// ==WebMod==
// @name        Post Styler
// @description Posts and people cards show their owners' colours
// @match       https://x.com/*
// @run-at      document-idle
// @risk        1 reads post authors' profile pictures from X's image server again (at 400×400) to find style codes
// @source      trif
// @version     3
// @boxed
// @powers      image-variants pbs.twimg.com _normal.→_400x400. _bigger.→_400x400. _mini.→_400x400. _x96.→_400x400. _200x200.→_400x400., site-storage local:trifProfileStyler.mine:*
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
//
// Boxed (TRIF's sandbox). Its powers: image-variants (each author's picture again at 400×400 from
// pbs.twimg.com, the header's literal size changes, read back as pixels: X's image server allows it) and
// site-storage, to read your own saved style where Profile Styler keeps it (trifProfileStyler.mine:<you>, in
// x.com's localStorage, shared by the family). (Beside other boxed mods, TRIF asks you once for each
// combination across two mods: see its hold.) What it remembers about pictures it's read
// (trifPostStyler.seen3: 3 since pictures' fonts are read) is in TRIF's settings now; the free version's old caches
// (trifPostStyler.seen, .seen2), which it deleted from localStorage, are left there (deleting them would take
// site-storage for those keys too), and the new one starts empty once.
// Names it gives are the sandbox's: data-ps-* is data-trif-box-ps-*, and Profile Styler's emoji spans (boxed
// too) are data-trif-box-pst-emoji.

