// `trif screenshot`: capturing a tab without ever switching the user's tabs or focusing a window.
//
// - Firefox: tabs.captureTab captures any tab, showing or not, in its exact state; with `full`, the whole
//   page (its `rect` is in page coordinates).
// - Chrome (and Safari): captureVisibleTab only captures the tab showing in a window. For a tab that's
//   showing, that's used. For one that isn't (or for a full page, which would mean scrolling the user's
//   tab), Chrome loads a fresh copy of the page in a window of its own that isn't focused, the size of the
//   user's, captures that and closes it. The copy runs the same mods, but it is not the tab's exact
//   state, and the answer says so. Safari: only a tab that's showing; otherwise a clear error.
// Every function takes the browser API and helpers as parameters, so the tests can drive them.

export const FULL_MAX_HEIGHT = 12000;   // CSS px of a full-page capture; longer pages are cut
export const MAX_SLICES = 14;           // captureVisibleTab calls for one stitched full page
const CAPTURE_INTERVAL_MS = 550;        // Chrome allows two captureVisibleTab calls a second
const SETTLE_MS = 600;                  // after the copy loads: late layout, web fonts, lazy images in view
const OFFSCREEN = 0.45;                 // share of the copy window's width put past the screen's right edge

/**
 * Where the copy window goes: the size of the user's window (so the page lays out the same), against the
 * right edge of the screen with OFFSCREEN of it past the edge. Chrome only draws windows that aren't
 * covered (an unfocused window behind the user's would show stale frames), and it refuses bounds that
 * are less than half on screen. `screen` is the tab's screen.avail* (or null: then the user's window's
 * own position).
 */
export function copyBounds(win, screen) {
  const width = win?.width || 1280;
  const height = win?.height || 900;
  if (screen && screen.w > 0 && screen.h > 0) {
    const left = Math.max(screen.x, screen.x + screen.w - Math.ceil(width * (1 - OFFSCREEN)));
    const top = Math.max(screen.y, Math.min(Number.isFinite(win?.top) ? win.top : screen.y, screen.y + screen.h - height));
    return { left, top, width, height };
  }
  const b = { width, height };
  if (win && win.state === 'normal' && Number.isFinite(win.left) && Number.isFinite(win.top)) Object.assign(b, { left: win.left, top: win.top });
  return b;
}

/**
 * How to capture: 'visible' (captureVisibleTab), 'tab' (Firefox's captureTab), 'copy' (a fresh copy in
 * an unfocused window), or {error}.
 */
export function screenshotPlan({ showing, full = false, captureTab = false, browser = 'Chrome' }) {
  if (captureTab) return 'tab';
  if (showing && !full) return 'visible';
  if (browser === 'Safari') {
    return { error: full
      ? "Safari can only capture the visible part of a tab (no --full)"
      : "that tab isn't showing, and Safari can only capture the tab in front (TRIF doesn't switch tabs while the user is browsing); " +
        'inspect it with `trif sweep`, `trif text` or `trif run` instead, or try again when it is in front' };
  }
  return 'copy';
}

/** Scroll offsets for a stitched full page: viewport-sized steps, the last one flush with the bottom. */
export function sliceOffsets(total, viewport, max = MAX_SLICES) {
  if (!(viewport > 0) || total <= viewport) return [0];
  const n = Math.min(max, Math.ceil(total / viewport));
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.min(i * viewport, Math.max(0, Math.min(total, n * viewport) - viewport)));
  return [...new Set(out)];
}

