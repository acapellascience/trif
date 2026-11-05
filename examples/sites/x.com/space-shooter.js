// ==WebMod==
// @name        X-Flyer
// @description blast the timeline!
// @match       https://x.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// Ported from timsrobot.com/shooter.js. Everything from the original is kept, including what only
// does something on timsrobot.com or with its other mods: the robot (shooting him, his health and
// colours, crashing into him, ROBOT DESTROYED and the ship's victory lap), the You Win screen (it needs
// every timsrobot.com mod on), Click Fireworks' celebration, the Tilt card's pinning. On X there's no
// robot yet, so those wait idle; blasting words, boxes and (with Gravity on) bombing pieces all work.
// What changed for X, each marked "X:" below:
// - It's off until you start it (Shift+S or the rocket button), and Shift+S again puts everything back.
//   On timsrobot.com the page is the game; on X the arrows, space and R are X's own keys the rest of the
//   time. While it's on, the game's keys don't reach X (R would open a reply, space would scroll).
// - X's text belongs to React. Wrapping words must leave React's own text nodes where they are (emptied,
//   as anchors), or React later removes a node that isn't there and X crashes. Stopping unwraps them.
// - X's hidden test elements directly in <body> (it computes request signatures from their styles)
//   are never touched: only #react-root and visible things in <body> get their words wrapped.
// - Rainbow Rave on X (its play/zoom buttons) counts as Rainbow Rave: rainbow flames, and rings on its kicks.

