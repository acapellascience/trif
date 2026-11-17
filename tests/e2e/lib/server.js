'use strict';
// The local test sites the browsers load:
//   http://127.0.0.1:<port>/        the main test site (its mod is written by the harness, then the agent's)
//   http://localhost:<port>/        a second site with a mod of its own, where TRIF stays off
//   https://x.com:<tlsPort>/home    a stand-in for X's home timeline, for the real Detox Timeline mod
//                                   (x.com/detox-timeline): the page fetches (and XHRs) a saved HomeLatestTimeline
//                                   response, as X does, and lists the posts it got back.
//   https://www.google.com:<tlsPort>/ and /search?q=…   stand-ins for Google's home and results pages,
//                                   with the parts the shipped Google mods hide (AI Banisher, Just Results)
//                                   and the parts they must keep, each marked data-e2e="hide…" or "keep…".
// The browsers resolve x.com and www.google.com to 127.0.0.1 and accept the self-signed certificate (set
// up by each driver).

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { run } = require('./util');

const { deep2Route } = require('./deep2');

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:40px;max-width:720px}#target{padding:12px;border:1px dashed #999}</style>
</head><body>${body}</body></html>`;

// Powers, phase 3 (tests/e2e/scenario.js powers3Check): the page's own video, a counter button, a link on the
// page and one to another site, a form whose buttons would submit or reset it (to /e2e-pw-leak-submit, so a
// submit shows as a leak), the user's drafts (fields, an editor) and fields that stay the user's.
const POWERS3_PAGE = () => PAGE('TRIF e2e powers 3', `<h1 id="title">Powers, phase 3</h1>
<video id="pmedia" muted width="16" height="16"></video>
<p><button type="button" id="pclick">0</button> <button type="button" id="pbtn">not named</button>
<a id="plink" href="#plink-target">a link on this page</a> <a id="ext3" href="http://localhost:1/e2e-pw-leak-ext">another site</a> <a id="shown3" href="/e2e-goto-shown">a page link</a></p>
<form id="f3" action="/e2e-pw-leak-submit" method="get"><input id="f3i" name="q" value="typed"><button id="fb3">Send</button><input type="reset" id="fr3" value="Reset"><label id="lb3" for="fs3">send it</label><input type="submit" id="fs3" value="Go"></form>
<p><input id="wd" value="the user's draft"> <textarea id="wta">draft two, see example.org/a</textarea></p>
<div id="ed2" contenteditable="true">the user's editor draft</div>
<p><input id="pw3" type="password" value="hunter2"> <input id="cc3" autocomplete="cc-number" value="4111"> <input id="fh3" type="hidden" value="h"> <select id="sel3"><option>a</option><option>b</option></select></p>
<p id="seen"></p>
<script>
document.getElementById('pclick').addEventListener('click', (e) => { e.target.textContent = String(Number(e.target.textContent) + 1); });
const seen = [];
for (const id of ['wd', 'wta', 'ed2']) document.getElementById(id).addEventListener('input', () => { seen.push(id); document.getElementById('seen').textContent = seen.join(','); });
</script>`);

// The clickjacking guard (tests/e2e/scenario.js clickjackCheck; extension/runtime.js clickGuard): real buttons
// that the hostile mods hide over a decoy, the page's own invisible file input over its styled label, a label
// over its own hidden checkbox, and buttons honest mods restyle (their words over one, their icon over one).
// What the page got: data-hits on <html>, as JSON.
const CLICKJACK_PAGE = () => PAGE('TRIF e2e clickjack', `<style>
.stage { position: relative; width: 320px; height: 56px; margin: 10px 0; }
.decoy { position: absolute; inset: 0; background: #2a2; color: #fff; display: flex; align-items: center; justify-content: center; }
.real { padding: 10px 18px; background: #c00; color: #fff; border: 0; transition: opacity .3s; }
.pretty { display: inline-block; padding: 10px 18px; background: #06c; color: #fff; }
.file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.icon-btn { background: transparent; border: 0; padding: 4px; } .ic { position: relative; display: inline-block; width: 20px; height: 20px; }
</style>
<h1 id="title">Clickjacking</h1>
<div class="stage" id="s1"><div class="decoy" id="decoy1">Win a prize</div><button class="real" id="real1" type="button">Delete account</button></div>
<div class="stage" id="s2"><div class="decoy" id="decoy2">Play</div><button class="real" id="real2" type="button">Follow</button></div>
<div class="stage" id="s3"><button class="real" id="real3" type="button">Send money</button></div>
<div class="stage" id="s4"><span class="pretty" id="pretty">Choose a picture</span><input class="file" id="file" type="file"></div>
<div class="stage" id="s5"><label id="sw"><input type="checkbox" id="cb" style="position:absolute;opacity:0"><span id="swtext">Notifications</span></label></div>
<div class="stage" id="s6"><button class="real" id="ok1" type="button">Search</button></div>
<div class="stage" id="s7"><button class="icon-btn" id="ok2" type="button"><span class="ic"><svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 2h16v16H2z"/></svg></span></button></div>
<script>
const hits = {};
for (const id of ['real1', 'real2', 'real3', 'decoy1', 'decoy2', 'file', 'cb', 'ok1', 'ok2']) document.getElementById(id).addEventListener('click', (e) => {
  hits[id] = (hits[id] || 0) + 1; document.documentElement.dataset.hits = JSON.stringify(hits); if (id === 'file') e.preventDefault();
});
document.documentElement.dataset.hits = '{}';
</script>`);

// Sandboxed mods (tests/e2e/scenario.js sandboxedCheck): what the page itself would notice (__hits: clicks,
// keys, submits, messages, inline code that ran), an empty script element the page made (text written into it
// would run), a style element, a form, links, an image, a frame; a row added later; Amazon-like results and a
// logo for the two sample ports; and 1000 cells for the timing.
const SANDBOX_PAGE = () => PAGE('TRIF e2e sandbox', `<div id="gadget-src" class="js-src done" data-auto-post="/e2e-sbx-leak-clone">gadget source</div>
<script>
// (a stand-in for the page's own attribute-directed code, htmx-like: it turns attributes on elements added to
// the page into requests, and acts when a "done" class is taken off; e2e sandboxedCheck, red-team RT-1)
new MutationObserver((recs) => {
  for (const r of recs) {
    if (r.type === 'attributes' && r.target.id === 'gadget-src' && !r.target.classList.contains('done')) fetch('/e2e-sbx-leak-class-removed', { method: 'POST', body: 'g' });
    for (const n of r.addedNodes || []) if (n.nodeType === 1) for (const el of [n, ...n.querySelectorAll('*')]) {
      const u = el.getAttribute('data-auto-post') || el.getAttribute('data-hx-post') || (el.classList.contains('js-auto-post') ? '/e2e-sbx-leak-class' : null)
        || (el.id === 'sbxConfig' ? '/e2e-sbx-leak-id' : null) || (el.hasAttribute('data-controller') ? '/e2e-sbx-leak-stimulus' : null);
      if (u) fetch(u, { method: 'POST', body: 'gadget' });
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
</script>
<script>
window.__pageSecret = 'from the page';
window.__hits = [];
for (const t of ['click', 'keydown', 'submit', 'input', 'message', 'focus']) window.addEventListener(t, (e) => __hits.push(t + ':' + ((e.target && e.target.id) || '')), true);
document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('script'); s.id = 'gadget'; document.body.append(s);
  setTimeout(() => { const d = document.createElement('div'); d.className = 'later'; d.textContent = 'later: Grok again'; document.getElementById('box').append(d); }, 400);
});
</script>
<h1 id="title">Sandbox</h1>
<p id="txt">Grok says hi</p>
<div id="box"></div>
<p id="target-click">click target</p>
<form id="f" action="/e2e-sbx-leak-submit"><span id="fwrap"><input id="fh" type="hidden" name="h" value="keep"></span><input id="fi" name="q" value="v"><textarea id="ta">t</textarea><select id="sel"><option id="opt">o</option></select><select id="sel2" name="s2"><option id="opt2" value="p">p</option></select><x-field id="xf">a custom field</x-field><button id="fb">Go</button></form>
<form id="f2" action="/e2e-sbx-leak-submit2"><p>another form</p></form>
<p><input id="pw" type="password" placeholder="password"> <input id="rv" value="typed-secret"></p>
<canvas id="pcv" width="10" height="10"></canvas>
<dialog id="dlg"><p>Are you sure?</p><button id="dlg-ok">Yes</button></dialog>
<details id="det"><summary>more</summary>details</details>
<div id="rx">a React-like element</div>
<script>
// (page-data: what React keeps on an element: its props, and its fiber with the parents' props)
const rx = document.getElementById('rx');
rx.__reactProps$e2e = { post: { text: 'from react', likes: 3, onClick() {}, node: document.body }, children: 'x' };
rx.__reactFiber$e2e = { memoizedProps: rx.__reactProps$e2e, return: { memoizedProps: { user: { name: 'tim', handlers: { f() {} } } } } };
</script>
<div id="shost" style="display:inline-block"></div>
<script>document.getElementById('shost').attachShadow({ mode: 'closed' }).innerHTML = '<input id="si" type="password" style="width:160px">';</script>
<div id="editor" contenteditable="true"><p id="ed-p">secret draft</p><a id="ed-a" href="/two.html?draft">a link in the draft</a></div>
<p><a id="blank" href="/two.html" target="_blank">blank</a> <a id="plink" href="/two.html">page link</a></p>
<img id="pimg" src="/favicon.ico" alt="" width="1" height="1">
<style id="pstyle">#title { letter-spacing: 0 }</style>
<button id="pbtn" onclick="__hits.push('onclick')">b</button>
<iframe id="frm" src="/two.html" width="200" height="60"></iframe>
<div class="sbx-hide">to hide</div>
<div id="logo" style="display:inline-block;width:120px;height:40px;font:700 28px sans-serif">Google</div>
<div class="s-main-slot">
  <div data-component-type="s-search-result" id="r1"><h2>Plain result one</h2></div>
  <div id="r-ad"><span class="puis-sponsored-label-text">Sponsored</span> An ad</div>
  <div id="r-carousel"><h2>Customers also bought</h2><div>things</div></div>
  <div data-component-type="s-search-result" id="r2"><h2>Plain result two</h2></div>
</div>
<div id="cells">${Array.from({ length: 1000 }, (_, i) => `<span class="cell">${i}</span>`).join(' ')}</div>`);

// The widened box (tests/e2e/scenario.js wideCheck, fixtures/sandbox-wide.js): what the page itself would
// notice (__hits in the capture phase, __bubbled on the document), a page animation, an open and a closed
// shadow root (and one made later), SVG with ids and references, a style sheet that uses an image, a field
// with a placeholder, an editor with SVG in it, a picture the page shows, a canvas and a frame.
const WIDE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const WIDE_PAGE = () => PAGE('TRIF e2e wide', `<style id="wstyle">#sprite { background: url(/e2e-wide.png?sprite=1) no-repeat } #sprite2 { --tint: rgb(9, 8, 7) }</style>
<script>
window.__hits = []; window.__bubbled = [];
for (const t of ['click', 'pointerdown', 'keydown', 'input', 'focus', 'dragstart', 'drop', 'message', 'submit']) window.addEventListener(t, (e) => __hits.push(t + ':' + ((e.target && e.target.id) || '')), true);
document.addEventListener('click', (e) => __bubbled.push((e.target && e.target.id) || ''));
</script>
<h1 id="title">Wide</h1>
<p id="words">alpha beta gamma</p>
<div id="feed"><p class="item" id="item1">one</p></div>
<div id="editor" contenteditable="true"><p id="ed-p">secret draft</p><svg id="ed-svg" width="10" height="10"><rect id="ed-rect" width="10" height="10"></rect></svg></div>
<form id="f" action="/e2e-wide-leak-submit"><input id="fi" name="q" value="v" placeholder="old"><textarea id="ta" placeholder="old t"></textarea><input id="pw" type="password"><button id="fb" type="button">b</button></form>
<p><button id="pb" type="button">page button</button></p>
<img id="pimg" src="/e2e-wide.png" width="16" height="16" alt="">
<div id="sprite" style="width: 4px; height: 4px"></div>
<svg id="psvg" width="100" height="50"><defs><linearGradient id="pg"><stop offset="0" stop-color="red"></stop></linearGradient></defs><rect id="prect" x="10" y="10" width="30" height="20" fill="url(#pg)"></rect><path id="ppath" d="M0 0 L30 40" stroke="black"></path></svg>
<div id="anim" style="width: 10px; height: 10px; background: blue"></div>
<div id="ohost"></div><div id="chost"></div>
<canvas id="pcv" width="10" height="10"></canvas>
<iframe id="frm" src="/two.html" width="120" height="40"></iframe>
<script>
window.__pageAnim = document.getElementById('anim').animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 100000 });
document.getElementById('ohost').attachShadow({ mode: 'open' }).innerHTML = '<p id="op">open root</p>';
window.__closedRoot = document.getElementById('chost').attachShadow({ mode: 'closed' });
window.__closedRoot.innerHTML = '<p id="cp">closed root</p>';
document.getElementById('pcv').getContext('2d').fillRect(0, 0, 10, 10);
window.__laterHost = () => { const h = document.createElement('div'); h.id = 'lhost'; h.className = 'host'; document.body.append(h); window.__laterRoot = h.attachShadow({ mode: 'closed' }); window.__laterRoot.innerHTML = '<p id="lp">later root</p>'; };
</script>`);

// The widened box's powers (scenario.js wideBCheck, fixtures/powers-b.js): the wide page, and what the new
// powers act on: the site's storage, an embedded JSON script and a data global, the page's own signal, a lazy
// picture, a video link, a link with a query, a file input, a video, and requests to rewrite.
const WIDE_B_PAGE = () => WIDE_PAGE().replace('</body>', `<script>
localStorage.setItem('e2e-wide-key', 'v1'); localStorage.setItem('e2e-old-setting', '{"zoom":3}'); localStorage.setItem('e2e-other', 'not its');
sessionStorage.setItem('e2e-wide-s', 's1'); document.cookie = 'e2e_c=c1; path=/'; document.cookie = 'e2e_other=c2; path=/';
window.__signals = [];
document.addEventListener('e2e-wide-reset', (e) => __signals.push(JSON.stringify(e.detail)));
document.addEventListener('e2e-wide-undeclared', () => __signals.push('undeclared'));
</script>
<script type="application/json" id="emb">{"posts":[{"t":"keep"},{"t":"drop"}]}</script>
<script>window.__embSeen = document.getElementById('emb').textContent; window.e2eData = { items: ['keep', 'drop'] }; window.__dataSeen = JSON.stringify(window.e2eData);</script>
<p><a id="yt" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5">a video</a> <a id="shown-q" href="/wideb.html?a=1&b=2">a link with a query</a></p>
<input id="file" type="file" accept="image/*"> <video id="vid" muted width="10" height="10"></video>
<div style="height: 4000px"></div><img id="lazy" src="/e2e-wide.png?lazy=1" loading="lazy" width="4" height="4" alt="">
<img id="pimg-big" src="/e2e-big.png" width="4" height="4" alt="">
<script>
window.__api = async () => (await fetch('/e2e-rw/E2eOp?mode=loud&variables=' + encodeURIComponent(JSON.stringify({ flag: true, other: 1 })), { method: 'POST', body: JSON.stringify({ operationName: 'E2eOp', variables: { flag: true } }) })).text();
window.__xhr = () => new Promise((res) => { const x = new XMLHttpRequest(); x.open('POST', '/e2e-rw/E2eOp'); x.onload = () => res(x.responseText); x.send(JSON.stringify({ variables: { flag: true } })); });
window.__other = async () => (await fetch('/e2e-rw/OtherOp?variables=' + encodeURIComponent('{"flag":true}'))).text();
window.__multi = async () => (await fetch('/e2e-multi')).text();
window.__urls = async () => (await fetch('/e2e-urls')).text();
document.getElementById('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const bm = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
  window.__fileSeen = f.name + ' ' + f.type + ' ' + [...g.getImageData(1, 1, 1, 1).data].join(',');
});
// (the page's own actions, from a real click on #go: no agent code runs in this tab before them)
window.__runAll = async () => {
  await window.__attach();
  const api = JSON.parse(await window.__api()), xhr = JSON.parse(await window.__xhr()), other = JSON.parse(await window.__other());
  const multi = await window.__multi(), urls = JSON.parse(await window.__urls());
  document.getElementById('trif-box-pb-embed').click(); // (not the user's: no frame)
  document.getElementById('vid').volume = 0.5;
  await new Promise((r) => setTimeout(r, 800));
  document.documentElement.setAttribute('data-e2e-results', JSON.stringify({ api, xhr, other, multi, urls, hits: window.__hits.slice(), signals: window.__signals.slice(), emb: window.__embSeen, data: window.__dataSeen,
    file: window.__fileSeen || null, key: localStorage.getItem('e2e-wide-key'), frames: document.querySelectorAll('iframe[src*="youtube"]').length, button: !!document.getElementById('trif-box-pb-embed'),
    lazy: document.getElementById('lazy').loading, url: location.href }));
};
document.addEventListener('DOMContentLoaded', () => { const b = document.createElement('button'); b.id = 'go'; b.type = 'button'; b.textContent = 'go'; b.addEventListener('click', () => { window.__runAll().catch((e) => document.documentElement.setAttribute('data-e2e-results', JSON.stringify({ error: String(e && e.message) }))); }); document.body.prepend(b); });
window.__attach = async () => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 4; const g = c.getContext('2d'); g.fillStyle = 'rgb(0, 0, 255)'; g.fillRect(0, 0, 4, 4);
  const b = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'pic.png', { type: 'image/png' }));
  const f = document.getElementById('file'); f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true }));
};
</script></body>`);

// The sandbox's fixes from the conversion run (scenario.js sandboxFixesCheck): text a mod wraps and the page then
// rewrites (as React does), text for two mods' wraps, a shadow root inside a shadow root, a picture from another
// host without CORS, a file input, embedded JSON two mods filter, and a tall page for the keys' defaults.
const FIXES_PAGE = (tlsPort) => PAGE('TRIF e2e fixes', `<h1 id="title">Fixes</h1>
<div id="w">alpha beta</div> <div id="w2">one two</div> <x-outer id="xo"></x-outer>
<img id="ximg" src="https://x.com:${tlsPort}/e2e-wide.png" width="4" height="4" alt=""> <input id="file" type="file" accept="image/*">
<script type="application/json" id="emb2">{"a":["x","y","z"]}</script>
<script>
window.__wText = document.getElementById('w').firstChild;
const xo = document.getElementById('xo').attachShadow({ mode: 'open' });
const inner = document.createElement('x-inner'); xo.append(inner);
const ir = inner.attachShadow({ mode: 'closed' }); ir.innerHTML = '<p id="ip">inner</p>'; window.__innerP = ir.getElementById('ip');
window.__keys = []; window.addEventListener('keydown', (e) => window.__keys.push(e.key));
document.getElementById('file').addEventListener('change', (e) => { const f = e.target.files[0]; window.__file = f ? { same: f === window.__orig, name: f.name, type: f.type } : null; });
window.__runAll = async () => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 4; c.getContext('2d').fillRect(0, 0, 4, 4);
  const b = await new Promise((r) => c.toBlob(r, 'image/png')); window.__orig = new File([b], 'pic.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(window.__orig); const f = document.getElementById('file'); f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true }));
  const urls = JSON.parse(await (await fetch('/e2e-fix-urls')).text());
  const raw = await (await fetch('/e2e-fix-raw')).text();
  window.__wText.data = 'gamma alpha';
  await new Promise((r) => setTimeout(r, 1000));
  const w = document.getElementById('w');
  document.documentElement.setAttribute('data-e2e-results', JSON.stringify({ urls, raw, file: window.__file || null, w: w.textContent, wIs: w.querySelectorAll('.trif-box-al').length,
    w2: document.getElementById('w2').textContent, w2Bs: document.getElementById('w2').querySelectorAll('b.trif-box-mk').length, emb: document.getElementById('emb2').textContent,
    inner: getComputedStyle(window.__innerP).color, key: localStorage.getItem('e2e-fix-key') }));
};
document.addEventListener('DOMContentLoaded', () => { const b = document.createElement('button'); b.id = 'go'; b.type = 'button'; b.textContent = 'go'; b.addEventListener('click', () => { window.__runAll().catch((e) => document.documentElement.setAttribute('data-e2e-results', JSON.stringify({ error: String(e && e.message) }))); }); document.body.prepend(b); });
</script>
<div style="height: 4000px"></div>`);

function testPage(host, pathName) {
  return PAGE(`TRIF e2e ${host}${pathName}`, `
