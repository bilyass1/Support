'use client';
import { useState, type ReactNode } from 'react';
import type { Plan } from '@/lib/types';
import type { Rule, Category } from '@/lib/domain';
export function ActionForm({children,label,onSubmit}:{children:ReactNode;label:string;onSubmit:(data:FormData)=>Promise<boolean>}) {
  const [pending,setPending]=useState(false);
  return <form className="form" onSubmit={async event=>{
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);setPending(true);
    try {if(await onSubmit(data))form.reset();}finally{setPending(false);}
  }}>{children}<button className="primary" disabled={pending}>{pending?'Enregistrement…':label}</button></form>;
}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="field"><span>{label}</span>{children}</label>;}
export function PlanEditor({plan,onSave,onCancel}:{plan?:Plan;onSave:(data:Record<string,unknown>)=>Promise<boolean>;onCancel:()=>void}) {
  const [rules,setRules]=useState<Rule[]>(plan?.rules??[]);
  const [pending,setPending]=useState(false);
  function update(index:number,rule:Rule) {setRules(current=>current.map((r,i)=>i===index?rule:r));}
  return <form className="form" onSubmit={async e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);setPending(true);
    try {if(await onSave({type:'save_plan',id:plan?.id,name:data.get('name'),annual_tokens:Number(data.get('annual_tokens')),price_minor:Number(data.get('price_minor')),currency:data.get('currency'),support_level:data.get('support_level'),mail_max_mailboxes:Number(data.get('mail_max_mailboxes')),mail_total_mb:Number(data.get('mail_total_mb')),mail_per_box_mb:Number(data.get('mail_per_box_mb')),mail_create_tokens:Number(data.get('mail_create_tokens')),apply_to_existing:data.get('apply')==='on',rules}))onCancel();}
    finally{setPending(false);}
  }}>
    <h3>{plan?'Modifier la formule':'Nouvelle formule'}</h3>
    <div className="form-grid">
      <Field label="Nom"><input name="name" required minLength={2} maxLength={80} defaultValue={plan?.name}/></Field>
      <Field label="Quota annuel de crédits"><input name="annual_tokens" type="number" min={0} max={1000000} required defaultValue={plan?.annual_tokens??100}/></Field>
      <Field label="Prix annuel en unité mineure (TND : millimes)"><input name="price_minor" type="number" min={0} max={1000000} required defaultValue={plan?.price_minor??0}/></Field>
      <Field label="Devise"><select name="currency" defaultValue={plan?.currency??'TND'}><option>TND</option><option>EUR</option><option>USD</option></select></Field>
      <Field label="Niveau de support"><input name="support_level" required defaultValue={plan?.support_level??'Standard'}/></Field>
      <Field label="Nombre maximal de boîtes du pack"><input name="mail_max_mailboxes" type="number" min={0} max={1000000} required defaultValue={plan?.mail_max_mailboxes??0}/></Field>
      <Field label="Stockage total du pack (Mo)"><input name="mail_total_mb" type="number" min={0} max={100000000} required defaultValue={plan?.mail_total_mb??0}/></Field>
      <Field label="Maximum par boîte (Mo)"><input name="mail_per_box_mb" type="number" min={0} max={100000000} required defaultValue={plan?.mail_per_box_mb??0}/></Field>
      <Field label="Tokens par création de boîte (0 = incluse)"><input name="mail_create_tokens" type="number" min={0} max={1000000} required defaultValue={plan?.mail_create_tokens??0}/></Field>
    </div>
    <div className="section-title"><h4>Règles de la formule</h4><div className="actions"><button type="button" onClick={()=>setRules(r=>[...r,{kind:'category_cost',category:'design',tokens:5}])}>Ajouter un tarif indicatif</button><button type="button" onClick={()=>setRules(r=>[...r,{kind:'max_open_tickets',limit:10}])}>Limiter les tickets ouverts</button></div></div>
    {rules.map((rule,index)=><div className="rule" key={index}>
      {rule.kind==='category_cost'?<>
        <label>Catégorie<select aria-label="Catégorie de la règle" value={rule.category} onChange={e=>update(index,{...rule,category:e.target.value as Category})}><option value="design">Design</option><option value="development">Développement</option><option value="bug">Correction de bug</option></select></label>
        <label>Crédits indicatifs<input type="number" min={0} max={1000000} value={rule.tokens} onChange={e=>update(index,{...rule,tokens:Number(e.target.value)})}/></label>
      </>:<label>Maximum de tickets ouverts<input type="number" min={1} max={1000} value={rule.limit} onChange={e=>update(index,{...rule,limit:Number(e.target.value)})}/></label>}
      <button type="button" onClick={()=>setRules(r=>r.filter((_,i)=>i!==index))}>Retirer</button>
    </div>)}
    {plan?<label className="checkbox"><input type="checkbox" name="apply"/>Appliquer les nouvelles règles aux abonnements existants. Le solde et les devis acceptés restent inchangés.</label>:null}
    <div className="actions"><button className="primary" disabled={pending}>{pending?'Enregistrement…':'Enregistrer la formule'}</button><button type="button" onClick={onCancel}>Annuler</button></div>
  </form>;
}

