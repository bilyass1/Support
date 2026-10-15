import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {auth} from '@/lib/auth';
import {needsPassword} from '@/lib/client-accounts';
import {FirstLoginForm} from '@/components/first-login-form';
export const dynamic='force-dynamic';
export default async function Page(){const session=await auth.api.getSession({headers:await headers()});if(!session)redirect('/login');if(!await needsPassword(session.user.id))redirect('/');return <FirstLoginForm/>;}
