'use client';
import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Trash2, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
type Device={id:string;name?:string|null;createdAt:Date|string};
function deviceName(){
 const agent=navigator.userAgent;
 const system=/iPhone/.test(agent)?'iPhone':/iPad/.test(agent)?'iPad':/Android/.test(agent)?'Android':/Mac/.test(agent)?'Mac':/Windows/.test(agent)?'Windows':'Appareil';
 return system+' · '+new Date().toLocaleDateString('fr-TN');
}
async function register(){
 const result=await authClient.passkey.addPasskey({name:deviceName()});
 if(result?.error)throw new Error('Cet appareil n’a pas pu être enregistré. Vérifiez que le verrouillage par Face ID, empreinte ou code est activé.');
 window.dispatchEvent(new Event('solumove:devices'));
}
const supported=()=>typeof window!=='undefined'&&typeof window.PublicKeyCredential!=='undefined';
/** Devices that open the space with Face ID, fingerprint or the device code instead of password + authenticator code. */
export function DeviceSecurity(){
 const [devices,setDevices]=useState<Device[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const load=useCallback(async()=>{const result=await authClient.passkey.listUserPasskeys();if(result.error)throw new Error('Chargement des appareils impossible.');setDevices((result.data??[]) as Device[]);},[]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 async function guard(operation:()=>Promise<string>){setBusy(true);setError('');setMessage('');try{setMessage(await operation());await load();}catch(e){setError(e instanceof Error?e.message:'Opération impossible.');}finally{setBusy(false);}}
 return <section className="panel"><h2><Fingerprint size={18}/> Face ID, empreinte et appareils de confiance</h2>
  <p className="muted">Après votre première connexion avec mot de passe et authenticator, enregistrez cet appareil : il ouvrira ensuite votre espace d’un regard ou d’un doigt, et le déverrouillera après cinq minutes d’inactivité.</p>
  {message?<p className="success" role="status">{message}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
  {devices?.map(device=><div className="mini-row" key={device.id}><div><strong>{device.name||'Appareil'}</strong><span className="small muted">Enregistré le {new Date(device.createdAt).toLocaleDateString('fr-TN')}</span></div>
   <button disabled={busy} aria-label={'Retirer '+(device.name||'cet appareil')} onClick={()=>{if(window.confirm('Retirer cet appareil ? Il devra de nouveau utiliser le mot de passe et le code.'))void guard(async()=>{const r=await authClient.passkey.deletePasskey({id:device.id});if(r.error)throw new Error('Retrait impossible.');window.dispatchEvent(new Event('solumove:devices'));return 'Appareil retiré.';});}}><Trash2 size={15}/>Retirer</button></div>)}
  {devices&&!devices.length?<p className="small muted">Aucun appareil enregistré : le mot de passe et le code sont demandés à chaque connexion.</p>:null}
  {supported()?<button className="primary" disabled={busy} onClick={()=>void guard(async()=>{await register();return 'Appareil enregistré : Face ID / empreinte activé.';})}><Fingerprint size={17}/>{busy?'En attente de l’appareil…':'Enregistrer cet appareil'}</button>
   :<p className="small muted">Ce navigateur ne propose pas la connexion biométrique.</p>}
  <p className="small muted">Appareil perdu ou vendu ? Retirez-le ici depuis un autre appareil, ou contactez l’admin.</p></section>;
}
/** One-time invitation shown after sign-in on a device that is not registered yet. */
export function DevicePrompt(){
 const [show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!supported())return;
  try{if(localStorage.getItem('supportflow:device-prompt:v1'))return;}catch{return;}
  authClient.passkey.listUserPasskeys().then(result=>{if(!result.error&&!result.data?.length)setShow(true);}).catch(()=>{});
 },[]);
 const dismiss=()=>{try{localStorage.setItem('supportflow:device-prompt:v1','1');}catch{}setShow(false);};
 if(!show)return null;
 return <section className="panel device-prompt"><Fingerprint size={26}/><div><strong>Ouvrez votre espace avec Face ID ou votre empreinte</strong><p className="muted">Enregistrez cet appareil : la prochaine fois, plus besoin de mot de passe ni de code.</p>{error?<p className="error" role="alert">{error}</p>:null}</div>
  <div className="actions"><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await register();dismiss();}catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.');}finally{setBusy(false);}}}>{busy?'En attente…':'Enregistrer cet appareil'}</button><button aria-label="Plus tard" onClick={dismiss}><X size={15}/>Plus tard</button></div></section>;
}
