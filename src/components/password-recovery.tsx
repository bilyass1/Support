'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Field } from './forms';
export function PasswordRecovery({reset=false}:{reset?:boolean}){
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <main className="login-page"><section className="login-card"><img className="brand-logo" src="/solumove-logo.webp" alt="Solumove Technologies"/><h1>{reset?'Nouveau mot de passe':'Retrouver votre accès'}</h1><form className="form" onSubmit={async e=>{e.preventDefault();setError('');setMessage('');setBusy(true);const data=new FormData(e.currentTarget);try{
  if(reset){const token=new URLSearchParams(window.location.search).get('token');if(!token)throw Error('Lien invalide. Demandez un nouveau lien.');const password=String(data.get('password'));if(password!==data.get('confirmation'))throw Error('Les mots de passe ne correspondent pas.');const r=await authClient.resetPassword({newPassword:password,token});if(r.error)throw Error(r.error.message);setMessage('Mot de passe changé. Reconnectez-vous avec votre authenticator.');}
  else{const r=await authClient.requestPasswordReset({email:String(data.get('email')),redirectTo:window.location.origin+'/reset-password'});if(r.error)throw Error('Demande indisponible. Réessayez plus tard.');setMessage('Si ce compte existe, un lien sera envoyé par administration@solumove.net. Vérifiez aussi les indésirables.');}
 }catch(e){setError(e instanceof Error?e.message:'Opération impossible.');}finally{setBusy(false);}}}>
 {reset?<><Field label="Nouveau mot de passe"><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></Field><Field label="Confirmer"><input name="confirmation" type="password" autoComplete="new-password" required/></Field></>:<Field label="Votre adresse e-mail"><input name="email" type="email" autoComplete="email" required/></Field>}
 <button disabled={busy} className="primary">{reset?'Changer le mot de passe':'Recevoir un lien'}</button></form>{message?<p className="success" role="status">{message}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}<a href="/login">Retour à la connexion</a></section></main>;
}
