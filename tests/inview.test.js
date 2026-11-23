// "What you're looking at now" (extension/inview.js): the outline's cap and format, the note's assembly, the
// capture's rules (a sensitive site never pictured, Off: nothing, a missing picture still sends the rest), and the
// helper's side (helper/lib/inview.js: the picture in the site's screenshots folder). The in-page walk itself is in
// tests/inview-browser.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test, before } = require('node:test');

let V;
before(async () => { V = await import('../extension/inview.js'); });

const entry = (i, o = {}) => ({ sel: `div[data-testid="row-${i}"]`, word: '', text: `Row ${i} text`, top: i * 20, bottom: i * 20 + 18, left: 0, p: 2, parent: -1, ...o });

test('inViewPage is self-contained (chrome.scripting runs it from its source text) and never throws', () => {
  const r = vm.runInNewContext(`(${V.inViewPage.toString()})({})`, { performance: { now: () => 0 } });
  assert.match(r.error, /in-view outline failed/);
});

test('outlineLine: selector, a word only where the selector doesn\'t say it, text, label, where, the selection', () => {
  assert.equal(V.outlineLine(entry(1)), 'div[data-testid="row-1"] “Row 1 text” y 20–38');
  assert.equal(V.outlineLine({ ...entry(2), sel: 'main > div:nth-of-type(2)', word: 'button' }), 'main > div:nth-of-type(2) (button) “Row 2 text” y 40–58');
  assert.equal(V.outlineLine({ ...entry(3), sel: '#top h2', word: 'heading' }), '#top h2 “Row 3 text” y 60–78', 'h2 says heading');
  assert.equal(V.outlineLine({ ...entry(4), sel: 'nav a.home', word: 'link', label: 'Home page' }), 'nav a.home “Row 4 text” [Home page] y 80–98');
  assert.match(V.outlineLine({ ...entry(5), selected: true }), /← the selection$/);
  assert.match(V.outlineLine({ ...entry(5), holdsSelection: true }), /← holds the selection$/);
  assert.match(V.outlineLine({ ...entry(6), top: -40 }), /y -40–138$/, 'cut at the top shows as a negative y');
});

test('formatOutline: under the cap, top to bottom, indented under the entry around each; low priority goes first', () => {
  const list = [entry(0, { sel: 'main', word: 'main', text: '', p: 1 })];
  for (let i = 1; i <= 300; i++) list.push(entry(i, { parent: 0, p: i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 4, ...(i === 250 ? { selected: true, p: 4 } : {}) }));
  const o = V.formatOutline(list, { maxChars: 2000 });
  assert.ok(o.text.length <= 2000, `${o.text.length} characters`);
  assert.ok(o.left > 0 && o.shown + o.left === list.length);
  const lines = o.text.split('\n');
  assert.equal(lines[0], 'main y 0–18', 'the region first, no word (main says it)');
  assert.ok(lines.slice(1).every((l) => l.startsWith('  div[')), 'children indented under it');
  const ys = lines.map((l) => Number(/y (-?\d+)/.exec(l)[1]));
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'top to bottom');
  assert.ok(o.text.includes('row-250"] “Row 250 text” y 5000–5018 ← the selection'), 'the selection\'s entry stays, whatever its priority');
  const kept = lines.slice(1).map((l) => Number(/row-(\d+)/.exec(l)[1]));
  const firsts = list.filter((e, i) => i && e.p === 1).length;
  assert.equal(kept.filter((i) => i % 3 === 0).length, Math.min(firsts, kept.length - 1), 'priority 1 kept before the rest');
  assert.ok(!kept.some((i) => i % 3 === 2 && i !== 250), 'plain text (priority 4) is what went');
  // a small page: everything, nothing left
  const small = V.formatOutline(list.slice(0, 4));
  assert.equal(small.left, 0);
  assert.equal(small.text.split('\n').length, 4);
  // nonsense in, nothing out
  assert.deepEqual(V.formatOutline(null), { text: '', shown: 0, left: 0 });
  assert.equal(V.formatOutline([{ sel: '' }, { nope: 1 }]).shown, 0);
});

test('formatOutline: the cap holds with deep nesting (indents counted)', () => {
  const list = [];
  for (let i = 0; i < 200; i++) list.push(entry(i, { parent: i - 1, p: 1, text: 'x'.repeat(50) }));
  for (const max of [300, 1000, 3500]) assert.ok(V.formatOutline(list, { maxChars: max }).text.length <= max);
  assert.match(V.formatOutline(list.slice(0, 8)).text.split('\n')[7], /^ {10}div/, 'indents stop at five levels');
});

const PAGE = {
  url: 'https://x.com/home', title: 'Home / X', vw: 1280, vh: 720, dpr: 2, sx: 0, sy: 4210, pw: 1280, ph: 48000, scroller: null,
  entries: [entry(0, { sel: 'main', word: 'main', text: '', p: 1 }), entry(1, { parent: 0, sel: 'article[data-testid="tweet"]:nth-of-type(3)', word: 'article', text: 'Paula @paula · 2h The thing', selected: true })],
  selection: { text: 'The thing', selector: 'div[data-testid="tweetText"]', field: false }, candidates: 2, scanned: 900, partial: false, ms: 12,
};

