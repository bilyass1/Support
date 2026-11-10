export type Role = 'admin' | 'manager' | 'client';
export type Category = 'design' | 'development' | 'bug';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'new' | 'quoted' | 'accepted' | 'in_progress' | 'ready' | 'closed' | 'cancelled';
export type Rule = {kind:'category_cost'; category:Category; tokens:number} | {kind:'max_open_tickets'; limit:number};
export class DomainError extends Error {
  constructor(message: string, public status = 400) { super(message); }
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
export const MODULES=['tokens','billing','support','tickets','mail','usage'] as const;
export type Module=typeof MODULES[number];
export const moduleLabels:Record<Module,string>={tokens:'Tokens & achats',billing:'Factures',support:'Support',tickets:'Demandes de développement',mail:'Messagerie & Outlook',usage:'Applications & utilisation'};
export const statusLabels:Record<TicketStatus,string>={new:'Nouveau',quoted:'À valider',accepted:'Accepté',in_progress:'En cours',ready:'À tester',closed:'Clôturé',cancelled:'Annulé'};
export const priorityLabels:Record<Priority,string>={low:'Basse',normal:'Normale',high:'Haute',urgent:'Urgente'};
/** Target delay for the team's first answer, in hours. */
export const slaHours:Record<Priority,number>={urgent:4,high:8,normal:24,low:72};
export function slaBreached(ticket:{priority:Priority;created_at:string|Date;first_response_at:string|Date|null;status:TicketStatus},now=Date.now()){
  if(ticket.status==='cancelled')return false;
  const limit=new Date(ticket.created_at).getTime()+slaHours[ticket.priority]*3_600_000;
  return (ticket.first_response_at?new Date(ticket.first_response_at).getTime():now)>limit;
}
