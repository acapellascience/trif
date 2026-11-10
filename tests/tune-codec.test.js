'use strict';
// examples/sites/x.com/tune-composer.js: its song format (TuneCodec, the block between /* tune-codec:begin */
// and /* tune-codec:end */, loaded on its own, as Style Encoder and Profile Styler will load it): round trips in
// both formats (2: plain prefix codes, 3: the range coder, what's saved), exact costs, what the structure buys
// (repeats, moved copies, keys), limits, damaged data. Sizes against the first format: tests/dev/measure-tunes.js.
// The sound is checked in a browser (tests/dev/check.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseHeader } = require('../helper/lib/mods');
const { powersOf } = require('../helper/lib/powers');
const { PREINSTALLED } = require('../helper/lib/preinstalled');
const { SONGS, rng, randomSong } = require('./tune-songs');

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
const size = (song, format = 3) => C.encode(song, { format }).length;
const back = (song, format) => plain(C.decode(C.encode(song, { format })));
const roundTrips = (song, what) => {
  const norm = plain(C.normalize(song));
  for (const format of [2, 3]) {
    const bytes = C.encode(song, { format });
    assert.deepStrictEqual(plain(C.decode(bytes)), norm, `${what}, format ${format}`);
    assert.deepStrictEqual([...C.encode(C.decode(bytes), { format })], [...bytes], `${what}, format ${format}: the same bytes again`);
  }
};
const crc = (bytes) => { let c = 0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 0xff : (c << 1) & 0xff; } return c; };
// a format-2 song by hand: its payload's bits, framed (version, length, payload, CRC)
function framed(fields) {
  const body = [];
  let n = 0;
  for (const [v, w] of fields) for (let i = w - 1; i >= 0; i--) { if (!(n & 7)) body.push(0); if ((v >>> i) & 1) body[body.length - 1] |= 0x80 >>> (n & 7); n++; }
  const all = [(2 << 5) | (body.length >> 8), body.length & 0xff, ...body];
  return Uint8Array.from([...all, crc(all)]);
}
// a one-pattern, one-bar song's settings in format 2: tempo 150, 4 rows a beat, no key, the default instruments
const SETTINGS = [[150 - 32, 8], [2, 2], [12, 4], [2, 2], [10, 4], [0, 3], [0, 1], [2, 2], [10, 4], [0, 3], [0, 1], [12, 4], [0, 1], [0, 6], [0, 8], [0, 1]];
const EMPTY = [0b100, 3]; // (a lane: empty)
const base = { tempo: 150, rpb: 4, patterns: [{}], order: [0] };

test('tune-composer: its header, not preinstalled, and nothing TRIF would hold it for', () => {
  const h = parseHeader(SRC);
  assert.strictEqual(h.name, 'Tune Composer');
  assert.deepStrictEqual(h.matches, ['https://x.com/*']);
  assert.strictEqual(h.runAt, 'document_idle');
  assert.strictEqual(h.risk.tier, 0);
  assert.strictEqual(h.source, 'trif');
  assert.ok(!PREINSTALLED.some((p) => p.id === 'x.com/tune-composer'));
  assert.deepStrictEqual(powersOf(SRC, { sites: ['x.com'] }), [], 'no sends, loads, navigation or hidden code');
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'http://', 'Math.random', 'Date.now']) assert.ok(!block('tune-codec').includes(word), word);
});

test('the budget: three corners, lossless about 3.8 KB, JPEG-safe about 950 B; the limits: 64 patterns, 256 bars', () => {
  assert.deepStrictEqual(plain(C.BUDGET), { lossless: 3780, jpeg: 945 });
  assert.strictEqual(C.MAX_PATTERNS, 64);
  assert.strictEqual(C.MAX_ORDER, 256);
  assert.strictEqual(C.VERSION, 3);
});

test('the codes: every tier a power of two, every value in its alphabet', () => {
  for (const [m, [n, tiers]] of Object.entries(C.MODELS)) {
    const seen = new Set();
    for (const tier of tiers) {
      assert.ok(tier.length && (tier.length & (tier.length - 1)) === 0, `${m}: a tier of ${tier.length}`);
      for (const v of tier) { assert.ok(Number.isInteger(v) && v >= 0 && v < n, `${m}: ${v}`); assert.ok(!seen.has(v), `${m}: ${v} twice`); seen.add(v); }
    }
  }
});

