import { authenticated,failure } from '@/lib/request';
import { clientInsights,companyStats } from '@/lib/insights';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const actor=await authenticated(request);const [insights,stats]=await Promise.all([clientInsights(actor),companyStats(actor)]);return Response.json({...insights,stats});}catch(error){return failure(error);}}
