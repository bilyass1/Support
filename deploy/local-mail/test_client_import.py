import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch


def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


client=load('client_bootstrap','import-client.py')
helper=load('existing_helper','import_existing.py')


class ClientImportTests(unittest.TestCase):
    def test_adds_only_the_requested_domain_and_preserves_existing_headroom(self):
        original={'domains':['existing.example'],'max_accounts':20,'other_setting':'keep'}
        states=[{'domain':'existing.example'} for _ in range(9)]
        result=client.import_configuration(original,states,'imf-immobiliere.tn',20)
        self.assertEqual(result,{'domains':['existing.example','imf-immobiliere.tn'],'max_accounts':40,'other_setting':'keep'})
        self.assertEqual(original,{'domains':['existing.example'],'max_accounts':20,'other_setting':'keep'})

    def test_repeated_preparation_never_duplicates_the_domain_or_grows_capacity_again(self):
        config={'domains':['existing.example','imf-immobiliere.tn'],'max_accounts':40}
        states=[{'domain':'existing.example'}]*9+[{'domain':'imf-immobiliere.tn'}]*2
        self.assertEqual(client.import_configuration(config,states,'imf-immobiliere.tn',20),config)

    def test_refuses_an_excessive_root_limit(self):
        with self.assertRaises(RuntimeError):
            client.import_configuration({'domains':['existing.example'],'max_accounts':990},[],'imf-immobiliere.tn',20)

    def context(self,**changes):
        info={'email':'client@example.com','admin':True,'active_subscription':True,'domain':None,'other_mailboxes':0,'rows':[]}
        info.update(changes);return info

    def args(self):
        return types.SimpleNamespace(organization='11111111-1111-4111-8111-111111111111',actor='admin',domain='imf-immobiliere.tn',mailboxes='contact,info',expected_email='client@example.com',preserve_subscription=True)

    def test_requires_the_explicit_client_email_before_import(self):
        with patch.object(helper,'pg',return_value=self.context(email='another@example.com')):
            with self.assertRaises(helper.Refused):helper.inspect_database(self.args())

    def test_preserving_a_pack_can_share_it_with_other_existing_domains(self):
        with patch.object(helper,'pg',return_value=self.context(other_mailboxes=3)):
            self.assertEqual(helper.inspect_database(self.args())['other_mailboxes'],3)

    def test_preserving_a_pack_still_refuses_domain_takeover(self):
        with patch.object(helper,'pg',return_value=self.context(domain={'organization_id':'another-client','provider':'postfix'})):
            with self.assertRaises(helper.Refused):helper.inspect_database(self.args())

    def test_repeated_import_accepts_only_the_selected_mailboxes(self):
        rows=[{'local_part':'contact'},{'local_part':'info'}]
        with patch.object(helper,'pg',return_value=self.context(rows=rows)):
            self.assertEqual(helper.inspect_database(self.args())['rows'],rows)
        with patch.object(helper,'pg',return_value=self.context(rows=rows+[{'local_part':'unexpected'}])):
            with self.assertRaises(helper.Refused):helper.inspect_database(self.args())


if __name__=='__main__':unittest.main()
