// ==WebMod==
// @name        Rainbow Rave
// @description 🌈🌈🌈
// @match       https://x.com/*
// @run-at      document-start
// @risk        1 styles X's chat and calls inside their shadow roots (TRIF catches them as they're made), which the page's scripts could notice
// @source      webmods
// @version     4
// @boxed
// @powers      sound, page-events wm-rainbow-kick
// @migrate     localStorage wmRainbow.zoom
// ==/WebMod==

// Boxed (TRIF's sandbox): the same engine through trif.audio() (sound), the same Web Animations through
// animate(), X's chat and calls styled through trif.css(…, {shadow}) (TRIF's runtime catches their shadow
// roots; this mod no longer patches attachShadow itself), the kick announced to X-Flyer as the same
// wm-rainbow-kick event on the document (page-events), the icons as the mod's own SVG, and the zoom switch
// kept by TRIF (brought over once from localStorage 'wmRainbow.zoom' by @migrate).
// Its buttons are .trif-box-wm-rainbow-music (a boxed mod names only trif-box- things): Follow Status finds
// either name; X-Flyer finds Rainbow Rave by that class too (space-shooter.js, raveOn),
// and these buttons hide themselves while X-Flyer is ready (html[data-tss-ready]), as X-Flyer's CSS did.
{
  // Evenly spaced hues, all at the same saturation and lightness, so neighbours blend cleanly (no muddy bands).
  const RAINBOW = `repeating-linear-gradient(115deg,
    hsl(0 100% 65%) 0, hsl(30 100% 62%) 5vmax, hsl(60 100% 58%) 10vmax, hsl(90 100% 58%) 15vmax,
    hsl(120 100% 60%) 20vmax, hsl(150 100% 58%) 25vmax, hsl(180 100% 58%) 30vmax, hsl(210 100% 65%) 35vmax,
    hsl(240 100% 72%) 40vmax, hsl(270 100% 70%) 45vmax, hsl(300 100% 68%) 50vmax, hsl(330 100% 66%) 55vmax,
    hsl(360 100% 65%) 60vmax)`;
  // The stripes repeat every 60vmax along their 115deg axis, i.e. every 60vmax / sin(115deg) along x:
  // sliding by exactly that loops seamlessly.
  const SLIDE = 'calc(-60vmax / 0.9063)';
  // Wider than the window by more than the slide (66.2vmax), so the rainbow's right edge never shows.
  const WIDTH = 'calc(100vw + 70vmax)';
  // The roll moves in steps at 15 frames a second (75 steps over the 5s loop), not smoothly at 60:
  // everything on the page is drawn over the rainbow, so each step redraws the whole screen. At 60fps
  // that made X (Firefox especially) crawl.
  const ROLL = '5s steps(75) infinite';

  // A "rainbow window": the same rainbow, pinned to the viewport (background-attachment: fixed) and sliding
  // like the background layer. With a fixed background, a pixel's colour depends only on its position on
  // screen, not on the element's size, so every window lines up with the background and with each other
  // (nested ones too). Dialogs use phase 'box' (in phase: a clear window onto the background, which their
  // mask dims); menus use 'menu', half a stripe period ahead, so they show the opposite colours and stand
  // out from the background they sit on. Animations are !important: X sets its fade-in timing inline on
  // dialogs (animation-duration: 0.15s), which would otherwise speed the rainbow up ~33x.
  const windowCss = (selector, phase) => `
    ${selector} {
      background-color: transparent !important;
      background-image: ${RAINBOW} !important;
      background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important;
      background-attachment: fixed !important;
      animation: wm-rainbow-${phase} ${ROLL} !important;
    }`;
  const KEYFRAMES = `
    @keyframes wm-rainbow-box { from { background-position: 0 0; } to { background-position: ${SLIDE} 0; } }
    @keyframes wm-rainbow-menu { from { background-position: calc(-30vmax / 0.9063) 0; } to { background-position: calc(-90vmax / 0.9063) 0; } }
  `;
  let STYLE = `
    /* The rainbow lives on a fixed layer behind everything, so it doesn't scroll with the feed. */
    html::before {
      content: ''; position: fixed; top: 0; bottom: 0; left: 0; z-index: -1; pointer-events: none;
      width: ${WIDTH};
      background: ${RAINBOW};
      will-change: transform;
      animation: wm-rainbow-roll ${ROLL};
    }
    @keyframes wm-rainbow-roll { from { transform: translateX(0); } to { transform: translateX(${SLIDE}); } }

    /* X (and Detox Timeline) paint black/white on almost every container via generated classes: clear them
       all. Only background-color, so avatars and media (background-image) still show. */
    /* Scoped to the app (#react-root) and Detox Timeline's search page, never all of body: X signs some
       requests (search) with a code computed from the computed styles of hidden test elements it
       puts directly in <body>. Restyling those makes the code wrong and X answers 404. */
    html, body, #react-root, #react-root *, .dm-search, .dm-search * { background-color: transparent !important; }

    /* Popups (menus, hover cards, dialogs) get a frosted dark backing so they stay readable over the feed. */
    /* Prefixed with #react-root to outrank the transparent rule above (an id beats attributes). */
    #react-root :is([role=menu], [data-testid=HoverCard], [role=listbox], [data-testid=sheetDialog],
      [aria-modal=true], [data-testid=toast]) {
      background-color: rgba(10, 10, 14, 0.92) !important;
    }
    /* The emoji picker is a hover card (a rainbow window, below) whose emoji grid is a [role=listbox]:
       let the card's rainbow show through it instead of the dark backing. */
    #react-root [data-testid=HoverCard] [role=listbox] { background-color: transparent !important; }
    /* Dialogs (compose, etc.) and menus are rainbow windows (see windowCss). Menus: More, a post's "...",
       hover cards (profile previews, but also the account menu under your avatar and the compose box's
       "Everyone" audience picker), and Detox Timeline's Filters menu (.dm-menu, in <body>, outside #react-root).
       After the dark rule above, which they override. */
    ${windowCss('#react-root [aria-modal=true]', 'box')}
    ${windowCss('#react-root :is([role=menu], [data-testid=HoverCard]), .dm-menu', 'menu')}
    ${KEYFRAMES}
    /* The dim layer behind dialogs (compose, image viewer), so the page behind recedes. */
    #react-root [data-testid=mask] { background-color: rgba(0, 0, 0, 0.45) !important; }

    /* All text white; icons use currentColor, so they go white too. The rainbow is bright, so a soft
       dark shadow keeps white text readable on the yellow and cyan stripes. */
    #react-root, #react-root *, #react-root *::placeholder, #react-root *::before, #react-root *::after,
    .dm-search, .dm-search *, .dm-search *::placeholder, .dm-menu, .dm-menu * { color: #fff !important; }
    /* One small shadow, not two blurred ones, and none on icons (a CSS filter per svg): blurred shadows
       are redrawn with every repaint and every newly scrolled-in tile, which is most of the CPU this mod
       costs while scrolling or screen recording. */
    #react-root, .dm-search, .dm-menu { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); }
    /* (the background's pinned start: see pin) */
    html::before { animation-delay: var(--trif-box-roll-delay, 0s); }
  `;

  // CSS animations start whenever their element appears, so a dialog's rainbow would be out of phase
  // with the background's. Pin every rainbow animation to the same start time (the page's time origin):
  // a CSS animation can't be given a start time from the box, so it gets the delay that puts it there.
  // (wm-rainbow-roll is the background's, on html::before: its delay comes through a variable on <html>.
  // Follow Status's wm-rainbow-fs-roll badges are pinned the same way. Not inside X's chat and calls: their
  // animation events stay inside their shadow roots.)
  const delayNow = (e) => `${-(performance.now() - (e.elapsedTime || 0) * 1000).toFixed(1)}ms`;
  const pin = (e) => {
    try {
      if (!e.animationName || !e.animationName.startsWith('wm-rainbow') || !e.target) return;
      if (e.animationName === 'wm-rainbow-roll') e.target.style('--trif-box-roll-delay', delayNow(e));
      else e.target.style('animation-delay', delayNow(e));
    } catch {}
  };
  page.on('animationstart', pin, { capture: true });

  // Chat (/i/chat, the DM drawer) and Calls (/i/calls) are a separate Tailwind app rendered in shadow
  // roots, which page CSS can't reach. Catch each root as it's created and give it its own stylesheet.
  // Roots inside #react-root are the pages themselves: their black panels (.bg-primary, .bg-primary/80
  // on the sticky header) go transparent so the background rainbow shows; their menus are rainbow
  // windows. Roots outside it are popovers (chat's menus, pickers): their panels are rainbow windows.
  // Text there is already light (X's dark theme) and inherits the text shadow from #react-root.
  // Keyframes are scoped to each shadow tree, so each root gets its own copy.
  // (Not [role=listbox]: chat's conversation list is one.) Grey secondary text goes white like the rest
  // of X, except on white buttons (bg-btn-primary, e.g. "New Call"), whose text is dark.
  // Message bubbles (theirs .bg-secondary, mine .bg-chat-accent, both .rounded-chat) and the message box
  // (dm-composer-input-container) are rainbow windows too; mine get a white outline to tell them apart,
  // theirs a fainter one.
  const PAGE_ROOT_CSS = `
    .bg-primary, [class*="bg-primary/"] { background-color: transparent !important; }
    :not(.bg-btn-primary, .bg-btn-primary *) { color: #fff !important; }
    ${windowCss(`[role=menu], [role=dialog], .rounded-chat:is(.bg-secondary, .bg-chat-accent), [data-testid=dm-composer-input-container],
      .bg-btn-tertiary, .bg-tertiary, .rounded-full.border.bg-gray-50,
      [class~="dark:bg-gray-0"], [data-testid=dm-read-only-notice]`, 'menu')}
    /* Also: the "Readers added context" box on posts shared in chat (dark:bg-gray-0), and the notice that
       replaces the message box in read-only chats ("Only Community Notes can send messages"...). */
    /* Above: round buttons (back, call, attach: .bg-btn-tertiary; voice: .bg-tertiary) and reaction labels
       under messages (.bg-gray-50 pills). The conversation's top and bottom edges fade out with a stack of
       blur layers plus one inline gradient to X's black (var(--x-bg-primary)): drop the black, keep the blur. */
    .pointer-events-none.absolute.inset-0[style*="linear-gradient"][style*="--x-bg-primary"] { background: none !important; }
    /* X draws some round buttons at half strength (opacity-50: the call and video-call buttons in a
       conversation header). Full strength, so their rainbow is as bright as the rest. */
    .bg-btn-tertiary.opacity-50 { opacity: 1 !important; }
    .rounded-chat.bg-chat-accent { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85) !important; }
    /* Theirs: a faint outline, as their rainbow can happen to look like the background behind it. */
    .rounded-chat.bg-secondary { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4) !important; }
    ${KEYFRAMES}
  `;
  const POPOVER_ROOT_CSS = `
    ${windowCss('.bg-primary, [role=menu], [role=listbox]', 'menu')}
    ${KEYFRAMES}
  `;
  // (TRIF's runtime keeps every root the page makes, closed ones too, and adds each sheet to the roots of the
  // hosts that match, as they're made and put in the page; adopted, so a root re-rendered keeps it)
  trif.css(PAGE_ROOT_CSS, { shadow: '#react-root *' });
  trif.css(POPOVER_ROOT_CSS, { shadow: 'body *:not(#react-root, #react-root *)' });
  // (a root inside another root: its host is in that root's tree, under no #react-root there, so popover CSS, as
  // the original's root.host.closest('#react-root') said)
  trif.css(POPOVER_ROOT_CSS, { shadow: ':not(html, html *)' });

  // ---- Trance loop: synthesized live with Web Audio (no files, nothing loaded from anywhere). ----
  // Starts on the first click or keypress of each page load; the play/pause button (bottom right)
  // stops and restarts it. Paused while the tab is hidden.
  let musicOn = false;
  const BPM = 138, STEP = 60 / BPM / 4;   // 16th notes
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);
  // Am - F - C - G, one bar each.
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
  const ROOTS = [45, 41, 48, 43];
  const ARP = [0, 1, 2, 1, 2, 0, 1, 2];   // chord-tone pattern; every other bar an octave up
  let ctx, master, noise, next = 0, step = 0, timer;

  const env = (g, t, peak, decay) => {
    const p = g.param('gain');
    p.set(0.0001, t);
    p.expRamp(peak, t + 0.005);
    p.expRamp(0.0001, t + decay);
  };
  const voice = (type, freq, t, peak, decay, cutoff, detunes = [0]) => {
    const g = ctx.gain(), f = ctx.filter({ type: 'lowpass', frequency: cutoff, Q: 4 });
    f.connect(g); g.connect(master); env(g, t, peak, decay);
    for (const d of detunes) {
      const o = ctx.oscillator({ type, frequency: freq });
      o.param('detune').set(d);
      o.connect(f); o.start(t); o.stop(t + decay + 0.05);
    }
  };
  const kick = (t) => {
    const o = ctx.oscillator(), g = ctx.gain();
    const fr = o.param('frequency');
    fr.set(150, t);
    fr.expRamp(40, t + 0.12);
    o.connect(g); g.connect(master); env(g, t, 1, 0.3);
    o.start(t); o.stop(t + 0.35);
  };
  const hiss = (t, type, freq, peak, decay) => {
    const s = ctx.buffer([noise], ctx.rate), f = ctx.filter({ type, frequency: freq }), g = ctx.gain();
    s.connect(f); f.connect(g); g.connect(master); env(g, t, peak, decay);
    s.start(t); s.stop(t + decay + 0.05);
  };
  // Kicks are scheduled up to 0.3s ahead: tell other mods (Kick Pulse) when each one will be heard, in
  // performance.now() time, so they can flash in time with it.
  let kickRefused = false;
  const announceKick = (t) => {
    const ms = (t - ctx.now + (ctx.latency.output || ctx.latency.base || 0)) * 1000;
    const at = performance.now() + ms;
    // (the same event on the document, for X-Flyer's kick rings; refused while another boxed X mod with a read
    // power is on the page and the user hasn't approved the pair: then no rings, but the music plays on)
    try { trif.signal('wm-rainbow-kick', { at }); } catch (e) { if (!kickRefused) { kickRefused = true; trif.warn('no kick event for X-Flyer', String(e && e.message || e)); } }
    setTimeout(() => kickPulse(at), Math.max(0, ms));
  };
  const play = (s, t) => {
    const bar = Math.floor(s / 16) % 4, beat = s % 16, chord = CHORDS[bar];
    if (beat % 4 === 0) { kick(t); announceKick(t); }
    if (beat % 4 === 2) { hiss(t, 'highpass', 8000, 0.25, 0.06); voice('sawtooth', midi(ROOTS[bar]), t, 0.35, 0.12, 900); }
    if (beat % 8 === 4) hiss(t, 'bandpass', 1800, 0.35, 0.18);
    // Supersaw arp, its filter opening over the 4-bar loop.
    const note = chord[ARP[beat % 8]] + 12 + (Math.floor(s / 16) % 2) * 12;
    voice('sawtooth', midi(note), t, 0.09, STEP * 1.6, 1200 + (s % 64) * 60, [-12, 0, 12]);
    if (beat === 0) for (const n of chord) voice('sawtooth', midi(n), t, 0.04, STEP * 16, 1400, [-8, 8]);   // pad
  };
  // Safari can leave an AudioContext stuck when the audio setup changes under it (an audio device
  // switching, screen recorders like OBS capturing the window): its clock stops and nothing plays, with no
  // error. Notice a clock that hasn't moved for a second while playing and mark the context stale; the next
  // play (button, click or keypress: browsers only allow sound to start from one) builds a fresh one.
  let stale = false, lastClock = -1, stalledSince = 0;
  const tick = () => {
    try {
      const now = ctx.now;
      if (now === lastClock) {
        if (!stalledSince) stalledSince = performance.now();
        else if (!stale && performance.now() - stalledSince > 1000) {
          stale = true;
          trif.warn('music clock stuck (audio context ' + ctx.state + '); restarting on next click');
        }
        return;
      }
      lastClock = now; stalledSince = 0;
      // After a stall the clock can jump ahead: skip the missed notes instead of playing them all at once.
      if (next < now - 0.1) next = now + 0.05;
      while (next < now + 0.3) { play(step, next); next += STEP; step = (step + 1) % 64; }
    } catch (e) { trif.warn('music failed', String(e)); stop(); }
  };
  const start = () => {
    if (ctx && (stale || ctx.state === 'closed')) {
      try { ctx.close(); } catch {}
      ctx = null; stale = false;
      trif.log('music: new audio context');
    }
    if (!ctx) {
      ctx = trif.audio();
      const comp = ctx.compressor();
      master = ctx.gain(0.3);
      master.connect(comp); comp.connect('out');
      noise = new Float32Array(ctx.rate);
      for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
      // A new context's clock starts again from 0.
      next = ctx.now + 0.05; lastClock = -1; stalledSince = 0;
    }
    ctx.resume();
    if (!timer) { next = ctx.now + 0.05; lastClock = -1; stalledSince = 0; timer = setInterval(tick, 100); }
  };
  // Any click or keypress while the music is stuck restarts it (see tick).
  const unstick = () => {
    if (!musicOn || !stale) return;
    try { start(); } catch (err) { trif.warn('music restart failed', String(err)); }
  };
  page.on('pointerdown', unstick, { capture: true });
  page.on('keydown', unstick, { capture: true });
  const stop = () => { clearInterval(timer); timer = 0; ctx?.suspend(); };
  const sync = () => {
    if (musicOn && !page.hidden && ctx) start(); else stop();
    if (button) {
      // SVG icons rather than ▶/⏸ characters: font glyphs sit off-centre and differ between fonts.
      const svg = page.createSvg('svg');
      svg.setAttr('viewBox', '0 0 24 24');
      const path = page.createSvg('path');
      path.setAttr('d', musicOn ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
      svg.append(path);
      for (const c of button.children) c.remove();
      button.append(svg);
      button.setAttr('aria-label', musicOn ? 'Pause rainbow music' : 'Play rainbow music');
    }
  };
  page.on('visibilitychange', sync);

  // Autoplay on the first click or keypress of each page load (browsers only allow sound after a user
  // gesture), so nobody misses it. A first click on the button itself is left to the button's handler,
  // which would otherwise start the music here and pause it again straight away.
  const offGesture = [];
  const firstGesture = (e) => {
    if (e.target && e.target.closest('.trif-box-wm-rainbow-music')) return;   // (either button: switching the zoom isn't asking for music)
    for (const off of offGesture.splice(0)) off();
    if (musicOn) return;
    musicOn = true;
    try { start(); } catch (err) { trif.warn('music failed', String(err)); musicOn = false; }
    sync();
  };
  offGesture.push(page.on('pointerdown', firstGesture, { capture: true }), page.on('keydown', firstGesture, { capture: true }));

  // ---- Kick zoom (was the separate Kick Pulse mod): the page zooms in and out with each kick. ----
  // Switched with the second button (left of play/pause); the choice is kept by TRIF.
  //
  // The whole page zooms, but not as one element: a transform on <html> or #react-root makes X's left
  // menu (position: fixed, in header[role=banner]) jump to the top of the document while it lasts.
  // So the three columns zoom separately, the menu's fixed box itself rather than its header, each
  // around the centre of the screen (its own origin, set at each kick), so together they zoom as one page.
  //
  // Everything pulses with ONE endless animation per element, a beat long, never restarted, all sharing
  // one start time (`phase`) locked to the kicks. A new scale animation per kick made Chrome re-rasterize
  // each column (every text shadow and highlight) at the animation's 1.05 scale when it started and back
  // at 1 when it ended: twice per kick. A running animation keeps its raster scale, so the page is painted
  // once and then only scaled by the compositor. Kicks only move the shared phase if it drifts from the
  // music, and then move every animation together, so elements never drift apart.
  let zoomOn = true, zoomSetting = null;
  trif.settings('wmRainbow.zoom', 'on').then((st) => { zoomSetting = st; zoomOn = st.value !== 'off'; syncZoom(); });
  const BEAT = 60000 / BPM;   // a kick every beat
  const PULSE = [
    { scale: 1.025, easing: 'steps(4)' }, // (half the bump it was: 1.05)
    { scale: 1, offset: 280 / BEAT },
    { scale: 1 },
  ];
  const TIMING = { duration: BEAT, iterations: Infinity };

  let nav = null;
  const columns = () => {
    if (!nav?.closest('html')) {
      nav = page.findAll('header[role=banner] div').find((el) => el.style('position') === 'fixed') || null;
    }
    // .dm-search is Detox Timeline's search page on Explore (a fixed box over X's hidden columns).
    // (#tss-hud and .tss-toggle: X-Flyer's side panel and its buttons, which bump along with the page;
    // #tss-glow-z: the glow layer of its title, drawn unzoomed so the same zoom lines it up)
    return [nav, ...page.findAll('[data-testid=primaryColumn], [data-testid=sidebarColumn], .dm-search, #tss-hud, .tss-toggle, #tss-glow-z')].filter(Boolean);
  };
  // Pop-ups: hover cards (profile previews, the account menu, the emoji picker) and menus (More, a post's
  // "...") live in #layers, outside the columns; .dm-menu is Detox Timeline's Filters menu, in <body>. They have
  // their own `animation: ... !important` (windowCss); element.animate() runs alongside CSS animations.
  // Their rainbow is background-attachment: fixed, which the spec turns into "scroll" (pinned to the
  // element's padding box, not the screen) while the element or an ancestor is transformed, as it now
  // always is while the music plays. So each rainbow window in a pop-up (the pop-up, and a menu inside a
  // hover card) also gets its background shifted back by its own position on screen, added on top of
  // the rolling background-position (composite: 'add'), which puts the rainbow where "fixed" would have.
  const POPUP = '#layers :is([data-testid=HoverCard], [role=menu]), .dm-menu';
  const popups = () => page.findAll(POPUP).filter((el) => !el.parent?.closest(POPUP));

  let phase = null;            // shared start time of every pulse animation (document.timeline time)
  // (the box's animations take a current time, not a start time: now minus the phase is the same thing)
  const toPhase = (anim) => anim.setCurrentTime(performance.now() - phase);
  const scales = new Map();    // element -> its pulse Animation
  const shifts = new Map();    // pop-up rainbow window -> [its background shift Animation, the shift]
  let stopTimer = 0;
  const stopAll = () => {
    for (const anim of scales.values()) anim.cancel();
    for (const [anim] of shifts.values()) anim.cancel();
    scales.clear(); shifts.clear(); phase = null;
  };

  const pulseOn = (el, cx, cy) => {
    // Set directly, not through an inherited custom property, so no descendant needs a style recalc,
    // and only when it changed (it does while scrolling: a column's box moves).
    const box = el.rect();
    const origin = `${Math.round(cx - box.left)}px ${Math.round(cy - box.top)}px`;
    if (el.inlineStyle('transform-origin') !== origin) el.style('transform-origin', origin);
    if (scales.has(el)) return;
    const anim = el.animate(PULSE, TIMING);
    toPhase(anim);
    scales.set(el, anim);
  };
  const unfix = (el) => {
    const box = el.rect();
    const border = (side) => parseFloat(el.style(`border-${side}-width`)) || 0;   // (its clientLeft, clientTop)
    const shift = `${-Math.round(box.left + border('left'))}px ${-Math.round(box.top + border('top'))}px`;
    const known = shifts.get(el);
    if (known?.[1] === shift) return;
    const frames = [{ backgroundPosition: shift }, { backgroundPosition: shift }];
    // (a new shift: a new animation; its keyframes are one value, so where it starts doesn't matter)
    if (known) known[0].cancel();
    const anim = el.animate(frames, { ...TIMING, composite: 'add' });
    toPhase(anim);
    shifts.set(el, [anim, shift]);
  };

  // Called at each kick (see announceKick) with when it is heard, in performance.now() time.
  const kickPulse = (at) => {
    try {
      // (with X-Flyer installed, the pulse is always on: these buttons are hidden then, see below)
      if (!(zoomOn || flyerOn()) || !musicOn || page.hidden) { clearTimeout(stopTimer); stopAll(); return; }
      // document.timeline and performance.now() share the page's time origin.
      const drift = phase === null ? 0 : ((at - phase) % BEAT + BEAT) % BEAT;
      if (phase === null || Math.min(drift, BEAT - drift) > 15) {
        phase = at;
        for (const anim of scales.values()) toPhase(anim);
        for (const [anim] of shifts.values()) toPhase(anim);
      }
      for (const map of [scales, shifts]) {
        for (const [el, a] of map) if (!el.closest('html')) { (a.cancel ? a : a[0]).cancel(); map.delete(el); }
      }
      const cx = page.width / 2, cy = page.height / 2;
      for (const el of columns()) pulseOn(el, cx, cy);
      for (const el of popups()) {
        for (const w of [el, ...el.findAll(POPUP)]) unfix(w);
        pulseOn(el, cx, cy);
      }
      // Music paused or tab hidden: no more kicks, so stop a little after the last one.
      clearTimeout(stopTimer);
      stopTimer = setTimeout(stopAll, BEAT * 2.5);
    } catch (e) { trif.warn('kick zoom failed', String(e)); }
  };

  let zoomButton;
  const syncZoom = () => {
    if (!zoomOn) { clearTimeout(stopTimer); stopAll(); }
    if (!zoomButton) return;
    // A bass pulse: a dot with sound waves going out both sides, the outer ones fainter as they spread;
    // when off, struck through and dimmed. Waves and slash are strokes (fill="none" beats the inherited fill).
    const svg = page.createSvg('svg');
    svg.setAttr('viewBox', '0 0 24 24');
    const add = (d, stroke, opacity = 1) => {
      const path = page.createSvg('path');
      path.setAttr('d', d);
      if (stroke) {
        path.setAttr('fill', 'none'); path.setAttr('stroke', '#fff');
        path.setAttr('stroke-width', '2'); path.setAttr('stroke-linecap', 'round');
      }
      path.setAttr('opacity', String(opacity));
      svg.append(path);
    };
    add('M12 9.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5z');
    add('M15.5 8.5a5 5 0 0 1 0 7M8.5 8.5a5 5 0 0 0 0 7', true);
    add('M18.5 5.5a9.2 9.2 0 0 1 0 13M5.5 5.5a9.2 9.2 0 0 0 0 13', true, 0.55);
    if (!zoomOn) add('M4 4 20 20', true);
    for (const c of zoomButton.children) c.remove();
    zoomButton.append(svg);
    zoomButton.setAttr('aria-pressed', String(zoomOn));
    zoomButton.setAttr('aria-label', zoomOn ? 'Turn off kick zoom' : 'Turn on kick zoom');
    zoomButton.setAttr('title', zoomOn ? 'Kick zoom on: click to turn it off' : 'Kick zoom off: click to turn it on');
  };

  let button;
  const addButton = () => {
    zoomButton = page.create('button');
    zoomButton.classes.add('trif-box-wm-rainbow-music'); zoomButton.classes.add('trif-box-wm-rainbow-zoom');
    zoomButton.on('click', (e) => {
      e.stopPropagation();
      zoomOn = !zoomOn;
      if (zoomSetting) zoomSetting.save(zoomOn ? 'on' : 'off').catch(() => {});
      syncZoom();
    });
    page.body.append(zoomButton);
    syncZoom();
    button = page.create('button');
    button.classes.add('trif-box-wm-rainbow-music');
    button.setAttr('title', 'Play/pause rainbow music');
    button.on('click', (e) => {
      e.stopPropagation();
      for (const off of offGesture.splice(0)) off();   // the user chose: no autoplay after this
      musicOn = !musicOn;
      try { if (musicOn) start(); } catch (err) { trif.warn('music failed', String(err)); musicOn = false; }
      sync();
    });
    page.body.append(button);
    sync();
  };
  STYLE += `
    /* (X-Flyer hid the buttons by their old name, .wm-rainbow-music, while it's ready: now they do it) */
    html[data-tss-ready] .trif-box-wm-rainbow-music { display: none !important; }
    .trif-box-wm-rainbow-music { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 40px; height: 40px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.6) !important; background-color: rgba(0,0,0,0.5) !important;
      padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .trif-box-wm-rainbow-music svg { width: 20px; height: 20px; fill: #fff; display: block; }
    .trif-box-wm-rainbow-zoom { right: 64px; }
    .trif-box-wm-rainbow-zoom[aria-pressed=false] { opacity: 0.6; }
  `;
  trif.css(STYLE);
  trif.ready.then(addButton);

  // ---- With X-Flyer (x.com/space-shooter), which marks <html> with data-tss-ready: these buttons are
  // gone (hidden by X-Flyer's CSS), the kick zoom always pulses (see kickPulse), and the music is on
  // (from the first gesture, as usual) unless X-Flyer's music switch is off (html[data-tss-music-off]),
  // which turns it off and on from then on.
  const flyerOn = () => page.root.attr('data-tss-ready') !== null;
  // (data-tss-dying: X-Flyer's last life just blew up; the music stops for the big boom and "YOU DIED", and
  // comes back when the game starts over)
  const flyerMuted = () => page.root.attr('data-tss-music-off') !== null
    || page.root.attr('data-tss-dying') !== null;
  let flyerMusic = null;   // what X-Flyer's switch last said (null: not seen yet)
  const followFlyer = () => {
    try {
      if (!flyerOn()) return;
      const want = !flyerMuted();
      if (want === flyerMusic) return;
      const first = flyerMusic === null;
      flyerMusic = want;
      if (!want) {
        for (const off of offGesture.splice(0)) off();
        if (musicOn) { musicOn = false; sync(); }
      } else if (!first && !musicOn) {   // (switched on: a click, so audio may start now)
        musicOn = true; start(); sync();
      }   // (on at load: the first gesture starts it)
    } catch (e) { trif.warn('rave with X-Flyer failed', String(e)); }
  };
  followFlyer();
  trif.observe('html', followFlyer, { attributes: ['data-tss-ready', 'data-tss-music-off', 'data-tss-dying'] });

  // ---- Rave checks, likes and bookmarks (was the separate Rave Checks mod): a fast, small rainbow on
  // verified checks, liked hearts and their counts, saved bookmarks and hovered post interactions. ----
  // In its own block so its names don't clash with the ones above.
  {
    // One complete hue cycle every ~24px, rolling past in 0.8s. Its small, local image is independent
    // of the viewport background above and of X's transformed feed rows.
    // (A seamless tile, TILE: exactly 3 hue cycles across, 102 px, so tiles meet stripe to stripe on anything
    // of any size (the old 96 px image was 2.83 cycles across and ran out, or met itself at a seam, on wider
    // things like long counts). The stripes are 24.04 px apart on the diagonal, so one cycle is an exact 17 px
    // step across and up: see trif-rave-icons-roll. Tim's: same tile as Profile Styler's RAVE_TILE.)
    const RB_P = 102 / (3 * Math.SQRT2);
    const RAINBOW = `repeating-linear-gradient(45deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% 60%) ${(i * RB_P / 12).toFixed(4)}px`).join(', ')})`;
    const TILE = 'background-size: 102px 102px; background-repeat: repeat;';
    const mask = (path, size, viewBox = `0 0 ${size} ${size}`) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path fill="white" d="${path}"/></svg>`)}")`;
    const CHECK_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'%3E%3Cpath fill='white' d='M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z'/%3E%3C/svg%3E")`;
    const FILLED_HEART_MASK = mask('M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z', 24);
    const BOOKMARK_MASK = mask('M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z', 24);
    const ICON_CSS = `
      /* Translate one hue cycle along the up/right diagonal: an exact 17px across and up (the tile repeats,
         so nothing runs out) */
      @keyframes trif-rave-icons-roll {
        from { background-position: -40px -20px; }
        to { background-position: -23px -37px; }
      }
      @keyframes trif-rave-heart-pop {
        0% { transform: scale(0.2); }
        45% { transform: scale(1.45); }
        100% { transform: scale(1); }
      }
      @keyframes trif-rave-heart-burst {
        from { transform: scale(.35); opacity: 1; }
        to { transform: scale(1.6); opacity: 0; }
      }
      [data-trif-box-rave-check], [data-trif-box-rave-heart], [data-trif-box-rave-bookmark] { position: relative !important; }
      [data-trif-box-rave-check] > svg[data-testid="icon-verified"],
      button[data-testid="removeBookmark"] [data-trif-box-rave-bookmark] > svg { opacity: 0 !important; }
      /* X temporarily replaces the heart SVG with a red animation. Hide that entire icon subtree
         while liked; our own rainbow heart and burst cover both the animated and settled states. */
      button[data-testid="unlike"] [data-trif-box-rave-heart] > * { visibility: hidden !important; }
      [data-trif-box-rave-check] { --trif-box-rave-mask: ${CHECK_MASK}; }
      [data-trif-box-rave-heart] { --trif-box-rave-mask: ${FILLED_HEART_MASK}; }
      [data-trif-box-rave-bookmark] { --trif-box-rave-mask: ${BOOKMARK_MASK}; }
      [data-trif-box-rave-check]::after,
      button[data-testid="unlike"] [data-trif-box-rave-heart]::after,
      button[data-testid="removeBookmark"] [data-trif-box-rave-bookmark]::after {
        content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
        background-image: ${RAINBOW} !important;
        ${TILE}
        animation: trif-rave-icons-roll 0.8s linear infinite;
        animation-delay: var(--trif-box-icons-delay, 0s);
        -webkit-mask: var(--trif-box-rave-mask) center / contain no-repeat;
        mask: var(--trif-box-rave-mask) center / contain no-repeat;
      }
      [data-trif-box-rave-like-pop] button[data-testid="unlike"] [data-trif-box-rave-heart]::after,
      button[data-trif-box-rave-like-pop][data-testid="unlike"] [data-trif-box-rave-heart]::after {
        animation: trif-rave-icons-roll 0.8s linear infinite,
          trif-rave-heart-pop 0.48s cubic-bezier(.2, .75, .25, 1) both;
        animation-delay: var(--trif-box-icons-delay, 0s), 0s;
      }
      [data-trif-box-rave-like-pop] button[data-testid="unlike"] [data-trif-box-rave-heart]::before,
      button[data-trif-box-rave-like-pop][data-testid="unlike"] [data-trif-box-rave-heart]::before {
        content: ''; position: absolute; inset: -50%; pointer-events: none; z-index: 2;
        background-image: ${RAINBOW} !important; ${TILE}
        mask: radial-gradient(transparent 53%, #000 56% 64%, transparent 67%);
        animation: trif-rave-icons-roll .8s linear infinite, trif-rave-heart-burst .52s ease-out both;
        animation-delay: var(--trif-box-icons-delay, 0s), 0s;
      }
      /* Hover colours only the icon, not the adjacent count or the button's hover background. */
      [data-trif-box-rave-hover-icon] { position: relative !important; }
      [data-trif-box-rave-hover]:hover [data-trif-box-rave-hover-icon] > svg { opacity: 0 !important; }
      [data-trif-box-rave-hover]:hover [data-trif-box-rave-hover-icon]::after {
        content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
        background-image: ${RAINBOW} !important; ${TILE}
        animation: trif-rave-icons-roll .8s linear infinite;
        animation-delay: var(--trif-box-icons-delay, 0s);
        -webkit-mask: var(--trif-box-rave-hover-mask) center / contain no-repeat;
        mask: var(--trif-box-rave-hover-mask) center / contain no-repeat;
      }
      /* X places interaction counts in leaf spans inside its animated number container. */
      [data-trif-box-rave-hover]:hover [data-testid="app-text-transition-container"] span:not(:has(span)),
      button[data-testid="unlike"] [data-testid="app-text-transition-container"] span:not(:has(span)) {
        color: transparent !important; -webkit-text-fill-color: transparent !important;
        background-image: ${RAINBOW} !important; ${TILE}
        background-clip: text !important; -webkit-background-clip: text !important;
        animation: trif-rave-icons-roll .8s linear infinite;
      }
      /* No text shadow on the counts (it muddies the rainbow ones); the rest of X keeps it. */
      [data-testid="app-text-transition-container"], [data-testid="app-text-transition-container"] * {
        text-shadow: none !important;
      }
    `;
    trif.css(ICON_CSS);
    // New checks and hearts pick up the same phase even when X mounts them during scrolling: each gets the
    // delay that puts its start on the page's time origin (the counts on themselves; the icons, drawn by a
    // ::before or ::after, through a variable on their holder).
    page.on('animationstart', (event) => {
      if (event.animationName !== 'trif-rave-icons-roll' || !event.target) return;
      try {
        if (event.target.matches('[data-testid="app-text-transition-container"] span')) event.target.style('animation-delay', delayNow(event));
        else event.target.style('--trif-box-icons-delay', delayNow(event));
      } catch (e) { trif.warn('rave icon animation sync failed', String(e)); }
    }, { capture: true });
    const hoverPaths = new WeakMap();
    const mark = () => {
      try {
        page.findAll('svg[data-testid="icon-verified"]').forEach((svg) => {
          const holder = svg.parent;
          if (holder && holder.attr('data-trif-box-rave-check') === null) holder.setAttr('data-trif-box-rave-check', '');
        });
        page.findAll('button[data-testid="like"], button[data-testid="unlike"]').forEach((button) => {
          // Keep identifying the same icon slot even while X swaps its SVG for an animation.
          const holder = button.children[0]?.children[0];
          if (holder && holder.attr('data-trif-box-rave-heart') === null) holder.setAttr('data-trif-box-rave-heart', '');
        });
        page.findAll('button[data-testid="bookmark"], button[data-testid="removeBookmark"]').forEach((button) => {
          const holder = button.find('svg[viewBox="0 0 24 24"]')?.parent;
          if (holder && holder.attr('data-trif-box-rave-bookmark') === null) holder.setAttr('data-trif-box-rave-bookmark', '');
        });
        const interactions = 'article :is(button[data-testid="reply"], button[data-testid="retweet"], button[data-testid="unretweet"], button[data-testid="like"], button[data-testid="unlike"], button[data-testid="bookmark"], button[data-testid="removeBookmark"], a[href*="/status/"][href$="/analytics"], button[aria-label="Share post"], button[data-testid="caret"], button[aria-label="Grok actions"])';
        page.findAll(interactions).forEach((control) => {
          // Most icons are 24x24; Grok's is 33x32, so the mask copies each icon's own viewBox.
          const svg = control.find('svg[viewBox]');
          const viewBox = svg?.attr('viewBox');
          const paths = svg?.findAll('path');
          const path = paths?.length === 1 && paths[0].attr('d');
          const holder = svg?.parent;
          // Only embed SVG path commands and numbers from X; malformed or unfamiliar icons stay original.
          if (!holder || !path || path.length > 5000 || !/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]+$/.test(path)) return;
          if (!/^[0-9.\s-]+$/.test(viewBox)) return;
          if (hoverPaths.get(holder) !== path) {
            holder.style('--trif-box-rave-hover-mask', mask(path, 24, viewBox));
            hoverPaths.set(holder, path);
          }
          if (control.attr('data-trif-box-rave-hover') === null) control.setAttr('data-trif-box-rave-hover', '');
          if (holder.attr('data-trif-box-rave-hover-icon') === null) holder.setAttr('data-trif-box-rave-hover-icon', '');
        });
      } catch (e) { trif.warn('rave icon scan failed', String(e)); }
    };
    let queued = false;
    const schedule = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); }, 16); } };
    // (what the original's one MutationObserver saw: elements added and removed, and those four attributes)
    trif.changes('html', schedule);
    trif.observe('[data-testid], [aria-label], a[href], svg path', schedule, { attributes: ['data-testid', 'd', 'href', 'aria-label'] });
    // On a real like click, keep the rainbow visible through X's brief burst and settled state.
    page.on('click', (event) => {
      try {
        const button = event.target?.closest('button[data-testid="like"]');
        if (!button) return;
        const owner = button.closest('article') || button;
        owner.setAttr('data-trif-box-rave-like-pop', '');
        setTimeout(() => owner.removeAttr('data-trif-box-rave-like-pop'), 520);
      } catch (e) { trif.warn('rave heart pop failed', String(e)); }
    }, { capture: true });
    schedule();
  }
}
