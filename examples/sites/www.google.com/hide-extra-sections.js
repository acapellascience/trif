// ==WebMod==
// @name        Results Only
// @description Hides everything on Google results that isn't a plain web result: People also ask, Images, Short videos, People also search for and other suggestion blocks
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     1
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // Headings are localized and class names are generated, so these key on structure and data attributes:
  // [data-rpos] is each block in the results list. A plain web result has its title as an <h3> inside
  // a link; carousels and widgets (Short videos, Images, People also ask, Top stories…) don't, so any
  // block without one goes. data-initq (People also ask) and data-iu (Images) are kept as a backup.
  // #bres holds "People also search for" / related searches at the bottom.
  style.textContent = `
    #rso [data-rpos]:not(:has(a h3)),
    [data-rpos]:has([data-initq]), [data-initq],
    [data-rpos]:has([data-iu]),
    #bres { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
