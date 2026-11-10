export type Role = 'admin' | 'manager' | 'client';
export type Category = 'design' | 'development' | 'bug';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'new' | 'quoted' | 'accepted' | 'in_progress' | 'ready' | 'closed' | 'cancelled';
export type Rule = {kind:'category_cost'; category:Category; tokens:number} | {kind:'max_open_tickets'; limit:number};
export const MODULES = ['tickets','credits','mail','billing','usage'] as const;
export type Module = typeof MODULES[number];
export const moduleLabels: Record<Module,string> = {tickets:'Demandes & support',credits:'Crédits',mail:'Messagerie',billing:'Facturation',usage:'Applications & utilisation'};
export const statusLabels: Record<TicketStatus,string> = {new:'Nouveau',quoted:'À valider',accepted:'Accepté',in_progress:'En cours',ready:'À tester',closed:'Clôturé',cancelled:'Annulé'};
export const priorityLabels: Record<Priority,string> = {low:'Basse',normal:'Normale',high:'Haute',urgent:'Urgente'};
/** Délai cible de première réponse de l'équipe, en heures. */
export const slaHours: Record<Priority,number> = {urgent:4,high:8,normal:24,low:72};
export class DomainError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}
export function creditChange(balance: number, reserved: number, balanceDelta: number, reservedDelta: number) {
  const result = {balance: balance + balanceDelta, reserved: reserved + reservedDelta};
  if (![balance,reserved,balanceDelta,reservedDelta].every(Number.isSafeInteger) || result.balance < 0 || result.reserved < 0 || result.reserved > result.balance) {
    throw new DomainError('Solde de crédits insuffisant ou opération invalide.',409);
  }
  return result;
}
export function canMove(from: TicketStatus, to: TicketStatus) {
  const transitions: Partial<Record<TicketStatus, TicketStatus[]>> = {
    accepted: ['in_progress','cancelled'], in_progress:['ready','cancelled'], ready:['closed','in_progress','cancelled'],
    new:['cancelled'], quoted:['cancelled']
  };
  if (!transitions[from]?.includes(to)) throw new DomainError('Transition de ticket invalide.',409);
}
export function suggestedCost(rules:Rule[], category:Category) {
  return rules.find((rule):rule is Extract<Rule,{kind:'category_cost'}> => rule.kind==='category_cost' && rule.category===category)?.tokens;
}
export function checkOpenLimit(rules:Rule[], count:number) {
  const limits=rules.filter((rule):rule is Extract<Rule,{kind:'max_open_tickets'}>=>rule.kind==='max_open_tickets');
  if (limits.some(rule=>count>=rule.limit)) throw new DomainError('La limite de tickets ouverts de cette formule est atteinte.',409);
}
/** Unités mineures par unité : le dinar tunisien compte 1000 millimes. */
export function minorUnits(currency:string) { return currency==='TND'?1000:100; }
export function formatMoney(minor:number,currency:string) {
  const digits=currency==='TND'?3:2;
  return (minor/minorUnits(currency)).toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits})+' '+currency;
}
export type InvoiceItem={label:string;quantity:number;unit_minor:number};
export function invoiceTotals(items:InvoiceItem[],taxRateBp:number,stampMinor:number) {
  const subtotal=items.reduce((sum,item)=>sum+Math.round(item.quantity*item.unit_minor),0);
  const tax=Math.round(subtotal*taxRateBp/10000);
  const total=subtotal+tax+stampMinor;
  if(![subtotal,tax,total].every(Number.isSafeInteger)||total>2_000_000_000) throw new DomainError('Montant de facture trop élevé.',400);
  return {subtotal,tax,total};
}
export function slaBreached(ticket:{priority:Priority;created_at:string|Date;first_response_at:string|Date|null;status:TicketStatus},now=Date.now()) {
  if(ticket.status==='cancelled') return false;
  const limit=new Date(ticket.created_at).getTime()+slaHours[ticket.priority]*3_600_000;
  return (ticket.first_response_at?new Date(ticket.first_response_at).getTime():now)>limit;
}
