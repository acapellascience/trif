// ==WebMod==
// @name        Rainbow Rave
// @description All text white, over a rolling psychedelic rainbow background, with a trance loop and switchable kick zoom; the robot logo and the "Get it" button get the fast mini-rainbow of X's rave badges
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
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

    body *, body *::placeholder, body *::before, body *::after { color: #fff !important; }
    body { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); }

    /* "Get it": the badges' fast mini-rainbow, with dark text so it stays readable on it. */
    @keyframes trif-rave-icons-roll {
      from { background-position: -40px -20px; }
      to { background-position: -23.029437px -36.970563px; }   /* one 24px period up the diagonal */
    }
    html body a.btn:not(.plain) {
      background-color: transparent !important;
      background-image: ${MINI} !important;
      background-size: 400px 200px !important; background-repeat: no-repeat !important;
      animation: trif-rave-icons-roll 0.8s linear infinite !important;
      color: #000 !important; text-shadow: none !important;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85);
    }

    .wm-rainbow-music { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 40px; height: 40px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.6) !important; background-color: rgba(0,0,0,0.5) !important;
      padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .wm-rainbow-music svg { width: 20px; height: 20px; fill: #fff; display: block; }
    .wm-rainbow-zoom { right: 64px; }
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
      return true;
    } catch (e) { window.trif?.warn('robot rainbow failed', String(e)); return true; }
  };
  if (!rainbowRobot()) addEventListener('DOMContentLoaded', rainbowRobot);
  // Another mod (Red robot) may reset the glow at DOMContentLoaded: set ours once more after load.
  addEventListener('load', () => {
    try { svgGlow(); } catch {}
  });
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
  const announceKick = (t) => {
    const ms = (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
    const at = performance.now() + ms;
    setTimeout(() => kickPulse(at), Math.max(0, ms));
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
      while (next < now + 0.3) { play(step, next); next += STEP; step = (step + 1) % 64; }
    } catch (e) { window.trif?.warn('music failed', String(e)); stop(); }
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
      next = ctx.currentTime + 0.05; lastClock = -1; stalledSince = 0;
    }
    ctx.resume();
    if (!timer) { next = ctx.currentTime + 0.05; lastClock = -1; stalledSince = 0; timer = setInterval(tick, 100); }
  };
  const unstick = () => { if (musicOn && stale) { try { start(); } catch (err) { window.trif?.warn('music restart failed', String(err)); } } };
  addEventListener('pointerdown', unstick, true);
  addEventListener('keydown', unstick, true);
  const stop = () => { clearInterval(timer); timer = 0; ctx?.suspend(); };
  const sync = () => {
    if (musicOn && !document.hidden && ctx) start(); else stop();
    if (button) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', musicOn ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
      svg.append(path);
      button.replaceChildren(svg);
      button.setAttribute('aria-label', musicOn ? 'Pause rainbow music' : 'Play rainbow music');
    }
  };
  document.addEventListener('visibilitychange', sync);

  // Autoplay on the first click or keypress (browsers only allow sound after a gesture).
  const firstGesture = (e) => {
    if (button && e.composedPath().includes(button)) return;
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

  // ---- Kick zoom: the page's blocks zoom with each kick, around the centre of the screen. ----
  // One endless beat-long animation per block, sharing one start time locked to the kicks (see X's version
  // for why: restarting per kick re-rasterizes everything twice a beat).
  let zoomOn = true;
  try { zoomOn = localStorage.getItem('wmRainbow.zoom') !== 'off'; } catch {}
  const BEAT = 60000 / BPM;
  const PULSE = [{ scale: 1.05, easing: 'steps(4)' }, { scale: 1, offset: 280 / BEAT }, { scale: 1 }];
  const TIMING = { duration: BEAT, iterations: Infinity };
  const blocks = () => [...document.querySelectorAll('main > section, body > footer')];

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
    add('M12 9.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5z');
    add('M15.5 8.5a5 5 0 0 1 0 7M8.5 8.5a5 5 0 0 0 0 7', true);
    add('M18.5 5.5a9.2 9.2 0 0 1 0 13M5.5 5.5a9.2 9.2 0 0 0 0 13', true, 0.55);
    if (!zoomOn) add('M4 4 20 20', true);
    zoomButton.replaceChildren(svg);
    zoomButton.setAttribute('aria-pressed', String(zoomOn));
    zoomButton.setAttribute('aria-label', zoomOn ? 'Turn off kick zoom' : 'Turn on kick zoom');
    zoomButton.title = zoomOn ? 'Kick zoom on: click to turn it off' : 'Kick zoom off: click to turn it on';
  };
  const addButtons = () => {
    zoomButton = document.createElement('button');
    zoomButton.className = 'wm-rainbow-music wm-rainbow-zoom';
    zoomButton.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomOn = !zoomOn;
      try { localStorage.setItem('wmRainbow.zoom', zoomOn ? 'on' : 'off'); } catch {}
      syncZoom();
    });
    document.body.append(zoomButton);
    syncZoom();
    button = document.createElement('button');
    button.className = 'wm-rainbow-music';
    button.title = 'Play/pause rainbow music';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEventListener('pointerdown', firstGesture, true);
      removeEventListener('keydown', firstGesture, true);
      musicOn = !musicOn;
      try { if (musicOn) start(); } catch (err) { window.trif?.warn('music failed', String(err)); musicOn = false; }
      sync();
    });
    document.body.append(button);
    sync();
  };
  if (document.body) addButtons(); else addEventListener('DOMContentLoaded', addButtons);
})();
