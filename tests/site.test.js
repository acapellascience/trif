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
  const m = reportEmail({ what: 'Detox Timeline shows\nnothing at all since this morning, and more words to make it long', site: 'x.com', email: 'a@b.co', details: 'TRIF 0.1.1' },
    { country: 'CA', userAgent: 'Firefox/159', at: '2026-11-01T00:00:00Z' });
  assert.equal(m.subject, 'TRIF report (x.com): Detox Timeline shows nothing at all since this morning, and…');
  assert.equal(m.replyTo, 'a@b.co');
  for (const want of ['What went wrong\nDetox Timeline shows\nnothing', 'Site: x.com', 'Reply to: a@b.co', 'Sent: 2026-11-01T00:00:00Z from CA', 'Browser: Firefox/159', 'Details from TRIF\nTRIF 0.1.1']) {
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
  assert.match(home, /href="https:\/\/github\.com\/acapellascience\/trif#install" target="_blank" rel="noopener">Get it</);
  assert.match(home, /href="https:\/\/github\.com\/acapellascience\/trif" target="_blank" rel="noopener">GitHub</, "the buttons open a new tab");
  assert.match(home, /href="\/report" target="_blank" rel="noopener">Report a problem</); // (footer links open in a new tab)
  // Its only script is the demo tab's (deferred, so the page is all there before it runs).
  assert.deepStrictEqual(home.match(/<script[^>]*>/g), ['<script src="/space.js" defer>', '<script src="/demo.js" defer>']);
  assert.match(home, /<footer>.*<a href="\/windows" target="_blank" rel="noopener">Windows<\/a>.*<\/footer>/, 'the footer links to the Windows waitlist');

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
  assert.equal((await worker.fetch(new Request('https://www.timsrobot.com/windows?mods=rave'), e)).headers.get('Location'), 'https://timsrobot.com/windows?mods=rave', 'www goes to the bare name');
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
  for (const [p, type] of [['/demo.js', 'text/javascript'], ['/space.js', 'text/javascript'], ['/demo/shim.js', 'text/javascript'], ['/demo/panel.css', 'text/css'],
    ['/demo/mods/fireworks.js', 'text/javascript'], ['/demo/ext/sidepanel.html', 'text/html'], ['/demo/ext/sidepanel.js', 'text/javascript'],
    ['/demo/ext/sidepanel.css', 'text/css'], ['/demo/ext/manifest.json', 'application/json'], ['/demo/ext/icons/robot-shaded.svg', 'image/svg+xml']]) {
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
  // Nothing else of the extension, nothing outside it, and no more demo window.
  for (const p of ['/demo/ext/background.js', '/demo/ext/onboarding.html', '/demo/ext/%2e%2e/package.json', '/demo/ext/', '/demo/mods/nope.js',
    '/demo/mods/../src/index.js', '/demo/mods/Fireworks.js', '/demo/x', '/demo', '/demo/home', '/demo/frame.js']) {
    assert.equal((await get(worker, e, p)).status, 404, p);
  }
  // Without the assets binding the panel isn't there, and nothing breaks.
  assert.equal((await get(worker, env(), '/demo/ext/sidepanel.js')).status, 404);
});

test('the demo: the CSP lets the home page frame the side panel and stays strict everywhere else', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  const all = ['/', '/?mods=fireworks', '/report', '/report.js', '/nope', '/demo.js', '/demo/shim.js', '/demo/mods/fireworks.js',
    '/demo/ext/sidepanel.html', '/demo/ext/sidepanel.js'];
  for (const p of all) {
    const d = directives(await get(worker, e, p));
    const home = p.startsWith('/?') || p === '/';
    assert.equal(d['default-src'], "'none'", p);
    assert.equal(d['script-src'], "'self'", p);
    assert.equal(d['base-uri'], "'none'", p);
    assert.equal(d['connect-src'], "'self'", p);
    assert.equal(d['frame-ancestors'], p === '/demo/ext/sidepanel.html' ? "'self'" : "'none'", p);
    assert.equal(d['frame-src'], home ? "'self'" : undefined, p);
    assert.equal(d['style-src'], p === '/demo/ext/sidepanel.html' ? "'self' 'unsafe-inline'" : "'unsafe-inline'", p);
    assert.ok(!/unsafe-eval|\*|https?:|data:/.test(Object.values(d).join(' ')), `${p}: nothing beyond this site`);
  }
});