(() => {
  if (window.top !== window) return;
  const root = document.documentElement;
  let on = false; // X: is the game running (html[data-tss-on])

  const css = document.createElement('style');
  css.textContent = `
    [data-tss-dead] { visibility: hidden !important; } /* blasted words, bombed pieces, the destroyed robot */
    /* robot hit flash, on its parts: the <svg>'s own animation slot is Living robot's waddle and hop */
    svg.robot.tss-hurt > * { animation: tss-hurt 110ms ease-out; }
    @keyframes tss-hurt { from { filter: brightness(2.6) saturate(0.4); } to { filter: none; } }
    /* Living robot's legs follow the damage colour */
    svg.robot[data-tss-hp] .lr-legs line { stroke: var(--tss-robot-leg) !important; }
    svg.robot[data-tss-hp] .lr-legs ellipse { fill: var(--tss-robot-leg) !important; }
    #tss-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
    /* X: one control per line, in the empty space right of the timeline (--tss-hud-l, see placeHud);
       placed from the top, not with bottom: see pin() */
    #tss-hud { position: fixed; left: var(--tss-hud-l, 12px); top: 72px; max-width: var(--tss-hud-w, 220px); white-space: pre-line; z-index: 2147483647; pointer-events: none;
      text-align: var(--tss-hud-align, left); transform: var(--tss-hud-shift, none);}
    /* (nowrap: placed at the strip's middle, the box only gets the room to the window's edge, and wrapped) */
    #tss-hud > div { white-space: nowrap; }
    /* X: the panel is three groups (title, controls, stats) spread down the strip from --tss-hud-top over
       --tss-hud-h (placeHud fits them to the window: the space between groups first, then the gaps inside
       them, --tss-gap, then the text size, --tss-fs) */
    #tss-hud .tss-g { display: flex; flex-direction: column; gap: var(--tss-gap, 12px); align-items: inherit; }
    #tss-hud .tss-g-lives { height: 26px; align-self: stretch; position: relative; }
    #tss-hud .tss-lives-cv { position: absolute; pointer-events: none; } /* (see drawLives) */
    #tss-glow, #tss-glow-z { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none;
      mix-blend-mode: plus-lighter; z-index: 2147483647; }
    #tss-glow { z-index: 2147483645; }
    html:not([data-tss-on]) :is(#tss-glow, #tss-glow-z), html:not([data-tss-rave]) :is(#tss-glow, #tss-glow-z) { display: none !important; } #tss-hud .tss-g-btns { height: var(--tss-btns-h, 40px); }
    /* X: the title: big, in the game's font, cyan into pink like the ship's glow and stripes */
    #tss-hud .tss-hud-title { font: 900 calc(var(--tss-fs, 12px) * 2.5)/1 ui-monospace, Menlo, monospace; letter-spacing: 0.02em; margin: 0;
      background: linear-gradient(90deg, #7ff, #ff6bf0); -webkit-background-clip: text; background-clip: text;
      color: transparent; -webkit-text-fill-color: transparent; text-shadow: none;
      filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.55)) drop-shadow(0 0 10px rgba(255, 0, 255, 0.35)); } /* the score sits well below the controls */
    #tss-hud .tss-hud-key { color: #7ff; text-shadow: 0 0 6px #0ff; }
    #tss-hud .tss-hud-what { color: #ff8cf4; text-shadow: 0 0 6px #f0f; }
    #tss-hud .tss-hud-stat { color: #ffd84a; text-shadow: 0 0 6px #fa0, 0 1px 2px rgba(0, 0, 0, 0.8); }
    #tss-hud {
      font: 600 var(--tss-fs, 12px)/1.4 ui-monospace, Menlo, monospace; color: #7ff; text-shadow: 0 0 6px #0ff; opacity: .85;
      display: flex; flex-direction: column; justify-content: space-between; align-items: var(--tss-hud-items, flex-start);
      top: var(--tss-hud-top, 72px); height: var(--tss-hud-h, auto); box-sizing: border-box; }
    /* X: the Home timeline, upside down (see "Timeline mode"): the list is mirrored about the middle of
       its part on screen, each post flipped back upright, and clipped to that part (what's mirrored in
       from off screen would otherwise land over the header). Not in Gravity mode: its pieces would fall up. */
    /* (each post is moved, not the list: X places posts by where the list is on screen, so a transform
       on the list made it draw posts far off screen, and the timeline went black) */
    html[data-tss-on]:not([data-gm-on]) [data-tss-tl] {
      clip-path: inset(var(--tss-tl-ct, 0px) 0 var(--tss-tl-cb, 0px) 0) !important;
    }
    html[data-tss-on]:not([data-gm-on]) [data-tss-tl] > [data-tss-y] { transform: translateY(var(--tss-y)) !important; }
    /* X: while playing, wide windows look like narrow ones: no right-hand sidebar (Live on X, trends, who
       to follow), so the timeline stands alone with the empty strip beside it for the HUD */
    html[data-tss-on] [data-testid=sidebarColumn] { display: none !important; }
    /* X: Rainbow Rave's play and zoom buttons step aside while playing (it keeps its music and beat pulse
       on meanwhile: see rainbow-rave.js) */
    html[data-tss-ready] .wm-rainbow-music { display: none !important; }
    /* X: with Rainbow Rave on (html[data-tss-rave]), the X-Flyer title goes rainbow like "You Win!" on
       timsrobot.com: each letter its own neon colour, red through to magenta across the word, with a thin
       white outline, a glow in its colour, and a rolling wave */
    html[data-tss-rave] #tss-hud .tss-hud-title { background: none; filter: none; -webkit-text-fill-color: initial; }
    html[data-tss-rave] #tss-hud .tss-tch { display: inline-block; color: hsl(var(--h) 95% 50%); -webkit-text-fill-color: hsl(var(--h) 95% 50%);
      -webkit-text-stroke: 3px rgba(255, 255, 255, 0.7); paint-order: stroke fill; /* (half of it shows, outside) */
      text-shadow: none !important; /* the glow is light, added on #tss-glow-z (see paintGlow) */
      animation: tss-wave 1.8s ease-in-out calc(var(--i) * 0.08s - 3.6s) infinite; }
    @keyframes tss-wave { 0%, 100% { translate: 0 1.5px; } 50% { translate: 0 -2.5px; } }
    /* (and the rest of the panel's text white, with a dark edge: readable over the rainbow) */
    html[data-tss-rave] #tss-hud { opacity: 1; }
    html[data-tss-rave] #tss-hud :is(.tss-hud-key, .tss-hud-what, .tss-hud-stat) { color: #fff; -webkit-text-fill-color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.45); }
    /* X: nothing of the game shows while it's off */
    html:not([data-tss-on]) :is(#tss-canvas, #tss-hud, #tss-banner) { display: none !important; }
    /* X: the start/stop button, in the style of Rainbow Rave's buttons (left of them) */
    .tss-toggle { position: fixed; right: 112px; bottom: 16px; z-index: 2147483647; width: 40px; height: 40px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.6) !important; background-color: rgba(0,0,0,0.5) !important;
      padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .tss-toggle svg { width: 20px; height: 20px; fill: #fff; display: block; }
    .tss-toggle[aria-pressed=true] { box-shadow: 0 0 10px #0ff, 0 0 2px #7ff inset; border-color: #7ff !important; }
    .tss-toggle[aria-pressed=true] svg { fill: #7ff; }
    /* X: music and sound switches, either side of the start/stop button (smaller; dimmed and struck through when off) */
    /* (the start button glows cyan whether or not a game's on) */
    /* (dimmer while no game's on) */
    .tss-toggle:not(.tss-ctl) { box-shadow: 0 0 5px rgba(0, 255, 255, 0.45), 0 0 2px rgba(119, 255, 255, 0.5) inset; border-color: rgba(119, 255, 255, 0.6) !important; }
    .tss-toggle:not(.tss-ctl) svg { fill: rgba(119, 255, 255, 0.75); filter: drop-shadow(0 0 2px rgba(0, 255, 255, 0.5)); }
    html[data-tss-on] .tss-toggle:not(.tss-ctl) { box-shadow: 0 0 10px #0ff, 0 0 2px #7ff inset; border-color: #7ff !important; }
    html[data-tss-on] .tss-toggle:not(.tss-ctl) svg { fill: #7ff; filter: drop-shadow(0 0 3px #0ff); }
    /* X: with Rainbow Rave on (its buttons are there, hidden), the rocket button's glow is a rainbow: a
       shadow can only be one colour, so a blurred rainbow disc spins behind it (::before), and a dark disc
       (::after) keeps the middle dark under the icon; both under the icon (z-index -1 in the button's own
       stacking context). Dimmer while the game is off, like the cyan one. */
    /* (the little music and sound buttons beside it too, while playing: a smaller glow) */
    html:has(.wm-rainbow-music) .tss-toggle { box-shadow: none; background-color: transparent !important;
      border-color: rgba(255, 255, 255, 0.85) !important; isolation: isolate; }
    html:has(.wm-rainbow-music) .tss-toggle::before,
    html:has(.wm-rainbow-music) .tss-toggle::after { content: ''; position: absolute; border-radius: 50%; z-index: -1; pointer-events: none; }
    html:has(.wm-rainbow-music) .tss-toggle::before { inset: -5px; filter: blur(5px); opacity: 0.55;
      background: conic-gradient(hsl(0 100% 60%), hsl(60 100% 60%), hsl(120 100% 60%), hsl(180 100% 60%),
        hsl(240 100% 60%), hsl(300 100% 60%), hsl(360 100% 60%));
      animation: tss-rave-spin 2.4s linear infinite; }
    html:has(.wm-rainbow-music) .tss-toggle::after { inset: 0; background: rgba(0, 0, 0, 0.55); }
    html:has(.wm-rainbow-music) .tss-toggle svg { fill: #fff; filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.6)); }
    html[data-tss-on]:has(.wm-rainbow-music) .tss-toggle::before { inset: -8px; filter: blur(7px); opacity: 1; }
    html[data-tss-on]:has(.wm-rainbow-music) .tss-toggle.tss-ctl::before { inset: -5px; filter: blur(4px); }
    @keyframes tss-rave-spin { to { rotate: 360deg; } }
    .tss-toggle.tss-ctl { width: 26px; height: 26px; bottom: 23px; }
    .tss-toggle.tss-ctl svg { width: 13px; height: 13px; fill: #fff; }
    .tss-toggle.tss-ctl[aria-pressed=false] { opacity: 0.55; }
    .tss-toggle.tss-music { right: 160px; } .tss-toggle.tss-sound { right: 70px; } /* (until placed in the strip) */
    html:not([data-tss-on]) .tss-toggle.tss-ctl { display: none !important; } /* (only while playing) */
    /* "ROBOT DESTROYED": outside <body>, so Gravity mode leaves it hanging; its words are targets */
    #tss-banner { position: fixed; left: 50vw; top: 50vh; transform: translate(-50%, -50%); z-index: 2147483645;
      pointer-events: none; white-space: nowrap; }
    #tss-banner .tss-bn { display: inline-block; font: 900 clamp(40px, 9vw, 120px)/1 ui-monospace, Menlo, monospace;
      letter-spacing: .06em; color: #7ff; text-shadow: 0 0 12px #0ff, 0 0 42px #08f;
      animation: tss-bn-in 900ms ease-out both, tss-bn-flicker 1.7s 900ms infinite; }
    #tss-banner .tss-gap { display: inline-block; width: .6em; }

    /* You Win, in the hero around its buttons (see showWin) */
    .tss-win-faded { opacity: 0 !important; transition: opacity 0.9s ease !important; pointer-events: none !important; }
    /* everything arrives top to bottom: title 0.4 s, line under it 1.0 s, buttons (if they need putting
       back) 1.6 s, "play again?" 2.2 s, each drifting down a touch as it fades in */
    .tss-win-fadein { animation: tss-win-fadein 1.1s ease 1.6s both !important; }
    @keyframes tss-win-fadein { from { opacity: 0; translate: 0 -8px; } to { opacity: 1; translate: 0 0; } }
    /* zero-height holders, out of the flow so nothing on the page moves; full width (the hero centres its
       children, which would shrink them to nothing and wrap the text a word per line) */
    .tss-win-above, .tss-win-below { position: relative; height: 0; width: 100%; align-self: stretch; }
    .tss-win-head { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; white-space: nowrap; }
    .tss-win-again { white-space: nowrap; }
    .tss-win-head h1.tss-win-title { margin: 0 0 6px;
      /* a smooth fade in, no neon flicker (Rainbow Rave's glow follows the h1's opacity) */
      animation: tss-win-fadein 1.2s ease 0.4s both !important; } /* (!important: Rainbow Rave turns off h1 animations) */
    .tss-win-head .tss-win-sub { margin: 0; animation: tss-win-fadein 1.1s ease 1s both; }
    .tss-win-below { text-align: center; }
    /* (centred with margins, not transform: Jelly buttons' hover wobble animates transform, which would
       knock it sideways) */
    .tss-win-again { position: absolute; left: 0; right: 0; width: max-content; margin: 0 auto; top: 6px; background: none; border: 0;
      padding: 2px 6px; cursor: pointer; font: 500 12px system-ui, -apple-system, sans-serif; color: rgba(255, 255, 255, 0.65);
      text-decoration: none; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
    /* its fade-in is a class, dropped when done: Jelly buttons' hover wobble replaces the animation, and
       when the hover ended the fade (with its delay) would start over, so it vanished and came back */
    .tss-win-again.tss-win-again-in { animation: tss-win-fadein 1s ease 2.2s both !important; } /* (no wobble until it's in) */
    .tss-win-again:hover { color: #fff; }
    /* eased "play again?" (see playAgainEased) */
    /* a plain white card over everything */
    /* (oversized, and pinned to the window by pinCurtain: a "fixed" box on <html> can be placed against the
       page instead of the window, when another mod sets perspective or translate on <html>) */
    .tss-curtain { position: fixed; left: -40px; top: -40px; width: calc(100vw + 80px); height: calc(100vh + 80px); z-index: 2147483647; opacity: 0; background: #fff; pointer-events: none;
      transition: opacity .8s ease; }
    .tss-curtain.tss-curtain-on { opacity: 1; pointer-events: auto; }
    .tss-curtain:not(.tss-curtain-on) { transition-duration: 1s; }
    @keyframes tss-bn-in { 0% { opacity: 0; transform: scale(2.4); filter: blur(10px); } 30% { opacity: 1; }
      55% { transform: scale(.92); filter: none; } 75% { transform: scale(1.04); } 100% { transform: scale(1); } }
    @keyframes tss-bn-flicker { 0%, 46%, 56%, 100% { opacity: 1; } 50% { opacity: .55; } 53% { opacity: .2; } }
  `;
  document.head.append(css);

  // --- Turn every word on the page into a target: wrap it in <span class="tss-w">.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME', 'CODE', 'PRE']);
  // X: <body>'s children other than #react-root only if visible (see the top of the file)
  const visibleTop = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  // X: each wrapped text node stays in place, emptied, as an anchor for React; its words go in just before
  // it. If X writes new text into it (a count, a timestamp), the next pass re-wraps it.
  const groups = new Map(); // text node → { nodes: what went in before it, data: its text }
  const wrapWords = () => {
    const tops = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!/\S/.test(n.data)) return NodeFilter.FILTER_REJECT;
        let top = null;
        for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) {
          if (SKIP.has(el.tagName.toUpperCase()) || el.classList.contains('tss-w') || el.id === 'tss-hud' || el.isContentEditable) return NodeFilter.FILTER_REJECT;
          top = el;
        }
        if (!top) return NodeFilter.FILTER_REJECT;
        if (top.id !== 'react-root') {
          if (!tops.has(top)) tops.set(top, visibleTop(top));
          if (!tops.get(top)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      groups.get(node)?.nodes.forEach((n) => n.remove()); // X changed its text: out with the old words
      const made = [];
      for (const part of node.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { made.push(document.createTextNode(part)); continue; }
        const span = document.createElement('span');
        span.className = 'tss-w';
        span.textContent = part;
        made.push(span);
      }
      node.before(...made);
      groups.set(node, { nodes: made, data: node.data });
      node.data = '';
    }
    // X: words whose anchor X removed (it took that text away) go too
    for (const [node, g] of groups) if (!node.isConnected) { g.nodes.forEach((n) => n.remove()); groups.delete(node); }
  };
  const unwrapWords = () => {
    for (const [node, g] of groups) {
      g.nodes.forEach((n) => n.remove());
      if (node.data === '') node.data = g.data;
    }
    groups.clear();
  };
  // Other mods (and the site) may add text later: wrap it too, debounced. (X: only while the game is on.)
  let queued = false;
  const wordWatch = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; if (on) try { wrapWords(); } catch {} }, 300);
  });

  // --- Canvas and HUD
  const canvas = document.createElement('canvas');
  canvas.id = 'tss-canvas';
  let ctx = canvas.getContext('2d'); // (let: drawLives points it at the lives' own canvas for a moment)
  const hud = document.createElement('div');
  hud.id = 'tss-hud';
  // X: Rainbow Rave's additive glow (timsrobot.com's raveGlow): a CSS text-shadow or canvas shadow paints
  // plain colour, a smudge on the rainbow; these layers (mix-blend-mode: plus-lighter) ADD their light to
  // what's under them. #tss-glow, under the game canvas, for the end screens' letters; #tss-glow-z, over
  // the panel, for its title: Rainbow Rave pulses it with the panel (it's in its columns()), so it's drawn
  // as if unzoomed and the beat moves it on the same clock as the letters (see paintGlow).
  const glowCv = document.createElement('canvas'), glowZ = document.createElement('canvas');
  glowCv.id = 'tss-glow'; glowZ.id = 'tss-glow-z';
  const glowG = glowCv.getContext('2d'), glowZG = glowZ.getContext('2d');
  // On <html>, not <body>: tilt puts a transform on <body>, which would make these "fixed"
  // elements tilt and shrink with it (the ship then couldn't reach the bottom of the window).
  document.documentElement.append(glowCv, canvas, hud, glowZ);
  let W = 0, H = 0;
  const resize = () => {
    const dpr = devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  // tilt sets `perspective` on <html> (and the shake sets `translate`), which makes <html> the
  // containing block for "fixed" elements: they then scroll with the page. Nudge them back so the
  // canvas always covers the window exactly.
  let pinX = 0, pinY = 0;
  const pin = () => {
    const r = canvas.getBoundingClientRect();
    if (Math.abs(r.left) < 0.5 && Math.abs(r.top) < 0.5) return;
    pinX -= r.left; pinY -= r.top;
    canvas.style.translate = hud.style.translate = `${pinX}px ${pinY}px`;
    if (banner) banner.style.translate = canvas.style.translate;
  };

  // X: the music and sound switches (buttons beside the start/stop one), remembered in localStorage
  const prefs = { music: true, sfx: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('tssShooter.prefs') || '{}')); } catch {}
  const savePrefs = () => { try { localStorage.setItem('tssShooter.prefs', JSON.stringify(prefs)); } catch {} };
  // X: tells Rainbow Rave that X-Flyer is here (it hides its buttons and keeps its kick zoom on), and
  // whether the music switch is off (the rave's music follows it).
  const markMusic = () => document.documentElement.toggleAttribute('data-tss-music-off', !prefs.music);
  markMusic();
  document.documentElement.setAttribute('data-tss-ready', '');

  // --- Sound effects, synthesized with Web Audio (nothing is loaded). Browsers only allow sound after a
  // gesture, so the audio starts on your first real key press or click. (X: while the game is on.)
  const sfx = (() => {
    let ac = null, out = null, noise = null, verb = null, room = null, mid = null, half = null, sheen = null, shaper = null, lastSmall = 0;
    const wake = (e) => {
      // (X: or any event once the page has had a real click or key press: Chrome allows sound from then on)
      if (!(e.isTrusted || navigator.userActivation?.hasBeenActive) || !on) return;
      try {
        if (!ac) {
          ac = new AudioContext();
          const comp = ac.createDynamicsCompressor();
          out = ac.createGain(); out.gain.value = 0.55;
          // +6 dB (×2) after the compressor, to sit level with Rainbow Rave's music
          const boost = ac.createGain(); boost.gain.value = 2;
          out.connect(comp); comp.connect(boost); boost.connect(ac.destination);
          noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          // A big, dark reverb for the explosions (a made-up room: 3 s of decaying noise, smoothed so the tail
          // is a low roar, not a hiss). Explosions send some of their sound into it.
          const makeVerb = (sec, gain) => {
            const len = Math.round(ac.sampleRate * sec), ir = ac.createBuffer(2, len, ac.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
              const b = ir.getChannelData(ch);
              let lp = 0;
              for (let i = 0; i < len; i++) { lp += 0.08 * (Math.random() * 2 - 1 - lp); b[i] = lp * 3 * Math.pow(1 - i / len, 2.5); }
            }
            const conv = ac.createConvolver();
            conv.buffer = ir;
            const send = ac.createGain(); send.gain.value = gain;
            send.connect(conv); conv.connect(out);
            return send;
          };
          verb = makeVerb(3, 1);
          room = makeVerb(0.3, 1.4); // and a small room, for the word pops: a short tail
          mid = makeVerb(0.8, 1.2);  // and a middling one for bombs and boxes (the long one is the robot's)
          half = makeVerb(1.5, 1);   // and the fireworks' length, for the ship's explosion

          // Soft saturation: gives a low tone overtones a small speaker can play (a pure 50 Hz sine is
          // mostly inaudible on a laptop: what was left was the hiss, which is what sounded tinny).
          shaper = ac.createWaveShaper();
          const curve = new Float32Array(1024);
          for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3); }
          shaper.curve = curve;
          out.gain.value = prefs.sfx ? 0.55 : 0; // (the sound switch)
          window.trif?.log('sound on: audio', ac.state);
        }
        if (ac.state === 'suspended' && !document.hidden) ac.resume();
        if (on && musicWanted) musicStart(); // (the game asked for music before the audio could start)
      } catch (err) { window.trif?.warn('sound failed', String(err)); }
    };
    // X: the soundtrack, from the Space Shooter Music mod (window.trifShooterMusic: an Opus loop as base64).
    // Decoded once in the page and looped with Web Audio, so nothing is loaded from anywhere. Fades in when a
    // game starts, out when it stops; without that mod (switched off), the game is just quieter.
    // musicWanted: whether the game wants it playing (on from the start of a game, off at game over and
    // on quitting), so a key press can't bring it back when it shouldn't be on
    let music = null, musicBuf = null, musicLoading = null, musicWanted = false;
    const MUSIC_LEVEL = 0.35; // (35%)
    const musicStart = () => {
      musicWanted = true;
      if (!ac || music || musicLoading || !prefs.music) return;
      const m = window.trifShooterMusic;
      if (!m?.base64) return;
      // (the flag is cleared when this settles, after it's been set: once decoded, the body runs to the end
      // synchronously, and clearing it inside left it stuck on, so the music never started again)
      const job = (async () => {
        try {
          if (!musicBuf) {
            const bytes = Uint8Array.from(atob(m.base64), (c) => c.charCodeAt(0));
            musicBuf = await ac.decodeAudioData(bytes.buffer);
          }
          if (!on || music || !musicWanted || !prefs.music) return;
          const g = ac.createGain(), t = ac.currentTime;
          g.gain.value = 0; g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 0.1); // (a 100 ms fade in: no click)
          g.connect(ac.destination); // (straight out: not through the effects' compressor, which would pump it)
          const src = ac.createBufferSource();
          src.buffer = musicBuf; src.loop = true;
          src.loopStart = m.loopStart || 0; src.loopEnd = m.loopEnd || musicBuf.duration; // (skips the encoder's padding at the seam)
          src.connect(g); src.start(t);
          music = { src, g };
          window.trif?.log(`music: ${m.title || 'soundtrack'} playing`);
        } catch (err) { window.trif?.warn('music failed', String(err)); }
      })();
      musicLoading = job;
      job.finally(() => { if (musicLoading === job) musicLoading = null; });
    };
    const musicStop = (keepWanted = false) => {
      if (!keepWanted) musicWanted = false;
      if (!music) return;
      const { src, g } = music, t = ac.currentTime;
      music = null;
      try {
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        src.stop(t + 0.65);
      } catch {}
    };
    // Nothing plays in a background tab (the game's paused there anyway)
    document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      if (document.hidden) ac.suspend(); else if (on) ac.resume();
    });
    addEventListener('keydown', wake, true);
    addEventListener('pointerdown', wake, true);
    let warned = false;
    const run = (fn) => {
      if (ac && ac.state === 'running' && !document.hidden) {
        try { fn(ac.currentTime); } catch (err) { if (!warned) { warned = true; window.trif?.warn('sound effect failed', String(err)); } }
      }
    };
    const env = (t, peak, attack, decay, wet = 0, bus = verb) => { // a gain node that rises to peak, then dies away
      const g = ac.createGain();
      // Silent from the start: a new gain node is at full volume (1) until its first scheduled value
      // takes over, which can land a render block late (a loud snap at the start of a sound).
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(out);
      if (wet > 0 && bus) { const s = ac.createGain(); s.gain.value = wet; g.connect(s); s.connect(bus); }
      return g;
    };
    // "dmmm": a low tone sagging in pitch, saturated for body, then darkened
    const dmm = (t, f0, len, peak, wet, bus = verb, attack = 0.012) => {
      const o = ac.createOscillator(), pre = ac.createGain(), f = ac.createBiquadFilter();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + len);
      pre.gain.value = 1.6;
      f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.7;
      const s = ac.createWaveShaper(); s.curve = shaper.curve; // (one per sound: a node can't be shared mid-chain)
      o.connect(pre); pre.connect(s); s.connect(f);
      f.connect(env(t, peak, attack, len, wet, bus));
      o.start(t); o.stop(t + len + 0.1);
    };
    // filtered noise: the roar and rumble
    // (fall: how fast the highs roll off, in seconds; by default over the whole sound)
    const rumble = (t, from, to, len, peak, wet, attack = 0.01, fall = 0, bus = verb) => {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter();
      src.buffer = noise; src.loop = true;
      f.type = 'lowpass'; f.Q.value = 0.5;
      f.frequency.setValueAtTime(from, t);
      if (fall) f.frequency.setTargetAtTime(to, t, fall / 3);
      else f.frequency.exponentialRampToValueAtTime(to, t + len);
      src.connect(f); f.connect(env(t, peak, attack, len, wet, bus));
      src.start(t, Math.random()); src.stop(t + len + 0.1);
    };
    return {
      wake, // X: the start button and key wake the audio themselves (the game was off when they began)
      musicStart, musicStop, // X: the soundtrack (see musicStart)
      setSfx: (onOff) => { if (out && ac) out.gain.setTargetAtTime(onOff ? 0.55 : 0, ac.currentTime, 0.05); }, // X: the sound switch
      // pew: a bright square-wave zap sweeping down
      laser: () => run((t) => {
        const o = ac.createOscillator(), f = ac.createBiquadFilter();
        o.type = 'square';
        o.frequency.setValueAtTime(1500 + Math.random() * 200, t);
        o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
        f.type = 'lowpass'; f.frequency.value = 3200;
        o.connect(f); f.connect(env(t, 0.05, 0.004, 0.12));
        o.start(t); o.stop(t + 0.15);
      }),
      // a falling whistle as a bomb drops
      bombDrop: () => run((t) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(1700, t);
        o.frequency.exponentialRampToValueAtTime(450, t + 0.5);
        o.connect(env(t, 0.035, 0.02, 0.5));
        o.start(t); o.stop(t + 0.55);
      }),
      // fwwwsssshh: the ship's engines at full thrust as it shoots off the top. Noise through a band that
      // sweeps up (the jet rising away), swelling in and trailing off, over a low rumble of thrust.
      whoosh: () => run((t) => {
        const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
        g.gain.value = 0.0001; // (silent from the start: see env)
        src.buffer = noise; src.loop = true;
        bp.type = 'bandpass'; bp.Q.value = 1.2;
        // the ignition lingers low for a moment before the sweep takes off
        bp.frequency.setValueAtTime(350, t);
        bp.frequency.setValueAtTime(350, t + 0.35);
        bp.frequency.exponentialRampToValueAtTime(3200, t + 1.65);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.05);
        src.connect(bp); bp.connect(g); g.connect(out);
        const s = ac.createGain(); s.gain.value = 0.2; g.connect(s); s.connect(mid);
        src.start(t, Math.random()); src.stop(t + 2.15);
        rumble(t, 260, 90, 1.3, 0.12, 0, 0.3);
      }),
      // the ship blowing up: the Click Fireworks boom (the robot's recipe, lower and bigger than the bombs'):
      // a crack, a deep "dmmm" around 50 Hz with a fifth above, a roar whose highs roll off fast, three
      // aftershocks close together, and a low rolling rumble, in a 1.5 s reverb
      shipBoom: () => run((t) => {
        const f0 = 46 + Math.random() * 8, len = 1.2;
        dmm(t, f0, len, 0.45, 0.45, half);
        dmm(t, f0 * 1.5, len * 0.6, 0.12, 0.2, half);
        rumble(t, 1100, 50, len, 0.24, 0.3, 0.01, 0.3, half);     // the roar
        rumble(t, 2000, 200, 0.12, 0.2, 0.3, 0.003, 0.05, half);  // the crack
        rumble(t, 220, 35, 1.6, 0.18, 0.6, 0.12, 0, half);        // the low rolling rumble
        [[0.14, 0.55], [0.35, 0.35], [0.62, 0.2]].forEach(([dt, k], i) => { // aftershocks
          dmm(t + dt, f0 * (0.9 - i * 0.08), len * 0.6, 0.35 * k + 0.05, 0.6, half);
          rumble(t + dt, 320, 40, len * 0.6, 0.12 * k + 0.02, 0.6, 0.03, 0.2, half);
        });
      }),
      // You Win: a shimmering wash of high white noise, 3.5 s, fading in as the win appears and out.
      // Two layers, each two unrelated noise streams (one per ear: wide): a wash above ~6 kHz with a gentle
      // flutter (7 and 11 a second), and a sparkle above ~10 kHz with a faster, deeper one (17 and 23 a
      // second): that's the shimmer in the highs. Both go into a bright reverb of their own (the long one is
      // dark, built for booms: hiss barely shows in it).
      winShimmer: () => run((t) => {
        const IN = 0.9, HOLD = 0.8, OUT = 1.8, END = IN + HOLD + OUT, LEVEL = 0.02;
        if (!sheen) { // bright 2.5 s reverb: plain decaying noise, not smoothed
          const len = Math.round(ac.sampleRate * 2.5), ir = ac.createBuffer(2, len, ac.sampleRate);
          for (let ch = 0; ch < 2; ch++) {
            const b = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
          }
          const conv = ac.createConvolver(); conv.buffer = ir;
          sheen = ac.createGain(); sheen.connect(conv); conv.connect(out);
        }
        const g = ac.createGain();
        g.gain.value = 0; // (silent from the start: see env)
        const srcs = [], at = Math.random();
        const layer = (cutoff, level, flutters) => {
          const merge = ac.createChannelMerger(2), trem = ac.createGain();
          for (const ch of [0, 1]) {
            const src = ac.createBufferSource(), f = ac.createBiquadFilter();
            src.buffer = noise; src.loop = true;
            f.type = 'highpass'; f.frequency.value = cutoff;
            src.connect(f); f.connect(merge, 0, ch);
            srcs.push(src);
          }
          const depthSum = flutters.reduce((a, [, d]) => a + d, 0);
          trem.gain.value = level * (1 - depthSum); // the flutter swings it between about (1 − 2·depth) and full
          for (const [rate, depth] of flutters) {
            const lfo = ac.createOscillator(), d = ac.createGain();
            lfo.frequency.value = rate; d.gain.value = level * depth;
            lfo.connect(d); d.connect(trem.gain);
            lfo.start(t); lfo.stop(t + END + 0.1);
          }
          merge.connect(trem); trem.connect(g);
        };
        layer(6000, 1, [[7, 0.15], [11, 0.1]]);    // the wash
        layer(10000, 1.2, [[17, 0.3], [23, 0.2]]); // the sparkle
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(LEVEL, t + IN);
        g.gain.setValueAtTime(LEVEL, t + IN + HOLD);
        g.gain.linearRampToValueAtTime(0, t + END);
        g.connect(out);
        const s = ac.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(sheen);
        srcs.forEach((src, i) => { src.start(t, (at + i * 0.45) % 2); src.stop(t + END + 0.1); });
      }),
      // X: a 1-up picked up: a quick rising arpeggio (C E G C), square-wave like an old console
      oneUp: () => run((t) => {
        [523, 659, 784, 1047].forEach((f0, i) => {
          const d = t + i * 0.07, o = ac.createOscillator(), f = ac.createBiquadFilter();
          o.type = 'square'; o.frequency.value = f0;
          f.type = 'lowpass'; f.frequency.value = 3200;
          o.connect(f); f.connect(env(d, 0.045, 0.004, i === 3 ? 0.3 : 0.11, 0.15, room));
          o.start(d); o.stop(d + (i === 3 ? 0.35 : 0.15));
        });
      }),
      // a clank when a laser hits the robot without finishing him
      clank: () => run((t) => {
        const o = ac.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(620, t);
        o.frequency.exponentialRampToValueAtTime(280, t + 0.08);
        o.connect(env(t, 0.06, 0.002, 0.09));
        o.start(t); o.stop(t + 0.12);
      }),
      // An explosion, built on a deep "dmmm" (see dmm) with a dark roar of noise, and some of it sent into the
      // reverb. size: 0.15 for a word (just the dmmm and a puff), about 0.5–0.9 for boxes, bombs and the
      // ship, 1.5 for the robot. Small ones are rate-limited, since a bomb can burst several words at once.
      boom: (size = 0.5) => run((t) => {
        if (size < 0.3) { if (t - lastSmall < 0.05) return; lastSmall = t; }
        if (size < 0.3) { // a word: a quick, deep thump, with a short room tail
          dmm(t, 92 + Math.random() * 10, 0.17, 0.36, 0.3, room, 0.004);
          rumble(t, 360, 60, 0.13, 0.07, 0, 0.003, 0.09); // the puff at the start
          return;
        }
        const big = size >= 1.2;
        const f0 = Math.max(42, 78 - size * 22);
        const len = big ? 0.5 + size * 0.7 : 0.35 + size * 0.4; // (bombs, boxes, the ship: tighter)
        const bus = big ? verb : mid;
        dmm(t, f0, len, 0.3 + size * 0.15, 0.25 + size * 0.15, bus);
        dmm(t, f0 * 1.5, len * 0.6, 0.12, 0.2, bus); // a fifth above, for weight
        // the roar (the robot's highs roll off fast, leaving the low end ringing)
        rumble(t, 500 + size * 300, 50, len, 0.14 + size * 0.1, 0.3, 0.01, big ? 0.3 : 0, bus);
        if (!big) rumble(t, 1400, 180, 0.16, 0.12 + size * 0.06, 0.2, 0.003, 0.1, bus); // the crack at the start
        if (big) { // the robot: a crack, then a shockwave that rolls on and reverberates
          rumble(t, 2000, 200, 0.12, 0.2, 0.3, 0.003, 0.05); // the crack
          rumble(t, 220, 35, 3.2, 0.2, 0.6, 0.25);            // a long, low rolling rumble swelling in
          [[0.28, 0.55], [0.7, 0.35], [1.25, 0.2]].forEach(([dt, k], i) => { // aftershocks, each deeper
            dmm(t + dt, f0 * (0.9 - i * 0.08), len * 0.9, 0.35 * k + 0.05, 0.6);
            rumble(t + dt, 320, 40, len, 0.12 * k + 0.02, 0.6, 0.03, 0.2);
          });
        }
      }),
    };
  })();

  // --- Game state
  const ship = { x: innerWidth / 2, y: innerHeight - 14, w: 102, h: 78 }; // y = bottom of the ship
  const keys = {};
  const lasers = [];
  const bits = []; // letters and sparks
  let lastShot = 0, score = 0, graphics = 0, lastInput = -1e9, presses = 0; // score: words blasted; graphics: photos, videos, cards, boxes // presses: fresh space presses since the last frame

  const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  addEventListener('keydown', (e) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    // X: Shift+S starts and stops the game; the rest only while it's on, and kept from X's own shortcuts
    if (e.key === 'S' && e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) { if (on) stopGame(); else startGame(e); }
      return;
    }
    if (!on) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault(); // no page scrolling, no pressing the focused button
      e.stopImmediatePropagation(); // X: (and not X's own arrow and space handling)
      if (e.key === ' ' && !e.repeat) presses++; // a fresh press (not the key repeating while held)
      keys[e.key] = true;
      lastInput = performance.now();
    } else if (e.key === 'x' || e.key === 'X') { // X: a bomb out the back (see dropRearBomb); X's own "x" (block) doesn't see it
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) dropRearBomb(performance.now());
      lastInput = performance.now();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault(); e.stopImmediatePropagation(); // X: R is X's "reply"
      if (winEl) playAgainEased(); else if (!againBusy) restoreAll();
    }
  }, true);
  const restoreAll = () => {
    removeBanner();
    chasers.length = 0; // X: the avatars go back in their circles (just below)
    // words and bombed pieces come back; the robot is rebuilt separately
    document.querySelectorAll('[data-tss-dead]:not(svg.robot)').forEach((w) => w.removeAttribute('data-tss-dead'));
    document.querySelectorAll('[data-tss-hits]').forEach(clearDamage); // X: damaged photos and cards heal
    // Living robot listens: a rebuilt robot goes back home
    dispatchEvent(new CustomEvent('tss-restore', { detail: { robotRebuilt: rebuildRobot() } }));
  };
  addEventListener('keyup', (e) => { keys[e.key] = false; }, true);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const fire = (now) => {
    lastShot = now;
    muzzle = 0.07;
    // X: from the X-Flyer's wingtip cannons (see CANNONS)
    lasers.push(...CANNONS.map(([mx, my]) => ({ x: ship.x + mx, y: ship.y + my - 34 })));
    sfx.laser();
  };

  // Screen shake: nudges <html> with the `translate` property, which no other mod here sets on <html>
  // and which stacks with any `transform` (tilt) instead of replacing it.
  // X: not <html>: a translate on <html> makes it the frame for "fixed" things, so X's left menu and the
  // start/stop button scrolled away with the page while it shook. Instead the main column shakes (the
  // timeline: nothing fixed in it) and the game's canvas is drawn shaken (shakeX/Y, see frame).
  let shake = 0, shakeX = 0, shakeY = 0, shaken = null;
  const applyShake = (dt) => {
    if (shake > 0.3) {
      shakeX = (Math.random() - 0.5) * 2 * shake; shakeY = (Math.random() - 0.5) * 2 * shake;
      shake *= Math.pow(0.0015, dt); // dies out in about a third of a second
    } else { shake = 0; shakeX = 0; shakeY = 0; }
    const col = document.querySelector('[data-testid=primaryColumn]');
    if (shaken && shaken !== col) shaken.style.translate = '';
    shaken = col;
    if (col) col.style.translate = shake ? `${shakeX.toFixed(1)}px ${shakeY.toFixed(1)}px` : '';
  };
  const rings = []; // shockwaves

  // Burst a word: each letter flies off with the word's own font and colour.
  const explode = (word) => {
    const cs = getComputedStyle(word);
    let color = cs.color;
    if (/rgba\(.*,\s*0\)$/.test(color) || color === 'transparent') color = '#fff'; // gradient/clip text
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = word.firstChild;
    const range = document.createRange();
    const r0 = word.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    if (text && text.nodeType === 3) {
      for (let i = 0; i < text.data.length; i++) {
        range.setStart(text, i); range.setEnd(text, i + 1);
        const r = range.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const a = Math.atan2(y - cy - 6, x - cx) + (Math.random() - 0.5) * 1.2;
        // X: (toned down: slower, shorter-lived, less spin, barely growing; was 300-800 px/s, 2.4-3.4 s, ×1.6-3.2)
        const sp = 120 + Math.random() * 200;
        bits.push({ ch: text.data[i], x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140,
          rot: 0, vr: (Math.random() - 0.5) * 8, life: 0.9 + Math.random() * 0.6, font, color,
          scale: 1, grow: 1.1 + Math.random() * 0.3 }); // letters swell a little as they fly
      }
    }
    const SPARK = ['#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f6d', '#ff6bf0'];
    for (let i = 0; i < 30; i++) { // X: (milder: 30 sparks, not 70; a smaller ring; a nudge, not a shake)
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 420;
      bits.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.5,
        spark: true, size: 2 + Math.random() * 4, color: SPARK[i % SPARK.length] });
    }
    const R = 40 + r0.width * 0.4;
    rings.push({ x: cx, y: cy, t: 0, R });
    shake = Math.min(shake + 2.5, 6);
    sfx.boom(0.15);
    word.setAttribute('data-tss-dead', '');
    score++;
    try { wakeAvatar(word); } catch (e) { window.trif?.warn('avatar wake failed', String(e)); } // X: its post's picture comes after you
  };

  // --- Crashing into the robot (the site's <svg class="robot">) blows the ship up; it respawns
  // at the bottom after a moment, blinking and untouchable for a bit. (No robot on X yet.)
  let deadUntil = 0, safeUntil = 0, deaths = 0;
  // X: lives (see blowUpShip and drawLives)
  const LIVES = 3;
  let lives = LIVES, lostLife = null, gameOverPending = false, diedAt = 0;
  // "YOU DIED", in the game's font, red, over the timeline while the last explosion rings out: it
  // flickers on hard for a moment (a few on/off flashes, popping slightly larger), then holds, and fades
  // out over the last half second before the game starts over.
  const drawDied = (now) => {
    if (!gameOverPending || !diedAt) return;
    const s = (now - diedAt) / 1000 - 0.35; // (a beat after the blast)
    if (s < 0) return;
    const left = (deadUntil - now) / 1000;
    let alpha = Math.min(1, left / 0.5);
    if (s < 0.45 && Math.floor(s / 0.075) % 2) alpha *= 0.12; // the flash-in
    const col = document.querySelector('[data-testid=primaryColumn]')?.getBoundingClientRect();
    const cx = col?.width ? col.left + col.width / 2 : W / 2;
    const size = Math.round(Math.min(72, (col?.width || W) / 7.5)) * (1 + Math.max(0, 0.45 - s) * 0.3);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    const font = `900 ${size}px ${WIN_FONT}`;
    ctx.font = font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (raveOn()) { // X: Rainbow Rave's look (see raveLetter), letter by letter, flashing white as it pops in
      const text = 'YOU DIED', total = ctx.measureText(text).width, flash = Math.max(0, 1 - s / 0.45);
      let x = cx - total / 2;
      [...text].forEach((ch, i) => {
        const w = ctx.measureText(ch).width;
        if (ch.trim()) {
          const y = H * 0.42 + raveBob(i, now);
          ctx.save(); ctx.translate(x + w / 2, y); raveLetter(ch, i, now, flash); ctx.restore();
          glowQueue.push([ch, font, size, x + w / 2, y, raveHue(i, now), Math.max(0, alpha), 0, 1]);
        }
        x += w;
      });
      ctx.restore();
      return;
    }
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText('YOU DIED', cx, H * 0.42);
    ctx.shadowColor = '#f00'; ctx.shadowBlur = 28;
    ctx.fillStyle = '#ff3b3b';
    ctx.fillText('YOU DIED', cx, H * 0.42);
    ctx.restore();
  };
  // X: the big one (the last life, and @elonmusk going down): timsrobot.com's robot explosion and its boom
  // (sfx.boom(1.5): the deep roar with aftershocks), scaled to fit X (shake kept moderate)
  const bigExplosion = (x, y, size) => {
    const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#e02626', '#ff6bf0'];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 1000;
      bits.push({ x: x + (Math.random() - 0.5) * size * 0.6, y: y + (Math.random() - 0.5) * size * 0.6,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 220, life: 0.8 + Math.random() * 1.6,
        spark: true, size: 2 + Math.random() * (i < 35 ? 14 : 6), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x, y, t: 0, R: 440, dur: 0.8 }, { x, y, t: 0.1, R: 300, dur: 0.7 }, { x, y, t: 0.2, R: 180, dur: 0.6 });
    shake = Math.min(shake + 16, 18);
    sfx.boom(1.5);
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x, y, radius: 300, power: 2200 } })); // (Gravity mode)
  };
  // Test hook: a `tss-test-die` event blows the ship up (as if hit), to check lives and game over.
  addEventListener('tss-test-die', () => { if (on && performance.now() >= deadUntil) blowUpShip(performance.now()); });
  const robotEl = () => document.querySelector('svg.robot');
  const robotRect = () => { // null when he's missing or destroyed
    const robot = robotEl();
    if (!robot || robot.hasAttribute('data-tss-dead')) return null;
    const r = robot.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  const touchesRobot = () => {
    const r = robotRect();
    if (!r) return false;
    // a slightly smaller box than the ship's drawing, so grazing a wingtip doesn't count
    const l = ship.x - ship.w * 0.35, rt = ship.x + ship.w * 0.35, t = ship.y - ship.h * 0.9, b = ship.y - ship.h * 0.1;
    return rt > r.left && l < r.right && b > r.top && t < r.bottom;
  };
  const blowUpShip = (now) => {
    const cx = ship.x, cy = ship.y - ship.h * 0.45;
    const COLORS = ['#ffffff', '#e8f6ff', '#7ff', '#0cf', '#ffd36b', '#ff9a3c', '#ff4f6d'];
    for (let i = 0; i < 90; i++) { // X: (milder)
      const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 600;
      bits.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: 0.5 + Math.random() * 1,
        spark: true, size: 2 + Math.random() * (i < 15 ? 10 : 5), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: cx, y: cy, t: 0, R: 150 }, { x: cx, y: cy, t: 0.1, R: 80 });
    shake = 10;
    lasers.length = 0;
    deadUntil = now + 1800;
    deaths++;
    // X: three lives (drawn over the buttons, see drawLives). Losing one blinks it away; the last one is
    // game over: the big explosion and boom, the music stops, every chaser goes, and once it's rung out
    // the game starts over (see the respawn in frame).
    lives = Math.max(0, lives - 1);
    lostLife = { index: lives, at: now };
    if (lives > 0) sfx.shipBoom();
    else {
      bigExplosion(cx, cy, 120);
      sfx.musicStop();
      chasers.length = 0;
      deadUntil = now + 4500; // (the big boom's aftershocks and reverb ring out for about 4.5 s)
      gameOverPending = true; diedAt = now; // (YOU DIED, see drawDied)
      root.setAttribute('data-tss-dying', ''); // (Rainbow Rave's music stops for it, until the restart)
      window.trif?.log('last life lost: game over');
    }
    // X: the avatars are thrown back by the blast (and drift until the ship's back)
    for (const c of chasers) {
      const dx = c.x - cx, dy = c.y - cy, d = Math.hypot(dx, dy) || 1;
      c.vx = dx / d * 500; c.vy = dy / d * 500;
    }
    // in Gravity mode the blast throws the pieces around it
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x: cx, y: cy, radius: 220, power: 1700 } }));
  };

  // --- Shooting the robot. His health lives here (so it works with or without Living robot): each hit
  // flashes him and slides his colour green → yellow → red; at 0 he blows up and hides until R.
  // `data-tss-hp` / `data-tss-dead` on the svg and the `tss-robot-hit` / `tss-restore` events let Living
  // robot react (speed up, get knocked back, freeze, go home).
  const ROBOT_HP = 100, DAMAGE = 2; // per laser hit: 50 hits destroy him
  let robotHp = ROBOT_HP;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // [outline light, outline dark, eye light, eye dark (= Living robot's legs)], in the order of the svg's <stop>s
  const PALETTES = [
    ['#44e0a8', '#1e9a6c', '#a7f3d0', '#2fc58d'], // green: the site's own colours
    ['#ffe14a', '#c9a400', '#fff3a8', '#f2c500'], // yellow
    ['#ff4f4f', '#b31212', '#ffb0b0', '#e02626'], // red
  ].map((p) => p.map(hex));
  const paintRobot = (robot) => {
    const t = 1 - robotHp / ROBOT_HP;
    const [a, z, f] = t < 0.5 ? [PALETTES[0], PALETTES[1], t * 2] : [PALETTES[1], PALETTES[2], (t - 0.5) * 2];
    const cols = a.map((c, i) => `rgb(${c.map((v, j) => Math.round(v + (z[i][j] - v) * f)).join(',')})`);
    const hurt = robotHp < ROBOT_HP;
    [...robot.querySelectorAll('defs stop')].slice(0, 4).forEach((s, i) => { s.style.stopColor = hurt ? cols[i] : ''; });
    robot.style.setProperty('--tss-robot-leg', cols[3]);
    if (hurt) robot.setAttribute('data-tss-hp', String(robotHp));
    else robot.removeAttribute('data-tss-hp');
  };
  // Test mode (address ends in #tss-test): any hit destroys him, to get to the end screens quickly.
  const testMode = () => location.hash.includes('tss-test');
  const hitRobot = (x, y, damage = DAMAGE) => {
    const robot = robotEl();
    if (robot && robotHp > 0) {
      robotHp = Math.max(0, robotHp - (testMode() ? ROBOT_HP : damage));
      paintRobot(robot);
      robot.classList.remove('tss-hurt');
      void robot.getBoundingClientRect(); // restart the flash
      robot.classList.add('tss-hurt');
      if (robotHp) sfx.clank(); // (the last hit gets the big boom instead)
      dispatchEvent(new CustomEvent('tss-robot-hit'));
      if (!robotHp) {
        const r = robot.getBoundingClientRect();
        robot.setAttribute('data-tss-dead', '');
        robot.classList.remove('tss-hurt');
        explodeRobot(r.left + r.width / 2, r.top + r.height / 2, r.width);
        setTimeout(() => { if (!robotHp) showBanner(); }, 900); // unless R already rebuilt him
        window.trif?.log('robot destroyed');
      }
    }
    const COLORS = ['#fff', '#7ff', '#ffd36b'];
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 120 + Math.random() * 380;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.35,
        spark: true, size: 2 + Math.random() * 3, color: COLORS[i % COLORS.length] });
    }
    shake = Math.min(shake + 1.5, 20);
  };
  // Test hook: in test mode, a `tss-test-kill` event destroys him outright (for scripted tests; bombing
  // him from below in Gravity mode can take a while)
  addEventListener('tss-test-kill', () => {
    if (!testMode()) return;
    const r = robotEl()?.getBoundingClientRect();
    if (r) hitRobot(r.left + r.width / 2, r.top + r.height / 2);
  });
  const rebuildRobot = () => { // → was there anything to rebuild?
    const robot = robotEl();
    if (!robot || robotHp === ROBOT_HP) return false;
    robotHp = ROBOT_HP;
    robot.removeAttribute('data-tss-dead');
    paintRobot(robot);
    return true;
  };
  // Rainbow Rave: timsrobot.com's (its gradient is in the robot svg), or X's (X: its play/zoom buttons)
  const raveOn = () => !!document.getElementById('trif-rave-robot') || !!document.querySelector('.wm-rainbow-music');
  function explodeRobot(x, y, size) { // the big one
    try {
      const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#e02626', '#ff6bf0'];
      for (let i = 0; i < 320; i++) {
        const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 1200;
        bits.push({ x: x + (Math.random() - 0.5) * size * 0.6, y: y + (Math.random() - 0.5) * size * 0.6,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 250, life: 0.8 + Math.random() * 1.8,
          spark: true, size: 2 + Math.random() * (i < 40 ? 16 : 7), color: COLORS[i % COLORS.length] });
      }
      // Rainbow Rave mod on: the parts cycle through the rainbow
      // and the blast is a huge rainbow nova with rainbow shockwaves
      const rave = raveOn();
      [...'⚙⚙⚙✦✦⚡⚡◆◆●', ...(rave ? '⚙⚙⚙⚙✦✦✦' : '')].forEach((ch, i) => { // flying robot parts
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 400 + Math.random() * 500;
        bits.push({ ch, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: 0, vr: (Math.random() - 0.5) * 18,
          life: 2.5 + Math.random(), font: 'bold 26px sans-serif', color: '#e02626', scale: 1, grow: 1.5 + Math.random(),
          hue: rave ? i * 37 : undefined });
      });
      if (rave) {
        for (const b of bits.slice(-320 - 17, -17)) b.hue = Math.random() * 360; // the sparks too
        rings.push({ x, y, t: 0, R: Math.max(W, H) * 0.9, nova: true, dur: 1.1 });
        for (let i = 0; i < 7; i++) rings.push({ x, y, t: i * 0.05, R: 260 + i * 70, hue: i * 51, dur: 0.8 });
      } else {
        rings.push({ x, y, t: 0, R: 520 }, { x, y, t: 0.1, R: 340 }, { x, y, t: 0.2, R: 200 });
      }
      shake = 34;
      sfx.boom(1.5); // the big one (with its own aftershocks)
      dispatchEvent(new CustomEvent('tss-blast', { detail: { x, y, radius: 320, power: 2300 } })); // Gravity mode: the big one
    } catch (err) { window.trif?.warn(String(err)); }
  }

  // --- Boxes (buttons, badges, the terminal window, the footer: anything with a visible background,
  // border or shadow that holds words). Their words shield them; once every word in a box is blasted
  // (and any box inside it is gone), lasers can blast the box itself, which counts as a word.
  // Outside Gravity mode only (there, bombs remove whole pieces). R brings them back like words.
  const hasVisibleBox = (el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor.match(/[\d.]+/g);
    if (cs.backgroundImage !== 'none' || (bg && (bg.length < 4 || +bg[3] > 0))) return true;
    if (cs.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && !/rgba\(.*,\s*0\)$|transparent/.test(cs[`border${s}Color`]));
  };
  let boxList = [], boxListAt = -1e9;
  const allBoxes = (now) => { // re-scanned at most once a second, and only while lasers are flying
    if (now - boxListAt > 1000) {
      boxListAt = now;
      boxList = [...document.body.querySelectorAll('*')].filter((el) => !/^(MAIN|SECTION|ARTICLE|HEADER|NAV)$/.test(el.tagName)
        && !el.matches('.tss-w, #tss-hud, #tss-canvas') && el.querySelector('.tss-w') && hasVisibleBox(el));
    }
    return boxList;
  };
  const hitBox = (x, y, now) => {
    const list = allBoxes(now);
    let best = null, bestArea = Infinity;
    for (const el of list) {
      if (el.closest('[data-tss-dead]') || !el.isConnected) continue;
      if (el.querySelector('.tss-w:not([data-tss-dead])')) continue; // still shielded by words
      if (list.some((b) => b !== el && el.contains(b) && !b.closest('[data-tss-dead]'))) continue; // a box inside is still there
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height < bestArea) { best = el; bestArea = r.width * r.height; }
    }
    return best;
  };
  const explodeBox = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let color = cs.backgroundColor;
    if (/rgba\(.*,\s*0\)$|transparent/.test(color)) color = cs.borderTopColor; // a bordered box
    const COLORS = [color, color, color, '#ffffff', '#ffd36b'];
    const n = Math.min(60, 20 + Math.round(r.width * r.height / 800)); // X: (milder)
    for (let i = 0; i < n; i++) { // shards from all over the box
      const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height;
      const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.8, sp = 150 + Math.random() * 400;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 0.5 + Math.random() * 0.9,
        spark: true, size: 3 + Math.random() * 6, color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: cx, y: cy, t: 0, R: 50 + Math.max(r.width, r.height) * 0.35 });
    shake = Math.min(shake + 4, 8);
    sfx.boom(0.45);
    el.setAttribute('data-tss-dead', '');
    graphics++; // X: boxes count as graphics, apart from words
  };

  // --- X: photos, videos and link cards are armoured: each laser hit makes one redder (and flash), and
  // the tenth blows it up (shards, a boom, and it's gone until R). The outermost of them is the target (a
  // link card's own picture is part of the card). Their damage lives in data-tss-dmg (0 to 1), for the CSS.
  const MEDIA = '[data-testid=tweetPhoto], [data-testid=videoPlayer], [data-testid="card.wrapper"]';
  const MEDIA_HP = 20;
  css.textContent += `
    [data-tss-dmg] { filter: sepia(calc(var(--tss-dmg) * 0.9)) saturate(calc(1 + var(--tss-dmg) * 5))
      hue-rotate(calc(var(--tss-dmg) * -45deg)) brightness(calc(1 - var(--tss-dmg) * 0.15)) !important;
      box-shadow: 0 0 calc(var(--tss-dmg) * 24px) rgba(255, 40, 40, calc(var(--tss-dmg) * 0.9)) !important; }
    [data-tss-dmg].tss-hit { animation: tss-media-hit 120ms ease-out; }
    @keyframes tss-media-hit { from { outline: 3px solid rgba(255, 255, 255, 0.9); outline-offset: -3px; } to { outline-color: transparent; } }
  `;
  const mediaAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      let m = el.closest?.(MEDIA);
      if (!m) continue;
      for (let up = m.parentElement?.closest(MEDIA); up; up = up.parentElement?.closest(MEDIA)) m = up; // the outermost
      return m.closest('[data-tss-dead]') ? null : m;
    }
    return null;
  };
  const hitMedia = (el, x, y) => {
    const hits = (parseInt(el.getAttribute('data-tss-hits'), 10) || 0) + 1;
    if (hits >= MEDIA_HP) { explodeMedia(el); return; }
    el.setAttribute('data-tss-hits', String(hits));
    el.setAttribute('data-tss-dmg', '');
    el.style.setProperty('--tss-dmg', (hits / MEDIA_HP).toFixed(2));
    el.classList.remove('tss-hit');
    void el.offsetWidth; // (restart the flash)
    el.classList.add('tss-hit');
    sfx.clank();
    const COLORS = ['#fff', '#ff4f4f', '#ffd36b'];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 120 + Math.random() * 380; // (sprayed back down at you)
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.35,
        spark: true, size: 2 + Math.random() * 3, color: COLORS[i % COLORS.length] });
    }
    shake = Math.min(shake + 0.5, 4);
  };
  const explodeMedia = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const COLORS = ['#ff2a2a', '#ff4f4f', '#b31212', '#ff9a3c', '#ffd36b', '#ffffff'];
    const n = Math.min(90, 30 + Math.round(r.width * r.height / 800)); // (milder)
    for (let i = 0; i < n; i++) { // shards from all over it
      const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height;
      const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.8, sp = 150 + Math.random() * 450;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 0.5 + Math.random() * 1,
        spark: true, size: 3 + Math.random() * 7, color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: cx, y: cy, t: 0, R: 60 + Math.max(r.width, r.height) * 0.4 }, { x: cx, y: cy, t: 0.1, R: 40 + Math.max(r.width, r.height) * 0.2 });
    shake = Math.min(shake + 6, 10);
    sfx.boom(0.8);
    el.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} }); // (a hidden video shouldn't keep talking)
    clearDamage(el);
    // The rounded frame around a photo or video is a box around it, about its size: it goes too, or an
    // empty frame is left. (Only boxes no bigger than it, plus a border: not a grid of several photos.)
    let gone = el;
    for (let p = el.parentElement, i = 0; p && i < 8 && !p.matches('article'); p = p.parentElement, i++) {
      const q = p.getBoundingClientRect();
      if (q.width > r.width + 6 || q.height > r.height + 6) break;
      gone = p;
    }
    gone.setAttribute('data-tss-dead', '');
    graphics++; // (counted apart from words)
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x: cx, y: cy, radius: 200, power: 1600 } }));
  };
  const clearDamage = (el) => {
    el.removeAttribute('data-tss-hits'); el.removeAttribute('data-tss-dmg'); el.classList.remove('tss-hit');
    el.style.removeProperty('--tss-dmg');
  };

  // --- X: avatars come alive. Blast a word of a post and the profile picture of whoever wrote it (the
  // nearest one around that word: a quoted post's own author for its words) leaves its circle, grows
  // and chases the ship, like the robot on timsrobot.com. Touching it kills you; it takes 10 hits. Each
  // is drawn on the canvas from the picture X already loaded (nothing is fetched); its circle on the page
  // stays empty (data-tss-dead) until R.
  const AVATAR = '[data-testid=Tweet-User-Avatar]';
  const AVATAR_HP = 10, AVATAR_SIZE = 64, MAX_CHASERS = 8;
  const chasers = [];
  // avatars (and the boss) destroyed this game, by who they are to you (see relationOf), for the HUD
  const noKills = () => ({ mutual: 0, follower: 0, stranger: 0 });
  let kills = noKills();
  // @elonmusk is the final boss (see moveBoss): big, 180 hits, flying set patterns instead of chasing.
  const BOSS_SIZE = 190, BOSS_HP = 180;
  const ELON_AVATAR = `${AVATAR}:has([data-testid="UserAvatar-Container-elonmusk" i])`;
  let elonSweep = 0;
  let winMsg = null; // "You won the timeline! Play again?" once he's beaten (see startWinMessage)
  // Follower count: X doesn't show it on posts, but React holds the post behind the picture (a `tweet`
  // prop up the tree, with user.followers_count; the nearest one is the quoted post's for a quoted
  // author). Read only, nothing is fetched. Unknown: null.
  const userOf = (el) => {
    try {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key], i = 0; f && i < 60; f = f.return, i++) {
        const u = f.memoizedProps?.tweet?.user;
        if (u && typeof u === 'object') return u;
      }
    } catch {}
    return null;
  };
  const followersOf = (u) => (Number.isFinite(u?.followers_count) ? u.followers_count : null);
  // Who they are to you, from the same post data: followed_by = they follow you, following = you follow
  // them. Mutual: both. Follower: they follow you, you don't follow back. Stranger: they don't follow you
  // (whether or not you follow them), and anyone we can't tell.
  const relationOf = (u) => (u?.followed_by ? (u.following ? 'mutual' : 'follower') : 'stranger');
  // Size: 1K followers keeps the picture's own size on the page (base); every ×1000 in followers is ×3 in
  // size (1M: 3×, 1B: 9×), smaller accounts shrink (10 followers: about half). Between 14px and 200px.
  // Health follows size, so what looks big is tough: 10 hits at 40px (a post's picture at 1K followers),
  // growing a bit faster than the size (^1.25). So a quoted post's smaller picture is weaker for the same
  // followers (24px at 1K: 5 hits), and big accounts are hard: 112px (660K followers) about 36 hits, 200px
  // (the cap) 60. Between 2 and 60. Unknown followers: its own size.
  const sizeFor = (followers, base) => {
    let size = base;
    if (Number.isFinite(followers)) {
      const L = Math.log10(Math.max(10, followers));
      size = base * 3 ** ((L - 3) / 3);
    }
    size = Math.round(Math.max(14, Math.min(200, size)));
    return { size, hp: Math.round(Math.max(2, Math.min(60, AVATAR_HP * (size / 40) ** 1.25))) };
  };
  const wakeAvatar = (word) => {
    if (!word.closest('article') || winMsg) return;
    // The author of the post the word is in: the nearest picture around it that belongs to the same post.
    // A quoted post sits inside the quoting one (a [role=link] card) with its own picture, which is
    // nearer to the quoting post's words than the quoting author's own: a picture inside a quote card
    // only counts for words inside that same card.
    const quoteOf = (el, within) => { const q = el.closest('[role=link]'); return q && within.contains(q) ? q : null; };
    let av = null, p = word.parentElement;
    for (; p; p = p.parentElement) {
      av = [...p.querySelectorAll(AVATAR)].find((a) => { const q = quoteOf(a, p); return !q || q.contains(word); }) || null;
      if (av || p.matches('article')) break;
    }
    if (!av || av.closest('[data-tss-dead]')) return;
    const r = av.getBoundingClientRect();
    if (!r.width) return;
    const img = av.querySelector('img');
    // Their @handle (from the name line next to the picture) flies out of the post and sits over their
    // head: it's their health bar (see drawHealthBar). Its word on the page is hidden until R.
    // (The handle comes from the picture itself: X names its box UserAvatar-Container-<handle>, so it's
    // always the picture's owner, never the name line of a post around it.)
    const own = /^UserAvatar-Container-(\w{1,15})$/.exec(av.querySelector('[data-testid^="UserAvatar-Container-"]')?.dataset.testid || '');
    const handle = own ? `@${own[1]}` : '';
    const nameLine = handle && [...(p?.querySelectorAll('[data-testid=User-Name]') || [])]
      .find((n) => n.textContent.toLowerCase().includes(handle.toLowerCase()));
    const hw = nameLine && [...nameLine.querySelectorAll('.tss-w')].find((s) => s.textContent.toLowerCase() === handle.toLowerCase());
    let tag = { x: r.left + r.width / 2, y: r.top, font: '600 15px system-ui, sans-serif' };
    if (hw) {
      const hr = hw.getBoundingClientRect(), cs = getComputedStyle(hw);
      tag = { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2, font: `600 ${cs.fontSize} ${cs.fontFamily}` };
      hw.setAttribute('data-tss-dead', '');
    }
    // Size and health grow with the log of their follower count (see sizeFor).
    const isBoss = handle.toLowerCase() === '@elonmusk';
    if (isBoss && chasers.some((c) => c.boss)) { av.setAttribute('data-tss-dead', ''); return; } // (one Elon at a time: this one just vanishes)
    if (!isBoss && chasers.filter((c) => !c.boss).length >= MAX_CHASERS) return;
    const user = userOf(av), followers = followersOf(user), relation = relationOf(user);
    let { size, hp } = sizeFor(followers, r.width);
    if (isBoss) { size = BOSS_SIZE; hp = BOSS_HP; tag.font = tag.font.replace(/^\S+ \S+/, '800 26px'); }
    window.trif?.log(`${handle || 'avatar'} ${isBoss ? 'BOSS' : 'chasing'}: ${relation}, ${followers ?? '?'} followers, ${size}px, ${hp} hits`);
    av.setAttribute('data-tss-dead', '');
    // which post it came out of, and whether from a quoted post inside it (see leaderOf)
    const article = av.closest('article'), q = av.closest('[role=link]');
    const quoted = !!(q && article?.contains(q));
    chasers.push({ el: av, handle, tag, targetSize: size, maxHp: hp, boss: isBoss, relation, article, quoted, followers, img: img?.complete && img.naturalWidth ? img : null, x: r.left + r.width / 2, y: r.top + r.height / 2,
      vx: 0, vy: -120, size: r.width, born: performance.now(), hits: 0, flash: 0, phase: Math.random() * 6 });
    sfx.clank();
    if (isBoss) { sfx.boom(0.9); shake = Math.min(shake + 8, 12); }
  };
  // Who an avatar follows instead of chasing the ship itself. While @elonmusk is out, everyone else is his
  // escort (they circle him). Otherwise a quoted post's author follows the quoting post's author, once
  // that one's out too (it trails behind); until then, or on its own, it hunts you itself.
  const leaderOf = (c) => {
    if (c.boss) return null;
    const boss = chasers.find((o) => o.boss);
    if (boss) return boss;
    if (c.quoted && c.article) return chasers.find((o) => o !== c && !o.quoted && !o.boss && o.article === c.article) || null;
    return null;
  };
  // Following: escorts orbit the boss in a slowly turning ring (spread evenly, an outer ring past 8);
  // followers orbit their leader like moons (see below). Eased into place, never faster than 650 px/s, so a
  // follower that's far away flies over to join.
  const followLeader = (c, lead, now, dt) => {
    let tx, ty;
    if (lead.boss) {
      const ring = chasers.filter((o) => !o.boss), i = ring.indexOf(c), n = Math.min(8, ring.length);
      const layer = Math.floor(i / 8), k = i % 8;
      const R = lead.size / 2 + 34 + layer * 46 + c.size / 2;
      const a = (k / n) * Math.PI * 2 + now / 1000 * (layer ? -0.7 : 0.9);
      tx = lead.x + Math.cos(a) * R; ty = lead.y + Math.sin(a) * R;
    } else {
      // a moon round its leader: each follower on its own orbit (the next one further out, going the other
      // way), quick when close in, slower further out, and slightly oval so it swings in and out
      const moons = chasers.filter((o) => o !== lead && leaderOf(o) === lead), i = Math.max(0, moons.indexOf(c));
      const R = lead.size / 2 + c.size / 2 + 22 + i * (c.size + 16);
      const w = (i % 2 ? -1 : 1) * 2.6 * Math.sqrt(60 / Math.max(60, R)); // rad/s
      const a = now / 1000 * w + c.phase;
      tx = lead.x + Math.cos(a) * R; ty = lead.y + Math.sin(a) * R * 0.8;
    }
    const k = Math.min(1, dt * 8); // (tight enough to hold the orbit as the leader moves)
    let vx = (tx - c.x) * k / dt, vy = (ty - c.y) * k / dt;
    const v = Math.hypot(vx, vy);
    if (v > 650) { vx *= 650 / v; vy *= 650 / v; }
    c.vx = vx; c.vy = vy;
    c.heading = Math.atan2(vy, vx);
  };
  // Chasing: steer toward the ship (a little wobble, and a push away from each other), faster than the
  // ship can climb but slower than it can dodge sideways. While the ship is down, they drift.
  const moveChasers = (now, dt, shipLive) => {
    const tx = ship.x, ty = ship.y - ship.h * 0.45;
    for (const c of chasers) {
      const age = (now - c.born) / 1000;
      c.size += (c.targetSize - c.size) * Math.min(1, dt * (c.boss ? 1.2 : 3)); // grows as it comes out of its circle
      c.flash = Math.max(0, c.flash - dt);
      if (c.boss) { moveBoss(c, now, dt, age, shipLive); continue; }
      const lead = age > 0.5 ? leaderOf(c) : null; // (following someone: see leaderOf)
      if (lead) followLeader(c, lead, now, dt);
      else if (age > 0.5 && shipLive) { // (a moment to come out first)
        // Flown like a plane: a heading that can only turn so fast (TURN_RATE), at a steady speed, so each
        // one swings round in a wide arc (about speed / TURN_RATE ≈ 150px radius) and overshoots when you
        // dodge, instead of homing straight in. A slight wobble on the aim keeps them from flying as one.
        const speed = 190 + Math.min(80, age * 4);
        if (c.heading === undefined) c.heading = Math.atan2(c.vy, c.vx);
        const aim = Math.atan2(ty - c.y, tx - c.x) + Math.sin(now / 300 + c.phase) * 0.25;
        let turn = aim - c.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // (the short way round)
        const TURN_RATE = 1.4; // rad/s
        c.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn));
        // its actual velocity eases onto the heading (so the knock-back from your ship's blast fades out)
        c.vx += (Math.cos(c.heading) * speed - c.vx) * Math.min(1, dt * 3);
        c.vy += (Math.sin(c.heading) * speed - c.vy) * Math.min(1, dt * 3);
      } else {
        c.vx *= 1 - Math.min(1, dt * 1.5); c.vy *= 1 - Math.min(1, dt * 1.5);
        if (Math.hypot(c.vx, c.vy) > 20) c.heading = Math.atan2(c.vy, c.vx); // (drifting: it faces where it's going)
      }
      for (const o of chasers) { // (personal space)
        if (o === c) continue;
        const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy), min = (c.size + o.size) / 2;
        if (d > 0 && d < min) { c.x += dx / d * (min - d) / 2; c.y += dy / d * (min - d) / 2; }
      }
      c.x += c.vx * dt; c.y += c.vy * dt;
      const r = c.size / 2;
      c.x = Math.max(r, Math.min(W - r, c.x)); c.y = Math.max(r, Math.min(H - r, c.y));
    }
  };
  // --- The boss's moves. Pre-programmed patterns, one after another (each a few seconds): a figure-eight
  // across the top half, a wide orbit round the middle, a zigzag sweeping down the screen and back up,
  // and dives: he stops, flashes red with a line to where you are (0.7 s warning), charges through that
  // spot and past it, then climbs back up. His position eases along each path, so patterns blend.
  const BOSS_PATTERNS = [['eight', 6], ['dive', 6.6], ['orbit', 6], ['zigzag', 5], ['dive', 6.6], ['eight', 4], ['orbit', 5]];
  const moveBoss = (c, now, dt, age, shipLive) => {
    const t = age - 1.5; // (the first 1.5 s: rising to the top middle)
    let px = W / 2, py = H * 0.22, ease = 3;
    c.telegraph = null;
    if (t > 0) {
      const total = BOSS_PATTERNS.reduce((a, [, d]) => a + d, 0);
      let tt = t % total, i = 0;
      while (tt > BOSS_PATTERNS[i][1]) { tt -= BOSS_PATTERNS[i][1]; i++; }
      const [kind] = BOSS_PATTERNS[i];
      const m = Math.max(c.size / 2, 60); // (keep his whole circle on screen)
      if (kind === 'eight') {
        px = W / 2 + (W / 2 - m) * 0.9 * Math.sin(tt * 1.5);
        py = H * 0.3 + H * 0.16 * Math.sin(tt * 3);
        ease = 5;
      } else if (kind === 'orbit') {
        const R = Math.min(W, H) * (0.3 + 0.06 * Math.sin(tt * 2.3));
        px = W / 2 + R * Math.cos(tt * 2.1 + c.phase); py = H * 0.45 + R * 0.8 * Math.sin(tt * 2.1 + c.phase);
        ease = 5;
      } else if (kind === 'zigzag') {
        const tri = (u) => 1 - Math.abs((u % 2) - 1); // 0 → 1 → 0
        px = m + (W - 2 * m) * tri(tt / 0.8);
        py = H * 0.15 + H * 0.6 * tri(tt / 2.5);
        ease = 7;
      } else { // dive: three per pattern, 2.2 s each
        const k = tt % 2.2, idx = `${i}:${Math.floor(tt / 2.2)}`;
        if (c.diveIdx !== idx) { c.diveIdx = idx; c.diveTo = null; c.diveHome = null; } // (a new dive)
        if (k < 0.7) { // warning: hover, and mark where he's going
          if (!c.diveTo) c.diveTo = { x: ship.x, y: ship.y - ship.h * 0.45, fx: c.x, fy: c.y };
          px = c.x; py = c.y; ease = 0;
          c.telegraph = c.diveTo;
        } else if (k < 1.3) { // the charge: through the spot and a bit beyond
          const d = c.diveTo, u = (k - 0.7) / 0.6;
          px = d.fx + (d.x - d.fx) * u * 1.35; py = d.fy + (d.y - d.fy) * u * 1.35;
          ease = 14;
        } else { // climb back to the top, somewhere new
          if (!c.diveHome) c.diveHome = { x: m + Math.random() * (W - 2 * m), y: H * (0.12 + Math.random() * 0.15) };
          px = c.diveHome.x; py = c.diveHome.y; ease = 4;
        }
      }
    }
    if (!shipLive && t > 0) { px = W / 2; py = H * 0.2; ease = 2; } // (the ship's down: he backs off)
    if (ease) { c.x += (px - c.x) * Math.min(1, dt * ease); c.y += (py - c.y) * Math.min(1, dt * ease); }
    const r = c.size / 2;
    c.x = Math.max(r, Math.min(W - r, c.x)); c.y = Math.max(r, Math.min(H - r, c.y));
  };
  const chaserAt = (x, y) => chasers.find((c) => Math.hypot(x - c.x, y - c.y) < c.size / 2);
  const touchesChaser = () => {
    const sx = ship.x, sy = ship.y - ship.h * 0.45;
    return chasers.some((c) => Math.hypot(sx - c.x, sy - c.y) < c.size / 2 + 26);
  };
  const hitChaser = (c, x, y) => {
    c.hits++;
    c.flash = 0.1;
    if (c.hits >= c.maxHp) { killChaser(c); return; }
    sfx.clank();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 100 + Math.random() * 300;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.3,
        spark: true, size: 2 + Math.random() * 3, color: i % 2 ? '#fff' : '#ff4f4f' });
    }
  };
  const killChaser = (c) => {
    chasers.splice(chasers.indexOf(c), 1);
    // X: big accounts (from a post itself, not a quoted one) drop extra lives: 250K+ followers a 1UP,
    // over 1M a 3UP
    if (!c.boss && !c.quoted && c.followers >= 250000 && !winMsg) {
      const n = c.followers > 1000000 ? 3 : 1, a = Math.random() * Math.PI * 2;
      pickups.push({ x: c.x, y: c.y, born: performance.now(), n, kind: n === 3 ? 'bird' : 'butterfly',
        vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, heading: a, phase: Math.random() * 6 });
    }
    if (c.boss) { // the end: the big explosion and boom, the others go with him, then the win message
      bigExplosion(c.x, c.y, c.size);
      for (const o of [...chasers]) killChaser(o);
      for (let i = 0; i < 3; i++) setTimeout(() => { if (on) rings.push({ x: c.x + (Math.random() - 0.5) * 80, y: c.y + (Math.random() - 0.5) * 80, t: 0, R: c.size * (0.8 + i * 0.4) }); }, 250 + i * 250);
      setTimeout(() => { if (on && !winMsg) startEndMessage('win'); }, 1300);
      window.trif?.log('boss down');
    }
    const COLORS = ['#ff4f4f', '#ffd36b', '#ffffff', '#ff9a3c', '#ff6bf0'];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 450;
      bits.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0.5 + Math.random() * 0.9,
        spark: true, size: 2 + Math.random() * 7, color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: c.x, y: c.y, t: 0, R: c.size * 1.2 });
    shake = Math.min(shake + 5, 9);
    sfx.boom(0.6);
    kills[c.relation] = (kills[c.relation] || 0) + 1; // (its own counters, not "blasted")
  };
  const drawChasers = (now) => {
    for (const c of chasers) {
      const r = c.size / 2;
      if (c.telegraph) { // the boss's dive warning: a flashing red line to the spot, and a ring on it
        const on2 = Math.floor(now / 90) % 2;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 50, 50, ${on2 ? 0.85 : 0.35})`; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
        ctx.shadowColor = '#f00'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.telegraph.x, c.telegraph.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(c.telegraph.x, c.telegraph.y, 40, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // X: with Rainbow Rave on, the boss's glow is a rainbow instead: a blurred ring of every hue, spinning
      // round him (wider while he's about to dive), and his rim is the same rainbow, sharp
      const raveBoss = c.boss && raveOn();
      const bossRing = raveBoss ? ctx.createConicGradient(now / 300, c.x, c.y) : null;
      if (bossRing) {
        for (let h = 0; h <= 360; h += 30) bossRing.addColorStop(h / 360, `hsl(${h % 360}, 100%, 60%)`);
        ctx.save();
        ctx.filter = `blur(${c.telegraph ? 16 : 11}px)`;
        ctx.strokeStyle = bossRing; ctx.lineWidth = c.telegraph ? 30 : 20;
        ctx.globalAlpha = c.telegraph ? 1 : 0.85 + 0.15 * Math.sin(now / 140);
        ctx.beginPath(); ctx.arc(c.x, c.y, r + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      // a soft glow and a pulsing white rim (no damage colour: the health bar over its head shows that);
      // the boss glows red, harder while he's about to dive
      ctx.shadowColor = raveBoss ? 'transparent' : c.boss ? 'rgba(255, 40, 40, 0.9)' : 'rgba(255, 255, 255, 0.6)';
      ctx.shadowBlur = c.boss ? (c.telegraph ? 50 : 30) : 14;
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      if (c.img) { try { ctx.drawImage(c.img, c.x - r, c.y - r, c.size, c.size); } catch {} }
      if (c.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(c.x - r, c.y - r, c.size, c.size); }
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = bossRing || `rgba(255,255,255,${0.6 + 0.3 * Math.sin(now / 120 + c.phase)})`; ctx.lineWidth = bossRing ? 4 : 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      drawHealthBar(c, r);
    }
  };
  // Over each one's head: its @handle, which is its health bar. The letters themselves are the bar: the
  // left part (its health) is coloured, the rest grey. Full: all green. Hit: the colour goes through
  // yellow to red as it shrinks to the left, until only a red sliver is left at the start. It glows in
  // its colour. It flies there from the post when the avatar comes out (half a second).
  const drawHealthBar = (c, r) => {
    const health = Math.max(0.04, 1 - c.hits / c.maxHp); // (the last hit leaves a sliver: then it pops)
    const text = c.handle || '@?';
    ctx.save();
    ctx.font = c.tag.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    const k = Math.min(1, (performance.now() - c.born) / 500), e = 1 - Math.pow(1 - k, 3); // fly-out
    const x = c.tag.x + (c.x - c.tag.x) * e, y = c.tag.y + (c.y - r - 14 - c.tag.y) * e;
    const col = `hsl(${Math.round(120 * Math.min(1, (health - 0.04) / 0.96))}, 95%, 52%)`;
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, col); g.addColorStop(health, col);
    g.addColorStop(Math.min(1, health + 0.001), '#8b8f96'); g.addColorStop(1, '#8b8f96');
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'; // (a dark edge: readable over anything)
    ctx.strokeText(text, x, y);
    ctx.shadowColor = col; ctx.shadowBlur = 10; // the glow
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
    ctx.restore();
  };

  // --- The win: "You won the timeline!" and "Play again?" assemble in the middle of the screen, letter by
  // letter, each flying in from a word in a post (or the edge of the screen), in the game's own font (the
  // HUD's, like ROBOT DESTROYED on timsrobot.com). Once it's together, every letter is a target: shoot
  // them one by one, and when the last one goes, the ship fires its engines and flies off the top with
  // a whoosh (the victory lap from timsrobot.com), and the game starts over.
  // (A 'gameover' version is kept here but unused: game over just starts over once the boom rings out.)
  // (the win is just one line now: no "Play again?")
  const END_LINES = { win: ['YOU WON THE TIMELINE'], gameover: ['GAME OVER', 'Play again?'] };
  const WIN_FONT = 'ui-monospace, Menlo, monospace';
  let winLeaving = false; // (the victory lap is this win's: start over properly when it ends)
  const startEndMessage = (kind) => {
    const WIN_LINES = END_LINES[kind];
    const family = WIN_FONT;
    // Fitted to the timeline column (centred on it), so it doesn't run into the HUD beside it
    const colBox = document.querySelector('[data-testid=primaryColumn]')?.getBoundingClientRect();
    const areaL = colBox?.width ? colBox.left : 0, areaW = colBox?.width ? colBox.width : W, mid = areaL + areaW / 2;
    const sizes = [58, 40];
    ctx.font = `900 ${sizes[0]}px ${family}`;
    const fit = Math.min(1, (areaW - 48) / ctx.measureText(WIN_LINES[0]).width);
    sizes[0] = Math.round(sizes[0] * fit); sizes[1] = Math.round(sizes[1] * fit);
    // where letters come from: words still on screen, in posts
    const origins = [...document.querySelectorAll('article .tss-w:not([data-tss-dead])')].map((w) => w.getBoundingClientRect())
      .filter((r) => r.width && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W);
    const from = () => {
      if (origins.length && Math.random() < 0.8) { const r = origins[Math.floor(Math.random() * origins.length)]; return [r.left + Math.random() * r.width, r.top + r.height / 2]; }
      const side = Math.floor(Math.random() * 4); // (or off an edge)
      return side === 0 ? [Math.random() * W, -30] : side === 1 ? [W + 30, Math.random() * H] : side === 2 ? [Math.random() * W, H + 30] : [-30, Math.random() * H];
    };
    const letters = [];
    let y = H * 0.38, top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    WIN_LINES.forEach((line, li) => {
      const font = `900 ${sizes[li]}px ${family}`;
      ctx.font = font;
      const total = ctx.measureText(line).width;
      let x = mid - total / 2;
      for (const ch of line) {
        const w = ctx.measureText(ch).width;
        if (ch.trim()) {
          const [fx, fy] = from();
          letters.push({ ch, font, line: li, w, h: sizes[li], tx: x + w / 2, ty: y, fx, fy, delay: Math.random() * 0.9 + li * 0.6, dur: 0.9 + Math.random() * 0.5,
            spin: (Math.random() - 0.5) * 8, arc: -60 - Math.random() * 120 });
        }
        x += w;
      }
      left = Math.min(left, mid - total / 2); right = Math.max(right, mid + total / 2);
      top = Math.min(top, y - sizes[li] * 0.7); bottom = Math.max(bottom, y + sizes[li] * 0.7);
      y += sizes[li] * 1.5;
    });
    winMsg = { kind, letters, t0: performance.now(), box: { left: left - 10, right: right + 10, top: top - 10, bottom: bottom + 10 }, done: false };
    if (kind === 'win') sfx.winShimmer();
    window.trif?.log(kind === 'win' ? 'you won the timeline!' : 'game over');
  };
  // Test hook: a `tss-test-win` event shows the win message straight away (while the game is on), to
  // check the end screen without beating the boss.
  addEventListener('tss-test-win', () => { if (on && !winMsg) startEndMessage('win'); });
  const drawWinMessage = (now) => {
    if (!winMsg) return;
    const s = (now - winMsg.t0) / 1000;
    let all = true;
    const rave = raveOn();
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    winMsg.letters.forEach((l, i) => {
      if (l.dead) return;
      const k = Math.max(0, Math.min(1, (s - l.delay) / l.dur));
      if (k < 1) all = false;
      if (k <= 0) return;
      const e = 1 - Math.pow(1 - k, 3);
      const x = l.fx + (l.tx - l.fx) * e, y = l.fy + (l.ty - l.fy) * e + Math.sin(k * Math.PI) * l.arc;
      const rot = l.spin * (1 - e), sc = 0.5 + 0.5 * e, alpha = Math.min(1, k * 3);
      if (rave) { // (see raveLetter: a white flash as it lands, then the wave)
        const landed = s - l.delay - l.dur, flash = landed >= 0 ? Math.max(0, 1 - landed / 0.4) : 0.6;
        const by = y + (landed >= 0 ? raveBob(i, now) * Math.min(1, landed / 0.5) : 0);
        ctx.save();
        ctx.translate(x, by); ctx.rotate(rot); ctx.scale(sc, sc);
        ctx.font = l.font; ctx.globalAlpha = alpha;
        raveLetter(l.ch, i, now, flash);
        ctx.restore();
        glowQueue.push([l.ch, l.font, l.h, x + shakeX, by + shakeY, raveHue(i, now), alpha * (1 + flash), rot, sc]);
        return;
      }
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
      ctx.font = l.font;
      ctx.globalAlpha = alpha;
      // the game's colours: the first line cyan with a cyan glow (like ROBOT DESTROYED), "Play again?" in
      // the lasers' pink, pulsing once it's all there
      const pulse = winMsg.done ? 0.5 + 0.5 * Math.sin(now / 250) : 0;
      ctx.shadowColor = l.line ? '#f0f' : '#0ff'; ctx.shadowBlur = 16 + (l.line ? pulse * 14 : 0);
      ctx.fillStyle = l.line ? '#ff6bf0' : '#7ff';
      ctx.fillText(l.ch, 0, 0);
      ctx.restore();
    });
    ctx.restore();
    winMsg.done = all;
  };
  // A letter of it, in place, under this point (only once the whole message is together)
  const winLetterAt = (x, y) => winMsg?.done && !winLeaving
    ? winMsg.letters.find((l) => !l.dead && Math.abs(x - l.tx) < l.w / 2 + 4 && Math.abs(y - l.ty) < l.h / 2) : null;
  const shootWinLetter = (l) => { // it bursts (the letter itself tumbles off, like a blasted word's)
    l.dead = true;
    const color = raveOn() ? `hsl(${raveHue(winMsg.letters.indexOf(l), performance.now()) % 360}, 100%, 62%)` : l.line ? '#ff6bf0' : '#7ff';
    bits.push({ ch: l.ch, x: l.tx, y: l.ty, vx: (Math.random() - 0.5) * 300, vy: -150 - Math.random() * 150,
      rot: 0, vr: (Math.random() - 0.5) * 8, life: 1 + Math.random() * 0.5, font: l.font, color, scale: 1, grow: 1.2 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 300;
      bits.push({ x: l.tx, y: l.ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.3 + Math.random() * 0.5,
        spark: true, size: 2 + Math.random() * 4, color: i % 3 ? color : '#ffffff' });
    }
    rings.push({ x: l.tx, y: l.ty, t: 0, R: 30 + l.h * 0.5 });
    shake = Math.min(shake + 2, 6);
    sfx.boom(0.15);
    if (winMsg.kind === 'gameover' && winMsg.letters.every((m) => m.dead)) { // game over cleared: start over
      const msg = winMsg;
      setTimeout(() => { if (on && winMsg === msg) restartGame(); }, 700);
      return;
    }
    if (winMsg.letters.every((m) => m.dead)) { // the last one: the victory lap (see victory)
      winLeaving = true;
      leaving = performance.now() + 700; leaveV = 0; whooshed = false; resetAt = 0;
      lasers.length = 0;
      window.trif?.log('message cleared: flying off');
    }
  };

  // The "ROBOT DESTROYED" banner can't be hit until its letters have finished coming in (see showBanner).
  // X: @handles on posts can't be shot (they're the avatars' health bars, see wakeAvatar): shots pass through.
  const shielded = (w) => !!w.closest('#tss-banner:not([data-tss-ready])')
    || (w.textContent.startsWith('@') && !!w.closest('[data-testid=User-Name]'));
  const hitWord = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList?.contains('tss-w') && !el.hasAttribute('data-tss-dead') && !shielded(el)) return el;
    }
    // elementsFromPoint skips pointer-events:none text: fall back to rects
    for (const w of document.querySelectorAll('.tss-w:not([data-tss-dead])')) {
      if (shielded(w)) continue;
      const r = w.getBoundingClientRect();
      if (tl && (r.top < tlBand.top || r.bottom > tlBand.bottom) && tl.contains(w)) continue; // X: clipped away (Timeline mode)
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return w;
    }
    return null;
  };

  // --- Bombs, only while Gravity mode is on (html[data-gm-on]). space drops one from the ship's belly instead of
  // firing (only one in the air at a time); it
  // falls, and blows up on the first piece it touches (or the floor). The piece it hits is removed
  // (its words burst into letters; the piece itself is hidden with data-tss-dead, which Gravity mode
  // treats as gone, and R brings back). A direct hit on the robot does BOMB_DAMAGE instead. The blast
  // goes to Gravity mode as a `tss-blast` { x, y, radius, power } event, which flings the pieces
  // around it (Gravity mode owns their physics).
  const BOMB_DAMAGE = 5, BOMB_GRAVITY = 1800, BLAST_RADIUS = 170, BLAST_POWER = 1500;
  const bombs = [];
  const gravityOn = () => document.documentElement.hasAttribute('data-gm-on');
  const dropBomb = (now) => {
    // one bomb in the air at a time: the next can drop once the last has gone off (holding space drops
    // the next one the moment it does)
    if (bombs.length || now < deadUntil) return;
    const vx = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * 520 * 0.6; // carries some of the ship's motion
    const vy = 80 + ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * 420 * 0.5;
    bombs.push({ x: ship.x, y: ship.y - 18, vx, vy, born: now });
    sfx.bombDrop();
  };
  const pieceAt = (x, y) => { // a live Gravity mode piece under this point (not the robot)
    for (const el of document.querySelectorAll('[data-gm-body]:not([data-gm-ghost])')) {
      if (el.matches('svg.robot') || el.closest('[data-tss-dead]')) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  };
  // Words that aren't Gravity mode pieces (the tagline, which hangs in place) can be bombed one by one.
  const looseWordAt = (x, y) => {
    for (const w of document.querySelectorAll('.tss-w:not([data-tss-dead])')) {
      if (w.closest('[data-gm-body]') || shielded(w)) continue;
      const r = w.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return w;
    }
    return null;
  };
  const detonate = (x, y, piece, robotHit, word) => {
    if (word) explode(word);
    if (piece) {
      const words = (piece.matches('.tss-w') ? [piece] : [...piece.querySelectorAll('.tss-w:not([data-tss-dead])')]).filter((w) => !shielded(w));
      words.forEach((w, i) => {
        if (i < 6) explode(w); // letters fly (a few words' worth: a whole paragraph would be a blizzard)
        else { w.setAttribute('data-tss-dead', ''); score++; }
      });
      piece.setAttribute('data-tss-dead', '');
    }
    if (robotHit) hitRobot(x, y, BOMB_DAMAGE);
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x, y, radius: BLAST_RADIUS, power: BLAST_POWER } }));
    const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#ff6bf0'];
    for (let i = 0; i < 70; i++) { // X: (milder)
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 600;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: 0.4 + Math.random() * 0.7,
        spark: true, size: 2 + Math.random() * (i < 12 ? 9 : 5), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x, y, t: 0, R: BLAST_RADIUS * 0.8 }, { x, y, t: 0.1, R: BLAST_RADIUS * 0.45 });
    sfx.boom(0.7);
    shake = Math.min(shake + 5, 9);
  };
  const drawBomb = (b, now) => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(-b.vx, b.vy)); // nose (local +y) along its motion
    // bright silver, like the ship's fuselage, with the same cyan glow
    ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
    const fg = ctx.createLinearGradient(-8, 0, 8, 0);
    fg.addColorStop(0, '#8fa3c7'); fg.addColorStop(0.5, '#e3eefc'); fg.addColorStop(1, '#8fa3c7');
    ctx.fillStyle = fg; // tail fins
    ctx.beginPath(); ctx.moveTo(-8, -15); ctx.lineTo(8, -15); ctx.lineTo(4, -6); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(-2.5, -3, 1, 0, 0, 11);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#e3eefc'); g.addColorStop(1, '#8fa3c7');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff6bf0'; ctx.fillRect(-6.5, -3, 13, 2); // band
    if (Math.floor((now - b.born) / 120) % 2) { // blinking light
      ctx.fillStyle = '#ff3b5c'; ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 6, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };
  const updateBombs = (now, dt) => {
    if (!bombs.length) return;
    if (!gravityOn()) { bombs.length = 0; return; } // gravity switched off: they fizzle
    const rr = robotRect();
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.vy += BOMB_GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const sp = Math.hypot(b.vx, b.vy) || 1, tx = b.x + b.vx / sp * 10, ty = b.y + b.vy / sp * 10; // the nose
      const robotHit = !!rr && tx > rr.left + rr.width * 0.1 && tx < rr.right - rr.width * 0.1 && ty > rr.top && ty < rr.bottom;
      const piece = robotHit ? null : pieceAt(tx, ty);
      const word = robotHit || piece ? null : looseWordAt(tx, ty);
      if (robotHit || piece || word || ty >= H - 2) {
        bombs.splice(i, 1);
        detonate(tx, Math.min(ty, H - 2), piece, robotHit, word);
      } else if (b.x < -60 || b.x > W + 60) bombs.splice(i, 1);
      else drawBomb(b, now);
    }
  };

  // --- X: rear bombs (the X key). Dropped out of the back of the ship, they fall behind it (down the screen) and
  // go off on the first thing they touch (a word, a photo or card, an avatar), at the bottom of the
  // window, or after a short fuse. The blast destroys every word within REAR_RADIUS (the first few burst
  // into letters, the rest just go), does REAR_MEDIA_DMG hits to photos/videos/cards and REAR_FOE_DMG to
  // avatars in it. One every 0.4 s at most. While the end message is up, they only hit its letters.
  const REAR_RADIUS = 110, REAR_MEDIA_DMG = 8, REAR_FOE_DMG = 4, REAR_FUSE = 1.1, REAR_COOLDOWN = 400;
  const rearBombs = [];
  let lastRear = -1e9;
  const dropRearBomb = (now) => {
    if (!on || now < deadUntil || leaving || returning || now - lastRear < REAR_COOLDOWN) return;
    lastRear = now;
    const vx = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * 520 * 0.4; // (a little of the ship's sideways motion)
    rearBombs.push({ x: ship.x, y: ship.y + 4, vx, vy: 160, born: now });
    sfx.bombDrop();
  };
  const inBand = (r) => !tl || (r.bottom > tlBand.top && r.top < tlBand.bottom); // (not what Timeline mode clips away)
  const rearBlast = (x, y) => {
    const near = (r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) < REAR_RADIUS;
    if (winMsg) { // only the end message's letters
      if (winMsg.done && !winLeaving) for (const l of winMsg.letters) if (!l.dead && Math.hypot(l.tx - x, l.ty - y) < REAR_RADIUS) { shootWinLetter(l); if (winLeaving) break; }
    } else {
      let n = 0;
      for (const w of document.querySelectorAll('.tss-w:not([data-tss-dead])')) {
        if (shielded(w)) continue;
        const r = w.getBoundingClientRect();
        if (!r.width || !inBand(r) || !near(r)) continue;
        if (n++ < 6) explode(w); // (the first few burst into letters; a whole paragraph would be a blizzard)
        else { w.setAttribute('data-tss-dead', ''); score++; try { wakeAvatar(w); } catch {} }
      }
      const seen = new Set();
      for (const el of document.querySelectorAll(MEDIA)) {
        let m = el;
        for (let up = m.parentElement?.closest(MEDIA); up; up = up.parentElement?.closest(MEDIA)) m = up;
        if (seen.has(m) || m.closest('[data-tss-dead]')) continue;
        seen.add(m);
        const r = m.getBoundingClientRect();
        if (!r.width || !inBand(r) || !near(r)) continue;
        const hits = (parseInt(m.getAttribute('data-tss-hits'), 10) || 0) + REAR_MEDIA_DMG;
        if (hits >= MEDIA_HP) explodeMedia(m);
        else { m.setAttribute('data-tss-hits', String(hits - 1)); hitMedia(m, Math.max(r.left, Math.min(x, r.right)), Math.max(r.top, Math.min(y, r.bottom))); }
      }
      for (const c of [...chasers]) {
        if (Math.hypot(c.x - x, c.y - y) > REAR_RADIUS + c.size / 2) continue;
        c.hits += REAR_FOE_DMG - 1; hitChaser(c, c.x, c.y); // (hitChaser adds the last one, and kills if it's enough)
      }
    }
    const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#ff6bf0'];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 600;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: 0.4 + Math.random() * 0.7,
        spark: true, size: 2 + Math.random() * (i < 12 ? 9 : 5), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x, y, t: 0, R: REAR_RADIUS * 1.1 }, { x, y, t: 0.1, R: REAR_RADIUS * 0.6 });
    sfx.boom(0.7);
    shake = Math.min(shake + 5, 9);
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x, y, radius: REAR_RADIUS, power: BLAST_POWER } })); // (Gravity mode)
  };
  const updateRearBombs = (now, dt) => {
    for (let i = rearBombs.length - 1; i >= 0; i--) {
      const b = rearBombs[i];
      b.vy += 1100 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const tx = b.x, ty = b.y + 10; // the nose
      let hit = (now - b.born) / 1000 > REAR_FUSE || ty >= H - 2 || !!chaserAt(tx, ty);
      if (!hit && now - b.born > 120) { // (clear of the ship first)
        if (winMsg) hit = !!winLetterAt(tx, ty);
        else {
          for (const el of document.elementsFromPoint(tx, ty)) {
            if ((el.classList?.contains('tss-w') && !el.hasAttribute('data-tss-dead') && !shielded(el)) || el.closest?.(MEDIA)) {
              if (!el.closest('[data-tss-dead]') && inBand(el.getBoundingClientRect())) { hit = true; break; }
            }
          }
        }
      }
      if (hit) { rearBombs.splice(i, 1); rearBlast(tx, Math.min(ty, H - 2)); }
      else if (b.x < -60 || b.x > W + 60) rearBombs.splice(i, 1);
      else drawBomb(b, now);
    }
  };

  // --- Victory. When the robot is destroyed, "ROBOT DESTROYED" flashes up in the middle of the screen.
  // Each of its letters is a target like any word (lasers and bombs can blast them; it lives outside <body> so Gravity
  // mode leaves it hanging). Once they're all gone, the ship takes over: it fires its thrusters, flies off
  // the top of the screen, and the game resets itself (like R, plus the counters go back to zero), with
  // the ship flying back in from the bottom.
  let banner = null, leaving = 0, leaveV = 0, resetAt = 0, whooshed = false;
  const showBanner = () => {
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'tss-banner';
    const text = document.createElement('span');
    text.className = 'tss-bn';
    // every letter is its own target: you have to hit each one
    let n = 0;
    ['ROBOT', 'DESTROYED'].forEach((w, i) => {
      if (i) text.append(Object.assign(document.createElement('span'), { className: 'tss-gap' }));
      for (const ch of w) {
        const s = document.createElement('span');
        s.className = 'tss-w';
        s.textContent = ch;
        s.style.setProperty('--tss-i', String(n++)); // letter index, for themes (Rainbow Rave colours each one)
        text.append(s);
      }
    });
    banner.append(text);
    banner.style.translate = canvas.style.translate; // see pin()
    document.documentElement.append(banner);
    // Shots pass through it until every letter's entrance animation (ours, or a theme's like Rainbow
    // Rave's staggered spin-in) has finished; then it's fair game. Capped at 4 s in case one never ends.
    const b = banner;
    const ready = () => { if (banner === b) b.setAttribute('data-tss-ready', ''); };
    setTimeout(ready, 4000);
    requestAnimationFrame(() => { // after the styles (and so the animations) apply
      try {
        const intros = b.getAnimations({ subtree: true }).filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime));
        Promise.all(intros.map((a) => a.finished.catch(() => {}))).then(ready);
      } catch { ready(); }
    });
  };
  const removeBanner = () => { banner?.remove(); banner = null; };
  const victory = (now, dt) => { // → true while the ship is out of your hands
    if (!leaving && banner && !banner.querySelector('.tss-w:not([data-tss-dead])')) {
      leaving = now + 700; leaveV = 0; // a beat for the letters to fly, then go
      lasers.length = 0;
    }
    if (!leaving) return false;
    if (now > leaving && !whooshed) { whooshed = true; sfx.whoosh(); }
    if (now > leaving) { // full thrust, straight up, with a little wobble
      leaveV = Math.min(1600, leaveV + 1400 * dt);
      ship.y -= leaveV * dt;
      ship.x += Math.sin(now / 70) * 40 * dt;
    }
    if (ship.y < -ship.h - 60 && !resetAt) resetAt = now + 1600; // an empty screen for a moment, then reset
    if (resetAt && now > resetAt) {
      if (winLeaving) { winLeaving = false; restartGame(); return true; } // X: after the timeline's win: start over
      if (winEl) return true; // the You Win screen is up: wait for "play again?"
      if (allModsOn()) { showWin(); return true; }
      playAgain();
    }
    return true;
  };
  // "play again?" from the You Win screen, eased: the win fades out and the music fades (Rainbow Rave
  // hears `tss-again-out`), the window dims to black, everything resets behind the curtain, then the page
  // fades back in with the music starting from the top (`tss-again-in`) and the ship flying in.
  const AGAIN_OUT = 1400; // ms: music fade
  let againBusy = false;
  const playAgainEased = () => {
    if (againBusy) return;
    againBusy = true;
    const done = () => { againBusy = false; };
    try {
      dispatchEvent(new CustomEvent('tss-again-out', { detail: { ms: AGAIN_OUT } }));
      const curtain = document.createElement('div');
      curtain.className = 'tss-curtain';
      let cx = 0, cy = 0;
      const pinCurtain = () => { // keep its top-left 40px above and left of the window's, every frame
        if (!curtain.isConnected) return;
        const r = curtain.getBoundingClientRect();
        if (Math.abs(r.left + 40) > 0.5 || Math.abs(r.top + 40) > 0.5) {
          cx -= r.left + 40; cy -= r.top + 40;
          curtain.style.translate = `${cx}px ${cy}px`;
        }
        requestAnimationFrame(pinCurtain);
      };
      setTimeout(() => {
        document.documentElement.append(curtain);
        pinCurtain();
        curtain.getBoundingClientRect(); // (so the fade runs from 0)
        curtain.classList.add('tss-curtain-on');
      }, 300);
      setTimeout(() => {
        try { playAgain(); } catch (e) { window.trif?.warn('play again failed', String(e)); }
        safeUntil = performance.now() + 2600;
        setTimeout(() => {
          dispatchEvent(new CustomEvent('tss-again-in'));
          curtain.classList.remove('tss-curtain-on');
          setTimeout(() => { curtain.remove(); done(); }, 1100);
        }, 300); // a breath in the dark
      }, AGAIN_OUT + 100);
    } catch (e) { window.trif?.warn('play again failed', String(e)); done(); playAgain(); }
  };
  const playAgain = () => {
    // a fresh game starts from the normal layout: Gravity mode off (the page flies home)
    if (gravityOn()) dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    removeWin();
    restoreAll();
    score = 0; graphics = 0; deaths = 0; bombs.length = 0; rearBombs.length = 0; kills = noKills();
    lives = LIVES; lostLife = null; gameOverPending = false; pickups.length = 0; root.removeAttribute('data-tss-dying');
    leaving = 0; resetAt = 0; whooshed = false;
    // X: the exhaust trail goes too: kept, its last points (above the top, after the victory lap) joined the
    // new ones (below the bottom) in a streak right across the screen. (timsrobot.com hides this jump
    // behind its fade to black.)
    trail.length = 0;
    ship.x = W / 2; ship.y = H + ship.h; // flies back in from below
    deadUntil = 0; safeUntil = performance.now() + 1800;
    returning = true;
  };

  // --- You Win: only for beating the robot with every timsrobot.com mod on. Each leaves a mark on the
  // page; if one's switched off (or its mark changes), the game just resets as usual.
  // (X: these are timsrobot.com's mods, so on X the game always just resets, until they come over.)
  const MOD_MARKS = {
    'fireworks': 'canvas[data-fw-canvas]',
    'gravity': 'html[data-gm-ready]',
    'jelly': () => [...document.querySelectorAll('style')].some((s) => s.textContent.includes('jb-jelly')),
    'led': '.led-sign',
    'robot': 'svg.robot[data-lr]',
    'checklist': '[data-nc]',
    'neon': '.nt-word',
    'rave': '#trif-rave-robot',
    'shooter': '#tss-canvas',
    'stickers': '.sb-badge',
    'terminal': '[data-tb]',
    'tilt': 'style[data-tc]',
    'tagline': 'html[data-tt-ready], [data-tt-done]',
  };
  const modsOff = () => Object.entries(MOD_MARKS).filter(([, m]) => !(typeof m === 'function' ? m() : document.querySelector(m))).map(([n]) => n);
  const allModsOn = () => {
    const off = modsOff();
    if (off.length) window.trif?.log('no You Win screen: not on', off.join(', '));
    return !off.length;
  };
  // Understated, in the page itself, around the hero's own Get it / GitHub buttons (p.links): what's
  // left above them (title, tagline, badges) fades out to make room; "You Win!" lights up there in the
  // neon title's style (it's an <h1> in <main>, so Neon title's warm-up flicker and Rainbow Rave's
  // per-letter colours and glow apply to it), "Now go fix the internet." in the tagline's style, and a
  // small "play again?" under the buttons. Buttons that survived stay as they are; blasted ones fade
  // back in where they belong. Gravity mode is switched off first, so everything's back in place.
  let winEl = null; // { nodes: [...], faded: [...], revived: [...] } while the win is showing
  const HERO = 'main > section.hero';
  const showWin = () => {
    if (winEl) return;
    winEl = { nodes: [], faded: [], revived: [], pending: true };
    if (gravityOn()) { // gravity off first: the page flies home, then the win comes in
      dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      setTimeout(showWinNow, 900);
    } else showWinNow();
  };
  const showWinNow = () => {
    try {
      if (!winEl) return; // "play again" already
      winEl.pending = false;
      const hero = document.querySelector(HERO), links = hero?.querySelector(':scope > .links');
      if (!links) { window.trif?.warn('you win: no hero buttons found'); return; }
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
      // make room: fade out what's above the buttons
      for (const n of hero.querySelectorAll(':scope > h1, :scope > .tagline, :scope > .small')) {
        n.classList.add('tss-win-faded'); winEl.faded.push(n);
      }
      // the buttons: only one that's completely intact is left alone; anything blasted (the button, or
      // even one of its words) comes back, fading in
      const hurt = (a) => a.closest('[data-tss-dead]') || a.querySelector('[data-tss-dead]');
      links.removeAttribute('data-tss-dead');
      for (const a of links.querySelectorAll('a')) {
        if (!hurt(a)) continue;
        a.removeAttribute('data-tss-dead');
        a.querySelectorAll('[data-tss-dead]').forEach((n) => n.removeAttribute('data-tss-dead'));
        a.classList.add('tss-win-fadein'); winEl.revived.push(a);
        // then drop the class, so other animations (Jelly buttons' wobble on hover) work again
        a.addEventListener('animationend', function done(e) {
          if (e.animationName === 'tss-win-fadein') { a.classList.remove('tss-win-fadein'); a.removeEventListener('animationend', done); }
        });
      }
      // "You Win!" and the line under it, sitting just above the buttons (out of the flow, so nothing moves)
      const above = el('div', 'tss-win-above'), head = el('div', 'tss-win-head');
      const h1 = el('h1', 'tss-win-title nt-lit'); // lit from the start: Neon title's steady style, no warm-up
      let i = 0;
      const TEXT = 'You Win!', n = TEXT.replace(/\s/g, '').length;
      TEXT.split(' ').forEach((w, wi) => {
        if (wi) h1.append(' ');
        const word = el('span', 'nt-word');
        for (const ch of w) {
          const s = el('span', 'nt-ch', ch);
          s.style.setProperty('--nt-hue', String(Math.round(i * 300 / (n - 1)))); // red → magenta across the whole thing (Rainbow Rave)
          s.style.setProperty('--nt-i', String(i++)); // (the wave's timing)
          word.append(s);
        }
        h1.append(word);
      });
      const orig = hero.querySelector(':scope > h1');
      if (orig) h1.style.fontSize = `${parseFloat(getComputedStyle(orig).fontSize) * 1.3}px`;
      const sub = el('p', 'tss-win-sub', 'Now go fix the internet.');
      const tag = hero.querySelector(':scope > .tagline');
      if (tag) { const cs = getComputedStyle(tag); sub.style.font = cs.font; sub.style.color = cs.color; sub.style.textShadow = cs.textShadow; }
      head.append(h1, sub);
      above.append(head);
      links.before(above);
      // "play again?", just under the buttons
      const below = el('div', 'tss-win-below');
      const again = el('button', 'tss-win-again', 'play again?');
      again.type = 'button';
      again.classList.add('tss-win-again-in');
      again.addEventListener('animationend', function done(e) {
        if (e.animationName === 'tss-win-fadein') { again.classList.remove('tss-win-again-in'); again.removeEventListener('animationend', done); }
      });
      again.addEventListener('click', (e) => { e.stopPropagation(); playAgainEased(); });
      below.append(again);
      links.after(below);
      again.style.top = `${2 - (parseFloat(getComputedStyle(links).marginBottom) || 0)}px`; // tucked just under the buttons
      winEl.nodes.push(above, below);
      sfx.winShimmer();
      celebrate(h1);
      dispatchEvent(new CustomEvent('tss-win')); // (Rainbow Rave unlocks its music and zoom buttons as a prize)
      window.trif?.log('you win!');
    } catch (e) { window.trif?.warn('you win failed', String(e)); }
  };
  // Five fireworks in an arc over "You Win!" (the Click Fireworks mod launches them, if it's on): around
  // the upper half of a circle centred on the title, going off one after another from the outside in, the
  // top one last.
  const celebrate = (title) => {
    try {
      const r = title.getBoundingClientRect(), vw = innerWidth;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // an arc (half an ellipse) just clear of the title, kept inside the window: 70 px from the sides,
      // 50 px from the top
      const rx = Math.max(120, Math.min(r.width / 2 + 90, cx - 70, vw - cx - 70));
      const ry = Math.max(60, Math.min(rx * 0.75, cy - 50));
      // angles (degrees, 180 = left, 90 = straight up), in firing order, each with its delay in ms
      [[180, 300], [0, 1300], [135, 2300], [45, 3300], [90, 4300]].forEach(([deg, ms]) => { // a second apart
        const a = deg * Math.PI / 180;
        const x = cx + Math.cos(a) * rx, y = cy - Math.sin(a) * ry;
        setTimeout(() => { if (winEl) dispatchEvent(new CustomEvent('firework-launch', { detail: { x, y } })); }, ms);
      });
    } catch (e) { window.trif?.warn('celebration failed', String(e)); }
  };
  const removeWin = () => {
    if (!winEl) return;
    for (const n of winEl.nodes) n.remove();
    for (const n of winEl.faded) n.classList.remove('tss-win-faded');
    for (const n of winEl.revived) n.classList.remove('tss-win-fadein');
    winEl = null;
  };
  let returning = false; // after the reset: the ship rises back into view on its own
  const flyBackIn = (dt) => {
    if (!returning) return false;
    ship.y -= 380 * dt;
    if (ship.y <= H - 14) { ship.y = H - 14; returning = false; }
    return true;
  };

  // --- The ship. Drawn in ship-local pixels: origin at the bottom centre (ship.x, ship.y), nose at
  // y = -78, wings out to ±51. The gun pods sit at x = ±27 with their muzzles at y = -47, where fire()
  // spawns lasers. It banks when flying sideways and its engines flare when climbing.
  const trail = []; // per engine: recent nozzle positions, for the exhaust
  // Rainbow Rave rings: one per kick drum while its music plays (it sends `rave-kick`)
  const pulses = [];
  const kickRing = () => { // each ring stays where the ship was when it started
    if (pulses.length < 6) pulses.push({ t: 0, hue: (performance.now() / 4) % 360, x: ship.x, y: ship.y - ship.h * 0.45 });
  };
  addEventListener('rave-kick', kickRing);
  // X: X's Rainbow Rave announces each kick ahead of time, with when it'll be heard (performance.now() time)
  document.addEventListener('wm-rainbow-kick', (e) => {
    if (!on) return;
    const at = e.detail?.at;
    setTimeout(kickRing, Number.isFinite(at) ? Math.max(0, at - performance.now()) : 0);
  });
  let bank = 0, thrust = 0.5, muzzle = 0;
  const ENGINES = [-20, 20]; // (the two engine nacelles: where the exhaust trails come from)
  const drawShip = (now, dt, visible) => {
    const wantBank = leaving || returning ? 0 : (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const wantThrust = leaving && now > leaving ? 2.2 : returning ? 1 : keys.ArrowUp ? 1 : keys.ArrowDown ? 0.15 : 0.5; // 2.2: afterburners
    bank += (wantBank - bank) * Math.min(1, dt * 9);
    thrust += (wantThrust - thrust) * Math.min(1, dt * 7);
    muzzle = Math.max(0, muzzle - dt);

    // Rainbow Rave mod on: rainbow flames and exhaust, and with its
    // music playing, a glowing rainbow ring pulses out from where the ship is on every kick drum
    const rave = raveOn();
    const hueAt = (k) => ((now / 4 + k) % 360 + 360) % 360;
    if (!rave || !visible) pulses.length = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], cx = p.x, cy = p.y;
      p.t += dt / 0.6;
      if (p.t >= 1) { pulses.splice(i, 1); continue; }
      // races out wide and fades fast: most of its light is gone by halfway
      const e = 1 - Math.pow(1 - p.t, 3), r = 30 + e * 230, fade = Math.pow(1 - p.t, 2.2);
      for (let k = 0; k < 3; k++) { // three bands of the rainbow, each a soft halo plus a bright core
        const h = (p.hue + k * 50) % 360, rr = r + k * 5;
        ctx.shadowColor = `hsl(${h}, 100%, 60%)`;
        ctx.shadowBlur = 22;
        ctx.strokeStyle = `hsla(${h}, 100%, 60%, ${(fade * 0.35).toFixed(3)})`;
        ctx.lineWidth = 12 * fade + 3;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `hsla(${h}, 100%, 78%, ${(fade * 0.9).toFixed(3)})`;
        ctx.lineWidth = 2.5 * fade + 1;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();

    // exhaust: a short, wide ribbon per engine through the nozzle's recent positions in screen space
    // (so it swings out behind when the ship moves), blown downwards and tapering as it ages
    // (Rainbow Rave: about 2.5× as long, with a wide soft halo under the glow and core)
    const life = (0.08 + thrust * 0.1) * (rave ? 2.5 : 1);
    const PASSES = rave
      ? [[46, 58, 0.13], [24, 62, 0.32], [9, 82, 0.8]] // [width, lightness %, alpha]: halo, glow, core
      : [[20, '60,140,255', 0.4], [8, '200,245,255', 0.75]]; // [width, rgb, alpha]: glow, core
    ENGINES.forEach((ex, e) => {
      const pts = trail[e] || (trail[e] = []);
      for (const p of pts) { p.age += dt; p.y += (120 + thrust * 160) * dt; }
      while (pts.length && pts[0].age > life) pts.shift();
      if (visible) pts.push({ x: ship.x + ex * (1 - Math.abs(bank) * 0.18), y: ship.y - 2, age: 0 });
      else pts.length = 0;
      if (pts.length < 2) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'butt'; // round caps overlap at each joint and, drawn additively, look beaded
      for (const [w, c, a] of PASSES) {
        for (let i = 1; i < pts.length; i++) {
          const f = 1 - pts[i].age / life;
          ctx.strokeStyle = rave // the whole rainbow down the ribbon, rolling
            ? `hsla(${hueAt((pts[i].age / life) * 330 + e * 60)}, 100%, ${c}%, ${(a * f).toFixed(3)})`
            : `rgba(${c},${(a * f).toFixed(3)})`;
          ctx.lineWidth = w * (0.4 + 0.6 * f) * (0.7 + thrust * 0.5);
          ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
        }
      }
      ctx.restore();
    });
    if (!visible) return;

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(bank * 0.1);
    ctx.scale(1 - Math.abs(bank) * 0.18, 1); // banking: the wings foreshorten

    drawHull(now, bank, thrust, rave); // X: (the ship itself, see drawHull: also drawn tiny for the lives)

    // muzzle flashes
    if (muzzle > 0) drawMuzzle();
    ctx.restore();

    // shield bubble while it can't be hurt after respawning
    drawShield(now);
  };
  // X: the X-Flyer, in ship-local pixels (origin at its bottom centre, nose at y = -78), so the lives can be
  // drawn as tiny copies of it. Seen from above: a long, narrow fuselage with the cockpit set back, two
  // pairs of straight wings splayed into an X (the lower pair a little behind and darker, so the pairs read
  // as above and below), a long laser cannon on each wingtip (the lasers come from their muzzles, CANNONS),
  // and four engines at the wing roots, flaring with thrust. Pink stripes on the wings, cyan edge glow.
  // (That one was too close to a film's fighter: replaced by the X below, kept unused as drawWingHull.)
  //
  // The X-Flyer: the letter X seen from above, like X's own logo: two crossing beams, the "\" one thick
  // and the "/" one thin, with the cockpit in a round hub where they cross. The two front tips carry the
  // cannons (the lasers come from their muzzles, CANNONS); the two back tips are the engines, flaring with
  // thrust. Brushed-metal beams with a cyan edge glow, a pink stripe down the thick one.
  // (That was too literal too: kept unused as drawLetterHull.) The X-Flyer is now the original ship (the
  // rocket with two engine nacelles, a canopy and a racing stripe) with each wing split into two blades that
  // make a shallow X (see drawRocketHull's splitWings). Lasers come from the gun pods' muzzles (CANNONS).
  // Which ship flies: 'mirror' (the first ship with a mirrored copy of its wings behind them: an X),
  // 'original' (the first ship, as it came from timsrobot.com) or 'x' (wings tilted into a shallow X).
  // 'xflyer' is the finished design (drawXFlyerHull), drawn from scratch from the 'mirror' sketch.
  const SHIP_STYLE = 'xflyer';
  const CANNONS = SHIP_STYLE === 'xflyer' ? [[-30, -58], [30, -58]] : SHIP_STYLE === 'x' ? [[-23, -53], [23, -53]] : [[-27, -47], [27, -47]];
  const drawHull = (now, bank, thrust, rave) => SHIP_STYLE === 'xflyer' ? drawXFlyerHull(now, bank, thrust, rave)
    : drawRocketHull(now, bank, thrust, rave, SHIP_STYLE === 'mirror' ? 'mirror' : SHIP_STYLE === 'x');
  // The X-Flyer, designed whole. The first ship's body (the rocket fuselage, canopy, racing stripe and two
  // engine nacelles with their flames), with two wings a side that meet at one root on the nacelle and
  // part into an X: a back wing sweeping down and out (the first ship's broad wing, lit, its leading edge
  // glowing cyan, a pink band near the tip and the blinking red/green tip light) and a front wing sweeping
  // up and out, set a level below it (in shadow, a cyan running light on its tip), carrying the gun pod
  // and its barrel forward (muzzles at CANNONS). Each wing is a tapered panel: its chord (root→tip) shrinks
  // from the root to the tip, edges straight, so the two pairs read as one clean X.
  const XF = {
    back: { root: [12, -27], tip: [52, -9], rc: 22, tc: 9 },
    front: { root: [12, -31], tip: [50, -50], rc: 18, tc: 8 },
    pod: 30, // gun pod's x, on the front wing
  };
  const wingPath = (s, w) => {
    const [rx, ry] = w.root, [tx, ty] = w.tip;
    ctx.beginPath();
    ctx.moveTo(s * rx, ry - w.rc / 2); ctx.lineTo(s * tx, ty - w.tc / 2); // leading edge
    ctx.lineTo(s * tx, ty + w.tc / 2); ctx.lineTo(s * rx, ry + w.rc / 2); // tip, trailing edge
    ctx.closePath();
  };
  const alongWing = (w, x) => { const t = (x - w.root[0]) / (w.tip[0] - w.root[0]); return w.root[1] + (w.tip[1] - w.root[1]) * t; };
  const drawXFlyerHull = (now, bank, thrust, rave) => {
    const hueAt = (k) => ((now / 4 + k) % 360 + 360) % 360;
    // engine flames (the first ship's)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ex of ENGINES) {
      const len = (16 + thrust * 34) * (0.85 + Math.random() * 0.3);
      const g = ctx.createLinearGradient(0, -6, 0, -6 + len);
      if (rave) {
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        for (let k = 1; k <= 4; k++) g.addColorStop(k * 0.22, `hsla(${hueAt(k * 70 + ex * 3)}, 100%, 62%, ${0.9 - k * 0.15})`);
        g.addColorStop(1, `hsla(${hueAt(330)}, 100%, 60%, 0)`);
      } else { g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, 'rgba(120,230,255,0.85)'); g.addColorStop(1, 'rgba(40,80,255,0)'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(ex - 6, -6); ctx.quadraticCurveTo(ex - 5, -6 + len * 0.5, ex, -6 + len); ctx.quadraticCurveTo(ex + 5, -6 + len * 0.5, ex + 6, -6); ctx.fill();
    }
    ctx.restore();
    for (const s of [-1, 1]) {
      const lit = 0.5 - s * bank * 0.35; // (the raised side catches the light)
      // front wing: the lower level, in shadow
      const fw = XF.front, gf = ctx.createLinearGradient(0, -36, s * fw.tip[0], fw.tip[1]);
      gf.addColorStop(0, `hsl(224, 26%, ${16 + lit * 14}%)`); gf.addColorStop(1, `hsl(224, 30%, ${24 + lit * 20}%)`);
      ctx.fillStyle = gf; wingPath(s, fw); ctx.fill();
      ctx.save();
      ctx.strokeStyle = 'rgba(51, 255, 255, 0.55)'; ctx.lineWidth = 1.2; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(s * fw.root[0], fw.root[1] - fw.rc / 2); ctx.lineTo(s * fw.tip[0], fw.tip[1] - fw.tc / 2); ctx.stroke();
      ctx.fillStyle = '#7ff'; ctx.shadowBlur = 8; // running light
      ctx.beginPath(); ctx.arc(s * fw.tip[0], fw.tip[1], 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // gun pod on the front wing, barrel forward
      const py = alongWing(fw, XF.pod);
      ctx.fillStyle = '#7d8cad'; ctx.beginPath(); ctx.roundRect(s * XF.pod - 3.5, py - 8, 7, 18, 3); ctx.fill();
      ctx.fillStyle = '#c9d6ee'; ctx.fillRect(s * XF.pod - 1.5, py - 18, 3, 12);
      // back wing: the upper level, lit (the first ship's wing)
      const bw = XF.back, gb = ctx.createLinearGradient(0, -40, s * bw.tip[0], bw.tip[1]);
      gb.addColorStop(0, `hsl(222, 30%, ${22 + lit * 20}%)`); gb.addColorStop(1, `hsl(222, 35%, ${32 + lit * 30}%)`);
      ctx.fillStyle = gb; wingPath(s, bw); ctx.fill();
      ctx.save();
      ctx.strokeStyle = '#3ff'; ctx.lineWidth = 1.6; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(s * bw.root[0], bw.root[1] - bw.rc / 2); ctx.lineTo(s * bw.tip[0], bw.tip[1] - bw.tc / 2); ctx.lineTo(s * bw.tip[0], bw.tip[1] + bw.tc / 2); ctx.stroke();
      ctx.restore();
      // pink band across the back wing, near the tip
      const bx0 = 38, bx1 = 43, by0 = alongWing(bw, bx0), by1 = alongWing(bw, bx1);
      const half = (x) => (bw.rc + (bw.tc - bw.rc) * (x - bw.root[0]) / (bw.tip[0] - bw.root[0])) / 2;
      ctx.fillStyle = '#ff6bf0';
      ctx.beginPath();
      ctx.moveTo(s * bx0, by0 - half(bx0) + 1); ctx.lineTo(s * bx1, by1 - half(bx1) + 1); ctx.lineTo(s * bx1, by1 + half(bx1) - 1); ctx.lineTo(s * bx0, by0 + half(bx0) - 1);
      ctx.closePath(); ctx.fill();
      // tip light: red port, green starboard, blinking
      if (Math.floor(now / 500) % 2 === (s < 0 ? 0 : 1)) {
        ctx.save();
        ctx.fillStyle = s < 0 ? '#ff3b5c' : '#3bff8a'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(s * bw.tip[0], bw.tip[1], 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // engine nacelles (over the wing roots), fuselage, racing stripe, canopy: the first ship's
    for (const ex of ENGINES) {
      const g = ctx.createLinearGradient(ex - 6, 0, ex + 6, 0);
      g.addColorStop(0, '#5d6c8e'); g.addColorStop(0.5, '#c4d2ec'); g.addColorStop(1, '#4a5878');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(ex - 6, -38, 12, 33, [6, 6, 2, 2]); ctx.fill();
      ctx.fillStyle = '#ff6bf0'; ctx.fillRect(ex - 6, -24, 12, 2.5);
      ctx.fillStyle = '#20263a'; ctx.fillRect(ex - 5, -7, 10, 3);
    }
    const fg = ctx.createLinearGradient(-14, 0, 14, 0);
    fg.addColorStop(0, bank > 0 ? '#f4fbff' : '#8fa3c7'); fg.addColorStop(0.5, '#e3eefc'); fg.addColorStop(1, bank > 0 ? '#8fa3c7' : '#f4fbff');
    ctx.save();
    ctx.fillStyle = fg; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.bezierCurveTo(8, -70, 13, -55, 13, -38);
    ctx.lineTo(11, -8); ctx.lineTo(6, -2); ctx.lineTo(-6, -2); ctx.lineTo(-11, -8); ctx.lineTo(-13, -38);
    ctx.bezierCurveTo(-13, -55, -8, -70, 0, -78); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ff6bf0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -8); ctx.stroke();
    const cg = ctx.createLinearGradient(0, -64, 0, -40);
    cg.addColorStop(0, '#9ff'); cg.addColorStop(1, '#0870b8');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(0, -51, 6, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.ellipse(-2.2 - bank * 1.5, -56, 1.6, 5, -0.15, 0, Math.PI * 2); ctx.fill();
  };
  // The original ship (a rocket with two gun pods), kept for if it's wanted back: not drawn any more.
  // (With splitWings it's the X-Flyer: see drawHull below.)
  const drawRocketHull = (now, bank, thrust, rave, splitWings = false) => {
    const hueAt = (k) => ((now / 4 + k) % 360 + 360) % 360;
    // engine flames
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ex of ENGINES) {
      const len = (16 + thrust * 34) * (0.85 + Math.random() * 0.3);
      const g = ctx.createLinearGradient(0, -6, 0, -6 + len);
      if (rave) { // white-hot at the nozzle, then a run through the rainbow
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        for (let k = 1; k <= 4; k++) g.addColorStop(k * 0.22, `hsla(${hueAt(k * 70 + ex * 3)}, 100%, 62%, ${0.9 - k * 0.15})`);
        g.addColorStop(1, `hsla(${hueAt(330)}, 100%, 60%, 0)`);
      } else { g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, 'rgba(120,230,255,0.85)'); g.addColorStop(1, 'rgba(40,80,255,0)'); }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ex - 6, -6);
      ctx.quadraticCurveTo(ex - 5, -6 + len * 0.5, ex, -6 + len);
      ctx.quadraticCurveTo(ex + 5, -6 + len * 0.5, ex + 6, -6);
      ctx.fill();
    }
    ctx.restore();

    // wings (the raised one catches the light)
    // (one wing, side s: the original broad wing; pod: with its gun pod)
    const wing = (s, pod = true) => {
      const lit = 0.5 - s * bank * 0.35;
      const g = ctx.createLinearGradient(0, -40, s * 51, -8);
      g.addColorStop(0, `hsl(222, 30%, ${22 + lit * 20}%)`); g.addColorStop(1, `hsl(222, 35%, ${32 + lit * 30}%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s * 9, -44); ctx.lineTo(s * 51, -14); ctx.lineTo(s * 49, -5); ctx.lineTo(s * 30, -10); ctx.lineTo(s * 12, -10);
      ctx.closePath(); ctx.fill();
      ctx.save();
      ctx.strokeStyle = '#3ff'; ctx.lineWidth = 1.6; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(s * 9, -44); ctx.lineTo(s * 51, -14); ctx.lineTo(s * 49, -5); ctx.stroke(); // leading edge
      ctx.restore();
      // gun pod and barrel
      if (pod) {
        ctx.fillStyle = '#7d8cad';
        ctx.beginPath(); ctx.roundRect(s * 27 - 3.5, -36, 7, 24, 3); ctx.fill();
        ctx.fillStyle = '#c9d6ee';
        ctx.fillRect(s * 27 - 1.5, -47, 3, 12);
      }
      // wingtip light: red port, green starboard, blinking
      if (Math.floor(now / 500) % 2 === (s < 0 ? 0 : 1)) {
        ctx.save();
        ctx.fillStyle = s < 0 ? '#ff3b5c' : '#3bff8a'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(s * 50, -12, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    };
    if (splitWings === 'mirror') {
      // X: the X-Flyer: behind the original wings, a copy of them mirrored top to bottom and moved up
      // (MIRROR_LIFT px above the flip about the wing's middle, y = -24.5), a little in shadow, so they sweep
      // forward from the same roots the originals sweep back from: together, an X. Then the originals.
      const MIRROR_LIFT = 8;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(0, -49 - MIRROR_LIFT); ctx.scale(1, -1);
        ctx.filter = 'brightness(0.72)';
        wing(s, false);
        ctx.restore();
      }
      for (const s of [-1, 1]) wing(s);
    } else for (const s of [-1, 1]) wing(s);

    // engine nacelles
    for (const ex of ENGINES) {
      const g = ctx.createLinearGradient(ex - 6, 0, ex + 6, 0);
      g.addColorStop(0, '#5d6c8e'); g.addColorStop(0.5, '#c4d2ec'); g.addColorStop(1, '#4a5878');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(ex - 6, -38, 12, 33, [6, 6, 2, 2]); ctx.fill();
      ctx.fillStyle = '#ff6bf0';
      ctx.fillRect(ex - 6, -24, 12, 2.5); // accent band
      ctx.fillStyle = '#20263a';
      ctx.fillRect(ex - 5, -7, 10, 3); // nozzle
    }

    // fuselage: light on the side facing away from the bank
    const fg = ctx.createLinearGradient(-14, 0, 14, 0);
    fg.addColorStop(0, bank > 0 ? '#f4fbff' : '#8fa3c7'); fg.addColorStop(0.5, '#e3eefc'); fg.addColorStop(1, bank > 0 ? '#8fa3c7' : '#f4fbff');
    ctx.save();
    ctx.fillStyle = fg; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -78);
    ctx.bezierCurveTo(8, -70, 13, -55, 13, -38);
    ctx.lineTo(11, -8); ctx.lineTo(6, -2); ctx.lineTo(-6, -2); ctx.lineTo(-11, -8); ctx.lineTo(-13, -38);
    ctx.bezierCurveTo(-13, -55, -8, -70, 0, -78);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ff6bf0'; ctx.lineWidth = 2; // racing stripe
    ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -8); ctx.stroke();

    // cockpit canopy
    const cg = ctx.createLinearGradient(0, -64, 0, -40);
    cg.addColorStop(0, '#9ff'); cg.addColorStop(1, '#0870b8');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(0, -51, 6, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.ellipse(-2.2 - bank * 1.5, -56, 1.6, 5, -0.15, 0, Math.PI * 2); ctx.fill();
  };
  // muzzle flashes (in ship-local pixels, see drawShip)
  const drawMuzzle = () => {
    {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [mx, my] of CANNONS) { // (at the cannon muzzles)
        const r = 10 * (muzzle / 0.07);
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,107,240,0.8)'); g.addColorStop(1, 'rgba(255,107,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  };
  // shield bubble while it can't be hurt after respawning (screen pixels)
  const drawShield = (now) => {
    if (now < safeUntil) {
      ctx.save();
      ctx.strokeStyle = `rgba(120,255,255,${0.35 + 0.25 * Math.sin(now / 60)})`; ctx.lineWidth = 2.5;
      ctx.shadowColor = '#0ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.ellipse(ship.x, ship.y - 38, 62, 50, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  };

  // --- X: Timeline mode. On Home, the timeline turns upside down for the game: the first post is at the
  // bottom, next to the ship, and the ones after it are stacked above, the way a shooter's level comes at
  // you. Holding ↑ scrolls the page on (the timeline comes down at you) at the ship's climbing speed, while
  // the ship itself still flies freely anywhere on screen; only while you hold ↑: X sees what it sees when you scroll
  // with the keyboard. Nothing is moved in X's list itself: it's a CSS mirror of the part on screen, so
  // X's own scrolling, loading and recycling of posts carry on as usual.
  // The list is the element holding the posts (cellInnerDiv) in the main column. Each post (X places it
  // with translateY(N)) is moved to its mirror image about the middle of the list's part on screen,
  // [max(list top, 0), window bottom], so that part maps onto itself, upside down post by post.
  let tl = null;
  const tlBand = { top: 0, bottom: 0 };
  let tlScroll = 0; // (fractions of a pixel left over between frames, see the ↑ scrolling in frame)
  const findTimeline = () => {
    if (location.pathname !== '/home' || gravityOn()) return null;
    return document.querySelector('[data-testid=primaryColumn] div:has(> [data-testid=cellInnerDiv])');
  };
  const unmirror = (list) => {
    list.removeAttribute('data-tss-tl');
    for (const p of ['--tss-tl-ct', '--tss-tl-cb']) list.style.removeProperty(p);
    for (const c of list.querySelectorAll(':scope > [data-tss-y]')) { c.removeAttribute('data-tss-y'); c.style.removeProperty('--tss-y'); }
  };
  const syncTimeline = () => {
    const list = on ? findTimeline() : null;
    if (list !== tl) {
      if (tl) unmirror(tl);
      tl = list;
      if (tl) tl.setAttribute('data-tss-tl', '');
    }
    if (!tl) return;
    // (its laid-out top, not getBoundingClientRect: Rainbow Rave's beat zoom and the screen shake transform
    // the column, and measuring through them moved the mirror's axis every frame, so the posts jumped)
    const top = layoutBox(tl)?.top ?? tl.getBoundingClientRect().top, h = tl.offsetHeight;
    tlBand.top = Math.max(top, 0); tlBand.bottom = H;
    const axis = (tlBand.top + tlBand.bottom) / 2 - top; // in the list's own pixels
    const set = (el, p, v) => { if (el.style.getPropertyValue(p) !== v) el.style.setProperty(p, v); };
    set(tl, '--tss-tl-ct', `${Math.max(0, tlBand.top - top).toFixed(1)}px`);
    set(tl, '--tss-tl-cb', `${Math.max(0, top + h - tlBand.bottom).toFixed(1)}px`);
    for (const c of tl.children) {
      const n = parseFloat(/translateY\((-?[\d.]+)px\)/.exec(c.style.transform)?.[1]);
      if (!Number.isFinite(n)) continue; // (not placed by X the usual way: left alone)
      set(c, '--tss-y', `${(2 * axis - n - c.offsetHeight).toFixed(1)}px`);
      if (!c.hasAttribute('data-tss-y')) c.setAttribute('data-tss-y', '');
    }
  };

  // X: the HUD and the start/stop button go in the empty strip right of the main column, centred in it:
  // the HUD near the top, the button at the bottom. Re-measured twice a second while playing, and every
  // second (and on resize) while not, for the button: the window or the layout can change. Without enough
  // room there, the HUD falls back to the top left and the button to the bottom right.
  let hudAt = 0;
  // An element's box in the window as laid out, ignoring transforms (offsetLeft/Top up its offset parents)
  const layoutBox = (el) => {
    if (!el || !el.offsetWidth) return null;
    let x = 0, y = 0, fixed = false;
    for (let e = el; e; e = e.offsetParent) {
      x += e.offsetLeft; y += e.offsetTop;
      if (getComputedStyle(e).position === 'fixed') { fixed = true; break; }
    }
    const left = fixed ? x : x - scrollX, top = fixed ? y : y - scrollY;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  };
  const placeHud = (now = performance.now()) => {
    if (now - hudAt < 500) return;
    hudAt = now;
    // (layout boxes, not getBoundingClientRect: Rainbow Rave's beat zooms the columns, and the panel's
    // size and place mustn't swell and shrink with it; the panel bumps along with the page instead)
    const col = layoutBox(document.querySelector('[data-testid=primaryColumn]'));
    const side = layoutBox(document.querySelector('[data-testid=sidebarColumn]'));
    const right = side?.width ? side.left : innerWidth; // (the sidebar, when X shows one, is the end of the strip)
    const room = col ? right - col.right - 12 : 0;
    const fits = room >= 86; // (the widest line, "shift+S quit")
    const mid = fits ? (col.right + right) / 2 : 0;
    const set = (el, p, v) => { if (el.style.getPropertyValue(p) !== v) el.style.setProperty(p, v); };
    set(hud, '--tss-hud-l', fits ? `${Math.round(mid)}px` : '12px');
    set(hud, '--tss-hud-w', fits ? `${Math.round(room)}px` : '220px');
    set(hud, '--tss-hud-align', fits ? 'center' : 'left');
    set(hud, '--tss-hud-shift', fits ? 'translateX(-50%)' : 'none');
    if (toggle) {
      set(toggle, 'left', fits ? `${Math.round(mid - 20)}px` : '');
      set(toggle, 'right', fits ? 'auto' : '');
    }
    // the music switch left of it, the sound switch right of it (S px, 8px apart); in a narrow strip
    // (no room for the row of three) they stack above it instead: music, then sound on top
    if (typeof musicBtn !== 'undefined') {
      const S = 26, stack = fits && room < 150;
      set(musicBtn, 'left', fits ? `${Math.round(stack ? mid - S / 2 : mid - 20 - 8 - S)}px` : '');
      set(musicBtn, 'right', fits ? 'auto' : '');
      set(musicBtn, 'bottom', stack ? `${16 + 40 + 8}px` : '');
      set(soundBtn, 'left', fits ? `${Math.round(stack ? mid - S / 2 : mid + 20 + 8)}px` : '');
      set(soundBtn, 'right', fits ? 'auto' : '');
      set(soundBtn, 'bottom', stack ? `${16 + 40 + 8 + S + 8}px` : '');
    }
    fitHudHeight(fits);
  };
  // X: the panel's height: the whole strip, from HUD_TOP down to the bottom of the buttons (16px above the
  // window's bottom). Five groups, evenly spaced (space-between): the title at the top, the controls, the
  // stats, the lives (drawn into their slot, see drawLives), and the buttons' slot at the bottom, where the
  // buttons themselves sit (their height: one row, or stacked in a narrow strip). If it doesn't all fit, the
  // gaps inside the groups shrink (12px down to 2px), then the text (12px down to 9px).
  const HUD_TOP = 18, HUD_BOTTOM = 16;
  // The title, one span per letter (--i its index, --h its hue: red to magenta across the word), for
  // Rainbow Rave's look (see the CSS); without it, the letters just share the title's cyan-to-pink.
  const titleEl = () => {
    const t = document.createElement('div');
    t.className = 'tss-hud-title';
    const word = 'X-Flyer';
    [...word].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'tss-tch'; s.textContent = ch;
      s.style.setProperty('--i', String(i)); s.style.setProperty('--h', String(Math.round(i * 300 / (word.length - 1))));
      t.append(s);
    });
    return t;
  };
  const fitHudHeight = (fits) => {
    const set = (p, v) => { if (hud.style.getPropertyValue(p) !== v) hud.style.setProperty(p, v); };
    set('--tss-hud-items', fits ? 'center' : 'flex-start');
    root.toggleAttribute('data-tss-rave', raveOn()); // (Rainbow Rave's look for the title, see the CSS)
    if (!on || !hud.firstChild) return;
    const tops = [toggle, typeof musicBtn !== 'undefined' && musicBtn, typeof soundBtn !== 'undefined' && soundBtn]
      .filter(Boolean).map((b) => layoutBox(b)).filter(Boolean).map((r) => r.top); // (unbumped: see placeHud)
    const btnsH = tops.length ? innerHeight - HUD_BOTTOM - Math.min(...tops) : 40;
    set('--tss-btns-h', `${Math.round(btnsH)}px`);
    const avail = Math.max(160, innerHeight - HUD_TOP - HUD_BOTTOM);
    set('--tss-hud-top', `${HUD_TOP}px`);
    set('--tss-hud-h', `${Math.round(avail)}px`);
    const groups = [...hud.children], gaps = groups.reduce((a, g) => a + Math.max(0, g.children.length - 1), 0);
    const MIN_BETWEEN = 18; // (at least this much between groups)
    const need = (gap, fs) => { // measured: each group's height at this gap and size
      set('--tss-gap', `${gap}px`); set('--tss-fs', `${fs}px`);
      return groups.reduce((a, g) => a + g.offsetHeight, 0) + MIN_BETWEEN * (groups.length - 1);
    };
    let fs = 12, gap = 12;
    const over = need(gap, fs) - avail;
    if (over > 0 && gaps) gap = Math.max(2, Math.floor(gap - over / gaps));
    while (need(gap, fs) > avail && fs > 9) fs -= 1;
  };
  addEventListener('resize', () => { hudAt = 0; placeHud(); });
  setInterval(() => { if (!on) { hudAt = 0; placeHud(); } }, 1000);

  // X: the lives, as little ships in a row above the buttons (unshaken). The one just lost blinks for
  // 1.5 s, then it's gone.
  // (a tiny copy of the real ship: the same drawing as the one you fly, scaled down, engines idling)
  const drawMiniShip = (x, y, s, alpha, now = performance.now()) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y); ctx.scale(s, s);
    drawHull(now, 0, 0.35, raveOn());
    ctx.restore();
  };
  // X: extra lives, dropped by big accounts (see killChaser). A 3UP is a little blue bird that flies to you
  // (it homes in, flapping); a 1UP is a blue butterfly that flutters about aimlessly, so you have to catch
  // it. Touch one for the lives (up to 9). They blink in their last 2 s and are gone after 12 s.
  const pickups = [];
  const ONEUP_LIFE = 12000, MAX_LIVES = 9;
  const movePickup = (p, now, dt, sx, sy, shipLive) => {
    if (p.kind === 'bird' && shipLive) { // flies straight at you, a little wavy, after a moment to take off
      const age = (now - p.born) / 1000, sp = Math.min(260, 60 + age * 160);
      const aim = Math.atan2(sy - p.y, sx - p.x) + Math.sin(now / 180 + p.phase) * 0.35;
      p.vx += (Math.cos(aim) * sp - p.vx) * Math.min(1, dt * 3);
      p.vy += (Math.sin(aim) * sp - p.vy) * Math.min(1, dt * 3);
    } else { // flutters: a heading that wanders at random, jittery speed, steering off the edges
      p.heading += (Math.random() - 0.5) * 7 * dt + Math.sin(now / 300 + p.phase) * 1.5 * dt;
      const m = 40;
      if (p.x < m) p.heading = 0; else if (p.x > W - m) p.heading = Math.PI;
      if (p.y < H * 0.12) p.heading = Math.PI / 2; else if (p.y > H * 0.88) p.heading = -Math.PI / 2;
      const sp = 70 + 50 * Math.abs(Math.sin(now / 160 + p.phase));
      p.vx = Math.cos(p.heading) * sp; p.vy = Math.sin(p.heading) * sp + Math.sin(now / 90 + p.phase) * 40; // (the bob of each wingbeat)
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
  };
  // X: with Rainbow Rave on, the bird and butterfly take the rave's badge rainbow (rainbow-rave.js: one hue
  // cycle every 24px up the 45° diagonal, rolling by in 0.8 s), as a gradient across the creature
  const RAVE_SPAN = 22; // (the gradient runs from -22,22 to 22,-22: a little over the creature's size)
  const raveFill = (now) => {
    const len = RAVE_SPAN * 2 * Math.SQRT2, roll = (now / 800) * 24;
    const g = ctx.createLinearGradient(-RAVE_SPAN, RAVE_SPAN, RAVE_SPAN, -RAVE_SPAN);
    for (let d = 0; d <= len; d += 2) g.addColorStop(d / len, `hsl(${(((d - roll) / 24) * 360 % 360 + 360) % 360}, 100%, 60%)`);
    return g;
  };
  const raveGlowColor = (now) => `hsl(${(now / 800) * 360 % 360}, 100%, 60%)`;
  // the bird: a round little blue bird (body, head, beak, a flapping wing, a tail), facing where it flies
  const drawBird = (p, now) => {
    const flap = Math.sin(now / 45 + p.phase), face = p.vx < 0 ? -1 : 1, rave = raveOn();
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(face, 1);
    ctx.shadowColor = rave ? raveGlowColor(now) : '#1d9bf0'; ctx.shadowBlur = 10;
    ctx.fillStyle = rave ? raveFill(now) : '#1d9bf0';
    ctx.beginPath(); ctx.moveTo(-9, 2); ctx.lineTo(-17, -3); ctx.lineTo(-15, 5); ctx.closePath(); ctx.fill(); // tail
    ctx.beginPath(); ctx.ellipse(0, 2, 10, 7.5, -0.15, 0, Math.PI * 2); ctx.fill(); // body
    ctx.beginPath(); ctx.arc(8, -5, 5.5, 0, Math.PI * 2); ctx.fill(); // head
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(13, -6); ctx.lineTo(18, -4.5); ctx.lineTo(13, -3); ctx.closePath(); ctx.fill(); // beak
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(9.5, -6.5, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b1b2b'; ctx.beginPath(); ctx.arc(10, -6.5, 0.8, 0, Math.PI * 2); ctx.fill(); // eye
    ctx.fillStyle = rave ? 'rgba(255, 255, 255, 0.75)' : '#8fd0ff'; // the wing, up and down
    ctx.beginPath(); ctx.ellipse(-1, -1 - flap * 4, 7.5, 3.2 + Math.abs(flap) * 1.5, -0.5 - flap * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  // the butterfly: two pairs of rounded wings in sky blue, opening and closing, on a thin dark body
  const drawButterfly = (p, now) => {
    const open = 0.25 + 0.75 * Math.abs(Math.sin(now / 70 + p.phase)); // (wings seen from above: they narrow as they close)
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
    const rave = raveOn(), rg = rave ? raveFill(now) : null;
    ctx.shadowColor = rave ? raveGlowColor(now) : '#0085ff'; ctx.shadowBlur = 10;
    for (const s of [-1, 1]) {
      let g = rg;
      if (!g) { g = ctx.createLinearGradient(0, -10, s * 14, 6); g.addColorStop(0, '#5fb6ff'); g.addColorStop(1, '#0066e0'); }
      ctx.fillStyle = g;
      ctx.save(); ctx.scale(open, 1);
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.bezierCurveTo(s * 6, -16, s * 18, -14, s * 14, -2); ctx.bezierCurveTo(s * 12, 2, s * 4, 1, 0, -1); ctx.fill(); // upper
      ctx.beginPath(); ctx.moveTo(0, 1); ctx.bezierCurveTo(s * 10, 2, s * 13, 10, s * 7, 12); ctx.bezierCurveTo(s * 3, 12, s * 1, 6, 0, 1); ctx.fill(); // lower
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#10223a'; ctx.beginPath(); ctx.ellipse(0, 0, 1.4, 8, 0, 0, Math.PI * 2); ctx.fill(); // body
    ctx.strokeStyle = '#10223a'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-0.5, -7); ctx.lineTo(-3, -12); ctx.moveTo(0.5, -7); ctx.lineTo(3, -12); ctx.stroke(); // antennae
    ctx.restore();
  };
  const updatePickups = (now, dt, shipLive) => {
    const sx = ship.x, sy = ship.y - ship.h * 0.45;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i], age = now - p.born;
      movePickup(p, now, dt, sx, sy, shipLive);
      if (age > ONEUP_LIFE) { pickups.splice(i, 1); continue; }
      if (shipLive && Math.hypot(p.x - sx, p.y - sy) < 46) {
        pickups.splice(i, 1);
        lives = Math.min(MAX_LIVES, lives + (p.n || 1));
        sfx.oneUp();
        rings.push({ x: p.x, y: p.y, t: 0, R: 60, hue: 120, dur: 0.5 });
        for (let k = 0; k < 24; k++) {
          const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 220;
          bits.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.4 + Math.random() * 0.4,
            spark: true, size: 2 + Math.random() * 3, color: k % 2 ? '#7fff9a' : '#ffffff' });
        }
        window.trif?.log('1-up:', lives, 'lives');
        continue;
      }
      const alpha = age > ONEUP_LIFE - 2000 && Math.floor(age / 110) % 2 ? 0.2 : 1;
      ctx.save(); ctx.globalAlpha = alpha;
      if (p.kind === 'bird') drawBird(p, now); else drawButterfly(p, now);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 13px ${WIN_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (raveOn()) { // (X: white with a drop shadow, like the panel's text over the rainbow)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#fff';
      } else {
        ctx.shadowColor = '#3f6'; ctx.shadowBlur = 10 + 4 * Math.sin(now / 120);
        ctx.fillStyle = '#7fff9a';
      }
      ctx.fillText(`${p.n || 1}UP`, p.x, p.y - 22);
      ctx.restore();
    }
  };
  // The lives are drawn on their own little canvas inside the panel's lives slot (between the stats and
  // the buttons, see fitHudHeight), so Rainbow Rave's beat zoom carries them exactly as it does the panel.
  // (Drawn on the game canvas, they followed the zoom a frame late: it runs on the compositor's clock.)
  let livesCv = null, livesG = null;
  const LIVES_PAD = 24; // (room around the slot for the flames and glow)
  const drawLives = (now) => {
    const slotEl = hud.querySelector('.tss-g-lives');
    if (!slotEl || !slotEl.offsetWidth) return;
    if (!livesCv) { livesCv = document.createElement('canvas'); livesCv.className = 'tss-lives-cv'; livesG = livesCv.getContext('2d'); }
    if (livesCv.parentNode !== slotEl) slotEl.append(livesCv); // (the panel is rebuilt when the stats change)
    const dpr = devicePixelRatio || 1, w = slotEl.offsetWidth + LIVES_PAD * 2, h = slotEl.offsetHeight + LIVES_PAD * 2;
    if (livesCv.width !== Math.round(w * dpr) || livesCv.height !== Math.round(h * dpr)) {
      livesCv.width = Math.round(w * dpr); livesCv.height = Math.round(h * dpr);
      Object.assign(livesCv.style, { left: `${-LIVES_PAD}px`, top: `${-LIVES_PAD}px`, width: `${w}px`, height: `${h}px` });
    }
    livesG.setTransform(1, 0, 0, 1, 0, 0);
    livesG.clearRect(0, 0, livesCv.width, livesCv.height);
    livesG.setTransform(dpr, 0, 0, dpr, 0, 0);
    // (the little ship's drawing goes from y up about 22px: its middle sits on the slot's middle)
    const cx = w / 2, y = h / 2 + 11, gap = 30;
    // (as many as you have, with 1-ups: at least the starting three slots, so a lost one can blink out;
    // closer together past five)
    const n = Math.max(LIVES, lives + (lostLife && now - lostLife.at < 1500 ? 1 : 0));
    const step = n > 5 ? 22 : gap;
    const main = ctx;
    ctx = livesG; // (drawMiniShip and drawHull draw on ctx)
    try {
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * step;
        let alpha = i < lives ? 1 : 0;
        if (lostLife && lostLife.index === i && now - lostLife.at < 1500) alpha = Math.floor((now - lostLife.at) / 120) % 2 ? 0.15 : 1;
        if (alpha) drawMiniShip(x, y, 0.24, alpha, now);
      }
    } finally { ctx = main; }
  };

  // Rainbow Rave's glow (see glowCv): each letter is drawn far off the canvas, and only its blurred shadow,
  // in the letter's hue, lands on it; two passes, a tight core and a wide halo (timsrobot.com's numbers).
  // k: the glow's size; strength: its brightness (the title is gentler than the end screens).
  const GLOW_OFF = 10000;
  const glowText = (g, ch, font, size, x, y, hue, alpha, k = 1, strength = 1, rot = 0, scale = 1) => {
    if (alpha <= 0.02) return;
    const dpr = devicePixelRatio || 1;
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowOffsetX = -GLOW_OFF * dpr; g.shadowOffsetY = 0; g.fillStyle = '#000';
    const c = Math.cos(rot) * dpr * scale, s = Math.sin(rot) * dpr * scale;
    g.setTransform(c, s, -s, c, (x + GLOW_OFF) * dpr, y * dpr);
    for (const [blur, light, a] of [[size * 0.12 * k, 70, 0.9], [size * 0.35 * k, 55, 0.7]]) {
      g.shadowBlur = blur * scale * dpr;
      g.shadowColor = `hsla(${((hue % 360) + 360) % 360}, 100%, ${light}%, ${a * alpha * strength})`;
      g.fillText(ch, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  const glowQueue = []; // the end screens' letters this frame: [ch, font, size, x, y, hue, alpha, rot, scale]
  const glowFonts = new WeakMap();
  const paintGlow = () => {
    for (const cv of [glowCv, glowZ]) {
      if (cv.width !== canvas.width || cv.height !== canvas.height) { cv.width = canvas.width; cv.height = canvas.height; }
      if (cv.style.translate !== canvas.style.translate) cv.style.translate = canvas.style.translate; // (see pin)
    }
    for (const g of [glowG, glowZG]) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, glowCv.width, glowCv.height); }
    const queued = glowQueue.splice(0);
    if (!root.hasAttribute('data-tss-rave')) return;
    for (const [ch, font, size, x, y, hue, alpha, rot, scale] of queued) glowText(glowG, ch, font, size, x, y, hue, alpha, 1.5, 1, rot, scale);
    // The title: where its letters would be without the beat's zoom (about the window's centre, as
    // Rainbow Rave does it), since the zoom is applied to this layer too.
    const hr = hud.getBoundingClientRect(), z = hud.offsetHeight && hr.height ? hr.height / hud.offsetHeight : 1;
    const zx = innerWidth / 2, zy = innerHeight / 2;
    for (const el of hud.querySelectorAll('.tss-tch')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      let f = glowFonts.get(el);
      if (!f) { const cs = getComputedStyle(el); f = { size: parseFloat(cs.fontSize) || 24, font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` }; glowFonts.set(el, f); }
      const x = zx + (r.left + r.width / 2 - zx) / z, y = zy + (r.top + r.height / 2 - zy) / z;
      glowText(glowZG, el.textContent, f.font, f.size, x, y, parseFloat(el.style.getPropertyValue('--h')) || 0, 1, 1, 0.6);
    }
  };
  // Rainbow Rave's look for the end screens (timsrobot.com's rainbow "ROBOT DESTROYED"): each letter its
  // own hue, a step around the wheel from the last, all of them rolling round it every 2.4 s, with a
  // white outline (half of it showing, outside) and the additive glow; once in place they bob in a wave.
  const raveHue = (i, now) => i * 26 + (now / 2400) * 360;
  const raveLetter = (ch, i, now, flash = 0) => {
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = `hsl(${raveHue(i, now) % 360}, 100%, ${58 + flash * 37}%)`;
    ctx.fillText(ch, 0, 0);
  };
  const raveBob = (i, now) => 5 * Math.sin((now / 1000 - i * 0.09) * Math.PI / 1.1);

  let prev = performance.now(), raf = 0;
  const frame = (now) => {
    raf = 0;
    if (!on) return; // X: stopped
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    try {
      if (keys.ArrowLeft) ship.x -= 520 * dt;
      if (keys.ArrowRight) ship.x += 520 * dt;
      const dead = now < deadUntil;
      if (deadUntil && !dead) { // respawn (X: while lives last; after the last, GAME OVER)
        deadUntil = 0;
        if (gameOverPending) { // (the big boom has rung out: start over, no game over screen)
          gameOverPending = false;
          restartGame();
        } else {
          ship.x = W / 2; ship.y = H - 14;
          safeUntil = now + 1500;
        }
      }
      const autopilot = victory(now, dt) || flyBackIn(dt);
      if (!dead && !autopilot) {
        if (keys.ArrowLeft) ship.x -= 520 * dt;
        if (keys.ArrowRight) ship.x += 520 * dt;
        if (keys.ArrowUp) ship.y -= 420 * dt;
        if (keys.ArrowDown) ship.y += 420 * dt;
        ship.x = Math.max(ship.w / 2, Math.min(W - ship.w / 2, ship.x));
        // X: Timeline mode: holding ↑ also scrolls the timeline down at you (at the ship's climbing speed), but
        // the ship still flies anywhere on screen: the scrolling doesn't hold it back
        if (tl && keys.ArrowUp) { tlScroll += 420 * dt; const n = Math.floor(tlScroll); if (n) { tlScroll -= n; scrollBy(0, n); } }
        ship.y = Math.max(ship.h + 4, Math.min(H - 14, ship.y));
        // space: lasers normally; in Gravity mode (where lasers can't do much) it drops bombs instead,
        // one in the air at a time
        // Holding space fires at most every 150 ms; each new press fires straight away, however soon
        // after the last shot (even a tap too quick for a frame to see the key down).
        if (gravityOn()) { if (presses || keys[' ']) dropBomb(now); } // (bombs: one in the air at a time)
        else if (presses || (keys[' '] && now - lastShot > 150)) fire(now);
        if (now > safeUntil && (touchesRobot() || touchesChaser())) blowUpShip(now); // X: (or an avatar)
      }
      presses = 0; // (presses while the ship is down or on autopilot don't save up)
      moveChasers(now, dt, !dead && !autopilot); // X
      // X: one Elon at a time. While the boss is out, every other @elonmusk picture on the page just
      // vanishes (its circle empties: nothing to wake), checked twice a second as posts scroll in.
      if (now - elonSweep > 500 && chasers.some((c) => c.boss)) {
        elonSweep = now;
        document.querySelectorAll(ELON_AVATAR).forEach((a) => { if (!a.hasAttribute('data-tss-dead')) a.setAttribute('data-tss-dead', ''); });
      }
      // (The boss fight doesn't scroll the page by itself: the timeline only moves when you fly up, as
      // always, so X sees nothing but your own pace.)
      // Tell the Living robot mod where the ship is (it chases an active ship). "Active" = flown
      // or fired in the last 5 s and not exploded.
      if (keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown || keys[' ']) lastInput = now;
      // (plus the bombs in the air, so the robot can see them coming and dodge)
      dispatchEvent(new CustomEvent('tss-ship', { detail: {
        x: ship.x, y: ship.y - ship.h * 0.45, active: !dead && !autopilot && now - lastInput < 5000,
        bombs: bombs.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })), bombGravity: BOMB_GRAVITY,
        deaths } })); // (the robot greets a fresh player differently from one he's already blown up)

      const dpr = devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      glowQueue.length = 0; // (filled again as this frame draws, see paintGlow)

      syncTimeline(); // X: (after any scroll this frame)
      applyShake(dt);
      ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr); // X: the game layer shakes with the timeline
      pin();

      ctx.save();
      ctx.shadowColor = '#f0f'; ctx.shadowBlur = 18;
      const rr = lasers.length ? robotRect() : null;
      for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.y -= 950 * dt;
        // the robot shields the words behind him (inset a little: his svg box has empty corners)
        if (rr && l.x + 5 > rr.left + rr.width * 0.12 && l.x - 5 < rr.right - rr.width * 0.12
            && l.y < rr.bottom - rr.height * 0.1 && l.y + 34 > rr.top + rr.height * 0.1) {
          hitRobot(l.x, l.y);
          lasers.splice(i, 1);
          continue;
        }
        // X: avatars chasing you are in front of everything
        const chaser = chaserAt(l.x, l.y) || chaserAt(l.x, l.y + 30);
        if (chaser) { hitChaser(chaser, l.x, l.y); lasers.splice(i, 1); continue; }
        const wl = winLetterAt(l.x, l.y) || winLetterAt(l.x, l.y + 20); // the win message, letter by letter
        if (wl) { lasers.splice(i, 1); shootWinLetter(wl); if (winLeaving) break; continue; } // (the last letter clears the lasers)
        if (winMsg) { // (while it's up, only its letters are targets: shots pass through the page)
          if (l.y < -40) { lasers.splice(i, 1); continue; }
          ctx.fillStyle = '#ff6bf0';
          ctx.beginPath(); ctx.roundRect(l.x - 5, l.y, 10, 34, 5); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.roundRect(l.x - 2, l.y + 3, 4, 28, 2); ctx.fill();
          continue;
        }
        // fat bolt: hit anything under its centre or either edge
        const w = l.y > 0 && (hitWord(l.x, l.y) || hitWord(l.x - 5, l.y) || hitWord(l.x + 5, l.y));
        if (w) explode(w);
        // X: photos, videos and link cards (outside what Timeline mode clips away)
        const media = !w && l.y > 0 && (!tl || (l.y > tlBand.top && l.y < tlBand.bottom)) ? mediaAt(l.x, l.y) : null;
        if (media) hitMedia(media, l.x, l.y);
        const box = !w && !media && l.y > 0 && !gravityOn() ? hitBox(l.x, l.y, now) : null;
        if (box) explodeBox(box);
        if (w || media || box || l.y < -40) { lasers.splice(i, 1); continue; }
        ctx.fillStyle = '#ff6bf0';
        ctx.beginPath(); ctx.roundRect(l.x - 5, l.y, 10, 34, 5); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.roundRect(l.x - 2, l.y + 3, 4, 28, 2); ctx.fill();
      }
      ctx.restore();

      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i];
        g.t += dt / (g.dur || 0.45);
        if (g.t >= 1) { rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - g.t, 3);
        ctx.save();
        if (g.nova) { // a rainbow disc that swells and fades: the Rainbow Rave robot blast
          const r = Math.max(1, g.R * e), spin = (now / 4) % 360;
          const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, r);
          grad.addColorStop(0, 'rgba(255,255,255,0.95)');
          for (let k = 0; k <= 6; k++) grad.addColorStop(0.15 + k * 0.13, `hsla(${(spin + k * 55) % 360}, 100%, 62%, ${0.75 - k * 0.07})`);
          grad.addColorStop(1, 'hsla(0, 100%, 60%, 0)');
          ctx.globalAlpha = (1 - g.t) * 0.85;
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          continue;
        }
        if (g.hue != null) { // a rainbow shockwave
          const c = `hsl(${(g.hue + now / 3) % 360}, 100%, 62%)`;
          ctx.globalAlpha = 1 - g.t;
          ctx.strokeStyle = c; ctx.lineWidth = 16 * (1 - g.t) + 2;
          ctx.shadowColor = c; ctx.shadowBlur = 24;
          ctx.beginPath(); ctx.arc(g.x, g.y, g.R * e, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          continue;
        }
        if (g.t < 0.25) { // white-hot flash at the centre
          ctx.globalAlpha = 1 - g.t / 0.25;
          ctx.fillStyle = '#fff8e0';
          ctx.beginPath(); ctx.arc(g.x, g.y, g.R * 0.45 * (0.5 + g.t * 2), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1 - g.t;
        ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 10 * (1 - g.t) + 1;
        ctx.shadowColor = '#ff6b3c'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.R * e, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.life -= dt;
        if (b.life <= 0) { bits.splice(i, 1); continue; }
        b.vy += 520 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y > H - 4 && b.vy > 0) { b.y = H - 4; b.vy *= -0.45; b.vx *= 0.7; }
        ctx.globalAlpha = Math.min(1, b.life);
        if (b.hue != null) b.color = `hsl(${(b.hue + now * 0.45) % 360}, 100%, 62%)`; // rainbow bits cycle
        if (b.spark) {
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
        } else {
          b.rot += b.vr * dt;
          b.scale = Math.min(b.grow, b.scale + dt * 4);
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.scale(b.scale, b.scale);
          ctx.font = b.font; ctx.fillStyle = b.color;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(b.ch, 0, 0);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      // hidden while dead; blinks while safe after respawning
      updateBombs(now, dt);
      updateRearBombs(now, dt); // X: Z's bombs
      updatePickups(now, dt, !dead && !autopilot); // X: 1-ups
      drawChasers(now); // X
      drawWinMessage(now); // X
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawLives(now); drawDied(now); ctx.restore(); // X: (steady, not shaken)
      drawShip(now, dt, now >= deadUntil && (now > safeUntil || Math.floor(now / 100) % 2));
      // X: one per line, spaced out (the HUD sits in the narrow strip right of the timeline), the score
      // and counters after a gap, in yellow
      // (each line: the key, in cyan, then what it does, in pink)
      const lines = [['← → ↑ ↓', 'fly'], ['space', gravityOn() ? 'bomb' : 'fire'], ['X', 'drop bomb']];
      if (document.documentElement.hasAttribute('data-gm-ready')) lines.push(['G', 'gravity']); // the Gravity mode mod is on
      lines.push(['R', 'restore'], ['shift+S', 'quit']);
      const stats = [`${score} ${score === 1 ? 'word' : 'words'} blasted`,
        `${graphics} ${graphics === 1 ? 'graphic' : 'graphics'} destroyed`,
        `${kills.mutual} ${kills.mutual === 1 ? 'mutual' : 'mutuals'} killed`,
        `${kills.follower} ${kills.follower === 1 ? 'follower' : 'followers'} killed`,
        `${kills.stranger} ${kills.stranger === 1 ? 'stranger' : 'strangers'} killed`];
      if (deaths) stats.push(`${deaths} death${deaths > 1 ? 's' : ''}`);
      if (robotHp && robotHp < ROBOT_HP) stats.push(`robot ${robotHp}/${ROBOT_HP}`); // (destroyed: the big banner says so)
      const key = lines.map((l) => l.join(' ')).join('|') + '#' + stats.join('|');
      if (hud.dataset.key !== key) {
        hud.dataset.key = key;
        const el = (tag, cls, text) => { const d = document.createElement(tag); d.className = cls; if (text) d.textContent = text; return d; };
        // three groups (title, controls, stats), spread down the strip by placeHud
        const group = (cls, kids) => { const g = el('div', `tss-g ${cls}`); g.append(...kids); return g; };
        hud.replaceChildren(
          group('tss-g-title', [titleEl()]), // the game's name, at the top of the strip
          group('tss-g-ctl', lines.map(([k, what]) => { const d = el('div', 'tss-hud-line'); d.append(el('span', 'tss-hud-key', k), ' ', el('span', 'tss-hud-what', what)); return d; })),
          group('tss-g-stats', stats.map((t) => el('div', 'tss-hud-stat', t))),
          // (room for the lives, drawn on their canvas there: see drawLives. It moves straight into the new
          // slot, drawing kept: left for the next frame, the lives blinked out whenever a stat changed)
          group('tss-g-lives', livesCv ? [livesCv] : []),
          group('tss-g-btns', [])); // (room for the buttons, which sit there: see fitHudHeight)
        hudAt = 0; // (re-fit it now)
      }
      placeHud(now);
      paintGlow(); // X: Rainbow Rave's glow, for this frame's letters
    } catch (e) { window.trif?.warn('frame failed', String(e)); }
    raf = requestAnimationFrame(frame);
  };

  // --- X: starting and stopping. On: words become targets and the ship flies in from below. Off:
  // gravity (if on) flies the page home, every blasted thing comes back, and the words are unwrapped.
  // Game over: everything comes back (words, photos, the avatars to their circles), the score goes to 0,
  // the page scrolls back to where the game started (the timeline from the top, in Timeline mode), and the
  // ship flies in from below.
  let startScroll = 0;
  const restartGame = () => {
    try {
      winMsg = null;
      playAgain();
      sfx.musicStart(); // (stopped at game over: back from the top)
      lasers.length = 0;
      scrollTo({ top: startScroll, behavior: 'instant' });
      window.trif?.log('game over: starting again');
    } catch (err) { window.trif?.warn('restart failed', String(err)); }
  };
  const startGame = (e) => {
    if (on) return;
    startScroll = scrollY;
    score = 0; graphics = 0; kills = noKills(); deaths = 0;
    lives = LIVES; lostLife = null; gameOverPending = false; pickups.length = 0; root.removeAttribute('data-tss-dying');
    on = true;
    root.setAttribute('data-tss-on', '');
    if (e) sfx.wake(e);
    sfx.musicStart(); // (plays now if the audio's awake, else as soon as it is)
    resize();
    try { wrapWords(); } catch (err) { window.trif?.warn('wrap failed', String(err)); }
    wordWatch.observe(document.body, { childList: true, subtree: true, characterData: true });
    trail.length = 0; ship.x = W / 2; ship.y = H + ship.h; returning = true; // flies in from below
    deadUntil = 0; safeUntil = performance.now() + 1800; lastInput = -1e9; presses = 0;
    prev = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
    syncToggle();
    window.trif?.log('space shooter on', groups.size, 'text pieces wrapped');
  };
  const stopGame = () => {
    if (!on) return;
    root.removeAttribute('data-tss-dying'); // (quit mid-death: the music comes back)
    const hadGravity = gravityOn();
    if (hadGravity) dispatchEvent(new KeyboardEvent('keydown', { key: 'g' })); // (while still on: Gravity takes plain G then)
    on = false;
    root.removeAttribute('data-tss-on');
    sfx.musicStop();
    wordWatch.disconnect();
    for (const k in keys) keys[k] = false;
    lasers.length = 0; bits.length = 0; rings.length = 0; bombs.length = 0; rearBombs.length = 0; pulses.length = 0; trail.length = 0;
    leaving = 0; resetAt = 0; whooshed = false; returning = false;
    shake = 0; shakeX = 0; shakeY = 0; root.style.translate = '';
    if (shaken) { shaken.style.translate = ''; shaken = null; }
    winLeaving = false;
    winMsg = null;
    removeWin();
    restoreAll();
    syncTimeline(); // X: the timeline the right way up again
    ctx.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // after Gravity's pieces have flown home (they may be our word spans)
    setTimeout(() => { if (!on) try { unwrapWords(); } catch (err) { window.trif?.warn('unwrap failed', String(err)); } }, hadGravity ? 900 : 0);
    syncToggle();
    window.trif?.log('space shooter off');
  };
  const toggle = document.createElement('button');
  toggle.className = 'tss-toggle';
  toggle.type = 'button';
  const syncToggle = () => {
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Stop X-Flyer' : 'Play X-Flyer');
    toggle.title = on ? 'Stop X-Flyer (Shift+S)' : 'Play X-Flyer (Shift+S)';
  };
  { // a little rocket (the original icon)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M12 2c3 2.4 4.5 5.9 4.5 10l2.5 3v3.5l-3.2-1.6H8.2L5 18.5V15l2.5-3C7.5 7.9 9 4.4 12 2zm0 6a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 12 8zm-2 11h4l-2 3.2z');
    svg.append(path);
    toggle.append(svg);
  }
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle.blur(); // (so space, the fire button, doesn't press it again)
    if (on) stopGame(); else startGame(e);
  });
  syncToggle();
  document.documentElement.append(toggle); // (on <html>, like the canvas: Gravity leaves it be)
  // X: the music switch (left of it) and the sound-effects switch (right of it): a note and a speaker,
  // struck through when off. Remembered between visits (prefs).
  const NS2 = 'http://www.w3.org/2000/svg';
  const makeSwitch = (cls, key, paths, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tss-toggle tss-ctl ${cls}`;
    const sync = () => {
      const svg = document.createElementNS(NS2, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      for (const d of [...paths, ...(prefs[key] ? [] : ['M3 3l18 18-1.4 1.4L2.6 4.4z'])]) {
        const p = document.createElementNS(NS2, 'path'); p.setAttribute('d', d); svg.append(p);
      }
      b.replaceChildren(svg);
      b.setAttribute('aria-pressed', String(prefs[key]));
      b.setAttribute('aria-label', `${label} ${prefs[key] ? 'on' : 'off'}`);
      b.title = `${label}: ${prefs[key] ? 'on (click to turn off)' : 'off (click to turn on)'}`;
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation(); b.blur();
      prefs[key] = !prefs[key]; savePrefs(); sync(); markMusic();
      // (switching music off keeps the game's wish, so switching it back on mid-game resumes it)
      if (key === 'music') { if (prefs.music) { if (on && !gameOverPending && winMsg?.kind !== 'gameover') sfx.musicStart(); } else sfx.musicStop(true); }
      else sfx.setSfx(prefs.sfx);
    });
    sync();
    document.documentElement.append(b);
    return b;
  };
  const musicBtn = makeSwitch('tss-music', 'music', ['M9 3v10.6A4 4 0 1 0 11 17V7h6V3z'], 'Music');
  const soundBtn = makeSwitch('tss-sound', 'sfx', ['M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7l1.4 1.4a7 7 0 0 0 0-9.8zM18.8 5.7a9 9 0 0 1 0 12.6l1.4 1.4a11 11 0 0 0 0-15.4z'], 'Sound effects');
  placeHud(); // (into the strip right of the timeline, if there's one yet)

  window.trif?.log('space shooter ready: Shift+S or the rocket button');
})();
