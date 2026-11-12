// ==WebMod==
// @name        Profile Styler
// @description Profiles show the colours their owners chose
// @match       https://x.com/*
// @run-at      document-idle
// @risk        1 reads profile pictures from X's image server again (at 400×400) to find style codes and songs; restyles only those profiles' pages; plays a profile's song only when you click its speaker
// @source      trif
// @version     2
// ==/WebMod==

// Tim's. Works with Style Encoder (style-encoder.js), the way Image Borders works on uploads.
//
// A profile picture can carry a style: a code in its bottom-left corner, which X's round crop hides.
// On anyone's profile page (/name and its tabs), this reads that person's picture, and if the code is there,
// paints the whole page while you're on their profile (theirs only) in their colours: background, display
// name, verified badge, @handle, general text, buttons and links. Any of them can be "rainbow": the
// background is Rainbow Rave's rolling rainbow, the rest Rainbow Rave's small badge rainbow.
// On your own profile, "Style profile" (beside Edit profile) opens the editing suite: pick the colours and
// they're on at once, and stay on (your own profile shows your choice). Style Encoder stamps your choice
// into the next profile picture you upload, which is how others see it.
//
// The code, from 2026-11: picture code v2 (PicCode, StyleCode; the same in style-encoder.js, character for
// character): 2×2-pixel gray cells, 2 bits each, the corner a stream with a mark, a length and a CRC-16; the
// style in it exactly (colours, rainbows, fonts), and exactly still when X makes the picture a JPEG. It's
// read first; a picture without it is read for the colour code before it, as it always was.
// The colour code: 4×4-pixel cells of a 400×400 picture, counted from the bottom-left corner (x right, y up),
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
// The song: a picture's other three corners can carry a tune (Tune Composer's; picture code v2, kind song). A
// profile whose picture has one shows a small speaker button beside its Follow or Edit profile button: click to
// play it (Tune Composer's NES synth, round and round), click again to stop. It never starts by itself, stops
// when you leave the profile, and only one plays at a time. A damaged, unreadable or silent song: no button.
// TuneCodec and TuneSynth are Tune Composer's own blocks, character for character, made only when needed: the
// codec when a picture has a song, the synth at the first click.
//
// The fonts: three, for the name, the @handle and all other text, picked in the panel from the fonts on
// your computer (found by measuring text: a font is there when "<font>", serif and the like measure unlike
// serif alone; once, when the panel first opens; "More fonts…" asks the browser for the full list, where it
// can, queryLocalFonts) or "Default" (X's own). Each is stored by its name, with a fallback type (sans,
// serif, mono, rounded, handwriting, display) and maybe a weight, in a font block after the colours: cells
// on x + y even from x + y = 14 out (the old code never reads them; see fontCode for the order and values),
// one 6-bit value per cell as one of the 64 palette colours, so a JPEG reads the same (when it doesn't
// smear past half a step). A block opens with 42 and ends with a 12-bit checksum: a picture without one, or
// with a damaged one, has no fonts, never garbage. Names are only ever lower-case letters, digits, space
// and - . _ & + ! ( ) / (anything else can't be stored, so can't reach the CSS), always quoted in it.
// On a styled profile, each font goes in as "<font>", look-alikes on other systems (Helvetica: Arial,
// Menlo: Consolas…), then its type's generic family, where the colours go: the name, the handles, the rest.
// A picture from before fonts reads as it always did, with no fonts; an older Profile Styler ignores them.
// (That font block is only read now: new pictures carry their fonts in picture code v2.)
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
  const fromList = (v, rainbow, fonts) => ({ bg: v[0], name: v[1], badge: v[2], handle: v[3], text: v[4], buttons: v[5], links: v[6], panel: v[7],
    icons: v[8], logo: v[9], cards: v[10], lines: v[11], quotes: v[12], rainbow, fonts: fonts || null });
  const root = document.documentElement;

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

  // Tune Composer's codec and synth (tune-composer.js, character for character; tests/styler-tune.test.js
  // checks): set up only when a picture has a song, and only at the first click.
  let madeCodec = null, madeSynth = null;
  const tuneCodec = () => madeCodec || (madeCodec = (() => {
  /* tune-codec:begin */
  // The song model and its bytes. Self-contained (no DOM, no audio), to be shared with Style Encoder and
  // Profile Styler when tunes go into pictures. A song:
  //   { v, tempo, rpb, beats, unit, rows, inst: { p1, p2, noise }, patterns: [{ p1, p2, tri, noise }], order: [pattern index] }
  //   the meter: beats a bar 2–12 and the beat's unit, 4 or 8 (tempo counts beats of that unit a minute); rows:
  //     every pattern's rows, 1–32 (the composer makes it one or two bars); v: the version it's written in, 3 or 4
  //   pulse instrument { duty 0–3, vol 0–15, decay 0–7, sweep: null | { neg, period 0–7, shift 1–7 } }
  //   noise instrument { vol 0–15, kit: 8 × [period 0–15, mode 0 long | 1 short] }
  //   a note { row 0 to rows − 1, len 1 to rows, pitch 0–61 } (pulse notes may also carry vol, decay, duty of their own)
  //   a hit  { row 0 to rows − 1, len 1–8, drum 0–7 }
  // Up to 64 patterns, and up to 256 entries in the order.
  //
  // The bytes: version 3 bits · payload length 13 bits · the payload · CRC-8 (polynomial 0x07) of all before it.
  // The payload is a stream of symbols (below), written one of three ways:
  //   version 4: as version 3, plus the meter and the rows (after rows per beat), with lengths (`len`, `rlen`)
  //     up to 32 and repeats (`repD`, `repN`) up to 32, in tables of their own. Written only when it's needed:
  //     a song in 4/4 with 16-row patterns is written as version 3, which older readers know
  //   version 3: a binary range coder (LZMA's kind, 11-bit odds), each symbol as the bits of a little binary
  //     tree whose odds are kept per symbol kind and context, start from version 2's codes, and move by 1/2, 1/4,
  //     1/4, 1/8 … then 1/16 of the way each time they're used (RATES: fast while there's little to go on).
  //     It reads as 4/4, 16 rows
  //   version 2: plain prefix codes (each kind's short codes, then 1s and the symbol in full); 4/4, 16 rows
  // Integer maths only, so every browser reads the same bytes the same way.
  //
  // The symbols. Settings first, in plain bits: tempo 8 (bpm − 32) · rows per beat 2 · (version 4: beats − 2: 4
  // · unit 1 (0: 4, 1: 8) · rows − 1: 5) · key 4 (the tonic 0–11 of
  // a major scale, or 12: none; the encoder tries all 13 and keeps the shortest) · Pulse 1 and 2: duty 2 ·
  // volume 4 · decay 3 · sweep 1 (+ negate 1 · period 3 · shift 3) · Noise: volume 4 · custom kit 1 (+ 8 ×
  // period 4 · mode 1) · patterns − 1: 6 · order length − 1: 8. The order: per entry, `ord` (the next pattern,
  // the same again, or written out in full). Then per pattern and channel, `lane`:
  //   empty · an earlier pattern's lane of this channel (`back` patterns back), moved by `shift` semitones ·
  //   another melodic channel's lane (1 bit which, `back`, `shift`) · or its events, until its rows are filled:
  //   a note: the interval from the channel's last note, `iv` in semitones (−61…61) or, in a key, `deg` in steps of
  //     the scale (a note outside it: `deg` SHARP, then the step to the note below it); and `len` (0 = as the
  //     last note, or 1–16; version 4: 1–32)
  //   a hit: `drum` (0–7) and `dlen` (0 = as the last hit, or 1–8)    a rest: `rlen` (0 = as the last, or 1–16; 4: 1–32)
  //   a repeat: `repD` events back, `repN` events, moved by `shift` semitones (it may overlap itself: a repeat
  //     of the last one, 7 times, is 7 more hats; moved, it climbs, a sequence)
  //   a settings change (pulses, until the pattern ends): `esc` volume 4 / decay 3 / duty 2 bits
  // Contexts (format 3): the event kind after the last one; intervals after the last interval (none, 0, up or down
  // a little, up or down a lot) and per pulse/triangle; lengths after the last length; drums after the last drum.
  // (None is a place in the pattern, so longer patterns need no more of them.)
  const TuneCodec = (() => {
    const VERSION = 4, V3 = 3, STATIC = 2, ROWS = 16, MAX_ROWS = 32, PITCHES = 62;
    const BEATS_MIN = 2, BEATS_MAX = 12, UNITS = [4, 8];
    const TEMPO_MIN = 32, TEMPO_MAX = 287, RPB = [2, 3, 4, 6];
    const MAX_PATTERNS = 64, MAX_ORDER = 256, DRUMS = 8, MAX_DRUM_LEN = 8, MAX_PAYLOAD = 8191;
    const CHANNELS = ['p1', 'p2', 'tri', 'noise'], MELODIC = ['p1', 'p2', 'tri'];
    const BASE = { p1: 36, p2: 36, tri: 24 }; // (MIDI note of pitch 0: C2 on the pulses, C1 on the triangle)
    const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open hat', 'Low tom', 'High tom', 'Clap', 'Crash'];
    const DRUM_KEYS = 'KSHOLTCX'; // (for lanes written as text: Kick Snare Hat Open hat Low tom Tom high Clap X crash)
    const KIT = [[10, 0], [7, 0], [1, 0], [1, 0], [7, 1], [5, 1], [5, 0], [3, 0]]; // the standard kit: [period, mode]

    const fail = (msg) => { throw new RangeError(`tune: ${msg}`); };
    const int = (v, lo, hi, what) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fail(`${what} must be a whole number from ${lo} to ${hi}, not ${v}`));
    const width = (n) => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));
    const laneOf = (p, ch) => (ch === 'p1' ? p.p1 : ch === 'p2' ? p.p2 : ch === 'tri' ? p.tri : p.noise);
    const instOf = (inst, ch) => (ch === 'p1' ? inst.p1 : ch === 'p2' ? inst.p2 : null);

    // --- checking a song (and putting it in its one canonical form) ---
    const pulseInst = (i) => {
      i = i || {};
      const sw = i.sweep;
      return {
        duty: int(i.duty ?? 2, 0, 3, 'duty'), vol: int(i.vol ?? 10, 0, 15, 'volume'), decay: int(i.decay ?? 0, 0, 7, 'decay'),
        sweep: sw ? { neg: !!sw.neg, period: int(sw.period ?? 0, 0, 7, 'sweep period'), shift: int(sw.shift ?? 1, 1, 7, 'sweep shift') } : null,
      };
    };
    const noiseInst = (i) => {
      i = i || {};
      const kit = i.kit || KIT;
      if (!Array.isArray(kit) || kit.length !== DRUMS) fail('a kit has 8 drums');
      return { vol: int(i.vol ?? 12, 0, 15, 'noise volume'), kit: kit.map((k) => [int(k[0], 0, 15, 'drum period'), int(+k[1], 0, 1, 'drum mode')]) };
    };
    const melodic = (list, inst, what, rows) => {
      const out = (list || []).map((n) => {
        const o = { row: int(n.row, 0, rows - 1, `${what} row`), len: int(n.len, 1, rows, `${what} length`), pitch: int(n.pitch, 0, PITCHES - 1, `${what} pitch`) };
        if (o.row + o.len > rows) fail(`${what}: a note runs past the end of its pattern`);
        if (inst) {
          if (n.vol != null && n.vol !== inst.vol) o.vol = int(n.vol, 0, 15, 'volume');
          if (n.decay != null && n.decay !== inst.decay) o.decay = int(n.decay, 0, 7, 'decay');
          if (n.duty != null && n.duty !== inst.duty) o.duty = int(n.duty, 0, 3, 'duty');
        }
        return o;
      }).sort((a, b) => a.row - b.row);
      for (let i = 1; i < out.length; i++) if (out[i].row < out[i - 1].row + out[i - 1].len) fail(`${what}: notes overlap (a channel plays one note at a time)`);
      return out;
    };
    const drums = (list, rows) => {
      const out = (list || []).map((h) => {
        const o = { row: int(h.row, 0, rows - 1, 'drum row'), len: int(h.len, 1, MAX_DRUM_LEN, 'drum length'), drum: int(h.drum, 0, DRUMS - 1, 'drum') };
        if (o.row + o.len > rows) fail('Noise: a hit runs past the end of its pattern');
        return o;
      }).sort((a, b) => a.row - b.row);
      for (let i = 1; i < out.length; i++) if (out[i].row < out[i - 1].row + out[i - 1].len) fail('Noise: hits overlap (one drum at a time)');
      return out;
    };
    const laneNorm = (list, ch, inst, rows) => (ch === 'noise' ? drums(list, rows) : melodic(list, instOf(inst, ch), ch === 'p1' ? 'Pulse 1' : ch === 'p2' ? 'Pulse 2' : 'Triangle', rows));
    // (4/4 with 16-row patterns: what version 3 holds)
    const plainMeter = (s) => s.beats === 4 && s.unit === 4 && s.rows === ROWS;
    function normalize(s) {
      if (!s || typeof s !== 'object') fail('not a song');
      const si = s.inst || {};
      const inst = { p1: pulseInst(si.p1), p2: pulseInst(si.p2), noise: noiseInst(si.noise) };
      const beats = int(s.beats ?? 4, BEATS_MIN, BEATS_MAX, 'beats per bar'), unit = s.unit ?? 4, rows = int(s.rows ?? ROWS, 1, MAX_ROWS, 'rows per pattern');
      if (!UNITS.includes(unit)) fail(`the beat is ${UNITS.join(' or ')}`);
      if (!Array.isArray(s.patterns) || !s.patterns.length) fail('a song needs at least one pattern');
      if (s.patterns.length > MAX_PATTERNS) fail(`a song has at most ${MAX_PATTERNS} patterns`);
      const patterns = s.patterns.map((p) => {
        p = p || {};
        return { p1: laneNorm(p.p1, 'p1', inst, rows), p2: laneNorm(p.p2, 'p2', inst, rows), tri: laneNorm(p.tri, 'tri', inst, rows), noise: laneNorm(p.noise, 'noise', inst, rows) };
      });
      if (!Array.isArray(s.order) || !s.order.length) fail('the song order is empty');
      if (s.order.length > MAX_ORDER) fail(`the song order has at most ${MAX_ORDER} entries`);
      const rpb = s.rpb ?? 4;
      if (!RPB.includes(rpb)) fail(`rows per beat must be ${RPB.join(', ')}`);
      return { v: plainMeter({ beats, unit, rows }) ? V3 : VERSION, tempo: int(s.tempo ?? 150, TEMPO_MIN, TEMPO_MAX, 'tempo'), rpb, beats, unit, rows, inst, patterns, order: s.order.map((o) => int(o, 0, patterns.length - 1, 'order entry')) };
    }

    // --- bits ---
    const writer = () => {
      const bytes = [];
      let n = 0;
      return {
        put(v, w) {
          for (let i = w - 1; i >= 0; i--) {
            if ((n & 7) === 0) bytes.push(0);
            if ((v >>> i) & 1) bytes[bytes.length - 1] |= 0x80 >>> (n & 7);
            n++;
          }
        },
        bytes: () => Uint8Array.from(bytes),
      };
    };
    const reader = (bytes) => {
      let n = 0;
      return {
        get(w) {
          let v = 0;
          for (let i = 0; i < w; i++) {
            if (n >= bytes.length * 8) fail('the data ends too soon');
            v = (v << 1) | ((bytes[n >>> 3] >>> (7 - (n & 7))) & 1);
            n++;
          }
          return v;
        },
      };
    };
    const crc8 = (bytes, end) => {
      let c = 0;
      for (let i = 0; i < end; i++) {
        c ^= bytes[i];
        for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
      }
      return c;
    };

    // --- the symbols' alphabets, and their short codes: [size, [tier 0 values, tier 1 values, …]]. A value in
    // tier t is t 1s, a 0 and its place in the tier; any other value, as many 1s as tiers and then itself ---
    const IV = 63; // (an interval's symbol is the interval + 63)
    // a key: the notes of a major scale (or its relative minor), its tonic's pitch class 0–11 (12: no key). Its
    // notes are counted in steps of the scale; a note outside it is a sharp of the one below (one step: SHARP)
    const MAJOR = [0, 2, 4, 5, 7, 9, 11], SHARP = 126, NO_KEY = 12;
    const inKey = (p, k) => MAJOR.includes((p - k + 12) % 12);
    const degree = (p, k) => { const d = p - k + 12 - (inKey(p, k) ? 0 : 1); return Math.floor(d / 12) * 7 + MAJOR.indexOf(d % 12); };
    const pitchAt = (g, k) => Math.floor(g / 7) * 12 + MAJOR[g % 7] + k - 12;
    const iv = (...xs) => xs.map((x) => x + IV);
    const MODELS = {
      ev: [4, [[0], [1, 2]]], // next in a lane: 0 a note (or a hit), 1 a rest, 2 a repeat, 3 a settings change
      iv: [127, [iv(0, 2, -2, -1), iv(1, 3, -3, 4, -4, 5, -5, 7), iv(-7, 12, -12, 9, -9, 8, -8, 10)]], // in semitones
      deg: [127, [iv(0, 1, -1, 2), iv(-2, 3, -3, 4, -4, 7, -7, 5), [...iv(-5, 6, -6, 9, -9, 8, -8), 126]]], // in steps of the key (126: sharp)
      len: [17, [[0], [2, 1, 4, 8]]], // 0 = as the last one
      rlen: [17, [[0], [2, 1, 4, 8]]],
      drum: [8, [[2, 0], [1, 3]]],
      dlen: [9, [[0], [1, 2, 4, 3]]],
      repD: [16, [[0, 1, 3, 7]]], // (1 less than the distance and the count)
      repN: [16, [[1, 3, 2, 7]]],
      shift: [127, [iv(0), iv(12, -12, 5, -5, 7, -7, 2, -2)]],
      lane: [4, [[0], [1, 2]]],
      back: [64, [[1, 2, 4, 3]]],
      ord: [3, [[0]]],
      esc: [3, []],
      // version 4's, for patterns of up to 32 rows: the same short codes, with room for more
      'len+': [33, [[0], [2, 1, 4, 8]]],
      'rlen+': [33, [[0], [2, 1, 4, 8]]],
      'repD+': [32, [[0, 1, 3, 7]]],
      'repN+': [32, [[1, 3, 2, 7]]],
    };
    const WIDE = { len: 'len+', rlen: 'rlen+', repD: 'repD+', repN: 'repN+' };
    const tierBits = (tier) => 31 - Math.clz32(tier.length);
    const codeLen = (m, v) => {
      const [n, tiers] = MODELS[m];
      for (let t = 0; t < tiers.length; t++) if (tiers[t].includes(v)) return t + 1 + tierBits(tiers[t]);
      return tiers.length + width(n);
    };
    // format 2: the codes as they are
    const staticOut = () => {
      const w = writer();
      return {
        minRepeat: 3, // (the shortest repeat worth its codes)
        run: 16, // (the longest repeat, and how far back)
        sym(m, ctx, v) {
          const [n, tiers] = MODELS[m];
          for (let t = 0; t < tiers.length; t++) {
            const i = tiers[t].indexOf(v);
            if (i >= 0) { w.put((1 << (t + 1)) - 2, t + 1); w.put(i, tierBits(tiers[t])); return; }
          }
          w.put((1 << tiers.length) - 1, tiers.length); w.put(v, width(n));
        },
        raw: (v, b) => w.put(v, b),
        bytes: () => w.bytes(),
      };
    };
    const staticIn = (bytes) => {
      const r = reader(bytes);
      return {
        sym(m) {
          const [n, tiers] = MODELS[m];
          let t = 0;
          while (t < tiers.length && r.get(1)) t++;
          const v = t < tiers.length ? tiers[t][r.get(tierBits(tiers[t]))] : r.get(width(n));
          return v < n ? v : fail('damaged data');
        },
        raw: (b) => r.get(b),
      };
    };
    // format 3: a binary range coder. Each table holds, per node of a symbol's binary tree, the odds (of 2048)
    // that the next bit is 0; it starts from the codes above (a value with a code k bits long: odds 2^−k)
    const PB = 11, ONE = 1 << PB;
    // (odds in the low 11 bits, and how often they've moved in the top 5: they move fast at first, then settle)
    const RATES = [1, 2, 2, 3, 3, 3, 4];
    const adapt = (p, i, b) => {
      const q = p[i] & (ONE - 1), c = p[i] >> PB, r = RATES[Math.min(c, RATES.length - 1)];
      p[i] = (b ? q - (q >> r) : q + ((ONE - q) >> r)) | (Math.min(c + 1, 31) << PB);
    };
    const priors = new Map();
    const prior = (m) => {
      if (!priors.has(m)) {
        const n = MODELS[m][0], size = 1 << width(n), lens = [];
        for (let v = 0; v < n; v++) lens.push(codeLen(m, v));
        const top = Math.max(...lens), freq = (v) => (v < n ? 2 ** (top - lens[v]) : 0), p = new Uint16Array(size);
        for (let node = 1; node < size; node++) {
          const d = 31 - Math.clz32(node), span = size >> d, lo = (node - (1 << d)) * span;
          let left = 0, all = 0;
          for (let v = lo; v < lo + span; v++) { all += freq(v); if (v < lo + span / 2) left += freq(v); }
          p[node] = all ? Math.min(ONE - 32, Math.max(32, Math.floor((left * ONE) / all))) : ONE >> 1;
        }
        priors.set(m, p);
      }
      return priors.get(m);
    };
    const tableOf = (tables, m, ctx) => {
      const k = `${m} ${ctx}`;
      if (!tables.has(k)) tables.set(k, prior(m).slice());
      return tables.get(k);
    };
    // (wide: version 4's, with its wider tables for lengths and repeats)
    const acOut = (wide) => {
      const tables = new Map(), out = [];
      let low = 0, range = 0xffffffff, cache = 0, pending = 1;
      const shiftLow = () => {
        if (low < 0xff000000 || low >= 0x100000000) {
          const carry = low >= 0x100000000 ? 1 : 0;
          let b = cache;
          do { out.push((b + carry) & 0xff); b = 0xff; } while (--pending);
          cache = (low >>> 24) & 0xff;
        }
        pending++;
        low = (low & 0xffffff) * 256;
      };
      const bit = (p, i, b) => {
        const q = p ? p[i] & (ONE - 1) : ONE >> 1, bound = (range >>> PB) * q;
        if (b) { low += bound; range -= bound; } else range = bound;
        if (p) adapt(p, i, b);
        while (range < 0x1000000) { range *= 256; shiftLow(); }
      };
      return {
        minRepeat: 5, // (shorter ones cost more than the notes, once the odds have learnt the tune)
        run: wide ? 32 : 16,
        sym(m, ctx, v) {
          if (wide && WIDE[m]) m = WIDE[m];
          const p = tableOf(tables, m, ctx), w = width(MODELS[m][0]);
          for (let i = w - 1, node = 1; i >= 0; i--) { const b = (v >> i) & 1; bit(p, node, b); node = node * 2 + b; }
        },
        raw(v, w) { for (let i = w - 1; i >= 0; i--) bit(null, 0, (v >> i) & 1); },
        bytes() {
          // the shortest ending: the value in [low, low + range) with the most 0 bits after it (the reader
          // reads 0s past the end)
          for (let s = 32; s >= 0; s--) { const unit = 2 ** s, v = Math.ceil(low / unit) * unit; if (v < low + range) { low = v; break; } }
          for (let i = 0; i < 5; i++) shiftLow();
          out.shift(); // (the first byte is always 0)
          while (out.length && !out[out.length - 1]) out.pop();
          return Uint8Array.from(out);
        },
      };
    };
    const acIn = (bytes, wide) => {
      const tables = new Map();
      let pos = 0, range = 0xffffffff, code = 0;
      const next = () => (pos < bytes.length ? bytes[pos++] : 0);
      for (let i = 0; i < 4; i++) code = code * 256 + next();
      const bit = (p, i) => {
        const q = p ? p[i] & (ONE - 1) : ONE >> 1, bound = (range >>> PB) * q;
        let b = 0;
        if (code < bound) range = bound; else { code -= bound; range -= bound; b = 1; }
        if (p) adapt(p, i, b);
        while (range < 0x1000000) { range *= 256; code = (code % 0x1000000) * 256 + next(); }
        return b;
      };
      return {
        sym(m, ctx) {
          if (wide && WIDE[m]) m = WIDE[m];
          const n = MODELS[m][0], p = tableOf(tables, m, ctx), w = width(n);
          let node = 1;
          for (let i = 0; i < w; i++) node = node * 2 + bit(p, node);
          return node - (1 << w) < n ? node - (1 << w) : fail('damaged data');
        },
        raw(w) { let v = 0; for (let i = 0; i < w; i++) v = v * 2 + bit(null, 0); return v; },
      };
    };

    // --- lanes as events: notes ({ pitch, len } and on the pulses their settings in full), hits, rests ---
    const EV_NOTE = 0, EV_REST = 1, EV_REPEAT = 2, EV_SET = 3;
    const settingOf = (e, k) => (k === 0 ? e.vol : k === 1 ? e.decay : e.duty);
    const setSetting = (e, k, v) => { if (k === 0) e.vol = v; else if (k === 1) e.decay = v; else e.duty = v; };
    const SETTING_BITS = [4, 3, 2];
    function toEvents(lane, ch, inst, rows) {
      const out = [], pi = instOf(inst, ch);
      let row = 0;
      for (const n of lane) {
        if (n.row > row) out.push({ rest: n.row - row });
        out.push(ch === 'noise' ? { drum: n.drum, len: n.len } : pi ? { pitch: n.pitch, len: n.len, vol: n.vol ?? pi.vol, decay: n.decay ?? pi.decay, duty: n.duty ?? pi.duty } : { pitch: n.pitch, len: n.len });
        row = n.row + n.len;
      }
      if (row < rows) out.push({ rest: rows - row });
      return out;
    }
    function fromEvents(events, ch, inst, rows) {
      const lane = [];
      let row = 0;
      for (const e of events) {
        if (e.rest) { row += e.rest; continue; }
        lane.push(ch === 'noise' ? { row, len: e.len, drum: e.drum } : { row, len: e.len, pitch: e.pitch, vol: e.vol, decay: e.decay, duty: e.duty });
        row += e.len;
      }
      return laneNorm(lane, ch, inst, rows);
    }
    const sameEvent = (a, b, t) => (a.rest || b.rest ? a.rest === b.rest : a.len === b.len
      && (a.drum !== undefined ? a.drum === b.drum : a.pitch === b.pitch + t && a.vol === b.vol && a.decay === b.decay && a.duty === b.duty));
    const moved = (e, t) => (e.pitch === undefined || !t ? e : { ...e, pitch: e.pitch + t });
    // what each channel remembers from lane to lane (the contexts)
    const freshState = () => ({ pitch: 24, ivb: 0, len: 0, rlen: 0, dlen: 0, drum: 8, ev: 4, row: 0 });
    const lenB = (l) => (l <= 4 ? l : l < 8 ? 5 : 6);
    const ivB = (d) => (d === 0 ? 1 : d > 0 ? (d <= 4 ? 2 : 4) : d >= -4 ? 3 : 5);
    const step = (st, e) => {
      st.row += e.rest || e.len;
      if (e.rest) st.rlen = e.rest;
      else if (e.drum !== undefined) { st.drum = e.drum; st.dlen = e.len; } else { st.ivb = ivB(e.pitch - st.pitch); st.pitch = e.pitch; st.len = e.len; }
    };
    const kindOf = (ch) => (ch === 'noise' ? 'd' : ch === 'tri' ? 't' : 'p');
    // the longest repeat of earlier events (distance d, count n, moved by t semitones) starting at event k, of
    // at most `run` events from at most `run` back
    function findRepeat(events, k, run) {
      let best = { n: 0, d: 0, t: 0 };
      for (let d = 1; d <= Math.min(k, run); d++) {
        let n = 0, t = null;
        while (k + n < events.length && n < run) {
          const a = events[k + n], b = events[k + n - d];
          if (t === null && a.pitch !== undefined && b.pitch !== undefined) t = a.pitch - b.pitch;
          if (!sameEvent(a, b, t || 0)) break;
          n++;
        }
        if (n > best.n || (n === best.n && n && Math.abs(t || 0) < Math.abs(best.t))) best = { n, d, t: t || 0 };
      }
      return best;
    }
    function writeLane(io, events, ch, st, inst, key) {
      const kind = kindOf(ch), pi = instOf(inst, ch), cur = pi && { vol: pi.vol, decay: pi.decay, duty: pi.duty };
      const ev = (k) => { io.sym('ev', kind + st.ev, k); st.ev = k; };
      st.row = 0;
      const took = (e) => { step(st, e); if (cur && e.pitch !== undefined) { cur.vol = e.vol; cur.decay = e.decay; cur.duty = e.duty; } };
      for (let k = 0; k < events.length;) {
        const rep = findRepeat(events, k, io.run);
        if (rep.n >= io.minRepeat) {
          ev(EV_REPEAT); io.sym('repD', kind, rep.d - 1); io.sym('repN', kind, rep.n - 1);
          if (ch !== 'noise') io.sym('shift', kind, rep.t + IV);
          for (let i = 0; i < rep.n; i++) took(events[k++]);
          continue;
        }
        const e = events[k++];
        if (e.rest) { ev(EV_REST); io.sym('rlen', kind, e.rest === st.rlen ? 0 : e.rest); }
        else if (e.drum !== undefined) { ev(EV_NOTE); io.sym('drum', st.drum, e.drum); io.sym('dlen', lenB(st.dlen), e.len === st.dlen ? 0 : e.len); }
        else {
          if (cur) for (let s = 0; s < 3; s++) if (settingOf(e, s) !== settingOf(cur, s)) { ev(EV_SET); io.sym('esc', '', s); io.raw(settingOf(e, s), SETTING_BITS[s]); setSetting(cur, s, settingOf(e, s)); }
          ev(EV_NOTE);
          if (key === NO_KEY) io.sym('iv', kind + st.ivb, e.pitch - st.pitch + IV);
          else {
            if (!inKey(e.pitch, key)) io.sym('deg', kind + st.ivb, SHARP);
            io.sym('deg', kind + st.ivb, degree(e.pitch, key) - degree(st.pitch, key) + IV);
          }
          io.sym('len', kind + lenB(st.len), e.len === st.len ? 0 : e.len);
        }
        took(e);
      }
    }
    function readLane(io, ch, st, inst, key, size) {
      const kind = kindOf(ch), pi = instOf(inst, ch), cur = pi && { vol: pi.vol, decay: pi.decay, duty: pi.duty }, out = [];
      let rows = 0, guard = 0;
      st.row = 0;
      const took = (e) => {
        rows += e.rest || e.len || fail('damaged data');
        if (rows > size) fail('a lane runs past the end of its pattern');
        out.push(e); step(st, e);
        if (cur && e.pitch !== undefined) { cur.vol = e.vol; cur.decay = e.decay; cur.duty = e.duty; }
      };
      while (rows < size) {
        if (++guard > 4 * size) fail('damaged data');
        const k = io.sym('ev', kind + st.ev);
        st.ev = k;
        if (k === EV_REPEAT) {
          const d = io.sym('repD', kind) + 1, n = io.sym('repN', kind) + 1, t = ch === 'noise' ? 0 : io.sym('shift', kind) - IV;
          for (let i = 0; i < n; i++) {
            const e = moved(out[out.length - d] || fail('a repeat reaches back too far'), t);
            if (e.pitch !== undefined && (e.pitch < 0 || e.pitch >= PITCHES)) fail('a repeat moves a note out of range');
            took(e);
          }
        } else if (k === EV_REST) took({ rest: io.sym('rlen', kind) || st.rlen });
        else if (k === EV_SET) { if (!cur) fail('this channel has no settings to change'); const s = io.sym('esc', ''); setSetting(cur, s, io.raw(SETTING_BITS[s])); }
        else if (ch === 'noise') { const drum = io.sym('drum', st.drum); took({ drum, len: io.sym('dlen', lenB(st.dlen)) || st.dlen }); }
        else {
          let pitch;
          if (key === NO_KEY) pitch = st.pitch + io.sym('iv', kind + st.ivb) - IV;
          else {
            let v = io.sym('deg', kind + st.ivb);
            const sharp = v === SHARP;
            if (sharp) v = io.sym('deg', kind + st.ivb);
            const g = degree(st.pitch, key) + v - IV;
            pitch = g < 0 ? -1 : pitchAt(g, key) + (sharp ? 1 : 0);
          }
          const len = io.sym('len', kind + lenB(st.len)) || st.len;
          if (pitch < 0 || pitch >= PITCHES) fail('a note out of range');
          took(cur ? { pitch, len, vol: cur.vol, decay: cur.decay, duty: cur.duty } : { pitch, len });
        }
      }
      return fromEvents(out, ch, inst, size);
    }
    // a lane taken from another (moved by t semitones; pulse notes keep the settings they have of their own)
    const copyLane = (lane, from, to, t, inst, rows) => laneNorm(lane.map((n) => (to === 'noise' ? { ...n }
      : to === 'tri' || from === 'tri' ? { row: n.row, len: n.len, pitch: n.pitch + t } : { ...n, pitch: n.pitch + t })), to, inst, rows);
    const others = (ch) => MELODIC.filter((c) => c !== ch);
    function findCopy(s, pi, ch) {
      const lane = laneOf(s.patterns[pi], ch), key = JSON.stringify(lane), tries = [];
      for (let back = 1; back <= Math.min(pi, 63); back++) tries.push({ back, from: ch });
      if (ch !== 'noise') {
        for (const from of others(ch)) for (let back = 0; back <= Math.min(pi, 63); back++) if (back || CHANNELS.indexOf(from) < CHANNELS.indexOf(ch)) tries.push({ back, from });
      }
      for (const c of tries) {
        const src = laneOf(s.patterns[pi - c.back], c.from);
        if (src.length !== lane.length) continue;
        const t = ch === 'noise' ? 0 : lane[0].pitch - src[0].pitch;
        try { if (JSON.stringify(copyLane(src, c.from, ch, t, s.inst, s.rows)) === key) return { ...c, t }; } catch { /* moved out of range */ }
      }
      return null;
    }

    function writeSong(s, io, key, copies, format) {
      io.raw(s.tempo - TEMPO_MIN, 8); io.raw(RPB.indexOf(s.rpb), 2);
      if (format === VERSION) { io.raw(s.beats - BEATS_MIN, 4); io.raw(UNITS.indexOf(s.unit), 1); io.raw(s.rows - 1, 5); }
      io.raw(key, 4);
      for (const i of [s.inst.p1, s.inst.p2]) {
        io.raw(i.duty, 2); io.raw(i.vol, 4); io.raw(i.decay, 3); io.raw(i.sweep ? 1 : 0, 1);
        if (i.sweep) { io.raw(i.sweep.neg ? 1 : 0, 1); io.raw(i.sweep.period, 3); io.raw(i.sweep.shift, 3); }
      }
      const nz = s.inst.noise, custom = nz.kit.some((k, i) => k[0] !== KIT[i][0] || k[1] !== KIT[i][1]);
      io.raw(nz.vol, 4); io.raw(custom ? 1 : 0, 1);
      if (custom) for (const k of nz.kit) { io.raw(k[0], 4); io.raw(k[1], 1); }
      const np = s.patterns.length;
      io.raw(np - 1, 6); io.raw(s.order.length - 1, 8);
      let prev = -1, last = 3;
      for (const o of s.order) {
        const k = o === prev + 1 ? 0 : o === prev ? 1 : 2;
        io.sym('ord', last, k);
        if (k === 2) io.raw(o, width(np));
        prev = o; last = k;
      }
      const states = { p1: freshState(), p2: freshState(), tri: freshState(), noise: freshState() };
      s.patterns.forEach((p, pi) => {
        for (const ch of CHANNELS) {
          const lane = laneOf(p, ch), st = laneOf(states, ch);
          if (!lane.length) { io.sym('lane', ch, 1); continue; }
          const c = copies[pi * 4 + CHANNELS.indexOf(ch)];
          if (c) {
            io.sym('lane', ch, c.from === ch ? 2 : 3);
            if (c.from !== ch) io.raw(others(ch).indexOf(c.from), 1);
            io.sym('back', '', c.back);
            if (ch !== 'noise') io.sym('shift', 'lane', c.t + IV);
          } else {
            io.sym('lane', ch, 0);
            writeLane(io, toEvents(lane, ch, s.inst, s.rows), ch, st, s.inst, key);
            continue;
          }
          for (const e of toEvents(lane, ch, s.inst, s.rows)) step(st, e);
        }
      });
    }
    function readSong(io, format) {
      const tempo = io.raw(8) + TEMPO_MIN, rpb = RPB[io.raw(2)];
      let beats = 4, unit = 4, rows = ROWS;
      if (format === VERSION) { beats = io.raw(4) + BEATS_MIN; unit = UNITS[io.raw(1)]; rows = io.raw(5) + 1; }
      const key = io.raw(4);
      if (key > NO_KEY || beats > BEATS_MAX) fail('damaged data');
      const pulse = () => {
        const i = { duty: io.raw(2), vol: io.raw(4), decay: io.raw(3), sweep: null };
        if (io.raw(1)) i.sweep = { neg: !!io.raw(1), period: io.raw(3), shift: io.raw(3) };
        return i;
      };
      const p1 = pulseInst(pulse()), p2 = pulseInst(pulse());
      const noise = { vol: io.raw(4), kit: KIT.map((k) => k.slice()) };
      if (io.raw(1)) noise.kit = KIT.map(() => [io.raw(4), io.raw(1)]);
      const inst = { p1, p2, noise: noiseInst(noise) };
      const np = io.raw(6) + 1, no = io.raw(8) + 1, order = [];
      let prev = -1, last = 3;
      for (let i = 0; i < no; i++) {
        const k = io.sym('ord', last), o = k === 0 ? prev + 1 : k === 1 ? prev : io.raw(width(np));
        order.push(o); prev = o; last = k;
      }
      const states = { p1: freshState(), p2: freshState(), tri: freshState(), noise: freshState() }, patterns = [];
      for (let pi = 0; pi < np; pi++) {
        const lanes = {};
        for (const ch of CHANNELS) {
          const k = io.sym('lane', ch), st = laneOf(states, ch);
          let lane;
          if (k === 1) lane = [];
          else if (k === 0) lane = readLane(io, ch, st, inst, key, rows);
          else {
            if (k === 3 && ch === 'noise') fail('the drums can only copy drums');
            const from = k === 3 ? others(ch)[io.raw(1)] : ch, back = io.sym('back', ''), t = ch === 'noise' ? 0 : io.sym('shift', 'lane') - IV;
            if (pi - back < 0 || (!back && (k === 2 || CHANNELS.indexOf(from) > CHANNELS.indexOf(ch)))) fail('a lane copies one that isn’t there yet');
            const src = laneOf(back ? patterns[pi - back] : lanes, from);
            lane = copyLane(src, from, ch, t, inst, rows);
            for (const e of toEvents(lane, ch, inst, rows)) step(st, e);
          }
          if (ch === 'p1') lanes.p1 = lane; else if (ch === 'p2') lanes.p2 = lane; else if (ch === 'tri') lanes.tri = lane; else lanes.noise = lane;
        }
        patterns.push(lanes);
      }
      return { tempo, rpb, beats, unit, rows, inst, patterns, order };
    }

    // --- the bytes: version 3 · payload length 13 · payload · CRC-8. (Version 3 when the song fits it, so older
    // readers can play it: 4/4 and 16 rows; version 4 for any other meter or length) ---
    function encode(song, { format } = {}) {
      const s = normalize(song);
      if (format === undefined) format = plainMeter(s) ? V3 : VERSION;
      if (format !== STATIC && format !== V3 && format !== VERSION) fail(`no format ${format}`);
      if (format !== VERSION && !plainMeter(s)) fail(`format ${format} holds only 4/4 with ${ROWS}-row patterns`);
      // (in whichever key is shortest, or none)
      let body = null;
      const copies = s.patterns.flatMap((p, pi) => CHANNELS.map((ch) => (laneOf(p, ch).length ? findCopy(s, pi, ch) : null)));
      for (let key = NO_KEY; key >= 0; key--) {
        const io = format === STATIC ? staticOut() : acOut(format === VERSION);
        writeSong(s, io, key, copies, format);
        const b = io.bytes();
        if (!body || b.length < body.length) body = b;
      }
      if (body.length > MAX_PAYLOAD) fail('the song is too big');
      const all = [(format << 5) | (body.length >> 8), body.length & 0xff, ...body];
      return Uint8Array.from([...all, crc8(all, all.length)]);
    }
    // (bytes after the checksum are ignored: whatever carries the bytes may pad them)
    function decode(input) {
      const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
      if (bytes.length < 3) fail('the data ends too soon');
      const format = bytes[0] >> 5, len = ((bytes[0] & 31) << 8) | bytes[1];
      if (format !== VERSION && format !== V3 && format !== STATIC) fail(`unknown format version ${format}`);
      if (bytes.length < len + 3) fail('the data ends too soon');
      if (crc8(bytes, len + 2) !== bytes[len + 2]) fail('the checksum doesn’t match (damaged data)');
      const body = bytes.subarray(2, 2 + len);
      return normalize(readSong(format === STATIC ? staticIn(body) : acIn(body, format === VERSION), format));
    }

    // (base64 by hand: TRIF reads String.fromCharCode as maybe making names it can't follow)
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const toBase64 = (bytes) => {
      let out = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
        out += B64.charAt(n >>> 18) + B64.charAt((n >>> 12) & 63) + (i + 1 < bytes.length ? B64.charAt((n >>> 6) & 63) : '=') + (i + 2 < bytes.length ? B64.charAt(n & 63) : '=');
      }
      return out;
    };
    const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const blank = (from) => normalize({ ...(from || {}), patterns: [{}], order: [0] });

    // --- lanes written as text, for hand-written tunes: 'E5:2 G5:2 -:4' (a note and octave, or - for a
    // rest, then its rows; !n after a pulse note sets its volume), drums 'K:2 H:2 S:2' (DRUM_KEYS) ---
    const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function laneFromText(ch, text, rows = ROWS) {
      const out = [];
      let row = 0;
      for (const tok of String(text).trim().split(/\s+/).filter(Boolean)) {
        const m = /^([^:!]+):(\d+)(?:!(\d+))?$/.exec(tok);
        if (!m) fail(`can’t read “${tok}”`);
        const len = +m[2];
        if (m[1] !== '-') {
          if (ch === 'noise') {
            const d = DRUM_KEYS.indexOf(m[1]);
            if (d < 0) fail(`no drum “${m[1]}”`);
            out.push({ row, len, drum: d });
          } else {
            const nm = /^([A-G])(#|b)?(\d)$/.exec(m[1]);
            if (!nm) fail(`can’t read the note “${m[1]}”`);
            const midi = 12 * (+nm[3] + 1) + SEMI[nm[1]] + (nm[2] === '#' ? 1 : nm[2] === 'b' ? -1 : 0);
            const n = { row, len, pitch: midi - BASE[ch] };
            if (m[3]) n.vol = +m[3];
            out.push(n);
          }
        }
        row += len;
      }
      if (row !== rows) fail(`a lane fills ${rows} rows; this one fills ${row}`);
      return out;
    }
    const fromText = (spec) => normalize({
      ...spec,
      patterns: spec.patterns.map((p) => {
        const lanes = CHANNELS.map((ch) => (typeof laneOf(p, ch) === 'string' ? laneFromText(ch, laneOf(p, ch), spec.rows ?? ROWS) : laneOf(p, ch)));
        return { p1: lanes[0], p2: lanes[1], tri: lanes[2], noise: lanes[3] };
      }),
    });

    return {
      VERSION, V3, STATIC, ROWS, MAX_ROWS, BEATS_MIN, BEATS_MAX, UNITS, PITCHES, CHANNELS, BASE, KIT, DRUM_NAMES, DRUM_KEYS, RPB, TEMPO_MIN, TEMPO_MAX, MAX_PATTERNS, MAX_ORDER, MAX_DRUM_LEN, MODELS,
      normalize, encode, decode, toBase64, fromBase64, blank, fromText, laneFromText, laneOf,
    };
  })();
  /* tune-codec:end */
    return TuneCodec;
  })());
  const tuneSynth = () => madeSynth || (madeSynth = (() => {
    const TuneCodec = tuneCodec();
  /* tune-synth:begin */
  // The sound: the 2A03's channels in Web Audio, made on the spot (no samples, no network). Works with any
  // BaseAudioContext, so the same code plays live (an AudioContext and a lookahead scheduler) and renders
  // offline (an OfflineAudioContext, for tests).
  const TuneSynth = ((C) => {
    const CPU = 1789773; // the NTSC 2A03's clock, Hz: the channels' timers count it
    const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
    const DUTY = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0], [1, 0, 0, 1, 1, 1, 1, 1]];
    const TRI = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const DECAY_P = [0, 0, 1, 2, 4, 6, 9, 15]; // decay setting → the envelope divider's period (a level every (P+1)/240 s)
    const LEVEL = { p1: 0.3, p2: 0.3, tri: 0.3, noise: 0.28 }; // (roughly the chip's mix: full volume on each)
    // the drums: per 1/60 s frame, a volume and a period offset from the kit's period (higher = lower)
    const ramp = (from, frames) => Array.from({ length: frames }, (_, i) => Math.max(1, Math.round(from * (1 - i / frames))));
    const DRUMS = [
      { vol: [15, 13, 11, 8, 5, 3, 2, 1], off: [0, 1, 2, 3, 4, 4, 5, 5] }, // kick
      { vol: [15, 13, 12, 10, 9, 7, 6, 5, 4, 3, 2, 2, 1, 1], off: [-2, -1, 0] }, // snare
      { vol: [9, 6, 3, 1], off: [0] }, // hat
      { vol: [9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1], off: [0] }, // open hat
      { vol: [14, 13, 11, 10, 8, 7, 5, 4, 3, 2, 1], off: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] }, // low tom
      { vol: [14, 13, 11, 10, 8, 7, 5, 4, 3, 2, 1], off: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] }, // high tom
      { vol: [13, 3, 13, 3, 12, 10, 8, 6, 5, 4, 3, 2, 1], off: [0] }, // clap
      { vol: ramp(13, 48), off: [0] }, // crash
    ];
    // a repeating step sequence as Fourier series, for a PeriodicWave (the steps kept: their buzz is the sound)
    const series = (seq, harmonics = 96) => {
      const N = seq.length, M = N * 64, mean = seq.reduce((a, b) => a + b, 0) / N, top = Math.max(...seq);
      const cosines = new Float32Array(harmonics + 1), sines = new Float32Array(harmonics + 1);
      for (let k = 1; k <= harmonics; k++) {
        let re = 0, im = 0;
        for (let j = 0; j < M; j++) {
          const x = (seq[Math.floor((j * N) / M)] - mean) / top, a = (2 * Math.PI * k * (j + 0.5)) / M;
          re += x * Math.cos(a); im += x * Math.sin(a);
        }
        cosines[k] = (2 * re) / M; sines[k] = (2 * im) / M;
      }
      return { real: cosines, imag: sines };
    };
    const SERIES = { duty: DUTY.map((d) => series(d)), tri: series(TRI) };
    const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

    // the noise channel's 15-bit LFSR (feedback from bit 1, or bit 6 in short mode), clocked as the chip does
    function renderDrum(ctx, d, period, mode) {
      const shape = DRUMS[d], sr = ctx.sampleRate, spf = sr / 60, frames = shape.vol.length, len = Math.ceil(frames * spf);
      const samples = new Float32Array(len), tap = mode ? 6 : 1;
      let lfsr = 1, acc = 0;
      for (let i = 0; i < len; i++) {
        const f = Math.min(frames - 1, Math.floor(i / spf));
        const idx = Math.max(0, Math.min(15, period + shape.off[Math.min(f, shape.off.length - 1)]));
        acc += CPU / NOISE_PERIODS[idx] / sr;
        let sum = 0, cnt = 0;
        while (acc >= 1) {
          const fb = (lfsr ^ (lfsr >> tap)) & 1;
          lfsr = (lfsr >> 1) | (fb << 14);
          sum += lfsr & 1 ? 0 : 1; cnt++; acc -= 1;
        }
        const out = cnt ? sum / cnt : lfsr & 1 ? 0 : 1;
        samples[i] = (out - 0.5) * 2 * (shape.vol[f] / 15);
      }
      const fade = Math.min(len, 96);
      for (let i = 0; i < fade; i++) samples[len - 1 - i] *= i / fade;
      const buf = ctx.createBuffer(1, len, sr);
      buf.copyToChannel(samples, 0);
      return buf;
    }

    function create(ctx, out = ctx.destination) {
      const wave = (s) => ctx.createPeriodicWave(s.real, s.imag);
      const waves = { duty: SERIES.duty.map(wave), tri: wave(SERIES.tri) };
      // the console's output filters, roughly: a high-pass at 90 Hz and a low-pass at 14 kHz
      const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), master = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.5;
      lp.type = 'lowpass'; lp.frequency.value = 14000; lp.Q.value = 0.5;
      master.gain.value = 0.8;
      master.connect(hp); hp.connect(lp); lp.connect(out);
      const bus = { p1: ctx.createGain(), p2: ctx.createGain(), tri: ctx.createGain(), noise: ctx.createGain() };
      for (const ch of C.CHANNELS) bus[ch].connect(master);
      const live = new Set();
      const track = (src, g) => {
        live.add(src);
        src.onended = () => { live.delete(src); src.disconnect(); g.disconnect(); };
      };
      const drumCache = new Map();
      const drumBuffer = (d, period, mode) => {
        const key = d * 32 + period * 2 + mode;
        if (!drumCache.has(key)) drumCache.set(key, renderDrum(ctx, d, period, mode));
        return drumCache.get(key);
      };
      // a volume envelope: from vol down a level every (P+1)/240 s (decay 0: held), then a 4 ms release
      function envelope(param, vol, decay, t, end, level) {
        const amp = (v) => (v / 15) * level;
        let v = vol;
        param.setValueAtTime(0, t);
        param.linearRampToValueAtTime(amp(v), t + 0.001);
        if (decay) {
          const step = (DECAY_P[decay] + 1) / 240;
          for (let at = t + step; v > 0 && at < end - 0.004; at += step) { v--; param.setValueAtTime(amp(v), at); }
        }
        param.setValueAtTime(amp(v), Math.max(t + 0.001, end - 0.004));
        param.linearRampToValueAtTime(0, end);
      }
      // a pulse or triangle note: inst is the pulse's instrument (null for the triangle); t, dur in seconds
      function note(ch, n, inst, t, dur) {
        const osc = ctx.createOscillator(), g = ctx.createGain(), hz = midiHz(C.BASE[ch] + n.pitch), end = t + dur;
        let stop = end;
        if (ch === 'tri') {
          osc.setPeriodicWave(waves.tri);
          const timer = Math.max(2, Math.min(0x7ff, Math.round(CPU / (32 * hz)) - 1));
          osc.frequency.setValueAtTime(CPU / (32 * (timer + 1)), t);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(LEVEL.tri, t + 0.002);
          g.gain.setValueAtTime(LEVEL.tri, Math.max(t + 0.002, end - 0.004));
          g.gain.linearRampToValueAtTime(0, end);
        } else {
          const duty = n.duty ?? inst.duty, vol = n.vol ?? inst.vol, decay = n.decay ?? inst.decay;
          osc.setPeriodicWave(waves.duty[duty]);
          let timer = Math.max(8, Math.min(0x7ff, Math.round(CPU / (16 * hz)) - 1));
          osc.frequency.setValueAtTime(CPU / (16 * (timer + 1)), t);
          const sw = inst.sweep;
          if (sw) { // the sweep unit: every (P+1)/120 s the timer moves by itself >> shift; out of range, it goes quiet
            const step = (sw.period + 1) / 120;
            for (let at = t + step; at < end; at += step) {
              const delta = timer >> sw.shift;
              timer = sw.neg ? timer - delta - (ch === 'p1' ? 1 : 0) : timer + delta;
              if (timer < 8 || timer > 0x7ff) { stop = at; break; }
              osc.frequency.setValueAtTime(CPU / (16 * (timer + 1)), at);
            }
          }
          envelope(g.gain, vol, decay, t, stop, ch === 'p1' ? LEVEL.p1 : LEVEL.p2);
        }
        osc.connect(g);
        g.connect(ch === 'p1' ? bus.p1 : ch === 'p2' ? bus.p2 : bus.tri);
        osc.start(t);
        osc.stop(stop + 0.005);
        track(osc, g);
      }
      function drum(hit, noise, t, dur) {
        const k = noise.kit[hit.drum], src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = drumBuffer(hit.drum, k[0], k[1]);
        const level = (noise.vol / 15) * LEVEL.noise, end = t + Math.min(src.buffer.duration, dur);
        g.gain.setValueAtTime(level, t);
        g.gain.setValueAtTime(level, Math.max(t, end - 0.004));
        g.gain.linearRampToValueAtTime(0, end);
        src.connect(g); g.connect(bus.noise);
        src.start(t); src.stop(end + 0.005);
        track(src, g);
      }
      // everything that starts on row r of pattern pi, at time t (rd: a row's length in seconds)
      function row(song, pi, r, t, rd) {
        const p = song.patterns[pi];
        if (!p) return;
        for (const n of p.p1) if (n.row === r) note('p1', n, song.inst.p1, t, n.len * rd);
        for (const n of p.p2) if (n.row === r) note('p2', n, song.inst.p2, t, n.len * rd);
        for (const n of p.tri) if (n.row === r) note('tri', n, null, t, n.len * rd);
        for (const h of p.noise) if (h.row === r) drum(h, song.inst.noise, t, h.len * rd);
      }
      const mute = (ch, on) => bus[ch].gain.setValueAtTime(on ? 0 : 1, ctx.currentTime);
      const stopAll = () => { for (const s of live) { try { s.stop(); } catch { /* not started */ } } live.clear(); };
      return { ctx, note, drum, row, mute, stopAll };
    }

    // live playback: rows are scheduled a little ahead of the audio clock (so timing doesn't depend on timers),
    // reading the song as it is now (edits are heard within the lookahead)
    function player(engine, { song, pattern, mode, from, lookahead = 0.12 }) {
      // (how far ahead rows are scheduled: short while editing, so a change is heard at once; a song that
      // doesn't change can go further ahead, so a busy page can't make it stutter)
      const LOOKAHEAD = lookahead;
      let timer = null, next = 0, o = 0, r = 0, marks = [];
      const tick = () => {
        const s = song(), ctx = engine.ctx, rd = 60 / (s.tempo * s.rpb), per = s.rows || C.ROWS;
        while (next < ctx.currentTime + LOOKAHEAD) {
          const songMode = mode() === 'song';
          // (the pattern's own rows; checked here, so a pattern made shorter while it plays ends at once)
          if (r >= per) { r = 0; if (songMode) o++; }
          if (o >= s.order.length) o = 0;
          const pi = songMode ? s.order[o] : Math.min(pattern(), s.patterns.length - 1);
          engine.row(s, pi, r, next, rd);
          marks.push({ t: next, o: songMode ? o : -1, pi, row: r, rd });
          next += rd;
          r++;
        }
        while (marks.length > 1 && marks[1].t <= ctx.currentTime) marks.shift();
      };
      return {
        start() { if (timer) return; o = from(); r = 0; marks = []; next = engine.ctx.currentTime + 0.05; tick(); timer = setInterval(tick, 25); },
        stop() { clearInterval(timer); timer = null; marks = []; engine.stopAll(); },
        get playing() { return !!timer; },
        position() { const m = marks[0]; return m && m.t <= engine.ctx.currentTime ? m : null; },
      };
    }

    // the whole song, once through its order, rendered offline: resolves to an AudioBuffer
    function render(song, { sampleRate = 44100, tail = 0.5, Offline = typeof OfflineAudioContext === 'undefined' ? null : OfflineAudioContext } = {}) {
      const rd = 60 / (song.tempo * song.rpb), per = song.rows || C.ROWS, rows = song.order.length * per;
      const ctx = new Offline(1, Math.ceil((rows * rd + tail) * sampleRate), sampleRate);
      const engine = create(ctx);
      let t = 0;
      for (const pi of song.order) for (let r = 0; r < per; r++) { engine.row(song, pi, r, t, rd); t += rd; }
      return ctx.startRendering();
    }

    return { CPU, NOISE_PERIODS, DUTY, TRI, create, player, render };
  })(TuneCodec);
  /* tune-synth:end */
    return TuneSynth;
  })());

  // FONT CODE begin (the colour code's font block, see the header's "The fonts": read from pictures stamped
  // with it; Style Encoder now stamps picture code v2 instead, whose fonts go in StyleCode)
  const fontCode = (() => {
    // the alphabet, one value each (font names match in CSS whatever their case, so lower case only); the
    // values after it (46 to 63) are no letter, so a cell holding one means there's no font block
    const ABC = ' abcdefghijklmnopqrstuvwxyz0123456789-._&+!()/';
    const TYPES = ['sans', 'serif', 'mono', 'rounded', 'handwriting', 'display'];
    const WEIGHTS = [null, 100, 300, 400, 500, 600, 700, 900]; // (null: the page's own)
    const MARK = 42, MAX = 50; // (the block's first value, which is also its version; the longest name)
    // the cells: x + y even, from x + y = 14 out, each diagonal from x = 0 up; only those wholly outside X's
    // round crop with a 4 px margin (the 400 px picture's centre (200, 200), radius 200): 166
    const CELLS = [];
    for (let d = 14; d <= 48; d += 2) {
      for (let x = 0; x <= d; x++) {
        const y = d - x, dx = 200 - Math.min(Math.max(200, 4 * x), 4 * x + 4), dy = 200 - Math.min(Math.max(200, 4 * y), 4 * y + 4);
        if (dx * dx + dy * dy >= 204 * 204) CELLS.push([x, y]);
      }
    }
    // a name as it's stored: lower case, single spaces, only the alphabet, 1 to MAX long, a letter or digit in it
    const clean = (s) => {
      const f = typeof s === 'string' ? s.toLowerCase().replace(/\s+/g, ' ').trim() : '';
      return f && f.length <= MAX && /[a-z0-9]/.test(f) && [...f].every((c) => ABC.includes(c)) ? f : null;
    };
    // (a weight to the nearest stored one: 200 → 100, 800 → 700)
    const weightOf = (w) => (Number.isFinite(Number(w)) && Number(w) > 0
      ? WEIGHTS.slice(1).reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)) : null);
    const norm = (f) => {
      const family = clean(f?.family);
      return family ? { family, type: TYPES.includes(f.type) ? f.type : 'sans', weight: weightOf(f.weight) } : null;
    };
    const sum = (v) => v.reduce((h, n) => (h * 31 + n + 1) & 4095, 2650); // (12 bits)
    // fonts { name, handle, text: { family, type, weight } or null } → the values ([] for none)
    const values = (fonts) => {
      const list = [norm(fonts?.name), norm(fonts?.handle), norm(fonts?.text)];
      const which = (list[0] ? 1 : 0) + (list[1] ? 2 : 0) + (list[2] ? 4 : 0);
      if (!which) return [];
      const v = [MARK, which];
      let prev = null;
      for (const f of list) {
        if (!f) continue;
        v.push(TYPES.indexOf(f.type) + 8 * WEIGHTS.indexOf(f.weight));
        if (f.family === prev) v.push(0);
        else { v.push(f.family.length); for (const c of f.family) v.push(ABC.indexOf(c)); }
        prev = f.family;
      }
      const s = sum(v);
      v.push(s >> 6, s & 63);
      return v;
    };
    // a value's colour: each channel 0, 85, 170 or 255 (two bits each, red highest)
    const colourOf = (n) => '#' + [n >> 4, (n >> 2) & 3, n & 3].map((l) => (l * 85).toString(16).padStart(2, '0')).join('');
    // → [[x, y, '#rrggbb'], …] to stamp
    const cells = (fonts) => values(fonts).map((n, i) => [CELLS[i][0], CELLS[i][1], colourOf(n)]);
    // rgbAt(x, y) → a cell's [r, g, b]; lossless: the picture is exact, so a cell off the palette means no
    // block. Reads only as far as it must (a picture without fonts: one cell). → fonts, or null
    const decode = (rgbAt, lossless) => {
      let i = 0;
      const v = [];
      const next = () => {
        if (i >= CELLS.length) return -1;
        const c = rgbAt(CELLS[i][0], CELLS[i][1]);
        i++;
        const l = c.map((x) => Math.min(3, Math.max(0, Math.round(x / 85))));
        if (lossless && c.some((x, j) => Math.abs(x - l[j] * 85) > 4)) return -1;
        v.push(l[0] * 16 + l[1] * 4 + l[2]);
        return l[0] * 16 + l[1] * 4 + l[2];
      };
      if (next() !== MARK) return null;
      const which = next();
      if (which < 1 || which > 7) return null;
      const got = [];
      let prev = null;
      for (const bit of [1, 2, 4]) {
        if (!(which & bit)) { got.push(null); continue; }
        const tw = next(), len = next();
        if (tw < 0 || (tw & 7) >= TYPES.length || len < 0 || len > MAX || (len === 0 && !prev)) return null;
        let family = prev;
        if (len) {
          family = '';
          for (let k = 0; k < len; k++) { const n = next(); if (n < 0 || n >= ABC.length) return null; family += ABC[n]; }
        }
        if (clean(family) !== family) return null;
        got.push({ family, type: TYPES[tw & 7], weight: WEIGHTS[tw >> 3] });
        prev = family;
      }
      const s = sum(v), hi = next(), lo = next();
      if (hi < 0 || lo < 0 || hi * 64 + lo !== s) return null;
      return { name: got[0], handle: got[1], text: got[2] };
    };
    // the same fonts, as a picture would carry them
    const key = (fonts) => JSON.stringify([norm(fonts?.name), norm(fonts?.handle), norm(fonts?.text)]);
    const same = (a, b) => key(a) === key(b);
    return { ABC, TYPES, WEIGHTS, MAX, CELLS, clean, norm, values, cells, decode, same };
  })();
  // FONT CODE end

  // --- fonts: the ones a computer may have, and how one goes into CSS -------------------------------------
  // (common fonts of macOS, Windows and Linux, and popular free ones people install, by fallback type: the
  // candidates the panel looks for, and the type of each)
  const FONT_LIST = [
    ['sans', 'Arial, Arial Narrow, Helvetica, Helvetica Neue, Verdana, Tahoma, Trebuchet MS, Segoe UI, Segoe UI Variable, Calibri, Candara, '
      + 'Corbel, Franklin Gothic Medium, Gill Sans, Gill Sans MT, Lucida Grande, Lucida Sans, Lucida Sans Unicode, Geneva, Optima, Avenir, '
      + 'Avenir Next, Avenir Next Condensed, Futura, Century Gothic, SF Pro, SF Pro Display, SF Pro Text, SF Compact, Seravek, Skia, '
      + 'Microsoft Sans Serif, Bahnschrift, Selawik, Tw Cen MT, Myriad Pro, Frutiger, Univers, Proxima Nova, Inter, Roboto, Open Sans, Lato, '
      + 'Montserrat, Poppins, Raleway, Work Sans, Nunito Sans, Source Sans Pro, Source Sans 3, Noto Sans, IBM Plex Sans, Fira Sans, PT Sans, '
      + 'Ubuntu, Cantarell, DejaVu Sans, Liberation Sans, Nimbus Sans, FreeSans, Droid Sans, Oxygen, Arimo, Carlito, Barlow, Josefin Sans, '
      + 'Rubik, Karla, Mulish, Manrope, Titillium Web, Heebo, Hind, Archivo, DIN Alternate, Hiragino Sans, Hiragino Kaku Gothic ProN, '
      + 'PingFang SC, PingFang TC, Apple SD Gothic Neo, Yu Gothic, Yu Gothic UI, Meiryo, Malgun Gothic, Microsoft YaHei, Microsoft JhengHei, '
      + 'Noto Sans JP, Leelawadee UI, Nirmala UI, Sukhumvit Set'],
    ['serif', 'Times New Roman, Times, Georgia, Garamond, EB Garamond, Baskerville, Baskerville Old Face, Big Caslon, Bodoni 72, Bodoni MT, '
      + 'Book Antiqua, Bookman Old Style, Cambria, Constantia, Century, Century Schoolbook, Charter, Cochin, Didot, Hoefler Text, '
      + 'Iowan Old Style, New York, Palatino, Palatino Linotype, Perpetua, Rockwell, Sitka Text, Sylfaen, Superclarendon, Athelas, '
      + 'Goudy Old Style, Californian FB, Centaur, High Tower Text, Lucida Bright, PT Serif, Noto Serif, DejaVu Serif, Liberation Serif, '
      + 'Nimbus Roman, FreeSerif, Droid Serif, Tinos, Caladea, Gelasio, Source Serif Pro, Source Serif 4, Merriweather, Lora, Crimson Text, '
      + 'Libre Baskerville, Cormorant Garamond, Bitter, Roboto Slab, IBM Plex Serif, Linux Libertine, Libertinus Serif, Gentium, C059, P052, '
      + 'URW Bookman, Hiragino Mincho ProN, Yu Mincho, MS Mincho, Songti SC, SimSun, Batang'],
    ['mono', 'Menlo, Monaco, SF Mono, Courier, Courier New, Consolas, Cascadia Code, Cascadia Mono, Lucida Console, Lucida Sans Typewriter, '
      + 'Andale Mono, American Typewriter, Courier Prime, OCR A Extended, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, '
      + 'Droid Sans Mono, Fira Code, Fira Mono, JetBrains Mono, Source Code Pro, IBM Plex Mono, Roboto Mono, Hack, Inconsolata, PT Mono, '
      + 'Nimbus Mono PS, FreeMono, Cousine, Anonymous Pro, Victor Mono, Iosevka, Space Mono, Monaspace Neon, Osaka-Mono'],
    ['rounded', 'SF Pro Rounded, Arial Rounded MT Bold, Nunito, Quicksand, Varela Round, Comfortaa, M PLUS Rounded 1c, Hiragino Maru Gothic ProN, '
      + 'Dosis, Fredoka, Baloo 2, VAG Rounded, Kosugi Maru'],
    ['handwriting', 'Comic Sans MS, Comic Neue, Marker Felt, Chalkboard, Chalkboard SE, Chalkduster, Noteworthy, Bradley Hand, Brush Script MT, '
      + 'Snell Roundhand, Apple Chancery, Zapfino, Savoye LET, SignPainter, Trattatello, Party LET, Segoe Print, Segoe Script, Ink Free, '
      + 'Lucida Handwriting, Monotype Corsiva, Mistral, Kristen ITC, Freestyle Script, Edwardian Script ITC, Vladimir Script, Viner Hand ITC, '
      + 'Bradley Hand ITC, Gabriola, Pacifico, Caveat, Dancing Script, Indie Flower, Kalam, Permanent Marker, Shadows Into Light, Patrick Hand, '
      + 'Amatic SC, Satisfy, Great Vibes, Kaushan Script, URW Chancery L, Z003'],
    ['display', 'Impact, Arial Black, Haettenschweiler, Copperplate, Copperplate Gothic Bold, Papyrus, Herculanum, Phosphate, Luminari, '
      + 'DIN Condensed, Rockwell Extra Bold, Cooper Black, Stencil, Algerian, Bauhaus 93, Broadway, Chiller, Jokerman, Showcard Gothic, '
      + 'Wide Latin, Playbill, Ravie, Snap ITC, Bernard MT Condensed, Britannic Bold, Castellar, Colonna MT, Engravers MT, Harrington, '
      + 'Magneto, Old English Text MT, Bebas Neue, Oswald, Anton, Abril Fatface, Playfair Display, Lobster, Righteous, Bungee, '
      + 'Alfa Slab One, Black Ops One, Press Start 2P, Silom, Krungthep, Academy Engraved LET'],
  ];
  const KNOWN = new Map(); // stored name (fontCode.clean) → [its name as written, its type]
  for (const [type, names] of FONT_LIST) for (const n of names.split(', ')) KNOWN.set(fontCode.clean(n), [n, type]);
  // look-alikes, so a viewer on another system gets the same feel: the font's name, then these, then its
  // type's generic family
  const ALIKE = new Map([
    ['helvetica', 'Arial, Liberation Sans'], ['helvetica neue', 'Arial, Liberation Sans'], ['arial', 'Helvetica, Liberation Sans'],
    ['sf pro', 'Segoe UI, Helvetica Neue'], ['sf pro text', 'Segoe UI, Helvetica Neue'], ['sf pro display', 'Segoe UI, Helvetica Neue'],
    ['lucida grande', 'Segoe UI, Lucida Sans Unicode'], ['lucida sans unicode', 'Lucida Grande'], ['geneva', 'Verdana, DejaVu Sans'],
    ['verdana', 'Geneva, DejaVu Sans'], ['tahoma', 'Geneva, DejaVu Sans'], ['segoe ui', 'Helvetica Neue, Ubuntu'],
    ['avenir', 'Segoe UI, Montserrat'], ['avenir next', 'Segoe UI, Montserrat'], ['calibri', 'Avenir Next, Carlito'],
    ['futura', 'Century Gothic, URW Gothic'], ['century gothic', 'Futura, URW Gothic'], ['gill sans', 'Gill Sans MT, Calibri'],
    ['gill sans mt', 'Gill Sans'], ['optima', 'Candara, Segoe UI'], ['candara', 'Optima'], ['trebuchet ms', 'Lucida Grande, Ubuntu'],
    ['roboto', 'Segoe UI, Helvetica Neue'], ['dejavu sans', 'Verdana'], ['liberation sans', 'Arial, Helvetica'], ['ubuntu', 'Segoe UI'],
    ['noto sans', 'Segoe UI, Helvetica Neue'], ['skia', 'Optima, Candara'],
    ['menlo', 'Consolas, DejaVu Sans Mono'], ['monaco', 'Consolas, DejaVu Sans Mono'], ['sf mono', 'Menlo, Consolas'],
    ['consolas', 'Menlo, DejaVu Sans Mono'], ['cascadia code', 'SF Mono, Menlo'], ['cascadia mono', 'SF Mono, Menlo'],
    ['lucida console', 'Monaco, Menlo'], ['courier new', 'Courier, Liberation Mono'], ['courier', 'Courier New, Liberation Mono'],
    ['dejavu sans mono', 'Menlo, Consolas'], ['american typewriter', 'Courier New, Courier'],
    ['times', 'Times New Roman, Liberation Serif'], ['times new roman', 'Times, Liberation Serif'], ['georgia', 'Cambria, Gelasio'],
    ['cambria', 'Georgia, Caladea'], ['palatino', 'Palatino Linotype, Book Antiqua, P052'], ['palatino linotype', 'Palatino, Book Antiqua'],
    ['book antiqua', 'Palatino'], ['baskerville', 'Baskerville Old Face, Georgia'], ['baskerville old face', 'Baskerville'],
    ['garamond', 'Hoefler Text, EB Garamond'], ['hoefler text', 'Garamond, Georgia'], ['didot', 'Bodoni MT, Bodoni 72'],
    ['bodoni 72', 'Bodoni MT, Didot'], ['bodoni mt', 'Bodoni 72, Didot'], ['constantia', 'Georgia'], ['sitka text', 'Georgia'],
    ['marker felt', 'Comic Sans MS, Chalkboard SE'], ['chalkboard', 'Comic Sans MS'], ['chalkboard se', 'Comic Sans MS'],
    ['chalkduster', 'Comic Sans MS'], ['comic sans ms', 'Chalkboard SE, Comic Neue'], ['noteworthy', 'Segoe Print, Ink Free'],
    ['bradley hand', 'Segoe Print, Ink Free'], ['segoe print', 'Bradley Hand, Noteworthy'], ['ink free', 'Bradley Hand, Noteworthy'],
    ['segoe script', 'Snell Roundhand, Apple Chancery'], ['snell roundhand', 'Segoe Script, Edwardian Script ITC'],
    ['apple chancery', 'Monotype Corsiva, Segoe Script'], ['monotype corsiva', 'Apple Chancery'], ['lucida handwriting', 'Apple Chancery, Segoe Script'],
    ['brush script mt', 'Segoe Script, Snell Roundhand'], ['zapfino', 'Segoe Script, Edwardian Script ITC'], ['mistral', 'Brush Script MT'],
    ['gabriola', 'Snell Roundhand'], ['copperplate', 'Copperplate Gothic Bold, Castellar'], ['copperplate gothic bold', 'Copperplate'],
    ['herculanum', 'Papyrus'], ['impact', 'Haettenschweiler, Oswald'], ['sf pro rounded', 'Arial Rounded MT Bold, Nunito'],
    ['arial rounded mt bold', 'SF Pro Rounded, Nunito'], ['hiragino sans', 'Yu Gothic, Meiryo'], ['hiragino kaku gothic pron', 'Yu Gothic, Meiryo'],
    ['yu gothic', 'Hiragino Sans'], ['meiryo', 'Hiragino Sans'], ['pingfang sc', 'Microsoft YaHei'], ['microsoft yahei', 'PingFang SC'],
    ['pingfang tc', 'Microsoft JhengHei'], ['microsoft jhenghei', 'PingFang TC'], ['apple sd gothic neo', 'Malgun Gothic'], ['malgun gothic', 'Apple SD Gothic Neo'],
  ]);
  const GENERIC = new Map([['sans', 'sans-serif'], ['serif', 'serif'], ['mono', 'monospace'], ['rounded', '"Arial Rounded MT Bold", "Nunito", ui-rounded, sans-serif'],
    ['handwriting', '"Segoe Print", "Bradley Hand", cursive'], ['display', 'Impact, "Haettenschweiler", fantasy']]);
  // a font → its CSS family list (null for none): its name (only ever the alphabet, see fontCode, and quoted),
  // its look-alikes (from the table above), its type's generic
  const fontStack = (f) => {
    const n = fontCode.norm(f);
    if (!n) return null;
    const alike = (ALIKE.get(n.family) || '').split(', ').filter((a) => a && fontCode.clean(a) !== n.family);
    return [`"${n.family}"`, ...alike.map((a) => `"${a}"`), GENERIC.get(n.type)].join(', ');
  };
  // a font the list doesn't know (from "More fonts…"): its type from its name
  const guessType = (name) => {
    const s = name.toLowerCase();
    return /mono|code|console|courier|typewriter|terminal/.test(s) ? 'mono' : /round|maru/.test(s) ? 'rounded'
      : /script|hand|brush|chancery|marker|felt|comic|chalk|print|ink|scrawl|doodle/.test(s) ? 'handwriting'
      : !/sans/.test(s) && /serif|roman|times|garamond|georgia|baskerville|caslon|bodoni|didot|palatino|antiqua|book|mincho|song|ming|slab/.test(s) ? 'serif'
      : /display|poster|black|impact|stencil|headline|condensed|ultra|fat/.test(s) ? 'display' : 'sans';
  };
  // a stored name as people write it: the list's, the computer's, or in title case
  const fontName = (stored) => KNOWN.get(stored)?.[0] || foundFonts?.find((f) => fontCode.clean(f.family) === stored)?.family
    || stored.replace(/(^|[ -])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  // Which of the candidates this computer has: text measured in "<font>", <fallback> against <fallback>
  // alone, for three fallbacks; a font counts when it measures unlike at least two of them (a font that's
  // missing measures exactly like each). Once per page load, when the panel first opens, in short slices so
  // the page doesn't stall. (If the browser blurs the measurements, so a fallback measures unlike itself,
  // every candidate is listed: it can't tell.)
  let foundFonts = null, finding = null; // [{ family, type }]
  const findFonts = () => finding || (finding = (async () => {
    const t0 = performance.now();
    const g = document.createElement('canvas').getContext('2d');
    const SAMPLE = 'mmmmmmmmmmlli WwQq@#0Oo&?gjy';
    const size = (font) => { g.font = font; const m = g.measureText(SAMPLE); return `${m.width}|${m.actualBoundingBoxAscent}|${m.actualBoundingBoxDescent}`; };
    const BASES = ['monospace', 'serif', 'sans-serif'];
    const base = BASES.map((b) => size(`72px ${b}`));
    const blurred = BASES.some((b, j) => size(`72px ${b}`) !== base[j]);
    const list = [];
    let n = 0;
    for (const [family, type] of KNOWN.values()) {
      if (blurred || BASES.filter((b, j) => size(`72px "${family}", ${b}`) !== base[j]).length >= 2) list.push({ family, type });
      if (++n % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    foundFonts = list;
    window.trif?.log(`profile styler: ${list.length} of ${KNOWN.size} fonts found in ${Math.round(performance.now() - t0)} ms${blurred ? ' (measurements blurred: all listed)' : ''}`);
    return list;
  })());
  // "More fonts…": every font the browser will list (it asks you first), where it can (queryLocalFonts:
  // Chrome, Edge); only when you pick it. Those whose names can't be stored are left out.
  let askedMore = null;
  const findMoreFonts = () => askedMore || (askedMore = (async () => {
    const have = new Set((foundFonts || []).map((f) => fontCode.clean(f.family)));
    let added = 0, skipped = 0;
    for (const fd of await window.queryLocalFonts()) {
      const k = fontCode.clean(fd.family);
      if (!k) { skipped++; continue; }
      if (have.has(k)) continue;
      have.add(k); added++;
      foundFonts = [...(foundFonts || []), { family: fd.family.trim(), type: KNOWN.get(k)?.[1] || guessType(fd.family) }];
    }
    window.trif?.log(`profile styler: ${added} more fonts from the browser${skipped ? `, ${skipped} with names a picture can't carry left out` : ''}`);
    return added;
  })().catch((e) => { askedMore = null; window.trif?.warn('profile styler: no more fonts', String(e)); return -1; }));

  // --- reading a picture's code ------------------------------------------------------------------
  // A picture's v2 style (PicCode, StyleCode), or null: the bottom-left corner read once (getImageData), each
  // cell's brightness sampled at its centre, between the four nearest pixels (bilinear): at 400 px exactly the
  // mean of the cell's four pixels; in a copy shrunk to 379 px, far fewer cells smeared into their neighbours
  // than averaging what each covers (measured: 0–0.4% of cells wrong, against 11–16%; a stream needs none).
  // The pictures read are the 400×400 ones.
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
  const readStyleV2 = (g, W, H) => {
    const s = PicCode.decode('bottom-left', greyReader(g, W, H, 'bottom-left'));
    const st = s && s.kind === PicCode.KIND.style && s.version === StyleCode.VERSION ? StyleCode.unpack(s.payload) : null;
    return st ? fromList(st.colours, st.rainbow, st.fonts) : null;
  };
  // A picture's song: its bytes, or null. A song starts in the bottom-right corner, so a picture without one
  // costs that corner's first few cells.
  const SONG_CORNERS = ['bottom-right', 'top-left', 'top-right'];
  const readSong = (g, W, H) => {
    const first = PicCode.decode(SONG_CORNERS[0], greyReader(g, W, H, SONG_CORNERS[0]));
    if (!first || first.kind !== PicCode.KIND.song || first.version !== 1) return null;
    const rest = SONG_CORNERS.slice(1, first.parts).map((c) => PicCode.decode(c, greyReader(g, W, H, c)));
    return PicCode.gather([first, ...rest], PicCode.KIND.song)?.payload || null;
  };
  const songBytes = new Map(); // picture url → a song's bytes (only pictures with one)
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
          // a song in the other corners, read here while the picture's drawn (once per picture, like the style)
          try { const song = readSong(g, W, H); if (song) songBytes.set(url, song); } catch (e) { window.trif?.warn('could not read a song', String(e)); }
          // picture code v2 first (see PicCode): the bottom-left corner's stream, a style
          const v2 = readStyleV2(g, W, H);
          if (v2) { resolve(v2); return; }
          // then the colour code before it, read as it always was
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
          // the fonts, if the picture has a font block (see fontCode); null otherwise, or if it's damaged
          // (markers exact but the font cells not: a fine JPEG, whose cells among the photo's smear more than
          // the markers in the corner; then to the palette, the checksum still the judge)
          const fonts = fontCode.decode(cell, lossless) || (lossless ? fontCode.decode(cell, false) : null);
          // (older codes: before buttons, links and rainbows, the first five colours only; before side panels,
          // the first seven)
          // (and before menu icons and logo, the first eight)
          const upTo = (n) => fromList(colours.map((c, i) => (i < n ? c : null)), KEYS.slice(0, n).filter((k, i) => flags[i]), fonts);
          if (flags.slice(0, 7).some((f) => f === null)) { resolve(fromList(colours.map((c, i) => (i < 5 ? c : null)), [], fonts)); return; }
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
    const m = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights|articles|reposts|subs|subscriptions|superfollows|affiliates|verified_followers|followers|following|followers_you_follow|creator-subscriptions))?\/?$/.exec(location.pathname);
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
  // (and never on text you can edit, :read-write: emojis there can't be wrapped, see wrapEmoji)
  // (PINNED: the window-sized image of a pinned rainbow, rounded up to a whole number of hue cycles each way
  // (RAVE_TILE's: 34 px across, 34 down): sized to the window exactly, its edge met the next copy mid-stripe,
  // and the rolling slid that seam across whatever was near it, the Post button on the left say)
  const PINNED = 'background-size: round(up, 100vw, 34px) round(up, 100vh, 34px) !important;';
  const rainbowText = (sel) => `${sel.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/(::[\w-]+)?$/, ':not(#pst-never):not(:read-write)$1')).join(', ')} { text-shadow: none !important; color: transparent !important; -webkit-text-fill-color: transparent !important;
      background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important;
      background-attachment: fixed !important; background-clip: text !important; -webkit-background-clip: text !important;
      animation: pst-text-roll .8s steps(12) infinite !important; }`;
  // (every pst- animation pinned to the page's time origin: the lines step through the hues together, and the
  // rainbows rolling on top of one another (a button's fill and what's inside it, Rainbow Rave's, which it pins
  // the same way) stay in step instead of showing a seam)
  addEventListener('animationstart', (e) => {
    if (!e.animationName.startsWith('pst-')) return;
    try { for (const a of e.target.getAnimations()) if (a.animationName === e.animationName && a.startTime !== 0) a.startTime = 0; } catch {}
  }, true);
  const css = document.createElement('style');
  css.textContent = `
    /* (one hue cycle of RAVE_TILE: an exact 17 px across and up) */
    @keyframes pst-small-roll { from { background-position: -40px -20px; } to { background-position: -23px -37px; } }
    /* (one hue cycle of RAVE_TILE across: an exact 34 px) */
    @keyframes pst-text-roll { from { background-position: 0 0; } to { background-position: 34px 0; } }
    @property --pst-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
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
    html[data-pst-on][data-pst-r-text] #react-root [data-testid=SearchBox_Search_Input],
    html[data-pst-on][data-pst-r-text] #react-root [data-testid=SearchBox_Search_Input]::placeholder { color: hsl(var(--pst-lh) 100% 60%) !important; -webkit-text-fill-color: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-r-text] #react-root form[role=search] svg { color: hsl(var(--pst-lh) 100% 60%) !important; fill: hsl(var(--pst-lh) 100% 60%) !important; }
    html[data-pst-on][data-pst-has-name] #react-root [data-pst-name], html[data-pst-on][data-pst-has-name] #react-root [data-pst-name] :not(svg, svg *) { color: var(--pst-name) !important; -webkit-text-fill-color: var(--pst-name) !important; background-image: none !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-name] #react-root [data-pst-name], html[data-pst-on][data-pst-r-name] #react-root [data-pst-name] :not(svg, svg *)')}
    html[data-pst-on][data-pst-has-handle] #react-root [data-pst-handle] { color: var(--pst-handle) !important; -webkit-text-fill-color: var(--pst-handle) !important; background-image: none !important; }
    ${rainbowText('html[data-pst-on][data-pst-r-handle] #react-root [data-pst-handle]')}
    /* fonts, where the colours go: all text, then the name and handles on top (each a family list from
       fontStack, set as a variable by apply; weights only when one's chosen, else X's own) */
    html[data-pst-on][data-pst-f-text] #react-root :is(span, time, div, h2) { font-family: var(--pst-f-text) !important; }
    html[data-pst-on][data-pst-fw-text] #react-root :is(span, time, div, h2) { font-weight: var(--pst-fw-text) !important; }
    html[data-pst-on][data-pst-f-name] #react-root :is([data-pst-name], [data-pst-name] :not(svg, svg *)) { font-family: var(--pst-f-name) !important; }
    html[data-pst-on][data-pst-fw-name] #react-root :is([data-pst-name], [data-pst-name] :not(svg, svg *)) { font-weight: var(--pst-fw-name) !important; }
    html[data-pst-on][data-pst-f-handle] #react-root [data-pst-handle] { font-family: var(--pst-f-handle) !important; }
    html[data-pst-on][data-pst-fw-handle] #react-root [data-pst-handle] { font-weight: var(--pst-fw-handle) !important; }
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
    html[data-pst-on][data-pst-has-cards] #pst-panel :is(h3, .pst-row > span, .pst-frow > span, p) { color: var(--pst-on-cards) !important; }
    html[data-pst-on][data-pst-r-cards] #react-root :is(${CARDS}), html[data-pst-on][data-pst-r-cards] #pst-panel {
      background-color: transparent !important; background-image: ${RAVE_BG} !important; background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important; background-attachment: fixed !important; animation: pst-panel-roll 5s steps(75) infinite !important; }
    html[data-pst-on][data-pst-r-cards] #pst-panel :is(h3, .pst-row > span, .pst-frow > span, p) { color: #fff !important; text-shadow: 0 1px 3px rgb(0 0 0 / .7); }
    /* lines: every border and divider (buttons keep theirs, above); rainbow: they all cycle through the hues
       together (a hue in a registered custom property, stepping 6 times a second: one variable, not an
       animation per element; striped borders would square off X's rounded boxes) */
    /* (X's own dividers only: many of its buttons have an invisible border, which every-border showed as
       rings round the icons) */
    html[data-pst-on][data-pst-has-lines] #react-root :is(${LINES}) { border-color: var(--pst-lines) !important; }
    html[data-pst-on][data-pst-has-lines] #react-root [role=separator] { background-color: var(--pst-lines) !important; }
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
      background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important;
      background-attachment: fixed !important; border-color: rgb(255 255 255 / .9) !important;
      animation: pst-text-roll .8s linear infinite !important; }
    html[data-pst-on][data-pst-r-buttons] #react-root ${BUTTONS} *, html[data-pst-on][data-pst-r-buttons] ${BUTTONS} { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .6); }
    /* "Style profile", beside X's "Edit profile" in your profile's header, in its shape (its colours copied
       from it as it's placed, see placeToggle) */
    #pst-toggle { display: inline-flex; align-items: center; height: 36px; padding: 0 16px; margin-right: 8px; border-radius: 9999px;
      border: 1px solid var(--pst-btn-border, #cfd9de); background: transparent; color: var(--pst-btn-color, inherit);
      font: 700 15px TwitterChirp, -apple-system, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    #pst-toggle:hover { filter: brightness(1.1); }
    /* a profile's song: a round icon button, in the row with Follow or Edit profile (colours copied from them
       as it's placed, see songTick) */
    #pst-speaker { display: inline-flex; align-items: center; justify-content: center; flex: none; box-sizing: border-box; width: 36px; height: 36px; padding: 0; margin-right: 8px; border-radius: 9999px;
      border: 1px solid var(--pst-btn-border, #cfd9de); background: transparent; color: var(--pst-btn-color, inherit); cursor: pointer; }
    #pst-speaker:hover { filter: brightness(1.2); }
    #pst-speaker svg { display: none; width: 18px; height: 18px; fill: currentColor; }
    #pst-speaker[aria-pressed=false] .pst-sp-play, #pst-speaker[aria-pressed=true] .pst-sp-stop { display: block; }
    html[data-pst-on][data-pst-has-text] #react-root #pst-speaker { color: var(--pst-text); border-color: var(--pst-text); }
    #pst-toggle .pst-state { display: inline-flex; margin-left: 6px; }
    #pst-toggle .pst-state svg { display: none; width: 16px; height: 16px; fill: currentColor; }
    #pst-toggle .pst-state[data-state=public] .pst-public, #pst-toggle .pst-state[data-state=edited] .pst-edited { display: block; }
    #pst-panel { position: fixed; top: var(--pst-panel-top, 100px); right: var(--pst-panel-right, 16px); z-index: 2147483646; width: 330px; padding: 12px 14px; border-radius: 16px;
      background: #fff; color: #0f1419; box-shadow: 0 4px 24px rgb(0 0 0 / .25); font: 13px -apple-system, system-ui, sans-serif;
      /* (never past the window's bottom: it scrolls instead) */
      box-sizing: border-box; max-height: calc(100vh - var(--pst-panel-top, 100px) - 12px); overflow-y: auto; overscroll-behavior: contain; }
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
    /* the three fonts: name, font, weight (the rows are their cells, like the colours'); each font list shown
       in the font it's set to */
    #pst-panel .pst-fonts { display: grid; grid-template-columns: auto minmax(0, 1fr) 84px; column-gap: 6px; row-gap: 7px; align-items: center; margin: 12px 0 2px; }
    #pst-panel .pst-frow { display: contents; }
    #pst-panel .pst-frow > span { white-space: nowrap; }
    #pst-panel select { height: 26px; min-width: 0; border: 1px solid #cfd9de; border-radius: 6px; padding: 0 4px; background: #fff; color: #0f1419; font-size: 13px; cursor: pointer; }
    #pst-panel select:disabled { opacity: .45; cursor: default; }
    #pst-panel .pst-reset { margin-right: 6px; }
    #pst-panel .pst-reset:disabled { opacity: .4; cursor: default; }
    #pst-panel p { margin: 10px 0 0; color: #536471; font-size: 12px; line-height: 1.35; }
    #pst-panel .pst-reset { margin-top: 8px; font: inherit; font-weight: 700; padding: 5px 10px; border-radius: 9999px; border: 1px solid #cfd9de; background: #fff; cursor: pointer; }
    /* the hue (pst-line-hue): animated on each thing it colours (the variable isn't inherited), pinned in step */
    html[data-pst-on][data-pst-r-text] #react-root :is([data-testid=SearchBox_Search_Input], form[role=search] svg),
    html[data-pst-on][data-pst-r-icons] #react-root ${ICON_BUTTONS},
    html[data-pst-on][data-pst-r-lines] #react-root :is(${LINES}, [role=separator]) { animation: pst-line-hue 3s steps(18) infinite; }
    /* (those that also roll a rainbow: both) */
    html[data-pst-on][data-pst-r-lines][data-pst-r-panel] #react-root [data-pst-card]:not(#pst-l),
    html[data-pst-on][data-pst-r-lines][data-pst-r-cards] #react-root :is(${CARDS}):is(${LINES}):not(#pst-l),
    html[data-pst-on][data-pst-r-lines][data-pst-r-quotes] #react-root :is(${QUOTES}):not(#pst-l) { animation: pst-panel-roll 5s steps(75) infinite, pst-line-hue 3s steps(18) infinite !important; }
    html[data-pst-on][data-pst-r-lines][data-pst-r-bg] #react-root [data-pst-solid]:not(#pst-l) { animation: pst-box-roll 5s steps(75) infinite, pst-line-hue 3s steps(18) infinite !important; }
    /* (the search field's placeholder: the field's own colour) */
    html[data-pst-on][data-pst-r-text]:not(#pst-l) #react-root [data-testid=SearchBox_Search_Input]::placeholder { color: inherit !important; -webkit-text-fill-color: inherit !important; }
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
    // (fonts by name too: name, handle, text)
    const fName = fontStack(st?.fonts?.name), fHandle = fontStack(st?.fonts?.handle), fText = fontStack(st?.fonts?.text);
    const wName = fontCode.norm(st?.fonts?.name)?.weight, wHandle = fontCode.norm(st?.fonts?.handle)?.weight, wText = fontCode.norm(st?.fonts?.text)?.weight;
    root.toggleAttribute('data-pst-f-name', !!fName); root.toggleAttribute('data-pst-fw-name', !!wName);
    root.toggleAttribute('data-pst-f-handle', !!fHandle); root.toggleAttribute('data-pst-fw-handle', !!wHandle);
    root.toggleAttribute('data-pst-f-text', !!fText); root.toggleAttribute('data-pst-fw-text', !!wText);
    if (fName) root.style.setProperty('--pst-f-name', fName);
    if (wName) root.style.setProperty('--pst-fw-name', String(wName));
    if (fHandle) root.style.setProperty('--pst-f-handle', fHandle);
    if (wHandle) root.style.setProperty('--pst-fw-handle', String(wHandle));
    if (fText) root.style.setProperty('--pst-f-text', fText);
    if (wText) root.style.setProperty('--pst-fw-text', String(wText));
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
  // (scope: where to look; the whole app by default, a hover card for its own rainbow, see hoverCards)
  const wrapEmoji = (scope) => {
    for (const [node, g] of emojiDone) {
      if (!node.isConnected || node.data !== '') { g.nodes.forEach((n) => n.remove()); emojiDone.delete(node); }
    }
    const app = scope || document.getElementById('react-root');
    if (!app) return;
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data && !emojiDone.has(n) && /\p{Extended_Pictographic}/u.test(n.data) && !n.parentElement?.closest('[data-pst-emoji], [data-ps-emoji], input, textarea') && !n.parentElement?.isContentEditable
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
      // (the name's span, even once its emoji are wrapped (wrapEmoji): an emoji wrapper isn't the name, and the
      // span holding "Tim " beside its wrappers is; a mark left on a wrapper by the old way is taken off)
      const EMO = '[data-pst-emoji], [data-ps-emoji]';
      for (const wrong of un.querySelectorAll(':is([data-pst-emoji], [data-ps-emoji])[data-pst-name]')) wrong.removeAttribute('data-pst-name');
      for (const span of un.querySelectorAll('span')) {
        if (span.matches(EMO) || [...span.children].some((c) => !c.matches(EMO))) continue;
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
    && [...a.rainbow].sort().join() === [...b.rainbow].sort().join() && fontCode.same(a.fonts, b.fonts);
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
  let copiedFor; // (the style on show when Edit profile's colours were last copied)
  const placeToggle = () => {
    const edit = document.querySelector('[data-testid=primaryColumn] [data-testid=editProfileButton]');
    if (!edit) { toggle.remove(); return false; }
    if (edit.previousElementSibling !== toggle) edit.before(toggle);
    else if (copiedFor === applied) return true;
    copiedFor = applied;
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
    panel.style.setProperty('--pst-panel-top', `${Math.round(r.bottom + 8)}px`);
    panel.style.setProperty('--pst-panel-right', `${Math.max(8, Math.round(innerWidth - (document.querySelector('[data-testid=editProfileButton]')?.getBoundingClientRect().right || r.right)))}px`);
  };
  // --- a profile's song: the speaker button -------------------------------------------------------------------
  const tunes = new Map(); // picture url → its song, decoded, or null (unreadable or silent): once per picture
  const tuneOf = (url) => {
    if (tunes.has(url)) return tunes.get(url);
    if (!songBytes.has(url)) return null; // (none, or the picture's still being read)
    let song = null;
    try {
      const s = tuneCodec().decode(songBytes.get(url));
      if (s.order.some((i) => [s.patterns[i].p1, s.patterns[i].p2, s.patterns[i].tri, s.patterns[i].noise].some((lane) => lane.length))) song = s;
    } catch (e) { window.trif?.log('a picture\'s song could not be read', String(e)); }
    tunes.set(url, song);
    return song;
  };
  const speaker = document.createElement('button');
  speaker.id = 'pst-speaker'; speaker.type = 'button';
  {
    const NS = 'http://www.w3.org/2000/svg';
    const icon = (cls, d) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p);
      return svg;
    };
    speaker.append(icon('pst-sp-play', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z'),
      icon('pst-sp-stop', 'M6 6h12v12H6z'));
  }
  let shownSong = null, shownHandle = null, songPlayer = null, playingFor = null, songCtx = null, songEngine = null, speakerCopied;
  const showSongState = () => {
    const on = !!songPlayer;
    speaker.setAttribute('aria-pressed', String(on));
    speaker.title = on ? 'Stop this profile’s song' : 'Play this profile’s song';
    speaker.setAttribute('aria-label', speaker.title);
  };
  showSongState();
  const stopSong = () => {
    if (!songPlayer) return;
    songPlayer.stop(); songPlayer = null; playingFor = null;
    showSongState();
    // (the audio clock asleep while nothing plays; a moment later, for the notes' release)
    setTimeout(() => { if (!songPlayer) songCtx?.suspend(); }, 200);
  };
  // (only ever from a click; one player, so one song at a time)
  const playSong = (song, handle) => {
    stopSong();
    const S = tuneSynth();
    if (!songCtx) { songCtx = new AudioContext({ latencyHint: 'playback' }); songEngine = S.create(songCtx); }
    if (songCtx.state === 'suspended') songCtx.resume();
    // (2 s ahead: the song doesn't change while it plays, so a busy page, X scrolling, can't make it stutter;
    // it starts at once, and stopping cancels what's scheduled)
    songPlayer = S.player(songEngine, { song: () => song, pattern: () => 0, mode: () => 'song', from: () => 0, lookahead: 2 });
    songPlayer.start();
    playingFor = handle;
    showSongState();
  };
  speaker.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { if (songPlayer) stopSong(); else if (shownSong) playSong(shownSong, shownHandle); } catch (err) { window.trif?.warn('could not play the song', String(err)); }
  });
  // each tick: the button on a profile whose picture has a song, beside Follow's row or before Style profile;
  // leaving the profile stops the song
  const songTick = (handle, own) => {
    if (playingFor && playingFor !== handle) stopSong();
    const url = handle ? headerPicture(handle) : null;
    if (url && !decoded.has(url)) readCode(url);
    const song = url ? tuneOf(url) : null;
    const edit = own ? document.querySelector('[data-testid=primaryColumn] [data-testid=editProfileButton]') : null;
    const like = own ? edit : document.querySelector('[data-testid=primaryColumn] [data-testid=userActions]');
    const before = own && toggle.isConnected ? toggle : like;
    shownSong = song; shownHandle = handle;
    if (!song || !before) { speaker.remove(); return; }
    if (before.previousElementSibling !== speaker) before.before(speaker);
    else if (speakerCopied === applied) return;
    speakerCopied = applied;
    const cs = getComputedStyle(like);
    speaker.style.setProperty('--pst-btn-border', cs.borderTopColor);
    speaker.style.setProperty('--pst-btn-color', getComputedStyle(like.querySelector('span, svg') || like).color);
    speaker.style.marginTop = cs.marginTop; speaker.style.marginBottom = cs.marginBottom;
  };

  const panel = document.createElement('div');
  panel.id = 'pst-panel';
  const pickers = new Map(), rainbows = new Map();
  // the fonts' rows (a style's fonts: { name, handle, text }, each { family, type, weight } or null; read and
  // set by name, like the colours)
  const FONT_SLOTS = [['name', 'Name font'], ['handle', 'Handle font'], ['text', 'Text font']];
  const FONT_WEIGHTS = [['', 'Weight'], ['100', 'Thin'], ['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']];
  const FONT_GROUPS = [['sans', 'Sans serif'], ['serif', 'Serif'], ['mono', 'Monospace'], ['rounded', 'Rounded'], ['handwriting', 'Handwriting'], ['display', 'Display']];
  const MORE_FONTS = '+more';
  const fontPickers = new Map(), weightPickers = new Map();
  let lastFilled = null, fontsListed = null; // (the style the panel shows; what its font lists list)
  const fontOf = (st, slot) => (slot === 'name' ? st.fonts?.name : slot === 'handle' ? st.fonts?.handle : st.fonts?.text) || null;
  const withFont = (st, slot, f) => ({ ...st, fonts: { name: slot === 'name' ? f : fontOf(st, 'name'), handle: slot === 'handle' ? f : fontOf(st, 'handle'), text: slot === 'text' ? f : fontOf(st, 'text') } });
  const fontValue = (f) => (f && fontCode.clean(f.family)) || '';
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
    // the fonts: a list of this computer's fonts each, and a weight
    const fgrid = document.createElement('div'); fgrid.className = 'pst-fonts';
    panel.append(fgrid);
    for (const [slot, label] of FONT_SLOTS) {
      const row = document.createElement('div'); row.className = 'pst-frow';
      const name = document.createElement('span'); name.textContent = label;
      const sel = document.createElement('select'); sel.title = label;
      const wsel = document.createElement('select'); wsel.title = `${label}: weight`;
      for (const [w, t] of FONT_WEIGHTS) { const o = document.createElement('option'); o.value = w; o.textContent = t; wsel.append(o); }
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (v === MORE_FONTS) { // (put back at once; the list grows once the browser answers)
          sel.value = fontValue(fontOf(lastFilled || {}, slot));
          findMoreFonts().then((added) => { if (added >= 0) { fontsListed = null; if (lastFilled) fill(lastFilled); } });
          return;
        }
        change((st) => {
          if (!v) return withFont(st, slot, null);
          const known = (foundFonts || []).find((f) => fontCode.clean(f.family) === v);
          return withFont(st, slot, { family: known?.family || fontName(v), type: known?.type || KNOWN.get(v)?.[1] || guessType(v), weight: fontOf(st, slot)?.weight || null });
        });
      });
      wsel.addEventListener('change', () => change((st) => {
        const f = fontOf(st, slot);
        return f ? withFont(st, slot, { ...f, weight: wsel.value ? Number(wsel.value) : null }) : st;
      }));
      fontPickers.set(slot, sel); weightPickers.set(slot, wsel);
      name.title = label;
      row.append(name, sel, wsel);
      fgrid.append(row);
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
    lastFilled = st;
    // the font lists: made again only when what they list changes (the fonts found, a font chosen that isn't
    // among them); each shows its font in that font
    const listKey = `${foundFonts ? foundFonts.length : '-'}|${askedMore ? 1 : 0}|${FONT_SLOTS.map(([s]) => fontValue(fontOf(st, s))).join('|')}`;
    const remake = listKey !== fontsListed;
    fontsListed = listKey;
    for (const [slot] of FONT_SLOTS) {
      const sel = fontPickers.get(slot), wsel = weightPickers.get(slot), f = fontCode.norm(fontOf(st, slot));
      if (remake) fontOptions(sel, f);
      sel.value = fontValue(f);
      sel.style.setProperty('font-family', fontStack(f) || 'inherit');
      wsel.value = f?.weight ? String(f.weight) : '';
      wsel.disabled = !f;
    }
  };
  // a font list: Default, the font chosen if it isn't found here, the fonts found by type, More fonts…
  const fontOptions = (sel, chosen) => {
    const opt = (value, text, title) => { const o = document.createElement('option'); o.value = value; o.textContent = text; if (title) o.title = title; return o; };
    const items = [opt('', 'Default', 'X’s own font')];
    const listed = new Set((foundFonts || []).map((f) => fontCode.clean(f.family)));
    if (chosen && !listed.has(chosen.family)) items.push(opt(chosen.family, foundFonts ? `${fontName(chosen.family)} (not on this computer)` : fontName(chosen.family)));
    if (!foundFonts) { const o = opt('-', 'Finding your fonts…'); o.disabled = true; items.push(o); }
    for (const [type, label] of FONT_GROUPS) {
      const fonts = (foundFonts || []).filter((f) => f.type === type).sort((a, b) => a.family.localeCompare(b.family));
      if (!fonts.length) continue;
      const group = document.createElement('optgroup'); group.label = label;
      group.append(...fonts.map((f) => opt(fontCode.clean(f.family), f.family)));
      items.push(group);
    }
    if (foundFonts && typeof window.queryLocalFonts === 'function' && !askedMore) items.push(opt(MORE_FONTS, 'More fonts…', 'All the fonts on this computer (your browser asks you first)'));
    sel.replaceChildren(...items);
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
    if (panelOpen) {
      const st = mine() || xLook(); saveMine(st); fill(st); apply(st);
      findFonts().then(() => { if (lastFilled) fill(lastFilled); }); // (once per page load, see findFonts)
    }
    tick();
  });

  // --- hover cards: the pop-up over a name, in that person's own style ------------------------------
  // Whoever's page you're on, a hover card shows the person it's about in their colours (what their picture
  // carries; yours, your saved choice): its background, their name, badge, @handle, bio text and links, and
  // their Follow button. (This was Post Styler's; it's here so it works without it.) A card showing several
  // people's pictures (the account switcher) isn't one person's, and is left alone.
  // The card gets data-pst-hc (whose: one rule per person sets their colours as --pst-hc-* variables),
  // data-pst-hc-has and data-pst-hc-r (which colours are set, which are rainbow); its parts are marked.
  const HC = 'html #react-root [data-testid=HoverCard][data-pst-hc]:not(#pst-hc-a):not(#pst-hc-b)';
  const HC_FOLLOW = ':is([data-testid$="-follow"], [data-testid$="-unfollow"])';
  const HC_NOBTN = ':not(button *):not([role=button] *)';
  const hcCss = document.createElement('style');
  hcCss.textContent = `
    ${HC}[data-pst-hc-has~=bg] { background-color: var(--pst-hc-bg) !important; background-image: none !important; }
    ${HC}[data-pst-hc-r~=bg] { background-color: transparent !important; background-image: ${RAVE_BG} !important; background-size: calc(100vw + 140vmax) 100vh !important;
      background-repeat: no-repeat !important; background-attachment: fixed !important; animation: pst-panel-roll 5s steps(75) infinite !important; }
    ${HC}[data-pst-hc-r~=bg] :is(span, div[dir]) { text-shadow: 0 1px 3px rgb(0 0 0 / .75), 0 0 1px rgb(0 0 0 / .6) !important; }
    ${HC}[data-pst-hc-has~=text] :is(span, div[dir])${HC_NOBTN} { color: var(--pst-hc-text) !important; -webkit-text-fill-color: var(--pst-hc-text) !important; }
    ${rainbowText(`${HC}[data-pst-hc-r~=text] span${HC_NOBTN}:not([data-pst-hc-name] *):not([data-pst-hc-name]):not([data-pst-hc-handle])`)}
    ${HC}[data-pst-hc-has~=links] [data-pst-hc-link], ${HC}[data-pst-hc-has~=links] [data-pst-hc-link] * { color: var(--pst-hc-links) !important; -webkit-text-fill-color: var(--pst-hc-links) !important; background-image: none !important; }
    ${rainbowText(`${HC}[data-pst-hc-r~=links] [data-pst-hc-link], ${HC}[data-pst-hc-r~=links] [data-pst-hc-link] span`)}
    ${HC}[data-pst-hc-has~=name] [data-pst-hc-name], ${HC}[data-pst-hc-has~=name] [data-pst-hc-name] span { color: var(--pst-hc-name) !important; -webkit-text-fill-color: var(--pst-hc-name) !important; background-image: none !important; }
    ${rainbowText(`${HC}[data-pst-hc-r~=name] [data-pst-hc-name]`)}
    ${HC}[data-pst-hc-has~=handle] [data-pst-hc-handle], ${HC}[data-pst-hc-has~=handle] :has(> [data-pst-hc-handle]) { color: var(--pst-hc-handle) !important; -webkit-text-fill-color: var(--pst-hc-handle) !important; background-image: none !important; }
    ${rainbowText(`${HC}[data-pst-hc-r~=handle] [data-pst-hc-handle]`)}
    ${HC}[data-pst-hc-has~=badge] svg[data-testid=icon-verified], ${HC}[data-pst-hc-has~=badge] svg[data-testid=icon-verified] * { color: var(--pst-hc-badge) !important; fill: var(--pst-hc-badge) !important; }
    ${HC}[data-pst-hc-r~=badge] svg[data-testid=icon-verified] path { fill: url(#pst-rb) !important; }
    ${HC}[data-pst-hc-has~=buttons] ${HC_FOLLOW} { background-color: var(--pst-hc-buttons) !important; border-color: var(--pst-hc-buttons) !important; background-image: none !important; }
    ${HC}[data-pst-hc-has~=buttons] ${HC_FOLLOW} * { color: var(--pst-hc-on-buttons) !important; -webkit-text-fill-color: var(--pst-hc-on-buttons) !important; background-image: none !important; }
    ${HC}[data-pst-hc-r~=buttons] ${HC_FOLLOW} { background-image: ${RAVE_TILE} !important; ${PINNED} background-repeat: repeat !important; background-attachment: fixed !important;
      border-color: rgb(255 255 255 / .9) !important; animation: pst-text-roll .8s linear infinite !important; }
    ${HC}[data-pst-hc-r~=buttons] ${HC_FOLLOW} * { color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 2px rgb(0 0 0 / .6); }
  `;
  root.append(hcCss);
  const hcVars = document.createElement('style');
  root.append(hcVars);
  const hcRules = new Map(); // handle → its rule
  const isHexC = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  const HC_KEYS = ['bg', 'name', 'badge', 'handle', 'text', 'links', 'buttons'];
  const hcClear = (hc) => { for (const a of ['data-pst-hc', 'data-pst-hc-has', 'data-pst-hc-r']) hc.removeAttribute(a); };
  const hcSet = (hc, h, st) => {
    const v = [['bg', st.bg], ['name', st.name], ['badge', st.badge], ['handle', st.handle], ['text', st.text], ['links', st.links], ['buttons', st.buttons],
      ['on-buttons', isHexC(st.buttons) ? onColour(st.buttons) : null]].filter(([, c]) => isHexC(c));
    const rule = `html #react-root [data-testid=HoverCard][data-pst-hc="${h}"] { ${v.map(([k, c]) => `--pst-hc-${k}: ${c};`).join(' ')} }`;
    if (hcRules.get(h) !== rule) { hcRules.set(h, rule); hcVars.textContent = [...hcRules.values()].join('\n'); }
    const has = HC_KEYS.filter((k) => v.some(([kk]) => kk === k)).join(' ');
    const r = (st.rainbow || []).filter((k) => HC_KEYS.includes(k)).join(' ');
    if (hc.getAttribute('data-pst-hc') !== h) hc.setAttribute('data-pst-hc', h);
    if (hc.getAttribute('data-pst-hc-has') !== has) hc.setAttribute('data-pst-hc-has', has);
    if ((hc.getAttribute('data-pst-hc-r') || '') !== r) { if (r) hc.setAttribute('data-pst-hc-r', r); else hc.removeAttribute('data-pst-hc-r'); }
  };
  // its parts: the name (in the link to them, else the first text that isn't the @handle, outside its
  // buttons), the @handle, other links (the bio's)
  const hcMark = (hc, h, box) => {
    const EMO = '[data-pst-emoji], [data-ps-emoji]';
    const nameIn = (scope) => {
      for (const s of scope.querySelectorAll('span')) {
        if (s.matches(EMO) || s.closest(EMO)) continue;
        const btn = s.closest('button, [role=button]');
        if (btn && !btn.contains(box)) continue;
        if ([...s.children].some((c) => !c.matches(EMO))) continue;
        const t = (s.textContent || '').trim();
        if (t && !t.startsWith('@')) return s;
      }
      return null;
    };
    if (!hc.querySelector('[data-pst-hc-name]')) {
      const link = [...hc.querySelectorAll('a[href]')].find((a) => a.getAttribute('href').toLowerCase() === `/${h}` && !a.querySelector('img'));
      const s = (link && nameIn(link)) || nameIn(hc);
      if (s) s.setAttribute('data-pst-hc-name', '');
    }
    for (const s of hc.querySelectorAll('span:not([data-pst-hc-handle])')) if (!s.children.length && /^@\w{1,15}$/.test((s.textContent || '').trim())) s.setAttribute('data-pst-hc-handle', '');
    for (const a of hc.querySelectorAll('a[href]:not([data-pst-hc-link])')) {
      const href = a.getAttribute('href').toLowerCase();
      if (href !== `/${h}` && !href.startsWith(`/${h}/`) && !a.querySelector('img') && !a.closest('button, [role=button]')) a.setAttribute('data-pst-hc-link', '');
    }
  };
  let hcBusy = false;
  const hoverCards = () => {
    if (hcBusy) return;
    hcBusy = true;
    try {
      const me = (myHandle() || '').toLowerCase();
      for (const hc of document.querySelectorAll('#react-root [data-testid=HoverCard]')) {
        const boxes = hc.querySelectorAll('[data-testid^="UserAvatar-Container-"]');
        if (new Set([...boxes].map((b) => b.dataset.testid.toLowerCase())).size !== 1) { hcClear(hc); continue; }
        const box = boxes[0];
        const h = /^UserAvatar-Container-(\w{1,15})$/.exec(box.dataset.testid || '')?.[1]?.toLowerCase();
        const img = box.querySelector('img[src*="/profile_images/"]');
        if (!h || !img) continue;
        let st;
        if (hc.getAttribute('data-pst-hc') === h && hcRules.has(h)) st = 'same'; // (already done: just keep its parts marked)
        else if (h === me && loadMine()) st = mine();
        else {
          const url = img.src.replace(/_(normal|bigger|mini|x96|200x200|400x400)(\.\w+)(\?.*)?$/, '_400x400$2');
          const known = decoded.get(url);
          if (known === undefined) { readCode(url).then(() => hoverCards()); continue; }
          if (known instanceof Promise) continue;
          st = known;
        }
        if (!st) { hcClear(hc); continue; }
        hcMark(hc, h, box);
        if (st !== 'same') hcSet(hc, h, st);
        if (hc.hasAttribute('data-pst-hc-r')) { try { wrapEmoji(hc); } catch {} }
      }
    } catch (e) { window.trif?.warn('profile styler: hover card', String(e)); }
    hcBusy = false;
  };
  // (straight away when a hover card opens: watched in #layers, where X puts its pop-ups; the tick catches
  // up too, see below)
  let hcFrame = 0, hcWatched = null;
  const watchHover = () => {
    const layers = document.getElementById('layers');
    if (!layers || layers === hcWatched) return;
    hcWatched = layers;
    new MutationObserver(() => { if (!hcFrame) hcFrame = requestAnimationFrame(() => { hcFrame = 0; hoverCards(); }); })
      .observe(layers, { childList: true, subtree: true });
  };

  // --- keeping up with the page (X changes pages without loading them) ----------------------------
  let lastKey = '';
  const tick = async () => {
    try { watchHover(); hoverCards(); } catch {}
    try {
      const handle = profileHandle();
      const own = !!handle && !!myHandle() && handle.toLowerCase() === myHandle().toLowerCase();
      // the panel's button only on your own profile, beside Edit profile
      if (own) placeToggle();
      else if (toggle.isConnected) { toggle.remove(); panelOpen = false; }
      songTick(handle, own);
      if (panelOpen) placePanel();
      if (panelOpen && !panel.isConnected) root.append(panel);
      if (!panelOpen && panel.isConnected) panel.remove();
      // (Site Inherits Profile Style on, html[data-pst-inherit]: everywhere that isn't a styled profile shows
      // your own style, once you've made one)
      const inherit = (root.hasAttribute('data-pst-inherit') || getComputedStyle(root).getPropertyValue('--pst-inherit').trim() === '1') && !!loadMine();
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
