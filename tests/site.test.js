'use strict';
// timsrobot.com (site/): the report form's checks, the email it makes, and the Worker's routes, run in Node
// with a stand-in for Cloudflare's email and rate-limit bindings.

const test = require('node:test');
const assert = require('node:assert');

const load = () => Promise.all([import('../site/src/index.js'), import('../site/src/report.js')]);

function env(overrides = {}) {
  const sent = [];
  return {
    sent,
    REPORT_TO: 'maintainer@example.com', REPORT_FROM: 'reports@timsrobot.com',
    EMAIL: { async send(m) { sent.push(m); return { messageId: 'm1' }; } },
    ...overrides,
  };
}

const post = (body, headers = {}) => new Request('https://timsrobot.com/report', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('parseReport: needs a description, checks lengths and the email, ignores bots', async () => {
  const [, { parseReport, ReportError, LIMITS }] = await load();
  assert.deepStrictEqual(parseReport({ what: '  Broken\r\nagain ', site: ' x.com ', email: '', details: 'd' }), { what: 'Broken\nagain', site: 'x.com', email: '', details: 'd' });
  assert.throws(() => parseReport({ what: 'x' }), /say what went wrong/);
  assert.throws(() => parseReport({ what: 'fine', email: 'nope' }), /doesn't look right/);
  assert.throws(() => parseReport({ what: 'x'.repeat(LIMITS.what + 1) }), /too long/);
  assert.throws(() => parseReport({ what: 'fine', details: 'x'.repeat(LIMITS.details + 1) }), /details is too long/);
  assert.throws(() => parseReport([]), ReportError);
  assert.deepStrictEqual(parseReport({ what: 'buy pills', website: 'http://spam' }), { spam: true });
});

test('reportEmail: a readable subject and body, replies go to the reporter', async () => {
  const [, { reportEmail }] = await load();
  const m = reportEmail({ what: 'Plain X shows\nnothing at all since this morning, and more words to make it long', site: 'x.com', email: 'a@b.co', details: 'TRIF 0.1.1' },
    { country: 'CA', userAgent: 'Firefox/159', at: '2026-11-01T00:00:00Z' });
  assert.equal(m.subject, 'TRIF report (x.com): Plain X shows nothing at all since this morning, and more w…');
  assert.equal(m.replyTo, 'a@b.co');
  for (const want of ['What went wrong\nPlain X shows\nnothing', 'Site: x.com', 'Reply to: a@b.co', 'Sent: 2026-11-01T00:00:00Z from CA', 'Browser: Firefox/159', 'Details from TRIF\nTRIF 0.1.1']) {
    assert.ok(m.text.includes(want), want);
  }
  assert.equal(reportEmail({ what: 'x y z', site: '', email: '', details: '' }).replyTo, null);
});

test('the Worker: pages with strict headers, reports emailed, bad ones refused', async () => {
  const [{ default: worker }] = await load();
  const e = env();
  for (const [path, type] of [['/', 'text/html'], ['/report', 'text/html'], ['/report.js', 'text/javascript']]) {
    const res = await worker.fetch(new Request(`https://timsrobot.com${path}`), e);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('Content-Type'), new RegExp(type));
    assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'; script-src 'self'/);
    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  }
  assert.match(await (await worker.fetch(new Request('https://timsrobot.com/report'), e)).text(), /<script src="\/report.js">/);
  assert.equal((await worker.fetch(new Request('https://timsrobot.com/nope'), e)).status, 404);
  // The home page: what TRIF is, where to get it, how to report a problem.
  const home = await (await worker.fetch(new Request('https://timsrobot.com/'), e)).text();
  assert.match(home, /Fix any website with your own coding agent\./);
  assert.match(home, /href="https:\/\/github\.com\/acapellascience\/trif#install">Get it</);
  assert.match(home, /href="\/report">Report a problem</);
  assert.ok(!/<script/.test(home), 'the home page runs no script');

  let res = await worker.fetch(post({ what: 'It broke', site: 'x.com', email: 'a@b.co', details: 'TRIF 0.1.1' }, { 'User-Agent': 'Firefox/159' }), e);
  assert.deepStrictEqual([res.status, await res.json()], [200, { ok: true }]);
  assert.equal(e.sent.length, 1);
  assert.deepStrictEqual([e.sent[0].to, e.sent[0].from, e.sent[0].replyTo], ['maintainer@example.com', { email: 'reports@timsrobot.com', name: 'TRIF reports' }, 'a@b.co']);
  assert.match(e.sent[0].subject, /^TRIF report \(x\.com\): It broke$/);

  res = await worker.fetch(post({ what: 'x' }), e);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /say what went wrong/);
  assert.equal((await worker.fetch(post('{not json'), e)).status, 400);
  assert.equal((await worker.fetch(post('x'.repeat(70 * 1024)), e)).status, 413);
  // Bots get an "ok" and no email.
  res = await worker.fetch(post({ what: 'spam spam', website: 'x' }), e);
  assert.deepStrictEqual([res.status, e.sent.length], [200, 1]);
  assert.equal(e.sent.length, 1);
});

