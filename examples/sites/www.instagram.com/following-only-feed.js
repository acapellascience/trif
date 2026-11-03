// ==WebMod==
// @name        Only Following
// @description Removes suggested posts, suggested accounts and ads from the Instagram home feed, so it only shows people you follow
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        1 drops feed ads, so their impressions never report; patches JSON.parse
// @source      webmods
// @version     2
// ==/WebMod==

(() => {
  // The home feed is a Relay connection named xdt_api__v1__feed__timeline__connection. The first page
  // is embedded in the HTML (<script type="application/json">); later pages come from
  // /graphql/query (PolarisFeedRootPaginationCachedQuery). Both are read with JSON.parse, so we filter
  // the parsed result there. Each edge.node is an XDTFeedItem with exactly one non-null field:
  //   media          a normal post (suggested ones have media.explore = {title: "Suggested for you"}
  //                  or inventory_source "mixed_unconnected")
  //   explore_story  a suggested post
  //   ad, ad4ad_in_webfeed, suggested_users, ...  not from people you follow
  // Pagination lives in page_info, not in edges, so dropping edges doesn't break "load more".
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

  const filterConnection = (conn) => {
    if (!Array.isArray(conn?.edges)) return;
    conn.edges = conn.edges.filter((e) => {
      const r = reasonFor(e?.node);
      if (r) counts[r] = (counts[r] || 0) + 1;
      return !r;
    });
  };

  // Bounded search for the connection key anywhere in the parsed object.
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 14) return;
    if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1); return; }
    for (const k in obj) {
      if (k === KEY) filterConnection(obj[k]);
      else walk(obj[k], depth + 1);
    }
  };

  const parse0 = JSON.parse;
  JSON.parse = function (text) {
    const result = parse0.apply(this, arguments);
    try {
      // Cheap check first: only feed payloads mention the key.
      if (typeof text === 'string' && text.length > 1000 && text.includes(KEY)) {
        walk(result, 0);
        window.webmods?.log('feed filtered', JSON.stringify(counts));
      }
    } catch (e) { window.webmods?.warn('filter failed', String(e)); }
    return result;
  };
})();
