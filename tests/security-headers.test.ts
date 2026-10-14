import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../src/proxy';
it('generates per-request CSP nonces without script unsafe-inline and never caches private pages',()=>{
 const first=proxy(new NextRequest('https://support.solumove.net/login')),second=proxy(new NextRequest('https://support.solumove.net/login'));
 const csp=first.headers.get('Content-Security-Policy')!;
 expect(csp).toContain("'strict-dynamic'");expect(csp.split('script-src')[1].split(';')[0]).not.toContain('unsafe-inline');
 expect(csp).not.toBe(second.headers.get('Content-Security-Policy'));expect(first.headers.get('Cache-Control')).toContain('no-store');
});
