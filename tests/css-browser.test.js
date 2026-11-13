'use strict';
// The CSS check against a real browser: whatever CSS a style mod is allowed (helper/lib/rules.js checkCss)
// must load nothing from the canary's address when a browser applies it. The check reads CSS as text, so it
// only holds where it reads the way a browser parses; this is the test that says so. Needs a Chromium that
// Playwright can start (skipped without one); the unit suite has the same cases against the reading alone
// (tests/hardening.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const rules = require('../helper/lib/rules');
const { cssCases } = require('./css-cases');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* none here: skipped */ }

test('CSS a style mod is allowed loads nothing from another address in a real browser', { skip: chromium ? false : 'no Playwright Chromium here' }, async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/canary')) hits.push(req.url);
    res.writeHead(200, { 'Content-Type': req.url.startsWith('/page') ? 'text/html' : 'text/css', 'Access-Control-Allow-Origin': '*' });
    res.end(req.url.startsWith('/page') ? '<!doctype html><html><head></head><body><a href="#">a</a><b>b</b><input value="abc"></body></html>' : '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const cases = cssCases(`${base}/canary`);
    let allowed = 0, refusedAndLoads = 0;
    for (const [i, css] of cases.entries()) {
      const tagged = css.split(`${base}/canary`).join(`${base}/canary?case=${i}`);
      await page.goto(`${base}/page`);
      await page.evaluate((text) => { const st = document.createElement('style'); st.textContent = text; document.head.append(st); return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 150))); }, tagged);
      const loaded = hits.some((h) => h.includes(`case=${i}`) && !h.includes(`case=${i}0`) );
      const ok = rules.checkCss(tagged) === null;
      if (ok) allowed++;
      assert.ok(!(ok && loaded), `allowed, and the browser loaded from it: ${JSON.stringify(css)}`);
      if (!ok && loaded) refusedAndLoads++;
    }
    assert.ok(allowed >= 4, 'ordinary CSS is allowed');
    // (the test can tell: several refused cases do load in the browser, the line-break and url() ones among them)
    assert.ok(refusedAndLoads >= 6, `refused cases that load: ${refusedAndLoads}`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
