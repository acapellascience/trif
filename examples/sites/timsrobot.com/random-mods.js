// ==WebMod==
// @name        R for Random
// @description Shuffle the toggles with R
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// Pressing R flips a coin for each mod in the demo's panel (sessionStorage 'trif-demo-state'.mods: 13 once
// Skip to Sandbox has listed them all) and reloads the page with the winners, as the panel's own switches
// do: their on/off goes in store.disabled (the panel reads it back after the reload) and the page loads
// with ?mods=<the ones on> (demo.js/the Worker serve those). Ignored while typing, with modifier keys, and
// before the demo has any mods. (Space Shooter also uses R, to restore blasted words; the reload makes
// that moot.)
(() => {
  if (window.top !== window) return; // (the demo's panel is an iframe on this site)
  const SAVED = 'trif-demo-state';
  const OK = /^[a-z0-9-]{1,40}$/;

  const typing = (e) => {
    const t = e.composedPath?.()[0] || e.target;
    return t instanceof Element && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  };

  addEventListener('keydown', (e) => {
    try {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      const s = JSON.parse(sessionStorage.getItem(SAVED) || 'null');
      const mods = (s?.v === 1 ? s.mods || [] : []).filter((m) => OK.test(m));
      if (!mods.length) return;
      const on = [];
      s.store = s.store || {};
      const disabled = s.store.disabled = s.store.disabled || {};
      for (const m of mods) {
        const flip = crypto.getRandomValues(new Uint8Array(1))[0] < 128;
        if (flip) { on.push(m); delete disabled[`timsrobot.com/${m}`]; } else disabled[`timsrobot.com/${m}`] = true;
      }
      if (!(s.sitesOn || []).includes('timsrobot.com')) s.sitesOn = ['timsrobot.com']; // TRIF on, in the demo
      sessionStorage.setItem(SAVED, JSON.stringify(s));
      window.trif?.log(`random: ${on.length} of ${mods.length} on:`, on.join(', ') || '(none)');
      const path = location.pathname === '/' || ['/report', '/windows'].includes(location.pathname) ? location.pathname : '/';
      location.replace(on.length ? `${path}?mods=${on.join(',')}` : path);
    } catch (err) { window.trif?.warn('random failed', String(err)); }
  }, true);
})();
