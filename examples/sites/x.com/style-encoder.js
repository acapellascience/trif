// ==WebMod==
// @name        Style Encoder
// @description Stamps your profile style into your new picture
// @match       https://x.com/*
// @run-at      document-start
// @risk        0 render-only: changes the picture you choose before X gets it; sends nothing anywhere
// @source      trif
// @version     3
// @boxed
// @powers      edit-uploads, site-storage local:trifProfileStyler.mine:* local:trifTuneComposer.song
// ==/WebMod==

// Tim's. Works with Profile Styler (profile-styler.js), the way Image Borders frames uploads.
//
// When you choose a new profile picture in Edit profile (x.com/settings/profile), the picture is redrawn
// before X sees it: squared (the middle of it) at 400×400, with your style from Profile Styler's panel
// (localStorage STORE) stamped into the bottom-left corner as a code, which X's round crop hides. In
// X's crop step, don't zoom or move it: the code is in the corner and must stay there. Anyone with Profile
// Styler then sees your profile in your colours.
//
// The code: picture code v2 (PicCode, below, the same as profile-styler.js's, character for character):
// 2×2-pixel gray cells, four grays, 2 bits a cell, which come back exactly even when X makes the picture a
// JPEG. The bottom-left corner's stream carries the style (StyleCode): every colour exactly, the rainbow
// flags, and the three fonts (name, handle, other text) if any were chosen. The other three corners carry your
// saved tune, if there is one (Tune Composer's, tune-composer.js; kind song, spread over as many corners as it
// needs, 441 bytes each); with no tune they're left as they are, and a tune too big for them isn't stamped.
// (Before 2026-11, the style went in as colour cells, which Profile Styler still
// reads; nothing stamps them any more.)
// Every new profile picture goes up as a 400×400 PNG (which X keeps as a PNG, lossless, so the code reads
// back exactly), with the code when the signed-in account has a saved style, plain otherwise. The banner
// (not square) and anything that isn't a picture pass through untouched.
//
// How: X's file input's change event is caught first (capture phase) and stopped; the picture is redrawn
// (canvas, PNG); then the same event goes out again with the new file, marked so it isn't caught twice.
//
// Boxed (TRIF's sandbox). Its powers: edit-uploads (the picture you choose comes to it as a canvas; what it
// gives back is what X gets) and site-storage, for the two keys it reads: Profile Styler's saved style
// (trifProfileStyler.mine:<you>) and Tune Composer's saved tune (trifTuneComposer.song), kept in x.com's
// localStorage as before so every member of the family, boxed or not, still finds them. It only reads them.
// (Beside the family's other boxed mods, TRIF asks you once for each combination across two mods: see its hold.)
// What the sandbox changes: the picture keeps its own name and type (TRIF makes the file: a JPEG you choose
// goes up as a JPEG at 92%, not a lossless -styled.png; the code's gray cells are made to come through a
// JPEG). The banner, which it leaves alone, goes on untouched, as do pictures anywhere else.

const STORE = 'trifProfileStyler.mine';
const TUNE_STORE = 'trifTuneComposer.song'; // (Tune Composer's saved tune: its encoded bytes, base64)
const SIZE = 400;
const ls = trif.storage('local');

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

// (the signed-in account's own saved style: STORE:<handle, lower case>, see profile-styler.js; the account
// from the account button at the bottom of X's menu)
const style = () => {
  try {
    const t = page.find('[data-testid=SideNav_AccountSwitcher_Button] [data-testid^="UserAvatar-Container-"]')?.attr('data-testid') || '';
    const me = /^UserAvatar-Container-(\w+)$/.exec(t)?.[1];
    return me ? JSON.parse(ls.get(`${STORE}:${me.toLowerCase()}`) || 'null') : null;
  } catch { return null; }
};
const paintCell = (g, x, y, level) => { g.set({ fillStyle: PicCode.grey(level) }); g.fillRect(x, y, PicCode.CELL, PicCode.CELL); };

