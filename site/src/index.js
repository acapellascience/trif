// webmods.dev (a Cloudflare Worker): the home page, the problem report form, and POST /report, which
// emails the report to the maintainer (the EMAIL send_email binding, to the REPORT_TO secret).

import { HOME, REPORT, REPORT_JS } from './pages.js';
import { LIMITS, ReportError, parseReport, reportEmail } from './report.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const respond = (body, type, status = 200, extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': type, ...SECURITY_HEADERS, ...extra } });
const json = (obj, status = 200) => respond(JSON.stringify(obj), 'application/json; charset=utf-8', status, { 'Cache-Control': 'no-store' });
const html = (body) => respond(body, 'text/html; charset=utf-8', 200, { 'Cache-Control': 'public, max-age=300' });

async function receiveReport(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.REPORT_LIMIT) {
    const { success } = await env.REPORT_LIMIT.limit({ key: `report:${ip}` });
    if (!success) return json({ ok: false, error: 'Too many reports from here just now. Please try again in a minute.' }, 429);
  }
  const raw = await request.text();
  if (raw.length > LIMITS.body) return json({ ok: false, error: 'The report is too large.' }, 413);
  let report;
  try {
    let body;
    try { body = JSON.parse(raw); } catch { throw new ReportError('expected JSON'); }
    report = parseReport(body);
  } catch (e) {
    if (e instanceof ReportError) return json({ ok: false, error: e.message }, e.status);
    throw e;
  }
  if (report.spam) return json({ ok: true }); // say nothing to bots
  if (!env.REPORT_TO || !env.EMAIL) return json({ ok: false, error: "Reports aren't set up on this server yet." }, 503);
  const mail = reportEmail(report, { country: request.cf?.country, userAgent: request.headers.get('User-Agent') || '', at: new Date().toISOString() });
  try {
    await env.EMAIL.send({
      to: env.REPORT_TO,
      from: { email: env.REPORT_FROM || 'reports@webmods.dev', name: 'WebMods reports' },
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });
  } catch (e) {
    console.error('sending a report failed:', e.code || '', e.message);
    return json({ ok: false, error: 'The report couldn’t be sent right now.' }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/report' && request.method === 'POST') return receiveReport(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 'text/plain', 405);
    if (pathname === '/') return html(HOME);
    if (pathname === '/report' || pathname === '/report/') return html(REPORT);
    if (pathname === '/report.js') return respond(REPORT_JS, 'text/javascript; charset=utf-8', 200, { 'Cache-Control': 'public, max-age=300' });
    return respond('Not found', 'text/plain', 404);
  },
};
