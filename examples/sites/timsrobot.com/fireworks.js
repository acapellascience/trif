// ==WebMod==
// @name        Click Fireworks
// @description Every click launches a firework from the bottom of the screen that bursts where you clicked; hovering "Get it" sprays confetti
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  if (window.__fwInstalled) return;
  window.__fwInstalled = true;

  // One full-screen canvas on top of everything; pointer-events: none so clicks pass through.
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-fw-canvas', '');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
  document.documentElement.append(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1, W = 0, H = 0;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const rockets = [], sparks = [], confetti = [];
  const rand = (a, b) => a + Math.random() * (b - a);
  const PALETTES = [[0, 30, 50], [200, 280, 320], [120, 160, 60], [40, 330, 190], [270, 300, 0]];

  const launch = (tx, ty) => {
    const x = tx + rand(-60, 60);
    rockets.push({ x, y: H + 5, sx: x, sy: H + 5, tx, ty, t: 0, dur: rand(0.55, 0.8), trail: [], hue: rand(0, 360) });
  };

  const MAX_SPARKS = 5000; // keep it smooth when clicking like mad

  // HUGE bursts: radius scales with the window (about half the screen across).
  // A spark at speed v with drag 0.965/frame travels ~v/0.035 px, so v = R * 0.035.
  const burst = (x, y, scale = 1) => {
    const R = Math.max(W, H) * 0.27 * scale;
    // Big bursts (not the little crackles) are announced, in window coordinates, so other mods can
    // react (Living robot shies away from ones near him).
    if (scale >= 0.5) dispatchEvent(new CustomEvent('firework-burst', { detail: { x, y, radius: R } }));
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
  const clearAll = () => { rockets.length = 0; sparks.length = 0; confetti.length = 0; };
  addEventListener('tss-again-out', clearAll);
  addEventListener('tss-again-in', clearAll);
  document.addEventListener('pointerout', (e) => {
    if (hoverEl && !hoverEl.contains(e.relatedTarget)) hoverEl = null;
  }, true);

  window.trif?.log('fireworks ready');
})();
