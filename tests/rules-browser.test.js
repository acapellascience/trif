'use strict';
// A style mod's replace rules in a real browser (helper/lib/rules.js rulesRuntime): every rule applies, not
// only the first (a user's report on 0.3.0: a mod with four, plain, scoped, caseless and regex, changed only
// what its first one found), to the page's text and to text the page adds or changes later, each once. Runs
// in headless Chrome for Testing (tests/cdp-page.js), with TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.
// The unit suite has the same against a small page in Node (tests/rules.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const rules = require('../helper/lib/rules');
const { browserTestsSkip, launch } = require('./cdp-page');

const PAGE = '<!doctype html><html><head><title>replace</title></head><body>' +
  '<article><span id="a">Grok says Hello, 12 views</span><p class="bio" id="b">my cat</p></article>' +
  '<p id="c">a cat</p><div id="feed"></div></body></html>';
const FOUR = [
  { find: 'Grok', with: 'Grok AI' },
  { in: '.bio', find: 'cat', with: 'dog' },
  { find: 'HELLO', caseless: true, with: 'hi' },
  { find: '\\d+ views', regex: true, with: 'some views ($1)' },
];
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));

test('a style mod\'s replace rules all apply in a real browser, whichever is first, each once', { skip: browserTestsSkip() }, async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const read = () => page.evaluate(() => ['a', 'b', 'c', 'feed'].map((id) => document.getElementById(id).textContent));
    for (let first = 0; first < FOUR.length; first++) {
      const replace = [...FOUR.slice(first), ...FOUR.slice(0, first)];
      await page.goto(`${base}/page`);
      await page.addScriptTag({ content: rules.rulesCode(rules.checkRules({ replace }), 'x.com/four') });
      await page.evaluate(frames);
      assert.deepEqual(await read(), ['Grok AI says hi, some views ($1)', 'my dog', 'a cat', ''], `replace[${first}] first`);
      // what the page adds, and what it changes in place, later: every rule, once (Grok AI stays Grok AI)
      await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'Grok has 3 views'; document.getElementById('feed').append(p); });
      await page.evaluate(frames);
      await page.evaluate(() => { document.getElementById('c').firstChild.data = 'Hello there, 5 views'; });
      await page.evaluate(frames);
      assert.deepEqual(await read(), ['Grok AI says hi, some views ($1)', 'my dog', 'hi there, some views ($1)', 'Grok AI has some views ($1)'], `replace[${first}] first, later text`);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
