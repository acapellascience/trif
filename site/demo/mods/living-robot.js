// ==WebMod==
// @name        Living robot
// @description The hero robot has little legs and wanders the page; its eyes follow the mouse, it blinks, and hops when clicked
// @match       *://timsrobot.com/*
// @match       *://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// ==/WebMod==

(() => {
  const MAX_LOOK = 6; // how far the eyes move, in the SVG's 128-unit viewBox

  const style = document.createElement('style');
  style.textContent = `
    svg.robot[data-lr] { cursor: pointer; overflow: visible; pointer-events: auto; position: relative; z-index: 50; }
    svg.robot[data-lr] .lr-leg { transform-box: view-box; }
    svg.robot[data-lr].lr-walking .lr-leg { animation: lr-step 0.32s ease-in-out infinite alternate; }
    svg.robot[data-lr].lr-walking .lr-leg + .lr-leg { animation-direction: alternate-reverse; }
    @keyframes lr-step { from { transform: rotate(-20deg); } to { transform: rotate(20deg); } }
    svg.robot[data-lr].lr-walking { animation: lr-waddle 0.32s ease-in-out infinite alternate; }
    @keyframes lr-waddle { from { transform: rotate(-4deg) translateY(0); } to { transform: rotate(4deg) translateY(-3px); } }
    svg.robot[data-lr] .lr-look { transition: transform 120ms ease-out; }
    svg.robot[data-lr] .lr-eye { transform-box: fill-box; transform-origin: center; }
    svg.robot[data-lr].lr-blink .lr-eye { animation: lr-blink 160ms ease-in-out; }
    @keyframes lr-blink { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.08); } }
    svg.robot[data-lr].lr-hop { animation: lr-hop 600ms cubic-bezier(.3,.7,.4,1); transform-origin: 50% 100%; }
    @keyframes lr-hop {
      0%   { transform: translateY(0) scale(1, 1); }
      15%  { transform: translateY(0) scale(1.12, 0.86); }
      45%  { transform: translateY(-38px) scale(0.94, 1.08); }
      75%  { transform: translateY(0) scale(1.1, 0.9); }
      88%  { transform: translateY(-4px) scale(0.98, 1.02); }
      100% { transform: translateY(0) scale(1, 1); }
    }
  `;
  (document.head || document.documentElement).append(style);

  const setup = () => {
    const svg = document.querySelector('svg.robot');
    if (!svg || svg.hasAttribute('data-lr')) return !!svg;
    const look = svg.querySelector('g[filter]'); // the glowing group holding both eyes
    const eyes = look ? [...look.querySelectorAll('polygon, circle, ellipse, path')] : [];
    if (!look || !eyes.length) { window.trif?.warn('robot shape changed: no eyes found'); return true; }
    svg.setAttribute('data-lr', '');
    eyes.forEach((e) => e.classList.add('lr-eye'));
    // Wrap the filtered group so the glow moves with the eyes.
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.classList.add('lr-look');
    look.replaceWith(wrap);
    wrap.append(look);

    // Eyes follow the mouse.
    let pending = null, queued = false;
    addEventListener('pointermove', (ev) => {
      pending = ev;
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        try {
          const r = svg.getBoundingClientRect();
          if (!r.width) return;
          const dx = pending.clientX - (r.left + r.width / 2);
          const dy = pending.clientY - (r.top + r.height * 0.49);
          const dist = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, dist / 300) * MAX_LOOK / dist;
          wrap.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
        } catch (e) { window.trif?.warn(String(e)); }
      }, 16);
    }, { passive: true });
    document.addEventListener('mouseleave', () => { wrap.style.transform = ''; });

    // Blink every few seconds (sometimes twice).
    const blink = () => {
      svg.classList.remove('lr-blink');
      void svg.getBoundingClientRect();
      svg.classList.add('lr-blink');
    };
    svg.addEventListener('animationend', (e) => { if (e.animationName === 'lr-blink') svg.classList.remove('lr-blink'); });
    const scheduleBlink = () => setTimeout(() => {
      blink();
      if (Math.random() < 0.25) setTimeout(blink, 260);
      scheduleBlink();
    }, 2500 + Math.random() * 3500);
    scheduleBlink();

    // Hop on click.
    svg.addEventListener('click', () => {
      svg.classList.remove('lr-hop');
      void svg.getBoundingClientRect(); // restart the animation on rapid clicks
      svg.classList.add('lr-hop');
      blink();
    });
    svg.addEventListener('animationend', (e) => { if (e.animationName === 'lr-hop') svg.classList.remove('lr-hop'); });

    // Little legs, drawn behind the head so the hips tuck under it.
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const legs = el('g', { class: 'lr-legs' });
    for (const x of [46, 82]) {
      const leg = el('g', { class: 'lr-leg' });
      leg.style.transformOrigin = `${x}px 112px`;
      leg.append(
        // Solid colour: a gradient with a zero-width bounding box (a vertical line) doesn't paint.
        el('line', { x1: x, y1: 108, x2: x, y2: 140, stroke: '#2fc58d', 'stroke-width': 7, 'stroke-linecap': 'round' }),
        el('ellipse', { cx: x, cy: 143, rx: 10, ry: 5, fill: '#2fc58d' }),
      );
      legs.append(leg);
    }
    const head = svg.querySelector(':scope > polygon');
    svg.insertBefore(legs, head || look.parentNode.firstChild);

    // Wander around the visible page. The walk uses the `translate` property, so it
    // stacks with the hop's `transform` animation instead of fighting it.
    const SPEED = 75; // px per second
    let pos = { x: 0, y: 0 }, target = null, hovering = false, lastMouse = 0, last = 0;
    addEventListener('pointermove', () => { lastMouse = Date.now(); }, { passive: true });
    svg.addEventListener('pointerenter', () => { hovering = true; });
    svg.addEventListener('pointerleave', () => { hovering = false; });
    const pickTarget = () => {
      const r = svg.getBoundingClientRect();
      const homeX = r.left - pos.x, homeY = r.top - pos.y;
      const vw = document.documentElement.clientWidth, vh = innerHeight;
      if (Math.random() < 0.25) return { x: 0, y: 0 }; // sometimes go home
      const minX = 8 - homeX, maxX = vw - r.width - 8 - homeX;
      const minY = 8 - homeY, maxY = vh - r.height - 30 - homeY; // leave room for the feet
      if (maxX <= minX || maxY <= minY) return null;
      return { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
    };
    const rest = () => setTimeout(() => { target = pickTarget(); if (!target) rest(); }, 1500 + Math.random() * 3500);
    const step = (t) => {
      try {
        const dt = Math.min(0.05, (t - (last || t)) / 1000);
        last = t;
        const walking = !!target && !hovering && !svg.classList.contains('lr-hop');
        svg.classList.toggle('lr-walking', walking);
        if (walking) {
          const dx = target.x - pos.x, dy = target.y - pos.y, d = Math.hypot(dx, dy);
          const move = SPEED * dt;
          if (d <= move) { pos = { ...target }; target = null; rest(); }
          else {
            pos.x += dx / d * move; pos.y += dy / d * move;
            if (Date.now() - lastMouse > 1500) // nobody's moving the mouse: look where he's going
              wrap.style.transform = `translate(${(dx / d * MAX_LOOK * 0.8).toFixed(2)}px, ${(dy / d * MAX_LOOK * 0.8).toFixed(2)}px)`;
          }
          svg.style.translate = `${pos.x.toFixed(1)}px ${pos.y.toFixed(1)}px`;
        }
      } catch (e) { window.trif?.warn(String(e)); target = null; return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    rest();
    window.trif?.log('robot is alive');
    return true;
  };

  if (!setup()) {
    const mo = new MutationObserver(() => { if (setup()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }
})();
