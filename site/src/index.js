// timsrobot.com (a Cloudflare Worker): the home page, the problem report form, and POST /report, which
// emails the report to the maintainer (the EMAIL send_email binding, to the REPORT_TO secret).
//
// And the home page's demo (demo.js): the home page with the mods it switched on (/?mods=a,b), the
// extension's side panel files (/demo/ext/…, from the EXTENSION assets binding: wrangler.toml), the demo's
// scripts and its mods. The side panel may be framed by this site only; everything else by nothing.
//
// It also answers for webmods.dev, TRIF's address before 0.2.0 (when it was called WebMods), sending
// everything there to the same path on timsrobot.com: older installs open webmods.dev/report#r=… (a
// browser keeps the # part across the redirect).

import { REPORT, REPORT_JS } from './pages.js';
import { LIMITS, ReportError, parseReport, reportEmail } from './report.js';
import { DEMO_FILES, EXTENSION_FILES, homeWith, modScript, panelHtml, typeFor } from './demo.js';

const CSP = {
  'default-src': "'none'", 'script-src': "'self'", 'style-src': "'unsafe-inline'", 'connect-src': "'self'", 'img-src': "'self'",
  'form-action': "'self'", 'base-uri': "'none'", 'frame-ancestors': "'none'",
};
/** The Content-Security-Policy: CSP with `changes` (a page that frames the demo, or is framed by it). */
export const csp = (changes = {}) => Object.entries({ ...CSP, ...changes }).map(([k, v]) => `${k} ${v}`).join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': csp(),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

// The demo: the home page frames the side panel.
const FRAMES_DEMO = { 'Content-Security-Policy': csp({ 'frame-src': "'self'" }) };
const PANEL = { 'Content-Security-Policy': csp({ 'style-src': "'self' 'unsafe-inline'", 'frame-ancestors': "'self'" }) };
const CACHE = { 'Cache-Control': 'public, max-age=300' };

const respond = (body, type, status = 200, extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': type, ...SECURITY_HEADERS, ...extra } });
const json = (obj, status = 200) => respond(JSON.stringify(obj), 'application/json; charset=utf-8', status, { 'Cache-Control': 'no-store' });
const html = (body, extra = {}) => respond(body, 'text/html; charset=utf-8', 200, { ...CACHE, ...extra });
const notFound = () => respond('Not found', 'text/plain', 404);

/** A side panel file from the extension's folder (the EXTENSION assets binding), if the panel uses it. */
async function extensionFile(request, env, file) {
  if (!EXTENSION_FILES.has(file) || !env.EXTENSION) return notFound();
  const res = await env.EXTENSION.fetch(new Request(new URL(`/${file}`, request.url)));
  if (!res.ok) return notFound();
  if (file === 'sidepanel.html') return html(panelHtml(await res.text()), PANEL);
  return respond(res.body, typeFor(file), 200, CACHE);
}

/**
 * The rate limit's key for an address: IPv4 as is, IPv6 by its /64 (one household or server usually
 * has a whole /64, so each of its addresses mustn't count separately).
 */
export function limitKey(ip) {
  if (!ip || !ip.includes(':')) return ip || 'unknown';
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

async function receiveReport(request, env) {
  // Only the form on this site may send reports. A JSON body makes a browser ask first (CORS preflight,
  // which this Worker doesn't answer) before another site's page could post one, and the origin check
  // covers anything that slips past that; tools that send no Origin are left to the rate limit.
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return json({ ok: false, error: 'expected JSON' }, 415);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'Reports are sent from the form on this site.' }, 403);
  if (Number(request.headers.get('Content-Length')) > LIMITS.body) return json({ ok: false, error: 'The report is too large.' }, 413);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.REPORT_LIMIT) {
    const { success } = await env.REPORT_LIMIT.limit({ key: `report:${limitKey(ip)}` });
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
      from: { email: env.REPORT_FROM || 'reports@timsrobot.com', name: 'TRIF reports' },
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

export const HOME_HOST = 'timsrobot.com';
const OLD_HOSTS = new Set(['webmods.dev', 'www.webmods.dev']);

/** The redirect for a request to an old address (OLD_HOSTS), or null. */
export function redirectFor(url) {
  const u = new URL(url);
  if (!OLD_HOSTS.has(u.hostname)) return null;
  // 308 keeps the method and body (an older form's POST /report still arrives).
  return new Response(null, { status: 308, headers: { Location: `https://${HOME_HOST}${u.pathname}${u.search}`, 'Cache-Control': 'public, max-age=3600' } });
}

export default {
  async fetch(request, env) {
    const moved = redirectFor(request.url);
    if (moved) return moved;
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === '/report' && request.method === 'POST') return receiveReport(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 'text/plain', 405);
    if (pathname === '/') return html(homeWith(searchParams.get('mods')), FRAMES_DEMO);
    if (pathname === '/report' || pathname === '/report/') return html(REPORT);
    if (pathname === '/report.js') return respond(REPORT_JS, 'text/javascript; charset=utf-8', 200, { 'Cache-Control': 'public, max-age=300' });
    if (Object.hasOwn(DEMO_FILES, pathname)) return respond(DEMO_FILES[pathname].body, DEMO_FILES[pathname].type, 200, CACHE);
    if (pathname.startsWith('/demo/mods/')) {
      const code = modScript(pathname.slice('/demo/mods/'.length));
      return code ? respond(code, 'text/javascript; charset=utf-8', 200, CACHE) : notFound();
    }
    if (pathname.startsWith('/demo/ext/')) return extensionFile(request, env, pathname.slice('/demo/ext/'.length));
    return notFound();
  },
};
