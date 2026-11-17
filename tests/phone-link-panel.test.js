'use strict';
// Settings' Connect a phone in the side panel (extension/phonelink.js): what it asks of the background, what it
// shows in each state, that the QR's text stays in its state only while the code is on screen, and its
// elements (with a few DOM methods; the real panel in a browser is the browser tests' and step 10's). The
// background's side (`phoneLink.*` from the panel page alone) is in tests/extension.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const load = () => import('../extension/phonelink.js');
const tick = () => new Promise((r) => setImmediate(r));
const QR = 'trif://pair?v=1&k=q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA&s=Zm9vYmFyYmF6cXV1eHF1dXV4&n=Study%20Mac';
const PHONE = { id: 'a1b2c3d4e5f60718', name: 'Tim’s iPhone', pairedAt: Date.UTC(2026, 10, 16, 12), lastSeen: Date.UTC(2026, 10, 16, 12) };
const status = (over = {}) => ({ on: false, id: null, name: 'Study Mac', port: 0, phones: [], pairing: null, listen: false, here: true, listening: false, announce: null, ...over });

/** A stand-in background: answers each request from `answers[type]` (a value or a function), and keeps them. */
function setup(mod, answers = {}) {
  const asked = [];
  let clock = 1000;
  const timers = [];
  let changes = 0;
  const link = mod.createPhoneLink({
    request: async (msg) => {
      asked.push(msg);
      const a = answers[msg.type];
      if (a === undefined) throw new Error(`unknown command "${msg.type}"`);
      return typeof a === 'function' ? a(msg) : a;
    },
    changed: () => changes++,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, on: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.on = false; },
  });
  const advance = async (ms) => { clock += ms; for (const t of timers) if (t.on && t.at <= clock) { t.on = false; t.fn(); } await tick(); };
  return { link, asked, answers, advance, changes: () => changes, types: () => asked.map((m) => m.type) };
}

test('connect a phone: nothing shows without a helper that has the link; off, it is a line and a button', async () => {
  const mod = await load();
  assert.deepStrictEqual(mod.phoneLinkView({ status: null }), { hidden: true });
  let s = setup(mod, {});
  await s.link.open(true); // (an older helper: "unknown command")
  assert.deepStrictEqual(s.link.view(), { hidden: true });
  s = setup(mod, { 'phoneLink.status': status() });
  await s.link.open(false); // (no helper connected: not even asked)
  assert.deepStrictEqual([s.types(), s.link.view()], [[], { hidden: true }]);
  await s.link.open(true);
  const v = s.link.view();
  assert.deepStrictEqual([v.hidden, v.label, v.toggle, v.phones, v.qr, v.elsewhere, v.notes], [false, 'Connect a phone', null, [], null, null, []]);
  assert.deepStrictEqual(v.button, { label: 'Connect a phone', disabled: false });
  // The three layers: a line of 6 to 9 words, an explanation of 2 to 4 sentences that starts with it
  assert.ok(v.line.split(/\s+/).length >= 6 && v.line.split(/\s+/).length <= 9, v.line);
  assert.ok(v.explanation.startsWith(v.line));
  const more = v.explanation.slice(v.line.length).trim().split(/(?<=[.!?])\s+/);
  assert.ok(more.length >= 2 && more.length <= 4, `"more" has ${more.length} sentences`);
});

