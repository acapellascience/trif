// ==WebMod==
// @name        DVD Logo (boxed)
// @description The Google logo bounces like a DVD screensaver
// @match       https://www.google.com/*
// @boxed
// @risk        0 render-only
// ==/WebMod==

// examples/sites/www.google.com/dvd-logo.js (Tim's), ported to a boxed mod (TECHNIQUES.md "Boxed
// mods"). An example, not one TRIF ships. What changed: the bouncing copy is clone() (TRIF's copy keeps
// only allowed elements and attributes); colours come from hue-rotate only (the original tints a same-site
// image with a CSS mask, and a mask's url() to the site isn't offered); it bounces on the copy's box (no
// SVG getBBox to trim the empty edges); "reduce motion" is page.prefersReducedMotion (read once).
const SELECTORS = ['img.lnXdpd', '#hplogo', '.k1zIA img', 'img[alt="Google"]', 'svg[aria-label="Google"]', 'svg[role="img"][aria-label*="Google" i]', '#logo'];
const TINTS = 9;
const SPEED = 140; // px per second, on each axis

const findLogo = () => SELECTORS.map((s) => page.find(s)).find((el) => el && el.rect().width > 0) || null;

function start(logo) {
  if (page.prefersReducedMotion) return;
  const r = logo.rect();
  const w = r.width, h = r.height;
  const dvd = page.create('div');
  dvd.setAttr('aria-hidden', 'true');
  dvd.setAttr('data-trif-dvd', '');
  const copy = logo.clone();
  if (copy) { copy.removeAttr('id'); copy.style('width', '100%'); copy.style('height', '100%'); copy.style('margin', '0'); dvd.append(copy); }
  for (const [k, v] of [['position', 'fixed'], ['left', '0'], ['top', '0'], ['width', `${w}px`], ['height', `${h}px`], ['z-index', '0'], ['pointer-events', 'none'], ['will-change', 'transform']]) dvd.style(k, v);
  let x = r.x, y = r.y, vx = SPEED, vy = SPEED, tint = 0, last = null;
  const paint = () => { dvd.style('filter', `hue-rotate(${tint * (360 / TINTS)}deg)`); dvd.style('transform', `translate(${x}px, ${y}px)`); };
  paint();
  logo.style('visibility', 'hidden');
  page.body.prepend(dvd);
  const step = (now) => {
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const maxX = Math.max(0, page.width - w), maxY = Math.max(0, page.height - h);
    x += vx * dt; y += vy * dt;
    let hit = false;
    if (x <= 0) { x = 0; vx = Math.abs(vx); hit = true; } else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); hit = true; }
    if (y <= 0) { y = 0; vy = Math.abs(vy); hit = true; } else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); hit = true; }
    if (hit) tint = (tint + 1) % TINTS;
    paint();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const now = findLogo();
if (now) start(now);
else {
  const stop = trif.observe(SELECTORS.join(', '), (el) => { if (el.rect().width > 0) { stop(); start(el); } });
  setTimeout(() => stop(), 10000);
}
