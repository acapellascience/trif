// ==WebMod==
// @name        Post Styler
// @description Posts and people cards show their owners' colours
// @match       https://x.com/*
// @run-at      document-idle
// @risk        1 reads post authors' profile pictures from X's image server again (at 400×400) to find style codes
// @source      trif
// @version     1
// ==/WebMod==

// Tim's. The timeline's side of Profile Styler (profile-styler.js) and Style Encoder (style-encoder.js).
//
// A profile picture can carry a style (colour codes in its bottom-left corner, stamped by Style Encoder: see
// profile-styler.js for the layout). Profile Styler paints a whole profile page in its owner's colours; this
// paints each *post* by a styled person, wherever it shows (the timeline, search, a thread, someone else's
// profile), in its author's colours: the post's background, the author's name, verified badge and @handle,
// the post's text and links, its action icons (reply, repost, like...; the "Menu items" colour), the boxes
// in it (link cards: "Cards"; the quoted post's box: "Quoted posts"; their edges: "Lines"). Rainbow works
// as on profiles. Buttons, side panels and the logo are page-wide things, so they stay Profile Styler's.
// A quoted post inside keeps its own text: only its box takes the author's colours.
// People's cards too (the sidebar's "Relevant people" and "You might like", Who to follow, follower lists,
// search's People; hover cards; the search box's drop-down and @-mention suggestions): the card's background,
// name, badge, @handle, bio text and links, and their Follow button in their buttons colour. And names alone:
// the people in a notification ("Tim followed you"), and a post's "Tim reposted" line (whoever's style is
// already known: there's no picture there to read). Not chat: X draws it in shadow roots page styles can't
// reach.
// Your own posts show your saved style from Profile Styler's panel (as your own profile does), once you've
// saved one; everyone else's, what their picture carries.
//
// How: each post's author picture (the small one beside the post) is read again at 400×400 from
// pbs.twimg.com, X's own image server, like Profile Styler reads a profile's: one picture per author, and
// what it found is remembered by the picture's address (localStorage SEEN_KEY) so it isn't read again. A
// changed picture has a new address. The post gets data-ps-u (whose style: one CSS rule per author sets its
// colours as variables) and data-ps / data-ps-r (which colours are set, and which are rainbow), and its name,
// handle, badge and quoted box are marked; the rules below do the rest.