const STORE = 'trifProfileStyler.mine'; // (Profile Styler's: your saved style, per account)
// (.seen2: picture code v2 is read now, so pictures the older reader found nothing in are read again)
const SEEN_KEY = 'trifPostStyler.seen3', SEEN_MAX = 600; // (3: with the picture's fonts)
// PIC CODE begin (the same in profile-styler.js and style-encoder.js, character for character;
// tests/styler-fonts.test.js checks)
// Picture code v2: bytes in the four hidden corners of a 400×400 picture, as 2×2-pixel gray cells (red =
// green = blue, so all of it is in the brightness, which a JPEG keeps at full resolution, unlike colour):
// four grays, 0, 85, 170 and 255, two bits a cell. A cell reads as the mean of (r + g + b) / 3 over its four
// pixels, to the nearest gray.
// The cells: on the 2-pixel grid, those wholly outside X's round crop with a 4 px margin, 1,801 a corner;
// in each corner in one order, from the corner out (by i + j, then i; i counts cells from the picture's side
// edge, j from its top or bottom edge).
// Each corner is its own stream: the mark (8 cells: white black black white black white white black); then
// bytes, four cells each, highest bits first: kind (1 a style, 2 a song), version, part (its number × 16 +
// parts − 1: a payload spread over several corners), payload length (2 bytes), the payload, and a CRC-16
// (CCITT: polynomial 0x1021, start 0xffff) of everything from kind on. Mark, length or CRC wrong: nothing.
// Room: 441 bytes of payload a corner (capacity()). The bottom-left corner carries the style (StyleCode,
// below); the other three are kept for a song.
// (An old colour code reads 85 or 170 in the corner where the mark wants black and white, so it's never taken
// for one of these; and gray cells are never red, magenta or yellow, so an older Profile Styler finds no
// markers in a picture with this code.)
const PicCode = (() => {
  const SIZE = 400, CELL = 2, LEVELS = [0, 85, 170, 255];
  const MARK = [3, 0, 0, 3, 0, 3, 3, 0], HEAD = 5;
  const KIND = { style: 1, song: 2 };
  const CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
  const LOCAL = []; // [i, j], in stream order
  for (let d = 0; d < 2 * SIZE / CELL; d++) {
    for (let i = 0; i <= d; i++) {
      const j = d - i, a = SIZE / 2 - CELL * (i + 1), b = SIZE / 2 - CELL * (j + 1);
      if (a >= 0 && b >= 0 && a * a + b * b > (SIZE / 2 + 4) ** 2) LOCAL.push([i, j]);
    }
  }
  // (how far from its corner a cell reaches, in pixels)
  const REACH = CELL * (1 + LOCAL.reduce((m, [i, j]) => Math.max(m, i, j), 0));
  // a corner's cells: [x, y] of each cell's top-left pixel (y down, as a canvas has it), in stream order
  const placed = new Map(CORNERS.map((c) => [c, LOCAL.map(([i, j]) => [
    c.endsWith('left') ? CELL * i : SIZE - CELL * (i + 1), c.startsWith('top') ? CELL * j : SIZE - CELL * (j + 1)])]));
  const cells = (corner) => placed.get(corner) || [];
  const capacity = () => Math.floor((LOCAL.length - MARK.length) / 4) - HEAD - 2;
  const grey = (level) => '#' + LEVELS[level].toString(16).padStart(2, '0').repeat(3);
  const crc16 = (bytes) => {
    let c = 0xffff;
    for (const b of bytes) { c ^= b << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
    return c;
  };
  // one corner's stream → [[x, y, level 0–3], …] to paint (each a CELL × CELL square of grey(level))
  const encode = (corner, { kind, version = 1, part = 0, parts = 1, payload }) => {
    const at = cells(corner), bytes = [...payload];
    if (!at.length) throw new RangeError(`no corner ${corner}`);
    if (!(kind >= 1 && kind <= 255 && version >= 0 && version <= 255 && parts >= 1 && parts <= 16 && part >= 0 && part < parts)) throw new RangeError('bad header');
    if (bytes.length > capacity() || bytes.some((b) => !(Number.isInteger(b) && b >= 0 && b <= 255))) throw new RangeError(`a corner holds ${capacity()} bytes of 0–255`);
    const body = [kind, version, part * 16 + parts - 1, bytes.length >> 8, bytes.length & 255, ...bytes];
    const c = crc16(body);
    const levels = [...MARK];
    for (const b of [...body, c >> 8, c & 255]) levels.push(b >> 6, (b >> 4) & 3, (b >> 2) & 3, b & 3);
    return levels.map((l, n) => [at[n][0], at[n][1], l]);
  };
  // greyAt(x, y): the mean brightness (0–255) of the cell whose top-left pixel is (x, y) in a 400 px picture
  // → { kind, version, part, parts, payload: [bytes] }, or null. Reads only as far as it must (a picture
  // without this code: the mark's first cells).
  const decode = (corner, greyAt) => {
    const at = cells(corner);
    let n = 0;
    const level = () => { if (n >= at.length) return -1; const v = greyAt(at[n][0], at[n][1]); n++; return Math.min(3, Math.max(0, Math.round(v / 85))); };
    for (const m of MARK) if (level() !== m) return null;
    const byte = () => { let b = 0; for (let k = 0; k < 4; k++) { const l = level(); if (l < 0) return -1; b = b * 4 + l; } return b; };
    const head = [];
    for (let k = 0; k < HEAD; k++) { const b = byte(); if (b < 0) return null; head.push(b); }
    const len = head[3] * 256 + head[4], part = head[2] >> 4, parts = (head[2] & 15) + 1;
    if (!head[0] || len > capacity() || part >= parts) return null;
    const payload = [];
    for (let k = 0; k < len; k++) { const b = byte(); if (b < 0) return null; payload.push(b); }
    const hi = byte(), lo = byte();
    if (hi < 0 || lo < 0 || crc16([...head, ...payload]) !== hi * 256 + lo) return null;
    return { kind: head[0], version: head[1], part, parts, payload };
  };
  // a payload longer than a corner holds (a song), over several corners in the order given: their streams
  const spread = (corners, { kind, version = 1, payload }) => {
    const bytes = [...payload], cap = capacity(), parts = Math.max(1, Math.ceil(bytes.length / cap));
    if (parts > corners.length) throw new RangeError(`${bytes.length} bytes need ${parts} corners`);
    return corners.slice(0, parts).map((corner, part) => ({ corner, cells: encode(corner, { kind, version, part, parts, payload: bytes.slice(part * cap, (part + 1) * cap) }) }));
  };
  // and back: decoded streams (from any corners, any order) → { version, payload } of one kind, or null if a
  // part's missing
  const gather = (streams, kind) => {
    const mine = streams.filter((s) => s && s.kind === kind).sort((a, b) => a.part - b.part);
    if (!mine.length || mine.length !== mine[0].parts || mine.some((s, k) => s.part !== k || s.parts !== mine[0].parts || s.version !== mine[0].version)) return null;
    return { version: mine[0].version, payload: mine.flatMap((s) => s.payload) };
  };
  return { SIZE, CELL, LEVELS, KIND, CORNERS, REACH, cells, capacity, grey, crc16, encode, decode, spread, gather };
})();
// The style, as the bottom-left corner's payload (kind 1, version 1): sections of tag, length, data, so a
// later version can add some that this one skips. 1: the colours, 3 bytes each (exact), in the order of
// KEYS (13: 39 bytes); 2: the rainbow flags, a bit each in that order, lowest first (2 bytes); 3: the fonts
// (only when there are some): which follow (1 name, 2 handle, 4 text), then each: type + 8 × weight (types
// sans serif mono rounded handwriting display; weights the page's own, 100 300 400 500 600 700 900), its
// name's length (0: the same name as the one before) and its name in ASCII: letters, digits, space and
// - . _ & + ! ( ) / only, 1 to 50 of them (fontName). Three fonts: about 75 bytes in all.
const StyleCode = (() => {
  const VERSION = 1, COLOURS = 1, RAINBOW = 2, FONTS = 3;
  const KEYS = ['bg', 'name', 'badge', 'handle', 'text', 'buttons', 'links', 'panel', 'icons', 'logo', 'cards', 'lines', 'quotes'];
  const TYPES = ['sans', 'serif', 'mono', 'rounded', 'handwriting', 'display'];
  const WEIGHTS = [null, 100, 300, 400, 500, 600, 700, 900];
  // a font name as stored: single spaces, only those characters, 1 to 50, a letter or digit in it; else null
  const fontName = (s) => {
    const f = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
    return f.length <= 50 && /[A-Za-z0-9]/.test(f) && /^[A-Za-z0-9 \-._&+!()/]+$/.test(f) ? f : null;
  };
  // (a byte back to its character: only those a name may hold; anything else spoils the name)
  const NAME_CHARS = [...' !&()+-./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'];
  const charOf = (b) => NAME_CHARS.find((c) => c.charCodeAt(0) === b) || '\u0000';
  const weightOf = (w) => (Number.isFinite(Number(w)) && Number(w) > 0 ? WEIGHTS.slice(1).reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)) : null);
  const font = (f) => { const family = fontName(f?.family); return family ? { family, type: TYPES.includes(f.type) ? f.type : 'sans', weight: weightOf(f.weight) } : null; };
  // colours: 13 '#rrggbb' in KEYS order; rainbow: keys; fonts: { name, handle, text } → bytes
  const pack = (colours, rainbow, fonts) => {
    const out = [];
    const section = (tag, data) => out.push(tag, data.length, ...data);
    section(COLOURS, colours.flatMap((c) => {
      const m = /^#([0-9a-f]{6})$/i.exec(c || '');
      if (!m) throw new RangeError(`not a colour: ${c}`);
      return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
    }));
    const on = KEYS.map((k) => (rainbow || []).includes(k));
    section(RAINBOW, [on.slice(0, 8).reduce((b, f, k) => b | (f ? 1 << k : 0), 0), on.slice(8).reduce((b, f, k) => b | (f ? 1 << k : 0), 0)]);
    const list = [font(fonts?.name), font(fonts?.handle), font(fonts?.text)];
    if (list.some(Boolean)) {
      const data = [(list[0] ? 1 : 0) + (list[1] ? 2 : 0) + (list[2] ? 4 : 0)];
      let prev = null;
      for (const f of list) {
        if (!f) continue;
        data.push(TYPES.indexOf(f.type) + 8 * WEIGHTS.indexOf(f.weight));
        if (prev && f.family.toLowerCase() === prev.toLowerCase()) data.push(0);
        else data.push(f.family.length, ...[...f.family].map((ch) => ch.charCodeAt(0)));
        prev = f.family;
      }
      section(FONTS, data);
    }
    return out;
  };
  const unpackFonts = (d) => {
    const which = d[0];
    if (!(which >= 1 && which <= 7)) return null;
    const got = [];
    let p = 1, prev = null;
    for (const bit of [1, 2, 4]) {
      if (!(which & bit)) { got.push(null); continue; }
      const tw = d[p], len = d[p + 1];
      if (tw === undefined || len === undefined || (tw & 7) >= TYPES.length || len > 50 || (!len && !prev) || d.length < p + 2 + len) return null;
      const family = len ? d.slice(p + 2, p + 2 + len).map(charOf).join('') : prev;
      if (fontName(family) !== family) return null;
      got.push({ family, type: TYPES[tw & 7], weight: WEIGHTS[tw >> 3] });
      p += 2 + len;
      prev = family;
    }
    return { name: got[0], handle: got[1], text: got[2] };
  };
  // bytes → { colours: 13 '#rrggbb' or null, rainbow: keys, fonts or null }, or null
  const unpack = (bytes) => {
    let colours = null, rainbow = [], fonts = null, i = 0;
    while (i < bytes.length) {
      const tag = bytes[i], len = bytes[i + 1];
      if (len === undefined || i + 2 + len > bytes.length) return null;
      const d = bytes.slice(i + 2, i + 2 + len);
      i += 2 + len;
      if (tag === COLOURS) {
        if (len % 3) return null;
        colours = [];
        for (let k = 0; k < len; k += 3) colours.push('#' + d.slice(k, k + 3).map((v) => v.toString(16).padStart(2, '0')).join(''));
      } else if (tag === RAINBOW) rainbow = KEYS.filter((k, n) => ((d[n >> 3] || 0) >> (n & 7)) & 1);
      else if (tag === FONTS) fonts = unpackFonts(d);
      // (any other tag: from a later version, skipped)
    }
    return colours ? { colours: KEYS.map((k, n) => colours[n] || null), rainbow: rainbow.filter((k) => colours[KEYS.indexOf(k)]), fonts } : null;
  };
  return { VERSION, KEYS, TYPES, WEIGHTS, fontName, font, pack, unpack };
})();
// PIC CODE end