test('a blank song: format 2 exactly as described (66 bits: settings, one bar, four empty lanes), format 3 11 bytes', () => {
  const blank = C.blank();
  assert.deepStrictEqual([...C.encode(blank, { format: 2 })], [...framed([...SETTINGS, EMPTY, EMPTY, EMPTY, EMPTY])]);
  assert.strictEqual(size(blank, 2), 12);
  assert.strictEqual(size(blank), 11);
  roundTrips(blank, 'blank');
});

test('exact costs in format 2: a note, a note with its own volume, a hit and a rest', () => {
  // a 16-row note on the anchor pitch (24): lane 0, event 0, interval 0 (3 bits), length 16 (7 bits): 66 − 3 + 12 bits
  const note = { ...base, patterns: [{ p1: [{ row: 0, len: 16, pitch: 24 }] }] };
  assert.deepStrictEqual([...C.encode(note, { format: 2 })], [...framed([...SETTINGS, [0, 1], [0, 1], [0, 3], [0b1110000, 7], EMPTY, EMPTY, EMPTY])]);
  // its own volume: a settings change first (4 bits), its kind (2) and the volume (4)
  const loud = { ...base, patterns: [{ p1: [{ row: 0, len: 16, pitch: 24, vol: 3 }] }] };
  assert.deepStrictEqual([...C.encode(loud, { format: 2 })], [...framed([...SETTINGS, [0, 1], [0b1111, 4], [0, 2], [3, 4], [0, 1], [0, 3], [0b1110000, 7], EMPTY, EMPTY, EMPTY])]);
  // an open hat of 8 rows (drum 3 bits, length 6), then a rest of 8 (event 3 bits, length 4)
  const hit = { ...base, patterns: [{ noise: [{ row: 0, len: 8, drum: 3 }] }] };
  assert.deepStrictEqual([...C.encode(hit, { format: 2 })], [...framed([...SETTINGS, EMPTY, EMPTY, EMPTY, [0, 1], [0, 1], [0b101, 3], [0b111000, 6], [0b100, 3], [0b1011, 4]])]);
  for (const s of [note, loud, hit]) roundTrips(s, 'exact');
});

test('repeats: a bar of 16 hats is a hit and one repeat; a riff played four times costs little more than once', () => {
  const hats = { ...base, patterns: [{ noise: Array.from({ length: 16 }, (_, row) => ({ row, len: 1, drum: 2 })) }] };
  assert.ok(size(hats, 2) - size(C.blank(), 2) <= 3, `${size(hats, 2)} bytes`);
  assert.ok(size(hats) - size(C.blank()) <= 3, `${size(hats)} bytes`);
  roundTrips(hats, 'hats');
  const riff = [{ row: 0, len: 1, pitch: 20 }, { row: 1, len: 1, pitch: 27 }, { row: 2, len: 1, pitch: 32 }, { row: 3, len: 1, pitch: 30 }];
  const once = { ...base, patterns: [{ tri: riff }] };
  const four = { ...base, patterns: [{ tri: [0, 4, 8, 12].flatMap((r) => riff.map((n) => ({ ...n, row: n.row + r }))) }] };
  assert.ok(size(four) - size(once) <= 2, `${size(once)} → ${size(four)} bytes`);
  // moved each time: a sequence (repeat with a shift, overlapping itself)
  const climb = { ...base, patterns: [{ tri: [0, 4, 8, 12].flatMap((r, i) => riff.map((n) => ({ ...n, row: n.row + r, pitch: n.pitch + 2 * i }))) }] };
  assert.ok(size(climb) - size(once) <= 3, `${size(once)} → ${size(climb)} bytes`);
  for (const s of [once, four, climb]) roundTrips(s, 'riff');
});

test('lanes taken from earlier patterns (moved) and from other channels: a few bits each', () => {
  const demo = C.fromText(TUNE_DEMO);
  const a = demo.patterns[0];
  const up = (lane, t) => lane.map((n) => ({ ...n, pitch: n.pitch + t }));
  // pattern B: pattern A moved up 5 semitones, every melodic lane
  const moved = { ...demo, patterns: [a, { p1: up(a.p1, 5), p2: up(a.p2, 5), tri: up(a.tri, 5), noise: a.noise }], order: [0, 1] };
  const alone = { ...demo, patterns: [a], order: [0, 0] };
  assert.ok(size(moved) - size(alone) <= 3, `${size(alone)} → ${size(moved)} bytes`);
  // Pulse 2 doubling Pulse 1 an octave down, and the triangle two octaves down
  const doubled = { ...demo, patterns: [{ p1: a.p1, p2: up(a.p1, -12), tri: up(a.p1, -24 + 12), noise: [] }], order: [0] };
  const lead = { ...demo, patterns: [{ p1: a.p1 }], order: [0] };
  assert.ok(size(doubled) - size(lead) <= 3, `${size(lead)} → ${size(doubled)} bytes`);
  for (const s of [moved, doubled]) roundTrips(s, 'copies');
});

