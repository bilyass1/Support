#!/usr/bin/python3
"""Root-owned mailbox broker. No TCP listener and no arbitrary command endpoint."""
import grp
import http.server
import json
import os
from pathlib import Path
import pwd
import re
import socket
import socketserver
import stat
import struct
import subprocess
import tempfile
import uuid

CONFIG = Path('/etc/supportflow-mail.json')
STATE = Path('/var/lib/supportflow-mail')
SOCKET = '/run/supportflow-mail/broker.sock'
ALIAS = Path('/etc/postfix/virtual')
MAILBOX_MAP = Path('/etc/postfix/vmailbox')
HOME_ROOT = Path('/home')
DOMAIN = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\Z')
LOCAL = re.compile(r'[a-z0-9]+(?:[._-][a-z0-9]+)*\Z')

class Rejected(Exception):
    pass

def command(args, data=None):
    # No shell; passwords are passed only over stdin, never through argv/logs.
    try:
        return subprocess.run(args, input=data, text=True, capture_output=True,
                              timeout=10, check=True, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        raise Rejected('system operation failed') from None

def secure_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise Rejected('unsafe file')

def settings():
    secure_file(CONFIG)
    config = json.loads(CONFIG.read_text())
    domains = config.get('domains')
    if not isinstance(domains, list) or not domains or any(not isinstance(d, str) or not DOMAIN.fullmatch(d) for d in domains):
        raise Rejected('invalid allowlist')
    limit = config.get('max_accounts')
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise Rejected('invalid account limit')
    return config

def identity(body):
    domain, local = body.get('domain'), body.get('local_part')
    if not isinstance(domain, str) or not DOMAIN.fullmatch(domain) or domain not in settings()['domains']:
        raise Rejected('domain not allowed')
    if not isinstance(local, str) or len(local) > 64 or not LOCAL.fullmatch(local):
        raise Rejected('invalid address')
    username = local + '-' + domain
    if len(username.encode()) > 32:
        raise Rejected('account name too long')
    try:
        mailbox_id = str(uuid.UUID(body.get('mailbox_id', '')))
    except (ValueError, TypeError, AttributeError):
        raise Rejected('invalid mailbox identity') from None
    return domain, local, username, mailbox_id

def validate_password(body):
    password = body.get('password')
    if not isinstance(password, str) or not 12 <= len(password) <= 128 or any(c in password for c in '\r\n\0'):
        raise Rejected('invalid password')
    return password

def verify_domain(domain):
    if not isinstance(domain, str) or domain not in settings()['domains']:
        raise Rejected('domain not allowed')
    if command(['/usr/sbin/postconf', '-h', 'virtual_alias_maps']) != 'hash:/etc/postfix/virtual':
        raise Rejected('unsupported alias backend')
    domains = re.split(r'[\s,]+', command(['/usr/sbin/postconf', '-h', 'virtual_alias_domains']))
    if domain not in domains:
        raise Rejected('domain not configured in Postfix')
    if command(['/usr/bin/doveconf', '-h', 'auth_username_format']) != '%n-%d':
        raise Rejected('unsupported authentication mapping')
    if command(['/usr/bin/doveconf', '-h', 'mail_location']) != 'maildir:~/Maildir:LAYOUT=fs':
        raise Rejected('unsupported mailbox layout')
    secure_file(ALIAS)
    secure_file(Path(str(ALIAS) + '.db'))

def entries(path):
    secure_file(path)
    return {line.split()[0].lower(): ' '.join(line.split()[1:])
            for line in path.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith('#') and len(line.split()) >= 2}

def reviewed_layout(account, username, home, target):
    # Imported accounts may retain their pre-existing home and local hostname
    # alias. Only a root-reviewed state record can authorize that layout.
    if account.pw_uid < 1000 or account.pw_shell != '/sbin/nologin' or account.pw_dir != str(home) or home.parent != HOME_ROOT:
        raise Rejected('unsafe imported account')
    for directory in (home, home/'Maildir', home/'Maildir/cur', home/'Maildir/new', home/'Maildir/tmp'):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != account.pw_uid:
            raise Rejected('unsafe imported home')
    hostname = command(['/usr/sbin/postconf', '-h', 'myhostname'])
    destinations = re.split(r'[\s,]+', command(['/usr/sbin/postconf', '-h', 'mydestination']))
    if target == username+'@localhost':
        if 'localhost' not in destinations:
            raise Rejected('localhost is not local delivery')
    elif target != username+'@'+hostname or not DOMAIN.fullmatch(hostname) or not ({hostname, '$myhostname'} & set(destinations)):
        raise Rejected('nonlocal imported alias')

def atomic_json(path, value):
    fd, name = tempfile.mkstemp(dir=STATE, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def add_alias(address, username, mailbox_id):
    old = ALIAS.read_bytes()
    backup = STATE / (mailbox_id + '.virtual.before')
    backup.write_bytes(old)
    os.chmod(backup, 0o600)
    fd, temporary = tempfile.mkstemp(dir=ALIAS.parent, prefix='.supportflow-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(old + (b'' if old.endswith(b'\n') else b'\n') +
                         (address + ' ' + username + '@localhost\n').encode())
            stream.flush()
            os.fsync(stream.fileno())
        command(['/usr/sbin/postmap', 'hash:' + temporary])
        os.chmod(temporary, 0o644)
        os.chmod(temporary + '.db', 0o644)
        # Preserve the source's SELinux label on both files before installing.
        command(['/usr/bin/chcon', '--reference=' + str(ALIAS), temporary])
        command(['/usr/bin/chcon', '--reference=' + str(ALIAS) + '.db', temporary + '.db'])
        os.replace(temporary + '.db', str(ALIAS) + '.db')
        os.replace(temporary, ALIAS)
    finally:
        for name in (temporary, temporary + '.db'):
            if os.path.exists(name):
                os.unlink(name)

def provision(body):
    operation = body.get('operation')
    if operation == 'verify_domain':
        verify_domain(body.get('domain'))
        return
    if operation not in ('create', 'reset_password'):
        raise Rejected('unsupported operation')
    domain, local, username, mailbox_id = identity(body)
    password = validate_password(body)
    verify_domain(domain)
    address, home = local + '@' + domain, HOME_ROOT / username
    state_path = STATE / (mailbox_id + '.json')
    if operation == 'reset_password':
        secure_file(state_path)
        record = json.loads(state_path.read_text())
        account = pwd.getpwnam(username)
        expected = {'domain': domain, 'local_part': local, 'username': username, 'uid': account.pw_uid, 'phase': 'active'}
        if 'home' in record or 'alias_target' in record:
            if not isinstance(record.get('home'), str) or not isinstance(record.get('alias_target'), str):
                raise Rejected('invalid reviewed layout')
            home, target = Path(record['home']), record['alias_target']
            reviewed_layout(account, username, home, target)
            expected.update({'home': str(home), 'alias_target': target})
        else:
            target = username+'@localhost'
        if record != expected:
            raise Rejected('unmanaged mailbox')
        if account.pw_shell != '/sbin/nologin' or account.pw_dir != str(home) or entries(ALIAS).get(address) != target:
            raise Rejected('mailbox identity changed')
        command(['/usr/sbin/chpasswd'], username + ':' + password + '\n')
        return
    if state_path.exists() or home.exists() or home.is_symlink() or address in entries(ALIAS) or address in entries(MAILBOX_MAP):
        raise Rejected('existing address or incomplete operation')
    # Also reject catch-all/domain aliases, which require an administrator's review.
    if '@' + domain in entries(ALIAS) or domain in entries(ALIAS):
        raise Rejected('domain has a catch-all')
    try:
        pwd.getpwnam(username)
    except KeyError:
        pass
    else:
        raise Rejected('existing Linux account')
    if len(list(STATE.glob('*.json'))) >= settings()['max_accounts']:
        raise Rejected('broker account limit reached')
    atomic_json(state_path, {'domain': domain, 'local_part': local, 'username': username, 'phase': 'creating'})
    # A failure leaves the account locked and an evidence record. Never adopt/retry it blindly.
    group = grp.getgrnam('vmail')
    command(['/usr/sbin/useradd', '--no-create-home', '--no-user-group', '--gid', str(group.gr_gid),
             '--home-dir', str(home), '--shell', '/sbin/nologin', username])
    account = pwd.getpwnam(username)
    for directory in (home, home / 'Maildir', home / 'Maildir/cur', home / 'Maildir/new', home / 'Maildir/tmp'):
        directory.mkdir(mode=0o700)
        os.chown(directory, account.pw_uid, group.gr_gid)
    command(['/usr/sbin/restorecon', '-R', str(home)])
    add_alias(address, username, mailbox_id)
    command(['/usr/sbin/chpasswd'], username + ':' + password + '\n')
    atomic_json(state_path, {'domain': domain, 'local_part': local, 'username': username, 'uid': account.pw_uid, 'phase': 'active'})

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log payloads, passwords, raw command output or HTTP headers.

    def do_POST(self):
        status, result = 400, {'ok': False}
        try:
            uid = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
            if uid != pwd.getpwnam('supportflow').pw_uid or self.path != '/':
                raise Rejected('unauthorized peer')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096 or self.headers.get('Transfer-Encoding'):
                raise Rejected('invalid request')
            self.connection.settimeout(5)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise Rejected('invalid request')
            provision(body)
            status, result = 200, {'ok': True}
        except Exception:
            # Generic errors keep secrets and system details out of the application.
            pass
        payload = json.dumps(result).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            pass

class Server(socketserver.UnixStreamServer):
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address

if __name__ == '__main__':
    os.umask(0o077)
    settings()
    if os.path.lexists(SOCKET):
        if not stat.S_ISSOCK(os.lstat(SOCKET).st_mode):
            raise RuntimeError('unsafe socket path')
        os.unlink(SOCKET)
    # One request at a time serializes account and alias modifications.
    with Server(SOCKET, Handler) as server:
        os.chown(SOCKET, 0, grp.getgrnam('supportflow').gr_gid)
        os.chmod(SOCKET, 0o660)
        server.serve_forever()
