// ==WebMod==
// @name        Tune Composer
// @description A little NES-style music maker, for tunes small enough to hide in a profile picture
// @match       https://x.com/*
// @run-at      document-idle
// @risk        0 render-only: its own panel, and sounds made on the spot with Web Audio; keeps your tune in this browser; sends nothing
// @source      trif
// @version     1
// ==/WebMod==

// Tim's. A four-channel composer modelled on the NES sound chip (the 2A03, without its sample channel), for
// tunes that will later ride in the hidden corners of a profile picture, the way Style Encoder stamps a style
// into the bottom-left one (style-encoder.js, profile-styler.js). This pass is the composer and its sound; the
// picture side isn't wired up yet.
//
// Open it: "♪ Tune" beside Save in Edit profile (x.com/settings/profile), or Alt+Shift+T anywhere on X.
// - Four lanes: Pulse 1, Pulse 2 (12.5/25/50/75% duty, 16 volumes, decay envelope, pitch sweep), Triangle
//   (bass: the NES's 16-step triangle, no volume) and Noise (8 drums from the NES's noise generator).
// - Each lane is a small piano roll over a 16-row pattern (16ths by default). Click to place a note, drag to set
//   its length, click it again or right-click to remove it, Alt-click a pulse note to change its volume.
//   One note at a time per channel, as on the chip.
// - Patterns (A–Z, then AA…, up to 64), arranged into a song in the order strip (drag to move, right-click to remove).
// - The space meter shows the tune's size in bytes against the room in a picture's three song corners,
//   440 bytes each, 1,320 in all (TUNE_ROOM), and how many corners it takes.
// - Save keeps the encoded bytes in this browser (localStorage), so what the meter shows is what's saved.
// - Keys, while the panel is open and you're not typing in a text field: A W S E D F T G Y H U J K O L P ;
//   play and enter notes at the cursor (A S D F G H J K on the Noise lane: the 8 drums), Z/X octave,
//   1–8 (9 = 12, 0 = 16) note length, arrows move the cursor and change lanes, Backspace deletes, Space plays
//   and stops, Ctrl/⌘+Z undoes, Esc closes. Those keys don't reach X while the panel has them.
//
// Written so it can become a boxed mod later, with the sound and controls powers (and keys, if that becomes
// a power): no network, nothing of the page's own (no page globals, X's DOM only for the one button), only
// localStorage and Web Audio.
//
// The format (TuneCodec below, where it's described in full): version 3 bits · length 13 bits · payload · CRC-8.
// The payload describes the song by its structure: intervals from the last note (in steps of the song's key when
// that's shorter), lengths as "the same again" or written out, lanes taken from earlier patterns or other
// channels and moved, and repeats of earlier events in a lane. Those symbols then go through a small adaptive
// binary range coder (integer maths only, so every browser reads it the same). Up to 64 patterns, 256 bars.
// A blank song is 11 bytes; the demo tune (TUNE_DEMO) is 117. Measured: tests/dev/measure-tunes.js.

