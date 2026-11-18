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
    assert.deepEqual(JSON.parse(await page.evaluate(() => globalThis.__trifChat.state())), { editor: true, usable: true, viewer: null, has: false, trif: 0, others: false, context: false, working: false, replying: false });
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

test('the chat script: TRIF\'s file attached through the page\'s file input when a paste goes in as text (chatgpt.com, 11-16); what TRIF put in, seen and taken out', { skip: browserTestsSkip(), timeout: 60000 }, async () => {
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

test('the chat script: a file opened in the chat\'s viewer (Claude\'s, 11-16): its code read off the screen for Add this mod?, and no fill while the viewer covers the message box', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
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

test('the chat script on chatgpt.com\'s newer mobile page (11-16): pictures-only file inputs, li[data-message-role] messages, a pause mid-reply, code as editor lines', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
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

test('the chat script: a long conversation\'s older messages that render late (Tim, 11-17: "spurious asks to add old code"): their old mods never offered, by the reply or late; a viewer the chat reopens with no tap isn\'t either', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
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

test('the chat script: the person\'s own code (Tim, 11-18: "When I paste code into Claude in the app, the app reads it as a mod"): pasted in the message box, sent as a code block or a pasted-text card, never offered nor given Add to TRIF; the assistant\'s mod still is', { skip: browserTestsSkip(), timeout: 120000 }, async () => {
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

test('the chat script: an old conversation (Tim, 11-18: "opening an old chat gets spurious pickups of old code"): loading in pieces, its messages late, drawn again on scroll-up, a reload watched again, the chat switched to it mid-reply: none of its mods offered; a new live reply still is, and /new → /chat/<id> keeps the watch', { skip: browserTestsSkip(), timeout: 150000 }, async () => {
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

test('the chat script: a quick ask (Tim, 11-18): the request goes in the box and TRIF never sends (no scripted click, Enter or submit); the person\'s own Send is told once; their message appearing counts as the send; the request taken out again', { skip: browserTestsSkip(), timeout: 90000 }, async () => {
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
