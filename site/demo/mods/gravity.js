// ==WebMod==
// @name        G Toggles Gravity
// @touch-name  Toggle Gravity
// @description Grab things and throw them!
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  const GRAVITY = 2600;        // px/s²
  const BOUNCE_FLOOR = 0.45;   // restitution against walls and floor
  const BOUNCE_BODY = 0.2;     // restitution between pieces
  const SUBSTEPS = 3;          // physics steps per frame (the solver: see "Physics: rigid boxes")
  // With the Tilt Card on, the card's tilt (--tc-ry / --tc-rx on <html>, up to ±24°) tips the pile: pieces
  // slide toward where the card dips, the side the mouse is on, like the walker does (Living Robot). A
  // hard push, and less floor friction the more it tips, so it shows once the card tilts noticeably.
  const TILT_MAX = 24, TILT_PUSH = 1.2;  // full tilt: 1.2 × gravity, sideways
  const tiltX = () => Math.max(-1, Math.min(1, (parseFloat(root.style.getPropertyValue('--tc-ry')) || 0) / TILT_MAX));

  // Elements whose whole box moves as one piece, without looking inside.
  const SOLID = new Set(['svg', 'img', 'video', 'canvas', 'picture', 'iframe', 'input', 'button', 'select', 'textarea', 'hr', 'a']);
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'br', 'head']);

  const style = document.createElement('style');
  // Doubled attribute for specificity: the neon title and jelly buttons mods animate these
  // same elements, and the living robot moves with the `translate` property.
  style.textContent = `
    html[data-gm-on] { overflow: hidden !important; }
    /* on a touchscreen too: no scrolling, pinching or pull-to-refresh while the page is in pieces (the
       touch handlers below stop what CSS alone doesn't, like Safari's pinch) */
    html[data-gm-on], html[data-gm-on] body { touch-action: none !important; overscroll-behavior: none !important; }
    html[data-gm-on] body { user-select: none !important; -webkit-user-select: none !important; }
    html[data-gm-on] [data-gm-body][data-gm-body] {
      transform: translate(var(--gm-x, 0px), var(--gm-y, 0px)) rotate(var(--gm-r, 0rad)) scale(var(--gm-sx, 1), var(--gm-sy, 1)) !important;
      transform-origin: 50% 50% !important;
      translate: none !important; rotate: none !important; scale: none !important;
      transition: none !important; /* animations keep running (the neon glow); this !important transform beats theirs */
      will-change: transform; cursor: grab !important; touch-action: none; pointer-events: auto !important;
      position: relative; z-index: 10;
    }
    html[data-gm-on] [data-gm-body][data-gm-inline] { display: inline-block !important; }
    html[data-gm-on] [data-gm-body][data-gm-held] { cursor: grabbing !important; z-index: 20; }
    html[data-gm-on] a[href][data-gm-body][data-gm-body], html[data-gm-on] [data-gm-body] a[href] { cursor: pointer !important; }
    html[data-gm-on] [data-gm-bare] { border-color: transparent !important; box-shadow: none !important; }
    /* containers whose pieces fall out of them (the terminal box clips its code with overflow: hidden):
       unclipped, or a piece that leaves goes invisible */
    [data-gm-word] { display: inline-block !important; } /* (only set while gravity runs: see splitWords) */
    html[data-gm-on] [data-gm-open] { overflow: visible !important; clip-path: none !important; contain: none !important; }
  `;
  (document.head || document.documentElement).append(style);

  const root = document.documentElement;
  let bodies = [], active = false, returning = false, last = 0, raf = 0, held = null;

  // The walker: the Living robot mod's robot (svg.robot[data-lr]) is a piece like any other (it falls,
  // collides, can be grabbed), but stays upright and is steered by that mod: it sends `lr-walk`
  // { vx, jump } events (target walking speed, and a jump when it wants one), and gets `gm-walker`
  // { x, y, vx, vy, supported } back each frame. Jumping into pieces above shoves them through the
  // normal contact physics; he counts as a bit heavier than his box so he can move words.
  const WALKER_MASS = 3, JUMP_COOLDOWN = 0.35; // × box area; s
  let walkCmd = { vx: 0, jump: 0, kick: 0 }; // kick: set his sideways speed outright, once (a flinch)
  addEventListener('lr-walk', (e) => {
    const d = e.detail || {};
    walkCmd.vx = Number.isFinite(d.vx) ? Math.max(-600, Math.min(600, d.vx)) : 0;
    if (Number.isFinite(d.jump) && d.jump > 0) walkCmd.jump = Math.min(1700, d.jump); // hurt, he jumps higher
    if (Number.isFinite(d.kick) && d.kick) walkCmd.kick = Math.max(-800, Math.min(800, d.kick));
  });

  // Pieces: the smallest visible boxes that read as one thing (a paragraph, a letter of an
  // inline-block title, a button, an image). Containers are walked into, not moved.
  const collect = (el, out) => {
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents' && !c.children.length) continue;
      // Click-through fixed overlays (the space shooter's full-screen canvas and HUD) aren't page
      // content: as pieces, the canvas fills the screen and shoves everything else off the top.
      if (cs.position === 'fixed' && cs.pointerEvents === 'none') continue;
      // The tagline ("Fix any website with your own coding agent.") stays hanging in place while
      // everything else falls (it once did by accident, and that's the look the user wants).
      if (c.matches('main > section.hero > .tagline')) continue;
      // The LED footer's sign falls as one piece: its links ride a strip that scrolls by animation, so
      // as separate pieces they'd jump about as the strip moves under them.
      if (c.matches('.led-sign')) { out.push(c); continue; }
      const kids = [...c.children].filter((k) => !SKIP.has(k.tagName.toLowerCase()));
      const ownText = [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      // Plain inline content (bold, code, links in a sentence) stays with its paragraph; inline-block
      // pieces inside (the neon title's letters) fall on their own.
      const allInline = [...c.querySelectorAll('*')].every((k) => SKIP.has(k.tagName.toLowerCase()) || k.closest('svg') || getComputedStyle(k).display === 'inline');
      if (SOLID.has(tag) || ownText || !kids.length || allInline) { out.push(c); continue; }
      const deco = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) || parseFloat(cs.borderLeftWidth) || cs.boxShadow !== 'none';
      // (its frame goes while its pieces are out of it; but a big card, the report form's or the waitlist's,
      // stays as it is: its border vanishing and coming back read as the box being deleted)
      if (deco && !c.matches('.card')) c.setAttribute('data-gm-bare', '');
      c.setAttribute('data-gm-open', ''); // its pieces will fall out of it: don't clip them (see the CSS)
      collect(c, out);
    }
  };

  const extents = (b) => {
    const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
    const w = b.jelly ? b.w * (1 - b.u) : b.w, h = b.jelly ? b.h * (1 + b.u) : b.h;
    return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
  };

  // Jelly buttons (when that mod is on): its buttons are squishy pieces. Each has a damped spring, u, its
  // squash (u < 0: wider and flatter, u > 0: taller and thinner; scale 1 - u by 1 + u). Hits squash them,
  // hovering one sets off the same wobble as Jelly buttons' hover (their CSS animation can't show through
  // our transform), and their size changing pushes on whatever they touch: the contacts count the speed
  // of their growing sides (b.rx, b.ry), so a wobbling button bounces what sits on it, and hops off the floor.
  const JELLY_K = 480, JELLY_C = 11, JELLY_MAX = 0.4; // spring (≈3.5 wobbles a second, dying out in ~0.7 s), most squash
  const SQUISH = 0.005;  // squash speed per px/s of a hit
  const jellyMod = () => [...document.querySelectorAll('style')].some((s) => s.textContent.includes('jb-jelly'));
  const squish = (b, dv) => { if (b.jelly && Math.abs(dv) > 30) b.uv += Math.max(-1500, Math.min(1500, dv)) * SQUISH; };
  const JELLY_PUSH = 250; // px/s: the fastest its sides push (a cap, so a pile can't pump it into a frenzy)
  const stepJelly = (b, dt) => {
    const e0 = extents(b);
    b.uv += (-JELLY_K * b.u - JELLY_C * b.uv) * dt;
    b.u = Math.max(-JELLY_MAX, Math.min(JELLY_MAX, b.u + b.uv * dt));
    const e1 = extents(b);
    const cap = (v) => Math.max(-JELLY_PUSH, Math.min(JELLY_PUSH, v));
    b.rx = cap((e1.hw - e0.hw) / dt); b.ry = cap((e1.hh - e0.hh) / dt);
  };

  // --- Card coordinates. With the Tilt card mod the page is a card tilted in 3D, and the physics runs in
  // the card's own flat coordinates (the window as it'd be untilted): the pile lies on the card and
  // tilts with it. Everything from outside (the pointer, Space shooter's blasts) arrives in screen
  // coordinates and is mapped onto the card; what we send out (the walker's position) is mapped back.
  // Four invisible markers at the flat window's corners, inside <body>, are read every frame: where
  // they land on screen gives the card→screen homography (a plane under perspective), and its inverse.
  // Without the tilt both are the identity. Measuring "flat" (html[data-gm-measure]) straightens the card
  // for an instant (Tilt card's CSS), without a repaint in between.
  let probes = null, PW = 1, PH = 1, Hm = [1, 0, 0, 0, 1, 0, 0, 0, 1], Hi = Hm;
  const measureFlat = (fn) => { root.setAttribute('data-gm-measure', ''); try { return fn(); } finally { root.removeAttribute('data-gm-measure'); } };
  const makeProbes = () => { // call while measuring flat
    removeProbes();
    const body = document.body, br = body.getBoundingClientRect();
    PW = root.clientWidth; PH = innerHeight;
    probes = [[0, 0], [PW, 0], [PW, PH], [0, PH]].map(([x, y]) => {
      const p = document.createElement('div');
      p.setAttribute('data-gm-probe', '');
      p.style.cssText = `position:absolute;left:${x - br.left - body.clientLeft}px;top:${y - br.top - body.clientTop}px;width:0;height:0;pointer-events:none;visibility:hidden;`;
      body.append(p);
      return p;
    });
  };
  const removeProbes = () => { probes?.forEach((p) => p.remove()); probes = null; Hm = Hi = [1, 0, 0, 0, 1, 0, 0, 0, 1]; };
  const updateMap = () => {
    if (!probes) return;
    const q = probes.map((p) => { const r = p.getBoundingClientRect(); return [r.left, r.top]; });
    // unit square → quad (Heckbert): (0,0) (1,0) (1,1) (0,1) → q0 q1 q2 q3
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let g = 0, h = 0;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { if (!den) return; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
    const S = [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
    // fold in the flat size (x/PW, y/PH), then invert
    const M = [S[0] / PW, S[1] / PH, S[2], S[3] / PW, S[4] / PH, S[5], S[6] / PW, S[7] / PH, S[8]];
    const [a, b, c, d, e, f, k, l, m] = M;
    const A = e * m - f * l, B = -(d * m - f * k), C = d * l - e * k, det = a * A + b * B + c * C;
    if (!det || !Number.isFinite(det)) return;
    Hm = M;
    Hi = [A / det, -(b * m - c * l) / det, (b * f - c * e) / det, B / det, (a * m - c * k) / det, -(a * f - c * d) / det, C / det, -(a * l - b * k) / det, (a * e - b * d) / det];
  };
  const apply = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
  const toFlat = (x, y) => apply(Hi, x, y), toScreen = (x, y) => apply(Hm, x, y);

  // r: his layout box (our transform at zero); pre: where he's actually standing (Living robot's
  // `translate`, which gravity turns off), so he starts falling from there.
  const makeWalker = (el, r, pre) => {
    // his legs hang below the svg's box (overflow: visible): stand on the feet, not the box
    const h = r.height * 1.16, hx = r.left + r.width / 2, hy = r.top + h / 2;
    const x = pre?.width ? pre.left + pre.width / 2 : hx, y = pre?.width ? pre.top + h / 2 : hy;
    return { el, walker: true, w: r.width * 0.8, h, hx, hy, x, y, a: 0, vx: 0, vy: 0, va: 0,
      m: r.width * h * WALKER_MASS, support: false, jumpWait: 0 };
  };
  // The robot can miss the start: destroyed (hidden) when G was pressed, or off screen. When he's back
  // (R rebuilt him) and isn't a piece yet, he joins in, falling from where he stands.
  const adoptWalker = () => {
    if (bodies.some((b) => b.walker)) return;
    const el = document.querySelector('svg.robot[data-lr]');
    if (!el || el.hasAttribute('data-tss-dead') || getComputedStyle(el).visibility === 'hidden') return;
    const [pre, r] = measureFlat(() => { // (card coordinates)
      const p = el.getBoundingClientRect();
      el.setAttribute('data-gm-body', '');
      return [p, el.getBoundingClientRect()];
    });
    if (r.width < 2 || r.height < 2) { el.removeAttribute('data-gm-body'); return; }
    const vw = root.clientWidth, vh = innerHeight;
    const inView = pre.width && pre.bottom > 0 && pre.top < vh && pre.right > 0 && pre.left < vw;
    bodies.push(makeWalker(el, r, inView ? pre : { width: 0 }));
    window.trif?.log('robot joined the gravity');
  };

  // The title falls apart letter by letter. The Neon title mod already splits it into inline-block
  // letters; without it the title is plain text (or Space shooter's inline word spans) and would fall
  // as one block, so while gravity is on each letter goes in its own inline-block span (undone at the end).
  const TITLE = 'main > section.hero > h1';
  const splitTitle = () => {
    const h1 = document.querySelector(TITLE);
    if (!h1 || [...h1.querySelectorAll('*')].some((k) => getComputedStyle(k).display !== 'inline')) return;
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const ch of node.data) {
        if (/\s/.test(ch)) { frag.append(ch); continue; }
        const s = document.createElement('span');
        s.setAttribute('data-gm-ch', '');
        s.style.display = 'inline-block';
        s.textContent = ch;
        frag.append(s);
      }
      node.replaceWith(frag);
    }
  };
  // All text falls apart word by word. Each word becomes an inline-block piece: Space shooter's word
  // spans (.tss-w) are marked as they are; plain text words get a span. Undone at the end. Text that
  // reads as one thing stays whole: links and buttons (they stay clickable), framed or filled boxes with
  // only inline content inside (the sticker badges), the title (it goes letter by letter, above), the
  // hanging tagline, and fixed overlays (the HUD).
  const isDecorated = (cs) => parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0
    || cs.backgroundImage !== 'none' || !/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor);
  const isLeaf = (el) => [...el.querySelectorAll('*')].every((k) => SKIP.has(k.tagName.toLowerCase()) || getComputedStyle(k).display.startsWith('inline'));
  const keepWhole = (el, memo) => {
    if (!el || el === document.body) return false;
    if (memo.has(el)) return memo.get(el);
    let r = SOLID.has(el.tagName.toLowerCase()) || el.matches(`${TITLE}, main > section.hero > .tagline, .led-sign, svg *`);
    if (!r) {
      const cs = getComputedStyle(el);
      r = cs.position === 'fixed' || cs.display === 'none' || (isDecorated(cs) && isLeaf(el));
    }
    r = r || keepWhole(el.parentElement, memo);
    memo.set(el, r);
    return r;
  };
  const splitWords = () => {
    const body = document.body, memo = new Map();
    body.querySelectorAll('.tss-w').forEach((w) => { if (!keepWhole(w, memo)) w.setAttribute('data-gm-word', ''); });
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode, p = n.parentElement;
      if (n.data.trim() && p && !SKIP.has(p.tagName.toLowerCase()) && !p.closest('[data-gm-word]') && !keepWhole(p, memo)) nodes.push(n);
    }
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const s = document.createElement('span');
        s.setAttribute('data-gm-word', ''); s.setAttribute('data-gm-made', '');
        s.textContent = part;
        frag.append(s);
      }
      node.replaceWith(frag);
    }
  };
  const unsplitWords = () => {
    const body = document.body;
    body.querySelectorAll('[data-gm-made]').forEach((s) => s.replaceWith(...s.childNodes));
    body.querySelectorAll('[data-gm-word]').forEach((w) => w.removeAttribute('data-gm-word'));
    body.normalize();
  };
  const unsplitTitle = () => {
    const h1 = document.querySelector(TITLE);
    if (!h1) return;
    h1.querySelectorAll('[data-gm-ch]').forEach((s) => s.replaceWith(...s.childNodes)); // keeps anything wrapped inside
    h1.normalize();
  };

  // Everything about the start is measured on the flat (untilted) card: see "Card coordinates".
  const start = () => measureFlat(startFlat);
  const startFlat = () => {
    try { splitTitle(); } catch (e) { window.trif?.warn('title split failed', String(e)); }
    try { splitWords(); } catch (e) { window.trif?.warn('word split failed', String(e)); }
    // where the walker is now (Living robot moves him with `translate`, which gravity turns off)
    const pre = document.querySelector('svg.robot[data-lr]')?.getBoundingClientRect();
    const els = [];
    collect(document.body, els);
    for (const el of els) {
      el.setAttribute('data-gm-body', '');
      if (getComputedStyle(el).display === 'inline') el.setAttribute('data-gm-inline', '');
    }
    root.setAttribute('data-gm-on', '');
    const vw = root.clientWidth, vh = innerHeight;
    const jellyOn = jellyMod();
    bodies = [];
    for (const el of els) {
      const r = el.getBoundingClientRect(); // layout position with our transform at zero
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        el.removeAttribute('data-gm-body'); el.removeAttribute('data-gm-inline');
        continue;
      }
      if (el.matches('svg.robot[data-lr]')) { bodies.push(makeWalker(el, r, pre)); continue; }
      const hx = r.left + r.width / 2, hy = r.top + r.height / 2;
      bodies.push({
        el, w: r.width, h: r.height, hx, hy, x: hx, y: hy, a: 0,
        // A little shove and spin each, so the page tumbles instead of dropping in columns.
        vx: (Math.random() - 0.5) * 360, vy: -80 - Math.random() * 220, va: (Math.random() - 0.5) * 6,
        m: Math.max(40, r.width * r.height), support: false,
        jelly: jellyOn && el.matches('main .btn, main button'), u: 0, uv: 0, rx: 0, ry: 0,
      });
    }
    active = true; returning = false; last = 0;
    for (const b of bodies) b.boxed = !b.walker && hasBox(b.el); // measured once: see isGone
    makeProbes(); // (still flat: their layout positions are the flat window's corners)
    window.trif?.log(`gravity on: ${bodies.length} pieces`);
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const stop = () => { // fly home, then let go
    if (window.__gm) (window.__gm.stops ||= []).push(new Error('stop').stack.split('\n').slice(1, 4).join(' | '));
    returning = true; held = null;
    releaseWalker();
    for (const b of bodies) { b.fromX = b.x; b.fromY = b.y; b.fromA = b.a; }
    returning = performance.now();
  };

  // The walker doesn't fly home: as soon as gravity is switched off he's let go where he stands, as a
  // Living robot `translate` (set here too, so he doesn't flash home for a frame), and
  // `gm-walker-release` { dx, dy } tells Living robot to carry on (wandering or chasing) from there,
  // while the rest of the page is still flying home.
  const releaseWalker = () => {
    const w = bodies.find((b) => b.walker);
    if (!w) return;
    bodies = bodies.filter((b) => b !== w);
    const dx = w.x - w.hx, dy = w.y - w.hy;
    w.el.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    for (const a of ['data-gm-body', 'data-gm-inline', 'data-gm-held', 'data-gm-ghost']) w.el.removeAttribute(a);
    for (const p of ['--gm-x', '--gm-y', '--gm-r']) w.el.style.removeProperty(p);
    dispatchEvent(new CustomEvent('gm-walker-release', { detail: { dx, dy } }));
  };

  const finish = () => {
    if (window.__gm) (window.__gm.stops ||= []).push(new Error('finish').stack.split('\n').slice(1, 4).join(' | '));
    releaseWalker();
    removeProbes();
    for (const b of bodies) {
      b.el.removeAttribute('data-gm-body'); b.el.removeAttribute('data-gm-inline'); b.el.removeAttribute('data-gm-held'); b.el.removeAttribute('data-gm-ghost');
      for (const p of ['--gm-x', '--gm-y', '--gm-r', '--gm-sx', '--gm-sy']) b.el.style.removeProperty(p);
    }
    document.querySelectorAll('[data-gm-bare]').forEach((e) => e.removeAttribute('data-gm-bare'));
    document.querySelectorAll('[data-gm-open]').forEach((e) => e.removeAttribute('data-gm-open'));
    root.removeAttribute('data-gm-on');
    try { unsplitTitle(); } catch (e) { window.trif?.warn('title restore failed', String(e)); }
    try { unsplitWords(); } catch (e) { window.trif?.warn('word restore failed', String(e)); }
    bodies = []; active = false; returning = false;
    window.trif?.log('gravity off');
  };

  // Explosions (Space shooter's bombs send `tss-blast` { x, y, radius, power }): every piece near the
  // blast is flung away from it, harder the closer its nearest edge is, lighter pieces further, with
  // an upward kick and some spin. The walker gets knocked about too (but stays upright).
  addEventListener('tss-blast', (e) => {
    try {
      if (!active || returning) return;
      const { x: sx, y: sy, radius: R, power } = e.detail || {};
      if (![sx, sy, R, power].every(Number.isFinite) || R <= 0) return;
      updateMap();
      const [x, y] = toFlat(sx, sy); // (blasts come in screen coordinates)
      for (const b of bodies) {
        if (b.ghost || b === held) continue;
        const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy);
        const k = 1 - Math.max(0, d - Math.min(b.w, b.h) / 2) / R; // 1 at the edge touching the blast
        if (k <= 0) continue;
        const ux = d > 1 ? dx / d : 0, uy = d > 1 ? dy / d : -1;
        const light = Math.max(0.35, Math.min(1.6, Math.sqrt(3000 / b.m))) * (b.walker ? 1.6 : 1);
        const dv = Math.min(power, power * k * light);
        wake(b); // (a sleeping piece takes the hit too)
        b.vx += ux * dv; b.vy += uy * dv - 350 * k;
        if (!b.walker) b.va += (Math.random() - 0.5) * 14 * k;
      }
    } catch (err) { window.trif?.warn(String(err)); }
  });

  // Pieces the Space shooter has blasted are only hidden (data-tss-dead), so their boxes would still
  // hold things up. A piece that's gone (blasted itself, inside a blasted word, or a block whose words
  // are all blasted and has nothing else to show) leaves the simulation, frozen where it was, until R
  // brings it back. Checked once per frame.
  // A piece with a visible box of its own (a button's background, a badge's border) is still there with
  // its words blasted: an empty button keeps falling and holding things up.
  const hasBox = (el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor.match(/[\d.]+/g);
    if (cs.backgroundImage !== 'none' || (bg && (bg.length < 4 || +bg[3] > 0) && cs.backgroundColor !== 'transparent')) return true;
    if (cs.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && !/rgba\(.*,\s*0\)$|transparent/.test(cs[`border${s}Color`]));
  };
  const isGone = (b) => {
    const el = b.el;
    if (el.closest('[data-tss-dead]')) return true;
    if (b.boxed) return false;
    if (!el.querySelector('.tss-w')) return false;
    if (el.querySelector('.tss-w:not([data-tss-dead])')) return false;
    return !el.querySelector('svg, img, video, canvas, picture, input, button'); // e.g. an icon still shows
  };

  // ---- Physics: rigid boxes ------------------------------------------------------------------------------
  // Every piece is a box with a mass and a moment of inertia, turning about its middle. Contacts are found box
  // against box (separating axes, then the touching edges clipped against each other: one or two points) and
  // against the floor and the window's sides (the corners past them), and solved with impulses at those
  // points (sequential impulses: a push along the contact's normal, then Coulomb friction along it), so a piece
  // hanging off an edge turns over it, a stack balances or doesn't, and a thrown piece spins as it should. A
  // piece that has come to rest sleeps (stays exactly put, and costs nothing) until something hits it, the
  // card tilts, or what held it up goes.
  const HELD_MAX_SPEED = 2200;          // px/s: how hard a held piece can hit things
  const MU = 0.8, MU_FLOOR = 0.8;       // friction between pieces; against the floor and sides
  const ITERS = 10;                     // solver passes per substep
  const SLOP = 0.5, CORRECT = 0.3;      // px of overlap left alone; share of the rest put right per substep
  const WARM = 0.85;                    // share of last substep's push each contact starts from
  const SPIN_MAX = 18;                  // rad/s: no piece spins faster
  const BOUNCE_MIN = 120;               // px/s: slower impacts don't bounce
  const SLEEP_V = 15, SLEEP_W = 0.2, SLEEP_T = 0.4, WAKE_V = 40; // px/s, rad/s, s, px/s
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const half = (b) => (b.jelly ? [b.w * (1 - b.u) / 2, b.h * (1 + b.u) / 2] : [b.w / 2, b.h / 2]);
  const shapeOf = (b) => { const [hw, hh] = half(b); return { b, x: b.x, y: b.y, c: Math.cos(b.a), s: Math.sin(b.a), hw, hh }; };
  const corners = (S) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
    [S.x + i * S.hw * S.c - j * S.hh * S.s, S.y + i * S.hw * S.s + j * S.hh * S.c]);
  const radius = (S, ax, ay) => S.hw * Math.abs(ax * S.c + ay * S.s) + S.hh * Math.abs(-ax * S.s + ay * S.c);
  // the part of p–q within `lim` of `c` along t (null: none)
  const clipSeg = (p, q, cx, cy, tx, ty, lim) => {
    const a = (p[0] - cx) * tx + (p[1] - cy) * ty, d = (q[0] - cx) * tx + (q[1] - cy) * ty;
    if ((a > lim && d > lim) || (a < -lim && d < -lim)) return null;
    const at = (k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    const cut = (v) => (v > lim ? at((a - lim) / (a - d)) : v < -lim ? at((a + lim) / (a - d)) : null);
    return [cut(a) || p, cut(d) || q];
  };
  // Box against box: null, or { nx, ny (from A to B), pts: [[x, y, depth]] }.
  const collide = (A, B) => {
    const dx = B.x - A.x, dy = B.y - A.y;
    let best = Infinity, score = Infinity, nx = 0, ny = 0, ref = null, onU = true;
    for (const [S, ax, ay, u] of [[A, A.c, A.s, true], [A, -A.s, A.c, false], [B, B.c, B.s, true], [B, -B.s, B.c, false]]) {
      const d = dx * ax + dy * ay;
      const o = radius(A, ax, ay) + radius(B, ax, ay) - Math.abs(d);
      if (o <= 0) return null;
      const sc = S === A ? o : o * 1.02 + 0.01; // (a slight preference for A's faces: no flicker between equals)
      if (sc < score) { score = sc; best = o; const sg = d < 0 ? -1 : 1; nx = ax * sg; ny = ay * sg; ref = S; onU = u; }
    }
    const inc = ref === A ? B : A;
    const rx = ref === A ? nx : -nx, ry = ref === A ? ny : -ny; // the reference face's normal, toward the other box
    const off = onU ? ref.hw : ref.hh, lim = onU ? ref.hh : ref.hw;
    const fx = ref.x + rx * off, fy = ref.y + ry * off, tx = -ry, ty = rx;
    // the incident box's face most against it
    let fn = null, fd = Infinity;
    for (const [ex, ey, u] of [[inc.c, inc.s, true], [-inc.c, -inc.s, true], [-inc.s, inc.c, false], [inc.s, -inc.c, false]]) {
      const d = ex * rx + ey * ry;
      if (d < fd) { fd = d; fn = [ex, ey, u]; }
    }
    const [ex, ey, eu] = fn, eOff = eu ? inc.hw : inc.hh, eHalf = eu ? inc.hh : inc.hw;
    const cx = inc.x + ex * eOff, cy = inc.y + ey * eOff, etx = -ey, ety = ex;
    const seg = clipSeg([cx - etx * eHalf, cy - ety * eHalf], [cx + etx * eHalf, cy + ety * eHalf], fx, fy, tx, ty, lim);
    if (!seg) return null;
    const pts = [];
    for (const p of seg) {
      const sep = (p[0] - fx) * rx + (p[1] - fy) * ry;
      if (sep <= 0) pts.push([p[0], p[1], -sep]);
    }
    return pts.length ? { nx, ny, pts, depth: best } : null;
  };
  const wake = (b, why = '?') => { if (b && b.asleep) { b.asleep = false; b.still = 0; if (window.__gm) (window.__gm.why ||= {})[why] = (window.__gm.why[why] || 0) + 1; } };
  let lastTilt = 0, lastLive = -1, nextId = 1;
  // (#gmdebug in the address: window.__gm for looking inside, while tuning)
  let dbg = location.hash.includes('gmdebug'); try { dbg ||= !!localStorage.getItem('gmdebug'); } catch {}
  if (dbg) window.__gm = { bodies: () => bodies, wakes: 0 };
  // Each contact's push carries over to the next substep (warm starting: a stack that held last step holds
  // now, instead of being worked out from nothing and jittering), matched by the pair and where on the second
  // piece it touches.
  let cache = new Map();
  const keyOf = (A, B, px, py) => {
    const ida = A ? (A.id ||= nextId++) : 0, idb = B.id ||= nextId++;
    const c = Math.cos(B.a), sn = Math.sin(B.a), lx = (px - B.x) * c + (py - B.y) * sn, ly = -(px - B.x) * sn + (py - B.y) * c;
    return `${ida}:${idb}:${Math.round(lx / 6)}:${Math.round(ly / 6)}`;
  };

  const simulate = (dt, stepsLeft = 1) => {
    const W = root.clientWidth, H = innerHeight;
    const tilt = tiltX();
    const live = bodies.filter((b) => !b.ghost);
    // The world changed under the sleepers: the card tilted, or a piece left (blasted).
    if (Math.abs(tilt - lastTilt) > 0.01 || live.length !== lastLive) live.forEach((b) => wake(b, 'world'));
    lastTilt = tilt; lastLive = live.length;

    // Forces, and what steers itself.
    for (const b of live) {
      if (b === held || b.asleep) continue;
      if (b.walker) { // steer: walk on whatever he stands on (a little air control), jump from it
        b.jumpWait = Math.max(0, b.jumpWait - dt);
        if (walkCmd.kick) { b.vx = walkCmd.kick; walkCmd.kick = 0; } // a flinch: straight away, air or not
        b.vx += (walkCmd.vx - b.vx) * Math.min(1, dt * (b.supported ? 12 : 3));
        if (walkCmd.jump && b.supported && !b.jumpWait) { b.vy = -walkCmd.jump; b.jumpWait = JUMP_COOLDOWN; }
        walkCmd.jump = 0;
      }
      b.vy += GRAVITY * dt;
      if (!b.walker) b.vx += tilt * TILT_PUSH * GRAVITY * dt; // (the walker gets his from Living Robot)
    }
    for (const b of live) if (b.jelly) stepJelly(b, dt); // (held ones too: they wobble in your hand)
    if (held) { // follow the pointer
      // The pointer moves once per frame; spread that move evenly over the frame's substeps (all of it at once
      // made the held piece momentarily 3× faster than the hand). Its speed is capped for what it hits.
      const b = held;
      const mx = (pointer.x - b.grabX - b.x) / stepsLeft, my = (pointer.y - b.grabY - b.y) / stepsLeft;
      b.x += mx; b.y += my;
      b.vx = mx / dt; b.vy = my / dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > HELD_MAX_SPEED) { b.vx *= HELD_MAX_SPEED / sp; b.vy *= HELD_MAX_SPEED / sp; }
      b.va *= 0.9; b.a += b.va * dt;
    }

    // Contacts. Broad phase: the boxes' bounds, sorted by left edge.
    const shapes = live.map(shapeOf);
    const bounds = shapes.map((S) => { const ex = radius(S, 1, 0), ey = radius(S, 0, 1); return [S.x - ex, S.x + ex, S.y - ey, S.y + ey, S]; });
    bounds.sort((p, q) => p[0] - q[0]);
    const contacts = [];
    for (const b of live) { b.support = false; b.touch = false; }
    const vel = (b, px, py) => [b.vx - b.va * (py - b.y), b.vy + b.va * (px - b.x)];
    const add = (A, B, nx, ny, pts, world) => {
      // a sleeper hit hard enough, or touched by the hand's piece, wakes up
      const vA = A ? [A.vx, A.vy] : [0, 0], vB = [B.vx, B.vy];
      const rv = (vB[0] - vA[0]) * nx + (vB[1] - vA[1]) * ny;
      if (A && (A.asleep || B.asleep) && (Math.abs(rv) > WAKE_V || A === held || B === held)) { wake(A, A.walker || B.walker ? 'walker' : 'hit'); wake(B, A.walker || B.walker ? 'walker' : 'hit'); }
      // what holds what up: the box above the other (or the floor) along this normal
      if (ny < -0.5) B.support = true; else if (A && ny > 0.5) A.support = true;
      B.touch = true; if (A) A.touch = true;
      contacts.push({ A, B, nx, ny, pts, world });
    };
    for (let i = 0; i < bounds.length; i++) {
      const [, ar, at, ab, SA] = bounds[i];
      for (let j = i + 1; j < bounds.length && bounds[j][0] <= ar; j++) {
        const [, , bt, bb, SB] = bounds[j];
        if (bt > ab || bb < at) continue;
        const A = SA.b, B = SB.b;
        if (A === held && B === held) continue;
        if ((A.asleep || A === held) && (B.asleep || B === held) && !(A === held || B === held)) {
          // two sleepers: nothing to solve, but they still hold each other up
          const m = collide(SA, SB);
          if (m) { A.touch = B.touch = true; if (m.ny < -0.5) B.support = true; else if (m.ny > 0.5) A.support = true; }
          continue;
        }
        const m = collide(SA, SB);
        if (m) add(A, B, m.nx, m.ny, m.pts, false);
      }
      // the floor and the sides (contacts from the world, A = null, normal into the piece)
      const B = SA.b;
      if (B === held) continue;
      const cs = corners(SA), floor = [], left = [], right = [];
      for (const [x, y] of cs) {
        if (y > H) floor.push([x, y, y - H]);
        if (x < 0) left.push([x, y, -x]);
        if (x > W) right.push([x, y, x - W]);
      }
      if (floor.length) add(null, B, 0, -1, floor, 'floor');
      if (left.length) add(null, B, 1, 0, left, 'side');
      if (right.length) add(null, B, -1, 0, right, 'side');
    }
    // Sleepers left without anything holding them up wake and fall.
    for (const b of live) if (b.asleep && !b.touch) wake(b, 'unsupported');

    // Solve: prepare each contact point, then push and rub until it settles.
    const inv = new Map();
    const invOf = (b) => {
      if (!b) return [0, 0];
      let v = inv.get(b);
      if (!v) {
        const fixed = b === held || b.asleep;
        const [hw, hh] = half(b);
        v = [fixed ? 0 : 1 / b.m, fixed || b.walker ? 0 : 3 / (b.m * (hw * hw + hh * hh))]; // a box about its middle: m (w² + h²) / 12
        inv.set(b, v);
      }
      return v;
    };
    const points = [];
    for (const k of contacts) {
      const { A, B, nx, ny } = k;
      const [ma, ia] = invOf(A), [mb, ib] = invOf(B);
      if (!ma && !ia && !mb && !ib) continue;
      const tx = -ny, ty = nx;
      const mu = (A?.walker || B.walker) ? 0 // the walker steers himself: his steps don't shove what he's on
        : k.world === 'floor' ? MU_FLOOR * (1 - 0.7 * Math.abs(tilt)) : k.world ? MU_FLOOR : MU;
      for (const [px, py, depth] of k.pts) {
        const rax = A ? px - A.x : 0, ray = A ? py - A.y : 0, rbx = px - B.x, rby = py - B.y;
        const rna = cross(rax, ray, nx, ny), rnb = cross(rbx, rby, nx, ny);
        const rta = cross(rax, ray, tx, ty), rtb = cross(rbx, rby, tx, ty);
        const nMass = 1 / (ma + mb + ia * rna * rna + ib * rnb * rnb);
        const tMass = 1 / (ma + mb + ia * rta * rta + ib * rtb * rtb);
        const [vax, vay] = A ? vel(A, px, py) : [0, 0], [vbx, vby] = vel(B, px, py);
        const vn = (vbx - vax) * nx + (vby - vay) * ny;
        const e = vn < -BOUNCE_MIN ? (k.world ? BOUNCE_FLOOR : BOUNCE_BODY) : 0;
        const bias = -e * vn; // (overlap is put right afterwards, by moving, not by speed: see below)
        // a hit squashes a jelly: flatter from above or below, taller from the side (its share of the hit)
        if (vn < -30 && k.pts[0][0] === px) {
          const flat = Math.abs(ny) > 0.7 ? -1 : 1;
          if (A?.jelly) squish(A, flat * -vn * ma / (ma + mb || 1));
          if (B.jelly) squish(B, flat * -vn * mb / (ma + mb || 1));
        }
        const key = keyOf(A, B, px, py), was = cache.get(key);
        points.push({ A, B, nx, ny, tx, ty, rax, ray, rbx, rby, ma, ia, mb, ib, nMass, tMass, bias, mu, depth, key,
          pn: was ? was[0] * WARM : 0, pt: was ? was[1] * WARM : 0 });
      }
    }
    const push = (p, jx, jy) => {
      const { A, B } = p;
      if (A) { A.vx -= jx * p.ma; A.vy -= jy * p.ma; A.va -= cross(p.rax, p.ray, jx, jy) * p.ia; }
      B.vx += jx * p.mb; B.vy += jy * p.mb; B.va += cross(p.rbx, p.rby, jx, jy) * p.ib;
    };
    for (const p of points) if (p.pn || p.pt) push(p, p.pn * p.nx + p.pt * p.tx, p.pn * p.ny + p.pt * p.ty); // warm start
    for (let it = 0; it < ITERS; it++) {
      for (const p of points) {
        const { A, B } = p;
        const vax = A ? A.vx - A.va * p.ray : 0, vay = A ? A.vy + A.va * p.rax : 0;
        const dvx = B.vx - B.va * p.rby - vax, dvy = B.vy + B.va * p.rbx - vay;
        // along the normal: no pulling, only pushing apart
        const vn = dvx * p.nx + dvy * p.ny;
        let j = p.nMass * (p.bias - vn);
        const pn = Math.max(0, p.pn + j); j = pn - p.pn; p.pn = pn;
        push(p, j * p.nx, j * p.ny);
        // along the surface: friction, at most mu × the push
        const vax2 = A ? A.vx - A.va * p.ray : 0, vay2 = A ? A.vy + A.va * p.rax : 0;
        const vt = (B.vx - B.va * p.rby - vax2) * p.tx + (B.vy + B.va * p.rbx - vay2) * p.ty;
        const max = p.mu * p.pn;
        let jt = -p.tMass * vt;
        const pt = Math.max(-max, Math.min(max, p.pt + jt)); jt = pt - p.pt; p.pt = pt;
        push(p, jt * p.tx, jt * p.ty);
      }
    }

    cache = new Map(points.map((p) => [p.key, [p.pn, p.pt]]));

    // Move, and put to sleep what has come to rest.
    for (const b of live) {
      if (b.walker) { b.a = 0; b.va = 0; b.supported = b.support; } // stays upright
      if (b === held || b.asleep) continue;
      b.va = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, b.va));
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
      b.vx *= 0.999; b.va *= 0.995;
    }
    // Overlap put right by moving the pieces apart (their share by mass), not by giving them speed, which
    // would feed a pile energy and keep it twitching.
    for (const p of points) {
      const over = p.depth - SLOP;
      if (over <= 0 || !(p.ma + p.mb)) continue;
      const k = CORRECT * over / (p.ma + p.mb);
      if (p.A) { p.A.x -= p.nx * k * p.ma; p.A.y -= p.ny * k * p.ma; }
      p.B.x += p.nx * k * p.mb; p.B.y += p.ny * k * p.mb;
    }
    for (const b of live) {
      if (b === held || b.asleep || b.walker) continue; // (he's never still for long, and Living Robot steers him)
      const quiet = b.touch && Math.hypot(b.vx, b.vy) < SLEEP_V && Math.abs(b.va) < SLEEP_W;
      b.still = quiet ? (b.still || 0) + dt : 0;
      if (b.still > SLEEP_T) { b.asleep = true; b.vx = 0; b.vy = 0; b.va = 0; }
    }
  };

  const render = () => {
    for (const b of bodies) {
      const s = b.el.style;
      s.setProperty('--gm-x', `${(b.x - b.hx).toFixed(1)}px`);
      s.setProperty('--gm-y', `${(b.y - b.hy).toFixed(1)}px`);
      s.setProperty('--gm-r', `${b.a.toFixed(3)}rad`);
      if (b.jelly) { s.setProperty('--gm-sx', (1 - b.u).toFixed(3)); s.setProperty('--gm-sy', (1 + b.u).toFixed(3)); }
    }
  };

  // Hovering a jelly button sets off its wobble (the first squash of Jelly buttons' animation: wider
  // and flatter), at most every 0.3 s.
  // (the demo's panel and tab sit over the page: touches and clicks there are theirs, never the pile's)
  const onDemoUi = (e) => !!e.target?.closest?.('.demo-panel, .demo-tab');
  addEventListener('pointerover', (e) => {
    if (!active || returning || onDemoUi(e)) return;
    const el = e.target.closest?.('[data-gm-body]');
    const b = el && bodies.find((x) => x.el === el);
    if (!b?.jelly || b.ghost) return;
    const now = performance.now();
    if (now - (b.hoverAt || 0) < 300) return;
    b.hoverAt = now;
    wake(b); // (its wobble pushes on what it touches)
    b.uv -= 5.5; // ≈ the 1.18 × 0.82 of the hover animation at its widest
  }, true);

  // `gm-frame`: the pieces have moved for this frame (Rainbow Rave draws its glows on it, so they keep up)
  const frameDone = () => { try { dispatchEvent(new CustomEvent('gm-frame')); } catch {} };

  // setTimeout fallback isn't needed: rAF pausing in a background tab just pauses the pile.
  const frame = (t) => {
    raf = 0;
    try {
      if (!active) return;
      const dt = Math.min(1 / 30, (t - (last || t)) / 1000) || 1 / 60;
      last = t;
      if (returning) {
        const k = Math.min(1, (t - returning) / 700), e = 1 - Math.pow(1 - k, 3);
        for (const b of bodies) {
          b.x = b.fromX + (b.hx - b.fromX) * e; b.y = b.fromY + (b.hy - b.fromY) * e;
          b.a = b.fromA + (Math.round(b.fromA / (2 * Math.PI)) * 2 * Math.PI - b.fromA) * e;
          if (b.jelly) b.u *= 1 - e; // un-squash on the way home
        }
        render(); frameDone();
        if (k >= 1) { finish(); return; }
      } else {
        updateMap(); // the card may have tilted since last frame
        [pointer.x, pointer.y] = toFlat(screenPtr.x, screenPtr.y);
        adoptWalker();
        for (const b of bodies) {
          const ghost = isGone(b);
          if (ghost !== !!b.ghost) b.el.toggleAttribute('data-gm-ghost', ghost); // Space shooter's bombs pass through these
          b.ghost = ghost;
          if (b.ghost) { b.vx = 0; b.vy = 0; b.va = 0; if (b === held) { held = null; b.el.removeAttribute('data-gm-held'); } } // back from R: drops from rest
        }
        for (let i = 0; i < SUBSTEPS; i++) simulate(dt / SUBSTEPS, SUBSTEPS - i);
        render(); frameDone();
        const w = bodies.find((b) => b.walker);
        if (w) { // (in screen coordinates, like everything Living robot and Space shooter deal in)
          const [sx, sy] = toScreen(w.x, w.y), [lx] = toScreen(w.x - w.w / 2, w.y), [rx] = toScreen(w.x + w.w / 2, w.y);
          const [, ty] = toScreen(w.x, w.y - w.h / 2), [, by] = toScreen(w.x, w.y + w.h / 2);
          dispatchEvent(new CustomEvent('gm-walker', { detail: { x: sx, y: sy, w: Math.abs(rx - lx), h: Math.abs(by - ty),
            vx: w.vx, vy: w.vy, supported: !!w.supported, held: w === held } }));
        }
      }
    } catch (e) { if (window.__gm) window.__gm.err = String(e && e.stack || e); window.trif?.warn(String(e)); finish(); return; }
    raf = requestAnimationFrame(frame);
  };

  // Grabbing and throwing.
  // (the pointer arrives in screen coordinates; `pointer` is it on the card, refreshed every frame)
  const screenPtr = { x: 0, y: 0 }, pointer = { x: 0, y: 0 };
  // On a touchscreen a finger on Space shooter's ship takes the ship, not the piece under it (the ship says
  // where in its `tss-ship` event).
  let shipGrab = null;
  addEventListener('tss-ship', (e) => { shipGrab = e.detail?.grab || null; });
  const onShip = (e) => e.pointerType === 'touch' && shipGrab && e.clientX >= shipGrab.left && e.clientX <= shipGrab.right
    && e.clientY >= shipGrab.top && e.clientY <= shipGrab.bottom;
  addEventListener('pointerdown', (e) => {
    if (!active || returning || e.button !== 0 || onShip(e) || onDemoUi(e)) return;
    if (e.target.closest?.('a[href]')) return; // links stay links: clicking one follows it
    const el = e.target.closest?.('[data-gm-body]');
    const b = el && bodies.find((x) => x.el === el);
    if (!b) return;
    e.preventDefault();
    screenPtr.x = e.clientX; screenPtr.y = e.clientY;
    updateMap();
    [pointer.x, pointer.y] = toFlat(e.clientX, e.clientY);
    b.grabX = pointer.x - b.x; b.grabY = pointer.y - b.y;
    wake(b); held = b; el.setAttribute('data-gm-held', '');
  }, true);
  const trail = []; // recent pointer positions (on the card), for the throw's speed
  addEventListener('pointermove', (e) => {
    screenPtr.x = e.clientX; screenPtr.y = e.clientY;
    if (!held) return;
    const now = performance.now();
    const [fx, fy] = toFlat(e.clientX, e.clientY);
    trail.push({ x: fx, y: fy, t: now });
    while (trail.length > 2 && now - trail[0].t > 100) trail.shift();
  }, { passive: true });
  const release = () => {
    if (!held) return;
    const b = held;
    held = null;
    b.el.removeAttribute('data-gm-held');
    // Throw with the pointer's speed over its last ~100 ms (a still pointer just drops it).
    const first = trail[0], lastP = trail[trail.length - 1];
    const span = first && lastP ? (performance.now() - first.t) / 1000 : 0;
    wake(b);
    if (span > 0.005) { b.vx = (lastP.x - first.x) / span; b.vy = (lastP.y - first.y) / span; } else { b.vx = 0; b.vy = 0; }
    trail.length = 0;
    const sp = Math.hypot(b.vx, b.vy), max = 4000; // cap a twitchy flick
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.va = b.vx / Math.max(40, b.w) * 1.5;
  };
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  // While it's on, a finger moves pieces, never the page: no scrolling and no pinch zoom (they shift the
  // window under the pile). Taps still go through; only moves and pinches are stopped.
  const still = (e) => { if (active && e.cancelable) e.preventDefault(); };
  addEventListener('touchmove', still, { capture: true, passive: false });
  for (const g of ['gesturestart', 'gesturechange']) addEventListener(g, still, { capture: true, passive: false }); // (Safari's pinch)
  addEventListener('blur', release);
  // Buttons don't fire while they're toys; links still work (they can't be grabbed, see pointerdown).
  addEventListener('click', (e) => {
    if (active && !onDemoUi(e) && !e.target.closest?.('a[href]') && e.target.closest?.('[data-gm-body]')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('dragstart', (e) => { if (active) e.preventDefault(); }, true);

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    try {
      if (e.key === 'g' || e.key === 'G') {
        if (!active) start(); else if (!returning) stop();
      } else if (e.key === 'Escape' && active && !returning) stop();
    } catch (err) { window.trif?.warn(String(err)); try { finish(); } catch {} }
  }, true);

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

  // On a touchscreen (no G or Escape to press), a button in the top right does what they do: a down arrow
  // drops the page, and while it's down an up arrow puts it back.
  const toggle = () => {
    try { if (!active) start(); else if (!returning) stop(); } catch (err) { window.trif?.warn(String(err)); try { finish(); } catch {} }
  };
  if (matchMedia('(pointer: coarse)').matches) {
    const NS = 'http://www.w3.org/2000/svg';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trif-top-btn trif-top-right';
    const sync = () => {
      const down = root.hasAttribute('data-gm-on');
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', down ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6');
      svg.append(path);
      button.replaceChildren(svg);
      button.setAttribute('aria-label', down ? 'Put the page back' : 'Drop the page (gravity)');
      button.title = down ? 'Put the page back' : 'Gravity: drop the page';
    };
    sync();
    // (whoever switches it: this button, or Space shooter turning gravity off for its You Win screen)
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-gm-on'] });
    button.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    topBar().append(button);
  }

  root.setAttribute('data-gm-ready', ''); // tells Space shooter to list "G gravity" in its controls
  window.trif?.log('gravity mode ready: press G');
})();
