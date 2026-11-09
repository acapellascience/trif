'use strict';
// A stand-in for X's Home timeline, rich enough to measure X-Flyer on: tests/e2e/lib/server.js's X page is a
// list of entry ids (enough for Detox Timeline's filter), and the game needs what it blasts, chases and
// recolours. This one is built the way X builds its page:
// - React Native Web's markup: nested <div class="css-175oi2r r-…"> Views and <span class="css-1jxf684"> Texts,
//   every style an atomic class inserted into <style id="react-native-stylesheet"> with insertRule as it's
//   first used (so the sheet grows as new kinds of things render, as X's does), plus X's inline colours.
//   Light mode (data-theme="light"), so X-Flyer's theme translator (the xlate stylesheet) is at work, as it
//   is for Tim (?theme=dark to have it idle).
// - The left nav (header[role=banner]), the main column (data-testid=primaryColumn) with its sticky tabs and
//   composer, and the sidebar (data-testid=sidebarColumn: search, Premium, trends, who to follow, footer).
// - The timeline as X's virtualised list: absolutely placed cellInnerDiv rows (transform: translateY(Npx)),
//   only those near the window in the page (about a window above and one and a half below), rows added and
//   removed as you scroll, the next page fetched near the end. Its data is a HomeLatestTimeline (UserTweets
//   on other paths) GraphQL response fetched by the page, so Detox Timeline filters it as on X.
// - Posts: author picture (a real JPEG, as X's: a background-image div plus a hidden <img>), name, @handle,
//   time, text (with links and hashtags), photos, quoted posts, link cards, reposts, the action bar's six
//   icons; React's fiber on each article and picture (__reactFiber$…: memoizedProps.tweet.user with
//   followers_count, following, followed_by), which X-Flyer and Follow status read. About 200 elements a post.
// - @elonmusk: post 25 by default; ?elon=N makes every Nth post his (for the boss).
// Paths: /home (Home: X-Flyer's upside-down Timeline mode), any other path (/perf_profile): the same feed,
// the right way up. Nothing real is used: names, text and pictures are generated (seeded, the same every run).
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { run } = require('../../e2e/lib/util');

// ---- seeded randomness (mulberry32)
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- pictures: real JPEGs (smooth shapes plus grain, so they compress like photos), made once with sips
function bmp(w, h, px) { // px(x, y) → [r, g, b]
  const row = Math.ceil((w * 3) / 4) * 4, buf = Buffer.alloc(54 + row * h);
  buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, h - 1 - y), o = 54 + y * row + x * 3;
    buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
  }
  return buf;
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function picture(kind, i, w, h) {
  const R = rng(1000 * (kind.length) + i * 7919), hue = R() * 360, hue2 = (hue + 60 + R() * 180) % 360;
  const hsl = (H, S, L) => { const a = S * Math.min(L, 1 - L), f = (n) => { const k = (n + H / 30) % 12; return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; };
  const blobs = Array.from({ length: 5 }, () => ({ x: R() * w, y: R() * h, r: (0.15 + R() * 0.35) * Math.max(w, h), c: hsl((hue + R() * 120) % 360, 0.6, 0.35 + R() * 0.4) }));
  const g = rng(i + 77);
  return bmp(w, h, (x, y) => {
    let c = hsl(((hue + (hue2 - hue) * (y / h)) + 360) % 360, 0.45, 0.25 + 0.4 * (x / w));
    for (const b of blobs) { const d = Math.hypot(x - b.x, y - b.y) / b.r; if (d < 1) { const k = (1 - d) ** 2; c = c.map((v, j) => v * (1 - k) + b.c[j] * k); } }
    const n = (g() - 0.5) * 18;
    return [clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n)];
  });
}
const N_AVATARS = 16, N_PHOTOS = 10, N_CARDS = 4;
function makePictures(dir) {
  const out = path.join(dir, 'img');
  const want = [['av', N_AVATARS + 1, 400, 400], ['ph', N_PHOTOS, 1200, 675], ['card', N_CARDS, 1200, 628]];
  for (const [kind, n, w, h] of want) for (let i = 0; i < n; i++) {
    const file = path.join(out, `${kind}${i}.jpg`);
    if (fs.existsSync(file)) continue;
    fs.mkdirSync(out, { recursive: true });
    const tmp = path.join(out, `${kind}${i}.bmp`);
    fs.writeFileSync(tmp, picture(kind, i, w, h));
    const r = run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', tmp, '--out', file]);
    fs.rmSync(tmp, { force: true });
    if (r.status !== 0) throw new Error(`sips failed: ${r.stderr}`);
  }
  return out;
}

// ---- the timeline data (X's GraphQL shape, what Detox Timeline and the page read)
const WORDS = ('the a to of and in is it you that for on this with be are was just have not but so at my all what like ' +
  'one can about out up if do we time new people now more get when think good really know make day year today ' +
  'going see because want work would how still first back even way much never always thing great things show ' +
  'world music build shipped open source browser timeline launch update video photo game night morning ' +
  'week team release finally everyone thanks love coffee code design science space rocket choir song').split(' ');
