// `trif screenshot`: capturing a tab without ever switching the user's tabs or focusing a window.
//
// - Firefox: tabs.captureTab captures any tab, showing or not, in its exact state; with `full`, the whole
//   page (its `rect` is in page coordinates).
// - Chrome (and Safari): captureVisibleTab only captures the tab showing in a window. For a tab that's
//   showing, that's used. For one that isn't (or for a full page, which would mean scrolling the user's
//   tab), only when asked (`copy`, `trif screenshot --copy`): Chrome loads a fresh copy of the page in a
//   window of its own that isn't focused, the size of the user's, captures that and closes it. That
//   window shows at the edge of the screen for a second or so, so it's never the default. The copy runs
//   the same mods, but it is not the tab's exact state, and the answer says so. Without `copy`, a clear
//   error that says how. Safari: only a tab that's showing. The copy loads the page again with the
//   user's cookies, so an address that looks like a one-time link is refused (unless `force`), and where
//   the copy ended up is checked like any URL a command touches (`checkUrl`) before every capture.
// - Without access to every site (`allUrls` false: TRIF only has the sites the user turned it on for; see
//   "site access" in lib.js): Chrome's captureVisibleTab wants <all_urls> or activeTab, a site's own host
//   permission isn't enough (Chromium's PermissionsData::CanCaptureVisiblePage, checked in Chrome 156), and
//   Firefox's captureTab wants <all_urls> (its tabs.json schema; captureVisibleTab takes activeTab since
//   Firefox 126). activeTab comes from the user clicking TRIF's toolbar button on that tab (in Chrome the
//   button opens the panel from action.onClicked for that reason, background.js). So then only the tab in
//   front can be captured, after that click; anything else is a clear error. Users who installed TRIF when
//   <all_urls> was required keep it, and keep everything above.
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
export function screenshotPlan({ showing, full = false, captureTab = false, browser = 'Chrome', copy = false, allUrls = true }) {
  if (captureTab && allUrls) return 'tab';
  if (showing && !full) return 'visible';
  if (!allUrls) return { error: notAllSites(browser, full ? 'To capture a full page' : "To capture a tab that isn't showing") };
  // Firefox puts captureTab in a page only if the add-on had <all_urls> when that page loaded (checked in
  // Firefox 159: granted later, it shows up in new pages and after the add-on restarts, not in the running
  // background, until Firefox suspends that idle event page and starts it again). A restart settles it.
  if (browser === 'Firefox') {
    return { error: 'TRIF got access to every site after Firefox started, and Firefox only lets it capture tabs in the background ' +
      `once TRIF starts again: ask the user to quit and reopen Firefox. ${CHECK_INSTEAD}` };
  }
  if (browser === 'Safari') {
    return { error: full
      ? "Safari can only capture the visible part of a tab (no --full)"
      : "that tab isn't showing, and Safari can only capture the tab in front (TRIF doesn't switch tabs while the user is browsing); " +
        'inspect it with `trif sweep`, `trif text` or `trif run` instead, or try again when it is in front' };
  }
  if (!copy) {
    return { error: (full
      ? `a full page in ${browser} would mean scrolling the user's tab, and TRIF doesn't; `
      : `that tab isn't showing, and TRIF doesn't switch tabs while the user is browsing; `) +
      '`trif screenshot --copy` captures a fresh copy of the page in a window that appears briefly at the edge of the screen. ' +
      'For checks, prefer `trif sweep`, `trif text` or `trif run`, which work on tabs that aren\'t showing' };
  }
  return 'copy';
}

