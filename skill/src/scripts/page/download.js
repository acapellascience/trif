// Save the finished mod as a file in the user's downloads, from this tab: a link to the text, clicked. Written for
// the TRIF skill (skill/src/scripts/page/download.js). Use it only when you can't save a file for the user any other
// way (references/handoff.md): it goes through the page's own world, so a hostile page could change what's saved.
//
//   __trifDownload('hide-reposts.js', modText)   -> {saved, name, bytes, lines, head}
// The browser saves it in the downloads folder (it may ask the user the first time a site downloads a file, or
// to allow several). Nothing is sent anywhere: the file is made in the page and saved by the browser.
(() => {
  window.__trifDownload = (name, text) => {
    const file = String(name || 'mod.js').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '') || 'mod.js';
    const body = String(text);
    if (!/^\s*\/\/\s*==WebMod==/m.test(body)) throw new Error('that isn\'t a mod: it has no // ==WebMod== header');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.endsWith('.js') ? file : `${file}.js`;
    a.style.display = 'none';
    (document.body || document.documentElement).append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { saved: true, name: a.download, bytes: new Blob([body]).size, lines: body.split('\n').length, head: body.split('\n').slice(0, 3).join('\n') };
  };
  return 'download ready: __trifDownload(\'<mod>.js\', text)';
})();
