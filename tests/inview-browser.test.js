'use strict';
// "What you're looking at now" (extension/inview.js) in a real browser. First the in-page walk alone, on a feed
// scrolled to one post: the outline has that post with a selector that finds it alone, nothing off screen, the
// selection with its element's selector, and how long the walk takes on a big page. Then TRIF itself (a copy of
// the extension, the real helper over native messaging in a temp workspace, never ~/.trif): the note as Send takes
// it, its picture saved in the site's screenshots folder; no picture without activeTab (the toolbar click), the
// outline anyway; a sensitive stand-in (claude.ai) read only once "Agent on this site" allows it, and never
// pictured; the phone view's tab in the phone view's chat; and the note in what a run started from Send, and a
// message that waited, are given (the run's log). Headless Chrome for Testing (tests/cdp-page.js: one browser at a
// time, the memory guard, muted), with TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { browserTestsSkip, launch } = require('./cdp-page');
const { extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function feedPage(n = 200) {
  const items = [];
  for (let i = 1; i <= n; i++) {
    items.push(`<div class="cell"><article data-testid="post"><div class="byline"><span class="author">Author ${i}</span> <span>@handle${i}</span></div>` +
      `<div data-testid="postText">Post number ${i} says something about topic ${i}.</div>` +
      `<div role="group"><button data-testid="like" aria-label="Like">${i % 7}</button> <button data-testid="reply">Reply</button></div></article></div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test feed</title><style>
    body { margin: 0; font: 16px sans-serif; } header { position: sticky; top: 0; height: 48px; background: #eee; z-index: 2; }
    article { height: 140px; border-bottom: 1px solid #ccc; padding: 8px; box-sizing: border-box; }
    </style></head><body><header id="top"><nav aria-label="Primary"><a href="/home">Home</a> <a href="/explore">Explore</a></nav></header>
    <main><h1>Feed</h1><div role="feed" aria-label="Timeline">${items.join('')}</div></main></body></html>`;
}

// An X-like page for the timing: deep anonymous divs with generated classes, 120 posts of about 90 elements each.
function bigPage() {
  const cls = () => `css-${Math.random().toString(36).slice(2, 9)} r-${Math.random().toString(36).slice(2, 8)}`;
  const deep = (inner, n) => (n ? `<div class="${cls()}">${deep(inner, n - 1)}</div>` : inner);
  const cells = [];
  for (let i = 1; i <= 120; i++) {
    let body = '';
    for (let k = 0; k < 6; k++) body += deep(`<span class="${cls()}">Line ${k} of post ${i}, with words</span>`, 8);
    cells.push(`<div data-testid="cellInnerDiv" style="height:420px">${deep(`<article data-testid="tweet" role="article"><div data-testid="User-Name">${deep(`<span>Name ${i}</span>`, 6)}</div>` +
      `<div data-testid="tweetText">${deep(`<span>Tweet ${i} text goes here</span>`, 4)}</div>${body}<div role="group">${['reply', 'retweet', 'like', 'bookmark'].map((t) => `<button data-testid="${t}" aria-label="${t}">${deep('<span>1</span>', 3)}</button>`).join('')}</div></article>`, 10)}</div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Big</title></head><body><div id="react-root">${deep(`<main role="main"><div aria-label="Timeline: Your Home Timeline">${cells.join('')}</div></main>`, 12)}</div></body></html>`;
}

function serve() {
  const big = bigPage();
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url.startsWith('/big') ? big : feedPage());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: (p) => `http://127.0.0.1:${server.address().port}${p}` })));
}

// The walk as chrome.scripting runs it: from its source text.
const walkIn = async (page, opts = {}) => {
  const { inViewPage } = await import('../extension/inview.js');
  return page.evaluate(`(${inViewPage.toString()})(${JSON.stringify(opts)})`);
};
// Where each of the entries' selectors leads: [{n (matches), top, bottom, same (the first match is the entry's)}]
const resolveAll = (page, entries) => page.evaluate((list) => list.map((e) => {
  const all = document.querySelectorAll(e.sel);
  const r = all[0] ? all[0].getBoundingClientRect() : null;
  return { n: all.length, top: r && Math.round(r.top), bottom: r && Math.round(r.bottom) };
}), entries);

const SCROLL_AND_SELECT = `(() => {
  const posts = document.querySelectorAll('article');
  scrollTo(0, posts[119].getBoundingClientRect().top + scrollY - 60);
  const text = posts[120].querySelector('[data-testid=postText]').firstChild;
  const r = document.createRange();
  r.setStart(text, text.data.indexOf('says')); r.setEnd(text, text.data.indexOf(' 121.') + 4);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  return [scrollY, String(getSelection())];
})()`;

