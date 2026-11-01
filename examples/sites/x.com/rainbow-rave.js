// ==WebMod==
// @name        Rainbow Rave
// @description All text white, over a rolling psychedelic rainbow background (chat, calls and menus included)
// @match       https://x.com/*
// @run-at      document-start
// @risk        1 patches attachShadow (to style chat and calls), which the page's scripts could notice
// @source      webmods
// @version     1
// ==/WebMod==

(() => {
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
  const style = document.createElement('style');
  style.textContent = `
    /* The rainbow lives on a fixed layer behind everything, so it doesn't scroll with the feed. */
    html::before {
      content: ''; position: fixed; top: 0; bottom: 0; left: 0; z-index: -1; pointer-events: none;
      width: ${WIDTH};
      background: ${RAINBOW};
      will-change: transform;
      animation: wm-rainbow-roll ${ROLL};
    }
    @keyframes wm-rainbow-roll { from { transform: translateX(0); } to { transform: translateX(${SLIDE}); } }

    /* X (and Plain X) paint black/white on almost every container via generated classes: clear them
       all. Only background-color, so avatars and media (background-image) still show. */
    /* Scoped to the app (#react-root) and Plain X's search page, never all of body: X signs some
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
       "Everyone" audience picker), and Plain X's Filters menu (.dm-menu, in <body>, outside #react-root).
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
    #react-root, .dm-search, .dm-menu { text-shadow: 0 0 3px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(0, 0, 0, 0.6); }
    :is(#react-root, .dm-search, .dm-menu) svg { filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7)); }
  `;
  (document.head || document.documentElement).append(style);

  // CSS animations start whenever their element appears, so a dialog's rainbow would be out of phase
  // with the background's. Pin every rainbow animation to the same start time (the page's time origin).
  const pin = (e) => {
    try {
      if (!e.animationName.startsWith('wm-rainbow')) return;
      const target = e.composedPath()[0];
      for (const a of [...document.getAnimations(), ...(target?.getAnimations?.() || [])]) {
        if (a.animationName?.startsWith('wm-rainbow') && a.startTime !== 0) a.startTime = 0;
      }
    } catch {}
  };
  addEventListener('animationstart', pin, true);

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
  const roots = new Set();
  const styleRoot = (root) => {
    if (!roots.has(root)) { roots.add(root); root.addEventListener('animationstart', pin, true); }
    if (root.querySelector(':scope > style[data-wm-rainbow]')) return;
    if (!root.host.isConnected) return;   // not in the page yet: its turn comes on the next pass
    const s = document.createElement('style');
    s.dataset.wmRainbow = '';
    s.textContent = root.host.closest('#react-root') ? PAGE_ROOT_CSS : POPOVER_ROOT_CSS;
    root.append(s);
  };
  const attachShadow0 = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function () {
    const root = attachShadow0.apply(this, arguments);
    try { roots.add(root); root.addEventListener('animationstart', pin, true); } catch {}
    setTimeout(() => { try { styleRoot(root); } catch (e) { window.webmods?.warn('rainbow shadow style failed', String(e)); } }, 0);
    return root;
  };
  // Style roots once their hosts are in the page, and put the style back if the app re-renders a root.
  setInterval(() => { try { roots.forEach(styleRoot); } catch {} }, 1000);

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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  };
  const voice = (type, freq, t, peak, decay, cutoff, detunes = [0]) => {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4;
    f.connect(g); g.connect(master); env(g, t, peak, decay);
    for (const d of detunes) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = d;
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
  const play = (s, t) => {
    const bar = Math.floor(s / 16) % 4, beat = s % 16, chord = CHORDS[bar];
    if (beat % 4 === 0) kick(t);
    if (beat % 4 === 2) { hiss(t, 'highpass', 8000, 0.25, 0.06); voice('sawtooth', midi(ROOTS[bar]), t, 0.35, 0.12, 900); }
    if (beat % 8 === 4) hiss(t, 'bandpass', 1800, 0.35, 0.18);
    // Supersaw arp, its filter opening over the 4-bar loop.
    const note = chord[ARP[beat % 8]] + 12 + (Math.floor(s / 16) % 2) * 12;
    voice('sawtooth', midi(note), t, 0.09, STEP * 1.6, 1200 + (s % 64) * 60, [-12, 0, 12]);
    if (beat === 0) for (const n of chord) voice('sawtooth', midi(n), t, 0.04, STEP * 16, 1400, [-8, 8]);   // pad
  };
  const tick = () => {
    try {
      while (next < ctx.currentTime + 0.3) { play(step, next); next += STEP; step = (step + 1) % 64; }
    } catch (e) { window.webmods?.warn('music failed', String(e)); stop(); }
  };
  const start = () => {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); master.gain.value = 0.3;
      master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    ctx.resume();
    if (!timer) { next = ctx.currentTime + 0.05; timer = setInterval(tick, 100); }
  };
  const stop = () => { clearInterval(timer); timer = 0; ctx?.suspend(); };
  const sync = () => {
    if (musicOn && !document.hidden && ctx) start(); else stop();
    if (button) {
      // SVG icons rather than ▶/⏸ characters: font glyphs sit off-centre and differ between fonts.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', musicOn ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
      svg.append(path);
      button.replaceChildren(svg);
      button.setAttribute('aria-label', musicOn ? 'Pause rainbow music' : 'Play rainbow music');
    }
  };
  document.addEventListener('visibilitychange', sync);

  // Autoplay on the first click or keypress of each page load (browsers only allow sound after a user
  // gesture), so nobody misses it. A first click on the button itself is left to the button's handler,
  // which would otherwise start the music here and pause it again straight away.
  const firstGesture = (e) => {
    if (button && e.composedPath().includes(button)) return;
    removeEventListener('pointerdown', firstGesture, true);
    removeEventListener('keydown', firstGesture, true);
    if (musicOn) return;
    musicOn = true;
    try { start(); } catch (err) { window.webmods?.warn('music failed', String(err)); musicOn = false; }
    sync();
  };
  addEventListener('pointerdown', firstGesture, true);
  addEventListener('keydown', firstGesture, true);

  let button;
  const addButton = () => {
    button = document.createElement('button');
    button.className = 'wm-rainbow-music';
    button.title = 'Play/pause rainbow music';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEventListener('pointerdown', firstGesture, true);   // the user chose: no autoplay after this
      removeEventListener('keydown', firstGesture, true);
      musicOn = !musicOn;
      try { if (musicOn) start(); } catch (err) { window.webmods?.warn('music failed', String(err)); musicOn = false; }
      sync();
    });
    document.body.append(button);
    sync();
  };
  style.textContent += `
    .wm-rainbow-music { position: fixed; right: 16px; bottom: 16px; z-index: 9999; width: 40px; height: 40px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.6) !important; background-color: rgba(0,0,0,0.5) !important;
      padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .wm-rainbow-music svg { width: 20px; height: 20px; fill: #fff; display: block; }
  `;
  if (document.body) addButton(); else addEventListener('DOMContentLoaded', addButton);
})();
