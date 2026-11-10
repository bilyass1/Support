import { z } from 'zod';
const id=z.uuid();
const amount=z.number().int().min(0).max(1_000_000);
const category=z.enum(['design','development','bug']);
const rule=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('category_cost'),category,tokens:amount}),
  z.object({kind:z.literal('max_open_tickets'),limit:z.number().int().min(1).max(1000)})
]);
const plan={name:z.string().trim().min(2).max(80),annual_tokens:amount,price_minor:amount,currency:z.enum(['TND','EUR','USD']),support_level:z.string().trim().min(1).max(80),rules:z.array(rule).max(30)};
export const actionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('create_organization'),name:z.string().trim().min(2).max(120),email:z.email()}),
  z.object({type:z.literal('create_application'),organization_id:id,name:z.string().trim().min(2).max(120),kind:z.enum(['web','mobile','software'])}),
  z.object({type:z.literal('save_plan'),id:id.optional(),apply_to_existing:z.boolean().default(false),...plan}),
  z.object({type:z.literal('assign_plan'),organization_id:id,plan_id:id}),
  z.object({type:z.literal('recharge'),organization_id:id,tokens:amount.refine(v=>v>0),note:z.string().trim().min(3).max(500)}),
  z.object({type:z.literal('create_ticket'),application_id:id,title:z.string().trim().min(3).max(160),description:z.string().trim().min(10).max(10000),category}),
  z.object({type:z.literal('quote'),ticket_id:id,tokens:amount,note:z.string().trim().min(3).max(2000)}),
  z.object({type:z.literal('accept'),ticket_id:id,estimate_revision:z.number().int().min(1)}),
  z.object({type:z.literal('move'),ticket_id:id,status:z.enum(['in_progress','ready','closed','cancelled'])}),
  z.object({type:z.literal('comment'),ticket_id:id,body:z.string().trim().min(1).max(5000)})
]);
export type Action=z.infer<typeof actionSchema>;
