'use strict';
// The sandbox's runtime under real SES in a real browser: tests/sandbox-harness.js stands in for SES and the
// DOM, so it can't say whether the runtime still starts once the language is locked down, or whether a
// stand-in still works on a real element. This loads vendor/ses.umd.min.js and the runtime into a page (the
// page's own world, not TRIF's user script world: the same code, without the world's wall around it) and runs
// a few mods. Needs a Chromium that Playwright can start (skipped without one). The escapes are the e2e's
// (tests/e2e/fixtures/sandbox-hostile.js); this is "does it run, and are the review's fixes there".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* none here: skipped */ }

const PAGE = `<!doctype html><html><head><title>t</title></head><body>
<button id="more" type="button">Show more replies</button>
<button id="del" type="button">Delete</button>
<input id="draft" type="text" value="">
<p id="out"></p>
<script>window.clicks = { more: 0, del: 0 }; for (const id of ['more', 'del']) document.getElementById(id).addEventListener('click', () => { window.clicks[id]++; });</script>
</body></html>`;

test('the sandbox runtime under real SES, in Chromium: mods run, stand-ins are their mod\'s, CSS and clicks are checked', { skip: chromium ? false : 'no Playwright Chromium here' }, async () => {
  const sb = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);
  const ses = fs.readFileSync(path.join(__dirname, '..', 'extension', sb.SES_FILE), 'utf8');
  const hits = [];
  const server = http.createServer((req, res) => { if (req.url.startsWith('/canary')) hits.push(req.url); res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : 'text/plain' }); res.end(req.url === '/' ? PAGE : ''); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(`${base}/`);
    await page.addScriptTag({ content: ses });
    await page.addScriptTag({ content: sb.sandboxRuntimeCode() });
    const run = (id, source, powers) => page.addScriptTag({ content: sb.sandboxModCode(id, source, powers) });
    const logsOf = (id) => page.evaluate((m) => globalThis.__trifSandbox.logs.filter((l) => l.mod === m).map((l) => l.args.join(' ')), id);
    const errorsOf = (id) => page.evaluate((m) => globalThis.__trifSandbox.errors.filter((e) => e.mod === m).map((e) => e.message), id);

    // a plain mod: the basics, at the top and after an await
    await run('x.com/plain', `
      const out = page.find('#out');
      out.setText('hello');
      const el = page.create('div'); el.setAttr('id', 'trif-box-made'); page.body.append(el);
      trif.css('#out { color: rgb(1, 2, 3) }');
      await null;
      trif.log(out.text, String(page.find('#out') === out), page.find('#trif-box-made').tag, out.style('color'));
      const tries = [];
      const t = (fn) => { try { fn(); tries.push('ok'); } catch (e) { tries.push(String(e.message)); } };
      t(() => page.find('#more').click());
      t(() => page.find('#draft').setValue('x'));
      t(() => trif.css('a { --x: "\\n} html { background: image-set("${base}/canary?1" 1x) } b { --y: " }'));
      t(() => trif.css('a { background: url(data:,/*) } html { background: url(${base}/canary?2) } b { c: url(data:,*/) }'));
      t(() => out.style('background-image', 'url(${base}/canary?3)'));
      trif.log(JSON.stringify(tries));`, []);
    await page.waitForTimeout(300);
    const plain = await logsOf('x.com/plain');
    assert.equal(plain[0], 'hello true div rgb(1, 2, 3)', `${JSON.stringify(plain)} ${JSON.stringify(await errorsOf('x.com/plain'))} ${pageErrors.join('; ')}`);
    const tries = JSON.parse(plain[1]);
    assert.match(tries[0], /needs the click power/);
    assert.match(tries[1], /needs the write-drafts power/);
    for (const i of [2, 3, 4]) assert.match(tries[i], /loads from an address/, `css ${i}`);

    // a mod with click, by what the thing says; the plain mod above still has none
    await run('x.com/clicker', `
      await trif.ready;
      const tries = [];
      const t = (fn) => { try { fn(); tries.push('ok'); } catch (e) { tries.push(String(e.message)); } };
      t(() => page.find('#more').click());
      t(() => page.find('#del').click());
      page.find('#del').setText('Show more');
      t(() => page.find('#del').click());
      trif.log(JSON.stringify(tries));`, { powers: ['click'], args: { click: ['"Show more": button'] } });
    await page.waitForTimeout(300);
    const c = JSON.parse((await logsOf('x.com/clicker'))[0]);
    assert.equal(c[0], 'ok');
    assert.match(c[1], /click what says "Show more", and this says "delete"/);
    assert.match(c[2], /a boxed mod changed what this says/);
    assert.deepEqual(await page.evaluate(() => window.clicks), { more: 1, del: 0 });

    // a mod whose id has a line break in it: named plainly, and nothing of the name runs
    await run('x.com/odd globalThis.__ran = 1;({})', 'trif.log("ran as a mod");', []);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => globalThis.__ran), undefined);
    assert.deepEqual(await logsOf('x.com/odd globalThis.__ran = 1;({})'), ['ran as a mod']);

    // a one-off run (trif run in the box): plain data back, the page's fields readable, nothing it can act with
    const ev = async (id, code, expression = true) => JSON.parse(await page.evaluate(([i, c, e, g]) => globalThis.__trifSandbox.evaluate(i, c, e, g), [id, code, expression, { powers: sb.BOX_RUN_POWERS, args: {} }]));
    await page.fill('#draft', 'typed by the user');
    let env = await ev('r1', 'page.findAll("button").map((b) => b.text.trim())');
    assert.deepEqual(JSON.parse(env.json), ['Show more replies', 'Show more']);
    env = await ev('r2', 'const d = page.find("#draft"); await null; return { typed: d.value, el: d, title: page.title }', false);
    assert.deepEqual(JSON.parse(env.json), { typed: 'typed by the user', el: '<input#draft>', title: 't' });
    env = await ev('r3', 'document.title');
    // (a name the box doesn't have is undefined there, not an error of its own)
    assert.equal(env.ok, false);
    assert.match(env.error, /^Cannot read properties of undefined \(reading 'title'\)\n\s*at .*\brun:1:/);
    env = await ev('r4', 'page.find("#more").click()');
    assert.match(env.error, /needs the click power/);
    env = await ev('r5', 'fetch("/canary?run")');
    assert.match(env.error, /^fetch is not a function/);
    assert.deepEqual(await page.evaluate(() => window.clicks), { more: 1, del: 0 });

    assert.deepEqual(hits, [], 'nothing loaded from the canary');
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    server.close(); server.closeAllConnections(); // (Chrome keeps a connection open: without this the test process never exits)
  }
});

