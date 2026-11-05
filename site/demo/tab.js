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
  const TALL = 'trif-demo-tall'; // sandbox mode on a phone: the sheet nearly full height (pages.js .demo-tall)
  try { sessionStorage.removeItem(TALL); } catch {} // (kb-simple: never full height)
  const FOCUS = 'trif-demo-focus';
  const remember = (on) => { try { sessionStorage.setItem(OPEN, on ? '1' : ''); } catch {} };
  // TEST BRANCH (kb-simple): the phone sheet as it was, half or tucked away; no drag, no full height,
  // no growing, no keyboard handling.
  const SIMPLE = true;
  const phone = () => matchMedia('(max-width: 700px)').matches; // the sheet over the bottom of the page
  const topLayer = typeof tab.showPopover === 'function';
  let box = null, under = null; // (under: see build)
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

  // On a phone with the keyboard up, the screen's visible part (the visual viewport) ends at the keyboard,
  // but the sheet is fixed to the bottom of the page's own viewport, which an iPhone can leave well below it:
  // the gap showed the page behind (a rainbow stripe under Rainbow Rave). So the sheet's bottom follows the
  // visible part's bottom, sitting on the keyboard; with no keyboard (a gap of a toolbar's height or less)
  // it's back at the bottom.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const sit = () => {
      if (!box) return;
      const layoutH = root.clientHeight + cut.h; // (the page's viewport, unshrunk: see cut)
      const gap = phone() ? Math.round(layoutH - (vv.offsetTop + vv.height)) : 0;
      const bottom = gap > 60 ? `${gap}px` : '';
      if (!SIMPLE && box.style.bottom !== bottom) box.style.bottom = bottom;
      if (DEBUG) note(`layout ${layoutH} (root ${root.clientHeight} + cut ${cut.h}) · vv top ${Math.round(vv.offsetTop)} h ${Math.round(vv.height)} · gap ${gap} · bottom ${bottom || '0'} · kb ${keyboardUp} · scrollY ${Math.round(scrollY)}`);
    };
    // ?kbdebug: a line of numbers at the top of the sheet, for finding why it jumps with the keyboard up
    // (kept for the tab, through the demo's own reloads: ?skip=end&kbdebug)
    let DEBUG = false;
    try { if (/[?&]kbdebug/.test(location.search)) sessionStorage.setItem('trif-kbdebug', '1'); DEBUG = !!sessionStorage.getItem('trif-kbdebug'); } catch {}
    const note = (t) => {
      let n = box.querySelector('.kbdebug');
      if (!n) { n = document.createElement('div'); n.className = 'kbdebug'; n.style.cssText = 'position:absolute;left:0;right:0;top:0;z-index:9;font:10px/1.3 monospace;background:#ff0;color:#000;padding:2px 4px;pointer-events:none'; box.append(n); }
      n.textContent = t;
    };
    if (DEBUG) setInterval(sit, 250);
    vv.addEventListener('resize', sit);
    // Not on the visible part's scrolling: a swipe in the strip by the keyboard slides it (the phone won't
    // be stopped), and the sheet chasing it each frame, a frame late, jumped about. Left alone, the sheet
    // just rides along with the slide and settles back with it.
    vv.addEventListener('scroll', () => { if (!keyboardUp) sit(); });
  }
  const remeasure = () => { if (measure()) dispatchEvent(new Event('resize')); };

  // With the keyboard up on a phone, a swipe on the page (the strip between the sheet and the keyboard,
  // or above the sheet) doesn't move anything: the phone would slide the whole page, the sheet with it,
  // and what follows it could only catch up a frame late (rainbow flashing under the see-through keyboard,
  // the sheet jumping). The sheet's own swipes are its own (they're in its frame).
  let keyboardUp = false;
  addEventListener('touchmove', (e) => { if (keyboardUp && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });

  // Testing shortcuts: /?skip=end jumps to the end of the demo (every chat played, every mod on, the panel
  // open, as a fresh tab would be after it), /?skip=win also beats the space game for you (You Win). The
  // panel does the rest (shim.js: trif-demo-skip), and the page reloads with every mod.
  const SKIP = 'trif-demo-skip';
  try {
    const p = new URLSearchParams(location.search), skip = p.get('skip');
    if (skip === 'end' || skip === 'win') {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('trif-demo') || k === 'trif.muted') sessionStorage.removeItem(k);
      sessionStorage.setItem(SKIP, skip);
      sessionStorage.setItem(OPEN, '1');
      p.delete('skip');
      history.replaceState(history.state, '', `${location.pathname}${p.toString() ? `?${p}` : ''}${location.hash}`);
    } else if (sessionStorage.getItem(SKIP) === 'win-load') {
      // (back with every mod: the robot destroyed and ROBOT DESTROYED shot away, through Space Shooter's
      // test hook, which only listens with #tss-test in the address)
      sessionStorage.removeItem(SKIP);
      addEventListener('load', () => setTimeout(() => {
        try {
          const hash = location.hash, at = `${location.pathname}${location.search}`;
          history.replaceState(history.state, '', `${at}#tss-test`);
          dispatchEvent(new Event('tss-test-kill'));
          setTimeout(() => {
            document.querySelectorAll('#tss-banner .tss-w').forEach((w) => w.setAttribute('data-tss-dead', ''));
            history.replaceState(history.state, '', `${at}${hash}`);
          }, 1500);
        } catch {}
      }, 2500));
    }
  } catch {}

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
        saved.sandbox = true; // (the panel clears its chat for the sandbox's note: shim.js)
        sessionStorage.setItem('trif-demo-state', JSON.stringify(saved));
        sessionStorage.setItem(OPEN, '1');
        sessionStorage.setItem(MIN, '');
        sessionStorage.setItem(TALL, '1'); // (on a phone the sheet comes up nearly full height, for the note)
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
    name.textContent = 'Tim\'s Robot Internet Fixer: Demo';
    name.style.cssText = 'min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'; // (a narrow phone: it ends in … rather than pushing the close button off)
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
    // Under the sheet, down to the bottom of the whole screen: its colour, in an ordinary layer. With the
    // keyboard up, an iPhone shows a band of the page under the sheet (behind its address pill, over the
    // keyboard), outside what the sheet (in the top layer) may draw on, but not outside what a layer as
    // tall as the screen reaches (Rainbow Rave's, which showed there). This one covers it.
    under = document.createElement('div');
    under.className = 'demo-under';
    root.append(under);
    new MutationObserver(() => { if (under.nextElementSibling && under.nextElementSibling !== box) root.append(under); }).observe(root, { childList: true }); // (last, so it's over layers the mods add later at the same height)
    const place = () => { try { under.style.top = `${Math.round(box.getBoundingClientRect().top)}px`; } catch {} };
    new ResizeObserver(place).observe(box);
    if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
    addEventListener('scroll', place, { passive: true });
    box.addEventListener('transitionend', place);
    place();
  }

  const isOpen = () => !!box && root.classList.contains('demo-open');

  // At phone width, the sheet's top bar can be swiped down to tuck the sheet away (only the bar stays, at
  // the bottom of the window) and swiped up, or tapped, to bring it back. Remembered across the page's
  // reloads in this tab. The window as mods see it grows and shrinks with it (remeasure, after the slide).
  const minimized = () => root.classList.contains('demo-min');
  function minimize(on) {
    root.classList.toggle('demo-min', on);
    // (tucked away, nothing in the panel keeps the focus: on a phone the keyboard would come straight back
    // with the sheet)
    if (on) try { frame?.contentDocument?.activeElement?.blur?.(); } catch {}
    try { sessionStorage.setItem(MIN, on ? '1' : ''); } catch {}
    const done = () => { box?.removeEventListener('transitionend', done); clearTimeout(timer); remeasure(); };
    const timer = setTimeout(done, 400); // (in case no transition runs)
    box?.addEventListener('transitionend', done);
  }
  // The sheet's sizes on a phone: tucked away (its bar), half (40% of the screen) and full (nearly all of
  // it). It opens at half (full only for the wrap-up and sandbox mode), and can be swiped to full at any
  // time, to look at the chat or the mods list.
  const FREE = 'trif-demo-free';
  const canFull = true;
  const size = () => (minimized() ? 'min' : root.classList.contains('demo-tall') ? 'full' : 'half');
  function setSize(s) {
    if (s === 'full' && (!canFull || SIMPLE)) s = 'half';
    root.classList.toggle('demo-tall', s === 'full');
    try { sessionStorage.setItem(TALL, s === 'full' ? '1' : ''); } catch {}
    minimize(s === 'min');
    tellSize();
  }
  // The panel hears the sheet's size: on a phone its mods list is open at full height, closed at half.
  function tellSize() { try { if (phone()) frame?.contentWindow?.postMessage({ type: 'trif-demo:size', size: size() }, location.origin); } catch {} }
  // The heights the sizes come to (pages.js), in the whole window (innerHeight stops at the sheet: see cut)
  function heights() {
    const H = innerHeight + cut.h;
    const grow = parseFloat(root.style.getPropertyValue('--demo-grow')) || 0;
    return { min: 35, half: Math.min(H * 0.85, Math.max(H * 0.4, 260) + grow), full: H * 0.88 };
  }
  // The top bar is the handle: the sheet follows the finger up or down, and on letting go settles at the
  // nearest size (a quick flick goes one size on in its direction); a tap brings a tucked-away sheet back.
  // It shrinks or grows from wherever the finger left it (no jump back first).
  // A drag of the sheet: by its handle (swipe, below) or by a swipe anywhere inside the panel that isn't
  // scrolling something there (shim.js: trif-demo:drag). dy: how far the finger has moved down.
  let drag = null;
  function dragStart() { if (SIMPLE) return; drag = { h: box.getBoundingClientRect().height, from: size() }; }
  function dragMove(dy) {
    if (!drag) return;
    const top = canFull ? heights().full : heights().half;
    box.style.transition = 'none';
    box.style.minHeight = '0';
    box.style.height = `${Math.round(Math.max(35, Math.min(top, drag.h - dy)))}px`;
  }
  function dragEnd(dy, cancelled) {
    if (!drag) return;
    const from = drag.from;
    drag = null;
    let to = from;
    if (!cancelled) {
      if (Math.abs(dy) < 8) to = from === 'min' ? 'half' : from; // a tap
      else {
        const hs = heights(), order = canFull ? ['min', 'half', 'full'] : ['min', 'half'];
        const at = box.getBoundingClientRect().height;
        to = order.reduce((a, b) => (Math.abs(hs[b] - at) < Math.abs(hs[a] - at) ? b : a));
        if (to === from && Math.abs(dy) > 40) { // a flick: one size on
          const i = order.indexOf(from) + (dy > 0 ? -1 : 1);
          to = order[Math.max(0, Math.min(order.length - 1, i))];
        }
      }
    }
    setSize(to);
    box.getBoundingClientRect(); // (from the height it was left at...)
    box.style.transition = ''; box.style.height = ''; box.style.minHeight = ''; // (...to the size's, smoothly)
  }
  function swipe(bar, except) {
    let start = null;
    bar.addEventListener('pointerdown', (e) => {
      if (!phone() || except.contains(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { id: e.pointerId, y: e.clientY };
      dragStart();
      try { bar.setPointerCapture(e.pointerId); } catch {}
    });
    bar.addEventListener('pointermove', (e) => { if (start?.id === e.pointerId) dragMove(e.clientY - start.y); });
    const end = (e) => {
      if (start?.id !== e.pointerId) return;
      const dy = e.clientY - start.y;
      start = null;
      dragEnd(dy, e.type === 'pointercancel');
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
    // On a phone the panel's message box fits its text, and the sheet grows by what the box gained
    // (pages.js: --demo-grow), so the chat above it keeps its room.
    // A swipe inside the panel that isn't scrolling anything there moves the sheet, as its handle does.
    if (d.type === 'trif-demo:drag') {
      if (!phone()) return;
      const dy = Math.max(-2000, Math.min(2000, Number(d.dy) || 0));
      if (d.phase === 'start') dragStart();
      else if (d.phase === 'move') dragMove(dy);
      else if (d.phase === 'end' || d.phase === 'cancel') dragEnd(dy, d.phase === 'cancel');
      return;
    }
    // After the demo, the robot is answering what the visitor typed: on a phone the sheet comes up full height.
    if (d.type === 'trif-demo:answering') { if (phone() && size() !== 'full') setSize('full'); return; }
    // The visitor taps into the message box to type (the keyboard comes up): on a phone a sheet that was up
    // full height comes down to half (tucked away, it stays tucked away).
    if (d.type === 'trif-demo:typing') { if (phone() && size() === 'full') setSize('half'); return; }
    // The keyboard is up (the panel's message box has the focus): on a phone the page holds still, see
    // keyboardUp below.
    if (d.type === 'trif-demo:keyboard') { if (SIMPLE) return; keyboardUp = d.on === true && phone(); root.classList.toggle('demo-kb', keyboardUp); return; }
    // The panel has loaded (again): it hears the sheet's size.
    if (d.type === 'trif-demo:hello') { tellSize(); return; }
    // The wrap-up chat was sent: on a phone the sheet comes up full height (shim.js opens the mods list).
    if (d.type === 'trif-demo:wrapup') {
      try { sessionStorage.setItem(FREE, '1'); } catch {}
      if (phone()) setSize('full');
      return;
    }
    // The demo's chats are done (the box is the visitor's): the sheet can come up full height.
    if (d.type === 'trif-demo:free') {
      try { sessionStorage.setItem(FREE, d.free === true ? '1' : ''); } catch {}
      return;
    }
    if (d.type === 'trif-demo:grow') {
      if (SIMPLE) return;
      const px = Math.max(0, Math.min(400, Math.round(Number(d.px) || 0)));
      document.documentElement.style.setProperty('--demo-grow', `${px}px`);
      return;
    }
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
      const tour = (Array.isArray(d.tour) ? d.tour : []).filter((n) => ok(n) && FOCUS_ON[n]);
      if (tour.length > 1 && phone()) showEach(tour); else focusOn(made);
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
  // A chat that made several mods (the makeover): on a phone the page goes to each one's part in turn, a
  // second for each (the scroll and a moment to see it), in the page's order.
  function showEach(slugs) {
    let i = 0;
    const next = () => {
      if (i >= slugs.length) return;
      try {
        const el = FOCUS_ON[slugs[i++]]();
        if (el) scrollBy({ top: el.getBoundingClientRect().top - 12, behavior: 'smooth' });
      } catch {}
      setTimeout(next, 1000);
    };
    setTimeout(next, 700); // (once the mods have had their moment to change the page)
  }
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