const HANDLES = ['ada_l', 'grace_h', 'linus_t', 'mkbhd_fan', 'nasa_watch', 'tim_cook_fan', 'jsconf', 'chromium_dev',
  'sci_bytes', 'acapella_news', 'mozilla_folks', 'webkit_notes', 'astro_kate', 'design_daily', 'retro_games', 'synth_pop',
  'coffee_cat', 'bike_lane', 'cityplanner', 'night_owl', 'pixel_art', 'bookworm', 'jazz_hands', 'trailrunner'];
function userFor(R, i, handle) {
  const big = R();
  const followers = handle === 'elonmusk' ? 219000000 : Math.round(10 ** (1.5 + big * 5.2)); // 30 to 5M
  const following = R() < 0.8, followedBy = R() < 0.55;
  return { rest_id: String(5000 + i), handle, name: handle.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    followers, following, followedBy, av: handle === 'elonmusk' ? N_AVATARS : i % N_AVATARS, verified: R() < 0.3 };
}
function sentence(R, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let w = WORDS[Math.floor(R() * WORDS.length)];
    if (i === 0) w = w[0].toUpperCase() + w.slice(1);
    out.push(w);
  }
  return out.join(' ') + (R() < 0.2 ? '!' : R() < 0.15 ? '?' : '.');
}
function postText(R) {
  const n = 1 + Math.floor(R() * 4), parts = [];
  for (let i = 0; i < n; i++) parts.push(sentence(R, 4 + Math.floor(R() * 14)));
  if (R() < 0.25) parts.push(`#${WORDS[Math.floor(R() * WORDS.length)]}${WORDS[Math.floor(R() * WORDS.length)]}`);
  if (R() < 0.15) parts.push(`@${HANDLES[Math.floor(R() * HANDLES.length)]}`);
  if (R() < 0.08) parts.push('🚀✨');
  return parts.join(' ').slice(0, 280);
}
function userResult(u) {
  return { __typename: 'User', rest_id: u.rest_id, is_blue_verified: u.verified,
    core: { screen_name: u.handle, name: u.name },
    relationship_perspectives: { following: u.following, followed_by: u.followedBy },
    legacy: { screen_name: u.handle, name: u.name, followers_count: u.followers, following: u.following, followed_by: u.followedBy,
      profile_image_url_https: `/img/av${u.av}.jpg` } };
}
function tweetResult(R, id, u, opts = {}) {
  const text = postText(R);
  const legacy = { id_str: id, full_text: text, display_text_range: [0, text.length], user_id_str: u.rest_id,
    favorite_count: Math.floor(R() * 5000), retweet_count: Math.floor(R() * 800), reply_count: Math.floor(R() * 300),
    created_at: 'Mon Nov 09 12:00:00 +0000 2026', entities: { urls: [], hashtags: [] } };
  const t = { __typename: 'Tweet', rest_id: id, core: { user_results: { result: userResult(u) } }, legacy, views: { count: String(Math.floor(R() * 900000)) } };
  if (opts.photo) legacy.extended_entities = { media: [{ type: 'photo', media_url_https: `/img/ph${opts.photo - 1}.jpg`, original_info: { width: 1200, height: 675 } }] };
  if (opts.card) {
    legacy.entities.urls.push({ expanded_url: 'https://example.com/story', display_url: 'example.com/story' });
    t.card = { legacy: { name: 'summary_large_image', binding_values: [{ key: 'title', value: { string_value: sentence(R, 7) } }, { key: 'thumbnail', value: { image_value: { url: `/img/card${opts.card - 1}.jpg` } } }] } };
  }
  if (opts.quote) { legacy.is_quote_status = true; t.quoted_status_result = { result: opts.quote }; }
  return t;
}
/** One page of the timeline: {body (the GraphQL response), count}. */
function timelinePage({ page = 0, size = 60, elonEvery = 0, seed = 1 } = {}) {
  const R = rng(seed * 1009 + page * 31);
  const entries = [{ entryId: `cursor-top-${page}`, content: { entryType: 'TimelineTimelineCursor', value: `top${page}`, cursorType: 'Top' } }];
  for (let k = 0; k < size; k++) {
    const i = page * size + k, id = String(1900000000000000000n + BigInt(i));
    const elon = elonEvery ? i % elonEvery === elonEvery - 1 : i === 24;
    const handle = elon ? 'elonmusk' : HANDLES[Math.floor(R() * HANDLES.length)];
    const u = userFor(rng(HANDLES.indexOf(handle) + 3), HANDLES.indexOf(handle) + 1, handle);
    const r = R(), opts = {};
    if (r < 0.26) opts.photo = 1 + Math.floor(R() * N_PHOTOS);
    else if (r < 0.34) { const qh = HANDLES[Math.floor(R() * HANDLES.length)]; opts.quote = tweetResult(R, `q${id}`, userFor(rng(HANDLES.indexOf(qh) + 3), HANDLES.indexOf(qh) + 1, qh), R() < 0.5 ? { photo: 1 + Math.floor(R() * N_PHOTOS) } : {}); }
    else if (r < 0.41) opts.card = 1 + Math.floor(R() * N_CARDS);
    let result = tweetResult(R, id, u, opts);
    if (r > 0.95) { // a repost: someone you follow reposted it
      const by = HANDLES[Math.floor(R() * HANDLES.length)], bu = userFor(rng(HANDLES.indexOf(by) + 3), HANDLES.indexOf(by) + 1, by);
      result = { __typename: 'Tweet', rest_id: `rt${id}`, core: { user_results: { result: userResult(bu) } }, legacy: { full_text: `RT @${handle}`, user_id_str: bu.rest_id, retweeted_status_result: { result } } };
    }
    entries.push({ entryId: `tweet-${id}`, sortIndex: id, content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem',
      itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result } } } });
    if (k === 9) entries.push({ entryId: `promoted-tweet-${id}-x`, content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: { advertiser_results: {} }, tweet_results: { result: tweetResult(R, `ad${id}`, userFor(R, 99, 'brand_co'), { photo: 1 }) } } } });
  }
  entries.push({ entryId: `cursor-bottom-${page}`, content: { entryType: 'TimelineTimelineCursor', value: `page:${page + 1}`, cursorType: 'Bottom' } });
  return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } }, user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } } };
}

