'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Field } from './forms';
export function LoginForm() {
  const [signup,setSignup]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  return <div className="login-card"><img className="brand-logo" src="/solumove-logo.webp" alt="Solumove Technologies"/><p className="eyebrow">VOTRE ESPACE DE COLLABORATION</p><h1>{signup?'Créer votre compte':'Bienvenue dans votre espace'}</h1><p className="muted">Vos applications, vos demandes et vos crédits, au même endroit.</p>
    <form className="form" onSubmit={async e=>{
      e.preventDefault();const data=new FormData(e.currentTarget);setError('');setPending(true);
      try {
        const email=String(data.get('email')),password=String(data.get('password'));
        const result=signup?await authClient.signUp.email({email,password,name:String(data.get('name'))}):await authClient.signIn.email({email,password});
        if(result.error)setError(result.error.message??'Connexion impossible.');else if(result.data&&'twoFactorRedirect' in result.data&&result.data.twoFactorRedirect)window.location.assign('/two-factor');else window.location.assign('/');
      }catch{setError('Le serveur est indisponible. Réessayez.');}finally{setPending(false);}
    }}>
      {signup?<Field label="Nom"><input name="name" autoComplete="name" required minLength={2}/></Field>:null}
      <Field label="Adresse e-mail"><input name="email" type="email" autoComplete="email" required/></Field>
      <Field label="Mot de passe"><input name="password" type="password" autoComplete={signup?'new-password':'current-password'} minLength={signup?12:1} required/></Field>
      {error?<p className="error" role="alert">{error}</p>:null}
      <button className="primary" disabled={pending}>{pending?'Patientez…':signup?'Créer le compte':'Se connecter'}</button>
    </form><a href="/forgot-password">Mot de passe oublié ?</a><button className="text-button" onClick={()=>{setSignup(!signup);setError('');}}>{signup?'J’ai déjà un compte':'Créer un compte'}</button><p className="small muted">Les nouveaux comptes accèdent uniquement aux projets auxquels l’admin les associe.</p>
  </div>;
}

