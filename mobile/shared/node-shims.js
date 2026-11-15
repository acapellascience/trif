// Stand-ins for the Node built-ins the helper's files name (mobile/prepare.js bundles them into shared/gen/mods.js,
// which the iPhone app runs in JavaScriptCore). Only what reading a mod uses works: sha1 (a mod's hash, as the
// helper makes it), a path's last part, a syntax check (powers.js "compiles"), a string's size in bytes. The
// file system isn't there: anything that would touch it throws.

const nothing = (what) => () => { throw new Error(`${what} isn't there on the phone`); };

// SHA-1 of a string's UTF-8 bytes, as hex (crypto.createHash('sha1').update(text).digest('hex')).
function sha1Hex(text) {
  const bytes = utf8(String(text));
  const ml = bytes.length;
  const withPad = ((ml + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(withPad);
  m.set(bytes);
  m[ml] = 0x80;
  const bits = ml * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(withPad - 4, bits >>> 0);
  dv.setUint32(withPad - 8, Math.floor(bits / 0x100000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

function utf8(s) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
  const out = [];
  for (const ch of s) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

const pathShim = {
  sep: '/',
  basename: (p, ext) => { const b = String(p).split('/').filter(Boolean).pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  dirname: (p) => { const s = String(p).split('/'); s.pop(); return s.join('/') || '/'; },
  extname: (p) => { const b = pathShim.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
  join: (...parts) => parts.filter((x) => x !== '').join('/').replace(/\/+/g, '/'),
  resolve: (...parts) => pathShim.join(...parts),
  isAbsolute: (p) => String(p).startsWith('/'),
  relative: (a, b) => String(b),
};

const BUILTINS = {
  fs: new Proxy({}, { get: (t, k) => (k === 'realpathSync' ? Object.assign(nothing('fs.realpathSync'), { native: nothing('fs.realpathSync') }) : nothing(`fs.${String(k)}`)) }),
  path: pathShim,
  os: { homedir: () => '/', tmpdir: () => '/tmp', platform: () => 'ios' },
  crypto: { createHash: () => { let text = ''; const h = { update: (t) => { text += String(t); return h; }, digest: () => sha1Hex(text) }; return h; } },
  // (powers.js only asks whether the code compiles: new Function parses it the same way, without running it)
  vm: { Script: function Script(code) { new Function(code); } },
};
const process = { cwd: () => '/', platform: 'ios', env: {} };
const Buffer = { byteLength: (s) => utf8(String(s)).length, from: nothing('Buffer'), alloc: nothing('Buffer'), concat: nothing('Buffer') };

// JavaScriptCore on its own has no URL (it's the browser's): a small one, enough for the helper's files and the
// match patterns (an absolute http(s), file or other scheme address: its parts, and the address as given).
const URL = typeof globalThis.URL === 'function' ? globalThis.URL : class URL {
  constructor(text, base) {
    const s = String(text);
    const m = /^([a-z][a-z0-9+.-]*:)(?:\/\/(?:([^@/?#]*)@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d*))?)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
    if (!m || (base === undefined && !m[1])) throw new TypeError(`Invalid URL: ${s}`);
    this.protocol = m[1].toLowerCase();
    this.hostname = (m[3] || '').toLowerCase();
    this.port = m[4] || '';
    this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname;
    this.pathname = m[5] || (m[3] !== undefined ? '/' : '');
    this.search = m[6] && m[6] !== '?' ? m[6] : '';
    this.hash = m[7] && m[7] !== '#' ? m[7] : '';
    this.origin = `${this.protocol}//${this.host}`;
    this.href = `${this.protocol}${m[3] !== undefined ? '//' : ''}${this.host}${this.pathname}${this.search}${this.hash}`;
  }
  toString() { return this.href; }
};
