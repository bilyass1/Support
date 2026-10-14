'use client';
import { useEffect, useState } from 'react';
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export function Pwa() {
 const [install,setInstall]=useState<InstallEvent|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  const theme=localStorage.getItem('supportflow:theme:v1');document.documentElement.dataset.theme=theme??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  const handler=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent);};window.addEventListener('beforeinstallprompt',handler);return()=>window.removeEventListener('beforeinstallprompt',handler);
 },[]);
 async function push(){setBusy(true);setMessage('');try{
  if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Push non disponible. Les notifications restent dans votre espace.');
  const response=await fetch('/api/push',{cache:'no-store'});const config=await response.json();if(!response.ok)throw Error(config.error??'Connectez-vous et activez votre authenticator.');if(!config.publicKey)throw Error('Notifications push en attente de configuration par l’admin.');
  if(await Notification.requestPermission()!=='granted')throw Error('Permission non accordée. Vous pouvez la modifier dans votre navigateur.');
  const registration=await navigator.serviceWorker.ready;const existing=await registration.pushManager.getSubscription();
  const b64=config.publicKey.replace(/-/g,'+').replace(/_/g,'/'),decoded=atob(b64+'='.repeat((4-b64.length%4)%4));const key=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  const saved=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});if(!saved.ok){const body=await saved.json();throw Error(body.error??'Abonnement non enregistré.');}setMessage('Notifications activées sur cet appareil.');
 }catch(e){setMessage(e instanceof Error?e.message:'Activation indisponible.');}finally{setBusy(false);}}
 async function unsubscribe(){setBusy(true);try{const registration=await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription();if(sub){const r=await fetch('/api/push',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});if(!r.ok)throw Error('Reconnectez-vous pour retirer cet abonnement.');await sub.unsubscribe();}setMessage('Notifications désactivées sur cet appareil.');}catch(e){setMessage(e instanceof Error?e.message:'Retrait impossible.');}finally{setBusy(false);}}
 return <aside className="pwa-tools"><details><summary>Installer l’app & notifications</summary><p>Android / Chrome : Installer. Sur iPhone / iPad : Safari → Partager → Sur l’écran d’accueil. La disponibilité dépend du navigateur.</p>{install?<button onClick={async()=>{await install.prompt();await install.userChoice;setInstall(null);}}>Installer Solumove</button>:null}<div className="actions"><button disabled={busy} onClick={push}>Activer les notifications</button><button disabled={busy} onClick={unsubscribe}>Désactiver</button></div>{message?<p role="status">{message}</p>:null}<p>Chaque appareil doit donner son accord. Aucun document client n’est conservé hors ligne.</p></details></aside>;
}

