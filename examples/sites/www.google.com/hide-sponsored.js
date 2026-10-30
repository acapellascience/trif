// ==WebMod==
// @name        Hide Sponsored Results
// @description Hides sponsored text ads and sponsored product carousels on Google results
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        1 hides ads, so Google's ad impression reports for them never fire
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // "Sponsored" labels are localized; these attributes aren't. Each sponsored block (top and bottom,
  // text ads and the "Featured products" carousel) sits in a [data-dsktp-pla-or-su] wrapper, and each
  // text ad carries data-text-ad. #tads/#bottomads/#tvcap are the older ad containers, kept as backup.
  style.textContent = `
    [data-dsktp-pla-or-su], [data-text-ad],
    #tads, #bottomads, #tvcap { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
