'use strict';
// examples/sites/x.com/tune-composer.js: its song format (TuneCodec, the block between /* tune-codec:begin */
// and /* tune-codec:end */, loaded on its own, as Style Encoder and Profile Styler will load it): round trips,
// exact sizes, limits, damaged data. The sound is checked in a browser (tests/dev/check.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseHeader } = require('../helper/lib/mods');
const { powersOf } = require('../helper/lib/powers');
const { PREINSTALLED } = require('../helper/lib/preinstalled');

const FILE = path.join(__dirname, '..', 'examples', 'sites', 'x.com', 'tune-composer.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const block = (name) => {
  const a = SRC.indexOf(`/* ${name}:begin */`), b = SRC.indexOf(`/* ${name}:end */`);
  assert.ok(a >= 0 && b > a, `${name} block`);
  return SRC.slice(a, b);
};
// (the codec and the synth need nothing from the page: they load on their own)
const { TuneCodec: C, TuneSynth: S, TUNE_DEMO } = new Function(`${block('tune-codec')}\n${block('tune-synth')}\n${block('tune-demo')}\nreturn { TuneCodec, TuneSynth, TUNE_DEMO };`)();

const plain = (x) => JSON.parse(JSON.stringify(x));
const size = (song) => C.encode(song).length;
// a seeded random source, so a failing song can be found again
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// bits by hand, for data the encoder would never write
function bits(fields) {
  const out = [];
  let n = 0;
  for (const [v, w] of fields) for (let i = w - 1; i >= 0; i--) { if (!(n & 7)) out.push(0); if ((v >>> i) & 1) out[out.length - 1] |= 0x80 >>> (n & 7); n++; }
  let c = 0;
  for (const b of out) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 0xff : (c << 1) & 0xff; }
  return Uint8Array.from([...out, c]);
}
// the header of a one-pattern, one-bar song with default settings
const HEADER = [[1, 3], [150 - 32, 8], [2, 2], [2, 2], [10, 4], [0, 3], [0, 1], [2, 2], [10, 4], [0, 3], [0, 1], [12, 4], [0, 1], [0, 4], [0, 6]];

test('tune-composer: its header, not preinstalled, and nothing TRIF would hold it for', () => {
  const h = parseHeader(SRC);
  assert.strictEqual(h.name, 'Tune Composer');
  assert.deepStrictEqual(h.matches, ['https://x.com/*']);
  assert.strictEqual(h.runAt, 'document_idle');
  assert.strictEqual(h.risk.tier, 0);
  assert.strictEqual(h.source, 'trif');
  assert.ok(!PREINSTALLED.some((p) => p.id === 'x.com/tune-composer'));
  assert.deepStrictEqual(powersOf(SRC, { sites: ['x.com'] }), [], 'no sends, loads, navigation or hidden code');
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'http://', 'https://x.com/i']) assert.ok(!block('tune-codec').includes(word) && !block('tune-synth').includes(word), word);
});

test('the budget: three corners, lossless about 3.8 KB, JPEG-safe about 950 B', () => {
  assert.deepStrictEqual(plain(C.BUDGET), { lossless: 3780, jpeg: 945 });
});

test('a blank song is 8 bytes: a 48-bit header, four empty lanes, the checksum', () => {
  const blank = C.blank();
  assert.strictEqual(size(blank), 8);
  assert.deepStrictEqual(plain(C.decode(C.encode(blank))), plain(blank));
  // (and exactly the bits the format describes)
  assert.deepStrictEqual([...C.encode(blank)], [...bits([...HEADER, [2, 2], [2, 2], [2, 2], [2, 2]])]);
});

