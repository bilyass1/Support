'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Fingerprint, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Field } from './forms';
import { Brand } from './login-form';
/** Mandatory enrolment: password → authenticator QR code → verification → backup codes → biometric device. */
export function SecuritySetup({email}:{email:string}) {
  const [step,setStep]=useState<'password'|'scan'|'codes'|'passkey'>('password'),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [qr,setQr]=useState(''),[secret,setSecret]=useState(''),[codes,setCodes]=useState<string[]>([]),[saved,setSaved]=useState(false);
  async function guard(operation:()=>Promise<void>){setError('');setPending(true);try{await operation();}catch{setError('Le serveur est indisponible. Réessayez.');}finally{setPending(false);}}
  const steps=['password','scan','codes','passkey'];
  return <div className="login-card"><Brand/><p className="eyebrow">ÉTAPE {steps.indexOf(step)+1} SUR 4 · SÉCURISATION DU COMPTE</p>
    <div className="steps">{steps.map((s,i)=><span key={s} className={i<=steps.indexOf(step)?'step-done':''}/>)}</div>
    {step==='password'?<><h1>Protégez votre compte</h1><p className="muted">La double authentification est obligatoire pour accéder à votre espace. Installez une application d’authentification (Google Authenticator, Microsoft Authenticator, Authy…) puis confirmez votre mot de passe.</p>
      <form className="form" onSubmit={e=>{e.preventDefault();const password=String(new FormData(e.currentTarget).get('password'));guard(async()=>{
        const result=await authClient.twoFactor.enable({password});
        if(result.error||!result.data||!('totpURI' in result.data)){setError('Mot de passe incorrect.');return;}
        setCodes(result.data.backupCodes);setSecret(new URL(result.data.totpURI).searchParams.get('secret')??'');
        setQr(await QRCode.toDataURL(result.data.totpURI,{width:220,margin:1}));setStep('scan');
      });}}>
        <input type="hidden" name="username" autoComplete="username" value={email} readOnly/>
        <Field label="Votre mot de passe"><input name="password" type="password" autoComplete="current-password" required autoFocus/></Field>
        {error?<p className="error" role="alert">{error}</p>:null}
        <button className="primary wide" disabled={pending}><ShieldCheck size={18}/>{pending?'Préparation…':'Continuer'}</button>
      </form></>:null}
    {step==='scan'?<><h1>Scannez le QR code</h1><p className="muted">Ouvrez votre application d’authentification, ajoutez un compte et scannez ce code. Saisissez ensuite le code à 6 chiffres affiché.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="qr"><img src={qr} alt="QR code à scanner avec l’application d’authentification" width={220} height={220}/><p className="small muted">Saisie manuelle : <code>{secret}</code></p></div>
      <form className="form" onSubmit={e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')).replace(/\s/g,'');guard(async()=>{
        const result=await authClient.twoFactor.verifyTotp({code});
        if(result.error)setError('Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.');else setStep('codes');
      });}}>
        <Field label="Code à 6 chiffres"><input name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} autoFocus/></Field>
        {error?<p className="error" role="alert">{error}</p>:null}
        <button className="primary wide" disabled={pending}>{pending?'Vérification…':'Activer la double authentification'}</button>
      </form></>:null}
    {step==='codes'?<><h1>Conservez vos codes de secours</h1><p className="muted">Ils permettent de vous connecter si vous perdez votre téléphone. Chaque code ne sert qu’une fois et ils ne seront plus affichés.</p>
      <div className="backup-codes">{codes.map(code=><code key={code}>{code}</code>)}</div>
      <button className="wide" onClick={()=>navigator.clipboard?.writeText(codes.join('\n')).then(()=>setSaved(true)).catch(()=>{})}><Copy size={16}/>Copier les codes</button>
      <label className="checkbox"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>J’ai enregistré ces codes dans un endroit sûr.</label>
      <button className="primary wide" disabled={!saved} onClick={()=>setStep('passkey')}>Continuer</button></>:null}
    {step==='passkey'?<><h1>Déverrouillez avec Face ID ou votre empreinte</h1><p className="muted">Enregistrez cet appareil : les prochaines fois, vous ouvrirez votre espace d’un simple regard ou d’un doigt, sans mot de passe ni code.</p>
      {error?<p className="error" role="alert">{error}</p>:null}
      <button className="primary wide" disabled={pending} onClick={()=>guard(async()=>{
        const result=await authClient.passkey.addPasskey({name:deviceName()});
        if(result?.error)setError('Cet appareil n’a pas pu être enregistré. Vous pourrez réessayer dans Sécurité.');else window.location.assign('/');
      })}><Fingerprint size={19}/>{pending?'En attente de l’appareil…':'Enregistrer cet appareil'}</button>
      <button className="text-button" onClick={()=>window.location.assign('/')}><Check size={15}/>Plus tard, ouvrir mon espace</button></>:null}
  </div>;
}
export function deviceName() {
  const agent=navigator.userAgent;
  const system=/iPhone/.test(agent)?'iPhone':/iPad/.test(agent)?'iPad':/Android/.test(agent)?'Android':/Mac/.test(agent)?'Mac':/Windows/.test(agent)?'Windows':'Appareil';
  return system+' · '+new Date().toLocaleDateString('fr-FR');
}