test('the in-view outline: the post scrolled to, with a selector that finds it alone; nothing off screen; the selection', { skip, timeout: 300000 }, async () => {
  const pages = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pages.url('/feed'));
    const [sy, selected] = await page.evaluate(SCROLL_AND_SELECT);
    assert.ok(sy > 15000);
    assert.equal(selected, 'says something about topic 121');
    const r = await walkIn(page, { maxChars: 3500 });
    assert.ok(!r.error, r.error);
    assert.equal(r.sy, sy);
    assert.ok(r.vw > 600 && r.vh > 400, `${r.vw}x${r.vh}`);
    const texts = r.entries.map((e) => e.text);
    const post120 = r.entries.find((e) => e.word === 'article' && /^Author 120 /.test(e.text));
    assert.ok(post120, `post 120 in the outline: ${JSON.stringify(texts)}`);
    // every selector finds exactly one element, the one in view
    const at = await resolveAll(page, r.entries);
    at.forEach((x, i) => {
      assert.equal(x.n, 1, `${r.entries[i].sel} finds one element`);
      assert.ok(x.bottom > 0 && x.top < r.vh, `${r.entries[i].sel} is in view (${x.top}–${x.bottom})`);
      assert.equal(x.top, r.entries[i].top);
    });
    assert.equal(await page.evaluate((s) => document.querySelector(s) === document.querySelectorAll('article')[119], post120.sel), true, `${post120.sel} is post 120`);
    // nothing from far up or down the feed
    for (const far of ['Author 5 ', 'Author 60 ', 'Author 190 ', 'topic 100.', 'topic 140.']) assert.ok(!texts.some((t) => t.includes(far)), `no ${far}`);
    assert.ok(r.entries.some((e) => e.sel.includes('nav') || e.word === 'navigation'), 'the sticky header\'s nav is in view');
    assert.ok(!r.entries.some((e) => e.word === 'heading' && e.text === 'Feed'), 'the h1, scrolled past, isn\'t');
    // the selection: its text, and its element
    assert.equal(r.selection.text, 'says something about topic 121');
    assert.equal(await page.evaluate((s) => document.querySelector(s) === document.querySelectorAll('article')[120].querySelector('[data-testid=postText]'), r.selection.selector), true, r.selection.selector);
    assert.ok(r.entries.some((e) => e.selected && e.text.includes('topic 121')), 'its entry is marked');
    // the note's outline from it: under the cap, with post 120's line
    const { formatOutline } = await import('../extension/inview.js');
    const o = formatOutline(r.entries, { maxChars: 3500 });
    assert.ok(o.text.length <= 3500);
    assert.ok(o.text.includes(post120.sel));
    console.log(`feed: ${r.entries.length} entries, ${o.text.length} chars, walk ${r.ms} ms (${r.scanned} elements)`);

    // a big X-like page: the walk stays quick, and still names what's in view
    await page.goto(pages.url('/big'));
    await page.evaluate(() => { document.querySelectorAll('article')[60].scrollIntoView(); });
    const times = [];
    let big;
    for (let i = 0; i < 5; i++) { big = await walkIn(page, {}); times.push(big.ms); }
    const count = await page.evaluate(() => document.getElementsByTagName('*').length);
    console.log(`big page (${count} elements): walk ${times.join(', ')} ms; ${big.entries.length} entries, partial ${big.partial}`);
    assert.ok(count > 10000);
    assert.ok(Math.max(...times.slice(1)) < 250, `walk times ${times}`);
    const tweet = big.entries.find((e) => e.word === 'article' && /Name 61/.test(e.text));
    assert.ok(tweet, JSON.stringify(big.entries.map((e) => e.text).slice(0, 20)));
    assert.equal(await page.evaluate((s) => document.querySelector(s) === document.querySelectorAll('article')[60], tweet.sel), true, tweet.sel);
    assert.ok(tweet.sel.length < 200, tweet.sel);
  } finally {
    await browser.close();
    pages.server.close();
  }
});

