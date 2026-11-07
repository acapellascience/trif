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

// The demo's Space Shooter (/demo/mods/shooter.js) shows a "You Win!" screen (h1.tss-win-title, with
// .tss-win-above / .tss-win-below around the hero's buttons) offering "sandbox mode". That button just
// fires a `trif-demo-reset` event with { to: 'sandbox' }, which the site's demo.js handles (every mod
// off, the panel open on its switches, page reloaded). This mod fires the same event as soon as the win
// screen appears, and hides it meanwhile so it doesn't flash.
//
// The demo's panel (/demo/shim.js) lists only the mods in sessionStorage 'trif-demo-state'.mods (the ones
// its chats made so far, or the ones in ?mods=), so sandbox mode could show a short or empty list. This
// mod fills that list with every demo mod (store.defaultOrder, the demo's full order), adding the missing
// ones switched off: before going to sandbox, and on any load once the demo's chats are all played.
// Mods the visitor put in the demo's trash stay there.
(() => {
  if (window.top !== window) return; // (the panel is an iframe on this site too: the page does this)
  const SAVED = 'trif-demo-state';
  const surfaceAll = (force) => {
    try {
      const s = JSON.parse(sessionStorage.getItem(SAVED) || 'null');
      if (s?.v !== 1) return;
      if (!force && !(s.replayed || []).includes('wrapup')) return; // demo still running: leave it be
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
  };
  surfaceAll(false);

  const style = document.createElement('style');
  style.textContent = `.tss-win-above, .tss-win-below { display: none !important; }`;
  (document.head || document.documentElement).append(style);

  let fired = false;
  const check = () => {
    if (fired || !document.querySelector('.tss-win-title')) return;
    fired = true;
    window.trif?.log('You Win screen appeared: going to sandbox mode');
    surfaceAll(true);
    dispatchEvent(new CustomEvent('trif-demo-reset', { detail: { to: 'sandbox' } }));
  };

  let queued = false;
  new MutationObserver(() => {
    if (fired || queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { check(); } catch (e) { window.trif?.warn(String(e)); } }, 50);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
