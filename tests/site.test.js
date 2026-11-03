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
  // Its only script is the demo tab's (deferred, so the page is all there before it runs).
  assert.deepStrictEqual(home.match(/<script[^>]*>/g), ['<script src="/demo.js" defer>']);

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

// ---- the home page's demo (site/src/demo.js, site/demo/) ----------------------------------------------

const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..');

async function demoEnv() {
  const { localAssets } = await import('../site/local-assets.js');
  return env({ EXTENSION: localAssets(path.join(REPO_DIR, 'extension')) });
}
const get = async (worker, e, p) => worker.fetch(new Request(`https://timsrobot.com${p}`), e);
const directives = (res) => Object.fromEntries(res.headers.get('Content-Security-Policy').split(/;\s*/).map((d) => { const [k, ...v] = d.split(' '); return [k, v.join(' ')]; }));

test('the demo: its routes, and the side panel from the extension\'s own files', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  for (const [p, type] of [['/demo', 'text/html'], ['/demo/', 'text/html'], ['/demo/home', 'text/html'], ['/demo.js', 'text/javascript'],
    ['/demo/frame.js', 'text/javascript'], ['/demo/shim.js', 'text/javascript'], ['/demo/panel.css', 'text/css'], ['/demo/mods/fireworks.js', 'text/javascript'],
    ['/demo/ext/sidepanel.html', 'text/html'], ['/demo/ext/sidepanel.js', 'text/javascript'], ['/demo/ext/sidepanel.css', 'text/css'],
    ['/demo/ext/manifest.json', 'application/json'], ['/demo/ext/icons/robot-shaded.svg', 'image/svg+xml']]) {
    const res = await get(worker, e, p);
    assert.equal(res.status, 200, p);
    assert.ok(res.headers.get('Content-Type').startsWith(type), p);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff', p);
  }
  // The extension's files, byte for byte (sidepanel.html: plus the demo's two lines).
  const ext = (f) => fs.readFileSync(path.join(REPO_DIR, 'extension', f), 'utf8');
  assert.equal(await (await get(worker, e, '/demo/ext/sidepanel.js')).text(), ext('sidepanel.js'));
  const panel = await (await get(worker, e, '/demo/ext/sidepanel.html')).text();
  assert.equal(panel, ext('sidepanel.html').replace('</head>', '<link rel="stylesheet" href="/demo/panel.css">\n<script src="/demo/shim.js"></script>\n</head>'));
  assert.ok(panel.indexOf('/demo/shim.js') < panel.indexOf('sidepanel.js'), 'the shim loads before the panel');
  // Nothing else of the extension, and nothing outside it.
  for (const p of ['/demo/ext/background.js', '/demo/ext/onboarding.html', '/demo/ext/%2e%2e/package.json', '/demo/ext/', '/demo/mods/nope.js',
    '/demo/mods/../src/index.js', '/demo/mods/Fireworks.js', '/demo/x']) {
    assert.equal((await get(worker, e, p)).status, 404, p);
  }
  // Without the assets binding the panel isn't there, and nothing breaks.
  assert.equal((await get(worker, env(), '/demo/ext/sidepanel.js')).status, 404);
  const demo = await (await get(worker, e, '/demo')).text();
  assert.match(demo, /<iframe id="page" src="\/demo\/home"/);
  assert.match(demo, /<iframe id="panel" src="\/demo\/ext\/sidepanel.html"/);
  assert.match(demo, /recordings of real Claude Code chats, sped up/);
});

test('the demo: the CSP lets this site frame the demo pages and stays strict everywhere else', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  const all = ['/', '/report', '/report.js', '/nope', '/demo', '/demo/home?mods=fireworks', '/demo.js', '/demo/shim.js', '/demo/mods/fireworks.js',
    '/demo/ext/sidepanel.html', '/demo/ext/sidepanel.js'];
  const framed = new Set(['/demo', '/demo/home?mods=fireworks', '/demo/ext/sidepanel.html']);
  const frames = new Set(['/', '/demo']);
  for (const p of all) {
    const d = directives(await get(worker, e, p));
    assert.equal(d['default-src'], "'none'", p);
    assert.equal(d['script-src'], "'self'", p);
    assert.equal(d['base-uri'], "'none'", p);
    assert.equal(d['connect-src'], "'self'", p);
    assert.equal(d['frame-ancestors'], framed.has(p) ? "'self'" : "'none'", p);
    assert.equal(d['frame-src'], frames.has(p) ? "'self'" : undefined, p);
    assert.equal(d['style-src'], p === '/demo/ext/sidepanel.html' ? "'self' 'unsafe-inline'" : "'unsafe-inline'", p);
    assert.ok(!/unsafe-eval|\*|https?:|data:/.test(Object.values(d).join(' ')), `${p}: nothing beyond this site`);
  }
});