test('a key: a tune in a key costs less than the same tune with every note outside it', () => {
  const scale = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0, 2];
  const tune = (notes) => ({ ...base, patterns: [{ p1: notes.map((p, row) => ({ row, len: 1, pitch: 24 + p })) }] });
  const inKey = tune(scale), chromatic = tune([0, 1, 3, 6, 10, 11, 8, 2, 9, 4, 7, 5, 1, 6, 0, 3]);
  assert.ok(size(inKey, 2) < size(chromatic, 2) - 2, `${size(inKey, 2)} vs ${size(chromatic, 2)}`);
  // (in any key: the same tune moved to every pitch class)
  for (let t = 1; t < 12; t++) assert.ok(size(tune(scale.map((p) => p + t)), 2) < size(chromatic, 2) - 2, `moved ${t}`);
  roundTrips(inKey, 'in key'); roundTrips(chromatic, 'chromatic');
  // a tune in a key, with a sharp (C major, F#)
  roundTrips(tune([0, 2, 4, 6, 7, 6, 4, 2, 0, 2, 4, 5, 7, 9, 11, 12]), 'a sharp');
});

test('the demo and the test songs: round trips, and their sizes (format 3, about half the first format)', () => {
  const demo = C.fromText(TUNE_DEMO);
  roundTrips(demo, 'demo');
  // (the first format, git 8e21091: demo 215, Kite 233, Pinball 229, Lantern 222)
  const limits = { demo: 125, 'Kite (melody)': 120, 'Pinball (drums)': 110, 'Lantern (chords)': 95 };
  assert.ok(size(demo) <= limits.demo, `demo: ${size(demo)} bytes`);
  assert.ok(C.measure(demo).fitsJpeg);
  assert.strictEqual(demo.patterns[5].p1.find((n) => n.vol).vol, 13, 'one accented note (a settings change)');
  for (const spec of SONGS) {
    const s = C.fromText(spec);
    roundTrips(s, spec.name);
    assert.ok(size(s) <= limits[spec.name], `${spec.name}: ${size(s)} bytes`);
    assert.ok(size(s) < size(s, 2), `${spec.name}: the range coder saves bytes`);
  }
  // base64, as Save keeps it
  const bytes = C.encode(demo), b64 = C.toBase64(bytes);
  assert.strictEqual(b64, Buffer.from(bytes).toString('base64'));
  assert.deepStrictEqual([...C.fromBase64(b64)], [...bytes]);
});

test('random songs: 450 come back exactly in both formats (up to 64 patterns, 256 bars)', () => {
  const r = rng(2026);
  for (let i = 0; i < 450; i++) {
    const song = randomSong(r);
    roundTrips(song, `song ${i}`);
    const m = C.measure(song);
    assert.strictEqual(m.bytes, size(song));
    assert.strictEqual(m.fitsJpeg, m.bytes <= 945);
  }
});

test('the biggest songs: 64 patterns of 1-row notes everywhere, each with a volume of its own', () => {
  const r = rng(5), pick = (n) => Math.floor(r() * n);
  const full = () => Array.from({ length: 16 }, (_, row) => ({ row, len: 1, pitch: pick(62), vol: pick(16) }));
  const song = { tempo: 200, rpb: 4, patterns: Array.from({ length: 64 }, () => ({ p1: full(), p2: full(), tri: full(), noise: Array.from({ length: 16 }, (_, row) => ({ row, len: 1, drum: pick(8) })) })), order: Array.from({ length: 256 }, () => pick(64)) };
  const m = C.measure(song);
  assert.ok(!m.fitsLossless && m.bytes < 8191, `${m.bytes} bytes: past what a picture holds, still written`);
  roundTrips(song, 'biggest');
});

