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
// (each test's time limit also covers cdp-page's wait for the test browsers' lock: files run side by side, and on CI
// a test here can wait behind another file's browser (smoke.js's probes, about 100 s there) before its own starts)
const LOCK_WAIT = 300000;

const CHAT = fs.readFileSync(path.join(__dirname, '..', 'browser-probe', 'TrifProbe', 'Web', 'chat.js'), 'utf8');
// (the app's message handler, as the page sees it in the app: what chat.js posts, kept in order)
const STUB = 'window.__posts = []; window.webkit = { messageHandlers: { trif: { postMessage: (m) => { window.__posts.push(m); } } } };';

const posts = (pg) => pg.evaluate(() => window.__posts);
const waitPost = (pg, type, n = 1) => pg.waitForFunction((a) => { const l = window.__posts.filter((m) => m.type === a.type); return l.length >= a.n ? [l] : null; }, { type, n }, { timeoutMs: 20000 }).then(([l]) => l);

test('the chat script: fill, the send, the reply watched until done, its mods handed over', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
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
    assert.deepEqual(JSON.parse(await page.evaluate(() => globalThis.__trifChat.state())), { editor: true, usable: true, viewer: null, has: false, trif: 0, others: false, pages: [], context: false, working: false, replying: false });
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
    // (opened from TRIF at the conversation's end, since e416d45)
    assert.equal(await page.evaluate(() => globalThis.__trifChat.showReply()), 'to the bottom');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a chat with no stop button to see, done once the reply has been still for a few seconds', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 60000 }, async () => {
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

test('the chat script: a file a reply attaches is never read (no request at all)', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
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

test('the chat script: TRIF\'s file attached through the page\'s file input when a paste goes in as text (chatgpt.com, 11-16); what TRIF put in, seen and taken out', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 60000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html?gptpaste`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    const text = "I'm looking at http://127.0.0.1:9/plain.html in TRIF, an app that changes websites with small mods.\n…";
    const said = await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), text);
    assert.match(said, /went in as text, taken out.*text attached \(file input\)/);
    let st = JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));
    assert.equal(st.trif, 1);
    assert.equal(st.others, false);
    assert.equal(await page.evaluate(() => document.querySelector('.ProseMirror').textContent), '');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid="file-thumbnail"]').length), 1);
    // (the person's own words beside it: seen as theirs)
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'make it green'); });
    st = JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));
    assert.equal(st.trif, 1);
    assert.equal(st.others, true);
    // (taken out: TRIF's tile only, the person's words stay)
    assert.equal(await page.evaluate(() => globalThis.__trifChat.clearTrif()), 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid="file-thumbnail"]').length), 0);
    assert.equal(await page.evaluate(() => document.querySelector('.ProseMirror').textContent), 'make it green');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a file opened in the chat\'s viewer (Claude\'s, 11-16): its code read off the screen for Add this mod?, and no fill while the viewer covers the message box', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    for (const query of ['', '?viewerroute']) {
      const page = await browser.newPage();
      await page.goto(`${base}/chat.html${query}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'as a viewer file please'); });
      await page.click('button[aria-label="Send message"]');
      await waitPost(page, 'done');
      // (the card is no link: a tap opens the viewer over the chat, its code with line numbers beside it)
      await page.click('.file-card');
      const [v] = await waitPost(page, 'viewer');
      assert.match(v.text, /^\/\/ ==WebMod==/);
      assert.match(v.text, /==\/WebMod==/);
      assert.doesNotMatch(v.text, /^\d/m, 'no line numbers in the code read');
      assert.equal(v.name, 'calmer-feed.js');
      if (query) assert.match(v.path, /\/files\/calmer-feed\.js$/);
      // (the message box is still there, under the viewer: not usable, so nothing goes in)
      let st = JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));
      assert.equal(st.editor, true);
      assert.equal(st.usable, false);
      assert.ok(st.viewer);
      const filling = page.evaluate(() => globalThis.__trifChat.fill('Here\'s http://127.0.0.1:9/ in TRIF now: …', null, null, null, null));
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => document.querySelector('.ProseMirror').textContent), '', 'nothing typed under the viewer');
      // (closed: the fill that was waiting goes in)
      await page.click('.viewer [aria-label="Close"]');
      assert.match(await filling, /text/);
      assert.match(await page.evaluate(() => document.querySelector('.ProseMirror').textContent), /in TRIF now/);
      st = JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));
      assert.equal(st.usable, true);
      assert.equal(st.viewer, null);
      if (query) assert.doesNotMatch(await page.evaluate(() => location.pathname), /\/files\//);
      // (opened again after a moment: offered again, once; the viewer staying open isn't offered over and over)
      await page.waitForTimeout(800);
      await page.click('.file-card');
      await page.waitForTimeout(1200);
      assert.equal((await posts(page)).filter((m) => m.type === 'viewer').length, 2, 'once more after it was closed (seen again), not more');
      // (the viewer's code isn't a reply's code block too: no late pickup of it, with its line numbers)
      assert.equal((await posts(page)).filter((m) => m.type === 'done' && m.why === 'late').length, 0);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script on chatgpt.com\'s newer mobile page (11-16): pictures-only file inputs, li[data-message-role] messages, a pause mid-reply, code as editor lines', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html?octane&cm&gpt`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    // (the instructions: no text file offered to an input that takes pictures only, so no "not a supported image")
    const said = await page.evaluate(() => globalThis.__trifChat.fill("I'm looking at http://127.0.0.1:9/plain.html in TRIF\n--- How TRIF mods are written ---\n…", null, 'TRIF instruction.txt', null, null));
    assert.match(said, /pictures only/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.toast').length), 0, 'no "not a supported image" toast');
    assert.match(await page.evaluate(() => document.querySelector('.ProseMirror').textContent), /How TRIF mods are written/);
    // (a picture: taken)
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.png'), png), /picture pasted/);
    await page.click('button[aria-label="Send message"]');
    await waitPost(page, 'sent');
    // (the reply pauses 3 s with no stop button; not done until it's marked complete)
    await page.waitForTimeout(2500);
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 0, 'not done during the pause');
    const [done] = await waitPost(page, 'done');
    assert.equal(done.mods.length, 1);
    assert.match(done.mods[0], /^\/\/ ==WebMod==\n\/\/ @name/, 'the editor\'s lines kept as lines');
    // (Add to TRIF under the code: the same file)
    await page.waitForFunction(() => (document.querySelector('.trif-add') ? [1] : null));
    await page.click('.trif-add');
    const [mod] = await waitPost(page, 'mod');
    assert.equal(mod.text, done.mods[0]);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a long conversation\'s older messages that render late (Tim, 11-17: "spurious asks to add old code"): their old mods never offered, by the reply or late; a viewer the chat reopens with no tap isn\'t either', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html?history`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    // (sent before the older messages render: they turn up during the reply, after the snapshot of what was seen)
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'make the headings green, wait 3'); });
    await page.click('button[aria-label="Send message"]');
    const [done] = await waitPost(page, 'done');
    assert.equal(await page.evaluate(() => document.querySelectorAll('pre').length) >= 2, true, 'the older message rendered during the reply');
    assert.equal(done.mods.length, 1, 'the new reply\'s mod only');
    assert.match(done.mods[0], /#1f8a5b/);
    // (another older message renders 2 s after the reply: no late offer of it)
    await page.waitForFunction(() => document.querySelectorAll('pre').length >= 3, null, { timeoutMs: 8000 });
    await page.waitForTimeout(3500);
    assert.equal((await posts(page)).filter((m) => m.type === 'done' && m.why === 'late').length, 0, 'no late offer of old code');
    // (a second send: still only its own reply's mod)
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'two please'); });
    await page.click('button[aria-label="Send message"]');
    const second = (await waitPost(page, 'done', 2))[1];
    // (its Calmer feed is the first reply's, the same code: seen already; the cookie box is new)
    assert.equal(second.mods.length, 1);
    assert.match(second.mods[0], /No cookie box/);
    await page.waitForTimeout(4000);
    assert.equal((await posts(page)).filter((m) => m.type === 'done' && m.why === 'late').length, 0);
    await page.close();
    // (a viewer the chat reopens by itself on load: said as skipped, with no code)
    const p2 = await browser.newPage();
    await p2.goto(`${base}/chat.html?reopen`);
    await p2.addScriptTag({ content: STUB });
    await p2.addScriptTag({ content: CHAT });
    const [v] = await waitPost(p2, 'viewer');
    assert.equal(v.text, '');
    assert.match(v.skipped, /no tap/);
    await p2.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

