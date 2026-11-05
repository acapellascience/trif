// ==WebMod==
// @name        Rainbow Rave
// @description Rainbow background, trance music, total rave
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// Ported from x.com/rainbow-rave (background, music, kick zoom, and the "rave checks" mini-rainbow).
// This is a small static page (main.home > section.hero / section.two, then footer), so no shadow-root
// or pop-up handling is needed.

(() => {
  // ---- Background rainbow (same as X's) ----
  const RAINBOW = `repeating-linear-gradient(115deg,
    hsl(0 100% 65%) 0, hsl(30 100% 62%) 5vmax, hsl(60 100% 58%) 10vmax, hsl(90 100% 58%) 15vmax,
    hsl(120 100% 60%) 20vmax, hsl(150 100% 58%) 25vmax, hsl(180 100% 58%) 30vmax, hsl(210 100% 65%) 35vmax,
    hsl(240 100% 72%) 40vmax, hsl(270 100% 70%) 45vmax, hsl(300 100% 68%) 50vmax, hsl(330 100% 66%) 55vmax,
    hsl(360 100% 65%) 60vmax)`;
  // Stripes repeat every 60vmax along their 115deg axis (60vmax / sin 115deg along x): sliding by that loops.
  const SLIDE = 'calc(-60vmax / 0.9063)';
  const WIDTH = 'calc(100vw + 70vmax)';
  const ROLL = '5s steps(75) infinite';

  // ---- The badges' mini-rainbow: one hue cycle every 24px on a 45deg diagonal, rolling in 0.8s ----
  const MINI = `repeating-linear-gradient(45deg,
    hsl(0 100% 60%) 0px, hsl(30 100% 60%) 2px, hsl(60 100% 60%) 4px,
    hsl(90 100% 60%) 6px, hsl(120 100% 60%) 8px, hsl(150 100% 60%) 10px,
    hsl(180 100% 60%) 12px, hsl(210 100% 60%) 14px, hsl(240 100% 60%) 16px,
    hsl(270 100% 60%) 18px, hsl(300 100% 60%) 20px, hsl(330 100% 60%) 22px,
    hsl(360 100% 60%) 24px)`;

  const style = document.createElement('style');
  style.textContent = `
    html::before {
      content: ''; position: fixed; top: 0; bottom: 0; left: 0; z-index: -1; pointer-events: none;
      width: ${WIDTH};
      background: ${RAINBOW};
      will-change: transform;
      animation: wm-rainbow-roll ${ROLL};
    }
    @keyframes wm-rainbow-roll { from { transform: translateX(0); } to { transform: translateX(${SLIDE}); } }

    /* The page paints its dark grey on <body>: clear it and every container. */
    html, body, body *:not(.wm-rainbow-music, .btn, code) { background-color: transparent !important; }
    /* The secondary (GitHub) button and inline code keep a frosted dark backing so they still read as boxes. */
    html body .btn.plain, html body code { background-color: rgba(10, 10, 14, 0.55) !important; border-color: rgba(255, 255, 255, 0.5) !important; }
    /* GitHub button: rolling rainbow lettering on its dark box. Two background layers: the rainbow,
       clipped to the text, over the dark backing, clipped to the box (background-color would be clipped
       to the text along with the top layer, so the backing is an image layer instead). */
    html body a.btn.plain {
      background-color: transparent !important;
      background-image: repeating-linear-gradient(90deg, hsl(0 100% 62%) 0, hsl(60 100% 58%) 20px, hsl(120 100% 55%) 40px,
          hsl(180 100% 60%) 60px, hsl(240 100% 70%) 80px, hsl(300 100% 66%) 100px, hsl(360 100% 62%) 120px),
        linear-gradient(rgba(10, 10, 14, 0.55), rgba(10, 10, 14, 0.55)) !important;
      background-size: 120px 100%, 100% 100% !important;
      -webkit-background-clip: text, padding-box !important; background-clip: text, padding-box !important;
      animation: rave-gh-roll 1.2s linear infinite;
    }
    /* Space shooter's You Win fades blasted buttons back in (.tss-win-fadein): with the rainbow, not instead */
    html body main a.btn:not(.plain).tss-win-fadein { animation: rave-getit-roll 1s linear infinite, tss-win-fadein 1.1s ease 1.6s both !important; }
    html body main a.btn.plain.tss-win-fadein { animation: rave-gh-roll 1.2s linear infinite, tss-win-fadein 1.1s ease 1.6s both !important; }
    /* (the rolling rainbows take the buttons' animation slot: on hover, Jelly buttons' wobble runs alongside) */
    /* (not while it's fading back in: the wobble would take over the fade, and the fade restart on leaving) */
    html body main a.btn.plain:not(.tss-win-fadein):hover { animation: rave-gh-roll 1.2s linear infinite, jb-jelly 0.7s ease-out both; }
    html body main a.btn:not(.plain):not(.tss-win-fadein):hover { animation: rave-getit-roll 1s linear infinite, jb-jelly 0.7s ease-out both !important; }
    @media (prefers-reduced-motion: reduce) {
      html body main a.btn.plain:not(.tss-win-fadein):hover { animation: rave-gh-roll 1.2s linear infinite; }
      html body main a.btn:not(.plain):not(.tss-win-fadein):hover { animation: rave-getit-roll 1s linear infinite !important; }
    }
    html body a.btn.plain, html body a.btn.plain * { -webkit-text-fill-color: transparent; text-shadow: none !important; }
    @keyframes rave-getit-roll { from { background-position: -90px -60px; } to { background-position: -47.573593px -102.426407px; } }
    @keyframes rave-gh-roll { from { background-position: 0 0, 0 0; } to { background-position: 120px 0, 0 0; } }

    body *, body *::placeholder, body *::before, body *::after { color: #fff !important; }
    body { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); }

    /* "Get it": the badges' fast mini-rainbow, with dark text so it stays readable on it. */
    @keyframes trif-rave-icons-roll {
      from { background-position: -40px -20px; }
      to { background-position: -23.029437px -36.970563px; }   /* one 24px period up the diagonal */
    }
    /* (halfway between the badges' tight mini-rainbow and the GitHub lettering's wide one: the GitHub
       colours, one cycle every 60px, on the badges' 45deg diagonal, rolling once a second. The image is
       oversized and slides one period up the diagonal, 60/sqrt(2) px each way, so the loop is seamless.) */
    html body a.btn:not(.plain) {
      background-color: transparent !important;
      background-image: repeating-linear-gradient(45deg, hsl(0 100% 62%) 0, hsl(60 100% 58%) 10px, hsl(120 100% 55%) 20px,
        hsl(180 100% 60%) 30px, hsl(240 100% 70%) 40px, hsl(300 100% 66%) 50px, hsl(360 100% 62%) 60px) !important;
      background-size: 500px 300px !important; background-repeat: no-repeat !important;
      animation: rave-getit-roll 1s linear infinite !important;
      color: #000 !important; text-shadow: none !important;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85);
    }

    /* Living robot's legs: the same rolling rainbow as the rest of him (beats Space shooter's damage
       colour, which uses !important on svg.robot[data-tss-hp] .lr-legs ...) */
    html body svg.robot[class] .lr-legs line { stroke: url(#trif-rave-robot) !important; }
    html body svg.robot[class] .lr-legs ellipse { fill: url(#trif-rave-robot) !important; }

    /* LED footer sign: keep its dark panel (the rave clears every background), and light its letters
       as rainbow LEDs: a rainbow fixed to the window shows through the text, so letters change colour
       as they scroll along the sign, with a soft white bloom */
    html body .led-sign { background-color: #0b0503 !important; }
    html body .led-sign .led-group a, html body .led-sign .led-group a::before {
      color: #fff !important;
      -webkit-text-fill-color: transparent;
      background: repeating-linear-gradient(90deg, hsl(0 100% 62%) 0, hsl(60 100% 58%) 8vw, hsl(120 100% 55%) 16vw,
        hsl(180 100% 58%) 24vw, hsl(240 100% 68%) 32vw, hsl(300 100% 65%) 40vw, hsl(360 100% 62%) 48vw) fixed !important;
      -webkit-background-clip: text !important; background-clip: text !important; /* after the !important shorthand */
      text-shadow: none !important; /* a shadow would paint over the clipped rainbow: glow with a filter */
    }
    /* the sign's bloom (a filter on the scrolling strip, see LED footer) goes white, around rainbow LEDs */
    html body .led-sign .led-track {
      filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.8)) drop-shadow(0 0 7px rgba(255, 255, 255, 0.5))
        drop-shadow(0 0 18px rgba(255, 255, 255, 0.35)) !important;
    }
    html body .led-sign { box-shadow: inset 0 0 18px #000, 0 0 0 1px #444, 0 6px 18px rgba(0, 0, 0, .5), 0 0 30px rgba(255, 255, 255, 0.35) !important; }
    html body .led-sign::after { background: radial-gradient(circle, rgba(255, 255, 255, 0.08) 1.4px, transparent 1.9px) 0 0 / 4px 4px !important; }

    /* Need checklist: the green bits go rainbow. Ticked boxes get the rolling diagonal rainbow (white edge),
       and the icons cycle through the rainbow, each a step apart. */
    @property --rave-cyc { syntax: '<number>'; inherits: true; initial-value: 0; }
    @keyframes rave-cyc { from { --rave-cyc: 0; } to { --rave-cyc: 360; } }
    html body ul[data-nc] { animation: rave-cyc 4s linear infinite; }
    html body ul[data-nc] > li:nth-child(4n+1) { --rave-nc: 0; }
    html body ul[data-nc] > li:nth-child(4n+2) { --rave-nc: 90; }
    html body ul[data-nc] > li:nth-child(4n+3) { --rave-nc: 180; }
    html body ul[data-nc] > li:nth-child(4n+4) { --rave-nc: 270; }
    html body ul[data-nc] li.nc-done .nc-box {
      background-color: transparent !important; border-color: rgba(255, 255, 255, 0.9) !important;
      background-image: repeating-linear-gradient(45deg, hsl(0 100% 62%) 0, hsl(60 100% 58%) 4px, hsl(120 100% 55%) 8px,
        hsl(180 100% 60%) 12px, hsl(240 100% 70%) 16px, hsl(300 100% 66%) 20px, hsl(360 100% 62%) 24px) !important;
      background-size: 100px 60px !important; background-repeat: no-repeat !important;
      animation: trif-rave-icons-roll 0.8s linear infinite;
    }
    html body ul[data-nc] li.nc-done .nc-icon { color: hsl(calc(var(--rave-cyc) + var(--rave-nc, 0)) 100% 62%) !important; }
    /* ...and the icons' strokes take the boxes' rolling diagonal rainbow (an SVG gradient, #rave-nc-grad,
       made by ncGradient below; the colour above is the fallback) */
    html body ul[data-nc] li.nc-done .nc-icon, html body ul[data-nc] li.nc-done .nc-icon * { stroke: url(#rave-nc-grad) !important; }
    /* (the icon's shapes stroke "currentColor", worked out on each shape, which "all text white" makes
       white: they take the icon's colour instead) */
    html body ul[data-nc] li .nc-icon * { color: inherit !important; }
    /* the tick inside a ticked box: white */
    html body ul[data-nc] .nc-box svg { stroke: #fff !important; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)); }

    /* Terminal box in Gravity mode: Gravity strips the frame of a container its pieces fall out of, but here
       the box has no background (the rave clears it), so without its frame it'd vanish: keep the frame */
    /* (and in the rave the frame is white, with a soft white glow) */
    html body [data-tb], html[data-gm-on] body [data-tb][data-gm-bare] { border-color: rgba(255, 255, 255, 0.9) !important;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45), 0 0 14px rgba(255, 255, 255, 0.25) !important; }
    html body [data-tb] .tb-bar, html[data-gm-on] body [data-tb] .tb-bar[data-gm-bare] { border-bottom-color: rgba(255, 255, 255, 0.9) !important; }

    /* Typing tagline: its glowing "your own coding agent" glows rainbow instead of green. Each letter
       (wrapped in .rave-tch by rainbowTagline below, with its index in --i) gets its own hue, rolling, with
       a neon glow of the same hue behind it; it fades in from plain white like the green one does
       (--rave-tt-a goes 0 → 1: animated through a registered property, since the colours have to be
       !important to beat "all text white", and animations can't override !important values). The cursor
       cycles through the rainbow. */
    html body .hero .tagline { animation: rave-cyc 3s linear infinite; }
    @property --rave-tt-a { syntax: '<number>'; inherits: true; initial-value: 1; }
    @keyframes rave-tt-in { from { --rave-tt-a: 0; } to { --rave-tt-a: 1; } }
    html body .tagline .tt-glow { animation: rave-tt-in 1.2s ease-out both !important; text-shadow: none !important; }
    html body .tagline .tt-glow .rave-tch, html body .tagline .tt-glow .rave-tch * {
      --h: calc(var(--rave-cyc) + var(--i, 0) * 17);
      color: color-mix(in srgb, #fff calc((1 - var(--rave-tt-a)) * 100%), hsl(var(--h) 100% 68%)) !important;
      /* a crisp core and a faint dark edge here; the wide halo is light, on the glow canvas (raveGlow) */
      text-shadow: 0 0 3px hsl(var(--h) 100% 60% / calc(var(--rave-tt-a) * 0.9)), 0 1px 2px rgba(0, 0, 0, 0.35) !important;
    }
    html body .tagline .tt-cursor {
      background: hsl(var(--rave-cyc) 100% 60%) !important; box-shadow: 0 0 8px hsl(var(--rave-cyc) 100% 60%) !important;
    }

    /* Space shooter's control tips: plain white with a shadow, readable on the rainbow */
    html #tss-hud { color: #fff !important; opacity: 1 !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.5) !important; }

    /* Neon title, rainbow version: never flickers (no warm-up flashes, no hum, no sputtering letter);
       the letters keep their rolling wave */
    html body main h1, html body main h1.nt-lit { animation: none !important; }
    html body main h1 .nt-ch, html body main h1.nt-lit .nt-ch.nt-bad {
      animation: nt-wave 1.8s ease-in-out calc(var(--nt-i) * 0.08s - 3.6s) infinite !important;
    }
    /* Neon title: each letter its own neon colour, around the rainbow (--nt-i is its index) */
    /* (and whatever wraps the letter inside, e.g. Space shooter's word span, which "all text white" would catch) */
    html body main h1 .nt-ch, html body main h1 .nt-ch * {
      -webkit-text-stroke: 3px rgba(255, 255, 255, 0.7); paint-order: stroke fill; /* thin white outline, outside the letter (half shows) */
      /* (--nt-hue, if a title sets it, overrides the position-based hue: Space shooter's "You Win!" spreads
         its few letters over the whole rainbow) */
      color: hsl(var(--nt-hue, calc(var(--nt-i, 0) * 16)) 95% 50%) !important;
      text-shadow: none !important; /* the glow is light, added on the glow canvas (see raveGlow) */
    }
    /* the additive glow layer: above the page, below the shooter's canvas */
    /* (sized in pixels to the window as innerWidth/innerHeight measure it, like what's drawn: see paint) */
    #rave-glow, #rave-glow-z { position: fixed; left: 0; top: 0; pointer-events: none;
      z-index: 2147483644; mix-blend-mode: plus-lighter; }

    /* Space shooter's "ROBOT DESTROYED": rainbow letters (--tss-i is each one's index) that spin down
       into place one after another with a flash, then roll through the rainbow and bob in a wave */
    /* the hue rolls by animating a registered number (a hue-rotate filter muddies saturated colours) */
    @property --rave-bn-h { syntax: '<number>'; inherits: true; initial-value: 0; }
    html #tss-banner .tss-bn { animation: rave-bn-hue 2.4s linear infinite !important; color: #fff; }
    html #tss-banner .tss-w {
      --h: calc(var(--tss-i, 0) * 26 + var(--rave-bn-h));
      display: inline-block;
      -webkit-text-stroke: 5px rgba(255, 255, 255, 0.8); paint-order: stroke fill; /* thin white outline, outside the letter (half shows) */
      color: hsl(var(--h) 100% 58%) !important;
      text-shadow: none !important; /* glow: see raveGlow */
      /* named rave-bn-*, not trif-rave-*: the phase-sync listener below would zero their staggered delays */
      animation: rave-bn-in 900ms cubic-bezier(.2, 1.5, .4, 1) calc(var(--tss-i, 0) * 70ms) both,
        rave-bn-wave 1.1s ease-in-out calc(var(--tss-i, 0) * 90ms) infinite alternate;
    }
    @keyframes rave-bn-hue { from { --rave-bn-h: 0; } to { --rave-bn-h: 360; } }
    @keyframes rave-bn-in {
      0% { opacity: 0; transform: translateY(-160px) rotate(-260deg) scale(3.2); filter: blur(8px) brightness(3); }
      55% { opacity: 1; filter: blur(0) brightness(2.2); }
      80% { transform: translateY(6px) rotate(8deg) scale(0.95); filter: brightness(1.4); }
      100% { opacity: 1; transform: none; filter: none; }
    }
    @keyframes rave-bn-wave { from { translate: 0 -5px; } to { translate: 0 5px; } }

    /* (in the row of buttons along the top: see topBar) */
    .wm-rainbow-music { width: 40px; height: 40px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.6) !important; background-color: rgba(0,0,0,0.5) !important;
      padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .wm-rainbow-music svg { width: 20px; height: 20px; fill: #fff; display: block; }
    /* the other mods' buttons in the row (Space shooter's restart, Gravity mode's drop) go dark like these */
    #trif-top-bar > .trif-top-btn { color: #fff; border: 1px solid rgba(255,255,255,0.6) !important;
      background: rgba(0,0,0,0.5) !important; box-shadow: none; }
    /* unlocked by winning: they pop in, with a glow that fades */
    .wm-rainbow-music.wm-rainbow-new { animation: wm-rainbow-pop 1.1s cubic-bezier(.2,1.6,.4,1) both; }
    .wm-rainbow-zoom.wm-rainbow-new { animation-delay: .25s; }
    @keyframes wm-rainbow-pop {
      0% { transform: scale(0); opacity: 0; box-shadow: 0 0 0 0 rgba(255,255,255,0.9); }
      60% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 24px 8px rgba(255,255,255,0.6); }
      100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(255,255,255,0); }
    }
    .wm-rainbow-zoom[aria-pressed=false] { opacity: 0.6; }
  `;
  (document.head || document.documentElement).append(style);

  // Keep every rainbow animation in phase, whenever its element appeared.
  addEventListener('animationstart', (e) => {
    try {
      if (!/^(wm-rainbow|trif-rave)/.test(e.animationName)) return;
      for (const a of document.getAnimations()) {
        if (/^(wm-rainbow|trif-rave)/.test(a.animationName || '') && a.startTime !== 0) a.startTime = 0;
      }
    } catch {}
  }, true);

  // ---- Robot: the same mini-rainbow as an SVG gradient on its outline and eyes ----
  // The logo is an inline <svg class="robot"> (viewBox 0 0 128 128) whose outline strokes url(#r) and eyes
  // fill url(#e). We add our own repeating gradient and point both at it, so the original gradients (and
  // any other mod restyling them) are left alone. The badge rainbow is 24 CSS px per cycle; in the logo's
  // user units that's 24 * 128 / rendered width, set from the rendered size.
  const NS = 'http://www.w3.org/2000/svg';
  const rainbowRobot = () => {
    try {
      const svg = document.querySelector('svg.robot');
      if (!svg) return false;
      if (svg.querySelector('#trif-rave-robot')) return true;
      const vb = svg.viewBox?.baseVal;
      const units = (vb && vb.width) || 128;
      const px = svg.getBoundingClientRect().width || 112;
      const d = (24 * units / px) / Math.SQRT2;   // the 24px period, split along x and -y (45deg, up-right)
      const g = document.createElementNS(NS, 'linearGradient');
      g.id = 'trif-rave-robot';
      g.setAttribute('gradientUnits', 'userSpaceOnUse');
      g.setAttribute('spreadMethod', 'repeat');
      g.setAttribute('x1', '0'); g.setAttribute('y1', '0');
      g.setAttribute('x2', String(d)); g.setAttribute('y2', String(-d));
      for (let i = 0; i <= 12; i++) {
        const s = document.createElementNS(NS, 'stop');
        s.setAttribute('offset', String(i / 12));
        s.setAttribute('stop-color', `hsl(${i * 30}, 100%, 60%)`);
        g.append(s);
      }
      const roll = document.createElementNS(NS, 'animateTransform');
      roll.setAttribute('attributeName', 'gradientTransform');
      roll.setAttribute('type', 'translate');
      roll.setAttribute('from', '0 0');
      roll.setAttribute('to', `${d} ${-d}`);
      roll.setAttribute('dur', '0.8s');
      roll.setAttribute('repeatCount', 'indefinite');
      g.append(roll);
      (svg.querySelector('defs') || svg).append(g);
      for (const el of svg.querySelectorAll('[stroke="url(#r)"]')) el.setAttribute('stroke', 'url(#trif-rave-robot)');
      for (const el of svg.querySelectorAll('[fill="url(#e)"]')) el.setAttribute('fill', 'url(#trif-rave-robot)');
      // The eyes' glow was tinted green by a colour matrix: make it a white glow, which suits any hue.
      const m = svg.querySelector('filter feColorMatrix');
      if (m) m.setAttribute('values', '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0');
      // The more the Space shooter has hurt him (data-tss-hp, 100 → 0), the faster his rainbow rolls:
      // 0.8 s a cycle when healthy, 5× faster near the end.
      const syncSpeed = () => {
        const hp = parseFloat(svg.getAttribute('data-tss-hp'));
        const dur = 0.8 * (0.2 + 0.8 * (Number.isFinite(hp) ? Math.max(0, Math.min(100, hp)) : 100) / 100);
        const v = `${dur.toFixed(3)}s`;
        if (roll.getAttribute('dur') !== v) roll.setAttribute('dur', v);
      };
      new MutationObserver(() => { try { syncSpeed(); } catch {} })
        .observe(svg, { attributes: true, attributeFilter: ['data-tss-hp'] });
      syncSpeed();
      return true;
    } catch (e) { window.trif?.warn('robot rainbow failed', String(e)); return true; }
  };
  if (!rainbowRobot()) addEventListener('DOMContentLoaded', rainbowRobot);
  // Another mod (Red robot) may reset the glow at DOMContentLoaded: set ours once more after load (or now,
  // if the page has loaded already: the demo adds mods to the page as it is).
  const afterLoad = () => { try { svgGlow(); } catch {} };
  if (document.readyState === 'complete') setTimeout(afterLoad); else addEventListener('load', afterLoad);
  const svgGlow = () => {
    const m = document.querySelector('svg.robot filter feColorMatrix');
    if (m) m.setAttribute('values', '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0');
  };

  // ---- Trance loop: synthesized live with Web Audio (no files, nothing loaded from anywhere). ----
  let musicOn = false;
  const BPM = 138, STEP = 60 / BPM / 4;   // 16th notes
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];   // Am - F - C - G
  const ROOTS = [45, 41, 48, 43];
  const ARP = [0, 1, 2, 1, 2, 0, 1, 2];
  let ctx, master, noise, next = 0, step = 0, timer;

  const env = (g, t, peak, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  };
  const voice = (type, freq, t, peak, decay, cutoff, detunes = [0]) => {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4;
    f.connect(g); g.connect(master); env(g, t, peak, decay);
    for (const dt of detunes) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = dt;
      o.connect(f); o.start(t); o.stop(t + decay + 0.05);
    }
  };
  const kick = (t) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    o.connect(g); g.connect(master); env(g, t, 1, 0.3);
    o.start(t); o.stop(t + 0.35);
  };
  const hiss = (t, type, freq, peak, decay) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = type; f.frequency.value = freq;
    s.connect(f); f.connect(g); g.connect(master); env(g, t, peak, decay);
    s.start(t); s.stop(t + decay + 0.05);
  };
  const KICK_LEAD = 200; // ms: other mods hear about each kick this much before it sounds
  const announceKick = (t) => {
    const ms = (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
    const at = performance.now() + ms;
    setTimeout(() => kickPulse(at), Math.max(0, ms));
    // Other mods can dance to it (Space shooter's ship pulses on each kick). Announced KICK_LEAD early:
    // an expanding ring is only noticed once it has grown a bit, so firing on the beat reads as late.
    setTimeout(() => { if (musicOn && !document.hidden) dispatchEvent(new CustomEvent('rave-kick')); }, Math.max(0, ms - KICK_LEAD));
  };
  const play = (s, t) => {
    const bar = Math.floor(s / 16) % 4, beat = s % 16, chord = CHORDS[bar];
    if (beat % 4 === 0) { kick(t); announceKick(t); }
    if (beat % 4 === 2) { hiss(t, 'highpass', 8000, 0.25, 0.06); voice('sawtooth', midi(ROOTS[bar]), t, 0.35, 0.12, 900); }
    if (beat % 8 === 4) hiss(t, 'bandpass', 1800, 0.35, 0.18);
    const note = chord[ARP[beat % 8]] + 12 + (Math.floor(s / 16) % 2) * 12;
    voice('sawtooth', midi(note), t, 0.09, STEP * 1.6, 1200 + (s % 64) * 60, [-12, 0, 12]);
    if (beat === 0) for (const n of chord) voice('sawtooth', midi(n), t, 0.04, STEP * 16, 1400, [-8, 8]);
  };
  // A stuck audio clock (device switch, screen recorder) marks the context stale; the next click rebuilds it.
  let stale = false, lastClock = -1, stalledSince = 0;
  const tick = () => {
    try {
      const now = ctx.currentTime;
      if (now === lastClock) {
        if (!stalledSince) stalledSince = performance.now();
        else if (!stale && performance.now() - stalledSince > 1000) {
          stale = true;
          window.trif?.warn('music clock stuck (audio context ' + ctx.state + '); restarting on next click');
        }
        return;
      }
      lastClock = now; stalledSince = 0;
      if (next < now - 0.1) next = now + 0.05;
      // schedule 0.4 s ahead: with a 0.1 s tick, every kick is known at least KICK_LEAD (0.2 s) early
      while (next < now + 0.4) { play(step, next); next += STEP; step = (step + 1) % 64; }
    } catch (e) { window.trif?.warn('music failed', String(e)); stop(); }
  };
  const start = () => {
    muteButton(); // (the music is ready to play: the courtesy mute appears, before it decides)
    if (isMuted()) return; // (the courtesy mute: the music waits for it to go off)
    if (ctx && (stale || ctx.state === 'closed')) { try { ctx.close(); } catch {} ctx = null; stale = false; }
    if (!ctx) {
      // (on an iPhone, sound plays as media, so the silent switch doesn't mute it: Safari's audio session)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); master.gain.value = 0.3;
      master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      next = ctx.currentTime + 0.05; lastClock = -1; stalledSince = 0;
      muteButton(); // (its first sound: the courtesy mute appears)
    }
    ctx.resume();
    if (!timer) { next = ctx.currentTime + 0.05; lastClock = -1; stalledSince = 0; timer = setInterval(tick, 100); }
  };
  // Space shooter's "play again?": `tss-again-out` { ms } fades the music out (then it stops, still "on");
  // `tss-again-in` starts it again from the top of the loop, if it's on.
  let fadeTimer = 0;
  addEventListener('tss-again-out', (e) => {
    try {
      if (!ctx || !master || !timer) return;
      const sec = Math.max(0.1, (e.detail?.ms || 1200) / 1000), now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.0001, now + sec);
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(stop, sec * 1000 + 50);
    } catch (err) { window.trif?.warn('music fade failed', String(err)); }
  });
  addEventListener('tss-again-in', () => {
    try {
      clearTimeout(fadeTimer);
      if (!ctx || !master) return;
      clearInterval(timer); timer = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.3, ctx.currentTime);
      step = 0;
      if (musicOn && !document.hidden) start(); // (start() resets the clock: the loop's first beat is next)
    } catch (err) { window.trif?.warn('music restart failed', String(err)); }
  });
  const unstick = () => { if (musicOn && stale) { try { start(); } catch (err) { window.trif?.warn('music restart failed', String(err)); } } };
  addEventListener('pointerdown', unstick, true);
  addEventListener('touchend', unstick, true); // (a touchscreen only allows sound once a finger lifts)
  addEventListener('keydown', unstick, true);
  const stop = () => { clearInterval(timer); timer = 0; ctx?.suspend(); };
  const sync = () => {
    if (musicOn && !document.hidden && ctx) start(); else stop();
    if (button) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      // a music note; struck through while the music is off
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z');
      if (!musicOn) path.setAttribute('opacity', '0.6');
      svg.append(path);
      if (!musicOn) {
        const slash = document.createElementNS(NS, 'path');
        slash.setAttribute('d', 'M4 4 20 20');
        slash.setAttribute('fill', 'none'); slash.setAttribute('stroke', '#fff');
        slash.setAttribute('stroke-width', '2'); slash.setAttribute('stroke-linecap', 'round');
        svg.append(slash);
      }
      button.replaceChildren(svg);
      button.setAttribute('aria-label', musicOn ? 'Pause rainbow music' : 'Play rainbow music');
    }
  };
  document.addEventListener('visibilitychange', sync);
  // The courtesy mute: the music stops while it's on, and starts again (if it's on) when it's off.
  // (unmuting is a click: the music can start then, even if it never has yet)
  addEventListener('trif-mute', () => { try { if (isMuted()) stop(); else if (musicOn && !document.hidden) { start(); sync(); } } catch {} });

  // Autoplay on the first click or keypress (browsers only allow sound after a gesture). On timsrobot.com
  // the music is always on (no play/pause or zoom buttons): it starts with your first real click or key
  // press, and any later one wakes it if the browser held it back.
  const firstGesture = (e) => {
    if (!e.isTrusted) return; // (a click sent by code can't unlock sound: wait for a real one)
    gestureUnmute(e); // (the courtesy mute's showing and nothing's chosen: this click turns the sound on)
    if (button && e.composedPath().includes(button)) return; // (the play/pause button, once unlocked, decides itself)
    if (zoomButton && e.composedPath().includes(zoomButton)) return;
    removeEventListener('pointerdown', firstGesture, true);
    removeEventListener('keydown', firstGesture, true);
    if (musicOn) return;
    musicOn = true;
    try { start(); } catch (err) { window.trif?.warn('music failed', String(err)); musicOn = false; }
    sync();
  };
  addEventListener('pointerdown', firstGesture, true);
  addEventListener('keydown', firstGesture, true);
  // The music's meant to play from the start: the courtesy mute turns up now, muted, and the first click
  // turns the sound on as it starts the music.
  setTimeout(() => { try { muteButton(); } catch {} }); // (once this whole script has run: muteButton is further down)
  const wakeMusic = (e) => {
    gestureUnmute(e);
    if (e.isTrusted && musicOn && ctx && ctx.state === 'suspended' && !document.hidden) { try { start(); } catch {} }
  };
  addEventListener('pointerdown', wakeMusic, true);
  addEventListener('touchend', wakeMusic, true); // (a touchscreen only allows sound once a finger lifts)
  addEventListener('keydown', wakeMusic, true);

  // ---- Kick zoom: the page's blocks zoom with each kick, around the centre of the screen. ----
  // One endless beat-long animation per block, sharing one start time locked to the kicks (see X's version
  // for why: restarting per kick re-rasterizes everything twice a beat).
  // (always on until the buttons are unlocked by winning, see below; then your choice is remembered)
  let zoomOn = true;
  try { if (localStorage.getItem('wmRainbow.unlocked') === '1') zoomOn = localStorage.getItem('wmRainbow.zoom') !== 'off'; } catch {}
  const BEAT = 60000 / BPM;
  const PULSE = [{ scale: 1.05, easing: 'steps(4)' }, { scale: 1, offset: 280 / BEAT }, { scale: 1 }];
  const TIMING = { duration: BEAT, iterations: Infinity };
  // (the home page's sections and footer; on a page whose <main> has no sections, like the report form and
  // the Windows waitlist, <main> as a whole)
  const BLOCK = 'main > section, body > footer';
  const sectionless = () => !document.querySelector('main > section');
  const blocks = () => [...document.querySelectorAll(sectionless() ? 'main, body > footer' : BLOCK)];
  const blockOf = (el) => el.closest(BLOCK) || (sectionless() ? el.closest('main') : null);

  let phase = null, stopTimer = 0;
  const scales = new Map();
  const stopAll = () => { for (const a of scales.values()) a.cancel(); scales.clear(); phase = null; };
  const pulseOn = (el, cx, cy) => {
    const box = el.getBoundingClientRect();
    const origin = `${Math.round(cx - box.left)}px ${Math.round(cy - box.top)}px`;
    if (el.style.transformOrigin !== origin) el.style.transformOrigin = origin;
    if (scales.has(el)) return;
    const anim = el.animate(PULSE, TIMING);
    anim.startTime = phase;
    scales.set(el, anim);
  };
  const kickPulse = (at) => {
    try {
      if (!zoomOn || !musicOn || document.hidden) { clearTimeout(stopTimer); stopAll(); return; }
      const drift = phase === null ? 0 : ((at - phase) % BEAT + BEAT) % BEAT;
      if (phase === null || Math.min(drift, BEAT - drift) > 15) {
        phase = at;
        for (const a of scales.values()) a.startTime = phase;
      }
      for (const [el, a] of scales) if (!el.isConnected) { a.cancel(); scales.delete(el); }
      const cx = innerWidth / 2, cy = innerHeight / 2;
      for (const el of blocks()) pulseOn(el, cx, cy);
      // the glow layer for what's in those blocks zooms with them, on the same clock (see raveGlow)
      // (it sits at the window's top-left, so the zoom's centre is the window's centre in its own pixels)
      const gz = document.getElementById('rave-glow-z');
      if (gz) {
        gz.style.transformOrigin = `${cx}px ${cy}px`;
        if (!scales.has(gz)) { const a = gz.animate(PULSE, TIMING); a.startTime = phase; scales.set(gz, a); }
      }
      clearTimeout(stopTimer);
      stopTimer = setTimeout(stopAll, BEAT * 2.5);
    } catch (e) { stopAll(); window.trif?.warn('kick zoom failed', String(e)); }
  };

  let zoomButton, button;
  const syncZoom = () => {
    if (!zoomOn) { clearTimeout(stopTimer); stopAll(); }
    if (!zoomButton) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const add = (d, stroke, opacity = 1) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      if (stroke) {
        path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#fff');
        path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round');
      }
      path.setAttribute('opacity', String(opacity));
      svg.append(path);
    };
    // the page zooming out and back: four corners around a block (the sound waves are the mute button's)
    add('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', true);
    add('M9 9h6v6H9z');
    if (!zoomOn) add('M4 4 20 20', true);
    zoomButton.replaceChildren(svg);
    zoomButton.setAttribute('aria-pressed', String(zoomOn));
    zoomButton.setAttribute('aria-label', zoomOn ? 'Turn off kick zoom' : 'Turn on kick zoom');
    zoomButton.title = zoomOn ? 'Kick zoom on: click to turn it off' : 'Kick zoom off: click to turn it on';
  };
  const addButtons = (fresh) => {
    if (button) return;
    zoomButton = document.createElement('button');
    zoomButton.className = 'wm-rainbow-music wm-rainbow-zoom';
    zoomButton.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomOn = !zoomOn;
      try { localStorage.setItem('wmRainbow.zoom', zoomOn ? 'on' : 'off'); } catch {}
      syncZoom();
    });
    syncZoom();
    button = document.createElement('button');
    button.className = 'wm-rainbow-music wm-rainbow-play';
    button.title = 'Play/pause rainbow music';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEventListener('pointerdown', firstGesture, true);
      removeEventListener('keydown', firstGesture, true);
      musicOn = !musicOn;
      try { if (musicOn) start(); } catch (err) { window.trif?.warn('music failed', String(err)); musicOn = false; }
      sync();
    });
    if (fresh) { zoomButton.classList.add('wm-rainbow-new'); button.classList.add('wm-rainbow-new'); } // the unlock: they pop in
    topBar().append(zoomButton, button);
    sync();
  };
  // The row of round buttons along the top of the window. On a touchscreen it's spread evenly from edge to
  // edge, in this order: the courtesy mute (from the first sound on), Space shooter's restart, Rainbow
  // Rave's kick zoom and music (once won), Gravity mode's drop (mute, restart and drop: left, middle and
  // right). With a mouse there's no restart or drop: the mute and the rave's two sit together in the top
  // right. Whichever mod needs it first makes it; the others find it. Light buttons, or the rave's dark ones
  // while it's on.
  // On <html>, not <body> (the tilt card transforms <body>, and Gravity mode piles up what's in it), and
  // in the top layer where the browser has one (popover): there it stays on the window whatever <html>
  // does (the tilt card's perspective, the shooter's screen shake). Where there's no top layer, it's
  // measured every frame and nudged back. As wide as the window measures (the demo's panel narrows it).
  const topBar = () => {
    let bar = document.getElementById('trif-top-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'trif-top-bar';
    if (matchMedia('(pointer: coarse)').matches) bar.classList.add('trif-top-touch');
    const style = document.createElement('style');
    style.textContent = `
      #trif-top-bar { position: fixed; inset: 0 auto auto 0; margin: 0; border: 0; background: none; color: inherit;
        overflow: visible; height: auto; z-index: 2147483647; box-sizing: border-box; width: 100vw;
        padding: 16px; display: flex; justify-content: flex-end; gap: 8px; pointer-events: none; }
      #trif-top-bar.trif-top-touch { justify-content: space-between; gap: 0; }
      #trif-top-bar > button { pointer-events: auto; flex: none; margin: 0; -webkit-tap-highlight-color: transparent; }
      :where(#trif-top-bar) > button.trif-top-btn { width: 40px; height: 40px; border-radius: 50%; padding: 0;
        display: flex; align-items: center; justify-content: center; cursor: pointer; color: #18181a;
        border: 1px solid rgba(0,0,0,0.15); background: rgba(255,255,255,0.88); box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      .trif-top-btn svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor;
        stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .trif-top-mute { order: 1; } .trif-top-left { order: 2; } .wm-rainbow-zoom { order: 3; } .wm-rainbow-play { order: 4; }
      .trif-top-right { order: 5; }`;
    bar.append(style);
    document.documentElement.append(bar);
    const fit = () => { bar.style.width = `${document.documentElement.clientWidth}px`; };
    fit();
    addEventListener('resize', fit);
    if (typeof bar.showPopover === 'function') {
      bar.popover = 'manual';
      bar.showPopover();
      return bar;
    }
    let px = 0, py = 0;
    const pin = () => {
      if (!bar.isConnected) return;
      try {
        const r = bar.getBoundingClientRect();
        if (Math.abs(r.left) > 0.5 || Math.abs(r.top) > 0.5) {
          px -= r.left; py -= r.top;
          bar.style.translate = `${px.toFixed(1)}px ${py.toFixed(1)}px`;
        }
      } catch {}
      requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
    return bar;
  };

  // The courtesy mute, shared by the mods that make sound (Living Robot, Space Shooter, Click Fireworks,
  // Rainbow Rave): the first button in the row along the top, there from the first sound on. It silences
  // all of them (each one suspends its own audio while it's on: the `trif-mute` event).
  // It turns up the first time there's meant to be a sound, muted (a speaker with an X), on every page load
  // (browsers won't play sound before a click anyway), and the next click, tap or key press anywhere on the
  // page turns the sound on, unless the button was used to switch it off: then it stays off until the
  // button turns it back on. The choice is kept for the visit (this tab's sessionStorage: '1' switched
  // off, '0' on, nothing yet: on at the first click); without storage, for the page.
  const MUTED = 'trif.muted';
  const muteChoice = () => { try { const v = sessionStorage.getItem(MUTED); if (v !== null) return v; } catch {} return window.__trifMuteChoice ?? null; };
  const isMuted = () => muteChoice() !== '0' || !window.__trifSoundLive; // (live: since a click on this page)
  const setMuted = (on) => {
    if (!on) window.__trifSoundLive = true;
    window.__trifMuteChoice = on ? '1' : '0';
    try { sessionStorage.setItem(MUTED, window.__trifMuteChoice); } catch {}
  };
  // A real click, tap or key press, not on the button, while the button's showing on this page and the
  // sound wasn't switched off with it: the sound comes on. (Each sound mod calls this from its gesture
  // listener, then resumes.)
  const gestureUnmute = (e) => {
    if (!e.isTrusted || muteChoice() === '1' || window.__trifSoundLive || !document.getElementById('trif-mute')) return;
    if (e.composedPath?.().some((n) => n.id === 'trif-mute')) return;
    setMuted(false);
    dispatchEvent(new CustomEvent('trif-mute', { detail: { muted: false } }));
  };
  const muteButton = () => {
    if (document.getElementById('trif-mute')) return;
    const NS = 'http://www.w3.org/2000/svg';
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'trif-mute';
    b.className = 'trif-top-btn trif-top-mute';
    const sync = () => {
      const muted = isMuted();
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const add = (d, filled, opacity = 1) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        if (filled) p.setAttribute('fill', 'currentColor');
        p.setAttribute('opacity', String(opacity));
        svg.append(p);
      };
      add('M3.5 9.5h3l4.5-4v13l-4.5-4h-3z', true); // a speaker
      if (muted) add('M15.5 9.5l5 5M20.5 9.5l-5 5'); // with an X
      else { add('M14.5 9.2a4 4 0 0 1 0 5.6'); add('M17.3 6.6a7.6 7.6 0 0 1 0 10.8', false, 0.7); } // or sound waves
      b.replaceChildren(svg);
      b.setAttribute('aria-pressed', String(muted));
      b.setAttribute('aria-label', muted ? 'Sound off: turn it back on' : 'Mute the sound');
      b.title = muted ? 'Sound off (click to turn it on)' : 'Mute';
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setMuted(!isMuted());
      sync();
      dispatchEvent(new CustomEvent('trif-mute', { detail: { muted: isMuted() } }));
    });
    addEventListener('trif-mute', sync);
    sync();
    topBar().append(b);
  };
  // On timsrobot.com the play/pause and kick-zoom buttons are a prize: until you've won Space Shooter's game
  // (its `tss-win` event), the music and the zoom are simply part of the rave. Winning unlocks them; they pop
  // in when you come back from the win ("play again?": as the white fades away, `tss-again-in`), and stay
  // unlocked (remembered in this browser).
  const UNLOCK = 'wmRainbow.unlocked';
  let unlocked = false;
  try { unlocked = localStorage.getItem(UNLOCK) === '1'; } catch {}
  const showButtons = (fresh) => { if (document.body) addButtons(fresh); else addEventListener('DOMContentLoaded', () => addButtons(fresh)); };
  if (unlocked) showButtons(false);
  let justWon = false;
  addEventListener('tss-win', () => {
    if (button) return;
    justWon = true;
    try { localStorage.setItem(UNLOCK, '1'); } catch {}
  });
  // …and they arrive switched off: as the win fades to white, the music (already fading out) stays off and
  // the zoom stops, so you come back to a quiet page, with the buttons to turn them on
  addEventListener('tss-again-out', () => {
    if (!justWon) return;
    musicOn = false;
    zoomOn = false;
    try { localStorage.setItem('wmRainbow.zoom', 'off'); } catch {}
    clearTimeout(stopTimer); stopAll();
  });
  addEventListener('tss-again-in', () => {
    if (!justWon) return;
    justWon = false;
    setTimeout(() => showButtons(true), 700); // (once the page is mostly back from the white)
  });

  // ---- Additive glow for the neon title and Space shooter's "ROBOT DESTROYED" ----
  // A CSS text-shadow paints plain colour (a smudge on the rainbow) and can't blend, and mix-blend-mode
  // on the letters can't reach the background (the tilt card's 3D transforms isolate them). So each
  // letter's glow is drawn on a canvas outside <body> with mix-blend-mode: plus-lighter, which ADDS its
  // light to whatever is under it. Every frame it follows the letters' boxes (waving, tilting, falling
  // in Gravity mode), skipping blasted ones.
  // Two layers: #rave-glow-z for letters in the page's blocks, which the kick zoom pulses with the same
  // animation as the blocks (an animation runs on the compositor's clock, a canvas redraw on the page's:
  // drawing the zoomed positions instead put the glows a frame off on every beat), so it's drawn as if
  // unzoomed; and #rave-glow for the rest ("ROBOT DESTROYED", which doesn't zoom).
  const raveGlow = () => {
    const cv = document.createElement('canvas');
    cv.id = 'rave-glow';
    const cvz = document.createElement('canvas');
    cvz.id = 'rave-glow-z';
    const g0 = cv.getContext('2d'), gz = cvz.getContext('2d');
    let g = g0;
    document.documentElement.append(cv, cvz);
    let W = 0, H = 0, px = 0, py = 0;
    const fonts = new WeakMap();
    const OFF = 10000; // the letters are drawn far off-canvas; only their shadow (the glow) lands here
    // Drawn every frame; while Gravity mode runs, right after it has moved its pieces (its `gm-frame`
    // event), so the glows don't trail a frame behind bouncing letters.
    const gravityOn = () => document.documentElement.hasAttribute('data-gm-on');
    addEventListener('gm-frame', () => paint());
    const draw = () => {
      if (!gravityOn()) paint();
      requestAnimationFrame(draw);
    };
    const paint = () => {
      try {
        if (!cv.isConnected) document.documentElement.append(cv);
        if (!cvz.isConnected) document.documentElement.append(cvz);
        const dpr = devicePixelRatio || 1;
        if (W !== innerWidth || H !== innerHeight || cv.width !== Math.round(innerWidth * dpr)) {
          W = innerWidth; H = innerHeight;
          cv.width = cvz.width = Math.round(W * dpr); cv.height = cvz.height = Math.round(H * dpr);
          // (not 100vw/100vh: a phone's 100vh includes the space under its toolbar, stretching the glows)
          for (const c of [cv, cvz]) { c.style.width = `${W}px`; c.style.height = `${H}px`; }
        }
        // pin to the window (the tilt card's `perspective` and the shooter's shake `translate` on <html>
        // make it the box "fixed" elements are placed in). The zoomed layer is placed the same way, so it
        // takes the same nudge (measuring it would include its zoom).
        const cr = cv.getBoundingClientRect();
        if (Math.abs(cr.left) > 0.5 || Math.abs(cr.top) > 0.5) { px -= cr.left; py -= cr.top; cv.style.translate = `${px}px ${py}px`; }
        if (cvz.style.translate !== cv.style.translate) cvz.style.translate = cv.style.translate;
        for (const c of [g0, gz]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); }
        const items = [];
        // [element, hue, size of the glow, strength]: the title's glow is gentler than the banner's
        for (const el of document.querySelectorAll('main h1 .nt-ch')) {
          const own = parseFloat(el.style.getPropertyValue('--nt-hue')); // see the title CSS
          items.push([el, Number.isFinite(own) ? own : (parseFloat(el.style.getPropertyValue('--nt-i')) || 0) * 16, 1, 0.45]);
        }
        // Typing tagline's rainbow phrase: halos in its letters' hues, fading in with them (--rave-tt-a)
        const tg = document.querySelector('.hero .tagline .tt-glow[data-rave-split]');
        if (tg) {
          const tcs = getComputedStyle(tg);
          const cyc = parseFloat(tcs.getPropertyValue('--rave-cyc')) || 0, a = parseFloat(tcs.getPropertyValue('--rave-tt-a'));
          for (const el of tg.querySelectorAll('.rave-tch')) {
            items.push([el, cyc + (parseFloat(el.style.getPropertyValue('--i')) || 0) * 17, 0.9, 0.55 * (Number.isFinite(a) ? a : 1)]);
          }
        }
        const bn = document.querySelector('#tss-banner .tss-bn');
        if (bn) {
          const roll = parseFloat(getComputedStyle(bn).getPropertyValue('--rave-bn-h')) || 0;
          for (const el of bn.querySelectorAll('.tss-w')) items.push([el, (parseFloat(el.style.getPropertyValue('--tss-i')) || 0) * 26 + roll, 1.5, 1]);
        }
        const opac = new Map(); // per frame: each title's own opacity, looked up once
        const titleOpacity = (h) => {
          if (!h) return 1;
          if (!opac.has(h)) { // its own opacity times its ancestors' (You Win's text fades out with its holder)
            let o = 1;
            for (let e = h, i = 0; e && e !== document.body && i < 8; e = e.parentElement, i++) o *= parseFloat(getComputedStyle(e).opacity);
            opac.set(h, Math.min(1, o));
          }
          return Number.isFinite(opac.get(h)) ? opac.get(h) : 1;
        };
        for (const c of [g0, gz]) { c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowOffsetX = -OFF * dpr; c.shadowOffsetY = 0; }
        const zooms = new Map(); // per frame: each block's current kick-zoom scale
        const zoomOf = (blk) => {
          if (!zooms.has(blk)) zooms.set(blk, parseFloat(getComputedStyle(blk).scale) || 1);
          return zooms.get(blk);
        };
        const zcx = W / 2, zcy = H / 2; // the zoom's centre (see kickPulse)
        for (const [el, hue, k, strength] of items) {
          // blasted (the mark can be on the letter, around it, or on Space shooter's word span inside it)
          if (el.closest('[data-tss-dead]') || (el.querySelector('.tss-w') && !el.querySelector('.tss-w:not([data-tss-dead])'))) continue;
          let r = el.getBoundingClientRect();
          // in a zooming block: drawn on the zoomed layer, where it was before the zoom
          const blk = blockOf(el);
          const z = blk ? zoomOf(blk) : 1;
          g = blk ? gz : g0;
          if (z !== 1) {
            const ux = (v) => zcx + (v - zcx) / z, uy = (v) => zcy + (v - zcy) / z;
            r = { left: ux(r.left), right: ux(r.right), top: uy(r.top), bottom: uy(r.bottom), width: r.width / z, height: r.height / z };
          }
          if (!r.width || r.bottom < -60 || r.top > H + 60 || r.right < -60 || r.left > W + 60) continue;
          let f = fonts.get(el);
          if (!f) {
            const cs = getComputedStyle(el);
            f = { size: parseFloat(cs.fontSize) || 40, style: `${cs.fontStyle} ${cs.fontWeight}`, family: cs.fontFamily };
            fonts.set(el, f);
          }
          // Gravity mode's spin (its --gm-r, on the piece, inherited by the letters in it)
          const ang = gravityOn() ? parseFloat(getComputedStyle(el).getPropertyValue('--gm-r')) || 0 : 0;
          const ac = Math.abs(Math.cos(ang)), as = Math.abs(Math.sin(ang));
          const span = el.offsetWidth * as + el.offsetHeight * ac; // the unscaled box's height on screen, turned
          const scale = span ? r.height / span : 1; // tilt / zoom / entrance scale
          // fade with what it belongs to: the banner letters fade in; a title can be faded out (e.g.
          // Space shooter's You Win clears the hero's title, and adds its own "You Win!" h1)
          const alpha = k > 1 ? Math.min(1, parseFloat(getComputedStyle(el).opacity) || 0) : titleOpacity(el.closest('h1, .tagline'));
          if (alpha <= 0.02) continue;
          const size = f.size * scale;
          g.font = `${f.style} ${size}px ${f.family}`;
          // the text sits OFF px to the right of the letter (the shadow offset, in device pixels whatever
          // the transform, brings the glow back onto it), turned with the letter about that point
          const x = (r.left + r.width / 2 + OFF) * dpr, y = (r.top + r.height / 2) * dpr;
          const cos = Math.cos(ang) * dpr, sin = Math.sin(ang) * dpr;
          g.setTransform(cos, sin, -sin, cos, x, y);
          for (const [blur, light, a] of [[size * 0.12 * k, 70, 0.9], [size * 0.35 * k, 55, 0.7]]) { // a tight core, a wide halo
            g.shadowBlur = blur * dpr;
            g.shadowColor = `hsla(${hue % 360}, 100%, ${light}%, ${a * alpha * strength})`;
            g.fillStyle = '#000';
            g.fillText(el.textContent, 0, 0);
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
      } catch (e) { window.trif?.warn('rave glow failed', String(e)); }
    };
    requestAnimationFrame(draw);
  };
  if (document.body) raveGlow(); else addEventListener('DOMContentLoaded', raveGlow);

  // Typing tagline: once its glowing phrase is in (it's rebuilt when the typing finishes), put each of its
  // letters in a .rave-tch span with its index, for the per-letter rainbow (see the CSS). Space shooter may
  // already have wrapped the words in spans; the letters go inside those.
  const rainbowTagline = () => {
    try {
      const g = document.querySelector('.hero .tagline .tt-glow');
      if (!g || g.hasAttribute('data-rave-split')) return;
      g.setAttribute('data-rave-split', '');
      const walker = document.createTreeWalker(g, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let i = 0;
      for (const node of nodes) {
        const frag = document.createDocumentFragment();
        for (const ch of node.data) {
          if (/\s/.test(ch)) { frag.append(ch); continue; }
          const s = document.createElement('span');
          s.className = 'rave-tch';
          s.style.setProperty('--i', String(i++));
          s.textContent = ch;
          frag.append(s);
        }
        node.replaceWith(frag);
      }
    } catch (e) { window.trif?.warn('rainbow tagline failed', String(e)); }
  };
  const watchTagline = () => {
    const p = document.querySelector('.hero .tagline');
    if (!p) return;
    new MutationObserver(rainbowTagline).observe(p, { childList: true, subtree: true });
    rainbowTagline();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watchTagline); else watchTagline();

  // Need checklist icons: the ticked boxes' rolling diagonal rainbow (24 CSS px a cycle, 45deg, 0.8 s), as
  // an SVG gradient the icons' strokes point at (see the CSS). The icons have a 24-unit viewBox shown at
  // 20px, so a 24px period is 24 * 24 / 20 units. It lives in its own hidden <svg> in the body.
  const ncGradient = () => {
    try {
      if (document.getElementById('rave-nc-grad') || !document.querySelector('ul[data-nc]')) return;
      const icon = document.querySelector('ul[data-nc] .nc-icon');
      const px = icon?.getBoundingClientRect().width || 20;
      const d = (24 * 24 / px) / Math.SQRT2;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      const g = document.createElementNS(NS, 'linearGradient');
      g.id = 'rave-nc-grad';
      g.setAttribute('gradientUnits', 'userSpaceOnUse');
      g.setAttribute('spreadMethod', 'repeat');
      g.setAttribute('x1', '0'); g.setAttribute('y1', String(d));
      g.setAttribute('x2', String(d)); g.setAttribute('y2', '0');
      for (let i = 0; i <= 12; i++) {
        const s = document.createElementNS(NS, 'stop');
        s.setAttribute('offset', String(i / 12));
        s.setAttribute('stop-color', `hsl(${i * 30}, 100%, 62%)`);
        g.append(s);
      }
      const roll = document.createElementNS(NS, 'animateTransform');
      roll.setAttribute('attributeName', 'gradientTransform');
      roll.setAttribute('type', 'translate');
      roll.setAttribute('from', '0 0');
      roll.setAttribute('to', `${d} ${-d}`);
      roll.setAttribute('dur', '0.8s');
      roll.setAttribute('repeatCount', 'indefinite');
      g.append(roll);
      svg.append(g);
      document.body.append(svg);
    } catch (e) { window.trif?.warn('checklist icon rainbow failed', String(e)); }
  };
  // (Need checklist runs at document-idle, after us: wait for its list)
  const waitNc = (n = 0) => { ncGradient(); if (!document.getElementById('rave-nc-grad') && n < 20) setTimeout(() => waitNc(n + 1), 500); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => waitNc()); else waitNc();
})();
