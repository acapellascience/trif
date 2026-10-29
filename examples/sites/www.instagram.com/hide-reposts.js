// ==WebMod==
// @name        Hide reposts
// @description Removes reposts (posts shown because someone you follow reposted them) from the Instagram home feed
// @match       https://www.instagram.com/*
// @run-at      document-start
// ==/WebMod==

(() => {
  // A repost in the home feed is an ordinary media item whose floating_context_items[] contains
  // {floating_context_item_type: "REPOSTED_BY", user: {username: <who reposted>}}. If you also follow
  // the post's author (media.user.friendship_status.following), it would be in your feed anyway, so
  // we keep it. Data arrives as JSON (first page embedded in the HTML, later pages from /graphql/query),
  // all read with JSON.parse, so we filter the parsed result there, only in Relay "edges" arrays.
  // page_info cursors are untouched, so loading more keeps working.
  const HINT = /"floating_context_item_type":\s*"REPOSTED_BY"/;
  let removed = 0;

  const isRepost = (m) => {
    if (!m || typeof m !== 'object' || !Array.isArray(m.floating_context_items)) return false;
    if (!m.floating_context_items.some((i) => i?.floating_context_item_type === 'REPOSTED_BY')) return false;
    return m.user?.friendship_status?.following !== true;
  };

  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 16) return;
    if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1); return; }
    for (const k in obj) {
      const v = obj[k];
      if (k === 'edges' && Array.isArray(v)) {
        const kept = v.filter((e) => !isRepost(e?.node?.media));
        if (kept.length !== v.length) { removed += v.length - kept.length; obj[k] = kept; }
      } else walk(v, depth + 1);
    }
  };

  const parse0 = JSON.parse;
  JSON.parse = function (text) {
    const result = parse0.apply(this, arguments);
    try {
      if (typeof text === 'string' && text.length > 1000 && HINT.test(text)) {
        const before = removed;
        walk(result, 0);
        if (removed !== before) window.webmods?.log(`removed ${removed - before} repost(s), ${removed} total`);
      }
    } catch (e) { window.webmods?.warn('repost filter failed', String(e)); }
    return result;
  };
  window.__wmIgRepostsRemoved = () => removed;
})();