// your saved tune into the three song corners (see PicCode). → a few words for the log
const stampTune = (g) => {
  let bytes;
  try {
    const text = ls.get(TUNE_STORE);
    if (!text) return 'no tune';
    bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch (e) { trif.warn('could not read your saved tune, so no song goes in the picture', String(e)); return 'no tune'; }
  const corners = ['bottom-right', 'top-left', 'top-right'], room = corners.length * PicCode.capacity();
  if (!bytes.length) return 'no tune';
  if (bytes.length > room) { trif.warn(`your tune is ${bytes.length} bytes, more than the ${room} a picture's song corners hold, so no song goes in the picture`); return 'tune too big'; }
  const streams = PicCode.spread(corners, { kind: PicCode.KIND.song, version: 1, payload: bytes });
  for (const s of streams) for (const [x, y, level] of s.cells) paintCell(g, x, y, level);
  return `with your tune, ${bytes.length} bytes in ${streams.length} ${streams.length === 1 ? 'corner' : 'corners'}`;
};

// the chosen picture (a canvas TRIF made from it) → a 400×400 canvas of our own, or nothing (the banner: as it was)
const encode = (src, w, h, st) => {
  try {
    if (Math.max(w, h) / Math.min(w, h) > 1.3) return undefined; // (the banner: not ours)
    const side = Math.min(w, h);
    const c = page.create('canvas');
    c.setAttr('width', String(SIZE)); c.setAttr('height', String(SIZE));
    const g = c.canvas();
    g.set({ imageSmoothingQuality: 'high' });
    g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE); // (the middle square)
    const tune = stampTune(g);
    // (no saved style for this account: just the 400×400 picture, no style code)
    if (!st) {
      trif.log(`made the picture 400×400 (no style saved for this account, so no style code; ${tune})`);
      return c;
    }
    // the style (colours, rainbows, fonts) as picture code v2, in the bottom-left corner: gray cells (see
    // PicCode, StyleCode). (The other three corners: the tune, above.)
    const colour = (v, dflt) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : dflt);
    const colours = [st.bg, st.name, st.badge, st.handle, st.text, colour(st.buttons, '#00aaff'), colour(st.links, '#00aaff'), colour(st.panel, st.bg),
      colour(st.icons, st.text), colour(st.logo, st.text), colour(st.cards, st.bg), colour(st.lines, '#555555'), colour(st.quotes, colour(st.cards, st.bg))];
    const payload = StyleCode.pack(colours, Array.isArray(st.rainbow) ? st.rainbow : [], st.fonts);
    const cells = PicCode.encode('bottom-left', { kind: PicCode.KIND.style, version: StyleCode.VERSION, payload });
    for (const [x, y, level] of cells) paintCell(g, x, y, level);
    trif.log(`stamped your profile style into the picture (${payload.length} bytes, ${cells.length} cells${[st.fonts?.name, st.fonts?.handle, st.fonts?.text].some(StyleCode.font) ? ', with its fonts' : ''}; ${tune})`, JSON.stringify(st));
    return c;
  } catch (e) {
    trif.warn('could not stamp the picture, so it goes as it was', String(e));
    return undefined;
  }
};

// Edit profile only (x.com/settings/profile): there, each picture you choose comes here first; elsewhere this
// asks for none (so TRIF leaves them alone). Every new profile picture goes up 400×400, with the code only
// when the signed-in account has a saved style.
let off = null;
const watch = (url) => {
  const here = /^https?:\/\/[^/]+\/settings\/profile/.test(String(url));
  if (here && !off) {
    off = trif.onUpload((canvas, { width, height }) => {
      const saved = style();
      const st = saved && [saved.bg, saved.name, saved.badge, saved.handle, saved.text].every((v) => /^#[0-9a-f]{6}$/i.test(v || '')) ? saved : null;
      return encode(canvas, width, height, st);
    });
  } else if (!here && off) { off(); off = null; }
};
trif.onUrl(watch);
watch(page.url);