test('connect a phone: the button turns the link on, opens the window and shows the code; a phone that pairs ends it', async () => {
  const mod = await load();
  const s = setup(mod, {
    'phoneLink.status': status(),
    'phoneLink.on': status({ on: true, id: 'c0ffee', listen: true }),
    'phoneLink.pair.start': () => ({ qr: QR, expires: 1000 + 300000, ...status({ on: true, listening: true, port: 50123, pairing: { expires: 301000 } }) }),
    'phoneLink.pair.stop': status({ on: true, listening: true, port: 50123 }),
  });
  await s.link.open(true);
  await s.link.connect();
  assert.deepStrictEqual(s.types(), ['phoneLink.status', 'phoneLink.on', 'phoneLink.pair.start']);
  let v = s.link.view();
  assert.deepStrictEqual(v.qr, { text: QR, over: 'Scan this with TRIF on your iPhone: More, then My computer.', under: 'Good for 5 minutes, for one phone.', cancel: 'Cancel' });
  assert.deepStrictEqual([v.button, v.elsewhere], [null, null]);
  assert.deepStrictEqual(v.toggle, { label: 'Let connected phones reach this computer', on: true, disabled: false });
  // The secret is in `pairing` alone: not in the status the section keeps
  assert.ok(!JSON.stringify(s.link.state.status).includes('Zm9v'));
  assert.strictEqual(s.link.state.status.qr, undefined);

  // The helper's message: a phone paired (the window closed there). The code goes, the phone is listed and named
  s.link.onMessage(status({ on: true, listening: true, port: 50123, phones: [PHONE] }));
  v = s.link.view((t) => `d${new Date(t).getUTCDate()}`);
  assert.strictEqual(v.qr, null);
  assert.strictEqual(s.link.state.pairing, null);
  assert.ok(!JSON.stringify(s.link.state).includes('Zm9v'), 'the secret is gone from the panel');
  assert.deepStrictEqual(v.phones, [{ id: PHONE.id, label: 'Tim’s iPhone · connected d16', remove: 'Remove' }]);
  assert.deepStrictEqual(v.notes, [{ text: 'Tim’s iPhone is connected.', error: false }]);
  assert.deepStrictEqual(v.button, { label: 'Connect a phone', disabled: false });
  assert.deepStrictEqual(s.types().slice(3), [], 'nothing to stop: the window was the phone\'s');
});

test('connect a phone: the code goes when its time is up, on Cancel, when Settings close and when the link is turned off', async () => {
  const mod = await load();
  const on = status({ on: true, listening: true, port: 50123 });
  const answers = {
    'phoneLink.status': on,
    'phoneLink.pair.start': () => ({ qr: QR, expires: 301000, ...on, pairing: { expires: 301000 } }),
    'phoneLink.pair.stop': on,
    'phoneLink.off': status(),
  };
  // its time
  let s = setup(mod, answers);
  await s.link.open(true);
  await s.link.connect();
  assert.deepStrictEqual(s.types(), ['phoneLink.status', 'phoneLink.pair.start'], 'already on: not turned on again');
  await s.advance(299000);
  assert.ok(s.link.view().qr);
  await s.advance(1000);
  assert.deepStrictEqual([s.link.view().qr, s.link.state.pairing, s.types().at(-1)], [null, null, 'phoneLink.pair.stop']);
  // Cancel
  s = setup(mod, answers);
  await s.link.open(true);
  await s.link.connect();
  await s.link.cancel();
  assert.deepStrictEqual([s.link.view().qr, s.types().at(-1)], [null, 'phoneLink.pair.stop']);
  await s.advance(400000);
  assert.strictEqual(s.types().filter((t) => t === 'phoneLink.pair.stop').length, 1, 'its timer went with it');
  // Settings close
  s = setup(mod, answers);
  await s.link.open(true);
  await s.link.connect();
  await s.link.close();
  assert.deepStrictEqual([s.link.state.pairing, s.types().at(-1)], [null, 'phoneLink.pair.stop']);
  // … also when they close before the window's answer is back: it is closed, and no code is kept
  let answer;
  s = setup(mod, { ...answers, 'phoneLink.pair.start': () => new Promise((r) => { answer = r; }) });
  await s.link.open(true);
  const connecting = s.link.connect();
  await tick();
  await s.link.close();
  answer({ qr: QR, expires: 301000, ...on, pairing: { expires: 301000 } });
  await connecting;
  await tick();
  assert.deepStrictEqual([s.link.state.pairing, s.types().at(-1)], [null, 'phoneLink.pair.stop']);
  // the switch, off: the phones stay listed, the code goes
  s = setup(mod, { ...answers, 'phoneLink.status': { ...on, phones: [PHONE] }, 'phoneLink.off': status({ phones: [PHONE] }) });
  await s.link.open(true);
  await s.link.connect();
  await s.link.toggle(false);
  const v = s.link.view();
  assert.deepStrictEqual([v.qr, v.toggle.on, v.phones.length, s.link.state.pairing], [null, false, 1, null]);
  assert.deepStrictEqual(v.button, { label: 'Connect a phone', disabled: false });
});