// (a paste into the message box, as the person would: the page's own paste handler takes it)
const pasteInto = (pg, text) => pg.evaluate((t) => {
  const ed = document.querySelector('.ProseMirror');
  ed.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  // (Chrome's ClipboardEvent drops a clipboardData given to it: the event's own, as a paste's)
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  ed.dispatchEvent(ev);
}, text);
const ownMod = (name, lines) => `// ==WebMod==\n// @name        ${name}\n// @match       http://localhost/*\n// @style\n// ==/WebMod==\n${JSON.stringify({ css: '.x { color: red }', hide: Array.from({ length: lines }, (_, i) => `.ad-${i}`) }, null, 2)}`;

test('the chat script: the person\'s own code (Tim, 11-18: "When I paste code into Claude in the app, the app reads it as a mod"): pasted in the message box, sent as a code block or a pasted-text card, never offered nor given Add to TRIF; the assistant\'s mod still is', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    for (const query of ['?pasted', '?pasted&octane&gpt']) {
      const page = await browser.newPage();
      await page.goto(`${base}/chat.html${query}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      const T = query.includes('octane') ? '[data-message-role="user"]' : '[data-testid="user-message"]';
      const R = query.includes('octane') ? '[data-message-role="assistant"]' : '.font-claude-response';
      // (a short paste: a code block in the box; a long one: a pasted-text tile with its preview)
      await pasteInto(page, ownMod('My pasted mod', 2));
      await pasteInto(page, ownMod('My long pasted mod', 20));
      assert.equal(await page.evaluate(() => document.querySelectorAll('.ProseMirror pre').length), 1);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.tiles .pasted pre').length), 1);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.trif-add').length), 0, 'no Add to TRIF in the message box');
      await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'make the headings green like this'); });
      await page.click('button[aria-label="Send message"]');
      await waitPost(page, 'sent');
      const [done] = await waitPost(page, 'done');
      // (the sent message holds the person's code block and pasted card; only the reply's mod is offered)
      assert.equal(await page.evaluate((t) => document.querySelectorAll(`${t} pre`).length, T), 2, 'the person\'s message has both');
      assert.deepEqual(done.mods.map((m) => m.match(/@name\s+(.+)/)[1].trim()), ['Calmer feed']);
      await page.waitForTimeout(800);
      assert.deepEqual(await page.evaluate((r) => [...document.querySelectorAll('.trif-add')].map((b) => !!b.closest(r)), R), [true], 'Add to TRIF under the reply\'s code only');
      // (more pasted after the reply: no late offer, no button)
      await pasteInto(page, ownMod('Another pasted mod', 3));
      await page.waitForTimeout(4000);
      assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 1, 'no late offer of the message box\'s code');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.composer .trif-add').length), 0);
      // (the person's pasted card tapped: their own text in the viewer, not offered)
      await page.click('.pasted-card');
      const [v] = await waitPost(page, 'viewer');
      assert.equal(v.text, '');
      assert.match(v.skipped, /outside the assistant/);
      assert.equal((await posts(page)).filter((m) => m.type === 'mod').length, 0);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: an old conversation (Tim, 11-18: "opening an old chat gets spurious pickups of old code"): loading in pieces, its messages late, drawn again on scroll-up, a reload watched again, the chat switched to it mid-reply: none of its mods offered; a new live reply still is, and /new → /chat/<id> keeps the watch', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 150000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const names = (d) => d.mods.map((m) => m.match(/@name\s+(.+)/)[1].trim());
  const say = (pg, t) => pg.evaluate((x) => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, x); }, t);
  try {
    browser = await launch();
    // (just opened, then scrolled up: nothing)
    let page = await browser.newPage();
    await page.goto(`${base}/chat/old-a?oldchat`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.waitForTimeout(2600);
    await page.evaluate(() => window.__standinScrollUp());
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.history pre').length), 3);
    assert.deepEqual((await posts(page)).filter((m) => ['done', 'mod', 'viewer'].includes(m.type)), []);
    await page.close();

    // (the app reloading it while it thinks a reply is being written: resume at once, before the pieces render)
    page = await browser.newPage();
    await page.goto(`${base}/chat/old-b?oldchat`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    assert.equal(await page.evaluate(() => globalThis.__trifChat.resume()), 'watching');
    const [resumed] = await waitPost(page, 'done');
    assert.deepEqual(resumed.mods, [], 'nothing from a resumed old chat');
    assert.ok((await posts(page)).some((m) => m.type === 'held' && m.history >= 1 && m.mode === 'resume'));
    await page.close();

    // (a send while it's still loading in pieces: only the new reply's mod; the re-render after, no late offer)
    page = await browser.newPage();
    await page.goto(`${base}/chat/old-c?oldchat`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await say(page, 'make the headings green');
    await page.click('button[aria-label="Send message"]');
    const [live] = await waitPost(page, 'done');
    assert.deepEqual(names(live), ['Calmer feed']);
    await page.evaluate(() => window.__standinScrollUp());
    await page.waitForTimeout(4000);
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 1, 'no late offer after the re-render');
    await page.close();

    // (/new → /chat/<id> at the send: the same watch, offered; then the chat switched to an old conversation in the
    // middle of a reply: the watch ends, nothing offered, nothing late)
    page = await browser.newPage();
    await page.goto(`${base}/new`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await say(page, 'make the headings green');
    await page.click('button[aria-label="Send message"]');
    const [first] = await waitPost(page, 'done');
    assert.match(await page.evaluate(() => location.pathname), /^\/chat\/\w+$/);
    assert.deepEqual(names(first), ['Calmer feed']);
    await say(page, 'two please, wait 8');
    await page.click('button[aria-label="Send message"]');
    await waitPost(page, 'sent', 2);
    await page.waitForTimeout(1500);
    await page.click('#old-chat');
    const left = (await waitPost(page, 'done', 2))[1];
    assert.equal(left.why, 'left');
    assert.deepEqual(left.mods, []);
    await page.waitForTimeout(9000);
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 2, 'nothing more from the old chat');
    await page.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a quick ask (Tim, 11-18): the request goes in the box and TRIF never sends (no scripted click, Enter or submit); the person\'s own Send is told once; their message appearing counts as the send; the request taken out again', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
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
    const box = () => page.evaluate(() => document.querySelector('.ProseMirror').textContent);

    // Filled and armed: nothing sent, by anyone, for a good while.
    assert.match(await page.evaluate(() => globalThis.__trifChat.fill('make the headings thinner', null, null, null, null)), /text/);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.armSend()), 'armed');
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__standinSends.length), 0);
    assert.equal((await posts(page)).filter((m) => m.type === 'sent').length, 0);

    // A new ask over it: the old words out, the new in; still nothing sent.
    assert.equal(await page.evaluate(() => globalThis.__trifChat.takeText('make the headings thinner')), 'taken out');
    assert.equal(await box(), '');
    await page.evaluate(() => globalThis.__trifChat.fill('hide the cookie box', null, null, null, null));
    await page.evaluate(() => globalThis.__trifChat.armSend());

    // The person's Send (a real click): told once, not again by the message appearing.
    await page.click('button[aria-label="Send message"]');
    const [sent] = await waitPost(page, 'sent');
    assert.equal(sent.how, 'button');
    await waitPost(page, 'done');
    await page.waitForTimeout(600);
    assert.equal((await posts(page)).filter((m) => m.type === 'sent').length, 1);
    assert.deepEqual(await page.evaluate(() => window.__standinSends.map((s) => `${s.how} ${s.trusted}`)), ['button true']);

    // A send TRIF's listeners didn't see (the site's own way): the person's message appearing is the send.
    await page.evaluate(() => globalThis.__trifChat.fill('one more', null, null, null, null));
    await page.evaluate(() => globalThis.__trifChat.armSend());
    await page.evaluate(() => { const u = document.createElement('div'); u.setAttribute('data-testid', 'user-message'); u.textContent = 'one more'; document.getElementById('log').append(u); });
    const two = await waitPost(page, 'sent', 2);
    assert.equal(two[1].how, 'message seen');
    assert.equal(await page.evaluate(() => window.__standinUntrusted()), 0);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: the quick ask\'s strip (Tim, 11-18: "a very little panel that shows the text"): stripBox is the box\'s text and the site\'s Send, never the attachments; stripWatch tells each change as the page settles, then nothing while it\'s still', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 60000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    // (?late: the box's tool row, a line above it and more room under it arrive after load; tiles show late)
    await page.goto(`${base}/chat.html?late`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    assert.equal(await page.evaluate(() => globalThis.__trifChat.stripWatch(true)), 'on');
    await page.evaluate(() => globalThis.__trifChat.fill('the page now', null, 'TRIF follow-up.txt', null, null));
    await page.evaluate(() => globalThis.__trifChat.fill('make the headings thinner', null, null, null, null));
    await page.waitForTimeout(2600); // (past the stand-in's last late piece)
    const b = await page.evaluate(() => globalThis.__trifChat.stripBox());
    const r = await page.evaluate(() => {
      const box = (el) => { const q = el.getBoundingClientRect(); return { top: q.top + scrollY, bottom: q.bottom + scrollY }; };
      return { ed: box(document.querySelector('.ProseMirror')), send: box(document.querySelector('button[aria-label="Send message"]')), tile: box(document.querySelector('[data-testid="file-thumbnail"]')) };
    });
    assert.ok(b && b.send, 'the Send button found');
    assert.equal(b.tiles, 1, 'the attachment is there');
    assert.equal(b.top, Math.min(r.ed.top, r.send.top));
    assert.equal(b.bottom, Math.max(r.ed.bottom, r.send.bottom));
    assert.ok(r.tile.bottom <= b.top, 'the attachment is above the strip\'s part');
    assert.ok(b.chars > 0 && b.ready);
    // (told as the page changed; once still, nothing more)
    const told = (await posts(page)).filter((m) => m.type === 'stripbox');
    assert.ok(told.length >= 3, `told ${told.length} times`);
    assert.deepEqual(told[told.length - 1].box, b);
    await page.waitForTimeout(800);
    assert.equal((await posts(page)).filter((m) => m.type === 'stripbox').length, told.length, 'nothing told while still');
    assert.equal(await page.evaluate(() => globalThis.__trifChat.stripWatch(false)), 'off');
    // (and nothing sent, ever)
    assert.equal(await page.evaluate(() => window.__standinSends.length), 0);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

// (a 1×1 PNG: a screenshot stand-in)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const OLD = "I'm looking at https://m.youtube.com/feed/subscriptions?ra=m in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page.\n\n--- How TRIF mods are written ---\n…\n--- The page: https://m.youtube.com/feed/subscriptions?ra=m ---\nytm-app 375×667 Subscriptions";
const NOW = "I'm looking at http://127.0.0.1:9/x.html in TRIF, an app that changes websites with small mods. Below are how TRIF mods are written, then an outline of the page.\n\n--- How TRIF mods are written ---\n…\n--- The page: http://127.0.0.1:9/x.html ---\nmain 375×667 X\n--- End of what TRIF sent ---";

test('the chat script: an earlier TRIF fill for another page that the chat puts back as its draft (Tim, 11-18: chatgpt.com, YouTube\'s text beside x.com\'s attachments): taken out, before the fill or after it, as a file or as text; the person\'s own words kept; only the page in front left', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const open = async (query, draft) => {
      await page.goto(`${base}/plain.html`);
      await page.evaluate((d) => { if (d) localStorage.setItem('standin-draft', d); else localStorage.removeItem('standin-draft'); }, draft);
      await page.goto(`${base}/chat.html?${query}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
    };
    const box = () => page.evaluate(() => document.querySelector('.ProseMirror').textContent);
    const tileNames = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="file-thumbnail"]')].map((t) => (t.querySelector('[data-cds-whole-caption]') || t.firstChild).textContent));
    const st = async () => JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));

    // 1. Put back AFTER TRIF looked and filled (as Tim's): the page's file and screenshot go in; 1.5 s later the old
    // YouTube text comes back; the guard takes it out again. Only x.com's things are left.
    await open('gptdraft=1500', OLD);
    assert.equal((await st()).has, false);
    assert.match(await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), NOW), /text attached/);
    assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), PNG), /picture pasted/);
    await page.waitForFunction(() => (window.__posts.some((m) => m.type === 'fillguard') ? [1] : null), {}, { timeoutMs: 6000 });
    await page.waitForTimeout(400);
    assert.equal(await box(), '');
    assert.deepEqual(await tileNames(), ['TRIF instruction.txt', 'TRIF screenshot.jpg']);
    assert.deepEqual((await posts(page)).find((m) => m.type === 'fillguard').gone, ['TRIF\'s text for m.youtube.com']);
    // (and the site's draft is now empty, so it doesn't come back next time)
    assert.equal(await page.evaluate(() => localStorage.getItem('standin-draft')), null);

    // 2. Put back BEFORE: the app sees TRIF's text for another page (state's pages), takes it out, then fills.
    await open('gptdraft=200', OLD);
    await page.waitForTimeout(500);
    let s = await st();
    assert.equal(s.trif, 1);
    assert.equal(s.others, false);
    assert.deepEqual(s.pages, ['https://m.youtube.com/feed/subscriptions?ra=m']);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.clearTrif()), 0);
    assert.equal(await box(), '');
    await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), NOW);
    assert.deepEqual(await tileNames(), ['TRIF instruction.txt']);

    // 3. The page's details as text (a chat that takes pictures only, ChatGPT's newer page), the old draft put back
    // over it 1.5 s later (replacing the box, as its editor does): the old text out, this page's typed again.
    await open('octane&gptdraft=1500', OLD);
    assert.match(await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), NOW), /text typed|text pasted/);
    await page.waitForFunction(() => (window.__posts.some((m) => m.type === 'fillguard') ? [1] : null), {}, { timeoutMs: 6000 });
    await page.waitForTimeout(400);
    assert.equal((await box()).replace(/\s+/g, ''), NOW.replace(/\s+/g, ''));
    s = await st();
    assert.deepEqual(s.pages, ['http://127.0.0.1:9/x.html']);
    assert.deepEqual((await posts(page)).find((m) => m.type === 'fillguard').gone, ['TRIF\'s text for m.youtube.com', 'this fill\'s own text typed again']);

    // 4. The person's own words around an old fill (this build's, with its end line): kept; only TRIF's block goes.
    const theirs = `make the header smaller\n\n${OLD}\n--- End of what TRIF sent ---\n\nthanks!`;
    await open('gptdraft=200', theirs);
    await page.waitForTimeout(500);
    s = await st();
    assert.equal(s.trif, 1);
    assert.equal(s.others, true);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.clearTrif()), 0);
    assert.equal((await box()).replace(/\s+/g, ' ').trim(), 'make the header smaller thanks!');
    await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), NOW);
    assert.deepEqual(await tileNames(), ['TRIF instruction.txt']);
    assert.equal((await box()).replace(/\s+/g, ' ').trim(), 'make the header smaller thanks!');
    // (and nothing of TRIF's typed text for x.com comes and goes later: the guard leaves the person's words alone)
    await page.waitForTimeout(1500);
    assert.equal((await box()).replace(/\s+/g, ' ').trim(), 'make the header smaller thanks!');
    assert.equal(await page.evaluate(() => window.__standinUntrusted()), 0);

    // 5. Claude's kind of draft (the stand-in's ?draft: its attachments too, back 0.8 s after a reload): the old
    // page's tiles come back after this fill's; the second of each is taken out, this fill's kept.
    await page.goto(`${base}/chat.html?draft`);
    await page.evaluate(() => sessionStorage.removeItem('draft'));
    await page.reload();
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), OLD);
    await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), PNG);
    await page.reload();
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), NOW);
    await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), PNG);
    await page.waitForFunction(() => (window.__posts.some((m) => m.type === 'fillguard') ? [1] : null), {}, { timeoutMs: 6000 });
    await page.waitForTimeout(600);
    assert.deepEqual(await tileNames(), ['TRIF instruction.txt', 'TRIF screenshot.jpg']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-trif-fill]').length), 2, 'the ones left are this fill\'s');
    assert.deepEqual((await posts(page)).find((m) => m.type === 'fillguard').gone, ['a second TRIF instruction', 'a second TRIF screenshot']);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: claude.ai\'s code blocks as they are now (11-18, "pre.code-block__code code.language-js code": a code of line numbers inside the code) read without their numbers; a reply that finished unseen (the app in the background) not offered but counted for the banner, its Add to TRIF there and shown', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    for (const shape of ['nested', 'nested=inline']) {
      await page.goto(`${base}/chat.html?${shape}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      const say = (t) => page.evaluate((w) => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, w); }, t);
      await say('Make the headings green on http://127.0.0.1:9/');
      await page.click('button[aria-label="Send message"]');
      const [done] = await waitPost(page, 'done');
      assert.equal(await page.evaluate(() => document.querySelectorAll('pre.code-block__code > code.language-js').length), 1, shape);
      assert.equal(done.mods.length, 1, shape);
      assert.match(done.mods[0], /^\/\/ ==WebMod==\n\/\/ @name {8}Calmer feed\n/, shape);
      assert.doesNotMatch(done.mods[0], /^\d/m, `${shape}: no line numbers`);
      assert.deepEqual(Object.keys(JSON.parse(done.mods[0].split('==/WebMod==')[1])), ['css', 'hide']);
      // (Add to TRIF hands over the same text; the line numbers are still on the page after the read)
      await page.click('.trif-add');
      const [mod] = await waitPost(page, 'mod');
      assert.equal(mod.text.trim(), done.mods[0].trim());
      assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.react-syntax-highlighter-line-number')).display !== 'none'));

      // A reply found finished (as after the app's page was suspended): not offered, held, counted as waiting.
      await say('whole: make it blue, called Bluer, on http://127.0.0.1:9/');
      await page.click('button[aria-label="Send message"]');
      const two = await waitPost(page, 'done', 2);
      assert.deepEqual(two[1].mods, [], shape);
      assert.equal(two[1].waiting, 1, shape);
      assert.ok((await posts(page)).some((m) => m.type === 'held' && m.history === 1 && m.anchored), shape);
      assert.ok(!(await posts(page)).some((m) => m.type === 'nopickup'), `${shape}: no "nopickup" when it was held`);
      assert.equal(await page.evaluate(() => globalThis.__trifChat.showReply(true)), 'shown at its mod');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.trif-add').length), 2);
      await page.evaluate(() => document.querySelectorAll('.trif-add')[1].click());
      const mods = await waitPost(page, 'mod', 2);
      assert.match(mods[1].text, /^\/\/ ==WebMod==\n/);
      assert.doesNotMatch(mods[1].text, /^\d/m);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: TRIF\'s greeting never drawn over the chat\'s own suggestions (Tim, 11-19, chatgpt.com signed in: a screenshot attached made the box taller and pushed ChatGPT\'s suggestions up under the greeting); placed in free space, small, or not at all; light and dark', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 90000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shape = { rim: '10,10 118,10 118,118 10,118', face: '24,24 104,24 104,104 24,104', eyes: ['40,50 56,50 56,70 40,70', '72,50 88,50 88,70 72,70'], colours: { rim: '#34d399', face: '#18181b', eye: '#34d399' } };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // (where the greeting is and what of the page's it covers: each suggestion, the box, the header)
  const where = (pg) => pg.evaluate(() => {
    const c = document.getElementById('trif-greeting');
    if (!c || c.hidden) return { shown: false };
    const r = c.getBoundingClientRect();
    const over = [...document.querySelectorAll('.suggest button, .composer, header')].filter((e) => { const q = e.getBoundingClientRect(); return q.bottom > r.top && q.top < r.bottom; }).map((e) => e.textContent.trim().slice(0, 30) || e.className);
    return { shown: true, tight: c.classList.contains('trif-tight'), top: Math.round(r.top), bottom: Math.round(r.bottom), over };
  });
  let browser;
  try {
    browser = await launch();
    for (const [w, h] of [[375, 471], [393, 640]]) {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage();
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await page.goto(`${base}/chat.html?greet&suggest&octane`);
        await page.addScriptTag({ content: STUB });
        await page.addScriptTag({ content: CHAT });
        await page.evaluate((s) => globalThis.__trifChat.look('facebook.com', s), shape);
        await page.waitForTimeout(300);
        const before = await where(page);
        assert.equal(before.shown, true, `${w}x${h} ${scheme}: the greeting in an empty chat`);
        assert.deepEqual(before.over, [], `${w}x${h} ${scheme}: nothing of the page's under it: ${JSON.stringify(before)}`);
        assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.png'), png), /picture pasted/);
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => document.querySelectorAll('.suggest button').length), 4, 'the image suggestions came');
        const after = await where(page);
        assert.deepEqual(after.shown ? after.over : [], [], `${w}x${h} ${scheme}: with the picture attached, nothing of the page's under it: ${JSON.stringify(after)}`);
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-trif-tone')), scheme);
        // (the heading the greeting stands in for: hidden only while the greeting shows)
        assert.equal(await page.evaluate(() => document.querySelector('h1.greet').hasAttribute('data-trif-greeting-hidden')), after.shown);
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: claude.ai\'s own greeting signed in (11-19: "Hello, night owl" with its starburst, no heading): TRIF\'s greeting in its place, the words and starburst hidden while it shows; light and dark', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 60000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shape = { rim: '10,10 118,10 118,118 10,118', face: '24,24 104,24 104,104 24,104', eyes: ['40,50 56,50 56,70 40,70', '72,50 88,50 88,70 72,70'], colours: { rim: '#34d399', face: '#18181b', eye: '#34d399' } };
  let browser;
  try {
    browser = await launch();
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage();
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 560, deviceScaleFactor: 2, mobile: true });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await page.goto(`${base}/chat.html?greet=claude`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      await page.evaluate((s) => globalThis.__trifChat.look('example.com', s), shape);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const c = document.getElementById('trif-greeting'), g = document.querySelector('.greet');
        const a = c.getBoundingClientRect(), b = g.getBoundingClientRect();
        return { shown: !c.hidden, hidden: g.hasAttribute('data-trif-greeting-hidden'), seen: getComputedStyle(g.querySelector('svg')).visibility,
          gap: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) };
      });
      assert.equal(r.shown, true, `${scheme}: TRIF's greeting shows`);
      assert.equal(r.hidden, true, `${scheme}: Claude's greeting block hidden: ${JSON.stringify(r)}`);
      assert.equal(r.seen, 'hidden', `${scheme}: its starburst too`);
      assert.ok(r.gap < 40, `${scheme}: in its place (centres ${r.gap} px apart)`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: chatgpt.com\'s picture tile signed in (11-19: a div[role=button] named by its aria-label, "(n)" on a name used before): TRIF\'s screenshot counted as TRIF\'s, made a pill (its × kept), and taken out with the rest', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 60000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html?octane`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    const state = async () => JSON.parse(await page.evaluate(() => globalThis.__trifChat.state()));
    assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), png), /picture pasted/);
    let s = await state();
    assert.equal(s.trif, 1, 'the picture is TRIF\'s');
    assert.equal(s.has, true);
    // (the person's own picture beside it: theirs, kept)
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'IMG_0001.png', { type: 'image/png' })); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(600);
    // (a second screenshot, as an old fill's: its name gets "(2)", still TRIF's)
    assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), png), /picture pasted/);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=button][aria-label]')].map((t) => t.getAttribute('aria-label'))), ['TRIF screenshot.jpg', 'IMG_0001.png', 'TRIF screenshot(2).jpg']);
    s = await state();
    assert.equal(s.trif, 2);
    assert.equal(s.others, true, 'the person\'s picture is theirs');
    // (TRIF's made a pill (Tim, 11-19: "the ChatGPT page still doesn't condense the screenshot into a pill"): its
    // words, no picture, a pill's height; its remove button still there and working; the person's picture untouched)
    await page.waitForTimeout(600);
    const look = await page.evaluate(() => {
      const t = document.querySelector('[aria-label="TRIF screenshot.jpg"]'), r = t.getBoundingClientRect(), x = t.querySelector('button').getBoundingClientRect();
      const mine = document.querySelector('[aria-label="IMG_0001.png"]').getBoundingClientRect();
      return { chip: t.getAttribute('data-trif-chip'), words: getComputedStyle(t, '::before').content, pill: r.height < 40 && r.width > 120, img: getComputedStyle(t.querySelector('img')).display,
        xShown: x.width > 0 && document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2) === t.querySelector('button'), mine: [Math.round(mine.width), Math.round(mine.height)] };
    });
    assert.deepEqual(look, { chip: 'TRIF screenshot', words: '"From TRIF: screenshot"', pill: true, img: 'none', xShown: true, mine: [80, 80] });
    await page.click('[aria-label="Remove TRIF screenshot(2).jpg"]');
    assert.equal((await state()).trif, 1, 'the pill\'s × takes it out');
    assert.equal(await page.evaluate(() => globalThis.__trifChat.clearTrif()), 0, 'all of TRIF\'s taken out');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=button][aria-label]')].map((t) => t.getAttribute('aria-label'))), ['IMG_0001.png']);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script on chatgpt.com\'s page of 11-20 (Tim\'s real send: no "working", no offer, no Add to TRIF, TRIF\'s greeting inside the conversation): the send seen as the new chat switches to the conversation\'s page; working while Stop shows; done → the mod offered; Add to TRIF under the code widget; the greeting gone once there are messages; the pages it keeps hidden never read', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shape = { rim: '10,10 118,10 118,118 10,118', face: '24,24 104,24 104,104 24,104', eyes: ['40,50 56,50 56,70 40,70'], colours: { rim: '#34d399', face: '#18181b', eye: '#34d399' } };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const greeting = (pg) => pg.evaluate(() => { const c = document.getElementById('trif-greeting'); return !!c && !c.hidden; });
  const state = (pg) => pg.evaluate(() => JSON.parse(globalThis.__trifChat.state()));
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 640, deviceScaleFactor: 2, mobile: true });
    await page.goto(`${base}/chat.html?thread`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.evaluate((s) => globalThis.__trifChat.look('127.0.0.1', s), shape);
    await page.waitForTimeout(300);
    assert.equal(await greeting(page), true, 'the greeting on the new chat');
    assert.equal(await page.evaluate(() => document.querySelector('.standin-home h1').hasAttribute('data-trif-greeting-hidden')), true, 'in place of ChatGPT\'s own');
    // (the fill: the instructions as a file, the screenshot as ChatGPT's picture tile, a pill each)
    assert.match(await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), "I'm looking at http://127.0.0.1:9/plain.html in TRIF\n--- How TRIF mods are written ---\n…"), /text attached/);
    assert.match(await page.evaluate((p) => globalThis.__trifChat.fill('', p, null, null, 'TRIF screenshot.jpg'), png), /picture pasted/);
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-trif-chip]')].map((t) => t.getAttribute('data-trif-chip')).sort()), ['TRIF instruction', 'TRIF screenshot']);
    assert.equal((await state(page)).context, false);
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'Make the headings green'); });
    await page.click('button[aria-label="Send"]');
    const [sent] = await waitPost(page, 'sent');
    assert.equal(sent.withInstructions, true);
    assert.equal(sent.how, 'button');
    // (the home view kept hidden, frozen with the message, "Thinking" and a Stop: never the page in front)
    await page.waitForFunction(() => (document.querySelector('.standin-kept [aria-label="Stop"]') && document.querySelector('[data-turn-key]') ? [1] : null), {}, { timeoutMs: 5000 });
    // (a provisional address first, its own 2 s later, mid-reply: the same conversation, the watch goes on)
    assert.match(await page.evaluate(() => location.pathname), /^\/c\/local-chatgpt%3A/);
    await page.waitForFunction(() => (/^\/c\/[a-z0-9]+$/.test(location.pathname) ? [1] : null), {}, { timeoutMs: 5000 });
    // (working while the conversation's Stop shows; the greeting gone with the person's message there)
    await page.waitForFunction(() => (document.querySelector('form [aria-label="Stop"]') ? [1] : null), {}, { timeoutMs: 5000 });
    assert.equal((await state(page)).replying, true);
    assert.equal(await greeting(page), false, 'no greeting in the conversation');
    const [done] = await waitPost(page, 'done');
    assert.equal(done.why, 'done');
    assert.equal(done.stop, true);
    assert.equal(done.replies, 1);
    assert.equal(done.mods.length, 1);
    assert.match(done.mods[0], /^\/\/ ==WebMod==\n\/\/ @name\s+Calmer feed[\s\S]*@match\s+http:\/\/127\.0\.0\.1\/\*[\s\S]*==\/WebMod==\n\{/);
    assert.deepEqual(Object.keys(JSON.parse(done.mods[0].split('==/WebMod==')[1])), ['css', 'hide']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-talvt-turn-state]').getAttribute('data-talvt-turn-state')), 'complete');
    // (Add to TRIF: one, right after the code widget, inside the reply; its tap hands over the same text)
    await page.waitForFunction(() => (document.querySelector('.trif-add') ? [1] : null), {}, { timeoutMs: 5000 });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.trif-add')].map((b) => [b.textContent, b.previousElementSibling.matches('[data-code-block]'), !!b.closest('[data-response-body]')])), [['Add to TRIF', true, true]]);
    await page.click('.trif-add');
    const [tap] = await waitPost(page, 'mod');
    assert.equal(tap.text, done.mods[0]);
    // (scrolled: still no greeting, it doesn't come back as the conversation moves)
    await page.evaluate(() => { const l = document.getElementById('log'); l.scrollTop = 0; l.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
    assert.equal(await greeting(page), false);
    assert.equal((await state(page)).context, true, 'the conversation has the instructions');
    // A second message in the conversation: seen, and its mod offered (the earlier one not again).
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); document.execCommand('insertText', false, 'Now two: also the cookie box'); });
    await page.click('button[aria-label="Send"]');
    await waitPost(page, 'sent', 2);
    const doneTwo = await waitPost(page, 'done', 2);
    assert.deepEqual(doneTwo[1].mods.map((m) => m.match(/@name\s+(.+)/)[1].trim()), ['Calmer feed', 'No cookie box']);
    // ChatGPT's New chat: the conversation kept hidden; the new chat is empty: the greeting back, no instructions in it,
    // nothing of the hidden conversation's offered or marked again
    const added = await page.evaluate(() => document.querySelectorAll('.trif-add').length);
    await page.click('#new-chat');
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.querySelector('.standin-kept [data-turn-key]') !== null), true);
    assert.equal(await greeting(page), true, 'the greeting on the new chat, the old conversation hidden');
    const st = await state(page);
    assert.equal(st.context, false, 'the hidden conversation\'s instructions aren\'t this chat\'s');
    assert.equal(st.working, false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.trif-add').length), added);
    assert.equal((await posts(page)).filter((m) => m.type === 'done').length, 2);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: edit blocks (Tim, 11-19: changes to a mod, not its whole file again): a reply\'s edit blocks, two code blocks, handed over together; one "Add 2 changes to TRIF" after the last; an edit quoting a header isn\'t a mod; Claude\'s and ChatGPT\'s pages', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mod = '// ==WebMod==\n// @name        Calmer feed\n// @match       http://127.0.0.1/*\n// @style\n// ==/WebMod==\n{\n  "css": ".feed-item h2 { color: #1f8a5b }",\n  "hide": [\n    "#promo-banner"\n  ]\n}';
  const fill = `I'm looking at ${base}/plain.html in TRIF\n--- Already changing this page (build on these) ---\n### Calmer feed (style mod) · edit with: TRIF edit 127.0.0.1/calmer-feed 1a2b3c4d\n\`\`\`js\n${mod}\n\`\`\`\n--- End of what TRIF sent ---`;
  let browser;
  try {
    browser = await launch();
    for (const query of ['', '?octane&cm&gpt', '?thread']) {
      const page = await browser.newPage();
      await page.goto(`${base}/chat.html${query}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF follow-up.txt', null, null), fill);
      await page.evaluate(() => { const ed = document.querySelector('.ProseMirror, #prompt-textarea, [contenteditable="true"]'); ed.focus(); document.execCommand('insertText', false, ' edit two ask blue'); });
      await page.evaluate(() => document.querySelector('.ProseMirror, #prompt-textarea, [contenteditable="true"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
      await waitPost(page, 'sent');
      const [done] = await waitPost(page, 'done');
      assert.equal(done.mods.length, 1, `${query}: one hand-over for the reply's edits`);
      const t = done.mods[0];
      assert.match(t, /^TRIF edit 127\.0\.0\.1\/calmer-feed 1a2b3c4d\n<<<<<<< SEARCH\n {2}"css": "\.feed-item h2 \{ color: #1f8a5b \}",\n=======\n {2}"css": "\.feed-item h2 \{ color: #b5179e \/\* blue \*\/ \}",\n>>>>>>> REPLACE/, query);
      assert.match(t, /\n\n<<<<<<< SEARCH\n {2}"hide": \[\n=======\n {2}"hide": \[\n {4}"#standin-edited",\n>>>>>>> REPLACE$/, query);
      // (the button: one, after the last edit block, its count of changes)
      await page.waitForFunction(() => (document.querySelector('.trif-add') ? [1] : null), {}, { timeoutMs: 8000 });
      // (after the last code block: its outermost element, ChatGPT's [data-code-block] widget since 11-20)
      const buttons = await page.evaluate(() => [...document.querySelectorAll('.trif-add')].map((b) => [b.textContent, b.hasAttribute('data-trif-edit'),
        b.previousElementSibling === [...document.querySelectorAll('[data-code-block], pre, .cm-editor')].filter((x) => !x.parentElement.closest('[data-code-block], pre, .cm-editor')).pop()]));
      assert.deepEqual(buttons, [['Add 2 changes to TRIF', true, true]], query);
      await page.click('.trif-add');
      const [tap] = await waitPost(page, 'mod');
      assert.equal(tap.text, t, `${query}: the tap hands over the same text`);
      await page.close();
    }
    // (an edit block quoting a mod's header lines (==WebMod== in its SEARCH) is an edit, not a mod; a whole mod beside it is a mod)
    const page = await browser.newPage();
    await page.goto(`${base}/chat.html`);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    await page.evaluate((m) => {
      const r = document.createElement('div'); r.setAttribute('data-is-streaming', 'false'); r.className = 'font-claude-response';
      const pre = (t) => { const p = document.createElement('pre'); const c = document.createElement('code'); c.textContent = t; p.append(c); return p; };
      r.append(pre(`TRIF edit a.com/b 0000aaaa\n<<<<<<< SEARCH\n// ==WebMod==\n// @name        B\n// ==/WebMod==\n=======\n// ==WebMod==\n// @name        B2\n// ==/WebMod==\n>>>>>>> REPLACE`), pre(m));
      document.querySelector('main, body').append(r);
    }, mod);
    await page.waitForFunction(() => (document.querySelectorAll('.trif-add').length >= 2 ? [1] : null), {}, { timeoutMs: 8000 });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.trif-add')].map((b) => b.textContent)), ['Add 1 change to TRIF', 'Add to TRIF']);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: a reply picked up after TRIF wasn\'t running (Tim, 11-20: "is there a way to automatically pick up the fact that there\'s a new mod when the app restarts?"): the send told with its fingerprint; the conversation loaded again, the reply after that message handed over though TRIF never saw it written, an older reply\'s mod never; by its place when it has no fingerprint; not found, nothing; a reply still being written, watched to its end; Claude\'s and ChatGPT\'s pages', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 150000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    for (const [query, sendButton] of [['keep', 'Send message'], ['thread&keep', 'Send']]) {
      await page.goto(`${base}/chat.html?${query}`);
      await page.addScriptTag({ content: STUB });
      await page.addScriptTag({ content: CHAT });
      const say = async (t) => {
        await page.evaluate((w) => { const ed = [...document.querySelectorAll('.ProseMirror')].filter((e) => e.getClientRects().length).pop(); ed.focus(); document.execCommand('insertText', false, w); }, t);
        await page.evaluate((b) => [...document.querySelectorAll(`button[aria-label="${b}"]`)].filter((e) => e.getClientRects().length).pop().click(), sendButton);
      };
      // (the instructions attached, then the person's words: the fingerprint is of their words only)
      assert.match(await page.evaluate((t) => globalThis.__trifChat.fill(t, null, 'TRIF instruction.txt', null, null), "I'm looking at http://127.0.0.1:9/plain.html in TRIF\n--- How TRIF mods are written ---\n…"), /text attached/);
      await say('Make the headings green, called Older, on http://127.0.0.1:9/');
      const [first] = await waitPost(page, 'sent');
      await waitPost(page, 'done');
      await say('Now make them blue please, called Bluer, on http://127.0.0.1:9/');
      const [, sent] = await waitPost(page, 'sent', 2);
      assert.match(sent.print, /^32:[0-9a-f]{8}$/, `${query}: a fingerprint of the words`);
      assert.notEqual(sent.print, first.print, query);
      assert.equal(typeof sent.users, 'number', query);
      const done2 = await waitPost(page, 'done', 2);
      assert.equal(done2[1].mods.length, 1, `${query}: the live reply as before`);
      const conv = await page.evaluate(() => location.pathname);
      assert.match(conv, /^\/(chat|c)\/k-/, query);

      // The app ended: the conversation loaded again, both exchanges drawn finished (the person's messages without
      // their file names), nothing being written. The note's message found by its words; only its reply's mod.
      const reopen = async () => {
        await page.goto(`${base}${conv}?${query}`);
        await page.addScriptTag({ content: STUB });
        await page.addScriptTag({ content: CHAT });
        await page.waitForFunction(() => (document.querySelectorAll('pre').length >= 2 ? [1] : null), {}, { timeoutMs: 10000 });
      };
      await reopen();
      assert.equal(await page.evaluate((n) => globalThis.__trifChat.resume(n), { print: sent.print, users: sent.users }), 'picking up');
      const [picked] = await waitPost(page, 'done');
      assert.equal(picked.mode, 'pickup', query);
      assert.equal(picked.anchored, true, query);
      assert.equal(picked.mods.length, 1, `${query}: the noted reply's mod`);
      assert.match(picked.mods[0], /@name {8}Bluer/, query);
      assert.ok(!picked.mods.some((m) => /Older/.test(m)), `${query}: never the older reply's`);

      // The first message's note: its reply, and not the later one (the person's next message ends it).
      await reopen();
      await page.evaluate((n) => globalThis.__trifChat.resume(n), { print: first.print, users: first.users });
      const [older] = await waitPost(page, 'done');
      assert.deepEqual(older.mods.map((m) => /@name {8}(\w+)/.exec(m)[1]), ['Older'], query);

      // No fingerprint (too few words): by its place, the person's messages before it.
      await reopen();
      await page.evaluate((n) => globalThis.__trifChat.resume(n), { print: null, users: sent.users });
      const [byPlace] = await waitPost(page, 'done');
      assert.deepEqual(byPlace.mods.map((m) => /@name {8}(\w+)/.exec(m)[1]), ['Bluer'], query);

      // A message that isn't there (another conversation's note, a long one not drawn): nothing, said so.
      await reopen();
      await page.evaluate(() => globalThis.__trifChat.resume({ print: '32:00000000', users: 0 }));
      const [none] = await waitPost(page, 'done');
      assert.equal(none.anchored, false, query);
      assert.deepEqual(none.mods, [], query);

      // A reply still being written when it's picked up: watched to its end, then handed over.
      await reopen();
      await say('Make the links red, called Redder, wait 4, on http://127.0.0.1:9/');
      const [live] = await waitPost(page, 'sent');
      await page.evaluate((n) => globalThis.__trifChat.resume(n), { print: live.print, users: live.users });
      const dones = await waitPost(page, 'done');
      const end = dones[dones.length - 1];
      assert.equal(end.mode, 'pickup', query);
      assert.deepEqual(end.mods.map((m) => /@name {8}(\w+)/.exec(m)[1]), ['Redder'], `${query}: the reply written after the pickup began`);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

test('the chat script: TRIF\'s chats in a project (Tim, 11-20: "set up in one tap"): the first-use card under the greeting, its answers told; claude.ai\'s and chatgpt.com\'s new-project forms filled and their Create only watched (never pressed by TRIF); the project\'s instructions box opened and filled, the person\'s Save told; a gone project\'s page said so', { skip: browserTestsSkip(), timeout: LOCK_WAIT + 120000 }, async () => {
  const server = http.createServer(handler(() => {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shape = { rim: '10,10 118,10 118,118 10,118', face: '24,24 104,24 104,104 24,104', eyes: ['40,50 56,50 56,70 40,70', '72,50 88,50 88,70 72,70'], colours: { rim: '#34d399', face: '#18181b', eye: '#34d399' } };
  const open = async (browser, url) => {
    const page = await browser.newPage();
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 560, deviceScaleFactor: 2, mobile: true });
    await page.goto(url);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: CHAT });
    return page;
  };
  // (every submit and every click on a Create / Save button the page sees, with whether it was a real (trusted) one)
  const WATCH = `window.__presses = []; document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && /create|save|send/i.test(b.textContent)) window.__presses.push(b.textContent.trim()); }, true);
    document.addEventListener('submit', (e) => window.__presses.push('submit'), true);`;
  let browser;
  try {
    browser = await launch();
    // (the card: drawn under the greeting with the service's name, told once it has stayed 2 s; Not now told; gone)
    let page = await open(browser, `${base}/chat.html?greet=claude`);
    await page.evaluate((s) => globalThis.__trifChat.look('example.com', s, 'Claude'), shape);
    await page.waitForTimeout(400);
    const card = await page.evaluate(() => { const o = document.querySelector('#trif-greeting .trif-offer'); return { shown: !!o && !o.hidden && o.getBoundingClientRect().height > 0, words: o && o.textContent }; });
    assert.equal(card.shown, true, 'the card shows');
    assert.match(card.words, /Keep TRIF chats in their own project\?.*in Claude.*recent chats.*Set it up.*Not now/);
    assert.equal((await posts(page)).filter((m) => m.type === 'projoffer').length, 0, 'not told before it has stayed 2 s');
    await waitPost(page, 'projoffer');
    await page.evaluate(() => document.querySelector('#trif-greeting .trif-later').click());
    assert.deepEqual((await posts(page)).filter((m) => m.type === 'project'), [{ type: 'project', what: 'later' }]);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#trif-greeting .trif-offer').hidden), true, 'gone at once');
    // (no card when the app doesn't offer it; none while a fill goes in)
    await page.evaluate((s) => globalThis.__trifChat.look('example.com', s, ''), shape);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#trif-greeting .trif-offer').hidden), true, 'not offered: no card');
    await page.close();

    // (claude.ai's form: name and description filled, Create enabled, never pressed; the person's Create told)
    page = await open(browser, `${base}/projects/create`);
    await page.evaluate(WATCH);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.projectForm({ name: 'TRIF', description: 'Mods for websites, made in the TRIF app.' })), 'filled');
    const f = await page.evaluate(() => ({ name: document.getElementById('np-name').value, desc: document.getElementById('np-desc').value, create: document.querySelector('.create').disabled, hint: (document.getElementById('trif-hint') || {}).textContent }));
    assert.deepEqual(f, { name: 'TRIF', desc: 'Mods for websites, made in the TRIF app.', create: false, hint: 'Tap Create project to make it. TRIF fills in its instructions next: one more tap.' });
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.__presses), [], 'TRIF pressed nothing');
    const [, nav] = await Promise.all([page.evaluate(() => document.querySelector('.create').click()), page.waitForFunction(() => /^\/project\/p-/.test(location.pathname) || null, null, { timeoutMs: 8000 }).catch(() => null)]);
    // (the page left: its posts went with it; the create is seen before it goes)
    assert.ok(nav !== undefined);
    await page.close();

    // (chatgpt.com's: the side bar opened, its + pressed, the form filled; Create never pressed; closed: told)
    page = await open(browser, `${base}/chat.html?gpt&gptin`);
    await page.evaluate(WATCH);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.projectForm({ name: 'TRIF' })), 'filled');
    assert.equal(await page.evaluate(() => document.getElementById('chatgpt-project-name').value), 'TRIF');
    assert.equal(await page.evaluate(() => document.getElementById('chatgpt-project-name').form.querySelector('button[type=submit]').disabled), false);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.__presses), [], 'TRIF pressed nothing');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close dialog').click());
    assert.deepEqual((await waitPost(page, 'projform')).map((m) => m.what), ['closed']);
    await page.close();

    // (a project's page: claude's "Set project instructions", chatgpt's ••• → Project settings; filled, Save watched)
    for (const kind of ['claude', 'chatgpt']) {
      const made = await new Promise((r) => { const q = http.request(`${base}/standin-project`, { method: 'POST' }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => r(JSON.parse(b).id)); }); q.end(JSON.stringify({ service: kind, name: 'TRIF' })); });
      page = await open(browser, kind === 'claude' ? `${base}/project/${made}` : `${base}/g/g-p-${made}-trif/project`);
      await page.evaluate(WATCH);
      assert.equal(await page.evaluate(() => globalThis.__trifChat.projectGuide({ text: 'This project is for making TRIF mods: test.' })), 'filled', kind);
      assert.equal(await page.evaluate(() => document.getElementById('pi-text').value), 'This project is for making TRIF mods: test.');
      assert.equal(await page.evaluate(() => document.body.hasAttribute('data-standin-deleted')), false, `${kind}: Delete project never pressed`);
      assert.deepEqual(await page.evaluate(() => window.__presses), [], `${kind}: TRIF pressed nothing`);
      await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^Save/.test(b.textContent)).click());
      assert.deepEqual((await waitPost(page, 'projguide')).map((m) => m.what), ['saved'], kind);
      // (filled again: TRIF's text is in it already)
      assert.equal(await page.evaluate(() => globalThis.__trifChat.projectGuide({ text: 'This project is for making TRIF mods: test.' })), 'already', `${kind}: already`);
      assert.equal(await page.evaluate(() => globalThis.__trifChat.projectMissing()), 'there');
      await page.close();
    }
    // (a deleted project's page: not found)
    page = await open(browser, `${base}/project/p-00000000`);
    assert.equal(await page.evaluate(() => globalThis.__trifChat.projectMissing()), 'missing');
    await page.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
