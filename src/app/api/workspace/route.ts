import { authenticated,failure } from '@/lib/request';
import { workspace } from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try { return Response.json(await workspace(await authenticated(request))); }
  catch(error) { return failure(error); }
}