test('limits: what the format can’t hold is refused, with a reason', () => {
  const ok = { tempo: 120, rpb: 4, patterns: [{}], order: [0] };
  const bad = (change, re) => assert.throws(() => C.encode({ ...ok, ...change }), re);
  bad({ tempo: 31 }, /tempo/); bad({ tempo: 288 }, /tempo/); bad({ tempo: 120.5 }, /tempo/);
  bad({ rpb: 5 }, /rows per beat/);
  bad({ patterns: [] }, /at least one pattern/);
  bad({ patterns: Array.from({ length: 65 }, () => ({})), order: [0] }, /at most 64 patterns/);
  bad({ order: [] }, /order is empty/);
  bad({ order: Array(257).fill(0) }, /at most 256/);
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
  assert.throws(() => C.encode(ok, { format: 1 }), /no format 1/);
  assert.throws(() => C.laneFromText('p1', 'C5:4 D5:4'), /fills 16 rows; this one fills 8/);
  assert.throws(() => C.laneFromText('noise', 'Q:16'), /no drum/);
  // (the triangle has no volume: a volume on its note is dropped, not stored)
  assert.deepStrictEqual(plain(C.normalize({ ...ok, patterns: [{ tri: [{ row: 0, len: 2, pitch: 3, vol: 5 }] }] }).patterns[0].tri), [{ row: 0, len: 2, pitch: 3 }]);
});

test('damaged data is refused: flipped bits, the end, versions, crafted streams; bytes after it are ignored', () => {
  for (const format of [2, 3]) {
    const bytes = C.encode(C.fromText(TUNE_DEMO), { format }), good = JSON.stringify(C.decode(bytes));
    let refused = 0, same = 0;
    for (let i = 0; i < bytes.length * 8; i++) {
      const b = Uint8Array.from(bytes);
      b[i >> 3] ^= 0x80 >> (i & 7);
      try { if (JSON.stringify(C.decode(b)) === good) same++; } catch { refused++; }
    }
    assert.strictEqual(same, 0, `format ${format}: no flipped bit reads back as the same tune`);
    assert.ok(refused / (bytes.length * 8) > 0.99, `format ${format}: ${refused} of ${bytes.length * 8} flipped bits refused`);
    assert.throws(() => C.decode(bytes.slice(0, bytes.length - 1)), /ends too soon/);
    assert.throws(() => C.decode(bytes.slice(0, 2)), /ends too soon/);
    assert.deepStrictEqual(plain(C.decode(Uint8Array.from([...bytes, 1, 2, 3, 255]))), plain(C.decode(bytes)), 'what comes after the checksum (the rest of a corner) is ignored');
  }
  assert.throws(() => C.decode([]), /ends too soon/);
  // the first format (version 1) and unknown ones
  const old = Uint8Array.from([0x3a, 0xd6, 0x9b]);
  assert.throws(() => C.decode(old), /unknown format version 1/);
  const v4 = framed([...SETTINGS, EMPTY, EMPTY, EMPTY, EMPTY]); v4[0] = (4 << 5) | (v4[0] & 31);
  assert.throws(() => C.decode(v4), /unknown format version 4/);
  // crafted, with a right checksum: a copy before the first pattern, settings on the triangle, a repeat of nothing
  assert.throws(() => C.decode(framed([...SETTINGS, [0b101, 3], [0b000, 3], [0, 1]])), /isn’t there yet/);
  assert.throws(() => C.decode(framed([...SETTINGS, EMPTY, EMPTY, [0, 1], [0b1111, 4]])), /no settings to change/);
  assert.throws(() => C.decode(framed([...SETTINGS, [0, 1], [0b101, 3], [0, 3], [0, 3], [0, 1]])), /reaches back too far/);
  assert.throws(() => C.decode(framed([...SETTINGS.slice(0, 2), [13, 4], ...SETTINGS.slice(3), EMPTY, EMPTY, EMPTY, EMPTY])), /damaged/);
});

test('the synth loads on its own and has the chip’s tables', () => {
  assert.strictEqual(S.CPU, 1789773);
  assert.strictEqual(S.NOISE_PERIODS.length, 16);
  assert.deepStrictEqual(S.DUTY.map((d) => d.reduce((a, b) => a + b, 0)), [1, 2, 4, 6]);
  assert.strictEqual(S.TRI.length, 32);
  assert.deepStrictEqual([...new Set(S.TRI)].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i), 'the triangle: 16 steps');
  for (const k of ['create', 'player', 'render']) assert.strictEqual(typeof S[k], 'function');
});