<h1 id="title">TRIF e2e test page</h1>
<p>Host <b id="host">${host}</b>, path <b id="path">${pathName}</b>.</p>
<p id="target">Original text.</p>
<p><a href="/two.html">Page two</a></p>`);
}

// A page with one kind of thing repeated across regions, a shadow root and a same-origin frame, for
// `trif sweep` (the counts are in SWEEP_EXPECT), and tall enough for full-page screenshots.
const BLUE = '#1d9bf0';
const SWEEP_PAGE = () => PAGE('TRIF e2e sweep', `
<style>:root { --brand: ${BLUE}; } .badge::before { content: 'AD '; color: var(--brand); } .tall { height: 2400px; }</style>
<header id="bar" style="position: sticky; top: 0; background: ${BLUE}; color: #fff; padding: 8px">Bar <span class="promo">Sponsored: top deal</span></header>
<main>
  <div class="promo" style="border: 2px solid ${BLUE}">Sponsored one</div>
  <p style="color: ${BLUE}">Blue words</p>
  <div class="promo">Sponsored two</div>
  <div class="promo badge">Sponsored three</div>
  <div class="promo" style="display: none">Sponsored hidden</div>
  <div id="host"></div>
  <iframe src="/sweep-frame.html" style="height: 60px"></iframe>
  <div class="tall">Tall filler</div>
