import type { Actor } from './service';
import type { Category, Rule, TicketStatus } from './domain';
export type Plan={id:string;name:string;annual_tokens:number;price_minor:number;currency:string;support_level:string;rules:Rule[];revision:number;mail_max_mailboxes:number;mail_total_mb:number;mail_per_box_mb:number;mail_create_tokens:number};
export type Organization={id:string;name:string;domains?:string[];tax_id?:string;billing_address?:string;contact_name?:string;contact_email?:string;phone?:string;primary_domain?:string;balance:number;reserved:number;snapshot:Plan|null;ends_at:string|null};
export type Application={id:string;organization_id:string;name:string;kind:string};
export type Ticket={id:string;number:string;organization_id:string;application_id:string;title:string;description:string;category:Category;status:TicketStatus;estimated_tokens:number|null;estimate_revision:number;estimate_note:string|null;created_at:string};
export type Workspace={actor:Actor;organizations:Organization[];applications:Application[];plans:Plan[];tickets:Ticket[];ledger:{id:string;kind:string;note:string;balance_delta:number;reserved_delta:number;created_at:string}[];notifications:{id:string;message:string;created_at:string}[];comments:{id:string;ticket_id:string;body:string;author_name:string;created_at:string}[]};

