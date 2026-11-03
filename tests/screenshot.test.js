// `trif screenshot` without switching the user's tabs (extension/screenshot.js): which way a tab is
// captured, the copy window's life (never focused, always closed), full pages, and the CLI's output.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { FakeExtension, runCli, tempDir } = require('./fake-extension');

let S;
before(async () => { S = await import('../extension/screenshot.js'); });

const PNG = (n) => `data:image/png;base64,${Buffer.from(`png${n}`).toString('base64')}`;

/** A browser API mock that records every call. `opts.captureTab` makes it Firefox-like. */
function mockApi({ active = true, state = 'normal', captureTab = false, loadPolls = 2, failLoad = false, quotaOnce = false } = {}) {
  const calls = [];
  let shot = 0;
  let polls = 0;
  let quota = quotaOnce;
  const windows = new Map([[1, { id: 1, state, left: 10, top: 20, width: 1200, height: 800 }]]);
  const api = {
    calls,
    windows: {
      get: async (id) => { calls.push(['windows.get', id]); if (!windows.has(id)) throw new Error('no window'); return { ...windows.get(id) }; },
      create: async (o) => { calls.push(['windows.create', o]); windows.set(7, { id: 7, state: 'normal', width: o.width, height: o.height }); return { id: 7, tabs: [{ id: 70 }] }; },
      update: async (id, o) => { calls.push(['windows.update', id, o]); Object.assign(windows.get(id), o); return windows.get(id); },
      remove: async (id) => { calls.push(['windows.remove', id]); windows.delete(id); },
    },
    tabs: {
      get: async (id) => { calls.push(['tabs.get', id]); polls++; return { id, status: failLoad || polls < loadPolls ? 'loading' : 'complete', url: polls < 2 ? 'about:blank' : 'https://example.com/page' }; },
      update: async (id, o) => { calls.push(['tabs.update', id, o]); return { id }; },
      captureVisibleTab: async (windowId) => {
        calls.push(['captureVisibleTab', windowId]);
        if (quota) { quota = false; throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.'); }
        return PNG(++shot);
      },
      ...(captureTab ? { captureTab: async (tabId, o) => { calls.push(['captureTab', tabId, o]); return PNG(++shot); } } : {}),
    },
  };
  return api;
}

/** pageCall stand-in: answers by what the injected function reads. */
function pages({ view = { w: 1180, h: 700, x: 0, y: 300, screen: { x: 0, y: 25, w: 1440, h: 875 } }, probeView = { w: 1180, h: 640 }, docHeight = 2000, ...opts } = {}) {
  const log = [];
  let scrollY = 0;
  const pageCall = async (tabId, func, args = []) => {
    const src = String(func);
    log.push([tabId, src.slice(0, 40), args]);
    if (/x: scrollX/.test(src)) return view;
    if (/scrollHeight/.test(src)) return { w: (tabId === 70 ? probeView : view).w, vh: probeView.h, h: docHeight };
    if (/innerWidth, h: innerHeight/.test(src)) return probeView;
    if (/scrollTo\(0, wantY\)/.test(src)) { scrollY = Math.min(args[0], docHeight - probeView.h); return { y: scrollY, hidden: !!opts.hidden }; }
    if (/visibilityState/.test(src)) return opts.hidden ? 'hidden' : 'visible';
    return undefined;
  };
  return { pageCall, log };
}

const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

const noFocus = (calls) => {
  for (const c of calls) {
    if (c[0] === 'windows.create') assert.strictEqual(c[1].focused, false, 'the copy window is created unfocused');
    if (c[0] === 'windows.update') assert.ok(!('focused' in c[2]) && !('state' in c[2]), 'never focuses or changes a window\'s state');
    if (c[0] === 'tabs.update') assert.ok(!('active' in c[2]) && !('highlighted' in c[2]), 'never switches tabs');
  }
};

test('screenshotPlan: the visible tab, Firefox\'s captureTab, a copy in Chrome only when asked, an error in Safari', () => {
  assert.strictEqual(S.screenshotPlan({ showing: true }), 'visible');
  assert.strictEqual(S.screenshotPlan({ showing: true, copy: true }), 'visible', 'a tab that\'s showing needs no copy');
  const hint = S.screenshotPlan({ showing: false }).error;
  assert.match(hint, /that tab isn't showing.*`trif screenshot --copy` captures a fresh copy of the page in a window that appears briefly at the edge of the screen.*prefer `trif sweep`, `trif text` or `trif run`/);
  assert.match(S.screenshotPlan({ showing: true, full: true }).error, /full page in Chrome would mean scrolling the user's tab.*--copy/);
  assert.strictEqual(S.screenshotPlan({ showing: false, copy: true }), 'copy');
  assert.strictEqual(S.screenshotPlan({ showing: true, full: true, copy: true }), 'copy', 'a full page in Chrome would scroll the user\'s tab');
  assert.strictEqual(S.screenshotPlan({ showing: false, captureTab: true, browser: 'Firefox' }), 'tab', 'Firefox: no copy, no window');
  assert.strictEqual(S.screenshotPlan({ showing: true, full: true, captureTab: true }), 'tab');
  assert.strictEqual(S.screenshotPlan({ showing: true, browser: 'Safari' }), 'visible');
  assert.match(S.screenshotPlan({ showing: false, browser: 'Safari' }).error, /isn't showing.*Safari/);
  assert.match(S.screenshotPlan({ showing: false, browser: 'Safari', copy: true }).error, /Safari/, 'no copies in Safari');
  assert.match(S.screenshotPlan({ showing: true, full: true, browser: 'Safari' }).error, /no --full/);
});

test('sliceOffsets: viewport steps, the last flush with the bottom, capped', () => {
  assert.deepStrictEqual(S.sliceOffsets(500, 700), [0]);
  assert.deepStrictEqual(S.sliceOffsets(2000, 700), [0, 700, 1300]);
  assert.deepStrictEqual(S.sliceOffsets(1400, 700), [0, 700]);
  assert.strictEqual(S.sliceOffsets(100000, 700).length, S.MAX_SLICES);
});

test('a tab that is showing: captureVisibleTab of its window, nothing opened, no note', async () => {
  const api = mockApi();
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: true, url: 'https://example.com/page' }, {}, { ...pages(), browser: 'Chrome' });
  assert.deepStrictEqual(r, { dataUrl: PNG(1), how: 'visible', note: null, full: false });
  assert.ok(!api.calls.some((c) => c[0] === 'windows.create'));
});

test('Chrome, a background tab without --copy: refused with the hint, nothing opened or captured', async () => {
  const api = mockApi({ active: false });
  await assert.rejects(S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, {}, { ...pages(), browser: 'Chrome' }), /--copy/);
  await assert.rejects(S.captureScreenshot(api, { id: 5, windowId: 1, active: true, url: 'https://example.com/page' }, { full: true }, { ...pages(), browser: 'Chrome' }), /--copy/);
  assert.ok(!api.calls.some((c) => c[0] === 'windows.create' || c[0] === 'captureVisibleTab'));
});

test('Chrome, a background tab: a copy in an unfocused window the size of the user\'s, at its scroll position, closed after', async () => {
  const api = mockApi({ active: false });
  const p = pages();
  const probes = [];
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, { copy: true },
    { ...p, ...fakeClock(), browser: 'Chrome', onProbe: (id, open) => probes.push([id, open]) });
  assert.strictEqual(r.how, 'copy');
  assert.strictEqual(r.dataUrl, PNG(1));
  assert.match(r.note, /fresh copy of https:\/\/example\.com\/page.*not focused.*the tab isn't showing.*scroll position.*isn't the tab's exact state/);
  const create = api.calls.find((c) => c[0] === 'windows.create')[1];
  // The user's window size, against the right edge of the screen, 45% past it; never focused.
  assert.deepStrictEqual(create, { url: 'about:blank', focused: false, type: 'normal', width: 1200, height: 800, left: 1440 - 660, top: 25 });
  assert.ok(api.calls.some((c) => c[0] === 'tabs.update' && c[2].muted === true), 'muted before it loads');
  assert.ok(api.calls.some((c) => c[0] === 'tabs.update' && c[2].url === 'https://example.com/page'));
  // The copy's viewport was 60px shorter: the window grows by that.
  assert.ok(api.calls.some((c) => c[0] === 'windows.update' && c[1] === 7 && c[2].height === 860 && c[2].width === 1200));
  assert.ok(p.log.some(([tab, , args]) => tab === 70 && args[0] === 0 && args[1] === 300), 'scrolled to the tab\'s position');
  assert.deepStrictEqual(api.calls.filter((c) => c[0] === 'captureVisibleTab').map((c) => c[1]), [7], 'only the copy window is captured');
  assert.deepStrictEqual(api.calls[api.calls.length - 1], ['windows.remove', 7]);
  assert.deepStrictEqual(probes, [[7, true], [7, false]]);
  noFocus(api.calls);
});

test('copyBounds: at the right edge, more than half on screen; without screen info, the user\'s window', () => {
  assert.deepStrictEqual(S.copyBounds({ width: 1000, height: 700, top: 100, state: 'normal', left: 50 }, { x: 0, y: 25, w: 1440, h: 875 }), { left: 890, top: 100, width: 1000, height: 700 });
  assert.deepStrictEqual(S.copyBounds({ width: 1000, height: 900, top: 100 }, { x: 1440, y: 0, w: 1920, h: 1055 }), { left: 1440 + 1920 - 550, top: 100, width: 1000, height: 900 });
  assert.deepStrictEqual(S.copyBounds({ width: 1000, height: 700, top: 400 }, { x: 0, y: 25, w: 1440, h: 875 }).top, 200, 'kept on screen vertically');
  assert.deepStrictEqual(S.copyBounds({ width: 1000, height: 700, left: 5, top: 6, state: 'normal' }, null), { width: 1000, height: 700, left: 5, top: 6 });
  assert.deepStrictEqual(S.copyBounds({ width: 1000, height: 700, left: 5, top: 6, state: 'maximized' }, null), { width: 1000, height: 700 });
});

test('bounds Chrome refuses: retried at the user\'s window position', async () => {
  const api = mockApi({ active: false });
  const create = api.windows.create;
  let first = true;
  api.windows.create = async (o) => { if (first) { first = false; api.calls.push(['refused', o]); throw new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.'); } return create(o); };
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, { copy: true }, { ...pages(), ...fakeClock(), browser: 'Chrome' });
  assert.strictEqual(r.how, 'copy');
  assert.deepStrictEqual(api.calls.find((c) => c[0] === 'windows.create')[1], { url: 'about:blank', focused: false, type: 'normal', width: 1200, height: 800, left: 10, top: 20 });
});

test('a copy Chrome stopped drawing (covered window) is reported as possibly stale', async () => {
  const api = mockApi({ active: false });
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, { full: true, copy: true },
    { ...pages({ hidden: true }), ...fakeClock(), browser: 'Chrome', stitch: async () => PNG('all') });
  assert.strictEqual(r.stale, true);
  assert.match(r.note, /stopped drawing the copy.*out of date or blank/);
});

test('the copy window is closed when loading fails, and the error says what happened', async () => {
  const api = mockApi({ active: false, failLoad: true });
  await assert.rejects(
    S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, { timeout: 2000, copy: true }, { ...pages(), ...fakeClock(), browser: 'Chrome' }),
    /copy of https:\/\/example\.com\/page didn't finish loading/);
  assert.deepStrictEqual(api.calls[api.calls.length - 1], ['windows.remove', 7]);
  noFocus(api.calls);
});

test('a minimized window counts as not showing; incognito copies stay incognito; the capture quota is retried', async () => {
  const api = mockApi({ state: 'minimized', quotaOnce: true });
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: true, incognito: true, url: 'https://example.com/page' }, { copy: true }, { ...pages(), ...fakeClock(), browser: 'Chrome' });
  assert.strictEqual(r.how, 'copy');
  const create = api.calls.find((c) => c[0] === 'windows.create')[1];
  assert.strictEqual(create.incognito, true);
  assert.strictEqual(create.width, 1200);
  assert.strictEqual(api.calls.filter((c) => c[0] === 'captureVisibleTab').length, 2);
});

