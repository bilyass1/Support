import { authenticated, failure, sameOrigin } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { mailWorkspace, mailAct } from '@/lib/mail-service';
import { mailActionSchema } from '@/lib/mail-validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const actor = await authenticated(request);
    const page = Number(new URL(request.url).searchParams.get('page') ?? '0');
    if (!Number.isInteger(page) || page < 0 || page > 1_000_000) throw new DomainError('Page invalide.');
    return Response.json(await mailWorkspace(actor, page));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await authenticated(request);
    const raw = await request.text();
    if (raw.length > 12000) throw new DomainError('Requête trop volumineuse.', 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new DomainError('JSON invalide.'); }
    const input = mailActionSchema.safeParse(value);
    if (!input.success) throw new DomainError('Champs de messagerie invalides. Vérifiez les noms, quotas et mots de passe.');
    return Response.json(await mailAct(actor, input.data));
  } catch (error) { return failure(error); }
}