// Since stand-ins became their mod's (78f9558), every way TRIF hands a mod an element has to know which mod
// it's for. The conversions' mods do their work in callbacks and after awaits, and call trif.* functions on
// elements there: NYT reading mode (loadSooner from a timer after trif.changes), SoundCloud play-on-open
// (click from a setInterval), the Montreal Gazette feed (trif.imageVariant from onVisible, after trif.ready).
const PAGE2 = `<!doctype html><html><head><title>t2</title></head><body>
<div class="fullListenHero"><button type="button" class="sc-button-play" aria-label="Play">Play</button></div>
<main><figure><img id="lazy" loading="lazy" src="/pic/lazy.jpg"></figure><img id="pic" src="/pic/a.jpg?w=160"></main>
<video id="v" muted></video>
<script>window.clicks = 0; document.querySelector('.sc-button-play').addEventListener('click', () => { window.clicks++; });</script>
</body></html>`;
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

test('under real SES: a mod\'s stand-ins work in its callbacks and after an await, and trif.* takes them there', { skip: chromium ? false : 'no Playwright Chromium here' }, async () => {
  const sb = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);
  const rt = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'runtime.js')).href);
  const ses = fs.readFileSync(path.join(__dirname, '..', 'extension', sb.SES_FILE), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : 'image/gif' }); res.end(req.url === '/' ? PAGE2 : GIF); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ args: ['--mute-audio'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(`${base}/`);
    await page.addScriptTag({ content: ses });
    await page.addScriptTag({ content: `(${rt.pageBridge.toString()})();` }); // (loadSooner's and imageVariant's page side)
    await page.addScriptTag({ content: sb.sandboxRuntimeCode() });
    const logsOf = (id) => page.evaluate((m) => globalThis.__trifSandbox.logs.filter((l) => l.mod === m).map((l) => l.args.join(' ')), id);
    const errorsOf = (id) => page.evaluate((m) => globalThis.__trifSandbox.errors.filter((e) => e.mod === m).map((e) => e.message), id);
    const ID = '127.0.0.1/later';
    await page.addScriptTag({ content: sb.sandboxModCode(ID, `
      const t = (what, fn) => { try { fn(); trif.log(what, 'ok'); } catch (e) { trif.log(what, String(e.message)); } };
      await null;
      t('after an await', () => page.find('#lazy').loadSooner());
      Promise.resolve().then(() => t('in a then', () => page.find('#pic').attr('src')));
      trif.ready.then(() => t('after ready', () => { const v = trif.imageVariant(page.find('#pic')); v.setAttr('alt', 'big'); page.find('main').append(v); }));
      setTimeout(() => t('in a timer', () => page.find('#v').pause()), 0);
      const timer = setInterval(() => { clearInterval(timer); t('in an interval', () => page.find('.fullListenHero .sc-button-play').click()); }, 20);
      requestAnimationFrame(() => t('in a frame', () => page.find('main').find('figure').closest('main').attr('id')));
      trif.observe('#pic', (img) => t('in observe', () => img.parent.attr('id')));
      trif.changes('main', (els) => t('in changes', () => { els[0].find('#pic').attr('src'); trif.imageVariant(page.find('#pic')); }));
      page.find('main').onVisible((v) => t('in onVisible', () => { if (v.visible) trif.imageVariant(page.find('#pic')).on('error', () => {}); }));
      page.on('click', (e) => t('in a page event', () => e.target.attr('id')));
      trif.onUrl(() => t('in onUrl', () => page.find('#v').media.paused));
      await new Promise((r) => setTimeout(r, 50));
      t('after a timer await', () => { page.find('#pic').attr('src'); trif.imageVariant(page.find('#pic')); });`,
    { powers: ['preload', 'click', 'image-variants', 'media'], args: { click: ['the Play button: .fullListenHero .sc-button-play'], 'image-variants': ['127.0.0.1 w=160→w=560'] } }) });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector('main').append(document.createElement('p')); history.pushState({}, '', '/next'); });
    await page.click('figure');
    await page.waitForTimeout(300);
    const logs = await logsOf(ID);
    const why = `${JSON.stringify(logs)} ${JSON.stringify(await errorsOf(ID))} ${pageErrors.join('; ')}`;
    for (const what of ['after an await', 'in a then', 'after ready', 'in a timer', 'in an interval', 'in a frame', 'in observe', 'in changes', 'in onVisible', 'in a page event', 'in onUrl', 'after a timer await']) {
      assert.ok(logs.includes(`${what} ok`), `${what}: ${why}`);
    }
    assert.deepEqual(await errorsOf(ID), []);
    // (and they took effect: the lazy picture loads now, the button was pressed, the variant has its address)
    assert.equal(await page.evaluate(() => document.querySelector('#lazy').loading), 'eager');
    assert.equal(await page.evaluate(() => window.clicks), 1);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('img[alt="big"]')].map((i) => i.getAttribute('src'))), [`${base}/pic/a.jpg?w=560`]);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    server.close(); server.closeAllConnections();
  }
});

