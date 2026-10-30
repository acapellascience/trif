// ==WebMod==
// @name        Hide AI content
// @description Removes posts labeled "AI content" (and posts by accounts labeled as AI) from Instagram feeds and lists
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        1 patches JSON.parse, which the page's scripts could notice
// ==/WebMod==

(() => {
  // Instagram's posts (XDTMediaDict) carry ai_label_info = {subtitle_text: "AI content",
  // gen_ai_detection_method: "AI_EDITED", attribution_label_text} when labeled, null otherwise.
  // Carousels can label single slides in carousel_media[]. AI accounts have
  // user.aigm_account_label_info.is_enabled = true.
  // Data arrives as JSON (the first page embedded in the HTML, later pages from /graphql/query), all
  // read with JSON.parse, so we filter the parsed result there. We only remove items from Relay
  // connection "edges" arrays (home feed, reels, explore, profile grids), never from single-post
  // payloads, so opening a labeled post directly still works. page_info cursors are untouched.
  const HINT = /"(gen_ai_detection_method|subtitle_text|attribution_label_text)":\s*"|"aigm_account_label_info":\s*\{\s*"is_enabled":\s*true/;
  let removed = 0;

  const labeled = (m) => {
    if (!m || typeof m !== 'object') return false;
    const l = m.ai_label_info;
    if (l && (l.subtitle_text || l.gen_ai_detection_method || l.attribution_label_text)) return true;
    if (m.user?.aigm_account_label_info?.is_enabled === true) return true;
    return Array.isArray(m.carousel_media) && m.carousel_media.some((c) => labeled(c));
  };
  const isAi = (edge) => {
    const n = edge?.node;
    if (!n || typeof n !== 'object') return false;
    return labeled(n.media) || labeled(n.explore_story?.media) || labeled(n) ||
      (Array.isArray(n.items) && n.items.some(labeled));   // ad units wrap their media in items[]
  };

  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 16) return;
    if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1); return; }
    for (const k in obj) {
      const v = obj[k];
      if (k === 'edges' && Array.isArray(v)) {
        const kept = v.filter((e) => !isAi(e));
        if (kept.length !== v.length) { removed += v.length - kept.length; obj[k] = kept; }
        for (const e of kept) walk(e, depth + 1);
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
        if (removed !== before) window.webmods?.log(`removed ${removed - before} AI-labeled post(s), ${removed} total`);
      }
    } catch (e) { window.webmods?.warn('AI filter failed', String(e)); }
    return result;
  };
})();
