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
  // The tilt's variables are registered as not inherited: set on <html> (where Living robot and Gravity mode
  // read them) and on <body> (the card, which uses them), they restyle just those two. Inherited, a change
  // every frame restyled every element on the page, which with the Rainbow Rave's styles was most of a frame.
  const css = `
    @property --tc-rx { syntax: '*'; inherits: false; }
    @property --tc-ry { syntax: '*'; inherits: false; }
    @property --tc-gx { syntax: '*'; inherits: false; }
    @property --tc-gy { syntax: '*'; inherits: false; }
    html {
      background: radial-gradient(ellipse at 50% 40%, #1d1d2b 0%, #0b0b12 70%) fixed, #0b0b12 !important;
      perspective: 1400px; overflow-x: hidden;
      /* perspective makes <html> the containing block for position:fixed layers (Rainbow Rave's
         html::before), so on short pages they'd stop at the content; keep <html> at least a screen tall */
      min-height: 100vh; box-sizing: border-box;
      /* (the perspective makes <html> the box "fixed" layers are placed in, so one wider than the window,
         like Rainbow Rave's sliding stripes, would widen the page; on a phone, the whole page zoomed out.
         overflow-x doesn't stop that there: paint containment does) */
      contain: paint;
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
      --tc-gx: inherit; --tc-gy: inherit; /* (from the card: not inherited by themselves) */
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
      const v = { '--tc-ry': (x * MAX_TILT).toFixed(3) + 'deg', '--tc-rx': (-y * MAX_TILT).toFixed(3) + 'deg', '--tc-gx': gx.toFixed(1) + '%', '--tc-gy': gy.toFixed(1) + '%' };
      for (const el of [root, document.body]) if (el) for (const k in v) el.style.setProperty(k, v[k]);
      if (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) raf = requestAnimationFrame(frame);
    } catch (e) { window.trif?.warn(String(e)); }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  let oriented = false; // the device's tilt is steering (below): the mouse doesn't
  addEventListener('mousemove', (e) => {
    if (oriented) return; // (a tap on a touchscreen sends one too)
    tx = (e.clientX / innerWidth - 0.5) * 2;   // -1 .. 1
    ty = (e.clientY / innerHeight - 0.5) * 2;
    // the glare under the pointer, from where it is in the window (measuring the card on every move
    // forced the page's layout each time)
    gx = (e.clientX / innerWidth) * 100; gy = (e.clientY / innerHeight) * 100;
    kick();
  }, { passive: true });
  document.addEventListener('mouseleave', () => { if (oriented) return; tx = 0; ty = 0; gx = 50; gy = 50; kick(); });

  // On a phone or tablet: tilt the device and the card tilts with it (its orientation sensor). Measured from
  // however you're holding it, and that "level" slowly follows your hand, so a held angle eases back
  // flat. Turned sideways, the axes turn with the screen. iPhones and iPads ask first, and only from a
  // tap: the first tap on the page asks.
  const RANGE = 20; // degrees of tilting the device for the full tilt
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  let level = null; // { beta, gamma }: the device's angles that count as flat
  addEventListener('deviceorientation', (e) => {
    try {
      if (e.beta == null || e.gamma == null) return;
      oriented = true;
      if (!level) level = { beta: e.beta, gamma: e.gamma };
      level.beta += (e.beta - level.beta) * 0.01; level.gamma += (e.gamma - level.gamma) * 0.01;
      const dx = (e.gamma - level.gamma) / RANGE, dy = (e.beta - level.beta) / RANGE; // in the device's upright frame
      const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) % 360 + 360) % 360;
      const [sx, sy] = angle === 90 ? [dy, -dx] : angle === 180 ? [-dx, -dy] : angle === 270 ? [-dy, dx] : [dx, dy];
      tx = clamp(sx); ty = clamp(sy);
      gx = 50 + tx * 40; gy = 50 + ty * 40;
      kick();
    } catch (err) { window.trif?.warn(String(err)); }
  });
  addEventListener('orientationchange', () => { level = null; });
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    let asking = false;
    const ask = () => {
      if (asking) return;
      asking = true;
      DeviceOrientationEvent.requestPermission().then(() => {
        removeEventListener('touchend', ask, true); removeEventListener('click', ask, true);
      }, () => { asking = false; }); // (not from a tap after all: the next one asks)
    };
    addEventListener('touchend', ask, true);
    addEventListener('click', ask, true);
  }

  window.trif?.log('tilt card on');
})();
