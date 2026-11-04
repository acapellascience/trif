// ==WebMod==
// @name        Space Shooter
// @description Fly a ship, blast the words
// @match       *://timsrobot.com/*
// @match       *://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  if (window.top !== window) return;

  const css = document.createElement('style');
  css.textContent = `
    [data-tss-dead] { visibility: hidden !important; } /* blasted words, bombed pieces, the destroyed robot */
    /* robot hit flash, on its parts: the <svg>'s own animation slot is Living robot's waddle and hop */
    svg.robot.tss-hurt > * { animation: tss-hurt 110ms ease-out; }
    @keyframes tss-hurt { from { filter: brightness(2.6) saturate(0.4); } to { filter: none; } }
    /* Living robot's legs follow the damage colour */
    svg.robot[data-tss-hp] .lr-legs line { stroke: var(--tss-robot-leg) !important; }
    svg.robot[data-tss-hp] .lr-legs ellipse { fill: var(--tss-robot-leg) !important; }
    /* (sized in pixels to the window as innerWidth/innerHeight measure it, like what's drawn: see resize) */
    #tss-canvas { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646; }
    #tss-hud { position: fixed; left: 12px; top: 8px; /* top, not bottom: see pin() */ z-index: 2147483647; pointer-events: none;
      font: 600 12px/1.4 ui-monospace, Menlo, monospace; color: #7ff; text-shadow: 0 0 6px #0ff; opacity: .85; }
    /* on a touchscreen, under the row of buttons along the top (the restart button has its corner) */
    #tss-hud.tss-touch { left: 16px; top: 64px; }
    /* "ROBOT DESTROYED": outside <body>, so Gravity mode leaves it hanging; its words are targets */
    /* (centred on, and its letters sized to, the window as innerWidth/innerHeight measure it: placeBanner) */
    #tss-banner { position: fixed; left: 50vw; top: 50vh; transform: translate(-50%, -50%); z-index: 2147483645;
      pointer-events: none; white-space: nowrap; }
    #tss-banner .tss-bn { display: inline-block; font: 900 clamp(40px, 9vw, 120px)/1 ui-monospace, Menlo, monospace;
      font-size: var(--tss-bn-size, clamp(40px, 9vw, 120px));
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
  const wrapWords = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!/\S/.test(n.data)) return NodeFilter.FILTER_REJECT;
        for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) {
          if (SKIP.has(el.tagName.toUpperCase()) || el.classList.contains('tss-w') || el.id === 'tss-hud' || el.isContentEditable) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const span = document.createElement('span');
        span.className = 'tss-w';
        span.textContent = part;
        frag.append(span);
      }
      node.replaceWith(frag);
    }
  };
  try { wrapWords(); } catch (e) { window.trif?.warn('wrap failed', String(e)); }
  // Other mods (and the site) may add text later: wrap it too, debounced.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { wrapWords(); } catch {} }, 300);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // --- Canvas and HUD
  const canvas = document.createElement('canvas');
  canvas.id = 'tss-canvas';
  const ctx = canvas.getContext('2d');
  const hud = document.createElement('div');
  hud.id = 'tss-hud';
  // On <html>, not <body>: tilt puts a transform on <body>, which would make these "fixed"
  // elements tilt and shrink with it (the ship then couldn't reach the bottom of the window).
  document.documentElement.append(canvas, hud);
  let W = 0, H = 0;
  const resize = () => {
    const dpr = devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    // In pixels, not 100vw/100vh: those can differ from what's drawn (a phone's 100vh includes the space
    // under its toolbar, which stretched the ship off the bottom of the screen).
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    placeBanner();
  };
  // "ROBOT DESTROYED" in the middle of the window, its letters as big as fit: 15 letters and a gap in a
  // wide monospace come to about 10.5 em, so about 8.5% of the width leaves a margin (a small phone too).
  const placeBanner = () => {
    let b;
    try { b = banner; } catch { return; } // (the first resize runs before `banner` is declared, below)
    if (!b) return;
    b.style.left = `${W / 2}px`; b.style.top = `${H / 2}px`;
    b.style.setProperty('--tss-bn-size', `${Math.round(Math.max(14, Math.min(120, W * 0.085)))}px`);
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

  // --- Sound effects, synthesized with Web Audio (nothing is loaded). Browsers only allow sound after a
  // gesture, so the audio starts on your first real key press or click.
  const sfx = (() => {
    let ac = null, out = null, noise = null, verb = null, room = null, mid = null, half = null, sheen = null, shaper = null, lastSmall = 0;
    const wake = (e) => {
      if (!e.isTrusted) return;
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
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (err) { window.trif?.warn('sound failed', String(err)); }
    };
    addEventListener('keydown', wake, true);
    addEventListener('pointerdown', wake, true);
    addEventListener('touchend', wake, true); // (a touchscreen only allows sound once a finger lifts)
    const run = (fn) => { if (ac && ac.state === 'running' && !document.hidden) try { fn(ac.currentTime); } catch {} };
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
  let lastShot = 0, score = 0, lastInput = -1e9, presses = 0; // presses: fresh space presses since the last frame

  const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  addEventListener('keydown', (e) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault(); // no page scrolling, no pressing the focused button
      if (e.key === ' ' && !e.repeat) presses++; // a fresh press (not the key repeating while held)
      keys[e.key] = true;
      lastInput = performance.now();
    } else if (e.key === 'r' || e.key === 'R') restart();
  }, true);
  const restart = () => { if (winEl) playAgainEased(); else if (!againBusy) restoreAll(); };
  const restoreAll = () => {
    removeBanner();
    // words and bombed pieces come back; the robot is rebuilt separately
    document.querySelectorAll('[data-tss-dead]:not(svg.robot)').forEach((w) => w.removeAttribute('data-tss-dead'));
    // Living robot listens: a rebuilt robot goes back home
    dispatchEvent(new CustomEvent('tss-restore', { detail: { robotRebuilt: rebuildRobot() } }));
  };
  addEventListener('keyup', (e) => { keys[e.key] = false; }, true);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // --- On a touchscreen there are no keys: hold the ship and drag it, and while you hold it, it fires as
  // fast as it can (or, in Gravity mode, drops bombs). A touch anywhere else is left to the page (it
  // scrolls, a firework goes up). Restart is a button in the top left (below), and the HUD keeps only
  // the counts.
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse) hud.classList.add('tss-touch');
  const GRAB = 36; // px of slack around the ship for a finger
  const grabBox = () => ({ left: ship.x - ship.w / 2 - GRAB, right: ship.x + ship.w / 2 + GRAB, top: ship.y - ship.h - GRAB, bottom: ship.y + GRAB });
  const touch = { id: null, x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0 }; // dx, dy: the finger's move since the last frame
  // Capture phase on the window, ahead of the page: a grab isn't also a click, a firework or (in Gravity
  // mode, which checks the box in the ship's `tss-ship` event) grabbing the piece under the ship.
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || touch.id !== null) return;
    if (performance.now() < deadUntil || e.target.closest?.('#trif-top-bar')) return;
    const b = grabBox();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) return;
    touch.id = e.pointerId; touch.x = e.clientX; touch.y = e.clientY; touch.dx = touch.dy = 0;
    presses++; // (the first shot straight away)
    e.stopPropagation();
  }, true);
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.id) return;
    touch.dx += e.clientX - touch.x; touch.dy += e.clientY - touch.y;
    touch.x = e.clientX; touch.y = e.clientY;
  }, true);
  const letGo = (e) => { if (e.pointerId === touch.id) { touch.id = null; touch.vx = touch.vy = 0; } };
  addEventListener('pointerup', letGo, true);
  addEventListener('pointercancel', letGo, true);
  // While the ship is held, the finger mustn't scroll or zoom the page (only touch events can stop that).
  const holdStill = (e) => { if (touch.id !== null && e.cancelable) e.preventDefault(); };
  addEventListener('touchstart', holdStill, { capture: true, passive: false });
  addEventListener('touchmove', holdStill, { capture: true, passive: false });

  const fire = (now) => {
    lastShot = now;
    muzzle = 0.07;
    const y = ship.y - ship.h * 0.6;
    lasers.push({ x: ship.x - 27, y }, { x: ship.x + 27, y });
    sfx.laser();
  };

  // Screen shake: nudges <html> with the `translate` property, which no other mod here sets on <html>
  // and which stacks with any `transform` (tilt) instead of replacing it.
  let shake = 0;
  const applyShake = (dt) => {
    const html = document.documentElement;
    if (shake > 0.3) {
      html.style.translate = `${((Math.random() - 0.5) * 2 * shake).toFixed(1)}px ${((Math.random() - 0.5) * 2 * shake).toFixed(1)}px`;
      shake *= Math.pow(0.0015, dt); // dies out in about a third of a second
    } else if (shake) {
      shake = 0;
      html.style.translate = '';
    }
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
        const sp = 300 + Math.random() * 500;
        bits.push({ ch: text.data[i], x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 320,
          rot: 0, vr: (Math.random() - 0.5) * 22, life: 2.4 + Math.random(), font, color,
          scale: 1, grow: 1.6 + Math.random() * 1.6 }); // letters balloon up as they fly
      }
    }
    const SPARK = ['#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f6d', '#ff6bf0'];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 650;
      bits.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.7,
        spark: true, size: 2 + Math.random() * 5, color: SPARK[i % SPARK.length] });
    }
    const R = 90 + r0.width * 0.8;
    rings.push({ x: cx, y: cy, t: 0, R });
    shake = Math.min(shake + 9, 20);
    sfx.boom(0.15);
    word.setAttribute('data-tss-dead', '');
    score++;
  };

  // --- Crashing into the robot (the site's <svg class="robot">) blows the ship up; it respawns
  // at the bottom after a moment, blinking and untouchable for a bit.
  let deadUntil = 0, safeUntil = 0, deaths = 0;
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
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 900;
      bits.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 0.6 + Math.random() * 1.4,
        spark: true, size: 2 + Math.random() * (i < 25 ? 14 : 6), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: cx, y: cy, t: 0, R: 260 }, { x: cx, y: cy, t: 0.1, R: 140 });
    shake = 24;
    lasers.length = 0;
    sfx.shipBoom();
    deadUntil = now + 1800;
    deaths++;
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
  function explodeRobot(x, y, size) { // the big one
    try {
      const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#e02626', '#ff6bf0'];
      for (let i = 0; i < 320; i++) {
        const a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 1200;
        bits.push({ x: x + (Math.random() - 0.5) * size * 0.6, y: y + (Math.random() - 0.5) * size * 0.6,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 250, life: 0.8 + Math.random() * 1.8,
          spark: true, size: 2 + Math.random() * (i < 40 ? 16 : 7), color: COLORS[i % COLORS.length] });
      }
      // Rainbow Rave mod on (its gradient is in the robot svg): the parts cycle through the rainbow
      // and the blast is a huge rainbow nova with rainbow shockwaves
      const rave = !!document.getElementById('trif-rave-robot');
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
    const n = Math.min(120, 30 + Math.round(r.width * r.height / 400));
    for (let i = 0; i < n; i++) { // shards from all over the box
      const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height;
      const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.8, sp = 200 + Math.random() * 600;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 250, life: 0.6 + Math.random() * 1.2,
        spark: true, size: 3 + Math.random() * 9, color: COLORS[i % COLORS.length] });
    }
    rings.push({ x: cx, y: cy, t: 0, R: 90 + Math.max(r.width, r.height) * 0.6 });
    shake = Math.min(shake + 12, 22);
    sfx.boom(0.45);
    el.setAttribute('data-tss-dead', '');
    score++;
  };

  // The "ROBOT DESTROYED" banner can't be hit until its letters have finished coming in (see showBanner).
  const shielded = (w) => !!w.closest('#tss-banner:not([data-tss-ready])');
  const hitWord = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList?.contains('tss-w') && !el.hasAttribute('data-tss-dead') && !shielded(el)) return el;
    }
    // elementsFromPoint skips pointer-events:none text: fall back to rects
    for (const w of document.querySelectorAll('.tss-w:not([data-tss-dead])')) {
      if (shielded(w)) continue;
      const r = w.getBoundingClientRect();
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
      const words = piece.matches('.tss-w') ? [piece] : [...piece.querySelectorAll('.tss-w:not([data-tss-dead])')];
      words.forEach((w, i) => {
        if (i < 6) explode(w); // letters fly (a few words' worth: a whole paragraph would be a blizzard)
        else { w.setAttribute('data-tss-dead', ''); score++; }
      });
      piece.setAttribute('data-tss-dead', '');
    }
    if (robotHit) hitRobot(x, y, BOMB_DAMAGE);
    dispatchEvent(new CustomEvent('tss-blast', { detail: { x, y, radius: BLAST_RADIUS, power: BLAST_POWER } }));
    const COLORS = ['#ffffff', '#fff6c2', '#ffd36b', '#ff9a3c', '#ff4f4f', '#ff6bf0'];
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 900;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 0.4 + Math.random() * 0.9,
        spark: true, size: 2 + Math.random() * (i < 20 ? 12 : 6), color: COLORS[i % COLORS.length] });
    }
    rings.push({ x, y, t: 0, R: BLAST_RADIUS * 1.3 }, { x, y, t: 0.1, R: BLAST_RADIUS * 0.7 });
    sfx.boom(0.7);
    shake = Math.min(shake + 16, 26);
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
    placeBanner();
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
    score = 0; deaths = 0; bombs.length = 0;
    leaving = 0; resetAt = 0; whooshed = false;
    ship.x = W / 2; ship.y = H + ship.h; // flies back in from below
    deadUntil = 0; safeUntil = performance.now() + 1800;
    returning = true;
  };

  // --- You Win: only for beating the robot with every timsrobot.com mod on. Each leaves a mark on the
  // page; if one's switched off (or its mark changes), the game just resets as usual.
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
  addEventListener('rave-kick', () => { // each ring stays where the ship was when it started
    if (pulses.length < 6) pulses.push({ t: 0, hue: (performance.now() / 4) % 360, x: ship.x, y: ship.y - ship.h * 0.45 });
  });
  let bank = 0, thrust = 0.5, muzzle = 0;
  const ENGINES = [-20, 20];
  const drawShip = (now, dt, visible) => {
    const dragBank = Math.max(-1, Math.min(1, touch.vx / 520)), dragUp = -touch.vy / 420;
    const wantBank = leaving || returning ? 0 : (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0) || dragBank;
    const wantThrust = leaving && now > leaving ? 2.2 : returning ? 1 : keys.ArrowUp || dragUp > 0.4 ? 1 : keys.ArrowDown || dragUp < -0.4 ? 0.15 : 0.5; // 2.2: afterburners
    bank += (wantBank - bank) * Math.min(1, dt * 9);
    thrust += (wantThrust - thrust) * Math.min(1, dt * 7);
    muzzle = Math.max(0, muzzle - dt);

    // Rainbow Rave mod on (its gradient is in the robot svg): rainbow flames and exhaust, and with its
    // music playing, a glowing rainbow ring pulses out from where the ship is on every kick drum
    const rave = !!document.getElementById('trif-rave-robot');
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
    for (const s of [-1, 1]) {
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
      ctx.fillStyle = '#7d8cad';
      ctx.beginPath(); ctx.roundRect(s * 27 - 3.5, -36, 7, 24, 3); ctx.fill();
      ctx.fillStyle = '#c9d6ee';
      ctx.fillRect(s * 27 - 1.5, -47, 3, 12);
      // wingtip light: red port, green starboard, blinking
      if (Math.floor(now / 500) % 2 === (s < 0 ? 0 : 1)) {
        ctx.save();
        ctx.fillStyle = s < 0 ? '#ff3b5c' : '#3bff8a'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(s * 50, -12, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

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

    // muzzle flashes
    if (muzzle > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of [-1, 1]) {
        const r = 10 * (muzzle / 0.07);
        const g = ctx.createRadialGradient(s * 27, -49, 0, s * 27, -49, r);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,107,240,0.8)'); g.addColorStop(1, 'rgba(255,107,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s * 27, -49, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

    // shield bubble while it can't be hurt after respawning
    if (now < safeUntil) {
      ctx.save();
      ctx.strokeStyle = `rgba(120,255,255,${0.35 + 0.25 * Math.sin(now / 60)})`; ctx.lineWidth = 2.5;
      ctx.shadowColor = '#0ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.ellipse(ship.x, ship.y - 38, 62, 50, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  };

  // The row of round buttons along the top of the window, shared by Space shooter (restart, on the left),
  // Rainbow Rave (music and kick zoom, once won) and Gravity mode (drop, on the right). Whichever mod
  // needs it first makes it; the others find it. With a left-hand button the row spreads out evenly along
  // the top; otherwise it gathers at the right. Light buttons, or the rave's dark ones while it's on.
  // On <html>, not <body> (the tilt card transforms <body>, and Gravity mode piles up what's in it), and
  // in the top layer where the browser has one (popover): there it stays on the window whatever <html>
  // does (the tilt card's perspective, the shooter's screen shake). Where there's no top layer, it's
  // measured every frame and nudged back. As wide as the window measures (the demo's panel narrows it).
  const topBar = () => {
    let bar = document.getElementById('trif-top-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'trif-top-bar';
    const style = document.createElement('style');
    style.textContent = `
      #trif-top-bar { position: fixed; inset: 0 auto auto 0; margin: 0; border: 0; background: none; color: inherit;
        overflow: visible; height: auto; z-index: 2147483647; box-sizing: border-box; width: 100vw;
        padding: 16px; display: flex; justify-content: flex-end; gap: 8px; pointer-events: none; }
      #trif-top-bar:has(> .trif-top-left) { justify-content: space-between; }
      #trif-top-bar > button { pointer-events: auto; flex: none; margin: 0; -webkit-tap-highlight-color: transparent; }
      :where(#trif-top-bar) > button.trif-top-btn { width: 40px; height: 40px; border-radius: 50%; padding: 0;
        display: flex; align-items: center; justify-content: center; cursor: pointer; color: #18181a;
        border: 1px solid rgba(0,0,0,0.15); background: rgba(255,255,255,0.88); box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      .trif-top-btn svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor;
        stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .trif-top-left { order: 0; } .wm-rainbow-zoom { order: 1; } .wm-rainbow-play { order: 2; } .trif-top-right { order: 3; }`;
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

  if (coarse) {
    const NS = 'http://www.w3.org/2000/svg';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trif-top-btn trif-top-left';
    button.title = 'Restart: bring back everything blasted';
    button.setAttribute('aria-label', 'Restart the space shooter');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const d of ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4.5h-4.5']) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    button.append(svg);
    button.addEventListener('click', (e) => { e.stopPropagation(); restart(); });
    topBar().append(button);
  }

  let prev = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    try {
      if (keys.ArrowLeft) ship.x -= 520 * dt;
      if (keys.ArrowRight) ship.x += 520 * dt;
      const dead = now < deadUntil;
      if (deadUntil && !dead) { // respawn
        deadUntil = 0;
        ship.x = W / 2; ship.y = H - 14;
        safeUntil = now + 1500;
      }
      const autopilot = victory(now, dt) || flyBackIn(dt);
      if (!dead && !autopilot) {
        if (keys.ArrowLeft) ship.x -= 520 * dt;
        if (keys.ArrowRight) ship.x += 520 * dt;
        if (keys.ArrowUp) ship.y -= 420 * dt;
        if (keys.ArrowDown) ship.y += 420 * dt;
        ship.x += touch.dx; ship.y += touch.dy; // (dragged)
        ship.x = Math.max(ship.w / 2, Math.min(W - ship.w / 2, ship.x));
        ship.y = Math.max(ship.h + 4, Math.min(H - 14, ship.y));
        // space: lasers normally; in Gravity mode (where lasers can't do much) it drops bombs instead,
        // one in the air at a time
        // Holding space fires at most every 150 ms; each new press fires straight away, however soon
        // after the last shot (even a tap too quick for a frame to see the key down).
        const firing = keys[' '] || touch.id !== null;
        if (gravityOn()) { if (presses || firing) dropBomb(now); } // (bombs: one in the air at a time)
        else if (presses || (firing && now - lastShot > 150)) fire(now);
        if (now > safeUntil && touchesRobot()) blowUpShip(now);
      }
      presses = 0; // (presses while the ship is down or on autopilot don't save up)
      // (nor drags; the drag's speed, smoothed, banks the ship and works its engines like the arrows)
      const k = Math.min(1, dt * 12);
      touch.vx += ((dt ? touch.dx / dt : 0) - touch.vx) * k; touch.vy += ((dt ? touch.dy / dt : 0) - touch.vy) * k;
      touch.dx = touch.dy = 0;
      // Tell the Living robot mod where the ship is (it chases an active ship). "Active" = flown
      // or fired in the last 5 s and not exploded.
      if (keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown || keys[' '] || touch.id !== null) lastInput = now;
      // (plus the bombs in the air, so the robot can see them coming and dodge)
      dispatchEvent(new CustomEvent('tss-ship', { detail: {
        x: ship.x, y: ship.y - ship.h * 0.45, active: !dead && !autopilot && now - lastInput < 5000,
        bombs: bombs.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })), bombGravity: BOMB_GRAVITY,
        grab: coarse && !dead && !autopilot ? grabBox() : null, // (where a finger takes the ship)
        deaths } })); // (the robot greets a fresh player differently from one he's already blown up)

      ctx.clearRect(0, 0, W, H);

      applyShake(dt);
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
        // fat bolt: hit anything under its centre or either edge
        const w = l.y > 0 && (hitWord(l.x, l.y) || hitWord(l.x - 5, l.y) || hitWord(l.x + 5, l.y));
        if (w) explode(w);
        const box = !w && l.y > 0 && !gravityOn() ? hitBox(l.x, l.y, now) : null;
        if (box) explodeBox(box);
        if (w || box || l.y < -40) { lasers.splice(i, 1); continue; }
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
      drawShip(now, dt, now >= deadUntil && (now > safeUntil || Math.floor(now / 100) % 2));
      hud.textContent = (coarse ? '' : `← → ↑ ↓ fly · space ${gravityOn() ? 'bomb' : 'fire'}`
        + (document.documentElement.hasAttribute('data-gm-ready') ? ' · G gravity' : '') // the Gravity mode mod is on
        + ' · R restore · ') + `${score} words blasted`
        + (deaths ? ` · ${deaths} death${deaths > 1 ? 's' : ''}` : '')
        + (robotHp && robotHp < ROBOT_HP ? ` · robot ${robotHp}/${ROBOT_HP}` : ''); // (destroyed: the big banner says so)
    } catch (e) { window.trif?.warn('frame failed', String(e)); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.trif?.log('space shooter ready', document.querySelectorAll('.tss-w').length, 'words');
})();