test('Send\'s note in TRIF: the picture saved for the site\'s runs, none without activeTab, never on a sensitive site; the run gets it', { skip, timeout: 900000 }, async () => {
  const https = require('https');
  const { spawnSync } = require('child_process');
  const { tempDir, testEnv, HOST_JS, privDir } = require('./fake-extension');
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = tempDir('wm-inview-');
  const extra = tempDir('wm-inviewx-');
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  const pages = await serve();
  // (the sensitive stand-in: claude.ai, https, a certificate of its own)
  const key = path.join(extra, 'key.pem');
  const cert = path.join(extra, 'cert.pem');
  const made = spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=claude.ai', '-addext', 'subjectAltName=DNS:claude.ai'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const sens = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => { res.setHeader('content-type', 'text/html'); res.end(feedPage(40)); });
  await new Promise((r) => sens.listen(0, '127.0.0.1', r));
  const sensUrl = `https://claude.ai:${sens.address().port}/chat`;
  const env = testEnv(home);
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const ext = extensionCopy(['*://127.0.0.1/*', '*://claude.ai/*', '*://*.claude.ai/*']);
  const shots = path.join(privDir(home), 'screenshots');
  let browser = null;
  try {
    browser = await launch({
      extension: ext,
      args: ['--screen-info={0,0 1470x956}', '--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP claude.ai 127.0.0.1', '--ignore-certificate-errors'],
      prepare: (profile, id) => {
        fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
        fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.webmods.helper.json'), JSON.stringify({
          name: 'com.webmods.helper', description: 'TRIF helper (a test\'s)', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
        }));
      },
    });
    const h = await harness(browser);
    const st = await waitFor('the helper', async () => { const s = await h.ask({ type: 'status' }); return s.helper.connected && s; }, 30000);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const { tab } = await h.E(async (u) => {
      const w = await chrome.windows.create({ url: u, focused: true, left: 0, top: 25, width: 1280, height: 860 });
      await new Promise((r) => setTimeout(r, 1500));
      return { tab: w.tabs[0].id };
    }, pages.url('/feed'));
    // (on the screen: headless Chrome draws no window that's off it, and captureVisibleTab then never answers)
    await waitFor('the feed', () => h.page(tab, 'document.readyState === "complete" && document.visibilityState === "visible"'));
    assert.deepEqual(await h.page(tab, SCROLL_AND_SELECT).then((x) => x[1]), 'says something about topic 121');
    const capture = (tabId, site) => h.ask({ type: 'inview.capture', tabId, site });

    // 1. No activeTab yet (TRIF has this site's access only, and nobody clicked its button on the tab): no picture,
    // one line saying why, the rest anyway.
    const before = await capture(tab, '127.0.0.1');
    assert.equal(before.pictured, false, before.note);
    assert.match(before.note, /^No screenshot: Chrome lets TRIF picture a tab only after the user clicks TRIF's toolbar button on it/m);
    assert.match(before.note, /Selected: “says something about topic 121”/);
    assert.match(before.note, /Author 120 /);

    // 2. The toolbar button on that tab (as the user opens the panel): activeTab, and the picture.
    const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const tabTarget = targetInfos.find((t) => t.type === 'tab' && t.url === pages.url('/feed'));
    await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: tabTarget.targetId });
    await sleep(800);
    const times = [];
    let r;
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now();
      r = await capture(tab, '127.0.0.1');
      times.push({ total: Date.now() - t0, ...r.ms });
      await sleep(600); // (captureVisibleTab: two a second)
    }
    console.log(`Send's note, as taken (ms): ${JSON.stringify(times)}`);
    console.log(r.note);
    assert.equal(r.pictured, true, r.note);
    const file = /^Screenshot of exactly this viewport: (.+)$/m.exec(r.note)[1];
    assert.equal(path.dirname(file), path.join(shots, '127.0.0.1'), 'in the site\'s screenshots folder, the runs\' own');
    const img = fs.readFileSync(file);
    assert.deepEqual([...img.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
    assert.match(r.note, /^Page: http:\/\/127\.0\.0\.1:\d+\/feed \(“Test feed”\), tab \d+$/m);
    assert.match(r.note, /^Viewport: \d+×\d+ CSS px, scrolled to y \d+ of \d+/m);
    assert.ok(r.note.length < 5000, `${r.note.length} characters`);
    assert.ok(Math.max(...times.slice(1).map((t) => t.total)) < 300, `under 300 ms: ${JSON.stringify(times)}`);

    // 3. The run Send starts gets it after the message (the run's log has what the helper was given), the chat
    // keeps the message as typed, marked; a message that waited gets its own.
    const runPrompt = async (runId) => {
      const log = path.join(privDir(home), 'runs', `${runId}.jsonl`);
      const first = await waitFor('the run\'s log', async () => fs.existsSync(log) && fs.readFileSync(log, 'utf8').split('\n')[0]);
      return JSON.parse(first).prompt;
    };
    const t0 = Date.now();
    const { runId } = await h.ask({ type: 'agent.start', site: '127.0.0.1', tabId: tab, url: pages.url('/feed'), prompt: 'look, I\'ve scrolled to it', agent: 'claude', withView: true });
    console.log(`agent.start with the note: ${Date.now() - t0} ms to the run id`);
    const prompt = await runPrompt(runId);
    assert.match(prompt, /^look, I've scrolled to it\n\n--- In view when I sent this ---\n/);
    assert.match(prompt, /Selected: “says something about topic 121”/);
    const chat = async () => (await h.E(() => chrome.storage.local.get('chat:127.0.0.1')))['chat:127.0.0.1'];
    const said = await waitFor('the message in the chat', async () => (await chat())?.messages?.find((m) => m.role === 'user' && m.text === 'look, I\'ve scrolled to it'));
    assert.equal(said.inView, 'shot', 'marked: the panel shows "with what\'s in view"');
    await waitFor('the run to end (no agent here)', async () => !(await chat())?.run, 30000);
    await h.page(tab, 'scrollTo(0, 0), getSelection().removeAllRanges(), 0');
    const q = await h.ask({ type: 'chat.queue', site: '127.0.0.1', tabId: tab, url: pages.url('/feed'), text: 'and this, at the top', agent: 'claude', withView: true });
    assert.equal(q.sent, true);
    const runs = path.join(privDir(home), 'runs');
    const second = await waitFor('the second run', async () => fs.readdirSync(runs).filter((f) => f.endsWith('.jsonl')).map((f) => JSON.parse(fs.readFileSync(path.join(runs, f), 'utf8').split('\n')[0])).find((x) => x.prompt && x.prompt.startsWith('and this, at the top')));
    assert.match(second.prompt, /scrolled to y 0 of/);
    assert.match(second.prompt, /Author 1 /);
    assert.doesNotMatch(second.prompt, /Selected:/);

    // 4. A sensitive stand-in (claude.ai): Off by default, so nothing at all; at Look, the outline and never a picture.
    if (st.blockedSites.includes('claude.ai')) await h.ask({ type: 'site.block', site: 'claude.ai', blocked: false });
    await h.ask({ type: 'site.set', site: 'claude.ai', on: true });
    const stab = await h.E(async (u) => { const w = await chrome.windows.create({ url: u, focused: true, left: 0, top: 25, width: 1200, height: 860 }); await new Promise((res) => setTimeout(res, 1500)); return w.tabs[0].id; }, sensUrl);
    await waitFor('the stand-in', () => h.page(stab, 'document.readyState === "complete"'));
    const sInfos = (await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: sInfos.find((t) => t.url === sensUrl).targetId });
    await sleep(800);
    assert.equal(await capture(stab, 'claude.ai'), null, 'Off: nothing of the page');
    await h.ask({ type: 'agentSite.set', site: 'claude.ai', level: 'look' });
    const s = await capture(stab, 'claude.ai');
    assert.equal(s.pictured, false);
    assert.match(s.note, /^No screenshot: this site is on TRIF's sensitive list, and TRIF never pictures those\.$/m);
    assert.match(s.note, /Author 1 /);
    assert.ok(!fs.existsSync(path.join(shots, 'claude.ai')) || !fs.readdirSync(path.join(shots, 'claude.ai')).length, 'no picture saved for it');

    // 5. The phone view: the note is its tab's, in its chat.
    const opened = await h.openPhone(tab, { left: 0, top: 25, width: 1470, height: 931 });
    await sleep(1500);
    const p = await capture(tab, 'phone~127.0.0.1');
    assert.match(p.note, /, in the phone view \(iPhone[^)]*\)/, p.note);
    assert.match(p.note, /^Viewport: ([34]\d\d)×/m, 'a phone\'s width (the window can keep a little over 390)');
    if (p.pictured) assert.equal(path.basename(path.dirname(/^Screenshot of exactly this viewport: (.+)$/m.exec(p.note)[1])), 'phone_127.0.0.1');
    assert.ok(Number.isInteger(opened.window));
  } finally {
    if (browser) await browser.close();
    pages.server.close();
    sens.close();
    let pid = 0;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* never started */ }
    if (pid) { await sleep(1500); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(privDir(home), { recursive: true, force: true });
  }
});
