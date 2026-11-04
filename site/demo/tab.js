// The home page's "Try the demo" tab: opens the real TRIF side panel (/demo/ext/sidepanel.html, with
// shim.js standing in for the extension) docked to the right of this page, like the browser's side panel:
// the page moves over to make room. At phone width it's a sheet over the bottom of the page.
//
// The mods run on this page: when the panel switches one (or the robot), it asks for the page again with the
// mods that are on (/?mods=a,b; the Worker adds only mods it has), and the panel opens again by itself after
// the reload (sessionStorage), where shim.js picks up its state. Without this script there's no tab.
//
// The tab and the panel live outside <body>, in the top layer where the browser has it (popover): mods that
// take the page apart (gravity, the shooter, tilting) walk or transform the body, and mustn't take the demo
// with it. Someone running the real TRIF, on for this site, has the real mods: the extension marks the page
// (<html data-trif="on">, before the page's scripts run; extension/lib.js homeMarkerScript), and then
// there's no tab, the panel doesn't come back after a reload, and the demo's mods do nothing (src/demo.js).
(() => {
  const tab = document.querySelector('.demo-tab');
  if (!tab) return;
  const root = document.documentElement;
  const OPEN = 'trif-demo-open';
  const MIN = 'trif-demo-min';
  const remember = (on) => { try { sessionStorage.setItem(OPEN, on ? '1' : ''); } catch {} };
  const phone = () => matchMedia('(max-width: 700px)').matches; // the sheet over the bottom of the page
  const realTrif = () => root.getAttribute('data-trif') === 'on';
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
  const shrunk = [];
  function shrink(obj, key, axis) {
    const d = lookup(obj, key);
    if (!d || !d.get || !d.configurable) return;
    const own = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { configurable: true, enumerable: d.enumerable, set: d.set, get() { return Math.max(0, d.get.call(obj) - cut[axis]); } });
    shrunk.push(() => { if (own) Object.defineProperty(obj, key, own); else delete obj[key]; });
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

  // The real TRIF is on here: no demo at all (and it doesn't reopen after the next reload either).
  function standAside() {
    remember(false);
    if (box) { if (box.popover && box.matches(':popover-open')) box.hidePopover(); box.remove(); box = null; frame = null; }
    root.classList.remove('demo-open', 'demo-min');
    if (tab.popover && tab.matches(':popover-open')) tab.hidePopover();
    tab.remove();
    cut.w = cut.h = 0;
    while (shrunk.length) shrunk.pop()();
  }
  if (realTrif()) { standAside(); return; }

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

  new MutationObserver(() => { if (realTrif()) standAside(); }).observe(root, { attributes: true, attributeFilter: ['data-trif'] });

  // The site's other pages (the report form, the Windows waitlist) run the same mods when their address
  // names them (the Worker adds them, as on this page): a link to one carries this page's ?mods=, so the
  // visitor's demo mods follow them there, as TRIF's would. Set as the link is followed (mods like the LED
  // sign copy the footer's links, so the copies count too).
  const OTHER_PAGES = new Set(['/report', '/windows']);
  const carryMods = (e) => {
    if (realTrif()) return;
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
    note.textContent = 'Demo: the real TRIF side panel, with recordings of real Claude Code chats, sped up. The switches really run the mods on this page.';
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
    if (realTrif()) return standAside();
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

  function hide() {
    if (!isOpen()) return;
    if (box.popover) box.hidePopover(); else box.hidden = true;
    root.classList.remove('demo-open', 'demo-min');
    try { sessionStorage.setItem(MIN, ''); } catch {}
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
    const names = (Array.isArray(d.mods) ? d.mods : []).filter((n) => typeof n === 'string' && /^[a-z0-9-]{1,40}$/.test(n));
    remember(true);
    // A recorded chat made a mod: on a phone the sheet comes back tucked away, so the page shows it off.
    if (d.made === true && phone()) { try { sessionStorage.setItem(MIN, '1'); } catch {} }
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
  let reopen = false;
  try { reopen = sessionStorage.getItem(OPEN) === '1'; } catch {}
  if (reopen) {
    try { if (sessionStorage.getItem(MIN) === '1' && phone()) root.classList.add('demo-min'); } catch {}
    show();
  }
})();
