import { authenticated,failure } from '@/lib/request';
import { clientInsights } from '@/lib/insights';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return Response.json(await clientInsights(await authenticated(request)));}catch(error){return failure(error);}}
