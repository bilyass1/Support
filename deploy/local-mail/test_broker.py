import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
import io
import json
import struct
from unittest.mock import Mock
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('broker', Path(__file__).with_name('broker.py'))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)

class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.body = {'operation': 'create', 'domain': 'cimeevents.com', 'local_part': 'new',
                     'mailbox_id': str(uuid.uuid4()), 'password': 'Long-Private-Password-123'}
        self.allow = patch.object(broker, 'settings', return_value={'domains': ['cimeevents.com'], 'max_accounts': 20})
        self.allow.start()
        self.addCleanup(self.allow.stop)

    def test_disallows_other_domains_and_shell_metacharacters(self):
        for changes in ({'domain': 'solumove.net'}, {'local_part': 'a;id'}, {'local_part': '../root'},
                        {'local_part': '-root'}, {'local_part': 'a' * 30}, {'mailbox_id': '../root'}):
            with self.subTest(changes=changes), self.assertRaises(broker.Rejected):
                broker.identity({**self.body, **changes})

    def test_password_rejects_chpasswd_line_injection(self):
        for password in ('short', 'long-password\nroot:evil', 'long-password\0evil'):
            with self.assertRaises(broker.Rejected):
                broker.validate_password({'password': password})

    def test_rejects_existing_linux_user_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(broker, 'STATE', Path(directory)), \
             patch.object(broker, 'verify_domain'), patch.object(broker, 'entries', return_value={}), \
             patch.object(broker.pwd, 'getpwnam', return_value=object()), patch.object(broker, 'command') as command:
            with self.assertRaises(broker.Rejected):
                broker.provision(self.body)
            command.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_rejects_existing_alias_and_never_adopts_account(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(broker, 'STATE', Path(directory)), \
             patch.object(broker, 'verify_domain'), \
             patch.object(broker, 'entries', return_value={'new@cimeevents.com': 'old@localhost'}), \
             patch.object(broker, 'command') as command:
            with self.assertRaises(broker.Rejected):
                broker.provision(self.body)
            command.assert_not_called()

    def test_rejects_reset_without_managed_identity(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(broker, 'STATE', Path(directory)), \
             patch.object(broker, 'verify_domain'), patch.object(broker, 'command') as command:
            with self.assertRaises(FileNotFoundError):
                broker.provision({**self.body, 'operation': 'reset_password'})
            command.assert_not_called()

    def test_creation_keeps_password_out_of_state_and_command_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'homes'
            home.mkdir()
            account = SimpleNamespace(pw_uid=10001, pw_dir=str(home / 'new-cimeevents.com'), pw_shell='/sbin/nologin')
            with patch.object(broker, 'STATE', root), patch.object(broker, 'HOME_ROOT', home), \
                 patch.object(broker, 'verify_domain'), patch.object(broker, 'entries', return_value={}), \
                 patch.object(broker.pwd, 'getpwnam', side_effect=[KeyError(), account]), \
                 patch.object(broker.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=5000)), \
                 patch.object(broker.os, 'chown'), patch.object(broker, 'add_alias') as alias, \
                 patch.object(broker, 'command') as command:
                broker.provision(self.body)
                record = root / (self.body['mailbox_id'] + '.json')
                self.assertNotIn(self.body['password'], record.read_text())
                self.assertIn('"phase": "active"', record.read_text())
                alias.assert_called_once_with('new@cimeevents.com', 'new-cimeevents.com', self.body['mailbox_id'])
                self.assertNotIn(self.body['password'], str([call.args[0] for call in command.call_args_list]))
                command.assert_any_call(['/usr/sbin/chpasswd'], 'new-cimeevents.com:' + self.body['password'] + '\n')

    def test_failed_creation_retains_incomplete_record_and_does_not_publish_alias(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(broker, 'STATE', Path(directory)), \
             patch.object(broker, 'verify_domain'), patch.object(broker, 'entries', return_value={}), \
             patch.object(broker.pwd, 'getpwnam', side_effect=KeyError()), \
             patch.object(broker.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=5000)), \
             patch.object(broker, 'command', side_effect=broker.Rejected()), patch.object(broker, 'add_alias') as alias:
            with self.assertRaises(broker.Rejected):
                broker.provision(self.body)
            self.assertIn('"phase": "creating"', (Path(directory) / (self.body['mailbox_id'] + '.json')).read_text())
            alias.assert_not_called()

    def test_independent_root_account_limit(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(broker, 'STATE', Path(directory)), \
             patch.object(broker, 'settings', return_value={'domains': ['cimeevents.com'], 'max_accounts': 1}), \
             patch.object(broker, 'verify_domain'), patch.object(broker, 'entries', return_value={}), \
             patch.object(broker.pwd, 'getpwnam', side_effect=KeyError()), patch.object(broker, 'command') as command:
            (Path(directory) / 'existing.json').write_text('{}')
            with self.assertRaises(broker.Rejected):
                broker.provision(self.body)
            command.assert_not_called()

    def test_socket_peer_identity_is_required_before_provisioning(self):
        for uid, allowed in ((12345, True), (99999, False)):
            handler = broker.Handler.__new__(broker.Handler)
            raw = json.dumps(self.body).encode()
            handler.connection = Mock()
            handler.connection.getsockopt.return_value = struct.pack('3i', 100, uid, 100)
            handler.path = '/'
            handler.headers = {'Content-Length': str(len(raw))}
            handler.rfile, handler.wfile = io.BytesIO(raw), io.BytesIO()
            handler.send_response = Mock()
            handler.send_header = Mock()
            handler.end_headers = Mock()
            with patch.object(broker.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=12345)), \
                 patch.object(broker, 'provision') as provision:
                handler.do_POST()
                self.assertEqual(provision.call_count, int(allowed))
                self.assertEqual(json.loads(handler.wfile.getvalue())['ok'], allowed)

    def test_rejects_unsupported_operations(self):
        for operation in ('shell', 'delete', 'suspend', 'resume'):
            with self.assertRaises(broker.Rejected):
                broker.provision({**self.body, 'operation': operation})

    def test_root_imported_imf_layout_can_reset_without_moving_messages_or_changing_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);home=root/'home';home.mkdir();legacy=home/'imf_contact'
            for folder in (legacy,legacy/'Maildir',legacy/'Maildir/cur',legacy/'Maildir/new',legacy/'Maildir/tmp'):folder.mkdir()
            message=legacy/'Maildir/cur/existing-message';message.write_text('keep existing mail')
            body={**self.body,'domain':'imf-immobiliere.tn','local_part':'contact','operation':'reset_password'}
            name='contact-imf-immobiliere.tn';account=SimpleNamespace(pw_uid=5022,pw_shell='/sbin/nologin',pw_dir=str(legacy))
            record={'domain':body['domain'],'local_part':'contact','username':name,'uid':5022,'phase':'active','home':str(legacy),'alias_target':name+'@mail.solumove.net'}
            state=root/(body['mailbox_id']+'.json');state.write_text(json.dumps(record))
            original=Path.lstat
            def lstat(path):
                info=original(path)
                return SimpleNamespace(st_mode=info.st_mode,st_uid=5022) if path.is_relative_to(home) else info
            def command(args,data=None):
                if args[-1]=='myhostname':return 'mail.solumove.net'
                if args[-1]=='mydestination':return '$myhostname, localhost.$mydomain, localhost'
                return ''
            with patch.object(broker,'STATE',root),patch.object(broker,'HOME_ROOT',home),patch.object(broker,'settings',return_value={'domains':['imf-immobiliere.tn'],'max_accounts':20}),patch.object(broker,'verify_domain'),patch.object(broker,'secure_file'),patch.object(broker,'entries',return_value={'contact@imf-immobiliere.tn':record['alias_target']}),patch.object(broker.pwd,'getpwnam',return_value=account),patch.object(Path,'lstat',lstat),patch.object(broker,'command',side_effect=command) as calls:
                broker.provision(body)
                calls.assert_any_call(['/usr/sbin/chpasswd'],name+':'+body['password']+'\n')
                self.assertEqual(json.loads(state.read_text()),record)
                self.assertEqual(message.read_text(),'keep existing mail')
                # Even a reviewed record cannot reset a replacement Unix identity.
                account.pw_uid=5999;calls.reset_mock()
                with self.assertRaises(broker.Rejected):broker.provision(body)
                self.assertFalse(any(call.args[0][0]=='/usr/sbin/chpasswd' for call in calls.call_args_list))

    def test_reviewed_layout_rejects_nonlocal_aliases_and_home_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory);account=SimpleNamespace(pw_uid=5022,pw_shell='/sbin/nologin',pw_dir=str(home/'legacy'))
            for path in (home/'legacy',home/'legacy/Maildir',home/'legacy/Maildir/cur',home/'legacy/Maildir/new',home/'legacy/Maildir/tmp'):path.mkdir()
            original=Path.lstat
            def lstat(path):
                info=original(path);return SimpleNamespace(st_mode=info.st_mode,st_uid=5022)
            with patch.object(broker,'HOME_ROOT',home),patch.object(Path,'lstat',lstat),patch.object(broker,'command',side_effect=['mail.solumove.net','$myhostname, localhost']):
                with self.assertRaises(broker.Rejected):broker.reviewed_layout(account,'contact-imf-immobiliere.tn',home/'legacy','root@localhost')
            (home/'unsafe').symlink_to(home/'legacy',target_is_directory=True);account.pw_dir=str(home/'unsafe')
            with patch.object(broker,'HOME_ROOT',home),patch.object(Path,'lstat',lstat):
                with self.assertRaises(broker.Rejected):broker.reviewed_layout(account,'contact-imf-immobiliere.tn',home/'unsafe','contact-imf-immobiliere.tn@localhost')

if __name__ == '__main__':
    unittest.main()
