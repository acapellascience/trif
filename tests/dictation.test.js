'use strict';
// The message box's microphone (extension/dictation.js createDictation) with a stand-in recogniser: it never stops
// by itself (a recogniser that ends is followed by a new one while the person hasn't stopped), the words only
// accumulate (what's in the box stays; heard words show, only finished ones go in), only the person's stop ends it
// and that never sends, "listening" only from the recogniser's own start, and the errors: blocked / no microphone
// / service off stop with a red note, a pause carries on quietly, the network is retried with a growing pause.
// The button, the note and the shortcut in a real browser: tests/dictation-browser.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../extension/dictation.js');
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/** A stand-in for SpeechRecognition: every instance kept; the test drives its events. */
function fakeClass() {
  const made = [];
  class FakeRecognition {
    constructor() { this.started = false; this.stopped = false; this.aborted = false; made.push(this); }
    start() { if (this.started) throw new Error('InvalidStateError'); this.started = true; }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    // what the browser would do
    begin() { this.onstart?.({}); }
    results(list) {
      const results = list.map(([text, final]) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: !!final }));
      this.onresult?.({ resultIndex: 0, results });
    }
    error(code) { this.onerror?.({ error: code }); }
    end() { this.onend?.({}); }
  }
  return { FakeRecognition, made, last: () => made[made.length - 1] };
}

/** A dictation with a box, a clock and timers of its own. */
async function setup(over = {}) {
  const { createDictation } = await load();
  const fake = fakeClass();
  let text = over.text ?? '';
  let clock = 1000;
  const timers = [];
  const sent = [];
  let changes = 0;
  const d = createDictation({
    Recognition: fake.FakeRecognition,
    lang: 'en-US',
    browser: over.browser || 'Chrome',
    getText: () => text,
    setText: (t) => { text = t; },
    changed: () => { changes++; },
    permission: async () => over.permission ?? 'granted',
    askPage: over.askPage === undefined ? null : over.askPage,
    canPrompt: over.canPrompt ?? true,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, on: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.on = false; },
  });
  const advance = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.on && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock = Math.max(clock, due.at);
      due.on = false;
      due.fn();
      await tick();
    }
    clock = end;
    await tick();
  };
  return { d, fake, text: () => text, setText: (t) => { text = t; }, advance, sent, changes: () => changes, pending: () => timers.filter((t) => t.on) };
}

test('it says listening only once the recogniser has started; interim shows, only finals go in the box, after what was there', async () => {
  const s = await setup({ text: 'Make the header' });
  await s.d.start();
  assert.equal(s.d.view().phase, 'starting');
  assert.equal(s.d.view().listening, false, 'not listening before the recogniser says so');
  const r = s.fake.last();
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(r.lang, 'en-US');
  r.begin();
  assert.equal(s.d.view().listening, true);
  r.results([['smaller', false]]);
  assert.equal(s.d.view().interim, 'smaller');
  assert.equal(s.text(), 'Make the header', 'interim words are not committed');
  r.results([['smaller and blue', true], [' and hide', false]]);
  assert.equal(s.text(), 'Make the header smaller and blue');
  assert.equal(s.d.view().interim, 'and hide');
  r.results([['smaller and blue', true], [' and hide the logo', true]]);
  assert.equal(s.text(), 'Make the header smaller and blue and hide the logo', 'each final once, in order');
  assert.equal(s.d.view().interim, '');
});

test('it never stops by itself: a recogniser that ends is followed by a new one, words kept across', async () => {
  const s = await setup();
  await s.d.start();
  let r = s.fake.last();
  r.begin();
  r.results([['first part', true]]);
  // Chrome ends a continuous session after a pause: a 'no-speech' error, then end
  await s.advance(8000);
  r.error('no-speech');
  r.end();
  assert.equal(s.d.view().active, true);
  await s.advance(0);
  assert.equal(s.fake.made.length, 2, 'a new recogniser started');
  r = s.fake.last();
  assert.equal(r.started, true);
  assert.equal(s.d.view().listening, true, 'no "starting" flash on a seamless restart');
  assert.equal(s.d.view().note, null, 'a pause says nothing');
  r.begin();
  r.results([['second part', true]]);
  assert.equal(s.text(), 'first part second part');
  // an hour of sessions ending by themselves: it keeps going
  for (let i = 0; i < 40; i++) {
    r = s.fake.last();
    r.begin();
    await s.advance(60000);
    r.end();
    await s.advance(0);
  }
  assert.equal(s.d.view().active, true);
  assert.equal(s.fake.last().started, true);
  assert.equal(s.text(), 'first part second part');
});

