'use strict';
// The message box's microphone (extension/dictation.js) in a real browser, with a stand-in recogniser (no real
// microphone, no speech service: what's said can't be tested here, Tim tries it): TRIF's own extension in headless
// Chrome for Testing (tests/cdp-page.js: muted, one browser at a time, the memory guard), its panel as a window
// following a window with a local page. Checks the button's states (off; on but not yet listening; listening only
// once the recogniser has started), its names and the shortcut, the words being heard under the box’s text and only finished
// ones in it, a recogniser that ends being followed by a new one, the person's stop (button, shortcut, Escape)
// keeping the words and sending nothing, the first listen's line about where the audio goes, mic.html asking for the
// microphone in a tab when the panel couldn't (Chrome's fake media UI answers it) and closing itself, the red note
// when blocked, and that the mic never covers Send or Stop. DICTATION_SHOTS=<dir> saves screenshots there.
// With TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { browserTestsSkip, launch } = require('./cdp-page');
const { servePhonePages, extensionCopy, harness } = require('./phone-pages');
const { waitFor } = require('./e2e/lib/util');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Before the panel's own scripts: the helper as connected (status replies), what the panel sends kept in
// window.__sent, a stand-in SpeechRecognition the test drives, and the microphone's permission as window.__perm says
// (unset: the browser's own).
const STUB = `(() => {
  window.__sent = [];
  const rt = chrome.runtime;
  const connect = rt.connect.bind(rt);
  rt.connect = (...a) => {
    const port = connect(...a);
    const fns = [];
    const status = new Set();
    port.onMessage.addListener((m) => {
      if (m && m.type === 'reply' && status.has(m.reqId) && m.ok && m.result && m.result.helper) { m.result.helper.connected = true; m.result.browser = 'Chrome'; }
      for (const fn of fns) fn(m);
    });
    port.onMessage.addListener = (fn) => { fns.push(fn); };
    const post = port.postMessage.bind(port);
    port.postMessage = (msg) => {
      if (msg && msg.type) window.__sent.push(msg.type);
      if (msg && msg.type === 'status') status.add(msg.reqId);
      post(msg);
    };
    return port;
  };
  window.__rec = [];
  window.__deny = 0; // how many starts are refused the microphone ('not-allowed')
  class FakeRecognition {
    constructor() { window.__rec.push(this); }
    start() {
      this.started = true;
      setTimeout(() => {
        if (window.__deny > 0) { window.__deny--; this.onerror?.({ error: 'not-allowed' }); this.onend?.({}); return; }
        this.onstart?.({});
      }, 150);
    }
    stop() { this.stopped = true; setTimeout(() => this.onend?.({}), 30); }
    abort() { this.aborted = true; }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
  window.__say = (list) => window.__rec.at(-1).onresult({ resultIndex: 0, results: list.map(([t, f]) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: !!f })) });
  window.__end = () => window.__rec.at(-1).onend({});
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (window.__perm && d && d.name === 'microphone' ? Promise.resolve({ state: window.__perm, addEventListener() {} }) : query(d));
})();`;

const LOOK = `(() => {
  const b = document.getElementById('mic');
  const note = document.querySelector('.dictation-note');
  const live = document.querySelector('.dictation-live');
  const r = (e) => { if (!e || e.hidden) return null; const x = e.getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; };
  return {
    shown: !!b && !b.hidden && b.offsetParent !== null, label: b?.getAttribute('aria-label'), pressed: b?.getAttribute('aria-pressed'),
    title: b?.title, keys: b?.getAttribute('aria-keyshortcuts'), listening: !!b?.classList.contains('listening'), disabled: !!b?.disabled,
    note: note && !note.hidden ? note.innerText : '', noteBad: !!note?.classList.contains('bad'), noteRole: note?.getAttribute('role'),
    fix: !!note?.querySelector('.dictation-fix'), live: live && !live.hidden ? live.textContent : '', text: document.getElementById('input').value,
    rec: window.__rec.length, sent: window.__sent.filter((t) => /^(agent\\.start|chat\\.queue|chat\\.sendNow)$/.test(t)),
    rects: { mic: r(b), send: r(document.getElementById('send')), stop: r(document.getElementById('stop')), composer: r(document.getElementById('composer')) },
  };
})()`;

const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