test('connect a phone: Remove, another browser\'s link, a phone that can\'t find the computer, the helper\'s errors', async () => {
  const mod = await load();
  const on = status({ on: true, listening: true, port: 50123, phones: [PHONE] });
  let s = setup(mod, {
    'phoneLink.status': on,
    'phoneLink.remove': (msg) => ({ removed: msg.id === PHONE.id ? { id: PHONE.id, name: PHONE.name } : null, ...on, phones: [] }),
  });
  await s.link.open(true);
  await s.link.remove(PHONE.id);
  assert.deepStrictEqual(s.asked.at(-1), { type: 'phoneLink.remove', id: PHONE.id });
  let v = s.link.view();
  assert.deepStrictEqual([v.phones, v.notes], [[], [{ text: 'Tim’s iPhone can’t reach this computer any more.', error: false }]]);
  assert.strictEqual(s.link.state.status.removed, undefined);

  // here: false → a line in the button's place; the switch and Remove are still there
  s = setup(mod, { 'phoneLink.status': { ...on, here: false, listening: false } });
  await s.link.open(true);
  v = s.link.view();
  assert.deepStrictEqual([v.button, v.qr, v.elsewhere], [null, null, 'Another browser’s TRIF is handling phones just now. Connect a phone from there.']);
  assert.ok(v.toggle && v.phones.length === 1);

  // announce
  for (const [announce, shown] of [['missing', true], ['failing', true], [null, false], ['unsupported', false]]) {
    const notes = mod.phoneLinkView({ status: { ...on, announce } }, 0).notes.map((n) => n.text);
    assert.deepStrictEqual(notes, shown ? ['Your phone may not find this computer just now.'] : [], String(announce));
  }
  assert.deepStrictEqual(mod.phoneLinkView({ status: status({ announce: 'missing' }) }, 0).notes, [], 'off: nothing to find');

  // The helper's own words, as a sentence; the button comes back
  s = setup(mod, {
    'phoneLink.status': status(),
    'phoneLink.on': () => { throw new Error('the phone link needs a system keyring to keep this computer\'s key in (the macOS Keychain, or a Secret Service on Linux)'); },
  });
  await s.link.open(true);
  await s.link.connect();
  v = s.link.view();
  assert.deepStrictEqual(v.notes, [{ text: 'The phone link needs a system keyring to keep this computer\'s key in (the macOS Keychain, or a Secret Service on Linux).', error: true }]);
  assert.deepStrictEqual([v.button.disabled, v.qr, s.types()], [false, null, ['phoneLink.status', 'phoneLink.on']]);
  assert.strictEqual(mod.sentence(new Error('this computer couldn\'t open a port for the phone to reach')), 'This computer couldn\'t open a port for the phone to reach.');

  // A name too long for the code: said, and the window closed again
  s = setup(mod, {
    'phoneLink.status': on,
    'phoneLink.pair.start': { qr: `${QR}${'%F0%9F%93%B1'.repeat(30)}`, expires: 301000, ...on, pairing: { expires: 301000 } },
    'phoneLink.pair.stop': on,
  });
  await s.link.open(true);
  await s.link.connect();
  await tick();
  assert.deepStrictEqual([s.link.state.pairing, s.types().at(-1), s.link.view().notes.at(-1).error], [null, 'phoneLink.pair.stop', true]);
  assert.match(s.link.view().notes.at(-1).text, /name is too long/);
});

// A few DOM methods: enough for renderPhoneLink (an SVG element's class is its attribute, as in a browser).
function fakeDoc() {
  const make = (tag) => {
    const attrs = new Map();
    const listeners = {};
    const e = {
      tagName: tag.toUpperCase(), children: [], className: '', textContent: '', hidden: false, disabled: false, type: '', id: '',
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      append: (...c) => e.children.push(...c),
      replaceChildren: (...c) => { e.children = c; },
      addEventListener: (t, f) => (listeners[t] ||= []).push(f),
      click: () => (listeners.click || []).forEach((f) => f({ stopPropagation() {} })),
      all: () => [e, ...e.children.flatMap((c) => (c.all ? c.all() : []))],
      querySelector: (sel) => e.all().slice(1).find((c) => sel.split('.').filter(Boolean).every((cls) => ` ${c.className || c.getAttribute('class') || ''} `.includes(` ${cls} `))) || null,
      text: () => e.textContent + e.children.map((c) => (c.text ? c.text() : '')).join(''),
    };
    return e;
  };
  return { createElement: make, createElementNS: (ns, tag) => make(tag) };
}

