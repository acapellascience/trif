// ==WebMod==
// @name        {{name}}
// @description TODO: one line, in plain words, saying what the user will see
// @match       *://{{site}}/*
// @match       *://*.{{site}}/*
// @boxed
// (if it needs an exception, ask for it: // @powers sound, controls, keys, read-drafts, site-data, page-data, search-box <url with {query}>, media, go-to <paths>, click (with // @click words: selector lines), write-drafts or mods; see "Powers" in TECHNIQUES.md)
// @risk        0 render-only
// ==/WebMod==

// A boxed mod: this runs in TRIF's sandbox, not in the page. It has only TRIF's API (page, trif, console,
// the timers, Math, Date) and the JavaScript language: no window, document, fetch or storage. It changes
// what the page shows, and can't send, load or click anything itself, so it never waits for the user's OK.
// Elements are TRIF's stand-ins: find/findAll, text/setText, attr/setAttr, classes, style(prop, value),
// hide/show, append/before/after/remove, on(type, fn), rect(), clone(). See "Boxed mods" in TECHNIQUES.md.
// `trif check` lists anything in it the sandbox wouldn't give it; `trif errors` shows what it threw.

// CSS that loads nothing (no url() other than data:)
trif.css(`
  /* [data-testid="sidebarColumn"] { display: none !important; } */
`);

// Hide what matches, now and later
// trif.hide('[data-testid="placementTracking"]');

// Each element matching a selector, now and whenever new ones show up (one observer for all of TRIF's mods)
// trif.observe('article', (article) => {
//   if (article.text.includes('Promoted')) article.hide();
// });

// Text inside what matches, rewritten
// trif.text('article', (text) => text.replace(/Grok/g, 'the robot'));