test('the mic in the message box: its states, the words, the shortcut, the stop that never sends, the first-time tab', { skip, timeout: 600000 }, async () => {
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  // (Chrome's own fake microphone and an automatic Allow for mic.html's question: nothing real is recorded)
  const browser = await launch({ extension: ext, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const shots = process.env.DICTATION_SHOTS ? path.resolve(process.env.DICTATION_SHOTS) : null;
  try {
    const h = await harness(browser);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    const win = await h.E((url) => chrome.windows.create({ url, focused: false }).then((w) => w.id), pages.url('/detect'));
    await h.E((id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?window=${id}`), focused: false, type: 'popup', width: 380, height: 640 }), win);
    const t = await waitFor('the panel', async () => (await browser.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes(`/sidepanel.html?window=${win}`)));
    const sid = await browser._attach(t.targetId);
    await browser.cdp.send('Page.enable', {}, sid);
    await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB }, sid);
    await browser.cdp.send('Page.reload', {}, sid);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 640, deviceScaleFactor: 2, mobile: false }, sid);
    await sleep(800);
    const ev = async (expr) => {
      const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const look = () => ev(LOOK);
    const until = (what, fn) => waitFor(what, async () => { const v = await look(); return fn(v) ? v : null; }, { timeoutMs: 10000, intervalMs: 50 });
    const key = async (k, { ctrl, shift } = {}) => {
      const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const codes = { ' ': ['Space', 32], Escape: ['Escape', 27] };
      const [code, kc] = codes[k];
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: kc, modifiers }, sid);
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: kc, modifiers }, sid);
    };
    const shot = async (name) => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };

    // Off: shown, named, the shortcut in its tooltip, and nowhere over Send (nor Stop while the agent works)
    let v = await until('the mic', (x) => x.shown && !x.disabled);
    assert.deepEqual([v.label, v.pressed, v.title, v.keys, v.listening], ['Dictate', 'false', 'Dictate (Ctrl+Shift+Space)', 'Control+Shift+Space', false]);
    assert.ok(!overlap(v.rects.mic, v.rects.send), 'the mic beside Send');
    await ev(`document.getElementById('composer').classList.add('busy'); document.getElementById('stop').hidden = false;`);
    v = await look();
    assert.ok(!overlap(v.rects.mic, v.rects.send) && !overlap(v.rects.mic, v.rects.stop) && !overlap(v.rects.send, v.rects.stop), 'mic, Send and Stop side by side');
    await shot('1-busy');
    await ev(`document.getElementById('composer').classList.remove('busy'); document.getElementById('stop').hidden = true;`);
    await shot('2-off');

    // Pressed: on, but "listening" only once the recogniser has started
    await ev(`(() => { const i = document.getElementById('input'); i.value = 'Make the header'; i.focus(); })()`);
    await ev(`document.getElementById('mic').click()`);
    v = await look();
    assert.equal(v.pressed, 'true');
    assert.equal(v.listening, false, 'not listening before the recogniser started');
    v = await until('listening', (x) => x.listening);
    assert.equal(v.label, 'Stop dictating');
    assert.match(v.title, /Stop dictating \(Ctrl\+Shift\+Space\)\. Your words stay in the box\./);
    assert.match(v.note, /Chrome sends what you say to Google to turn it into text\./, 'the first listen says where the audio goes');
    assert.equal(v.noteBad, false);

    // The words: being heard under the box’s text, finished ones into it after what was there
    await ev(`window.__say([['smaller', false]])`);
    v = await look();
    assert.equal(v.live, 'smaller');
    assert.equal(v.text, 'Make the header');
    await shot('3-listening');
    await ev(`window.__say([['smaller and blue', true]])`);
    v = await look();
    assert.equal(v.text, 'Make the header smaller and blue');
    assert.equal(v.live, '');

    // The recogniser ends by itself: a new one, still on
    await ev(`window.__end()`);
    v = await until('a new recogniser', (x) => x.rec === 2 && x.listening);
    assert.equal(v.pressed, 'true');
    await ev(`window.__say([['and hide the logo', true]])`);

    // The shortcut stops it: the words stay, nothing is sent
    await key(' ', { ctrl: true, shift: true });
    v = await until('stopped', (x) => x.pressed === 'false');
    assert.equal(v.listening, false);
    assert.equal(v.text, 'Make the header smaller and blue and hide the logo');
    assert.deepEqual(v.sent, [], 'stopping never sends');
    assert.equal(v.note, '', 'the first-use line goes with the first listen');
    // ... and starts it; Escape in the box stops it
    await key(' ', { ctrl: true, shift: true });
    await until('listening again', (x) => x.listening && x.rec === 3);
    assert.equal((await look()).note, '', 'the first-use line only once');
    await ev(`document.getElementById('input').focus()`);
    await key('Escape');
    v = await until('stopped by Escape', (x) => x.pressed === 'false');
    assert.deepEqual(v.sent, []);
    assert.equal(v.text, 'Make the header smaller and blue and hide the logo');

    // The microphone refused in the panel, the question never shown: mic.html asks in a tab, then closes itself
    const micTabs = async () => (await browser.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page' && x.url.includes('/mic.html'));
    await ev(`window.__deny = 1`);
    await ev(`document.getElementById('mic').click()`);
    await waitFor('mic.html', async () => ((await micTabs()).length ? true : null), { timeoutMs: 10000, intervalMs: 50 });
    v = await until('listening after the tab allowed it', (x) => x.listening);
    assert.equal(v.note, '');
    await waitFor('mic.html closed itself', async () => ((await micTabs()).length === 0 ? true : null), { timeoutMs: 10000, intervalMs: 100 });
    await ev(`document.getElementById('mic').click()`);
    await until('stopped', (x) => x.pressed === 'false');

    // Blocked: a plain red note with the fix, not pressed, not listening
    await ev(`window.__perm = 'denied'`);
    await ev(`document.getElementById('mic').click()`);
    v = await until('the red note', (x) => x.noteBad);
    assert.equal(v.pressed, 'false');
    assert.equal(v.listening, false);
    assert.match(v.note, /The microphone is blocked for TRIF\. Allow it in Chrome’s settings, then press the mic again\./);
    assert.equal(v.noteRole, 'alert');
    assert.equal(v.fix, true, 'Open microphone settings');
    await shot('4-blocked');
    assert.deepEqual(v.sent, []);
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
});