const greyReader = (g, W, H, corner) => {
  const kx = W / PicCode.SIZE, ky = H / PicCode.SIZE;
  const R = Math.min(W, H, Math.ceil(PicCode.REACH * Math.max(kx, ky)) + 2), left = corner.endsWith('left') ? 0 : W - R, top = corner.startsWith('top') ? 0 : H - R;
  const d = g.getImageData(left, top, R, R).data;
  const px = (x, y) => { const o = (Math.min(R - 1, Math.max(0, y - top)) * R + Math.min(R - 1, Math.max(0, x - left))) * 4; return (d[o] + d[o + 1] + d[o + 2]) / 3; };
  return (x, y) => {
    const cx = (x + PicCode.CELL / 2) * kx - 0.5, cy = (y + PicCode.CELL / 2) * ky - 0.5, ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
    return px(ix, iy) * (1 - fx) * (1 - fy) + px(ix + 1, iy) * fx * (1 - fy) + px(ix, iy + 1) * (1 - fx) * fy + px(ix + 1, iy + 1) * fx * fy;
  };
};

const ls = trif.storage('local');
// --- the code (as Profile Styler reads it; see profile-styler.js) --------------------------------
const KEYS = ['bg', 'name', 'badge', 'handle', 'text', 'buttons', 'links', 'panel', 'icons', 'logo', 'cards', 'lines', 'quotes'];
const MARKERS = [[0, 0, [255, 0, 0]], [1, 0, [255, 0, 255]], [2, 0, [255, 255, 0]], [0, 1, [0, 0, 255]], [1, 1, [0, 255, 255]], [0, 2, [0, 255, 0]]];
const CELLS = [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0], [0, 6], [1, 5], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0], [3, 7]];
const FLAGS = [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1], [8, 0], [0, 10], [1, 9], [2, 8], [4, 6]];
const LEVELS = [0, 85, 170, 255];
const snap = (v) => LEVELS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const fromList = (v, rainbow, fonts = null) => ({ bg: v[0], name: v[1], badge: v[2], handle: v[3], text: v[4], buttons: v[5], links: v[6], panel: v[7],
  icons: v[8], logo: v[9], cards: v[10], lines: v[11], quotes: v[12], rainbow, fonts });
// a picture's font ({ family, type, weight }, StyleCode) → a CSS family list: its name, then its type's generic (as
// Profile Styler's fontStack, without its look-alikes: a computer without the font gets one of its kind)
const GENERIC = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', rounded: '"Arial Rounded MT Bold", "Nunito", ui-rounded, sans-serif',
  handwriting: '"Segoe Print", "Bradley Hand", cursive', display: 'Impact, "Haettenschweiler", fantasy' };
const fontStack = (f) => (f && /^[A-Za-z0-9 ._&+!()\/-]{1,50}$/.test(f.family) ? `"${f.family}", ${GENERIC[f.type] || 'sans-serif'}` : null);
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
// the text colour that reads on a colour (a button's label): black or white
const onColour = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) > 150 ? '#0f1419' : '#ffffff'; };
const root = page.root;

// what's been read, by picture address: a style, or 0 (no code); kept between visits (TRIF's settings)
const seenSettings = await trif.settings(SEEN_KEY, {});
const seenMap = new Map(Object.entries(seenSettings.value || {}));
let saveTimer = 0;
const remember = (url, st) => {
  seenMap.delete(url); seenMap.set(url, st || 0);
  while (seenMap.size > SEEN_MAX) seenMap.delete(seenMap.keys().next().value); // (the oldest go first)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { seenSettings.save(Object.fromEntries(seenMap)).catch(() => {}); }, 2000);
};
// (the picture's size: the variant isn't on the page, so it's measured by putting it there for a moment,
// unseen; its natural size, as the free version's naturalWidth)
const sizeOf = (img) => {
  img.style('position', 'absolute'); img.style('visibility', 'hidden'); img.style('left', '-10000px'); img.style('top', '0');
  img.style('width', 'auto'); img.style('height', 'auto'); img.style('max-width', 'none'); img.style('max-height', 'none');
  root.append(img);
  const W = img.offsetWidth, H = img.offsetHeight;
  img.remove();
  return [W, H];
};
const reading = new Map(); // url → Promise
// av: the page's own picture (a stand-in); url: its 400×400 address, the cache's key
const readCode = (av, url) => {
  if (seenMap.has(url)) return Promise.resolve(seenMap.get(url) || null);
  if (reading.has(url)) return reading.get(url);
  const p = new Promise((resolve) => {
    let img;
    try { img = trif.imageVariant(av, { pixels: true }); } catch (e) {
      // (already 400×400, or not X's: nothing to read; TRIF refusing it on this page puts that in trif errors itself)
      resolve(null); return;
    }
    img.on('load', () => {
      try {
        const [W, H] = sizeOf(img), s = W / 100;
        if (W < 200) { resolve(null); return; } // (too small to hold a code)
        const c = page.create('canvas');
        c.setAttr('width', String(W)); c.setAttr('height', String(H));
        const g = c.canvas();
        g.drawImage(img, 0, 0);
        const cell = (x, y) => {
          const x0 = Math.floor((x + 0.25) * s), y0 = Math.floor(H - (y + 0.75) * s), n = Math.max(1, Math.round(s / 2));
          const d = g.getImageData(x0, y0, n, n).data, sum = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
          const k = d.length / 4;
          return sum.map((v) => v / k);
        };
        // picture code v2 first (Style Encoder stamps it now: profile-styler.js "PIC CODE"), then the colour cells
        const v2 = PicCode.decode('bottom-left', greyReader(g, W, H, 'bottom-left'));
        const st2 = v2 && v2.kind === PicCode.KIND.style && v2.version === StyleCode.VERSION ? StyleCode.unpack(v2.payload) : null;
        if (st2) { resolve(fromList(st2.colours, st2.rainbow, st2.fonts)); return; }
        if (!MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) < 90))) { resolve(null); return; }
        const lossless = MARKERS.every(([x, y, want]) => cell(x, y).every((v, i) => Math.abs(v - want[i]) <= 4));
        const colours = CELLS.map(([x, y]) => hex(lossless ? cell(x, y) : cell(x, y).map(snap)));
        const flags = FLAGS.map(([x, y]) => { const c = cell(x, y), lum = (c[0] + c[1] + c[2]) / 3, spread = Math.max(...c) - Math.min(...c); return spread > 60 ? null : lum > 200 ? true : lum < 55 ? false : null; });
        // (older codes carry fewer colours: as many as have their rainbow flag; see profile-styler.js)
        let n = 13;
        if (flags.slice(0, 7).some((f) => f === null)) { resolve(fromList(colours.map((c, i) => (i < 5 ? c : null)), [])); return; }
        for (const [at, upTo] of [[7, 7], [8, 8], [9, 8], [10, 10], [11, 11], [12, 12]]) if (flags[at] === null) { n = Math.min(n, upTo); }
        resolve(fromList(colours.map((c, i) => (i < n ? c : null)), KEYS.slice(0, n).filter((k, i) => flags[i])));
      } catch (e) { trif.warn('post styler: could not read a picture', String(e)); resolve(null); }
    });
    img.on('error', () => resolve(null));
  }).then((st) => { reading.delete(url); remember(url, st); return st; });
  reading.set(url, p);
  return p;
};

