'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BellRing, Fingerprint, Lock, LogOut, Share } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Brand } from './login-form';

function keyBytes(value:string) {
  const padded=(value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(padded),char=>char.charCodeAt(0));
}
/** Subscribes this device and stores the subscription on the server. Returns false when it could not be done. */
export async function subscribeDevice(publicKey:string,test=false) {
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  const current=subscription?.options.applicationServerKey;
  // A subscription created with another server key can never be used again: replace it.
  if(subscription&&current&&btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==publicKey){await subscription.unsubscribe();subscription=null;}
  subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
  const response=await fetch('/api/push'+(test?'?test=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription.toJSON())});
  return response.ok;
}
type PushState='checking'|'ok'|'ask'|'denied'|'install'|'unsupported'|'error';
/** Blocks the workspace until this device receives push notifications. Skipped only when the server has no push keys. */
export function PushGate({children,onStatus}:{children:ReactNode;onStatus:(configured:boolean)=>void}) {
  const [state,setState]=useState<PushState>('checking'),[key,setKey]=useState(''),[pending,setPending]=useState(false);
  const check=useCallback(async(publicKey:string)=>{
    const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
    if(!supported){
      const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
      const standalone=window.matchMedia('(display-mode: standalone)').matches||(navigator as {standalone?:boolean}).standalone===true;
      setState(ios&&!standalone?'install':'unsupported');return;
    }
    if(Notification.permission==='denied'){setState('denied');return;}
    if(Notification.permission==='default'){setState('ask');return;}
    try{setState(await subscribeDevice(publicKey)?'ok':'error');}catch{setState('error');}
  },[]);
  useEffect(()=>{
    fetch('/api/push',{cache:'no-store'}).then(r=>r.json()).then(value=>{
      onStatus(Boolean(value.public_key));
      if(!value.public_key||value.required===false){setState('ok');return;}
      setKey(value.public_key);return check(value.public_key);
    }).catch(()=>setState('error'));
  },[check,onStatus]);
  if(state==='ok')return <>{children}</>;
  if(state==='checking')return <main className="login-page"><Brand/></main>;
  const signOut=async()=>{await authClient.signOut();window.location.assign('/login');};
  return <main className="login-page"><div className="login-card"><Brand/><div className="gate-icon"><BellRing size={30}/></div>
    {state==='ask'?<><h1>Activez les notifications</h1><p className="muted">Pour ne manquer aucune estimation, livraison ou facture, les notifications sont obligatoires sur chaque appareil. Vous serez prévenu même lorsque l’application est fermée.</p>
      <button className="primary wide" disabled={pending} onClick={async()=>{setPending(true);try{const permission=await Notification.requestPermission();if(permission==='granted')setState(await subscribeDevice(key,true)?'ok':'error');else setState(permission==='denied'?'denied':'ask');}catch{setState('error');}finally{setPending(false);}}}><BellRing size={18}/>{pending?'Activation…':'Activer les notifications'}</button></>:null}
    {state==='denied'?<><h1>Les notifications sont bloquées</h1><p className="muted">Votre navigateur a bloqué les notifications pour ce site. Pour continuer :</p>
      <ol className="steps-list"><li>Cliquez sur l’icône de cadenas ou de réglages à gauche de l’adresse du site.</li><li>Dans « Notifications », choisissez « Autoriser ».</li><li>Revenez ici et appuyez sur « J’ai autorisé ».</li></ol>
      <button className="primary wide" onClick={()=>check(key)}>J’ai autorisé les notifications</button></>:null}
    {state==='install'?<><h1>Installez l’application</h1><p className="muted">Sur iPhone et iPad, les notifications fonctionnent une fois l’application ajoutée à l’écran d’accueil :</p>
      <ol className="steps-list"><li>Ouvrez cette page dans Safari.</li><li>Appuyez sur Partager <Share size={14}/>.</li><li>Choisissez « Sur l’écran d’accueil ».</li><li>Ouvrez SupportFlow depuis l’écran d’accueil.</li></ol></>:null}
    {state==='unsupported'?<><h1>Navigateur non compatible</h1><p className="muted">Ce navigateur ne peut pas recevoir de notifications. Ouvrez votre espace avec Chrome, Edge, Firefox ou Safari à jour, en navigation normale (pas en navigation privée).</p></>:null}
    {state==='error'?<><h1>Activation impossible pour le moment</h1><p className="muted">L’abonnement aux notifications n’a pas pu être enregistré. Vérifiez votre connexion puis réessayez.</p><button className="primary wide" onClick={()=>key?check(key):window.location.reload()}>Réessayer</button></>:null}
    <button className="text-button" onClick={signOut}><LogOut size={15}/>Se déconnecter</button>
  </div></main>;
}

const IDLE_MS=5*60_000;
/** Hides the workspace after five minutes away; a registered device reopens it with Face ID or fingerprint. */
export function LockScreen({children,email}:{children:ReactNode;email:string}) {
  const [locked,setLocked]=useState(false),[enabled,setEnabled]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const last=useRef(0);
  useEffect(()=>{authClient.passkey.listUserPasskeys().then(result=>setEnabled(Boolean(result.data?.length))).catch(()=>{});},[]);
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
  return <><div hidden={locked}>{children}</div>{locked?<main className="login-page lock"><div className="login-card"><Brand/><div className="gate-icon"><Lock size={30}/></div><h1>Espace verrouillé</h1><p className="muted">Par sécurité, votre espace se verrouille après cinq minutes d’inactivité.</p>
    {error?<p className="error" role="alert">{error}</p>:null}
    <button className="primary wide" disabled={pending} onClick={async()=>{setPending(true);setError('');try{const result=await authClient.signIn.passkey();if(result?.error)setError('Déverrouillage refusé. Réessayez.');else{
      // The workspace on screen belongs to one account: another account's device key must not reveal it.
      const session=await authClient.getSession();
      if(session.data?.user.email!==email){window.location.assign('/');return;}
      last.current=Date.now();setLocked(false);}}catch{setError('Déverrouillage impossible.');}finally{setPending(false);}}}><Fingerprint size={19}/>{pending?'En attente…':'Déverrouiller avec Face ID / empreinte'}</button>
    <button className="text-button" onClick={async()=>{await authClient.signOut();window.location.assign('/login');}}><LogOut size={15}/>Se déconnecter</button>
  </div></main>:null}</>;
}
