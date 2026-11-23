'use strict';
// The load power in a real browser: TRIF's own extension (with access to example.com and feed.test only), the real
// helper (helper/host.js over native messaging, in a temp workspace: never the user's), a stand-in page with a
// strict Content Security Policy (connect-src 'self', as x.com's blocks other servers) and a stand-in feed server
// on another site. A free mod's fetch to the feed is blocked by the page's CSP; the boxed mod (BOXED.md's example,
// with the feed's address) loads it through TRIF once allowed, pages on with the cursor the feed sent, and every
// trick to put the page's text into an address is refused before anything reaches the feed. The feed sees no
// cookie (one is set for it), no referrer, only GETs, and never the page's text. Headless Chrome for Testing
// (tests/cdp-page.js: muted, one browser at a time, the memory guard), with TRIF_BROWSER_TESTS=1 or in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { browserTestsSkip, launch } = require('./cdp-page');
const { extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'hunter2-draft';

test('the load power: the page\'s CSP blocks a free mod\'s fetch; a boxed mod\'s trif.load works once allowed, and nothing of the page reaches the feed', { skip, timeout: 300000 }, async () => {
  const { tempDir, testEnv, HOST_JS, CLI_JS, writeMod } = require('./fake-extension');
  const { execFile } = require('child_process');
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = tempDir('wm-load-');
  const extra = tempDir('wm-loadx-');
  // the feed: two pages joined by a cursor, a redirect to another site, a cookie of its own; every request kept
  const seen = [];
  const feed = http.createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, cookie: req.headers.cookie || null, referer: req.headers.referer || null, origin: req.headers.origin || null });
    const u = new URL(req.url, 'http://feed.test');
    if (u.pathname === '/setcookie') { res.writeHead(200, { 'Set-Cookie': 'sid=feed-session; Path=/', 'Content-Type': 'text/html' }); return res.end('<p>cookie set</p>'); }
    if (u.pathname === '/api/redirect') { res.writeHead(302, { Location: `http://example.com:${pagePort}/stolen` }); return res.end(); }
    if (u.pathname !== '/api/feed') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no'); }
    const second = u.searchParams.get('cursor') === 'c-2';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(second ? { posts: [{ author: 'bea', text: 'second page post' }], next_cursor: null } : { posts: [{ author: 'ann', text: 'first page post' }], next_cursor: 'c-2' }));
  });
  await new Promise((r) => feed.listen(0, '127.0.0.1', r));
  const feedPort = feed.address().port;
  const FEED = `http://feed.test:${feedPort}`;
  // the page: a strict CSP, as x.com's (scripts only its own, connections only to itself)
  const pageHits = [];
  const page = http.createServer((req, res) => {
    pageHits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Strict page</title></head><body><main data-testid="primaryColumn"><p id="secret">${SECRET}</p></main></body></html>`);
  });
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  const pagePort = page.address().port;
  const url = `http://example.com:${pagePort}/`;

  // the mods, in the test's workspace: a free mod that fetches the feed, and BOXED.md's example with the feed's address
  writeMod(home, 'example.com', 'free-fetch.js', `// ==WebMod==
// @name        Free fetch
// @match       *://example.com/*
// @run-at      document-end
// ==/WebMod==
const out = document.createElement('p');
out.id = 'free-result';
document.body.append(out);
fetch('${FEED}/api/feed').then((r) => { out.textContent = 'loaded ' + r.status; }, (e) => { out.textContent = 'blocked: ' + e.name; });
`);
  const guide = fs.readFileSync(path.join(__dirname, '..', 'helper', 'workspace', 'BOXED.md'), 'utf8');
  const example = /\*\*A feed from another service, with `load`\*\*[\s\S]*?```js\n([\s\S]*?)```/.exec(guide)[1];
  assert.match(example, /https:\/\/tweetstack\.app\/api\/feed/);
  const archive = example.split('https://tweetstack.app').join(FEED)
    .replace(/(\/\/ @powers\s+load .*)\n/, `$1 ${FEED}/api/redirect http://nope.test:${feedPort}/api/feed\n`)
    .replace('// @match       https://x.com/*', '// @match       *://example.com/*')
  // (and the tricks, after the example's first page: each one's error, into an element the test reads)
    + `
await trif.ready;
const secret = page.find('#secret').text;
const tries = [
  ['page text as the cursor', \`${FEED}/api/feed?cursor=\${encodeURIComponent(secret)}\`],
  ['page text in another parameter', \`${FEED}/api/feed?limit=20&q=\${encodeURIComponent(secret)}\`],
  ['page text in the path', \`${FEED}/api/\${encodeURIComponent(secret)}\`],
  ['another path', '${FEED}/admin'],
  ['another site', 'http://evil.test:${feedPort}/api/feed'],
  ['a fragment', \`${FEED}/api/feed#\${secret}\`],
  ['a word not in the list', '${FEED}/api/feed?limit=21'],
  ['a redirect to another site', '${FEED}/api/redirect'],
  ['a site the browser gave no access', 'http://nope.test:${feedPort}/api/feed'],
];
const results = {};
for (const [what, u] of tries) { try { await trif.load(u); results[what] = 'LOADED'; } catch (e) { results[what] = e.message; } }
for (const [what, o] of [['a POST', { method: 'POST' }], ['headers', { headers: { Cookie: 'x=1' } }], ['a body', { body: secret }]]) {
  try { await trif.load('${FEED}/api/feed', o); results[what] = 'LOADED'; } catch (e) { results[what] = e.message; }
}
const pre = page.create('pre');
pre.setAttr('id', 'trif-box-results');
pre.setText(JSON.stringify(results));
page.body.append(pre);
`;
  writeMod(home, 'example.com', 'archive.js', archive);
  const env = testEnv(home);
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const ext = extensionCopy(['*://example.com/*', '*://*.example.com/*', '*://feed.test/*', '*://*.feed.test/*']);
  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [CLI_JS, ...args], { env, timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? -1 : 0, stdout, stderr })));
  let browser = null;
  try {
    browser = await launch({
      extension: ext,
      args: ['--host-resolver-rules=MAP example.com 127.0.0.1, MAP *.example.com 127.0.0.1, MAP feed.test 127.0.0.1, MAP nope.test 127.0.0.1, MAP evil.test 127.0.0.1'],
      prepare: (profile, id) => {
        fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
        fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.webmods.helper.json'), JSON.stringify({
          name: 'com.webmods.helper', description: 'TRIF helper (a test\'s)', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
        }));
      },
    });
    const h = await harness(browser);
    await h.allowUserScripts();
    const status = () => h.ask({ type: 'status' });
    await waitFor('the helper', async () => { const s = await status(); return s.helper.connected && s; }, 30000);
    await h.ask({ type: 'site.set', site: 'example.com', on: true });
    // a cookie of the feed's own, in this browser (a tab of the feed's, as the user would have)
    const feedTab = await h.E((u) => chrome.tabs.create({ url: u, active: false }).then((t) => t.id), `${FEED}/setcookie`);
    await waitFor('the feed\'s cookie', () => h.E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete'), feedTab));
    await h.E((id) => chrome.tabs.remove(id), feedTab);
    // both held: the boxed mod for its power (its line names the feed), the free one for what it sends
    const held = await waitFor('the boxed mod held', async () => { const s = await status(); const a = s.mods.find((m) => m.id === 'example.com/archive'); const f = s.mods.find((m) => m.id === 'example.com/free-fetch'); return a && a.held && f && { a, f }; }, 30000);
    assert.ok(held.a.held.facts.some((f) => /^can load data from feed\.test \(\/api\/feed, \/api\/redirect\), nope\.test \(\/api\/feed\), without your cookies, and can't put what's on this page into those addresses$/.test(f)), JSON.stringify(held.a.held.facts));
    assert.deepEqual(held.a.loadSites, ['feed.test', 'nope.test']);
    assert.deepEqual(held.a.loadMissing, ['nope.test'], 'the row would ask for nope.test');
    for (const m of [held.a, held.f]) if (m.held) { const r = await cli(['approve', m.id]); assert.equal(r.code, 0, r.stderr + r.stdout); }
    for (const id of ['example.com/archive', 'example.com/free-fetch']) {
      const m = await waitFor(`${id} allowed`, async () => (await status()).mods.find((x) => x.id === id && !x.held), 30000);
      if (!m.enabled) await h.ask({ type: 'mod.enable', id, enabled: true });
    }
    await waitFor('both running', async () => { const s = await status(); return ['example.com/archive', 'example.com/free-fetch'].every((id) => { const m = s.mods.find((x) => x.id === id); return m && !m.held && m.enabled && m.registered; }); }, 30000)
      .catch(async (e) => { console.error(JSON.stringify((await status()).mods.map((m) => [m.id, !!m.held, m.enabled, m.registered, m.error]))); throw e; });

    const tabId = await h.E((u) => chrome.tabs.create({ url: u, active: true }).then((t) => t.id), url);
    await waitFor('the page', () => h.page(tabId, 'document.readyState === "complete"'));
    // the free mod: the page's CSP blocks its fetch, which never reaches the feed
    const free = await waitFor('the free mod\'s fetch', () => h.page(tabId, '(document.getElementById("free-result") || {}).textContent || null'), 20000);
    assert.equal(free, 'blocked: TypeError');
    // the boxed mod: the feed's first page, through TRIF
    await waitFor('the first page of the feed', () => h.page(tabId, 'document.getElementById("trif-box-archive")?.textContent.includes("ann: first page post") || null'), 20000);
    const results = JSON.parse(await waitFor('the tricks', () => h.page(tabId, 'document.getElementById("trif-box-results")?.textContent || null'), 30000));
    const want = {
      'page text as the cursor': /isn't what feed\.test last sent back as next_cursor/,
      'page text in another parameter': /"q" isn't a parameter/,
      'page text in the path': /isn't one of the addresses this mod's header lists/,
      'another path': /isn't one of the addresses this mod's header lists/,
      'another site': /isn't one of the addresses this mod's header lists/,
      'a fragment': /has a #/,
      'a word not in the list': /isn't one of the header's words \(20, 50\)/,
      'a redirect to another site': /feed\.test sent it on to another site \(http:\/\/example\.com:\d+\)/,
      'a site the browser gave no access': /TRIF doesn't have your browser's access to nope\.test yet/,
      'a POST': /trif\.load takes only \{ as \}/, headers: /trif\.load takes only \{ as \}/, 'a body': /trif\.load takes only \{ as \}/,
    };
    for (const [what, re] of Object.entries(want)) assert.match(String(results[what]), re, `${what}: ${results[what]}`);
    // More: the second page, by the cursor the feed sent; then no more
    await h.click(tabId, '#trif-box-archive button');
    await waitFor('the second page', () => h.page(tabId, 'document.getElementById("trif-box-archive")?.textContent.includes("bea: second page post") || null'), 20000);
    // what the feed saw: only GETs, no cookie (it has one in this browser), no referrer, nothing of the page's
    await sleep(500);
    const api = seen.filter((r) => r.url.startsWith('/api/') || r.url.startsWith('/admin')); // (not the cookie tab's own, nor its favicon)
    assert.ok(seen.some((r) => r.url === '/setcookie'), 'the cookie was set');
    assert.ok(api.some((r) => r.url === '/api/feed?limit=20') && api.some((r) => r.url === '/api/feed?cursor=c-2&limit=20'), JSON.stringify(api));
    for (const r of api) {
      assert.equal(r.method, 'GET', r.url);
      assert.equal(r.cookie, null, `no cookie with ${r.url}`);
      assert.equal(r.referer, null, `no referrer with ${r.url}`);
      assert.ok(!r.url.includes(SECRET) && !r.url.includes('hunter2'), `nothing of the page in ${r.url}`);
      assert.notEqual(r.origin, `http://example.com:${pagePort}`, 'nothing from the page itself (the free mod\'s fetch was blocked)');
    }
    assert.ok(!api.some((r) => r.url.startsWith('/admin')), 'refused ones never reached it');
    assert.ok(!pageHits.some((u) => u.includes(SECRET)), 'nor the page\'s own server');
    // (trif errors: the mod's refusals, as the panel's badge would show them)
    const errs = await cli(['errors', 'example.com/archive']);
    assert.equal(errs.code, 0, errs.stderr);
  } finally {
    if (browser) await browser.close();
    feed.close();
    page.close();
    let pid = 0;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* never started */ }
    if (pid) { await sleep(1500); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