test('words heard but never finished when a recogniser ends are kept, not dropped', async () => {
  const s = await setup({ text: 'Hi' });
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['there friend', false]]);
  await s.advance(5000);
  r.end();
  assert.equal(s.text(), 'Hi there friend');
  assert.equal(s.d.view().interim, '');
});

test('the person\'s stop ends it, never sends, and the last words still come in', async () => {
  const s = await setup({ text: 'Draft' });
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['one two', false]]);
  s.d.stop();
  assert.equal(r.stopped, true, 'stop(), not abort(): the last words are finished');
  assert.equal(s.d.view().active, false);
  assert.equal(s.d.view().listening, false, 'not listening the moment it is stopped');
  r.results([['one two three', true]]);
  r.end();
  await s.advance(10000);
  assert.equal(s.text(), 'Draft one two three');
  assert.equal(s.fake.made.length, 1, 'no restart after the person stopped');
  assert.equal(s.sent.length, 0);
  // (a recogniser that never ends after the stop: dropped after a moment, its heard words kept)
  await s.d.start();
  const r2 = s.fake.last();
  r2.begin();
  r2.results([['four', false]]);
  s.d.stop();
  await s.advance(3000);
  assert.equal(r2.aborted, true);
  assert.equal(s.text(), 'Draft one two three four');
  assert.equal(s.fake.made.length, 2);
});

test('sending while it listens stops it at once: the words being heard go in first, nothing after lands in the emptied box', async () => {
  const s = await setup({ text: 'Make it' });
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['blue please', false]]);
  s.d.endForSend();
  assert.equal(s.text(), 'Make it blue please', 'the words being heard are in the box before it is read');
  assert.equal(s.d.view().active, false);
  assert.equal(s.d.view().phase, 'off');
  assert.equal(r.aborted, true);
  s.setText(''); // (the panel sends and empties the box)
  r.results([['blue please now', true]]);
  r.end();
  await s.advance(10000);
  assert.equal(s.text(), '', 'a late word from the stopped recogniser is ignored');
  assert.equal(s.fake.made.length, 1, 'no restart');
  s.d.endForSend(); // (sending with the mic off: nothing)
  assert.equal(s.text(), '');
});

test('the box is never replaced: words typed while it listens stay, new words go after them', async () => {
  const s = await setup({ text: 'a' });
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['b', true]]);
  s.setText('a b (typed)\n');
  r.results([['b', true], ['c', true]]);
  assert.equal(s.text(), 'a b (typed)\nc');
  s.setText(''); // (sent while dictating: the box empty)
  r.results([['b', true], ['c', true], ['d', true]]);
  assert.equal(s.text(), 'd');
});

test('the same final sent again is not added twice; a final that grows adds only its new words', async () => {
  const s = await setup();
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['hello world', true]]);
  r.results([['hello world', true]]);
  r.results([['Hello, world.', true]]);
  assert.equal(s.text(), 'hello world');
  r.results([['hello world again', true]]);
  assert.equal(s.text(), 'hello world again');
  r.results([['something else entirely', true]]); // (another stretch at the same place: kept, never dropped)
  assert.equal(s.text(), 'hello world again something else entirely');
});

test('Safari: words being heard that start over within a session are kept before the new ones', async () => {
  const s = await setup({ browser: 'Safari' });
  await s.d.start();
  const r = s.fake.last();
  r.begin();
  r.results([['make the font bigger', false]]);
  r.results([['and', false]]);
  assert.equal(s.text(), 'make the font bigger');
  r.results([['and darker', true]]);
  assert.equal(s.text(), 'make the font bigger and darker');
  // Chrome's interim results are revised that way all the time: nothing committed from them
  const c = await setup({ browser: 'Chrome' });
  await c.d.start();
  const cr = c.fake.last();
  cr.begin();
  cr.results([['I scream for', false]]);
  cr.results([['ice cream', false]]);
  cr.results([['ice cream for you', true]]);
  assert.equal(c.text(), 'ice cream for you');
});

