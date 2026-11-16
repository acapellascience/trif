// ==WebMod==
// @name        Following-Only Feed
// @description Home feed shows only people you follow, no ads
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        1 drops feed ads, so their impressions never report; TRIF filters the page's data (fetch, XHR, embedded JSON)
// @source      webmods
// @version     4
// @boxed
// @powers site-data
// ==/WebMod==

// The home feed is a Relay connection named xdt_api__v1__feed__timeline__connection. Later pages come
// from /graphql/query (PolarisFeedRootPaginationCachedQuery): filtered here, before Instagram sees them.
// The first page is embedded in the HTML (<script type="application/json">). Each edge.node is an XDTFeedItem
// with exactly one non-null field: media (suggested ones have media.explore or inventory_source
// "mixed_unconnected"), explore_story, ad, ad4ad_in_webfeed, suggested_users, ...
const KEY = 'xdt_api__v1__feed__timeline__connection';
const DROP = ['explore_story', 'ad', 'ad4ad_in_webfeed', 'suggested_users', 'bloks_netego', 'abra_icebreakers_in_feed_unit'];
const counts = {};
const reasonFor = (node) => {
  if (!node || typeof node !== 'object') return null;
  for (const k of DROP) if (node[k] != null) return k;
  const m = node.media;
  if (m && (m.explore != null || m.inventory_source === 'mixed_unconnected')) return 'suggested_media';
  return null;
};
// keepOne: the first page (embedded in the HTML) is only a few posts; if it ends up empty, Instagram renders
// no feed at all and never loads more. TRIF combines the Instagram filters by keeping only what all of them
// keep, so each one keeping "a" post isn't enough: Hide Reposts and Hide AI Content use the same rule, and
// all three always keep the first edge that is a plain post (node.media) on the first page.
const anchorOf = (edges) => edges.find((e) => e && e.node && e.node.media);
// Testing markers: one log line per batch (trif logs, or the side panel's log): how many posts Instagram
// sent, what this mod removed and why. TRIF keeps only what every filter keeps, so the other filters' lines
// for the same batch show the rest.
let batch = 0;
const filterConnection = (conn, keepOne) => {
  if (!conn || !Array.isArray(conn.edges)) return;
  const all = conn.edges;
  const anchor = keepOne ? anchorOf(all) : null;
  const kept = all.filter((e) => e === anchor || !reasonFor(e && e.node));
  const why = {};
  for (const e of all) {
    const r = reasonFor(e && e.node);
    if (r && !kept.includes(e)) { counts[r] = (counts[r] || 0) + 1; why[r] = (why[r] || 0) + 1; }
  }
  batch++;
  trif.log(`batch ${batch}${keepOne ? ' (first page)' : ''}: Instagram sent ${all.length}, removed ${all.length - kept.length} ${JSON.stringify(why)}, kept ${kept.length}`);
  conn.edges = kept;
};
const walk = (obj, depth, keepOne) => {
  if (!obj || typeof obj !== 'object' || depth > 14) return;
  if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1, keepOne); return; }
  for (const k in obj) {
    if (k === KEY) filterConnection(obj[k], keepOne);
    else walk(obj[k], depth + 1, keepOne);
  }
};
const has = (obj, depth) => {
  if (!obj || typeof obj !== 'object' || depth > 14) return false;
  if (Array.isArray(obj)) return obj.some((v) => has(v, depth + 1));
  for (const k in obj) if (k === KEY || has(obj[k], depth + 1)) return true;
  return false;
};
const filterWith = (keepOne) => (data) => {
  if (!has(data, 0)) return data;
  walk(data, 0, keepOne);
  return data;
};
const filter = filterWith(false);
// The first page, embedded in the HTML (<script type="application/json">), before Instagram's code reads it,
// and later pages from /graphql/query (and the like), before Instagram sees them: where the original's
// JSON.parse patch caught them.
// Not filtered: the first page, embedded in the HTML. Filtering it with trif.filterEmbedded left the feed
// blank on about 1 load in 4 (6/6 loads fine without it, tested), even when posts were left. Instead, the
// first page's suggested posts and ads are hidden on the page, by their labels (English). They're collapsed
// to zero height but stay in the layout, not display: none: Instagram's virtual list measures each post as
// (next post's top - its top), and a display: none post has no position (its top reads 0), which threw the
// measurements off and left the feed blank further down. Three-Column Feed takes zero-height posts out of
// the grid.
const LABEL = /^(Suggested for you|Sponsored|Ad)$/;
trif.css(`.trif-box-igf-hidden { height: 0 !important; min-height: 0 !important; overflow: hidden !important;
  visibility: hidden !important; margin: 0 !important; padding: 0 !important; border: 0 !important; }`);
// Home feed only: on a post's own page (/p/…) the <article> is the post you opened.
const onHome = () => /^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(page.url);
trif.observe('main article', (post) => {
  if (!onHome()) return;
  if (post.findAll('span').some((s) => LABEL.test(s.text.trim()))) post.classes.add('trif-box-igf-hidden');
});
// Only the feed's own endpoint: every response a filter matches is copied into the sandbox, so '*' slowed
// the whole site down.
trif.filterResponse('https://www.instagram.com/graphql/query*', filter);