/** What the agent is told about a capture that isn't simply the tab as it is on screen. */
export function captureNote({ how, full, showing, url, height, cut, slices, stale }) {
  const page = full ? `the full page${cut ? ` (cut at ${FULL_MAX_HEIGHT} px of ${height})` : ''}` : 'the visible part';
  if (how === 'tab') return showing && !full ? null : `captured ${page} of the tab${showing ? '' : ' while it stays in the background'}, as it is now`;
  if (how === 'copy') {
    return `this is a fresh copy of ${url}, loaded with the mods in a window TRIF opened at the edge of the screen (not focused) and closed again, ` +
      `because ${showing ? 'a full page would mean scrolling your tab' : "the tab isn't showing and TRIF doesn't switch tabs"}; ` +
      `${page}${slices > 1 ? ` stitched from ${slices} captures (fixed and sticky elements only at the top)` : full ? '' : ', at the tab\'s scroll position'}. ` +
      "It isn't the tab's exact state: open menus, typed text and content loaded since aren't in it" +
      (stale ? ". Chrome had stopped drawing the copy (its window was covered), so parts of the image may be out of date or blank" : '');
  }
  return null;
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Capture `tab`. deps: {pageCall(tabId, func, args) → result (isolated world), stitch(shots, size) → dataUrl,
 * sleep?, now?, browser, firefox?}. Returns {dataUrl, how, note, full, width?, height?, cut?}.
 */
export async function captureScreenshot(api, tab, { full = false, timeout = 45000 } = {}, deps) {
  const sleep = deps.sleep || sleepDefault;
  const win = await api.windows.get(tab.windowId).catch(() => null);
  const showing = !!(tab.active && win && win.state !== 'minimized');
  const plan = screenshotPlan({ showing, full, captureTab: typeof api.tabs.captureTab === 'function', browser: deps.browser });
  if (plan.error) throw new Error(plan.error);
  if (plan === 'visible') {
    return { dataUrl: await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' }), how: 'visible', note: null, full: false };
  }
  if (plan === 'tab') {
    if (!full) return { dataUrl: await api.tabs.captureTab(tab.id, { format: 'png' }), how: 'tab', note: captureNote({ how: 'tab', showing }), full: false };
    const d = await deps.pageCall(tab.id, () => ({
      w: document.documentElement.clientWidth || innerWidth,
      h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight),
    }));
    const height = Math.min(d.h, FULL_MAX_HEIGHT);
    const dataUrl = await api.tabs.captureTab(tab.id, { format: 'png', rect: { x: 0, y: 0, width: d.w, height }, ...(height > 4000 ? { scale: 1 } : {}) });
    return { dataUrl, how: 'tab', full: true, width: d.w, height, cut: d.h > height, note: captureNote({ how: 'tab', full: true, showing, height: d.h, cut: d.h > height }) };
  }
  return captureCopy(api, tab, win, { full, showing, timeout }, { ...deps, sleep });
}

async function captureCopy(api, tab, win, { full, showing, timeout }, deps) {
  const { sleep, pageCall } = deps;
  const now = deps.now || Date.now;
  const deadline = now() + timeout;
  const url = tab.url || tab.pendingUrl || '';
  // The user's viewport and scroll position, to reproduce them.
  const view = await pageCall(tab.id, () => ({
    w: innerWidth, h: innerHeight, x: scrollX, y: scrollY,
    screen: { x: screen.availLeft || 0, y: screen.availTop || 0, w: screen.availWidth, h: screen.availHeight },
  })).catch(() => null);
  const create = (bounds) => api.windows.create({ url: 'about:blank', focused: false, type: 'normal', ...bounds, ...(tab.incognito ? { incognito: true } : {}) });
  let created;
  try {
    created = await create(copyBounds(win, view && view.screen));
  } catch (e) {
    if (!/bounds/i.test(String(e?.message ?? e))) throw e;
    created = await create(copyBounds(win, null));
  }
  deps.onProbe?.(created.id, true);
  const probe = created.tabs && created.tabs[0];
  try {
    if (!probe) throw new Error('the window TRIF opened for the copy has no tab');
    await api.tabs.update(probe.id, { muted: true }).catch(() => {});
    await api.tabs.update(probe.id, { url });
    // Loaded: complete, and no longer about:blank.
    for (;;) {
      const t = await api.tabs.get(probe.id);
      if (t.status === 'complete' && t.url && t.url !== 'about:blank') break;
      if (now() > deadline) throw new Error(`the copy of ${url} didn't finish loading`);
      await sleep(100);
    }
    // Same viewport size as the user's tab (window chrome differs between windows).
    if (view) {
      const got = await pageCall(probe.id, () => ({ w: innerWidth, h: innerHeight })).catch(() => null);
      if (got && (got.w !== view.w || got.h !== view.h)) {
        const cur = await api.windows.get(created.id).catch(() => null);
        if (cur) await api.windows.update(created.id, { width: cur.width + view.w - got.w, height: cur.height + view.h - got.h }).catch(() => {});
      }
    }
    let stale = false;
    const settled = await pageCall(probe.id, async (ms) => {
      try { await Promise.race([document.fonts && document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]); } catch { /* no fonts API */ }
      await new Promise((r) => setTimeout(r, ms));
      return document.visibilityState;
    }, [SETTLE_MS]).catch(() => sleep(SETTLE_MS));
    if (settled === 'hidden') stale = true;
    let last = 0;
    const capture = async () => {
      const wait = last + CAPTURE_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      last = now();
      try {
        return await api.tabs.captureVisibleTab(created.id, { format: 'png' });
      } catch (e) {
        if (!/quota|MAX_CAPTURE/i.test(String(e?.message ?? e))) throw e;
        await sleep(1000);
        last = now();
        return api.tabs.captureVisibleTab(created.id, { format: 'png' });
      }
    };
    if (!full) {
      if (view && (view.x || view.y)) await pageCall(probe.id, (x, y) => { scrollTo(x, y); return new Promise((r) => setTimeout(r, 150)); }, [view.x, view.y]).catch(() => {});
      return { dataUrl: await capture(), how: 'copy', full: false, note: captureNote({ how: 'copy', showing, url, stale: stale && !!(view && (view.x || view.y)) }) };
    }
    const d = await pageCall(probe.id, () => ({
      w: document.documentElement.clientWidth || innerWidth, vh: innerHeight,
      h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight),
    }));
    const target = Math.min(d.h, FULL_MAX_HEIGHT, MAX_SLICES * d.vh);
    const shots = [];
    const offsets = sliceOffsets(target, d.vh);
    for (let i = 0; i < offsets.length; i++) {
      if (now() > deadline) break;
      const y = await pageCall(probe.id, (wantY, hideFixed) => {
        if (!document.getElementById('__trif-shot')) {
          // No scrollbars in the slices (overlay scrollbars show up in each one).
          const st = document.createElement('style');
          st.id = '__trif-shot';
          st.textContent = 'html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }';
          (document.head || document.documentElement).append(st);
        }
        if (hideFixed && !window.__trifShotHidden) {
          // After the first capture, fixed and sticky elements would repeat in every slice.
          window.__trifShotHidden = true;
          for (const el of document.querySelectorAll('body *')) {
            const p = getComputedStyle(el).position;
            if (p === 'fixed' || p === 'sticky') el.style.setProperty('visibility', 'hidden', 'important');
          }
        }
        scrollTo(0, wantY);
        return new Promise((r) => setTimeout(() => r({ y: scrollY, hidden: document.visibilityState === 'hidden' }), 120));
      }, [offsets[i], i > 0]);
      if (i > 0 && y.hidden) stale = true;
      shots.push({ y: y.y, dataUrl: await capture() });
    }
    const height = shots.length ? Math.min(target, shots[shots.length - 1].y + d.vh) : d.vh;
    const dataUrl = shots.length === 1 ? shots[0].dataUrl : await deps.stitch(shots, { width: d.w, height });
    return {
      dataUrl, how: 'copy', full: true, width: d.w, height, cut: d.h > height, ...(stale ? { stale: true } : {}), slices: shots.map((x) => x.y), viewport: d.vh,
      note: captureNote({ how: 'copy', full: true, showing, url, height: d.h, cut: d.h > height, slices: shots.length, stale }),
    };
  } finally {
    await api.windows.remove(created.id).catch(() => {});
    deps.onProbe?.(created.id, false);
  }
}

/**
 * Stitch viewport captures ({y: scroll offset in CSS px, dataUrl}) into one PNG data URL of `width` x
 * `height` CSS px, scaled like the captures. Uses OffscreenCanvas (service worker and background page).
 */
export async function stitchShots(shots, { width, height }) {
  const bitmaps = [];
  for (const s of shots) bitmaps.push(await createImageBitmap(await (await fetch(s.dataUrl)).blob()));
  const scale = bitmaps[0].width / width;
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  shots.forEach((s, i) => ctx.drawImage(bitmaps[i], 0, Math.round(s.y * scale)));
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