// A stand-in kept across callbacks, after its element has left the page (Tim's tvtropes.org/skip-adblock-wall):
// trif.observe hands the mod the real article as it's parsed; the site's script removes it and appends a new
// #main-entry holding only its "allow ads" notice; in that callback the mod puts the saved article back with
// cur.after(real) and cur.remove(). The saved stand-in is still the mod's, detached or not.
const PAGE3 = `<!doctype html><html><head><title>t3</title></head><body><div id="wrap"><article id="main-entry"><p>The real article</p></article></div></body></html>`;
const SKIP_WALL = `let real = null;
let warned = false;
const warnOnce = (msg) => { if (!warned) { warned = true; trif.warn(msg); } };
trif.observe('#main-entry', (cur) => {
  try {
    if (!cur.find('.adblock_notice')) { real = cur; return; }
    if (!real) return warnOnce('adblock notice found but no saved article to restore');
    cur.after(real);
    cur.remove();
  } catch (e) {
    warnOnce('skip-adblock-wall failed: ' + e);
  }
});`;

test('under real SES: a stand-in from one observe callback, kept after its element is detached, works in a later one', { skip: chromium ? false : 'no Playwright Chromium here' }, async () => {
  const sb = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);
  const ses = fs.readFileSync(path.join(__dirname, '..', 'extension', sb.SES_FILE), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE3); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ args: ['--mute-audio'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: ses });
    await page.addScriptTag({ content: sb.sandboxRuntimeCode() });
    const ID = 'tvtropes.org/skip-adblock-wall';
    await page.addScriptTag({ content: sb.sandboxModCode(ID, SKIP_WALL, { powers: [], args: {} }) });
    // another boxed mod's observe of the same element: its stand-ins are its own, and the first mod's saved one
    // keeps working beside it
    await page.addScriptTag({ content: sb.sandboxModCode('tvtropes.org/other', 'trif.observe("#main-entry", (el) => el.attr("id"));', { powers: [], args: {} }) });
    await page.waitForTimeout(100);
    // (the site's script: the real article out, a notice-only one in)
    await page.evaluate(() => {
      document.querySelector('#main-entry').remove();
      const a = document.createElement('article');
      a.id = 'main-entry';
      a.innerHTML = '<div class="adblock_notice">Please allow ads</div>';
      document.querySelector('#wrap').append(a);
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#main-entry')].map((e) => e.textContent)), ['The real article']);
    assert.equal(await page.evaluate(() => document.querySelector('.adblock_notice')), null);
    const logs = await page.evaluate(() => globalThis.__trifSandbox.logs.map((l) => `${l.mod}: ${l.args.join(' ')}`));
    const errors = await page.evaluate(() => globalThis.__trifSandbox.errors.map((e) => `${e.mod}: ${e.message}`));
    assert.deepEqual(logs, [], 'no warning from the mod');
    assert.deepEqual(errors, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    server.close(); server.closeAllConnections();
  }
});
