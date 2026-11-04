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
  const remember = (on) => { try { sessionStorage.setItem(OPEN, on ? '1' : ''); } catch {} };
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
    root.classList.remove('demo-open');
    if (tab.popover && tab.matches(':popover-open')) tab.hidePopover();
    tab.remove();
    cut.w = cut.h = 0;
    while (shrunk.length) shrunk.pop()();
  }
  if (realTrif()) { standAside(); return; }
  new MutationObserver(() => { if (realTrif()) standAside(); }).observe(root, { attributes: true, attributeFilter: ['data-trif'] });

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

  function hide() {
    if (!isOpen()) return;
    if (box.popover) box.hidePopover(); else box.hidden = true;
    root.classList.remove('demo-open');
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
    location.replace(names.length ? `/?mods=${names.join(',')}` : '/');
  });

  // Out of <body>, like the panel; in the top layer where there is one.
  root.append(tab);
  if (topLayer) tab.popover = 'manual';
  showTab(true);
  tab.addEventListener('click', show);
  // Escape closes the panel only from the demo's own controls: on the page, mods use it (Gravity puts the
  // page back with it).
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && box.contains(document.activeElement) && !e.defaultPrevented) hide(); });
  let reopen = false;
  try { reopen = sessionStorage.getItem(OPEN) === '1'; } catch {}
  if (reopen) show();
})();
