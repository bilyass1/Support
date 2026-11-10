import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null = null;
function configuration() {
  const host = process.env.SMTP_HOST, from = process.env.MAIL_FROM;
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? '587');
  return {host, port, from, user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD};
}
export function mailerAvailable() { return configuration() !== null; }
export const companyName = () => process.env.COMPANY_NAME || 'SupportFlow';
export const appUrl = () => (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

export function renderEmail(title: string, message: string, link: string, action = 'Ouvrir mon espace') {
  const company = escape(companyName());
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#141a2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#1b2140;color:#ffffff;padding:20px 28px;font-size:17px;font-weight:bold">${company}</td></tr>
<tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 14px">${escape(title)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px;white-space:pre-line">${escape(message)}</p>
<a href="${escape(link)}" style="display:inline-block;background:#4353ff;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:bold;font-size:14px">${escape(action)}</a></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e6e9f2;font-size:12px;color:#6b7390">Message automatique envoyé par ${company}. Vous le recevez car vous avez un compte sur notre espace client.</td></tr>
</table></td></tr></table></body></html>`;
  return {html, text: `${title}\n\n${message}\n\n${action} : ${link}\n\n${companyName()}`};
}
export async function sendEmail(to: string, subject: string, body: {html: string; text: string}) {
  const config = configuration();
  if (!config) throw new Error('MailerNotConfigured');
  transport ??= nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465,
    auth: config.user ? {user: config.user, pass: config.pass ?? ''} : undefined,
    connectionTimeout: 10_000, socketTimeout: 15_000
  });
  await transport.sendMail({from: config.from, to, subject, html: body.html, text: body.text});
}
