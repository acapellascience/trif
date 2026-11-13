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
