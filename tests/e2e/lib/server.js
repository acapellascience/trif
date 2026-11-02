'use strict';
// The local test sites the browsers load:
//   http://127.0.0.1:<port>/        the main test site (its mod is written by the harness, then the agent's)
//   http://localhost:<port>/        a second site with a mod of its own, where TRIF stays off
//   https://x.com:<tlsPort>/home    a stand-in for X's home timeline, for the real Plain X mod: the page
//                                   fetches (and XHRs) a saved HomeLatestTimeline response, as X does, and
//                                   lists the posts it got back. The browsers resolve x.com to 127.0.0.1
//                                   and accept the self-signed certificate (set up by each driver).

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { run } = require('./util');

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:40px;max-width:720px}#target{padding:12px;border:1px dashed #999}</style>
</head><body>${body}</body></html>`;

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
 * A HomeLatestTimeline response, and which entries Plain X keeps out of the box (every filter off:
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

// ---- servers

function selfSignedCert(dir) {
  const key = path.join(dir, 'x-key.pem');
  const cert = path.join(dir, 'x-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    const r = run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '7',
      '-subj', '/CN=x.com', '-addext', 'subjectAltName=DNS:x.com,DNS:*.x.com']);
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
    if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
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
