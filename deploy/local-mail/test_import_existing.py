import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid
spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('import_existing.py'))
importer=importlib.util.module_from_spec(spec);spec.loader.exec_module(importer)

class ImportTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.state=self.root/'state';self.state.mkdir(mode=0o700);self.home=self.root/'home';self.alias={'contact@cimeevents.com':'contact-cimeevents.com@localhost'}
  self.broker=types.SimpleNamespace(STATE=self.state,HOME_ROOT=self.home,ALIAS=self.root/'virtual',secure_file=lambda p:None,entries=lambda p:self.alias,settings=lambda:{'max_accounts':20})
  self.parts=['contact','it','cm'];self.original_lstat=Path.lstat
  self.account=types.SimpleNamespace(pw_uid=5003,pw_shell='/sbin/nologin',pw_dir='')
  def account(name):return types.SimpleNamespace(pw_uid=5003,pw_shell='/sbin/nologin',pw_dir=str(self.home/name))
  def lstat(path):
   if str(path).startswith(str(self.home)):return types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=5003)
   info=self.original_lstat(path)
   if path==self.state:return types.SimpleNamespace(st_mode=info.st_mode,st_uid=0)
   return info
  self.patches=[patch.object(importer.pwd,'getpwnam',side_effect=account),patch.object(Path,'lstat',lstat),patch.object(importer,'query_alias',side_effect=lambda address,path:self.alias.get(address,''))]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def inspect(self,rows=None):return importer.inspect_accounts(self.broker,'cimeevents.com',self.parts,rows or [])
 def record(self,local='contact',phase='active',uid=5003):
  id=str(uuid.uuid4());data={'domain':'cimeevents.com','local_part':local,'username':local+'-cimeevents.com','uid':uid,'phase':phase};(self.state/(id+'.json')).write_text(json.dumps(data));return id
 def test_preserves_existing_ids_and_proposes_only_missing_aliases(self):
  existing=self.record();records=self.inspect();self.assertEqual(records[0]['id'],existing);self.assertFalse(records[0]['state_missing']);self.assertFalse(records[0]['alias_missing']);self.assertEqual([r['local_part'] for r in records if r['alias_missing']],['it','cm']);self.assertEqual(len(list(self.state.glob('*.json'))),1)
 def test_rejects_alias_takeover_and_changed_uid(self):
  self.alias['it@cimeevents.com']='someone@else.example'
  with self.assertRaises(importer.Refused):self.inspect()
  self.alias.pop('it@cimeevents.com');self.record(uid=5004)
  with self.assertRaises(importer.Refused):self.inspect()
 def test_rejects_incomplete_state_and_uuid_mismatch(self):
  self.record(phase='creating')
  with self.assertRaises(importer.Refused):self.inspect()
  for p in self.state.glob('*.json'):p.unlink()
  self.record()
  row={'local_part':'contact','id':str(uuid.uuid4()),'status':'active','operation':None,'reserved_tokens':0,'quota_mb':1000}
  with self.assertRaises(importer.Refused):self.inspect([row])
 def test_rejects_pending_operations_and_independent_broker_cap(self):
  row={'local_part':'contact','id':str(uuid.uuid4()),'status':'active','operation':'reset_password','reserved_tokens':0,'quota_mb':1000}
  with self.assertRaises(importer.Refused):self.inspect([row])
  self.broker.settings=lambda:{'max_accounts':2}
  with self.assertRaises(importer.Refused):self.inspect()
 def test_rejects_shell_injection_and_duplicate_addresses(self):
  args=types.SimpleNamespace(organization=str(uuid.uuid4()),actor='admin',domain='cimeevents.com',mailboxes='contact,contact',max_mailboxes=10,per_box_mb=1000,total_mb=10000)
  with self.assertRaises(importer.Refused):importer.validated_args(args)
  args.mailboxes='contact;touch /tmp/unsafe'
  with self.assertRaises(importer.Refused):importer.validated_args(args)
 def test_rejects_compiled_map_disagreement_and_home_symlink(self):
  with patch.object(importer,'query_alias',return_value='wrong@localhost'):
   with self.assertRaises(importer.Refused):self.inspect()
  original=Path.lstat
  def lstat(path):
   if path==self.home/'it-cimeevents.com':return types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=5003)
   return original(path)
  with patch.object(Path,'lstat',lstat):
   with self.assertRaises(importer.Refused):self.inspect()

if __name__=='__main__':unittest.main()
