import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SecurityForm } from '@/components/security-form';
export const dynamic='force-dynamic';
export default async function Page(){const session=await auth.api.getSession({headers:await headers()});if(!session)redirect('/login');if(session.user.twoFactorEnabled)redirect('/');return <SecurityForm enroll/>;}
