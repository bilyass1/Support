'use client';
import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/domain';
export const money=formatMoney;
export const date=(value:string|Date|null|undefined)=>value?new Date(value).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const dateTime=(value:string|Date|null|undefined)=>value?new Date(value).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
export function ago(value:string|null|undefined) {
  if(!value)return 'Jamais';
  const minutes=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000));
  if(minutes<1)return 'À l’instant';
  if(minutes<60)return `Il y a ${minutes} min`;
  if(minutes<1440)return `Il y a ${Math.round(minutes/60)} h`;
  return `Il y a ${Math.round(minutes/1440)} j`;
}
export const megabytes=(mb:number)=>mb>=1024?(mb/1024).toLocaleString('fr-FR',{maximumFractionDigits:1})+' Go':mb+' Mo';
export function Stat({label,value,hint,tone}:{label:string;value:ReactNode;hint?:ReactNode;tone?:'danger'|'warning'|'good'}) {
  return <article className={'stat'+(tone?' stat-'+tone:'')}><span>{label}</span><strong>{value}</strong>{hint?<small>{hint}</small>:null}</article>;
}
export function Empty({icon,title,children}:{icon?:ReactNode;title:string;children?:ReactNode}) {
  return <div className="empty">{icon}<h3>{title}</h3>{children?<p>{children}</p>:null}</div>;
}
/** `remaining` reads the bar as what is left (low is bad) instead of what is consumed (high is bad). */
export function Meter({value,max,label,remaining}:{value:number;max:number;label?:string;remaining?:boolean}) {
  const ratio=max>0?Math.min(1,Math.max(0,value/max)):0,load=remaining?1-ratio:ratio;
  return <div className="meter" role="img" aria-label={(label??'Niveau')+' : '+Math.round(ratio*100)+' %'}><span className={load>=.9?'meter-danger':load>=.75?'meter-warning':''} style={{width:ratio*100+'%'}}/></div>;
}
/** Single-series daily bar chart. Values are exposed in the tooltip and in an accessible summary. */
export function Bars({points,unit}:{points:{label:string;value:number}[];unit:string}) {
  const max=Math.max(1,...points.map(p=>p.value)),total=points.reduce((sum,p)=>sum+p.value,0);
  return <div className="bars" role="img" aria-label={`${total} ${unit} sur ${points.length} jours, maximum ${max} par jour`}>
    {points.map(p=><span key={p.label} title={`${p.label} : ${p.value} ${unit}`} style={{height:Math.max(p.value?6:2,p.value/max*100)+'%'}} className={p.value?'':'bar-zero'}/>)}
  </div>;
}
export function lastDays(count:number) {
  const days:string[]=[];
  for(let i=count-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));}
  return days;
}
export function downloadCsv(name:string,header:string[],rows:(string|number|null|undefined)[][]) {
  // Cells starting with a formula character are prefixed so spreadsheets never execute them.
  const cell=(value:string|number|null|undefined)=>{const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';};
  const blob=new Blob(['﻿'+[header,...rows].map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name+'.csv';link.click();URL.revokeObjectURL(link.href);
}