// ---- the page
const SHELL = (theme) => `<!DOCTYPE html>
<html dir="ltr" lang="en" style="overflow-y: scroll; overscroll-behavior-y: none; font-size: 15px; color-scheme: ${theme};">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=0,viewport-fit=cover">
<title>Home / X</title>
<style>html{min-height:100%}body{min-height:100%}html{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:rgba(0,0,0,0)}body{margin:0}button::-moz-focus-inner,input::-moz-focus-inner{border:0;padding:0}input::-webkit-search-cancel-button,input::-webkit-search-decoration{display:none}</style>
<style id="react-native-stylesheet"></style>
<script src="/app.js" defer></script>
</head>
<body style="background-color: ${theme === 'dark' ? '#000000' : '#FFFFFF'};"><noscript>JavaScript is needed.</noscript>
<div id="react-root" style="min-height:100vh;display:flex;"><div id="placeholder" style="position:fixed;inset:0;background:inherit"><svg viewBox="0 0 24 24" style="width:72px;margin:auto;display:block;padding-top:40vh"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg></div></div>
<div style="position:absolute;visibility:hidden;width:0;height:0;overflow:hidden" aria-hidden="true"><div id="x-sig-1" style="color:rgb(1,2,3);transform:rotate(3deg)">x</div></div>
</body></html>`;

