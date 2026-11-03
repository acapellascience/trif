// ==WebMod==
// @name        Rainbow Rave
// @description Rainbow Instagram, trance music, total rave
// @match       https://www.instagram.com/*
// @exclude     https://www.instagram.com/accounts/*
// @exclude     https://www.instagram.com/challenge/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// Ported from timsrobot.com/rave (rolling rainbow, white text, trance loop, kick zoom, shimmering icons).
// Not on login, account or security-check pages. Instagram's class names are generated (and change), so
// this keys on roles, labels and tags, and the generic passes at the bottom do most of the work: they find
// coloured icons (the verified badge, a liked heart) and buttons by their colour. Photos and videos are
// left as they are: they're the point.

(() => {
  const SITE = {
    css: ({ windowCss, shimmerCss }) => `
      /* The top bar (logged out) and the bottom tab bar (phones): rainbow windows in the opposite colours,
         so the feed scrolls under them, not through them; a white hairline at their edge. */
      ${windowCss('html body [data-trif-rave-bar]')}
      html body [data-trif-rave-bar=top] { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) !important; }
      html body [data-trif-rave-bar=bottom] { box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.7) !important; }
      /* Menus, the share sheet, hover cards: rainbow windows too. Dialogs (a post opened over the feed, the
         log-in wall, settings) are for reading: dark glass, white edge. The page behind dims. */
      ${windowCss('html body :is([role=menu], [role=listbox])')}
      html body :is([role=menu], [role=listbox]) { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 8px 24px rgba(0, 0, 0, 0.35) !important; border-radius: 12px; }
      html body [role=dialog]:not([role=dialog] [role=dialog]) {
        background-color: rgba(10, 10, 14, 0.82) !important; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 12px 40px rgba(0, 0, 0, 0.5) !important;
        border-radius: 12px;
      }
      html body [data-trif-rave-dim] { background-color: rgba(0, 0, 0, 0.5) !important; }
      /* Story rings (canvases): coloured ones (a new story) shimmer, through a mask of the ring itself;
         grey ones (seen) go white. See the pass below. */
      ${shimmerCss('html body canvas[data-trif-rave-ring=rainbow]')}
      html body canvas[data-trif-rave-ring=rainbow] { object-position: -99999px 0 !important; }
      html body canvas[data-trif-rave-ring=plain] { filter: brightness(0) invert(1) drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.6)); }
      /* Hairlines (between posts, around the comment box, the profile tabs) white. */
      html body :is(main, nav, footer, [role=dialog], article) * { border-color: rgba(255, 255, 255, 0.4) !important; }
      /* The selected profile tab's line: bright white. */
      html body [role=tablist] [aria-selected=true] { border-color: #fff !important; }
      /* Captions and comments are long reads: a slightly heavier shadow. */
      html body :is(article, [role=dialog]) :is(h1, span[dir=auto]) { text-shadow: 0 0 4px rgba(0, 0, 0, 0.85), 0 1px 2px rgba(0, 0, 0, 0.7) !important; }
      /* Photos and videos keep their colours; a soft shadow lifts them off the rainbow. */
      html body main :is(article img, a[href*="/p/"] img, a[href*="/reel/"] img, video) { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3); }
      /* The controls: in the logged-out top bar, before Log In (see place). */
      div.trif-rave-ui.trif-rave-ig:not(#trif-rave) { margin-right: 12px; }
      div.trif-rave-ui.trif-rave-ig button:not(#trif-rave) { width: 34px; height: 34px; }
      div.trif-rave-ui.trif-rave-ig button:not(#trif-rave) svg { width: 17px; height: 17px; }
    `,
    // Instagram's links drawn as buttons (Log In, Sign up) carry role=link.
    candidates: 'a[role=link]',
    pass: ({ shimmerSvg }) => {
      // The Instagram wordmark is white (or black): it always shimmers.
      for (const svg of document.querySelectorAll('svg[aria-label=Instagram]:not([data-trif-rave-svg])')) shimmerSvg(svg, true);
      // Bars fixed to the top (logged out: logo, Log In, Sign Up) or bottom (the tab bar on phones).
      for (const logo of document.querySelectorAll('svg[aria-label=Instagram], a[href="/"]')) {
        for (let el = logo.parentElement, i = 0; el && el !== document.body && i < 10; el = el.parentElement, i++) {
          if (el.hasAttribute('data-trif-rave-bar')) break;
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.height < 90 && r.width > innerWidth * 0.6) el.setAttribute('data-trif-rave-bar', r.top < innerHeight / 2 ? 'top' : 'bottom');
          break;
        }
      }
      // The dim layer behind a dialog: a fixed, full-window box just before it.
      for (const d of document.querySelectorAll('[role=dialog]')) {
        for (let el = d, i = 0; el && el !== document.body && i < 10; el = el.parentElement, i++) {
          for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
            if (s.hasAttribute('data-trif-rave-dim') || getComputedStyle(s).position !== 'fixed') continue;
            const r = s.getBoundingClientRect();
            if (r.width >= innerWidth - 2 && r.height >= innerHeight - 2) s.setAttribute('data-trif-rave-dim', '');
          }
        }
      }
      // Story rings: canvases Instagram draws the ring on. A coloured ring becomes the mask its shimmer
      // shows through (a snapshot of the canvas); a grey one goes white. Redrawn rings get looked at again.
      for (const cv of document.querySelectorAll('canvas')) {
        if (cv.closest('.trif-rave-ui') || !cv.width || cv.width > 400) continue;
        const key = `${cv.width}x${cv.height}`;
        if (cv.getAttribute('data-trif-rave-ring-at') === key) continue;
        let g;
        try { g = cv.getContext('2d'); } catch { g = null; }
        if (!g) { cv.setAttribute('data-trif-rave-ring-at', key); continue; }
        let px;
        try { px = g.getImageData(0, 0, cv.width, cv.height).data; } catch { cv.setAttribute('data-trif-rave-ring-at', key); continue; }
        let seen = 0, coloured = 0;
        for (let i = 0; i < px.length; i += 4 * 7) {
          if (px[i + 3] < 128) continue;
          seen++;
          const max = Math.max(px[i], px[i + 1], px[i + 2]), min = Math.min(px[i], px[i + 1], px[i + 2]);
          if (max - min > 60) coloured++;
        }
        if (!seen) continue;   // not drawn yet
        cv.setAttribute('data-trif-rave-ring-at', key);
        if (coloured > seen * 0.3) {
          let url;
          try { url = cv.toDataURL(); } catch { continue; }
          for (const p of ['mask-image', '-webkit-mask-image']) cv.style.setProperty(p, `url("${url}")`);
          for (const p of ['mask-size', '-webkit-mask-size']) cv.style.setProperty(p, '100% 100%');
          cv.setAttribute('data-trif-rave-ring', 'rainbow');
          cv.setAttribute('data-trif-rave-pop', '');
        } else {
          cv.setAttribute('data-trif-rave-ring', 'plain');
        }
      }
    },
    // The page's blocks that zoom on the kick: the profile header and tabs, the grid's tiles, posts (the
    // feed's and a post's own page), and a dialog's post. Bars hold still, a frame for the bounce.
    blocks: () => [...document.querySelectorAll(`main header, main [role=tablist], main a[href*="/p/"]:has(img), main a[href*="/reel/"]:has(img),
      main article, [role=dialog] article`)],
    // Instagram is a React app: nodes of ours inside its tree can trip it up when it re-renders, so the
    // controls stay outside it (on <html>), floating. Logged out, lined up in the top bar just left of
    // Log In; otherwise in the top right corner, where Instagram keeps nothing (its message bubble is
    // bottom right, its menu bottom left).
    place: () => false,
    corner: (ui) => {
      const login = document.querySelector('[data-trif-rave-bar=top] a[href*="/accounts/login"]');
      const r = login && login.getBoundingClientRect();
      ui.classList.add('trif-rave-ig');
      if (!r || !r.width) return '16px 16px auto auto';
      // (no room between the logo and Log In, on a narrow phone: bottom right instead)
      const logo = document.querySelector('[data-trif-rave-bar=top] svg[aria-label=Instagram]')?.getBoundingClientRect();
      if (logo && logo.width && r.left - logo.right < ui.offsetWidth + 24) return 'auto 16px 16px auto';
      return `${Math.round(r.top + r.height / 2 - 17)}px ${Math.round(document.documentElement.clientWidth - r.left + 12)}px auto auto`;
    },
  };

  // ======================================================================================================
  // The rave itself: the same in every Rainbow Rave mod (timsrobot.com's, ported). Everything above is
  // this site's part: SITE says what bounces, what shimmers and where the controls go.
  // ======================================================================================================
  const NS = 'http://www.w3.org/2000/svg';
  const warned = new Set();
  const warn = (what, e) => { if (!warned.has(what)) { warned.add(what); window.trif?.warn(`${what}: ${e}`); } };

  // ---- The beat. Every bounce, pulse and shimmer on the page runs on this one clock: a kick lands at
  // `phase` + n beats (performance.now() ms; the page's time origin until the music starts, then the
  // music's own kicks). Every rave animation lasts a whole number of beats dividing CYCLE, and starts
  // at anchor(), so whenever an element appeared, its loop hits on the kick with everything else. ----
  const BPM = 138, BEAT = 60000 / BPM, STEP = 60 / BPM / 4;   // 16th notes, in seconds
  const CYCLE = 24 * BEAT;
  let phase = 0;
  // `phase`, moved back by whole cycles so it isn't in the future (a start time ahead of now would
  // leave the animation waiting).
  const anchor = () => phase - Math.ceil(Math.max(0, phase - performance.now()) / CYCLE) * CYCLE;
  const isRave = (a) => /^trif-rave/.test(a.animationName || a.id || '');
  const pin = (a) => { const t = anchor(); if (a.startTime !== t) a.startTime = t; };
  const repinAll = () => {
    try { for (const a of document.getAnimations()) if (isRave(a)) pin(a); } catch (e) { warn('beat sync failed', e); }
    syncSvgClock();
  };
  // A CSS animation starts when its element appears (or its style changes): pin it to the beat then.
  addEventListener('animationstart', (e) => {
    try {
      if (!/^trif-rave/.test(e.animationName)) return;
      for (const a of e.target.getAnimations({ subtree: !!e.pseudoElement })) if (a.animationName === e.animationName) pin(a);
    } catch {}
  }, true);

  // ---- The background: a psychedelic rainbow rolling behind the whole page (as on X and timsrobot.com).
  // It rolls 12 beats a loop, in 72 steps (6 a beat), not smoothly: everything is drawn over it, and
  // a step redraws the screen, so 60 fps made big pages crawl. ----
  const RAINBOW = `repeating-linear-gradient(115deg,
    hsl(0 100% 65%) 0, hsl(30 100% 62%) 5vmax, hsl(60 100% 58%) 10vmax, hsl(90 100% 58%) 15vmax,
    hsl(120 100% 60%) 20vmax, hsl(150 100% 58%) 25vmax, hsl(180 100% 58%) 30vmax, hsl(210 100% 65%) 35vmax,
    hsl(240 100% 72%) 40vmax, hsl(270 100% 70%) 45vmax, hsl(300 100% 68%) 50vmax, hsl(330 100% 66%) 55vmax,
    hsl(360 100% 65%) 60vmax)`;
  const SLIDE = 'calc(-60vmax / 0.9063)';   // one stripe period along x (60vmax / sin 115deg): loops seamlessly
  const ROLL = `${(12 * BEAT).toFixed(3)}ms steps(72) infinite`;
  // The shimmer: X's "rave badge" mini-rainbow, one hue cycle every 24px on a 45deg diagonal, rolling
  // one period every 2 beats (in 16 steps: there can be dozens of shimmering things on a page).
  const MINI = `repeating-linear-gradient(45deg, hsl(0 100% 60%) 0px, hsl(30 100% 60%) 2px, hsl(60 100% 60%) 4px,
    hsl(90 100% 60%) 6px, hsl(120 100% 60%) 8px, hsl(150 100% 60%) 10px, hsl(180 100% 60%) 12px,
    hsl(210 100% 60%) 14px, hsl(240 100% 60%) 16px, hsl(270 100% 60%) 18px, hsl(300 100% 60%) 20px,
    hsl(330 100% 60%) 22px, hsl(360 100% 60%) 24px)`;
  // Buttons get timsrobot.com's "Get it" rainbow: the same diagonal, wider (60px a cycle), so their
  // (dark) labels stay readable on it.
  const WIDE = `repeating-linear-gradient(45deg, hsl(0 100% 62%) 0, hsl(60 100% 58%) 10px, hsl(120 100% 55%) 20px,
    hsl(180 100% 60%) 30px, hsl(240 100% 70%) 40px, hsl(300 100% 66%) 50px, hsl(360 100% 62%) 60px)`;
  const SHIMMER_ROLL = `${(2 * BEAT).toFixed(3)}ms steps(16) infinite`;
  // A "rainbow window": the background rainbow, pinned to the window, showing through a box (menus,
  // sticky headers). 'menu' is half a period ahead, the opposite colours, so it stands out from the page.
  const windowCss = (sel, phaseName = 'menu') => `
    ${sel} {
      background-color: transparent !important; background-image: ${RAINBOW} !important;
      background-size: calc(100vw + 140vmax) 100vh !important; background-repeat: no-repeat !important;
      background-attachment: fixed !important; animation: trif-rave-window-${phaseName} ${ROLL} !important;
    }`;
  // A box filled with the shimmer (MINI) or the button rainbow (WIDE). The image is oversized and slides
  // one period up the diagonal, so the loop is seamless.
  const shimmerCss = (sel, wide = false) => `
    ${sel} {
      background-color: transparent !important; background-image: ${wide ? WIDE : MINI} !important;
      background-size: 600px 400px !important; background-repeat: no-repeat !important;
      background-position: -60px -60px;
      animation: trif-rave-${wide ? 'wide' : 'mini'} ${SHIMMER_ROLL} !important;
    }`;
  // Text drawn in the shimmer (the background clipped to the letters).
  const shimmerTextCss = (sel) => `${shimmerCss(sel)}
    ${sel} { -webkit-background-clip: text !important; background-clip: text !important;
      -webkit-text-fill-color: transparent !important; text-shadow: none !important;
      filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6)); }`;

  const BASE_CSS = `
    html::before {
      content: ''; position: fixed; top: 0; bottom: 0; left: 0; z-index: -1; pointer-events: none;
      width: calc(100vw + 70vmax); background: ${RAINBOW}; will-change: transform;
      animation: trif-rave-roll ${ROLL};
    }
    @keyframes trif-rave-roll { from { transform: translateX(0); } to { transform: translateX(${SLIDE}); } }
    @keyframes trif-rave-window-box { from { background-position: 0 0; } to { background-position: ${SLIDE} 0; } }
    @keyframes trif-rave-window-menu { from { background-position: calc(-30vmax / 0.9063) 0; } to { background-position: calc(-90vmax / 0.9063) 0; } }
    /* one period up the 45deg diagonal: 24px (MINI) or 60px (WIDE) / sqrt 2 on each axis */
    @keyframes trif-rave-mini { from { background-position: -60px -60px; } to { background-position: -43.029437px -76.970563px; } }
    @keyframes trif-rave-wide { from { background-position: -60px -60px; } to { background-position: -17.573593px -102.426407px; } }

    /* Every box clear, so the rainbow shows. Only background-color: images (photos, sprites) stay.
       Boxes the rave classified (buttons, badges: data-trif-rave-bg, below) are styled on their own. */
    html, body, body *:not(.trif-rave-ui, .trif-rave-ui *, [data-trif-rave-bg], [data-trif-rave-probe], img, video, canvas, iframe) {
      background-color: transparent !important;
    }
    /* All text white, with a dark shadow so it reads on the yellow and cyan stripes too. Monochrome icons
       use currentColor, so they go white as well. (:not(#trif-rave) matches everything; it's there to
       outrank sites' own !important colour classes.) */
    body *:not(#trif-rave), body *:not(#trif-rave)::placeholder, body *:not(#trif-rave)::before, body *:not(#trif-rave)::after { color: #fff !important; }
    body { text-shadow: 0 0 3px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(0, 0, 0, 0.6); }
    body *::placeholder { opacity: 0.8 !important; }
    body svg:not(.trif-rave-ui svg) { filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55)); }
    ::selection { background: rgba(0, 0, 0, 0.55) !important; color: #fff !important; }
    /* Fields: a dark glass box, white text and caret. (A native select's list stays dark on white.) */
    html body :is(input:not([type=checkbox], [type=radio], [type=range], [type=image], [type=submit], [type=button], [type=reset], [type=color], [type=file]), textarea, select) {
      background-color: rgba(10, 10, 14, 0.35) !important; color: #fff !important; caret-color: #fff !important;
    }
    html body select option:not(#trif-rave), html body select optgroup:not(#trif-rave) { color: #000 !important; background-color: #fff !important; text-shadow: none !important; }
    /* Coloured buttons and badges: the rolling button rainbow, dark labels (as timsrobot.com's "Get it"). */
    ${shimmerCss('html body [data-trif-rave-bg=shimmer]', true)}
    html body [data-trif-rave-bg=shimmer] { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85) !important; }
    html body [data-trif-rave-bg=shimmer]:not(#trif-rave), html body [data-trif-rave-bg=shimmer] *:not(#trif-rave) { color: #000 !important; text-shadow: none !important; }
    html body [data-trif-rave-bg=shimmer] svg { filter: none !important; }
    /* Grey and white buttons: dark glass with a white edge (timsrobot.com's GitHub button). */
    html body [data-trif-rave-bg=glass] {
      background-color: rgba(10, 10, 14, 0.45) !important; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55) !important;
    }
    html body [data-trif-rave-bg=none] { background-color: transparent !important; }
    /* Product shots and logos on white: the white keyed out (see whiteKey), so they float on the rainbow. */
    html body [data-trif-rave-key] { filter: url(#trif-rave-white-key) !important; }

    /* The controls: kick zoom on/off and music play/pause, round dark glass buttons (timsrobot.com's). */
    /* (:not(#trif-rave) and !important: page styles for buttons, ids included, mustn't reach them) */
    div.trif-rave-ui:not(#trif-rave) { display: flex !important; gap: 8px; align-items: center; z-index: 2147483000; flex: none; }
    div.trif-rave-ui.trif-rave-float:not(#trif-rave) { position: fixed !important; }
    div.trif-rave-ui button:not(#trif-rave) { all: unset; box-sizing: border-box !important; width: 40px; height: 40px; border-radius: 50% !important;
      cursor: pointer !important; border: 1px solid rgba(255, 255, 255, 0.6) !important; background: rgba(0, 0, 0, 0.5) !important;
      display: flex !important; align-items: center !important; justify-content: center !important; flex: none !important;
      padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
    div.trif-rave-ui button:not(#trif-rave):focus-visible { outline: 2px solid #fff !important; outline-offset: 2px; }
    div.trif-rave-ui button:not(#trif-rave):hover { background: rgba(0, 0, 0, 0.65) !important; }
    div.trif-rave-ui button:not(#trif-rave) svg { width: 20px; height: 20px; fill: #fff !important; display: block !important; filter: none !important; }
    div.trif-rave-ui .trif-rave-zoom[aria-pressed=false]:not(#trif-rave) { opacity: 0.6; }
  `;

  const style = document.createElement('style');
  style.textContent = BASE_CSS + SITE.css({ windowCss, shimmerCss, shimmerTextCss, RAINBOW, MINI, WIDE, SHIMMER_ROLL, ROLL, BEAT });
  (document.head || document.documentElement).append(style);
  // Put it back if the page throws it out (some apps rebuild <head>).
  setInterval(() => { if (!style.isConnected) (document.head || document.documentElement).append(style); }, 2000);

  // ---- SVG: shimmering icons. Every coloured shape in an inline <svg> (a solid colour, or one of the
  // site's own gradients) is filled with the shimmer instead, as an SVG gradient (CSS backgrounds can't
  // paint SVG shapes); all-grey icons go white, like text. Gradients live in one hidden <svg>, one per
  // scale (the shimmer is 24 screen px a cycle, so it's 24 × units-per-px in an icon's own units), and
  // roll on the beat clock (syncSvgClock). ----
  let defs = null;
  const grads = new Map();
  const defsSvg = () => {
    if (defs && defs.isConnected) return defs;
    if (!document.body) return null;
    if (!defs) {
      defs = document.createElementNS(NS, 'svg');
      defs.setAttribute('aria-hidden', 'true');
      defs.setAttribute('class', 'trif-rave-ui');
      defs.setAttribute('style', 'position:absolute !important;width:0;height:0;overflow:hidden;pointer-events:none;display:block !important');
      // White key: alpha = 24 × A − 8 × (R + G + B), clamped: white (and near-white) goes see-through,
      // what was see-through stays so.
      const f = document.createElementNS(NS, 'filter');
      f.id = 'trif-rave-white-key';
      f.setAttribute('color-interpolation-filters', 'sRGB');
      const m = document.createElementNS(NS, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -8 -8 -8 24 0');
      f.append(m);
      defs.append(f);
    }
    // On <html>, not in <body>: pages (and other mods) hide body's children wholesale, and a hidden <svg>'s
    // gradients and filters stop working.
    document.documentElement.append(defs);
    return defs;
  };
  const gradFor = (upp) => {
    const k = Math.max(0.05, Math.round(upp * 20) / 20);
    const id = `trif-rave-g${String(k).replace('.', '_')}`;
    if (grads.has(id)) return id;
    const d = defsSvg();
    if (!d) return null;
    const p = (24 * k) / Math.SQRT2;
    const g = document.createElementNS(NS, 'linearGradient');
    g.id = id;
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('spreadMethod', 'repeat');
    g.setAttribute('x1', '0'); g.setAttribute('y1', '0');
    g.setAttribute('x2', String(p)); g.setAttribute('y2', String(-p));
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
    roll.setAttribute('to', `${p} ${-p}`);
    roll.setAttribute('dur', `${(2 * BEAT / 1000).toFixed(5)}s`);
    roll.setAttribute('repeatCount', 'indefinite');
    g.append(roll);
    d.append(g);
    grads.set(id, g);
    syncSvgClock();
    return id;
  };
  // SMIL keeps its own clock (the hidden <svg>'s): set it to the beat's.
  function syncSvgClock() {
    try { if (defs && defs.isConnected && defs.setCurrentTime) defs.setCurrentTime((performance.now() - anchor()) / 1000); } catch {}
  }
  setInterval(syncSvgClock, 10000);

  const rgba = (s) => {
    const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(s || '');
    return m ? { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const hsl = (c) => {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    return { s, l };
  };
  const colourful = (c) => { const { s, l } = hsl(c); return c.a > 0.3 && s > 0.35 && l > 0.15 && l < 0.9; };
  const SHAPES = 'path, circle, rect, ellipse, polygon, polyline, line, text, use';
  const shimmerSvg = (svg, force = false) => {
    if (svg.hasAttribute('data-trif-rave-svg') || svg.closest('.trif-rave-ui')) return;
    svg.setAttribute('data-trif-rave-svg', '');
    const shapes = svg.querySelectorAll(SHAPES);
    if (!shapes.length || shapes.length > 120) return;
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const upp = vb && vb.width && box.width ? vb.width / box.width : 1;
    const icon = !box.width || (box.width <= 64 && box.height <= 64);
    const coloured = [], plain = [];
    for (const s of shapes) {
      const cs = getComputedStyle(s);
      for (const prop of ['fill', 'stroke']) {
        const v = cs[prop];
        if (!v || v === 'none') continue;
        if (/^url\(/.test(v)) { if (!v.includes('trif-rave')) coloured.push([s, prop]); continue; }
        const c = rgba(v);
        if (!c || c.a === 0) continue;
        if (force || colourful(c)) coloured.push([s, prop]);
        else if (hsl(c).l < 0.97) plain.push([s, prop]);
      }
    }
    if (coloured.length) {
      const id = gradFor(upp);
      if (!id) { svg.removeAttribute('data-trif-rave-svg'); return; }
      for (const [s, prop] of coloured) s.style.setProperty(prop, `url(#${id})`, 'important');
      svg.setAttribute('data-trif-rave-pop', '');
    } else if (icon && plain.length) {
      for (const [s, prop] of plain) s.style.setProperty(prop, '#fff', 'important');
    }
  };

  // ---- Buttons and badges: the ones the site paints in a colour get the button rainbow, grey and
  // white ones dark glass. The page CSS above clears every background, so to see a box's own colour it
  // is exempted for a moment (data-trif-rave-probe), all of a batch at once (one style recalc). ----
  const CANDIDATES = `button, [role=button], input[type=submit], input[type=button], [role=tab], [role=switch]${SITE.candidates ? ', ' + SITE.candidates : ''}`;
  const classify = (els) => {
    els = els.filter((el) => !el.closest('.trif-rave-ui'));
    for (const el of els) el.setAttribute('data-trif-rave-probe', '');
    const kinds = els.map((el) => {
      const c = rgba(getComputedStyle(el).backgroundColor);
      if (!c || c.a < 0.12) return 'none';
      if (colourful(c)) return 'shimmer';
      return 'glass';
    });
    els.forEach((el, i) => {
      el.removeAttribute('data-trif-rave-probe');
      const k = SITE.classify ? SITE.classify(el, kinds[i]) : kinds[i];
      el.setAttribute('data-trif-rave-bg', k);
      if (k === 'shimmer') el.setAttribute('data-trif-rave-pop', '');
    });
  };

  // ---- Passes: new content (lazy-loaded results, menus, dialogs) gets the same treatment. ----
  const pass = () => {
    if (!document.body) return;
    defsSvg();
    try { SITE.pass && SITE.pass({ shimmerSvg, gradFor }); } catch (e) { warn('site pass failed', e); }
    try {
      const svgs = document.querySelectorAll('svg:not([data-trif-rave-svg])');
      for (let i = 0; i < svgs.length && i < 400; i++) shimmerSvg(svgs[i]);
    } catch (e) { warn('icon shimmer failed', e); }
    try { classify([...document.querySelectorAll(`:is(${CANDIDATES}):not([data-trif-rave-bg])`)].slice(0, 400)); }
    catch (e) { warn('button rainbow failed', e); }
    try { placeControls(); } catch (e) { warn('controls failed', e); }
  };
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; pass(); }, 250);
  };
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  // (the first pass waits for the end of this script: everything below is set up by then)
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', pass); else setTimeout(pass, 0);
  addEventListener('load', queue);
  // (Single-page apps: their route changes rebuild the page, which the observer above sees. History
  // isn't patched, so the page has nothing of ours to notice but styles and attributes.)

  // ---- Trance loop: synthesized live with Web Audio (no files, nothing loaded from anywhere). It
  // starts on the first click or keypress (browsers only allow sound after one); the play button
  // stops and restarts it. Paused while the tab is hidden. ----
  let musicOn = false;
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
  // Each kick, when it will actually sound (audio clock → page clock, output latency included).
  const announceKick = (t) => {
    const ms = (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
    const at = performance.now() + ms;
    setTimeout(() => kickPulse(at), Math.max(0, ms - 120));   // a little early: bounces are set up before the hit
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
        else if (!stale && performance.now() - stalledSince > 1000) { stale = true; warn('music clock stuck', `audio context ${ctx.state}; restarting on next click`); }
        return;
      }
      lastClock = now; stalledSince = 0;
      if (next < now - 0.1) next = now + 0.05;
      while (next < now + 0.4) { play(step, next); next += STEP; step = (step + 1) % 64; }
    } catch (e) { warn('music failed', e); stop(); }
  };
  const start = () => {
    if (ctx && (stale || ctx.state === 'closed')) { try { ctx.close(); } catch {} ctx = null; stale = false; }
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); master.gain.value = 0.3;
      master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    ctx.resume();
    if (!timer) {
      // Start on a fresh bar, so the loop always comes in from its top.
      next = ctx.currentTime + 0.05; step = 0; lastClock = -1; stalledSince = 0; timer = setInterval(tick, 100);
    }
  };
  const stop = () => { clearInterval(timer); timer = 0; ctx?.suspend(); stopBounce(); };
  const unstick = () => { if (musicOn && stale) { try { start(); } catch (err) { warn('music restart failed', err); } } };
  addEventListener('pointerdown', unstick, true);
  addEventListener('keydown', unstick, true);

  // ---- Bounces. While the music plays (and the kick zoom is on), the page's main blocks zoom with
  // every kick, around the centre of the window (timsrobot.com's kick zoom), and every shimmering icon
  // and button pops around its own centre. One endless beat-long animation each, all with the same
  // start time (anchor()), so they all hit on the kick together; they're only (re)started when the
  // beat drifts, never per kick (that re-rasterized everything twice a beat). ----
  let zoomOn = true;
  try { zoomOn = localStorage.getItem('trifRave.zoom') !== 'off'; } catch {}
  const ZOOM = [{ scale: 1.04, easing: 'steps(4)' }, { scale: 1, offset: 280 / BEAT }, { scale: 1 }];
  const POP = [{ scale: 1.16, easing: 'steps(4)' }, { scale: 1, offset: 280 / BEAT }, { scale: 1 }];
  const MAX_POPS = 80;
  const bouncing = new Map();   // element -> Animation
  let stopTimer = 0;
  const stopBounce = () => { clearTimeout(stopTimer); for (const a of bouncing.values()) a.cancel(); bouncing.clear(); };
  const bounce = (el, frames, origin) => {
    if (origin && el.style.transformOrigin !== origin) el.style.transformOrigin = origin;
    if (bouncing.has(el)) return;
    const a = el.animate(frames, { duration: BEAT, iterations: Infinity, id: 'trif-rave-bounce' });
    a.startTime = anchor();
    bouncing.set(el, a);
  };
  const inView = (r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  function kickPulse(at) {
    try {
      if (!musicOn || document.hidden) { stopBounce(); return; }
      const drift = ((at - phase) % BEAT + BEAT) % BEAT;
      if (Math.min(drift, BEAT - drift) > 15) { phase = at; repinAll(); }
      if (!zoomOn) { stopBounce(); return; }
      for (const [el, a] of bouncing) if (!el.isConnected) { a.cancel(); bouncing.delete(el); }
      const cx = innerWidth / 2, cy = innerHeight / 2;
      for (const el of SITE.blocks()) {
        const r = el.getBoundingClientRect();
        if (inView(r)) bounce(el, ZOOM, `${Math.round(cx - r.left)}px ${Math.round(cy - r.top)}px`);
      }
      let pops = 0;
      for (const a of bouncing.values()) if (a.effect?.getKeyframes?.()[0]?.scale === '1.16') pops++;
      for (const el of document.querySelectorAll('[data-trif-rave-pop]')) {
        if (pops >= MAX_POPS) break;
        if (bouncing.has(el) || el.closest('[data-trif-rave-nopop]')) continue;
        const r = el.getBoundingClientRect();
        if (!inView(r) || r.width > 320 || r.height > 120) continue;
        bounce(el, POP, 'center');
        pops++;
      }
      clearTimeout(stopTimer);
      stopTimer = setTimeout(stopBounce, BEAT * 2.5);
    } catch (e) { stopBounce(); warn('kick zoom failed', e); }
  }

  // ---- The controls: kick zoom on/off, music play/pause. SITE.place puts them where they fit on this
  // site (and is asked again whenever the page changes); otherwise they float in a corner. ----
  let ui, zoomButton, button;
  const icon = (paths) => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [d, stroke, opacity = 1] of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      if (stroke) { p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); }
      p.setAttribute('opacity', String(opacity));
      svg.append(p);
    }
    return svg;
  };
  const syncButtons = () => {
    if (!ui) return;
    button.replaceChildren(icon([[musicOn ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z']]));
    button.setAttribute('aria-label', musicOn ? 'Pause rave music' : 'Play rave music');
    button.title = musicOn ? 'Pause the rave music' : 'Play the rave music';
    const waves = [['M12 9.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5z'], ['M15.5 8.5a5 5 0 0 1 0 7M8.5 8.5a5 5 0 0 0 0 7', true],
      ['M18.5 5.5a9.2 9.2 0 0 1 0 13M5.5 5.5a9.2 9.2 0 0 0 0 13', true, 0.55]];
    if (!zoomOn) waves.push(['M4 4 20 20', true]);
    zoomButton.replaceChildren(icon(waves));
    zoomButton.setAttribute('aria-pressed', String(zoomOn));
    zoomButton.setAttribute('aria-label', zoomOn ? 'Turn off kick zoom' : 'Turn on kick zoom');
    zoomButton.title = zoomOn ? 'Kick zoom on: click to turn it off' : 'Kick zoom off: click to turn it on';
  };
  const sync = () => {
    if (musicOn && !document.hidden && ctx) start(); else stop();
    syncButtons();
  };
  document.addEventListener('visibilitychange', () => { sync(); syncSvgClock(); });
  // Autoplay on the first click or keypress (not one on the controls: their own handlers decide).
  const firstGesture = (e) => {
    if (ui && e.composedPath().includes(ui)) return;
    removeEventListener('pointerdown', firstGesture, true);
    removeEventListener('keydown', firstGesture, true);
    if (musicOn) return;
    musicOn = true;
    try { start(); } catch (err) { warn('music failed', err); musicOn = false; }
    sync();
  };
  addEventListener('pointerdown', firstGesture, true);
  addEventListener('keydown', firstGesture, true);
  const makeUi = () => {
    ui = document.createElement('div');
    ui.className = 'trif-rave-ui';
    ui.setAttribute('role', 'group');
    ui.setAttribute('aria-label', 'Rainbow Rave');
    zoomButton = document.createElement('button');
    zoomButton.type = 'button';
    zoomButton.className = 'trif-rave-zoom';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'trif-rave-play';
    // The site's own handlers never see clicks on the controls (a click inside a search form, say).
    for (const t of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) ui.addEventListener(t, (e) => e.stopPropagation());
    zoomButton.addEventListener('click', (e) => {
      e.preventDefault();
      zoomOn = !zoomOn;
      try { localStorage.setItem('trifRave.zoom', zoomOn ? 'on' : 'off'); } catch {}
      if (!zoomOn) stopBounce();
      syncButtons();
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      removeEventListener('pointerdown', firstGesture, true);
      removeEventListener('keydown', firstGesture, true);
      musicOn = !musicOn;
      try { if (musicOn) start(); } catch (err) { warn('music failed', err); musicOn = false; }
      sync();
    });
    ui.append(zoomButton, button);
    syncButtons();
  };
  addEventListener('resize', () => { try { placeControls(); } catch {} });
  function placeControls() {
    if (!document.body) return;
    if (!ui) makeUi();
    const placed = SITE.place(ui);
    if (placed) { ui.classList.remove('trif-rave-float'); ui.style.removeProperty('inset'); return; }
    // Fallback: floating in a corner, on <html> so nothing the page does to <body> carries it off.
    ui.classList.add('trif-rave-float');
    if (ui.parentNode !== document.documentElement) document.documentElement.append(ui);
    const at = (typeof SITE.corner === 'function' ? SITE.corner(ui) : SITE.corner) || 'auto 16px 16px auto';
    if (ui.style.inset !== at) ui.style.inset = at;
  }
})();
