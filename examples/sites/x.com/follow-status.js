// ==WebMod==
// @name        Follow status
// @description see your moots
// @match       https://x.com/*
// @run-at      document-start
// @risk        0 render-only: reads what X already loaded for each post; sends nothing
// @source      trif
// @version     1
// ==/WebMod==

// Who the author is to you comes from the post data X already has in the page: React keeps the post (a
// `tweet` prop, a few steps up from its <article>) with user.following (you follow them) and
// user.followed_by (they follow you). Nothing is fetched.
// Named so it sorts before rainbow-rave and space-shooter: it loads first, and their styles go on top of
// its badges (Rainbow Rave's white text and shadow; X-Flyer wraps the badge's word like any other, so it
// can be shot).
(() => {
  const LABELS = { mutual: 'mutual', following: 'you follow', follower: 'follows you', suggested: 'not followed' };

  const style = document.createElement('style');
  style.textContent = `
    .fs-badge { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 9999px; vertical-align: 1px;
      font-family: TwitterChirp, -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px; line-height: 16px; font-weight: 500; white-space: nowrap;
      border: 1px solid rgb(var(--fs-rgb) / 0.7); color: rgb(var(--fs-rgb)) !important; background: rgb(var(--fs-rgb) / 0.11); }
    /* toned down from X's own green, yellow, blue and red, not all the way to pastel */
    :is(.fs-badge, .fs-avdot)[data-fs=mutual] { --fs-rgb: 63 191 142; }
    :is(.fs-badge, .fs-avdot)[data-fs=following] { --fs-rgb: 235 203 64; }
    :is(.fs-badge, .fs-avdot)[data-fs=follower] { --fs-rgb: 79 166 227; }
    :is(.fs-badge, .fs-avdot)[data-fs=suggested] { --fs-rgb: 229 87 93; }
    /* no room in the name line (see fit): the badge steps out, and a dot in its colour sits on the corner of
       their picture instead, ringed in the page's background (hover: the label) */
    .fs-badge[data-fs-dot] { display: none !important; }
    /* With Rainbow Rave on (html[data-fs-rave], see pass): the colours wash out most of the way to white,
       and "mutual" gets Rainbow Rave's badge rainbow (one hue cycle every 24px on the 45° diagonal, rolling
       by in 0.8s), lighter. (Rave's own white text and shadow go on top.) */
    html[data-fs-rave] :is(.fs-badge, .fs-avdot)[data-fs=following] { --fs-rgb: 250 238 196; }
    html[data-fs-rave] :is(.fs-badge, .fs-avdot)[data-fs=follower] { --fs-rgb: 204 228 250; }
    html[data-fs-rave] :is(.fs-badge, .fs-avdot)[data-fs=suggested] { --fs-rgb: 250 204 207; }
    /* (fills as images: Rainbow Rave clears every background colour in X's page) */
    html[data-fs-rave] .fs-badge:not([data-fs=mutual]) { background-image: linear-gradient(rgb(var(--fs-rgb) / 0.3), rgb(var(--fs-rgb) / 0.3));
      border-color: rgb(var(--fs-rgb) / 0.95); }
    html[data-fs-rave] .fs-avdot:not([data-fs=mutual]) { background-image: linear-gradient(rgb(var(--fs-rgb)), rgb(var(--fs-rgb))); }
    html[data-fs-rave] :is(.fs-badge, .fs-avdot)[data-fs=mutual] {
      background: repeating-linear-gradient(45deg,
        hsl(0 100% 74%) 0px, hsl(30 100% 74%) 2px, hsl(60 100% 74%) 4px, hsl(90 100% 74%) 6px,
        hsl(120 100% 74%) 8px, hsl(150 100% 74%) 10px, hsl(180 100% 74%) 12px, hsl(210 100% 74%) 14px,
        hsl(240 100% 74%) 16px, hsl(270 100% 74%) 18px, hsl(300 100% 74%) 20px, hsl(330 100% 74%) 22px,
        hsl(360 100% 74%) 24px);
      border-color: rgba(255, 255, 255, 0.9); animation: wm-rainbow-fs-roll 0.8s linear infinite;
      /* the image is bigger than the badge and slides exactly one stripe (24px) up the diagonal, so no edge
         of it ever shows: an image the badge's own size jumped at its seams (Rainbow Rave's icons do this) */
      background-size: calc(100% + 80px) calc(100% + 80px); background-repeat: no-repeat; }
    /* (named wm-rainbow-*: Rainbow Rave keeps those in phase with each other) */
    @keyframes wm-rainbow-fs-roll { from { background-position: -40px -20px; } to { background-position: -23.029437px -36.970563px; } }
    .fs-avdot { position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px; border-radius: 50%; z-index: 1;
      background: rgb(var(--fs-rgb)); box-shadow: 0 0 0 2px var(--fs-ring, #000); }
  `;
  (document.head || document.documentElement).append(style);

  // Your own id, to leave your own posts unlabelled (X's twid cookie: "u=<id>", URL-encoded)
  const myId = () => {
    try { return decodeURIComponent(document.cookie.match(/(?:^|;\s*)twid=([^;]+)/)?.[1] || '').replace(/^u=/, ''); } catch { return ''; }
  };

  const tweetOf = (article) => {
    try {
      const key = Object.keys(article).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && article[key], i = 0; f && i < 40; f = f.return, i++) {
        const t = f.memoizedProps?.tweet;
        if (t && typeof t === 'object') return t;
      }
    } catch {}
    return null;
  };
  const statusOf = (u) => {
    if (!u || typeof u !== 'object' || typeof u.following !== 'boolean' && typeof u.followed_by !== 'boolean') return null;
    if (u.id_str && u.id_str === myId()) return null;
    return u.following ? (u.followed_by ? 'mutual' : 'following') : u.followed_by ? 'follower' : 'suggested';
  };

  // After the time-since-posted link in a name line (or the time itself, in a quoted post, where it may
  // not be a link). Kept up to date: the same row can be reused for another post, or you can follow
  // someone from the page.
  const label = (nameLine, status) => {
    const time = nameLine?.querySelector('time');
    if (!time) return;
    const anchor = time.closest('a') || time;
    let badge = anchor.nextElementSibling?.classList.contains('fs-badge') ? anchor.nextElementSibling : null;
    if (!status) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'fs-badge';
      // (X sets its font on its own text spans, not on the row: copy it from the time, or it's Times)
      badge.style.fontFamily = getComputedStyle(time).fontFamily;
      anchor.after(badge);
    }
    if (badge.dataset.fs !== status) {
      badge.dataset.fs = status;
      badge.textContent = LABELS[status];
      badge.title = LABELS[status];
      delete badge.dataset.fsW;
    }
    fit(badge, nameLine, anchor, status);
  };

  // A long name leaves no room in the header: the badge would wrap or run under the controls on the right
  // (the "..." menu, Grok, other extensions' labels). Then it steps out for a dot on their picture (the
  // post's own author only; a quoted post has no controls beside it, so its badge always stays). Its full
  // width is remembered, so it comes back only when that fits again (no flip-flopping).
  const fit = (badge, nameLine, anchor, status) => {
    const article = nameLine.closest('article');
    const hasCaret = (r) => Array.from(r.parentElement?.children || []).some((c) => c !== r && c.querySelector?.('[data-testid=caret]'));
    let row = nameLine;
    for (let i = 0; row && i < 8 && !hasCaret(row); i++) row = row.parentElement;
    if (!row || !hasCaret(row) || !article?.contains(row)) return;
    let limit = Infinity;
    for (const c of row.parentElement.children) if (c !== row) { const r = c.getBoundingClientRect(); if (r.width) limit = Math.min(limit, r.left); }
    const ar = anchor.getBoundingClientRect();
    let wrapped = false;
    if (!badge.hasAttribute('data-fs-dot')) {
      const br = badge.getBoundingClientRect();
      if (br.width) badge.dataset.fsW = String(br.width);
      wrapped = br.width > 0 && Math.abs(br.top + br.height / 2 - (ar.top + ar.height / 2)) > ar.height / 2;
    }
    const full = parseFloat(badge.dataset.fsW) || 0, left = ar.right + 6;
    // ...and anything drawn over where its right end would be (e.g. an extension's label laid over the row)
    const x = left + full - 2, y = ar.top + ar.height / 2;
    const covered = x < innerWidth && y > 0 && y < innerHeight && document.elementsFromPoint(x, y)
      .some((el) => article.contains(el) && !el.contains(badge) && !badge.contains(el) && !row.contains(el));
    const dot = wrapped || left + full > limit || covered;
    badge.toggleAttribute('data-fs-dot', dot);
    const avatar = [...article.querySelectorAll('[data-testid=Tweet-User-Avatar]')].find((a) => !a.closest('[role=link]'));
    let mark = avatar?.querySelector(':scope > .fs-avdot');
    if (!dot || !avatar) { mark?.remove(); return; }
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'fs-avdot';
      avatar.append(mark);
      // (ringed in the page's own background, light or dark theme)
      document.documentElement.style.setProperty('--fs-ring', getComputedStyle(document.body).backgroundColor);
    }
    if (mark.dataset.fs !== status) { mark.dataset.fs = status; mark.title = LABELS[status]; }
  };

  const pass = () => {
    // Rainbow Rave is on when its (maybe hidden) music buttons are there
    document.documentElement.toggleAttribute('data-fs-rave', !!document.querySelector('.wm-rainbow-music'));
    for (const article of document.querySelectorAll('article[data-testid=tweet]')) {
      const tweet = tweetOf(article);
      if (!tweet) continue;
      const main = tweet.retweeted_status || tweet;
      const names = [...article.querySelectorAll('[data-testid=User-Name]')];
      // the post's own name line, then a quoted post's (inside its card, a [role=link])
      const own = names.find((n) => !n.closest('[role=link]')) || names[0];
      label(own, statusOf(main.user));
      const quoted = names.find((n) => n !== own && n.closest('[role=link]'));
      if (quoted) label(quoted, statusOf(main.quoted_status?.user));
    }
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      try { pass(); } catch (e) { window.trif?.warn('follow status failed', String(e)); }
    }, 150);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('resize', schedule);
  schedule();
})();
