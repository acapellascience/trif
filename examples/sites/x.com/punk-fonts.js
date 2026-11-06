// ==WebMod==
// @name        Punk Fonts
// @description add some edge
// @match       https://x.com/*
// @run-at      document-start
// @risk        1 patches attachShadow (to style chat), which the page's scripts could notice
// @source      webmods
// @version     2
// ==/WebMod==

(() => {
  // X's CSP blocks web fonts (font-src), so use fonts installed with macOS.
  const FONT = '"Chalkduster", "Marker Felt", "Impact", fantasy';

  const style = document.createElement('style');
  style.textContent = `
    /* Scoped to the app (#react-root) and Detox Timeline's search page and Filters menu (in <body>, outside it),
       never all of body: X signs some requests (search) with a code computed from the computed styles
       of hidden test elements it puts directly in <body>. Restyling those makes X answer 404. */
    #react-root, #react-root *, .dm-search, .dm-search *, .dm-menu, .dm-menu * { font-family: ${FONT} !important; }
    /* Detox Timeline draws its "x" logo (side bar, loading screen) as ::after, which body * doesn't reach. */
    header[role=banner] h1 a[href="/home"] > div::after, #placeholder::after { font-family: ${FONT} !important; }
  `;
  (document.head || document.documentElement).append(style);

  // Chat (/i/chat, the DM drawer) is a separate app rendered in shadow roots, which page CSS can't
  // reach. Catch each root as it's created and give it its own stylesheet.
  const ROOT_CSS = `:host, * { font-family: ${FONT} !important; }`;
  const roots = new Set();
  const styleRoot = (root) => {
    roots.add(root);
    if (!root.querySelector(':scope > style[data-punk-fonts]')) {
      const s = document.createElement('style');
      s.dataset.punkFonts = '';
      s.textContent = ROOT_CSS;
      root.append(s);
    }
  };
  const attachShadow0 = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function () {
    const root = attachShadow0.apply(this, arguments);
    try { styleRoot(root); } catch (e) { window.webmods?.warn('punk-fonts shadow style failed', String(e)); }
    return root;
  };
  // Put the style back if the app re-renders a root's children.
  setInterval(() => { try { roots.forEach(styleRoot); } catch {} }, 1500);
})();
