// ==WebMod==
// @name        Tune Composer
// @description A little NES-style music maker, for tunes small enough to hide in a profile picture
// @match       https://x.com/*
// @run-at      document-idle
// @risk        0 render-only: its own panel, and sounds made on the spot with Web Audio; keeps your tune in this browser; sends nothing
// @source      trif
// @version     2
// @boxed
// @powers      sound, controls, block-events keydown keyup keypress, site-storage local:trifTuneComposer.*, image-variants pbs.twimg.com _normal.→_400x400. _bigger.→_400x400. _mini.→_400x400. _x96.→_400x400. _200x200.→_400x400.
// ==/WebMod==

// Boxed (TRIF's sandbox) with five powers: sound (its NES voices: the same PeriodicWaves and LFSR drums, on
// the sandbox's sound nodes), controls (its sliders, selects and the tempo box), block-events (the keys the
// panel takes don't reach X, as stopImmediatePropagation kept them from it) and site-storage (your tune and the
// panel's place stay where they were, trifTuneComposer.* in x.com's localStorage, which Style Encoder reads) and
// image-variants (From picture: the open profile's picture again at 400×400, its pixels read for the tune in its corners).
// What the sandbox changes, against the free version:
// - The panel puts the focus on its own Play button when it opens or is clicked (a key on the mod's own
//   button is one TRIF can tell wasn't typed into anything; the free version focused the panel itself).
// - Alt+Shift+T works where the focus is on the page, a link or a button, not on one of X's posts (TRIF shows a
//   key there only with the keys power, which this doesn't ask for; the corner ♪ always works).
// - The lanes' windows move their roll (margin-top) instead of scrolling (a mod only reads an element's scroll).
// - The time signatures that don't fit at the rows per beat aren't greyed out in the list (a mod can't disable an
//   option); picking one says why in the status line, as the free version's setMeter did.

// Tim's. A four-channel composer modelled on the NES sound chip (the 2A03, without its sample channel), for
// tunes that will later ride in the hidden corners of a profile picture, the way Style Encoder stamps a style
// into the bottom-left one (style-encoder.js, profile-styler.js). Style Encoder stamps your saved tune into the
// other three corners of the next picture you upload, and anyone with Profile Styler gets a speaker button to
// play it.
//
// Open it: "♪ Tune" beside Save in Edit profile (x.com/settings/profile), or Alt+Shift+T anywhere on X.
// - Four lanes: Pulse 1, Pulse 2 (12.5/25/50/75% duty, 16 volumes, decay envelope, pitch sweep), Triangle
//   (bass: the NES's 16-step triangle, no volume) and Noise (8 drums from the NES's noise generator).
// - Each lane is a small piano roll over a 16-row pattern (16ths by default). Click to place a note, drag to set
//   its length, click it again or right-click to remove it, Alt-click a pulse note to change its volume.
//   One note at a time per channel, as on the chip.
// - Time (2/4 … 12/8) and Bars (1 or 2) make every pattern that many bars (32 rows at most): rows added are
//   empty, notes in rows cut off go, and it's one Undo. A bar line at each bar, a lighter line on each beat.
//   Tempo counts beats of the time signature's note (eighths in 6/8). A tune in 4/4 with 16-row patterns
//   is saved as format version 3, which every Profile Styler plays; any other, as version 4.
// - Patterns (A–Z, then AA…, up to 64), arranged into a song in the order strip (drag to move, right-click to remove).
// - The space meter shows the tune's size in bytes against the room in a picture's three song corners,
//   441 bytes each, 1,323 in all (TUNE_ROOM, from PicCode), and how many corners it takes.
// - Save keeps the encoded bytes in this browser (localStorage), so what the meter shows is what's saved.
// - Keys, while the panel is open and you're not typing in a text field: A W S E D F T G Y H U J K O L P ;
//   play and enter notes at the cursor (A S D F G H J K on the Noise lane: the 8 drums), Z/X octave,
//   1–8 (9 = 12, 0 = 16) note length, arrows move the cursor and change lanes, Backspace deletes, Space plays
//   and stops, Ctrl/⌘+Z undoes, Esc closes. Those keys don't reach X while the panel has them.
//
//
//
// The format (TuneCodec below, where it's described in full): version 3 bits · length 13 bits · payload · CRC-8.
// The payload describes the song by its structure: intervals from the last note (in steps of the song's key when
// that's shorter), lengths as "the same again" or written out, lanes taken from earlier patterns or other
// channels and moved, and repeats of earlier events in a lane. Those symbols then go through a small adaptive
// binary range coder (integer maths only, so every browser reads it the same). Up to 64 patterns, 256 bars.
// A blank song is 11 bytes; the demo tune (TUNE_DEMO) is 117. Measured: tests/dev/measure-tunes.js.


