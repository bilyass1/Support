import { authenticated,sameOrigin,failure } from '@/lib/request';
import { actionSchema } from '@/lib/validation';
import { act } from '@/lib/service';
import { DomainError } from '@/lib/domain';
import { deliverAfterResponse } from '@/lib/deliver-now';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const actor=await authenticated(request);
    const raw=await request.text();
    if(raw.length>20000) throw new DomainError('Requête trop volumineuse.',413);
    let parsed:unknown;
    try { parsed=JSON.parse(raw); } catch { throw new DomainError('JSON invalide.'); }
    const input=actionSchema.safeParse(parsed);
    if(!input.success) throw new DomainError('Champs invalides : '+input.error.issues.map(i=>i.path.join('.')).join(', '));
    const result=await act(actor,input.data);deliverAfterResponse();return Response.json(result);
  } catch(error) { return failure(error); }
}
