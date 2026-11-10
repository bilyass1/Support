import { z } from 'zod';
import { MODULES } from './domain';
const id=z.uuid();
const amount=z.number().int().min(0).max(1_000_000);
const money=z.number().int().min(0).max(2_000_000_000);
const category=z.enum(['design','development','bug']);
const priority=z.enum(['low','normal','high','urgent']);
const optionalText=(max:number)=>z.string().trim().max(max).nullish().transform(value=>value||null);
const rule=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('category_cost'),category,tokens:amount}),
  z.object({kind:z.literal('max_open_tickets'),limit:z.number().int().min(1).max(1000)})
]);
const plan={name:z.string().trim().min(2).max(80),annual_tokens:amount,price_minor:money,currency:z.enum(['TND','EUR','USD']),support_level:z.string().trim().min(1).max(80),rules:z.array(rule).max(30)};
const invoiceItem=z.object({label:z.string().trim().min(1).max(200),quantity:z.number().min(0.01).max(100_000),unit_minor:money});
export const actionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('create_organization'),name:z.string().trim().min(2).max(120),email:z.email().optional()}),
  z.object({type:z.literal('update_organization'),organization_id:id,name:z.string().trim().min(2).max(120),contact_email:z.email().nullish().transform(v=>v||null),phone:optionalText(40),tax_id:optionalText(60),address:optionalText(300)}),
  z.object({type:z.literal('set_modules'),organization_id:id,modules:z.array(z.enum(MODULES)).max(MODULES.length)}),
  z.object({type:z.literal('add_member'),organization_id:id,email:z.email()}),
  z.object({type:z.literal('remove_member'),user_id:z.string().min(1).max(200)}),
  z.object({type:z.literal('set_role'),email:z.email(),role:z.enum(['admin','manager','none'])}),
  z.object({type:z.literal('create_application'),organization_id:id,name:z.string().trim().min(2).max(120),kind:z.enum(['web','mobile','software'])}),
  z.object({type:z.literal('rotate_app_key'),application_id:id}),
  z.object({type:z.literal('save_plan'),id:id.optional(),apply_to_existing:z.boolean().default(false),...plan}),
  z.object({type:z.literal('assign_plan'),organization_id:id,plan_id:id}),
  z.object({type:z.literal('renew_subscription'),organization_id:id}),
  z.object({type:z.literal('recharge'),organization_id:id,tokens:amount.refine(v=>v>0),note:z.string().trim().min(3).max(500)}),
  z.object({type:z.literal('create_ticket'),application_id:id,title:z.string().trim().min(3).max(160),description:z.string().trim().min(10).max(10000),category,priority:priority.default('normal')}),
  z.object({type:z.literal('quote'),ticket_id:id,tokens:amount,note:z.string().trim().min(3).max(2000)}),
  z.object({type:z.literal('accept'),ticket_id:id,estimate_revision:z.number().int().min(1)}),
  z.object({type:z.literal('move'),ticket_id:id,status:z.enum(['in_progress','ready','closed','cancelled'])}),
  z.object({type:z.literal('comment'),ticket_id:id,body:z.string().trim().min(1).max(5000),internal:z.boolean().default(false)}),
  z.object({type:z.literal('triage'),ticket_id:id,priority,assignee_id:z.string().min(1).max(200).nullable()}),
  z.object({type:z.literal('rate'),ticket_id:id,rating:z.number().int().min(1).max(5),comment:optionalText(1000)}),
  z.object({type:z.literal('save_invoice'),id:id.optional(),organization_id:id,currency:z.enum(['TND','EUR','USD']),items:z.array(invoiceItem).min(1).max(50),tax_rate_bp:z.number().int().min(0).max(10000),stamp_minor:money,due_at:z.iso.date(),note:optionalText(1000)}),
  z.object({type:z.literal('invoice_status'),invoice_id:id,status:z.enum(['sent','paid','cancelled'])}),
  z.object({type:z.literal('announce'),organization_id:id.nullable(),title:z.string().trim().min(3).max(120),body:z.string().trim().min(3).max(2000)}),
  z.object({type:z.literal('mark_seen')})
]);
export type Action=z.infer<typeof actionSchema>;
export const ingestSchema=z.object({
  event:z.string().trim().min(1).max(40).regex(/^[a-z0-9_.-]+$/i),
  user:z.string().trim().min(1).max(128).optional(),
  version:z.string().trim().min(1).max(40).optional()
});
export const pushSubscriptionSchema=z.object({
  // The server posts to this URL, so only the browsers' own push services are accepted.
  endpoint:z.url().max(2000).refine(value=>{
    try { const url=new URL(value); return url.protocol==='https:'&&!url.username&&!url.port&&/(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/.test(url.hostname); }
    catch { return false; }
  }),
  keys:z.object({p256dh:z.string().min(20).max(300),auth:z.string().min(8).max(300)})
});