test('Chrome --full: slices of the copy, stitched, fixed elements hidden after the first; the user\'s tab is never scrolled', async () => {
  const api = mockApi({ active: true });
  const p = pages({ docHeight: 2000 });
  let stitched = null;
  const r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: true, url: 'https://example.com/page' }, { full: true, copy: true },
    { ...p, ...fakeClock(), browser: 'Chrome', stitch: async (shots, size) => { stitched = { shots, size }; return PNG('all'); } });
  assert.strictEqual(r.how, 'copy');
  assert.strictEqual(r.full, true);
  assert.strictEqual(r.dataUrl, PNG('all'));
  assert.deepStrictEqual(stitched.shots.map((s) => s.y), [0, 640, 1280, 1360]);
  assert.deepStrictEqual(stitched.size, { width: 1180, height: 2000 });
  assert.deepStrictEqual(p.log.filter(([, src]) => /wantY/.test(src)).map(([, , a]) => a[1]), [false, true, true, true]);
  assert.ok(!p.log.some(([tab, src]) => tab === 5 && /scrollTo/.test(src)), 'no scrolling in the user\'s tab');
  assert.match(r.note, /full page stitched from 4 captures/);
  assert.match(r.note, /a full page would mean scrolling your tab/);
});

test('Firefox: captureTab of the tab itself, background or not; --full captures the page rect', async () => {
  const api = mockApi({ active: false, captureTab: true });
  const p = pages({ docHeight: 20000 });
  let r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/page' }, {}, { ...p, browser: 'Firefox' });
  assert.strictEqual(r.how, 'tab');
  assert.match(r.note, /visible part of the tab while it stays in the background/);
  assert.deepStrictEqual(api.calls.find((c) => c[0] === 'captureTab'), ['captureTab', 5, { format: 'png' }]);
  r = await S.captureScreenshot(api, { id: 5, windowId: 1, active: true, url: 'https://example.com/page' }, { full: true }, { ...p, browser: 'Firefox' });
  assert.deepStrictEqual(api.calls.filter((c) => c[0] === 'captureTab')[1][2], { format: 'png', rect: { x: 0, y: 0, width: 1180, height: S.FULL_MAX_HEIGHT }, scale: 1 });
  assert.strictEqual(r.cut, true);
  assert.match(r.note, /cut at 12000 px of 20000/);
  assert.ok(!api.calls.some((c) => c[0] === 'windows.create' || c[0] === 'captureVisibleTab'));
});

