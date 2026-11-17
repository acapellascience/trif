'use strict';
// tests/cdp-page.js does what the browser tests rely on (Playwright's meaning): an error a script tag
// throws is a page error (or the empty pageErrors the others assert would say nothing), clicks are
// trusted, fill types, goto and reload wait for the load, evaluate returns by value, close ends Chrome.
// With TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { browserTestsSkip, launch } = require('./cdp-page');
const { pidsMatching } = require('./e2e/lib/util');

const PAGE = `<!doctype html><title>p</title><body><button id="b">b</button><input id="i" value="old">
<script>window.got = []; b.onclick = (e) => got.push('click ' + e.isTrusted); i.oninput = (e) => got.push('input ' + e.isTrusted + ' ' + i.value);
addEventListener('load', () => { window.loaded = true; });</script>`;

test('the CDP page helper: page errors, trusted clicks, fill, load waits, values back, and nothing left running', { skip: browserTestsSkip() }, async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.evaluate(() => window.loaded), true, 'goto waits for the load event');
    await page.addScriptTag({ content: 'window.tagRan = 1; throw new TypeError("from a tag");' });
    await page.addScriptTag({ content: 'Promise.reject(new Error("rejected"));' });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.tagRan), 1);
    assert.deepEqual(errors, ['from a tag', 'rejected']);
    assert.deepEqual(await page.evaluate(async (a) => ({ sum: a.x + 1, none: undefined, n: null }), { x: 1 }), { sum: 2, n: null });
    assert.equal(await page.evaluate(() => undefined), undefined);
    assert.equal(await page.evaluate('1 + 1'), 2);
    await assert.rejects(page.evaluate(() => { throw new Error('in evaluate'); }), /in evaluate/);
    await page.click('#b');
    await page.fill('#i', 'new text');
    assert.deepEqual(await page.evaluate(() => window.got), ['click true', 'input true new text']);
    await page.reload();
    assert.deepEqual(await page.evaluate(() => [window.loaded, window.got]), [true, []]);
  } finally {
    if (browser) await browser.close();
    server.close(); server.closeAllConnections();
  }
  assert.deepEqual(pidsMatching(browser.dir).map((p) => p.command), [], 'no Chrome process left');
});
