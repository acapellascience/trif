// timsrobot.com (a Cloudflare Worker): the home page, the problem report form, and POST /report, which
// emails the report to the maintainer (the EMAIL send_email binding, to the REPORT_TO secret). Also the
// Windows waitlist: /windows, whose POST emails each signup the same way (the maintainer's inbox is the list).
//
// And the home page's demo (demo.js): the home page with the mods it switched on (/?mods=a,b), the
// extension's side panel files (/demo/ext/…, from the EXTENSION assets binding: wrangler.toml), the demo's
// scripts and its mods. The side panel may be framed by this site only; everything else by nothing.
//
// It also answers for webmods.dev, TRIF's address before 0.2.0 (when it was called WebMods), sending
// everything there to the same path on timsrobot.com: older installs open webmods.dev/report#r=… (a
// browser keeps the # part across the redirect).

import { REPORT, REPORT_JS, WINDOWS, WINDOWS_JS, windowsPage } from './pages.js';
import { LIMITS, ReportError, parseReport, parseSignup, reportEmail, signupEmail } from './report.js';
import { DEMO_FILES, EXTENSION_FILES, homeWith, modScript, pageWith, panelHtml, typeFor } from './demo.js';

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
const html = (body, status = 200, cache = 'public, max-age=300', extra = {}) => respond(body, 'text/html; charset=utf-8', status, { 'Cache-Control': cache, ...extra });
// A page with a plain form (no script needed) that posts back here: under 'no-referrer' a browser sends
// "Origin: null" with the post, which the origin check can't tell from another site's. 'same-origin'
// still sends nothing to other sites.
const FORM_PAGE = { 'Referrer-Policy': 'same-origin' };
const script = (body) => respond(body, 'text/javascript; charset=utf-8', 200, CACHE);
const bodyType = (request) => (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
const notFound = () => respond('Not found', 'text/plain', 404);

/** A side panel file from the extension's folder (the EXTENSION assets binding), if the panel uses it. */
async function extensionFile(request, env, file) {
  if (!EXTENSION_FILES.has(file) || !env.EXTENSION) return notFound();
  const res = await env.EXTENSION.fetch(new Request(new URL(`/${file}`, request.url)));
  if (!res.ok) return notFound();
  if (file === 'sidepanel.html') return html(panelHtml(await res.text()), 200, undefined, PANEL);
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

/**
 * What a form's POST must pass before its body is read: the body type, that it came from this site, its
 * size, and the rate limit (the one REPORT_LIMIT binding, counted separately for each form by `name`).
 * Returns { status, error } to refuse it, or null.
 *
 * Only the forms on this site may post. A JSON body makes a browser ask first (CORS preflight, which this
 * Worker doesn't answer) before another site's page could post one; a plain form post doesn't, so the
 * origin check covers it and anything else that slips past (a browser always sends Origin with a POST;
 * see FORM_PAGE).
 * Tools that send no Origin are left to the rate limit.
 */
async function admit(request, env, { name, types, max, says }) {
  if (!types.includes(bodyType(request))) return { status: 415, error: types.length > 1 ? 'expected JSON or a form' : 'expected JSON' };
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return { status: 403, error: says.elsewhere };
  if (Number(request.headers.get('Content-Length')) > max) return { status: 413, error: says.tooLarge };
  if (env.REPORT_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.REPORT_LIMIT.limit({ key: `${name}:${limitKey(ip)}` });
    if (!success) return { status: 429, error: says.tooMany };
  }
  return null;
}

async function receiveReport(request, env) {
  const tooLarge = 'The report is too large.';
  const refused = await admit(request, env, {
    name: 'report', types: ['application/json'], max: LIMITS.body,
    says: { elsewhere: 'Reports are sent from the form on this site.', tooLarge, tooMany: 'Too many reports from here just now. Please try again in a minute.' },
  });
  if (refused) return json({ ok: false, error: refused.error }, refused.status);
  const raw = await request.text();
  if (raw.length > LIMITS.body) return json({ ok: false, error: tooLarge }, 413);
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

const FORM = 'application/x-www-form-urlencoded';

// A Windows waitlist signup: JSON from the page's script (answered with JSON), or a plain form post when
// the script doesn't run (answered with the thanks page, or the form again with what was wrong).
async function receiveSignup(request, env) {
  const asForm = bodyType(request) === FORM;
  let email = '';
  const reply = (status, error) => {
    if (!asForm) return json(error ? { ok: false, error } : { ok: true }, status);
    return html(windowsPage(error ? { error, email } : { thanks: true }), status, 'no-store', FORM_PAGE);
  };
  const tooLarge = 'That’s too much to send.';
  const refused = await admit(request, env, {
    name: 'windows', types: ['application/json', FORM], max: LIMITS.signup,
    says: { elsewhere: 'Please sign up with the form on timsrobot.com.', tooLarge, tooMany: 'Too many signups from here just now. Please try again in a minute.' },
  });
  if (refused) return reply(refused.status, refused.error);
  const raw = await request.text();
  if (raw.length > LIMITS.signup) return reply(413, tooLarge);
  let signup;
  try {
    let body;
    if (asForm) body = Object.fromEntries(new URLSearchParams(raw));
    else try { body = JSON.parse(raw); } catch { throw new ReportError('expected JSON'); }
    email = typeof body?.email === 'string' ? body.email.trim().slice(0, LIMITS.email) : '';
    signup = parseSignup(body);
  } catch (e) {
    if (e instanceof ReportError) return reply(e.status, e.message);
    throw e;
  }
  if (signup.spam) return reply(200); // say nothing to bots
  if (!env.REPORT_TO || !env.EMAIL) return reply(503, 'The waitlist isn’t set up on this server yet.');
  const mail = signupEmail(signup, { at: new Date().toISOString() });
  try {
    await env.EMAIL.send({
      to: env.REPORT_TO,
      from: { email: env.REPORT_FROM || 'reports@timsrobot.com', name: 'TRIF waitlist' },
      subject: mail.subject,
      text: mail.text,
      replyTo: mail.replyTo,
    });
  } catch (e) {
    console.error('sending a waitlist signup failed:', e.code || '', e.message);
    return reply(502, 'You couldn’t be added just now. Please try again later.');
  }
  return reply(200);
}

export const HOME_HOST = 'timsrobot.com';
// (and www.timsrobot.com, to the bare name)
const OLD_HOSTS = new Set(['webmods.dev', 'www.webmods.dev', 'www.timsrobot.com']);

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
    if (pathname === '/windows' && request.method === 'POST') return receiveSignup(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 'text/plain', 405);
    if (pathname === '/') return html(homeWith(searchParams.get('mods')), 200, undefined, FRAMES_DEMO);
    if (pathname === '/report' || pathname === '/report/') return html(pageWith(REPORT, searchParams.get('mods')));
    if (pathname === '/report.js') return script(REPORT_JS);
    if (pathname === '/windows' || pathname === '/windows/') return html(pageWith(WINDOWS, searchParams.get('mods')), 200, undefined, FORM_PAGE);
    if (pathname === '/windows.js') return script(WINDOWS_JS);
    if (Object.hasOwn(DEMO_FILES, pathname)) return respond(DEMO_FILES[pathname].body, DEMO_FILES[pathname].type, 200, CACHE);
    if (pathname.startsWith('/demo/mods/')) {
      const code = modScript(pathname.slice('/demo/mods/'.length));
      return code ? respond(code, 'text/javascript; charset=utf-8', 200, CACHE) : notFound();
    }
    if (pathname.startsWith('/demo/ext/')) return extensionFile(request, env, pathname.slice('/demo/ext/'.length));
    return notFound();
  },
};
