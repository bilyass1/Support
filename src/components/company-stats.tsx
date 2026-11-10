'use client';
import type { CompanyStats as Stats } from '@/lib/insights';
const monthLabel=(month:string)=>new Date(month+'-01T00:00:00').toLocaleDateString('fr-TN',{month:'short'});
const money=(minor:number,currency:string)=>(minor/(currency==='TND'?1000:100)).toLocaleString('fr-TN',{maximumFractionDigits:currency==='TND'?3:2})+' '+currency;
/** One measure per chart, one colour, values readable on hover and in the table underneath. */
function MonthBars({title,months,values,format=(value:number)=>String(value),short=format}:{title:string;months:string[];values:number[];format?:(value:number)=>string;short?:(value:number)=>string}){
 const max=Math.max(1,...values),total=values.reduce((sum,value)=>sum+value,0);
 return <section className="panel chart-card"><div className="section-title"><h2>{title}</h2><strong>{format(total)}</strong></div>
  <div className="month-bars" role="img" aria-label={`${title} : ${months.map((m,i)=>monthLabel(m)+' '+format(values[i])).join(', ')}`}>
   {months.map((m,i)=><div key={m} title={`${monthLabel(m)} : ${format(values[i])}`}><span className="bar-value">{values[i]?short(values[i]):''}</span><span className={'bar'+(values[i]?'':' bar-zero')} style={{height:Math.max(values[i]?6:2,values[i]/max*100)+'%'}}/><span className="bar-label">{monthLabel(m)}</span></div>)}
  </div></section>;
}
export function CompanyStats({stats}:{stats:Stats|null}){
 if(!stats)return <section className="panel"><p className="muted">Chargement des chiffres…</p></section>;
 const paid=stats.revenue.map(r=>({currency:r.currency,total:r.paid.reduce((sum,value)=>sum+value,0)}));
 return <>
  <div className="stats">
   <article className="stat stat-good"><span>Encaissé sur 6 mois</span><strong>{paid.length?paid.map(p=>money(p.total,p.currency)).join(' + '):'0'}</strong><small>Factures payées, par mois d’émission</small></article>
   <article className={'stat'+(stats.unpaid.some(u=>u.overdue)?' stat-danger':'')}><span>À encaisser</span><strong>{stats.unpaid.length?stats.unpaid.map(u=>money(u.total,u.currency)).join(' + '):'0'}</strong><small>{stats.unpaid.reduce((sum,u)=>sum+u.count,0)} facture(s) · {stats.unpaid.reduce((sum,u)=>sum+u.overdue,0)} en retard</small></article>
   <article className="stat"><span>Première réponse</span><strong>{stats.first_response_hours===null?'—':stats.first_response_hours+' h'}</strong><small>Délai moyen sur 90 jours</small></article>
   <article className="stat"><span>Satisfaction</span><strong>{stats.satisfaction===null?'—':stats.satisfaction+' / 5'}</strong><small>{stats.ratings} avis client(s)</small></article>
   <article className={'stat'+(stats.sites.down?' stat-danger':'')}><span>Sites surveillés</span><strong>{stats.sites.total-stats.sites.down} / {stats.sites.total}</strong><small>{stats.sites.down?stats.sites.down+' indisponible(s)':'Tous en ligne'}</small></article>
  </div>
  <div className="chart-grid">
   {stats.revenue.map(r=><MonthBars key={r.currency} title={'Encaissements '+r.currency} months={stats.months} values={r.paid} format={value=>money(value,r.currency)} short={value=>Math.round(value/(r.currency==='TND'?1000:100)).toLocaleString('fr-TN')}/>)}
   {!stats.revenue.length?<section className="panel chart-card"><h2>Encaissements</h2><p className="muted">Aucune facture émise sur les six derniers mois.</p></section>:null}
   <MonthBars title="Demandes créées" months={stats.months} values={stats.tickets_created}/>
   <MonthBars title="Demandes clôturées" months={stats.months} values={stats.tickets_closed}/>
   <MonthBars title="Tokens consommés" months={stats.months} values={stats.tokens_consumed}/>
  </div></>;
}
