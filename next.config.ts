import type { NextConfig } from 'next';
const security = [
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'X-Frame-Options',value:'DENY'},
  {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
  {key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},
  {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)'},
  {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"}
];
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['nodemailer','web-push'],
  async headers() {
    return [
      { source: '/:path*', headers: security },
      { source: '/api/:path*', headers: [{key:'Cache-Control',value:'no-store'}] },
      { source: '/sw.js', headers: [{key:'Cache-Control',value:'no-cache'}] }
    ];
  }
};
export default config;