test('Safari: a background tab is a clear error, not a switch', async () => {
  const api = mockApi({ active: false });
  await assert.rejects(S.captureScreenshot(api, { id: 5, windowId: 1, active: false, url: 'https://example.com/' }, {}, { ...pages(), browser: 'Safari' }), /Safari can only capture the tab in front/);
  assert.ok(!api.calls.some((c) => c[0] === 'windows.create' || c[0] === 'captureVisibleTab'));
});

// ---- the CLI

let ext;
let home;
after(() => ext && ext.close());

test('trif screenshot: the path on stdout, the note on stderr, --full and --copy sent, --json has both', async () => {
  home = tempDir();
  ext = new FakeExtension({ home, env: { TRIF_TIMEOUT_GRACE: '300' } });
  ext.hello();
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let last = null;
  ext.handlers = {
    screenshot: (args) => { last = args; return { dataUrl: `data:image/png;base64,${PNG_1PX}`, how: 'copy', full: !!args.full, note: 'this is a fresh copy of the page' }; },
  };
  await ext.waitForSocket();
  const out = path.join(home, 'a.png');
  let r = await runCli(['screenshot', '--url', 'example', '--full', '--copy', '-o', out], { home });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), out);
  assert.match(r.stderr, /^note: this is a fresh copy of the page$/m);
  assert.strictEqual(last.full, true);
  assert.strictEqual(last.copy, true);
  assert.strictEqual(last.url, 'example');
  assert.ok(last.timeout >= 45000, 'the helper waits long enough for a page load');
  assert.ok(fs.existsSync(out));
  r = await runCli(['screenshot', '--json', '-o', out], { home });
  assert.strictEqual(last.copy, false, 'no copy unless asked');
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual(j, { file: out, how: 'copy', full: false, note: 'this is a fresh copy of the page' });
});
