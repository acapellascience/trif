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
// - Patterns A–P, arranged into a song in the order strip (drag to move, right-click to remove).
// - The space meter shows the tune's size in bytes, against what three picture corners hold: about 3.8 KB
//   when X keeps the picture lossless (PNG), about 950 B if X re-saves it as a JPEG (see BUDGET).
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
// The format (TuneCodec below; bits are written most significant first; a song is at most 16 patterns of
// 16 rows, played through an order list of up to 64 entries):
//   header   version 3 (= 1) · tempo 8 (bpm = 32 + v, 32–287) · rows per beat 2 (2, 3, 4 or 6)
//            Pulse 1 and Pulse 2: duty 2 · volume 4 · decay 3 (0 = hold, 1 fastest … 7 slowest) · sweep 1,
//              and when sweep is on: negate 1 · period 3 · shift 3 (the NES's own sweep unit)
//            Noise: volume 4 · custom kit 1, and when on: 8 × (period 4 · mode 1) (else the standard kit)
//            (the triangle has no settings, like the chip's)
//            patterns 4 (count − 1) · order 6 (length − 1) · order entries, ceil(log2(patterns)) bits each
//   lanes    for each pattern, for each channel: 0 = lane data follows, 10 = empty, 11 + index = the same
//            as this channel's lane in an earlier pattern (ceil(log2(this pattern's index)) bits)
//   Pulse and Triangle lane data, events until the 16 rows are filled:
//            pitch 6 · length 4 (1–16 rows)   10 bits, a note: pitch 0–61, from C2 on the pulses, C1 on the
//                                                    triangle (about five octaves each)
//            62 · length 4                   10 bits, a rest
//            63 · kind 4 · 8 bits            18 bits, an escape, before the next note, for the rest of the
//                                                    pattern (each pattern starts from the channel's settings):
//                                                    kind 0 = volume 4 · decay 3 · 0, kind 1 = duty 2 · 000000
//                                                    (pulses only; other kinds are reserved)
//   Noise lane data: 1 · drum 3 · length 3 (1–8 rows), 7 bits, a hit; 0 · length 3, 4 bits, a rest
//   then zero bits to the end of the byte, and a CRC-8 (polynomial 0x07) of everything before it.
// A blank song is 8 bytes; the demo tune (TUNE_DEMO) is 215.

