// ==WebMod==
// @name        Double-Click Fireworks
// @touch-name  Tap Fireworks
// @description Double-click (or tap) to launch a firework
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
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
    if (e.composedPath?.().some((n) => n.id === 'trif-mute' || n.classList?.contains('demo-panel') || n.classList?.contains('demo-tab'))) return; // (nor the demo's panel)
    setMuted(false);
    dispatchEvent(new CustomEvent('trif-mute', { detail: { muted: false } }));
  };
  // One audio engine for every mod that makes sound (window.__trifAudio). A browser, an iPhone's above all,
  // only lets an engine play once a real tap has switched it on, and dragging the ship around may not count:
  // with one engine, any tap that switched it on lets every mod play, the ship and the rave's music (which
  // arrives later) included. The mute suspends and resumes it; nothing closes it.
  function trifAudio() {
    let a = window.__trifAudio;
    if (!a || a.state === 'closed') {
      // (on an iPhone, sound plays as media, so the silent switch doesn't mute it: Safari's audio session)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
      a = window.__trifAudio = new AudioContext();
    }
    return a;
  }
  // The demo's Send (in its panel, a frame of its own: its taps never reach the page) counts as the tap that
  // turns the sound on. On a phone the next thing is often the ship, grabbed and held, and a hold never
  // lets a browser start sound: so the panel calls this from inside its tap (shim.js), while the tap still
  // counts. Not if the sound was switched off with the button.
  if (!window.__trifSendGesture) window.__trifSendGesture = () => {
    try {
      if (muteChoice() === '1' || !document.getElementById('trif-mute')) return;
      const a = trifAudio();
      if (!window.__trifSoundLive) { setMuted(false); dispatchEvent(new CustomEvent('trif-mute', { detail: { muted: false } })); }
      a.resume();
      if (!a.__trifUnlocked) { // (as on a finger's first lift: a silent blip unlocks it for good)
        a.__trifUnlocked = true;
        const blip = a.createBufferSource(); blip.buffer = a.createBuffer(1, 1, 22050); blip.connect(a.destination); blip.start(0);
      }
    } catch {}
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

  if (window.__fwInstalled) return;
  window.__fwInstalled = true;

  // One full-screen canvas on top of everything; pointer-events: none so clicks pass through.
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-fw-canvas', '');
  // (sized in pixels to the window as innerWidth/innerHeight measure it, like what it draws: 100vw/100vh can
  // differ, e.g. a phone's 100vh includes the space under its toolbar, which stretched the drawing)
  canvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.append(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1, W = 0, H = 0;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  // Keep it on the window: when <html> has a `perspective` (Tilt Card) or a `translate` (the shooter's
  // shake), "fixed" is placed against the page instead, so the bursts landed off target once scrolled.
  let pinX = 0, pinY = 0;
  const pin = () => {
    const r = canvas.getBoundingClientRect();
    if (Math.abs(r.left) < 0.5 && Math.abs(r.top) < 0.5) return;
    pinX -= r.left; pinY -= r.top;
    canvas.style.translate = `${pinX}px ${pinY}px`;
  };
  resize();
  addEventListener('resize', resize);

  const rockets = [], sparks = [], confetti = [];
  const rand = (a, b) => a + Math.random() * (b - a);
  const PALETTES = [[0, 30, 50], [200, 280, 320], [120, 160, 60], [40, 330, 190], [270, 300, 0]];

  const launch = (tx, ty) => {
    const x = tx + rand(-60, 60);
    rockets.push({ x, y: H + 5, sx: x, sy: H + 5, tx, ty, t: 0, dur: rand(0.55, 0.8), trail: [], hue: rand(0, 360) });
    sound.thud();
  };

  const MAX_SPARKS = 5000; // keep it smooth when clicking like mad

  // --- The boom of each big burst: the same recipe as Space Shooter's robot explosion (a crack, a deep
  // saturated "dmmm" with a fifth above, a dark roar whose highs roll off fast, aftershocks and a low
  // rolling rumble), in a reverb half as long (1.5 s). Synthesized with Web Audio, nothing loaded; starts
  // on your first real click (browsers only allow sound after one).
  const sound = (() => {
    let ac = null, out = null, noise = null, verb = null, short = null, curve = null, last = 0;
    const wake = (e) => {
      if (!e.isTrusted) return;
      try {
        if (!ac) {
          // (on an iPhone, sound plays as media, so the silent switch doesn't mute it: Safari's audio session)
          try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
          ac = trifAudio(); // (shared by all the sound mods: see trifAudio)
          const comp = ac.createDynamicsCompressor();
          out = ac.createGain(); out.gain.value = 0.5;
          // +6 dB (×2) after the compressor, to sit level with Rainbow Rave's music
          const boost = ac.createGain(); boost.gain.value = 2;
          out.connect(comp); comp.connect(boost); boost.connect(ac.destination);
          noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          const makeVerb = (sec) => { // a dark made-up room: decaying, smoothed noise
            const len = Math.round(ac.sampleRate * sec), ir = ac.createBuffer(2, len, ac.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
              const b = ir.getChannelData(ch);
              let lp = 0;
              for (let i = 0; i < len; i++) { lp += 0.08 * (Math.random() * 2 - 1 - lp); b[i] = lp * 3 * Math.pow(1 - i / len, 2.5); }
            }
            const conv = ac.createConvolver();
            conv.buffer = ir;
            const send = ac.createGain();
            send.connect(conv); conv.connect(out);
            return send;
          };
          verb = makeVerb(1.5);
          short = makeVerb(0.5); // the launch thud's
          curve = new Float32Array(1024);
          for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5 - 1) * 3);
        }
        gestureUnmute(e); // (the button's showing and nothing's chosen: this click turns the sound on)
        if (isMuted()) { if (ac.state === 'running') ac.suspend(); }
        else {
          if (ac.state !== 'running') ac.resume();
          // iPhone Safari unlocks sound only as a finger lifts, and a context made as it went down can say it's
          // running while it plays nothing (a mod added after the visitor unmuted: silent until the mute was
          // toggled). So on the first lift, resume and play a silent blip, which unlocks it for good.
          if (e.type === 'touchend' && !ac.__trifUnlocked) {
            ac.__trifUnlocked = true;
            ac.resume();
            const blip = ac.createBufferSource(); blip.buffer = ac.createBuffer(1, 1, 22050); blip.connect(ac.destination); blip.start(0);
          }
        }
      } catch (err) { window.trif?.warn('firework sound failed', String(err)); }
    };
    // The courtesy mute: suspended while it's on, back on when it's off.
    addEventListener('trif-mute', () => { try { if (ac) { if (isMuted()) ac.suspend(); else ac.resume(); } } catch {} });
    addEventListener('pointerdown', wake, true);
    addEventListener('touchend', wake, true); // (a touchscreen only allows sound once a finger lifts)
    addEventListener('keydown', wake, true);
    const env = (t, peak, attack, decay, wet, bus = verb) => {
      const g = ac.createGain();
      // Silent from the start: a new gain node is at full volume (1) until its first scheduled value
      // takes over, and that can land a render block late, letting a few ms of sound through at full
      // volume (a loud snap that no level setting turned down).
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(out);
      if (wet > 0) { const s = ac.createGain(); s.gain.value = wet; g.connect(s); s.connect(bus); }
      return g;
    };
    const dmm = (t, f0, len, peak, wet) => { // a low tone sagging in pitch, saturated for body, darkened
      const o = ac.createOscillator(), pre = ac.createGain(), sh = ac.createWaveShaper(), f = ac.createBiquadFilter();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + len);
      pre.gain.value = 1.6; sh.curve = curve;
      f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.7;
      o.connect(pre); pre.connect(sh); sh.connect(f); f.connect(env(t, peak, 0.012, len, wet));
      o.start(t); o.stop(t + len + 0.1);
    };
    const rumble = (t, from, to, len, peak, wet, attack = 0.01, fall = 0) => { // filtered noise
      const src = ac.createBufferSource(), f = ac.createBiquadFilter();
      src.buffer = noise; src.loop = true;
      f.type = 'lowpass'; f.Q.value = 0.5;
      f.frequency.setValueAtTime(from, t);
      if (fall) f.frequency.setTargetAtTime(to, t, fall / 3); else f.frequency.exponentialRampToValueAtTime(to, t + len);
      src.connect(f); f.connect(env(t, peak, attack, len, wet));
      src.start(t, Math.random()); src.stop(t + len + 0.1);
    };
    // (a sound meant to play: the courtesy mute turns up, if it hasn't, and stays quiet until it's off)
    const live = () => { if (document.hidden) return false; if (ac?.state === 'running') return true; muteButton(); return false; };
    let lastCrackle = 0;
    return {
      // launch: a small, dull thud (a short low tone and a puff of dark noise), in a 0.5 s room
      thud: () => {
        try {
          if (!live()) return;
          const t = ac.currentTime, o = ac.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(150, t);
          o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
          o.connect(env(t, 0.22, 0.004, 0.13, 0.5, short));
          o.start(t); o.stop(t + 0.2);
          const src = ac.createBufferSource(), f = ac.createBiquadFilter();
          src.buffer = noise;
          f.type = 'lowpass'; f.frequency.setValueAtTime(450, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.08);
          src.connect(f); f.connect(env(t, 0.07, 0.003, 0.08, 0.5, short));
          src.start(t, Math.random()); src.stop(t + 0.15);
        } catch {}
      },
      // the secondary sprays: a smooth wash of white noise that fades in as the volley starts and out
      // after it (one per volley: later sprays in the same volley ride on it)
      crackle: () => {
        try {
          if (!live()) return;
          const t = ac.currentTime;
          if (t < lastCrackle) return; // a wash is still playing
          const IN = 0.25, HOLD = 0.175, OUT = 0.8, LEVEL = 0.0135;
          lastCrackle = t + IN + HOLD + OUT; // one at a time: never overlapping
          // stereo width: two unrelated stretches of noise, one hard left, one hard right (the same noise in
          // both ears would sit in the middle)
          const g = ac.createGain(), merge = ac.createChannelMerger(2), srcs = [];
          for (const ch of [0, 1]) {
            const src = ac.createBufferSource(), f = ac.createBiquadFilter();
            src.buffer = noise; src.loop = true;
            f.type = 'highpass'; f.frequency.value = 2500;
            src.connect(f); f.connect(merge, 0, ch);
            srcs.push(src);
          }
          g.gain.value = 0; // (silent from the start: see env)
          merge.connect(g);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(LEVEL, t + IN);
          g.gain.setValueAtTime(LEVEL, t + IN + HOLD);
          g.gain.linearRampToValueAtTime(0, t + IN + HOLD + OUT);
          g.connect(out);
          // into the firework's reverb, as much as the boom's aftershocks (it's dark, and this is bright
          // hiss, so it needs a strong send to be heard there)
          const s = ac.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(verb);
          const at = Math.random();
          srcs.forEach((src, i) => { src.start(t, (at + i * 0.9) % 2); src.stop(t + IN + HOLD + OUT + 0.05); });
        } catch {}
      },
      boom: () => {
        try {
          if (!live()) return;
          const t = ac.currentTime;
          if (t - last < 0.06) return; // clicking like mad: not a wall of booms
          last = t;
          const f0 = 46 + Math.random() * 8, len = 1.2;
          dmm(t, f0, len, 0.45, 0.45);
          dmm(t, f0 * 1.5, len * 0.6, 0.12, 0.2);
          rumble(t, 1100, 50, len, 0.24, 0.3, 0.01, 0.3);     // the roar
          rumble(t, 2000, 200, 0.12, 0.2, 0.3, 0.003, 0.05);  // the crack
          rumble(t, 220, 35, 1.6, 0.18, 0.6, 0.12);           // the low rolling rumble (half the robot's)
          [[0.14, 0.55], [0.35, 0.35], [0.62, 0.2]].forEach(([dt, k], i) => { // aftershocks, closer together
            dmm(t + dt, f0 * (0.9 - i * 0.08), len * 0.6, 0.35 * k + 0.05, 0.6);
            rumble(t + dt, 320, 40, len * 0.6, 0.12 * k + 0.02, 0.6, 0.03, 0.2);
          });
        } catch {}
      },
    };
  })();

  // HUGE bursts: radius scales with the window (about half the screen across).
  // A spark at speed v with drag 0.965/frame travels ~v/0.035 px, so v = R * 0.035.
  const burst = (x, y, scale = 1) => {
    const R = Math.max(W, H) * 0.27 * scale;
    // Big bursts (not the little crackles) are announced, in window coordinates, so other mods can
    // react (Living robot shies away from ones near him).
    if (scale >= 0.5) dispatchEvent(new CustomEvent('firework-burst', { detail: { x, y, radius: R } }));
    if (scale >= 1) sound.boom(); else sound.crackle(); // (the little bursts are the secondary sprays)
    const vmax = R * 0.035;
    const style = Math.random();
    const rainbow = style < 0.45; // full spectrum around the circle
    const pal = PALETTES[(Math.random() * PALETTES.length) | 0];
    const base = rand(0, 360);
    // (fewer sparks on a small screen, where the bursts are smaller anyway: a phone can't draw a desktop's)
    const density = Math.max(0.5, Math.min(1, Math.sqrt((W * H) / (1440 * 900))));
    const n = Math.round((scale < 1 ? 40 : 320) * density);
    const add = (vx, vy, hue, extra) => {
      if (sparks.length < MAX_SPARKS) sparks.push({ x, y, px: x, py: y, vx, vy, life: 1, decay: rand(0.006, 0.011) / Math.max(scale, 0.6),
        hue, glitter: Math.random() < 0.35, width: rand(2, 3.5) * Math.max(scale, 0.6), ...extra });
    };
    // Main shell: a full sphere of sparks
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = vmax * Math.sqrt(Math.random()) * rand(0.85, 1); // even fill, not clumped at the centre
      const hue = rainbow ? (a / (Math.PI * 2)) * 360 + base : pal[i % pal.length] + rand(-15, 15);
      add(Math.cos(a) * sp, Math.sin(a) * sp, hue,
        scale >= 1 && Math.random() < 0.06 ? { crackle: true } : null);
    }
    if (scale >= 1) {
      // Bright outer ring in a contrasting colour
      const ring = Math.round(90 * density), core = Math.round(60 * density);
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        add(Math.cos(a) * vmax * 1.05, Math.sin(a) * vmax * 1.05, base + 180 + i * 4 * (90 / ring), { width: 3.5 });
      }
      // Inner core of a third colour
      for (let i = 0; i < core; i++) {
        const a = (i / core) * Math.PI * 2;
        add(Math.cos(a) * vmax * 0.45, Math.sin(a) * vmax * 0.45, base + 90, null);
      }
    }
    // flash
    sparks.push({ flash: true, x, y, life: 1, decay: 0.08, r: R * 0.5 * Math.max(scale, 0.3) });
  };

  const sprayConfetti = (rect) => {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (let i = 0; i < 6; i++) {
      const a = rand(-Math.PI, 0) + rand(-0.3, 0.3); // mostly upwards
      const sp = rand(3, 8);
      confetti.push({ x: cx + rand(-rect.width / 2, rect.width / 2), y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        w: rand(5, 9), h: rand(3, 6), rot: rand(0, Math.PI), vr: rand(-0.3, 0.3), flip: rand(0, Math.PI), vf: rand(0.1, 0.3),
        color: `hsl(${rand(0, 360) | 0} 95% 60%)`, life: 1 });
    }
  };

  let running = false;
  const frame = () => {
    try {
      pin();
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += 1 / 60 / r.dur;
        const e = 1 - Math.pow(1 - Math.min(r.t, 1), 3); // ease-out: slows near the top
        r.x = r.sx + (r.tx - r.sx) * e + Math.sin(r.t * 20) * 1.5;
        r.y = r.sy + (r.ty - r.sy) * e;
        r.trail.push([r.x, r.y]);
        if (r.trail.length > 14) r.trail.shift();
        r.trail.forEach(([x, y], k) => {
          ctx.fillStyle = `hsla(40, 100%, ${60 + k * 2}%, ${k / r.trail.length})`;
          ctx.beginPath(); ctx.arc(x + rand(-1, 1), y, 1 + k / 8, 0, 7); ctx.fill();
        });
        if (r.t >= 1) { rockets.splice(i, 1); burst(r.tx, r.ty); }
      }

      // Sparks are drawn in batches: those of about the same colour, brightness and width share one path
      // and one stroke (a big burst is over a thousand sparks, and a stroke each, with its own colour
      // string, every frame, was more than a phone could draw)
      const batches = new Map();
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= s.decay;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        if (s.flash) {
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
          g.addColorStop(0, `rgba(255,255,230,${s.life * 0.7})`); g.addColorStop(1, 'rgba(255,255,230,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
          continue;
        }
        s.vx *= 0.965; s.vy = s.vy * 0.965 + 0.06;
        s.x += s.vx; s.y += s.vy;
        // Crackle sparks split into small coloured bursts partway through
        if (s.crackle && s.life < 0.55) { sparks.splice(i, 1); burst(s.x, s.y, 0.18); continue; }
        if (s.glitter && s.life < 0.6 && Math.random() < 0.5) continue; // twinkle as it fades
        // Long streak behind each spark (a few frames of motion) so the shell looks like real trails
        const tx = s.x - s.vx * 6, ty = s.y - s.vy * 6;
        const hue = Math.round((((s.hue % 360) + 360) % 360) / 12) * 12, life = Math.ceil(s.life * 12) / 12, width = Math.round(s.width * 2) / 2;
        const key = hue * 1e4 + life * 1e3 + width;
        let b = batches.get(key);
        if (!b) batches.set(key, (b = { hue, life, width, segs: [] }));
        b.segs.push(tx, ty, s.x, s.y);
      }
      ctx.lineCap = 'round';
      for (const b of batches.values()) {
        ctx.strokeStyle = `hsla(${b.hue}, 100%, ${50 + b.life * 30}%, ${Math.min(1, b.life * 1.4)})`;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        for (let k = 0; k < b.segs.length; k += 4) { ctx.moveTo(b.segs[k], b.segs[k + 1]); ctx.lineTo(b.segs[k + 2], b.segs[k + 3]); }
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vx *= 0.98; c.vy = c.vy * 0.98 + 0.18;
        c.x += c.vx + Math.sin(c.flip) * 0.6; c.y += c.vy;
        c.rot += c.vr; c.flip += c.vf;
        if (c.y > H + 20) c.life = 0;
        if (c.life <= 0) { confetti.splice(i, 1); continue; }
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.scale(1, Math.cos(c.flip));
        ctx.fillStyle = c.color; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
      }

      if (hoverEl) {
        hoverTick++;
        if (hoverTick % 2 === 0 && shown(hoverEl)) sprayConfetti(hoverEl.getBoundingClientRect());
      }
    } catch (e) { window.trif?.warn('fireworks frame failed', String(e)); }

    if (rockets.length || sparks.length || confetti.length || hoverEl) requestAnimationFrame(frame);
    else { running = false; ctx.clearRect(0, 0, W, H); }
  };
  const start = () => { if (!running) { running = true; requestAnimationFrame(frame); } };

  // A double-click launches a rocket (capture phase, so nothing on the page can swallow it): two clicks
  // close together in time and place, so a single click doesn't set one off by accident. On a
  // touchscreen, a tap: launched as the finger lifts, and only if it barely moved, so grabbing and
  // throwing something (Gravity mode's words and robot, the shooter's ship) isn't a tap. (Movement only,
  // no time limit: a busy page can take a long while to see the finger lift, and a tap mustn't be lost.)
  // Never from the buttons along the top (mute, restart, drop: they do their own thing).
  // (nor from the demo's panel or tab, which sit over the page: their touches are theirs)
  const onTopBar = (e) => !!e.target.closest?.('#trif-top-bar, .demo-panel, .demo-tab');
  let lastDown = null, touchDown = null;
  document.addEventListener('pointerdown', (e) => {
    try {
      if (e.button !== 0 || onTopBar(e)) return;
      if (e.pointerType === 'touch') { touchDown = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      const prev = lastDown;
      lastDown = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (!prev || e.timeStamp - prev.t > 450 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 24) return;
      lastDown = null; // (a third click starts the next pair)
      launch(e.clientX, e.clientY);
      start();
    } catch (err) { window.trif?.warn(String(err)); }
  }, true);
  document.addEventListener('pointerup', (e) => {
    try {
      const down = touchDown;
      if (e.pointerType !== 'touch' || !down || down.id !== e.pointerId) return;
      touchDown = null;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return; // a drag or a throw
      launch(e.clientX, e.clientY);
      start();
    } catch (err) { window.trif?.warn(String(err)); }
  }, true);
  document.addEventListener('pointercancel', (e) => { if (touchDown?.id === e.pointerId) touchDown = null; }, true); // (the page scrolled)

  // ...without the double-click selecting the word under it (text boxes keep theirs).
  document.addEventListener('mousedown', (e) => {
    if (e.detail > 1 && e.button === 0 && !e.target.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"]), .demo-panel, .demo-tab')) e.preventDefault();
  }, true);

  // "Get it" button: matched by its text, since it has no id; any link/button reading "Get it".
  const isGetIt = (el) => el && /^\s*get it\s*$/i.test(el.textContent || '');
  // No confetti from a button that isn't (fully) there: Space shooter's You Win fades it back in
  const shown = (el) => !el.matches('.tss-win-fadein, .tss-win-faded *') && parseFloat(getComputedStyle(el).opacity) > 0.9;
  let hoverEl = null, hoverTick = 0;
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('a, button');
    if (isGetIt(el) && el !== hoverEl) {
      hoverEl = el; hoverTick = 0;
      if (shown(el)) { sprayConfetti(el.getBoundingClientRect()); sprayConfetti(el.getBoundingClientRect()); }
      start();
    }
  }, true);
  // Space shooter's "play again?" fades the page out and resets it: the rocket its click launched (and
  // anything still in the air) goes, so nothing bursts over the fresh page.
  // Other mods can set one off: `firework-launch` { x, y } (window coordinates) sends a rocket up to burst
  // there, like a click would (Space Shooter's You Win launches an arc of them).
  addEventListener('firework-launch', (e) => {
    try {
      const { x, y } = e.detail || {};
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      launch(x, y);
      start();
    } catch (err) { window.trif?.warn(String(err)); }
  });
  const clearAll = () => { rockets.length = 0; sparks.length = 0; confetti.length = 0; };
  addEventListener('tss-again-out', clearAll);
  addEventListener('tss-again-in', clearAll);
  document.addEventListener('pointerout', (e) => {
    if (hoverEl && !hoverEl.contains(e.relatedTarget)) hoverEl = null;
  }, true);

  window.trif?.log('fireworks ready');
})();
