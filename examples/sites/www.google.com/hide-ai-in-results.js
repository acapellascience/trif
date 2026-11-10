// ==WebMod==
// @name        AI Banisher
// @description robots, begone!
// @match       https://www.google.com/
// @match       https://www.google.com/?*
// @match       https://www.google.com/webhp*
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     4
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // Google's class names are generated, so these key on steadier things: a URL parameter, ids, jsname
  // values and a custom tag. One stylesheet for the home page and results pages (both have the search
  // box); each part is its own rule, so a selector one browser doesn't take can't drop the others.
  style.textContent = `
    /* AI Mode. In the search box it's a button (jsname B6rgad). On results pages it's also a tab in the
       tab row, whose link carries udm=50 (Google's AI Mode URL parameter, which is language-neutral):
       hide the tab's listitem and any other link to it. */
    button[jsname=B6rgad] { display: none !important; }
    [role=listitem]:has(a[href*="udm=50&"], a[href$="udm=50"]),
    a[href*="udm=50&"], a[href$="udm=50"] { display: none !important; }
    /* The promo line under the search box's buttons (currently a Gemini ad), and its jsslot wrapper so
       no empty gap is left. */
    promo-middle-slot,
    [jsslot]:has(> div > promo-middle-slot) { display: none !important; }
    /* AI Overview at the top of results, including its sticky "Ask anything" follow-up box: both live
       in #m-x-content. Google serves several layouts: the overview in its own block in #rcnt next to
       #center_col; both of those inside a [role=main] wrapper (display: contents) in #rcnt (Nov 2026);
       or as the first block inside #rso with the results. Never hide #center_col, #rso, or anything
       that contains them. */
    #rcnt > :not(#center_col):has(#m-x-content):not(:has(#center_col)),
    #rcnt > [role=main] > :not(#center_col):has(#m-x-content):not(:has(#center_col)),
    #rso > :has(#m-x-content):not(:has(a h3)),
    [data-lhcontainer]:has(#m-x-content):not(:has(#center_col)),
    #m-x-content { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
