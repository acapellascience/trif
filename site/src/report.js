// Checking a submitted problem report or Windows waitlist signup and turning it into the email the
// maintainer gets. No Worker APIs here, so tests run it in Node (tests/site.test.js).

export const LIMITS = { what: 5000, details: 30000, site: 200, email: 200, body: 64 * 1024, signup: 4 * 1024 };

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export class ReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');

/**
 * The report from a form submission's JSON: { what, site, email, details, website }. `website` is a
 * field people can't see: only bots fill it in, and then the result is { spam: true }.
 */
export function parseReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReportError('expected a JSON object');
  if (text(body.website)) return { spam: true };
  const r = { what: text(body.what), site: text(body.site), email: text(body.email), details: text(body.details) };
  if (r.what.length < 3) throw new ReportError('Please say what went wrong.');
  for (const k of ['what', 'site', 'email', 'details']) {
    if (r[k].length > LIMITS[k]) throw new ReportError(`The ${k === 'what' ? 'description' : k} is too long (at most ${LIMITS[k]} characters).`);
  }
  if (r.email && !EMAIL_RE.test(r.email)) throw new ReportError("That email address doesn't look right.");
  r.site = r.site.replace(/\s+/g, ' ');
  return r;
}

const oneLine = (s, n) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The email for a report: { subject, text, replyTo }. meta: { country, userAgent, at }. */
export function reportEmail(r, meta = {}) {
  const subject = `TRIF report${r.site ? ` (${oneLine(r.site, 40)})` : ''}: ${oneLine(r.what, 60)}`;
  const lines = ['What went wrong', r.what, ''];
  if (r.site) lines.push(`Site: ${r.site}`);
  lines.push(`Reply to: ${r.email || '(no address given)'}`);
  lines.push(`Sent: ${meta.at || new Date().toISOString()}${meta.country ? ` from ${meta.country}` : ''}`);
  if (meta.userAgent) lines.push(`Browser: ${oneLine(meta.userAgent, 200)}`);
  lines.push('', r.details ? `Details from TRIF\n${r.details}` : 'No details from TRIF were included.');
  return { subject, text: lines.join('\n') + '\n', replyTo: r.email || null };
}

/**
 * A Windows waitlist signup from the /windows form ({ email, website }, as JSON or form fields): the
 * address, or { spam: true } when the hidden `website` field is filled in.
 */
export function parseSignup(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReportError('expected a JSON object');
  if (text(body.website)) return { spam: true };
  const email = text(body.email);
  if (!email) throw new ReportError('Please enter your email address.');
  if (email.length > LIMITS.email) throw new ReportError(`That email address is too long (at most ${LIMITS.email} characters).`);
  if (!EMAIL_RE.test(email)) throw new ReportError("That email address doesn't look right.");
  return { email };
}

/** The email for a waitlist signup: { subject, text, replyTo }. meta: { at }. Just the address and the time. */
export function signupEmail(s, meta = {}) {
  return {
    subject: `TRIF Windows waitlist: ${s.email}`,
    text: `${s.email} joined the Windows waitlist.\n\nSigned up: ${meta.at || new Date().toISOString()}\n`,
    replyTo: s.email,
  };
}
