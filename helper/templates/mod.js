// ==WebMod==
// @name        {{name}}
// @description TODO: one line, in plain words, saying what the user will see
// @match       *://{{site}}/*
// @match       *://*.{{site}}/*
// @run-at      document-start
// @risk        0 render-only
// ==/WebMod==

// A free mod: this file runs in the page itself (same `window` as the site) every time a matching page loads,
// at document-start: before the site's own scripts, and before <head> and <body> exist.
// Save the file, then `trif reload` to see the change; `trif errors` shows anything it threw.
// window.trif?.log(...) records messages you can read back with `trif logs`.

// --- 1. CSS: the simplest and sturdiest way to hide or restyle things. ----------------------------
// Prefer stable hooks (data-testid, aria-label, role, href) over generated class names.

const CSS = `
  /* [data-testid="sidebarColumn"] { display: none !important; } */
`;

function addStyle(css) {
  const style = document.createElement('style');
  style.dataset.trif = '{{site}}/{{mod}}';
  style.textContent = css;
  const insert = () => (document.head || document.documentElement).append(style);
  if (document.head) return insert();
  // At document-start <head> doesn't exist yet: wait for it.
  const obs = new MutationObserver(() => {
    if (document.head) { obs.disconnect(); insert(); }
  });
  obs.observe(document, { childList: true, subtree: true });
}

addStyle(CSS);

// --- 2. Elements that appear later (single-page apps re-render all the time). --------------------
// Calls fn(el) once for every element matching `selector`, now and whenever new ones show up.

function onElements(selector, fn) {
  const seen = new WeakSet();
  let queued = false;
  const scan = () => {
    queued = false;
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      try { fn(el); } catch (e) { window.trif?.error(e); }
    }
  };
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(scan); } };
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  schedule();
}

// onElements('article', (article) => {
//   if (article.textContent.includes('Promoted')) article.style.display = 'none';
// });

// --- 3. Run something once the DOM is ready. ------------------------------------------------------

// function ready(fn) {
//   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
//   else fn();
// }
// ready(() => trif.log('{{mod}} loaded on', location.href));
