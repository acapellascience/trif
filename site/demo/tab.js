// The home page's "Try the demo" tab: opens the real TRIF side panel (/demo/ext/sidepanel.html, with
// shim.js standing in for the extension) docked to the right of this page, like the browser's side panel:
// the page moves over to make room. At phone width it's a sheet over the bottom of the page.
//
// The mods run on this page: when the panel switches one (or the robot), it asks for the page again with the
// mods that are on (/?mods=a,b; the Worker adds only mods it has), and the panel opens again by itself after
// the reload (sessionStorage), where shim.js picks up its state. Without this script there's no tab.
(() => {
  const tab = document.querySelector('.demo-tab');
  if (!tab) return;
  const root = document.documentElement;
  const OPEN = 'trif-demo-open';
  const remember = (on) => { try { sessionStorage.setItem(OPEN, on ? '1' : ''); } catch {} };
  let box = null;
  let frame = null;

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

  function show() {
    if (!box) build();
    if (box.popover) { if (!box.matches(':popover-open')) box.showPopover(); } else box.hidden = false;
    root.classList.add('demo-open');
    tab.hidden = true;
    remember(true);
  }

  function hide() {
    if (!isOpen()) return;
    if (box.popover) box.hidePopover(); else box.hidden = true;
    root.classList.remove('demo-open');
    tab.hidden = false;
    tab.focus();
    remember(false);
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

  tab.hidden = false;
  tab.addEventListener('click', show);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  let reopen = false;
  try { reopen = sessionStorage.getItem(OPEN) === '1'; } catch {}
  if (reopen) show();
})();