test('the demo: /?mods= runs only the bundled mods it names on the home page, unknown names are ignored', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  const page = async (q) => (await get(worker, e, `/${q}`)).text();
  const scripts = (html) => html.match(/<script[^>]*>/g) || [];
  const tabOnly = ['<script src="/space.js" defer>', '<script src="/demo.js" defer>'];
  assert.deepStrictEqual(scripts(await page('')), tabOnly);
  assert.deepStrictEqual(scripts(await page('?mods=')), tabOnly);
  assert.deepStrictEqual(scripts(await page('?mods=nope,x')), tabOnly);
  assert.equal(await page('?mods=nope'), await page(''), 'unknown names: the plain home page');
  const html = await page(`?mods=${encodeURIComponent('fireworks,nope,../src/index,<img src=x onerror=alert(1)>,neon,fireworks')}`);
  assert.deepStrictEqual(scripts(html), ['<script src="/demo/mods/neon.js">', '<script src="/space.js" defer>', '<script src="/demo.js" defer>', '<script src="/demo/mods/fireworks.js" defer>'],
    'document-start mods before the page, the rest deferred; each once');
  assert.ok(!/nope|onerror|src\/index/.test(html), 'nothing from the address is written into the page');
  assert.match(html, /Fix any website with your own coding agent\./);
  const { modsFrom } = await import('../site/src/demo.js');
  assert.deepStrictEqual(modsFrom('x,,y').map((m) => m.slug), []);
  assert.deepStrictEqual(modsFrom(null).map((m) => m.slug), []);
});