</main>
<aside><div class="promo">Sponsored side</div></aside>
<script>
document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
  '<style>.promo { background: ${BLUE}; }</style><div class="promo">Sponsored shadow one</div><div class="promo">Sponsored shadow two</div>';
</script>`);
const SWEEP_FRAME = () => PAGE('TRIF e2e sweep frame', '<div class="promo">Sponsored in frame</div>');
// .promo: header 1, main 4 (one hidden), aside 1, shadow 2, frame 1. Text "Sponsored": the same 9.
// The blue: header background, the bordered promo, the blue words, 2 shadow promos, the badge's ::before.
const SWEEP_EXPECT = { promo: 9, hidden: 1, shadow: 2, frames: 1, sponsored: 9, blue: 6, sticky: 1 };

// A page like the ones users ask about (for `--guidance`, comparing versions of AGENTS.md with a real
// agent): 12 promos of several markups across the header, the feed, a list, the sidebar, the footer, a
// shadow root, and 3 more that load when the page is scrolled to the bottom; and a brand blue used by a
// sticky header, links, buttons, a border, a ::before, an SVG icon and the shadow root, mostly through a
// CSS variable. The promos all carry a "Promoted" label, which is how they're counted.
const BRAND = '#0a66c2';
const PROMOS_PAGE = () => PAGE('Daily Feed', `
<style>
  :root { --brand: ${BRAND}; }
  body { max-width: 980px; }
  .top { position: sticky; top: 0; background: var(--brand); color: #fff; padding: 10px 16px; display: flex; gap: 16px; align-items: center; z-index: 5; }
  .top .strip { margin-left: auto; font-size: 13px; background: #fff3; padding: 2px 8px; border-radius: 4px; }
  .layout { display: grid; grid-template-columns: 1fr 260px; gap: 24px; margin-top: 16px; }
  a { color: var(--brand); }
  .post, .promoted, .sponsor-card, .rec-item, .footer-deal { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 10px 0; list-style: none; }
  .label { font-size: 12px; color: #666; display: block; }
  .shop { background: var(--brand); color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; }
  blockquote { border-left: 4px solid var(--brand); margin: 8px 0; padding-left: 10px; }
  .tips li::before { content: '> '; color: var(--brand); }
  svg.icon { width: 16px; height: 16px; fill: ${BRAND}; vertical-align: middle; }
</style>
<header class="top"><b>Daily Feed</b><a href="#" style="color:#fff">Home</a><span class="strip"><span class="label" style="display:inline;color:#fff">Promoted</span> Get Premium · Deal 0</span></header>
<div class="layout">
<main id="feed">
  <article class="post"><h3>Post 1</h3><p>A normal post. <a href="#">Read more</a></p></article>
  <article class="post promoted"><span class="label">Promoted · Deal 1</span><h3>Big sale on lamps</h3><button class="shop">Shop now</button></article>
  <article class="post"><h3>Post 2</h3><blockquote>A quoted line.</blockquote></article>
  <div class="sponsor-card"><span class="label">Promoted</span><b>Deal 2: cheap flights</b> <button class="shop">Book</button></div>
  <article class="post"><h3>Post 3</h3><p><svg class="icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg> With an icon. <a href="#">Link</a></p></article>
  <section><h4>Recommended for you</h4><ul class="recs">
    <li class="rec-item" data-ad="1"><span class="label">Promoted</span> Deal 3: a course <button class="shop">Enroll</button></li>
    <li class="post">Post 4 (recommended, not a promo)</li></ul></section>
  <article class="post promoted"><span class="label">Promoted · Deal 4</span><h3>Phones</h3><button class="shop">Shop now</button></article>
  <article class="post"><h3>Post 5</h3><ul class="tips"><li>Tip one</li><li>Tip two</li></ul></article>
  <deal-widget></deal-widget>
  <article class="post"><h3>Post 6</h3><p>The last post for now. <a href="#">More</a></p></article>
  <div id="more" style="height: 900px"></div>
</main>
<aside>
  <h4>Around the web</h4>
  <div class="sponsor-card"><span class="label">Promoted</span> Deal 5: shoes <button class="shop">See</button></div>
  <div class="sponsor-card"><span class="label">Promoted</span> Deal 6: coffee <button class="shop">See</button></div>
  <p><a href="#">About</a></p>
</aside>
</div>
<footer><section class="footer-deal"><span class="label">Promoted</span> Deal 7: a credit card <button class="shop">Apply</button></section><p>© Daily Feed</p></footer>
<script>
customElements.define('deal-widget', class extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' }).innerHTML = '<style>.card{border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0}.label{font-size:12px;color:#666;display:block}button{background:${BRAND};color:#fff;border:0;border-radius:4px;padding:4px 10px}</style>' +
      '<div class="card"><span class="label">Promoted</span> Deal 8: a widget deal <button>Get it</button></div>';
  }
});
let loaded = false;
addEventListener('scroll', () => {
  if (loaded || scrollY + innerHeight < document.documentElement.scrollHeight - 300) return;
  loaded = true;
  const feed = document.getElementById('feed');
  for (const n of [9, 10, 11]) {
    const a = document.createElement('article');
    a.className = 'post promoted';
    a.innerHTML = '<span class="label">Promoted · Deal ' + n + '</span><h3>Late deal ' + n + '</h3><button class="shop">Shop now</button>';
    feed.insertBefore(a, document.getElementById('more'));
  }
});
</script>`);

// A page like the one the Facebook birthdays chat was about (for `--study`, comparing guides with real agent
// runs): a header, a left nav, a feed column that loads more posts with a POST as you scroll (so a tab locked by
// `trif run` can't), and a right column with a Sponsored section, a Birthdays box and Contacts. Class names are
// generated-looking, as on Facebook: roles and headings are what an agent (and the study's measure) can hold on to.
// feed: true (/hearth-feed.html, the study's scrolling-feed task) adds a Sponsored post to every page the feed
// loads, and two friends' posts that say "sponsored" in their text (which a fix by text alone would hide too).
const HEARTH_DECOY = (n) => (n === 2 ? 'Our 5k run was sponsored by the corner bakery. Thanks, all!' : `Post ${n}: something that happened today.`);
const HEARTH_PAGE = ({ feed = false } = {}) => PAGE('Hearth', `
<style>
  body { margin: 0; max-width: none; background: #f0f2f5; font: 15px/1.35 system-ui, sans-serif; color: #1c1e21; }
  .x9f2k { position: sticky; top: 0; z-index: 3; height: 56px; background: #fff; box-shadow: 0 1px 2px #0002; display: flex; align-items: center; padding: 0 16px; gap: 12px; }
  .x9f2k b { font-size: 22px; color: #0866ff; }
  .x7q1z { display: flex; align-items: flex-start; }
  .x1lnv { width: 280px; flex: 0 0 280px; padding: 16px 8px; box-sizing: border-box; }
  .x1lnv a { display: block; padding: 8px; color: inherit; text-decoration: none; border-radius: 8px; }
  .x5mid { flex: 1 1 auto; display: flex; justify-content: center; min-width: 0; }
  .x5mid > [role=main] { width: 590px; flex: 0 0 auto; padding: 16px 32px; }
  .x3pst { background: #fff; border-radius: 12px; box-shadow: 0 1px 2px #0002; margin-bottom: 16px; padding: 12px 16px; }
  .x3pst .x0img { height: 260px; border-radius: 8px; background: linear-gradient(135deg, #c8d6f0, #e9d8c8); margin-top: 10px; }
  .x3pst .x0sub { font-size: 13px; color: #65676b; }
  .x8rgt { width: 300px; flex: 0 9999 300px; padding: 16px 16px 16px 0; box-sizing: border-box; position: sticky; top: 56px; }
  .x8rgt h3 { font-size: 17px; color: #65676b; margin: 8px 8px 8px; font-weight: 600; }
  .x8rgt section { padding-bottom: 12px; border-bottom: 1px solid #ced0d4; margin-bottom: 12px; }
  .x2ad { display: flex; gap: 12px; padding: 8px; color: inherit; text-decoration: none; border-radius: 8px; }
  .x2ad .x0img { width: 120px; height: 120px; flex: 0 0 120px; border-radius: 8px; background: #d8dadf; }
  .x2ad .x0sub { font-size: 13px; color: #65676b; }
  .x4bd { display: flex; align-items: center; gap: 12px; padding: 8px; color: inherit; text-decoration: none; }
  .x4bd .x0gift { width: 36px; height: 36px; flex: 0 0 36px; font-size: 28px; line-height: 36px; text-align: center; }
  .x6ct { display: flex; align-items: center; gap: 12px; padding: 8px; }
  .x6ct i { width: 36px; height: 36px; border-radius: 50%; background: #c9ccd1; }
  .x0err { background: #fff; border-radius: 12px; padding: 16px; color: #b00; }
  @media (max-width: 1100px) { .x8rgt { display: none; } }
</style>
<div class="x9f2k" role="banner"><b>hearth</b><input placeholder="Search Hearth" style="border-radius:20px;border:0;background:#f0f2f5;padding:8px 12px"></div>
<div class="x7q1z">
  <div class="x1lnv" role="navigation">
    <a href="#">Tim B</a><a href="#">Friends</a><a href="#">Groups</a><a href="#">Marketplace</a><a href="#">Memories</a><a href="#">Saved</a>
  </div>
  <div class="x5mid"><div role="main"><div role="feed" id="x0feed">
    ${[1, 2, 3].map((n) => `<div class="x3pst"><b>Friend ${n}</b><div class="x0sub">${n}h</div><div>${feed ? HEARTH_DECOY(n) : `Post ${n}: something that happened today.`}</div><div class="x0img"></div></div>`).join('')}
    <div class="x3pst"><b>Lamps Inc.</b><div class="x0sub">Sponsored</div><div>Big sale on lamps.</div><div class="x0img"></div></div>
    ${[4, 5].map((n) => `<div class="x3pst"><b>Friend ${n}</b><div class="x0sub">${n}h</div><div>Post ${n}: something that happened today.</div><div class="x0img"></div></div>`).join('')}
  </div><div id="x0more" style="height: 40px"></div></div></div>
  <div class="x8rgt" role="complementary">
    <section><h3>Sponsored</h3>
      <a class="x2ad" href="#"><div class="x0img"></div><div><div>Try Acrobat free for 7 days</div><div class="x0sub">adobe.example</div></div></a>
      <a class="x2ad" href="#"><div class="x0img"></div><div><div>Five compressors. Two plugins.</div><div class="x0sub">berryeffects.example</div></div></a>
    </section>
    <section><h3>Birthdays</h3>
      <a class="x4bd" href="#"><div class="x0gift">🎁</div><span><b>Trinity B</b> and <b>Silvia Dos Santos</b> have birthdays today.</span></a>
    </section>
    <section style="border:0"><h3>Contacts</h3>
      ${['Reuben W', 'Ana P', 'Joel K', 'Mira S', 'Dev R', 'Lou T'].map((n) => `<div class="x6ct"><i></i>${n}</div>`).join('')}
    </section>
  </div>
</div>
<script>
let busy = false, page = 0;
const feed = document.getElementById('x0feed');
addEventListener('scroll', async () => {
  if (busy || scrollY + innerHeight < document.documentElement.scrollHeight - 400) return;
  busy = true;
  try {
    const r = await fetch('/api/hearth-more${feed ? '?ads=1' : ''}', { method: 'POST', body: JSON.stringify({ page: ++page }) });
    const items = await r.json();
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'x3pst';
      d.innerHTML = '<b></b><div class="x0sub"></div><div></div><div class="x0img"></div>';
      d.children[0].textContent = it.who; d.children[1].textContent = it.when; d.children[2].textContent = it.text;
      feed.append(d);
    }
  } catch (e) {
    if (!document.querySelector('.x0err')) { const d = document.createElement('div'); d.className = 'x0err'; d.textContent = 'Something went wrong. Try reloading.'; feed.append(d); }
  } finally { busy = false; }
});
</script>`);

// ---- the study's deep tasks (--study-tasks autoplay,follow,jump; 2026-11-17): pages where the best fix needs
// the app's own code or data, and a fix on what's on screen is worse or impossible. Each app's code is a
// script of its own (/<app>/app.js), as on a real site, so reading it takes the page's own world (or a GET).

// Streamly (task autoplay, "stop it from playing the next episode by itself"): a player resuming 6 s before the
// end of episode 1; at the end, an "up next" card counts down 5 s and starts episode 2 (a POST, as a real
// player's is). The app reads window.__APP_CONFIG__.features.autoplayNext (and a pref in localStorage) at that
// moment; the settings box on the page has no switch for it. Hiding the card doesn't stop the countdown.
const STREAMLY_EPS = ['The Pilot', 'Graveyard Shift', 'Overtime', 'Call Back', 'Double Shift', 'Last Call'];
const STREAMLY_PAGE = () => PAGE('Night Shift · Streamly', `
<style>
  [hidden] { display: none !important; }
  body { margin: 0; max-width: none; background: #141414; color: #e5e5e5; font: 15px/1.4 system-ui, sans-serif; }
  .q1top { height: 56px; display: flex; align-items: center; padding: 0 24px; gap: 24px; background: #000; }
  .q1top b { color: #e50914; font-size: 24px; letter-spacing: 1px; } .q1top a { color: #ccc; text-decoration: none; }
  .q1wrap { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  .q2ply { position: relative; flex: 1 1 auto; aspect-ratio: 16 / 9; max-width: 900px; background: linear-gradient(135deg, #243b55, #141e30); border-radius: 6px; overflow: hidden; }
  .q2scr { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 28px; }
  .q2ctl { position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px; background: linear-gradient(transparent, #000c); }
  .q2bar { height: 4px; background: #555; border-radius: 2px; } .q2bar > div { height: 100%; background: #e50914; width: 0; }
  .q2row { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
  .q2row button, .q3end button { background: none; border: 1px solid #fff6; border-radius: 4px; color: #fff; font: inherit; cursor: pointer; padding: 4px 10px; }
  .q7un { position: absolute; right: 24px; bottom: 72px; width: 300px; background: #181818ee; border-radius: 6px; padding: 16px; box-shadow: 0 4px 16px #0008; }
  .q7un .q7th { height: 110px; border-radius: 4px; background: linear-gradient(135deg, #614385, #516395); margin-bottom: 10px; }
  .q7un button { background: #fff; color: #000; border: 0; border-radius: 4px; padding: 6px 14px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  .q3end, .q3err { position: absolute; inset: 0 0 64px; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; background: #000a; }
  .q3err { color: #ff8a80; }
  .q4side { width: 300px; flex: 0 0 300px; }
  .q4side a { display: block; padding: 10px; border-radius: 4px; color: inherit; text-decoration: none; background: #222; margin-bottom: 8px; }
  .q4side a.on { outline: 2px solid #e50914; }
  .q4set { margin-top: 16px; background: #222; padding: 12px; border-radius: 4px; display: grid; gap: 8px; }
</style>
<div class="q1top" role="banner"><b>STREAMLY</b><a href="#">Home</a><a href="#">Series</a><a href="#">Films</a><a href="#">My List</a></div>
<div class="q1wrap">
  <div class="q2ply" id="q2ply">
    <div class="q2scr"><div id="q2title"></div></div>
    <div class="q7un" id="q7un" hidden><div class="q7th"></div><div>Next episode in <span id="q7n">5</span></div><div id="q7t"></div><button type="button" id="q7go">Play now</button></div>
    <div class="q3end" id="q3end" hidden><div id="q3txt"></div><div><button type="button" id="q3re">Replay</button> <button type="button" id="q3next">Next episode</button></div></div>
    <div class="q3err" id="q3err" hidden></div>
    <div class="q2ctl"><div class="q2bar"><div id="q2fill"></div></div><div class="q2row"><button type="button" id="q2pp">Pause</button><span id="q2time"></span><span style="margin-left:auto">Night Shift · Season 1</span></div></div>
  </div>
  <div class="q4side" role="complementary">
    <h3>Episodes</h3><div id="q4eps">${STREAMLY_EPS.map((t, i) => `<a href="#" data-ep="${i + 1}">${i + 1}. ${t}<br><small>42 min</small></a>`).join('')}</div>
    <div class="q4set"><b>Playback settings</b>
      <label>Quality <select><option>Auto</option><option>1080p</option><option>720p</option></select></label>
      <label>Subtitles <select><option>Off</option><option>English</option><option>Français</option></select></label>
      <label>Audio <select><option>English</option><option>English (Audio Description)</option></select></label>
    </div>
  </div>
</div>
<script>window.__APP_CONFIG__ = {"build":"2026.11.3-web","locale":"en-US","apiBase":"/api/streamly","features":{"previews":true,"skipIntro":true,"autoplayNext":true,"upNextSeconds":5,"postPlayCredits":false,"ratingsPrompt":true},"experiments":{"rowArt":"b","heroTrailer":"off"}};</script>
<script src="/streamly/app.js"></script>`);
function streamlyApp(EPS) {
  const LEN = 42 * 60;
  const $ = (id) => document.getElementById(id);
  const cfg = () => window.__APP_CONFIG__ || {};
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('sx:prefs') || '{}') || {}; } catch (e) { prefs = {}; }
  const opt = (k) => (Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : (cfg().features || {})[k]);
  const st = { ep: 1, pos: LEN - 6, playing: true, count: null };
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function render() {
    $('q2title').textContent = `Episode ${st.ep}: ${EPS[st.ep - 1]}`;
    $('q2time').textContent = `${fmt(st.pos)} / ${fmt(LEN)}`;
    $('q2fill').style.width = `${(100 * st.pos) / LEN}%`;
    $('q2pp').textContent = st.playing ? 'Pause' : 'Play';
    for (const a of document.querySelectorAll('#q4eps a')) a.classList.toggle('on', Number(a.dataset.ep) === st.ep);
  }
  function tick() {
    if (!st.playing) return;
    st.pos = Math.min(LEN, st.pos + 1);
    render();
    if (st.pos >= LEN) ended();
  }
  function ended() {
    st.playing = false;
    render();
    if (st.ep < EPS.length && opt('autoplayNext')) return upNext();
    $('q3txt').textContent = `You finished Episode ${st.ep}.`;
    $('q3end').hidden = false;
  }
  function upNext() {
    let n = Number(opt('upNextSeconds')) || 5;
    $('q7t').textContent = `Episode ${st.ep + 1}: ${EPS[st.ep]}`;
    $('q7n').textContent = String(n);
    $('q7un').hidden = false;
    st.count = setInterval(() => {
      n--;
      $('q7n').textContent = String(n);
      if (n <= 0) play(st.ep + 1);
    }, 1000);
  }
  async function play(ep) {
    clearInterval(st.count);
    $('q7un').hidden = true; $('q3end').hidden = true; $('q3err').hidden = true;
    try {
      const r = await fetch(`${cfg().apiBase || '/api/streamly'}/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ep }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      st.ep = j.ep; st.pos = j.resumeAt; st.playing = true;
      render();
    } catch (e) {
      $('q3err').textContent = `Couldn't start Episode ${ep}. Try again.`;
      $('q3err').hidden = false;
    }
  }
  $('q7go').addEventListener('click', () => play(st.ep + 1));
  $('q3next').addEventListener('click', () => play(Math.min(EPS.length, st.ep + 1)));
  $('q3re').addEventListener('click', () => play(st.ep));
  $('q2pp').addEventListener('click', () => { st.playing = !st.playing; render(); });
  for (const a of document.querySelectorAll('#q4eps a')) a.addEventListener('click', (e) => { e.preventDefault(); play(Number(a.dataset.ep)); });
  render();
  setInterval(tick, 1000);
}

// Murmur (task follow, "hide posts from accounts I don't follow"): an X-like home timeline. Whether you follow
// a post's author is only in the data: the timeline's JSON (a POST, more as you scroll) and the React-like
// fiber behind each post (article.__reactFiber$….return.memoizedProps.post.author.following); nothing on
// screen says it. Each post sits in a cell with its own padding and border, as on X.
const MURMUR_AUTHORS = [
  ['Ada Moss', 'adamoss', true], ['Peak Outdoor Co.', 'peakoutdoor', false], ['Jonah Reyes', 'jreyes', true],
  ['Lena Fischer', 'lenafischer', false], ['City Transit', 'citytransit', true], ['Sam Okafor', 'samokafor', true],
  ['Ravi Menon', 'ravimenon', false], ['Night Owl Books', 'nightowlbooks', true], ['Maya Lindqvist', 'mayal', false],
  ['Theo Grant', 'theogrant', true], ['Daily Crunch', 'dailycrunch', false], ['Priya Shah', 'priyashah', true],
];
const MURMUR_TEXTS = ['Finally finished the shelf. Only one screw left over.', 'Rain all week, apparently. Good time for soup.',
  'Anyone else think the new bridge lights are a bit much?', 'Thread on what I learned running a tiny bakery for a year 🧵',
  'Morning run done. 5k, no stops, a personal best.', 'Hot take: the second album is better than the first.',
  'Spotted a heron on the canal today.', 'Reminder: the library extends hours this weekend.',
  'Tried the new ramen place on 4th. Worth the queue.', 'Our garden finally has tomatoes.', 'Big news coming Friday. Stay tuned.',
  'Does anyone have a spare bike pump I could borrow?', 'This week\'s reading list, short version.', 'Train delays again on the north line.'];
const MURMUR_PER_PAGE = (cursor) => (cursor === 0 ? 10 : 6);
const murmurPage = (cursor) => {
  const start = cursor === 0 ? 0 : 10 + 6 * (cursor - 1);
  return Array.from({ length: MURMUR_PER_PAGE(cursor) }, (_, j) => {
    const i = start + j;
    const [name, handle, following] = MURMUR_AUTHORS[(i * 5) % MURMUR_AUTHORS.length];
    return { id: String(7000 + i), text: MURMUR_TEXTS[i % MURMUR_TEXTS.length], created: `${1 + (i % 23)}h`,
      author: { id: String(300 + MURMUR_AUTHORS.findIndex((a) => a[1] === handle)), name, handle, following, followed_by: (i % 3) === 0, verified: handle === 'citytransit' || handle === 'dailycrunch' },
      counts: { replies: (i * 7) % 40, reposts: (i * 3) % 25, likes: (i * 13) % 300 } };
  });
};
const murmurFollowing = (id) => { const i = Number(id) - 7000; return MURMUR_AUTHORS[(i * 5) % MURMUR_AUTHORS.length][2]; };
const MURMUR_PAGE = () => PAGE('Home / Murmur', `
<style>
  body { margin: 0; max-width: none; background: #fff; color: #0f1419; font: 15px/1.35 system-ui, sans-serif; }
  .n1sh { display: flex; justify-content: center; }
  .n1nv { width: 220px; padding: 12px; box-sizing: border-box; } .n1nv a { display: block; padding: 12px; font-size: 19px; color: inherit; text-decoration: none; }
  .n2mn { width: 600px; border-left: 1px solid #eff3f4; border-right: 1px solid #eff3f4; }
  .n2hd { position: sticky; top: 0; background: #fffd; backdrop-filter: blur(8px); padding: 16px; font-size: 20px; font-weight: 700; border-bottom: 1px solid #eff3f4; z-index: 2; }
  .r-cell { border-bottom: 1px solid #eff3f4; padding: 12px 16px; }
  .r-1lq { display: flex; gap: 12px; }
  .r-av { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; background: #cfd9de; }
  .r-mt { color: #536471; } .r-mt b { color: #0f1419; } .r-mt a { color: inherit; text-decoration: none; }
  .r-tx { margin: 4px 0 10px; }
  .r-ac { display: flex; gap: 48px; color: #536471; font-size: 13px; }
  .n3sd { width: 320px; padding: 12px 24px; box-sizing: border-box; }
  .n3bx { background: #f7f9f9; border-radius: 16px; padding: 12px 16px; margin-bottom: 16px; } .n3bx div { padding: 8px 0; }
  .n4er { padding: 16px; color: #b00; }
</style>
<div class="n1sh">
  <nav class="n1nv" role="navigation"><a href="#"><b>murmur</b></a><a href="#">Home</a><a href="#">Explore</a><a href="#">Notifications</a><a href="#">Messages</a><a href="#">Profile</a></nav>
  <main class="n2mn" role="main"><div class="n2hd">Home</div><div id="n2tl" aria-label="Timeline: Your Home Timeline"></div><div id="n2more" style="height: 60px"></div></main>
  <aside class="n3sd" role="complementary"><div class="n3bx"><b>What's happening</b><div>#RainyWeek · 12.1K posts</div><div>Bridge lights · 3,402 posts</div><div>#BakeryThread · 1,877 posts</div></div></aside>
</div>
<script src="/murmur/app.js"></script>`);
function murmurApp() {
  const KEY = Math.random().toString(36).slice(2, 11);
  const tl = document.getElementById('n2tl');
  const more = document.getElementById('n2more');
  let cursor = 0, busy = false, done = false;
  function Timeline() {}
  function PostCell() {}
  const timelineFiber = { tag: 0, type: Timeline, memoizedProps: { timelineId: 'home', kind: 'HomeTimeline' }, return: null };
  function cell(post) {
    const c = document.createElement('div');
    c.className = 'r-cell';
    c.setAttribute('data-testid', 'cellInnerDiv');
    const a = document.createElement('article');
    a.className = 'r-1lq';
    a.setAttribute('role', 'article');
    a.tabIndex = 0;
    a.innerHTML = '<div class="r-av"></div><div><div class="r-mt"><b></b> <span></span> · <a></a></div><div class="r-tx"></div><div class="r-ac"><span></span><span></span><span></span></div></div>';
    const mt = a.querySelector('.r-mt');
    mt.children[0].textContent = post.author.name + (post.author.verified ? ' ✓' : '');
    mt.children[1].textContent = '@' + post.author.handle;
    mt.children[2].textContent = post.created;
    mt.children[2].href = `/murmur/status/${post.id}`;
    a.querySelector('.r-tx').textContent = post.text;
    const ac = a.querySelectorAll('.r-ac span');
    ac[0].textContent = `💬 ${post.counts.replies}`; ac[1].textContent = `🔁 ${post.counts.reposts}`; ac[2].textContent = `♥ ${post.counts.likes}`;
    const parent = { tag: 0, type: PostCell, key: post.id, memoizedProps: { post, onLike() {}, onReply() {}, showActions: true }, return: timelineFiber };
    a[`__reactFiber$${KEY}`] = { tag: 5, type: 'article', key: null, memoizedProps: { role: 'article', className: a.className, tabIndex: 0 }, return: parent };
    a[`__reactProps$${KEY}`] = { role: 'article', className: a.className, tabIndex: 0, onClick() {} };
    c.append(a);
    return c;
  }
  async function load() {
    if (busy || done) return;
    busy = true;
    try {
      const r = await fetch('/api/murmur/timeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeline: 'home', cursor }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      for (const p of j.posts || []) tl.append(cell(p));
      cursor = j.next;
      if (j.next === null) done = true;
    } catch (e) {
      if (!document.querySelector('.n4er')) { const d = document.createElement('div'); d.className = 'n4er'; d.textContent = 'Something went wrong. Try reloading.'; tl.after(d); }
      done = true;
    } finally { busy = false; }
    // (still at the bottom, a short timeline: the next page)
    if (!done && more.getBoundingClientRect().top < innerHeight + 200) setTimeout(load, 50);
  }
  addEventListener('scroll', () => { if (more.getBoundingClientRect().top < innerHeight + 400) load(); });
  load();
}

// Pebble (task jump, "stop the feed jumping to the top when new posts come in"): a live feed that asks for new
// posts every 4 s (a GET) and, when there are some, puts them at the top and scrolls the page there
// (window.Pebble.applyNew calls Pebble.scrollToTop, which the logo uses too). CSS can't stop it, and a mod
// that blocks every scrollTo breaks the logo's "back to the top".
const PEBBLE_POST = (p) => `<div class="p3ps" data-id="${p.id}"><div class="p3hd"><i></i><b>${p.who}</b><span>${p.when}</span></div><div class="p3tx">${p.text}</div><div class="p3im"></div></div>`;
const pebblePost = (id) => ({ id, who: ['Ines', 'Marco', 'Yuki', 'Femi', 'Clara', 'Owen', 'Zara'][id % 7], when: `${(id % 50) + 1}m`, text: `Update #${id}: ${['the market on Elm St is open late tonight.', 'roadworks on the bypass are finally done.', 'the choir concert moved to Sunday.', 'free museum entry this Thursday.', 'new bike lanes along the river.'][id % 5]}` });
const PEBBLE_PAGE = () => PAGE('Pebble · Live', `
<style>
  body { margin: 0; max-width: none; background: #f4f1ec; color: #222; font: 15px/1.4 system-ui, sans-serif; }
  .p1tp { position: sticky; top: 0; z-index: 3; height: 52px; display: flex; align-items: center; gap: 16px; padding: 0 20px; background: #2d6a4f; color: #fff; }
  .p1tp a { color: #fff; text-decoration: none; } #p1logo { font-weight: 800; font-size: 20px; }
  .p2fd { width: 560px; margin: 16px auto; }
  .p3ps { background: #fff; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 1px 2px #0002; }
  .p3hd { display: flex; gap: 8px; align-items: center; } .p3hd i { width: 32px; height: 32px; border-radius: 50%; background: #b7c9bd; } .p3hd span { color: #777; font-size: 13px; margin-left: auto; }
  .p3tx { margin: 8px 0; } .p3im { height: 120px; border-radius: 8px; background: linear-gradient(135deg, #d8e2dc, #ffe5d9); }
  .p4ts { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); background: #2d6a4f; color: #fff; padding: 6px 14px; border-radius: 16px; z-index: 4; }
</style>
<div class="p1tp" role="banner"><a href="#" id="p1logo">pebble</a><a href="#">Live</a><a href="#">Local</a><a href="#">Saved</a></div>
<main class="p2fd" role="main"><div id="p2feed" role="feed" data-newest="1030">${Array.from({ length: 30 }, (_, i) => PEBBLE_POST(pebblePost(1030 - i))).join('')}</div></main>
<script src="/pebble/app.js"></script>`);
function pebbleApp() {
  const P = (window.Pebble = window.Pebble || {});
  const feed = document.getElementById('p2feed');
  let newest = Number(feed.dataset.newest);
  P.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'instant' });
  P.render = (p) => {
    const d = document.createElement('div');
    d.className = 'p3ps'; d.dataset.id = String(p.id);
    d.innerHTML = '<div class="p3hd"><i></i><b></b><span></span></div><div class="p3tx"></div><div class="p3im"></div>';
    d.querySelector('b').textContent = p.who; d.querySelector('.p3hd span').textContent = p.when; d.querySelector('.p3tx').textContent = p.text;
    return d;
  };
  P.toast = (text) => {
    const t = document.createElement('div');
    t.className = 'p4ts'; t.textContent = text;
    document.body.append(t);
    setTimeout(() => t.remove(), 2500);
  };
  P.applyNew = (items) => {
    for (const it of items) feed.prepend(P.render(it));
    newest = Math.max(newest, ...items.map((x) => x.id));
    P.toast(`${items.length} new post${items.length > 1 ? 's' : ''}`);
    P.scrollToTop();
  };
  P.poll = async () => {
    try {
      const r = await fetch(`/api/pebble/new?after=${newest}`);
      const j = await r.json();
      if (j.items && j.items.length) P.applyNew(j.items);
    } catch (e) { /* next time */ }
  };
  document.getElementById('p1logo').addEventListener('click', (e) => { e.preventDefault(); P.scrollToTop(); });
  setInterval(() => P.poll(), 4000);
}

// ---- the X stand-in

// The authenticated user (document.cookie twid) and authors.
const ME = '999';
const author = (following, followedBy, id = '1000') => ({
  result: { rest_id: id, relationship_perspectives: { following, followed_by: followedBy }, legacy: { screen_name: `user${id}` } },
});
const tweet = (id, { following = true, followedBy = true, legacy = {}, extra = {} } = {}) => ({
  entryId: `tweet-${id}`,
  content: {
    entryType: 'TimelineTimelineItem',
    itemContent: {
      itemType: 'TimelineTweet',
      tweet_results: { result: { __typename: 'Tweet', rest_id: id, core: { user_results: author(following, followedBy) }, legacy: { full_text: `post ${id}`, ...legacy }, ...extra } },
    },
  },
});

/**
 * A HomeLatestTimeline response, and which entries Detox Timeline keeps out of the box (every filter off:
 * only original text posts from people who follow you back; cursors always stay).
 */
function timeline() {
  const entries = [
    tweet('1'), // a mutual's plain post: kept
    tweet('2', { legacy: { retweeted_status_result: { result: { rest_id: 'orig' } } } }), // repost
    { entryId: 'promoted-tweet-3', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: { advertiser: 1 }, tweet_results: { result: { legacy: {} } } } } }, // ad
    { entryId: 'who-to-follow-4', content: { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { itemType: 'TimelineUser' } } }] } },
    tweet('5', { followedBy: false }), // doesn't follow you back
    tweet('6', { legacy: { extended_entities: { media: [{ type: 'photo' }] } } }), // image
    tweet('7', { legacy: { is_quote_status: true } }), // quote
    tweet('8', { legacy: { entities: { urls: [{ expanded_url: 'https://example.com/story' }] } } }), // link
    tweet('9'), // another plain post: kept
    { entryId: 'cursor-bottom-10', content: { entryType: 'TimelineTimelineCursor', value: 'abc' } },
  ];
  const body = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
  return { body, all: entries.map((e) => e.entryId), kept: ['tweet-1', 'tweet-9', 'cursor-bottom-10'] };
}

const X_PAGE = () => PAGE('Home / X (TRIF e2e stand-in)', `
<header style="display:flex;gap:12px;align-items:center"><h1 style="margin:0">X stand-in</h1><span id="status">loading…</span></header>
<main data-testid="primaryColumn">
  <h2>fetch</h2><ol id="fetch-list"></ol>
  <h2>XMLHttpRequest</h2><ol id="xhr-list"></ol>
</main>
<script>
document.cookie = 'twid=u%3D${ME}; path=/';
const vars = encodeURIComponent(JSON.stringify({ count: 20, includePromotedContent: true, enableRanking: true }));
const url = '/i/api/graphql/e2eQueryId/HomeLatestTimeline?variables=' + vars;
const show = (id, json) => {
  const entries = json.data.home.home_timeline_urt.instructions[0].entries;
  document.getElementById(id).innerHTML = entries.map((e) => '<li data-entry="' + e.entryId + '">' + e.entryId + '</li>').join('');
};
window.__xDone = Promise.all([
  fetch(url, { headers: { 'content-type': 'application/json' } }).then((r) => r.json()).then((j) => show('fetch-list', j)),
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url + '&via=xhr');
    x.onload = () => { try { show('xhr-list', JSON.parse(x.responseText)); resolve(); } catch (e) { reject(e); } };
    x.onerror = () => reject(new Error('xhr failed'));
    x.send();
  }),
]).then(() => { document.getElementById('status').textContent = 'loaded'; window.__xLoaded = true; },
         (e) => { document.getElementById('status').textContent = 'error: ' + e.message; window.__xError = String(e); });
</script>`);

// Google's markup, cut down to what the shipped Google mods key on (see their comments): ids, data
// attributes, jsname values, the udm=50 AI Mode links and the <promo-middle-slot> tag. data-e2e says what
// each mod must do to it ("hide-ai": AI Banisher, "hide-results": Just Results, "keep": neither).
const GOOGLE_SEARCH_BOX = `
<form role="search"><textarea name="q" data-e2e="keep-box"></textarea>
  <button type="button" jsname="B6rgad" data-e2e="hide-ai-mode-button">AI Mode</button>
  <button type="submit" data-e2e="keep-search-button">Google Search</button></form>
<div jsslot data-e2e="hide-ai-promo-slot"><div><promo-middle-slot>Try Gemini, Google's AI</promo-middle-slot></div></div>`;
// (and the logo as an <img class=lnXdpd>, for DVD Logo: a picture from elsewhere, so it bounces a copy)
const GOOGLE_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='272' height='92'%3E%3Crect width='272' height='92' rx='20' fill='%234285f4'/%3E%3C/svg%3E";
const GOOGLE_HOME = () => PAGE('Google (TRIF e2e stand-in)', `<div id="logo" data-e2e="keep-logo">Google</div>
<img class="lnXdpd" alt="Google" width="272" height="92" src="${GOOGLE_LOGO}" data-e2e="keep-logo-img">${GOOGLE_SEARCH_BOX}`);
const GOOGLE_RESULTS = () => PAGE('trif - Google Search (TRIF e2e stand-in)', `
${GOOGLE_SEARCH_BOX}
<div role="list">
  <div role="listitem" data-e2e="keep-tab"><a href="/search?q=trif">All</a></div>
  <div role="listitem" data-e2e="hide-ai-mode-tab"><a href="/search?q=trif&amp;udm=50">AI Mode</a></div>
  <div role="listitem" data-e2e="keep-images-tab"><a href="/search?q=trif&amp;udm=2">Images</a></div>
</div>
<div id="rcnt">
  <div data-e2e="hide-ai-overview"><div id="m-x-content">AI Overview: TRIF is… <textarea>Ask anything</textarea></div></div>
  <div id="center_col" data-e2e="keep-center">
    <div id="tads" data-e2e="hide-results-top-ads"><div data-text-ad="1"><a href="https://ads.example/"><h3>Sponsored: buy TRIF</h3></a></div></div>
    <div data-dsktp-pla-or-su data-e2e="hide-results-products">Featured products</div>
    <div id="rso">
      <div data-rpos="0" data-e2e="keep-result-1"><a href="https://example.com/one"><h3>A plain web result</h3></a></div>
      <div data-rpos="1" data-e2e="hide-results-paa"><div data-initq="trif">People also ask</div></div>
      <div data-rpos="2" data-e2e="hide-results-videos"><span>Short videos</span></div>
      <div data-rpos="3" data-e2e="keep-result-2"><a href="https://example.com/two"><h3>Another web result</h3></a></div>
    </div>
    <div id="bottomads" data-e2e="hide-results-bottom-ads">Sponsored at the bottom</div>
    <div id="bres" data-e2e="hide-results-related">People also search for</div>
  </div>
</div>`);

// ---- servers

function selfSignedCert(dir) {
  // (Named for the hosts it covers: a cached certificate without www.google.com isn't reused.)
  const key = path.join(dir, 'x-google-key.pem');
  const cert = path.join(dir, 'x-google-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    const r = run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '7',
      '-subj', '/CN=x.com', '-addext', 'subjectAltName=DNS:x.com,DNS:*.x.com,DNS:www.google.com']);
    if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const SW_SCRIPT = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  const { url, method } = e.data || {};
  fetch(url, { method, body: method === 'POST' ? 'from the service worker' : undefined })
    .then((r) => 'sent ' + r.status, (x) => 'blocked: ' + x.message)
    .then((t) => e.ports[0].postMessage(t));
});
`;

// X's own logo, as X's image server has it (public, stable), and the parts of X's CSP that apply to a page
// with mods on it (fetched from x.com, 11-14)
const X_PIC = 'https://pbs.twimg.com/profile_images/1683899100922511378/5lY42eHs';
const X_CSP = "default-src 'self'; img-src 'self' https://*.twimg.com data: blob:; style-src 'self' 'unsafe-inline' https://*.twimg.com; " +
  "script-src 'self' 'nonce-e2e' 'wasm-unsafe-eval'; script-src-attr 'none'; font-src 'self' https://*.twimg.com data:; " +
  "media-src 'self' https://*.twimg.com blob: data:; connect-src 'self' https://*.twimg.com; worker-src 'self' blob:";
const X_PICS_PAGE = (size) => `<!doctype html><html><head><meta charset="utf-8"><title>Pics (@e2e_pics) / X</title></head><body>
<div id="react-root"><main><div data-testid="primaryColumn">
<a href="/e2e_pics/photo"><img alt="" src="${X_PIC}_${size}.jpg" width="134" height="134"></a>
<div data-testid="UserName"><span>Pics</span> <span>@e2e_pics</span></div>
<article data-testid="tweet"><div data-testid="Tweet-User-Avatar"><img alt="" src="${X_PIC}_normal.jpg" width="40" height="40"></div>
<div data-testid="User-Name"><a href="/e2e_pics"><span>Pics</span></a> <a href="/e2e_pics"><span>@e2e_pics</span></a></div>
<div data-testid="tweetText"><span>A post with X's real picture</span></div><div role="group"><span>3</span></div></article>
</div></main></div></body></html>`;

/** Starts both servers. Returns {port, tlsPort, requests, timeline, close()}. */
async function startServers(dir) {
  const requests = []; // {host, url, method, time}
  const tl = timeline();
  const handler = (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const u = new URL(req.url, 'http://x');
    requests.push({ host, url: req.url, method: req.method, time: Date.now() });
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (host === 'x.com') {
      if (u.pathname.startsWith('/i/api/graphql/')) return send(200, 'application/json', JSON.stringify(tl.body));
      if (u.pathname === '/home' || u.pathname === '/') return send(200, 'text/html; charset=utf-8', X_PAGE());
      if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
      // A stand-in profile page whose pictures are X's own logo from X's real image server (scenario.js
      // xPicturesCheck), under X's own rules for pictures, styles and scripts (its CSP, 11-14); ?s=400: the
      // profile's picture already at 400×400, as X shows some
      if (u.pathname === '/e2e_pics') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': X_CSP });
        return res.end(X_PICS_PAGE(u.searchParams.get('s') === '400' ? '400x400' : '200x200'));
      }
      // (another host's picture, with no CORS headers: sandboxFixesCheck's image variant)
      if (u.pathname === '/e2e-wide.png') return send(200, 'image/png', Buffer.from(WIDE_PNG, 'base64'));
      return send(404, 'text/plain', 'not found');
    }
    if (host === 'www.google.com') {
      if (u.pathname === '/search') return send(200, 'text/html; charset=utf-8', GOOGLE_RESULTS());
      if (u.pathname === '/') return send(200, 'text/html; charset=utf-8', GOOGLE_HOME());
      if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
      return send(404, 'text/plain', 'not found');
    }
    if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    // A service worker for the tab-lock checks (scenario.js tabLockHardeningCheck): it takes the page at
    // once, passes fetches through, and fetches what a message asks for (a request no tab owns: tabId -1).
    if (u.pathname === '/e2e-sw.js') return send(200, 'text/javascript', SW_SCRIPT);
    if (u.pathname === '/promos.html') return send(200, 'text/html; charset=utf-8', PROMOS_PAGE());
    if (u.pathname === '/hearth.html') return send(200, 'text/html; charset=utf-8', HEARTH_PAGE());
    if (u.pathname === '/hearth-feed.html') return send(200, 'text/html; charset=utf-8', HEARTH_PAGE({ feed: true }));
    // (the study's deep tasks: the pages, their apps' scripts, and their APIs)
    if (u.pathname === '/streamly.html') return send(200, 'text/html; charset=utf-8', STREAMLY_PAGE());
    if (u.pathname === '/streamly/app.js') return send(200, 'text/javascript', `(${streamlyApp})(${JSON.stringify(STREAMLY_EPS)});`);
    if (u.pathname === '/api/streamly/play' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { let ep = 1; try { ep = Math.max(1, Math.min(STREAMLY_EPS.length, Number(JSON.parse(body).ep) || 1)); } catch { /* 1 */ } send(200, 'application/json', JSON.stringify({ ep, resumeAt: 0, title: STREAMLY_EPS[ep - 1] })); });
      return undefined;
    }
    if (u.pathname === '/murmur.html') return send(200, 'text/html; charset=utf-8', MURMUR_PAGE());
    if (u.pathname === '/murmur/app.js') return send(200, 'text/javascript', `(${murmurApp})();`);
    if (u.pathname === '/api/murmur/timeline' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { let cursor = 0; try { cursor = Math.max(0, Math.min(20, Number(JSON.parse(body).cursor) || 0)); } catch { /* 0 */ } send(200, 'application/json', JSON.stringify({ posts: murmurPage(cursor), next: cursor < 20 ? cursor + 1 : null })); });
      return undefined;
    }
    if (u.pathname === '/pebble.html') return send(200, 'text/html; charset=utf-8', PEBBLE_PAGE());
    if (u.pathname === '/pebble/app.js') return send(200, 'text/javascript', `(${pebbleApp})();`);
    if (u.pathname === '/api/pebble/new') { const after = Number(u.searchParams.get('after')) || 1030; return send(200, 'application/json', JSON.stringify({ items: [pebblePost(after + 1)] })); }
    // (the second depth study's pages, lib/deep2.js)
    if (deep2Route(u, req, send)) return;
    // (the scrolling-feed task's next posts: two friends', a Sponsored one, and a friend's that says "sponsored" every other page)
    if (u.pathname === '/api/hearth-more' && u.search === '?ads=1' && req.method === 'POST') {
      const n = requests.filter((x) => x.url === '/api/hearth-more?ads=1').length;
      const f = (i) => 5 + 3 * (n - 1) + i;
      return send(200, 'application/json', JSON.stringify([
        { who: `Friend ${f(1)}`, when: '1d', text: `Older post ${f(1)}.` },
        { who: ['Lamps Inc.', 'Acrobat', 'Berry Effects', 'Cheap Flights'][n % 4], when: 'Sponsored', text: `Deal ${n}: don't miss it.` },
        { who: `Friend ${f(2)}`, when: '1d', text: `Older post ${f(2)}.` },
        { who: `Friend ${f(3)}`, when: '2d', text: n % 2 ? 'My podcast this week is sponsored by nobody, as usual.' : `Older post ${f(3)}.` },
      ]));
    }
    // (the Hearth feed's next posts: a POST, as Facebook's are, so a tab locked by trif run can't load them)
    if (u.pathname === '/api/hearth-more' && req.method === 'POST') {
      const n = requests.filter((x) => x.url === '/api/hearth-more').length;
      return send(200, 'application/json', JSON.stringify([1, 2, 3].map((i) => ({ who: `Friend ${5 + 3 * (n - 1) + i}`, when: '1d', text: `Older post ${3 * (n - 1) + i}.` }))));
    }
    if (u.pathname === '/sandbox.html') return send(200, 'text/html; charset=utf-8', SANDBOX_PAGE());
    if (u.pathname === '/clickjack.html') return send(200, 'text/html; charset=utf-8', CLICKJACK_PAGE());
    if (u.pathname === '/wide.html') return send(200, 'text/html; charset=utf-8', WIDE_PAGE());
    if (u.pathname === '/wideb.html') return send(200, 'text/html; charset=utf-8', WIDE_B_PAGE());
    // (rewrite-requests: what the request carried, as the server got it)
    if (u.pathname.startsWith('/e2e-rw/')) { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => send(200, 'application/json', JSON.stringify({ url: req.url, body }))); return undefined; }
    if (u.pathname === '/e2e-multi') return send(200, 'application/json', 'for (;;);{"a":["keep","drop"]}\n{"b":["drop"],"c":1}');
    // (x: another site's address, which a filter may not shorten: review F2)
    if (u.pathname === '/e2e-urls') return send(200, 'application/json', JSON.stringify({ u: 'https://127.0.0.1/watch?v=1&list=2&start_radio=1', w: 'https://127.0.0.1/watch?v=2', x: 'https://www.youtube.com/watch?v=3&si=e2e' }));
    // (go-to across a navigation, scenario.js comboFixesCheck: the page a boxed mod goes from, and the one it
    // goes to, with a counter and the page's own signal, each counted where the suite can read it)
    if (u.pathname === '/combo-go.html') return send(200, 'text/html; charset=utf-8', PAGE('TRIF e2e combo go', '<h1 id="title">Going</h1>'));
    if (u.pathname === '/combo-dest.html') return send(200, 'text/html; charset=utf-8', PAGE('TRIF e2e combo dest', `<h1 id="title">Arrived</h1>
<button type="button" id="cc">count</button> <button type="button" id="user">the user's button</button>
<script>
const d = document.documentElement; d.setAttribute('data-cc', '0'); d.setAttribute('data-pings', '[]');
document.getElementById('cc').addEventListener('click', () => d.setAttribute('data-cc', String(Number(d.getAttribute('data-cc')) + 1)));
document.addEventListener('combo-ping', (e) => d.setAttribute('data-pings', JSON.stringify([...JSON.parse(d.getAttribute('data-pings')), e.detail])));
</script>`));
    if (u.pathname === '/e2e-wide.png') return send(200, 'image/png', Buffer.from(WIDE_PNG, 'base64'));
    // (a picture already the size powers-b.js's header asks for: B10's same-address variant)
    if (u.pathname === '/e2e-big.png') return send(200, 'image/png', Buffer.from(WIDE_PNG, 'base64'));
    if (u.pathname === '/fixes.html') return send(200, 'text/html; charset=utf-8', FIXES_PAGE(tls.address().port));
    // (site-data: an address and the same address with a parameter out; JSON spaced as no serializer writes it)
    if (u.pathname === '/e2e-fix-urls') return send(200, 'application/json', JSON.stringify({ long: 'https://127.0.0.1/watch?v=1&si=e2e', short: 'https://127.0.0.1/watch?v=1' }));
    if (u.pathname === '/e2e-fix-raw') return send(200, 'application/json', '{ "a" : [ 1, 2 ] ,"b":"kept as sent" }');
    // (site approval, scenario.js siteApprovalCheck: a counter a boxed mod clicks, and the page's own signal)
    if (u.pathname === '/cross.html') return send(200, 'text/html; charset=utf-8', PAGE('TRIF e2e cross', `<h1 id="title">Two mods</h1><button type="button" id="cc">count</button>
<script>
const d = document.documentElement; d.setAttribute('data-cc', '0'); d.setAttribute('data-pings', '[]');
document.getElementById('cc').addEventListener('click', () => d.setAttribute('data-cc', String(Number(d.getAttribute('data-cc')) + 1)));
document.addEventListener('cm-ping', (e) => d.setAttribute('data-pings', JSON.stringify([...JSON.parse(d.getAttribute('data-pings')), e.detail])));
</script>`));
    if (u.pathname === '/powers3.html') return send(200, 'text/html; charset=utf-8', POWERS3_PAGE());
    // (mods that break, scenario.js modHealthCheck: the element a style mod looks for, there with ?has=1)
    if (u.pathname === '/health.html') return send(200, 'text/html; charset=utf-8', PAGE('TRIF e2e health', `<h1 id="title">Health</h1>${u.searchParams.get('has') ? '<div id="e2e-quiet-target">here</div>' : '<p>gone</p>'}`));
    if (u.pathname.startsWith('/e2e-goto-')) return send(200, 'text/html; charset=utf-8', PAGE('go-to', `<p id="where">${u.pathname}</p>`));
    // (powers, site-data: small JSON the page fetches, which boxed mods filter; search-box: where it goes)
    if (u.pathname.startsWith('/e2e-api/')) return send(200, 'application/json', JSON.stringify({
      items: [{ id: '1', text: 'keep me', url: '/two.html' }, { id: '2', text: 'Promoted: buy', url: '/two.html' }, { id: '3', text: 'keep me too', url: '/two.html' }],
      cursor: 'c-next', count: 3, more: true,
    }));
    if (u.pathname === '/e2e-search') return send(200, 'text/html; charset=utf-8', PAGE('search', `<p id="q">${String(u.searchParams.get('q') || '').replace(/[<&]/g, '')}</p>`));
    // (audit AU-7: a page whose speculation rules prefetch its same-site links at once, with no click)
    if (u.pathname === '/specrules.html') return send(200, 'text/html; charset=utf-8', PAGE('TRIF e2e speculation rules', `<script type="speculationrules">{"prefetch":[{"source":"document","where":{"href_matches":"/e2e-spec-*"},"eagerness":"immediate"}]}</script>
<h1 id="title">Speculation rules</h1><p><a id="known" href="/two.html">a link the page has</a></p>`));
    if (u.pathname.startsWith('/e2e-spec-')) return send(200, 'text/html; charset=utf-8', PAGE('spec', '<p>prefetched</p>'));
    if (u.pathname === '/sweep.html') return send(200, 'text/html; charset=utf-8', SWEEP_PAGE());
    if (u.pathname === '/sweep-frame.html') return send(200, 'text/html; charset=utf-8', SWEEP_FRAME());
    return send(200, 'text/html; charset=utf-8', testPage(host, u.pathname));
  };
  const plain = http.createServer(handler);
  const tls = https.createServer(selfSignedCert(dir), handler);
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  await new Promise((r) => tls.listen(0, '127.0.0.1', r));
  return {
    port: plain.address().port,
    tlsPort: tls.address().port,
    requests,
    timeline: tl,
    close: () => Promise.all([plain, tls].map((srv) => new Promise((r) => { srv.close(r); srv.closeAllConnections(); }))),
  };
}

module.exports = { startServers, timeline, SWEEP_EXPECT, murmurPage, murmurFollowing, MURMUR_PER_PAGE };
