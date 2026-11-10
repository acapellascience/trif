'use strict';
// Test tunes for the Tune Composer's format (tests/tune-codec.test.js, tests/dev/measure-tunes.js): three
// originals in the lane text of TuneCodec.fromText, each leaning on something different, and random songs.

// melody-heavy: a lead that keeps moving (steps, leaps, runs), a held harmony, an 8ths bass, a light beat
const KITE = {
  name: 'Kite (melody)', tempo: 132, rpb: 4,
  inst: { p1: { duty: 2, vol: 11, decay: 5 }, p2: { duty: 1, vol: 5, decay: 0 }, noise: { vol: 9 } },
  patterns: [
    { p1: 'G5:2 A5:1 B5:1 D6:2 B5:2 C6:1 B5:1 A5:1 G5:1 A5:4', p2: 'B4:4 D5:4 E5:4 D5:4',
      tri: 'G2:2 G3:2 D3:2 G3:2 E2:2 E3:2 B2:2 E3:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'B5:2 C6:1 D6:1 E6:2 D6:2 C6:1 B5:1 A5:1 B5:1 G5:4', p2: 'D5:4 E5:4 F#5:4 D5:4',
      tri: 'C3:2 C4:2 G3:2 C4:2 D3:2 D4:2 A3:2 D4:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'E6:1 D6:1 C6:1 B5:1 C6:2 E6:2 D6:1 C6:1 B5:1 A5:1 B5:4', p2: 'C5:4 E5:4 F#5:4 D5:4',
      tri: 'A2:2 A3:2 E3:2 A3:2 B2:2 B3:2 F#3:2 B3:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'A5:1 B5:1 C6:1 D6:1 E6:1 F#6:1 G6:2 F#6:2 D6:2 A5:4', p2: 'F#5:4 D5:4 A4:4 D5:4',
      tri: 'D3:2 D4:2 A3:2 D4:2 D3:2 C4:2 A3:2 F#3:2', noise: 'K:2 H:2 S:2 H:2 K:2 S:1 S:1 S:1 S:1 S:2' },
    { p1: 'G6:2 F#6:1 E6:1 D6:2 B5:2 C6:2 A5:2 F#5:4', p2: 'B5:4 G5:4 E5:4 D5:4',
      tri: 'E2:2 E3:2 B2:2 E3:2 C3:2 C4:2 G3:2 C4:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'G5:1 B5:1 D6:1 G6:1 F#6:1 D6:1 A5:1 F#6:1 E6:2 C6:2 A5:4', p2: 'B4:4 F#5:4 C5:4 C5:4',
      tri: 'G2:2 G3:2 D3:2 G3:2 A2:2 A3:2 E3:2 A3:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'B5:1 A5:1 G5:1 A5:1 B5:2 D6:2 C6:1 B5:1 A5:1 G5:1 F#5:4', p2: 'D5:4 G5:4 E5:4 D5:4',
      tri: 'C3:2 C4:2 G3:2 C4:2 D3:2 D4:2 A3:2 D4:2', noise: 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2' },
    { p1: 'G5:2 D6:2 B5:2 G5:2 G6:6 -:2', p2: 'B4:4 D5:4 B5:8',
      tri: 'G2:4 D3:4 G2:8', noise: 'X:8 K:4 -:4' },
  ],
  order: [0, 1, 2, 3, 4, 5, 6, 7],
};

// drum-heavy: 16th-note beats and fills, a bass riff moved to each chord, stabs moved with it
const PINBALL = {
  name: 'Pinball (drums)', tempo: 160, rpb: 4,
  inst: { p1: { duty: 2, vol: 12, decay: 2 }, p2: { duty: 1, vol: 5, decay: 0 }, noise: { vol: 12 } },
  patterns: [
    { p1: '-:2 E5:1 -:3 G5:1 -:1 B5:1 -:3 E5:1 -:3', p2: 'E4:8 D4:8',
      tri: 'E2:2 E2:1 E3:1 -:1 E2:1 D3:2 E2:2 E2:1 G2:1 -:1 A2:1 B2:2', noise: 'K:1 H:1 H:1 H:1 S:1 H:1 K:1 H:1 K:1 H:1 H:1 K:1 S:1 H:1 H:1 O:1' },
    { p1: '-:2 A5:1 -:3 C6:1 -:1 E6:1 -:3 A5:1 -:3', p2: 'A4:8 G4:8',
      tri: 'A2:2 A2:1 A3:1 -:1 A2:1 G3:2 A2:2 A2:1 C3:1 -:1 D3:1 E3:2', noise: 'K:1 H:1 K:1 H:1 S:1 H:1 H:1 K:1 H:1 K:1 H:1 H:1 S:1 S:1 T:1 L:1' },
    { p1: '-:2 C6:1 -:3 E6:1 -:1 G6:1 -:3 C6:1 -:3', p2: 'C5:8 B4:8',
      tri: 'C3:2 C3:1 C4:1 -:1 C3:1 B3:2 C3:2 C3:1 E3:1 -:1 F3:1 G3:2', noise: 'K:1 H:1 H:1 K:1 C:1 H:1 K:1 H:1 K:1 H:1 H:1 K:1 C:1 H:1 S:1 S:1' },
    { p1: '-:2 B5:1 -:3 D#6:1 -:1 F#6:1 -:3 B5:1 -:3', p2: 'B4:8 A4:8',
      tri: 'B2:2 B2:1 B3:1 -:1 B2:1 A3:2 B2:2 B2:1 D3:1 -:1 E3:1 F#3:2', noise: 'K:2 O:2 S:1 H:1 K:1 K:1 H:1 K:1 O:2 S:1 H:1 S:1 S:1' },
    { p1: 'E6:2 D6:1 B5:1 A5:2 B5:2 G5:1 A5:1 B5:2 D6:2 E6:2', p2: 'E4:16',
      tri: 'E2:2 E2:1 E3:1 -:1 E2:1 D3:2 E2:2 E2:1 G2:1 -:1 A2:1 B2:2', noise: 'K:1 H:1 S:1 H:1 K:1 H:1 S:1 H:1 K:1 H:1 S:1 H:1 T:1 T:1 L:1 L:1' },
    { p1: 'E6:8 -:8', p2: '-:16',
      tri: 'E2:4 E3:4 B2:4 E2:4', noise: 'S:1 S:1 S:1 S:1 T:1 T:1 T:1 T:1 L:1 L:1 L:1 L:1 X:4' },
  ],
  order: [0, 1, 0, 2, 3, 4, 3, 5],
};

// chord-based: 16th arpeggios over i–VI–III–VII and on, a bass that walks the chords, a held pad
const LANTERN = {
  name: 'Lantern (chords)', tempo: 112, rpb: 4,
  inst: { p1: { duty: 0, vol: 8, decay: 3 }, p2: { duty: 2, vol: 6, decay: 0 }, noise: { vol: 9 } },
  patterns: [
    { p1: 'D5:1 F5:1 A5:1 D6:1 A5:1 F5:1 D5:1 F5:1 A5:1 D6:1 A5:1 F5:1 D5:1 F5:1 A5:1 F5:1', p2: 'F4:8 A4:8',
      tri: 'D2:4 A2:2 D3:2 C3:4 A2:2 F2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'D5:1 F5:1 Bb5:1 D6:1 Bb5:1 F5:1 D5:1 F5:1 Bb5:1 D6:1 Bb5:1 F5:1 D5:1 F5:1 Bb5:1 F5:1', p2: 'F4:8 D4:8',
      tri: 'Bb1:4 F2:2 Bb2:2 A2:4 F2:2 D2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'C5:1 F5:1 A5:1 C6:1 A5:1 F5:1 C5:1 F5:1 A5:1 C6:1 A5:1 F5:1 C5:1 F5:1 A5:1 F5:1', p2: 'A4:8 C5:8',
      tri: 'F2:4 C3:2 F3:2 E3:4 C3:2 A2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'C5:1 E5:1 G5:1 C6:1 G5:1 E5:1 C5:1 E5:1 G5:1 C6:1 G5:1 E5:1 C5:1 E5:1 G5:1 E5:1', p2: 'G4:8 E4:8',
      tri: 'C2:4 G2:2 C3:2 B2:4 G2:2 E2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'D5:1 G5:1 Bb5:1 D6:1 Bb5:1 G5:1 D5:1 G5:1 Bb5:1 D6:1 Bb5:1 G5:1 D5:1 G5:1 Bb5:1 G5:1', p2: 'Bb4:8 G4:8',
      tri: 'G1:4 D2:2 G2:2 F2:4 D2:2 Bb1:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'C#5:1 E5:1 A5:1 C#6:1 A5:1 E5:1 C#5:1 E5:1 A5:1 C#6:1 A5:1 E5:1 C#5:1 E5:1 A5:1 E5:1', p2: 'A4:8 C#5:8',
      tri: 'A1:4 E2:2 A2:2 G2:4 E2:2 C#2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'D5:1 F5:1 A5:1 D6:1 F6:4 E6:4 D6:4', p2: 'F4:16',
      tri: 'D2:4 A2:2 D3:2 C3:4 A2:2 F2:2', noise: 'K:4 H:2 H:2 S:4 H:2 H:2' },
    { p1: 'D6:12 -:4', p2: 'A4:12 -:4', tri: 'D2:12 -:4', noise: 'X:8 -:8' },
  ],
  order: [0, 1, 2, 3, 0, 1, 4, 5, 6, 7],
};

// a seeded random source, so a failing song can be found again
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// a random song: notes anywhere, settings of their own, some lanes copied (and moved), up to `maxPatterns`
function randomSong(r, { maxPatterns = 64, maxOrder = 256, kit = [[10, 0], [7, 0], [1, 0], [1, 0], [7, 1], [5, 1], [5, 0], [3, 0]] } = {}) {
  const pick = (n) => Math.floor(r() * n);
  const pulse = () => ({ duty: pick(4), vol: pick(16), decay: pick(8), sweep: r() < 0.3 ? { neg: r() < 0.5, period: pick(8), shift: 1 + pick(7) } : null });
  const inst = { p1: pulse(), p2: pulse(), noise: { vol: pick(16), kit: r() < 0.3 ? Array.from({ length: 8 }, () => [pick(16), pick(2)]) : kit } };
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
  const patterns = Array.from({ length: 1 + pick(r() < 0.8 ? 16 : maxPatterns) }, () => ({ p1: lane('pulse'), p2: lane('pulse'), tri: lane('tri'), noise: lane('noise') }));
  // (some lanes copied, some moved, as songs do)
  for (let i = 1; i < patterns.length; i++) {
    if (r() < 0.3) patterns[i].noise = JSON.parse(JSON.stringify(patterns[pick(i)].noise));
    if (r() < 0.2) { const t = pick(7) - 3; const src = patterns[pick(i)].tri; if (src.every((n) => n.pitch + t >= 0 && n.pitch + t < 62)) patterns[i].tri = src.map((n) => ({ ...n, pitch: n.pitch + t })); }
  }
  return { tempo: 32 + pick(256), rpb: [2, 3, 4, 6][pick(4)], inst, patterns, order: Array.from({ length: 1 + pick(r() < 0.8 ? 64 : maxOrder) }, () => pick(patterns.length)) };
}

module.exports = { SONGS: [KITE, PINBALL, LANTERN], rng, randomSong };
