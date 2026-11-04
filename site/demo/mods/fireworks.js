// ==WebMod==
// @name        Click Fireworks
// @description Every click launches a firework
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  // The row of round buttons along the top of the window: five places, evenly spread, each button always in
  // its own (whichever others are there): Space shooter's restart, Rainbow Rave's kick zoom (once won), the
  // courtesy mute (from the first sound on), Rainbow Rave's music (once won), Gravity mode's drop. Whichever
  // mod needs it first makes it; the others find it. Light buttons, or the rave's dark ones while it's on.
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
        padding: 16px; display: grid; grid-template-columns: repeat(5, 40px); justify-content: space-between;
        pointer-events: none; }
      #trif-top-bar > button { pointer-events: auto; grid-row: 1; margin: 0; -webkit-tap-highlight-color: transparent; }
      :where(#trif-top-bar) > button.trif-top-btn { width: 40px; height: 40px; border-radius: 50%; padding: 0;
        display: flex; align-items: center; justify-content: center; cursor: pointer; color: #18181a;
        border: 1px solid rgba(0,0,0,0.15); background: rgba(255,255,255,0.88); box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      .trif-top-btn svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor;
        stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .trif-top-left { grid-column: 1; } .wm-rainbow-zoom { grid-column: 2; } .trif-top-mute { grid-column: 3; }
      .wm-rainbow-play { grid-column: 4; } .trif-top-right { grid-column: 5; }`;
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
  // Rainbow Rave): the middle button in the row along the top, there from the first sound on. It silences
  // all of them (each one suspends its own audio while it's on: the `trif-mute` event), and this browser
  // remembers it.
  const MUTED = 'trif.muted';
  const isMuted = () => { try { return localStorage.getItem(MUTED) === '1'; } catch { return false; } };
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
      add('M12 9.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5z', true);
      add('M15.5 8.5a5 5 0 0 1 0 7M8.5 8.5a5 5 0 0 0 0 7');
      add('M18.5 5.5a9.2 9.2 0 0 1 0 13M5.5 5.5a9.2 9.2 0 0 0 0 13', false, 0.55);
      if (muted) add('M4 4 20 20');
      b.replaceChildren(svg);
      b.setAttribute('aria-pressed', String(muted));
      b.setAttribute('aria-label', muted ? 'Sound off: turn it back on' : 'Mute the sound');
      b.title = muted ? 'Sound off (click to turn it on)' : 'Mute';
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      try { localStorage.setItem(MUTED, isMuted() ? '' : '1'); } catch {}
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
          ac = new AudioContext();
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
        muteButton(); // (its first sound: the courtesy mute appears)
        if (ac.state === 'suspended' && !isMuted()) ac.resume();
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
    const live = () => ac && ac.state === 'running' && !document.hidden;
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
          if (!ac || ac.state !== 'running' || document.hidden) return;
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
    const n = scale < 1 ? 40 : 320;
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
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        add(Math.cos(a) * vmax * 1.05, Math.sin(a) * vmax * 1.05, base + 180 + i * 4, { width: 3.5 });
      }
      // Inner core of a third colour
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
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
        ctx.strokeStyle = `hsla(${s.hue}, 100%, ${50 + s.life * 30}%, ${Math.min(1, s.life * 1.4)})`;
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
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

  // Every click (capture phase, so nothing on the page can swallow it) launches a rocket.
  document.addEventListener('pointerdown', (e) => {
    try {
      if (e.button !== 0) return;
      launch(e.clientX, e.clientY);
      start();
    } catch (err) { window.trif?.warn(String(err)); }
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