if (page.root.attr('data-trif-box-tcp') !== null) return; // (loaded twice)
page.root.setAttr('data-trif-box-tcp', '');

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

  /* tune-synth:begin */
  // The sound: the 2A03's channels in Web Audio, made on the spot (no samples, no network). (Boxed: the same
  // synth on the sandbox's sound nodes, trif.audio(): oscillators with the same PeriodicWaves, the drums'
  // LFSR samples as buffers at the context's own rate, gains and filters; no onended there, so a voice is let
  // go a moment after it stops. The offline render, for the free version's tests, isn't here.)
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
    // (→ its samples, and its length in seconds)
    function renderDrum(ctx, d, period, mode) {
      const shape = DRUMS[d], sr = ctx.rate, spf = sr / 60, frames = shape.vol.length, len = Math.ceil(frames * spf);
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
      return { samples, rate: sr, duration: len / sr };
    }

    // A: trif.audio() (its `now` stands in for currentTime, its `rate` for sampleRate)
    function create(A, out = 'out') {
      const ctx = { get currentTime() { return A.now; }, get rate() { return A.rate; } };
      const waves = { duty: SERIES.duty, tri: SERIES.tri };
      // the console's output filters, roughly: a high-pass at 90 Hz and a low-pass at 14 kHz
      const hp = A.filter({ type: 'highpass', frequency: 90, Q: 0.5 }), lp = A.filter({ type: 'lowpass', frequency: 14000, Q: 0.5 }), master = A.gain(0.8);
      master.connect(hp); hp.connect(lp); lp.connect(out);
      const bus = { p1: A.gain(1), p2: A.gain(1), tri: A.gain(1), noise: A.gain(1) };
      for (const ch of C.CHANNELS) bus[ch].connect(master);
      const live = new Set();
      // (no onended in the sandbox: let go a moment after its stop time)
      const track = (src, g, end) => {
        live.add(src);
        setTimeout(() => { live.delete(src); try { src.disconnect(); g.disconnect(); } catch { /* gone */ } }, Math.max(0, (end - A.now) * 1000) + 250);
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
        param.set(0, t);
        param.ramp(amp(v), t + 0.001);
        if (decay) {
          const step = (DECAY_P[decay] + 1) / 240;
          for (let at = t + step; v > 0 && at < end - 0.004; at += step) { v--; param.set(amp(v), at); }
        }
        param.set(amp(v), Math.max(t + 0.001, end - 0.004));
        param.ramp(0, end);
      }
      // a pulse or triangle note: inst is the pulse's instrument (null for the triangle); t, dur in seconds
      function note(ch, n, inst, t, dur) {
        const osc = A.oscillator(), g = A.gain(), hz = midiHz(C.BASE[ch] + n.pitch), end = t + dur;
        const freq = osc.param('frequency'), gain = g.param('gain');
        let stop = end;
        if (ch === 'tri') {
          osc.setWave(waves.tri.real, waves.tri.imag);
          const timer = Math.max(2, Math.min(0x7ff, Math.round(CPU / (32 * hz)) - 1));
          freq.set(CPU / (32 * (timer + 1)), t);
          gain.set(0, t);
          gain.ramp(LEVEL.tri, t + 0.002);
          gain.set(LEVEL.tri, Math.max(t + 0.002, end - 0.004));
          gain.ramp(0, end);
        } else {
          const duty = n.duty ?? inst.duty, vol = n.vol ?? inst.vol, decay = n.decay ?? inst.decay;
          osc.setWave(waves.duty[duty].real, waves.duty[duty].imag);
          let timer = Math.max(8, Math.min(0x7ff, Math.round(CPU / (16 * hz)) - 1));
          freq.set(CPU / (16 * (timer + 1)), t);
          const sw = inst.sweep;
          if (sw) { // the sweep unit: every (P+1)/120 s the timer moves by itself >> shift; out of range, it goes quiet
            const step = (sw.period + 1) / 120;
            for (let at = t + step; at < end; at += step) {
              const delta = timer >> sw.shift;
              timer = sw.neg ? timer - delta - (ch === 'p1' ? 1 : 0) : timer + delta;
              if (timer < 8 || timer > 0x7ff) { stop = at; break; }
              freq.set(CPU / (16 * (timer + 1)), at);
            }
          }
          envelope(gain, vol, decay, t, stop, ch === 'p1' ? LEVEL.p1 : LEVEL.p2);
        }
        osc.connect(g);
        g.connect(ch === 'p1' ? bus.p1 : ch === 'p2' ? bus.p2 : bus.tri);
        osc.start(t);
        osc.stop(stop + 0.005);
        track(osc, g, stop + 0.005);
      }
      function drum(hit, noise, t, dur) {
        const k = noise.kit[hit.drum], buf = drumBuffer(hit.drum, k[0], k[1]), src = A.buffer([buf.samples], buf.rate), g = A.gain();
        const level = (noise.vol / 15) * LEVEL.noise, end = t + Math.min(buf.duration, dur), gain = g.param('gain');
        gain.set(level, t);
        gain.set(level, Math.max(t, end - 0.004));
        gain.ramp(0, end);
        src.connect(g); g.connect(bus.noise);
        src.start(t); src.stop(end + 0.005);
        track(src, g, end + 0.005);
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
      const mute = (ch, on) => bus[ch].param('gain').set(on ? 0 : 1, A.now);
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

    return { CPU, NOISE_PERIODS, DUTY, TRI, create, player };
  })(TuneCodec);
  /* tune-synth:end */

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

  /* tune-room:begin */
  // Where a tune goes: the three song corners of a profile picture (picture code v2: 2×2 gray cells, each corner
  // its own stream with markers, kind, version, length and CRC-16). The tune's bytes are cut into corner-sized
  // pieces in corner order and joined back the same way; TuneCodec never sees corners (it ignores anything after
  // its own checksum, so a joined stream may carry padding).
  const TUNE_ROOM = (() => {
    const CORNER_BYTES = PicCode.capacity(), CORNERS = 3, BYTES = CORNER_BYTES * CORNERS; // 441 a corner, 1,323
    const split = (bytes) => {
      if (bytes.length > BYTES) throw new RangeError(`tune: ${bytes.length} bytes is more than ${BYTES} (${CORNERS} corners)`);
      const out = [];
      for (let i = 0; i < bytes.length; i += CORNER_BYTES) out.push(bytes.slice(i, i + CORNER_BYTES));
      return out;
    };
    const join = (pieces) => Uint8Array.from(pieces.flatMap((b) => [...b]));
    const corners = (n) => Math.ceil(n / CORNER_BYTES);
    return { CORNER_BYTES, CORNERS, BYTES, split, join, corners };
  })();
  /* tune-room:end */

  /* tune-demo:begin */
  // The demo tune (an original): eight bars of C – Am – F – G, C – Am – F G – C, from six patterns.
  const TUNE_DEMO = {
    tempo: 140, rpb: 4,
    inst: { p1: { duty: 1, vol: 11, decay: 6 }, p2: { duty: 0, vol: 7, decay: 4 }, noise: { vol: 11 } },
    patterns: [
      { p1: 'E5:2 G5:2 C6:3 B5:1 A5:2 G5:2 E5:4', p2: 'G4:2 C5:2 E5:2 C5:2 G4:2 C5:2 E5:2 C5:2',
        tri: 'C3:3 C4:1 -:2 C3:2 G2:3 G3:1 -:2 G2:2', noise: 'K:2 H:2 S:2 H:1 K:1 K:2 H:2 S:2 H:2' },
      { p1: 'A5:2 C6:2 E6:3 D6:1 C6:2 B5:2 A5:4', p2: 'A4:2 C5:2 E5:2 C5:2 A4:2 C5:2 E5:2 C5:2',
        tri: 'A2:3 A3:1 -:2 A2:2 E2:3 E3:1 -:2 G2:2', noise: 'K:2 H:2 S:2 H:1 K:1 K:2 H:2 S:2 H:2' },
      { p1: 'F5:2 A5:2 C6:2 F6:2 E6:2 D6:2 C6:2 A5:2', p2: 'A4:2 C5:2 F5:2 C5:2 A4:2 C5:2 F5:2 C5:2',
        tri: 'F2:3 F3:1 -:2 F2:2 C3:3 C4:1 -:2 C3:2', noise: 'K:2 H:2 S:2 H:1 K:1 K:2 H:2 S:2 H:2' },
      { p1: 'B5:3 C6:1 D6:2 B5:2 G5:6 -:2', p2: 'B4:2 D5:2 G5:2 D5:2 B4:2 D5:2 G5:2 D5:2',
        tri: 'G2:3 G3:1 -:2 G2:2 D3:3 D4:1 -:2 B2:2', noise: 'K:2 H:2 S:2 H:2 K:2 S:1 S:1 T:1 T:1 L:1 L:1' },
      { p1: 'A5:2 C6:2 F6:4 G6:2 F6:1 E6:1 D6:4', p2: 'A4:2 C5:2 F5:2 C5:2 B4:2 D5:2 G5:2 D5:2',
        tri: 'F2:3 F3:1 -:2 F2:2 G2:3 G3:1 -:2 G2:2', noise: 'K:2 H:2 S:2 H:1 K:1 K:2 C:2 S:2 O:2' },
      { p1: 'E6:2 D6:1 C6:1 G5:2 E5:2 C6:6!13 -:2', p2: 'G4:2 C5:2 E5:2 G5:2 C6:4 -:4',
        tri: 'C3:3 C4:1 -:2 G2:2 C3:4 -:4', noise: 'X:4 H:2 S:2 K:2 C:2 K:2 -:2' },
    ],
    order: [0, 1, 2, 3, 0, 1, 4, 5],
  };
  /* tune-demo:end */

  // --- the page, through TRIF's sandbox --------------------------------------------------------------------
  // The composer below is the free version's, line for line where it could be. It builds its panel with a
  // handful of DOM habits (el.className = …, el.css.left = …, el.dataset.v = …, el.txt = '', …):
  // E wraps one of TRIF's stand-ins with exactly those, mapped to the sandbox's API. Its own names get the
  // sandbox's prefix on the way (classes and ids tcp-x → trif-box-tcp-x, data-x → data-trif-box-x), so the
  // stylesheet names them that way too. A button can't be disabled by a mod (the attribute isn't offered):
  // aria-disabled, styled the same, and its clicks ignored. (The wrapper's own names, like listen and txt,
  // are its own: TRIF's check reads element-like names, addEventListener and the rest, as the page's.)
  const PFX = 'trif-box-';
  const own = (c) => String(c).split(/\s+/).filter(Boolean).map((x) => (x.startsWith(PFX) ? x : PFX + x));
  const attrName = (n) => (/^data-/.test(n) && !/^data-trif-box-/.test(n) ? `data-trif-box-${n.slice(5)}` : n);
  const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const selOwn = (sel) => sel.replace(/([.#])tcp-/g, `$1${PFX}tcp-`);
  const ROOT_S = page.root;
  const ES = new WeakMap();
  // (a drag's data: the sandbox's, which holds only the mod's own; effectAllowed is the browser's to choose)
  const dragOf = (dt) => (dt ? { setData: (t, v) => dt.setData(t, v), getData: (t) => dt.getData(t), set effectAllowed(v) { /* (not offered) */ }, set dropEffect(v) { try { dt.setDropEffect(v); } catch { /* fine */ } } } : null);
  const evOf = (ev) => {
    const target = E.of(ev.target);
    return {
      type: ev.type, key: ev.key, code: ev.code, repeat: ev.repeat, altKey: ev.alt, shiftKey: ev.shift, ctrlKey: ev.ctrl, metaKey: ev.meta,
      clientX: ev.x, clientY: ev.y, button: ev.button, buttons: ev.buttons, pointerId: ev.pointerId, target, composedPath: () => [target],
      dataTransfer: dragOf(ev.dataTransfer),
      preventDefault: () => ev.preventDefault(), stopPropagation: () => ev.stopPropagation(), stopImmediatePropagation: () => ev.stopImmediatePropagation(),
    };
  };
  class E {
    static of(s) { if (!s) return null; let e = ES.get(s); if (!e) { e = new E(s); ES.set(s, e); } return e; }
    static make(tag) { return E.of(page.create(tag)); }
    constructor(s) {
      this.s = s; this._cls = []; this._styles = new Map(); this._data = new Map(); this._disabled = false; this._off = new Map();
      const self = this;
      this.css = new Proxy({}, {
        get(_, k) {
          if (k === 'setProperty') return (n, v) => self._css(n, v);
          if (k === 'removeProperty') return (n) => self._css(n, '');
          return self._styles.get(kebab(String(k))) || '';
        },
        set(_, k, v) { self._css(kebab(String(k)), v); return true; },
      });
      this.dataset = new Proxy({}, {
        get(_, k) { return self._data.get(String(k)); },
        set(_, k, v) { self._data.set(String(k), String(v)); s.setAttr(`data-trif-box-${kebab(String(k))}`, String(v)); return true; },
      });
      this.cl = {
        add: (...c) => { const x = own(c.join(' ')); if (x.length) s.classes.add(...x); },
        remove: (...c) => { const x = own(c.join(' ')); if (x.length) s.classes.remove(...x); },
        toggle: (c, on) => s.classes.toggle(own(c)[0], on),
        contains: (c) => s.classes.has(own(c)[0]),
      };
    }
    _css(n, v) {
      const val = v == null ? '' : String(v);
      if (val === '') { this._styles.delete(n); this.s.style(n, null); } else { this._styles.set(n, val); this.s.style(n, val); }
    }
    get tagName() { return this.s.tag.toUpperCase(); }
    get className() { return this._cls.map((c) => c.slice(PFX.length)).join(' '); }
    set className(c) { if (this._cls.length) this.s.classes.remove(...this._cls); this._cls = own(c); if (this._cls.length) this.s.classes.add(...this._cls); }
    get txt() { return this.s.text; }
    set txt(t) { this.s.setText(t == null ? '' : String(t)); }
    get id() { const v = this.s.attr('id'); return v ? v.replace(PFX, '') : ''; }
    set id(v) { this.s.setAttr('id', PFX + v); }
    set title(v) { this.s.setAttr('title', String(v)); }
    get title() { return this.s.attr('title') || ''; }
    set tabIndex(v) { this.s.setAttr('tabindex', String(v)); }
    set draggable(v) { this.s.setAttr('draggable', v ? 'true' : 'false'); }
    get type() { return this.s.attr('type') || ''; }
    set type(v) { if (this.s.tag !== 'button') this.s.setAttr('type', String(v)); } // (a mod's button is always type=button)
    set min(v) { this.s.setAttr('min', String(v)); }
    set max(v) { this.s.setAttr('max', String(v)); }
    set step(v) { this.s.setAttr('step', String(v)); }
    get value() { return this.s.value; }
    set value(v) { if (this.s.tag === 'option') this.s.setAttr('value', String(v)); else this.s.setValue(String(v)); }
    get disabled() { return this._disabled; }
    set disabled(v) { this._disabled = !!v; if (this._disabled) this.s.setAttr('aria-disabled', 'true'); else this.s.removeAttr('aria-disabled'); }
    setA(n, v) { this.s.setAttr(attrName(n), String(v)); }
    removeA(n) { this.s.removeAttr(attrName(n)); }
    toggleAttribute(n, on) {
      const m = attrName(n), want = on === undefined ? this.s.attr(m) === null : !!on;
      if (want) this.s.setAttr(m, ''); else this.s.removeAttr(m);
      return want;
    }
    append(...k) { this.s.append(...k.map((x) => (x instanceof E ? x.s : String(x)))); }
    before(...k) { this.s.before(...k.map((x) => (x instanceof E ? x.s : String(x)))); }
    remove() { this.s.remove(); }
    get isConnected() { for (let p = this.s; p; p = p.parent) if (p === ROOT_S) return true; return false; }
    get prev() { return E.of(this.s.previous); }
    rectOf() { return this.s.rect(); }
    get offsetWidth() { return this.s.offsetWidth; }
    get offsetLeft() { return this.s.offsetLeft; }
    get offsetTop() { return this.s.offsetTop; }
    all(sel) { return this.s.findAll(selOwn(sel)).map((x) => E.of(x)); }
    closest(sel) { return E.of(this.s.closest(selOwn(sel))); }
    listen(type, fn, opt) {
      const capture = opt === true || !!(opt && opt.capture);
      const off = this.s.on(type, (ev) => { if (this._disabled && type === 'click') return; fn(evOf(ev)); }, { capture, preventDefault: true });
      this._off.set(fn, off);
    }
    unlisten(type, fn) { const off = this._off.get(fn); if (off) { off(); this._off.delete(fn); } }
    capture(id) { try { this.s.capturePointer(id); } catch { /* not now */ } }
    focusIt() { this.s.focusIt(); }
    blur() { try { this.s.blur(); } catch { /* not now */ } }
  }
  const ROOT = E.of(ROOT_S);
  // (numbers with thousands commas, as toLocaleString('en') wrote them: the sandbox's toLocaleString has no locale)
  const NF = new Intl.NumberFormat('en');
  const fmt = (n) => NF.format(n);

  // --- the composer ------------------------------------------------------------------------------------
  const C = TuneCodec, S = TuneSynth, P = C.PITCHES;
  const STORE = 'trifTuneComposer.song'; // the saved tune: its encoded bytes, base64
  const POS = 'trifTuneComposer.pos'; // where you dragged the panel
  const LANES = [
    { ch: 'p1', name: 'Pulse 1', color: '#e0453a' },
    { ch: 'p2', name: 'Pulse 2', color: '#e8930f' },
    { ch: 'tri', name: 'Triangle', color: '#2e86d6' },
    { ch: 'noise', name: 'Noise', color: '#2f9e44' },
  ];
  const RH = 7, DH = 12, GUT = 36; // a pitch row's height, a drum row's, the key gutter
  // a column's width: 22 px up to 16 rows; longer patterns narrower (down to 14 px), and the panel wider past that
  let CW = 22;
  const colWidth = (rows) => (rows <= 16 ? 22 : Math.max(14, Math.floor((16 * 22) / rows)));
  const PANEL_W = 616;
  // the time signatures on offer (beats a bar / the beat's note); a pattern is one or two bars of 32 rows at most
  const METERS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [7, 8], [9, 8], [12, 8]];
  const WIN = 17; // a note lane's window, in rows: the piano's reach, C to the E above the next C (keys A … ;)
  const DUTY_NAMES = ['12.5%', '25%', '50%', '75%'];
  const DECAY_NAMES = ['Hold', 'Blip', 'Pluck', 'Short', 'Medium', 'Long', 'Slow', 'Fade'];
  const SWEEPS = [['No sweep', null], ['Drop', { neg: false, period: 1, shift: 3 }], ['Slide down', { neg: false, period: 5, shift: 6 }],
    ['Rise', { neg: true, period: 2, shift: 4 }], ['Zap', { neg: false, period: 0, shift: 1 }]];
  const KITS = [['Standard', C.KIT], ['Bright', C.KIT.map((k) => [Math.max(0, k[0] - 2), k[1]])],
    ['Deep', C.KIT.map((k) => [Math.min(15, k[0] + 2), k[1]])], ['Metal', C.KIT.map((k) => [k[0], 1])]];
  const DRUM_SHORT = ['Kick', 'Snare', 'Hat', 'Open', 'Tom L', 'Tom H', 'Clap', 'Crash'];
  const LENGTHS = [1, 2, 3, 4, 5, 6, 7, 8, 12, 16];
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const label = (i) => (i < 26 ? AZ.charAt(i) : AZ.charAt(Math.floor(i / 26) - 1) + AZ.charAt(i % 26)); // A … Z, AA … BL
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  const isBlack = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);
  const PIANO = new Map(['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'].map((k, i) => [k, i]));
  const PADS = new Map(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'].map((k, i) => [k, i]));
  const OCT = { p1: [2, 6], p2: [2, 6], tri: [1, 5] }; // the piano's octave range per lane (its A key's C)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // (x.com's localStorage, as before, through the site-storage power: Style Encoder reads the song there)
  const ls = trif.storage('local');
  const store = {
    get(k) { try { return ls.get(k); } catch { return null; } },
    set(k, v) { try { ls.set(k, v); return true; } catch { return false; } },
  };

  // the tune: the saved one, or the demo
  let saved = store.get(STORE), song, firstNote = '';
  try { song = saved ? C.decode(C.fromBase64(saved)) : C.fromText(TUNE_DEMO); } catch {
    // (kept aside, never overwritten: a tune saved in an older format, say)
    if (store.get(`${STORE}.unread`) == null) store.set(`${STORE}.unread`, saved);
    song = C.fromText(TUNE_DEMO); saved = null; firstNote = 'The saved tune couldn’t be read (it’s kept aside), so here’s the demo.';
  }
  const ui = { open: false, pat: 0, lane: 'p1', cursor: 0, len: 2, oct: new Map([['p1', 5], ['p2', 4], ['tri', 2]]), loop: 'song', from: 0, drum: 1, muted: new Set(), status: firstNote, centred: false, scrolls: [] };
  const undo = [];
  const curLane = (ch) => C.laneOf(song.patterns[ui.pat], ch);
  const instFor = (ch) => (ch === 'p1' ? song.inst.p1 : ch === 'p2' ? song.inst.p2 : null);
  const rowDur = () => 60 / (song.tempo * song.rpb);
  // a change: made to the song in place, then checked; `was` (the song before, as JSON) goes on the undo stack
  const commit = (was) => {
    try { song = C.normalize(song); } catch (e) { song = JSON.parse(was); ui.status = e.message; }
    if (JSON.stringify(song) !== was) { undo.push(was); if (undo.length > 200) undo.shift(); ui.status = ''; autosave(); }
    ui.pat = Math.min(ui.pat, song.patterns.length - 1);
    render();
  };
  const edit = (fn) => { const was = JSON.stringify(song); fn(); commit(was); };
  // how many bars a pattern is now (0: not a whole number of them, as when rows per beat changed since)
  const barsNow = () => { const bar = song.beats * song.rpb, n = song.rows / bar; return Number.isInteger(n) ? n : 0; };
  // a new time signature or bars per pattern: every pattern resized to that many bars (new rows empty; notes
  // in rows cut off go, and notes running past the end are shortened), as one step
  const fits = (beats, bars) => bars * beats * song.rpb <= C.MAX_ROWS;
  const setMeter = (beats, unit, bars) => {
    if (!fits(beats, bars)) bars = 1;
    if (!fits(beats, bars)) { ui.status = `${beats}/${unit} at ${song.rpb} rows per beat is more than a pattern’s ${C.MAX_ROWS} rows.`; render(); return; }
    const rows = bars * beats * song.rpb;
    edit(() => {
      song.beats = beats; song.unit = unit; song.rows = rows;
      for (const p of song.patterns) {
        for (const ch of C.CHANNELS) {
          const lane = C.laneOf(p, ch);
          for (let i = lane.length - 1; i >= 0; i--) { const n = lane[i]; if (n.row >= rows) lane.splice(i, 1); else if (n.row + n.len > rows) n.len = rows - n.row; }
        }
      }
    });
  };
  const doUndo = () => { if (!undo.length) return; song = JSON.parse(undo.pop()); ui.pat = Math.min(ui.pat, song.patterns.length - 1); ui.status = ''; render(); autosave(); };

  // --- sound (the AudioContext only once something is played) ---
  let actx = null, engine = null, player = null;
  const audio = () => {
    if (!actx) {
      actx = trif.audio();
      engine = S.create(actx);
      for (const ch of ui.muted) engine.mute(ch, true);
      player = S.player(engine, { song: () => song, pattern: () => ui.pat, mode: () => ui.loop, from: () => (ui.loop === 'song' && ui.from < song.order.length ? ui.from : 0) });
    }
    if (actx.state === 'suspended') actx.resume();
    return engine;
  };
  const preview = (ch, key, len) => {
    const e = audio(), t = actx.now + 0.01, d = clamp((len || ui.len) * rowDur(), 0.12, 0.4);
    if (ch === 'noise') e.drum({ row: 0, len: 8, drum: key }, song.inst.noise, t, 1);
    else e.note(ch, { pitch: key }, instFor(ch), t, d);
  };
  const playing = () => !!player && player.playing;
  const togglePlay = () => {
    audio();
    if (player.playing) player.stop(); else { player.start(); requestAnimationFrame(frame); }
    render();
  };

  // --- notes in a lane (one at a time per channel) ---
  const keyOf = (n) => (n.drum != null ? n.drum : n.pitch);
  const nextStart = (lane, row, except) => lane.reduce((m, o) => (o !== except && o.row > row ? Math.min(m, o.row) : m), song.rows);
  function placeNote(lane, row, key, len, drums) {
    for (let i = lane.length - 1; i >= 0; i--) {
      const o = lane[i];
      if (o.row === row) lane.splice(i, 1); else if (o.row < row && o.row + o.len > row) o.len = row - o.row;
    }
    const cap = Math.min(nextStart(lane, row) - row, drums ? C.MAX_DRUM_LEN : song.rows);
    const n = drums ? { row, len: Math.min(len, cap), drum: key } : { row, len: Math.min(len, cap), pitch: key };
    lane.push(n);
    lane.sort((a, b) => a.row - b.row);
    return n;
  }
  const setLen = (lane, n, len, drums) => { n.len = clamp(len, 1, Math.min(nextStart(lane, n.row, n) - n.row, drums ? C.MAX_DRUM_LEN : song.rows)); };
  const removeNote = (lane, n) => { const i = lane.indexOf(n); if (i >= 0) lane.splice(i, 1); };
  const noteAt = (lane, col, key) => lane.find((n) => keyOf(n) === key && n.row <= col && col < n.row + n.len);
  const enter = (key) => {
    const was = JSON.stringify(song), n = placeNote(curLane(ui.lane), ui.cursor, key, ui.len, ui.lane === 'noise');
    preview(ui.lane, key, n.len);
    ui.cursor = (n.row + n.len) % song.rows;
    commit(was);
  };
  const erase = () => {
    const lane = curLane(ui.lane);
    const n = lane.find((o) => o.row <= ui.cursor && ui.cursor < o.row + o.len) || [...lane].reverse().find((o) => o.row < ui.cursor);
    if (!n) return;
    ui.cursor = n.row;
    edit(() => removeNote(lane, n));
  };

  // --- the panel ---
  // (each tag by name: TRIF reads a tag worked out at run time as maybe a script or a frame)
  // (TRIF's stand-ins, through the small E wrapper above; <kbd> isn't one of the sandbox's tags: <code> instead)
  const make = (tag) => E.make(tag === 'kbd' ? 'code' : tag);
  const el = (tag, cls, text) => { const e = make(tag); if (cls) e.className = cls; if (text != null) e.txt = text; return e; };
  const btn = (cls, text, title, on) => { const b = el('button', cls, text); b.type = 'button'; if (title) b.title = title; if (on) b.listen('click', (e) => { if (performance.now() - tookKeyUp < 60) return; on(e); }); return b; };
  const seg = (items, onPick, label) => {
    const box = el('div', 'tcp-seg');
    box.setA('role', 'group');
    if (label) box.setA('aria-label', label);
    const bs = items.map(([v, text, title]) => { const b = btn('', text, title, () => onPick(v)); b.dataset.v = String(v); box.append(b); return b; });
    box.set = (v) => { for (const b of bs) b.setA('aria-pressed', String(b.dataset.v === String(v))); };
    return box;
  };
  const select = (items, onPick, label) => {
    const s = el('select');
    s.setA('aria-label', label);
    for (const [v, text] of items) { const o = el('option', '', text); o.value = String(v); s.append(o); }
    s.listen('change', () => onPick(s.value));
    return s;
  };
  const range = (lo, hi, onPick, label) => {
    const r = el('input'), out = el('span', 'tcp-val');
    r.type = 'range'; r.min = String(lo); r.max = String(hi); r.step = '1';
    r.setA('aria-label', label);
    r.listen('input', () => { out.txt = r.value; });
    r.listen('change', () => onPick(+r.value));
    return [r, out];
  };
  const field = (label, ...nodes) => { const f = el('div', 'tcp-field'); if (label != null) f.append(typeof label === 'string' ? el('span', 'tcp-label', label) : label); f.append(...nodes); return f; };
  const NOTE_ART = ['...XX...', '...X.X..', '...X..X.', '...X....', '.XXX....', 'XXXX....', 'XXXX....', '.XX.....'];
  const pixelNote = () => {
    const box = el('span', 'tcp-icon'), px = el('i'), sh = [];
    NOTE_ART.forEach((line, y) => [...line].forEach((c, x) => { if (c === 'X') sh.push(`${x * 2}px ${y * 2}px 0 #e0453a`); }));
    px.css.boxShadow = sh.join(',');
    box.append(px);
    return box;
  };

  trif.css(`
    #trif-box-tcp-panel { all: initial; display: block; position: fixed; top: 56px; right: 16px; z-index: 2147483646; width: 616px; max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box; padding: 12px 14px 10px; border-radius: 16px; background: #fff; color: #0f1419;
      box-shadow: 0 4px 24px rgb(0 0 0 / .25); font: 13px/1.3 -apple-system, system-ui, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
      outline: none; user-select: none; -webkit-user-select: none; scrollbar-width: thin; }
    #trif-box-tcp-panel *, #trif-box-tcp-panel *::before, #trif-box-tcp-panel *::after { box-sizing: border-box; }
    #trif-box-tcp-panel button, #trif-box-tcp-panel select, #trif-box-tcp-panel input { font: inherit; color: inherit; margin: 0; }
    #trif-box-tcp-panel .trif-box-tcp-head { display: flex; align-items: center; gap: 8px; margin: -2px 0 8px; cursor: grab; }
    #trif-box-tcp-panel .trif-box-tcp-head:active { cursor: grabbing; }
    #trif-box-tcp-panel .trif-box-tcp-title { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 15px; font-weight: 800; }
    #trif-box-tcp-panel .trif-box-tcp-icon { position: relative; width: 16px; height: 16px; flex: none; }
    #trif-box-tcp-panel .trif-box-tcp-icon i { position: absolute; left: 0; top: 0; width: 2px; height: 2px; }
    #trif-box-tcp-panel .trif-box-tcp-chip { font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; padding: 3px 5px 2px; border-radius: 3px; background: #0f1419; color: #fff; }
    #trif-box-tcp-panel .trif-box-tcp-x { width: 30px; height: 30px; border-radius: 50%; border: 0; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
    #trif-box-tcp-panel .trif-box-tcp-x:hover { background: #eff3f4; }
    #trif-box-tcp-panel .trif-box-tcp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin: 0 0 8px; }
    #trif-box-tcp-panel .trif-box-tcp-group { display: flex; align-items: center; gap: 5px; }
    #trif-box-tcp-panel .trif-box-tcp-label { font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .07em; text-transform: uppercase; color: #536471; white-space: nowrap; }
    #trif-box-tcp-panel .trif-box-tcp-btn { font-weight: 700; padding: 4px 11px; border-radius: 9999px; border: 1px solid #cfd9de; background: #fff; cursor: pointer; white-space: nowrap; }
    #trif-box-tcp-panel .trif-box-tcp-btn:hover:not([aria-disabled=true]) { background: #f7f9f9; }
    #trif-box-tcp-panel button[aria-disabled=true] { opacity: .4; cursor: default; }
    #trif-box-tcp-panel .trif-box-tcp-primary { background: #0f1419; border-color: #0f1419; color: #fff; box-shadow: 2px 2px 0 #e0453a; }
    #trif-box-tcp-panel .trif-box-tcp-primary:hover:not([aria-disabled=true]) { background: #272c30; }
    #trif-box-tcp-panel .trif-box-tcp-primary:active:not([aria-disabled=true]) { transform: translate(1px, 1px); box-shadow: 1px 1px 0 #e0453a; }
    #trif-box-tcp-panel .trif-box-tcp-play { min-width: 76px; }
    #trif-box-tcp-panel .trif-box-tcp-seg { display: inline-flex; border: 1px solid #cfd9de; border-radius: 9999px; overflow: hidden; flex: none; }
    #trif-box-tcp-panel .trif-box-tcp-seg button { border: 0; border-left: 1px solid #cfd9de; background: #fff; padding: 3px 9px; font-weight: 600; cursor: pointer; }
    #trif-box-tcp-panel .trif-box-tcp-seg button:first-child { border-left: 0; }
    #trif-box-tcp-panel .trif-box-tcp-seg button:hover { background: #f7f9f9; }
    #trif-box-tcp-panel .trif-box-tcp-seg button[aria-pressed=true] { background: #0f1419; color: #fff; }
    #trif-box-tcp-panel .trif-box-tcp-small button { padding: 2px 6px; font: 600 11px ui-monospace, Menlo, monospace; }
    #trif-box-tcp-panel .trif-box-tcp-round { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid #cfd9de; background: #fff; cursor: pointer; font-weight: 700; line-height: 1; }
    #trif-box-tcp-panel input[type=number] { width: 46px; padding: 3px 2px; border: 1px solid #cfd9de; border-radius: 6px; text-align: center; background: #fff; -moz-appearance: textfield; }
    #trif-box-tcp-panel input[type=number]::-webkit-inner-spin-button { display: none; }
    #trif-box-tcp-panel select { padding: 2px 3px; border: 1px solid #cfd9de; border-radius: 6px; background: #fff; cursor: pointer; min-width: 0; font-size: 12px; }
    #trif-box-tcp-panel input[type=range] { width: 70px; accent-color: var(--c, #0f1419); margin: 0; flex: 1; min-width: 0; }
    #trif-box-tcp-panel .trif-box-tcp-rows { display: grid; grid-template-columns: 62px 1fr; gap: 6px 8px; align-items: center; margin: 0 0 4px; }
    #trif-box-tcp-panel .trif-box-tcp-tabs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
    #trif-box-tcp-panel .trif-box-tcp-tab { min-width: 26px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid #cfd9de; background: #fff; font: 700 12px ui-monospace, Menlo, monospace; cursor: pointer; }
    #trif-box-tcp-panel .trif-box-tcp-tab:hover { background: #f7f9f9; }
    #trif-box-tcp-panel .trif-box-tcp-tab[aria-pressed=true] { background: #0f1419; color: #fff; border-color: #0f1419; }
    #trif-box-tcp-panel .trif-box-tcp-act { height: 24px; padding: 0 9px; font-size: 12px; }
    #trif-box-tcp-panel .trif-box-tcp-order { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; min-height: 30px; padding: 3px; border-radius: 7px; background: #f7f9f9; }
    #trif-box-tcp-panel .trif-box-tcp-o { min-width: 22px; height: 22px; padding: 0 4px; border-radius: 4px; border: 1px solid #cfd9de; background: #fff; font: 700 11px ui-monospace, Menlo, monospace; cursor: grab; }
    #trif-box-tcp-panel .trif-box-tcp-o[data-trif-box-sel] { box-shadow: 0 0 0 2px #1d9bf0; border-color: #1d9bf0; }
    #trif-box-tcp-panel .trif-box-tcp-o[data-trif-box-cur] { background: #eaf5fe; }
    #trif-box-tcp-panel .trif-box-tcp-o[data-trif-box-playing] { background: #1d9bf0; border-color: #1d9bf0; color: #fff; }
    #trif-box-tcp-panel .trif-box-tcp-o.trif-box-tcp-over { box-shadow: -3px 0 0 #1d9bf0; }
    #trif-box-tcp-panel .trif-box-tcp-o { position: relative; }
    #trif-box-tcp-panel .trif-box-tcp-o-x { display: none; position: absolute; top: -7px; right: -7px; width: 14px; height: 14px; border-radius: 50%;
      background: #0f1419; color: #fff; font: 700 11px/14px -apple-system, system-ui, sans-serif; text-align: center; cursor: pointer; z-index: 1; }
    #trif-box-tcp-panel .trif-box-tcp-o:hover .trif-box-tcp-o-x { display: block; }
    #trif-box-tcp-panel .trif-box-tcp-o-x:hover { background: #f4212e; }
    #trif-box-tcp-panel .trif-box-tcp-lane { display: grid; grid-template-columns: 160px auto; gap: 10px; padding: 6px 0; border-top: 1px solid #eff3f4; }
    #trif-box-tcp-panel .trif-box-tcp-ctl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    #trif-box-tcp-panel .trif-box-tcp-ltop { display: flex; align-items: center; gap: 6px; height: 20px; }
    #trif-box-tcp-panel .trif-box-tcp-dot { width: 10px; height: 10px; flex: none; background: var(--c); box-shadow: inset -2px -2px 0 rgb(0 0 0 / .2); }
    #trif-box-tcp-panel .trif-box-tcp-lname { flex: 1; font: 700 11px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; }
    #trif-box-tcp-panel .trif-box-tcp-lane[data-trif-box-sel] .trif-box-tcp-lname { color: var(--c); }
    #trif-box-tcp-panel .trif-box-tcp-mute { width: 20px; height: 20px; padding: 0; border-radius: 4px; border: 1px solid #cfd9de; background: #fff; font: 700 10px ui-monospace, Menlo, monospace; cursor: pointer; }
    #trif-box-tcp-panel .trif-box-tcp-mute[aria-pressed=true] { background: #536471; border-color: #536471; color: #fff; }
    #trif-box-tcp-panel .trif-box-tcp-lane[data-trif-box-muted] .trif-box-tcp-layer { opacity: .35; }
    #trif-box-tcp-panel .trif-box-tcp-field { display: flex; align-items: center; gap: 5px; min-width: 0; }
    #trif-box-tcp-panel .trif-box-tcp-field > .trif-box-tcp-label { width: 30px; flex: none; }
    #trif-box-tcp-panel .trif-box-tcp-field > select { flex: 1; }
    #trif-box-tcp-panel .trif-box-tcp-field > select.trif-box-tcp-env { flex: 0 0 70px; }
    #trif-box-tcp-panel .trif-box-tcp-val { width: 15px; flex: none; text-align: right; font: 600 11px ui-monospace, Menlo, monospace; color: #536471; }
    #trif-box-tcp-panel .trif-box-tcp-dname { width: auto !important; flex: 1 !important; color: var(--c); }
    #trif-box-tcp-panel .trif-box-tcp-hintc { font-size: 11.5px; line-height: 1.35; color: #536471; }
    /* (a note lane shows exactly the piano's reach in its octave, WIN rows, and doesn't scroll: Z and X move it;
       see placeWindow) */
    #trif-box-tcp-panel .trif-box-tcp-scroll { position: relative; height: ${WIN * RH + 2}px; width: max-content; overflow: hidden; border: 1px solid #cfd9de; border-radius: 7px; background: #fff; }
    #trif-box-tcp-panel .trif-box-tcp-win { position: relative; }
    #trif-box-tcp-panel .trif-box-tcp-more { all: unset; position: absolute; right: 3px; z-index: 2; width: 18px; height: 14px; border-radius: 4px; cursor: pointer;
      background: var(--c); color: #fff; font: 700 9px/14px -apple-system, system-ui, sans-serif; text-align: center; box-shadow: 0 1px 3px rgb(0 0 0 / .25); }
    #trif-box-tcp-panel .trif-box-tcp-more.trif-box-tcp-up { top: 3px; } #trif-box-tcp-panel .trif-box-tcp-more.trif-box-tcp-down { bottom: 3px; }
    #trif-box-tcp-panel .trif-box-tcp-more[aria-disabled=true] { opacity: .3; cursor: default; }
    /* a note out of the window: a small arrow at the window's edge, in its column, pointing to where it is */
    #trif-box-tcp-panel .trif-box-tcp-marks { position: absolute; inset: 1px; pointer-events: none; overflow: hidden; }
    #trif-box-tcp-panel .trif-box-tcp-mark { position: absolute; height: 9px; color: var(--c); font: 700 8px/9px -apple-system, system-ui, sans-serif; text-align: center; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
    #trif-box-tcp-panel .trif-box-tcp-mark.trif-box-tcp-mup { top: 0; } #trif-box-tcp-panel .trif-box-tcp-mark.trif-box-tcp-mdown { bottom: 0; }
    #trif-box-tcp-panel .trif-box-tcp-drums { height: ${8 * DH + 2}px; overflow: hidden; }
    #trif-box-tcp-panel .trif-box-tcp-lane[data-trif-box-sel] .trif-box-tcp-scroll { border-color: var(--c); box-shadow: 0 0 0 1px var(--c); }
    #trif-box-tcp-panel .trif-box-tcp-roll { position: relative; cursor: crosshair; touch-action: none; } /* (its width: renderLane) */
    #trif-box-tcp-panel .trif-box-tcp-k { position: absolute; left: 0; right: 0; height: ${RH}px; }
    #trif-box-tcp-panel .trif-box-tcp-k.trif-box-tcp-bk { background: #f1f4f5; }
    #trif-box-tcp-panel .trif-box-tcp-k.trif-box-tcp-c { box-shadow: inset 0 -1px 0 #dbe2e6; }
    #trif-box-tcp-panel .trif-box-tcp-drums .trif-box-tcp-k { height: ${DH}px; }
    #trif-box-tcp-panel .trif-box-tcp-gut { position: absolute; left: 0; top: 0; bottom: 0; width: ${GUT}px; background: #f7f9f9; border-right: 1px solid #dbe2e6; cursor: pointer; }
    #trif-box-tcp-panel .trif-box-tcp-kl { position: absolute; left: 4px; font: 600 8px/${RH}px ui-monospace, Menlo, monospace; color: #8b98a5; }
    #trif-box-tcp-panel .trif-box-tcp-dl { position: absolute; left: 4px; font: 600 9px/${DH}px ui-monospace, Menlo, monospace; color: #536471; white-space: nowrap; }
    #trif-box-tcp-panel .trif-box-tcp-dl[data-trif-box-sel] { color: var(--c); font-weight: 800; }
    #trif-box-tcp-panel .trif-box-tcp-col { position: absolute; top: 0; bottom: 0; width: 1px; background: #edf0f2; }
    #trif-box-tcp-panel .trif-box-tcp-col.trif-box-tcp-beat { background: #d0d9de; }
    #trif-box-tcp-panel .trif-box-tcp-col.trif-box-tcp-barl { width: 2px; margin-left: -1px; background: #8b98a5; }
    #trif-box-tcp-panel .trif-box-tcp-layer { position: absolute; inset: 0; pointer-events: none; }
    #trif-box-tcp-panel .trif-box-tcp-n { position: absolute; background: var(--c); border-radius: 1px; box-shadow: inset 0 -2px 0 rgb(0 0 0 / .2), inset 2px 0 0 rgb(255 255 255 / .45); }
    #trif-box-tcp-panel .trif-box-tcp-cur { position: absolute; top: 0; bottom: 0; background: rgb(29 155 240 / .08); border-left: 2px solid #1d9bf0; pointer-events: none; display: none; }
    #trif-box-tcp-panel .trif-box-tcp-lane[data-trif-box-sel] .trif-box-tcp-cur { display: block; }
    #trif-box-tcp-panel .trif-box-tcp-ph { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #0f1419; opacity: .6; pointer-events: none; display: none; }
    #trif-box-tcp-panel .trif-box-tcp-meter { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #eff3f4; }
    #trif-box-tcp-panel .trif-box-tcp-mhead { display: flex; align-items: baseline; gap: 8px; margin: 0 0 5px; }
    #trif-box-tcp-panel .trif-box-tcp-mtext { font-size: 12px; color: #536471; }
    #trif-box-tcp-panel .trif-box-tcp-mtext b { color: #0f1419; }
    #trif-box-tcp-panel .trif-box-tcp-mbar { position: relative; height: 12px; border-radius: 2px; background: #eff3f4; }
    #trif-box-tcp-panel .trif-box-tcp-mfill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background-color: var(--m, #2f9e44);
      background-image: repeating-linear-gradient(90deg, transparent 0 6px, rgb(255 255 255 / .85) 6px 8px); min-width: 2px; }
    #trif-box-tcp-panel .trif-box-tcp-mmark { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #8b98a5; }
    #trif-box-tcp-panel .trif-box-tcp-mscale { position: relative; height: 14px; margin-top: 3px; font: 600 10px/14px ui-monospace, Menlo, monospace; color: #536471; }
    #trif-box-tcp-panel .trif-box-tcp-mscale span { position: absolute; top: 0; white-space: nowrap; }
    #trif-box-tcp-panel .trif-box-tcp-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    #trif-box-tcp-panel .trif-box-tcp-status { flex: 1; margin-left: 4px; font-size: 12px; color: #536471; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #trif-box-tcp-panel .trif-box-tcp-how { display: block; margin: 8px 2px 12px; font-size: 12px; line-height: 1.5; color: #536471; }
    #trif-box-tcp-panel .trif-box-tcp-keys { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 3px; margin: 2px 0 8px; font-size: 11px; line-height: 1.5; color: #8b98a5; }
    #trif-box-tcp-panel .trif-box-tcp-keys .trif-box-tcp-group { margin-right: 8px; }
    #trif-box-tcp-panel .trif-box-tcp-keys .trif-box-tcp-label { width: auto; }
    #trif-box-tcp-panel .trif-box-tcp-kitrow input[type=range] { flex: 0 0 52px; }
    #trif-box-tcp-panel .trif-box-tcp-keys select { font-size: 11px; padding: 1px 2px; }
    #trif-box-tcp-panel .trif-box-tcp-kbd { font: 600 10px ui-monospace, Menlo, monospace; padding: 0 3px; border: 1px solid #dbe2e6; border-bottom-width: 2px; border-radius: 3px; color: #536471; background: #fff; }
    #trif-box-tcp-open { all: initial; display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 14px; margin: 0 8px 0 0; align-self: center;
      border-radius: 9999px; border: 1px solid rgb(128 128 128 / .5); color: inherit; font: 700 14px TwitterChirp, -apple-system, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    #trif-box-tcp-open:hover { background: rgb(128 128 128 / .12); }
    #trif-box-tcp-open.trif-box-tcp-float { position: fixed; left: 16px; bottom: 16px; z-index: 2147483645; margin: 0; background: #fff; color: #0f1419; border-color: #cfd9de; box-shadow: 0 2px 10px rgb(0 0 0 / .2); }
  `);

  let panel = null;
  const R = {}; // the panel's parts
  const lanes = []; // per lane: its parts

  function buildLane(L) {
    const drums = L.ch === 'noise', pulse = L.ch === 'p1' || L.ch === 'p2';
    const ref = { L, drums, pulse, box: el('div', 'tcp-lane') };
    ref.box.css.setProperty('--c', L.color);
    ref.box.dataset.ch = L.ch;
    const ctl = el('div', 'tcp-ctl'), top = el('div', 'tcp-ltop');
    ref.mute = btn('tcp-mute', 'M', `Mute ${L.name} while you work (not saved)`, () => {
      const on = !ui.muted.has(L.ch);
      if (on) ui.muted.add(L.ch); else ui.muted.delete(L.ch);
      if (engine) engine.mute(L.ch, on);
      render();
    });
    top.append(el('i', 'tcp-dot'), el('span', 'tcp-lname', L.name), ref.mute);
    ctl.append(top);
    const setInst = (fn) => { edit(() => fn(instFor(L.ch))); preview(L.ch, lastPitch(L.ch), 3); };
    const setNoise = (fn) => { edit(() => fn(song.inst.noise)); preview('noise', ui.drum); };
    if (pulse) {
      ref.duty = seg([0, 1, 2, 3].map((d) => [d, ['12', '25', '50', '75'][d], `Duty ${DUTY_NAMES[d]}`]), (d) => setInst((i) => { i.duty = d; }), 'Duty');
      ref.duty.cl.add('tcp-small');
      [ref.vol, ref.volOut] = range(0, 15, (v) => setInst((i) => { i.vol = v; }), `${L.name} volume`);
      ref.decay = select(DECAY_NAMES.map((n, i) => [i, n]), (v) => setInst((i) => { i.decay = +v; }), `${L.name} envelope`);
      ref.decay.title = 'Envelope: how fast each note fades (Hold: it doesn’t)';
      ref.decay.cl.add('tcp-env');
      ref.sweep = select([...SWEEPS.map((s, i) => [i, s[0]]), ['custom', 'Custom']], (v) => {
        if (v !== 'custom') setInst((i) => { const s = SWEEPS[+v][1]; i.sweep = s && { ...s }; });
      }, `${L.name} sweep`);
      ref.sweep.title = 'Sweep: the NES’s automatic pitch slide';
      ctl.append(field('Duty', ref.duty), field('Vol', ref.vol, ref.volOut), field(null, ref.decay, ref.sweep));
    } else if (!drums) {
      ctl.append(el('div', 'tcp-hintc', 'The bass. Like the NES’s triangle, it has one volume: a 16-step wave.'));
    } else {
      ref.kit = select([...KITS.map((k, i) => [i, k[0]]), ['custom', 'Custom']], (v) => {
        if (v !== 'custom') setNoise((nz) => { nz.kit = KITS[+v][1].map((k) => k.slice()); });
      }, 'Drum kit');
      ref.kit.title = 'Kit: every drum’s pitch and noise mode at once';
      [ref.vol, ref.volOut] = range(0, 15, (v) => setNoise((nz) => { nz.vol = v; }), 'Noise volume');
      ref.drumName = el('span', 'tcp-label tcp-dname');
      ref.mode = seg([[0, 'Long', 'Long noise: a hiss'], [1, 'Short', 'Short noise: metallic, nearly a tone']], (m) => setNoise((nz) => { nz.kit[ui.drum][1] = m; }), 'Noise mode');
      ref.mode.cl.add('tcp-small');
      [ref.period, ref.periodOut] = range(0, 15, (v) => setNoise((nz) => { nz.kit[ui.drum][0] = v; }), 'Drum pitch');
      ref.period.title = 'The drum’s noise period: 0 is the highest, 15 the lowest';
      const kitRow = field(null, ref.kit, ref.vol, ref.volOut);
      kitRow.cl.add('tcp-kitrow');
      ctl.append(kitRow, field(ref.drumName, ref.mode), field('Pitch', ref.period, ref.periodOut));
    }
    // the roll
    const scroll = el('div', drums ? 'tcp-scroll tcp-drums' : 'tcp-scroll'), roll = el('div', 'tcp-roll');
    roll.css.height = `${drums ? 8 * DH : P * RH}px`;
    roll.title = drums ? 'Click: a hit · drag: its length · click again or right-click: remove · the names: pick a drum to tune'
      : `Click: a note · drag: its length · click again or right-click: remove${pulse ? ' · Alt-click: its volume' : ''}`;
    const gut = el('div', 'tcp-gut');
    ref.drumLabels = [];
    if (drums) {
      for (let d = 0; d < 8; d++) {
        const k = el('div', d % 2 ? 'tcp-k tcp-bk' : 'tcp-k'), l = el('span', 'tcp-dl', DRUM_SHORT[d]);
        k.css.top = `${(7 - d) * DH}px`; l.css.top = `${(7 - d) * DH}px`;
        roll.append(k); gut.append(l); ref.drumLabels.push(l);
      }
    } else {
      for (let p = 0; p < P; p++) {
        const midi = C.BASE[L.ch] + p, k = el('div', `tcp-k${isBlack(midi) ? ' tcp-bk' : ''}${midi % 12 === 0 ? ' tcp-c' : ''}`);
        k.css.top = `${(P - 1 - p) * RH}px`;
        roll.append(k);
        if (midi % 12 === 0) { const l = el('span', 'tcp-kl', noteName(midi)); l.css.top = `${(P - 1 - p) * RH}px`; gut.append(l); }
      }
    }
    roll.append(gut);
    ref.cols = []; // (the row lines: renderLane, as many as the pattern has rows)
    ref.layer = el('div', 'tcp-layer'); ref.cur = el('div', 'tcp-cur'); ref.ph = el('div', 'tcp-ph');
    roll.append(ref.layer, ref.cur, ref.ph);
    scroll.append(roll);
    // (note lanes: ▲ / ▼ at the right, always there, move the octave (as X and Z do); and a small arrow over
    // each note that's out of the window, at the edge it's past: see placeWindow)
    const win = el('div', 'tcp-win');
    win.append(scroll);
    if (!drums) {
      ref.marks = el('div', 'tcp-marks');
      ref.up = btn('tcp-more tcp-up', '▲', 'Up an octave (X)', () => shiftOctave(L.ch, 1));
      ref.down = btn('tcp-more tcp-down', '▼', 'Down an octave (Z)', () => shiftOctave(L.ch, -1));
      win.append(ref.marks, ref.up, ref.down);
    }
    ref.box.append(ctl, win);
    ref.scroll = scroll; ref.roll = roll;

    const cellAt = (e, loose) => {
      const r = roll.rectOf(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!loose && (x < 0 || y < 0 || x >= r.width || y >= r.height)) return null;
      const col = x < GUT && !loose ? -1 : clamp(Math.floor((x - GUT) / CW), 0, song.rows - 1);
      const key = drums ? 7 - clamp(Math.floor(y / DH), 0, 7) : P - 1 - clamp(Math.floor(y / RH), 0, P - 1);
      return { col, key };
    };
    ref.box.listen('pointerdown', () => { if (ui.lane !== L.ch) { ui.lane = L.ch; render(); } }, true);
    roll.listen('contextmenu', (e) => {
      e.preventDefault();
      const c = cellAt(e);
      if (!c || c.col < 0) return;
      const n = noteAt(curLane(L.ch), c.col, c.key);
      if (n) edit(() => removeNote(curLane(L.ch), n));
    });
    roll.listen('pointerdown', (e) => {
      if (e.button !== 0) return;
      const c = cellAt(e);
      if (!c) return;
      e.preventDefault();
      focusPanel();
      if (c.col < 0) { // the gutter: hear the key (and, for drums, pick the drum to tune)
        if (drums) { ui.drum = c.key; render(); }
        preview(L.ch, c.key);
        return;
      }
      const was = JSON.stringify(song), lane = curLane(L.ch);
      let n = noteAt(lane, c.col, c.key);
      const fresh = !n;
      if (n && e.altKey && pulse) { // a pulse note's own volume: the channel's, then 15, 11, 7, 4
        const inst = instFor(L.ch), steps = [null, ...[15, 11, 7, 4].filter((v) => v !== inst.vol)];
        const nextVol = steps[(steps.indexOf(n.vol ?? null) + 1) % steps.length];
        if (nextVol == null) delete n.vol; else n.vol = nextVol;
        preview(L.ch, n.pitch, n.len);
        commit(was);
        return;
      }
      if (!n) { n = placeNote(lane, c.col, c.key, ui.len, drums); preview(L.ch, c.key, n.len); renderLane(ref); }
      if (drums) ui.drum = c.key;
      let moved = false;
      roll.capture(e.pointerId);
      const move = (ev) => {
        const col = Math.max(n.row, cellAt(ev, true).col);
        if (col !== c.col) moved = true;
        if (moved) { setLen(lane, n, col - n.row + 1, drums); renderLane(ref); }
      };
      const up = () => {
        roll.unlisten('pointermove', move); roll.unlisten('pointerup', up); roll.unlisten('pointercancel', up);
        if (!fresh && !moved) removeNote(lane, n); else ui.cursor = (n.row + n.len) % song.rows;
        commit(was);
      };
      roll.listen('pointermove', move); roll.listen('pointerup', up); roll.listen('pointercancel', up);
    });
    return ref;
  }
  const lastPitch = (ch) => {
    const lane = curLane(ch);
    return lane.length ? lane[lane.length - 1].pitch : clamp(12 * (ui.oct.get(ch) + 1) - C.BASE[ch], 0, P - 1);
  };

  function build() {
    panel = el('div');
    panel.id = 'tcp-panel';
    panel.setA('role', 'dialog');
    panel.setA('aria-label', 'Tune composer');
    // the head (drag it to move the panel)
    const head = el('div', 'tcp-head'), title = el('div', 'tcp-title');
    title.append(pixelNote(), el('span', '', 'Tune composer'), el('span', 'tcp-chip', '2A03'));
    head.append(title, btn('tcp-x', '×', 'Close (Esc)', closePanel));
    head.listen('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = panel.rectOf(), x0 = e.clientX, y0 = e.clientY;
      head.capture(e.pointerId);
      const move = (ev) => setPos(r.left + ev.clientX - x0, r.top + ev.clientY - y0);
      const up = () => {
        head.unlisten('pointermove', move); head.unlisten('pointerup', up);
        store.set(POS, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
      };
      head.listen('pointermove', move); head.listen('pointerup', up);
    });
    // transport
    const bar = el('div', 'tcp-bar');
    R.play = btn('tcp-btn tcp-primary tcp-play', '', 'Play or stop (Space)', togglePlay);
    R.loop = seg([['pattern', 'Pattern', 'Loop the pattern you’re editing'], ['song', 'Song', 'Play the song from the selected place, and loop it']], (v) => { ui.loop = v; render(); }, 'Loop');
    R.tempo = el('input');
    R.tempo.type = 'number'; R.tempo.min = String(C.TEMPO_MIN); R.tempo.max = String(C.TEMPO_MAX);
    R.tempo.setA('aria-label', 'Tempo, beats per minute');
    const setTempo = (v) => edit(() => { song.tempo = clamp(Math.round(v) || song.tempo, C.TEMPO_MIN, C.TEMPO_MAX); });
    R.tempo.listen('change', () => setTempo(+R.tempo.value));
    // (Enter: the sandbox doesn't show a key typed into a field, so the field's own change, which Enter makes,
    // lets it go; and whether it has the focus, for render)
    R.tempo.listen('change', () => R.tempo.blur());
    R.tempo.listen('focus', () => { tempoFocused = true; });
    R.tempo.listen('blur', () => { tempoFocused = false; });
    R.rpb = select(C.RPB.map((v) => [v, `${v} rows`]), (v) => edit(() => { song.rpb = +v; }), 'Rows per beat');
    R.rpb.title = 'Rows per beat (4: each row is a 16th note)';
    // the time signature, and how many bars a pattern is (both resize every pattern, as one Undo step)
    R.meter = select(METERS.map(([b, u]) => [`${b}/${u}`, `${b}/${u}`]), (v) => { const [b, u] = v.split('/').map(Number); setMeter(b, u, barsNow() || 1); }, 'Time signature');
    R.meter.title = 'Time signature. Some need fewer rows per beat (a pattern holds 32 rows at most)';
    R.bars = seg([[1, '1', '1 bar per pattern'], [2, '2', '2 bars per pattern']], (n) => setMeter(song.beats, song.unit, n), 'Bars per pattern');
    R.bars.cl.add('tcp-small');
    R.bars.title = 'Bars per pattern';
    R.len = select(LENGTHS.map((v) => [v, `${v} row${v > 1 ? 's' : ''}`]), (v) => { ui.len = +v; render(); }, 'Note length');
    R.len.title = 'Length of new notes (keys 1–8, 9 = 12, 0 = 16)';
    bar.append(R.play, field('Loop', R.loop),
      field('Tempo', btn('tcp-round', '−', 'Slower', () => setTempo(song.tempo - 1)), R.tempo, btn('tcp-round', '+', 'Faster', () => setTempo(song.tempo + 1))),
      field('Time', R.meter), field('Beat', R.rpb), field('Bars', R.bars));
    for (const f of bar.all('.trif-box-tcp-field')) f.cl.add('tcp-group');
    // patterns and the song's order
    const rows = el('div', 'tcp-rows');
    R.tabs = el('div', 'tcp-tabs');
    R.add = btn('tcp-btn tcp-act', '+ New', 'A new, empty pattern, added to the end of the song', () => edit(() => {
      song.patterns.push({}); ui.pat = song.patterns.length - 1;
      if (song.order.length < C.MAX_ORDER) song.order.push(ui.pat);
    }));
    R.copy = btn('tcp-btn tcp-act', 'Copy', 'A copy of this pattern, added to the end of the song', () => edit(() => {
      song.patterns.push(JSON.parse(JSON.stringify(song.patterns[ui.pat]))); ui.pat = song.patterns.length - 1;
      if (song.order.length < C.MAX_ORDER) song.order.push(ui.pat);
    }));
    R.del = btn('tcp-btn tcp-act', 'Delete', 'Delete this pattern (and its places in the song)', () => edit(() => {
      const i = ui.pat;
      song.patterns.splice(i, 1);
      song.order = song.order.filter((o) => o !== i).map((o) => (o > i ? o - 1 : o));
      if (!song.order.length) song.order = [0];
      ui.pat = Math.max(0, i - 1); ui.from = 0;
    }));
    R.order = el('div', 'tcp-order');
    R.place = btn('tcp-btn tcp-act', '+', 'Add the pattern you’re editing to the end of the song', () => edit(() => { song.order.push(ui.pat); ui.from = song.order.length - 1; }));
    rows.append(el('span', 'tcp-label', 'Patterns'), R.tabs, el('span', 'tcp-label', 'Song'), R.order);
    // lanes
    const lanesBox = el('div');
    for (const L of LANES) { const ref = buildLane(L); lanes.push(ref); lanesBox.append(ref.box); }
    // the space meter
    const meter = el('div', 'tcp-meter'), mhead = el('div', 'tcp-mhead'), mbar = el('div', 'tcp-mbar'), scale = el('div', 'tcp-mscale');
    R.mtext = el('span', 'tcp-mtext'); R.mfill = el('div', 'tcp-mfill');
    // (a tick where each corner fills)
    const ticks = [1, 2].map((k) => { const t = el('div', 'tcp-mmark'); t.css.left = `${(100 * k) / TUNE_ROOM.CORNERS}%`; return t; });
    mbar.title = `The tune’s size, against what a picture’s ${TUNE_ROOM.CORNERS} song corners hold: ${TUNE_ROOM.CORNER_BYTES} bytes each, ${TUNE_ROOM.BYTES} in all`;
    mbar.append(R.mfill, ...ticks);
    const s0 = el('span', '', '0'), s2 = el('span', '', `${fmt(TUNE_ROOM.BYTES)} B · ${TUNE_ROOM.CORNERS} corners`);
    s0.css.left = '0'; s2.css.right = '0';
    scale.append(s0, s2);
    mhead.append(el('span', 'tcp-label', 'Space'), R.mtext);
    meter.append(mhead, mbar, scale);
    // save, undo, clear
    const foot = el('div', 'tcp-foot');
    R.save = btn('tcp-btn tcp-primary', 'Save', 'Keep this tune in this browser', save);
    R.undo = btn('tcp-btn', 'Undo', 'Undo (Ctrl/⌘+Z)', doUndo);
    R.clear = btn('tcp-btn', 'Clear', 'Start over: one empty pattern (Undo brings it back)', () => edit(() => { song = C.blank(song); ui.pat = 0; ui.from = 0; ui.cursor = 0; }));
    R.status = el('span', 'tcp-status');
    R.fromPic = btn('tcp-btn', 'From picture', 'Load the tune from the profile picture of the profile you have open (Undo brings yours back)', loadFromPicture);
    foot.append(R.save, R.undo, R.clear, R.fromPic, R.status);
    // how a tune gets into a profile picture (Style Encoder stamps the saved tune; Profile Styler plays it)
    R.how = el('p', 'tcp-how', 'Compose a tune, then use Style Encoder to put it in your profile. Anyone with Profile Styler can hear it!');
    R.keys = el('div', 'tcp-keys');
    R.lenBox = field('New notes', R.len);
    R.lenBox.cl.add('tcp-group');
    // (R.how isn't put in the panel: in the free version el('p') made a <style> (its make() had no 'p'), so the
    // note never showed, and the boxed one leaves it out to match. Showing it: R.how after head, below.)
    panel.append(head, R.keys, bar, rows, lanesBox, meter, foot); // (the key hints along the top)
  }

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
  // the tune in the picture of the profile that's open (the header's picture, at 400 px): as Profile Styler
  // reads it (PicCode's song corners, then TuneCodec)
  const SONG_CORNERS = ['bottom-right', 'top-left', 'top-right'];
  // (boxed: the page's own picture, a stand-in, is what image-variants asks the 400×400 copy for)
  const openProfilePicture = () => {
    const handle = /^\/(\w{1,15})(?:\/|$)/.exec(new URL(page.url).pathname)?.[1];
    if (!handle) return null;
    for (const a of page.findAll('[data-testid=primaryColumn] a[href$="/photo"]')) {
      if ((a.attr('href') || '').toLowerCase() !== `/${handle.toLowerCase()}/photo`) continue;
      const img = a.find('img[src*="/profile_images/"]');
      const src = img && img.attr('src');
      if (src) return { handle, img, url: src.replace(/_(normal|bigger|mini|x96|200x200|400x400)(\.\w+)(\?.*)?$/, '_400x400$2') };
    }
    return { handle, url: null };
  };
  // (the picture again at 400×400 through image-variants, its pixels read where X's image server allows it; its
  // natural size measured by putting it on the page for a moment, unseen)
  const songInPicture = (pageImg) => new Promise((resolve, reject) => {
    let img;
    try { img = trif.imageVariant(pageImg, { pixels: true }); } catch (e) { reject(e); return; }
    img.on('load', () => {
      try {
        for (const [k, v] of [['position', 'absolute'], ['visibility', 'hidden'], ['left', '-10000px'], ['top', '0'], ['width', 'auto'], ['height', 'auto'], ['max-width', 'none'], ['max-height', 'none']]) img.style(k, v);
        page.root.append(img);
        const W = img.offsetWidth, H = img.offsetHeight;
        img.remove();
        const c = page.create('canvas');
        c.setAttr('width', String(W)); c.setAttr('height', String(H));
        const g = c.canvas();
        g.drawImage(img, 0, 0);
        const first = PicCode.decode(SONG_CORNERS[0], greyReader(g, W, H, SONG_CORNERS[0]));
        if (!first) { resolve(null); return; }
        const rest = SONG_CORNERS.slice(1, first.parts).map((k) => PicCode.decode(k, greyReader(g, W, H, k)));
        const got = PicCode.gather([first, ...rest], PicCode.KIND.song);
        resolve(got ? Uint8Array.from(got.payload) : null);
      } catch (e) { reject(e); }
    });
    img.on('error', () => reject(new Error('the picture could not be loaded')));
  });
  async function loadFromPicture() {
    const p = openProfilePicture();
    if (!p) { ui.status = 'Open a profile first: its picture’s tune loads here.'; render(); return; }
    if (!p.url) { ui.status = `No profile picture found for @${p.handle} on this page.`; render(); return; }
    let bytes;
    try { bytes = await songInPicture(p.img); } catch (e) { ui.status = `Couldn’t read @${p.handle}’s picture: ${e.message}`; render(); return; }
    if (!bytes) { ui.status = `@${p.handle}’s picture has no tune in it.`; render(); return; }
    let got;
    try { got = C.decode(bytes); } catch (e) { ui.status = `@${p.handle}’s tune couldn’t be read: ${e.message}`; render(); return; }
    edit(() => { song = got; ui.pat = 0; ui.from = 0; ui.cursor = 0; });
    ui.status = `Loaded @${p.handle}’s tune (${bytes.length} bytes). Undo brings yours back.`;
    render();
  }

  const kbd = (t) => el('kbd', 'tcp-kbd', t);
  function renderLane(ref) {
    const ch = ref.L.ch, lane = curLane(ch), inst = instFor(ch);
    ref.layer.txt = '';
    for (const n of lane) {
      const d = el('div', 'tcp-n');
      d.css.left = `${GUT + n.row * CW + 1}px`;
      d.css.width = `${n.len * CW - 2}px`;
      if (ref.drums) { d.css.top = `${(7 - n.drum) * DH + 2}px`; d.css.height = `${DH - 4}px`; }
      else {
        d.css.top = `${(P - 1 - n.pitch) * RH}px`; d.css.height = `${RH - 1}px`;
        if (inst) d.css.opacity = String(0.35 + (0.65 * (n.vol ?? inst.vol)) / 15);
      }
      ref.layer.append(d);
    }
    // the row lines: a bar line at each bar, a lighter one on each beat
    ref.roll.css.width = `${GUT + song.rows * CW}px`;
    while (ref.cols.length < song.rows) { const col = el('div', 'tcp-col'); ref.layer.before(col); ref.cols.push(col); }
    while (ref.cols.length > song.rows) ref.cols.pop().remove();
    const bar = song.beats * song.rpb;
    ref.cols.forEach((c, i) => { c.css.left = `${GUT + i * CW}px`; c.cl.toggle('tcp-barl', i % bar === 0); c.cl.toggle('tcp-beat', i % bar !== 0 && i % song.rpb === 0); });
    ref.cur.css.left = `${GUT + ui.cursor * CW}px`;
    ref.cur.css.width = `${CW}px`;
    ref.box.toggleAttribute('data-sel', ui.lane === ch);
    ref.box.toggleAttribute('data-muted', ui.muted.has(ch));
    ref.mute.setA('aria-pressed', String(ui.muted.has(ch)));
  }
  let dragFrom = -1, tempoFocused = false;
  function render() {
    if (!panel) return;
    R.play.txt = playing() ? '■ Stop' : '▶ Play';
    R.loop.set(ui.loop);
    if (!tempoFocused) R.tempo.value = String(song.tempo);
    R.rpb.value = String(song.rpb);
    R.len.value = String(ui.len);
    // the time signature (one from elsewhere that isn't on the list gets its own entry), what fits, the bars
    const meter = `${song.beats}/${song.unit}`;
    if (!R.meter.all('option').some((o) => o.value === meter)) { const o = el('option', '', meter); o.value = meter; R.meter.append(o); }
    // (a meter that doesn't fit at these rows per beat can't be greyed out in the list: a mod can't disable an option; picking it says why, as setMeter does)
    R.meter.value = meter;
    R.bars.set(barsNow());
    R.bars.all('button')[1].disabled = !fits(song.beats, 2);
    ui.cursor = Math.min(ui.cursor, song.rows - 1);
    // the grid's columns, and the panel as wide as its lanes need
    CW = colWidth(song.rows);
    panel.css.width = `${PANEL_W + Math.max(0, song.rows * CW - 16 * 22)}px`;
    if (panel.css.left && panel.isConnected && panel.rectOf().right > page.width - 8) setPos(panel.offsetLeft, panel.offsetTop);
    // pattern tabs
    R.tabs.txt = '';
    song.patterns.forEach((_, i) => {
      const b = btn('tcp-tab', label(i), `Edit pattern ${label(i)}`, () => { ui.pat = i; render(); });
      b.setA('aria-pressed', String(i === ui.pat));
      R.tabs.append(b);
    });
    R.add.disabled = R.copy.disabled = song.patterns.length >= C.MAX_PATTERNS;
    R.del.disabled = song.patterns.length <= 1;
    R.tabs.append(R.add, R.copy, R.del);
    // the order strip (drag a chip to move it, right-click to remove it)
    R.order.txt = '';
    R.chips = song.order.map((pi, i) => {
      const b = btn('tcp-o', label(pi), `Bar ${i + 1}: pattern ${label(pi)}. Click to edit it and play from here, drag to move, right-click to remove`, () => { ui.from = i; ui.pat = pi; render(); });
      b.draggable = true;
      b.toggleAttribute('data-sel', i === ui.from);
      b.toggleAttribute('data-cur', pi === ui.pat);
      const removeBar = () => { if (song.order.length > 1) edit(() => { song.order.splice(i, 1); ui.from = Math.min(ui.from, song.order.length - 1); }); };
      b.listen('contextmenu', (e) => { e.preventDefault(); removeBar(); });
      // (and a ✕ on the chip, showing on hover: takes this bar out of the song; the pattern itself stays.
      // Not on the last bar left: a song needs one)
      if (song.order.length > 1) {
        const x = el('span', 'tcp-o-x', '×');
        x.title = 'Take this bar out of the song (the pattern stays)';
        x.listen('click', (e) => { e.stopPropagation(); e.preventDefault(); removeBar(); });
        x.listen('pointerdown', (e) => e.stopPropagation());
        b.append(x);
      }
      b.listen('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', label(pi)); });
      b.listen('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); b.cl.add('tcp-over'); } });
      b.listen('dragleave', () => b.cl.remove('tcp-over'));
      b.listen('drop', (e) => {
        e.preventDefault();
        const from = dragFrom;
        dragFrom = -1;
        if (from < 0 || from === i) { render(); return; }
        edit(() => { const [x] = song.order.splice(from, 1); song.order.splice(from < i ? i - 1 : i, 0, x); ui.from = from < i ? i - 1 : i; });
      });
      b.listen('dragend', () => { dragFrom = -1; });
      R.order.append(b);
      return b;
    });
    R.place.txt = `+ ${label(ui.pat)}`;
    R.place.disabled = song.order.length >= C.MAX_ORDER;
    R.order.append(R.place);
    // lanes and their settings
    for (const ref of lanes) {
      renderLane(ref);
      placeWindow(ref);
      const ch = ref.L.ch;
      if (ref.pulse) {
        const i = instFor(ch);
        ref.duty.set(i.duty);
        ref.vol.value = String(i.vol); ref.volOut.txt = String(i.vol);
        ref.decay.value = String(i.decay);
        const sw = SWEEPS.findIndex((s) => JSON.stringify(s[1]) === JSON.stringify(i.sweep));
        ref.sweep.value = sw >= 0 ? String(sw) : 'custom';
      } else if (ref.drums) {
        const nz = song.inst.noise, k = nz.kit[ui.drum];
        const kit = KITS.findIndex((x) => JSON.stringify(x[1]) === JSON.stringify(nz.kit));
        ref.kit.value = kit >= 0 ? String(kit) : 'custom';
        ref.vol.value = String(nz.vol); ref.volOut.txt = String(nz.vol);
        ref.drumName.txt = C.DRUM_NAMES[ui.drum];
        ref.mode.set(k[1]);
        ref.period.value = String(k[0]); ref.periodOut.txt = String(k[0]);
        ref.drumLabels.forEach((l, d) => l.toggleAttribute('data-sel', d === ui.drum));
      }
    }
    // the meter: bytes, against the room in the picture's song corners (a tick where each one fills)
    let bytes = null;
    try { bytes = C.encode(song); } catch (e) { ui.status = e.message; }
    const n = bytes ? bytes.length : 0, room = TUNE_ROOM.BYTES, k = TUNE_ROOM.corners(n);
    R.mfill.css.width = `${Math.min(100, (100 * n) / room)}%`;
    R.mfill.css.setProperty('--m', n <= room ? '#2f9e44' : '#e0453a');
    R.mtext.txt = '';
    R.mtext.append(el('b', '', `${n} bytes`), n <= room ? ` · uses ${k} of ${TUNE_ROOM.CORNERS} corners · ${fmt(room - n)} to spare` : ` · ${fmt(n - room)} too many for a picture`);
    // footer
    const now = bytes && C.toBase64(bytes);
    R.undo.disabled = !undo.length;
    R.status.txt = ui.status || (!saved ? 'The demo tune. Save keeps your own.' : now === saved ? 'Saved.' : 'Not saved yet.');
    R.keys.txt = '';
    R.keys.append(R.lenBox);
    if (ui.lane === 'noise') R.keys.append('Keys: ', kbd('A'), '–', kbd('K'), ' drums');
    else R.keys.append('Keys: ', kbd('A'), kbd('W'), kbd('S'), kbd('E'), kbd('D'), '… piano from ', el('b', '', `C${ui.oct.get(ui.lane)}`), ' · ', kbd('Z'), kbd('X'), ' octave');
    R.keys.append(' · ', kbd('1'), '–', kbd('8'), ' length · ', kbd('←'), kbd('→'), ' cursor · ', kbd('↑'), kbd('↓'), ' lane · ', kbd('⌫'), ' delete · ', kbd('Space'), ' play · ', kbd('Esc'), ' close');
  }
  // the playhead, while playing
  function frame() {
    if (!panel || !playing()) { for (const ref of lanes) ref.ph.css.display = 'none'; if (R.chips) for (const c of R.chips) c.removeA('data-playing'); return; }
    const pos = player.position();
    for (const ref of lanes) {
      const show = !!pos && pos.pi === ui.pat;
      ref.ph.css.display = show ? 'block' : 'none';
      if (show) ref.ph.css.left = `${GUT + (pos.row + clamp((actx.now - pos.t) / pos.rd, 0, 1)) * CW}px`;
    }
    if (R.chips) R.chips.forEach((c, i) => c.toggleAttribute('data-playing', !!pos && pos.o === i));
    requestAnimationFrame(frame);
  }

  function save() {
    let bytes;
    try { bytes = C.encode(song); } catch (e) { ui.status = e.message; render(); return; }
    const text = C.toBase64(bytes);
    if (store.set(STORE, text)) { saved = text; ui.status = `Saved: ${bytes.length} bytes.`; } else ui.status = 'Couldn’t save: this browser’s storage is full or blocked.';
    render();
  }
  // Every change is kept as you go (a moment after it, and when the page goes away), so a reload or a closed
  // tab never loses work. (It used to keep only what Save kept: a reload lost everything since, 2026-11-10.)
  let autoT = 0;
  function flushSave() {
    if (!autoT) return; // (nothing changed: the demo isn't your tune until you touch it, and Style Encoder stamps what's kept)
    clearTimeout(autoT); autoT = 0;
    try {
      const text = C.toBase64(C.encode(song));
      if (text !== saved && store.set(STORE, text)) { saved = text; if (panel?.isConnected) render(); }
    } catch {} // (a song that can't be encoded yet: kept at the last good one)
  }
  function autosave() { clearTimeout(autoT); autoT = setTimeout(flushSave, 300); }
  page.on('pagehide', flushSave);
  page.on('visibilitychange', () => { if (page.visibilityState === 'hidden') flushSave(); });
  const setPos = (left, top) => {
    panel.css.left = `${Math.round(clamp(left, 8, Math.max(8, page.width - panel.offsetWidth - 8)))}px`;
    panel.css.top = `${Math.round(clamp(top, 8, Math.max(8, page.height - 80)))}px`;
    panel.css.right = 'auto';
    fitHeight();
  };
  // (never past the window's bottom: the panel scrolls instead)
  const fitHeight = () => { if (panel) panel.css.maxHeight = `${Math.max(160, page.height - panel.rectOf().top - 8)}px`; };
  page.on('resize', () => { if (ui.open) { const r = panel.rectOf(); if (panel.css.left) setPos(r.left, r.top); else fitHeight(); } });
  // A note lane's window: the piano's reach in its octave (C up to the E above the next C, the keys A … ;),
  // fixed there. Each note of the pattern on show that's above or below it gets a small ▲ or ▼ at that edge,
  // centred on the note's very start (its left edge); the octave buttons dim at the ends of the lane's range.
  const winLow = (ch) => clamp(12 * (ui.oct.get(ch) + 1) - C.BASE[ch], 0, Math.max(0, P - WIN));
  function placeWindow(ref) {
    if (ref.drums) return;
    const ch = ref.L.ch, low = winLow(ch), high = low + WIN - 1;
    ref.roll.css.marginTop = `${-(P - 1 - high) * RH}px`; // (the sandbox only reads an element's scroll: the roll moves up instead)
    ref.marks.txt = '';
    for (const n of curLane(ch)) {
      if (n.pitch >= low && n.pitch <= high) continue;
      const up = n.pitch > high, m = el('div', up ? 'tcp-mark tcp-mup' : 'tcp-mark tcp-mdown', up ? '▲' : '▼');
      m.css.left = `${GUT + n.row * CW + 1 - 4.5}px`; m.css.width = '9px'; // (its point right on the note's very start, its left edge)
      m.title = `${noteName(C.BASE[ch] + n.pitch)}, ${up ? 'above' : 'below'}`;
      ref.marks.append(m);
    }
    ref.up.disabled = ui.oct.get(ch) >= OCT[ch][1];
    ref.down.disabled = ui.oct.get(ch) <= OCT[ch][0];
  }
  function shiftOctave(ch, by) {
    ui.oct.set(ch, clamp(ui.oct.get(ch) + by, OCT[ch][0], OCT[ch][1]));
    render();
  }
  // each lane opens on the octave its notes are mostly in
  const centre = () => {
    for (const ref of lanes) {
      if (ref.drums) continue;
      const ch = ref.L.ch, ps = song.patterns.flatMap((p) => C.laneOf(p, ch).map((n) => n.pitch)).sort((a, b) => a - b);
      if (ps.length) ui.oct.set(ch, clamp(Math.floor((C.BASE[ch] + ps[ps.length >> 1]) / 12) - 1, OCT[ch][0], OCT[ch][1]));
      placeWindow(ref);
    }
  };
  function openPanel() {
    if (!panel) build();
    ui.open = true;
    ROOT.append(panel);
    render();
    // (a panel taken out of the page forgets its scroll positions: put back where each lane was)
    if (!ui.centred) { ui.centred = true; centre(); } else lanes.forEach(placeWindow);
    try { const pos = JSON.parse(store.get(POS) || 'null'); if (pos) setPos(pos.left, pos.top); } catch { /* none */ }
    fitHeight();
    focusPanel();
  }
  function closePanel() {
    if (player && player.playing) player.stop();
    ui.open = false;
    if (panel) panel.remove();
  }

  // --- keys: while the panel is open, and never while you're typing in a field (X's or the panel's) ---
  const typing = (e) => {
    if (e.code == null) return true; // (TRIF hides the key: it was typed into a field or an editor)
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!t) return false;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') return !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(t.type || 'text');
    return !!(t.closest && t.closest('[role=textbox],[contenteditable=""],[contenteditable=true]'));
  };
  function key(e) {
    const code = e.code, t = e.composedPath ? e.composedPath()[0] : e.target;
    if (e.repeat) return PIANO.has(code) || code === 'Space' || code === 'Backspace';
    if (code === 'Space') { togglePlay(); return true; }
    if (code === 'Escape') { closePanel(); return true; }
    if (code.startsWith('Arrow') && t && t.tagName === 'INPUT') return false; // (a slider's own keys)
    if (code === 'ArrowLeft' || code === 'ArrowRight') { ui.cursor = (ui.cursor + (code === 'ArrowLeft' ? song.rows - 1 : 1)) % song.rows; render(); return true; }
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const i = LANES.findIndex((l) => l.ch === ui.lane);
      ui.lane = LANES[(i + (code === 'ArrowUp' ? 3 : 1)) % 4].ch;
      render();
      return true;
    }
    if (/^Digit\d$/.test(code)) { const d = +code.slice(5); ui.len = d === 0 ? 16 : d === 9 ? 12 : d; render(); return true; }
    if (code === 'Backspace' || code === 'Delete') { erase(); return true; }
    const drums = ui.lane === 'noise';
    if (code === 'KeyZ' || code === 'KeyX') {
      if (!drums) shiftOctave(ui.lane, code === 'KeyZ' ? -1 : 1);
      return true;
    }
    const k = drums ? PADS.get(code) : PIANO.get(code);
    if (k == null) return false;
    const pitch = drums ? k : 12 * (ui.oct.get(ui.lane) + 1) + k - C.BASE[ui.lane];
    if (pitch >= 0 && pitch < P) enter(pitch);
    return true;
  }
  const taken = new Set();
  let tookKeyUp = -1e9; // (when the last taken key came up: see btn)
  // (the panel's keys go to one of its own buttons: TRIF can tell a key there wasn't typed into anything)
  const focusPanel = () => { try { if (R.play && R.play.isConnected) R.play.focusIt(); } catch { /* not now */ } };
  trif.block('keydown', (ev) => {
    const e = evOf(ev);
    if (typing(e)) return false;
    let took = true;
    if (e.code === 'KeyT' && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) { if (ui.open) closePanel(); else openPanel(); }
    else if (!ui.open) took = false;
    else if (e.metaKey || e.ctrlKey) { if (e.code === 'KeyZ' && !e.shiftKey) doUndo(); else took = false; }
    else if (e.altKey) took = false;
    else took = key(e);
    // (kept from X, and its default (a page scroll on Space or an arrow) stopped too, as the free version did)
    if (took) { taken.add(e.code); e.preventDefault(); }
    return took;
  });
  const swallow = (ev) => {
    if (!taken.has(ev.code)) return false;
    if (ev.type === 'keyup') { taken.delete(ev.code); tookKeyUp = performance.now(); }
    ev.preventDefault();
    return true;
  };
  trif.block('keypress', swallow);
  trif.block('keyup', swallow);

  // --- the button in Edit profile (x.com/settings/profile): beside Save, or in the corner if Save isn't found ---
  const opener = btn('', '♪ Tune', 'Compose a tune (Alt+Shift+T anywhere on X)', () => { if (ui.open) closePanel(); else openPanel(); });
  opener.id = 'tcp-open';
  const tick = () => {
    if (!new URL(page.url).pathname.startsWith('/settings/profile')) { opener.remove(); return; }
    const saveBtn = E.of(page.find('[data-testid=Profile_Save_Button]'));
    let placed = false;
    if (saveBtn) {
      try {
        if (saveBtn.prev !== opener) saveBtn.before(opener);
        opener.cl.remove('tcp-float');
        placed = true;
      } catch (e) { /* (inside a form, where a mod's button can't go: in the corner instead) */ }
    }
    if (placed) { /* beside Save */ } else if (!opener.cl.contains('tcp-float') || !opener.isConnected) {
      opener.cl.add('tcp-float');
      ROOT.append(opener);
    }
  };
  setInterval(tick, 800);
  tick();

  // --- and a little round ♪ in the bottom-right corner, on every X page: opens and closes the composer.
  // (Alt+Shift+T is taken by some browsers.) Right in the corner.
  const corner = btn('', '♪', 'Tune Composer', () => { if (ui.open) closePanel(); else openPanel(); });
  corner.id = 'tcp-corner';
  corner.setA('aria-label', 'Tune Composer');
  trif.css(`
    #trif-box-tcp-corner { all: initial; position: fixed; right: 10px; bottom: 10px; z-index: 2147483646; width: 40px; height: 40px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer;
      background: rgb(15 20 25 / .75); border: 1px solid rgb(255 255 255 / .35); color: #fff;
      font: 700 20px/1 -apple-system, system-ui, sans-serif; box-shadow: 0 2px 8px rgb(0 0 0 / .3); }
    #trif-box-tcp-corner:hover { background: rgb(15 20 25 / .9); border-color: rgb(255 255 255 / .6); }  `);
  ROOT.append(corner);
