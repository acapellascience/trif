// The home page's "Try the demo" tab: opens the real TRIF side panel (/demo/ext/sidepanel.html, with
// shim.js standing in for the extension) docked to the right of this page, like the browser's side panel:
// the page moves over to make room. At phone width it's a sheet over the bottom of the page.
//
// The mods run on this page: when the panel switches one (or the robot), it asks for the page again with the
// mods that are on (/?mods=a,b; the Worker adds only mods it has), and the panel opens again by itself after
// the reload (sessionStorage), where shim.js picks up its state. Without this script there's no tab.
//
// The tab and the panel live outside <body>, in the top layer where the browser has it (popover): mods that
// take the page apart (gravity, the shooter) walk or transform the body, and mustn't take the demo
// with it. (Someone running the real TRIF here gets the demo like anyone else: the extension never marks a
// page, so this site can't tell, and its mods are theirs to make, as on any other site.)
(() => {
  const tab = document.querySelector('.demo-tab');
  if (!tab) return;
  const root = document.documentElement;
  const OPEN = 'trif-demo-open';
  const MIN = 'trif-demo-min';
  const FOCUS = 'trif-demo-focus';
  const remember = (on) => { try { sessionStorage.setItem(OPEN, on ? '1' : ''); } catch {} };
  const phone = () => matchMedia('(max-width: 700px)').matches; // the sheet over the bottom of the page
  const topLayer = typeof tab.showPopover === 'function';
  let box = null;
  let frame = null;

  // The window as the mods see it. The browser's real side panel makes the window narrower; this one only sits
  // over the page (the page moves over for it: pages.js). So while it's open, the window's size, as mods
  // measure it (innerWidth / innerHeight, and the root's clientWidth / clientHeight), stops at the panel's
  // edge (or, at phone width, at the top of the sheet), and mods that keep things inside the window (the
  // robot, the shooter, gravity) keep them out from behind it. Measured when the panel opens or closes and
  // when the window resizes, which mods hear about (a resize event).
  const cut = { w: 0, h: 0 };
  const lookup = (o, k) => { for (let p = o; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) return d; } return null; };
  function shrink(obj, key, axis) {
    const d = lookup(obj, key);
    if (!d || !d.get || !d.configurable) return;
    Object.defineProperty(obj, key, { configurable: true, enumerable: d.enumerable, set: d.set, get() { return Math.max(0, d.get.call(obj) - cut[axis]); } });
  }
  shrink(window, 'innerWidth', 'w');
  shrink(window, 'innerHeight', 'h');
  shrink(root, 'clientWidth', 'w');
  shrink(root, 'clientHeight', 'h');
  function measure() {
    const was = `${cut.w},${cut.h}`;
    cut.w = cut.h = 0;
    if (isOpen()) {
      const r = box.getBoundingClientRect();
      const w = root.clientWidth + cut.w, h = root.clientHeight + cut.h; // (cut is 0 here: the whole window)
      if (r.top <= 0 && r.left > 0) cut.w = Math.max(0, Math.round(w - r.left));
      else if (r.top > 0) cut.h = Math.max(0, Math.round(h - r.top));
    }
    return was !== `${cut.w},${cut.h}`;
  }
  // First in line for the browser's resize events (mods' scripts come after this one), and one of our own
  // when the panel opens or closes.
  addEventListener('resize', (e) => { if (e.isTrusted) measure(); });
  const remeasure = () => { if (measure()) dispatchEvent(new Event('resize')); };

  // Back on the plain home page (no ?mods=: its address typed again, a link back here) with demo mods
  // switched on earlier in this tab: the page runs only the mods its address names, so ask for it again with
  // the ones the panel says are on (shim.js keeps its switches in this tab's sessionStorage), as switching
  // them does. Once per page: if the Worker leaves some out, the panel's switches still say what's on.
  try {
    const params = new URLSearchParams(location.search);
    const saved = JSON.parse(sessionStorage.getItem('trif-demo-state') || 'null');
    if (!params.has('mods') && saved?.v === 1) {
      const off = saved.store?.disabled || {};
      const siteOn = Array.isArray(saved.sitesOn) && saved.sitesOn.length > 0;
      const on = siteOn ? (saved.mods || []).filter((s) => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s) && !off[`timsrobot.com/${s}`]) : [];
      const want = on.join(',');
      if (on.length && sessionStorage.getItem('trif-demo-synced') !== want) {
        sessionStorage.setItem('trif-demo-synced', want);
        location.replace(`/?mods=${want}${location.hash}`);
        return;
      }
    }
    if (params.has('mods')) sessionStorage.removeItem('trif-demo-synced');
  } catch { /* no sessionStorage: nothing was remembered */ }

  // Space Shooter's You Win screen, in the demo, offers two more ways on (its `trif-demo-reset` event):
  // "sandbox mode": every mod switched off, the panel open on its switches, to try them one by one; and
  // "restart the demo": back to how a first visit finds it (the demo's state, the mute, the rave's
  // unlocked buttons and the panel's open mod list all forgotten). Both load the plain home page again.
  addEventListener('trif-demo-reset', (e) => {
    const to = e.detail?.to;
    try {
      if (to === 'sandbox') {
        // the panel's mods (and any the page runs that it doesn't list yet, from a link), all off
        let saved = JSON.parse(sessionStorage.getItem('trif-demo-state') || 'null');
        if (saved?.v !== 1) saved = { v: 1, sitesOn: ['timsrobot.com'], store: {}, mods: [] };
        const running = (new URLSearchParams(location.search).get('mods') || '').split(',').filter((n) => /^[a-z0-9-]{1,40}$/.test(n));
        saved.mods = [...new Set([...(saved.mods || []), ...running])];
        saved.store = saved.store || {};
        saved.store.disabled = Object.fromEntries(saved.mods.map((s) => [`timsrobot.com/${s}`, true]));
        saved.active = null;
        const chat = saved.store['chat:timsrobot.com'];
        if (chat) chat.run = null;
        sessionStorage.setItem('trif-demo-state', JSON.stringify(saved));
        sessionStorage.setItem(OPEN, '1');
        sessionStorage.setItem(MIN, '');
        try { localStorage.setItem('modsOpen', 'true'); } catch {}
      } else if (to === 'restart') {
        for (const k of Object.keys(sessionStorage)) if (k.startsWith('trif-demo') || k === 'trif.muted') sessionStorage.removeItem(k);
        for (const k of ['wmRainbow.unlocked', 'wmRainbow.zoom', 'modsOpen']) localStorage.removeItem(k);
      } else return;
    } catch { /* no storage: the page comes back as it would anyway */ }
    location.replace('/');
  });

  // The site's other pages (the report form, the Windows waitlist) run the same mods when their address
  // names them (the Worker adds them, as on this page): a link to one carries this page's ?mods=, so the
  // visitor's demo mods follow them there, as TRIF's would. Set as the link is followed (mods like the LED
  // sign copy the footer's links, so the copies count too).
  const OTHER_PAGES = new Set(['/report', '/windows']);
  const carryMods = (e) => {
    const mods = new URLSearchParams(location.search).get('mods');
    const a = e.target.closest?.('a[href]');
    if (!mods || !a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin || !OTHER_PAGES.has(u.pathname.replace(/\/$/, '')) || u.searchParams.has('mods')) return;
    const names = mods.split(',').map(encodeURIComponent).join(','); // (commas kept readable)
    a.href = `${u.pathname}${u.search ? `${u.search}&` : '?'}mods=${names}${u.hash}`;
  };
  addEventListener('click', carryMods, true);
  addEventListener('auxclick', carryMods, true);
  addEventListener('contextmenu', carryMods, true); // (copy link, open in new tab)

  function build() {
    box = document.createElement('aside');
    box.className = 'demo-panel';
    box.setAttribute('aria-label', 'TRIF side panel (demo)');
    const top = document.createElement('div');
    top.className = 'demo-panel-top';
    const name = document.createElement('span');
    name.textContent = 'TRIF demo';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'demo-close';
    close.title = 'Close the demo';
    close.setAttribute('aria-label', 'Close the demo');
    close.textContent = '×';
    close.addEventListener('click', () => hide());
    top.append(name, close);
    swipe(top, close);
    frame = document.createElement('iframe');
    frame.src = '/demo/ext/sidepanel.html';
    frame.title = 'The TRIF side panel';
    const note = document.createElement('p');
    note.className = 'demo-panel-note';
    note.textContent = 'Demo: based on real Claude Code sessions';
    box.append(top, frame, note);
    // Outside <body> (mods that take the page apart walk the body), and in the top layer where the browser
    // has it (popover), above mods' full-window layers.
    if (typeof box.showPopover === 'function') box.popover = 'manual';
    else box.hidden = true;
    root.append(box);
  }

  const isOpen = () => !!box && root.classList.contains('demo-open');

  // At phone width, the sheet's top bar can be swiped down to tuck the sheet away (only the bar stays, at
  // the bottom of the window) and swiped up, or tapped, to bring it back. Remembered across the page's
  // reloads in this tab. The window as mods see it grows and shrinks with it (remeasure, after the slide).
  const minimized = () => root.classList.contains('demo-min');
  function minimize(on) {
    root.classList.toggle('demo-min', on);
    try { sessionStorage.setItem(MIN, on ? '1' : ''); } catch {}
    const done = () => { box?.removeEventListener('transitionend', done); clearTimeout(timer); remeasure(); };
    const timer = setTimeout(done, 400); // (in case no transition runs)
    box?.addEventListener('transitionend', done);
  }
  function swipe(bar, except) {
    let start = null;
    bar.addEventListener('pointerdown', (e) => {
      if (!phone() || except.contains(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { id: e.pointerId, y: e.clientY };
      try { bar.setPointerCapture(e.pointerId); } catch {}
    });
    bar.addEventListener('pointermove', (e) => {
      if (start?.id !== e.pointerId || minimized()) return;
      box.style.translate = `0 ${Math.max(0, e.clientY - start.y).toFixed(0)}px`; // the sheet follows the finger down
    });
    const end = (e) => {
      if (start?.id !== e.pointerId) return;
      const dy = e.clientY - start.y;
      start = null;
      box.style.translate = '';
      if (e.type === 'pointercancel') return;
      if (!minimized() && dy > 40) minimize(true);
      else if (minimized() && (dy < -20 || Math.abs(dy) < 8)) minimize(false); // swiped up, or tapped
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function showTab(on) {
    tab.hidden = !on;
    if (!tab.popover) return;
    if (on && !tab.matches(':popover-open')) tab.showPopover();
    else if (!on && tab.matches(':popover-open')) tab.hidePopover();
  }

  function show() {
    if (!box) build();
    if (box.popover) { if (!box.matches(':popover-open')) box.showPopover(); } else box.hidden = false;
    root.classList.add('demo-open');
    showTab(false);
    remember(true);
    remeasure();
  }
  function open() { // from the tab: the whole sheet
    if (minimized()) minimize(false);
    show();
  }

  // Once the panel's been closed, the tab brings it back: "Show the fixer" (it says "Try the demo" until
  // it's been open; at a desk it starts open).
  const tabLabel = () => { tab.textContent = 'Show the fixer'; };
  function hide() {
    if (!isOpen()) return;
    if (box.popover) box.hidePopover(); else box.hidden = true;
    root.classList.remove('demo-open', 'demo-min');
    try { sessionStorage.setItem(MIN, ''); } catch {}
    tabLabel();
    showTab(true);
    tab.focus();
    remember(false);
    remeasure();
  }

  // The panel (shim.js) asks for the page with other mods: only names, and the Worker checks them too.
  addEventListener('message', (e) => {
    if (!frame || e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type !== 'trif-demo:load') return;
    const ok = (n) => typeof n === 'string' && /^[a-z0-9-]{1,40}$/.test(n);
    const names = (Array.isArray(d.mods) ? d.mods : []).filter(ok);
    const made = ok(d.made) ? d.made : '';
    // At a desk, every change of mods reloads the page, as it does with the real TRIF installed. On a phone,
    // a chat's mod (live: the page keeps what it has and only gains mods) is added to the page as it is
    // (their scripts, as the Worker serves them for ?mods=), with no reload: sound keeps playing and
    // nothing flashes. The address follows, so a reload later gets the same page. Losing a mod reloads the
    // page there too: mods can't take themselves back out.
    const running = (new URLSearchParams(location.search).get('mods') || '').split(',').filter(ok);
    if (d.live === true && phone() && running.every((n) => names.includes(n))) {
      history.replaceState(history.state, '', `/?mods=${names.join(',')}${location.hash}`);
      for (const n of names) {
        if (running.includes(n)) continue;
        const s = document.createElement('script');
        s.src = `/demo/mods/${n}.js`;
        s.async = false; // (in order, if there's more than one)
        document.head.append(s);
      }
      // (mods that list what's there, like Terminal Box, hear about the new ones)
      dispatchEvent(new CustomEvent('trif-demo-mods', { detail: { mods: names.slice() } }));
      if (made === 'shooter' && phone() && !minimized()) minimize(true); // (a game: the sheet out of the ship's way)
      focusOn(made);
      return;
    }
    remember(true);
    // A chat just made this mod: after the reload, on a phone, show the part of the page it changed.
    try { sessionStorage.setItem(FOCUS, typeof d.made === 'string' && /^[a-z0-9-]{1,40}$/.test(d.made) ? d.made : ''); } catch {}
    // The shooter is a game: on a phone, the sheet comes back tucked away, out of the way of the ship.
    if (d.made === 'shooter' && phone()) { try { sessionStorage.setItem(MIN, '1'); } catch {} }
    location.replace(names.length ? `/?mods=${names.join(',')}` : '/');
  });

  // Out of <body>, like the panel; in the top layer where there is one.
  root.append(tab);
  if (topLayer) tab.popover = 'manual';
  showTab(true);
  tab.addEventListener('click', open);
  // Escape closes the panel only from the demo's own controls: on the page, mods use it (Gravity puts the
  // page back with it).
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && box.contains(document.activeElement) && !e.defaultPrevented) hide(); });
  // On a phone, after the reload a chat's mod causes: the part of the page that mod changes, scrolled into
  // the space above the sheet (mods that change the whole page, like Gravity, have none).
  const heading = (words) => [...document.querySelectorAll('h2')].find((h) => h.textContent.toLowerCase().includes(words))?.parentElement;
  const FOCUS_ON = {
    tagline: () => document.querySelector('.hero .tagline'),
    robot: () => document.querySelector('svg.robot'),
    jelly: () => document.querySelector('.hero .links'),
    neon: () => document.querySelector('.hero h1'),
    stickers: () => document.querySelector('.sb-row') || document.querySelector('.hero .small'),
    fireworks: () => document.querySelector('.hero .links'),
    checklist: () => heading('what you need'),
    terminal: () => document.querySelector('[data-tb]') || heading('yours, on your computer'),
    led: () => document.querySelector('footer'),
  };
  function showMade() {
    let slug = '';
    try { slug = sessionStorage.getItem(FOCUS) || ''; sessionStorage.removeItem(FOCUS); } catch {}
    focusOn(slug);
  }
  function focusOn(slug) {
    if (!slug || !phone() || !FOCUS_ON[slug]) return;
    setTimeout(() => { // (once the mod has had its moment to change the page)
      try {
        const el = FOCUS_ON[slug]();
        if (!el) return;
        const r = el.getBoundingClientRect(), room = innerHeight; // (innerHeight stops at the sheet: see cut)
        if (r.top >= 8 && r.bottom <= room - 8) return; // already in view
        scrollBy({ top: r.top - 12, behavior: 'smooth' }); // (near the top: some, like Terminal Box, grow as they play)
      } catch {}
    }, 700);
  }

  // Open again after a reload if it was open; at a desk, open from the start (the first visit to the page
  // in this tab); on a phone, the tab waits to be tapped. Closed before: the tab says so.
  let reopen = false;
  try {
    const was = sessionStorage.getItem(OPEN);
    reopen = was === '1' || (was === null && !phone());
    if (was === '') tabLabel();
  } catch {}
  if (reopen) {
    try { if (sessionStorage.getItem(MIN) === '1' && phone()) root.classList.add('demo-min'); } catch {}
    show();
    if (document.readyState === 'complete') showMade(); else addEventListener('load', showMade, { once: true });
  }
})();
