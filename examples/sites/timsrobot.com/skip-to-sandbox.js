// ==WebMod==
// @name        Skip to Sandbox
// @description All mods available to mess with
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     2
// ==/WebMod==

// The homepage demo's panel (/demo/shim.js) lists only the mods in sessionStorage 'trif-demo-state'.mods:
// the ones its chats have made so far. This mod lists every demo mod (store.defaultOrder, the demo's full
// order) from the start, adding the missing ones switched off, so the visitor can switch any of them on
// without playing through the chats first. Mods the visitor put in the demo's trash stay there.
//
// It leaves the game alone: the space shooter's You Win screen shows as usual, with its own button for
// sandbox mode. (An earlier version jumped from the win screen straight to sandbox mode, which took the
// win away.) The demo keeps its state from its first load on, so on a first visit the list fills in from
// the next reload.
(() => {
  if (window.top !== window) return; // (the panel is an iframe on this site too: the page does this)
  const SAVED = 'trif-demo-state';
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVED) || 'null');
    if (s?.v !== 1) return;
    const all = (s.store?.defaultOrder?.['timsrobot.com'] || []).map((id) => id.replace(/^timsrobot\.com\//, ''))
      .filter((slug) => /^[a-z0-9-]{1,40}$/.test(slug));
    const trashed = new Set(s.trash || []);
    const have = new Set(s.mods || []);
    const missing = all.filter((slug) => !have.has(slug) && !trashed.has(slug));
    if (!missing.length) return;
    s.mods = [...(s.mods || []), ...missing];
    s.store = s.store || {};
    s.store.disabled = s.store.disabled || {};
    for (const slug of missing) s.store.disabled[`timsrobot.com/${slug}`] = true;
    sessionStorage.setItem(SAVED, JSON.stringify(s));
    window.trif?.log('added to the panel (off):', missing.join(', '));
  } catch (e) { window.trif?.warn('could not list all mods', String(e)); }
})();
