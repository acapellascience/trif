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
<p><input id="wd" value="the user's draft"> <textarea id="wta">draft two</textarea></p>
<div id="ed2" contenteditable="true">the user's editor draft</div>
<p><input id="pw3" type="password" value="hunter2"> <input id="cc3" autocomplete="cc-number" value="4111"> <input id="fh3" type="hidden" value="h"> <select id="sel3"><option>a</option><option>b</option></select></p>
<p id="seen"></p>
<script>
document.getElementById('pclick').addEventListener('click', (e) => { e.target.textContent = String(Number(e.target.textContent) + 1); });
const seen = [];
for (const id of ['wd', 'wta', 'ed2']) document.getElementById(id).addEventListener('input', () => { seen.push(id); document.getElementById('seen').textContent = seen.join(','); });
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
const GOOGLE_HOME = () => PAGE('Google (TRIF e2e stand-in)', `<div id="logo" data-e2e="keep-logo">Google</div>${GOOGLE_SEARCH_BOX}`);
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
      return send(404, 'text/plain', 'not found');
    }
    if (host === 'www.google.com') {
      if (u.pathname === '/search') return send(200, 'text/html; charset=utf-8', GOOGLE_RESULTS());
      if (u.pathname === '/') return send(200, 'text/html; charset=utf-8', GOOGLE_HOME());
      if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
      return send(404, 'text/plain', 'not found');
    }
    if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    if (u.pathname === '/promos.html') return send(200, 'text/html; charset=utf-8', PROMOS_PAGE());
    if (u.pathname === '/sandbox.html') return send(200, 'text/html; charset=utf-8', SANDBOX_PAGE());
    if (u.pathname === '/powers3.html') return send(200, 'text/html; charset=utf-8', POWERS3_PAGE());
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

module.exports = { startServers, timeline, SWEEP_EXPECT };
