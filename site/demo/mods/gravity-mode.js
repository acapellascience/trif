// ==WebMod==
// @name        Gravity mode
// @description Press G: everything on the page falls, bounces and piles up at the bottom. Grab pieces and throw them. G or Esc again puts it all back
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// ==/WebMod==

(() => {
  const GRAVITY = 2600;        // px/s²
  const BOUNCE_FLOOR = 0.45;   // restitution against walls and floor
  const BOUNCE_BODY = 0.2;     // restitution between pieces
  const FRICTION = 0.25;       // share of sliding speed lost per contact, per substep
  const SUBSTEPS = 3, ITERS = 6;

  // Elements whose whole box moves as one piece, without looking inside.
  const SOLID = new Set(['svg', 'img', 'video', 'canvas', 'picture', 'iframe', 'input', 'button', 'select', 'textarea', 'hr', 'a']);
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'br', 'head']);

  const style = document.createElement('style');
  // Doubled attribute for specificity: the neon title and jelly buttons mods animate these
  // same elements, and the living robot moves with the `translate` property.
  style.textContent = `
    html[data-gm-on] { overflow: hidden !important; }
    html[data-gm-on] body { user-select: none !important; -webkit-user-select: none !important; }
    html[data-gm-on] [data-gm-body][data-gm-body] {
      transform: translate(var(--gm-x, 0px), var(--gm-y, 0px)) rotate(var(--gm-r, 0rad)) !important;
      transform-origin: 50% 50% !important;
      translate: none !important; rotate: none !important; scale: none !important;
      transition: none !important; /* animations keep running (the neon glow); this !important transform beats theirs */
      will-change: transform; cursor: grab !important; touch-action: none; pointer-events: auto !important;
      position: relative; z-index: 10;
    }
    html[data-gm-on] [data-gm-body][data-gm-inline] { display: inline-block !important; }
    html[data-gm-on] [data-gm-body][data-gm-held] { cursor: grabbing !important; z-index: 20; }
    html[data-gm-on] [data-gm-bare] { border-color: transparent !important; box-shadow: none !important; }
  `;
  (document.head || document.documentElement).append(style);

  const root = document.documentElement;
  let bodies = [], active = false, returning = false, last = 0, raf = 0, held = null;

  // Pieces: the smallest visible boxes that read as one thing (a paragraph, a letter of an
  // inline-block title, a button, an image). Containers are walked into, not moved.
  const collect = (el, out) => {
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents' && !c.children.length) continue;
      // Click-through fixed overlays (the space shooter's full-screen canvas and HUD) aren't page
      // content: as pieces, the canvas fills the screen and shoves everything else off the top.
      if (cs.position === 'fixed' && cs.pointerEvents === 'none') continue;
      const kids = [...c.children].filter((k) => !SKIP.has(k.tagName.toLowerCase()));
      const ownText = [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      // Plain inline content (bold, code, links in a sentence) stays with its paragraph; inline-block
      // pieces inside (the neon title's letters) fall on their own.
      const allInline = [...c.querySelectorAll('*')].every((k) => SKIP.has(k.tagName.toLowerCase()) || k.closest('svg') || getComputedStyle(k).display === 'inline');
      if (SOLID.has(tag) || ownText || !kids.length || allInline) { out.push(c); continue; }
      const deco = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) || parseFloat(cs.borderLeftWidth) || cs.boxShadow !== 'none';
      if (deco) c.setAttribute('data-gm-bare', '');
      collect(c, out);
    }
  };

  const extents = (b) => {
    const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
    return { hw: (b.w * c + b.h * s) / 2, hh: (b.w * s + b.h * c) / 2 };
  };

  const start = () => {
    const els = [];
    collect(document.body, els);
    for (const el of els) {
      el.setAttribute('data-gm-body', '');
      if (getComputedStyle(el).display === 'inline') el.setAttribute('data-gm-inline', '');
    }
    root.setAttribute('data-gm-on', '');
    const vw = root.clientWidth, vh = innerHeight;
    bodies = [];
    for (const el of els) {
      const r = el.getBoundingClientRect(); // layout position with our transform at zero
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        el.removeAttribute('data-gm-body'); el.removeAttribute('data-gm-inline');
        continue;
      }
      const hx = r.left + r.width / 2, hy = r.top + r.height / 2;
      bodies.push({
        el, w: r.width, h: r.height, hx, hy, x: hx, y: hy, a: 0,
        // A little shove and spin each, so the page tumbles instead of dropping in columns.
        vx: (Math.random() - 0.5) * 360, vy: -80 - Math.random() * 220, va: (Math.random() - 0.5) * 6,
        m: Math.max(40, r.width * r.height), support: false,
      });
    }
    active = true; returning = false; last = 0;
    window.trif?.log(`gravity on: ${bodies.length} pieces`);
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const stop = () => { // fly home, then let go
    returning = true; held = null;
    for (const b of bodies) { b.fromX = b.x; b.fromY = b.y; b.fromA = b.a; }
    returning = performance.now();
  };

  const finish = () => {
    for (const b of bodies) {
      b.el.removeAttribute('data-gm-body'); b.el.removeAttribute('data-gm-inline'); b.el.removeAttribute('data-gm-held');
      b.el.style.removeProperty('--gm-x'); b.el.style.removeProperty('--gm-y'); b.el.style.removeProperty('--gm-r');
    }
    document.querySelectorAll('[data-gm-bare]').forEach((e) => e.removeAttribute('data-gm-bare'));
    root.removeAttribute('data-gm-on');
    bodies = []; active = false; returning = false;
    window.trif?.log('gravity off');
  };

  const nearestQuarter = (a) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);

  const simulate = (dt) => {
    const W = root.clientWidth, H = innerHeight;
    for (const b of bodies) {
      if (b === held) continue;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
      b.support = false;
    }
    if (held) { // follow the pointer; its velocity is what gets thrown
      const b = held;
      const nx = pointer.x - b.grabX, ny = pointer.y - b.grabY;
      b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt;
      b.x = nx; b.y = ny;
      b.va *= 0.9;
    }
    // Bottom-most first, so support spreads up the pile in one pass.
    const order = bodies.slice().sort((p, q) => q.y - p.y);
    for (let it = 0; it < ITERS; it++) {
      // Walls and floor. A piece on the floor, or resting on one that is, is "grounded": it
      // doesn't get pushed down by what lands on it, so heavy pieces can't sink a pile.
      for (const b of order) {
        const { hw, hh } = extents(b);
        const lock = b === held;
        b.grounded = lock;
        if (b.y + hh >= H - 0.5) { b.y = H - hh; if (!lock && b.vy > 0) { b.vy = b.vy > 120 ? -b.vy * BOUNCE_FLOOR : 0; b.vx *= 1 - FRICTION; } b.support = true; b.grounded = true; }
        if (b.x - hw < 0) { b.x = hw; if (!lock && b.vx < 0) b.vx = -b.vx * BOUNCE_FLOOR; }
        if (b.x + hw > W) { b.x = W - hw; if (!lock && b.vx > 0) b.vx = -b.vx * BOUNCE_FLOOR; }
      }
      // Pieces against each other (boxes around the rotated pieces).
      for (let i = 0; i < order.length; i++) {
        const A = order[i], ea = extents(A);
        for (let j = i + 1; j < order.length; j++) {
          const B = order[j], eb = extents(B);
          const dx = B.x - A.x, dy = B.y - A.y;
          const px = ea.hw + eb.hw - Math.abs(dx), py = ea.hh + eb.hh - Math.abs(dy);
          if (px <= 0 || py <= 0) continue;
          const ia = A === held ? 0 : 1 / A.m, ib = B === held ? 0 : 1 / B.m;
          if (!ia && !ib) continue;
          let share = ia / (ia + ib);
          if (py < px) { // vertical contact
            const s = dy > 0 ? 1 : -1; // +1: B below A
            const lower = s > 0 ? B : A, upper = s > 0 ? A : B;
            if (lower.grounded && upper !== held) { share = s > 0 ? 1 : 0; upper.grounded = true; }
            A.y -= s * py * share; B.y += s * py * (1 - share);
            const rel = (B.vy - A.vy) * s;
            if (rel < 0) {
              const e = -rel > 150 ? BOUNCE_BODY : 0;
              const jn = -(1 + e) * rel / (ia + ib);
              A.vy -= s * jn * ia; B.vy += s * jn * ib;
              const rt = B.vx - A.vx, jt = rt * FRICTION / (ia + ib);
              A.vx += jt * ia; B.vx -= jt * ib;
            }
            if (s > 0) A.support = true; else B.support = true;
          } else { // sideways contact
            const s = dx > 0 ? 1 : -1;
            A.x -= s * px * share; B.x += s * px * (1 - share);
            const rel = (B.vx - A.vx) * s;
            if (rel < 0) {
              const jn = -(1 + BOUNCE_BODY) * rel / (ia + ib);
              A.vx -= s * jn * ia; B.vx += s * jn * ib;
            }
          }
        }
      }
    }
    for (const b of bodies) {
      if (b === held) continue;
      if (b.support) {
        // Resting pieces settle flat (any side down) and stop spinning; rolling feeds the tilt.
        b.va = b.va * 0.7 + b.vx * 0.0006;
        b.a += (nearestQuarter(b.a) - b.a) * Math.min(1, 12 * dt);
        if (Math.abs(b.vx) < 4) b.vx = 0;
      }
      b.vx *= 0.999; b.va *= 0.995;
    }
  };

  const render = () => {
    for (const b of bodies) {
      const s = b.el.style;
      s.setProperty('--gm-x', `${(b.x - b.hx).toFixed(1)}px`);
      s.setProperty('--gm-y', `${(b.y - b.hy).toFixed(1)}px`);
      s.setProperty('--gm-r', `${b.a.toFixed(3)}rad`);
    }
  };

  // setTimeout fallback isn't needed: rAF pausing in a background tab just pauses the pile.
  const frame = (t) => {
    raf = 0;
    try {
      if (!active) return;
      const dt = Math.min(1 / 30, (t - (last || t)) / 1000) || 1 / 60;
      last = t;
      if (returning) {
        const k = Math.min(1, (t - returning) / 700), e = 1 - Math.pow(1 - k, 3);
        for (const b of bodies) {
          b.x = b.fromX + (b.hx - b.fromX) * e; b.y = b.fromY + (b.hy - b.fromY) * e;
          b.a = b.fromA + (Math.round(b.fromA / (2 * Math.PI)) * 2 * Math.PI - b.fromA) * e;
        }
        render();
        if (k >= 1) { finish(); return; }
      } else {
        for (let i = 0; i < SUBSTEPS; i++) simulate(dt / SUBSTEPS);
        render();
      }
    } catch (e) { window.trif?.warn(String(e)); finish(); return; }
    raf = requestAnimationFrame(frame);
  };

  // Grabbing and throwing.
  const pointer = { x: 0, y: 0 };
  addEventListener('pointerdown', (e) => {
    if (!active || returning || e.button !== 0) return;
    const el = e.target.closest?.('[data-gm-body]');
    const b = el && bodies.find((x) => x.el === el);
    if (!b) return;
    e.preventDefault();
    pointer.x = e.clientX; pointer.y = e.clientY;
    b.grabX = e.clientX - b.x; b.grabY = e.clientY - b.y;
    held = b; el.setAttribute('data-gm-held', '');
  }, true);
  const trail = []; // recent pointer positions, for the throw's speed
  addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (!held) return;
    const now = performance.now();
    trail.push({ x: e.clientX, y: e.clientY, t: now });
    while (trail.length > 2 && now - trail[0].t > 100) trail.shift();
  }, { passive: true });
  const release = () => {
    if (!held) return;
    const b = held;
    held = null;
    b.el.removeAttribute('data-gm-held');
    // Throw with the pointer's speed over its last ~100 ms (a still pointer just drops it).
    const first = trail[0], lastP = trail[trail.length - 1];
    const span = first && lastP ? (performance.now() - first.t) / 1000 : 0;
    if (span > 0.005) { b.vx = (lastP.x - first.x) / span; b.vy = (lastP.y - first.y) / span; } else { b.vx = 0; b.vy = 0; }
    trail.length = 0;
    const sp = Math.hypot(b.vx, b.vy), max = 4000; // cap a twitchy flick
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.va = b.vx / Math.max(40, b.w) * 1.5;
  };
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  addEventListener('blur', release);
  // Links and buttons don't fire while they're toys.
  addEventListener('click', (e) => {
    if (active && e.target.closest?.('[data-gm-body]')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('dragstart', (e) => { if (active) e.preventDefault(); }, true);

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    try {
      if (e.key === 'g' || e.key === 'G') {
        if (!active) start(); else if (!returning) stop();
      } else if (e.key === 'Escape' && active && !returning) stop();
    } catch (err) { window.trif?.warn(String(err)); try { finish(); } catch {} }
  }, true);

  window.trif?.log('gravity mode ready: press G');
})();
