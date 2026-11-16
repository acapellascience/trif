// ==WebMod==
// @name        Hide AI Content
// @description Removes posts labeled as AI content from feeds
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        1 TRIF filters the page's data (fetch, XHR, embedded JSON), which the page's scripts could notice
// @source      webmods
// @version     4
// @boxed
// @powers site-data
// ==/WebMod==

// Instagram's posts (XDTMediaDict) carry ai_label_info = {subtitle_text, gen_ai_detection_method,
// attribution_label_text} when labeled; carousels can label single slides; AI accounts have
// user.aigm_account_label_info.is_enabled = true. Only items in Relay "edges" arrays go (feeds, reels,
// explore, grids), never single-post payloads. The first page
// (embedded in the HTML) and later pages (/graphql/query) are both filtered.
let removed = 0;
const labeled = (m) => {
  if (!m || typeof m !== 'object') return false;
  const l = m.ai_label_info;
  if (l && (l.subtitle_text || l.gen_ai_detection_method || l.attribution_label_text)) return true;
  if (m.user && m.user.aigm_account_label_info && m.user.aigm_account_label_info.is_enabled === true) return true;
  return Array.isArray(m.carousel_media) && m.carousel_media.some((c) => labeled(c));
};
const isAi = (edge) => {
  const n = edge && edge.node;
  if (!n || typeof n !== 'object') return false;
  return labeled(n.media) || labeled(n.explore_story && n.explore_story.media) || labeled(n) ||
    (Array.isArray(n.items) && n.items.some(labeled));   // ad units wrap their media in items[]
};
// keepOne: the first page (embedded in the HTML) is only a few posts; if it ends up empty, Instagram renders
// no feed at all and never loads more. TRIF combines the Instagram filters by keeping only what all of them
// keep, so all three (with Following-Only Feed and Hide Reposts) always keep the same post there: the
// first edge that is a plain post (node.media).
const anchorOf = (edges) => edges.find((e) => e && e.node && e.node.media);
// Testing markers: one log line per home-feed batch (trif logs, or the side panel's log): how many posts
// Instagram sent and how many AI-labeled ones this mod removed. Other lists only log when it removes some.
const FEED = 'xdt_api__v1__feed__timeline__connection';
let batch = 0;
const walk = (obj, depth, keepOne, parentKey) => {
  if (!obj || typeof obj !== 'object' || depth > 16) return;
  if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1, keepOne, parentKey); return; }
  for (const k in obj) {
    const v = obj[k];
    if (k === 'edges' && Array.isArray(v)) {
      const anchor = keepOne ? anchorOf(v) : null;
      const kept = v.filter((e) => e === anchor || !isAi(e));
      if (parentKey === FEED) {
        batch++;
        trif.log(`batch ${batch}${keepOne ? ' (first page)' : ''}: Instagram sent ${v.length}, removed ${v.length - kept.length} AI-labeled, kept ${kept.length}`);
      } else if (kept.length !== v.length) trif.log(`${parentKey}: removed ${v.length - kept.length} AI-labeled of ${v.length}`);
      if (kept.length !== v.length) { removed += v.length - kept.length; obj[k] = kept; }
      for (const e of kept) walk(e, depth + 1, keepOne, k);
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
// Not filtered as data: the first page, embedded in the HTML. Filtering it with trif.filterEmbedded left the
// feed blank on about 1 load in 4. Instead, posts on the home feed whose header shows Instagram's AI label
// ("AI content", "AI info"; English) are collapsed on the page: zero height but kept in the layout, not
// display: none, because Instagram's virtual list measures each post by where the next one starts (see
// Following-Only Feed). Three-Column Feed takes zero-height posts out of the grid.
const AI_LABEL = /^(AI content|AI info)$/;
trif.css(`.trif-box-igai-hidden { height: 0 !important; min-height: 0 !important; overflow: hidden !important;
  visibility: hidden !important; margin: 0 !important; padding: 0 !important; border: 0 !important; }`);
const onHome = () => /^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(page.url);   // not a post's own page
trif.observe('main article', (post) => {
  if (!onHome()) return;
  if (post.findAll('span').some((s) => AI_LABEL.test(s.text.trim()))) post.classes.add('trif-box-igai-hidden');
});
// Only the GraphQL endpoints feeds, reels and explore load from: every response a filter matches is copied
// into the sandbox, so '*' slowed the whole site down.
trif.filterResponse('https://www.instagram.com/graphql/query*', filter);
trif.filterResponse('https://www.instagram.com/api/graphql*', filter);
