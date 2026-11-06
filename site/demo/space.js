// The home page's spacing on a computer (pages.js HOME_STYLE): what the window leaves free once the content is
// in is shared out between the parts. The CSS guesses the content's height (--home-content, 560px); this
// measures it (main's rows and the footer, not the space between them) once the page and its mods have
// settled, and again when the window changes size, so a mod that makes the page longer (the makeover's
// checklist, terminal and LED sign) gets less space around it instead of pushing the footer out of view.
// Not while it's in pieces (Gravity mode): what's left in place isn't the page's height.
(() => {
  const root = document.documentElement;
  const wide = matchMedia('(min-width: 701px)');
  const px = (v) => parseFloat(v) || 0;
  let last = 0;
  const measure = () => {
    const main = document.querySelector('main.home');
    const foot = main && main.nextElementSibling;
    if (!main || !foot || foot.localName !== 'footer' || !wide.matches || root.hasAttribute('data-gm-on')) return;
    const ms = getComputedStyle(main), fs = getComputedStyle(foot);
    let rows = 0;
    for (const c of main.children) {
      const s = getComputedStyle(c);
      if (s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed') rows++;
    }
    const h = Math.round(main.offsetHeight - px(ms.paddingTop) - px(ms.paddingBottom) - px(ms.rowGap) * Math.max(0, rows - 1)
      + foot.offsetHeight - px(fs.paddingTop) - px(fs.paddingBottom));
    if (h <= 0 || Math.abs(h - last) < 4) return;
    last = h;
    root.style.setProperty('--home-content', `${h}px`);
  };
  measure();
  const settle = () => { measure(); setTimeout(measure, 600); setTimeout(measure, 2000); };
  if (document.readyState === 'complete') settle(); else addEventListener('load', settle, { once: true });
  let timer = 0;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(measure, 150); });
})();
