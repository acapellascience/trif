// ==WebMod==
// @name        Space shooter
// @description A little ship flies along the bottom of the page: arrow keys move it, space fires lasers, and any word you hit explodes into its letters. R brings the words back
// @match       *://timsrobot.com/*
// @match       *://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// ==/WebMod==

(() => {
  if (window.top !== window) return;

  const css = document.createElement('style');
  css.textContent = `
    .tss-w[data-tss-dead] { visibility: hidden !important; }
    #tss-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
    #tss-hud { position: fixed; left: 12px; bottom: 8px; z-index: 2147483647; pointer-events: none;
      font: 600 12px/1.4 ui-monospace, Menlo, monospace; color: #7ff; text-shadow: 0 0 6px #0ff; opacity: .85; }
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
  document.body.append(canvas, hud);
  let W = 0, H = 0;
  const resize = () => {
    const dpr = devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  // --- Game state
  const ship = { x: innerWidth / 2, w: 102, h: 78 };
  const keys = {};
  const lasers = [];
  const bits = []; // letters and sparks
  let lastShot = 0, score = 0;

  const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  addEventListener('keydown', (e) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault(); // no page scrolling, no pressing the focused button
      keys[e.key] = true;
    } else if (e.key === 'r' || e.key === 'R') {
      document.querySelectorAll('.tss-w[data-tss-dead]').forEach((w) => w.removeAttribute('data-tss-dead'));
    }
  }, true);
  addEventListener('keyup', (e) => { keys[e.key] = false; }, true);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const fire = (now) => {
    lastShot = now;
    const y = H - 14 - ship.h * 0.6;
    lasers.push({ x: ship.x - 27, y }, { x: ship.x + 27, y });
  };

  // Screen shake: nudges <html> with the `translate` property, which no other mod here sets on <html>
  // and which stacks with any `transform` (tilt-card) instead of replacing it.
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
    word.setAttribute('data-tss-dead', '');
    score++;
  };

  const hitWord = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList?.contains('tss-w') && !el.hasAttribute('data-tss-dead')) return el;
    }
    // elementsFromPoint skips pointer-events:none text: fall back to rects
    for (const w of document.querySelectorAll('.tss-w:not([data-tss-dead])')) {
      const r = w.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return w;
    }
    return null;
  };

  const drawShip = () => {
    const x = 0, y = 0;
    ctx.save();
    ctx.translate(ship.x, H - 14);
    ctx.scale(ship.w / 34, ship.h / 26); // drawn at 34x26, scaled up
    ctx.shadowColor = '#0ff'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.moveTo(x, y - 26);
    ctx.lineTo(x + 17, y);
    ctx.lineTo(x + 6, y - 6);
    ctx.lineTo(x - 6, y - 6);
    ctx.lineTo(x - 17, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0cf';
    ctx.beginPath(); ctx.ellipse(x, y - 13, 3.5, 6, 0, 0, Math.PI * 2); ctx.fill();
    // engine flame
    ctx.fillStyle = `rgba(255,${140 + Math.random() * 100 | 0},40,.9)`;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 5); ctx.lineTo(x + 4, y - 5); ctx.lineTo(x, y + 3 + Math.random() * 6); ctx.fill();
    ctx.restore();
  };

  let prev = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    try {
      if (keys.ArrowLeft) ship.x -= 520 * dt;
      if (keys.ArrowRight) ship.x += 520 * dt;
      ship.x = Math.max(ship.w / 2, Math.min(W - ship.w / 2, ship.x));
      if (keys[' '] && now - lastShot > 150) fire(now);

      ctx.clearRect(0, 0, W, H);

      applyShake(dt);

      ctx.save();
      ctx.shadowColor = '#f0f'; ctx.shadowBlur = 18;
      for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.y -= 950 * dt;
        // fat bolt: hit anything under its centre or either edge
        const w = l.y > 0 && (hitWord(l.x, l.y) || hitWord(l.x - 5, l.y) || hitWord(l.x + 5, l.y));
        if (w) explode(w);
        if (w || l.y < -40) { lasers.splice(i, 1); continue; }
        ctx.fillStyle = '#ff6bf0';
        ctx.beginPath(); ctx.roundRect(l.x - 5, l.y, 10, 34, 5); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.roundRect(l.x - 2, l.y + 3, 4, 28, 2); ctx.fill();
      }
      ctx.restore();

      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i];
        g.t += dt / 0.45;
        if (g.t >= 1) { rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - g.t, 3);
        ctx.save();
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
      drawShip();
      hud.textContent = `← → fly · space fire · R restore · ${score} words blasted`;
    } catch (e) { window.trif?.warn('frame failed', String(e)); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.trif?.log('space shooter ready', document.querySelectorAll('.tss-w').length, 'words');
})();
