// ==WebMod==
// @name        Follow Status
// @description see your moots
// @match       https://x.com/*
// @run-at      document-start
// @risk        0 render-only: reads what X already loaded for each post; sends nothing
// @source      trif
// @version     3
// @boxed
// @powers      page-data
// ==/WebMod==

// Who the author is to you comes from the post data X already has in the page: React keeps the post (a
// `tweet` prop, a few steps up from its <article>) with user.following (you follow them) and
// user.followed_by (they follow you). Nothing is fetched. (Boxed: read through TRIF's page-data power, as a
// plain copy; the mod can't send anything.)
// Named so it sorts before rainbow-rave and space-shooter: it loads first, and their styles go on top of
// its badges (Rainbow Rave's white text and shadow; X-Flyer wraps the badge's word like any other, so it
// can be shot).
const LABELS = { mutual: 'mutual', following: 'you follow', follower: 'follows you', suggested: 'not followed' };
// Rainbow Rave's badge rainbow, lighter, as a seamless 102px tile: 3 hue cycles across, so its stripes are
// 24.04px apart on the diagonal (see the mutual badge below)
const FS_P = 102 / (3 * Math.SQRT2);
const FS_RAINBOW = `repeating-linear-gradient(45deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% 74%) ${(i * FS_P / 12).toFixed(4)}px`).join(', ')})`;

trif.css(`
  .trif-box-fs-badge { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 9999px; vertical-align: 1px;
    font-family: TwitterChirp, -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11px; line-height: 16px; font-weight: 500; white-space: nowrap;
    border: 1px solid rgb(var(--fs-rgb) / 0.7); color: rgb(var(--fs-rgb)) !important; background: rgb(var(--fs-rgb) / 0.11); }
  /* toned down from X's own green, yellow, blue and red, not all the way to pastel */
  :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=mutual] { --fs-rgb: 63 191 142; }
  :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=following] { --fs-rgb: 235 203 64; }
  :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=follower] { --fs-rgb: 79 166 227; }
  :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=suggested] { --fs-rgb: 229 87 93; }
  /* no room in the name line (see fit): the badge steps out, and a dot in its colour sits on the corner of
     their picture instead, ringed in the page's background (hover: the label) */
  .trif-box-fs-badge[data-trif-box-fs-dot] { display: none !important; }
  /* With Rainbow Rave on (html[data-trif-box-fs-rave], see pass): the colours wash out most of the way to
     white, and "mutual" gets Rainbow Rave's badge rainbow, lighter. (Rave's own white text and shadow go on top.) */
  html[data-trif-box-fs-rave] :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=following] { --fs-rgb: 250 238 196; }
  html[data-trif-box-fs-rave] :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=follower] { --fs-rgb: 204 228 250; }
  html[data-trif-box-fs-rave] :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=suggested] { --fs-rgb: 250 204 207; }
  /* (fills as images: Rainbow Rave clears every background colour in X's page) */
  html[data-trif-box-fs-rave] .trif-box-fs-badge:not([data-trif-box-fs=mutual]) { background-image: linear-gradient(rgb(var(--fs-rgb) / 0.3), rgb(var(--fs-rgb) / 0.3));
    border-color: rgb(var(--fs-rgb) / 0.95); }
  html[data-trif-box-fs-rave] .trif-box-fs-avdot:not([data-trif-box-fs=mutual]) { background-image: linear-gradient(rgb(var(--fs-rgb)), rgb(var(--fs-rgb))); }
  html[data-trif-box-fs-rave] :is(.trif-box-fs-badge, .trif-box-fs-avdot)[data-trif-box-fs=mutual] {
    background: ${FS_RAINBOW};
    border-color: rgba(255, 255, 255, 0.9); animation: wm-rainbow-fs-roll 0.8s linear infinite;
    background-size: 102px 102px; background-repeat: repeat; }
  /* (named wm-rainbow-*: Rainbow Rave keeps those in phase with each other) */
  @keyframes wm-rainbow-fs-roll { from { background-position: -40px -20px; } to { background-position: -23px -37px; } }
  .trif-box-fs-avdot { position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px; border-radius: 50%; z-index: 1;
    background: rgb(var(--fs-rgb)); box-shadow: 0 0 0 2px var(--fs-ring, #000); }
`);

// You, to leave your own posts unlabelled: the handle in X's Profile link. (The original read X's twid
// cookie; a boxed mod could too, with the site-storage power (cookie:twid), but that's one more thing for
// you to allow, for the same person either way.)
const myHandle = () => {
  const a = page.find('a[data-testid=AppTabBar_Profile_Link]');
  const m = /\/([A-Za-z0-9_]{1,15})\/?$/.exec((a && a.attr('href')) || '');
  return m ? m[1].toLowerCase() : '';
};

// The post behind an <article>: the `tweet` prop a few steps up its React fiber (a copy, through page-data).
// The number of steps is remembered per article, and checked again each pass (a row can be reused).
const stepsOf = new WeakMap();
const MAX_STEPS = 35; // (page-data paths are up to 40 names: fiber, 35 × return, memoizedProps, tweet, …)
const propsPath = (k) => `fiber${'.return'.repeat(k)}.memoizedProps`;
const isObj = (v) => !!v && typeof v === 'object';
const usersOf = (article) => {
  let k = stepsOf.get(article);
  if (k !== undefined && !isObj(article.pageData(`${propsPath(k)}.tweet.user`)) && !isObj(article.pageData(`${propsPath(k)}.tweet.retweeted_status`))) k = undefined;
  if (k === undefined) {
    for (let i = 0; i < MAX_STEPS; i++) if (isObj(article.pageData(`${propsPath(i)}.tweet`))) { k = i; break; }
    if (k === undefined) return null;
    stepsOf.set(article, k);
  }
  const T = `${propsPath(k)}.tweet`;
  const rt = isObj(article.pageData(`${T}.retweeted_status`));
  const main = rt ? `${T}.retweeted_status` : T;
  return { user: article.pageData(`${main}.user`), quoted: article.pageData(`${main}.quoted_status.user`) };
};
const statusOf = (u, me) => {
  if (!u || typeof u !== 'object' || typeof u.following !== 'boolean' && typeof u.followed_by !== 'boolean') return null;
  if (me && typeof u.screen_name === 'string' && u.screen_name.toLowerCase() === me) return null;
  return u.following ? (u.followed_by ? 'mutual' : 'following') : u.followed_by ? 'follower' : 'suggested';
};

const widths = new WeakMap(); // badge → its full width (data-fs-w in the original)
// After the time-since-posted link in a name line (or the time itself, in a quoted post, where it may
// not be a link). Kept up to date: the same row can be reused for another post, or you can follow
// someone from the page.
const label = (nameLine, status) => {
  const time = nameLine && nameLine.find('time');
  if (!time) return;
  const anchor = time.closest('a') || time;
  const nx = anchor.next;
  let badge = nx && nx.classes.has('trif-box-fs-badge') ? nx : null;
  if (!status) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = page.create('span');
    badge.classes.add('trif-box-fs-badge');
    // (X sets its font on its own text spans, not on the row: copy it from the time, or it's Times)
    badge.style('font-family', time.style('font-family'));
    anchor.after(badge);
  }
  if (badge.attr('data-trif-box-fs') !== status) {
    badge.setAttr('data-trif-box-fs', status);
    badge.setText(LABELS[status]);
    badge.setAttr('title', LABELS[status]);
    widths.delete(badge);
  }
  fit(badge, nameLine, anchor, status);
};

// A long name leaves no room in the header: the badge would wrap or run under the controls on the right
// (the "..." menu, Grok, other extensions' labels). Then it steps out for a dot on their picture (the
// post's own author only; a quoted post has no controls beside it, so its badge always stays). Its full
// width is remembered, so it comes back only when that fits again (no flip-flopping).
const fit = (badge, nameLine, anchor, status) => {
  const article = nameLine.closest('article');
  const hasCaret = (r) => { const p = r.parent; return !!p && p.children.some((c) => c !== r && !!c.find('[data-testid=caret]')); };
  let row = nameLine;
  for (let i = 0; row && i < 8 && !hasCaret(row); i++) row = row.parent;
  if (!row || !hasCaret(row) || !article || !isInside(article, row)) return;
  let limit = Infinity;
  for (const c of row.parent.children) if (c !== row) { const r = c.rect(); if (r.width) limit = Math.min(limit, r.left); }
  const ar = anchor.rect();
  let wrapped = false;
  if (badge.attr('data-trif-box-fs-dot') === null) {
    const br = badge.rect();
    if (br.width) widths.set(badge, br.width);
    wrapped = br.width > 0 && Math.abs(br.top + br.height / 2 - (ar.top + ar.height / 2)) > ar.height / 2;
  }
  const full = widths.get(badge) || 0, left = ar.right + 6;
  // ...and anything drawn over where its right end would be (e.g. an extension's label laid over the row)
  const x = left + full - 2, y = ar.top + ar.height / 2;
  const covered = x < page.width && y > 0 && y < page.height && page.elementsFromPoint(x, y)
    .some((el) => isInside(article, el) && !isInside(el, badge) && !isInside(badge, el) && !isInside(row, el));
  const dot = wrapped || left + full > limit || covered;
  if (dot) badge.setAttr('data-trif-box-fs-dot', ''); else badge.removeAttr('data-trif-box-fs-dot');
  const avatar = article.findAll('[data-testid=Tweet-User-Avatar]').find((a) => !a.closest('[role=link]'));
  let mark = avatar ? avatar.children.find((c) => c.classes.has('trif-box-fs-avdot')) : null;
  if (!dot || !avatar) { if (mark) mark.remove(); return; }
  if (!mark) {
    mark = page.create('span');
    mark.classes.add('trif-box-fs-avdot');
    avatar.append(mark);
    // (ringed in the page's own background, light or dark theme)
    if (page.body) page.root.style('--fs-ring', page.body.style('background-color'));
  }
  if (mark.attr('data-trif-box-fs') !== status) { mark.setAttr('data-trif-box-fs', status); mark.setAttr('title', LABELS[status]); }
};
// (whether `inner` is `outer` or inside it: closest() from inner up)
const isInside = (outer, inner) => { for (let e = inner; e; e = e.parent) if (e === outer) return true; return false; };

const pass = () => {
  // Rainbow Rave is on when its (maybe hidden) music buttons are there
  if (page.find('.wm-rainbow-music, .trif-box-wm-rainbow-music')) page.root.setAttr('data-trif-box-fs-rave', ''); else page.root.removeAttr('data-trif-box-fs-rave');
  const me = myHandle();
  for (const article of page.findAll('article[data-testid=tweet]')) {
    const u = usersOf(article);
    if (!u) continue;
    const names = article.findAll('[data-testid=User-Name]');
    // the post's own name line, then a quoted post's (inside its card, a [role=link])
    const own = names.find((n) => !n.closest('[role=link]')) || names[0];
    label(own, statusOf(u.user, me));
    const quoted = names.find((n) => n !== own && n.closest('[role=link]'));
    if (quoted) label(quoted, statusOf(u.quoted, me));
  }
};

let queued = false;
const schedule = () => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    try { pass(); } catch (e) { trif.warn('follow status failed', String(e)); }
  }, 150);
};
// (any change to the page: children added or removed, or text, anywhere)
trif.changes('html', schedule);
page.on('resize', schedule);
schedule();
