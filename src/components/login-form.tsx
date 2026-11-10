'use client';
import { useEffect, useState } from 'react';
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Field } from './forms';
type Mode='signin'|'signup'|'code'|'forgot'|'reset';
export function Brand(){return <div className="brand"><span className="brand-icon">S</span>SupportFlow</div>;}
export function LoginForm() {
  const [mode,setMode]=useState<Mode>('signin'),[pending,setPending]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState('');
  const [backup,setBackup]=useState(false),[token,setToken]=useState(''),[passkeys,setPasskeys]=useState(false);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const reset=params.get('token');
    if(reset){setToken(reset);setMode('reset');}
    if(params.get('error'))setError('Ce lien n’est plus valable. Demandez-en un nouveau.');
    setPasskeys(typeof window.PublicKeyCredential!=='undefined');
  },[]);
  function change(next:Mode){setMode(next);setError('');setInfo('');}
  async function guard(operation:()=>Promise<void>) {
    setError('');setInfo('');setPending(true);
    try{await operation();}catch{setError('Le serveur est indisponible. Réessayez.');}finally{setPending(false);}
  }
  const passkey=()=>guard(async()=>{
    const result=await authClient.signIn.passkey();
    if(result?.error)setError('Connexion biométrique impossible sur cet appareil. Utilisez votre mot de passe, puis enregistrez l’appareil dans Sécurité.');
    else window.location.assign('/');
  });
  const titles:Record<Mode,string>={signin:'Bienvenue dans votre espace',signup:'Créer votre compte',code:'Vérification en deux étapes',forgot:'Mot de passe oublié',reset:'Nouveau mot de passe'};
  return <div className="login-card"><Brand/><p className="eyebrow">ESPACE CLIENT SÉCURISÉ</p><h1>{titles[mode]}</h1>
    {mode==='signin'||mode==='signup'?<p className="muted">Vos applications, vos demandes, vos factures et votre messagerie, au même endroit.</p>:null}
    {mode==='signin'&&passkeys?<><button type="button" className="primary wide" disabled={pending} onClick={passkey}><Fingerprint size={19}/>Face ID / empreinte</button><div className="divider"><span>ou avec votre mot de passe</span></div></>:null}
    {mode==='signin'||mode==='signup'?<form className="form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);guard(async()=>{
      const email=String(data.get('email')),password=String(data.get('password'));
      const result=mode==='signup'?await authClient.signUp.email({email,password,name:String(data.get('name'))}):await authClient.signIn.email({email,password});
      if(result.error)setError(result.error.status===429?'Trop de tentatives. Patientez une minute.':mode==='signup'?(result.error.message??'Création du compte impossible.'):'E-mail ou mot de passe incorrect.');
      else if(result.data&&'twoFactorRedirect' in result.data&&result.data.twoFactorRedirect)change('code');
      else window.location.assign('/');
    });}}>
      {mode==='signup'?<Field label="Nom complet"><input name="name" autoComplete="name" required minLength={2} maxLength={80}/></Field>:null}
      <Field label="Adresse e-mail"><input name="email" type="email" autoComplete="username webauthn" required/></Field>
      <Field label={mode==='signup'?'Mot de passe (12 caractères minimum)':'Mot de passe'}><input name="password" type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength={mode==='signup'?12:1} required/></Field>
      {error?<p className="error" role="alert">{error}</p>:null}
      <button className={passkeys&&mode==='signin'?'wide':'primary wide'} disabled={pending}>{pending?'Patientez…':mode==='signup'?'Créer le compte':'Se connecter'}</button>
    </form>:null}
    {mode==='code'?<form className="form" onSubmit={e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')).replace(/\s/g,'');guard(async()=>{
      const result=backup?await authClient.twoFactor.verifyBackupCode({code}):await authClient.twoFactor.verifyTotp({code});
      if(result.error)setError('Code incorrect ou expiré.');else window.location.assign('/');
    });}}>
      <p className="muted"><ShieldCheck size={16}/> {backup?'Saisissez l’un de vos codes de secours. Chaque code ne sert qu’une fois.':'Saisissez le code à 6 chiffres affiché dans votre application d’authentification.'}</p>
      <Field label={backup?'Code de secours':'Code à 6 chiffres'}><input name="code" className="code-input" autoFocus required autoComplete="one-time-code" inputMode={backup?'text':'numeric'} maxLength={backup?20:7} key={String(backup)}/></Field>
      {error?<p className="error" role="alert">{error}</p>:null}
      <button className="primary wide" disabled={pending}>{pending?'Vérification…':'Valider'}</button>
      <button type="button" className="text-button" onClick={()=>{setBackup(!backup);setError('');}}>{backup?'Utiliser l’application d’authentification':'Je n’ai pas mon téléphone : utiliser un code de secours'}</button>
    </form>:null}
    {mode==='forgot'?<form className="form" onSubmit={e=>{e.preventDefault();const email=String(new FormData(e.currentTarget).get('email'));guard(async()=>{
      await authClient.requestPasswordReset({email,redirectTo:'/login'});
      setInfo('Si un compte existe avec cette adresse, un e-mail contenant le lien de réinitialisation vient d’être envoyé.');
    });}}>
      <Field label="Adresse e-mail du compte"><input name="email" type="email" autoComplete="email" required/></Field>
      {info?<p className="success" role="status">{info}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
      <button className="primary wide" disabled={pending}>{pending?'Envoi…':'Recevoir le lien'}</button>
    </form>:null}
    {mode==='reset'?<form className="form" onSubmit={e=>{e.preventDefault();const password=String(new FormData(e.currentTarget).get('password'));guard(async()=>{
      const result=await authClient.resetPassword({newPassword:password,token});
      if(result.error)setError('Ce lien n’est plus valable. Demandez-en un nouveau.');
      else{window.history.replaceState(null,'','/login');change('signin');setInfo('Mot de passe modifié. Connectez-vous.');}
    });}}>
      <Field label="Nouveau mot de passe (12 caractères minimum)"><input name="password" type="password" autoComplete="new-password" minLength={12} required/></Field>
      {error?<p className="error" role="alert">{error}</p>:null}
      <button className="primary wide" disabled={pending}><KeyRound size={17}/>{pending?'Enregistrement…':'Enregistrer le mot de passe'}</button>
    </form>:null}
    {mode==='signin'&&info?<p className="success" role="status">{info}</p>:null}
    <div className="login-links">
      {mode==='signin'?<><button className="text-button" onClick={()=>change('forgot')}>Mot de passe oublié ?</button><button className="text-button" onClick={()=>change('signup')}>Créer un compte</button></>:<button className="text-button" onClick={()=>change('signin')}>← Retour à la connexion</button>}
    </div>
    <p className="small muted">La double authentification est obligatoire. Après la première connexion, votre appareil peut être déverrouillé par Face ID ou empreinte.</p>
  </div>;
}
