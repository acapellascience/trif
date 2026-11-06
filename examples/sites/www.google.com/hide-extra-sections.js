// ==WebMod==
// @name        Just Results
// @description no sponsors, no mess
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        1 hides ads, so Google's ad impression reports for them never fire
// @source      webmods
// @version     3
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // Headings and "Sponsored" labels are localized and class names are generated, so these key on
  // structure and data attributes. Each part is its own rule, so a selector one browser doesn't take
  // can't drop the others.
  style.textContent = `
    /* Sponsored results: each sponsored block (top and bottom, text ads and the "Featured products"
       carousel) sits in a [data-dsktp-pla-or-su] wrapper, and each text ad carries data-text-ad.
       #tads/#bottomads/#tvcap are the older ad containers, kept as a backup. */
    [data-dsktp-pla-or-su], [data-text-ad],
    #tads, #bottomads, #tvcap { display: none !important; }
    /* Everything that isn't a plain web result. [data-rpos] is each block in the results list. A plain
       web result has its title as an <h3> inside a link; carousels and widgets (Short videos, Images,
       People also ask, Top stories…) don't, so any block without one goes. data-initq (People also ask)
       and data-iu (Images) are kept as a backup. #bres holds "People also search for" / related
       searches at the bottom. */
    #rso [data-rpos]:not(:has(a h3)),
    [data-rpos]:has([data-initq]), [data-initq],
    [data-rpos]:has([data-iu]),
    #bres { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
