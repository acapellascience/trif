// ==WebMod==
// @name        Hide AI Mode and Gemini Promo
// @description Hides the "AI Mode" button in the Google search box and the Gemini suggestion under it
// @match       https://www.google.com/
// @match       https://www.google.com/?*
// @match       https://www.google.com/webhp*
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        0 render-only
// ==/WebMod==

(() => {
  const style = document.createElement('style');
  // Google's class names are generated; jsname values and the <promo-middle-slot> tag are steadier.
  // B6rgad: the "AI Mode" pill inside the search box. promo-middle-slot: the promo line under the buttons
  // (currently a Gemini ad); its jsslot wrapper is hidden too so no empty gap is left.
  // The AI Overview and AI Mode tab on results pages are in hide-ai-in-results.js.
  style.textContent = `
    button[jsname=B6rgad] { display: none !important; }
    promo-middle-slot,
    [jsslot]:has(> div > promo-middle-slot) { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
