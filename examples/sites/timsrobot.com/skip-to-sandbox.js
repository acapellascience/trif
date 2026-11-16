// ==WebMod==
// @name        Skip to Sandbox
// @description All mods available to mess with
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     4
// @boxed
// @powers      site-storage session:trif-demo-state, page-events trif-demo-reset
// ==/WebMod==

// Skips the homepage demo's chats: on arrival the demo goes straight to its sandbox mode (what the space
// shooter's You Win screen offers: every mod switched off, the panel open on its switches, the chat the
// visitor's), with every demo mod listed, so they can switch any of them on right away.
//
// How: the demo's page script (/demo.js, site/demo/tab.js) handles a `trif-demo-reset` event with
// { to: 'sandbox' }: it marks the saved state (sessionStorage 'trif-demo-state') and reloads the home page.
// Before that, this lists every demo mod in the saved state, switched off (the panel lists only those).
// Once only: not when the demo's chats are already all played (sandbox mode marks them so) or right after
// the reset (the state's `sandbox` flag, which the panel clears once it's applied), so no reload loop.
// The You Win screen is left alone. Mods the visitor put in the demo's trash stay there.
// Boxed: that one storage key (site-storage) and that one signal to the demo's script (page-events).
// (Only the top frame: TRIF runs mods there, so the demo's panel iframe never has this.)
if (new URL(page.url).pathname !== '/') return; // (the demo lives on the home page)
const SAVED = 'trif-demo-state';
const store = trif.storage('session');
// The demo's mods, in its order (site/build-demo.js DEMO_ORDER), for a first visit, before the demo has
// saved its own list (store.defaultOrder).
const ORDER = ['tagline', 'robot', 'neon', 'jelly', 'fireworks', 'stickers', 'checklist', 'terminal', 'led', 'gravity', 'tilt', 'shooter', 'rave'];
let s = null;
try { s = JSON.parse(store.get(SAVED) || 'null'); } catch {}
if (s && s.v !== 1) return; // (a state this doesn't know: leave it be)
if (s?.sandbox || (s?.replayed || []).includes('wrapup')) return; // already in sandbox mode (or past the chats)

try {
  s = s || { v: 1, sitesOn: ['timsrobot.com'], store: {}, mods: [] };
  const order = (s.store?.defaultOrder?.['timsrobot.com'] || []).map((id) => id.replace(/^timsrobot\.com\//, ''));
  const all = (order.length ? order : ORDER).filter((slug) => /^[a-z0-9-]{1,40}$/.test(slug));
  const trashed = new Set(s.trash || []);
  s.mods = [...new Set([...(s.mods || []), ...all.filter((slug) => !trashed.has(slug))])];
  store.set(SAVED, JSON.stringify(s));
} catch (e) { trif.warn('could not list all mods', String(e)); return; }

// The demo's script listens once it's run (it's deferred, so by the time the document is parsed).
await trif.ready;
trif.log('skipping the demo\'s chats: sandbox mode');
trif.signal('trif-demo-reset', { to: 'sandbox' });