(() => {
  if (window.top !== window) return;
  const STORE = 'trifProfileStyler.mine'; // (Profile Styler's: your saved style, per account)
  const SEEN_KEY = 'trifPostStyler.seen', SEEN_MAX = 600;
  // --- the code (as Profile Styler reads it; see profile-styler.js) --------------------------------
  const KEYS = ['bg', 'name', 'badge', 'handle', 'text', 'buttons', 'links', 'panel', 'icons', 'logo', 'cards', 'lines', 'quotes'];
  const MARKERS = [[0, 0, [255, 0, 0]], [1, 0, [255, 0, 255]], [2, 0, [255, 255, 0]], [0, 1, [0, 0, 255]], [1, 1, [0, 255, 255]], [0, 2, [0, 255, 0]]];
  const CELLS = [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0], [0, 6], [1, 5], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0], [3, 7]];
  const FLAGS = [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1], [8, 0], [0, 10], [1, 9], [2, 8], [4, 6]];
  const LEVELS = [0, 85, 170, 255];
  const snap = (v) => LEVELS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const fromList = (v, rainbow) => ({ bg: v[0], name: v[1], badge: v[2], handle: v[3], text: v[4], buttons: v[5], links: v[6], panel: v[7],
    icons: v[8], logo: v[9], cards: v[10], lines: v[11], quotes: v[12], rainbow });
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  // the text colour that reads on a colour (a button's label): black or white
  const onColour = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) > 150 ? '#0f1419' : '#ffffff'; };
  const root = document.documentElement;

  // what's been read, by picture address: a style, or 0 (no code); kept between visits
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { seen = {}; }
  const seenMap = new Map(Object.entries(seen));
  let saveTimer = 0;
  const remember = (url, st) => {
    seenMap.delete(url); seenMap.set(url, st || 0);
    while (seenMap.size > SEEN_MAX) seenMap.delete(seenMap.keys().next().value); // (the oldest go first)
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seenMap))); } catch {} }, 2000);
  };
  const reading = new Map(); // url → Promise
  const readCode = (url) => {
    if (seenMap.has(url)) return Promise.resolve(seenMap.get(url) || null);
    if (reading.has(url)) return reading.get(url);
    const p = new Promise((resolve) => {
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight, s = W / 100;
          if (W < 200) { resolve(null); return; } // (too small to hold a code)
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          const cell = (x, y) => {
            const x0 = Math.floor((x + 0.25) * s), y0 = Math.floor(H - (y + 0.75) * s), n = Math.max(1, Math.round(s / 2));
            const d = g.getImageData(x0, y0, n, n).data, sum = [0, 0, 0];
            for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
            const k = d.length / 4;
            return sum.map((v) => v / k);
          };
          if (!MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) < 90))) { resolve(null); return; }
          const lossless = MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) <= 4));
          const colours = CELLS.map(([x, y]) => hex(lossless ? cell(x, y) : cell(x, y).map(snap)));
          const flags = FLAGS.map(([x, y]) => { const c = cell(x, y), lum = (c[0] + c[1] + c[2]) / 3, spread = Math.max(...c) - Math.min(...c); return spread > 60 ? null : lum > 200 ? true : lum < 55 ? false : null; });
          // (older codes carry fewer colours: as many as have their rainbow flag; see profile-styler.js)
          let n = 13;
          if (flags.slice(0, 7).some((f) => f === null)) { resolve(fromList(colours.map((c, i) => (i < 5 ? c : null)), [])); return; }
          for (const [at, upTo] of [[7, 7], [8, 8], [9, 8], [10, 10], [11, 11], [12, 12]]) if (flags[at] === null) { n = Math.min(n, upTo); }
          resolve(fromList(colours.map((c, i) => (i < n ? c : null)), KEYS.slice(0, n).filter((k, i) => flags[i])));
        } catch (e) { window.trif?.warn('post styler: could not read a picture', String(e)); resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }).then((st) => { reading.delete(url); remember(url, st); return st; });
    reading.set(url, p);
    return p;
  };

  // --- who's who --------------------------------------------------------------------------------
  const myHandle = () => {
    const t = document.querySelector('[data-testid=SideNav_AccountSwitcher_Button] [data-testid^="UserAvatar-Container-"]')?.dataset.testid || '';
    return /^UserAvatar-Container-(\w+)$/.exec(t)?.[1] || null;
  };
  const mySaved = (handle) => {
    try { const st = JSON.parse(localStorage.getItem(`${STORE}:${handle.toLowerCase()}`) || 'null'); return st && isHex(st.bg) ? st : null; } catch { return null; }
  };
  const big = (src) => src.replace(/_(normal|bigger|mini|x96|200x200|400x400)(\.\w+)(\?.*)?$/, '_400x400$2');

  // --- the look ---------------------------------------------------------------------------------
  const RAVE_BG = `repeating-linear-gradient(115deg,
    hsl(0 100% 65%) 0, hsl(30 100% 62%) 5vmax, hsl(60 100% 58%) 10vmax, hsl(90 100% 58%) 15vmax,
    hsl(120 100% 60%) 20vmax, hsl(150 100% 58%) 25vmax, hsl(180 100% 58%) 30vmax, hsl(210 100% 65%) 35vmax,
    hsl(240 100% 72%) 40vmax, hsl(270 100% 70%) 45vmax, hsl(300 100% 68%) 50vmax, hsl(330 100% 66%) 55vmax,
    hsl(360 100% 65%) 60vmax)`;
  const RAVE_SMALL = `repeating-linear-gradient(45deg,
    hsl(0 100% 60%) 0px, hsl(30 100% 60%) 2px, hsl(60 100% 60%) 4px, hsl(90 100% 60%) 6px, hsl(120 100% 60%) 8px,
    hsl(150 100% 60%) 10px, hsl(180 100% 60%) 12px, hsl(210 100% 60%) 14px, hsl(240 100% 60%) 16px,
    hsl(270 100% 60%) 18px, hsl(300 100% 60%) 20px, hsl(330 100% 60%) 22px, hsl(360 100% 60%) 24px)`;
  // (a post by a styled author: P; with colour k set: P[data-ps~=k]; rainbow: P[data-ps-r~=k]. #react-root
  // and the extra :not()s keep these above Profile Styler's page-wide rules and X-Flyer's recolouring)
  // A person, wherever X shows one with their picture: a people card (UserCell: the sidebar's lists, Who to
  // follow, followers, search's People), a hover card (the pop-up over a name), an entry in the search box's
  // drop-down (TypeaheadUser; also the @-mention suggestions while writing)
  const CARDS = '[data-testid=UserCell], [data-testid=HoverCard], [data-testid=TypeaheadUser]';
  // (a post, or a person's card: P is either; C only the card)
  const P = `html #react-root :is(article, ${CARDS})[data-ps-u]:not(#ps-a)`;
  const C = `html #react-root :is(${CARDS})[data-ps-u]:not(#ps-a)`;
  // A name link (in a notification, "Tim followed you", and a post's "Tim reposted" line): just the name
  const N = 'html #react-root a[data-ps-n][data-ps-u]:not(#ps-a)';
  const FOLLOW = '[data-testid$="-follow"], [data-testid$="-unfollow"]';
  const OUT = ':not([data-ps-quote] *)'; // (not inside the quoted post)
  const NOBTN = ':not(button *):not([role=button] *)'; // (not on X's buttons)
  const ICONS = '[role=group] svg, [data-testid=caret] svg, button[aria-label="Grok actions"] svg';
  const LINKS = '[data-testid=tweetText] a, [data-testid=tweet-text-show-more-link]';
  // (never on text you can edit, :read-write: emojis there can't be wrapped, so they'd turn into rainbow blobs
  // as you type; each part of the list gets it, before any pseudo-element)
  // (pinned rainbows: Profile Styler's seamless small rainbow (3 hue cycles in 102 px: 34 px a cycle across
  // and down), its window-sized image rounded up to whole cycles, PINNED, so where the image repeats it meets
  // itself stripe to stripe; sized to the window exactly, the rolling slid a seam across what was near it)
  const RB_P = 102 / (3 * Math.SQRT2);
  const RAVE_TILE = `repeating-linear-gradient(45deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% 60%) ${(i * RB_P / 12).toFixed(4)}px`).join(', ')})`;
  const PINNED = 'background-size: round(up, 100vw, 34px) round(up, 100vh, 34px) !important;';
  const rainbowText = (sel) => `${sel.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/(::[\w-]+)?$/, ':not(:read-write)$1')).join(', ')} { text-shadow: none !important; color: transparent !important; -webkit-text-fill-color: transparent !important;
      background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important;
      background-attachment: fixed !important; background-clip: text !important; -webkit-background-clip: text !important;
      animation: ps-text-roll .8s steps(12) infinite !important; }`;
  const bigRainbow = `background-color: transparent !important; background-image: ${RAVE_BG} !important; background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important; background-attachment: fixed !important; animation: ps-box-roll 5s steps(75) infinite !important;`;
  // A quoted post by a styled author is styled as its own item, in its author's colours, over whatever the
  // post around it gives its box: Q, one :not(#…) more than P, so its rules win inside it
  const Q = 'html #react-root [data-ps-quote][data-ps-u]:not(#ps-a):not(#ps-q)';
  // Everything a styled item gets, under its prefix X; out: what to leave out of it (a post: its quoted post,
  // which is the quoted author's, styled or not)
  const itemRules = (X, out) => `
    /* background (a colour over any rainbow the box got from the post around it) */
    ${X}[data-ps~=bg] { background-color: var(--ps-bg) !important; background-image: none !important; }
    ${X}[data-ps-r~=bg] { ${bigRainbow} }
    ${X}[data-ps-r~=bg] :is(span, time)${out} { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
    /* (pictures with see-through parts: X paints the page's colour on the layers behind a picture (avatars,
       attached photos, link-card images), which showed through as white or black patches; in a styled item
       those layers are see-through, so the item's own background shows, rainbow and all. Background colour
       only: the picture itself is a background image there, and stays) */
    ${X}:is([data-ps~=bg], [data-ps-r~=bg]) :is([data-testid^="UserAvatar-Container-"], [data-testid=tweetPhoto], [data-testid$=".media"])${out},
    ${X}:is([data-ps~=bg], [data-ps-r~=bg]) :is([data-testid^="UserAvatar-Container-"], [data-testid=tweetPhoto], [data-testid$=".media"])${out} * { background-color: transparent !important; }
    /* text: the item's own */
    /* (not X's buttons in the post, like Boost or Follow, which have their own fill; the action bar's counts yes) */
    ${X}[data-ps~=text] :is(span, time, div[dir])${out}${NOBTN}, ${X}[data-ps~=text] [role=group] span { color: var(--ps-text) !important; -webkit-text-fill-color: var(--ps-text) !important; }
    ${rainbowText(`${X}[data-ps-r~=text] :is(span, time)${out}${NOBTN}:not(:has(*)):not(#ps-b), ${X}[data-ps-r~=text] [role=group] span:not(:has(*)):not(#ps-b)`)}
    /* name, handle (marked; X draws the emoji in names as pictures, which a rainbow background would cover:
       only text spans get it) */
    ${X}[data-ps~=name] [data-ps-name]${out}:not(#ps-b), ${X}[data-ps~=name] [data-ps-name]${out} span:not(#ps-b) { color: var(--ps-name) !important; -webkit-text-fill-color: var(--ps-name) !important; background-image: none !important; }
    ${rainbowText(`${X}[data-ps-r~=name] [data-ps-name]${out} span:not(:has(*)):not(#ps-b):not(#ps-c), ${X}[data-ps-r~=name] span[data-ps-name]${out}:not(:has(*)):not(#ps-b):not(#ps-c)`)}
    /* (and its box: a cut-short handle's "…" is drawn in the box's colour) */
    ${X}[data-ps~=handle] [data-ps-handle]${out}:not(#ps-b), ${X}[data-ps~=handle] :has(> [data-ps-handle])${out}:not(#ps-b) { color: var(--ps-handle) !important; -webkit-text-fill-color: var(--ps-handle) !important; background-image: none !important; }
    ${rainbowText(`${X}[data-ps-r~=handle] [data-ps-handle]${out}:not(#ps-b):not(#ps-c)`)}
    /* links in the text */
    ${X}[data-ps~=links] :is(${LINKS})${out}:not(#ps-b), ${X}[data-ps~=links] :is(${LINKS})${out} span:not(#ps-b) { color: var(--ps-links) !important; -webkit-text-fill-color: var(--ps-links) !important; background-image: none !important; }
    ${rainbowText(`${X}[data-ps-r~=links] :is(${LINKS})${out} span:not(#ps-b):not(#ps-c)`)}
    /* the badge: the author's verified check (a rainbow one: its shape filled with the small rainbow, #ps-rb) */
    ${X}[data-ps~=badge] svg[data-ps-badge]${out}, ${X}[data-ps~=badge] svg[data-ps-badge]${out} * { color: var(--ps-badge) !important; fill: var(--ps-badge) !important; }
    ${X}[data-ps-r~=badge] svg[data-ps-badge]${out} path { fill: url(#ps-rb) !important; }
    /* action icons (and the post's ... and Grok buttons) */
    ${X}[data-ps~=icons] :is(${ICONS})${out}, ${X}[data-ps~=icons] :is(${ICONS})${out} * { color: var(--ps-icons) !important; fill: var(--ps-icons) !important; }
    ${X}[data-ps-r~=icons] :is(${ICONS})${out} path { fill: url(#ps-rb) !important; }
    /* boxes: link cards, the quoted post's box, their edges */
    ${X}[data-ps~=cards] [data-testid="card.wrapper"] { background-color: var(--ps-cards) !important; }
    ${X}[data-ps-r~=cards] [data-testid="card.wrapper"] { ${bigRainbow} }
    ${X}[data-ps~=quotes] [data-ps-quote] { background-color: var(--ps-quotes) !important; }
    ${X}[data-ps-r~=quotes] [data-ps-quote] { ${bigRainbow} }
    ${X}[data-ps-r~=quotes] [data-ps-quote] :is(span, time) { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
    ${X}[data-ps~=lines] :is([data-testid="card.wrapper"], [data-ps-quote]) { border-color: var(--ps-lines) !important; }
    ${X}[data-ps-r~=lines] :is([data-testid="card.wrapper"], [data-ps-quote]) { animation: ps-line-hue 3s steps(18) infinite; }
    ${X}[data-ps-r~=lines][data-ps-r~=cards] [data-testid="card.wrapper"]:not(#ps-l),
    ${X}[data-ps-r~=lines][data-ps-r~=quotes] [data-ps-quote]:not(#ps-l),
    ${X}[data-ps-r~=lines] [data-ps-quote][data-ps-r~=bg]:not(#ps-l):not(#ps-q):not(#ps-m) { animation: ps-box-roll 5s steps(75) infinite, ps-line-hue 3s steps(18) infinite !important; }
    ${X}[data-ps-r~=lines] :is([data-testid="card.wrapper"], [data-ps-quote]) { border-color: hsl(var(--ps-lh) 100% 60%) !important; }
  `;
  // (each ps-line-hue animation pinned to the page's time origin: every line steps through the hues together)
  addEventListener('animationstart', (e) => {
    if (!e.animationName.startsWith('ps-')) return;
    try { for (const a of e.target.getAnimations()) if (a.animationName === e.animationName && a.startTime !== 0) a.startTime = 0; } catch {}
  }, true);
  const css = document.createElement('style');
  css.id = 'ps-css';
  css.textContent = `
    @keyframes ps-text-roll { from { background-position: 0 0; } to { background-position: 34px 0; } }
    @keyframes ps-box-roll { from { background-position: calc(-30vmax / 0.9063) 0; } to { background-position: calc(-90vmax / 0.9063) 0; } }
    @property --ps-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
    @keyframes ps-line-hue { from { --ps-lh: 0deg; } to { --ps-lh: 360deg; } }
    ${itemRules(P, OUT)}
    ${itemRules(Q, '')}
    /* a styled quoted post's own box edge, in its author's lines colour */
    ${Q}[data-ps~=lines] { border-color: var(--ps-lines) !important; }
    ${Q}[data-ps-r~=lines] { animation: ps-line-hue 3s steps(18) infinite; border-color: hsl(var(--ps-lh) 100% 60%) !important; }
    /* a person's card: their Follow / Following button in their buttons colour (its label black or white to
       read on it); rainbow: the small rainbow */
    ${C}[data-ps~=buttons] :is(${FOLLOW}) { background-color: var(--ps-buttons) !important; border-color: var(--ps-buttons) !important; }
    ${C}[data-ps~=buttons] :is(${FOLLOW}) *:not(#ps-b):not(#ps-c) { color: var(--ps-on-buttons) !important; -webkit-text-fill-color: var(--ps-on-buttons) !important; background-image: none !important; }
    ${C}[data-ps-r~=buttons] :is(${FOLLOW}) { background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important; background-attachment: fixed !important; border-color: rgb(255 255 255 / .9) !important;
      animation: ps-text-roll .8s linear infinite !important; }
    ${C}[data-ps-r~=buttons] :is(${FOLLOW}) *:not(#ps-b):not(#ps-c) { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .6); }
    /* emojis stay emojis in rainbow text (wrapped by wrapEmoji) */
    /* (above the rainbow rules: P carries one :not(#…) and they add two) */
    /* name links: the name in that person's name colour, or the rainbow */
    ${N}[data-ps~=name] span:not(#ps-b) { color: var(--ps-name) !important; -webkit-text-fill-color: var(--ps-name) !important; background-image: none !important; }
    ${rainbowText(`${N}[data-ps-r~=name] span:not(:has(*)):not(#ps-b):not(#ps-c)`)}
    html #react-root :is(article, a, ${CARDS}) span:is([data-ps-emoji], [data-pst-emoji]):not(#ps-a):not(#ps-b):not(#ps-c):not(#ps-d):not(#ps-e) { color: #000 !important; -webkit-text-fill-color: #000 !important; background-image: none !important;
      background-clip: border-box !important; -webkit-background-clip: border-box !important; text-shadow: none !important; animation: none !important; }
  `;
  root.append(css);
  // each author's colours, as variables: one rule per styled author
  const vars = document.createElement('style');
  vars.id = 'ps-vars';
  root.append(vars);
  const authorRules = new Map(); // handle (lower case) → its rule
  const setAuthor = (h, st) => {
    const v = [['bg', st.bg], ['name', st.name], ['badge', st.badge], ['handle', st.handle], ['text', st.text], ['links', st.links],
      ['icons', st.icons], ['cards', st.cards], ['lines', st.lines], ['quotes', st.quotes], ['buttons', st.buttons],
      ['on-buttons', isHex(st.buttons) ? onColour(st.buttons) : null]].filter(([, c]) => isHex(c));
    const rule = `html #react-root [data-ps-u="${h}"] { ${v.map(([k, c]) => `--ps-${k}: ${c};`).join(' ')} }`;
    if (authorRules.get(h) === rule) return;
    authorRules.set(h, rule);
    vars.textContent = [...authorRules.values()].join('\n');
  };
  // the small rainbow as an SVG gradient, for icons and the badge (as Profile Styler's #pst-rb)
  {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'ps-rb'); grad.setAttribute('gradientUnits', 'userSpaceOnUse'); grad.setAttribute('spreadMethod', 'repeat');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '24'); grad.setAttribute('x2', '17'); grad.setAttribute('y2', '7');
    for (let i = 0; i <= 12; i++) {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', String(i / 12)); stop.setAttribute('stop-color', `hsl(${i * 30} 100% 60%)`);
      grad.append(stop);
    }
    const roll = document.createElementNS(NS, 'animateTransform');
    roll.setAttribute('attributeName', 'gradientTransform'); roll.setAttribute('type', 'translate');
    roll.setAttribute('from', '0 0'); roll.setAttribute('to', '17 -17'); roll.setAttribute('dur', '0.8s'); roll.setAttribute('repeatCount', 'indefinite');
    grad.append(roll);
    defs.append(grad); svg.append(defs);
    root.append(svg);
  }

  // --- the posts ----------------------------------------------------------------------------------
  const isHandle = (s) => /^@\w{1,15}$/.test((s.textContent || '').trim());
  // the post's own parts: its quoted post's box (marked, and left out), its author's picture, name line
  const parts = (art) => {
    for (const q of art.querySelectorAll('[role=link]:has([data-testid=User-Name])')) if (!q.hasAttribute('data-ps-quote')) q.setAttribute('data-ps-quote', '');
    const inQuote = (el) => !!el.closest('[data-ps-quote]');
    const av = [...art.querySelectorAll('[data-testid=Tweet-User-Avatar] img[src*="/profile_images/"]')].find((i) => !inQuote(i));
    const un = [...art.querySelectorAll('[data-testid=User-Name]')].find((u) => !inQuote(u));
    return { av, un };
  };
  // (each attribute named outright: see "Writing mods TRIF can read")
  const setHas = (el, list) => { const v = list.join(' '); if ((el.getAttribute('data-ps') || '') !== v) { if (v) el.setAttribute('data-ps', v); else el.removeAttribute('data-ps'); } };
  const setRainbow = (el, list) => { const v = list.join(' '); if ((el.getAttribute('data-ps-r') || '') !== v) { if (v) el.setAttribute('data-ps-r', v); else el.removeAttribute('data-ps-r'); } };
  const unstyle = (art) => { for (const a of ['data-ps-u', 'data-ps', 'data-ps-r']) art.removeAttribute(a); };
  const styleArt = (art, h, st) => {
    setAuthor(h, st);
    if (art.getAttribute('data-ps-u') !== h) art.setAttribute('data-ps-u', h);
    const has = ['bg', 'name', 'badge', 'handle', 'text', 'links', 'icons', 'cards', 'lines', 'quotes', 'buttons']
      .filter((k) => isHex(k === 'bg' ? st.bg : k === 'name' ? st.name : k === 'badge' ? st.badge : k === 'handle' ? st.handle : k === 'text' ? st.text
        : k === 'links' ? st.links : k === 'icons' ? st.icons : k === 'cards' ? st.cards : k === 'lines' ? st.lines : k === 'quotes' ? st.quotes : st.buttons));
    setHas(art, has);
    setRainbow(art, (st.rainbow || []).filter((k) => has.includes(k) || k === 'bg'));
  };
  // name, handle, badge in the author's name line
  const markNames = (un) => {
    const first = un.firstElementChild;
    if (first && !first.hasAttribute('data-ps-name')) first.setAttribute('data-ps-name', '');
    for (const span of un.querySelectorAll('span:not([data-ps-handle])')) if (!span.children.length && isHandle(span)) span.setAttribute('data-ps-handle', '');
    for (const svg of un.querySelectorAll('svg[data-testid=icon-verified]:not([data-ps-badge])')) svg.setAttribute('data-ps-badge', '');
  };

  // emojis inside rainbow text: each run in its own span (as Profile Styler does; X's own text node stays,
  // emptied, as an anchor; if X writes into it again, the pieces go and it's done again)
  const EMOJI = /(\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*)/gu;
  // Every emoji wrapper protects itself, inline and !important, which no stylesheet rule can beat: whatever
  // rainbow, colour or clip any rule (of this mod, Profile Styler's, Rainbow Rave's, or one written later)
  // puts on text, an emoji stays an emoji. (Its colour: CanvasText, the page's own text colour for its light
  // or dark scheme, for the few emoji that draw in one colour, like ©.)
  const protectEmoji = (s) => {
    const st = s.style;
    st.setProperty('color', 'CanvasText', 'important'); st.setProperty('-webkit-text-fill-color', 'CanvasText', 'important');
    st.setProperty('background', 'none', 'important'); st.setProperty('background-clip', 'border-box', 'important');
    st.setProperty('-webkit-background-clip', 'border-box', 'important'); st.setProperty('text-shadow', 'none', 'important');
    st.setProperty('animation', 'none', 'important'); st.setProperty('filter', 'none', 'important');
  };
  const emojiDone = new Map();
  const wrapEmoji = (scope) => {
    // (a post's own text, not its quoted post's, unless the scope is that quoted post)
    const quoteOf = (n) => n.parentElement?.closest('[data-ps-quote]') || null;
    // (also plain text sitting beside elements in the same span, like "Tim " beside Profile Styler's own
    // emoji wrappers when it got there first: the rainbow goes only on spans with nothing inside them, so text
    // left loose there would show the plain colour under the rainbow)
    const loose = (n) => !!n.data.trim() && !!n.parentElement?.children.length;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data && !emojiDone.has(n) && (/\p{Extended_Pictographic}/u.test(n.data) || loose(n))
        && !n.parentElement?.closest('[data-ps-emoji], [data-ps-txt], [data-pst-emoji], svg')
        // (not text you can edit, which wrapping would break; but a post embedded in an editor, like an article
        // draft's, is marked not editable inside it: isContentEditable goes by the nearest marking)
        && !n.parentElement?.isContentEditable
        && (quoteOf(n) === null || quoteOf(n) === scope) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    for (const node of found) {
      const made = [];
      for (const part of node.data.split(EMOJI)) {
        if (!part) continue;
        EMOJI.lastIndex = 0;
        if (EMOJI.test(part)) { EMOJI.lastIndex = 0; const s = document.createElement('span'); s.setAttribute('data-ps-emoji', ''); s.textContent = part; protectEmoji(s); made.push(s); }
        // (the text between in a span of its own: a rainbow clipped to a span's text takes in its children's
        // letters too, emoji and all, so the rainbow goes only on spans with nothing inside them)
        else { EMOJI.lastIndex = 0; const s = document.createElement('span'); s.setAttribute('data-ps-txt', ''); s.textContent = part; made.push(s); }
      }
      node.before(...made);
      emojiDone.set(node, { nodes: made });
      node.data = '';
    }
  };
  const tidyEmoji = () => {
    for (const [node, g] of emojiDone) if (!node.isConnected || node.data !== '') { g.nodes.forEach((n) => n.remove()); emojiDone.delete(node); }
  };

  // A person's card (the sidebar's "Relevant people", "You might like", Who to follow, follower lists): its
  // picture, and its handle from the picture's test id; the name is the card's first non-@ text in the link to
  // them; handle and badge as in a post
  // (one person only: a container showing several people's pictures isn't a person's card, it's a list of
  // them, like the account switcher, which X builds as a hover card; then its own people cards inside, if
  // any, are styled one by one, and the container itself not at all)
  const cardParts = (cell) => {
    const boxes = cell.querySelectorAll('[data-testid^="UserAvatar-Container-"]');
    if (new Set([...boxes].map((b) => b.dataset.testid.toLowerCase())).size !== 1) {
      if (cell.hasAttribute('data-ps-u')) unstyle(cell);
      return {};
    }
    const box = boxes[0];
    const h = /^UserAvatar-Container-(\w{1,15})$/.exec(box?.dataset.testid || '')?.[1];
    const av = cell.querySelector('img[src*="/profile_images/"]');
    if (!h || !av) return {};
    // (the name: a span with text that isn't the @handle, holding nothing but text and emoji wrappers; first
    // in the link to them, else (the search box's drop-down, whose entries have no link to the person) the
    // first such span in the card outside its buttons)
    // (a button in the card, Follow or the ✕ by a recent search, isn't the name; but a drop-down entry is a
    // button itself, picture and all, and its name is inside it)
    const nameIn = (scope) => {
      for (const s of scope.querySelectorAll('span')) {
        if (s.closest('[data-ps-emoji], [data-ps-txt], [data-pst-emoji]')) continue;
        const btn = s.closest('button, [role=button]');
        if (btn && !btn.contains(box)) continue;
        const t = (s.textContent || '').trim();
        if (t && !t.startsWith('@') && !s.querySelector('span:not([data-ps-emoji]):not([data-ps-txt]):not([data-pst-emoji])')) return s;
      }
      return null;
    };
    if (!cell.querySelector('[data-ps-name]')) {
      const link = [...cell.querySelectorAll('a[href]')].find((a) => a.getAttribute('href').toLowerCase() === `/${h.toLowerCase()}` && !a.querySelector('img'));
      const s = (link && nameIn(link)) || nameIn(cell);
      if (s) s.setAttribute('data-ps-name', '');
    }
    for (const s of cell.querySelectorAll('span:not([data-ps-handle])')) if (!s.children.length && isHandle(s)) s.setAttribute('data-ps-handle', '');
    for (const svg of cell.querySelectorAll('svg[data-testid=icon-verified]:not([data-ps-badge])')) svg.setAttribute('data-ps-badge', '');
    return { av, h: h.toLowerCase() };
  };
  // someone's style: your own, your saved one; anyone else's, what their picture carries (read once). → the
  // style, null (none), or undefined (being read: ask again next tick). Remembered by handle too (byHandle),
  // for names shown without their picture ("Tim reposted").
  const byHandle = new Map();
  const resolve = (h, av, me) => {
    const own = h === me ? mySaved(h) : null;
    if (own) { byHandle.set(h, own); return own; }
    if (!av) return byHandle.has(h) ? byHandle.get(h) : null;
    const url = big(av.src);
    const known = seenMap.get(url);
    if (known === undefined) { readCode(url); return undefined; }
    byHandle.set(h, known || null);
    return known || null;
  };
  // one post or card
  const styleOne = (el, h, av, me) => {
    const st = resolve(h, av, me);
    if (st === undefined) {
      if (el.getAttribute('data-ps-u') && el.getAttribute('data-ps-u') !== h) unstyle(el); // (reused: someone else's now)
      return;
    }
    if (st) styleArt(el, h, st); else if (el.hasAttribute('data-ps-u')) unstyle(el);
    // (any rainbow at all: its emojis wrapped, and so protected; see protectEmoji)
    if (el.getAttribute('data-ps-r')) wrapEmoji(el);
  };
  // a name link: just the name, in that person's name colour (or rainbow)
  const styleName = (a, h, av, me) => {
    const st = resolve(h, av, me);
    if (st === undefined) return;
    if (!st || !isHex(st.name)) { if (a.hasAttribute('data-ps-u')) { a.removeAttribute('data-ps-u'); a.removeAttribute('data-ps'); a.removeAttribute('data-ps-r'); } return; }
    setAuthor(h, st);
    if (a.getAttribute('data-ps-u') !== h) a.setAttribute('data-ps-u', h);
    if (!a.hasAttribute('data-ps-n')) a.setAttribute('data-ps-n', '');
    setHas(a, ['name']);
    setRainbow(a, (st.rainbow || []).includes('name') ? ['name'] : []);
    if ((st.rainbow || []).includes('name')) wrapEmoji(a);
  };
  // the links to someone in a box that are their name (not the @handle, not their picture)
  const nameLinks = (box, h) => [...box.querySelectorAll('a[href]')].filter((a) => a.getAttribute('href').toLowerCase() === `/${h}`
    && !a.querySelector('img, [data-testid^="UserAvatar-Container-"]') && !(a.textContent || '').trim().startsWith('@') && (a.textContent || '').trim());
  const tick = () => {
    try {
      tidyEmoji();
      const me = (myHandle() || '').toLowerCase();
      for (const art of document.querySelectorAll('#react-root article')) {
        const { av, un } = parts(art);
        if (!av || !un) continue;
        const h = ([...un.querySelectorAll('span')].find(isHandle)?.textContent.trim().slice(1) || '').toLowerCase();
        if (!h) continue;
        markNames(un);
        styleOne(art, h, av, me);
        // its quoted post: in the quoted author's style, when they have one
        for (const q of art.querySelectorAll('[data-ps-quote]')) {
          const qav = q.querySelector('[data-testid=Tweet-User-Avatar] img[src*="/profile_images/"]');
          const qun = q.querySelector('[data-testid=User-Name]');
          const qh = qun && ([...qun.querySelectorAll('span')].find(isHandle)?.textContent.trim().slice(1) || '').toLowerCase();
          if (!qav || !qh) continue;
          markNames(qun);
          styleOne(q, qh, qav, me);
        }
      }
      for (const cell of document.querySelectorAll(`#react-root :is(${CARDS})`)) {
        const { av, h } = cardParts(cell);
        if (av) styleOne(cell, h, av, me);
      }
      // notifications ("Tim followed you", "Tim and 3 others liked your post"): each pictured person's name
      for (const n of document.querySelectorAll('#react-root article[data-testid=notification]')) {
        for (const box of n.querySelectorAll('[data-testid^="UserAvatar-Container-"]')) {
          const h = /^UserAvatar-Container-(\w{1,15})$/.exec(box.dataset.testid || '')?.[1]?.toLowerCase();
          const av = box.querySelector('img[src*="/profile_images/"]');
          if (!h || !av) continue;
          for (const a of nameLinks(n, h)) styleName(a, h, av, me);
        }
      }
      // a post's "Tim reposted" line: no picture there, so whoever's been seen already (byHandle)
      for (const sc of document.querySelectorAll('#react-root article [data-testid=socialContext]')) {
        const a = sc.closest('a[href]') || sc.querySelector('a[href]');
        const h = /^\/(\w{1,15})$/.exec(a?.getAttribute('href') || '')?.[1]?.toLowerCase();
        if (h && (byHandle.has(h) || h === me)) styleName(a, h, null, me);
      }
    } catch (e) { window.trif?.warn('post styler', String(e)); }
  };
  setInterval(tick, 800);
  tick();
})();
