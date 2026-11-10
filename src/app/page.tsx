import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Dashboard } from '@/components/dashboard';
export const dynamic='force-dynamic';
export default async function Page() {
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)return <main className="loading"><div className="login-card"><div className="brand">SupportFlow</div><h1>Le projet est prêt à configurer</h1><p>Renseignez DATABASE_URL, BETTER_AUTH_URL et BETTER_AUTH_SECRET dans .env.local, puis appliquez les migrations indiquées dans le README.</p><p>Les données affichées ensuite proviennent de votre base PostgreSQL.</p></div></main>;
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect('/login');
  return <Dashboard/>;
}
