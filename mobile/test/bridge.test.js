#!/usr/bin/env node
'use strict';
// The iPhone app's page side of a boxed mod's site-data power (mobile/shared/gen/page-bridge.js: desktop's
// runtime.js pageBridge behind a test of the address), in Chromium: it starts only on a page one of the mods it's
// handed matches; it leaves fetch and XMLHttpRequest alone until a filter is asked for; then a JSON response whose
// address matches goes to the box's side (here a stand-in answering as sandbox.js does) and what comes back is what
// the page gets, from fetch and from XMLHttpRequest; no answer, and the page gets what the site sent.
//
//   TRIF_BROWSER_TESTS=1 node mobile/test/bridge.test.js
//
// (The box's side, the checks that a filter only removes or reorders, is extension/sandbox.js's, tested in
// tests/boxpowers.test.js; that it all runs in the app is checked in the Simulator with shared/pages/feed.html.)

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handler } = require('../serve');
const { browserTestsSkip, launch } = require('../../tests/cdp-page');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'page-bridge.js'), 'utf8');
const nativeFetch = (pg) => pg.evaluate(() => /native code/.test(Function.prototype.toString.call(window.fetch)));
const feed = (pg, by) => pg.evaluate(async (how) => {
  if (how === 'fetch') return (await (await fetch('feed.json?by=fetch', { cache: 'no-store' })).json()).entries.map((e) => e.id);
  return new Promise((done) => { const x = new XMLHttpRequest(); x.open('GET', 'feed.json?by=xhr'); x.onload = () => done(JSON.parse(x.responseText).entries.map((e) => e.id)); x.send(); });
}, by);

// (the time limit counts cdp-page's wait for the test browsers' lock too: test files run side by side, and this one,
// the suite's first browser, can wait behind another file's browser for more than a minute on CI)
test('the page side of site-data: only on matching pages, nothing wrapped until a filter, then the filtered response', { skip: browserTestsSkip(), timeout: 600000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/plain.html`);
    // (a mod for another site: nothing starts)
    await page.addScriptTag({ content: `${BRIDGE}(${JSON.stringify([[['https://x.com/*'], []]])});` });
    assert.equal(await page.evaluate(() => !!window.__trifBridge), false);
    // (one for this page, but excluded here: nothing either)
    await page.addScriptTag({ content: `${BRIDGE}(${JSON.stringify([[['http://127.0.0.1/*'], ['http://127.0.0.1/plain.html']]])});` });
    assert.equal(await page.evaluate(() => !!window.__trifBridge), false);
    // (one for this page: the bridge is there, and fetch is still the page's own)
    await page.addScriptTag({ content: `${BRIDGE}(${JSON.stringify([[['http://127.0.0.1/*'], []]])});` });
    assert.equal(await page.evaluate(() => !!window.__trifBridge), true);
    assert.equal(await nativeFetch(page), true);
    assert.deepEqual(await feed(page, 'fetch'), [1, 2, 3, 4, 5]);

    // A filter asked for: fetch and XMLHttpRequest wrapped; the box's side (a stand-in) drops the promoted entries.
    await page.evaluate(() => {
      document.addEventListener('trif:filter-request', (e) => {
        const req = JSON.parse(e.detail);
        window.__asked = (window.__asked || 0) + 1;
        if (window.__silent) return;
        const d = JSON.parse(req.text);
        d.entries = d.entries.filter((x) => !x.promoted);
        document.dispatchEvent(new CustomEvent('trif:filter-response', { detail: JSON.stringify(d) }));
      });
      document.dispatchEvent(new CustomEvent('trif:filter-patterns', { detail: JSON.stringify(['*feed.json*']) }));
    });
    assert.equal(await nativeFetch(page), false);
    assert.deepEqual(await feed(page, 'fetch'), [1, 3, 5]);
    assert.deepEqual(await feed(page, 'xhr'), [1, 3, 5]);
    // (an address no filter asked for isn't handed over)
    const before = await page.evaluate(() => window.__asked);
    await page.evaluate(() => fetch('frame.html').then((r) => r.text()));
    assert.equal(await page.evaluate(() => window.__asked), before);
    // No answer from the box's side (a filter that failed): what the site sent.
    await page.evaluate(() => { window.__silent = true; });
    assert.deepEqual(await feed(page, 'fetch'), [1, 2, 3, 4, 5]);
    assert.deepEqual(await feed(page, 'xhr'), [1, 2, 3, 4, 5]);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
