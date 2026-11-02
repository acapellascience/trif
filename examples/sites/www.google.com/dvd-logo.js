// ==WebMod==
// @name        DVD Logo
// @description The Google logo on the home page bounces around the screen like an old DVD player's screensaver, changing color at every edge
// @match       https://www.google.com/
// @match       https://www.google.com/?*
// @match       https://www.google.com/webhp*
// @run-at      document-idle
// @risk        0 render-only
// @source      webmods
// @version     1
// ==/WebMod==

(() => {
  // The logo stays where it is, hidden (so the page keeps its layout); a copy of it bounces above the page,
  // never catching clicks. Home page only: on results pages the small logo is the way back home.
  // With "reduce motion" on, the logo holds still.
  const SELECTORS = ['img.lnXdpd', '#hplogo', '.k1zIA img', 'img[alt="Google"]'];
  const TINTS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55'];
  const SPEED = 140; // px per second, on each axis
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let logo = null;
  let dvd = null;
  let frame = 0;

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const findLogo = () => SELECTORS.map((s) => document.querySelector(s)).find((el) => el && visible(el)) || null;

  function start() {
    if (dvd || !logo || reduce.matches) return;
    const r = logo.getBoundingClientRect();
    const w = r.width, h = r.height;
    dvd = document.createElement('div');
    dvd.setAttribute('aria-hidden', 'true');
    const src = logo.currentSrc || logo.src || '';
    let sameOrigin = false;
    try { sameOrigin = !!src && new URL(src, location.href).origin === location.origin; } catch { /* not a URL */ }
    // A same-origin image becomes a solid shape in the current tint, like the DVD logo; anything else (an
    // inline drawing, a doodle from elsewhere) is copied and has its colors turned instead.
    const tinted = logo.tagName === 'IMG' && sameOrigin;
    if (tinted) {
      const mask = `url("${src.replace(/"/g, '%22')}") center / contain no-repeat`;
      dvd.style.mask = mask;
      dvd.style.webkitMask = mask;
    } else {
      const copy = logo.cloneNode(true);
      copy.removeAttribute('id');
      copy.style.cssText = 'width:100%;height:100%;margin:0;visibility:visible';
      dvd.append(copy);
    }
    Object.assign(dvd.style, {
      position: 'fixed', left: '0', top: '0', width: `${w}px`, height: `${h}px`, zIndex: '2147483000',
      pointerEvents: 'none', willChange: 'transform',
    });
    let x = r.left, y = r.top;
    let vx = SPEED, vy = SPEED;
    let tint = 0;
    const paint = () => {
      if (tinted) dvd.style.backgroundColor = TINTS[tint];
      else dvd.style.filter = `hue-rotate(${tint * (360 / TINTS.length)}deg)`;
      dvd.style.transform = `translate(${x}px, ${y}px)`;
    };
    paint();
    logo.style.visibility = 'hidden';
    document.body.append(dvd);
    let last = null;
    const step = (now) => {
      if (!dvd) return;
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000); // a background tab resumes calmly
      last = now;
      const maxX = Math.max(0, document.documentElement.clientWidth - w);
      const maxY = Math.max(0, document.documentElement.clientHeight - h);
      x += vx * dt;
      y += vy * dt;
      let hit = false;
      if (x <= 0) { x = 0; vx = Math.abs(vx); hit = maxX > 0; } else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); hit = maxX > 0; }
      if (y <= 0) { y = 0; vy = Math.abs(vy); hit = hit || maxY > 0; } else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); hit = hit || maxY > 0; }
      if (hit) tint = (tint + 1) % TINTS.length;
      paint();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function stop() {
    cancelAnimationFrame(frame);
    if (dvd) dvd.remove();
    dvd = null;
    if (logo) logo.style.visibility = '';
  }

  reduce.addEventListener('change', () => (reduce.matches ? stop() : start()));

  // The logo is usually there by now; if not, wait for it a little.
  logo = findLogo();
  if (logo) { start(); return; }
  const observer = new MutationObserver(() => {
    logo = findLogo();
    if (logo) { observer.disconnect(); start(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
})();