test('not-allowed: a red note with the fix, it stops, the words kept', async () => {
  const s = await setup({ text: 'kept', permission: 'denied' });
  await s.d.start();
  assert.equal(s.fake.made.length, 0, 'blocked already: no recogniser');
  assert.equal(s.d.view().active, false);
  assert.equal(s.d.view().note.kind, 'bad');
  assert.equal(s.d.view().note.fix, 'settings');
  assert.match(s.d.view().note.text, /blocked for TRIF.*Chrome’s settings/);
  // granted, then refused by the recogniser, and the question already asked or none to ask: the note
  const t = await setup({ text: 'kept' });
  await t.d.start();
  const r = t.fake.last();
  r.begin();
  r.results([['words', false]]);
  r.error('not-allowed');
  await tick();
  r.end();
  await t.advance(30000);
  assert.equal(t.d.view().active, false);
  assert.equal(t.d.view().listening, false);
  assert.equal(t.d.view().note.kind, 'bad');
  assert.equal(t.text(), 'kept words');
  assert.equal(t.fake.made.length, 1, 'no restart once blocked');
  // the next press clears the note and tries again
  await t.d.start();
  assert.equal(t.d.view().note, null);
});

test('Chrome\'s side panel: the first time, mic.html asks in a tab; allowed, it starts listening', async () => {
  let resolve;
  const asks = [];
  const s = await setup({ permission: 'prompt', canPrompt: false, askPage: () => { asks.push(1); return new Promise((r) => { resolve = r; }); } });
  const started = s.d.start();
  await tick();
  assert.equal(asks.length, 1);
  assert.equal(s.d.view().phase, 'asking');
  assert.equal(s.d.view().listening, false);
  assert.match(s.d.view().note.text, /Allow the microphone in the tab/);
  assert.equal(s.fake.made.length, 0, 'no recogniser until it is allowed');
  resolve('granted');
  await started;
  assert.equal(s.fake.made.length, 1);
  assert.equal(s.d.view().note, null);
  s.fake.last().begin();
  assert.equal(s.d.view().listening, true);
  // refused in the tab: the red note; closed without an answer: just off
  for (const [answer, kind] of [['denied', 'bad'], ['nomic', 'bad'], ['closed', null]]) {
    const t = await setup({ permission: 'prompt', canPrompt: false, askPage: async () => answer });
    await t.d.start();
    assert.equal(t.d.view().active, false, answer);
    assert.equal(t.d.view().note?.kind ?? null, kind, answer);
    if (answer === 'nomic') assert.match(t.d.view().note.text, /No microphone found/);
  }
  // stopped while the tab asks: allowed later, it doesn't start by itself
  let later;
  const u = await setup({ permission: 'prompt', canPrompt: false, askPage: () => new Promise((r) => { later = r; }) });
  const p = u.d.start();
  await tick();
  u.d.stop();
  later('granted');
  await p;
  assert.equal(u.fake.made.length, 0);
  assert.equal(u.d.view().active, false);
});

test('a panel in a window asks the browser\'s way; refused with the question never shown, mic.html asks once', async () => {
  let perm = 'prompt';
  const asks = [];
  const { createDictation } = await load();
  const fake = fakeClass();
  let text = '';
  const d = createDictation({
    Recognition: fake.FakeRecognition, lang: '', browser: 'Chrome', getText: () => text, setText: (t) => { text = t; },
    permission: async () => perm, askPage: async () => { asks.push(1); perm = 'granted'; return 'granted'; }, canPrompt: true,
    setTimer: (fn) => { setImmediate(fn); return {}; }, clearTimer: () => {},
  });
  await d.start();
  assert.equal(fake.made.length, 1, 'tried at once');
  assert.equal(asks.length, 0);
  fake.last().error('not-allowed');
  await tick(5);
  assert.equal(asks.length, 1, 'the browser never asked: mic.html does');
  assert.equal(fake.made.length, 2, 'and then it starts');
  fake.last().begin();
  assert.equal(d.view().listening, true);
  fake.last().error('not-allowed'); // (refused again: no second tab, the note)
  await tick(5);
  assert.equal(asks.length, 1);
  assert.equal(d.view().note.kind, 'bad');
});

test('no microphone, the service off, a language it can\'t do: stop with a red note', async () => {
  const cases = [['audio-capture', /No microphone found/, 'Chrome'], ['service-not-allowed', /Dictation is off on this Mac/, 'Safari'], ['service-not-allowed', /speech recognition isn’t available/, 'Edge']];
  for (const [code, re, browser] of cases) {
    const s = await setup({ browser });
    await s.d.start();
    s.fake.last().begin();
    s.fake.last().error(code);
    s.fake.last().end();
    await s.advance(20000);
    assert.equal(s.d.view().active, false, code);
    assert.equal(s.d.view().note.kind, 'bad', code);
    assert.match(s.d.view().note.text, re);
    assert.equal(s.fake.made.length, 1, code);
  }
  // a language it can't do: once more in the browser's own, then the note
  const s = await setup();
  await s.d.start();
  s.fake.last().error('language-not-supported');
  s.fake.last().end();
  await s.advance(1000);
  assert.equal(s.fake.made.length, 2);
  assert.equal(s.fake.last().lang, undefined, 'the browser\'s own language');
  s.fake.last().error('language-not-supported');
  await s.advance(1000);
  assert.equal(s.d.view().active, false);
  assert.match(s.d.view().note.text, /can’t understand en-US/);
});

