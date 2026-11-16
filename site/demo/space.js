// The home page's spacing on a computer (pages.js HOME_STYLE): what the window leaves free once the content is
// in is shared out between the parts. The CSS guesses the content's height (--home-content, 560px); this
// measures it (main's rows and the footer, not the space between them), so a mod that makes the page longer
// (the makeover's checklist, terminal and LED sign) gets less space around it instead of pushing the footer
// out of view.
// It watches the parts (not main and the footer themselves, whose size the spacing changes) and follows them
// as mods grow them, the typing tagline, the stickers and the rest settling in after the page loads. It
// doesn't follow them down: the space game blasting words away, or Gravity mode taking the page apart,
// would have the spacing jump about mid-game. A new window size measures again from scratch.
(() => {
  const root = document.documentElement;
  const wide = matchMedia('(min-width: 701px)');
  const px = (v) => parseFloat(v) || 0;
  let last = 0, frame = 0;
  const parts = () => {
    const main = document.querySelector('main.home');
    const foot = main && main.nextElementSibling;
    return main && foot && foot.localName === 'footer' ? { main, foot } : null;
  };
  const measure = (fresh = false) => {
    frame = 0;
    const p = parts();
    if (!p || !wide.matches || root.hasAttribute('data-gm-on')) return;
    const ms = getComputedStyle(p.main), fs = getComputedStyle(p.foot);
    let rows = 0;
    for (const c of p.main.children) {
      const s = getComputedStyle(c);
      if (s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed') rows++;
    }
    const h = Math.round(p.main.offsetHeight - px(ms.paddingTop) - px(ms.paddingBottom) - px(ms.rowGap) * Math.max(0, rows - 1)
      + p.foot.offsetHeight - px(fs.paddingTop) - px(fs.paddingBottom));
    if (h <= 0 || (!fresh && h < last + 4)) return; // (growing only, unless measuring afresh)
    if (Math.abs(h - last) < 4) return;
    last = h;
    root.style.setProperty('--home-content', `${h}px`);
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(() => measure()); };
  // The parts: main's rows and what's in the footer (mods replace them: watched again when they do).
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
  const watch = () => {
    const p = parts();
    if (!p || !sizes) return;
    sizes.disconnect();
    for (const el of [...p.main.children, ...p.foot.children]) sizes.observe(el);
    soon();
  };
  watch();
  measure(true);
  const p = parts();
  if (p && typeof MutationObserver === 'function') {
    const swaps = new MutationObserver(watch);
    swaps.observe(p.main, { childList: true });
    swaps.observe(p.foot, { childList: true });
  }
  let timer = 0;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { last = 0; measure(true); }, 150); });
})();