(() => {
  if (window.top !== window) return;
  if (document.documentElement.hasAttribute('data-tcp')) return; // (loaded twice)
  document.documentElement.setAttribute('data-tcp', '');

  /* tune-codec:begin */
  // The song model and its bytes. Self-contained (no DOM, no audio), to be shared with Style Encoder and
  // Profile Styler when tunes go into pictures. A song:
  //   { v, tempo, rpb, inst: { p1, p2, noise }, patterns: [{ p1, p2, tri, noise }], order: [pattern index] }
  //   pulse instrument { duty 0–3, vol 0–15, decay 0–7, sweep: null | { neg, period 0–7, shift 1–7 } }
  //   noise instrument { vol 0–15, kit: 8 × [period 0–15, mode 0 long | 1 short] }
  //   a note { row 0–15, len 1–16, pitch 0–61 } (pulse notes may also carry vol, decay, duty of their own)
  //   a hit  { row 0–15, len 1–8, drum 0–7 }
  // Up to 64 patterns of 16 rows, and up to 256 entries in the order.
  //
  // The bytes: version 3 bits · payload length 13 bits · the payload · CRC-8 (polynomial 0x07) of all before it.
  // The payload is a stream of symbols (below), written one of two ways:
  //   version 3: a binary range coder (LZMA's kind, 11-bit odds), each symbol as the bits of a little binary
  //     tree whose odds are kept per symbol kind and context, start from version 2's codes, and move by 1/2, 1/4,
  //     1/4, 1/8 … then 1/16 of the way each time they're used (RATES: fast while there's little to go on)
  //   version 2: plain prefix codes (each kind's short codes, then 1s and the symbol in full)
  // Integer maths only, so every browser reads the same bytes the same way.
  //
  // The symbols. Settings first, in plain bits: tempo 8 (bpm − 32) · rows per beat 2 · key 4 (the tonic 0–11 of
  // a major scale, or 12: none; the encoder tries all 13 and keeps the shortest) · Pulse 1 and 2: duty 2 ·
  // volume 4 · decay 3 · sweep 1 (+ negate 1 · period 3 · shift 3) · Noise: volume 4 · custom kit 1 (+ 8 ×
  // period 4 · mode 1) · patterns − 1: 6 · order length − 1: 8. The order: per entry, `ord` (the next pattern,
  // the same again, or written out in full). Then per pattern and channel, `lane`:
  //   empty · an earlier pattern's lane of this channel (`back` patterns back), moved by `shift` semitones ·
  //   another melodic channel's lane (1 bit which, `back`, `shift`) · or its events, until 16 rows are filled:
  //   a note: the interval from the channel's last note, `iv` in semitones (−61…61) or, in a key, `deg` in steps of
  //     the scale (a note outside it: `deg` SHARP, then the step to the note below it); and `len` (0 = as the
  //     last note, or 1–16)
  //   a hit: `drum` (0–7) and `dlen` (0 = as the last hit, or 1–8)    a rest: `rlen` (0 = as the last, or 1–16)
  //   a repeat: `repD` events back, `repN` events, moved by `shift` semitones (it may overlap itself: a repeat
  //     of the last one, 7 times, is 7 more hats; moved, it climbs, a sequence)
  //   a settings change (pulses, until the pattern ends): `esc` volume 4 / decay 3 / duty 2 bits
  // Contexts (format 3): the event kind after the last one; intervals after the last interval (none, 0, up or down
  // a little, up or down a lot) and per pulse/triangle; lengths after the last length; drums after the last drum.
  const TuneCodec = (() => {
    const VERSION = 3, STATIC = 2, ROWS = 16, PITCHES = 62;
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
    const melodic = (list, inst, what) => {
      const out = (list || []).map((n) => {
        const o = { row: int(n.row, 0, ROWS - 1, `${what} row`), len: int(n.len, 1, ROWS, `${what} length`), pitch: int(n.pitch, 0, PITCHES - 1, `${what} pitch`) };
        if (o.row + o.len > ROWS) fail(`${what}: a note runs past the end of its pattern`);
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
    const drums = (list) => {
      const out = (list || []).map((h) => {
        const o = { row: int(h.row, 0, ROWS - 1, 'drum row'), len: int(h.len, 1, MAX_DRUM_LEN, 'drum length'), drum: int(h.drum, 0, DRUMS - 1, 'drum') };
        if (o.row + o.len > ROWS) fail('Noise: a hit runs past the end of its pattern');
        return o;
      }).sort((a, b) => a.row - b.row);
      for (let i = 1; i < out.length; i++) if (out[i].row < out[i - 1].row + out[i - 1].len) fail('Noise: hits overlap (one drum at a time)');
      return out;
    };
    const laneNorm = (list, ch, inst) => (ch === 'noise' ? drums(list) : melodic(list, instOf(inst, ch), ch === 'p1' ? 'Pulse 1' : ch === 'p2' ? 'Pulse 2' : 'Triangle'));
    function normalize(s) {
      if (!s || typeof s !== 'object') fail('not a song');
      const si = s.inst || {};
      const inst = { p1: pulseInst(si.p1), p2: pulseInst(si.p2), noise: noiseInst(si.noise) };
      if (!Array.isArray(s.patterns) || !s.patterns.length) fail('a song needs at least one pattern');
      if (s.patterns.length > MAX_PATTERNS) fail(`a song has at most ${MAX_PATTERNS} patterns`);
      const patterns = s.patterns.map((p) => {
        p = p || {};
        return { p1: laneNorm(p.p1, 'p1', inst), p2: laneNorm(p.p2, 'p2', inst), tri: laneNorm(p.tri, 'tri', inst), noise: laneNorm(p.noise, 'noise', inst) };
      });
      if (!Array.isArray(s.order) || !s.order.length) fail('the song order is empty');
      if (s.order.length > MAX_ORDER) fail(`the song order has at most ${MAX_ORDER} entries`);
      const rpb = s.rpb ?? 4;
      if (!RPB.includes(rpb)) fail(`rows per beat must be ${RPB.join(', ')}`);
      return { v: VERSION, tempo: int(s.tempo ?? 150, TEMPO_MIN, TEMPO_MAX, 'tempo'), rpb, inst, patterns, order: s.order.map((o) => int(o, 0, patterns.length - 1, 'order entry')) };
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
    };
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
    const acOut = () => {
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
        sym(m, ctx, v) {
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
    const acIn = (bytes) => {
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
    function toEvents(lane, ch, inst) {
      const out = [], pi = instOf(inst, ch);
      let row = 0;
      for (const n of lane) {
        if (n.row > row) out.push({ rest: n.row - row });
        out.push(ch === 'noise' ? { drum: n.drum, len: n.len } : pi ? { pitch: n.pitch, len: n.len, vol: n.vol ?? pi.vol, decay: n.decay ?? pi.decay, duty: n.duty ?? pi.duty } : { pitch: n.pitch, len: n.len });
        row = n.row + n.len;
      }
      if (row < ROWS) out.push({ rest: ROWS - row });
      return out;
    }
    function fromEvents(events, ch, inst) {
      const lane = [];
      let row = 0;
      for (const e of events) {
        if (e.rest) { row += e.rest; continue; }
        lane.push(ch === 'noise' ? { row, len: e.len, drum: e.drum } : { row, len: e.len, pitch: e.pitch, vol: e.vol, decay: e.decay, duty: e.duty });
        row += e.len;
      }
      return laneNorm(lane, ch, inst);
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
    // the longest repeat of earlier events (distance d, count n, moved by t semitones) starting at event k
    function findRepeat(events, k) {
      let best = { n: 0, d: 0, t: 0 };
      for (let d = 1; d <= Math.min(k, 16); d++) {
        let n = 0, t = null;
        while (k + n < events.length && n < 16) {
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
        const rep = findRepeat(events, k);
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
    function readLane(io, ch, st, inst, key) {
      const kind = kindOf(ch), pi = instOf(inst, ch), cur = pi && { vol: pi.vol, decay: pi.decay, duty: pi.duty }, out = [];
      let rows = 0, guard = 0;
      st.row = 0;
      const took = (e) => {
        rows += e.rest || e.len || fail('damaged data');
        if (rows > ROWS) fail('a lane runs past the end of its pattern');
        out.push(e); step(st, e);
        if (cur && e.pitch !== undefined) { cur.vol = e.vol; cur.decay = e.decay; cur.duty = e.duty; }
      };
      while (rows < ROWS) {
        if (++guard > 64) fail('damaged data');
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
      return fromEvents(out, ch, inst);
    }
    // a lane taken from another (moved by t semitones; pulse notes keep the settings they have of their own)
    const copyLane = (lane, from, to, t, inst) => laneNorm(lane.map((n) => (to === 'noise' ? { ...n }
      : to === 'tri' || from === 'tri' ? { row: n.row, len: n.len, pitch: n.pitch + t } : { ...n, pitch: n.pitch + t })), to, inst);
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
        try { if (JSON.stringify(copyLane(src, c.from, ch, t, s.inst)) === key) return { ...c, t }; } catch { /* moved out of range */ }
      }
      return null;
    }

    function writeSong(s, io, key, copies) {
      io.raw(s.tempo - TEMPO_MIN, 8); io.raw(RPB.indexOf(s.rpb), 2); io.raw(key, 4);
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
            writeLane(io, toEvents(lane, ch, s.inst), ch, st, s.inst, key);
            continue;
          }
          for (const e of toEvents(lane, ch, s.inst)) step(st, e);
        }
      });
    }
    function readSong(io) {
      const tempo = io.raw(8) + TEMPO_MIN, rpb = RPB[io.raw(2)], key = io.raw(4);
      if (key > NO_KEY) fail('damaged data');
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
          else if (k === 0) lane = readLane(io, ch, st, inst, key);
          else {
            if (k === 3 && ch === 'noise') fail('the drums can only copy drums');
            const from = k === 3 ? others(ch)[io.raw(1)] : ch, back = io.sym('back', ''), t = ch === 'noise' ? 0 : io.sym('shift', 'lane') - IV;
            if (pi - back < 0 || (!back && (k === 2 || CHANNELS.indexOf(from) > CHANNELS.indexOf(ch)))) fail('a lane copies one that isn’t there yet');
            const src = laneOf(back ? patterns[pi - back] : lanes, from);
            lane = copyLane(src, from, ch, t, inst);
            for (const e of toEvents(lane, ch, inst)) step(st, e);
          }
          if (ch === 'p1') lanes.p1 = lane; else if (ch === 'p2') lanes.p2 = lane; else if (ch === 'tri') lanes.tri = lane; else lanes.noise = lane;
        }
        patterns.push(lanes);
      }
      return { tempo, rpb, inst, patterns, order };
    }

    // --- the bytes: version 3 · payload length 13 · payload · CRC-8 ---
    function encode(song, { format = VERSION } = {}) {
      const s = normalize(song);
      if (format !== STATIC && format !== VERSION) fail(`no format ${format}`);
      // (in whichever key is shortest, or none)
      let body = null;
      const copies = s.patterns.flatMap((p, pi) => CHANNELS.map((ch) => (laneOf(p, ch).length ? findCopy(s, pi, ch) : null)));
      for (let key = NO_KEY; key >= 0; key--) {
        const io = format === STATIC ? staticOut() : acOut();
        writeSong(s, io, key, copies);
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
      if (format !== VERSION && format !== STATIC) fail(`unknown format version ${format}`);
      if (bytes.length < len + 3) fail('the data ends too soon');
      if (crc8(bytes, len + 2) !== bytes[len + 2]) fail('the checksum doesn’t match (damaged data)');
      const body = bytes.subarray(2, 2 + len);
      return normalize(readSong(format === STATIC ? staticIn(body) : acIn(body)));
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
    function laneFromText(ch, text) {
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
      if (row !== ROWS) fail(`a lane fills ${ROWS} rows; this one fills ${row}`);
      return out;
    }
    const fromText = (spec) => normalize({
      ...spec,
      patterns: spec.patterns.map((p) => {
        const lanes = CHANNELS.map((ch) => (typeof laneOf(p, ch) === 'string' ? laneFromText(ch, laneOf(p, ch)) : laneOf(p, ch)));
        return { p1: lanes[0], p2: lanes[1], tri: lanes[2], noise: lanes[3] };
      }),
    });

    return {
      VERSION, STATIC, ROWS, PITCHES, CHANNELS, BASE, KIT, DRUM_NAMES, DRUM_KEYS, RPB, TEMPO_MIN, TEMPO_MAX, MAX_PATTERNS, MAX_ORDER, MAX_DRUM_LEN, MODELS,
      normalize, encode, decode, toBase64, fromBase64, blank, fromText, laneFromText, laneOf,
    };
  })();
  /* tune-codec:end */

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
    function player(engine, { song, pattern, mode, from }) {
      const LOOKAHEAD = 0.12;
      let timer = null, next = 0, o = 0, r = 0, marks = [];
      const tick = () => {
        const s = song(), ctx = engine.ctx, rd = 60 / (s.tempo * s.rpb);
        while (next < ctx.currentTime + LOOKAHEAD) {
          const songMode = mode() === 'song';
          if (o >= s.order.length) o = 0;
          const pi = songMode ? s.order[o] : Math.min(pattern(), s.patterns.length - 1);
          engine.row(s, pi, r, next, rd);
          marks.push({ t: next, o: songMode ? o : -1, pi, row: r, rd });
          next += rd;
          if (++r >= C.ROWS) { r = 0; if (songMode) o = (o + 1) % s.order.length; }
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
      const rd = 60 / (song.tempo * song.rpb), rows = song.order.length * C.ROWS;
      const ctx = new Offline(1, Math.ceil((rows * rd + tail) * sampleRate), sampleRate);
      const engine = create(ctx);
      let t = 0;
      for (const pi of song.order) for (let r = 0; r < C.ROWS; r++) { engine.row(song, pi, r, t, rd); t += rd; }
      return ctx.startRendering();
    }

    return { CPU, NOISE_PERIODS, DUTY, TRI, create, player, render };
  })(TuneCodec);
  /* tune-synth:end */

  /* tune-room:begin */
  // Where a tune goes: the three song corners of a profile picture (picture code v2: 2×2 gray cells, each corner
  // its own stream with markers, kind, version, length and CRC-16). The tune's bytes are cut into corner-sized
  // pieces in corner order and joined back the same way; TuneCodec never sees corners (it ignores anything after
  // its own checksum, so a joined stream may carry padding). 440 bytes a corner until PicCode.capacity() says.
  const TUNE_ROOM = (() => {
    const CORNER_BYTES = 440, CORNERS = 3, BYTES = CORNER_BYTES * CORNERS; // 1,320
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

  // --- the composer ------------------------------------------------------------------------------------
  const C = TuneCodec, S = TuneSynth, ROWS = C.ROWS, P = C.PITCHES;
  const STORE = 'trifTuneComposer.song'; // the saved tune: its encoded bytes, base64
  const POS = 'trifTuneComposer.pos'; // where you dragged the panel
  const LANES = [
    { ch: 'p1', name: 'Pulse 1', color: '#e0453a' },
    { ch: 'p2', name: 'Pulse 2', color: '#e8930f' },
    { ch: 'tri', name: 'Triangle', color: '#2e86d6' },
    { ch: 'noise', name: 'Noise', color: '#2f9e44' },
  ];
  const RH = 7, DH = 12, CW = 22, GUT = 36; // a pitch row's height, a drum row's, a column's width, the key gutter
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
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
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
    if (JSON.stringify(song) !== was) { undo.push(was); if (undo.length > 200) undo.shift(); ui.status = ''; }
    ui.pat = Math.min(ui.pat, song.patterns.length - 1);
    render();
  };
  const edit = (fn) => { const was = JSON.stringify(song); fn(); commit(was); };
  const doUndo = () => { if (!undo.length) return; song = JSON.parse(undo.pop()); ui.pat = Math.min(ui.pat, song.patterns.length - 1); ui.status = ''; render(); };

  // --- sound (the AudioContext only once something is played) ---
  let actx = null, engine = null, player = null;
  const audio = () => {
    if (!actx) {
      actx = new AudioContext({ latencyHint: 'interactive' });
      engine = S.create(actx);
      for (const ch of ui.muted) engine.mute(ch, true);
      player = S.player(engine, { song: () => song, pattern: () => ui.pat, mode: () => ui.loop, from: () => (ui.loop === 'song' && ui.from < song.order.length ? ui.from : 0) });
    }
    if (actx.state === 'suspended') actx.resume();
    return engine;
  };
  const preview = (ch, key, len) => {
    const e = audio(), t = actx.currentTime + 0.01, d = clamp((len || ui.len) * rowDur(), 0.12, 0.4);
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
  const nextStart = (lane, row, except) => lane.reduce((m, o) => (o !== except && o.row > row ? Math.min(m, o.row) : m), ROWS);
  function placeNote(lane, row, key, len, drums) {
    for (let i = lane.length - 1; i >= 0; i--) {
      const o = lane[i];
      if (o.row === row) lane.splice(i, 1); else if (o.row < row && o.row + o.len > row) o.len = row - o.row;
    }
    const cap = Math.min(nextStart(lane, row) - row, drums ? C.MAX_DRUM_LEN : ROWS);
    const n = drums ? { row, len: Math.min(len, cap), drum: key } : { row, len: Math.min(len, cap), pitch: key };
    lane.push(n);
    lane.sort((a, b) => a.row - b.row);
    return n;
  }
  const setLen = (lane, n, len, drums) => { n.len = clamp(len, 1, Math.min(nextStart(lane, n.row, n) - n.row, drums ? C.MAX_DRUM_LEN : ROWS)); };
  const removeNote = (lane, n) => { const i = lane.indexOf(n); if (i >= 0) lane.splice(i, 1); };
  const noteAt = (lane, col, key) => lane.find((n) => keyOf(n) === key && n.row <= col && col < n.row + n.len);
  const enter = (key) => {
    const was = JSON.stringify(song), n = placeNote(curLane(ui.lane), ui.cursor, key, ui.len, ui.lane === 'noise');
    preview(ui.lane, key, n.len);
    ui.cursor = (n.row + n.len) % ROWS;
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
  const make = (tag) => (tag === 'div' ? document.createElement('div') : tag === 'span' ? document.createElement('span') : tag === 'button' ? document.createElement('button')
    : tag === 'select' ? document.createElement('select') : tag === 'option' ? document.createElement('option') : tag === 'input' ? document.createElement('input')
    : tag === 'i' ? document.createElement('i') : tag === 'b' ? document.createElement('b') : tag === 'kbd' ? document.createElement('kbd') : document.createElement('style'));
  const el = (tag, cls, text) => { const e = make(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text, title, on) => { const b = el('button', cls, text); b.type = 'button'; if (title) b.title = title; if (on) b.addEventListener('click', on); return b; };
  const seg = (items, onPick, label) => {
    const box = el('div', 'tcp-seg');
    box.setAttribute('role', 'group');
    if (label) box.setAttribute('aria-label', label);
    const bs = items.map(([v, text, title]) => { const b = btn('', text, title, () => onPick(v)); b.dataset.v = String(v); box.append(b); return b; });
    box.set = (v) => { for (const b of bs) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
    return box;
  };
  const select = (items, onPick, label) => {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (const [v, text] of items) { const o = el('option', '', text); o.value = String(v); s.append(o); }
    s.addEventListener('change', () => onPick(s.value));
    return s;
  };
  const range = (lo, hi, onPick, label) => {
    const r = el('input'), out = el('span', 'tcp-val');
    r.type = 'range'; r.min = String(lo); r.max = String(hi); r.step = '1';
    r.setAttribute('aria-label', label);
    r.addEventListener('input', () => { out.textContent = r.value; });
    r.addEventListener('change', () => onPick(+r.value));
    return [r, out];
  };
  const field = (label, ...nodes) => { const f = el('div', 'tcp-field'); if (label != null) f.append(typeof label === 'string' ? el('span', 'tcp-label', label) : label); f.append(...nodes); return f; };
  const NOTE_ART = ['...XX...', '...X.X..', '...X..X.', '...X....', '.XXX....', 'XXXX....', 'XXXX....', '.XX.....'];
  const pixelNote = () => {
    const box = el('span', 'tcp-icon'), px = el('i'), sh = [];
    NOTE_ART.forEach((line, y) => [...line].forEach((c, x) => { if (c === 'X') sh.push(`${x * 2}px ${y * 2}px 0 #e0453a`); }));
    px.style.boxShadow = sh.join(',');
    box.append(px);
    return box;
  };

  const css = el('style');
  css.textContent = `
    #tcp-panel { all: initial; display: block; position: fixed; top: 56px; right: 16px; z-index: 2147483646; width: 616px; max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box; padding: 12px 14px 10px; border-radius: 16px; background: #fff; color: #0f1419;
      box-shadow: 0 4px 24px rgb(0 0 0 / .25); font: 13px/1.3 -apple-system, system-ui, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
      outline: none; user-select: none; -webkit-user-select: none; scrollbar-width: thin; }
    #tcp-panel *, #tcp-panel *::before, #tcp-panel *::after { box-sizing: border-box; }
    #tcp-panel button, #tcp-panel select, #tcp-panel input { font: inherit; color: inherit; margin: 0; }
    #tcp-panel .tcp-head { display: flex; align-items: center; gap: 8px; margin: -2px 0 8px; cursor: grab; }
    #tcp-panel .tcp-head:active { cursor: grabbing; }
    #tcp-panel .tcp-title { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 15px; font-weight: 800; }
    #tcp-panel .tcp-icon { position: relative; width: 16px; height: 16px; flex: none; }
    #tcp-panel .tcp-icon i { position: absolute; left: 0; top: 0; width: 2px; height: 2px; }
    #tcp-panel .tcp-chip { font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; padding: 3px 5px 2px; border-radius: 3px; background: #0f1419; color: #fff; }
    #tcp-panel .tcp-x { width: 30px; height: 30px; border-radius: 50%; border: 0; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
    #tcp-panel .tcp-x:hover { background: #eff3f4; }
    #tcp-panel .tcp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin: 0 0 8px; }
    #tcp-panel .tcp-group { display: flex; align-items: center; gap: 5px; }
    #tcp-panel .tcp-label { font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .07em; text-transform: uppercase; color: #536471; white-space: nowrap; }
    #tcp-panel .tcp-btn { font-weight: 700; padding: 4px 11px; border-radius: 9999px; border: 1px solid #cfd9de; background: #fff; cursor: pointer; white-space: nowrap; }
    #tcp-panel .tcp-btn:hover:not(:disabled) { background: #f7f9f9; }
    #tcp-panel button:disabled { opacity: .4; cursor: default; }
    #tcp-panel .tcp-primary { background: #0f1419; border-color: #0f1419; color: #fff; box-shadow: 2px 2px 0 #e0453a; }
    #tcp-panel .tcp-primary:hover:not(:disabled) { background: #272c30; }
    #tcp-panel .tcp-primary:active:not(:disabled) { transform: translate(1px, 1px); box-shadow: 1px 1px 0 #e0453a; }
    #tcp-panel .tcp-play { min-width: 76px; }
    #tcp-panel .tcp-seg { display: inline-flex; border: 1px solid #cfd9de; border-radius: 9999px; overflow: hidden; flex: none; }
    #tcp-panel .tcp-seg button { border: 0; border-left: 1px solid #cfd9de; background: #fff; padding: 3px 9px; font-weight: 600; cursor: pointer; }
    #tcp-panel .tcp-seg button:first-child { border-left: 0; }
    #tcp-panel .tcp-seg button:hover { background: #f7f9f9; }
    #tcp-panel .tcp-seg button[aria-pressed=true] { background: #0f1419; color: #fff; }
    #tcp-panel .tcp-small button { padding: 2px 6px; font: 600 11px ui-monospace, Menlo, monospace; }
    #tcp-panel .tcp-round { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid #cfd9de; background: #fff; cursor: pointer; font-weight: 700; line-height: 1; }
    #tcp-panel input[type=number] { width: 46px; padding: 3px 2px; border: 1px solid #cfd9de; border-radius: 6px; text-align: center; background: #fff; -moz-appearance: textfield; }
    #tcp-panel input[type=number]::-webkit-inner-spin-button { display: none; }
    #tcp-panel select { padding: 2px 3px; border: 1px solid #cfd9de; border-radius: 6px; background: #fff; cursor: pointer; min-width: 0; font-size: 12px; }
    #tcp-panel input[type=range] { width: 70px; accent-color: var(--c, #0f1419); margin: 0; flex: 1; min-width: 0; }
    #tcp-panel .tcp-rows { display: grid; grid-template-columns: 62px 1fr; gap: 6px 8px; align-items: center; margin: 0 0 4px; }
    #tcp-panel .tcp-tabs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
    #tcp-panel .tcp-tab { min-width: 26px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid #cfd9de; background: #fff; font: 700 12px ui-monospace, Menlo, monospace; cursor: pointer; }
    #tcp-panel .tcp-tab:hover { background: #f7f9f9; }
    #tcp-panel .tcp-tab[aria-pressed=true] { background: #0f1419; color: #fff; border-color: #0f1419; }
    #tcp-panel .tcp-act { height: 24px; padding: 0 9px; font-size: 12px; }
    #tcp-panel .tcp-order { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; min-height: 30px; padding: 3px; border-radius: 7px; background: #f7f9f9; }
    #tcp-panel .tcp-o { min-width: 22px; height: 22px; padding: 0 4px; border-radius: 4px; border: 1px solid #cfd9de; background: #fff; font: 700 11px ui-monospace, Menlo, monospace; cursor: grab; }
    #tcp-panel .tcp-o[data-sel] { box-shadow: 0 0 0 2px #1d9bf0; border-color: #1d9bf0; }
    #tcp-panel .tcp-o[data-cur] { background: #eaf5fe; }
    #tcp-panel .tcp-o[data-playing] { background: #1d9bf0; border-color: #1d9bf0; color: #fff; }
    #tcp-panel .tcp-o.tcp-over { box-shadow: -3px 0 0 #1d9bf0; }
    #tcp-panel .tcp-lane { display: grid; grid-template-columns: 160px auto; gap: 10px; padding: 6px 0; border-top: 1px solid #eff3f4; }
    #tcp-panel .tcp-ctl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    #tcp-panel .tcp-ltop { display: flex; align-items: center; gap: 6px; height: 20px; }
    #tcp-panel .tcp-dot { width: 10px; height: 10px; flex: none; background: var(--c); box-shadow: inset -2px -2px 0 rgb(0 0 0 / .2); }
    #tcp-panel .tcp-lname { flex: 1; font: 700 11px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; }
    #tcp-panel .tcp-lane[data-sel] .tcp-lname { color: var(--c); }
    #tcp-panel .tcp-mute { width: 20px; height: 20px; padding: 0; border-radius: 4px; border: 1px solid #cfd9de; background: #fff; font: 700 10px ui-monospace, Menlo, monospace; cursor: pointer; }
    #tcp-panel .tcp-mute[aria-pressed=true] { background: #536471; border-color: #536471; color: #fff; }
    #tcp-panel .tcp-lane[data-muted] .tcp-layer { opacity: .35; }
    #tcp-panel .tcp-field { display: flex; align-items: center; gap: 5px; min-width: 0; }
    #tcp-panel .tcp-field > .tcp-label { width: 30px; flex: none; }
    #tcp-panel .tcp-field > select { flex: 1; }
    #tcp-panel .tcp-field > select.tcp-env { flex: 0 0 70px; }
    #tcp-panel .tcp-val { width: 15px; flex: none; text-align: right; font: 600 11px ui-monospace, Menlo, monospace; color: #536471; }
    #tcp-panel .tcp-dname { width: auto !important; flex: 1 !important; color: var(--c); }
    #tcp-panel .tcp-hintc { font-size: 11.5px; line-height: 1.35; color: #536471; }
    #tcp-panel .tcp-scroll { position: relative; height: ${16 * RH + 2}px; width: max-content; overflow-x: hidden; overflow-y: auto; border: 1px solid #cfd9de; border-radius: 7px; scrollbar-width: thin; background: #fff; }
    #tcp-panel .tcp-drums { height: ${8 * DH + 2}px; overflow: hidden; }
    #tcp-panel .tcp-lane[data-sel] .tcp-scroll { border-color: var(--c); box-shadow: 0 0 0 1px var(--c); }
    #tcp-panel .tcp-roll { position: relative; width: ${GUT + ROWS * CW}px; cursor: crosshair; touch-action: none; }
    #tcp-panel .tcp-k { position: absolute; left: 0; right: 0; height: ${RH}px; }
    #tcp-panel .tcp-k.tcp-bk { background: #f1f4f5; }
    #tcp-panel .tcp-k.tcp-c { box-shadow: inset 0 -1px 0 #dbe2e6; }
    #tcp-panel .tcp-drums .tcp-k { height: ${DH}px; }
    #tcp-panel .tcp-gut { position: absolute; left: 0; top: 0; bottom: 0; width: ${GUT}px; background: #f7f9f9; border-right: 1px solid #dbe2e6; cursor: pointer; }
    #tcp-panel .tcp-kl { position: absolute; left: 4px; font: 600 8px/${RH}px ui-monospace, Menlo, monospace; color: #8b98a5; }
    #tcp-panel .tcp-dl { position: absolute; left: 4px; font: 600 9px/${DH}px ui-monospace, Menlo, monospace; color: #536471; white-space: nowrap; }
    #tcp-panel .tcp-dl[data-sel] { color: var(--c); font-weight: 800; }
    #tcp-panel .tcp-col { position: absolute; top: 0; bottom: 0; width: 1px; background: #edf0f2; }
    #tcp-panel .tcp-col.tcp-beat { background: #d0d9de; }
    #tcp-panel .tcp-layer { position: absolute; inset: 0; pointer-events: none; }
    #tcp-panel .tcp-n { position: absolute; background: var(--c); border-radius: 1px; box-shadow: inset 0 -2px 0 rgb(0 0 0 / .2), inset 2px 0 0 rgb(255 255 255 / .45); }
    #tcp-panel .tcp-cur { position: absolute; top: 0; bottom: 0; width: ${CW}px; background: rgb(29 155 240 / .08); border-left: 2px solid #1d9bf0; pointer-events: none; display: none; }
    #tcp-panel .tcp-lane[data-sel] .tcp-cur { display: block; }
    #tcp-panel .tcp-ph { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #0f1419; opacity: .6; pointer-events: none; display: none; }
    #tcp-panel .tcp-meter { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #eff3f4; }
    #tcp-panel .tcp-mhead { display: flex; align-items: baseline; gap: 8px; margin: 0 0 5px; }
    #tcp-panel .tcp-mtext { font-size: 12px; color: #536471; }
    #tcp-panel .tcp-mtext b { color: #0f1419; }
    #tcp-panel .tcp-mbar { position: relative; height: 12px; border-radius: 2px; background: #eff3f4; }
    #tcp-panel .tcp-mfill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background-color: var(--m, #2f9e44);
      background-image: repeating-linear-gradient(90deg, transparent 0 6px, rgb(255 255 255 / .85) 6px 8px); min-width: 2px; }
    #tcp-panel .tcp-mmark { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #8b98a5; }
    #tcp-panel .tcp-mscale { position: relative; height: 14px; margin-top: 3px; font: 600 10px/14px ui-monospace, Menlo, monospace; color: #536471; }
    #tcp-panel .tcp-mscale span { position: absolute; top: 0; white-space: nowrap; }
    #tcp-panel .tcp-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    #tcp-panel .tcp-status { flex: 1; margin-left: 4px; font-size: 12px; color: #536471; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tcp-panel .tcp-keys { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 3px; margin-top: 8px; font-size: 11px; line-height: 1.5; color: #8b98a5; }
    #tcp-panel .tcp-keys .tcp-group { margin-right: 8px; }
    #tcp-panel .tcp-keys .tcp-label { width: auto; }
    #tcp-panel .tcp-kitrow input[type=range] { flex: 0 0 52px; }
    #tcp-panel .tcp-keys select { font-size: 11px; padding: 1px 2px; }
    #tcp-panel kbd { font: 600 10px ui-monospace, Menlo, monospace; padding: 0 3px; border: 1px solid #dbe2e6; border-bottom-width: 2px; border-radius: 3px; color: #536471; background: #fff; }
    #tcp-open { all: initial; display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 14px; margin: 0 8px 0 0; align-self: center;
      border-radius: 9999px; border: 1px solid rgb(128 128 128 / .5); color: inherit; font: 700 14px TwitterChirp, -apple-system, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    #tcp-open:hover { background: rgb(128 128 128 / .12); }
    #tcp-open.tcp-float { position: fixed; left: 16px; bottom: 16px; z-index: 2147483645; margin: 0; background: #fff; color: #0f1419; border-color: #cfd9de; box-shadow: 0 2px 10px rgb(0 0 0 / .2); }
  `;
  document.documentElement.append(css);

  let panel = null;
  const R = {}; // the panel's parts
  const lanes = []; // per lane: its parts

  function buildLane(L) {
    const drums = L.ch === 'noise', pulse = L.ch === 'p1' || L.ch === 'p2';
    const ref = { L, drums, pulse, box: el('div', 'tcp-lane') };
    ref.box.style.setProperty('--c', L.color);
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
      ref.duty.classList.add('tcp-small');
      [ref.vol, ref.volOut] = range(0, 15, (v) => setInst((i) => { i.vol = v; }), `${L.name} volume`);
      ref.decay = select(DECAY_NAMES.map((n, i) => [i, n]), (v) => setInst((i) => { i.decay = +v; }), `${L.name} envelope`);
      ref.decay.title = 'Envelope: how fast each note fades (Hold: it doesn’t)';
      ref.decay.classList.add('tcp-env');
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
      ref.mode.classList.add('tcp-small');
      [ref.period, ref.periodOut] = range(0, 15, (v) => setNoise((nz) => { nz.kit[ui.drum][0] = v; }), 'Drum pitch');
      ref.period.title = 'The drum’s noise period: 0 is the highest, 15 the lowest';
      const kitRow = field(null, ref.kit, ref.vol, ref.volOut);
      kitRow.classList.add('tcp-kitrow');
      ctl.append(kitRow, field(ref.drumName, ref.mode), field('Pitch', ref.period, ref.periodOut));
    }
    // the roll
    const scroll = el('div', drums ? 'tcp-scroll tcp-drums' : 'tcp-scroll'), roll = el('div', 'tcp-roll');
    roll.style.height = `${drums ? 8 * DH : P * RH}px`;
    roll.title = drums ? 'Click: a hit · drag: its length · click again or right-click: remove · the names: pick a drum to tune'
      : `Click: a note · drag: its length · click again or right-click: remove${pulse ? ' · Alt-click: its volume' : ''}`;
    const gut = el('div', 'tcp-gut');
    ref.drumLabels = [];
    if (drums) {
      for (let d = 0; d < 8; d++) {
        const k = el('div', d % 2 ? 'tcp-k tcp-bk' : 'tcp-k'), l = el('span', 'tcp-dl', DRUM_SHORT[d]);
        k.style.top = `${(7 - d) * DH}px`; l.style.top = `${(7 - d) * DH}px`;
        roll.append(k); gut.append(l); ref.drumLabels.push(l);
      }
    } else {
      for (let p = 0; p < P; p++) {
        const midi = C.BASE[L.ch] + p, k = el('div', `tcp-k${isBlack(midi) ? ' tcp-bk' : ''}${midi % 12 === 0 ? ' tcp-c' : ''}`);
        k.style.top = `${(P - 1 - p) * RH}px`;
        roll.append(k);
        if (midi % 12 === 0) { const l = el('span', 'tcp-kl', noteName(midi)); l.style.top = `${(P - 1 - p) * RH}px`; gut.append(l); }
      }
    }
    roll.append(gut);
    ref.cols = [];
    for (let c = 0; c < ROWS; c++) { const col = el('div', 'tcp-col'); col.style.left = `${GUT + c * CW}px`; roll.append(col); ref.cols.push(col); }
    ref.layer = el('div', 'tcp-layer'); ref.cur = el('div', 'tcp-cur'); ref.ph = el('div', 'tcp-ph');
    roll.append(ref.layer, ref.cur, ref.ph);
    scroll.append(roll);
    ref.box.append(ctl, scroll);
    ref.scroll = scroll; ref.roll = roll;

    const cellAt = (e, loose) => {
      const r = roll.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!loose && (x < 0 || y < 0 || x >= r.width || y >= r.height)) return null;
      const col = x < GUT && !loose ? -1 : clamp(Math.floor((x - GUT) / CW), 0, ROWS - 1);
      const key = drums ? 7 - clamp(Math.floor(y / DH), 0, 7) : P - 1 - clamp(Math.floor(y / RH), 0, P - 1);
      return { col, key };
    };
    ref.box.addEventListener('pointerdown', () => { if (ui.lane !== L.ch) { ui.lane = L.ch; render(); } }, true);
    roll.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const c = cellAt(e);
      if (!c || c.col < 0) return;
      const n = noteAt(curLane(L.ch), c.col, c.key);
      if (n) edit(() => removeNote(curLane(L.ch), n));
    });
    roll.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const c = cellAt(e);
      if (!c) return;
      e.preventDefault();
      panel.focus({ preventScroll: true });
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
      roll.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const col = Math.max(n.row, cellAt(ev, true).col);
        if (col !== c.col) moved = true;
        if (moved) { setLen(lane, n, col - n.row + 1, drums); renderLane(ref); }
      };
      const up = () => {
        roll.removeEventListener('pointermove', move); roll.removeEventListener('pointerup', up); roll.removeEventListener('pointercancel', up);
        if (!fresh && !moved) removeNote(lane, n); else ui.cursor = (n.row + n.len) % ROWS;
        commit(was);
      };
      roll.addEventListener('pointermove', move); roll.addEventListener('pointerup', up); roll.addEventListener('pointercancel', up);
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
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tune composer');
    // the head (drag it to move the panel)
    const head = el('div', 'tcp-head'), title = el('div', 'tcp-title');
    title.append(pixelNote(), el('span', '', 'Tune composer'), el('span', 'tcp-chip', '2A03'));
    head.append(title, btn('tcp-x', '×', 'Close (Esc)', closePanel));
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = panel.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => setPos(r.left + ev.clientX - x0, r.top + ev.clientY - y0);
      const up = () => {
        head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up);
        store.set(POS, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
      };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    // transport
    const bar = el('div', 'tcp-bar');
    R.play = btn('tcp-btn tcp-primary tcp-play', '', 'Play or stop (Space)', togglePlay);
    R.loop = seg([['pattern', 'Pattern', 'Loop the pattern you’re editing'], ['song', 'Song', 'Play the song from the selected place, and loop it']], (v) => { ui.loop = v; render(); }, 'Loop');
    R.tempo = el('input');
    R.tempo.type = 'number'; R.tempo.min = String(C.TEMPO_MIN); R.tempo.max = String(C.TEMPO_MAX);
    R.tempo.setAttribute('aria-label', 'Tempo, beats per minute');
    const setTempo = (v) => edit(() => { song.tempo = clamp(Math.round(v) || song.tempo, C.TEMPO_MIN, C.TEMPO_MAX); });
    R.tempo.addEventListener('change', () => setTempo(+R.tempo.value));
    R.tempo.addEventListener('keydown', (e) => { if (e.key === 'Enter') R.tempo.blur(); });
    R.rpb = select(C.RPB.map((v) => [v, `${v} rows`]), (v) => edit(() => { song.rpb = +v; }), 'Rows per beat');
    R.rpb.title = 'Rows per beat (4: each row is a 16th note)';
    R.len = select(LENGTHS.map((v) => [v, `${v} row${v > 1 ? 's' : ''}`]), (v) => { ui.len = +v; render(); }, 'Note length');
    R.len.title = 'Length of new notes (keys 1–8, 9 = 12, 0 = 16)';
    bar.append(R.play, field('Loop', R.loop),
      field('Tempo', btn('tcp-round', '−', 'Slower', () => setTempo(song.tempo - 1)), R.tempo, btn('tcp-round', '+', 'Faster', () => setTempo(song.tempo + 1))),
      field('Beat', R.rpb));
    for (const f of bar.querySelectorAll('.tcp-field')) f.classList.add('tcp-group');
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
    const ticks = [1, 2].map((k) => { const t = el('div', 'tcp-mmark'); t.style.left = `${(100 * k) / TUNE_ROOM.CORNERS}%`; return t; });
    mbar.title = `The tune’s size, against what a picture’s ${TUNE_ROOM.CORNERS} song corners hold: ${TUNE_ROOM.CORNER_BYTES} bytes each, ${TUNE_ROOM.BYTES} in all`;
    mbar.append(R.mfill, ...ticks);
    const s0 = el('span', '', '0'), s2 = el('span', '', `${TUNE_ROOM.BYTES.toLocaleString('en')} B · ${TUNE_ROOM.CORNERS} corners`);
    s0.style.left = '0'; s2.style.right = '0';
    scale.append(s0, s2);
    mhead.append(el('span', 'tcp-label', 'Space'), R.mtext);
    meter.append(mhead, mbar, scale);
    // save, undo, clear
    const foot = el('div', 'tcp-foot');
    R.save = btn('tcp-btn tcp-primary', 'Save', 'Keep this tune in this browser', save);
    R.undo = btn('tcp-btn', 'Undo', 'Undo (Ctrl/⌘+Z)', doUndo);
    R.clear = btn('tcp-btn', 'Clear', 'Start over: one empty pattern (Undo brings it back)', () => edit(() => { song = C.blank(song); ui.pat = 0; ui.from = 0; ui.cursor = 0; }));
    R.status = el('span', 'tcp-status');
    foot.append(R.save, R.undo, R.clear, R.status);
    R.keys = el('div', 'tcp-keys');
    R.lenBox = field('New notes', R.len);
    R.lenBox.classList.add('tcp-group');
    panel.append(head, bar, rows, lanesBox, meter, foot, R.keys);
  }

  const kbd = (t) => el('kbd', '', t);
  function renderLane(ref) {
    const ch = ref.L.ch, lane = curLane(ch), inst = instFor(ch);
    ref.layer.textContent = '';
    for (const n of lane) {
      const d = el('div', 'tcp-n');
      d.style.left = `${GUT + n.row * CW + 1}px`;
      d.style.width = `${n.len * CW - 2}px`;
      if (ref.drums) { d.style.top = `${(7 - n.drum) * DH + 2}px`; d.style.height = `${DH - 4}px`; }
      else {
        d.style.top = `${(P - 1 - n.pitch) * RH}px`; d.style.height = `${RH - 1}px`;
        if (inst) d.style.opacity = String(0.35 + (0.65 * (n.vol ?? inst.vol)) / 15);
      }
      ref.layer.append(d);
    }
    ref.cols.forEach((c, i) => c.classList.toggle('tcp-beat', i % song.rpb === 0));
    ref.cur.style.left = `${GUT + ui.cursor * CW}px`;
    ref.box.toggleAttribute('data-sel', ui.lane === ch);
    ref.box.toggleAttribute('data-muted', ui.muted.has(ch));
    ref.mute.setAttribute('aria-pressed', String(ui.muted.has(ch)));
  }
  let dragFrom = -1;
  function render() {
    if (!panel) return;
    R.play.textContent = playing() ? '■ Stop' : '▶ Play';
    R.loop.set(ui.loop);
    if (document.activeElement !== R.tempo) R.tempo.value = String(song.tempo);
    R.rpb.value = String(song.rpb);
    R.len.value = String(ui.len);
    // pattern tabs
    R.tabs.textContent = '';
    song.patterns.forEach((_, i) => {
      const b = btn('tcp-tab', label(i), `Edit pattern ${label(i)}`, () => { ui.pat = i; render(); });
      b.setAttribute('aria-pressed', String(i === ui.pat));
      R.tabs.append(b);
    });
    R.add.disabled = R.copy.disabled = song.patterns.length >= C.MAX_PATTERNS;
    R.del.disabled = song.patterns.length <= 1;
    R.tabs.append(R.add, R.copy, R.del);
    // the order strip (drag a chip to move it, right-click to remove it)
    R.order.textContent = '';
    R.chips = song.order.map((pi, i) => {
      const b = btn('tcp-o', label(pi), `Bar ${i + 1}: pattern ${label(pi)}. Click to edit it and play from here, drag to move, right-click to remove`, () => { ui.from = i; ui.pat = pi; render(); });
      b.draggable = true;
      b.toggleAttribute('data-sel', i === ui.from);
      b.toggleAttribute('data-cur', pi === ui.pat);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (song.order.length > 1) edit(() => { song.order.splice(i, 1); ui.from = Math.min(ui.from, song.order.length - 1); }); });
      b.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', label(pi)); });
      b.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); b.classList.add('tcp-over'); } });
      b.addEventListener('dragleave', () => b.classList.remove('tcp-over'));
      b.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = dragFrom;
        dragFrom = -1;
        if (from < 0 || from === i) { render(); return; }
        edit(() => { const [x] = song.order.splice(from, 1); song.order.splice(from < i ? i - 1 : i, 0, x); ui.from = from < i ? i - 1 : i; });
      });
      b.addEventListener('dragend', () => { dragFrom = -1; });
      R.order.append(b);
      return b;
    });
    R.place.textContent = `+ ${label(ui.pat)}`;
    R.place.disabled = song.order.length >= C.MAX_ORDER;
    R.order.append(R.place);
    // lanes and their settings
    for (const ref of lanes) {
      renderLane(ref);
      const ch = ref.L.ch;
      if (ref.pulse) {
        const i = instFor(ch);
        ref.duty.set(i.duty);
        ref.vol.value = String(i.vol); ref.volOut.textContent = String(i.vol);
        ref.decay.value = String(i.decay);
        const sw = SWEEPS.findIndex((s) => JSON.stringify(s[1]) === JSON.stringify(i.sweep));
        ref.sweep.value = sw >= 0 ? String(sw) : 'custom';
      } else if (ref.drums) {
        const nz = song.inst.noise, k = nz.kit[ui.drum];
        const kit = KITS.findIndex((x) => JSON.stringify(x[1]) === JSON.stringify(nz.kit));
        ref.kit.value = kit >= 0 ? String(kit) : 'custom';
        ref.vol.value = String(nz.vol); ref.volOut.textContent = String(nz.vol);
        ref.drumName.textContent = C.DRUM_NAMES[ui.drum];
        ref.mode.set(k[1]);
        ref.period.value = String(k[0]); ref.periodOut.textContent = String(k[0]);
        ref.drumLabels.forEach((l, d) => l.toggleAttribute('data-sel', d === ui.drum));
      }
    }
    // the meter: bytes, against the room in the picture's song corners (a tick where each one fills)
    let bytes = null;
    try { bytes = C.encode(song); } catch (e) { ui.status = e.message; }
    const n = bytes ? bytes.length : 0, room = TUNE_ROOM.BYTES, k = TUNE_ROOM.corners(n);
    R.mfill.style.width = `${Math.min(100, (100 * n) / room)}%`;
    R.mfill.style.setProperty('--m', n <= room ? '#2f9e44' : '#e0453a');
    R.mtext.textContent = '';
    R.mtext.append(el('b', '', `${n} bytes`), n <= room ? ` · uses ${k} of ${TUNE_ROOM.CORNERS} corners · ${(room - n).toLocaleString('en')} to spare` : ` · ${(n - room).toLocaleString('en')} too many for a picture`);
    // footer
    const now = bytes && C.toBase64(bytes);
    R.undo.disabled = !undo.length;
    R.status.textContent = ui.status || (!saved ? 'The demo tune. Save keeps your own.' : now === saved ? 'Saved.' : 'Not saved yet.');
    R.keys.textContent = '';
    R.keys.append(R.lenBox);
    if (ui.lane === 'noise') R.keys.append('Keys: ', kbd('A'), '–', kbd('K'), ' drums');
    else R.keys.append('Keys: ', kbd('A'), kbd('W'), kbd('S'), kbd('E'), kbd('D'), '… piano from ', el('b', '', `C${ui.oct.get(ui.lane)}`), ' · ', kbd('Z'), kbd('X'), ' octave');
    R.keys.append(' · ', kbd('1'), '–', kbd('8'), ' length · ', kbd('←'), kbd('→'), ' cursor · ', kbd('↑'), kbd('↓'), ' lane · ', kbd('⌫'), ' delete · ', kbd('Space'), ' play · ', kbd('Esc'), ' close');
  }
  // the playhead, while playing
  function frame() {
    if (!panel || !playing()) { for (const ref of lanes) ref.ph.style.display = 'none'; if (R.chips) for (const c of R.chips) c.removeAttribute('data-playing'); return; }
    const pos = player.position();
    for (const ref of lanes) {
      const show = !!pos && pos.pi === ui.pat;
      ref.ph.style.display = show ? 'block' : 'none';
      if (show) ref.ph.style.left = `${GUT + (pos.row + clamp((actx.currentTime - pos.t) / pos.rd, 0, 1)) * CW}px`;
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
  const setPos = (left, top) => {
    panel.style.left = `${Math.round(clamp(left, 8, Math.max(8, innerWidth - panel.offsetWidth - 8)))}px`;
    panel.style.top = `${Math.round(clamp(top, 8, Math.max(8, innerHeight - 80)))}px`;
    panel.style.right = 'auto';
    fitHeight();
  };
  // (never past the window's bottom: the panel scrolls instead)
  const fitHeight = () => { if (panel) panel.style.maxHeight = `${Math.max(160, innerHeight - panel.getBoundingClientRect().top - 8)}px`; };
  addEventListener('resize', () => { if (ui.open) { const r = panel.getBoundingClientRect(); if (panel.style.left) setPos(r.left, r.top); else fitHeight(); } });
  // each lane opens on its notes (and the piano on their octave)
  const centre = () => {
    for (const ref of lanes) {
      if (ref.drums) continue;
      const ch = ref.L.ch, ps = song.patterns.flatMap((p) => C.laneOf(p, ch).map((n) => n.pitch)).sort((a, b) => a - b);
      const mid = ps.length ? ps[ps.length >> 1] : 12 * (ui.oct.get(ch) + 1) + 5 - C.BASE[ch];
      if (ps.length) ui.oct.set(ch, clamp(Math.floor((C.BASE[ch] + mid) / 12) - 1, OCT[ch][0], OCT[ch][1]));
      ref.scroll.scrollTop = (P - 1 - mid) * RH - ref.scroll.clientHeight / 2;
    }
  };
  function openPanel() {
    if (!panel) build();
    ui.open = true;
    document.documentElement.append(panel);
    render();
    // (a panel taken out of the page forgets its scroll positions: put back where each lane was)
    if (!ui.centred) { ui.centred = true; centre(); } else lanes.forEach((ref, i) => { ref.scroll.scrollTop = ui.scrolls[i] || 0; });
    try { const pos = JSON.parse(store.get(POS) || 'null'); if (pos) setPos(pos.left, pos.top); } catch { /* none */ }
    fitHeight();
    panel.focus({ preventScroll: true });
  }
  function closePanel() {
    if (player && player.playing) player.stop();
    ui.open = false;
    if (panel) { ui.scrolls = lanes.map((ref) => ref.scroll.scrollTop); panel.remove(); }
  }

  // --- keys: while the panel is open, and never while you're typing in a field (X's or the panel's) ---
  const typing = (e) => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
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
    if (code === 'ArrowLeft' || code === 'ArrowRight') { ui.cursor = (ui.cursor + (code === 'ArrowLeft' ? ROWS - 1 : 1)) % ROWS; render(); return true; }
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
      if (drums) return true;
      const ch = ui.lane;
      ui.oct.set(ch, clamp(ui.oct.get(ch) + (code === 'KeyZ' ? -1 : 1), OCT[ch][0], OCT[ch][1]));
      const ref = lanes.find((l) => l.L.ch === ch);
      if (ref) ref.scroll.scrollTop = (P - 1 - (12 * (ui.oct.get(ch) + 1) + 6 - C.BASE[ch])) * RH - ref.scroll.clientHeight / 2;
      render();
      return true;
    }
    const k = drums ? PADS.get(code) : PIANO.get(code);
    if (k == null) return false;
    const pitch = drums ? k : 12 * (ui.oct.get(ui.lane) + 1) + k - C.BASE[ui.lane];
    if (pitch >= 0 && pitch < P) enter(pitch);
    return true;
  }
  const taken = new Set();
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    let took = true;
    if (e.code === 'KeyT' && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) { if (ui.open) closePanel(); else openPanel(); }
    else if (!ui.open) took = false;
    else if (e.metaKey || e.ctrlKey) { if (e.code === 'KeyZ' && !e.shiftKey) doUndo(); else took = false; }
    else if (e.altKey) took = false;
    else took = key(e);
    if (took) { taken.add(e.code); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  const swallow = (e) => {
    if (!taken.has(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'keyup') taken.delete(e.code);
  };
  addEventListener('keypress', swallow, true);
  addEventListener('keyup', swallow, true);

  // --- the button in Edit profile (x.com/settings/profile): beside Save, or in the corner if Save isn't found ---
  const opener = btn('', '♪ Tune', 'Compose a tune (Alt+Shift+T anywhere on X)', () => { if (ui.open) closePanel(); else openPanel(); });
  opener.id = 'tcp-open';
  const tick = () => {
    if (!location.pathname.startsWith('/settings/profile')) { opener.remove(); return; }
    const saveBtn = document.querySelector('[data-testid=Profile_Save_Button]');
    if (saveBtn) {
      opener.classList.remove('tcp-float');
      if (saveBtn.previousElementSibling !== opener) saveBtn.before(opener);
    } else if (!opener.classList.contains('tcp-float') || !opener.isConnected) {
      opener.classList.add('tcp-float');
      document.documentElement.append(opener);
    }
  };
  setInterval(tick, 800);
  tick();
})();
