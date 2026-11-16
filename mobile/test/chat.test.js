#!/usr/bin/env node
'use strict';
// The iPhone app's chat script (browser-probe/TrifProbe/Web/chat.js) against the stand-in chat
// (shared/pages/chat.html), in Chromium: the tab's data goes into the message box, a send is told to the app
// (and Return that only makes a new line isn't), the reply is watched until it's done (its stop button gone),
// and the mod files written in it, and only those, are handed over; a reply with no mod hands over none.
//
//   TRIF_BROWSER_TESTS=1 node mobile/test/chat.test.js
//
// Headless Chrome for Testing (tests/cdp-page.js), only with TRIF_BROWSER_TESTS=1 or in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handler } = require('../serve');
const { browserTestsSkip, launch } = require('../../tests/cdp-page');

const CHAT = fs.readFileSync(path.join(__dirname, '..', 'browser-probe', 'TrifProbe', 'Web', 'chat.js'), 'utf8');
// (the app's message handler, as the page sees it in the app: what chat.js posts, kept in order)
const STUB = 'window.__posts = []; window.webkit = { messageHandlers: { trif: { postMessage: (m) => { window.__posts.push(m); } } } };';

const posts = (pg) => pg.evaluate(() => window.__posts);
const waitPost = (pg, type, n = 1) => pg.waitForFunction((a) => { const l = window.__posts.filter((m) => m.type === a.type); return l.length >= a.n ? [l] : null; }, { type, n }, { timeoutMs: 20000 }).then(([l]) => l);

test('the chat script: fill, the send, the reply watched until done, its mods handed over', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });

    // A new chat: no instructions in it, nothing in the box. The instructions go in as an attached file.
    assert.deepEqual(JSON.parse(await page.evaluate(() => globalThis.__trifChat.state())), { editor: true, has: false, context: false, working: false, replying: false });
    const said = await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null),
      "I'm looking at http://127.0.0.1:9/plain.html in TRIF\n--- How TRIF mods are written ---\n…");
    assert.match(said, /text attached/);
    assert.equal(JSON.parse(await page.evaluate(() => globalThis.__trifChat.state())).has, true);

    // Return with Shift (a new line) isn't a send; the send button is.
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'Make the headings green'); });
    await page.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
    await page.waitForTimeout(400);
    assert.equal((await posts(page)).filter((m) => m.type === 'sent').length, 0);
    await page.click('button[aria-label="Send message"]');
    const [sent] = await waitPost(page, 'sent');
    assert.equal(sent.withInstructions, true);
    assert.match(await page.evaluate(() => location.pathname), /^\/chat\//);

    // Still working while the stop button shows; done after, with the one mod in the reply.
    await page.waitForFunction(() => (document.querySelector('[aria-label="Stop response"]') ? [1] : null));
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 0);
    const [done] = await waitPost(page, 'done');
    assert.equal(done.why, 'done');
    assert.equal(done.stop, true);
    assert.equal(done.mods.length, 1);
    assert.match(done.mods[0], /==WebMod==[\s\S]*@name\s+Calmer feed[\s\S]*@match\s+http:\/\/127\.0\.0\.1\/\*[\s\S]*==\/WebMod==/);
    // (whole: its rules after the header are the JSON the chat wrote, the Add to TRIF button not in them)
    assert.deepEqual(Object.keys(JSON.parse(done.mods[0].split('==/WebMod==')[1])), ['css', 'hide']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.trif-add').length), 1);
    // (the watch has stopped: nothing more is posted while the page is quiet)
    await page.waitForTimeout(2500);
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 1);

    // The conversation has the instructions now; a second message by Return: two mods, the earlier one not again.
    assert.equal(JSON.parse(await page.evaluate(() => globalThis.__trifChat.state())).context, true);
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'Now two: also the cookie box'); });
    await page.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    const sentTwo = await waitPost(page, 'sent', 2);
    assert.equal(sentTwo[1].how, 'return');
    assert.equal(sentTwo[1].withInstructions, false);
    const doneTwo = await waitPost(page, 'done', 2);
    // (this reply's Calmer feed has another @match, no page named in the message: a new version, so offered too)
    assert.deepEqual(doneTwo[1].mods.map((m) => m.match(/@name\s+(.+)/)[1].trim()), ['Calmer feed', 'No cookie box']);

    // A reply with no mod in it: done, no mods.
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'no mod please, just answer'); });
    await page.click('button[aria-label="Send message"]');
    const doneThree = await waitPost(page, 'done', 3);
    assert.deepEqual(doneThree[2].mods, []);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.showReply()), 'shown');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a chat with no stop button to see, done once the reply has been still for a few seconds', { skip: browserTestsSkip(), timeout: 60000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html?nostop`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'Hide the banner on http://127.0.0.1:9/'); });
    await page.click('button[aria-label="Send message"]');
    await waitPost(page, 'sent');
    const t0 = Date.now();
    await page.waitForFunction(() => (document.querySelector('.font-claude-response pre') ? [1] : null));
    const [done] = await waitPost(page, 'done');
    assert.equal(done.why, 'quiet');
    assert.equal(done.stop, false);
    assert.equal(done.mods.length, 1);
    assert.ok(Date.now() - t0 > 5000, 'not before the reply has been still for a while');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a file a reply attaches is never read (no request at all)', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
  // (Tim, 11-16: nothing against Claude's or ChatGPT's terms: no internal routes, no session token, no reading a
  // reply's files; a file comes only when the person taps it, as a download the app catches)
  const h = handler(() => {});
  const asked = [];
  const server = http.createServer((req, res) => { asked.push(req.url); h(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const ask = async (text, n) => {
      await page.evaluate((t) => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, t); }, text);
      await page.click('button[aria-label="Send message"]');
      return (await waitPost(page, 'done', n))[n - 1];
    };
    await page.goto(`${base}/chat.html`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    asked.length = 0;
    const file = await ask('as a file please', 1);
    assert.deepEqual(file.mods, [], 'an attached file is not read');
    const both = await ask('file and block, the same mod', 2);
    assert.equal(both.mods.length, 1, 'the code block only');
    assert.deepEqual(asked, [], `the chat script asked for nothing: ${asked.join(', ')}`);
    const src = CHAT;
    for (const route of ['/api/', 'backend-api', 'auth/session', 'wiggle', 'chat_conversations', 'document.cookie', 'Authorization', 'fetch(']) {
      assert.equal(src.includes(route), false, `chat.js has no ${route}`);
    }

  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
