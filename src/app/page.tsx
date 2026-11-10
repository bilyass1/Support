import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, twoFactorRequired } from '@/lib/auth';
import { Dashboard } from '@/components/dashboard';
export const dynamic='force-dynamic';
export default async function Page() {
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)return <main className="login-page"><div className="login-card"><div className="brand"><span className="brand-icon">S</span>SupportFlow</div><h1>Le projet est prêt à configurer</h1><p>Renseignez DATABASE_URL, BETTER_AUTH_URL et BETTER_AUTH_SECRET dans .env.local, puis appliquez les migrations indiquées dans le README.</p></div></main>;
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect('/login');
  if(twoFactorRequired()&&!(session.user as {twoFactorEnabled?:boolean|null}).twoFactorEnabled)redirect('/securite');
  return <Dashboard email={session.user.email}/>;
}