test('the demo: /demo/home runs only the bundled mods it names, unknown names are ignored', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  const page = async (q) => (await get(worker, e, `/demo/home${q}`)).text();
  const scripts = (html) => html.match(/<script[^>]*>/g) || [];
  assert.deepStrictEqual(scripts(await page('')), [], 'no mods: no script at all (and no demo tab)');
  const html = await page(`?mods=${encodeURIComponent('fireworks,nope,../src/index,<img src=x onerror=alert(1)>,neon-title,fireworks')}`);
  assert.deepStrictEqual(scripts(html), ['<script src="/demo/mods/neon-title.js">', '<script src="/demo/mods/fireworks.js" defer>'],
    'document-start mods before the page, the rest deferred; each once');
  assert.ok(!/nope|onerror|index/.test(html), 'nothing from the address is written into the page');
  assert.ok(!/demo-tab|\/demo\.js/.test(html), 'no demo tab inside the demo');
  assert.match(html, /<base target="_blank">/);
  assert.match(html, /Fix any website with your own coding agent\./);
  const { modsFrom } = await import('../site/src/demo.js');
  assert.deepStrictEqual(modsFrom('x,,y').map((m) => m.slug), []);
  assert.deepStrictEqual(modsFrom(null).map((m) => m.slug), []);
});

test('the home page works without script: everything is in the HTML, the tab is a link to /demo', async () => {
  const [{ default: worker }] = await load();
  const home = await (await get(worker, await demoEnv(), '/')).text();
  for (const want of ["<h1>Tim's Robot Internet Fixer</h1>", 'Fix any website with your own coding agent.', 'What you need', 'Yours, on your computer',
    '<a class="demo-tab" href="/demo">Try the demo</a>', '<footer>']) assert.ok(home.includes(want), want);
  assert.ok(!/\shidden[\s>]/.test(home), 'nothing waits for a script to be shown');
  assert.ok(!/<iframe/.test(home), 'the demo loads only when asked for');
});

test('the demo serves every extension file the side panel loads', async () => {
  const { EXTENSION_FILES } = await import('../site/src/demo.js');
  const dir = path.join(REPO_DIR, 'extension');
  const need = new Set();
  const html = fs.readFileSync(path.join(dir, 'sidepanel.html'), 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) need.add(ref);
  // Icons the panel sets itself (renderGate).
  const panelJs = fs.readFileSync(path.join(dir, 'sidepanel.js'), 'utf8');
  for (const [, icon] of panelJs.matchAll(/`(icons\/robot-shaded)\$\{[^}]*'(-red)'[^}]*\}\.svg`/g)) { need.add(`${icon}.svg`); need.add(`${icon}-red.svg`); }
  const visit = (f) => {
    if (!f.endsWith('.js') || need.has(`seen:${f}`)) return;
    need.add(`seen:${f}`);
    for (const [, imp] of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^import[^'"]*['"]\.\/([^'"]+)['"]/gm)) { need.add(imp); visit(imp); }
  };
  [...need].forEach(visit);
  const files = [...need].filter((f) => !f.startsWith('seen:'));
  assert.ok(files.includes('lib.js') && files.includes('runtime.js') && files.includes('icons/robot-shaded-red.svg'), files.join(' '));
  for (const f of files) assert.ok(EXTENSION_FILES.has(f), `site/src/demo.js EXTENSION_FILES is missing ${f}`);
  for (const f of EXTENSION_FILES) assert.ok(fs.existsSync(path.join(dir, f)), `${f} isn't in extension/`);
});

test('the demo\'s bundle is up to date with site/demo/, its chats are clean and render safely', async () => {
  const { demoModule, OUT } = await import('../site/build-demo.js');
  assert.equal(fs.readFileSync(OUT, 'utf8'), demoModule(), 'run node site/build-demo.js');
  const { MODS, CHATS, FILES } = await import('../site/src/demo-files.js');
  assert.equal(MODS.length, 13);
  const slugs = new Set(MODS.map((m) => m.slug));
  for (const c of CHATS) {
    assert.equal(c.messages[0].role, 'user', c.id);
    assert.equal(c.messages[0].text, c.prompt, c.id);
    for (const s of c.mods) assert.ok(slugs.has(s), `${c.id}: ${s}`);
    for (const a of c.after) assert.ok(CHATS.some((x) => x.id === a), `${c.id} follows ${a}`);
  }
  const text = JSON.stringify(CHATS);
  assert.ok(!/\/private\/|\/tmp\/|\/Users\/|claude-501|--tab \d|e2e/.test(text), 'no machine-specific paths or tab ids in the recordings');
  // The panel renders assistant (and error) lines as markdown: only its own few tags come out.
  const { renderMarkdown, MARKDOWN_ELEMENTS } = await import('../extension/markdown.js');
  for (const c of CHATS) {
    for (const m of c.messages) {
      const tags = [...renderMarkdown(m.text).matchAll(/<\/?([a-z0-9]+)/g)].map((x) => x[1]);
      for (const t of tags) assert.ok(MARKDOWN_ELEMENTS.includes(t), `${c.id}: <${t}>`);
    }
  }
  for (const [name, code] of Object.entries(FILES)) assert.ok(!/\beval\(|new Function|innerHTML|document\.write/.test(code), `${name}: no eval or raw HTML`);
});