test('the demo: the report form and the Windows waitlist run the bundled mods their ?mods= names (the demo carries it there)', async () => {
  const [{ default: worker }] = await load();
  const e = await demoEnv();
  const page = async (p) => (await get(worker, e, p)).text();
  const mods = (html) => (html.match(/<script src="\/demo\/mods\/[^"]+"[^>]*>/g) || []);
  for (const p of ['/report', '/windows']) {
    const plain = await page(p);
    assert.deepStrictEqual(mods(plain), [], `${p}: no mods without ?mods=`);
    assert.equal(await page(`${p}?mods=nope`), plain, `${p}: unknown names change nothing`);
    const html = await page(`${p}?mods=${encodeURIComponent('fireworks,<img src=x onerror=alert(1)>,neon')}`);
    assert.deepStrictEqual(mods(html), ['<script src="/demo/mods/neon.js">', '<script src="/demo/mods/fireworks.js" defer>'], p);
    assert.ok(html.indexOf('/demo/mods/neon.js') < html.indexOf('</head>') && html.indexOf('/demo/mods/fireworks.js') < html.indexOf('</body>'), p);
    assert.ok(!/onerror/.test(html), `${p}: nothing from the address is written into the page`);
  }
});

test('the home page works without script: everything is in the HTML; the demo tab only shows with it', async () => {
  const [{ default: worker }] = await load();
  const home = await (await get(worker, await demoEnv(), '/')).text();
  for (const want of ["<h1>Tim's Robot Internet Fixer</h1>", 'Fix any website with your own coding agent.', 'What you need', 'Yours, on your computer',
    '<footer>', '<button type="button" class="demo-tab" hidden>Try the demo</button>']) assert.ok(home.includes(want), want);
  assert.deepStrictEqual(home.match(/<[^>]*\shidden[\s>]/g), ['<button type="button" class="demo-tab" hidden>'], 'only the tab waits for the script');
  assert.ok(!/<iframe/.test(home), 'the panel loads only when asked for');
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
    for (const text of [...c.messages.map((m) => m.text), ...Object.values(c.touch?.texts || {})]) { // (touch versions too)
      const tags = [...renderMarkdown(text).matchAll(/<\/?([a-z0-9]+)/g)].map((x) => x[1]);
      for (const t of tags) assert.ok(MARKDOWN_ELEMENTS.includes(t), `${c.id}: <${t}>`);
    }
  }
  for (const [name, code] of Object.entries(FILES)) assert.ok(!/\beval\(|new Function|innerHTML|document\.write/.test(code), `${name}: no eval or raw HTML`);
});

test('the demo runs its own mods (site/demo/mods/, which TRIF doesn\'t ship), lists them in its order, and wraps each as TRIF does', async () => {
  const { MODS, ORDER } = await import('../site/src/demo-files.js');
  const { modScript } = await import('../site/src/demo.js');
  const { DEMO_ORDER } = await import('../site/build-demo.js');
  const { PREINSTALLED, DEFAULT_ORDER } = require('../helper/lib/preinstalled');
  const dir = path.join(REPO_DIR, 'site', 'demo', 'mods');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
  assert.deepStrictEqual(MODS.map((m) => m.slug), [...files].sort(), 'every mod in site/demo/mods, nothing else');
  for (const m of MODS) assert.strictEqual(m.code, fs.readFileSync(path.join(dir, `${m.slug}.js`), 'utf8'), `${m.slug}: the file as it is`);
  assert.deepStrictEqual(ORDER, DEMO_ORDER.map((slug) => `timsrobot.com/${slug}`));
  assert.deepStrictEqual(DEMO_ORDER, ['tagline', 'robot', 'neon', 'jelly', 'fireworks', 'stickers', 'checklist', 'terminal', 'led', 'gravity', 'tilt', 'shooter', 'rave']);
  // TRIF ships none of them: the home page is like any other website.
  assert.ok(!PREINSTALLED.some((p) => p.id.startsWith('timsrobot.com/')) && !DEFAULT_ORDER['timsrobot.com']);
  assert.ok(!fs.existsSync(path.join(REPO_DIR, 'examples', 'sites', 'timsrobot.com')));
  // Each mod's script is wrapped as TRIF wraps a mod (a function), and runs whatever the page says.
  const code = modScript('neon.js'); // (document-start: as it is; a document-idle one waits for DOMContentLoaded, as with TRIF)
  assert.ok(code.startsWith('(() => {\n'), code.slice(0, 60));
  assert.ok(code.includes(MODS.find((m) => m.slug === 'neon').code));
  assert.ok(!code.includes('data-trif'));
  const idle = modScript('fireworks.js');
  assert.ok(idle.includes(MODS.find((m) => m.slug === 'fireworks').code) && idle.includes("addEventListener('DOMContentLoaded', run, { once: true })"));
  // The demo's tab never looks for the real TRIF (nothing marks a page for it to find).
  const { FILES } = await import('../site/src/demo-files.js');
  assert.ok(!/data-trif|realTrif|standAside/.test(FILES['tab.js']));
  // The recorded chats switch on mods the bundle has.
  const { CHATS } = await import('../site/src/demo-files.js');
  for (const c of CHATS) for (const s of c.mods) assert.ok(MODS.some((m) => m.slug === s), `${c.id}: ${s}`);
});

const signup = (body, headers = {}) => new Request('https://timsrobot.com/windows', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const formSignup = (fields, headers = {}) => signup(new URLSearchParams(fields).toString(), { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://timsrobot.com', ...headers });

test('parseSignup / signupEmail: one checked address, emailed with a findable subject', async () => {
  const [, { parseSignup, signupEmail, ReportError, LIMITS }] = await load();
  assert.deepStrictEqual(parseSignup({ email: '  a@b.co ' }), { email: 'a@b.co' });
  assert.throws(() => parseSignup({ email: '' }), /enter your email/);
  assert.throws(() => parseSignup({ email: 'nope' }), /doesn't look right/);
  assert.throws(() => parseSignup({ email: 'a@b.co\r\nBcc: x@y.z' }), /doesn't look right/);
  assert.throws(() => parseSignup({ email: `${'x'.repeat(LIMITS.email)}@b.co` }), /too long/);
  assert.throws(() => parseSignup([]), ReportError);
  assert.deepStrictEqual(parseSignup({ email: 'a@b.co', website: 'http://spam' }), { spam: true });
  const m = signupEmail({ email: 'a@b.co' }, { at: '2026-11-03T00:00:00Z' });
  assert.equal(m.subject, 'TRIF Windows waitlist: a@b.co');
  assert.equal(m.replyTo, 'a@b.co');
  assert.equal(m.text, 'a@b.co joined the Windows waitlist.\n\nSigned up: 2026-11-03T00:00:00Z\n', 'just the address and the time');
});

test('/windows: the waitlist page, with strict headers and its own script', async () => {
  const [{ default: worker }] = await load();
  const e = env();
  const res = await worker.fetch(new Request('https://timsrobot.com/windows'), e);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /text\/html/);
  assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'; script-src 'self'.*form-action 'self'/);
  assert.equal(res.headers.get('Referrer-Policy'), 'same-origin', "so the form's post carries this site's Origin, not null");
  const page = await res.text();
  assert.match(page, /<form id="form" class="card" method="post" action="\/windows">/, 'works without the script');
  assert.match(page, /<input id="email" name="email" type="email"[^>]* required/);
  assert.match(page, /<input id="website" name="website"/, 'the bot trap');
  assert.match(page, />Join the waitlist</);
  assert.match(page, /used only to tell you when TRIF is ready for Windows/);
  assert.ok(!/<script>/.test(page) && !/ on[a-z]+=/.test(page), 'no inline script');
  assert.match(page, /<script src="\/windows.js"><\/script>/);
  const js = await worker.fetch(new Request('https://timsrobot.com/windows.js'), e);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('Content-Type'), /text\/javascript/);
  assert.match(await js.text(), /fetch\('\/windows'/);
});

test('/windows: a signup is emailed to the maintainer, replies go to the address', async () => {
  const [{ default: worker }] = await load();
  const e = env();
  let res = await worker.fetch(signup({ email: 'win@example.com', website: '' }, { Origin: 'https://timsrobot.com' }), e);
  assert.deepStrictEqual([res.status, await res.json()], [200, { ok: true }]);
  assert.equal(e.sent.length, 1);
  const m = e.sent[0];
  assert.deepStrictEqual([m.to, m.from, m.replyTo, m.subject], ['maintainer@example.com', { email: 'reports@timsrobot.com', name: 'TRIF waitlist' }, 'win@example.com', 'TRIF Windows waitlist: win@example.com']);
  assert.match(m.text, /win@example\.com joined the Windows waitlist\.\n\nSigned up: \d{4}-\d\d-\d\dT/);

  // Without the script: a plain form post, answered with a thanks page.
  res = await worker.fetch(formSignup({ email: 'nojs@example.com', website: '' }), e);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /text\/html/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const thanks = await res.text();
  assert.match(thanks, /Thanks, you're on the list\./);
  assert.ok(!/<form/.test(thanks) && !/<script/.test(thanks));
  assert.equal(e.sent.length, 2);
  assert.equal(e.sent[1].replyTo, 'nojs@example.com');

  // A plain form post with a bad address gets the form back, saying why, with what was typed (escaped).
  res = await worker.fetch(formSignup({ email: 'no"pe<b>' }), e);
  assert.equal(res.status, 400);
  const again = await res.text();
  assert.match(again, /<p id="status" class="note error" role="status">That email address doesn&#39;t look right\.<\/p>/);
  assert.match(again, /value="no&#34;pe&#60;b&#62;"/);
  assert.equal(e.sent.length, 2);
});

test('/windows: bad signups, bots, other sites and the wrong method are refused', async () => {
  const [{ default: worker }] = await load();
  const e = env();
  const status = async (req) => (await worker.fetch(req, e)).status;
  assert.equal(await status(signup({ email: 'not an address' })), 400);
  assert.equal(await status(signup({ email: '' })), 400);
  assert.equal(await status(signup({ email: `${'x'.repeat(300)}@b.co` })), 400);
  assert.equal(await status(signup('{not json')), 400);
  assert.equal(await status(signup({ email: 'a@b.co', pad: 'x'.repeat(5000) })), 413);
  assert.equal(await status(signup({ email: 'a@b.co' }, { 'Content-Length': String(1024 * 1024) })), 413);
  assert.equal(await status(signup({ email: 'a@b.co' }, { 'Content-Type': 'text/plain' })), 415);
  assert.equal(await status(signup({ email: 'a@b.co' }, { Origin: 'https://evil.example' })), 403);
  assert.equal(await status(formSignup({ email: 'a@b.co' }, { Origin: 'null' })), 403, 'a sandboxed page elsewhere');
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    assert.equal(await status(new Request('https://timsrobot.com/windows', { method, body: '{}' })), 405, method);
  }
  // Bots that fill in the hidden field are thanked and not emailed.
  let res = await worker.fetch(signup({ email: 'bot@example.com', website: 'http://spam' }), e);
  assert.deepStrictEqual([res.status, await res.json()], [200, { ok: true }]);
  res = await worker.fetch(formSignup({ email: 'bot@example.com', website: 'http://spam' }), e);
  assert.match(await res.text(), /Thanks, you're on the list\./);
  assert.equal(e.sent.length, 0);
  assert.equal((await worker.fetch(signup({ email: 'a@b.co' }), env({ REPORT_TO: '' }))).status, 503);
});

test('/windows: the reports rate limit applies, counted apart from reports', async () => {
  const [{ default: worker }] = await load();
  const keys = [];
  let allow = true;
  const limited = env({ REPORT_LIMIT: { async limit({ key }) { keys.push(key); return { success: allow }; } } });
  assert.equal((await worker.fetch(signup({ email: 'one@example.com' }), limited)).status, 200);
  allow = false;
  let res = await worker.fetch(signup({ email: 'two@example.com' }), limited);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Too many signups/);
  res = await worker.fetch(formSignup({ email: 'three@example.com' }), limited);
  assert.equal(res.status, 429);
  assert.match(await res.text(), /Too many signups from here just now/);
  assert.deepStrictEqual(keys, ['windows:203.0.113.9', 'windows:203.0.113.9', 'windows:203.0.113.9']);
  assert.equal(limited.sent.length, 1);
});
