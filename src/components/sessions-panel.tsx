'use client';
import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
type Session={id:string;token:string;userAgent?:string|null;updatedAt:Date|string};
function device(agent?:string|null){
  if(!agent)return 'Appareil inconnu';
  const system=/iPhone/.test(agent)?'iPhone':/iPad/.test(agent)?'iPad':/Android/.test(agent)?'Android':/Mac OS/.test(agent)?'Mac':/Windows/.test(agent)?'Windows':/Linux/.test(agent)?'Linux':'Appareil';
  const browser=/Edg\//.test(agent)?'Edge':/Chrome\//.test(agent)?'Chrome':/Firefox\//.test(agent)?'Firefox':/Safari\//.test(agent)?'Safari':'navigateur';
  return system+' · '+browser;
}
/** Where the account is signed in, with a way to sign another device out. */
export function SessionsPanel(){
  const [sessions,setSessions]=useState<Session[]>([]),[current,setCurrent]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const load=useCallback(async()=>{
    const [list,session]=await Promise.all([authClient.listSessions(),authClient.getSession()]);
    setSessions((list.data??[]) as Session[]);setCurrent(session.data?.session.token??'');
  },[]);
  useEffect(()=>{load().catch(()=>setError('Chargement des sessions impossible.'));},[load]);
  async function run(operation:()=>Promise<{error?:unknown}|undefined|void>,done:string){
    setPending(true);setError('');setMessage('');
    try{const result=await operation();if(result&&result.error)setError('Opération impossible.');else{setMessage(done);await load();}}catch{setError('Opération impossible.');}finally{setPending(false);}
  }
  return <section className="panel"><h2><MonitorSmartphone size={18}/> Sessions actives</h2><p className="muted">Les appareils sur lesquels votre compte est ouvert en ce moment.</p>
    {message?<p className="success" role="status">{message}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    {sessions.map(s=><div className="mini-row" key={s.id}><div><strong>{device(s.userAgent)}{s.token===current?' · cet appareil':''}</strong><span className="small muted">Dernière activité : {new Date(s.updatedAt).toLocaleString('fr-TN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span></div>
      {s.token!==current?<button disabled={pending} onClick={()=>run(()=>authClient.revokeSession({token:s.token}),'Appareil déconnecté.')}>Déconnecter</button>:null}</div>)}
    {sessions.length>1?<button className="danger spaced" disabled={pending} onClick={()=>run(()=>authClient.revokeOtherSessions(),'Les autres appareils sont déconnectés.')}>Déconnecter tous les autres appareils</button>:null}</section>;
}
