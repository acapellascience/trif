// ==WebMod==
// @name        DVD Logo
// @description wait for the corner!
// @match       https://www.google.com/
// @match       https://www.google.com/?*
// @match       https://www.google.com/webhp*
// @run-at      document-idle
// @risk        0 render-only
// @source      webmods
// @version     2
// ==/WebMod==

(() => {
  // The logo stays where it is, hidden (so the page keeps its layout); a copy of it bounces above the page,
  // never catching clicks. Home page only: on results pages the small logo is the way back home.
  // With "reduce motion" on, the logo holds still.
  const SELECTORS = [
    'img.lnXdpd', '#hplogo', '.k1zIA img', 'img[alt="Google"]',
    'svg[aria-label="Google"]', 'svg[role="img"][aria-label*="Gopoogople" i]', 'svg[role="img"][aria-label*="Google" i]'
  ];
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
    let w = r.width, h = r.height;
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
      position: 'fixed', left: '0', top: '0', width: `${w}px`, height: `${h}px`, zIndex: '0',
      pointerEvents: 'none', willChange: 'transform',
    });
    // The box can change after we start (Oppish swaps in a wider logo), so follow the hidden logo's size,
    // and bounce on the drawing's ink, not its box: an SVG that says where its ink is (data-trif-ink, in
    // viewBox units) or else its content's bounding box. inset = empty space on each side, in px.
    let inset = { l: 0, t: 0, r: 0, b: 0 };
    let lastMeasure = -1e9;
    const measure = (now) => {
      if (now - lastMeasure < 250) return;
      lastMeasure = now;
      const lr = logo.getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0 && (Math.abs(lr.width - w) > 0.5 || Math.abs(lr.height - h) > 0.5)) {
        w = lr.width; h = lr.height;
        dvd.style.width = `${w}px`; dvd.style.height = `${h}px`;
      }
      inset = { l: 0, t: 0, r: 0, b: 0 };
      const svg = dvd.querySelector('svg');
      if (!svg) return;
      try {
        const vb = svg.viewBox.baseVal;
        let ink = (svg.getAttribute('data-trif-ink') || '').split(/\s+/).map(Number);
        if (ink.length !== 4 || ink.some(isNaN)) { const b = svg.getBBox(); ink = [b.x, b.y, b.x + b.width, b.y + b.height]; }
        if (!vb || !vb.width || !vb.height) return;
        // Default preserveAspectRatio: scaled to fit, centred.
        const s = Math.min(w / vb.width, h / vb.height);
        const ox = (w - vb.width * s) / 2, oy = (h - vb.height * s) / 2;
        inset = {
          l: Math.max(0, ox + (ink[0] - vb.x) * s), t: Math.max(0, oy + (ink[1] - vb.y) * s),
          r: Math.max(0, ox + (vb.x + vb.width - ink[2]) * s), b: Math.max(0, oy + (vb.y + vb.height - ink[3]) * s),
        };
      } catch { /* not measurable: bounce on the box */ }
    };
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
    // Prepend so it sits behind later page content.
    document.body.prepend(dvd);
    let last = null;
    const step = (now) => {
      if (!dvd) return;
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000); // a background tab resumes calmly
      last = now;
      measure(now);
      // The ink touches the viewport edges exactly: the box may go past them by its empty margins.
      const minX = -inset.l, minY = -inset.t;
      const maxX = Math.max(minX, document.documentElement.clientWidth - w + inset.r);
      const maxY = Math.max(minY, document.documentElement.clientHeight - h + inset.b);
      x += vx * dt;
      y += vy * dt;
      let hit = false;
      if (x <= minX) { x = minX; vx = Math.abs(vx); hit = maxX > minX; } else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); hit = maxX > minX; }
      if (y <= minY) { y = minY; vy = Math.abs(vy); hit = hit || maxY > minY; } else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); hit = hit || maxY > minY; }
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

  logo = findLogo();
  if (logo) { start(); return; }
  const observer = new MutationObserver(() => {
    logo = findLogo();
    if (logo) { observer.disconnect(); start(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
})();
