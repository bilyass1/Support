import { authenticated,failure } from '@/lib/request';
import { adminView } from '@/lib/service';
import { mailerAvailable } from '@/lib/mailer';
import { pushPublicKey } from '@/lib/push';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const view=await adminView(await authenticated(request),new URL(request.url).searchParams.get('view')??'');
    return Response.json({...view,channels:{email:mailerAvailable(),push:Boolean(pushPublicKey())}});
  }
  catch(error) { return failure(error); }
}