(() => {
  if (window.top !== window) return;
  if (document.documentElement.hasAttribute('data-tcp')) return; // (loaded twice)
  document.documentElement.setAttribute('data-tcp', '');

  /* tune-codec:begin */
  // The song model and its bytes. Self-contained (no DOM, no audio), to be shared with Style Encoder and
  // Profile Styler when tunes go into pictures. A song:
  //   { v: 1, tempo, rpb, inst: { p1, p2, noise }, patterns: [{ p1, p2, tri, noise }], order: [pattern index] }
  //   pulse instrument { duty 0–3, vol 0–15, decay 0–7, sweep: null | { neg, period 0–7, shift 1–7 } }
  //   noise instrument { vol 0–15, kit: 8 × [period 0–15, mode 0 long | 1 short] }
  //   a note { row 0–15, len 1–16, pitch 0–61 } (pulse notes may also carry vol, decay, duty of their own)
  //   a hit  { row 0–15, len 1–8, drum 0–7 }
  const TuneCodec = (() => {
    const VERSION = 1, ROWS = 16, PITCHES = 62, REST = 62, ESC = 63;
    const TEMPO_MIN = 32, TEMPO_MAX = 287, RPB = [2, 3, 4, 6];
    const MAX_PATTERNS = 16, MAX_ORDER = 64, DRUMS = 8, MAX_DRUM_LEN = 8;
    const CHANNELS = ['p1', 'p2', 'tri', 'noise'];
    const BASE = { p1: 36, p2: 36, tri: 24 }; // (MIDI note of pitch 0: C2 on the pulses, C1 on the triangle)
    const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open hat', 'Low tom', 'High tom', 'Clap', 'Crash'];
    const DRUM_KEYS = 'KSHOLTCX'; // (for lanes written as text: Kick Snare Hat Open hat Low tom Tom high Clap X crash)
    const KIT = [[10, 0], [7, 0], [1, 0], [1, 0], [7, 1], [5, 1], [5, 0], [3, 0]]; // the standard kit: [period, mode]
    // Room: three corners of a 400×400 picture, 4×4-pixel cells outside X's round crop with a 4 px margin,
    // 429 cells each, 9 of them kept for markers and a length (settled when this goes into pictures). A cell
    // carries 24 bits when the picture stays lossless, 6 when X makes it a JPEG (each channel to 4 levels).
    const CORNER_CELLS = 429, RESERVED_CELLS = 9, CORNERS = 3;
    const DATA_CELLS = (CORNER_CELLS - RESERVED_CELLS) * CORNERS;
    const BUDGET = { lossless: DATA_CELLS * 3, jpeg: Math.floor((DATA_CELLS * 6) / 8) }; // 3780 B, 945 B

    const fail = (msg) => { throw new RangeError(`tune: ${msg}`); };
    const int = (v, lo, hi, what) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fail(`${what} must be a whole number from ${lo} to ${hi}, not ${v}`));
    const bitsFor = (n) => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));
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
    function normalize(s) {
      if (!s || typeof s !== 'object') fail('not a song');
      const si = s.inst || {};
      const inst = { p1: pulseInst(si.p1), p2: pulseInst(si.p2), noise: noiseInst(si.noise) };
      if (!Array.isArray(s.patterns) || !s.patterns.length) fail('a song needs at least one pattern');
      if (s.patterns.length > MAX_PATTERNS) fail(`a song has at most ${MAX_PATTERNS} patterns`);
      const patterns = s.patterns.map((p) => {
        p = p || {};
        return { p1: melodic(p.p1, inst.p1, 'Pulse 1'), p2: melodic(p.p2, inst.p2, 'Pulse 2'), tri: melodic(p.tri, null, 'Triangle'), noise: drums(p.noise) };
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
        get bits() { return n; },
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
        get bits() { return n; },
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

    // --- encoding ---
    const sameKit = (a, b) => a.every((k, i) => k[0] === b[i][0] && k[1] === b[i][1]);
    const sameLane = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function putMelodic(w, notes, inst) {
      let row = 0;
      const st = inst && { vol: inst.vol, decay: inst.decay, duty: inst.duty };
      const rest = (to) => { while (row < to) { const l = Math.min(ROWS, to - row); w.put(REST, 6); w.put(l - 1, 4); row += l; } };
      for (const n of notes) {
        rest(n.row);
        if (st) {
          const vol = n.vol ?? inst.vol, decay = n.decay ?? inst.decay, duty = n.duty ?? inst.duty;
          if (vol !== st.vol || decay !== st.decay) { w.put(ESC, 6); w.put(0, 4); w.put((vol << 4) | (decay << 1), 8); st.vol = vol; st.decay = decay; }
          if (duty !== st.duty) { w.put(ESC, 6); w.put(1, 4); w.put(duty << 6, 8); st.duty = duty; }
        }
        w.put(n.pitch, 6); w.put(n.len - 1, 4);
        row += n.len;
      }
      rest(ROWS);
    }
    function putDrums(w, hits) {
      let row = 0;
      const rest = (to) => { while (row < to) { const l = Math.min(MAX_DRUM_LEN, to - row); w.put(0, 1); w.put(l - 1, 3); row += l; } };
      for (const h of hits) { rest(h.row); w.put(1, 1); w.put(h.drum, 3); w.put(h.len - 1, 3); row += h.len; }
      rest(ROWS);
    }
    function encode(song) {
      const s = normalize(song), w = writer();
      w.put(VERSION, 3); w.put(s.tempo - TEMPO_MIN, 8); w.put(RPB.indexOf(s.rpb), 2);
      for (const i of [s.inst.p1, s.inst.p2]) {
        w.put(i.duty, 2); w.put(i.vol, 4); w.put(i.decay, 3); w.put(i.sweep ? 1 : 0, 1);
        if (i.sweep) { w.put(i.sweep.neg ? 1 : 0, 1); w.put(i.sweep.period, 3); w.put(i.sweep.shift, 3); }
      }
      const nz = s.inst.noise, custom = !sameKit(nz.kit, KIT);
      w.put(nz.vol, 4); w.put(custom ? 1 : 0, 1);
      if (custom) for (const k of nz.kit) { w.put(k[0], 4); w.put(k[1], 1); }
      w.put(s.patterns.length - 1, 4); w.put(s.order.length - 1, 6);
      const ob = bitsFor(s.patterns.length);
      for (const o of s.order) w.put(o, ob);
      s.patterns.forEach((p, pi) => {
        for (const ch of CHANNELS) {
          const lane = laneOf(p, ch);
          if (!lane.length) { w.put(2, 2); continue; }
          const j = s.patterns.findIndex((q, qi) => qi < pi && sameLane(laneOf(q, ch), lane));
          if (j >= 0) { w.put(3, 2); w.put(j, bitsFor(pi)); continue; }
          w.put(0, 1);
          if (ch === 'noise') putDrums(w, lane); else putMelodic(w, lane, instOf(s.inst, ch));
        }
      });
      const body = w.bytes();
      return Uint8Array.from([...body, crc8(body, body.length)]);
    }

    // --- decoding (trailing bytes after the checksum are ignored: a picture's corners may hold more) ---
    function getMelodic(r, inst) {
      const notes = [];
      const st = inst && { vol: inst.vol, decay: inst.decay, duty: inst.duty };
      let row = 0;
      while (row < ROWS) {
        const p = r.get(6), l = r.get(4);
        if (p === ESC) {
          if (!st) fail('the triangle has no settings to change');
          const a = r.get(8);
          if (l === 0) { st.vol = a >>> 4; st.decay = (a >>> 1) & 7; } else if (l === 1) st.duty = a >>> 6; else fail(`escape ${l} is reserved`);
          continue;
        }
        const len = l + 1;
        if (row + len > ROWS) fail('a note runs past the end of its pattern');
        if (p !== REST) {
          const n = { row, len, pitch: p };
          if (st) {
            if (st.vol !== inst.vol) n.vol = st.vol;
            if (st.decay !== inst.decay) n.decay = st.decay;
            if (st.duty !== inst.duty) n.duty = st.duty;
          }
          notes.push(n);
        }
        row += len;
      }
      return notes;
    }
    function getDrums(r) {
      const hits = [];
      let row = 0;
      while (row < ROWS) {
        if (r.get(1)) {
          const drum = r.get(3), len = r.get(3) + 1;
          if (row + len > ROWS) fail('a hit runs past the end of its pattern');
          hits.push({ row, len, drum });
          row += len;
        } else {
          const len = r.get(3) + 1;
          if (row + len > ROWS) fail('a rest runs past the end of its pattern');
          row += len;
        }
      }
      return hits;
    }
    function decode(input) {
      const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
      const r = reader(bytes);
      const v = r.get(3);
      if (v !== VERSION) fail(`unknown format version ${v}`);
      const tempo = r.get(8) + TEMPO_MIN, rpb = RPB[r.get(2)];
      const pulse = () => {
        const i = { duty: r.get(2), vol: r.get(4), decay: r.get(3), sweep: null };
        if (r.get(1)) i.sweep = { neg: !!r.get(1), period: r.get(3), shift: r.get(3) };
        return i;
      };
      const p1 = pulse(), p2 = pulse();
      const noise = { vol: r.get(4), kit: KIT.map((k) => k.slice()) };
      if (r.get(1)) noise.kit = KIT.map(() => [r.get(4), r.get(1)]);
      const inst = { p1, p2, noise };
      const np = r.get(4) + 1, no = r.get(6) + 1, ob = bitsFor(np);
      const order = [];
      for (let i = 0; i < no; i++) order.push(r.get(ob));
      const patterns = [];
      for (let pi = 0; pi < np; pi++) {
        const lanes = CHANNELS.map((ch) => {
          if (r.get(1) === 0) return ch === 'noise' ? getDrums(r) : getMelodic(r, instOf(inst, ch));
          if (r.get(1) === 0) return [];
          if (!pi) fail('the first pattern can’t copy an earlier one');
          const j = r.get(bitsFor(pi));
          if (j >= pi) fail('a lane copies a pattern that isn’t earlier');
          return laneOf(patterns[j], ch).map((n) => ({ ...n }));
        });
        patterns.push({ p1: lanes[0], p2: lanes[1], tri: lanes[2], noise: lanes[3] });
      }
      const end = Math.ceil(r.bits / 8);
      if (bytes.length <= end) fail('the checksum is missing');
      if (crc8(bytes, end) !== bytes[end]) fail('the checksum doesn’t match (damaged data)');
      return normalize({ tempo, rpb, inst, patterns, order });
    }

    const measure = (song) => {
      const bytes = encode(song).length;
      return { bytes, jpeg: BUDGET.jpeg, lossless: BUDGET.lossless, fitsJpeg: bytes <= BUDGET.jpeg, fitsLossless: bytes <= BUDGET.lossless };
    };
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
      VERSION, ROWS, PITCHES, CHANNELS, BASE, KIT, DRUM_NAMES, DRUM_KEYS, RPB, TEMPO_MIN, TEMPO_MAX, MAX_PATTERNS, MAX_ORDER, MAX_DRUM_LEN, BUDGET,
      normalize, encode, decode, measure, toBase64, fromBase64, blank, fromText, laneFromText, laneOf,
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
  const LETTERS = 'ABCDEFGHIJKLMNOP';
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
    song = C.fromText(TUNE_DEMO); saved = null; firstNote = 'The saved tune couldn’t be read, so here’s the demo.';
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
    #tcp-panel .tcp-mmark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #0f1419; }
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
    const mark = el('div', 'tcp-mmark'), jpegAt = `${(100 * C.BUDGET.jpeg) / C.BUDGET.lossless}%`;
    mark.style.left = jpegAt;
    mark.title = `JPEG-safe: up to ${C.BUDGET.jpeg} bytes still read back if X re-saves the picture as a JPEG`;
    mbar.title = `The tune’s size, against three picture corners: ${C.BUDGET.lossless} bytes when X keeps the picture lossless, ${C.BUDGET.jpeg} if it re-saves it as a JPEG`;
    mbar.append(R.mfill, mark);
    const s0 = el('span', '', '0'), s1 = el('span', '', `▲ JPEG-safe ${C.BUDGET.jpeg} B`), s2 = el('span', '', `lossless ${(C.BUDGET.lossless / 1000).toFixed(2)} KB`);
    s0.style.left = '0'; s1.style.left = `calc(${jpegAt} - 4px)`; s2.style.right = '0';
    scale.append(s0, s1, s2);
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
      const b = btn('tcp-tab', LETTERS[i], `Edit pattern ${LETTERS[i]}`, () => { ui.pat = i; render(); });
      b.setAttribute('aria-pressed', String(i === ui.pat));
      R.tabs.append(b);
    });
    R.add.disabled = R.copy.disabled = song.patterns.length >= C.MAX_PATTERNS;
    R.del.disabled = song.patterns.length <= 1;
    R.tabs.append(R.add, R.copy, R.del);
    // the order strip (drag a chip to move it, right-click to remove it)
    R.order.textContent = '';
    R.chips = song.order.map((pi, i) => {
      const b = btn('tcp-o', LETTERS[pi], `Bar ${i + 1}: pattern ${LETTERS[pi]}. Click to edit it and play from here, drag to move, right-click to remove`, () => { ui.from = i; ui.pat = pi; render(); });
      b.draggable = true;
      b.toggleAttribute('data-sel', i === ui.from);
      b.toggleAttribute('data-cur', pi === ui.pat);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (song.order.length > 1) edit(() => { song.order.splice(i, 1); ui.from = Math.min(ui.from, song.order.length - 1); }); });
      b.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', LETTERS[pi]); });
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
    R.place.textContent = `+ ${LETTERS[ui.pat]}`;
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
    // the meter: bytes, against the lossless room (the bar) and the JPEG-safe room (the mark)
    let bytes = null;
    try { bytes = C.encode(song); } catch (e) { ui.status = e.message; }
    const n = bytes ? bytes.length : 0, B = C.BUDGET;
    R.mfill.style.width = `${Math.min(100, (100 * n) / B.lossless)}%`;
    R.mfill.style.setProperty('--m', n <= B.jpeg ? '#2f9e44' : n <= B.lossless ? '#e8930f' : '#e0453a');
    R.mtext.textContent = '';
    R.mtext.append(el('b', '', `${n} bytes`), n <= B.jpeg ? ` · fits JPEG-safe, ${B.jpeg - n} to spare`
      : n <= B.lossless ? ` · ${n - B.jpeg} past JPEG-safe: only if X keeps the picture lossless` : ` · ${n - B.lossless} too many for a picture`);
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