test('the Worker: only takes JSON reports from its own form (no other site can post them)', async () => {
  const [{ default: worker, limitKey }] = await load();
  const e = env();
  assert.equal((await worker.fetch(post({ what: 'from the form' }, { Origin: 'https://timsrobot.com' }), e)).status, 200);
  assert.equal((await worker.fetch(post({ what: 'from a tool' }), e)).status, 200, 'no Origin: a tool, left to the rate limit');
  assert.equal((await worker.fetch(post({ what: 'from elsewhere' }, { Origin: 'https://evil.example' }), e)).status, 403);
  assert.equal((await worker.fetch(post({ what: 'as text' }, { 'Content-Type': 'text/plain' }), e)).status, 415);
  assert.equal((await worker.fetch(post({ what: 'big' }, { 'Content-Length': String(10 * 1024 * 1024) }), e)).status, 413);
  assert.equal(e.sent.length, 2);
  assert.equal(limitKey('203.0.113.9'), '203.0.113.9');
  assert.equal(limitKey('2001:db8:85a3:0042:1000:8a2e:370:7334'), '2001:db8:85a3:42::/64');
  assert.equal(limitKey('2001:DB8::1'), '2001:db8:0:0::/64');
  assert.equal(limitKey('2001:db8:85a3:42::abcd'), limitKey('2001:db8:85a3:42:ffff::1'));
  assert.equal(limitKey(''), 'unknown');
});

test('the Worker: rate limited per address; says so when email isn\'t set up or fails', async () => {
  const [{ default: worker }] = await load();
  const keys = [];
  let allow = true;
  const limited = env({ REPORT_LIMIT: { async limit({ key }) { keys.push(key); return { success: allow }; } } });
  await worker.fetch(post({ what: 'first one' }), limited);
  allow = false;
  const res = await worker.fetch(post({ what: 'second one' }), limited);
  assert.equal(res.status, 429);
  assert.deepStrictEqual(keys, ['report:203.0.113.9', 'report:203.0.113.9']);
  assert.equal(limited.sent.length, 1);

  assert.equal((await worker.fetch(post({ what: 'no address' }), env({ REPORT_TO: '' }))).status, 503);
  const failing = env({ EMAIL: { async send() { const err = new Error('nope'); err.code = 'E_DELIVERY_FAILED'; throw err; } } });
  const origError = console.error;
  console.error = () => {};
  try {
    const r = await worker.fetch(post({ what: 'will fail' }), failing);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /couldn’t be sent/);
  } finally { console.error = origError; }
});

test('webmods.dev (the address before 0.2.0) redirects to the same place on timsrobot.com', async () => {
  const [{ default: worker }] = await load();
  const e = env();
  const res = await worker.fetch(new Request('https://webmods.dev/report?x=1'), e);
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('Location'), 'https://timsrobot.com/report?x=1');
  assert.equal((await worker.fetch(new Request('https://www.webmods.dev/'), e)).headers.get('Location'), 'https://timsrobot.com/');
  const post = await worker.fetch(new Request('https://webmods.dev/report', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), e);
  assert.equal(post.status, 308);
  assert.equal(e.sent.length, 0, 'nothing is sent from the old address');
  assert.equal((await worker.fetch(new Request('https://timsrobot.com/'), e)).status, 200);
});

test('the home page\'s robot is the extension\'s shaded robot', async () => {
  const fs = require('fs');
  const path = require('path');
  const { ROBOT_SVG } = await import('../site/src/pages.js');
  const file = fs.readFileSync(path.join(__dirname, '..', 'extension', 'icons', 'robot-shaded.svg'), 'utf8');
  const shapes = (svg) => svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[^>]*>/, '').replace(/\s+/g, ' ').trim();
  assert.equal(shapes(ROBOT_SVG), shapes(file), 'run node scripts/render-icon.js, then copy the new robot into site/src/pages.js');
});
