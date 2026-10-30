// ==WebMod==
// @name        Hide AI in Results
// @description Hides the AI Overview (and its "Ask anything" box) and the AI Mode tab on Google results pages
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        0 render-only
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // On results pages, AI Mode is also a tab in the tab row: its link carries udm=50 (Google's AI Mode
  // URL parameter), which is language-neutral, so hide the tab's listitem and any other link to it.
  style.textContent = `
    [role=listitem]:has(a[href*="udm=50&"], a[href$="udm=50"]),
    a[href*="udm=50&"], a[href$="udm=50"] { display: none !important; }
    /* AI Overview at the top of results, including its sticky "Ask anything" follow-up box: both live
       in #m-x-content. Google serves two layouts: the overview in its own block in #rcnt, next to
       #center_col, or as the first block inside #rso with the results. Never hide #center_col or #rso. */
    #rcnt > :not(#center_col):has(#m-x-content),
    #rso > :has(#m-x-content):not(:has(a h3)),
    [data-lhcontainer]:has(#m-x-content),
    #m-x-content { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
