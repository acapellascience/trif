// ==WebMod==
// @name        Tilt Card
// @description The page tilts in 3D with your mouse
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  const MAX_TILT = 24; // degrees at the edge of the window (Living robot slides with the tilt: it reads --tc-rx/--tc-ry against this)

  // Depth uses the individual `translate` property on containers only: the neon title, jelly
  // buttons and living robot mods animate `transform`/`translate` on the letters, buttons and robot
  // themselves, so those elements are left alone and ride along with their parent's depth.
  // Gravity mode (html[data-gm-on]): the card keeps tilting, with its pile tumbling inside it; only the
  // per-section depths are dropped, so everything lies flat on the card. Gravity mode measures the flat
  // page by setting html[data-gm-measure] for an instant, which straightens the card.
  const css = `
    html {
      background: radial-gradient(ellipse at 50% 40%, #1d1d2b 0%, #0b0b12 70%) fixed, #0b0b12 !important;
      perspective: 1400px; overflow-x: hidden;
    }
    html body {
      position: relative;
      transform-style: preserve-3d;
      transform: rotateX(var(--tc-rx, 0deg)) rotateY(var(--tc-ry, 0deg)) scale(0.94);
      transform-origin: 50% 50vh;
      border-radius: 18px;
      box-shadow: 0 40px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06);
    }
    html[data-gm-measure] body { transform: none !important; }
    html body::after {
      content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      background: radial-gradient(circle at var(--tc-gx, 50%) var(--tc-gy, 50%), rgba(255,255,255,.10), transparent 45%);
      transform: translateZ(1px);
    }
    html:not([data-gm-on]) main,
    html:not([data-gm-on]) main > section,
    html:not([data-gm-on]) main > section.two > div { transform-style: preserve-3d; }

    html:not([data-gm-on]) main > section.hero            { translate: 0 0 50px; }
    html:not([data-gm-on]) main > section.hero > h1       { translate: 0 0 60px; }
    html:not([data-gm-on]) main > section.hero > .tagline { translate: 0 0 35px; }
    html:not([data-gm-on]) main > section.hero > .small   { translate: 0 0 20px; }
    html:not([data-gm-on]) main > section.hero > .links   { translate: 0 0 80px; }
    html:not([data-gm-on]) main > section.two             { translate: 0 0 15px; }
    html:not([data-gm-on]) main > section.two > div       { translate: 0 0 25px; }
    html:not([data-gm-on]) main > section.two > div > h2  { translate: 0 0 30px; }
    html:not([data-gm-on]) body > footer                  { translate: 0 0 8px; } /* lowest layer; below 0 it would hide behind the card's own background */
    /* in gravity everything lies on one plane, a hair above the card (level with it, it can flicker behind) */
    html[data-gm-on] main, html[data-gm-on] body > footer { translate: 0 0 2px; }
  `;
  const style = document.createElement('style');
  style.dataset.tc = '';
  style.textContent = css;
  (document.head || document.documentElement).append(style);

  const root = document.documentElement;
  let tx = 0, ty = 0, x = 0, y = 0, gx = 50, gy = 50, raf = 0;

  // Eased toward the target; the loop stops once it settles, so an idle page costs nothing.
  const frame = () => {
    raf = 0;
    try {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      root.style.setProperty('--tc-ry', (x * MAX_TILT).toFixed(3) + 'deg');
      root.style.setProperty('--tc-rx', (-y * MAX_TILT).toFixed(3) + 'deg');
      root.style.setProperty('--tc-gx', gx.toFixed(1) + '%');
      root.style.setProperty('--tc-gy', gy.toFixed(1) + '%');
      if (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) raf = requestAnimationFrame(frame);
    } catch (e) { window.trif?.warn(String(e)); }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  addEventListener('mousemove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;   // -1 .. 1
    ty = (e.clientY / innerHeight - 0.5) * 2;
    const r = document.body?.getBoundingClientRect();
    if (r && r.width) { gx = ((e.clientX - r.left) / r.width) * 100; gy = ((e.clientY - r.top) / r.height) * 100; }
    kick();
  }, { passive: true });
  document.addEventListener('mouseleave', () => { tx = 0; ty = 0; gx = 50; gy = 50; kick(); });

  window.trif?.log('tilt card on');
})();
