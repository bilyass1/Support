import { after } from 'next/server';
import { authenticated,sameOrigin,failure,jsonBody } from '@/lib/request';
import { actionSchema } from '@/lib/validation';
import { act } from '@/lib/service';
import { DomainError } from '@/lib/domain';
import { flushDeliveries } from '@/lib/dispatch';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const actor=await authenticated(request);
    const input=actionSchema.safeParse(await jsonBody(request));
    if(!input.success) throw new DomainError('Champs invalides : '+input.error.issues.map(i=>i.path.join('.')).join(', '));
    const result=await act(actor,input.data);
    // E-mails and push notifications leave as soon as the change is committed, without delaying the response.
    if(input.data.type!=='mark_seen') after(()=>flushDeliveries().catch(()=>console.error('Delivery flush failed')));
    return Response.json(result);
  } catch(error) { return failure(error); }
}