test('exact costs: notes and rests 10 bits, hits 7, drum rests 4, escapes 18, sweep 7, a custom kit 40', () => {
  const base = { tempo: 150, rpb: 4, patterns: [{}], order: [0] };
  const bitsOf = (song) => { const s = C.normalize(song); return C.encode(s).length; };
  // one 16-row note: lane flag 0 + 10 bits, replacing the empty lane's 2: 56 - 2 + 11 = 65 bits = 9 bytes, + 1
  assert.strictEqual(bitsOf({ ...base, patterns: [{ p1: [{ row: 0, len: 16, pitch: 30 }] }] }), 10);
  // a note in the middle: rest, note, rest = 30 bits + 1: 85 bits = 11 bytes, + 1
  assert.strictEqual(bitsOf({ ...base, patterns: [{ tri: [{ row: 4, len: 4, pitch: 12 }] }] }), 12);
  // a hit of 8 rows and a rest of 8: 1 + 7 + 4 = 12 bits: 66 bits = 9 bytes, + 1
  assert.strictEqual(bitsOf({ ...base, patterns: [{ noise: [{ row: 0, len: 8, drum: 3 }] }] }), 10);
  // the same note with a volume of its own: + 18 bits (85 + 18 + 18 for the duty too = 121 bits = 16 bytes, + 1)
  assert.strictEqual(bitsOf({ ...base, patterns: [{ p1: [{ row: 4, len: 4, pitch: 12, vol: 3 }] }] }), 1 + Math.ceil(103 / 8));
  assert.strictEqual(bitsOf({ ...base, patterns: [{ p1: [{ row: 4, len: 4, pitch: 12, vol: 3, duty: 0 }] }] }), 1 + Math.ceil(121 / 8));
  // sweep on Pulse 2: + 7 bits (56 + 7 = 63 bits = 8 bytes, + 1); a custom kit: + 40 (96 bits = 12 bytes, + 1)
  assert.strictEqual(bitsOf({ ...base, inst: { p2: { sweep: { neg: true, period: 3, shift: 2 } } } }), 9);
  assert.strictEqual(bitsOf({ ...base, inst: { noise: { kit: C.KIT.map((k) => [k[0], 1 - k[1]]) } } }), 13);
});

test('patterns reuse lanes: a lane like an earlier pattern’s costs 2 bits and an index', () => {
  const one = C.fromText(TUNE_DEMO);
  const twice = C.normalize({ ...one, patterns: [...one.patterns, ...one.patterns.map(plain)], order: [...one.order, 6, 7, 8, 9, 10, 11] });
  // six more patterns, every lane a copy (11 + 3 bits for patterns 6–8, + 4 for 9–11), and the order's 14
  // entries at 4 bits instead of 8 at 3: 4 × (5 + 5 + 5 + 6 + 6 + 6) + 56 − 24 = 164 bits
  const extra = size(twice) - size(one);
  assert.ok(extra >= 20 && extra <= 22, `${extra} bytes more`);
  assert.deepStrictEqual(plain(C.decode(C.encode(twice))), plain(twice));
  // (the demo itself reuses its beat: patterns B and C copy A's drums; changing B's makes it cost its own)
  const own = plain(one);
  own.patterns[1].noise[own.patterns[1].noise.length - 1].len = 1;
  assert.ok(size(own) - size(one) >= 6);
});

test('the demo tune: round trip, about 200 bytes, well inside JPEG-safe', () => {
  const demo = C.fromText(TUNE_DEMO);
  const bytes = C.encode(demo);
  assert.deepStrictEqual(plain(C.decode(bytes)), plain(demo));
  assert.ok(bytes.length > 150 && bytes.length < 260, `${bytes.length} bytes`);
  assert.ok(C.measure(demo).fitsJpeg);
  assert.strictEqual(demo.patterns.length, 6);
  assert.deepStrictEqual(demo.order, [0, 1, 2, 3, 0, 1, 4, 5]);
  assert.strictEqual(demo.patterns[5].p1.find((n) => n.vol).vol, 13, 'one accented note (an escape)');
  // base64, as Save keeps it
  const b64 = C.toBase64(bytes);
  assert.strictEqual(b64, Buffer.from(bytes).toString('base64'));
  assert.deepStrictEqual([...C.fromBase64(b64)], [...bytes]);
});

