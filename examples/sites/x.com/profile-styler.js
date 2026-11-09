// ==WebMod==
// @name        Profile Styler
// @description Profiles show the colours their owners chose
// @match       https://x.com/*
// @run-at      document-idle
// @risk        1 reads profile pictures from X's image server again (at 400×400) to find style codes; restyles only those profiles' pages
// @source      trif
// @version     1
// ==/WebMod==

// Tim's. Works with Style Encoder (style-encoder.js), which stamps your style into your profile picture.
//
// A profile picture can carry a style: colour codes in its bottom-left corner, which X's round crop hides.
// On anyone's profile page (/name and its tabs), this reads that person's picture, and if the code is there,
// paints the whole page while you're on their profile (theirs only) in their colours: background, display
// name, verified badge, @handle, general text, buttons and links. Any of them can be "rainbow": the
// background is Rainbow Rave's rolling rainbow, the rest Rainbow Rave's small badge rainbow.
// On your own profile, "Style profile" (beside Edit profile) opens the editing suite: pick the colours and
// they're on at once, and stay on (your own profile shows your choice). Style Encoder stamps your choice
// into the next profile picture you upload, which is how others see it.
//
// The code: 4×4-pixel cells of a 400×400 picture, counted from the bottom-left corner (x right, y up),
// scaled with the picture (a 379 px copy reads the same):
// - six markers, x + y <= 2: (0,0) red, (1,0) magenta, (2,0) yellow, (0,1) blue, (1,1) cyan, (0,2) green;
// - colours on x + y = 4: (0,4) background, (1,3) name, (2,2) badge, (3,1) handle, (4,0) text;
//   and on x + y = 6: (0,6) buttons, (1,5) links, (2,4) side panels (the right-hand sidebar's boxes),
//   (3,3) menu icons (the left-hand menu's), (4,2) logo, (5,1) cards (pop-ups, boxes in posts, the panel),
//   (6,0) lines (borders and dividers); then (3,7) quoted posts;
// - rainbow flags, one per colour in that order, white = rainbow, black = not: x + y = 8, (0,8) to (8,0),
//   then (0,10) for the logo, (1,9) for cards, (2,8) for lines, (4,6) for quoted posts.
//   (A picture stamped before buttons, links and rainbows existed has neither black nor white there: then
//   only its first five colours apply; before side panels, the first seven; before icons and logo, eight.)
// Colours are any of the 16.7 million, read from the middle of each cell. X keeps many profile pictures as
// PNG (lossless, as Style Encoder uploads them): then the markers come back pixel-perfect and every colour
// is read exactly. When X recompresses as JPEG, small cells smear by up to ~45 per channel (measured on
// x.com, 2026-11-09: markers survive JPEG at 50% and shrinking to 379 px; free colours don't), so then each
// colour is read to the nearest of a 64-colour palette (each channel 0, 85, 170 or 255): close, not exact.
// Shared with style-encoder.js: STORE, the layout.
//
// Reads the picture with an <img crossOrigin="anonymous"> from pbs.twimg.com (X's own image server, which
// allows it), at 400×400: the same kind of image request X makes itself. Nothing is sent anywhere else.

