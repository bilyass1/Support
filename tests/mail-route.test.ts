import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({session: vi.fn(), actor: vi.fn(), act: vi.fn(), workspace: vi.fn(), db: vi.fn()}));
vi.mock('../src/lib/db',()=>({pool:{query:harness.db}}));
vi.mock('../src/lib/auth', () => ({auth: {api: {getSession: harness.session}}}));
vi.mock('../src/lib/service', () => ({getActor: harness.actor}));
vi.mock('../src/lib/mail-service', () => ({mailAct: harness.act, mailWorkspace: harness.workspace}));
import { GET, POST } from '../src/app/api/mail/route';
const actor = {id: 'client', name: 'Client', role: 'client', organization_id: '11111111-1111-4111-8111-111111111111'};
function post(body: unknown, origin = 'https://support.example') {
  return new Request('https://support.example/api/mail', {method: 'POST', headers: {'Origin': origin, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
}
beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://support.example');
  harness.session.mockReset().mockResolvedValue({user: {id: 'client', name: 'Client',twoFactorEnabled:true},session:{id:'session-1'}});
  harness.db.mockReset().mockImplementation(async(sql:string)=>sql.includes('session_assurance')?{rows:[{}],rowCount:1}:{rows:[{count:1}],rowCount:1});
  harness.actor.mockReset().mockResolvedValue(actor);
  harness.act.mockReset().mockResolvedValue({message: 'Demande enregistrée.'});
  harness.workspace.mockReset().mockResolvedValue({domains: [], mailboxes: []});
});
afterEach(() => {vi.unstubAllEnvs();});
describe('mail HTTP authentication and input boundary', () => {
  it('requires an authenticated session for reads and writes', async () => {
    harness.session.mockResolvedValue(null);
    expect((await GET(new Request('https://support.example/api/mail'))).status).toBe(401);
    expect((await POST(post({}))).status).toBe(401);
    expect(harness.act).not.toHaveBeenCalled(); expect(harness.workspace).not.toHaveBeenCalled();
  });
  it('blocks sessions without MFA enrollment or verification',async()=>{
    harness.session.mockResolvedValue({user:{id:'client',name:'Client',twoFactorEnabled:false},session:{id:'old'}});
    expect((await GET(new Request('https://support.example/api/mail'))).status).toBe(428);
    harness.session.mockResolvedValue({user:{id:'client',name:'Client',twoFactorEnabled:true},session:{id:'old'}});harness.db.mockResolvedValue({rows:[],rowCount:0});
    expect((await GET(new Request('https://support.example/api/mail'))).status).toBe(428);expect(harness.workspace).not.toHaveBeenCalled();
  });
  it('rejects cross-origin writes before business operations', async () => {
    expect((await POST(post({}, 'https://attacker.example'))).status).toBe(403);
    expect(harness.act).not.toHaveBeenCalled();
  });
  it('rejects invalid pagination', async () => {
    for (const page of ['-1', '1.5', 'bad']) expect((await GET(new Request('https://support.example/api/mail?page=' + page))).status).toBe(400);
    expect(harness.workspace).not.toHaveBeenCalled();
  });
  it('uses the server-authenticated actor and normalizes addresses', async () => {
    const response = await POST(post({type: 'create_mailbox', domain_id: actor.organization_id, local_part: ' CONTACT ', display_name: 'Contact', quota_mb: 100, role: 'admin'}));
    expect(response.status).toBe(200);
    expect(harness.act).toHaveBeenCalledWith(actor, {type: 'create_mailbox', domain_id: actor.organization_id, local_part: 'contact', display_name: 'Contact', quota_mb: 100});
  });
  it('rejects weak mailbox passwords without echoing them', async () => {
    const response = await POST(post({type: 'create_mailbox', domain_id: actor.organization_id, local_part: 'contact', display_name: 'Contact', quota_mb: 100, password: 'weakSecret'}));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('weakSecret');
    expect(harness.act).not.toHaveBeenCalled();
  });
  it('rejects oversized and malformed bodies', async () => {
    expect((await POST(post({content: 'x'.repeat(13000)}))).status).toBe(413);
    expect((await POST(new Request('https://support.example/api/mail', {method: 'POST', headers: {Origin: 'https://support.example'}, body: '{bad'}))).status).toBe(400);
    expect(harness.act).not.toHaveBeenCalled();
  });
  it('passes page selection to the scoped workspace service', async () => {
    expect((await GET(new Request('https://support.example/api/mail?page=2'))).status).toBe(200);
    expect(harness.workspace).toHaveBeenCalledWith(actor, 2);
  });
});