function randomSong(r) {
  const pick = (n) => Math.floor(r() * n);
  const pulse = () => ({ duty: pick(4), vol: pick(16), decay: pick(8), sweep: r() < 0.3 ? { neg: r() < 0.5, period: pick(8), shift: 1 + pick(7) } : null });
  const inst = { p1: pulse(), p2: pulse(), noise: { vol: pick(16), kit: r() < 0.3 ? Array.from({ length: 8 }, () => [pick(16), pick(2)]) : C.KIT } };
  const lane = (kind) => {
    const out = [];
    let row = pick(3);
    while (row < 16 && r() < 0.85) {
      const len = 1 + pick(Math.min(kind === 'noise' ? 8 : 16, 16 - row));
      const n = kind === 'noise' ? { row, len, drum: pick(8) } : { row, len, pitch: pick(62) };
      if (kind === 'pulse' && r() < 0.2) n.vol = pick(16);
      if (kind === 'pulse' && r() < 0.1) n.decay = pick(8);
      if (kind === 'pulse' && r() < 0.1) n.duty = pick(4);
      out.push(n);
      row += len + (r() < 0.4 ? pick(3) : 0);
    }
    return out;
  };
  const patterns = Array.from({ length: 1 + pick(16) }, () => ({ p1: lane('pulse'), p2: lane('pulse'), tri: lane('tri'), noise: lane('noise') }));
  // (some lanes copied, as songs do)
  for (let i = 1; i < patterns.length; i++) if (r() < 0.3) patterns[i].noise = plain(patterns[pick(i)].noise);
  return { tempo: 32 + pick(256), rpb: C.RPB[pick(4)], inst, patterns, order: Array.from({ length: 1 + pick(64) }, () => pick(patterns.length)) };
}

test('random songs: every one comes back exactly, and measure() agrees with the bytes', () => {
  const r = rng(2026);
  for (let i = 0; i < 400; i++) {
    const song = randomSong(r), norm = C.normalize(song), bytes = C.encode(song);
    assert.deepStrictEqual(plain(C.decode(bytes)), plain(norm), `song ${i}`);
    const m = C.measure(song);
    assert.strictEqual(m.bytes, bytes.length);
    assert.strictEqual(m.fitsJpeg, bytes.length <= 945);
  }
});

test('the biggest songs: 16 patterns of 1-row notes everywhere, with a volume change on every pulse note', () => {
  const full = (kind) => Array.from({ length: 16 }, (_, row) => (kind === 'noise' ? { row, len: 1, drum: row % 8 } : { row, len: 1, pitch: (row * 7) % 62, ...(kind === 'pulse' ? { vol: row % 2 ? 3 : 9 } : {}) }));
  // (every lane different, so none is a copy)
  const patterns = Array.from({ length: 16 }, (_, i) => ({ p1: full('pulse').map((n) => ({ ...n, pitch: (n.pitch + i) % 62 })), p2: full('pulse').map((n) => ({ ...n, pitch: (n.pitch + 2 * i) % 62 })),
    tri: full('tri').map((n) => ({ ...n, pitch: (n.pitch + 3 * i) % 62 })), noise: full('noise').map((n) => ({ ...n, drum: (n.row * 3 + i + (i >> 3) * n.row) % 8 })) }));
  const song = { tempo: 200, rpb: 4, inst: { p1: { vol: 15 }, p2: { vol: 15 } }, patterns, order: Array.from({ length: 64 }, (_, i) => i % 16) };
  const m = C.measure(song);
  // per pattern: 2 pulses × 16 × (10 + 18) + 16 × 10 + 16 × 7 + 4 lane flags = 1172 bits; 16 of them, after the header and 64 order entries of 4 bits
  assert.strictEqual(m.bytes, 1 + Math.ceil((48 + 64 * 4 + 16 * 1172) / 8));
  assert.ok(!m.fitsJpeg && m.fitsLossless, `${m.bytes} bytes: past JPEG-safe, inside lossless`);
  assert.deepStrictEqual(plain(C.decode(C.encode(song))), plain(C.normalize(song)));
});

