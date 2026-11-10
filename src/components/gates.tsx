'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BellRing, Fingerprint, Lock, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { activatePush, blockedMessage, pushKey, pushSupportError, withPushTimeout } from '@/lib/push-client';

const signOut=async()=>{await authClient.signOut();window.location.assign('/login');};
function Card({icon,title,children}:{icon:ReactNode;title:string;children:ReactNode}){
 return <main className="login-page gate"><section className="login-card"><img className="brand-logo" src="/solumove-logo.webp" alt="Solumove Technologies"/><div className="gate-icon">{icon}</div><h1>{title}</h1>{children}
  <button className="text-button" onClick={signOut}><LogOut size={15}/>Se déconnecter</button></section></main>;
}
type Ready={registration:ServiceWorkerRegistration;key:Uint8Array<ArrayBuffer>};
type State='checking'|'open'|'ask'|'blocked'|'unsupported'|'error';
/**
 * The workspace stays closed until this device receives notifications for this account.
 * It opens without asking when the server has no push keys, or when FORCE_NOTIFICATIONS=false.
 */
export function PushGate({children}:{children:ReactNode}){
 const [state,setState]=useState<State>('checking'),[ready,setReady]=useState<Ready|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const activate=useCallback(async(target:Ready)=>{
  try{await activatePush(target.registration,target.key);setState('open');}
  catch(error){
   const blocked=(error instanceof DOMException&&error.name==='NotAllowedError')||Notification.permission==='denied';
   setMessage(blocked?blockedMessage:error instanceof Error?error.message:'Activation indisponible.');setState(blocked?'blocked':Notification.permission==='granted'?'error':'ask');
  }
 },[]);
 const prepare=useCallback(async()=>{
  setState('checking');setMessage('');
  try{
   const response=await fetch('/api/push',{cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(response.status===401){window.location.assign('/login');return;}
   const config=await response.json();
   if(!response.ok)throw new Error(config.error??'Vérification des notifications impossible.');
   if(!config.publicKey||config.required===false){setState('open');return;}
   const unavailable=pushSupportError();
   if(unavailable){setMessage(unavailable);setState('unsupported');return;}
   const registration=await withPushTimeout(navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready));
   const target={registration,key:pushKey(config.publicKey)};setReady(target);
   if(Notification.permission==='denied'){setMessage(blockedMessage);setState('blocked');}
   // Already authorised on this device: confirm the subscription for this account without another click.
   else if(Notification.permission==='granted')await activate(target);
   else setState('ask');
  }catch(error){setMessage(error instanceof Error?error.message:'Vérification des notifications impossible.');setState('error');}
 },[activate]);
 useEffect(()=>{void prepare();},[prepare]);
 if(state==='open')return <>{children}</>;
 if(state==='checking')return <main className="loading"><p role="status">Vérification des notifications…</p></main>;
 return <Card icon={<BellRing size={28}/>} title={state==='ask'?'Activez les notifications':state==='blocked'?'Notifications bloquées':state==='unsupported'?'Notifications indisponibles ici':'Activation à reprendre'}>
  {state==='ask'?<p className="muted">Les notifications sont obligatoires sur chaque appareil : estimations à valider, livraisons, factures et réponses du support vous parviennent même lorsque l’application est fermée.</p>:null}
  {state==='blocked'?<><p className="muted">Votre navigateur bloque les notifications de ce site. Autorisez-les, puis revenez ici :</p><ol className="gate-steps"><li>Ouvrez les réglages du site (icône à gauche de l’adresse).</li><li>Passez « Notifications » sur « Autoriser ».</li><li>Appuyez sur « J’ai autorisé ».</li></ol></>:null}
  {state==='unsupported'?<><p className="muted">{message}</p><ol className="gate-steps"><li>Sur iPhone ou iPad : ouvrez ce site dans Safari.</li><li>Partager → « Sur l’écran d’accueil ».</li><li>Ouvrez Solumove depuis l’écran d’accueil.</li></ol></>:null}
  {message&&state!=='unsupported'?<p className="error" role="alert">{message}</p>:null}
  {state==='ask'&&ready?<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');await activate(ready);setBusy(false);}}><BellRing size={17}/>{busy?'Activation…':'Activer les notifications'}</button>:null}
  {state!=='ask'?<button className="primary" onClick={()=>void prepare()}>{state==='blocked'?'J’ai autorisé les notifications':'Réessayer'}</button>:null}
 </Card>;
}

const IDLE_MS=5*60_000;
/**
 * After five minutes away the workspace is hidden until the registered device is unlocked again
 * (Face ID, fingerprint or device code). Accounts without a registered device are not locked.
 */
export function LockScreen({children}:{children:ReactNode}){
 const [locked,setLocked]=useState(false),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const last=useRef(0),owner=useRef('');
 useEffect(()=>{
  const refresh=()=>authClient.passkey.listUserPasskeys().then(result=>setEnabled(Boolean(result.data?.length))).catch(()=>{});
  authClient.getSession().then(session=>{owner.current=session.data?.user.id??'';}).catch(()=>{});
  void refresh();window.addEventListener('solumove:devices',refresh);return()=>window.removeEventListener('solumove:devices',refresh);
 },[]);
 useEffect(()=>{
  if(!enabled)return;
  last.current=Date.now();
  const touch=()=>{last.current=Date.now();};
  const verify=()=>{if(Date.now()-last.current>IDLE_MS)setLocked(true);};
  const visible=()=>{if(document.visibilityState==='visible')verify();};
  const events=['pointerdown','keydown','scroll'] as const;
  events.forEach(name=>window.addEventListener(name,touch,{passive:true}));
  document.addEventListener('visibilitychange',visible);
  const timer=window.setInterval(verify,15_000);
  return()=>{events.forEach(name=>window.removeEventListener(name,touch));document.removeEventListener('visibilitychange',visible);window.clearInterval(timer);};
 },[enabled]);
 async function unlock(){
  setBusy(true);setError('');
  try{
   const result=await authClient.signIn.passkey();
   if(result?.error){setError('Déverrouillage refusé. Réessayez.');return;}
   // The screen behind belongs to one account: another account's device must not reveal it.
   const session=await authClient.getSession();
   if(!session.data||session.data.user.id!==owner.current){window.location.assign('/');return;}
   last.current=Date.now();setLocked(false);
  }catch{setError('Déverrouillage impossible sur cet appareil.');}finally{setBusy(false);}
 }
 return <><div hidden={locked}>{children}</div>{locked?<Card icon={<Lock size={28}/>} title="Espace verrouillé">
  <p className="muted">Par sécurité, votre espace se verrouille après cinq minutes d’inactivité.</p>
  {error?<p className="error" role="alert">{error}</p>:null}
  <button className="primary" disabled={busy} onClick={unlock}><Fingerprint size={18}/>{busy?'En attente de l’appareil…':'Déverrouiller avec Face ID / empreinte'}</button></Card>:null}</>;
}
