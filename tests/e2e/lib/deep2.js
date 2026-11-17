'use strict';
// The second depth study's pages (scenario.js guidanceStudy: --study-tasks suggest,newest,live; docs/STUDY-DEEP-2.md).
// Each app is one minified bundle (short names, no source map, a few long lines) buried among ~300 generated
// vendor modules, so the lever is only found by searching obfuscated code or by watching the app's traffic.
// Each has a surface fix that passes a first look and a deep one that's clean:
// - Tidepool (/tidepool.html): a virtualized feed (fixed 150 px rows, recycled nodes). "Suggested for you"
//   posts are marked only by that badge text (reposts carry the same badge element), and in the data as k:3.
//   Hiding rows leaves 150 px holes (and a node hidden by hand keeps its style when it's reused for another post);
//   dropping k:3 items from GET /tidepool/api/v2/feed leaves none.
// - Quillby (/quillby.html): an article's comments, 10 a page from GET /quillby/api/c?…&o=0 (0 top, 1 oldest,
//   2 newest). Re-sorting the drawn cards by their <time> passes a look, but they're the 10 top comments, not
//   the 10 newest. The bundle has a sort menu behind a flag (localStorage qb:flags {"sm":1}) and reads the
//   sort from localStorage qb:o; or the request's o can be rewritten.
// - Glint (/glint.html): a live mini-player pops up in the corner 1.8 s after load and polls ~25 KB frames
//   (GET /glint/api/f?ch=9…) every 400 ms. Hiding it leaves the polling running; the bundle mounts it only when
//   GET /glint/api/home has a "feat" entry and localStorage gl:prefs doesn't say {"lp":0} (its close button
//   sets sessionStorage gl.pv, for this tab only). The big player (a card's click) uses the same frames.
// Everything these pages do at load is a GET: nothing a measure needs is a send right after a reload.

// ---- generated vendor code (deterministic)
function vendor(seed, count, vocab) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const L = 'abcdefghijklmnopqrstuvwxyz';
  const N = `${L}ABCDEFGHIJKLMNOPQRSTUVWXYZ$_0123456789`;
  const nm = () => pick(L.split('')) + (rnd() < 0.7 ? pick(N.split('')) : '');
  const words = ['Like', 'Reply', 'Share', 'Save', 'Report', 'Mute', 'Block', 'Copy link', 'Embed', 'Follow', 'Unfollow', 'Settings', 'Close', 'Back', 'Retry', 'Show more', 'Show less', 'Loading…', 'Try again', 'Something went wrong', 'Notifications', 'Messages', 'Search', 'Trending', 'Home', 'Profile', 'Privacy', 'Terms', 'Cookies', 'Help'];
  const T = [
    (a) => `function ${a}(e,t){if(null==e)return{};var n,r,o={},i=Object.keys(e);for(r=0;r<i.length;r++)n=i[r],t.indexOf(n)>=0||(o[n]=e[n]);return o}`,
    (a) => `function ${a}(){for(var e=[],t=0;t<arguments.length;t++){var n=arguments[t];if(n){var r=typeof n;if("string"===r||"number"===r)e.push(n);else if(Array.isArray(n))e.push(${a}.apply(null,n));else if("object"===r)for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&n[o]&&e.push(o)}}return e.join(" ")}`,
    (a) => `function ${a}(){try{var e=localStorage.getItem("${pick(vocab.keys)}");return e?JSON.parse(e):${pick(['{}', 'null', '[]', '!1'])}}catch(t){return ${pick(['{}', 'null'])}}}`,
    (a) => `function ${a}(e){return fetch("${pick(vocab.urls)}"+(e?"?"+new URLSearchParams(e):""),{credentials:"same-origin"}).then(function(t){if(!t.ok)throw new Error("HTTP "+t.status);return t.json()})}`,
    (a) => `var ${a}={${Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => `${nm()}${nm()}:${pick(['!0', '!1', '0', '1', '"a"', '"b"', '"off"', '300', '5e3'])}`).join(',')}}`,
    (a) => `function ${a}(e,t){var n;return function(){var r=this,o=arguments;clearTimeout(n),n=setTimeout(function(){e.apply(r,o)},t)}}`,
    (a) => `var ${a}={${Array.from({ length: 4 + Math.floor(rnd() * 5) }, () => `${nm()}:"${pick(words)}"`).join(',')}}`,
    (a) => `function ${a}(e){var t=Math.floor((Date.now()-e)/6e4);return t<1?"now":t<60?t+"m":t<1440?Math.floor(t/60)+"h":Math.floor(t/1440)+"d"}`,
    (a) => `function ${a}(e,t){switch(void 0===e&&(e={}),t.type){case"${pick(vocab.actions)}":return Object.assign({},e,{${nm()}:t.payload});case"${pick(vocab.actions)}":return Object.assign({},e,{${nm()}:!${pick(['0', '1'])}});default:return e}}`,
    (a) => `function ${a}(){var e={};return{on:function(t,n){(e[t]=e[t]||[]).push(n)},off:function(t,n){e[t]=(e[t]||[]).filter(function(e){return e!==n})},emit:function(t,n){(e[t]||[]).slice().forEach(function(e){e(n)})}}}`,
    (a) => `function ${a}(e,t){var n=document.createElement(e);for(var r in t)"style"===r?Object.assign(n.style,t[r]):"className"===r?n.className=t[r]:n.setAttribute(r,t[r]);return n}`,
    (a) => `function ${a}(e){var t=e.getBoundingClientRect();return t.top<innerHeight&&t.bottom>0&&t.left<innerWidth&&t.right>0}`,
    (a) => `function ${a}(e){return String(e).replace(/[&<>"']/g,function(e){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[e]})}`,
    (a) => `function ${a}(e,t,n){return e.addEventListener(t,n,{passive:!0}),function(){e.removeEventListener(t,n)}}`,
  ];
  const mods = [];
  const ids = new Set();
  while (mods.length < count) {
    const id = 100 + Math.floor(rnd() * 9800);
    if (ids.has(id)) continue;
    ids.add(id);
    const fns = [];
    const names = [];
    for (let k = 0, m = 2 + Math.floor(rnd() * 4); k < m; k++) { const a = `${nm()}${k}`; names.push(a); fns.push(pick(T)(a)); }
    mods.push(`${id}:function(e,t,n){"use strict";${fns.join(';')};${names.map((a) => `t.${nm().toUpperCase()}=${a}`).join(',')}}`);
  }
  return { mods, ids };
}

