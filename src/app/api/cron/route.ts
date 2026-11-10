import { timingSafeEqual } from 'node:crypto';
import { failure } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { reminders } from '@/lib/service';
import { flushDeliveries } from '@/lib/dispatch';
import { syncMailUsage } from '@/lib/mail-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
/** Scheduled job (every 10-15 minutes): reminders, retry of failed deliveries, mailbox usage refresh. */
export async function GET(request:Request) {
  try {
    const secret=process.env.CRON_SECRET??'',given=request.headers.get('authorization')??'';
    const expected=Buffer.from('Bearer '+secret),received=Buffer.from(given);
    if(secret.length<16||expected.length!==received.length||!timingSafeEqual(expected,received)) throw new DomainError('Accès refusé.',401);
    const reminded=await reminders();
    const mail=await syncMailUsage().catch(()=>({domains:0,mailboxes:0,failed:true}));
    const deliveries=await flushDeliveries(true);
    return Response.json({reminded,mail,deliveries});
  } catch(error) { return failure(error); }
}
