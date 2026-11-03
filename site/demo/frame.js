// The homepage demo's browser window (/demo): the home page on the left (/demo/home, with the mods that
// are on) and the real TRIF side panel on the right. The panel (shim.js) says when to load the page again
// with other mods; the home page (tab.js), when this window is inside it, gets Pop out and Close.
(() => {
  const $ = (id) => document.getElementById(id);
  const page = $('page');
  const panel = $('panel');
  const embedded = window.parent !== window;

  // Only names (the Worker ignores any it doesn't have).
  function load(mods) {
    const names = (Array.isArray(mods) ? mods : []).filter((n) => typeof n === 'string' && /^[a-z0-9-]{1,40}$/.test(n));
    const url = `/demo/home${names.length ? `?mods=${names.join(',')}` : ''}`;
    if (page.getAttribute('src') === url) page.contentWindow.location.reload();
    else page.setAttribute('src', url);
  }

  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (e.source === panel.contentWindow && d.type === 'trif-demo:load') load(d.mods);
    else if (embedded && e.source === window.parent && d.type === 'trif-demo:state') {
      $('big').textContent = d.big ? 'Shrink' : 'Pop out';
      $('big').setAttribute('aria-pressed', String(!!d.big));
    }
  });

  $('reload').addEventListener('click', () => page.contentWindow.location.reload());
  if (embedded) {
    const tell = (type) => window.parent.postMessage({ type }, location.origin);
    $('big').hidden = false;
    $('close').hidden = false;
    $('big').addEventListener('click', () => tell('trif-demo:big'));
    $('close').addEventListener('click', () => tell('trif-demo:close'));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') tell('trif-demo:escape'); });
    tell('trif-demo:ready');
  } else {
    $('home').hidden = false;
  }
})();