test('connect a phone: its elements: the switch, the phones with Remove, the code as a picture, never its text', async () => {
  const mod = await load();
  const on = status({ on: true, listening: true, port: 50123, phones: [PHONE] });
  const s = setup(mod, {
    'phoneLink.status': on,
    'phoneLink.pair.start': { qr: QR, expires: 301000, ...on, pairing: { expires: 301000 } },
    'phoneLink.pair.stop': on,
    'phoneLink.off': { ...on, on: false, listening: false },
  });
  const doc = fakeDoc();
  const root = doc.createElement('div');
  const draw = () => mod.renderPhoneLink(root, s.link, { doc });
  draw();
  assert.deepStrictEqual([root.hidden, root.children.length], [true, 0]);
  await s.link.open(true);
  draw();
  assert.strictEqual(root.hidden, false);
  const sw = root.querySelector('.switch');
  assert.deepStrictEqual([sw.getAttribute('role'), sw.getAttribute('aria-checked'), sw.getAttribute('aria-labelledby')], ['switch', 'true', 'pl-toggle-label']);
  assert.match(root.text(), /Connect a phone.*Let connected phones reach this computer.*Tim’s iPhone · connected .*Remove.*Connect a phone$/s);
  root.querySelector('.pl-connect').click();
  await tick(); await tick();
  draw();
  const svg = root.querySelector('.pl-qr');
  assert.deepStrictEqual([svg.tagName, svg.getAttribute('role'), svg.getAttribute('aria-label'), svg.getAttribute('viewBox')], ['SVG', 'img', 'The code to scan', '0 0 49 49']);
  assert.deepStrictEqual(svg.children.map((c) => [c.tagName, c.getAttribute('fill')]), [['RECT', '#fff'], ['PATH', '#000']]);
  // (filled squares, never outlined as the panel's icons are: seen in a real browser, tests/phone-link-browser.test.js)
  assert.strictEqual(svg.children[1].getAttribute('stroke'), 'none');
  assert.strictEqual(root.querySelector('.pl-connect'), null);
  // The text of the code (the secret) is in no element's text or attribute but the picture's path
  const seen = JSON.stringify(root.all().map((e) => [e.textContent, e.getAttribute('aria-label'), e.id, e.className]));
  assert.ok(!seen.includes('trif://') && !seen.includes('Zm9v'));
  // the switch, off
  root.querySelector('.switch').click();
  await tick(); await tick();
  draw();
  assert.deepStrictEqual([root.querySelector('.pl-qr'), root.querySelector('.switch').getAttribute('aria-checked')], [null, 'false']);
  assert.deepStrictEqual(s.types(), ['phoneLink.status', 'phoneLink.pair.start', 'phoneLink.off']);
});

test('connect a phone: every string the panel shows is in docs/PHONE-LINK-STRINGS.md, and none names another product', async () => {
  const { TEXT } = await load();
  const plain = (x) => x.replace(/’/g, '\'');
  const doc = plain(fs.readFileSync(path.join(__dirname, '..', 'docs', 'PHONE-LINK-STRINGS.md'), 'utf8'));
  for (const [k, v] of Object.entries(TEXT)) {
    assert.ok(doc.includes(plain(v)), `${k}: "${v}" isn't in the strings file`);
    assert.doesNotMatch(v, /claude|codex|cursor|copilot|gemini|chatgpt|openai|anthropic/i, k);
  }
  // (the panel's markup and styles: the box is in Settings, which scroll)
  const html = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.html'), 'utf8');
  const settings = html.slice(html.indexOf('<section id="settings"'), html.indexOf('<section id="gate"'));
  assert.ok(settings.includes('<div id="phone-link" class="phone-link" hidden></div>'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.css'), 'utf8');
  assert.match(css, /\.settings \{[^}]*overflow-y: auto/);
});