(() => {
  if (window.top !== window) return;
  const STORE = 'trifProfileStyler.mine'; // your choice (Style Encoder reads it too)
  const FIELDS = [['bg', 'Background'], ['name', 'Name'], ['badge', 'Badge'], ['handle', 'Handles'], ['text', 'Text'], ['buttons', 'Buttons'],
    ['links', 'Links'], ['panel', 'Side panels'], ['icons', 'Menu items'], ['logo', 'Logo'], ['cards', 'Cards'], ['lines', 'Lines'], ['quotes', 'Quoted posts']];
  const KEYS = FIELDS.map(([k]) => k);
  const MARKERS = [[0, 0, [255, 0, 0]], [1, 0, [255, 0, 255]], [2, 0, [255, 255, 0]], [0, 1, [0, 0, 255]], [1, 1, [0, 255, 255]], [0, 2, [0, 255, 0]]];
  const CELLS = [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0], [0, 6], [1, 5], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0], [3, 7]]; // (in KEYS order)
  const FLAGS = [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1], [8, 0], [0, 10], [1, 9], [2, 8], [4, 6]]; // (in KEYS order)
  const LEVELS = [0, 85, 170, 255];
  const snap = (v) => LEVELS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const rgbOf = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null; };
  const snapHex = (h) => { const c = rgbOf(h); return c ? hex(c.map(snap)) : null; };
  // a style: { bg, name, badge, handle, text, buttons, links: '#rrggbb' or null, rainbow: [keys] }
  // (fields read and set by name, not obj[key]: TRIF reads a run-time key as maybe setting an address)
  const get = (st, k) => (k === 'bg' ? st.bg : k === 'name' ? st.name : k === 'badge' ? st.badge : k === 'handle' ? st.handle
    : k === 'text' ? st.text : k === 'buttons' ? st.buttons : k === 'links' ? st.links : k === 'panel' ? st.panel : k === 'icons' ? st.icons : k === 'logo' ? st.logo : k === 'cards' ? st.cards : k === 'lines' ? st.lines : st.quotes);
  const withField = (st, k, v) => ({ ...st, ...(k === 'bg' ? { bg: v } : k === 'name' ? { name: v } : k === 'badge' ? { badge: v }
    : k === 'handle' ? { handle: v } : k === 'text' ? { text: v } : k === 'buttons' ? { buttons: v } : k === 'links' ? { links: v }
    : k === 'panel' ? { panel: v } : k === 'icons' ? { icons: v } : k === 'logo' ? { logo: v } : k === 'cards' ? { cards: v } : k === 'lines' ? { lines: v } : { quotes: v }) });
  const fromList = (v, rainbow) => ({ bg: v[0], name: v[1], badge: v[2], handle: v[3], text: v[4], buttons: v[5], links: v[6], panel: v[7],
    icons: v[8], logo: v[9], cards: v[10], lines: v[11], quotes: v[12], rainbow });
  const root = document.documentElement;

  // --- reading a picture's code ------------------------------------------------------------------
  const decoded = new Map(); // picture url → style, or null (no code), or a Promise while reading
  const readCode = (url) => {
    if (decoded.has(url)) return decoded.get(url);
    const p = new Promise((resolve) => {
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight, s = W / 100;
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          // a cell's colour: the average of its middle half (away from its smeared edges)
          const cell = (x, y) => {
            const x0 = Math.floor((x + 0.25) * s), y0 = Math.floor(H - (y + 0.75) * s), n = Math.max(1, Math.round(s / 2));
            const d = g.getImageData(x0, y0, n, n).data, sum = [0, 0, 0];
            for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
            const k = d.length / 4;
            return sum.map((v) => v / k);
          };
          if (!MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) < 90))) { resolve(null); return; }
          // Lossless (X kept the picture a PNG: the markers come back pixel-perfect): every colour exactly.
          // Smeared (X made it a JPEG): each to the nearest of the 64-colour palette, close but not exact.
          const lossless = MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) <= 4));
          const colours = CELLS.map(([x, y]) => hex(lossless ? cell(x, y) : cell(x, y).map(snap)));
          const flags = FLAGS.map(([x, y]) => { const c = cell(x, y), lum = (c[0] + c[1] + c[2]) / 3, spread = Math.max(...c) - Math.min(...c); return spread > 60 ? null : lum > 200 ? true : lum < 55 ? false : null; });
          // (older codes: before buttons, links and rainbows, the first five colours only; before side panels,
          // the first seven)
          // (and before menu icons and logo, the first eight)
          const upTo = (n) => fromList(colours.map((c, i) => (i < n ? c : null)), KEYS.slice(0, n).filter((k, i) => flags[i]));
          if (flags.slice(0, 7).some((f) => f === null)) { resolve(fromList(colours.map((c, i) => (i < 5 ? c : null)), [])); return; }
          if (flags[7] === null) { resolve(upTo(7)); return; }
          if (flags[8] === null || flags[9] === null) { resolve(upTo(8)); return; }
          if (flags[10] === null) { resolve(upTo(10)); return; } // (before cards)
          if (flags[11] === null) { resolve(upTo(11)); return; } // (before lines)
          if (flags[12] === null) { resolve(upTo(12)); return; } // (before quoted posts)
          resolve(upTo(13));
        } catch (e) { window.trif?.warn('could not read a profile picture', String(e)); resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }).then((v) => { decoded.set(url, v); return v; });
    decoded.set(url, p);
    return p;
  };

  // --- which profile we're on --------------------------------------------------------------------
  const NOT_PROFILE = /^(home|explore|notifications|messages|i|settings|search|compose|bookmarks|lists|communities|jobs|premium|hashtag|login|logout|signup|tos|privacy|chat|grok|account|intent|share|download)$/i;
  const profileHandle = () => {
    const m = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights|articles|superfollows|affiliates|verified_followers|followers|following|followers_you_follow))?\/?$/.exec(location.pathname);
    return m && !NOT_PROFILE.test(m[1]) ? m[1] : null;
  };
  const myHandle = () => {
    const t = document.querySelector('[data-testid=SideNav_AccountSwitcher_Button] [data-testid^="UserAvatar-Container-"]')?.dataset.testid || '';
    return /^UserAvatar-Container-(\w+)$/.exec(t)?.[1] || null;
  };
  // the profile's own picture (the big one in its header; its link is /name/photo), at 400×400
  const headerPicture = (handle) => {
    for (const a of document.querySelectorAll('[data-testid=primaryColumn] a[href$="/photo"]')) {
      if (a.getAttribute('href').toLowerCase() !== `/${handle.toLowerCase()}/photo`) continue;
      const src = a.querySelector('img[src*="/profile_images/"]')?.src;
      if (src) return src.replace(/_(normal|bigger|mini|x96|200x200|400x400)(\.\w+)(\?.*)?$/, '_400x400$2');
    }
    return null;
  };

  // --- painting the page -------------------------------------------------------------------------
  // The colours go in CSS variables on <html>; html[data-pst-on] switches the rules on, and one attribute
  // per colour says which are set (data-pst-has-*) and which are rainbow (data-pst-r-*). Name and handle
  // are found by their text (the @ one is the handle) and marked. Rules are prefixed with #react-root so
  // they outrank X-Flyer's white theme (which restyles every element under it); never all of <body>: X
  // computes a request signature from hidden test elements there (see rainbow-rave.js).
  const RAVE_BG = `repeating-linear-gradient(115deg,
    hsl(0 100% 65%) 0, hsl(30 100% 62%) 5vmax, hsl(60 100% 58%) 10vmax, hsl(90 100% 58%) 15vmax,
    hsl(120 100% 60%) 20vmax, hsl(150 100% 58%) 25vmax, hsl(180 100% 58%) 30vmax, hsl(210 100% 65%) 35vmax,
    hsl(240 100% 72%) 40vmax, hsl(270 100% 70%) 45vmax, hsl(300 100% 68%) 50vmax, hsl(330 100% 66%) 55vmax,
    hsl(360 100% 65%) 60vmax)`; // (Rainbow Rave's background)
  const RAVE_SMALL = `repeating-linear-gradient(45deg,
    hsl(0 100% 60%) 0px, hsl(30 100% 60%) 2px, hsl(60 100% 60%) 4px, hsl(90 100% 60%) 6px, hsl(120 100% 60%) 8px,
    hsl(150 100% 60%) 10px, hsl(180 100% 60%) 12px, hsl(210 100% 60%) 14px, hsl(240 100% 60%) 16px,
    hsl(270 100% 60%) 18px, hsl(300 100% 60%) 20px, hsl(330 100% 60%) 22px, hsl(360 100% 60%) 24px)`; // (its badge rainbow)
  // The small rainbow as a seamless tile, for anything that tiles it (a box that isn't pinned to the window):
  // a tile exactly 3 hue cycles across, 102 px, so neighbouring tiles meet stripe to stripe at any size (the
  // 96 px tiles were 2.83 cycles across and left a seam every 96 px). Its stripes are 24.04 px apart on the
  // diagonal, so one cycle is an exact 17 px step across and down (see pst-small-roll).
  const RB_P = 102 / (3 * Math.SQRT2); // (24.0416 px: one hue cycle along the 45° line)
  const RAVE_TILE = `repeating-linear-gradient(45deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% 60%) ${(i * RB_P / 12).toFixed(4)}px`).join(', ')})`;
  const TILE = '102px 102px';
  const CHECK_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'%3E%3Cpath fill='white' d='M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z'/%3E%3C/svg%3E")`;
  const ON = 'html[data-pst-on] #react-root';
  const BUTTONS = `:is([data-testid$="-follow"], [data-testid$="-unfollow"], [data-testid=editProfileButton],
    [data-testid=tweetButtonInline], [data-testid=tweetButton], [data-testid=SideNav_NewTweet_Button], #pst-toggle)`;
  const ICONS = `header[role=banner] nav :is(a, button):not([data-testid=SideNav_NewTweet_Button]) svg:not(.tss-logo-bird),
    [data-pst-solid] button svg, article [data-testid=caret] svg, article button[aria-label="Grok actions"] svg,
    :has(> [data-testid=userActions]) button:not([data-testid$="-follow"], [data-testid$="-unfollow"]) svg`;
  // (the round icon buttons in a profile's header, beside Follow/Subscribe: their outlines too; the bell is
  // wrapped a level deeper than the others)
  const ICON_BUTTONS = ':has(> [data-testid=userActions]) button:not([data-testid$="-follow"], [data-testid$="-unfollow"])';
  // X's dividers: the column's edges, the lines between posts, the bar over the profile's tabs, the sidebar's
  // boxes and search field, the boxes in posts, the top bar
  const LINES = `[data-testid=primaryColumn], [data-testid=cellInnerDiv] > div, :has(> nav [role=tablist]), [data-pst-card], [data-pst-solid],
    [data-testid="card.wrapper"], article [role=link]:has([data-testid=User-Name])`;
  const CARDS = `[role=menu], [data-testid=HoverCard], [role=listbox], [data-testid=Dropdown], [data-testid=sheetDialog],
    [aria-labelledby=modal-header], [role=dialog] > div > div, [data-testid="card.wrapper"]`;
  const QUOTES = 'article [role=link]:has([data-testid=User-Name])'; // (a quoted post: the box in a post with its own name line)
  const LINKS = `:is([data-testid=tweetText] a, [data-testid=UserDescription] a, [data-testid=UserUrl], [data-testid=UserProfileHeader_Items] a,
    [data-testid=tweet-text-show-more-link], a[href*="/hashtag/"])`;
  // small rainbow on text (Rainbow Rave's badge rainbow, clipped to the letters, rolling), on leaf spans only
  // (an element's own background image would cover pictures X draws as backgrounds)
  // (pinned to the window, background-attachment: fixed: text of any length is covered, and all of it shares
  // one rainbow; it rolls one 24px stripe (33.94px across) every 0.8s, in steps to keep the redraws cheap)
  // (and no drop shadow: a text shadow paints over a background clipped to the letters, muddying the
  // rainbow; :not(#pst-never) lifts these rules above the shadow ones, see SHADOW)
  const rainbowText = (sel) => `${sel.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/(::[\w-]+)?$/, ':not(#pst-never)$1')).join(', ')} { text-shadow: none !important; color: transparent !important; -webkit-text-fill-color: transparent !important;
      background-image: ${RAVE_SMALL} !important; background-size: auto !important; background-repeat: repeat !important;
      background-attachment: fixed !important; background-clip: text !important; -webkit-background-clip: text !important;
      animation: pst-text-roll .8s steps(12) infinite !important; }`;
  const css = document.createElement('style');
  css.textContent = `
    /* (one hue cycle of RAVE_TILE: an exact 17 px across and up) */
    @keyframes pst-small-roll { from { background-position: -40px -20px; } to { background-position: -23px -37px; } }
    @keyframes pst-text-roll { from { background-position: 0 0; } to { background-position: 33.941px 0; } }
    @property --pst-lh { syntax: '<angle>'; inherits: true; initial-value: 0deg; }
    @keyframes pst-line-hue { from { --pst-lh: 0deg; } to { --pst-lh: 360deg; } }
    @keyframes pst-box-roll { from { background-position: 0 0; } to { background-position: calc(-60vmax / 0.9063) 0; } }
    @keyframes pst-panel-roll { from { background-position: calc(-30vmax / 0.9063) 0; } to { background-position: calc(-90vmax / 0.9063) 0; } }
    @keyframes pst-big-roll { from { transform: translateX(0); } to { transform: translateX(calc(-60vmax / 0.9063)); } }
    /* background: the page in one colour (X's own panels see-through), pop-ups on it too */
    html[data-pst-on][data-pst-has-bg]:not([data-pst-r-bg]), html[data-pst-on][data-pst-has-bg]:not([data-pst-r-bg]) body { background-color: var(--pst-bg) !important; }
    html[data-pst-on][data-pst-has-bg] #react-root, html[data-pst-on][data-pst-has-bg] #react-root * { background-color: transparent !important; backdrop-filter: none !important; }
    html[data-pst-on][data-pst-has-bg]:not([data-pst-r-bg]) #react-root :is([role=menu], [data-testid=HoverCard], [role=listbox], [data-testid=sheetDialog],
      [aria-labelledby=modal-header], [role=dialog] > div > div, [data-pst-solid]) { background-color: var(--pst-bg) !important; }
    /* rainbow background: Rainbow Rave's, rolling on a fixed layer behind everything; pop-ups dark and frosted */
    html[data-pst-on][data-pst-r-bg], html[data-pst-on][data-pst-r-bg] body { background-color: #000 !important; }
    html[data-pst-on][data-pst-r-bg]::before { content: ''; position: fixed; top: 0; bottom: 0; left: 0; z-index: -1; pointer-events: none;
      width: calc(100vw + 70vmax); background: ${RAVE_BG}; will-change: transform; animation: pst-big-roll 5s steps(75) infinite; }
    html[data-pst-on][data-pst-r-bg] #react-root :is([role=menu], [data-testid=HoverCard], [role=listbox], [data-testid=sheetDialog],
      [aria-labelledby=modal-header], [role=dialog] > div > div) { background-color: rgb(0 0 0 / .72) !important; backdrop-filter: blur(12px) !important; }
    /* text: everything on the page; then name, handle, links on top */
    html[data-pst-on][data-pst-has-text] #react-root :is(span, time, div, h2) { color: var(--pst-text) !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-text] #react-root :is(span, time):not(:has(img, svg, video))')}
    /* (the name: in the profile's header, and the owner's name on each of their posts; not the badge beside it) */
    /* the search field: what you type, its "Search" placeholder and its magnifier, in the text colour (rainbow
       text: a field can't take a clipped background, so it cycles through the hues, like rainbow lines) */
    /* (::placeholder on its own: a pseudo-element can't go inside :is()) */
    html[data-pst-on][data-pst-has-text] #react-root [data-testid=SearchBox_Search_Input],
    html[data-pst-on][data-pst-has-text] #react-root [data-testid=SearchBox_Search_Input]::placeholder { color: var(--pst-text) !important; -webkit-text-fill-color: var(--pst-text) !important; opacity: 1 !important; }
    html[data-pst-on][data-pst-has-text] #react-root form[role=search] svg { color: var(--pst-text) !important; fill: var(--pst-text) !important; }
    html[data-pst-on][data-pst-r-text] { animation: pst-line-hue 3s steps(18) infinite; }
    html[data-pst-on][data-pst-r-text] #react-root [data-testid=SearchBox_Search_Input],
    html[data-pst-on][data-pst-r-text] #react-root [data-testid=SearchBox_Search_Input]::placeholder { color: hsl(var(--pst-lh) 100% 60%) !important; -webkit-text-fill-color: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-r-text] #react-root form[role=search] svg { color: hsl(var(--pst-lh) 100% 60%) !important; fill: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-has-name] #react-root [data-pst-name], html[data-pst-on][data-pst-has-name] #react-root [data-pst-name] :not(svg, svg *) { color: var(--pst-name) !important; -webkit-text-fill-color: var(--pst-name) !important; background-image: none !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-name] #react-root [data-pst-name], html[data-pst-on][data-pst-r-name] #react-root [data-pst-name] :not(svg, svg *)')}
    html[data-pst-on][data-pst-has-handle] #react-root [data-pst-handle] { color: var(--pst-handle) !important; -webkit-text-fill-color: var(--pst-handle) !important; background-image: none !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-handle] #react-root [data-pst-handle]')}
    html[data-pst-on][data-pst-has-links] #react-root ${LINKS}, html[data-pst-on][data-pst-has-links] #react-root ${LINKS} span { color: var(--pst-links) !important; -webkit-text-fill-color: var(--pst-links) !important; background-image: none !important; }
    ${rainbowText(`html[data-pst-on][data-pst-r-links] #react-root ${LINKS} span, html[data-pst-on][data-pst-r-links] #react-root ${LINKS}:not(:has(span))`)}
    /* side panels: the right-hand sidebar's boxes and its search field (marked by mark()); rainbow: Rainbow
       Rave's big rainbow, pinned to the window and half a stripe ahead of the page's, like its menus */
    html[data-pst-on][data-pst-has-panel] #react-root [data-pst-card] { background-color: var(--pst-panel) !important; }
    html[data-pst-on][data-pst-r-panel] #react-root [data-pst-card] { background-color: transparent !important; background-image: ${RAVE_BG} !important;
      background-size: calc(100vw + 140vmax) 100vh !important; background-repeat: no-repeat !important; background-attachment: fixed !important;
      animation: pst-panel-roll 5s steps(75) infinite !important; }
    /* the left-hand menu's icons (not the Post button: that's a button), and the logo above them (X's, or
       Detox Timeline's "x"; X-Flyer's bird logo keeps its own colours). Rainbow: the small rainbow as an SVG
       gradient fill (#pst-rb, see below), which works on any icon's shape */
    /* (menu items: the left menu's icons, the top bar's buttons (back, search...), and each post's Grok and
       "..." buttons) */
    html[data-pst-on][data-pst-has-icons] #react-root :is(${ICONS}),
    html[data-pst-on][data-pst-has-icons] #react-root :is(${ICONS}) * { color: var(--pst-icons) !important; fill: var(--pst-icons) !important; }
    html[data-pst-on][data-pst-r-icons] #react-root :is(${ICONS}) path { fill: url(#pst-rb) !important; }
    html[data-pst-on][data-pst-has-icons] #react-root ${ICON_BUTTONS} { border-color: var(--pst-icons) !important; }
    html[data-pst-on][data-pst-r-icons] #react-root ${ICON_BUTTONS} { border-color: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-r-icons] { animation: pst-line-hue 3s steps(18) infinite; }
    html[data-pst-on][data-pst-has-logo] #react-root header[role=banner] h1 a[href="/home"] svg:not(.tss-logo-bird),
    html[data-pst-on][data-pst-has-logo] #react-root header[role=banner] h1 a[href="/home"] svg:not(.tss-logo-bird) *,
    html[data-pst-on][data-pst-has-logo] #react-root header[role=banner] h1 a[href="/home"] > div { color: var(--pst-logo) !important; fill: var(--pst-logo) !important; }
    html[data-pst-on][data-pst-r-logo] #react-root header[role=banner] h1 a[href="/home"] svg:not(.tss-logo-bird) path { fill: url(#pst-rb) !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-logo] #react-root header[role=banner] h1 a[href="/home"] > div::after')}
    /* cards: pop-ups (menus, hover cards, dropdowns, dialogs), the boxes in posts (quoted posts, link previews),
       and this mod's own Style profile panel (its text black or white to read on it); rainbow: the big
       rainbow, pinned to the window and half a stripe ahead, like Rainbow Rave's menus */
    html[data-pst-on][data-pst-has-cards] #react-root :is(${CARDS}),
    html[data-pst-on][data-pst-has-cards] #pst-panel { background-color: var(--pst-cards) !important; }
    html[data-pst-on][data-pst-has-cards] #pst-panel :is(h3, .pst-row > span, p) { color: var(--pst-on-cards) !important; }
    html[data-pst-on][data-pst-r-cards] #react-root :is(${CARDS}), html[data-pst-on][data-pst-r-cards] #pst-panel {
      background-color: transparent !important; background-image: ${RAVE_BG} !important; background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important; background-attachment: fixed !important; animation: pst-panel-roll 5s steps(75) infinite !important; }
    html[data-pst-on][data-pst-r-cards] #pst-panel :is(h3, .pst-row > span, p) { color: #fff !important; text-shadow: 0 1px 3px rgb(0 0 0 / .7); }
    /* lines: every border and divider (buttons keep theirs, above); rainbow: they all cycle through the hues
       together (a hue in a registered custom property, stepping 6 times a second: one variable, not an
       animation per element; striped borders would square off X's rounded boxes) */
    /* (X's own dividers only: many of its buttons have an invisible border, which every-border showed as
       rings round the icons) */
    html[data-pst-on][data-pst-has-lines] #react-root :is(${LINES}) { border-color: var(--pst-lines) !important; }
    html[data-pst-on][data-pst-has-lines] #react-root [role=separator] { background-color: var(--pst-lines) !important; }
    html[data-pst-on][data-pst-r-lines] { animation: pst-line-hue 3s steps(18) infinite; }
    html[data-pst-on][data-pst-r-lines] #react-root :is(${LINES}) { border-color: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-r-lines] #react-root [role=separator] { background-color: hsl(var(--pst-lh) 100% 60%) !important; }
    /* the bar along the top of the column (X's sticky, see-through one behind the name): solid, in the
       background colour, or the background's rainbow (marked by mark()) */
    html[data-pst-on][data-pst-has-bg]:not([data-pst-r-bg]) #react-root [data-pst-solid] { background-color: var(--pst-bg) !important; }
    html[data-pst-on][data-pst-r-bg] #react-root [data-pst-solid] { background-color: transparent !important; background-image: ${RAVE_BG} !important;
      background-size: calc(100vw + 140vmax) 100vh !important; background-repeat: no-repeat !important; background-attachment: fixed !important;
      animation: pst-box-roll 5s steps(75) infinite !important; }
    /* quoted posts: the box a post quotes another in; rainbow: the big rainbow, like cards */
    html[data-pst-on][data-pst-has-quotes] #react-root :is(${QUOTES}) { background-color: var(--pst-quotes) !important; }
    html[data-pst-on][data-pst-r-quotes] #react-root :is(${QUOTES}) {
      background-color: transparent !important; background-image: ${RAVE_BG} !important; background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important; background-attachment: fixed !important; animation: pst-panel-roll 5s steps(75) infinite !important; }
    /* SHADOW: text on a rainbow (the background, side panels, cards, quoted posts, the top bar) gets a soft
       dark drop shadow to stand out; not rainbow text (see rainbowText) */
    html[data-pst-on][data-pst-r-bg] #react-root :is(span, time, h2),
    html[data-pst-on][data-pst-r-panel] #react-root [data-pst-card] :is(span, time, h2, input),
    html[data-pst-on][data-pst-r-cards] #react-root :is(${CARDS}) :is(span, time, h2),
    html[data-pst-on][data-pst-r-quotes] #react-root :is(${QUOTES}) :is(span, time, h2) { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
    /* notifications: the unread-count bubbles and dots in the left menu, in the badge colour (its number in
       black or white to read on it); rainbow: the small rainbow */
    html[data-pst-on][data-pst-has-badge] #react-root header[role=banner] [aria-label*="unread" i]:not(a) { background-color: var(--pst-badge) !important; border-color: var(--pst-bg, transparent) !important; }
    /* (its number in the text colour) */
    html[data-pst-on][data-pst-has-badge] #react-root header[role=banner] [aria-label*="unread" i]:not(a) * { color: var(--pst-text, var(--pst-on-badge)) !important; -webkit-text-fill-color: var(--pst-text, var(--pst-on-badge)) !important; background-image: none !important; text-shadow: none !important; }
    html[data-pst-on][data-pst-r-badge] #react-root header[role=banner] [aria-label*="unread" i]:not(a) { background-image: ${RAVE_TILE} !important; background-size: ${TILE} !important; background-repeat: repeat !important; animation: pst-small-roll .8s linear infinite !important; }
    html[data-pst-on][data-pst-r-badge] #react-root header[role=banner] [aria-label*="unread" i]:not(a) * { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .7) !important; }
    /* emojis stay emojis inside rainbow text (each wrapped in its own span by wrapEmoji; :not(#a):not(#b)
       lifts this above the rainbow rules, which are lifted once) */
    /* (a solid colour of its own: the rainbow's is transparent, and an emoji drawn in "transparent" vanishes;
       colour emoji draw in their own colours whatever this is) */
    html #react-root span[data-pst-emoji]:not(#pst-a):not(#pst-b) { color: #000 !important; -webkit-text-fill-color: #000 !important; background-image: none !important;
      background-clip: border-box !important; -webkit-background-clip: border-box !important; text-shadow: none !important; animation: none !important; }
    /* the badge: the profile's verified check */
    /* (the header's check, and the sidebar's: "You might like" and the like) */
    html[data-pst-on][data-pst-has-badge] #react-root :is([data-testid=UserName], [data-testid=sidebarColumn]) svg[data-testid=icon-verified] { color: var(--pst-badge) !important; fill: var(--pst-badge) !important; }
    html[data-pst-on][data-pst-r-badge] #react-root :is([data-testid=UserName], [data-testid=sidebarColumn]) :has(> svg[data-testid=icon-verified]) { position: relative !important; }
    html[data-pst-on][data-pst-r-badge] #react-root :is([data-testid=UserName], [data-testid=sidebarColumn]) svg[data-testid=icon-verified] { opacity: 0 !important; }
    html[data-pst-on][data-pst-r-badge] #react-root :is([data-testid=UserName], [data-testid=sidebarColumn]) :has(> svg[data-testid=icon-verified])::after {
      content: ''; position: absolute; inset: 0; pointer-events: none; background-image: ${RAVE_TILE}; background-size: ${TILE}; background-repeat: repeat;
      animation: pst-small-roll .8s linear infinite; -webkit-mask: ${CHECK_MASK} center / contain no-repeat; mask: ${CHECK_MASK} center / contain no-repeat; }
    /* buttons: their fill and edge; their text in the page's background colour */
    html[data-pst-on][data-pst-has-buttons] #react-root ${BUTTONS}, html[data-pst-on][data-pst-has-buttons] ${BUTTONS} { background-color: var(--pst-buttons) !important; border-color: var(--pst-buttons) !important; }
    html[data-pst-on][data-pst-has-buttons] #react-root ${BUTTONS} *, html[data-pst-on][data-pst-has-buttons] ${BUTTONS} { color: var(--pst-on-buttons) !important; -webkit-text-fill-color: var(--pst-on-buttons) !important; background-image: none !important; }
    html[data-pst-on][data-pst-r-buttons] #react-root ${BUTTONS}, html[data-pst-on][data-pst-r-buttons] ${BUTTONS} {
      /* (pinned to the window like the rainbow text: a 96px tile left a seam rolling across wider buttons) */
      background-image: ${RAVE_SMALL} !important; background-size: auto !important; background-repeat: repeat !important;
      background-attachment: fixed !important; border-color: rgb(255 255 255 / .9) !important;
      animation: pst-text-roll .8s linear infinite !important; }
    html[data-pst-on][data-pst-r-buttons] #react-root ${BUTTONS} *, html[data-pst-on][data-pst-r-buttons] ${BUTTONS} { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .6); }
    /* "Style profile", beside X's "Edit profile" in your profile's header, in its shape (its colours copied
       from it as it's placed, see placeToggle) */
    #pst-toggle { display: inline-flex; align-items: center; height: 36px; padding: 0 16px; margin-right: 8px; border-radius: 9999px;
      border: 1px solid var(--pst-btn-border, #cfd9de); background: transparent; color: var(--pst-btn-color, inherit);
      font: 700 15px TwitterChirp, -apple-system, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    #pst-toggle:hover { filter: brightness(1.1); }
    #pst-toggle .pst-state { display: inline-flex; margin-left: 6px; }
    #pst-toggle .pst-state svg { display: none; width: 16px; height: 16px; fill: currentColor; }
    #pst-toggle .pst-state[data-state=public] .pst-public, #pst-toggle .pst-state[data-state=edited] .pst-edited { display: block; }
    #pst-panel { position: fixed; top: var(--pst-panel-top, 100px); right: var(--pst-panel-right, 16px); z-index: 2147483646; width: 330px; padding: 12px 14px; border-radius: 16px;
      background: #fff; color: #0f1419; box-shadow: 0 4px 24px rgb(0 0 0 / .25); font: 13px -apple-system, system-ui, sans-serif; }
    #pst-panel h3 { margin: 0 0 8px; font-size: 15px; }
    /* two columns of name, swatch, rainbow: each name column only as wide as its longest name, so the
       swatches sit right by their names (the rows themselves are just their three cells: display: contents) */
    #pst-panel .pst-grid { display: grid; grid-template-columns: repeat(2, auto 36px 26px); column-gap: 4px; row-gap: 7px;
      align-items: center; justify-content: start; margin: 4px 0 2px; }
    #pst-panel .pst-row { display: contents; }
    #pst-panel .pst-row > span { white-space: nowrap; }
    #pst-panel .pst-row:nth-child(even) > span { margin-left: 12px; }
    #pst-panel input[type=color] { width: 36px; height: 26px; border: 1px solid #cfd9de; border-radius: 6px; padding: 0; background: none; cursor: pointer; }
    #pst-panel input[type=color].pst-off { opacity: .35; }
    #pst-panel input[type=color].pst-off:hover { opacity: .8; }
    /* (a faint rainbow always, so it reads as "rainbow"; full and rolling when on) */
    #pst-panel .pst-rb { width: 26px; flex: none; height: 26px; border-radius: 6px; border: 1px solid #cfd9de; cursor: pointer; font-size: 0;
      background-image: linear-gradient(rgb(255 255 255 / .72), rgb(255 255 255 / .72)), ${RAVE_TILE}; background-size: auto, ${TILE}; }
    #pst-panel .pst-rb:hover { background-image: linear-gradient(rgb(255 255 255 / .5), rgb(255 255 255 / .5)), ${RAVE_TILE}; }
    #pst-panel .pst-rb[aria-pressed=true] { background-image: ${RAVE_TILE}; background-size: ${TILE}; border-color: #0f1419; animation: pst-small-roll .8s linear infinite; }
    #pst-panel .pst-reset { margin-right: 6px; }
    #pst-panel .pst-reset:disabled { opacity: .4; cursor: default; }
    #pst-panel p { margin: 10px 0 0; color: #536471; font-size: 12px; line-height: 1.35; }
    #pst-panel .pst-reset { margin-top: 8px; font: inherit; font-weight: 700; padding: 5px 10px; border-radius: 9999px; border: 1px solid #cfd9de; background: #fff; cursor: pointer; }
  `;
  root.append(css);
  // The small rainbow as an SVG gradient, for icons (an SVG shape can't take a CSS background): one hue cycle
  // across a 24-unit icon, rolling one cycle every 0.8 s, like Rainbow Rave's badge rainbow
  {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'pst-rb'); grad.setAttribute('gradientUnits', 'userSpaceOnUse'); grad.setAttribute('spreadMethod', 'repeat');
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

  // the text colour that reads on a colour (for button labels): black or white
  const onColour = (h) => { const c = rgbOf(h); return !c || (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) > 150 ? '#0f1419' : '#ffffff'; };
  let applied = null; // the style on show
  const apply = (st) => {
    applied = st;
    root.toggleAttribute('data-pst-on', !!st);
    const r = st?.rainbow || [];
    // (each attribute and variable by name: see get)
    root.toggleAttribute('data-pst-has-bg', !!st?.bg); root.toggleAttribute('data-pst-has-name', !!st?.name);
    root.toggleAttribute('data-pst-has-badge', !!st?.badge); root.toggleAttribute('data-pst-has-handle', !!st?.handle);
    root.toggleAttribute('data-pst-has-text', !!st?.text); root.toggleAttribute('data-pst-has-buttons', !!st?.buttons);
    root.toggleAttribute('data-pst-has-links', !!st?.links); root.toggleAttribute('data-pst-has-panel', !!st?.panel);
    root.toggleAttribute('data-pst-r-panel', r.includes('panel'));
    root.toggleAttribute('data-pst-has-icons', !!st?.icons); root.toggleAttribute('data-pst-r-icons', r.includes('icons'));
    root.toggleAttribute('data-pst-has-logo', !!st?.logo); root.toggleAttribute('data-pst-r-logo', r.includes('logo'));
    root.toggleAttribute('data-pst-has-cards', !!st?.cards); root.toggleAttribute('data-pst-r-cards', r.includes('cards'));
    root.toggleAttribute('data-pst-has-lines', !!st?.lines); root.toggleAttribute('data-pst-r-lines', r.includes('lines'));
    root.toggleAttribute('data-pst-has-quotes', !!st?.quotes); root.toggleAttribute('data-pst-r-quotes', r.includes('quotes'));
    root.toggleAttribute('data-pst-r-bg', r.includes('bg')); root.toggleAttribute('data-pst-r-name', r.includes('name'));
    root.toggleAttribute('data-pst-r-badge', r.includes('badge')); root.toggleAttribute('data-pst-r-handle', r.includes('handle'));
    root.toggleAttribute('data-pst-r-text', r.includes('text')); root.toggleAttribute('data-pst-r-buttons', r.includes('buttons'));
    root.toggleAttribute('data-pst-r-links', r.includes('links'));
    if (!st) return;
    if (st.bg) root.style.setProperty('--pst-bg', st.bg);
    if (st.name) root.style.setProperty('--pst-name', st.name);
    if (st.badge) { root.style.setProperty('--pst-badge', st.badge); root.style.setProperty('--pst-on-badge', onColour(st.badge)); }
    if (st.handle) root.style.setProperty('--pst-handle', st.handle);
    if (st.text) root.style.setProperty('--pst-text', st.text);
    if (st.buttons) { root.style.setProperty('--pst-buttons', st.buttons); root.style.setProperty('--pst-on-buttons', onColour(st.buttons)); }
    if (st.links) root.style.setProperty('--pst-links', st.links);
    if (st.panel) root.style.setProperty('--pst-panel', st.panel);
    if (st.icons) root.style.setProperty('--pst-icons', st.icons);
    if (st.logo) root.style.setProperty('--pst-logo', st.logo);
    if (st.cards) { root.style.setProperty('--pst-cards', st.cards); root.style.setProperty('--pst-on-cards', onColour(st.cards)); }
    if (st.lines) root.style.setProperty('--pst-lines', st.lines);
    if (st.quotes) root.style.setProperty('--pst-quotes', st.quotes);
  };
  // Emojis inside rainbow text: X draws them as plain characters, so the rainbow (clipped to the letters)
  // swallowed them into rainbow blobs. While any rainbow text is on, each run of emoji in the page's text is
  // put in its own <span data-pst-emoji>, which the CSS leaves out of the rainbow. Like X-Flyer's words:
  // X's own text node stays where it was, emptied, as an anchor; if X writes new text into it, the pieces
  // are taken out and it's done again.
  const EMOJI = /(\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*)/gu;
  const emojiDone = new Map(); // X's text node → { nodes we put before it, text it had }
  // Each wrapper protects itself, inline and !important, which no stylesheet rule can beat: whatever rainbow,
  // colour or clip any rule (this mod's, Post Styler's, Rainbow Rave's, or one written later) puts on text, an
  // emoji stays an emoji. (CanvasText: the page's text colour for its scheme, for emoji drawn in one colour.)
  const protectEmoji = (s) => {
    const st = s.style;
    st.setProperty('color', 'CanvasText', 'important'); st.setProperty('-webkit-text-fill-color', 'CanvasText', 'important');
    st.setProperty('background', 'none', 'important'); st.setProperty('background-clip', 'border-box', 'important');
    st.setProperty('-webkit-background-clip', 'border-box', 'important'); st.setProperty('text-shadow', 'none', 'important');
    st.setProperty('animation', 'none', 'important'); st.setProperty('filter', 'none', 'important');
  };
  const wrapEmoji = () => {
    for (const [node, g] of emojiDone) {
      if (!node.isConnected || node.data !== '') { g.nodes.forEach((n) => n.remove()); emojiDone.delete(node); }
    }
    const app = document.getElementById('react-root');
    if (!app) return;
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data && !emojiDone.has(n) && /\p{Extended_Pictographic}/u.test(n.data) && !n.parentElement?.closest('[data-pst-emoji], [data-ps-emoji], [contenteditable=true], input, textarea')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    for (const node of found) {
      const made = [];
      for (const part of node.data.split(EMOJI)) {
        if (!part) continue;
        if (EMOJI.test(part)) { EMOJI.lastIndex = 0; const s = document.createElement('span'); s.setAttribute('data-pst-emoji', ''); s.textContent = part; protectEmoji(s); made.push(s); }
        else { EMOJI.lastIndex = 0; made.push(document.createTextNode(part)); }
      }
      node.before(...made);
      emojiDone.set(node, { nodes: made, data: node.data });
      node.data = '';
    }
  };
  const anyRainbowText = () => ['data-pst-r-text', 'data-pst-r-name', 'data-pst-r-handle', 'data-pst-r-links'].some((a) => root.hasAttribute(a));
  // mark the name and handle in the profile's header, every @handle on the page, the owner's name on their
  // posts, and X's see-through bars in the column
  const mark = () => {
    if (root.hasAttribute('data-pst-on') && anyRainbowText()) { try { wrapEmoji(); } catch (e) { window.trif?.warn('emoji wrap', String(e)); } }
    const owner = (profileHandle() || '').toLowerCase();
    const isHandle = (s) => /^@\w{1,15}$/.test((s.textContent || '').trim());
    // every @handle by a name (posts, quoted posts, the sidebar's people): a leaf span that's just "@name"
    for (const box of document.querySelectorAll('#react-root :is([data-testid=User-Name], [data-testid=UserCell])')) {
      for (const span of box.querySelectorAll('span:not([data-pst-handle])')) if (!span.children.length && isHandle(span)) span.setAttribute('data-pst-handle', '');
    }
    // the name in the bar along the top of the profile (its title)
    const title = document.querySelector('[data-testid=primaryColumn] [data-pst-solid] h2');
    if (title && owner && !title.hasAttribute('data-pst-name')) title.setAttribute('data-pst-name', '');
    // the owner's name on their posts: the name half of the post's name line, when its handle is theirs
    for (const un of document.querySelectorAll('#react-root article [data-testid=User-Name]')) {
      const first = un.firstElementChild;
      if (!first || first.hasAttribute('data-pst-name')) continue;
      const h = [...un.querySelectorAll('span')].find(isHandle)?.textContent.trim().slice(1).toLowerCase();
      if (h && owner && h === owner) first.setAttribute('data-pst-name', '');
    }
    const un = document.querySelector('[data-testid=primaryColumn] [data-testid=UserName]');
    if (un) {
      for (const span of un.querySelectorAll('span')) {
        if (span.children.length) continue;
        const t = (span.textContent || '').trim();
        if (!t) continue;
        if (t.startsWith('@')) { if (!span.hasAttribute('data-pst-handle')) span.setAttribute('data-pst-handle', ''); }
        else if (!un.querySelector('[data-pst-name]')) span.setAttribute('data-pst-name', '');
      }
    }
    // the sidebar's boxes and search field: its rounded, bordered blocks (not its buttons), checked once each
    for (const el of document.querySelectorAll('[data-testid=sidebarColumn] div:not([data-pst-sb])')) {
      el.setAttribute('data-pst-sb', '');
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopLeftRadius) >= 12 && parseFloat(cs.borderTopWidth) > 0 && !el.closest('button, [role=button]')) el.setAttribute('data-pst-card', '');
    }
    const col = document.querySelector('[data-testid=primaryColumn]');
    if (col) {
      let level = [col];
      for (let d = 0; d < 6 && level.length; d++) {
        const next = [];
        for (const el of level) {
          if (!el.hasAttribute('data-pst-checked')) {
            el.setAttribute('data-pst-checked', '');
            // (X's see-through bars: blurred behind (backdrop-filter), or stuck to the top (position: sticky);
            // the blur can't be the only sign: our own rules take it away once a style is on)
            const cs = getComputedStyle(el), bf = cs.backdropFilter;
            if ((bf && bf !== 'none') || cs.position === 'sticky') el.setAttribute('data-pst-solid', '');
          }
          if (el.children.length < 40) next.push(...el.children);
        }
        level = next;
      }
    }
  };

  // --- your choice, and the editing suite --------------------------------------------------------
  // (one saved style per account: STORE:<handle, lower case>, for whoever's signed in; nothing before X
  // shows who that is. The style once shared by every account, plain STORE, is gone: the account it was made
  // for carries it in its picture, which is where a new account's style starts, see tick.)
  const storeKey = () => { const me = myHandle(); return me ? `${STORE}:${me.toLowerCase()}` : null; };
  try { localStorage.removeItem(STORE); } catch {}
  const loadMine = () => { try { const k = storeKey(); const v = k && JSON.parse(localStorage.getItem(k) || 'null'); return v ? { ...v, rainbow: Array.isArray(v.rainbow) ? v.rainbow : [] } : null; } catch { return null; } };
  const saveMine = (st) => { try { const k = storeKey(); if (k) localStorage.setItem(k, JSON.stringify(st)); } catch {} };
  // the page's colours as X shows them now (without ours), snapped to the palette: where your choice starts
  const xLook = () => {
    const was = root.hasAttribute('data-pst-on');
    root.removeAttribute('data-pst-on');
    const un = document.querySelector('[data-testid=primaryColumn] [data-testid=UserName]');
    const cssHex = (c) => { const m = (c || '').match(/\d+/g); return m ? hex(m.slice(0, 3).map((v) => +v)) : null; };
    const handleEl = un?.querySelector('[data-pst-handle]');
    const st = {
      bg: cssHex(getComputedStyle(document.body).backgroundColor) || '#000000',
      name: cssHex(un && getComputedStyle(un.querySelector('span') || un).color) || '#ffffff',
      badge: '#00aaff',
      handle: cssHex(handleEl && getComputedStyle(handleEl).color) || '#aaaaaa',
      text: cssHex(getComputedStyle(document.body).color) || '#ffffff',
      buttons: '#00aaff',
      links: '#00aaff',
      panel: cssHex(getComputedStyle(document.body).backgroundColor) || '#000000',
      icons: cssHex(getComputedStyle(document.body).color) || '#ffffff',
      logo: cssHex(getComputedStyle(document.body).color) || '#ffffff',
      cards: cssHex(getComputedStyle(document.body).backgroundColor) || '#000000',
      quotes: cssHex(getComputedStyle(document.body).backgroundColor) || '#000000',
      lines: cssHex(document.querySelector('[data-testid=primaryColumn]') && getComputedStyle(document.querySelector('[data-testid=primaryColumn]')).borderRightColor) || '#555555',
      rainbow: [],
    };
    root.toggleAttribute('data-pst-on', was);
    return st;
  };
  // (a saved choice from before buttons and links: filled in from X's look)
  const mine = () => { const m = loadMine(); if (!m) return null; const base = xLook(); return { ...base, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)), rainbow: m.rainbow }; };

  let panelOpen = false;
  const toggle = document.createElement('button');
  toggle.id = 'pst-toggle'; toggle.type = 'button';
  // Whether your style is out there: your picture's code compared with your saved choice. The same:
  // "public" (a globe: everyone with Profile Styler sees what you see); different, or no code: "edited"
  // (a pencil: changes not yet published, upload a new picture with Style Encoder on). Nothing while it reads.
  const stateIcon = document.createElement('span');
  stateIcon.className = 'pst-state';
  {
    const NS = 'http://www.w3.org/2000/svg';
    const icon = (cls, d) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p);
      return svg;
    };
    stateIcon.append(
      icon('pst-public', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.9 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zM8.03 8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.03 8zM12 19.96A14.1 14.1 0 0 1 10.09 16h3.82A14.1 14.1 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38z'),
      icon('pst-edited', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'));
  }
  const label = document.createElement('span'); label.textContent = 'Style profile';
  toggle.append(label, stateIcon);
  // (each field compared by name: see get; rainbows as sets)
  const sameStyle = (a, b) => !!a && !!b && KEYS.every((k) => (get(a, k) || null) === (get(b, k) || null))
    && [...a.rainbow].sort().join() === [...b.rainbow].sort().join();
  let stateKey = '';
  const updateState = async (url) => {
    const mineNow = loadMine();
    const key = `${url}|${JSON.stringify(mineNow)}`;
    if (key === stateKey) return;
    stateKey = key;
    stateIcon.removeAttribute('data-state');
    if (!url || !mineNow) return;
    const pic = await readCode(url);
    if (key !== stateKey) return; // (changed meanwhile)
    restoreBtn.disabled = !pic; // (only when your picture carries a style)
    const live = sameStyle(pic, mine());
    stateIcon.setAttribute('data-state', live ? 'public' : 'edited');
    toggle.title = live ? 'Public: your picture carries this style, so everyone with Profile Styler sees it'
      : 'Edited: your style isn’t in your picture yet. Upload a new picture (Edit profile) with Style Encoder on to publish it';
  };
  // right before X's "Edit profile" (when it's there: X redraws the header as you move about), matching it
  const placeToggle = () => {
    const edit = document.querySelector('[data-testid=primaryColumn] [data-testid=editProfileButton]');
    if (!edit) { toggle.remove(); return false; }
    if (edit.previousElementSibling !== toggle) edit.before(toggle);
    const cs = getComputedStyle(edit), label = edit.querySelector('span') || edit;
    toggle.style.setProperty('--pst-btn-border', cs.borderTopColor);
    toggle.style.setProperty('--pst-btn-color', getComputedStyle(label).color);
    // (X gives Edit profile a margin below it, and its row lines buttons up by their bottoms: the same margins
    // keep the two level)
    toggle.style.marginTop = cs.marginTop; toggle.style.marginBottom = cs.marginBottom;
    return true;
  };
  // the panel opens just under the buttons, lined up with their right edge
  const placePanel = () => {
    const r = toggle.getBoundingClientRect();
    if (!r.width) return;
    root.style.setProperty('--pst-panel-top', `${Math.round(r.bottom + 8)}px`);
    root.style.setProperty('--pst-panel-right', `${Math.max(8, Math.round(innerWidth - (document.querySelector('[data-testid=editProfileButton]')?.getBoundingClientRect().right || r.right)))}px`);
  };
  const panel = document.createElement('div');
  panel.id = 'pst-panel';
  const pickers = new Map(), rainbows = new Map();
  const restoreBtn = document.createElement('button');
  // a change from the panel: saved, and on show at once
  const change = (fn) => { const st = fn(mine() || xLook()); saveMine(st); fill(st); apply(st); };
  {
    const h = document.createElement('h3'); h.textContent = 'Style profile';
    panel.append(h);
    // (the colours in two columns, each name close to its swatch)
    const grid = document.createElement('div'); grid.className = 'pst-grid';
    panel.append(grid);
    for (const [key, label] of FIELDS) {
      const row = document.createElement('div'); row.className = 'pst-row';
      const name = document.createElement('span'); name.textContent = label;
      const input = document.createElement('input'); input.type = 'color'; input.title = `${label} colour`;
      // (picking a colour, or just clicking the swatch while its rainbow is on, goes back to the colour)
      const noRainbow = (st) => ({ ...st, rainbow: st.rainbow.filter((k) => k !== key) });
      // (any colour: exact when X keeps the picture lossless, see readCode)
      input.addEventListener('input', () => change((st) => noRainbow(withField(st, key, (input.value || '').toLowerCase()))));
      input.addEventListener('click', () => { if ((mine() || xLook()).rainbow.includes(key)) change(noRainbow); });
      const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'pst-rb'; rb.textContent = 'Rainbow'; rb.title = `${label}: rainbow`;
      rb.addEventListener('click', () => change((st) => ({ ...st, rainbow: st.rainbow.includes(key) ? st.rainbow.filter((k) => k !== key) : [...st.rainbow, key] })));
      pickers.set(key, input); rainbows.set(key, rb);
      name.title = label; // (the full name, if a narrow column cuts it short)
      row.append(name, input, rb);
      grid.append(row);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'pst-reset'; reset.textContent = 'Revert to X default';
    reset.addEventListener('click', () => { const st = xLook(); saveMine(st); fill(st); apply(st); });
    // back to what your picture carries (what everyone sees), when it carries a style: see updateState
    restoreBtn.type = 'button'; restoreBtn.className = 'pst-reset'; restoreBtn.textContent = 'Restore from public'; restoreBtn.disabled = true;
    restoreBtn.title = 'Back to the style your profile picture carries, the one everyone sees';
    restoreBtn.addEventListener('click', async () => {
      const url = headerPicture(myHandle() || '');
      const pic = url && await readCode(url);
      if (!pic) return;
      // (a picture from before some colours existed leaves them empty: X's look fills those)
      const base = xLook();
      const st = { ...base, ...Object.fromEntries(Object.entries(pic).filter(([, v]) => v != null)), rainbow: pic.rainbow };
      saveMine(st); fill(st); apply(st);
    });
    panel.append(restoreBtn);
    const note = document.createElement('p');
    note.textContent = 'To show other TRIF users your style, save and re-upload your profile picture with the Style Encoder mod enabled.';
    panel.append(reset, note);
  }
  const fill = (st) => {
    for (const k of KEYS) {
      const v = get(st, k), on = st.rainbow.includes(k);
      if (v) pickers.get(k).value = v;
      pickers.get(k).classList.toggle('pst-off', on); // (faded, still clickable: see the swatch's click)
      rainbows.get(k).setAttribute('aria-pressed', String(on));
    }
  };
  // a click anywhere outside the panel (and its button) closes it, and so does Escape. (The colour picker's
  // own pop-up is the browser's, outside the page: picking colours there doesn't count as a click outside.)
  const closePanel = () => { if (!panelOpen) return; panelOpen = false; tick(); };
  addEventListener('pointerdown', (e) => {
    if (panelOpen && !panel.contains(e.target) && !toggle.contains(e.target)) closePanel();
  }, true);
  addEventListener('keydown', (e) => { if (panelOpen && e.key === 'Escape') closePanel(); }, true);
  toggle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    if (panelOpen) { const st = mine() || xLook(); saveMine(st); fill(st); apply(st); }
    tick();
  });

  // --- keeping up with the page (X changes pages without loading them) ----------------------------
  let lastKey = '';
  const tick = async () => {
    try {
      const handle = profileHandle();
      const own = !!handle && !!myHandle() && handle.toLowerCase() === myHandle().toLowerCase();
      // the panel's button only on your own profile, beside Edit profile
      if (own) placeToggle();
      else if (toggle.isConnected) { toggle.remove(); panelOpen = false; }
      if (panelOpen) placePanel();
      if (panelOpen && !panel.isConnected) root.append(panel);
      if (!panelOpen && panel.isConnected) panel.remove();
      // (Site Inherits Profile Style on, html[data-pst-inherit]: everywhere that isn't a styled profile shows
      // your own style, once you've made one)
      const inherit = root.hasAttribute('data-pst-inherit') && !!loadMine();
      if (!handle) {
        if (inherit) { mark(); if (lastKey !== 'site') { lastKey = 'site'; apply(mine()); } return; }
        if (applied) apply(null); lastKey = ''; return;
      }
      mark();
      // your own profile: your choice, once you've made one (it stays on); otherwise what your picture carries
      // (an account with no saved style yet starts from the one its picture carries, if any)
      if (own && !loadMine() && headerPicture(handle)) {
        const pic = await readCode(headerPicture(handle));
        if (pic && !loadMine() && profileHandle() === handle) { saveMine(pic); lastKey = ''; window.trif?.log(`@${handle}: saved style taken from your picture`); }
      }
      if (own) updateState(headerPicture(handle)); // (public or edited: see updateState)
      // (mine() measures X's look, so only when it's about to be shown)
      if (own && loadMine()) { if (lastKey !== 'mine') { lastKey = 'mine'; apply(mine()); } return; }
      const url = headerPicture(handle);
      const key = `${handle}|${url}|${inherit}`;
      if (key === lastKey) return;
      lastKey = key;
      // (a profile without a style: X's look, or yours when the site inherits it)
      const fallback = () => (inherit ? mine() : null);
      if (!url) { apply(fallback()); return; }
      apply(fallback()); // (nothing borrowed from the last profile while this one's read)
      const st = await readCode(url);
      if (profileHandle() !== handle) return; // (moved on meanwhile)
      apply(st || fallback());
      if (st) window.trif?.log(`@${handle}'s picture carries a style`, JSON.stringify(st));
    } catch (e) { window.trif?.warn('profile styler', String(e)); }
  };
  setInterval(tick, 700);
  tick();
})();
