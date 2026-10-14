import {it,expect,vi} from 'vitest';
import {createHash,createDecipheriv} from 'node:crypto';
const query=vi.hoisted(()=>vi.fn(async()=>({rows:[],rowCount:1})));
vi.mock('../src/lib/db',()=>({pool:{query}}));
import {queueAuthEmail} from '../src/lib/auth-email';
it('queues encrypted reset links, never plaintext, with a bounded expiry',async()=>{
 vi.stubEnv('BETTER_AUTH_SECRET','test-secret-12345678901234567890123456');
 try{await queueAuthEmail('client@example.com','Reset','https://support.example/reset-password?token=private-test-token');const [sql,args]=query.mock.calls[0] as unknown as [string,string[]];expect(sql).toContain("30 minutes");expect(args[0]).not.toContain('private-test-token');
 const encrypted=Buffer.from(args[0],'base64'),cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(process.env.BETTER_AUTH_SECRET!).digest(),encrypted.subarray(0,12));cipher.setAuthTag(encrypted.subarray(12,28));const decoded=JSON.parse(Buffer.concat([cipher.update(encrypted.subarray(28)),cipher.final()]).toString());expect(decoded.to).toBe('client@example.com');expect(decoded.text).toContain('private-test-token');}finally{vi.unstubAllEnvs();}
});
