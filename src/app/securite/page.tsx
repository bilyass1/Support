import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SecuritySetup } from '@/components/security-setup';
export const dynamic='force-dynamic';
export default async function SecurityPage() {
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect('/login');
  if((session.user as {twoFactorEnabled?:boolean|null}).twoFactorEnabled)redirect('/');
  return <main className="login-page"><SecuritySetup email={session.user.email}/></main>;
}
