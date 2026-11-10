'use client';
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Fingerprint, KeyRound, MonitorSmartphone, Trash2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Field } from '../forms';
import { subscribeDevice } from '../gates';
import { deviceName } from '../security-setup';
import { ago, date } from '../ui';
type Passkey={id:string;name?:string|null;createdAt:Date|string};
type Session={id:string;token:string;userAgent?:string|null;updatedAt:Date|string};
function device(agent?:string|null) {
  if(!agent)return 'Appareil inconnu';
  const system=/iPhone/.test(agent)?'iPhone':/iPad/.test(agent)?'iPad':/Android/.test(agent)?'Android':/Mac OS/.test(agent)?'Mac':/Windows/.test(agent)?'Windows':/Linux/.test(agent)?'Linux':'Appareil';
  const browser=/Edg\//.test(agent)?'Edge':/Chrome\//.test(agent)?'Chrome':/Firefox\//.test(agent)?'Firefox':/Safari\//.test(agent)?'Safari':'navigateur';
  return system+' · '+browser;
}
export function SecurityView({email,pushConfigured}:{email:string;pushConfigured:boolean}) {
  const [passkeys,setPasskeys]=useState<Passkey[]>([]),[sessions,setSessions]=useState<Session[]>([]),[current,setCurrent]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[codes,setCodes]=useState<string[]>([]);
  const load=useCallback(async()=>{
    const [keys,list,session]=await Promise.all([authClient.passkey.listUserPasskeys(),authClient.listSessions(),authClient.getSession()]);
    setPasskeys((keys.data??[]) as Passkey[]);setSessions((list.data??[]) as Session[]);setCurrent(session.data?.session.token??'');
  },[]);
  useEffect(()=>{load().catch(()=>setError('Chargement impossible.'));},[load]);
  async function guard(operation:()=>Promise<string|void>){setError('');setMessage('');setPending(true);try{const done=await operation();if(done)setMessage(done);await load();}catch(e){setError(e instanceof Error&&e.message?e.message:'Opération impossible.');}finally{setPending(false);}}
  const fail=(text:string)=>{throw new Error(text);};
  return <>
    {message?<p className="success" role="status">{message}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    <div className="overview-grid">
      <div className="stack">
        <section className="panel"><h2><Fingerprint size={18}/> Face ID, empreinte et appareils de confiance</h2><p className="muted">Un appareil enregistré ouvre votre espace sans mot de passe ni code, et le déverrouille après une période d’inactivité.</p>
          {passkeys.map(p=><div className="mini-row" key={p.id}><div><strong>{p.name||'Appareil'}</strong><span className="small muted">Ajouté le {date(p.createdAt)}</span></div><button className="danger" disabled={pending} aria-label={'Supprimer '+(p.name||'cet appareil')} onClick={()=>{if(window.confirm('Supprimer cet appareil ? Il devra de nouveau utiliser le mot de passe et le code.'))guard(async()=>{const r=await authClient.passkey.deletePasskey({id:p.id});if(r.error)fail('Suppression impossible.');return 'Appareil supprimé.';});}}><Trash2 size={15}/></button></div>)}
          {!passkeys.length?<p className="warning">Aucun appareil enregistré : vous utilisez encore le mot de passe et le code à chaque connexion.</p>:null}
          <button className="primary" disabled={pending} onClick={()=>guard(async()=>{const r=await authClient.passkey.addPasskey({name:deviceName()});if(r?.error)fail('Cet appareil n’a pas pu être enregistré.');return 'Appareil enregistré : Face ID / empreinte activé.';})}><Fingerprint size={17}/>Enregistrer cet appareil</button></section>
        <section className="panel"><h2><BellRing size={18}/> Notifications</h2><p className="muted">Les notifications sont obligatoires sur chaque appareil. Envoyez un test pour vérifier leur réception.</p>
          <button disabled={pending||!pushConfigured} onClick={()=>guard(async()=>{const info=await (await fetch('/api/push',{cache:'no-store'})).json();if(!info.public_key||!await subscribeDevice(info.public_key,true))fail('Notifications indisponibles sur cet appareil.');return 'Notification de test envoyée.';})}>Envoyer une notification de test</button>
          {!pushConfigured?<p className="small muted">Le serveur n’a pas encore de clés de notification.</p>:null}</section>
      </div>
      <div className="stack">
        <section className="panel"><h2><MonitorSmartphone size={18}/> Sessions actives</h2>
          {sessions.map(s=><div className="mini-row" key={s.id}><div><strong>{device(s.userAgent)}{s.token===current?' · cet appareil':''}</strong><span className="small muted">Actif {ago(String(s.updatedAt)).toLowerCase()}</span></div>{s.token!==current?<button disabled={pending} onClick={()=>guard(async()=>{await authClient.revokeSession({token:s.token});return 'Session fermée.';})}>Déconnecter</button>:null}</div>)}
          {sessions.length>1?<button className="danger" disabled={pending} onClick={()=>guard(async()=>{await authClient.revokeOtherSessions();return 'Les autres appareils sont déconnectés.';})}>Déconnecter tous les autres appareils</button>:null}</section>
        <section className="panel"><h2><KeyRound size={18}/> Mot de passe et codes de secours</h2>
          <form className="form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);guard(async()=>{const r=await authClient.changePassword({currentPassword:String(f.get('current')),newPassword:String(f.get('next')),revokeOtherSessions:true});if(r.error)fail('Mot de passe actuel incorrect ou nouveau mot de passe trop court.');form.reset();return 'Mot de passe modifié. Les autres appareils sont déconnectés.';});}}>
            <input type="hidden" autoComplete="username" value={email} readOnly/>
            <div className="form-grid"><Field label="Mot de passe actuel"><input name="current" type="password" autoComplete="current-password" required/></Field><Field label="Nouveau (12 caractères min.)"><input name="next" type="password" autoComplete="new-password" minLength={12} required/></Field></div>
            <button disabled={pending}>Changer le mot de passe</button></form>
          <form className="form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,password=String(new FormData(form).get('password'));guard(async()=>{const r=await authClient.twoFactor.generateBackupCodes({password});if(r.error||!r.data)fail('Mot de passe incorrect.');setCodes(r.data!.backupCodes);form.reset();return 'Nouveaux codes générés. Les anciens ne fonctionnent plus.';});}}>
            <Field label="Mot de passe, pour générer de nouveaux codes de secours"><input name="password" type="password" autoComplete="current-password" required/></Field><button disabled={pending}>Générer de nouveaux codes</button></form>
          {codes.length?<><div className="backup-codes">{codes.map(c=><code key={c}>{c}</code>)}</div><p className="small muted">Conservez-les maintenant : ils ne seront plus affichés.</p></>:null}</section>
      </div>
    </div>
  </>;
}
