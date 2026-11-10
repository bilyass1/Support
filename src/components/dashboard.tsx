'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Tickets, Users, Coins, Bell, Moon, Sun, LogOut, Mail, Receipt, Activity, ShieldCheck, Settings2, TriangleAlert } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import type { Workspace, Go, Run } from '@/lib/types';
import type { Module } from '@/lib/domain';
import { PushGate, LockScreen } from './gates';
import { MailWorkspace } from './mail-workspace';
import { Overview } from './views/overview';
import { TicketsView } from './views/tickets';
import { BillingView } from './views/billing';
import { UsageView } from './views/usage';
import { ClientsView } from './views/clients';
import { AdminView } from './views/admin';
import { LedgerView, NotificationsView } from './views/activity';
import { SecurityView } from './views/security';

type NavItem={id:string;label:string;short:string;icon:typeof Bell;module?:Module;role?:'staff'|'admin'};
const nav:NavItem[]=[
  {id:'overview',label:'Tableau de bord',short:'Accueil',icon:LayoutDashboard},
  {id:'tickets',label:'Demandes & support',short:'Demandes',icon:Tickets,module:'tickets'},
  {id:'billing',label:'Facturation',short:'Factures',icon:Receipt,module:'billing'},
  {id:'usage',label:'Applications & utilisation',short:'Applications',icon:Activity,module:'usage'},
  {id:'mail',label:'Messagerie',short:'Messagerie',icon:Mail,module:'mail'},
  {id:'ledger',label:'Crédits',short:'Crédits',icon:Coins,module:'credits'},
  {id:'clients',label:'Clients · vue 360°',short:'Clients',icon:Users,role:'staff'},
  {id:'admin',label:'Administration',short:'Admin',icon:Settings2,role:'admin'},
  {id:'notifications',label:'Notifications',short:'Alertes',icon:Bell},
  {id:'security',label:'Sécurité',short:'Sécurité',icon:ShieldCheck}
];
const roleLabels={admin:'Administrateur',manager:'Manager',client:'Client'};
export function Dashboard({email}:{email:string}) {
  const [pushConfigured,setPushConfigured]=useState(true);
  return <PushGate onStatus={setPushConfigured}><LockScreen email={email}><Workspace_ email={email} pushConfigured={pushConfigured}/></LockScreen></PushGate>;
}
function Workspace_({email,pushConfigured}:{email:string;pushConfigured:boolean}) {
  const [data,setData]=useState<Workspace|null>(null),[tab,setTab]=useState('overview'),[ticket,setTicket]=useState<string|null>(null);
  const [error,setError]=useState(''),[success,setSuccess]=useState(''),[dark,setDark]=useState(false);
  const timer=useRef<number|undefined>(undefined);
  const load=useCallback(async()=>{
    const response=await fetch('/api/workspace',{cache:'no-store'});
    if(response.status===401){window.location.assign('/login');return;}
    const value=await response.json();
    if(value.code==='two_factor_required'){window.location.assign('/securite');return;}
    if(!response.ok)throw new Error(value.error);
    setData(value);
  },[]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get('tab'))setTab(params.get('tab')!);
    if(params.get('ticket'))setTicket(params.get('ticket'));
    setDark(document.documentElement.dataset.theme==='dark');
    load().catch(e=>setError(e.message));
    // Keep the workspace fresh without a manual reload.
    const refresh=()=>{if(document.visibilityState==='visible')load().catch(()=>{});};
    const interval=window.setInterval(refresh,60_000);
    document.addEventListener('visibilitychange',refresh);
    return()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
  },[load]);
  const go:Go=useCallback((next,nextTicket=null)=>{
    setTab(next);setTicket(nextTicket);setError('');
    window.history.replaceState(null,'','/?tab='+next+(nextTicket?'&ticket='+nextTicket:''));
    window.scrollTo({top:0});
  },[]);
  const run:Run=useCallback(async(body,message='Modification enregistrée.')=>{
    setError('');setSuccess('');window.clearTimeout(timer.current);
    try {
      const response=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      await load();
      if(message){setSuccess(message);timer.current=window.setTimeout(()=>setSuccess(''),4000);}
      return result;
    }catch(e){setError(e instanceof Error?e.message:'Une erreur est survenue.');window.scrollTo({top:0,behavior:'smooth'});return null;}
  },[load]);
  useEffect(()=>{if(tab==='notifications'&&data?.unread)run({type:'mark_seen'},'');},[tab,data?.unread,run]);
  if(!data)return <main className="login-page">{error?<div className="login-card"><p className="error" role="alert">{error}</p><button onClick={()=>window.location.reload()}>Réessayer</button></div>:<p className="muted">Chargement de votre espace…</p>}</main>;
  const staff=data.actor.role!=='client',admin=data.actor.role==='admin';
  const items=nav.filter(n=>(!n.module||data.modules.includes(n.module))&&(!n.role||(n.role==='staff'?staff:admin)));
  const current=items.find(n=>n.id===tab)??items[0];
  const props={data,run,go,staff,admin,reload:load};
  const waiting=!staff&&!data.organizations.length;
  function theme(){const next=dark?'light':'dark';try{localStorage.setItem('supportflow:theme:v1',next);}catch{}document.documentElement.dataset.theme=next;setDark(!dark);}
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-icon">S</span>SupportFlow</div>
      <div className="workspace-label">{staff?'ESPACE ÉQUIPE':data.organizations[0]?.name?.toUpperCase()??'ESPACE CLIENT'}</div>
      <nav aria-label="Navigation principale">{items.map(n=><button key={n.id} className={current.id===n.id?'nav-active':''} aria-current={current.id===n.id?'page':undefined} onClick={()=>go(n.id)}>
        <n.icon size={19}/><span className="nav-long">{n.label}</span><span className="nav-short">{n.short}</span>
        {n.id==='notifications'&&data.unread?<span className="pill">{data.unread}</span>:null}
        {n.id==='overview'&&staff&&data.alerts.length?<span className="pill pill-danger">{data.alerts.length}</span>:null}
      </button>)}</nav>
      <div className="sidebar-bottom"><div className="avatar">{data.actor.name.slice(0,1).toUpperCase()}</div><div className="who"><strong>{data.actor.name}</strong><span>{roleLabels[data.actor.role]}</span></div>
        <button title="Se déconnecter" aria-label="Se déconnecter" onClick={async()=>{await authClient.signOut();window.location.assign('/login');}}><LogOut size={17}/></button></div>
    </aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">{staff?'PILOTAGE':'VOTRE ESPACE'}</p><h1>{current.label}</h1></div>
      <div className="actions"><button className="icon-button" aria-label={dark?'Passer en mode clair':'Passer en mode sombre'} onClick={theme}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
        <button className="icon-button" aria-label={`Notifications (${data.unread} non lues)`} onClick={()=>go('notifications')}><Bell size={18}/>{data.unread?<span className="dot"/>:null}</button>
        <button className="icon-button mobile-only" aria-label="Se déconnecter" onClick={async()=>{await authClient.signOut();window.location.assign('/login');}}><LogOut size={18}/></button></div></header>
    <div className="content">
      {error?<p className="error" role="alert">{error}</p>:null}{success?<p className="success toast" role="status">{success}</p>:null}
      {admin&&!pushConfigured?<p className="warning"><TriangleAlert size={16}/> Les notifications push ne sont pas encore configurées sur le serveur (clés VAPID manquantes). Voir Administration → Envois.</p>:null}
      {waiting?<section className="panel empty"><h2>Votre compte est prêt</h2><p>Notre équipe doit encore vous associer à votre organisation. Vous recevrez une notification dès que votre espace sera ouvert.</p></section>:null}
      {!waiting&&current.id==='overview'?<Overview {...props}/>:null}
      {current.id==='tickets'?<TicketsView {...props} selected={ticket} email={email}/>:null}
      {current.id==='billing'?<BillingView {...props}/>:null}
      {current.id==='usage'?<UsageView {...props}/>:null}
      {current.id==='mail'?<MailWorkspace workspace={data}/>:null}
      {current.id==='ledger'?<LedgerView {...props}/>:null}
      {current.id==='clients'?<ClientsView {...props}/>:null}
      {current.id==='admin'?<AdminView {...props}/>:null}
      {current.id==='notifications'?<NotificationsView {...props}/>:null}
      {current.id==='security'?<SecurityView email={email} pushConfigured={pushConfigured}/>:null}
    </div></main></div>;
}