// --- who's who --------------------------------------------------------------------------------
const myHandle = () => {
  const t = page.find('[data-testid=SideNav_AccountSwitcher_Button] [data-testid^="UserAvatar-Container-"]')?.attr('data-testid') || '';
  return /^UserAvatar-Container-(\w+)$/.exec(t)?.[1] || null;
};
const mySaved = (handle) => {
  try { const st = JSON.parse(ls.get(`${STORE}:${handle.toLowerCase()}`) || 'null'); return st && isHex(st.bg) ? st : null; } catch { return null; }
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
// (a post by a styled author: P; with colour k set: P[data-trif-box-ps~=k]; rainbow: P[data-trif-box-ps-r~=k]. #react-root
// and the extra :not()s keep these above Profile Styler's page-wide rules and X-Flyer's recolouring)
// A person, wherever X shows one with their picture: a people card (UserCell: the sidebar's lists, Who to
// follow, followers, search's People), an entry in the search box's drop-down (TypeaheadUser; also the
// @-mention suggestions while writing). (Hover cards, the pop-up over a name, are Profile Styler's now.)
const CARDS = '[data-testid=UserCell], [data-testid=TypeaheadUser]';
// (a post, or a person's card: P is either; C only the card)
const P = `html #react-root :is(article, ${CARDS})[data-trif-box-ps-u]:not(#trif-box-ps-a)`;
const C = `html #react-root :is(${CARDS})[data-trif-box-ps-u]:not(#trif-box-ps-a)`;
// A name link (in a notification, "Tim followed you", and a post's "Tim reposted" line): just the name
const N = 'html #react-root a[data-trif-box-ps-n][data-trif-box-ps-u]:not(#trif-box-ps-a)';
const FOLLOW = '[data-testid$="-follow"], [data-testid$="-unfollow"]';
const OUT = ':not([data-trif-box-ps-quote] *)'; // (not inside the quoted post)
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
const Q = 'html #react-root [data-trif-box-ps-quote][data-trif-box-ps-u]:not(#trif-box-ps-a):not(#trif-box-ps-q)';
// Everything a styled item gets, under its prefix X; out: what to leave out of it (a post: its quoted post,
// which is the quoted author's, styled or not)
const itemRules = (X, out) => `
  /* background (a colour over any rainbow the box got from the post around it) */
  ${X}[data-trif-box-ps~=bg] { background-color: var(--ps-bg) !important; background-image: none !important; }
  ${X}[data-trif-box-ps-r~=bg] { ${bigRainbow} }
  ${X}[data-trif-box-ps-r~=bg] :is(span, time)${out} { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
  /* (pictures with see-through parts: X paints the page's colour on the layers behind a picture (avatars,
     attached photos, link-card images), which showed through as white or black patches; in a styled item
     those layers are see-through, so the item's own background shows, rainbow and all. Background colour
     only: the picture itself is a background image there, and stays) */
  ${X}:is([data-trif-box-ps~=bg], [data-trif-box-ps-r~=bg]) :is([data-testid^="UserAvatar-Container-"], [data-testid=tweetPhoto], [data-testid$=".media"])${out},
  ${X}:is([data-trif-box-ps~=bg], [data-trif-box-ps-r~=bg]) :is([data-testid^="UserAvatar-Container-"], [data-testid=tweetPhoto], [data-testid$=".media"])${out} * { background-color: transparent !important; }
  /* fonts: the author's, from their picture (text, then name and handle over it) */
  ${X}[data-trif-box-ps~=ftext] :is(span, time, div[dir])${out}${NOBTN} { font-family: var(--ps-f-text) !important; }
  ${X}[data-trif-box-ps~=wtext] :is(span, time, div[dir])${out}${NOBTN} { font-weight: var(--ps-w-text) !important; }
  ${X}[data-trif-box-ps~=fname] [data-trif-box-ps-name]${out}:not(#trif-box-ps-b), ${X}[data-trif-box-ps~=fname] [data-trif-box-ps-name]${out} span:not(#trif-box-ps-b) { font-family: var(--ps-f-name) !important; }
  ${X}[data-trif-box-ps~=wname] [data-trif-box-ps-name]${out}:not(#trif-box-ps-b), ${X}[data-trif-box-ps~=wname] [data-trif-box-ps-name]${out} span:not(#trif-box-ps-b) { font-weight: var(--ps-w-name) !important; }
  ${X}[data-trif-box-ps~=fhandle] [data-trif-box-ps-handle]${out}:not(#trif-box-ps-b) { font-family: var(--ps-f-handle) !important; }
  ${X}[data-trif-box-ps~=whandle] [data-trif-box-ps-handle]${out}:not(#trif-box-ps-b) { font-weight: var(--ps-w-handle) !important; }
  /* text: the item's own */
  /* (not X's buttons in the post, like Boost or Follow, which have their own fill; the action bar's counts yes) */
  ${X}[data-trif-box-ps~=text] :is(span, time, div[dir])${out}${NOBTN}, ${X}[data-trif-box-ps~=text] [role=group] span { color: var(--ps-text) !important; -webkit-text-fill-color: var(--ps-text) !important; }
  ${rainbowText(`${X}[data-trif-box-ps-r~=text] :is(span, time)${out}${NOBTN}:not(:has(*)):not(#trif-box-ps-b), ${X}[data-trif-box-ps-r~=text] [role=group] span:not(:has(*)):not(#trif-box-ps-b)`)}
  /* name, handle (marked; X draws the emoji in names as pictures, which a rainbow background would cover:
     only text spans get it) */
  ${X}[data-trif-box-ps~=name] [data-trif-box-ps-name]${out}:not(#trif-box-ps-b), ${X}[data-trif-box-ps~=name] [data-trif-box-ps-name]${out} span:not(#trif-box-ps-b) { color: var(--ps-name) !important; -webkit-text-fill-color: var(--ps-name) !important; background-image: none !important; }
  ${rainbowText(`${X}[data-trif-box-ps-r~=name] [data-trif-box-ps-name]${out} span:not(:has(*)):not(#trif-box-ps-b):not(#trif-box-ps-c), ${X}[data-trif-box-ps-r~=name] span[data-trif-box-ps-name]${out}:not(:has(*)):not(#trif-box-ps-b):not(#trif-box-ps-c)`)}
  /* (and its box: a cut-short handle's "…" is drawn in the box's colour) */
  ${X}[data-trif-box-ps~=handle] [data-trif-box-ps-handle]${out}:not(#trif-box-ps-b), ${X}[data-trif-box-ps~=handle] :has(> [data-trif-box-ps-handle])${out}:not(#trif-box-ps-b) { color: var(--ps-handle) !important; -webkit-text-fill-color: var(--ps-handle) !important; background-image: none !important; }
  ${rainbowText(`${X}[data-trif-box-ps-r~=handle] [data-trif-box-ps-handle]${out}:not(#trif-box-ps-b):not(#trif-box-ps-c)`)}
  /* links in the text */
  ${X}[data-trif-box-ps~=links] :is(${LINKS})${out}:not(#trif-box-ps-b), ${X}[data-trif-box-ps~=links] :is(${LINKS})${out} span:not(#trif-box-ps-b) { color: var(--ps-links) !important; -webkit-text-fill-color: var(--ps-links) !important; background-image: none !important; }
  ${rainbowText(`${X}[data-trif-box-ps-r~=links] :is(${LINKS})${out} span:not(#trif-box-ps-b):not(#trif-box-ps-c)`)}
  /* the badge: the author's verified check (a rainbow one: its shape filled with the small rainbow, #trif-box-ps-rb) */
  ${X}[data-trif-box-ps~=badge] svg[data-trif-box-ps-badge]${out}, ${X}[data-trif-box-ps~=badge] svg[data-trif-box-ps-badge]${out} * { color: var(--ps-badge) !important; fill: var(--ps-badge) !important; }
  ${X}[data-trif-box-ps-r~=badge] svg[data-trif-box-ps-badge]${out} path { fill: url(#trif-box-ps-rb) !important; }
  /* action icons (and the post's ... and Grok buttons) */
  ${X}[data-trif-box-ps~=icons] :is(${ICONS})${out}, ${X}[data-trif-box-ps~=icons] :is(${ICONS})${out} * { color: var(--ps-icons) !important; fill: var(--ps-icons) !important; }
  ${X}[data-trif-box-ps-r~=icons] :is(${ICONS})${out} path { fill: url(#trif-box-ps-rb) !important; }
  /* boxes: link cards, the quoted post's box, their edges */
  ${X}[data-trif-box-ps~=cards] [data-testid="card.wrapper"] { background-color: var(--ps-cards) !important; }
  ${X}[data-trif-box-ps-r~=cards] [data-testid="card.wrapper"] { ${bigRainbow} }
  ${X}[data-trif-box-ps~=quotes] [data-trif-box-ps-quote] { background-color: var(--ps-quotes) !important; }
  ${X}[data-trif-box-ps-r~=quotes] [data-trif-box-ps-quote] { ${bigRainbow} }
  ${X}[data-trif-box-ps-r~=quotes] [data-trif-box-ps-quote] :is(span, time) { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
  ${X}[data-trif-box-ps~=lines] :is([data-testid="card.wrapper"], [data-trif-box-ps-quote]) { border-color: var(--ps-lines) !important; }
  ${X}[data-trif-box-ps-r~=lines] :is([data-testid="card.wrapper"], [data-trif-box-ps-quote]) { animation: ps-line-hue 3s steps(18) infinite; }
  ${X}[data-trif-box-ps-r~=lines][data-trif-box-ps-r~=cards] [data-testid="card.wrapper"]:not(#trif-box-ps-l),
  ${X}[data-trif-box-ps-r~=lines][data-trif-box-ps-r~=quotes] [data-trif-box-ps-quote]:not(#trif-box-ps-l),
  ${X}[data-trif-box-ps-r~=lines] [data-trif-box-ps-quote][data-trif-box-ps-r~=bg]:not(#trif-box-ps-l):not(#trif-box-ps-q):not(#trif-box-ps-m) { animation: ps-box-roll 5s steps(75) infinite, ps-line-hue 3s steps(18) infinite !important; }
  ${X}[data-trif-box-ps-r~=lines] :is([data-testid="card.wrapper"], [data-trif-box-ps-quote]) { border-color: hsl(var(--ps-lh) 100% 60%) !important; }
`;
// (each ps-line-hue animation pinned to the page's time origin: every line steps through the hues together)
// (each ps- animation pinned to the page's time origin, as the free version did with startTime = 0: every
// line steps through the hues together. The sandbox changes only its own animations' times, so the page's
// element is given a negative animation-delay instead, putting the animation where it would be had it
// started at time 0)
const pin = (e) => {
  const t = e.target;
  if (!t || !String(e.animationName || '').startsWith('ps-')) return;
  const names = t.style('animation-name').split(',').map((x) => x.trim());
  const durs = t.style('animation-duration').split(',').map((x) => parseFloat(x) * (/ms$/.test(x.trim()) ? 1 : 1000));
  const delays = t.style('animation-delay').split(',').map((x) => x.trim());
  const now = performance.now();
  const out = names.map((n, i) => (n.startsWith('ps-') && durs[i % durs.length] > 0 ? `${-((now % durs[i % durs.length]) / 1000).toFixed(3)}s` : delays[i % delays.length] || '0s'));
  t.style('animation-delay', out.join(', '));
};
page.on('animationstart', pin, { capture: true });
trif.css(`
  @keyframes ps-text-roll { from { background-position: 0 0; } to { background-position: 34px 0; } }
  @keyframes ps-box-roll { from { background-position: calc(-30vmax / 0.9063) 0; } to { background-position: calc(-90vmax / 0.9063) 0; } }
  @property --ps-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  @keyframes ps-line-hue { from { --ps-lh: 0deg; } to { --ps-lh: 360deg; } }
  ${itemRules(P, OUT)}
  ${itemRules(Q, '')}
  /* a styled quoted post's own box edge, in its author's lines colour */
  ${Q}[data-trif-box-ps~=lines] { border-color: var(--ps-lines) !important; }
  ${Q}[data-trif-box-ps-r~=lines] { animation: ps-line-hue 3s steps(18) infinite; border-color: hsl(var(--ps-lh) 100% 60%) !important; }
  /* a person's card: their Follow / Following button in their buttons colour (its label black or white to
     read on it); rainbow: the small rainbow */
  ${C}[data-trif-box-ps~=buttons] :is(${FOLLOW}) { background-color: var(--ps-buttons) !important; border-color: var(--ps-buttons) !important; }
  ${C}[data-trif-box-ps~=buttons] :is(${FOLLOW}) *:not(#trif-box-ps-b):not(#trif-box-ps-c) { color: var(--ps-on-buttons) !important; -webkit-text-fill-color: var(--ps-on-buttons) !important; background-image: none !important; }
  ${C}[data-trif-box-ps-r~=buttons] :is(${FOLLOW}) { background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important; background-attachment: fixed !important; border-color: rgb(255 255 255 / .9) !important;
    animation: ps-text-roll .8s linear infinite !important; }
  ${C}[data-trif-box-ps-r~=buttons] :is(${FOLLOW}) *:not(#trif-box-ps-b):not(#trif-box-ps-c) { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .6); }
  /* emojis stay emojis in rainbow text (wrapped by wrapEmoji) */
  /* (above the rainbow rules: P carries one :not(#…) and they add two) */
  /* name links: the name in that person's name colour, or the rainbow */
  ${N}[data-trif-box-ps~=name] span:not(#trif-box-ps-b) { color: var(--ps-name) !important; -webkit-text-fill-color: var(--ps-name) !important; background-image: none !important; }
  ${rainbowText(`${N}[data-trif-box-ps-r~=name] span:not(:has(*)):not(#trif-box-ps-b):not(#trif-box-ps-c)`)}
  html #react-root :is(article, a, ${CARDS}) span:is([data-trif-box-ps-emoji], [data-trif-box-pst-emoji]):not(#trif-box-ps-a):not(#trif-box-ps-b):not(#trif-box-ps-c):not(#trif-box-ps-d):not(#trif-box-ps-e) { color: #000 !important; -webkit-text-fill-color: #000 !important; background-image: none !important;
    background-clip: border-box !important; -webkit-background-clip: border-box !important; text-shadow: none !important; animation: none !important; }
`);
// each author's colours, as variables: one rule per styled author
let varsSheet = null;
const authorRules = new Map(); // handle (lower case) → its rule
const setAuthor = (h, st) => {
  const v = [['bg', st.bg], ['name', st.name], ['badge', st.badge], ['handle', st.handle], ['text', st.text], ['links', st.links],
    ['icons', st.icons], ['cards', st.cards], ['lines', st.lines], ['quotes', st.quotes], ['buttons', st.buttons],
    ['on-buttons', isHex(st.buttons) ? onColour(st.buttons) : null]].filter(([, c]) => isHex(c));
  // (the fonts: a family list each, and a weight when one's chosen)
  const f = [];
  for (const k of ['name', 'handle', 'text']) {
    const font = st.fonts?.[k], stack = fontStack(font);
    if (stack) f.push([`f-${k}`, stack]);
    if (stack && Number.isInteger(font.weight)) f.push([`w-${k}`, String(font.weight)]);
  }
  const rule = `html #react-root [data-trif-box-ps-u="${h}"] { ${[...v, ...f].map(([k, c]) => `--ps-${k}: ${c};`).join(' ')} }`;
  if (authorRules.get(h) === rule) return;
  authorRules.set(h, rule);
  const next = trif.css([...authorRules.values()].join('\n'));
  if (varsSheet) varsSheet.remove();
  varsSheet = next;
};
// the small rainbow as an SVG gradient, for icons and the badge (as Profile Styler's #trif-box-pst-rb). It
// rolls one hue cycle every 0.8 s: the free version moved the gradient with an SVG animateTransform, which the
// sandbox doesn't make; moving a repeating gradient along itself by one cycle is each stop going round the
// colour wheel once, so each stop's colour is animated instead (the same picture at every moment)
{
  const svg = page.createSvg('svg');
  svg.setAttr('width', '0'); svg.setAttr('height', '0'); svg.setAttr('aria-hidden', 'true');
  svg.style('position', 'absolute');
  const defs = page.createSvg('defs');
  const grad = page.createSvg('linearGradient');
  grad.setAttr('id', 'trif-box-ps-rb'); grad.setAttr('gradientUnits', 'userSpaceOnUse'); grad.setAttr('spreadMethod', 'repeat');
  grad.setAttr('x1', '0'); grad.setAttr('y1', '24'); grad.setAttr('x2', '17'); grad.setAttr('y2', '7');
  for (let i = 0; i <= 12; i++) {
    const stop = page.createSvg('stop');
    stop.setAttr('offset', String(i / 12)); stop.setAttr('stop-color', `hsl(${i * 30} 100% 60%)`);
    grad.append(stop);
    // (from→to 17,-17 is one cycle along the gradient's own line, 0 → 1: the colour at offset o becomes the one
    // that was at o − t, so the stop's hue goes down the wheel as t runs from 0 to 1)
    stop.animate(Array.from({ length: 13 }, (_, k) => ({ stopColor: `hsl(${(i * 30 - k * 30 + 720) % 360} 100% 60%)`, offset: k / 12 })),
      { duration: 800, iterations: Infinity, easing: 'linear' });
  }
  defs.append(grad); svg.append(defs);
  root.append(svg);
}

// --- the posts ----------------------------------------------------------------------------------
const isHandle = (s) => /^@\w{1,15}$/.test((s.text || '').trim());
const has = (el, a) => el.attr(a) !== null;
// the post's own parts: its quoted post's box (marked, and left out), its author's picture, name line
const parts = (art) => {
  for (const q of art.findAll('[role=link]:has([data-testid=User-Name])')) if (!has(q, 'data-trif-box-ps-quote')) q.setAttr('data-trif-box-ps-quote', '');
  const inQuote = (el) => !!el.closest('[data-trif-box-ps-quote]');
  const av = art.findAll('[data-testid=Tweet-User-Avatar] img[src*="/profile_images/"]').find((i) => !inQuote(i));
  const un = art.findAll('[data-testid=User-Name]').find((u) => !inQuote(u));
  return { av, un };
};
const setHas = (el, list) => { const v = list.join(' '); if ((el.attr('data-trif-box-ps') || '') !== v) { if (v) el.setAttr('data-trif-box-ps', v); else el.removeAttr('data-trif-box-ps'); } };
const setRainbow = (el, list) => { const v = list.join(' '); if ((el.attr('data-trif-box-ps-r') || '') !== v) { if (v) el.setAttr('data-trif-box-ps-r', v); else el.removeAttr('data-trif-box-ps-r'); } };
const unstyle = (art) => { for (const a of ['data-trif-box-ps-u', 'data-trif-box-ps', 'data-trif-box-ps-r']) art.removeAttr(a); };
const styleArt = (art, h, st) => {
  setAuthor(h, st);
  if (art.attr('data-trif-box-ps-u') !== h) art.setAttr('data-trif-box-ps-u', h);
  const keys = ['bg', 'name', 'badge', 'handle', 'text', 'links', 'icons', 'cards', 'lines', 'quotes', 'buttons']
    .filter((k) => isHex(k === 'bg' ? st.bg : k === 'name' ? st.name : k === 'badge' ? st.badge : k === 'handle' ? st.handle : k === 'text' ? st.text
      : k === 'links' ? st.links : k === 'icons' ? st.icons : k === 'cards' ? st.cards : k === 'lines' ? st.lines : k === 'quotes' ? st.quotes : st.buttons));
  for (const k of ['name', 'handle', 'text']) if (fontStack(st.fonts?.[k])) keys.push(`f${k}`, ...(Number.isInteger(st.fonts[k].weight) ? [`w${k}`] : []));
  setHas(art, keys);
  setRainbow(art, (st.rainbow || []).filter((k) => keys.includes(k) || k === 'bg'));
};
// name, handle, badge in the author's name line
const markNames = (un) => {
  const first = un.children[0];
  if (first && !has(first, 'data-trif-box-ps-name')) first.setAttr('data-trif-box-ps-name', '');
  for (const span of un.findAll('span:not([data-trif-box-ps-handle])')) if (!span.children.length && isHandle(span)) span.setAttr('data-trif-box-ps-handle', '');
  for (const svg of un.findAll('svg[data-testid=icon-verified]:not([data-trif-box-ps-badge])')) svg.setAttr('data-trif-box-ps-badge', '');
};

// emojis inside rainbow text: each run in its own span (as Profile Styler does; X's own text node stays,
// emptied, as an anchor), with trif.wrap, once per pass on the item it's handed (marked for the moment).
// The text beside an emoji goes in a span of its own too (a rainbow clipped to a span's text takes in its
// children's letters, emoji and all, so the rainbow goes only on spans with nothing inside them), and so does
// text sitting loose beside elements in a span, like Profile Styler's emoji spans (loose, below).
const EMOJI = /(\p{ExtPict}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{ExtPict})*)/gu;
const PIECES = /(\p{ExtPict}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{ExtPict})*)|(?<=\p{ExtPict}[^]*)[^\p{ExtPict}]+|[^\p{ExtPict}]+(?=[^]*\p{ExtPict})/u;
// Every emoji wrapper protects itself, inline and !important, which no stylesheet rule can beat: whatever
// rainbow, colour or clip any rule (of this mod, Profile Styler's, Rainbow Rave's, or one written later)
// puts on text, an emoji stays an emoji. (Its colour: CanvasText, the page's own text colour for its light
// or dark scheme, for the few emoji that draw in one colour, like ©.)
const protectEmoji = (s) => {
  s.style('color', 'CanvasText'); s.style('-webkit-text-fill-color', 'CanvasText');
  s.style('background', 'none'); s.style('background-clip', 'border-box');
  s.style('-webkit-background-clip', 'border-box'); s.style('text-shadow', 'none');
  s.style('animation', 'none'); s.style('filter', 'none');
};
const piece = (match, groups) => {
  const s = page.create('span');
  if (groups[0] != null) { s.setAttr('data-trif-box-ps-emoji', ''); protectEmoji(s); } else s.setAttr('data-trif-box-ps-txt', '');
  s.setText(match);
  return s;
};
// (a post's own text, not its quoted post's, unless the scope is that quoted post; not in svg, not in pieces)
const SKIP = ':not([data-trif-box-ps-emoji]):not([data-trif-box-ps-txt]):not([data-trif-box-pst-emoji]):not(svg):not(svg *)';
const wrapEmoji = (scope) => {
  scope.setAttr('data-trif-box-ps-wrap', '');
  const quote = scope.matches('[data-trif-box-ps-quote]');
  // (the scope's own text: everything inside it but a quoted post (when the scope isn't that quoted post)
  const sel = quote ? `[data-trif-box-ps-wrap] *${SKIP}` : `[data-trif-box-ps-wrap] *${SKIP}:not([data-trif-box-ps-quote]):not([data-trif-box-ps-quote] *)`;
  try { trif.wrap(sel, PIECES, piece)(); } catch (e) { trif.warn('post styler: emoji', String(e)); }
  // (loose text: whole, in a span of its own, where a span also holds elements, emoji pieces or others)
  const loose = quote ? '[data-trif-box-ps-wrap] span:has(> *)' : '[data-trif-box-ps-wrap] span:has(> *):not([data-trif-box-ps-quote] *)';
  try { trif.wrap(`${loose}:not([data-trif-box-ps-emoji]):not([data-trif-box-ps-txt]):not(svg *)`, /[^]*\S[^]*/, (m) => { const s = page.create('span'); s.setAttr('data-trif-box-ps-txt', ''); s.setText(m); return s; })(); } catch (e) { trif.warn('post styler: loose text', String(e)); }
  scope.removeAttr('data-trif-box-ps-wrap');
};
// (and two that stay, over every rainbow item: when X writes new text into a text node a wrap emptied (React
// does), TRIF takes the pieces out and wraps it again with these, as the free version's tidyEmoji did)
trif.wrap(`:is(article, a, ${CARDS})[data-trif-box-ps-r] *${SKIP}`, PIECES, piece);
trif.wrap(`:is(article, a, ${CARDS})[data-trif-box-ps-r] span:has(> *):not([data-trif-box-ps-emoji]):not([data-trif-box-ps-txt]):not(svg *)`, /[^]*\S[^]*/,
  (m) => { const sp = page.create('span'); sp.setAttr('data-trif-box-ps-txt', ''); sp.setText(m); return sp; });
const cardParts = (cell) => {
  const boxes = cell.findAll('[data-testid^="UserAvatar-Container-"]');
  if (new Set(boxes.map((b) => b.attr('data-testid').toLowerCase())).size !== 1) {
    if (has(cell, 'data-trif-box-ps-u')) unstyle(cell);
    return {};
  }
  const box = boxes[0];
  const h = /^UserAvatar-Container-(\w{1,15})$/.exec(box?.attr('data-testid') || '')?.[1];
  const av = cell.find('img[src*="/profile_images/"]');
  if (!h || !av) return {};
  // (the name: a span with text that isn't the @handle, holding nothing but text and emoji wrappers; first
  // in the link to them, else (the search box's drop-down, whose entries have no link to the person) the
  // first such span in the card outside its buttons)
  // (a button in the card, Follow or the ✕ by a recent search, isn't the name; but a drop-down entry is a
  // button itself, picture and all, and its name is inside it)
  const nameIn = (scope) => {
    for (const s of scope.findAll('span')) {
      if (s.closest('[data-trif-box-ps-emoji], [data-trif-box-ps-txt], [data-trif-box-pst-emoji]')) continue;
      const btn = s.closest('button, [role=button]');
      if (btn && !box.closest('button, [role=button]') === btn) continue;
      const t = (s.text || '').trim();
      if (t && !t.startsWith('@') && !s.find('span:not([data-trif-box-ps-emoji]):not([data-trif-box-ps-txt]):not([data-trif-box-pst-emoji])')) return s;
    }
    return null;
  };
  if (!cell.find('[data-trif-box-ps-name]')) {
    const link = [...cell.findAll('a[href]')].find((a) => a.attr('href').toLowerCase() === `/${h.toLowerCase()}` && !a.find('img'));
    const s = (link && nameIn(link)) || nameIn(cell);
    if (s) s.setAttr('data-trif-box-ps-name', '');
  }
  for (const s of cell.findAll('span:not([data-trif-box-ps-handle])')) if (!s.children.length && isHandle(s)) s.setAttr('data-trif-box-ps-handle', '');
  for (const svg of cell.findAll('svg[data-testid=icon-verified]:not([data-trif-box-ps-badge])')) svg.setAttr('data-trif-box-ps-badge', '');
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
  const url = big(av.attr('src') || '');
  const known = seenMap.get(url);
  if (known === undefined) { readCode(av, url); return undefined; }
  byHandle.set(h, known || null);
  return known || null;
};
// one post or card
const styleOne = (el, h, av, me) => {
  const st = resolve(h, av, me);
  if (st === undefined) {
    if (el.attr('data-trif-box-ps-u') && el.attr('data-trif-box-ps-u') !== h) unstyle(el); // (reused: someone else's now)
    return;
  }
  if (st) styleArt(el, h, st); else if (has(el, 'data-trif-box-ps-u')) unstyle(el);
  // (any rainbow at all: its emojis wrapped, and so protected; see protectEmoji)
  if (el.attr('data-trif-box-ps-r')) wrapEmoji(el);
};
// a name link: just the name, in that person's name colour (or rainbow)
const styleName = (a, h, av, me) => {
  const st = resolve(h, av, me);
  if (st === undefined) return;
  if (!st || !isHex(st.name)) { if (has(a, 'data-trif-box-ps-u')) { a.removeAttr('data-trif-box-ps-u'); a.removeAttr('data-trif-box-ps'); a.removeAttr('data-trif-box-ps-r'); } return; }
  setAuthor(h, st);
  if (a.attr('data-trif-box-ps-u') !== h) a.setAttr('data-trif-box-ps-u', h);
  if (!has(a, 'data-trif-box-ps-n')) a.setAttr('data-trif-box-ps-n', '');
  setHas(a, ['name']);
  setRainbow(a, (st.rainbow || []).includes('name') ? ['name'] : []);
  if ((st.rainbow || []).includes('name')) wrapEmoji(a);
};
// the links to someone in a box that are their name (not the @handle, not their picture)
const nameLinks = (box, h) => box.findAll('a[href]').filter((a) => a.attr('href').toLowerCase() === `/${h}`
  && !a.find('img, [data-testid^="UserAvatar-Container-"]') && !(a.text || '').trim().startsWith('@') && (a.text || '').trim());
const tick = () => {
  try {
    const me = (myHandle() || '').toLowerCase();
    for (const art of page.findAll('#react-root article')) {
      const { av, un } = parts(art);
      if (!av || !un) continue;
      const h = (un.findAll('span').find(isHandle)?.text.trim().slice(1) || '').toLowerCase();
      if (!h) continue;
      markNames(un);
      styleOne(art, h, av, me);
      // its quoted post: in the quoted author's style, when they have one
      for (const q of art.findAll('[data-trif-box-ps-quote]')) {
        const qav = q.find('[data-testid=Tweet-User-Avatar] img[src*="/profile_images/"]');
        const qun = q.find('[data-testid=User-Name]');
        const qh = qun && (qun.findAll('span').find(isHandle)?.text.trim().slice(1) || '').toLowerCase();
        if (!qav || !qh) continue;
        markNames(qun);
        styleOne(q, qh, qav, me);
      }
    }
    for (const cell of page.findAll(`#react-root :is(${CARDS})`)) {
      const { av, h } = cardParts(cell);
      if (av) styleOne(cell, h, av, me);
    }
    // notifications ("Tim followed you", "Tim and 3 others liked your post"): each pictured person's name
    for (const n of page.findAll('#react-root article[data-testid=notification]')) {
      for (const box of n.findAll('[data-testid^="UserAvatar-Container-"]')) {
        const h = /^UserAvatar-Container-(\w{1,15})$/.exec(box.attr('data-testid') || '')?.[1]?.toLowerCase();
        const av = box.find('img[src*="/profile_images/"]');
        if (!h || !av) continue;
        for (const a of nameLinks(n, h)) styleName(a, h, av, me);
      }
    }
    // a post's "Tim reposted" line: no picture there, so whoever's been seen already (byHandle)
    for (const sc of page.findAll('#react-root article [data-testid=socialContext]')) {
      const a = sc.closest('a[href]') || sc.find('a[href]');
      const h = /^\/(\w{1,15})$/.exec(a?.attr('href') || '')?.[1]?.toLowerCase();
      if (h && (byHandle.has(h) || h === me)) styleName(a, h, null, me);
    }
  } catch (e) { trif.warn('post styler', String(e)); }
};
setInterval(tick, 800);
tick();