test('network errors: it keeps trying with a growing pause, says so quietly from the second, never "listening" meanwhile', async () => {
  const s = await setup();
  await s.d.start();
  s.fake.last().begin();
  assert.equal(s.d.view().listening, true);
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    const r = s.fake.last();
    r.error('network');
    r.end();
    assert.equal(s.d.view().listening, false, 'not listening while it reconnects');
    assert.equal(s.d.view().phase, 'retrying');
    assert.equal(s.d.view().active, true);
    if (i === 0) assert.equal(s.d.view().note, null, 'one miss: nothing said');
    else assert.equal(s.d.view().note.kind, 'quiet');
    const before = s.fake.made.length;
    const at = s.pending().map((t) => t.at).sort((a, b) => a - b)[0];
    gaps.push(at);
    await s.advance(10000);
    assert.equal(s.fake.made.length, before + 1, 'tried again');
    s.fake.last().begin(); // (Chrome says it started, then the network fails again)
    assert.equal(s.d.view().listening, false, 'a start after misses isn\'t listening yet');
  }
  const deltas = gaps.map((g, i) => (i ? g - gaps[i - 1] : 0));
  assert.ok(deltas.slice(2).every((d) => d >= 10000), `the pause grows to 10 s (${deltas})`);
  // the network back: words arrive, it's listening and the note goes
  s.fake.last().results([['back again', true]]);
  assert.equal(s.d.view().listening, true);
  assert.equal(s.d.view().note, null);
  assert.equal(s.text(), 'back again');
  // or, without words, a session that holds 3 s
  const t = await setup();
  await t.d.start();
  t.fake.last().begin();
  t.fake.last().error('network'); t.fake.last().end();
  await t.advance(300);
  t.fake.last().begin();
  assert.equal(t.d.view().listening, false);
  await t.advance(3000);
  assert.equal(t.d.view().listening, true);
});

test('a recogniser that ends at once without starting is retried with a pause, not in a tight loop', async () => {
  const s = await setup();
  await s.d.start();
  for (let i = 0; i < 20; i++) { s.fake.last().end(); await s.advance(0); }
  assert.ok(s.fake.made.length <= 2, `${s.fake.made.length} recognisers in no time`);
  await s.advance(60000);
  assert.equal(s.d.view().active, true);
});

test('the words: shortcut, browsers offered, appendWords, settings pages', async () => {
  const m = await load();
  assert.equal(m.isDictationKey({ ctrlKey: true, shiftKey: true, code: 'Space', key: ' ' }), true);
  assert.equal(m.isDictationKey({ ctrlKey: true, shiftKey: false, code: 'Space', key: ' ' }), false);
  assert.equal(m.isDictationKey({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'Space', key: ' ' }), false);
  const R = function () {};
  assert.deepEqual(['Chrome', 'Edge', 'Safari', 'Firefox', 'Brave', 'Opera'].map((b) => m.dictationOffered(b, R)), [true, true, true, false, false, false]);
  assert.equal(m.dictationOffered('Chrome', null), false, 'no recogniser: no button');
  assert.equal(m.recognitionClass({}), null);
  assert.equal(m.appendWords('', ' hi  there '), 'hi there');
  assert.equal(m.appendWords('a\n', 'b'), 'a\nb');
  assert.equal(m.appendWords('a', ''), 'a');
  assert.equal(m.micSettingsUrl('Edge', 'chrome-extension://abc/'), 'edge://settings/content/siteDetails?site=chrome-extension%3A%2F%2Fabc');
  assert.equal(m.micSettingsUrl('Chrome', 'chrome-extension://abc'), 'chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2Fabc');
  assert.equal(m.micSettingsUrl('Safari', 'x'), null);
  assert.equal(m.wordsFor(m.DICTATION_WORDS.firstUse, 'Edge'), 'Edge sends what you say to Microsoft to turn it into text.');
  assert.equal(m.wordsFor(m.DICTATION_WORDS.startTitle, 'Chrome', { key: m.DICTATION_KEY }), 'Dictate (Ctrl+Shift+Space)');
});
