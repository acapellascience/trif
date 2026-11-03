// The home page's "Try the demo" tab: opens the demo (/demo, a browser window with the real TRIF side
// panel) over the page, at the right; Pop out makes it nearly as big as the window, Close puts it away.
// Without this script the tab is a plain link to /demo.
(() => {
  const tab = document.querySelector('.demo-tab');
  if (!tab) return;
  const root = document.documentElement;
  const phone = matchMedia('(max-width: 700px)');
  let win = null;
  let back = null;
  let frame = null;
  let big = false;

  const isOpen = () => !!win && !win.hidden;

  function sync() {
    if (!win) return;
    win.classList.toggle('big', big);
    back.hidden = !isOpen() || !big || phone.matches;
    root.classList.toggle('demo-lock', isOpen() && (big || phone.matches));
    frame.contentWindow?.postMessage({ type: 'trif-demo:state', big }, location.origin);
  }

  function open() {
    if (!win) {
      back = document.createElement('div');
      back.className = 'demo-back';
      back.hidden = true;
      back.addEventListener('click', () => { big = false; sync(); });
      win = document.createElement('div');
      win.className = 'demo-win';
      win.setAttribute('role', 'dialog');
      win.setAttribute('aria-label', 'TRIF demo');
      frame = document.createElement('iframe');
      frame.src = '/demo';
      frame.title = 'TRIF demo: timsrobot.com with the TRIF side panel';
      win.append(frame);
      document.body.append(back, win);
    }
    win.hidden = false;
    tab.setAttribute('aria-expanded', 'true');
    sync();
    frame.focus();
  }

  function close() {
    if (!isOpen()) return;
    win.hidden = true;
    big = false;
    sync();
    tab.setAttribute('aria-expanded', 'false');
    tab.focus();
  }

  // Escape: back to the small window first, then closed.
  function escape() { if (big && !phone.matches) { big = false; sync(); } else close(); }

  tab.setAttribute('aria-expanded', 'false');
  tab.addEventListener('click', (e) => { e.preventDefault(); if (isOpen()) close(); else open(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) escape(); });
  phone.addEventListener('change', sync);
  addEventListener('message', (e) => {
    if (!frame || e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const type = e.data?.type;
    if (type === 'trif-demo:close') close();
    else if (type === 'trif-demo:big') { big = !big; sync(); }
    else if (type === 'trif-demo:escape') escape();
    else if (type === 'trif-demo:ready') sync();
  });
})();