// Without access to every site: what can still be captured, and how to check the page otherwise.
const CHECK_INSTEAD = 'For checks, use `trif sweep`, `trif text` or `trif run`, which work on any tab of the site';
function notAllSites(browser, what) {
  return `${what}, ${browser} wants TRIF to have access to every site, and TRIF only has the sites the user turned it on for. ` +
    `It can capture the tab in front once the user has clicked the TRIF toolbar button on that tab. ${CHECK_INSTEAD}`;
}
function needsClick(browser) {
  return `${browser} lets TRIF capture this tab only after the user clicks the TRIF toolbar button on it (TRIF has access to the sites ` +
    `it's on, which isn't enough for ${browser} to let it take screenshots). Ask the user to click the TRIF button on this tab, then try again. ${CHECK_INSTEAD}`;
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

// Addresses that may act when loaded again (a copy loads the page again, with the user's cookies): one-time
// sign-in and OAuth links, password resets, confirm and unsubscribe links. Query parameter names, and
// path segments.
const ONE_TIME_PARAM = /token|^(code|otp|nonce|ticket|sig|signature|hmac|magic|magic_?link|auth|login_?key|reset|confirm|confirmation|verify|verification|unsubscribe|invite|invitation)$/i;
const ONE_TIME_PATH = /^(unsubscribe|optout|opt-out|confirm|confirmation|verify|verification|activate|activation|magic[-_]?link|reset[-_]?password|password[-_]?reset|oauth2?|callback|sso|authorize|invite|accept[-_]?invite)$/i;

/**
 * Why loading `url` again might do something (a one-time link: sign-in, OAuth, reset, confirm,
 * unsubscribe), or null.
 */
export function oneTimeUrl(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  for (const name of u.searchParams.keys()) if (ONE_TIME_PARAM.test(name)) return `its query has "${name}="`;
  if (u.searchParams.has('state') && u.searchParams.has('code')) return 'it looks like a sign-in callback';
  if (/(^|[#&])(access_token|id_token|token|code)=/i.test(u.hash.slice(1))) return 'its fragment carries a token';
  const seg = u.pathname.split('/').find((s) => ONE_TIME_PATH.test(s.replace(/\.\w+$/, '')));
  if (seg) return `its path has "/${seg}"`;
  return null;
}

/**
 * A window a copy was made in, as remembered (background.js): {id, urls, bounds: {left, top, width,
 * height}}. Whether `win` (from windows.getAll with tabs) is still that window: one tab, at one of those
 * URLs, at those bounds. (Window ids change when the browser restarts and restores its windows, so the id
 * alone could name a window of the user's.)
 */
export function isCopyWindow(win, rec) {
  if (!win || !rec || !Array.isArray(win.tabs) || win.tabs.length !== 1) return false;
  const url = win.tabs[0].url || win.tabs[0].pendingUrl || '';
  if (!(rec.urls || []).includes(url)) return false;
  const b = rec.bounds || {};
  return ['left', 'top', 'width', 'height'].every((k) => Number.isFinite(b[k]) && Math.abs((win[k] ?? NaN) - b[k]) <= 2);
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Capture `tab`. deps: {pageCall(tabId, func, args) → result (isolated world), stitch(shots, size) → dataUrl,
 * sleep?, now?, browser, firefox?, checkUrl?(url) (throws when the copy may not show that URL: the run's
 * scope, TRIF off there), onProbe?(windowId, open, info)}. `force`: make a copy of a one-time link anyway.
 * Returns {dataUrl, how, note, full, width?, height?, cut?}.
 */
export async function captureScreenshot(api, tab, { full = false, copy = false, force = false, timeout = 45000 } = {}, deps) {
  const sleep = deps.sleep || sleepDefault;
  const win = await api.windows.get(tab.windowId).catch(() => null);
  const showing = !!(tab.active && win && win.state !== 'minimized');
  const allUrls = deps.allUrls !== false;
  const plan = screenshotPlan({ showing, full, captureTab: typeof api.tabs.captureTab === 'function', browser: deps.browser, copy, allUrls });
  if (plan.error) throw new Error(plan.error);
  if (plan === 'visible') {
    // captureVisibleTab takes a window, not a tab: the picture is of whatever tab shows there as it's taken.
    // The tab was checked a moment ago (the run's site, the site's "Agent on this site"); if the user has
    // switched tabs in that window since, the picture would be of the other one, on any site. So: what's
    // showing is asked again right before and right after, and a picture of anything else is thrown away.
    const showingNow = async () => {
      if (typeof api.tabs.query !== 'function') return tab;
      const now = (await api.tabs.query({ active: true, windowId: tab.windowId }).catch(() => []))[0];
      if (!now || now.id !== tab.id) throw new Error(`tab ${tab.id} stopped being the one showing in its window while TRIF took the picture, so there's no picture: try again, or use \`trif sweep\` or \`trif text\``);
      if (deps.checkShown) deps.checkShown(now.url || now.pendingUrl || '');
      return now;
    };
    await showingNow();
    let dataUrl;
    try { dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); } catch (e) {
      // ("Either the '<all_urls>' or 'activeTab' permission is required.")
      if (!allUrls && /activeTab|all_urls|permission/i.test(String(e?.message ?? e))) throw new Error(needsClick(deps.browser));
      throw e;
    }
    dataUrl = (await showingNow()) && dataUrl;
    return { dataUrl, how: 'visible', note: null, full: false };
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
  const url = tab.url || tab.pendingUrl || '';
  const why = force ? null : oneTimeUrl(url);
  if (why) {
    throw new Error(`that page's address looks like a one-time link (${why}: sign-in, confirmation, reset or unsubscribe), and --copy ` +
      "loads it again with the user's cookies, which could act on it. Check it with `trif sweep`, `trif text` or `trif run` instead; " +
      'if loading it again is harmless, add --force');
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
  const bounds = { left: created.left, top: created.top, width: created.width, height: created.height };
  const urls = [url];
  deps.onProbe?.(created.id, true, { urls, bounds });
  const probe = created.tabs && created.tabs[0];
  // Where the copy ended up (redirects, a script navigating) must be allowed too: the run's site, a site
  // TRIF is on for. Checked once it has loaded and before every capture.
  const checkCopy = async () => {
    if (!deps.checkUrl) return;
    const t = await api.tabs.get(probe.id);
    const at = t.url || t.pendingUrl || '';
    if (!urls.includes(at)) { urls.push(at); deps.onProbe?.(created.id, true, { urls, bounds }); }
    try { deps.checkUrl(at); } catch (e) {
      throw new Error(`the copy of ${url} went to ${at || 'another page'}, so TRIF closed it: ${e?.message ?? e}`);
    }
  };
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
    await checkCopy();
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
      await checkCopy();
      last = now();
      try {
        return await api.tabs.captureVisibleTab(created.id, { format: 'png' });
      } catch (e) {
        if (!/quota|MAX_CAPTURE/i.test(String(e?.message ?? e))) throw e;
        await sleep(1000);
        await checkCopy();
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
