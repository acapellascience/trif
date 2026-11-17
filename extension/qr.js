// A small QR code encoder, TRIF's own (no dependency, nothing fetched): the side panel draws "Connect a
// phone"'s code with it (phonelink.js). Only what that needs: byte mode (the text's UTF-8), versions 1 to 10,
// error correction M, or L when M has no room (about 270 bytes at most), the eight masks with the standard's
// scoring. ISO/IEC 18004's steps, in its order: the bits, the blocks and their Reed–Solomon codewords, the
// fixed patterns, the zigzag, the mask, the format and version bits.
//
// qrMatrix(text) → {version, level, mask, size, rows} (rows[y][x] is 1 for a dark module, no quiet zone);
// qrPath(qr, quiet) → {d, size}: one SVG path of the dark modules inside a quiet zone, for a viewBox of
// `0 0 size size`. Checked against another encoder's matrices and a decoder: tests/phone-link-qr.test.js.

// Per version (index 1 to 10): the codewords in all, and per level the error correction codewords of each
// block and the blocks as [how many, data codewords each] (the standard's table 9).
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const BLOCKS = {
  M: [null, [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]],
    [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
  L: [null, [7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]],
    [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
};
// The alignment patterns' centres (rows and columns), per version.
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const LEVEL_BITS = { L: 1, M: 0 };
export const QR_MAX_VERSION = 10;

// GF(256), the standard's polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x; LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The Reed–Solomon generator of `n` error correction codewords (its coefficients, the leading 1 left out). */
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g.slice(1);
}

/** The `n` error correction codewords of a block's data. */
function remainder(data, n) {
  const g = generator(n);
  const r = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(g[i], f);
  }
  return r;
}

const dataCodewords = (version, level) => BLOCKS[level][version].slice(1).reduce((n, [count, each]) => n + count * each, 0);
// (byte mode: 4 bits of mode, then the count in 8 bits up to version 9 and 16 from 10 on)
const capacity = (version, level) => Math.floor((dataCodewords(version, level) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);

/** The smallest version (and the level: M, else L) that holds `n` bytes, or null. */
export function qrFit(n, level) {
  for (const lv of level ? [level] : ['M', 'L']) {
    for (let v = 1; v <= QR_MAX_VERSION; v++) if (capacity(v, lv) >= n) return { version: v, level: lv };
  }
  return null;
}

/** Every codeword of the symbol, in the order they are placed: the blocks' data interleaved, then their error correction. */
function codewords(bytes, version, level) {
  const total = dataCodewords(version, level);
  const bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ec, ...groups] = BLOCKS[level][version];
  const blocks = [];
  let at = 0;
  for (const [count, each] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(at, at + each);
      at += each;
      blocks.push({ d, e: remainder(d, ec) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  if (out.length !== TOTAL[version]) throw new Error('qr: the codewords don\'t add up');
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The symbol before masking: {size, m (rows of modules), fixed (rows: 1 where a module isn't data)}. */
function layout(version, words) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Uint8Array(size));
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = dark ? 1 : 0; fixed[y][x] = 1; } };

  // The three finder patterns with their separators, the timing lines, the alignment patterns
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const centres = ALIGN[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const last = centres[centres.length - 1];
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue; // a finder is there
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Room for the format bits (written after the mask is chosen) and the module that is always dark
  for (let i = 0; i < 9; i++) { set(8, i, m[i][8]); set(i, 8, m[8][i]); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, 0); set(8, size - 1 - i, 0); }
  set(8, size - 8, 1);
  // The version, twice (from version 7 on): 6 bits and their 12 check bits
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, (bits >>> i) & 1);
      set(b, a, (bits >>> i) & 1);
    }
  }
  // The codewords, in the zigzag: two columns at a time from the right, up then down, past the timing column
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (fixed[y][x] || i >= words.length * 8) continue;
        m[y][x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
  if (i !== words.length * 8) throw new Error('qr: the codewords don\'t fit the symbol');
  return { size, m, fixed };
}

/** The 15 format bits (the level and the mask, with their check bits), written in their two places. */
function writeFormat(rows, size, level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) rows[i][8] = bit(i);
  rows[7][8] = bit(6);
  rows[8][8] = bit(7);
  rows[8][7] = bit(8);
  for (let i = 9; i < 15; i++) rows[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) rows[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) rows[size - 15 + i][8] = bit(i);
}

/** The standard's score of a finished symbol (lower is easier to read): runs, blocks, finder look-alikes, balance. */
export function qrPenalty(rows) {
  const size = rows.length;
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    // 1:1:3:1:1 dark, with four light modules on one side
    for (let i = 0; i + 11 <= size; i++) {
      let a = 0;
      for (let j = 0; j < 11; j++) a = (a << 1) | get(i + j);
      if (a === 0b10111010000 || a === 0b00001011101) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => rows[y][x]);
  for (let x = 0; x < size; x++) line((y) => rows[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      dark += rows[y][x];
      if (x + 1 < size && y + 1 < size && rows[y][x] === rows[y][x + 1] && rows[y][x] === rows[y + 1][x] && rows[y][x] === rows[y + 1][x + 1]) score += 3;
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * The QR code of `text` (its UTF-8 bytes): {version, level, mask, size, rows}. `level` ('M' or 'L') and
 * `mask` (0 to 7) are chosen when not given: M if it fits in version 10, and the mask with the lowest score.
 * Throws when the text is too long for version 10.
 */
export function qrMatrix(text, { level, mask } = {}) {
  const bytes = new TextEncoder().encode(String(text));
  if (level !== undefined && !(level in LEVEL_BITS)) throw new Error('qr: the level is M or L');
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask < 8)) throw new Error('qr: the mask is 0 to 7');
  const fit = qrFit(bytes.length, level);
  if (!fit) throw new Error('qr: too long for a code this size');
  const { size, m, fixed } = layout(fit.version, codewords(bytes, fit.version, fit.level));
  const masked = (k) => {
    const rows = m.map((row) => Uint8Array.from(row));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[k](x, y)) rows[y][x] ^= 1;
    writeFormat(rows, size, fit.level, k);
    return rows;
  };
  let best = null;
  for (const k of mask !== undefined ? [mask] : [0, 1, 2, 3, 4, 5, 6, 7]) {
    const rows = masked(k);
    const score = qrPenalty(rows);
    if (!best || score < best.score) best = { rows, score, mask: k };
  }
  return { version: fit.version, level: fit.level, mask: best.mask, size, rows: best.rows };
}

/** One SVG path for the dark modules, each row's runs as a rectangle, inside `quiet` light modules: {d, size}. */
export function qrPath(qr, quiet = 4) {
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.rows[y][x]) continue;
      let w = 1;
      while (x + w < qr.size && qr.rows[y][x + w]) w++;
      d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return { d, size: qr.size + quiet * 2 };
}
