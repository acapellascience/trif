// ==WebMod==
// @name        Hide Reposts
// @description Removes reposts by people you follow from Home
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        1 TRIF filters the page's data (fetch, XHR, embedded JSON), which the page's scripts could notice
// @source      webmods
// @version     3
// @boxed
// @powers site-data
// ==/WebMod==

// A repost in the home feed is a media item whose floating_context_items[] has
// {floating_context_item_type: "REPOSTED_BY"}; kept when you follow the post's author anyway. The first page
// (embedded in the HTML) and later pages (/graphql/query) are filtered, only in Relay "edges" arrays.
let removed = 0;
const isRepost = (m) => {
  if (!m || typeof m !== 'object' || !Array.isArray(m.floating_context_items)) return false;
  if (!m.floating_context_items.some((i) => i && i.floating_context_item_type === 'REPOSTED_BY')) return false;
  return !(m.user && m.user.friendship_status && m.user.friendship_status.following === true);
};
// keepOne: the first page (embedded in the HTML) is only a few posts; if it ends up empty, Instagram renders
// no feed at all and never loads more. TRIF combines the Instagram filters by keeping only what all of them
// keep, so all three (with Following-Only Feed and Hide AI Content) always keep the same post there: the
// first edge that is a plain post (node.media).
const anchorOf = (edges) => edges.find((e) => e && e.node && e.node.media);
// Testing markers: one log line per home-feed batch (trif logs, or the side panel's log): how many posts
// Instagram sent and how many reposts this mod removed.
const FEED = 'xdt_api__v1__feed__timeline__connection';
let batch = 0;
const walk = (obj, depth, keepOne, parentKey) => {
  if (!obj || typeof obj !== 'object' || depth > 16) return;
  if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1, keepOne, parentKey); return; }
  for (const k in obj) {
    const v = obj[k];
    if (k === 'edges' && Array.isArray(v)) {
      const anchor = keepOne ? anchorOf(v) : null;
      const kept = v.filter((e) => e === anchor || !isRepost(e && e.node && e.node.media));
      if (parentKey === FEED) {
        batch++;
        trif.log(`batch ${batch}${keepOne ? ' (first page)' : ''}: Instagram sent ${v.length}, removed ${v.length - kept.length} repost(s), kept ${kept.length}`);
      }
      if (kept.length !== v.length) { removed += v.length - kept.length; obj[k] = kept; }
    } else walk(v, depth + 1, keepOne, k);
  }
};
const filterWith = (keepOne) => (data) => {
  walk(data, 0, keepOne, null);
  return data;
};
const filter = filterWith(false);
// The first page, embedded in the HTML (<script type="application/json">), before Instagram's code reads it,
// and later pages from /graphql/query (and the like), before Instagram sees them: where the original's
// JSON.parse patch caught them.
// Not filtered: the first page, embedded in the HTML. Filtering it with trif.filterEmbedded left the feed
// blank on about 1 load in 4, so the first few posts aren't checked for reposts.
// Only the feed's own endpoint: every response a filter matches is copied into the sandbox, so '*' slowed
// the whole site down.
trif.filterResponse('https://www.instagram.com/graphql/query*', filter);