// The bundle: a webpack-style runtime that runs module `entry`, with the app module at a random place among the vendor ones
function bundle(name, app, seed, vocab) {
  const { mods, ids } = vendor(seed, 300, vocab);
  let entry = 7000; while (ids.has(entry)) entry++;
  const src = app.toString().replace(/^function\s*\w*\s*\(/, 'function(');
  // (collapse the app's own whitespace outside its strings: written with semicolons, no comments, no templates)
  const min = src.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/).map((x, i) => (i % 2 ? x : x.replace(/\s*\n\s*/g, '').replace(/\s*([=+\-*/<>!?:;,{}()|&])\s*/g, '$1'))).join('');
  mods.splice(Math.floor(mods.length * 0.62), 0, `${entry}:${min}`);
  const lines = [];
  for (let i = 0; i < mods.length; i += 40) lines.push(mods.slice(i, i + 40).join(','));
  return `/*! For license information please see ${name}.LICENSE.txt */\n(()=>{var e={${lines.join(',\n')}},t={};function n(r){var o=t[r];if(void 0!==o)return o.exports;var i=t[r]={exports:{}};return e[r].call(i.exports,i,i.exports,n),i.exports}n(${entry})})();\n`;
}

// ---- Tidepool: the feed
const TP_PER = 12;
const TP_PAGES = 8;
const TP_PEOPLE = [['Ines Ortega', 'ines'], ['Marco Bellini', 'marcob'], ['Yuki Tanaka', 'yukit'], ['Femi Adeyemi', 'femi'], ['Clara Novak', 'claran'], ['Owen Price', 'owenp'], ['Zara Malik', 'zaram'], ['Theo Laurent', 'theol'], ['Priya Raman', 'priyar'], ['Jonas Berg', 'jberg']];
const TP_SUGG = [['Crypto Daily', 'cryptodaily'], ['FitLife Coach', 'fitlife'], ['Gadget Hub', 'gadgethub'], ['Viral Clips', 'viralclips'], ['Travel Deals', 'traveldeals']];
const TP_TEXT = ['the tide pools at Point Lobos were full of anemones this morning', 'finally finished the bookshelf, only one screw left over', 'anyone know a good bakery near the station?', 'the choir sang the new arrangement tonight and it worked', 'three days of rain and the garden is thrilled', 'new bike lanes along the river are open', 'made too much soup again, come over', 'the museum is free on Thursday evenings', 'first swim of the season, very cold, no regrets', 'our cat learned to open the cupboard'];
const TP_SPAM = ['10 things you won\'t believe happened this week', 'this one stretch changed my mornings', 'you need this gadget in your life', 'watch till the end', 'flights from $49, today only'];
const tpSuggested = (n) => (n * 7) % 11 < 3;
const tpItem = (n) => {
  if (tpSuggested(n)) { const [nme, h] = TP_SUGG[n % TP_SUGG.length]; return { i: `tp${n}`, u: { n: nme, h }, x: TP_SPAM[n % TP_SPAM.length], k: 3, r: null, t: 30 + n % 200, l: 900 + n * 13 }; }
  const [nme, h] = TP_PEOPLE[n % TP_PEOPLE.length];
  const rep = (n * 5) % 9 === 0;
  return { i: `tp${n}`, u: { n: nme, h }, x: TP_TEXT[(n * 3) % TP_TEXT.length], k: rep ? 1 : 0, r: rep ? TP_PEOPLE[(n + 3) % TP_PEOPLE.length][0] : null, t: 2 + n * 4, l: (n * 37) % 120 };
};
const tidepoolPage = (c) => Array.from({ length: TP_PER }, (_, j) => tpItem(100 + c * TP_PER + j));
const tpCursor = (c) => Buffer.from(JSON.stringify([c, TP_PER])).toString('base64');
function tidepoolApp(e, t, n) {
  'use strict';
  var H = 150, B = 2, L = [], X = null, W = !1, M = new Map(), F = [], R = document.getElementById('tp-root'), Z = R.querySelector('.tZ'), E = R.querySelector('.tE'), D = R.querySelector('.tD');
  var S = { 0: '', 1: 'Reposted by ', 3: 'Suggested for you' };
  function f(m) { return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'; }
  function q(c) {
    W = !0;
    return fetch('/tidepool/api/v2/feed' + (c ? '?c=' + encodeURIComponent(c) : ''), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { for (var i = 0; i < j.d.length; i++) L.push(j.d[i]); X = j.nx || null; W = !1; Z.style.height = L.length * H + 'px'; D.hidden = !!X; u(); }).catch(function () { W = !1; E.hidden = !1; });
  }
  function b(o, d) {
    var g = d.k === 3 ? S[3] : d.k === 1 ? S[1] + d.r : '';
    o.innerHTML = '<article class="tA">' + (g ? '<div class="tB"><span class="tG">' + g + '</span></div>' : '') + '<div class="tH"><a class="tN" href="/tidepool/u/' + d.u.h + '">' + d.u.n + '</a> <span class="tM">@' + d.u.h + ' · ' + f(d.t) + '</span></div><p class="tX">' + d.x + '</p><div class="tF"><span>♡ ' + d.l + '</span><a class="tL" href="/tidepool/p/' + d.i + '">Open</a></div></article>';
  }
  function P() { var o = document.createElement('div'); o.className = 'tR'; o.style.cssText = 'position:absolute;left:0;right:0;top:0;height:' + H + 'px'; return o; }
  function u() {
    var y = scrollY - (Z.getBoundingClientRect().top + scrollY);
    var a = Math.max(0, Math.floor(y / H) - B), z = Math.min(L.length - 1, Math.ceil((y + innerHeight) / H) + B);
    M.forEach(function (o, i) { if (i < a || i > z) { M.delete(i); o.remove(); F.push(o); } });
    for (var i = a; i <= z; i++) { if (M.has(i)) continue; var o = F.pop() || P(); b(o, L[i]); o.style.transform = 'translateY(' + i * H + 'px)'; o.setAttribute('aria-posinset', i + 1); M.set(i, o); Z.appendChild(o); }
    if (!W && X && z >= L.length - 4) q(X);
  }
  var K = 0;
  addEventListener('scroll', function () { if (!K) K = requestAnimationFrame(function () { K = 0; u(); }); }, { passive: !0 });
  addEventListener('resize', u);
  q(null);
}
const TIDEPOOL_JS = '/tidepool/static/js/main.3e7a91c4.js';
const TIDEPOOL_PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home / Tidepool</title>
<style>
  [hidden] { display: none !important; }
  body { margin: 0; background: #f4f6f8; color: #14171a; font: 15px/1.4 system-ui, sans-serif; }
  .tT { position: sticky; top: 0; z-index: 2; height: 52px; display: flex; align-items: center; gap: 20px; padding: 0 20px; background: #fff; border-bottom: 1px solid #dde3e8; }
  .tT b { color: #0b7a75; font-size: 20px; } .tT a { color: #4a5560; text-decoration: none; }
  .tW { max-width: 600px; margin: 0 auto; background: #fff; border-left: 1px solid #dde3e8; border-right: 1px solid #dde3e8; min-height: 100vh; }
  .tZ { position: relative; }
  .tR { box-sizing: border-box; border-bottom: 1px solid #e6ebef; overflow: hidden; }
  .tA { padding: 12px 16px; height: 100%; box-sizing: border-box; }
  .tB { font-size: 12px; color: #66727c; margin-bottom: 4px; } .tN { color: #14171a; font-weight: 600; text-decoration: none; } .tM { color: #66727c; }
  .tX { margin: 6px 0; } .tF { display: flex; gap: 24px; color: #66727c; font-size: 13px; } .tL { color: #0b7a75; }
  .tE, .tD { padding: 24px; text-align: center; color: #66727c; }
</style></head><body>
<div class="tT" role="banner"><b>tidepool</b><a href="#">Home</a><a href="#">Explore</a><a href="#">Notifications</a><a href="#">Messages</a></div>
<main class="tW" role="main"><div id="tp-root"><div class="tZ" role="feed"></div><div class="tE" hidden>Something went wrong. Try again.</div><div class="tD" hidden>You're all caught up</div></div></main>
<script src="${TIDEPOOL_JS}"></script></body></html>`;

// ---- Quillby: the comments
const QB_N = 60;
const QB_NOW = Math.floor(Date.now() / 1000);
const QB_NAMES = ['harbourlight', 'M. Okafor', 'quietreader', 'Dana P.', 'lev_k', 'Rosa Lind', 'tomasz', 'Aiko', 'northfield', 'B. Chen', 'grace_h', 'Sam W.'];
const QB_TEXT = ['Great piece, the part about the ferry schedule matches what I see every morning.', 'I disagree with the conclusion, but the reporting is solid.', 'Does anyone know if the council vote is public?', 'This happened on my street too, last spring.', 'Thanks for covering this, nobody else did.', 'The numbers in the third paragraph look off to me.', 'Finally someone asks the obvious question.', 'My grandfather worked at that yard for 30 years.', 'Can we get a follow-up in a month?', 'The photo of the harbour at dawn is lovely.'];
// i = 0 newest … 59 oldest; older comments have more votes, so the top page is mostly old ones
const qbComment = (i) => ({ id: `c${1000 + i}`, n: QB_NAMES[(i * 7) % QB_NAMES.length], ts: QB_NOW - (i * 41 + ((i * i) % 17) + 3) * 60, b: QB_TEXT[(i * 3) % QB_TEXT.length], v: Math.round(2 + i * 2.2 + ((i * 37) % 23)) });
const QB_ALL = Array.from({ length: QB_N }, (_, i) => qbComment(i));
const qbSorted = (o) => [...QB_ALL].sort(o === 2 ? (a, b) => b.ts - a.ts : o === 1 ? (a, b) => a.ts - b.ts : (a, b) => b.v - a.v || b.ts - a.ts);
function quillbyApp(e, t, n) {
  'use strict';
  function j(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (x) { return {}; } }
  var F = Object.assign({ sm: !1, rx: !0, av: !1 }, j('qb:flags')), O = +(localStorage.getItem('qb:o') || 0), P = 0, A = document.getElementById('qb-c'), Q, Y;
  var U = [[0, 'Top'], [2, 'Newest'], [1, 'Oldest']];
  function f(s) { var m = Math.floor((Date.now() / 1e3 - s) / 60); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'; }
  function g(p) { return fetch('/quillby/api/c?a=' + A.dataset.a + '&p=' + p + '&o=' + O, { credentials: 'same-origin' }).then(function (r) { return r.json(); }); }
  function c(x) { var d = document.createElement('div'), w = new Date(x.ts * 1e3); d.className = 'qC'; d.setAttribute('data-c', x.id); d.innerHTML = '<div class="qA"><b>' + x.n + '</b> · <time datetime="' + w.toISOString() + '" title="' + w.toLocaleString() + '">' + f(x.ts) + '</time></div><p class="qB">' + x.b + '</p><div class="qV">▲ ' + x.v + '</div>'; return d; }
  function l() { Y.disabled = !0; g(P).then(function (d) { d.r.forEach(function (x) { Q.appendChild(c(x)); }); Y.hidden = !d.m; Y.disabled = !1; P++; }); }
  A.innerHTML = '<h2 class="qH">Comments <span>(' + A.dataset.n + ')</span></h2>' + (F.sm ? '<label class="qS">Sort by <select>' + U.map(function (u) { return '<option value="' + u[0] + '"' + (u[0] === O ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select></label>' : '<div class="qT">Top comments</div>') + '<div class="qL"></div><button type="button" class="qM">Show more comments</button>';
  Q = A.querySelector('.qL'); Y = A.querySelector('.qM');
  Y.addEventListener('click', l);
  if (F.sm) A.querySelector('select').addEventListener('change', function (v) { O = +v.target.value; localStorage.setItem('qb:o', O); P = 0; Q.textContent = ''; l(); });
  l();
}
const QUILLBY_JS = '/quillby/assets/index-8b2d4f1a.js';
const QUILLBY_PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The harbour yard's last winter · The Quillby</title>
<style>
  [hidden] { display: none !important; }
  body { margin: 0; background: #fbfaf7; color: #1d1d1b; font: 17px/1.6 Georgia, serif; }
  .qN { height: 56px; display: flex; align-items: center; gap: 22px; padding: 0 28px; border-bottom: 2px solid #1d1d1b; font: 15px system-ui, sans-serif; }
  .qN b { font: 700 24px Georgia, serif; } .qN a { color: #444; text-decoration: none; }
  article.qR, #qb-c { max-width: 680px; margin: 0 auto; padding: 0 20px; }
  h1 { font-size: 34px; line-height: 1.2; } .qBy { color: #666; font: 14px system-ui, sans-serif; }
  #qb-c { font: 15px/1.5 system-ui, sans-serif; padding-bottom: 60px; }
  .qT, .qS { color: #666; margin-bottom: 8px; } .qC { border-top: 1px solid #e3e0d8; padding: 12px 0; }
  .qA time { color: #777; } .qB { margin: 4px 0; } .qV { color: #888; font-size: 13px; }
  .qM { margin-top: 12px; padding: 8px 16px; border: 1px solid #1d1d1b; background: #fff; cursor: pointer; }
</style></head><body>
<div class="qN" role="banner"><b>The Quillby</b><a href="#">News</a><a href="#">City</a><a href="#">Culture</a><a href="#">Opinion</a></div>
<article class="qR"><h1>The harbour yard's last winter</h1><p class="qBy">By Nell Arden · 6 min read</p>
${['For ninety years the yard at the end of Pier Road built and mended the boats that worked this coast. This winter, for the first time, its slipways are empty.', 'The council will vote next month on a plan to turn the site into flats and a marina. Supporters say the yard has lost money for a decade; former workers say it was never given a chance to modernise.', 'Walking the yard with its last foreman, the scale of what is ending is hard to miss: the steam box, the sail loft, the long shed where whole hulls were turned by hand.', 'Whatever the vote decides, the town will have to decide what it wants its waterfront to be for.'].map((p) => `<p>${p}</p>`).join('\n')}
</article>
<section id="qb-c" data-a="quill-77" data-n="${QB_N}" aria-label="Comments"></section>
<script src="${QUILLBY_JS}"></script></body></html>`;

// ---- Glint: the live preview
const GL_CH = Array.from({ length: 12 }, (_, i) => ({ ch: i + 1, t: ['Night drive', 'Lo-fi study', 'Speedrun any%', 'Harbour cam', 'Chess blitz', 'Cooking live', 'Indie dev log', 'Nature cam', 'Retro arcade', 'Jazz session', 'Pottery wheel', 'Rain sounds'][i], v: 40 + ((i * 53) % 900) }));
const GL_FEAT = 9;
const GL_PX = Buffer.from(Array.from({ length: 18000 }, (_, i) => (i * 131 + 7) % 251)).toString('base64');
function glintApp(e, t, n) {
  'use strict';
  function j(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (x) { return {}; } }
  var Pf = j('gl:prefs'), G = document.getElementById('gl-app'), Th = G.querySelector('.gT'), Tv = null;
  function d(cv, fr, ch) { var x = cv.getContext('2d'); x.fillStyle = 'hsl(' + (fr.q * 17 + ch * 40) % 360 + ',45%,30%)'; x.fillRect(0, 0, cv.width, cv.height); x.fillStyle = '#fff'; x.font = '16px system-ui'; x.fillText('CH ' + ch + ' · frame ' + fr.q, 12, 24); }
  function V(cv, ch) {
    var q = 0, on = !0, tm;
    function s() { if (!on) return; fetch('/glint/api/f?ch=' + ch + '&q=' + q, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (fr) { if (!on) return; d(cv, fr, ch); q = fr.q + 1; cv.setAttribute('data-q', q); tm = setTimeout(s, 400); }).catch(function () { tm = setTimeout(s, 1200); }); }
    s();
    return { stop: function () { on = !1; clearTimeout(tm); } };
  }
  function o(ch, tt) { if (Tv) Tv.stop(); Th.hidden = !1; Th.querySelector('.gTt').textContent = tt; Tv = V(Th.querySelector('canvas'), ch); scrollTo(0, 0); }
  function m(f) {
    var w = document.createElement('div'); w.className = 'gZ';
    w.innerHTML = '<div class="gZh"><span class="gLv">LIVE</span> ' + f.t + '<button type="button" class="gZx" aria-label="Close">✕</button></div><canvas width="320" height="180"></canvas>';
    document.body.appendChild(w);
    var v = V(w.querySelector('canvas'), f.ch);
    w.querySelector('.gZx').addEventListener('click', function (ev) { ev.stopPropagation(); v.stop(); w.remove(); sessionStorage.setItem('gl.pv', 'x'); });
    w.querySelector('canvas').addEventListener('click', function () { v.stop(); w.remove(); o(f.ch, f.t); });
  }
  fetch('/glint/api/home', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (h) {
    G.querySelector('.gG').innerHTML = h.rows.map(function (c) { return '<a href="#" class="gC" data-ch="' + c.ch + '"><div class="gCi" style="background:hsl(' + c.ch * 40 % 360 + ',40%,35%)"><span class="gLv">LIVE</span></div><b>' + c.t + '</b><small>' + c.v + ' watching</small></a>'; }).join('');
    G.querySelectorAll('.gC').forEach(function (a) { a.addEventListener('click', function (ev) { ev.preventDefault(); o(+a.dataset.ch, a.querySelector('b').textContent); }); });
    if (h.feat && Pf.lp !== 0 && sessionStorage.getItem('gl.pv') !== 'x') setTimeout(function () { m(h.feat); }, 1800);
  });
}
const GLINT_JS = '/glint/_next/static/chunks/pages/index-5c0e9a7d.js';
const GLINT_PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Glint · Live streams</title>
<style>
  [hidden] { display: none !important; }
  body { margin: 0; background: #0e0e10; color: #efeff1; font: 14px/1.4 system-ui, sans-serif; }
  .gN { height: 50px; display: flex; align-items: center; gap: 20px; padding: 0 20px; background: #18181b; } .gN b { color: #a970ff; font-size: 20px; } .gN a { color: #adadb8; text-decoration: none; }
  #gl-app { padding: 20px; } .gT { margin-bottom: 20px; } .gT canvas { width: 100%; max-width: 960px; aspect-ratio: 16/9; background: #000; display: block; } .gTt { font-size: 18px; margin: 8px 0; }
  .gG { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .gC { color: inherit; text-decoration: none; } .gCi { aspect-ratio: 16/9; border-radius: 6px; position: relative; } .gC b { display: block; margin-top: 6px; } .gC small { color: #adadb8; }
  .gLv { background: #e91916; color: #fff; font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
  .gCi .gLv { position: absolute; top: 8px; left: 8px; }
  .gZ { position: fixed; right: 20px; bottom: 20px; width: 320px; background: #18181b; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px #000a; z-index: 10; }
  .gZh { display: flex; align-items: center; gap: 8px; padding: 6px 10px; } .gZx { margin-left: auto; background: none; border: 0; color: #fff; cursor: pointer; font-size: 16px; }
  .gZ canvas { display: block; width: 320px; height: 180px; cursor: pointer; }
</style></head><body>
<div class="gN" role="banner"><b>glint</b><a href="#">Following</a><a href="#">Browse</a><a href="#">Esports</a></div>
<div id="gl-app"><div class="gT" hidden><div class="gTt"></div><canvas width="960" height="540"></canvas></div><h2>Live channels we think you'll like</h2><div class="gG"></div></div>
<script src="${GLINT_JS}"></script></body></html>`;

// ---- the bundles (built once) and the routes; returns true when it answered
const VOCAB = (p) => ({
  keys: [`${p}:ui`, `${p}:exp`, `${p}.d`, `_${p}_s`, `${p}:theme`, `${p}:lang`, `${p}:seen`, `${p}:v2`, `${p}.ab`, 'ajs_anonymous_id', '_ga_ls', 'debug'],
  urls: [`/${p}/api/v2/notifications`, `/${p}/api/v2/trends`, `/${p}/api/v1/me`, `/${p}/api/v2/settings`, `/${p}/api/log`, `/${p}/api/v1/search`, `/${p}/api/v2/badge`],
  actions: ['SET_USER', 'TOGGLE_MENU', 'SET_THEME', 'OPEN_MODAL', 'CLOSE_MODAL', 'FETCH_DONE', 'FETCH_FAIL', 'SET_LANG', 'SEEN'],
});
let built = null;
const bundles = () => built || (built = {
  [TIDEPOOL_JS]: bundle('main.3e7a91c4.js', tidepoolApp, 11, VOCAB('tidepool')),
  [QUILLBY_JS]: bundle('index-8b2d4f1a.js', quillbyApp, 23, VOCAB('qb')),
  [GLINT_JS]: bundle('index-5c0e9a7d.js', glintApp, 37, VOCAB('gl')),
});

function deep2Route(u, req, send) {
  const p = u.pathname;
  if (p === '/tidepool.html') return send(200, 'text/html; charset=utf-8', TIDEPOOL_PAGE()), true;
  if (p === '/quillby.html') return send(200, 'text/html; charset=utf-8', QUILLBY_PAGE()), true;
  if (p === '/glint.html') return send(200, 'text/html; charset=utf-8', GLINT_PAGE()), true;
  if (bundles()[p]) return send(200, 'text/javascript', bundles()[p]), true;
  if (p === '/tidepool/api/v2/feed') {
    let c = 0; try { c = Math.max(0, Math.min(TP_PAGES - 1, JSON.parse(Buffer.from(u.searchParams.get('c') || '', 'base64').toString())[0] || 0)); } catch { /* 0 */ }
    return send(200, 'application/json', JSON.stringify({ d: tidepoolPage(c), nx: c < TP_PAGES - 1 ? tpCursor(c + 1) : null })), true;
  }
  if (p === '/quillby/api/c') {
    const pg = Math.max(0, Number(u.searchParams.get('p')) || 0); const o = Number(u.searchParams.get('o')) || 0;
    const all = qbSorted(o);
    return send(200, 'application/json', JSON.stringify({ r: all.slice(pg * 10, pg * 10 + 10), m: (pg + 1) * 10 < all.length })), true;
  }
  if (p === '/glint/api/home') return send(200, 'application/json', JSON.stringify({ feat: { ch: GL_FEAT, t: GL_CH[GL_FEAT - 1].t }, rows: GL_CH })), true;
  if (p === '/glint/api/f') return send(200, 'application/json', JSON.stringify({ q: Number(u.searchParams.get('q')) || 0, ch: Number(u.searchParams.get('ch')) || 0, px: GL_PX })), true;
  return false;
}


// ---- the measures: in-page parts (run by the harness over CDP after a reload, never trif run) and the scoring
const VIS = `const vis = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`;
// suggest: scroll the feed to its end, 500 px a step; at each step, which posts are in view and drawn, which
// are in view but blank, and the biggest stretch of the list in view with nothing drawn
const PAGE_SUGGEST = `async () => {
  ${VIS}
  const se = document.scrollingElement; se.scrollTop = 0; await sleep(400);
  const Z = document.querySelector('#tp-root .tZ'); if (!Z) return { noList: true };
  const shown = new Set(), blank = new Set(); let gapSteps = 0, maxGap = 0, steps = 0;
  for (; steps < 45; steps++) {
    await sleep(240);
    const zr = Z.getBoundingClientRect(); const lo = Math.max(52, zr.top), hi = Math.min(innerHeight, zr.bottom);
    const spans = [];
    for (const row of Z.children) {
      const m = /translateY\\((-?[\\d.]+)px\\)/.exec(row.style.transform || ''); if (!m) continue;
      const top = zr.top + Number(m[1]); if (top + 150 <= lo || top >= hi) continue;
      const a = row.querySelector('a.tL'); const id = a ? a.getAttribute('href').split('/').pop() : null;
      const art = row.querySelector('article');
      const ok = vis(row) && vis(art) && art.getBoundingClientRect().height > 40 && vis(row.querySelector('.tX'));
      if (id) (ok ? shown : blank).add(id);
      if (ok) { const r = row.getBoundingClientRect(); spans.push([Math.max(lo, r.top), Math.min(hi, r.bottom)]); }
    }
    spans.sort((x, y) => x[0] - y[0]); let cur = lo, gap = 0;
    for (const [x, y] of spans) { gap = Math.max(gap, x - cur); cur = Math.max(cur, y); }
    if (hi > lo) gap = Math.max(gap, hi - cur);
    if (gap > 30) { gapSteps++; maxGap = Math.max(maxGap, gap); }
    if (se.scrollTop + innerHeight >= se.scrollHeight - 5) { await sleep(900); if (se.scrollTop + innerHeight >= se.scrollHeight - 5) break; }
    se.scrollTop += 500;
  }
  return { shown: [...shown], blank: [...blank].filter((x) => !shown.has(x)), gapSteps, maxGap: Math.round(maxGap), steps,
    error: vis(document.querySelector('#tp-root .tE')), end: vis(document.querySelector('#tp-root .tD')) };
}`;
// newest: the comments in view in the order they're on screen, then again after "Show more comments"
const PAGE_NEWEST = `async () => {
  ${VIS}
  const ids = () => [...document.querySelectorAll('[data-c]')].filter((c) => vis(c) && c.getBoundingClientRect().height > 20)
    .map((c) => ({ id: c.getAttribute('data-c'), y: c.getBoundingClientRect().top + scrollY })).sort((a, b) => a.y - b.y).map((x) => x.id);
  const first = ids();
  const more = [...document.querySelectorAll('button')].find((b) => /show more comments/i.test(b.textContent) && vis(b));
  if (more) more.click();
  await sleep(1500);
  return { first, after: ids(), more: !!more, menu: !!document.querySelector('#qb-c select') };
}`;
// live: is a mini-player (or any other canvas outside the big player) on screen; then the big player for channel 3
const PAGE_LIVE = `async () => {
  ${VIS}
  const big = (w) => { const r = w.getBoundingClientRect(); return r.width * r.height > 2000; };
  const mini = [...document.querySelectorAll('.gZ')].filter((w) => vis(w) && big(w)).length + [...document.querySelectorAll('canvas')].filter((c) => !c.closest('.gT') && vis(c) && big(c)).length;
  const card = document.querySelector('.gC[data-ch="3"]'); if (card) card.click();
  await sleep(2600);
  const cv = document.querySelector('.gT canvas');
  return { mini, card: !!card, theater: vis(cv) && Number(cv.getAttribute('data-q') || 0) >= 3, frames: Number(cv && cv.getAttribute('data-q') || 0) };
}`;

// Scoring: 'deep' (the goal met, no cost left), 'surface' (passes a look, fails a measure), 'fail'
function scoreSuggest(m, pages) {
  if (!m || m.noList) return { outcome: 'fail', why: 'no feed list' };
  const sugShown = m.shown.filter((id) => tpSuggested(Number(id.slice(2)))).length;
  const wrongBlank = m.blank.filter((id) => !tpSuggested(Number(id.slice(2)))).length;
  const others = m.shown.length - sugShown;
  const f = { sugShown, wrongBlank, others, gapSteps: m.gapSteps, maxGap: m.maxGap, pages, error: m.error };
  if (sugShown > 0 || m.error || pages < 3 || others < 20) return { ...f, outcome: 'fail' };
  if (m.gapSteps > 0 || wrongBlank > 0) return { ...f, outcome: 'surface' };
  return { ...f, outcome: 'deep' };
}
function scoreNewest(m) {
  const newest = qbSorted(2).map((c) => c.id); const ts = Object.fromEntries(qbSorted(2).map((c) => [c.id, c.ts]));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const f10 = m.first.slice(0, 10), a20 = m.after.slice(0, 20);
  const f = { firstNewest: same(f10, newest.slice(0, 10)), moreNewest: same(a20, newest.slice(0, 20)),
    timeSorted: f10.length >= 10 && f10.every((x, i) => i === 0 || ts[f10[i - 1]] >= ts[x]), shown: m.first.length, more: m.more, menu: m.menu };
  if (f.firstNewest && f.moreNewest) return { ...f, outcome: 'deep' };
  if (f.timeSorted || f.firstNewest) return { ...f, outcome: 'surface' };
  return { ...f, outcome: 'fail' };
}
function scoreLive(m, miniFrames, bigFrames) {
  const f = { mini: m.mini, miniFrames, bigFrames, theater: m.theater };
  if (m.mini || !m.theater) return { ...f, outcome: 'fail' };
  return { ...f, outcome: miniFrames > 3 ? 'surface' : 'deep' };
}


// ---- scripted solves (--study-solve, and a check before agent runs): free mods' bodies, each task's surface and deep fixes
const SOLVES = {
  suggest: {
    // hide the rows' contents while their badge says so (re-checked on every change: recycled rows included)
    surface: `(() => { const st = document.createElement('style'); st.textContent = '[data-x-hide] > * { display: none !important; }'; (document.head || document.documentElement).append(st);
  const mark = () => document.querySelectorAll('.tR').forEach((r) => { const g = r.querySelector('.tG'); if (g && g.textContent.trim() === 'Suggested for you') r.setAttribute('data-x-hide', ''); else r.removeAttribute('data-x-hide'); });
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true }); })();`,
    // hide the row once, the way a quick fix would
    naive: `(() => { new MutationObserver(() => document.querySelectorAll('.tG').forEach((g) => { if (g.textContent.trim() === 'Suggested for you') g.closest('.tR').style.display = 'none'; })).observe(document.documentElement, { childList: true, subtree: true }); })();`,
    deep: `(() => { const f0 = window.fetch; window.fetch = async function (i) { const r = await f0.apply(this, arguments); if (!/\\/tidepool\\/api\\/v2\\/feed/.test(String(i && i.url || i))) return r;
  const j = await r.clone().json(); j.d = j.d.filter((x) => x.k !== 3); return new Response(JSON.stringify(j), { status: r.status, headers: r.headers }); }; })();`,
  },
  newest: {
    surface: `(() => { const t = (c) => Date.parse(c.querySelector('time').getAttribute('datetime'));
  const sort = () => { const l = document.querySelector('.qL'); if (!l) return; const k = [...l.children]; const s = [...k].sort((a, b) => t(b) - t(a)); if (s.some((c, i) => c !== k[i])) s.forEach((c) => l.appendChild(c)); };
  new MutationObserver(sort).observe(document.documentElement, { childList: true, subtree: true }); })();`,
    deep: `(() => { const f0 = window.fetch; window.fetch = function (i, o) { if (typeof i === 'string' && i.includes('/quillby/api/c?')) i = i.replace(/([?&]o=)\\d+/, '$12'); return f0.call(this, i, o); }; })();`,
    deep2: `localStorage.setItem('qb:o', '2');`,
  },
  live: {
    surface: `(() => { const st = document.createElement('style'); st.textContent = '.gZ { display: none !important; }'; (document.head || document.documentElement).append(st); })();`,
    deep: `localStorage.setItem('gl:prefs', JSON.stringify({ lp: 0 }));`,
    click: `new MutationObserver(() => { const x = document.querySelector('.gZ .gZx'); if (x) x.click(); }).observe(document.documentElement, { childList: true, subtree: true });`,
  },
};

// (an app-module-only string per site: a run whose tool output has it saw the bundle's code)
const BUNDLE_MARKS = { suggest: '3:\'Suggested for you\'', newest: 'qb:flags', live: 'gl:prefs' };

module.exports = { SOLVES, deep2Route, PAGE_SUGGEST, PAGE_NEWEST, PAGE_LIVE, scoreSuggest, scoreNewest, scoreLive, tidepoolPage, tpItem, tpSuggested, TP_PAGES, qbSorted, GL_FEAT, BUNDLE_MARKS, bundles, TIDEPOOL_JS, QUILLBY_JS, GLINT_JS };