// The page's own code (X's app, cut down): runs in the page, serialised from this function.
function APP() {
  const Q = new URLSearchParams(location.search);
  const theme = Q.get('theme') || 'light', DARK = theme === 'dark';
  document.cookie = 'twid=u%3D999; path=/';
  document.cookie = `night_mode=${DARK ? 2 : 0}; path=/`;
  const HOME = location.pathname === '/home';
  // palette: X's light mode, or Lights out
  const P = DARK
    ? { text: 'rgba(231,233,234,1.00)', sub: 'rgba(113,118,123,1.00)', bg: 'rgba(0,0,0,1.00)', line: 'rgb(47,51,54)', hover: 'rgba(231,233,234,0.1)', card: 'rgba(22,24,28,1.00)', inv: 'rgba(239,243,244,1.00)', invText: 'rgba(15,20,25,1.00)', inlineText: 'rgb(231, 233, 234)', inlineSub: 'rgb(113, 118, 123)' }
    : { text: 'rgba(15,20,25,1.00)', sub: 'rgba(83,100,113,1.00)', bg: 'rgba(255,255,255,1.00)', line: 'rgb(239,243,244)', hover: 'rgba(15,20,25,0.1)', card: 'rgba(247,249,249,1.00)', inv: 'rgba(15,20,25,1.00)', invText: 'rgba(255,255,255,1.00)', inlineText: 'rgb(15, 20, 25)', inlineSub: 'rgb(83, 100, 113)' };
  const BLUE = 'rgba(29,155,240,1.00)';

  // React Native Web's atomic classes: one rule per declaration, inserted when first used
  const sheet = document.getElementById('react-native-stylesheet').sheet;
  const reg = new Map();
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36).slice(0, 7); };
  const rule = (text) => { try { sheet.insertRule(text, sheet.cssRules.length); } catch {} };
  rule('.css-175oi2r{align-items:stretch;background-color:rgba(0,0,0,0.00);border:0 solid black;box-sizing:border-box;display:flex;flex-basis:auto;flex-direction:column;flex-shrink:0;list-style:none;margin:0px;min-height:0px;min-width:0px;padding:0px;position:relative;text-decoration:none;z-index:0}');
  rule(`.css-1jxf684{background-color:rgba(0,0,0,0.00);border:0 solid black;box-sizing:border-box;color:rgba(0,0,0,1.00);display:inline;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;list-style:none;margin:0px;padding:0px;position:relative;text-align:inherit;text-decoration:none;white-space:inherit;word-wrap:break-word}`);
  rule(`.css-146c3p1{background-color:rgba(0,0,0,0.00);border:0 solid black;box-sizing:border-box;color:rgba(0,0,0,1.00);display:inline;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;list-style:none;margin:0px;padding:0px;position:relative;text-align:start;text-decoration:none;white-space:pre-wrap;word-wrap:break-word}`);
  rule('.css-9pa8cd{inset:0px;height:100%;opacity:0;position:absolute;width:100%;z-index:-1}');
  rule('.css-175oi2r:focus-visible{outline:2px solid rgba(29,155,240,1.00)}');
  const C = (decls) => decls.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    let c = reg.get(d);
    if (!c) { c = `r-${hash(d)}`; reg.set(d, c); rule(`.${c}{${d}}`); }
    return c;
  }).join(' ');
  // (X's sheet is big from the start: what its first screens and their menus use)
  { const R = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const props = ['padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'margin-left', 'margin-top', 'margin-bottom', 'gap', 'min-height', 'max-width', 'width', 'height', 'border-radius', 'font-size', 'line-height', 'flex-grow', 'flex-basis', 'z-index', 'top', 'left', 'right', 'bottom'];
    const cols = DARK ? ['rgba(231,233,234,1.00)', 'rgba(113,118,123,1.00)', 'rgba(22,24,28,1.00)', 'rgba(47,51,54,1.00)', 'rgba(32,35,39,1.00)', 'rgba(0,0,0,1.00)'] : ['rgba(15,20,25,1.00)', 'rgba(83,100,113,1.00)', 'rgba(247,249,249,1.00)', 'rgba(239,243,244,1.00)', 'rgba(207,217,222,1.00)', 'rgba(255,255,255,1.00)', 'rgba(15,20,25,0.10)', 'rgba(83,100,113,0.10)'];
    for (let i = 0; i < 1300; i++) {
      if (i % 5 === 0) C(`${['color', 'background-color', 'border-bottom-color', 'border-top-color', 'border-left-color', 'border-right-color'][i % 6]}:${cols[Math.floor(R() * cols.length)]}`);
      else C(`${props[Math.floor(R() * props.length)]}:${Math.floor(R() * 400)}px`);
    }
    for (const bp of [500, 688, 988, 1078, 1265]) rule(`@media (min-width:${bp}px){.r-bp${bp}{width:${bp - 200}px}}`);
  }
  const V = 'css-175oi2r', T = 'css-1jxf684', TD = 'css-146c3p1';
  const TEXT = C(`color:${P.text}`), SUB = C(`color:${P.sub}`);
  const FONT15 = C('font-family:"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;overflow-wrap:break-word;min-width:0px');
  const BOLD = C('font-weight:700'), ROW = C('flex-direction:row'), WRAP = C('flex-wrap:wrap'), GROW = C('flex-grow:1'), SHRINK = C('flex-shrink:1');
  const CENTER = C('align-items:center'), JSB = C('justify-content:space-between');
  // a tiny React.createElement
  const h = (tag, a, ...kids) => {
    const svg = tag === 'svg' || tag === 'g' || tag === 'path' || tag === 'circle';
    const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    for (const k in a || {}) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'fiber') el[`__reactFiber$perf${FIBER}`] = v;
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const FIBER = Math.random().toString(36).slice(2, 9);
  const v = (cls, ...kids) => h('div', { class: `${V} ${cls || ''}`.trim() }, ...kids);
  // (X wraps most parts of a post in two or three more Views than they need: as deep as X's markup)
  const deep = (n, el) => { for (let i = 0; i < n; i++) el = v(i % 2 ? C('flex-shrink:1') : '', el); return el; };
  const txt = (cls, s, style) => h('span', { class: `${T} ${cls || ''}`.trim(), style }, s);
  const ICONS = ['M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z',
    'M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z',
    'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z',
    'M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z',
    'M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z',
    'M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z'];
  const icon = (d, cls) => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `${cls || C('height:1.25em;fill:currentcolor;max-width:100%;position:relative;user-select:none;vertical-align:text-bottom')}` }, h('g', null, h('path', { d })));
  const VERIFIED = 'M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z';

  // a picture, as X draws one: a background-image div, and an <img> under it (hidden) for saving and alt text
  const pic = (src, size, round = true) => v(`${C('overflow:hidden')} ${round ? C('border-radius:9999px') : ''}`.trim(),
    h('div', { class: C('padding-bottom:100%;width:100%') }),
    v(C('position:absolute;inset:0px'),
      v(C('background-size:cover;background-position:center center;background-repeat:no-repeat;position:absolute;inset:0px;height:100%;width:100%'), null),
      h('img', { alt: '', draggable: 'true', src, class: 'css-9pa8cd' })));
  const setBg = (el, src) => { const d = el.querySelector(`.${C('background-size:cover;background-position:center center;background-repeat:no-repeat;position:absolute;inset:0px;height:100%;width:100%').split(' ')[0]}`); if (d) d.style.backgroundImage = `url("${src}")`; };
  const avatar = (u, size, tweet) => {
    const src = u.legacy.profile_image_url_https;
    const box = h('div', { class: `${V} ${C(`width:${size}px;height:${size}px`)}`, 'data-testid': `UserAvatar-Container-${u.legacy.screen_name}`, style: `width:${size}px;height:${size}px` },
      h('a', { href: `/${u.legacy.screen_name}`, role: 'link', tabindex: '-1', class: `${V} ${C('cursor:pointer')}` }, pic(src, size)));
    setBg(box, src);
    return h('div', { class: V, 'data-testid': 'Tweet-User-Avatar', fiber: { memoizedProps: { tweet: { user: { ...u.legacy } } }, return: null } }, box);
  };
  const nameLine = (u, time) => h('div', { class: `${V} ${ROW} ${WRAP} ${SHRINK}`, 'data-testid': 'User-Name' },
    v(`${ROW} ${CENTER}`, h('a', { href: `/${u.legacy.screen_name}`, role: 'link', class: `${V} ${C('text-decoration-line:none')}` },
      v(`${ROW} ${CENTER}`, h('div', { dir: 'ltr', class: `${TD} ${FONT15} ${BOLD} ${TEXT}`, style: `color: ${P.inlineText};` }, txt(C('text-overflow:ellipsis;overflow:hidden;white-space:nowrap'), u.legacy.name)),
        u.is_blue_verified ? h('div', { dir: 'ltr', class: `${TD} ${C('margin-left:2px')}` }, icon(VERIFIED, C(`fill:${BLUE};height:1.25em;vertical-align:text-bottom`))) : null))),
    v(`${ROW} ${C('margin-left:4px')}`,
      h('a', { href: `/${u.legacy.screen_name}`, role: 'link', class: `${V} ${C('text-decoration-line:none')}` }, h('div', { dir: 'ltr', class: `${TD} ${FONT15} ${SUB}`, style: `color: ${P.inlineSub};` }, txt('', `@${u.legacy.screen_name}`))),
      h('div', { dir: 'ltr', class: `${TD} ${FONT15} ${SUB} ${C('padding-left:4px;padding-right:4px')}` }, txt('', '·')),
      h('a', { href: '#', role: 'link', class: `${V} ${SUB}` }, h('time', { datetime: '2026-11-09T12:00:00.000Z', class: `${FONT15} ${SUB}` }, time))));
  const tweetText = (t) => {
    const parts = t.split(/(#\w+|@\w+)/).map((s) => (/^[#@]\w+/.test(s)
      ? h('a', { href: `/${s.slice(1)}`, role: 'link', class: `${T} ${C(`color:${BLUE}`)}` }, s) : s ? txt('', s) : null));
    return h('div', { dir: 'auto', lang: 'en', class: `${TD} ${FONT15} ${TEXT} ${C('margin-top:2px')}`, style: `color: ${P.inlineText}; text-overflow: unset;`, 'data-testid': 'tweetText' }, ...parts);
  };
  const actions = (l) => h('div', { 'aria-label': `${l.reply_count} replies, ${l.retweet_count} reposts, ${l.favorite_count} likes`, role: 'group', class: `${V} ${ROW} ${JSB} ${C('margin-top:12px;max-width:600px')}` },
    ...[['reply', l.reply_count], ['retweet', l.retweet_count], ['like', l.favorite_count], ['views', 9999], ['bookmark', null], ['share', null]].map(([id, n], i) =>
      v(`${ROW} ${C('flex-grow:1;flex-basis:0')}`, h('button', { 'aria-label': id, role: 'button', 'data-testid': id, type: 'button', class: `${V} ${C('background:none;border:0;cursor:pointer;padding:0')}` },
        v(`${ROW} ${CENTER} ${SUB}`, v(C('display:inline-flex'), icon(ICONS[i])),
          n == null ? null : v(C('padding-left:4px'), h('span', { class: `${T} ${C('font-size:13px;line-height:16px')} ${SUB}` }, txt('', n > 999 ? `${(n / 1000).toFixed(1)}K` : String(n)))))))));
  const media = (m) => v(C('margin-top:12px'), v(`${C(`border:1px solid ${P.line};border-radius:16px;overflow:hidden`)}`,
    h('a', { href: '#', role: 'link', class: V }, h('div', { class: V, 'data-testid': 'tweetPhoto', 'aria-label': 'Image' },
      (() => { const el = pic(m.media_url_https, 0, false); el.firstChild.style.paddingBottom = '56.25%'; setBg(el, m.media_url_https); return el; })()))));
  const card = (c) => {
    const title = c.legacy.binding_values.find((b) => b.key === 'title').value.string_value, img = c.legacy.binding_values.find((b) => b.key === 'thumbnail').value.image_value.url;
    const p = pic(img, 0, false); p.firstChild.style.paddingBottom = '52.33%'; setBg(p, img);
    return v(C('margin-top:12px'), h('div', { class: `${V} ${C(`border:1px solid ${P.line};border-radius:16px;overflow:hidden`)}`, 'data-testid': 'card.wrapper' },
      h('a', { href: 'https://example.com/story', role: 'link', class: V }, p, v(C('position:absolute;left:12px;bottom:12px;background-color:rgba(0,0,0,0.77);border-radius:4px;padding:0 4px'), txt(C('color:rgba(255,255,255,1.00);font-size:13px'), title)))),
      v(C('margin-top:2px'), txt(`${SUB} ${C('font-size:13px')}`, 'From example.com')));
  };
  const quote = (q) => {
    const u = q.core.user_results.result;
    return v(C('margin-top:12px'), h('div', { role: 'link', tabindex: '0', class: `${V} ${C(`border:1px solid ${P.line};border-radius:16px;overflow:hidden;cursor:pointer`)}` },
      v(C('padding:12px'), v(`${ROW} ${CENTER}`, v(C('margin-right:4px'), avatar(u, 20, q)), nameLine(u, '5h')),
        tweetText(q.legacy.full_text)),
      q.legacy.extended_entities ? media(q.legacy.extended_entities.media[0]) : null));
  };
  // one row of the list (cellInnerDiv), X's markup for a post
  const post = (entry) => {
    let t = entry.content.itemContent.tweet_results.result, social = null;
    if (t.legacy.retweeted_status_result) {
      social = v(`${ROW} ${C('padding-bottom:2px;margin-left:24px')}`, h('span', { class: `${T} ${SUB} ${C('font-size:13px;font-weight:700')}`, 'data-testid': 'socialContext' }, `${t.core.user_results.result.legacy.name} reposted`));
      t = t.legacy.retweeted_status_result.result;
    }
    const u = t.core.user_results.result, l = t.legacy;
    const fiber = { memoizedProps: { tweet: { ...t, user: { ...u.legacy } } }, return: null };
    return h('div', { 'data-testid': 'cellInnerDiv', style: 'transform: translateY(0px); position: absolute; width: 100%;' },
      v(C(`border-bottom:1px solid ${P.line}`), v('', h('article', { 'aria-labelledby': `id__${t.rest_id}`, role: 'article', tabindex: '0', 'data-testid': 'tweet', class: `${V} ${C('padding-left:16px;padding-right:16px;cursor:pointer;outline-style:none')}`, fiber },
        v(C('flex-grow:1;flex-basis:auto'), v(`${C('padding-top:12px')}`, social),
          v(`${ROW}`,
            v(C('margin-right:8px;flex-basis:40px;flex-grow:0;align-items:center'), avatar(u, 40, t)),
            v(`${GROW} ${C('flex-basis:0px;padding-bottom:12px')}`,
              deep(3, v(`${ROW} ${JSB}`, deep(2, nameLine(u, `${1 + (Number(t.rest_id.slice(-2)) % 23)}h`)),
                deep(2, h('button', { 'aria-label': 'More', 'data-testid': 'caret', type: 'button', class: `${V} ${C('background:none;border:0')}` }, v(SUB, icon('M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z')))))),
              deep(3, tweetText(l.full_text)),
              l.extended_entities ? deep(3, media(l.extended_entities.media[0])) : null,
              t.card ? deep(2, card(t.card)) : null,
              t.quoted_status_result ? deep(2, quote(t.quoted_status_result.result)) : null,
              deep(3, actions(l)))))))));
  };

  // ---- the app's frame: nav, main column, sidebar
  const navItem = (label, d, href) => h('a', { href, role: 'link', 'aria-label': label, 'data-testid': `AppTabBar_${label}_Link`, class: `${V} ${C('padding:4px 0;text-decoration:none')}` },
    v(`${ROW} ${CENTER} ${C('padding:12px;border-radius:9999px')}`, v(TEXT, icon(d, C('height:1.75rem;fill:currentcolor'))),
      h('div', { dir: 'ltr', class: `${TD} ${C('font-size:20px;line-height:24px;margin-left:20px;margin-right:16px')} ${TEXT}`, style: `color: ${P.inlineText};` }, txt('', label))));
  const header = () => h('header', { role: 'banner', class: `${V} ${C('flex-grow:1;align-items:flex-end;z-index:3')}` }, v(C('width:275px;height:100vh'),
    v(C('width:275px;height:100vh;position:fixed;top:0px;padding:0 8px;box-sizing:border-box'),
      h('h1', { role: 'heading', class: C('margin:0') }, h('a', { href: '/home', 'aria-label': 'X', role: 'link', class: `${V} ${C('padding:12px')}` }, v(TEXT, icon('M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z', C('height:2rem;fill:currentcolor'))))),
      h('nav', { 'aria-label': 'Primary', role: 'navigation', class: V },
        ...['Home', 'Explore', 'Notifications', 'Messages', 'Grok', 'Lists', 'Bookmarks', 'Communities', 'Premium', 'Profile', 'More'].map((l, i) => navItem(l, ICONS[i % ICONS.length], `/${l.toLowerCase()}`))),
      v(C('margin:16px 0;width:90%'), h('a', { href: '/compose/post', role: 'link', 'data-testid': 'SideNav_NewTweet_Button', class: `${V} ${C(`background-color:${P.inv};border-radius:9999px;min-height:52px;align-items:center;justify-content:center`)}` },
        h('span', { class: `${T} ${C(`color:${P.invText};font-size:17px;font-weight:700`)}` }, 'Post'))),
      v(C('margin-top:auto;margin-bottom:12px'), h('button', { 'data-testid': 'SideNav_AccountSwitcher_Button', type: 'button', class: `${V} ${ROW} ${CENTER} ${C('background:none;border:0;padding:12px')}` },
        h('div', { class: V, 'data-testid': 'UserAvatar-Container-perf_me', style: 'width:40px;height:40px' }, pic('/img/av3.jpg', 40)),
        v(C('margin-left:12px'), txt(`${TEXT} ${BOLD}`, 'Perf Me'), txt(SUB, '@perf_me')))))));
  const trend = (i) => v(C('padding:12px 16px'), txt(`${SUB} ${C('font-size:13px')}`, `Trending in Canada · ${i + 1}`), txt(`${TEXT} ${BOLD}`, `#${['WebMods', 'Choir', 'SpaceX', 'Science', 'Music', 'Chrome', 'Montreal', 'Rocket', 'Coffee', 'Pixel'][i]}`), txt(`${SUB} ${C('font-size:13px')}`, `${(i + 2) * 3.1}K posts`));
  const sidebar = () => h('div', { class: `${V} ${C('width:350px;margin-right:10px;margin-left:30px')}`, 'data-testid': 'sidebarColumn' },
    v(C('position:sticky;top:0px;gap:16px;padding-top:12px'),
      h('form', { role: 'search', class: V }, h('input', { 'aria-label': 'Search query', placeholder: 'Search', 'data-testid': 'SearchBox_Search_Input', class: C(`border-radius:9999px;border:1px solid ${P.line};padding:12px 40px;background-color:${P.card}`) })),
      v(C(`border:1px solid ${P.line};border-radius:16px;padding:12px 16px`), txt(`${TEXT} ${C('font-size:20px;font-weight:800')}`, 'Subscribe to Premium'), txt(TEXT, 'Subscribe to unlock new features.'),
        h('button', { type: 'button', class: C(`background-color:${BLUE};color:white;border:0;border-radius:9999px;padding:8px 16px;font-weight:700;align-self:flex-start;margin-top:8px`) }, 'Subscribe')),
      h('section', { 'aria-label': 'Timeline: Trending now', role: 'region', class: `${V} ${C(`border:1px solid ${P.line};border-radius:16px`)}` },
        h('h2', { class: C('margin:12px 16px;font-size:20px') }, txt(TEXT, "What's happening")), ...Array.from({ length: 10 }, (_, i) => trend(i))),
      h('aside', { 'aria-label': 'Who to follow', role: 'complementary', class: `${V} ${C(`border:1px solid ${P.line};border-radius:16px`)}` },
        h('h2', { class: C('margin:12px 16px;font-size:20px') }, txt(TEXT, 'Who to follow')),
        ...[5, 8, 11].map((i) => v(`${ROW} ${CENTER} ${C('padding:12px 16px;gap:8px')}`, h('div', { class: V, 'data-testid': `UserAvatar-Container-wtf${i}`, style: 'width:40px;height:40px' }, pic(`/img/av${i}.jpg`, 40)),
          v(GROW, txt(`${TEXT} ${BOLD}`, `Suggested ${i}`), txt(SUB, `@suggested${i}`)),
          h('button', { type: 'button', 'data-testid': `${5000 + i}-follow`, class: C(`background-color:${P.inv};color:${P.invText};border:0;border-radius:9999px;padding:6px 16px;font-weight:700`) }, txt(C(`color:${P.invText}`), 'Follow'))))),
      h('nav', { 'aria-label': 'Footer', role: 'navigation', class: `${V} ${ROW} ${WRAP} ${C('padding:0 16px;gap:4px 12px')}` },
        ...['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Ads info', 'More', '© 2026 X Corp.'].map((s) => h('a', { href: '#', role: 'link', class: `${T} ${SUB} ${C('font-size:13px')}` }, s)))));
  const tabs = () => v(C(`position:sticky;top:0px;z-index:3;backdrop-filter:blur(12px);background-color:${DARK ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)'};border-bottom:1px solid ${P.line}`),
    h('div', { role: 'tablist', 'data-testid': 'ScrollSnap-List', class: `${V} ${ROW}` }, ...['For you', 'Following'].map((s, i) => h('div', { role: 'presentation', class: `${V} ${GROW} ${CENTER}` },
      h('a', { href: '/home', role: 'tab', 'aria-selected': String(i === 1), class: `${V} ${C('padding:16px 0')}` }, txt(`${i === 1 ? TEXT : SUB} ${BOLD}`, s))))));
  const composer = () => v(`${ROW} ${C(`padding:12px 16px;border-bottom:1px solid ${P.line};gap:8px`)}`, h('div', { class: V, style: 'width:40px;height:40px' }, pic('/img/av3.jpg', 40)),
    v(GROW, h('div', { role: 'textbox', 'aria-label': 'Post text', 'data-testid': 'tweetTextarea_0', class: C('font-size:20px;padding:12px 0;min-height:24px') }, txt(SUB, "What's happening?")),
      v(`${ROW} ${JSB} ${CENTER}`, v(`${ROW} ${C('gap:8px')}`, ...ICONS.slice(0, 5).map((d) => v(C(`color:${BLUE}`), icon(d)))), h('button', { type: 'button', 'data-testid': 'tweetButtonInline', class: C(`background-color:${BLUE};opacity:0.5;color:white;border:0;border-radius:9999px;padding:8px 16px;font-weight:700`) }, 'Post'))));

  // ---- the virtualised list
  const list = h('div', { class: C('position:relative'), style: 'position: relative; min-height: 0px;' });
  const posts = [], heights = [], rendered = new Map(), EST = 360;
  const ALL = Q.get('rows') === 'all'; // (every row in the page, none recycled: a heavier page than X's)
  let tops = [], total = 0, cursor = null, loading = false;
  const relayout = () => { let y = 0; tops = posts.map((_, i) => { const t = y; y += heights[i] || EST; return t; }); total = y; list.style.minHeight = `${total}px`; };
  const place = (i, cell) => { const tr = `translateY(${tops[i]}px)`; if (cell.style.transform !== tr) cell.style.transform = tr; };
  let pending = 0;
  const update = () => {
    pending = 0;
    const r = list.getBoundingClientRect(), from = ALL ? -Infinity : -r.top - innerHeight * 1.0, to = ALL ? Infinity : -r.top + innerHeight * 2;
    // (new rows are measured as they go in, which moves the ones after them: again until nothing changes)
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < posts.length; i++) {
        const vis = tops[i] < to && tops[i] + (heights[i] || EST) > from, cell = rendered.get(i);
        if (vis && !cell) {
          const c = post(posts[i]);
          rendered.set(i, c); list.append(c);
          const ht = c.offsetHeight;
          if (ht && ht !== heights[i]) { heights[i] = ht; changed = true; }
        } else if (!vis && cell) { cell.remove(); rendered.delete(i); }
      }
      if (!changed) break;
      relayout();
    }
    for (const [i, c] of rendered) place(i, c);
    if (to > total - innerHeight && !loading && cursor) load(cursor);
  };
  const schedule = () => { if (!pending) pending = requestAnimationFrame(update); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  const OP = HOME ? 'HomeLatestTimeline' : 'UserTweets';
  const load = (c) => {
    loading = true;
    const vars = encodeURIComponent(JSON.stringify({ count: 20, cursor: c || undefined, includePromotedContent: true, latestControlAvailable: true }));
    return fetch(`/i/api/graphql/perfQ/${OP}?variables=${vars}${location.search.replace('?', '&')}`, { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json()).then((j) => {
        const ins = (j.data.home?.home_timeline_urt || j.data.user.result.timeline.timeline).instructions;
        const entries = ins.find((x) => x.type === 'TimelineAddEntries')?.entries || [];
        cursor = null;
        for (const e of entries) {
          if (e.content?.itemContent?.tweet_results?.result?.legacy) { posts.push(e); heights.push(0); }
          if (e.content?.cursorType === 'Bottom') cursor = e.content.value;
        }
        relayout(); update();
        window.__xPosts = posts.length;
      }).finally(() => { loading = false; });
  };

  const start = () => {
    if (!DARK) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.setAttribute('data-theme', 'dark');
    const app = document.getElementById('react-root');
    document.getElementById('placeholder')?.remove();
    const primary = h('div', { class: `${V} ${C(`width:600px;max-width:600px;border-left:1px solid ${P.line};border-right:1px solid ${P.line};min-height:100vh`)}`, 'data-testid': 'primaryColumn' },
      HOME ? tabs() : v(C('padding:12px 16px'), txt(`${TEXT} ${C('font-size:20px;font-weight:800')}`, 'Perf Profile')),
      HOME ? composer() : null,
      h('section', { 'aria-labelledby': 'accessible-list-1', role: 'region', class: V },
        h('h1', { id: 'accessible-list-1', class: C('position:absolute;width:1px;height:1px;overflow:hidden') }, HOME ? 'Your Home Timeline' : 'Posts'),
        h('div', { 'aria-label': HOME ? 'Timeline: Your Home Timeline' : 'Timeline: Posts' }, list)));
    const main = h('main', { role: 'main', class: `${V} ${C('flex-grow:2;align-items:flex-start')}` },
      v(C('width:990px'), v(`${ROW} ${JSB} ${C('width:990px;min-height:100%')}`, primary, sidebar())));
    app.append(v(`${ROW} ${GROW} ${C(`background-color:${P.bg};min-height:100%`)}`, header(), main));
    load(null).then(() => { window.__xLoaded = true; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}

function selfSignedCert(dir) {
  const key = path.join(dir, 'x-key.pem'), cert = path.join(dir, 'x-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    const r = run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30',
      '-subj', '/CN=x.com', '-addext', 'subjectAltName=DNS:x.com,DNS:*.x.com']);
    if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/** Starts the stand-in on https://x.com:<port> (resolved to 127.0.0.1 by the browser). → {port, requests, close()} */
async function startXPage(workDir, { seed = 1 } = {}) {
  const imgDir = makePictures(workDir);
  const appJs = `(${APP.toString()})();`;
  const requests = [];
  const srv = https.createServer(selfSignedCert(workDir), (req, res) => {
    const u = new URL(req.url, 'https://x.com');
    requests.push({ url: req.url, time: Date.now() });
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
    if (u.pathname.startsWith('/i/api/graphql/')) {
      let vars = {};
      try { vars = JSON.parse(u.searchParams.get('variables') || '{}'); } catch {}
      const page = /^page:(\d+)$/.exec(vars.cursor || '')?.[1] || 0;
      const body = JSON.stringify(timelinePage({ page: Number(page), size: Number(page) ? 30 : 60, elonEvery: Number(u.searchParams.get('elon')) || 0, seed }));
      return send(200, 'application/json', zlib.gzipSync(body), { 'content-encoding': 'gzip' });
    }
    if (u.pathname === '/app.js') return send(200, 'text/javascript', appJs);
    const img = /^\/img\/((?:av|ph|card)\d+)\.jpg$/.exec(u.pathname);
    if (img) {
      const f = path.join(imgDir, `${img[1]}.jpg`);
      if (fs.existsSync(f)) return send(200, 'image/jpeg', fs.readFileSync(f), { 'cache-control': 'max-age=3600' });
      return send(404, 'text/plain', 'no');
    }
    if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    if (u.pathname === '/blank') return send(200, 'text/html; charset=utf-8', '<!doctype html><title>blank</title>'); // (same site: the renderer is kept)
    return send(200, 'text/html; charset=utf-8', SHELL(u.searchParams.get('theme') === 'dark' ? 'dark' : 'light'));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, requests, close: () => new Promise((r) => { srv.close(r); srv.closeAllConnections(); }) };
}

module.exports = { startXPage, timelinePage };
