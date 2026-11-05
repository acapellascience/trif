// ==WebMod==
// @name        Desaturate
// @description Turns Instagram's colours down to 35% saturation
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     2
// ==/WebMod==

(() => {
  const SATURATION = 0.35;   // 1 = normal colour, 0 = black and white

  // On <html>, injected at document-start, so the page is desaturated from its first frame (videos included).
  const style = document.createElement('style');
  style.textContent = `html { filter: saturate(${SATURATION}) !important; }`;
  (document.head || document.documentElement).append(style);
})();