test('inViewNote: header, page and tab, viewport and scroll, the screenshot, the selection, the outline, footer', () => {
  const n = V.inViewNote(PAGE, { tabId: 77, shot: '/s/x.com/in-view-1.jpg' });
  const lines = n.split('\n');
  assert.equal(lines[0], V.IN_VIEW_HEADER);
  assert.equal(lines[1], 'Page: https://x.com/home (“Home / X”), tab 77');
  assert.equal(lines[2], 'Viewport: 1280×720 CSS px, scrolled to y 4210 of 48000; 2 device px per CSS px.');
  assert.equal(lines[3], 'Screenshot of exactly this viewport: /s/x.com/in-view-1.jpg');
  assert.equal(lines[4], 'Selected: “The thing”');
  assert.equal(lines[5], '  in div[data-testid="tweetText"]');
  assert.match(lines[6], /^In view, top to bottom/);
  assert.equal(lines[7], 'main y 0–18');
  assert.match(lines[8], /^ {2}article\[data-testid="tweet"\]:nth-of-type\(3\) “Paula/);
  assert.equal(lines.at(-1), V.IN_VIEW_FOOTER);
  assert.ok(n.length < 1200);
});

test('inViewNote: no picture says why; the phone view says so; an inner scroller; nothing to say → null', () => {
  const n = V.inViewNote({ ...PAGE, selection: null, scroller: { sel: '#feed', y: 900, height: 9000 }, sy: 0 }, { tabId: 5, noShot: 'this site is on TRIF\'s sensitive list', phone: { device: 'iPhone 15', width: 393 } });
  assert.match(n, /^Page: .*, tab 5, in the phone view \(iPhone 15, 393 px wide\)$/m);
  assert.match(n, /^No screenshot: this site is on TRIF's sensitive list\.$/m);
  assert.match(n, /the page's own scroller #feed scrolled to y 900 of 9000/);
  assert.doesNotMatch(n, /Selected/);
  assert.match(V.inViewNote(null, { tabId: 5, outlineWhy: 'the tab went to another page' }), /^No outline: the tab went to another page\.$/m);
  assert.equal(V.inViewNote(null, {}), null);
  const more = V.inViewNote({ ...PAGE, candidates: 40, partial: true, ms: 160 }, {});
  assert.match(more, /\(38 more in view not listed, to keep this short: the page is big, and TRIF stopped after 160 ms; trif run or trif sweep for the rest\.\)/);
});

test('withInView: after the message; several (messages that waited) each say which message, the latest kept', () => {
  assert.equal(V.withInView('hi', []), 'hi');
  assert.equal(V.withInView('hi', [{ note: `${V.IN_VIEW_HEADER}\nA\n${V.IN_VIEW_FOOTER}`, text: 'hi' }]), `hi\n\n${V.IN_VIEW_HEADER}\nA\n${V.IN_VIEW_FOOTER}`);
  const notes = [1, 2, 3, 4].map((i) => ({ note: `${V.IN_VIEW_HEADER}\nN${i}`, text: `message ${i}` }));
  const t = V.withInView('one\n\ntwo', notes);
  assert.ok(!t.includes('N1'), `only the last ${V.NOTES_MAX}`);
  assert.match(t, /--- In view when I sent “message 4” ---\nN4$/);
  assert.equal((t.match(/--- In view when I sent “/g) || []).length, 3);
});

const fakeDeps = (o = {}) => {
  const calls = [];
  let t = 0;
  return {
    calls,
    deps: {
      tab: { id: 9, url: 'https://example.com/a', windowId: 1, active: true }, level: 'look', sensitive: false, now: () => t,
      pageCall: async (func, args) => { calls.push(['page', func.name, args[0]]); t += 40; if (o.pageFails) throw new Error('the tab went to another page'); return PAGE; },
      capture: async () => { calls.push(['capture']); if (o.captureFails) throw new Error(o.captureFails); return 'data:image/jpeg;base64,/9j/'; },
      saveShot: async (d) => { calls.push(['save', d.slice(0, 15)]); return '/shots/example.com/in-view-x.jpg'; },
      ...o.deps,
    },
  };
};

test('captureInView: the outline and the picture, together', async () => {
  const { deps, calls } = fakeDeps();
  const r = await V.captureInView(deps);
  assert.equal(r.pictured, true);
  assert.match(r.note, /Screenshot of exactly this viewport: \/shots\/example\.com\/in-view-x\.jpg/);
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['capture', 'page', 'save']);
  assert.equal(calls.find((c) => c[0] === 'page')[1], 'inViewPage');
  assert.equal(calls.find((c) => c[0] === 'page')[2].maxChars, V.OUTLINE_MAX);
});

test('captureInView: a sensitive site is never pictured (the outline only); Off: nothing at all', async () => {
  const s = fakeDeps({ deps: { sensitive: true, level: 'run' } });
  const r = await V.captureInView(s.deps);
  assert.equal(r.pictured, false);
  assert.ok(!s.calls.some((c) => c[0] === 'capture' || c[0] === 'save'), 'no capture asked for');
  assert.match(r.note, /No screenshot: this site is on TRIF's sensitive list, and TRIF never pictures those\./);
  assert.match(r.note, /In view, top to bottom/);
  const off = fakeDeps({ deps: { level: 'off' } });
  assert.equal(await V.captureInView(off.deps), null);
  assert.deepEqual(off.calls, [], 'nothing read, nothing pictured');
  const notWeb = fakeDeps({ deps: { tab: { id: 1, url: 'chrome://settings' } } });
  assert.equal(await V.captureInView(notWeb.deps), null);
});

test('captureInView: no picture (no activeTab grant, say) still sends the outline, with one line saying why', async () => {
  const { deps } = fakeDeps({ captureFails: 'Chrome lets TRIF picture a tab only after the user clicks TRIF\'s toolbar button on it.' });
  const r = await V.captureInView(deps);
  assert.equal(r.pictured, false);
  assert.match(r.note, /^No screenshot: Chrome lets TRIF picture a tab only after the user clicks TRIF's toolbar button on it\.$/m);
  assert.match(r.note, /Selected: “The thing”/);
  const p = fakeDeps({ pageFails: true });
  const r2 = await V.captureInView(p.deps);
  assert.equal(r2.pictured, true);
  assert.match(r2.note, /No outline: the tab went to another page\./);
});

test('captureInView: the outline and the picture are taken at once, not one after the other', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deps = {
    tab: { id: 1, url: 'https://example.com/' }, level: 'ask', sensitive: false,
    pageCall: async () => { await wait(120); return PAGE; },
    capture: async () => { await wait(120); return 'data:image/jpeg;base64,/9j/'; },
    saveShot: async () => { await wait(20); return '/f.jpg'; },
  };
  const t0 = Date.now();
  const r = await V.captureInView(deps);
  const took = Date.now() - t0;
  assert.ok(took < 220, `${took} ms`);
  assert.ok(r.ms.total >= 120 && r.ms.outline >= 110 && r.ms.shot >= 130);
});

test('helper inview.shot: the picture in the site\'s screenshots folder, fresh, under a name of its own', () => {
  const { saveInViewShot } = require('../helper/lib/inview');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-inview-'));
  try {
    const ws = { home, private: path.join(home, 'private') };
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
    const r = saveInViewShot(ws, { scope: 'x.com', dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}` });
    assert.equal(path.dirname(r.file), path.join(home, 'private', 'screenshots', 'x.com'));
    assert.match(path.basename(r.file), /^in-view-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-[0-9a-f]{6}\.jpg$/);
    assert.deepEqual(fs.readFileSync(r.file), jpg);
    // (modes do nothing on Windows, where the private folder's access list keeps other users out)
    if (process.platform !== 'win32') assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
    // the phone view's chat: its phone twin's folder (as runs.js names it)
    const p = saveInViewShot(ws, { scope: 'phone~x.com', dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}` });
    assert.equal(path.basename(path.dirname(p.file)), 'phone_x.com');
    assert.notEqual(p.file, r.file);
    assert.throws(() => saveInViewShot(ws, { scope: 'x.com', dataUrl: 'data:image/gif;base64,R0lGOD' }), /JPEG or PNG/);
    assert.throws(() => saveInViewShot(ws, { scope: 'x.com', dataUrl: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}` }), /not a JPEG or PNG/);
    assert.throws(() => saveInViewShot(ws, { scope: '', dataUrl: 'x' }), /missing scope/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the extension\'s messages: the panel\'s Send asks for the note; only the panel may (background.js)', () => {
  const bg = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  assert.match(bg, /case 'agent\.start': return startAgent\(\{ \.\.\.msg, withView: fromPanel && msg\.withView === true \}\);/);
  assert.match(bg, /prompt: withInView\(withAttached\(prompt, chatSite\), notes\)/);
  assert.match(bg, /text: withInView\(withAttached\(item\.text, chatSite\), notes\)/, 'Send now into a working run carries it too');
  assert.match(bg, /\{ fromQueue: m\.ids, inView: notesOf\(m\.items\) \}/, 'messages that waited carry theirs');
  assert.match(panel, /startRun\(text, \{ withView: true \}\)/);
  assert.match(panel, /queueMessage\(text, \{ withView: true \}\)/);
  const host = fs.readFileSync(path.join(__dirname, '..', 'helper', 'host.js'), 'utf8');
  assert.match(host, /const PANEL_COMMANDS = new Set\(\[[^\]]*'inview\.shot'/, 'the helper takes the picture from the extension\'s connection only');
});