test('limits: what the format can’t hold is refused, with a reason', () => {
  const ok = { tempo: 120, rpb: 4, patterns: [{}], order: [0] };
  const bad = (change, re) => assert.throws(() => C.encode({ ...ok, ...change }), re);
  bad({ tempo: 31 }, /tempo/); bad({ tempo: 288 }, /tempo/); bad({ tempo: 120.5 }, /tempo/);
  bad({ rpb: 5 }, /rows per beat/);
  bad({ patterns: [] }, /at least one pattern/);
  bad({ patterns: Array.from({ length: 17 }, () => ({})), order: [0] }, /at most 16 patterns/);
  bad({ order: [] }, /order is empty/);
  bad({ order: Array(65).fill(0) }, /at most 64/);
  bad({ order: [1] }, /order entry/);
  bad({ patterns: [{ p1: [{ row: 0, len: 4, pitch: 1 }, { row: 3, len: 2, pitch: 5 }] }] }, /overlap/);
  bad({ patterns: [{ p1: [{ row: 12, len: 5, pitch: 1 }] }] }, /past the end/);
  bad({ patterns: [{ tri: [{ row: 0, len: 17, pitch: 1 }] }] }, /length/);
  bad({ patterns: [{ tri: [{ row: 0, len: 0, pitch: 1 }] }] }, /length/);
  bad({ patterns: [{ p2: [{ row: 0, len: 1, pitch: 62 }] }] }, /pitch/);
  bad({ patterns: [{ noise: [{ row: 0, len: 9, drum: 0 }] }] }, /drum length/);
  bad({ patterns: [{ noise: [{ row: 0, len: 1, drum: 8 }] }] }, /drum/);
  bad({ patterns: [{ noise: [{ row: 0, len: 4, drum: 1 }, { row: 2, len: 1, drum: 2 }] }] }, /overlap/);
  bad({ inst: { p1: { duty: 4 } } }, /duty/);
  bad({ inst: { p1: { vol: 16 } } }, /volume/);
  bad({ inst: { p2: { decay: 8 } } }, /decay/);
  bad({ inst: { p2: { sweep: { shift: 0 } } } }, /sweep shift/);
  bad({ inst: { noise: { kit: [[1, 0]] } } }, /8 drums/);
  bad({ inst: { noise: { kit: C.KIT.map(() => [16, 0]) } } }, /drum period/);
  assert.throws(() => C.laneFromText('p1', 'C5:4 D5:4'), /fills 16 rows; this one fills 8/);
  assert.throws(() => C.laneFromText('noise', 'Q:16'), /no drum/);
  // (the triangle has no volume: a volume on its note is dropped, not stored)
  assert.deepStrictEqual(plain(C.normalize({ ...ok, patterns: [{ tri: [{ row: 0, len: 2, pitch: 3, vol: 5 }] }] }).patterns[0].tri), [{ row: 0, len: 2, pitch: 3 }]);
});

test('damaged data is refused: the checksum, the end, versions, reserved codes; trailing bytes are ignored', () => {
  const bytes = C.encode(C.fromText(TUNE_DEMO));
  let refused = 0, same = 0;
  for (let i = 0; i < bytes.length * 8; i++) {
    const b = Uint8Array.from(bytes);
    b[i >> 3] ^= 0x80 >> (i & 7);
    try { if (JSON.stringify(C.decode(b)) === JSON.stringify(C.decode(bytes))) same++; } catch { refused++; }
  }
  assert.strictEqual(same, 0, 'no flipped bit reads back as the same tune');
  assert.ok(refused / (bytes.length * 8) > 0.99, `${refused} of ${bytes.length * 8} flipped bits refused`);
  assert.throws(() => C.decode(bytes.slice(0, bytes.length - 1)), /checksum is missing/);
  assert.throws(() => C.decode(bytes.slice(0, 20)), /ends too soon/);
  assert.throws(() => C.decode([]), /ends too soon/);
  assert.deepStrictEqual(plain(C.decode(Uint8Array.from([...bytes, 1, 2, 3, 255]))), plain(C.decode(bytes)), 'what comes after the checksum (the rest of a corner) is ignored');
  assert.throws(() => C.decode(bits([[2, 3], ...HEADER.slice(1), [2, 2], [2, 2], [2, 2], [2, 2]])), /unknown format version 2/);
  assert.throws(() => C.decode(bits([...HEADER, [3, 2]])), /first pattern can’t copy/);
  assert.throws(() => C.decode(bits([...HEADER, [0, 1], [63, 6], [2, 4], [0, 8]])), /escape 2 is reserved/);
  assert.throws(() => C.decode(bits([...HEADER, [2, 2], [2, 2], [0, 1], [63, 6], [0, 4], [0xa0, 8]])), /triangle has no settings/);
  assert.throws(() => C.decode(bits([...HEADER, [0, 1], [62, 6], [3, 4], [5, 6], [15, 4]])), /past the end/);
});

test('the synth loads on its own and has the chip’s tables', () => {
  assert.strictEqual(S.CPU, 1789773);
  assert.strictEqual(S.NOISE_PERIODS.length, 16);
  assert.deepStrictEqual(S.DUTY.map((d) => d.reduce((a, b) => a + b, 0)), [1, 2, 4, 6]);
  assert.strictEqual(S.TRI.length, 32);
  assert.deepStrictEqual([...new Set(S.TRI)].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i), 'the triangle: 16 steps');
  for (const k of ['create', 'player', 'render']) assert.strictEqual(typeof S[k], 'function');
});
