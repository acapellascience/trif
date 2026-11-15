// Made by mobile/prepare.js from helper/lib/{rules,combinations,boxpowers,powers,mods,stylesection,framing,pathcheck,scope,diff}.js, mobile/shared/node-shims.js and mobile/shared/modfile.js: don't edit.
globalThis.__trifMods = (function () {
'use strict';
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

const SOURCES = {
"./rules": function (module, exports, require) {
'use strict';
// Rules mods: mods that are data, not code (docs/SAFE-MODS.md, the "rules" tier). The file is an ordinary
// mod file whose header says `// @rules`, with a JSON object where the code would be:
//
//   // ==WebMod==
//   // @name   Hide promos
//   // @match  https://x.com/*
//   // @rules
//   // ==/WebMod==
//   {
//     "css": "[data-testid=sidebarColumn] { opacity: .6 }",
//     "hide": ["[data-testid=placementTracking]"],
//     "replace": [{ "in": "article", "find": "Grok", "with": "the robot" }],
//     "filter": [{ "items": "[data-testid=cellInnerDiv]", "hideIfText": "Promoted" }]
//   }
//
// The helper checks it here and sends, as the mod's code, TRIF's own fixed runtime (rulesRuntime, below)
// with the checked rules as data. Nothing the mod's author wrote runs as code, so a rules mod can't send,
// click, navigate or reach the page's code, whoever wrote it, and it never waits for the user's OK (held.js).
// Its strings only ever become: CSS that passed checkCss (nothing loads from anywhere but data:), selectors
// handed to querySelectorAll, text set as text, and regular expressions (capped, compiled here first).

const MAX = { css: 200000, list: 500, selector: 1000, find: 200, with: 2000, text: 500 };
const KEYS = new Set(['css', 'hide', 'replace', 'filter']);

class RulesError extends Error {}

/** The rules object in a rules mod's file: the JSON after the header (optionally in parentheses). */
function parseRules(code) {
  const text = String(code).replace(/^﻿/, '');
  const end = text.search(/^\s*\/\/\s*==\/WebMod==\s*$/m);
  let body = end === -1 ? text : text.slice(text.indexOf('\n', end) + 1);
  body = body.replace(/^\s*\/\/.*$/gm, '').trim().replace(/^\(([\s\S]*)\)\s*;?$/, '$1').trim();
  if (!body) throw new RulesError('a style mod needs a JSON object after its header');
  let spec;
  try { spec = JSON.parse(body); } catch (e) { throw new RulesError(`the rules aren't valid JSON: ${e.message}`); }
  return checkRules(spec);
}

/** Checks a rules object; returns it normalized, or throws with every problem found. */
function checkRules(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new RulesError('the rules must be a JSON object');
  for (const k of Object.keys(spec)) if (!KEYS.has(k)) problems.push(`unknown rule "${k}" (style mods have ${[...KEYS].join(', ')})`);
  const out = { css: '', hide: [], replace: [], filter: [] };
  if (spec.css !== undefined) {
    if (typeof spec.css !== 'string' || spec.css.length > MAX.css) problems.push(`"css" must be text, at most ${MAX.css} characters`);
    else { const p = checkCss(spec.css); if (p) problems.push(`"css": ${p}`); else out.css = spec.css; }
  }
  const list = (key) => {
    const v = spec[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > MAX.list) { problems.push(`"${key}" must be a list of at most ${MAX.list}`); return []; }
    return v;
  };
  for (const [i, sel] of list('hide').entries()) {
    const p = checkSelector(sel);
    if (p) problems.push(`"hide"[${i}]: ${p}`); else out.hide.push(sel);
  }
  for (const [i, r] of list('replace').entries()) {
    const at = `"replace"[${i}]`;
    if (!r || typeof r !== 'object') { problems.push(`${at} must be an object { in?, find, regex?, caseless?, with }`); continue; }
    for (const k of Object.keys(r)) if (!['in', 'find', 'regex', 'caseless', 'with'].includes(k)) problems.push(`${at}: unknown key "${k}"`);
    if (r.in !== undefined) { const p = checkSelector(r.in); if (p) problems.push(`${at}.in: ${p}`); }
    if (typeof r.find !== 'string' || !r.find || r.find.length > MAX.find) { problems.push(`${at}.find must be text, 1 to ${MAX.find} characters`); continue; }
    if (typeof r.with !== 'string' || r.with.length > MAX.with) { problems.push(`${at}.with must be text, at most ${MAX.with} characters`); continue; }
    if (r.regex) { const p = checkRegex(r.find); if (p) { problems.push(`${at}.find: ${p}`); continue; } }
    out.replace.push({ in: r.in || 'body', find: r.find, regex: !!r.regex, caseless: !!r.caseless, with: r.with });
  }
  for (const [i, f] of list('filter').entries()) {
    const at = `"filter"[${i}]`;
    if (!f || typeof f !== 'object') { problems.push(`${at} must be an object { items, hideIfText | hideIfRegex | hideIfHas }`); continue; }
    for (const k of Object.keys(f)) if (!['items', 'hideIfText', 'hideIfRegex', 'hideIfHas'].includes(k)) problems.push(`${at}: unknown key "${k}"`);
    const p = checkSelector(f.items);
    if (p) { problems.push(`${at}.items: ${p}`); continue; }
    const ways = ['hideIfText', 'hideIfRegex', 'hideIfHas'].filter((k) => f[k] !== undefined);
    if (ways.length !== 1) { problems.push(`${at} needs exactly one of hideIfText, hideIfRegex, hideIfHas`); continue; }
    if (f.hideIfText !== undefined && (typeof f.hideIfText !== 'string' || !f.hideIfText || f.hideIfText.length > MAX.text)) { problems.push(`${at}.hideIfText must be text, 1 to ${MAX.text} characters`); continue; }
    if (f.hideIfRegex !== undefined) { const q = typeof f.hideIfRegex === 'string' ? checkRegex(f.hideIfRegex) : 'must be text'; if (q) { problems.push(`${at}.hideIfRegex: ${q}`); continue; } }
    if (f.hideIfHas !== undefined) { const q = checkSelector(f.hideIfHas); if (q) { problems.push(`${at}.hideIfHas: ${q}`); continue; } }
    out.filter.push({ items: f.items, ...(f.hideIfText !== undefined ? { hideIfText: f.hideIfText } : {}), ...(f.hideIfRegex !== undefined ? { hideIfRegex: f.hideIfRegex } : {}), ...(f.hideIfHas !== undefined ? { hideIfHas: f.hideIfHas } : {}) });
  }
  if (problems.length) throw new RulesError(problems.join('; '));
  return out;
}

// Reads CSS as a browser reads it, as far as what loads goes (extension/sandbox.js cssScan is the same
// reading; tests/rules.test.js keeps the two in step). Three things a checker must read the browser's way, or
// text it takes for a string's or a comment's is live CSS to the browser, unseen by every check below:
//   - a quoted string ends at a line break, as CSS ends it (reading on to the next quote would swallow rules);
//   - an unquoted url(…) is one token, its text the address whatever is in it (a /* there starts no comment);
//   - a backslash outside a string is refused (an escape can spell a function's or rule's name: u\72l( is url().
// Returns {error}, or {flat, urls}: the text outside strings and comments (a string and a comment each a
// space, a url() as `url()`), and each url()'s address as written.
function cssScan(css) {
  css = String(css);
  let flat = '';
  const urls = [];
  const WS = ' \t\n\r\f';
  const stringEnd = (i) => { // (i: the opening quote; the index after the closing one, or -1)
    const q = css[i];
    for (let j = i + 1; j < css.length; j++) {
      const c = css[j];
      if (c === '\\') { j++; continue; }
      if (c === '\n' || c === '\r' || c === '\f') return -1;
      if (c === q) return j + 1;
    }
    return -1;
  };
  for (let i = 0; i < css.length;) {
    const c = css[i];
    if (c === '"' || c === "'") { const e = stringEnd(i); if (e === -1) return { error: 'a quoted string that isn\'t closed on its line' }; flat += ' '; i = e; continue; }
    if (c === '\\') return { error: 'a backslash escape outside a string' };
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); if (e === -1) return { error: 'an unclosed comment' }; flat += ' '; i = e + 2; continue; }
    if ((c === 'u' || c === 'U') && /^url\($/i.test(css.slice(i, i + 4))) {
      let j = i + 4, arg;
      while (j < css.length && WS.includes(css[j])) j++;
      if (css[j] === '"' || css[j] === "'") {
        const e = stringEnd(j);
        if (e === -1) return { error: 'a quoted string that isn\'t closed on its line' };
        arg = css.slice(j + 1, e - 1);
        if (arg.includes('\\')) return { error: 'a backslash escape in a url()' };
        j = e;
        while (j < css.length && WS.includes(css[j])) j++;
        if (css[j] !== ')') return { error: 'a url() that isn\'t closed after its address' };
      } else {
        const e = css.indexOf(')', j);
        if (e === -1) return { error: 'a url() that isn\'t closed' };
        arg = css.slice(j, e).replace(/[ \t\n\r\f]+$/, '');
        if (/["'()\\]|\/\*|[\s\u0000-\u001f\u007f]/.test(arg)) return { error: 'a url() whose address has a quote, a space, a bracket, a backslash or /* in it (put the address in quotes)' };
        j = e;
      }
      urls.push(arg);
      flat += 'url()';
      i = j + 1;
      continue;
    }
    flat += c;
    i++;
  }
  return { flat, urls };
}

// Selectors that read what's typed in a field: the value attribute (React keeps it in step with what's typed,
// passwords too) and :autofill. Refused in style mods' selectors and CSS as in boxed mods' (sandbox.js
// READS_FIELDS): nothing a style mod has can carry the answer anywhere, and this keeps it that way.
const READS_FIELDS = /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b/i;

/**
 * CSS a rules mod may have: anything that changes how the page looks, but nothing that loads from an
 * address (which can carry what the page shows to another site): url() only with data:, and no @import,
 * image-set(), image(), cross-fade(), element(), src(), or the old script-running properties. null when fine.
 */
function checkCss(css) {
  const r = cssScan(css);
  if (r.error) return r.error === 'a backslash escape outside a string' ? 'a backslash escape outside a string (an escape can spell url( or @import)' : r.error;
  const text = r.flat.toLowerCase();
  if (/@import\b/.test(text)) return '@import loads from an address; put the CSS here instead';
  if (/(?:^|[^a-z-])(?:-webkit-)?(image-set|image|cross-fade|element|src)\s*\(/.test(text)) return 'image-set(), image(), cross-fade(), element() and src() can load from an address';
  // (behavior: the whole property's name, not the end of overscroll-behavior or scroll-behavior)
  if (/expression\s*\(|-moz-binding|(?<![\w-])(?:-ms-)?behavior\s*:/.test(text)) return 'that property runs code';
  // url(…): only data:
  for (const a of r.urls) if (!/^\s*data:/i.test(a)) return 'url() loads from an address: only data: is allowed in a style mod';
  if (READS_FIELDS.test(r.flat)) return 'CSS can\'t select by the value attribute or :autofill (it would read what\'s typed in a field)';
  return null;
}

// A selector: it goes into querySelectorAll, and into generated CSS (`sel { display: none !important }`),
// so it may not close the rule or start another, and no escapes (as in checkCss).
function checkSelector(sel) {
  if (typeof sel !== 'string' || !sel.trim() || sel.length > MAX.selector) return `a selector must be text, 1 to ${MAX.selector} characters`;
  const r = cssScan(sel);
  if (r.error) return r.error;
  const bad = /[{};@]/.exec(r.flat);
  if (bad) return `"${bad[0]}" can't be in a selector here`;
  if (r.urls.length) return 'a selector has no url()';
  if (READS_FIELDS.test(r.flat)) return 'a selector can\'t name the value attribute or :autofill (it would read what\'s typed in a field)';
  return null;
}

function checkRegex(src) {
  if (typeof src !== 'string' || !src || src.length > MAX.find) return `a pattern must be text, 1 to ${MAX.find} characters`;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(src)) return 'nested repeats ((a+)+ and the like) can make a page hang';
  try { new RegExp(src, 'u'); } catch (e) { return `not a valid pattern: ${e.message}`; }
  return null;
}

/**
 * TRIF's own code for a rules mod: what runs in the page. It reads `spec` (checked by checkRules) and
 * only ever puts its strings into a style element (the CSS, and the hide selectors as CSS), into
 * querySelectorAll / matches, into regular expressions, and into text nodes' text.
 */
function rulesRuntime(spec) {
  const css = spec.css + (spec.hide.length ? `\n${spec.hide.join(',\n')} { display: none !important; }` : '');
  if (css.trim()) {
    const style = document.createElement('style');
    style.textContent = css;
    const put = () => (document.head || document.documentElement).append(style);
    if (document.documentElement) put(); else document.addEventListener('readystatechange', put, { once: true });
  }
  if (!spec.replace.length && !spec.filter.length) return;
  const MAX_TEXT = 20000; // (characters of one text node a pattern looks at)
  const replacers = spec.replace.map((r) => ({
    in: r.in, re: r.regex ? new RegExp(r.find, `gu${r.caseless ? 'i' : ''}`) : null,
    find: r.caseless ? r.find.toLowerCase() : r.find, caseless: r.caseless, with: r.with,
  }));
  const filters = spec.filter.map((f) => ({ ...f, re: f.hideIfRegex ? new RegExp(f.hideIfRegex, 'iu') : null, text: f.hideIfText ? f.hideIfText.toLowerCase() : null }));
  const done = new WeakMap(); // text node -> the text it had after replacing
  const replaceIn = (root) => {
    for (const r of replacers) {
      let scopes;
      try { scopes = root.matches && root.matches(r.in) ? [root] : [...(root.querySelectorAll ? root.querySelectorAll(r.in) : [])]; } catch { continue; }
      if (!scopes.length && root.closest) { try { if (root.closest(r.in)) scopes = [root]; } catch { /* bad selector */ } }
      for (const scope of scopes) {
        const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (done.get(n) === n.data || n.data.length > MAX_TEXT) continue;
          const p = n.parentElement;
          // (never what the user is typing: an editor by what the browser says it is, not by how its attribute
          // is spelled: contenteditable="plaintext-only", "TRUE", and a page in design mode are editors too)
          if (p && (p.closest('script,style,textarea') || p.isContentEditable || document.designMode === 'on')) continue;
          let t = n.data;
          if (r.re) t = t.replace(r.re, () => r.with);
          else if (r.caseless) { let i, lower = t.toLowerCase(), out = '', from = 0; while ((i = lower.indexOf(r.find, from)) !== -1) { out += t.slice(from, i) + r.with; from = i + r.find.length; } t = out + t.slice(from); }
          else t = t.split(r.find).join(r.with);
          if (t !== n.data) n.data = t;
          done.set(n, n.data);
        }
      }
    }
  };
  const filterIn = (root) => {
    for (const f of filters) {
      let items;
      try { items = [...(root.querySelectorAll ? root.querySelectorAll(f.items) : [])]; if (root.matches && root.matches(f.items)) items.push(root); if (root.closest) { const up = root.closest(f.items); if (up) items.push(up); } } catch { continue; }
      for (const el of items) {
        let hide = false;
        const text = (el.textContent || '').slice(0, MAX_TEXT);
        if (f.text) hide = text.toLowerCase().includes(f.text);
        else if (f.re) hide = f.re.test(text);
        else if (f.hideIfHas) { try { hide = !!el.querySelector(f.hideIfHas); } catch { /* bad selector */ } }
        if (hide) el.style.setProperty('display', 'none', 'important');
      }
    }
  };
  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const r of roots) { if (!r.isConnected) continue; replaceIn(r); filterIn(r); }
  };
  const schedule = (n) => { pending.add(n); if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } };
  const start = () => {
    schedule(document.body || document.documentElement);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') { if (m.target.parentElement) schedule(m.target.parentElement); }
        else for (const n of m.addedNodes) schedule(n.nodeType === 1 ? n : n.parentElement || document.body);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** The code a rules mod runs: TRIF's runtime with the checked rules as data. */
function rulesCode(spec, id) {
  // (the id in a comment: only its plain characters, as a line break in it would end the comment)
  return `// TRIF rules mod ${JSON.stringify(String(id || '').replace(/[^\x20-\x7e]/g, '?'))}: TRIF's own code, the mod's rules as data (helper/lib/rules.js)\n` +
    `(${rulesRuntime.toString()})(${JSON.stringify(spec)});\n`;
}

/**
 * What a style mod looks for on the page (extension/modhealth.js: a mod whose selectors stop matching may be
 * broken): its hide and filter selectors, replace's `in`, and the selectors of its CSS rules; not the ones
 * every page has (html, body, :root, *). At most 40.
 */
function selectorsOf(rules) {
  const out = new Set();
  const add = (s) => { const t = String(s || '').trim(); if (t && t.length <= 300 && !/^(html|body|:root|\*)$/i.test(t)) out.add(t); };
  for (const s of rules.hide || []) add(s);
  for (const f of rules.filter || []) add(f.items);
  for (const r of rules.replace || []) if (r.in && r.in !== 'body') add(r.in);
  const css = String(rules.css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/(?:^|[{};])\s*([^{}@;]+)\{/g)) {
    for (const sel of m[1].split(',')) { const t = sel.trim(); if (t && !/^(from|to|\d+(\.\d+)?%)$/i.test(t)) add(t.replace(/::?(before|after|placeholder|selection|marker|first-line|first-letter|hover|focus|active|visited|focus-visible|focus-within)\b(\([^)]*\))?/gi, '') || t); }
  }
  return [...out].slice(0, 40);
}

module.exports = { selectorsOf, parseRules, checkRules, checkCss, checkSelector, checkRegex, cssScan, rulesRuntime, rulesCode, RulesError };

},
"./combinations": function (module, exports, require) {
'use strict';
// Power combinations (docs/POWER-COMBINATIONS.md is this table, written out; docs/SAFE-MODS.md says why).
// Every pair and every triple of the powers, each with a warning the hold shows, or why it adds
// nothing to what its powers do alone. "Adds" means: together they can carry what a mod reads off the page,
// or act as you, in a way none of them (or, for a triple, none of its pairs) can. Within one mod, and across
// the boxed mods on a page, which see each other's elements and can talk over `mods`: the sandbox's
// page-wide rules (extension/sandbox.js ACT_PARTNERS) keep a combination split across mods from slipping
// past the hold.
//
// The hold (boxpowers.js powerNeeds): each warned combination a mod has is a need of its own, keyed by its
// powers (`power:together:a+b[+c]`), so approving a pair doesn't cover a triple; the panel shows them in the
// red box, the strongest first, one line each ("Together, it …"). A mod with more than three powers gets
// MANY instead (its combinations are still needs, keyed, without lines of their own).

// The order the table is written in (boxpowers.js NAMES; tests/combinations.test.js checks they match).
const POWERS = ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants', 'sound', 'controls', 'mods', 'preload', 'media',
  'search-box', 'go-to', 'embeds', 'rewrite-requests', 'block-events', 'page-events', 'click', 'write-drafts', 'edit-uploads'];
// (the twelve of 0.2: their combinations are the literal table below; the rest, added in 0.3, follow RULES)
const POWERS_02 = ['read-drafts', 'keys', 'site-data', 'page-data', 'sound', 'controls', 'mods', 'media', 'search-box', 'go-to', 'click', 'write-drafts'];
// Reads: see more than the page shows (image-variants: the pixels of the pictures it loads; edit-uploads: the
// pictures you attach, before anything is posted)
const READS = ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants', 'edit-uploads'];

// The warnings, strongest first (rank). Each is a fact after "it", like the powers' own.
const WARNINGS = {
  'read-post-for-you': { rank: 1, fact: 'could put what it reads into a post and send it for you' },
  'go-post-for-you': { rank: 2, fact: 'could go to a page, write a post there and send it for you' },
  'post-for-you': { rank: 3, fact: 'could write a post and send it for you' },
  'read-into-post': { rank: 4, fact: 'could put what it reads into something you post' },
  'read-into-picture': { rank: 5, fact: 'could put what it reads into a picture you post' },
  'read-into-page-code': { rank: 6, fact: 'could hand what it reads to this page\'s own code, which may post or send it' },
  'read-into-storage': { rank: 7, fact: 'could keep what it reads where this site\'s own code, and your other boxed mods, can find it later' },
  'go-and-click': { rank: 8, fact: 'could take you to a page and click things there for you' },
  'go-and-signal': { rank: 9, fact: 'could take you to a page and set off that page\'s own actions there' },
  'click-and-rewrite': { rank: 10, fact: 'could click things for you and change what the site receives from those clicks' },
  'signal-and-rewrite': { rank: 11, fact: 'could set off this page\'s own actions and change what the site receives from them' },
  'read-decides-click': { rank: 12, fact: 'could let what it reads decide what it clicks for you' },
  'block-and-click': { rank: 13, fact: 'could keep your clicks from reaching the page and click in their place' },
  'block-and-signal': { rank: 14, fact: 'could keep your clicks from reaching the page and set off the page\'s own actions in their place' },
  'block-and-go': { rank: 15, fact: 'could keep your clicks from reaching the page and take you to another page in their place' },
  'read-decides-blocks': { rank: 16, fact: 'could let what it reads decide which of your actions this page sees, and the page\'s code may send that on' },
  'read-through-media': { rank: 17, fact: 'could pass what it reads to the site a video or sound comes from, by how it plays it' },
  'read-through-pictures': { rank: 18, fact: 'could pass what it reads to the sites this page\'s pictures come from, by which ones it loads' },
  'read-through-videos': { rank: 19, fact: 'could pass what it reads to the site a video comes from, by which video it offers you' },
  'read-into-sound': { rank: 20, fact: 'could turn what it reads into sounds that a device nearby could pick up' },
};
// (Tim's words, for a mod with more than three powers, in place of the lines above)
const MANY = 'Mods with many powers could act in surprising ways. Treat them with caution.';
const MANY_OVER = 3;

// Every pair (66) and triple (220) of the twelve of 0.2, in POWERS order: { warn: <WARNINGS key> }, or why it
// adds no risk. (Those with a power added in 0.3: RULES, below, written into the same table.)
const COMBINATIONS = {
  'read-drafts+keys': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+site-data': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+sound': { warn: 'read-into-sound' },
  'read-drafts+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'read-drafts+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'read-drafts+media': { warn: 'read-through-media' },
  'read-drafts+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'read-drafts+go-to': 'it only goes to this site\'s own pages (the header\'s, with the header\'s words in a query, or links the page shows), and that site can already see what it reads',
  'read-drafts+click': { warn: 'read-decides-click' },
  'read-drafts+write-drafts': { warn: 'read-into-post' },
  'keys+site-data': 'both only read: nothing they read can leave the page without something that acts',
  'keys+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'keys+sound': { warn: 'read-into-sound' },
  'keys+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'keys+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'keys+media': { warn: 'read-through-media' },
  'keys+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'keys+go-to': 'it only goes to this site\'s own pages (the header\'s, with the header\'s words in a query, or links the page shows), and that site can already see what it reads',
  'keys+click': { warn: 'read-decides-click' },
  'keys+write-drafts': { warn: 'read-into-post' },
  'site-data+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'site-data+sound': { warn: 'read-into-sound' },
  'site-data+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'site-data+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'site-data+media': { warn: 'read-through-media' },
  'site-data+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'site-data+go-to': 'it only goes to this site\'s own pages (the header\'s, with the header\'s words in a query, or links the page shows), and that site can already see what it reads',
  'site-data+click': { warn: 'read-decides-click' },
  'site-data+write-drafts': { warn: 'read-into-post' },
  'page-data+sound': { warn: 'read-into-sound' },
  'page-data+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'page-data+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'page-data+media': { warn: 'read-through-media' },
  'page-data+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'page-data+go-to': 'it only goes to this site\'s own pages (the header\'s, with the header\'s words in a query, or links the page shows), and that site can already see what it reads',
  'page-data+click': { warn: 'read-decides-click' },
  'page-data+write-drafts': { warn: 'read-into-post' },
  'sound+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'sound+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'sound+media': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'sound+go-to': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+click': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'controls+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'controls+media': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+search-box': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+go-to': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+click': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+write-drafts': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'mods+media': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+search-box': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+go-to': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+click': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+write-drafts': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'media+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'media+go-to': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'media+click': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'media+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'search-box+go-to': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'search-box+click': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'search-box+write-drafts': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'go-to+click': { warn: 'go-and-click' },
  'go-to+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'click+write-drafts': { warn: 'post-for-you' },
  'read-drafts+keys+site-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+sound': 'no more than its pairs: their warnings show',
  'read-drafts+keys+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+media': 'no more than its pairs: their warnings show',
  'read-drafts+keys+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+click': 'no more than its pairs: their warnings show',
  'read-drafts+keys+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+sound': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+media': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+click': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+sound': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+media': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+click': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+sound+controls': 'no more than its pairs: their warnings show',
  'read-drafts+sound+mods': 'no more than its pairs: their warnings show',
  'read-drafts+sound+media': 'no more than its pairs: their warnings show',
  'read-drafts+sound+search-box': 'no more than its pairs: their warnings show',
  'read-drafts+sound+go-to': 'no more than its pairs: their warnings show',
  'read-drafts+sound+click': 'no more than its pairs: their warnings show',
  'read-drafts+sound+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+media': 'no more than its pairs: their warnings show',
  'read-drafts+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+click': 'no more than its pairs: their warnings show',
  'read-drafts+controls+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+mods+media': 'no more than its pairs: their warnings show',
  'read-drafts+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+mods+click': 'no more than its pairs: their warnings show',
  'read-drafts+mods+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+media+search-box': 'no more than its pairs: their warnings show',
  'read-drafts+media+go-to': 'no more than its pairs: their warnings show',
  'read-drafts+media+click': 'no more than its pairs: their warnings show',
  'read-drafts+media+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+search-box+click': 'no more than its pairs: their warnings show',
  'read-drafts+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+go-to+click': 'no more than its pairs: their warnings show',
  'read-drafts+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+click+write-drafts': { warn: 'read-post-for-you' },
  'keys+site-data+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+sound': 'no more than its pairs: their warnings show',
  'keys+site-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+media': 'no more than its pairs: their warnings show',
  'keys+site-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+click': 'no more than its pairs: their warnings show',
  'keys+site-data+write-drafts': 'no more than its pairs: their warnings show',
  'keys+page-data+sound': 'no more than its pairs: their warnings show',
  'keys+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+media': 'no more than its pairs: their warnings show',
  'keys+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+click': 'no more than its pairs: their warnings show',
  'keys+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'keys+sound+controls': 'no more than its pairs: their warnings show',
  'keys+sound+mods': 'no more than its pairs: their warnings show',
  'keys+sound+media': 'no more than its pairs: their warnings show',
  'keys+sound+search-box': 'no more than its pairs: their warnings show',
  'keys+sound+go-to': 'no more than its pairs: their warnings show',
  'keys+sound+click': 'no more than its pairs: their warnings show',
  'keys+sound+write-drafts': 'no more than its pairs: their warnings show',
  'keys+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+media': 'no more than its pairs: their warnings show',
  'keys+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+click': 'no more than its pairs: their warnings show',
  'keys+controls+write-drafts': 'no more than its pairs: their warnings show',
  'keys+mods+media': 'no more than its pairs: their warnings show',
  'keys+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+mods+click': 'no more than its pairs: their warnings show',
  'keys+mods+write-drafts': 'no more than its pairs: their warnings show',
  'keys+media+search-box': 'no more than its pairs: their warnings show',
  'keys+media+go-to': 'no more than its pairs: their warnings show',
  'keys+media+click': 'no more than its pairs: their warnings show',
  'keys+media+write-drafts': 'no more than its pairs: their warnings show',
  'keys+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+search-box+click': 'no more than its pairs: their warnings show',
  'keys+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'keys+go-to+click': 'no more than its pairs: their warnings show',
  'keys+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'keys+click+write-drafts': { warn: 'read-post-for-you' },
  'site-data+page-data+sound': 'no more than its pairs: their warnings show',
  'site-data+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+media': 'no more than its pairs: their warnings show',
  'site-data+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+click': 'no more than its pairs: their warnings show',
  'site-data+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+sound+controls': 'no more than its pairs: their warnings show',
  'site-data+sound+mods': 'no more than its pairs: their warnings show',
  'site-data+sound+media': 'no more than its pairs: their warnings show',
  'site-data+sound+search-box': 'no more than its pairs: their warnings show',
  'site-data+sound+go-to': 'no more than its pairs: their warnings show',
  'site-data+sound+click': 'no more than its pairs: their warnings show',
  'site-data+sound+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+media': 'no more than its pairs: their warnings show',
  'site-data+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+click': 'no more than its pairs: their warnings show',
  'site-data+controls+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+mods+media': 'no more than its pairs: their warnings show',
  'site-data+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+mods+click': 'no more than its pairs: their warnings show',
  'site-data+mods+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+media+search-box': 'no more than its pairs: their warnings show',
  'site-data+media+go-to': 'no more than its pairs: their warnings show',
  'site-data+media+click': 'no more than its pairs: their warnings show',
  'site-data+media+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+search-box+click': 'no more than its pairs: their warnings show',
  'site-data+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+go-to+click': 'no more than its pairs: their warnings show',
  'site-data+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+click+write-drafts': { warn: 'read-post-for-you' },
  'page-data+sound+controls': 'no more than its pairs: their warnings show',
  'page-data+sound+mods': 'no more than its pairs: their warnings show',
  'page-data+sound+media': 'no more than its pairs: their warnings show',
  'page-data+sound+search-box': 'no more than its pairs: their warnings show',
  'page-data+sound+go-to': 'no more than its pairs: their warnings show',
  'page-data+sound+click': 'no more than its pairs: their warnings show',
  'page-data+sound+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+media': 'no more than its pairs: their warnings show',
  'page-data+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+click': 'no more than its pairs: their warnings show',
  'page-data+controls+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+mods+media': 'no more than its pairs: their warnings show',
  'page-data+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+mods+click': 'no more than its pairs: their warnings show',
  'page-data+mods+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+media+search-box': 'no more than its pairs: their warnings show',
  'page-data+media+go-to': 'no more than its pairs: their warnings show',
  'page-data+media+click': 'no more than its pairs: their warnings show',
  'page-data+media+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+search-box+click': 'no more than its pairs: their warnings show',
  'page-data+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+go-to+click': 'no more than its pairs: their warnings show',
  'page-data+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+click+write-drafts': { warn: 'read-post-for-you' },
  'sound+controls+mods': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+go-to+click': 'no more than its pairs: their warnings show',
  'sound+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+click+write-drafts': 'no more than its pairs: their warnings show',
  'controls+mods+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+go-to+click': 'no more than its pairs: their warnings show',
  'controls+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+click+write-drafts': 'no more than its pairs: their warnings show',
  'mods+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+go-to+click': 'no more than its pairs: their warnings show',
  'mods+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+click+write-drafts': 'no more than its pairs: their warnings show',
  'media+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+go-to+click': 'no more than its pairs: their warnings show',
  'media+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+click+write-drafts': 'no more than its pairs: their warnings show',
  'search-box+go-to+click': 'no more than its pairs: their warnings show',
  'search-box+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'search-box+click+write-drafts': 'no more than its pairs: their warnings show',
  'go-to+click+write-drafts': { warn: 'go-post-for-you' },
};

const keyOf = (list) => POWERS.filter((p) => list.includes(p)).join('+');

// RULES: the combinations with a power added in 0.3 (WIDEN.md class B), by what each power is. A read with a
// way out warns by the way out; acts that together post or act for you warn; a triple warns on its own only
// where a read, something that sends and something that writes the post meet (or go-to does with those two),
// and otherwise shows its pairs' warnings, or says why it adds nothing.
// (site-storage: what it writes, the site's own code reads, and may sync or send on, and a later boxed mod
// can read on another page; block-events: which of your actions the page's code sees, the mod's choice;
// embeds: which video it offers, which the player's host sees once you click)
const WAY_OUT = {
  'write-drafts': 'read-into-post', click: 'read-decides-click', media: 'read-through-media', sound: 'read-into-sound',
  'edit-uploads': 'read-into-picture', 'page-events': 'read-into-page-code', 'image-variants': 'read-through-pictures', preload: 'read-through-pictures',
  'site-storage': 'read-into-storage', 'block-events': 'read-decides-blocks', embeds: 'read-through-videos',
};
// (rewrite-requests with an act: the act's own request carries the header's change, with no one asking;
// go-to with block-events: your click kept from the page, and a move of the mod's in its place; go-to with
// site-storage: something left for a page's code to act on as it loads, then the user taken there)
const ACT_PAIRS = {
  'block-events+click': 'block-and-click', 'page-events+write-drafts': 'post-for-you', 'click+edit-uploads': 'post-for-you',
  'page-events+edit-uploads': 'post-for-you', 'go-to+page-events': 'go-and-signal',
  'rewrite-requests+click': 'click-and-rewrite', 'rewrite-requests+page-events': 'signal-and-rewrite', 'block-events+page-events': 'block-and-signal',
  'go-to+block-events': 'block-and-go', 'site-storage+go-to': 'go-and-signal',
};
const SENDS = ['click', 'page-events'];
const WRITES = ['write-drafts', 'edit-uploads'];
const REASONS = {
  reads: 'both only read: nothing they read can leave the page without something that acts',
  controls: 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  mods: 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'rewrite-requests': 'its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it',
  embeds: 'it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it',
  'block-events': 'keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields',
  preload: 'it only makes the page load its own pictures sooner, as it would when you scroll to them',
  'go-to': 'it only goes to this site\'s own pages (the header\'s, with the header\'s words in a query, or links the page shows), and that site can already see what it reads',
  pictures: 'both only load the page\'s own pictures, from where the page gets them',
  write: 'a post it changes still waits for you to send it, and the other power carries nothing into it or sends it',
  acts: 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  readOnly: 'it can read, but nothing in it carries what it reads off the page or acts on it',
  actsOnly: 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  pairs: 'no more than its pairs: their warnings show',
};
const pairRule = (a, b) => {
  const k = keyOf([a, b]);
  if (ACT_PAIRS[k]) return { warn: ACT_PAIRS[k] };
  if (k === 'image-variants+preload') return REASONS.pictures;
  for (const [r, o] of [[a, b], [b, a]]) if (READS.includes(r) && WAY_OUT[o] && r !== o) return { warn: WAY_OUT[o] };
  for (const p of ['controls', 'mods', 'search-box', 'rewrite-requests', 'embeds', 'block-events', 'preload']) if (a === p || b === p) return REASONS[p];
  if (READS.includes(a) && READS.includes(b)) return REASONS.reads;
  if (READS.includes(a) || READS.includes(b)) return REASONS['go-to'];
  if (WRITES.includes(a) || WRITES.includes(b)) return REASONS.write;
  return REASONS.acts;
};
const tripleRule = (t) => {
  const reads = t.filter((p) => READS.includes(p));
  const has = (list) => t.some((p) => list.includes(p));
  // (a read that isn't the very picture it posts: edit-uploads reads the picture it changes, and alone that's
  // posting it for you, its pair's warning)
  const readAndWrite = reads.some((r) => t.some((w) => WRITES.includes(w) && w !== r));
  if (readAndWrite && has(SENDS) && t.filter((p) => !SENDS.includes(p) && !WRITES.includes(p)).every((p) => READS.includes(p))) return { warn: 'read-post-for-you' };
  if (t.includes('go-to') && has(SENDS) && t.includes('write-drafts')) return { warn: 'go-post-for-you' };
  const pairs = [[t[0], t[1]], [t[0], t[2]], [t[1], t[2]]];
  if (pairs.some((x) => typeof COMBINATIONS[keyOf(x)] === 'object')) return REASONS.pairs;
  return reads.length ? REASONS.readOnly : REASONS.actsOnly;
};
for (let i = 0; i < POWERS.length; i++) for (let j = i + 1; j < POWERS.length; j++) {
  const pair = [POWERS[i], POWERS[j]];
  if (!pair.every((p) => POWERS_02.includes(p))) COMBINATIONS[keyOf(pair)] = pairRule(...pair);
}
for (let i = 0; i < POWERS.length; i++) for (let j = i + 1; j < POWERS.length; j++) for (let k = j + 1; k < POWERS.length; k++) {
  const t = [POWERS[i], POWERS[j], POWERS[k]];
  if (!t.every((p) => POWERS_02.includes(p))) COMBINATIONS[keyOf(t)] = tripleRule(t);
}
// (the table in POWERS order, pairs then triples, as the doc lists it)
{
  const sorted = Object.keys(COMBINATIONS).sort((x, y) => {
    const a = x.split('+').map((p) => POWERS.indexOf(p)), b = y.split('+').map((p) => POWERS.indexOf(p));
    return a.length - b.length || a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0);
  });
  const copy = { ...COMBINATIONS };
  for (const k of Object.keys(COMBINATIONS)) delete COMBINATIONS[k];
  for (const k of sorted) COMBINATIONS[k] = copy[k];
}
const N = POWERS.length, PAIRS = (N * (N - 1)) / 2, TRIPLES = (N * (N - 1) * (N - 2)) / 6;

/** The warned combinations among a set of powers: [{key, combo, warn, rank, fact}], the strongest first. */
function warningsFor(powers) {
  const list = POWERS.filter((p) => (powers || []).includes(p));
  const out = [];
  const add = (c) => { const e = COMBINATIONS[keyOf(c)]; if (e && typeof e === 'object') out.push({ key: `power:together:${keyOf(c)}`, combo: keyOf(c), warn: e.warn, ...WARNINGS[e.warn] }); };
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    add([list[i], list[j]]);
    for (let k = j + 1; k < list.length; k++) add([list[i], list[j], list[k]]);
  }
  return out.sort((a, b) => a.rank - b.rank || POWERS.indexOf(a.combo.split('+')[0]) - POWERS.indexOf(b.combo.split('+')[0]));
}

/**
 * docs/POWER-COMBINATIONS.md, written out from the table (tests/combinations.test.js checks the file is this):
 * node -e "process.stdout.write(require('./helper/lib/combinations').toMarkdown())" > docs/POWER-COMBINATIONS.md
 */
function toMarkdown() {
  const entries = Object.entries(COMBINATIONS);
  const warned = (n) => entries.filter(([k, v]) => k.split('+').length === n && typeof v === 'object');
  const show = (k) => k.split('+').map((p) => `\`${p}\``).join(' + ');
  const cell = (v, k) => {
    if (typeof v === 'object') return `**Together, it ${WARNINGS[v.warn].fact}.**`;
    if (!/^no more than its pairs/.test(v)) return `No added risk: ${v}.`;
    const ws = [...new Set(warningsFor(k.split('+')).filter((w) => w.combo !== k).map((w) => w.fact))];
    return `No more than its pairs, whose warnings show: ${ws.map((f) => `"${f}"`).join('; ')}.`;
  };
  const L = [];
  L.push('# Power combinations', '');
  L.push('Written out from `helper/lib/combinations.js` (the table the hold reads); don\'t edit by hand. Every pair');
  L.push(`(${PAIRS}) and triple (${TRIPLES}) of the ${N} powers, with the warning a hold shows for it, or why it adds no risk.`, '');
  L.push('"Adds risk" means: together, the powers can carry what a mod reads off the page, or act as you, in a way');
  L.push('none of them (for a triple: none of its pairs) can alone. Reads (`read-drafts`, `keys`, `site-data`,');
  L.push('`page-data`, `site-storage`, `local-fonts`, `image-variants` for the pixels it reads, and `edit-uploads` for');
  L.push('the pictures you attach) see more than the page shows; nothing else does. The ways out of the page are what');
  L.push('you post (`write-drafts`, `click`, a picture you attach: `edit-uploads`), what the mod clicks (`click`, and');
  L.push('`go-to` to get to a page), what the page\'s own code is told or sees (`page-events`, and which of your actions');
  L.push('`block-events` keeps from it), what the site keeps (`site-storage`: the site\'s own code reads it, and so can');
  L.push('a boxed mod on a later page), how the page\'s media plays (the host of a video sees its requests: `media`),');
  L.push('which of the page\'s pictures load (their hosts see that: `image-variants`, `preload`), which video it offers');
  L.push('you (the player\'s host sees it once you click: `embeds`) and sound in the room (`sound`).');
  L.push('`rewrite-requests` changes what the site receives, but only as its header says, by TRIF: nothing the mod');
  L.push('reads rides on it, but beside an act (`click`, `page-events`) it changes what that act sends. Everything a');
  L.push('boxed mod reaches otherwise stays on the site it came from, which already has it. Across mods on one page');
  L.push('(they see each other\'s elements, and `mods` gives them a channel), the sandbox\'s page-wide rules stop a');
  L.push('combination split between mods from slipping past the hold, unless the user approved what the site\'s boxed');
  L.push('mods can do together ("Your … mods can:": one approval per site): docs/SAFE-MODS.md, "Combinations".', '');
  L.push(`Counts: ${warned(2).length} of ${PAIRS} pairs carry a warning; ${warned(3).length} of ${TRIPLES} triples carry one of their own, and`);
  L.push(`${entries.filter(([k, v]) => k.split('+').length === 3 && /^no more than its pairs/.test(v)).length} more show their pairs' warnings.`, '');
  L.push('## The warnings, strongest first', '');
  L.push('A hold lists each warning its mod\'s powers make, one line each, in this order (the same sentence once).', '');
  L.push('| | warning | combinations |', '|---|---|---|');
  for (const [id, w] of Object.entries(WARNINGS).sort((a, b) => a[1].rank - b[1].rank)) {
    const cs = entries.filter(([, v]) => typeof v === 'object' && v.warn === id).map(([k]) => k);
    const byShape = {};
    // ("a read": one that's only a read; site-storage, image-variants and edit-uploads, ways out too, by name)
    for (const k of cs) { const shape = k.split('+').map((p) => (READS.includes(p) && !WAY_OUT[p] ? 'a read' : `\`${p}\``)).join(' + '); byShape[shape] = (byShape[shape] || 0) + 1; }
    L.push(`| ${w.rank} | Together, it ${w.fact}. | ${Object.entries(byShape).map(([sh, n]) => `${sh}${n > 1 ? ` (${n})` : ''}`).join('; ')} |`);
  }
  L.push('', `A mod with more than ${MANY_OVER} powers gets, in place of these lines: **${MANY}** (keyed by its exact set of powers; its`);
  L.push('combinations are still needs of their own, so a later version with fewer of them doesn\'t ask again for what was allowed).', '');
  for (const n of [2, 3]) {
    L.push(`## ${n === 2 ? `Pairs (${PAIRS})` : `Triples (${TRIPLES})`}`, '');
    L.push(`Grouped by their first power, in the menu's order.`, '');
    for (const first of POWERS) {
      const rows = entries.filter(([k]) => k.split('+').length === n && k.split('+')[0] === first);
      if (!rows.length) continue;
      L.push(`### ${n === 2 ? 'Pairs' : 'Triples'} starting with \`${first}\``, '', '| combination | the hold |', '|---|---|');
      for (const [k, v] of rows) L.push(`| ${show(k)} | ${cell(v, k)} |`);
      L.push('');
    }
  }
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}

module.exports = { POWERS, POWERS_02, READS, WARNINGS, MANY, MANY_OVER, COMBINATIONS, warningsFor, keyOf, toMarkdown, PAIRS, TRIPLES };

},
"./boxpowers": function (module, exports, require) {
'use strict';
// Powers: the named exceptions a boxed mod can ask for (docs/POWERS.md). A boxed mod declares them in its
// header, `// @powers sound, read-drafts`; TRIF holds it until the user approves that set, and the sandbox
// (extension/sandbox.js) gives it those and nothing more. None of them sends anything the mod makes up:
// go-to and click go only where the header or the page's own links say, write-drafts changes only what the
// user is about to post, and write-drafts with a read power is a combination the hold names on its own.
//
// The approval is for the set, not the code: each power is allowed for the mod by its key (`power:<name>`,
// held.js allowed.json), so an update with the same powers runs without asking again, and one that adds a
// power waits for that one. The quiet powers (`soft`: sound, controls, mods, preload, embeds, media) read nothing
// beyond the page and act as nobody: they're listed on a hold, but don't make one on their own; a warned
// combination one of them makes still does (its own need), in the mod or in its site's mods together.

// The menu, in the order a hold lists them. `hold`: the fact a hold shows (after "it", like the classifier's
// facts: held.js, the panel, trif status); `site` in it is the mod's site. `built`: in this version.
const MENU = {
  'read-drafts': { hold: () => 'can read what you type on this site, but can\'t send it anywhere', built: true },
  keys: { hold: () => 'can see the keys you press (not in text fields), so it can have shortcuts', built: true },
  'site-data': { hold: (site) => `can see and filter what ${site} sends this page (posts, profiles), but can't send anything`, built: true },
  'page-data': { hold: (site) => `can read the data ${site} keeps behind what's on the page`, built: true },
  // (0.3: WIDEN.md class B)
  'site-storage': { hold: (site, args) => `can read and change what this site keeps under: ${storageWords(args)}`, built: true },
  'local-fonts': { hold: () => 'can see which fonts are installed on this computer (and this site could see that too)', built: true },
  'image-variants': { hold: (site, args) => `can load other sizes of pictures this page shows (from ${[...new Set((args || []).map((a) => a.split(' ')[0]))].join(', ')})`, built: true },
  sound: { hold: () => 'can play sounds', built: true, soft: true },
  controls: { hold: () => 'can add its own controls (sliders, pickers)', built: true, soft: true },
  mods: { hold: () => 'can talk to your other boxed mods on this page', built: true, soft: true },
  preload: { hold: () => 'can make this page load its pictures sooner', built: true, soft: true },
  media: { hold: () => 'can play and pause video and audio on this page', built: true, soft: true },
  'search-box': { hold: (site, args) => `adds a search box that searches ${args && args[0] ? hostOf(args[0].replace('{link}', 'l')) : site}${args && args[0] && args[0].includes('{link}') ? ' (in the place a link on the page names)' : ''}`, built: true, args: 'one' },
  'go-to': { hold: (site, args) => goToWords(site, args), built: true },
  embeds: { hold: (site, args) => `can play videos this page links to, inside the page (from ${(args || []).map((a) => a.split('/')[0].replace(/^www\./, '')).join(', ')})`, built: true, soft: true },
  'rewrite-requests': { hold: (site, args) => `changes what ${site} receives from this page: ${(args || []).map(rewriteWords).join('; ')}`, built: true },
  'block-events': { hold: (site, args) => `can keep this site from seeing some of what you do here (${blockWords(args)}), so the site doesn't react to it`, built: true },
  'page-events': { hold: (site, args) => `can send this page's own code these signals: ${(args || []).join(', ')}`, built: true },
  // (words in quotes: what the thing has to say, which TRIF checks at each click (extension/sandbox.js); without
  // quotes, the mod's own description of what the selector names)
  click: { hold: (site, args) => `can click these for you: ${(args || []).map((c) => { const i = c.search(/:\s/); const words = c.slice(0, i).trim(), sel = c.slice(i + 1).trim(); const q = /^["\u201c](.+)["\u201d]$/.exec(words); return q ? `only what says "${q[1]}" (${sel})` : `${words} (${sel})`; }).join(', ')}`, built: true },
  'write-drafts': { hold: () => 'can change what you type and paste on this site before you post it', built: true },
  'edit-uploads': { hold: () => 'can change pictures you attach on this site before you post them', built: true },
};
// (the words a hold says for some powers' header values)
const storageWords = (args) => (args || []).map((a) => { const [area, ...k] = a.split(':'); const key = k.join(':'); return area === 'cookie' ? `${key} (a cookie: only read)` : key; }).join(', ');
const rewriteWords = (rule) => {
  const [op, ...sets] = String(rule).split(' ');
  return `${sets.map((x) => {
    const i = x.indexOf('=');
    const v = x.slice(i + 1);
    const j = v.indexOf('→');
    return `${x.slice(0, i).split('.').pop()} set to ${j < 0 ? v : `${v.slice(j + 1)} in place of ${v.slice(0, j).split('|').join(' or ')}`}`;
  }).join(', ')} (in ${op} requests)`;
};
const BLOCK_WORDS = [[/^(mouse|pointer)(over|out|enter|leave|move)$/, 'the mouse moving over things'], [/^key/, 'keys'], [/^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/, 'clicks'],
  [/^(wheel|scroll)$/, 'scrolling'], [/^touch/, 'touches'], [/^(drag|drop)/, 'dragging']];
const blockWords = (args) => {
  const out = [];
  for (const a of args || []) {
    const m = /^([a-z]+)(?:\((.+)\))?$/.exec(a);
    if (!m) continue;
    const w = (BLOCK_WORDS.find(([re]) => re.test(m[1])) || [null, m[1]])[1] + (m[2] ? ` on ${m[2]}` : '');
    if (!out.includes(w)) out.push(w);
  }
  return out.join(', ');
};
const goToWords = (site, args) => {
  const list = (args || []).filter((a) => a !== 'reload');
  const reload = (args || []).includes('reload') ? 'can reload this page; it ' : '';
  return `${reload}${list.length ? `can take you to these pages on ${site}: ${list.map((p) => p.replace(/\[([^\]]+)\]/, (m, v) => `one of ${v.split('|').join(', ')}`)).join(', ')}, or to a link the page shows` : `can take you to a link a page on ${site} shows`}`;
};
const NAMES = Object.keys(MENU);

class PowersError extends Error {}

// ---- the header values of the 0.3 powers (WIDEN.md class B), each checked here and again by the sandbox
// (events a mod may keep from the site: never submit, leaving, visibility, focus or what a field takes in;
// a click-like one only on a selector, as the click power's)
const BLOCKABLE = /^(mouse(over|out|enter|leave|move|down|up)|pointer(over|out|enter|leave|move|down|up)|click|dblclick|auxclick|contextmenu|key(down|up|press)|wheel|scroll|touch(start|move|end)|drag(start|over|enter|leave|end)?|drop)$/;
const CLICKISH = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/;
function checkBlock(a) {
  const m = /^([a-z]+)(?:\(([^()\s,\\{};]{1,200})\))?$/.exec(a);
  if (!m || !BLOCKABLE.test(m[1])) throw new PowersError(`block-events: "${a}" isn't an event it may keep from the site (mouse, pointer, key, wheel, scroll, touch and drag events, and clicks on a selector; never submit, focus, input or leaving the page)`);
  if (CLICKISH.test(m[1]) && !m[2]) throw new PowersError(`block-events: ${m[1]} only on what it names: ${m[1]}(button.cancel)`);
  if (m[2] && /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b/i.test(m[2])) throw new PowersError(`block-events: "${m[2]}" can't name the value attribute or :autofill`);
  return a;
}
// (a page's own event's name: with a - or a :, never a browser event's, TRIF's own, or a framework's that
// the page's code acts on by its name)
const FRAMEWORK_EVENTS = /^(htmx|hx|turbo|turbolinks|alpine|livewire|stimulus|phx|phoenix|react|vue|svelte|ng|ember)[:-]/i;
function checkEventName(n, what) {
  if (!/^[a-z][\w.]*[-:][\w.:-]*$/i.test(n) || n.length > 100) throw new PowersError(`${what}: "${n}" isn't a page's own event's name (one with a - or a : in it: no browser event has either)`);
  if (/^trif:/i.test(n)) throw new PowersError(`${what}: trif: events are TRIF's own`);
  if (what === 'page-events' && FRAMEWORK_EVENTS.test(n)) throw new PowersError(`page-events: "${n}" is named like a framework's own event (htmx:, turbo:, alpine:, …), which the page's code acts on`);
  return n;
}
// (a key of the site's storage: local:, session: or cookie:, the name literal or a prefix with * at the end;
// never everything, nor one named like a login)
const TOKENISH = /(^|[^a-z])(auth|token|session|sess|sid|secret|passw|pwd|jwt|csrf|xsrf|credential|api[-_]?key|bearer|login|oauth)/i;
function checkStorageKey(a) {
  const m = /^(local|session|cookie):([\w.:$@!~+/-]{1,100}?)(\*)?$/.exec(a);
  if (!m) throw new PowersError(`site-storage: "${a}" isn't a key: local:name, session:name or cookie:name (a prefix may end with *)`);
  if (m[3] && m[2].length < 3) throw new PowersError(`site-storage: "${a}": a prefix is at least 3 characters before the *`);
  if (TOKENISH.test(m[2])) throw new PowersError(`site-storage: "${m[2]}" is named like a login (token, session, auth…): a boxed mod doesn't get those`);
  return a;
}
// (a rewrite: the operation's name, then path=value. What a rule may write is as narrow as what it may name:
// the value is true, false, null or a number, which takes the place of one of its kind the request already
// has, or a word that only ever swaps one the header names for another (Top→Recent; several the same way:
// Top|Popular→Recent), so no text the mod's author chose rides in a field that holds the user's words. And
// TRIF's page side never adds a field: the names in a rule carry nothing to the site either.)
const REWRITE_WORD = /^[A-Za-z][\w-]{0,40}$/;
const REWRITE_LITERAL = /^(true|false|null|-?\d{1,15}(\.\d{1,10})?)$/;
/** A rewrite's value as TRIF keeps it ('Top|Popular→Recent' for a swap), or null when it isn't one. */
function rewriteValue(v) {
  if (REWRITE_LITERAL.test(v)) return v;
  // (→, or ->: a word has no >, so the arrow is where the > is)
  const i = v.includes('→') ? v.indexOf('→') : v.indexOf('>') > 0 && v[v.indexOf('>') - 1] === '-' ? v.indexOf('>') - 1 : -1;
  if (i < 0) return null;
  const from = v.slice(0, i).split('|');
  const to = v.slice(i + (v[i] === '→' ? 1 : 2));
  if (from.length > 8 || !from.every((w) => REWRITE_WORD.test(w)) || !REWRITE_WORD.test(to) || from.includes(to)) return null;
  return `${from.join('|')}→${to}`;
}
function checkRewrite(rest) {
  const [op, ...sets] = rest;
  if (!op || !/^[A-Za-z][\w]{0,60}$/.test(op) || !sets.length) throw new PowersError('rewrite-requests takes the request\'s name and what to set in it: @powers rewrite-requests HomeTimeline variables.enableRanking=false');
  const out = [];
  for (const x of sets) {
    const m = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,7})=(.+)$/.exec(x);
    if (!m) throw new PowersError(`rewrite-requests: "${x}" isn't name.path=value`);
    // (a path names the request's own fields: never the names every object has, which lead to its prototype)
    if (/(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(m[1])) throw new PowersError(`rewrite-requests: "${m[1]}" names __proto__, prototype or constructor, which aren't a request's own fields`);
    const v = rewriteValue(m[2]);
    if (v === null && REWRITE_WORD.test(m[2])) throw new PowersError(`rewrite-requests: "${m[2]}" is a word, so say which word it takes the place of: ${m[1]}=Top→${m[2]} (a rule only swaps a setting the request has for another, never writes new text)`);
    if (v === null) throw new PowersError(`rewrite-requests: "${m[2]}" isn't true, false, null, a number or one word swapped for another (Top→Recent): an address or other text could carry data`);
    out.push(`${m[1]}=${v}`);
  }
  return [op, ...out].join(' ');
}
// (other sizes of the page's pictures: the host, then each literal change, from→to (or from->to))
function checkVariant(rest) {
  const [host, ...changes] = rest;
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || !changes.length) throw new PowersError('image-variants takes the pictures\' host and the change: @powers image-variants pbs.twimg.com _normal.→_400x400.');
  const out = [host.toLowerCase()];
  for (const c of changes) {
    const m = /^([^\s→]+?)(?:→|->)([^\s→]*)$/.exec(c);
    if (!m || m[1].length > 60 || m[2].length > 60 || /\/\/|@|\\/.test(m[1] + m[2])) throw new PowersError(`image-variants: "${c}" isn't a change from→to (up to 60 characters each, no // or @)`);
    out.push(`${m[1]}→${m[2]}`);
  }
  return out.join(' ');
}
// (where embedded videos come from: the players TRIF knows how to make an address for, from a link)
const EMBEDS = ['www.youtube.com/embed', 'www.youtube-nocookie.com/embed', 'player.vimeo.com/video'];
function checkEmbed(a) {
  if (!EMBEDS.includes(a)) throw new PowersError(`embeds: "${a}" isn't a player TRIF makes embeds for (${EMBEDS.join(', ')})`);
  return a;
}
// (site-data: the page's data globals, by name, filtered as they're set: never a browser name or a function's)
const BROWSER_NAMES = /^(window|self|top|parent|frames|document|location|history|navigator|fetch|XMLHttpRequest|WebSocket|eval|Function|Object|Array|JSON|Promise|setTimeout|setInterval|localStorage|sessionStorage|indexedDB|crypto|performance|console|alert|open|close|postMessage|chrome|browser|origin|name|status|opener|customElements|trustedTypes|caches|cookieStore|onload|onerror|onmessage|globalThis)$/;
function checkGlobal(n) {
  if (!/^[A-Za-z_$][\w$]{0,60}$/.test(n) || BROWSER_NAMES.test(n) || /^on/.test(n) || /^(webkit|moz|ms)/i.test(n)) throw new PowersError(`site-data: "${n}" isn't a data global TRIF filters (a name like ytInitialData; never a browser name)`);
  return n;
}
/**
 * `// @migrate localStorage rrRave.zoom` lines: what a boxed mod's free version kept in the site's storage,
 * brought into its own settings once (extension/sandbox.js), listed on the hold. Returns ["local:rrRave.zoom", …].
 */
function parseMigrate(values) {
  const out = [];
  for (const v of values || []) {
    const [area, ...keys] = String(v).trim().split(/\s+/);
    const a = { localStorage: 'local', sessionStorage: 'session', local: 'local', session: 'session' }[area];
    if (!a || !keys.length) throw new PowersError(`@migrate "${v}": say where and which keys: // @migrate localStorage my-key other-key`);
    for (const k of keys) { const key = checkStorageKey(`${a}:${k}`); if (key.endsWith('*')) throw new PowersError(`@migrate "${k}": a key by its whole name`); if (!out.includes(key)) out.push(key); }
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
// (a host is the mod's site, or one of its subdomains, or a host its @match lines name)
function sameSite(host, mod) {
  const site = String((mod && mod.site) || '').toLowerCase();
  const h = String(host).toLowerCase();
  if (site && site !== 'all-sites' && (h === site || h.endsWith(`.${site}`))) return true;
  return ((mod && mod.matches) || []).some((p) => { const m = /^[^:]+:\/\/([^/]+)\//.exec(String(p)); if (!m) return false; const ph = m[1].toLowerCase(); return ph === h || (ph.startsWith('*.') && (h === ph.slice(2) || h.endsWith(ph.slice(1)))); });
}

/**
 * The powers a header's `@powers` lines ask for: `values` are the lines' texts ("sound, search-box
 * https://www.amazon.ca/s?k={query}"). Returns the names, in the menu's order, and what some take after
 * their name (`args`: name -> [values]); throws a PowersError for a name not on the menu, one not built yet,
 * or one whose values don't check out. `mod` ({site, matches}) is for the checks that need its site.
 */
function parsePowersWithArgs(values, mod = {}) {
  const out = new Set();
  const args = {};
  for (const v of values || []) {
    for (const item of String(v).split(',')) {
      const [first, ...rest] = item.trim().split(/\s+/);
      const name = (first || '').toLowerCase();
      if (!name) continue;
      if (!MENU[name]) throw new PowersError(`"${name}" isn't a power (the powers: ${NAMES.join(', ')})`);
      if (!MENU[name].built) throw new PowersError(`the ${name} power isn't in this version of TRIF yet`);
      if (name === 'search-box') {
        const t = rest[0];
        if (!t || rest.length > 1) throw new PowersError('search-box takes the site\'s search address, with {query} where the words go: @powers search-box https://www.example.com/search?q={query}');
        let u;
        // ({link}: the path of a link the page shows, put there by TRIF: a place the site's own link names)
        if ((t.match(/\{link\}/g) || []).length > 1) throw new PowersError('search-box: one {link} at most');
        try { u = new URL(t.replace('{query}', 'q').replace('{link}', 'l')); } catch { throw new PowersError(`search-box: "${t}" isn't an address`); }
        if (!/^https?:$/.test(u.protocol) || !t.includes('{query}')) throw new PowersError(`search-box: "${t}" needs to be an http(s) address with {query} in it`);
        if (!sameSite(u.hostname, mod)) throw new PowersError(`search-box: ${u.hostname} isn't this mod's site: a search box searches the site it's on`);
        args[name] = [t];
      } else if (name === 'go-to') {
        // (literal pages of this site: a path, no query, no wildcard, since a path the mod built could carry data;
        // or `reload`; or a path with one query parameter whose values are listed: /?mods=[red|blue])
        for (const p of rest) {
          if (p === 'reload') continue;
          const q = /^(\/[\w\-./~%@!$&'()+;=]*)\?([\w-]{1,40})=\[([^\]]+)\]$/.exec(p);
          if (q) {
            if (q[1].includes('..')) throw new PowersError(`go-to: "${p}" isn't a page of this site`);
            for (const v of q[3].split('|')) if (!/^[\w-]{1,40}$/.test(v)) throw new PowersError(`go-to: "${v}" in ${p} isn't a plain word (letters, digits, - and _): a value can't be an address`);
            continue;
          }
          if (!/^\/[\w\-./~%@!$&'()+;=]*$/.test(p) || p.includes('..') || /[?#*]/.test(p)) throw new PowersError(`go-to: "${p}" isn't a page of this site: a path starting with /, with no query, # or *; or reload; or /path?name=[one|two]`);
        }
        args[name] = [...new Set([...(args[name] || []), ...rest])];
      } else if (name === 'block-events') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkBlock)])];
      else if (name === 'page-events') args[name] = [...new Set([...(args[name] || []), ...rest.map((n) => checkEventName(n, 'page-events'))])];
      else if (name === 'site-storage') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkStorageKey)])];
      else if (name === 'rewrite-requests') args[name] = [...(args[name] || []), checkRewrite(rest)];
      else if (name === 'image-variants') args[name] = [...(args[name] || []), checkVariant(rest)];
      else if (name === 'embeds') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkEmbed)])];
      else if (name === 'site-data') { if (rest.length) args[name] = [...new Set([...(args[name] || []), ...rest.map(checkGlobal)])]; }
      else if (rest.length) throw new PowersError(`the ${name} power takes nothing after its name`);
      if (['block-events', 'page-events', 'site-storage', 'embeds'].includes(name) && !(args[name] || []).length) throw new PowersError(`the ${name} power needs ${({ 'block-events': 'the events it keeps from the site: @powers block-events mouseover keydown click(button.cancel)', 'page-events': 'the signals it sends: @powers page-events my-app-reset', 'site-storage': 'the keys: @powers site-storage local:my-key session:other-key cookie:name', embeds: 'where its videos come from: @powers embeds www.youtube.com/embed' })[name]}`);
      out.add(name);
    }
  }
  return { names: NAMES.filter((n) => out.has(n)), args };
}

/**
 * `// @click words: selector` lines: what a mod with the click power may click, named in words the hold
 * shows, with the selector. Returns ["words: selector", …]; throws for one without words or with a selector
 * TRIF wouldn't take (escapes, the value attribute: as everywhere in the sandbox).
 */
function parseClicks(values) {
  return (values || []).map((v) => {
    const m = /^(.+?):\s+(.+)$/.exec(String(v).trim());
    if (!m || !m[1].trim() || !m[2].trim()) throw new PowersError(`@click "${v}": say what it is, then a colon and its selector: // @click the play button: button.play`);
    const sel = m[2].trim();
    if (sel.includes('\\') || /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b|[{};]/i.test(sel) || sel.length > 500) throw new PowersError(`@click "${v}": that selector isn't one TRIF takes (no \\ escapes, value attribute, :autofill, braces or semicolons)`);
    return `${m[1].trim()}: ${sel}`;
  });
}

/**
 * `// @events trif-endscreen-switch, my-app:ready` lines: the page's own custom events a boxed mod listens
 * for (page.on(name, fn); extension/sandbox.js). Names with a - or a : in them (no browser event has either),
 * never TRIF's own (trif:…). Not a power: hearing a signal the page sends tells the mod nothing the page
 * couldn't put on the page.
 */
function parseEvents(values) {
  const out = [];
  for (const v of values || []) {
    for (const item of String(v).split(/[\s,]+/)) {
      const n = item.trim();
      if (!n) continue;
      if (!/^[a-z][\w.]*[-:][\w.:-]*$/i.test(n) || n.length > 100) throw new PowersError(`@events "${n}": a page's own event's name has a - or a : in it (no browser event has either)`);
      if (/^trif:/i.test(n)) throw new PowersError(`@events "${n}": trif: events are TRIF's own`);
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

// The combinations: helper/lib/combinations.js, every pair and triple, with the warnings a hold shows.
const combos = require('./combinations');
const READS = combos.READS;
function togetherNeeds(list, declared = list) {
  const warns = combos.warningsFor(list);
  const need = (key, fact) => ({ key, fact, power: 'together', soft: false, lines: [] });
  // (more than three powers: one general warning, for that exact set; its combinations are still needs, so
  // a version with fewer powers that the user allowed in this one doesn't ask again; counted by the powers
  // the header declares, @migrate not among them)
  if (declared.length > combos.MANY_OVER) return [need(`power:together:many:${combos.keyOf(list)}`, combos.MANY), ...warns.map((w) => need(w.key, ''))];
  return warns.map((w) => need(w.key, w.fact));
}
/**
 * A hold's lines, from its needs' keys and facts (aligned): "it <fact>", "together, it <fact>", or the
 * many-powers sentence; none for a need without a fact, and a sentence once (two reads with write-drafts
 * are two needs with one warning).
 */
// (what a mod adds to its site's boxed mods together, site:<site>:…, comes after the mod's own)
function factLines(needs, facts) {
  const seen = new Set();
  const own = [], site = [];
  (facts || []).forEach((f, i) => {
    const k = (needs || [])[i] || '';
    const l = factLine(k, f);
    if (l && !seen.has(l)) { seen.add(l); (/^site:/.test(String(k)) ? site : own).push(l); }
  });
  return own.concat(site);
}

/**
 * A need's words after the mod's name: "it <fact>", for a combination "together, it <fact>" (a site's union:
 * "it adds to what your <site> mods can do together", with the site's lists: siteLines); '' for none.
 */
function factLine(key, fact) {
  if (!fact) return '';
  const k = String(key);
  if (/^power:together:many:/.test(k)) return fact;
  if (/^site:/.test(k)) return `it ${fact}`;
  return /^power:together:/.test(k) ? `together, it ${fact}` : `it ${fact}`;
}
/**
 * A site's lists (sitecombos.js reach) for trif status, one line each, as the card has them: ["<site> mods can: …",
 * "they can see: …", "it could end up in: …", then the flag lines].
 */
function siteLines(r) {
  const items = (l) => l.map((x) => `${x.t}${x.new ? ' (new)' : ''}`).join(' · ');
  const label = { act: `${r.site} mods can:`, see: 'they can see:', go: 'it could end up in:' };
  return (r.order || ['act', 'see', 'go']).filter((k) => r[k].length).map((k) => `${label[k]} ${items(r[k])}`)
    .concat(r.flags.map((f) => `${f.t}${f.new ? ' (new)' : ''}`));
}
function parsePowers(values, mod) { return parsePowersWithArgs(values, mod).names; }

// The site a hold names: the mod's folder (x.com), or its sites in general.
function siteOf(mod) {
  const s = String(mod.site || String(mod.id || '').split('/')[0] || '');
  return !s || s === 'all-sites' ? 'the sites it runs on' : s;
}

/**
 * What a boxed mod's powers need allowing: [{key, fact, power, soft}] (held.js needsOf). A power's values
 * are part of its key (a search box's address), so changing them asks again.
 */
function powerNeeds(mod) {
  const site = siteOf(mod);
  const args = (mod && mod.powerArgs) || {};
  const list = Array.isArray(mod.powers) ? mod.powers : [];
  const out = list.filter((n) => MENU[n]).map((n) => ({
    key: `power:${n}${args[n] && args[n].length ? `:${[...args[n]].sort().join(' | ')}` : ''}`, fact: MENU[n].hold(site, args[n]), power: n, soft: !!MENU[n].soft, lines: [],
  }));
  // (@migrate: its old settings brought over from the site's storage once: a need of its own, by its keys)
  if (Array.isArray(args.migrate) && args.migrate.length) {
    out.push({ key: `power:migrate:${[...args.migrate].sort().join(' | ')}`, fact: `brings over its old settings from what this site keeps under: ${args.migrate.map((k) => k.replace(/^\w+:/, '')).join(', ')} (once)`, power: 'migrate', soft: false, lines: [] });
  }
  // the combinations: needs of their own (docs/POWERS.md "Combinations", docs/SAFE-MODS.md); @migrate reads
  // the site's storage, so for them it counts as site-storage (as the sandbox's page-wide rules count it)
  const together = Array.isArray(args.migrate) && args.migrate.length && !list.includes('site-storage') ? NAMES.filter((n) => list.includes(n) || n === 'site-storage') : list;
  return out.concat(togetherNeeds(together, list));
}

/**
 * A boxed mod's powers for the panel's row and code card: each power's words, and the combination warnings
 * as sentences (extension/modlevel.js). A power this version has no entry for has no words here.
 */
function powerInfo(mod) {
  const needs = powerNeeds(mod);
  const together = needs.filter((n) => n.power === 'together');
  return {
    facts: needs.filter((n) => n.power !== 'together').map((n) => ({ power: n.power, fact: n.fact })),
    warnings: factLines(together.map((n) => n.key), together.map((n) => n.fact)),
  };
}

/** Whether a need is a power that doesn't hold on its own (controls, mods). */
function isSoft(key) {
  const m = /^power:([\w-]+)(?::|$)/.exec(String(key)); // (with or without its header values: embeds' players)
  return !!(m && MENU[m[1]] && MENU[m[1]].soft);
}

module.exports = { siteLines, MENU, NAMES, PowersError, parsePowers, parsePowersWithArgs, parseClicks, parseEvents, parseMigrate, EMBEDS, BLOCKABLE, powerNeeds, powerInfo, isSoft, siteOf, sameSite, READS, factLine, factLines };

},
"./powers": function (module, exports, require) {
'use strict';
// What a mod's code can do that matters for the user's account, found by reading the code (not from its
// header, which whoever wrote the mod also wrote). Used to hold a side-panel run's mods (held.js) and for
// the review of mods the user already has. See docs/SECURITY.md.
//
//   powersOf(code, { sites }) -> [{ key, fact, found: [names], line, lines: [line numbers] }]   (empty: restyles, hides, reads)
//
// Keys (stable: approvals are stored by key):
//   sends     sends requests or messages (fetch, XMLHttpRequest, sendBeacon, WebSocket, forms, postMessage…)
//   acts      clicks, types or presses keys for the user (.click(), synthetic UI events, execCommand, the clipboard)
//   loads     loads from an address it works out while running (src/href/url(…) built at run time): such a
//             load can carry what the mod read to anywhere
//   navigates sends the page somewhere (location, window.open)
//   site:<h>  names another site (a URL literal for a host outside the mod's own sites)
//   hidden    code TRIF can't check (eval, Function, string timers, code built from strings, computed
//             access to the page's globals, another frame's window, inline handlers): it could do any of the above
//
// This is a conservative reading, not a proof: anything it can't follow counts as `hidden`, so getting past
// it takes code that looks like nothing at all. It reads tokens (comments and strings are told apart from
// code), and checks its own reading against the JavaScript engine: if the code with every string, comment
// and regex blanked out doesn't compile the same way, the reading was wrong and the mod is `hidden`.

const vm = require('vm');

const FACTS = {
  sends: (f) => `can send requests or messages from the page as you (it uses ${f})`,
  acts: (f) => `can click, type or press keys on the page for you (it uses ${f})`,
  loads: () => 'can load things from addresses it works out while running, which can carry what it reads to another site',
  navigates: (f) => `can send the page somewhere else (it uses ${f})`,
  hidden: (f) => `has code TRIF can't check, which could do any of this (${f})`,
};
const siteFact = (host) => `names another site: ${host}`;

// --- tokens ---------------------------------------------------------------------------------------------

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
const ID_START = /[A-Za-z_$\u0080-￿\\]/;
const ID_PART = /[A-Za-z0-9_$\u0080-￿\\‌‍]/;

/** Tokens: {t: 'id'|'str'|'tpl'|'num'|'p'|'re', v, line, interp?}. Throws on what it can't read. */
function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  // template nesting: each entry is the brace depth at which a `${` opened
  const tplStack = [];
  let braces = 0;
  const prevSig = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.t === 'id') return KEYWORDS_BEFORE_REGEX.has(p.v);
    if (p.t === 'num' || p.t === 'str' || p.t === 're') return false;
    if (p.t === 'tpl') return false;
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '}' || p.v === '++' || p.v === '--');
    return true;
  };
  const readEscapedId = () => { // an identifier, with \uXXXX and \u{...} escapes decoded
    let v = '';
    while (i < n && ID_PART.test(src[i])) {
      if (src[i] === '\\') {
        const m = /^\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(src.slice(i, i + 12));
        if (!m) throw new Error('bad escape in a name');
        v += String.fromCodePoint(parseInt(m[1] || m[2], 16));
        i += m[0].length;
      } else v += src[i++];
    }
    return v;
  };
  const readString = (q) => { // after the opening quote
    let v = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\n') throw new Error('unterminated string');
      if (src[i] === '\\') {
        const c = src[i + 1];
        if (c === '\n') { line++; i += 2; continue; }
        const m = /^\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4}))/.exec(src.slice(i, i + 12));
        if (m) { v += String.fromCodePoint(parseInt(m[1] || m[2] || m[3], 16)); i += m[0].length; continue; }
        v += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
        i += 2;
        continue;
      }
      v += src[i++];
    }
    if (i >= n) throw new Error('unterminated string');
    i++;
    return v;
  };
  // A template's text up to the closing backtick (token 'tpl', end) or to a `${` (token 'tpl', open).
  const readTemplatePart = () => {
    let v = '';
    while (i < n) {
      const c = src[i];
      if (c === '`') { i++; return { v, open: false }; }
      if (c === '$' && src[i + 1] === '{') { i += 2; return { v, open: true }; }
      if (c === '\\') { v += src[i + 1] === '`' ? '`' : src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') line++;
      v += c; i++;
    }
    throw new Error('unterminated template');
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    const at = line;
    if (c === '"' || c === "'") { i++; out.push({ t: 'str', v: readString(c), line: at }); continue; }
    if (c === '`') {
      i++;
      const part = readTemplatePart();
      const tok = { t: 'tpl', v: part.v, line: at, interp: part.open };
      out.push(tok);
      if (part.open) { tplStack.push({ depth: braces, tok }); braces++; out.push({ t: 'p', v: '${', line: at }); }
      continue;
    }
    if (c === '}' && tplStack.length && tplStack[tplStack.length - 1].depth === braces - 1) {
      // the end of a `${…}`: the template goes on
      braces--;
      const { tok } = tplStack.pop();
      out.push({ t: 'p', v: '}$', line: at });
      i++;
      const part = readTemplatePart();
      tok.v += '\u0000' + part.v; // (the pieces between the ${…}s, joined by a mark)
      if (part.open) { tplStack.push({ depth: braces, tok }); braces++; out.push({ t: 'p', v: '${', line: at }); }
      else out.push({ t: 'p', v: '`end', line: at });
      continue;
    }
    if (ID_START.test(c)) { out.push({ t: 'id', v: readEscapedId(), line: at }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xXoObB][0-9a-fA-F_]+n?|(?:\d[\d_]*)?\.?\d*(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i));
      i += Math.max(1, m[0].length);
      out.push({ t: 'num', v: m[0], line: at });
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let k = i + 1, inClass = false;
      while (k < n) {
        const d = src[k];
        if (d === '\n') throw new Error('unterminated regex');
        if (d === '\\') { k += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        k++;
      }
      if (k >= n) throw new Error('unterminated regex');
      k++;
      while (k < n && /[a-z]/i.test(src[k])) k++;
      out.push({ t: 're', v: src.slice(i, k), line: at });
      i = k;
      continue;
    }
    const p3 = src.slice(i, i + 4);
    const op = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>']
      .find((o) => p3.startsWith(o)) || c;
    if (op === '{') braces++;
    if (op === '}') braces--;
    out.push({ t: 'p', v: op, line: at });
    i += op.length;
  }
  if (tplStack.length) throw new Error('unterminated template');
  return out;
}

// The code as these tokens read it, with every string, template and regex replaced by something neutral
// that holds a line break. It must still compile. If the browser would have read one of those as part of
// a regex (a division taken for a regex, or the other way round, after a } or a )), the line break ends
// that regex too early and the result doesn't compile: the tokens were misread, and what looked like a
// string may have been code.
function blanked(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k], prev = tokens[k - 1], next = tokens[k + 1];
    if (t.t === 'str' || (t.t === 'tpl' && !t.interp)) {
      const key = next && next.t === 'p' && next.v === ':' && prev && prev.t === 'p' && (prev.v === '{' || prev.v === ',');
      out.push(key ? '[\n0\n]' : '(\n0\n)');
    } else if (t.t === 'tpl') out.push('(\n[');
    else if (t.t === 're') out.push('/x/');
    else if (t.t === 'p' && t.v === '${') out.push('(');
    else if (t.t === 'p' && t.v === '}$') out.push('),');
    else if (t.t === 'p' && t.v === '`end') out.push(']\n)');
    else out.push(t.v);
  }
  return out.join(' ');
}

function compiles(code) {
  try { new vm.Script(`(async function(){\n${code}\n})`); return true; } catch { return false; }
}

// --- what counts --------------------------------------------------------------------------------------

const SENDS = new Set(['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection',
  'Worker', 'SharedWorker', 'importScripts', 'submit', 'requestSubmit', 'postMessage', 'BroadcastChannel', 'serviceWorker', 'registerProtocolHandler']);
const ACTS = new Set(['click', 'execCommand', 'clipboard', 'dispatchEvent', 'showModal']);
const UI_EVENTS = /^(click|dblclick|auxclick|contextmenu|mouse\w*|pointer\w*|touch\w*|key\w*|input|beforeinput|change|submit|reset|focus\w*|blur|paste|cut|copy|drop|drag\w*|composition\w*|select\w*|wheel)$/i;
const UI_EVENT_CLASSES = new Set(['MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent', 'TouchEvent', 'SubmitEvent', 'FocusEvent', 'WheelEvent', 'DragEvent', 'ClipboardEvent', 'CompositionEvent', 'UIEvent']);
const NAVIGATES = new Set(['location', 'open', 'assign', 'replace', 'navigate']);
// Names that run code TRIF can't read (a reading by name can't see what's in it). Other frames' windows
// (contentWindow, parent) aren't here: their fetch is still called fetch.
const HIDDEN = new Set(['eval', 'Function', 'constructor', 'Reflect', 'createContextualFragment', 'srcdoc', 'GeneratorFunction', 'AsyncFunction',
  // (a property's setter taken out and called reaches it by name as text: getOwnPropertyDescriptor(…, 'src').set.call(img, u))
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', '__lookupSetter__', '__defineSetter__']);
// Ways to make a string TRIF can't read off the page (base64, character codes, reversing): together with
// a name worked out at run time, they can make "fetch" or "script" without writing it.
const DECODERS = new Set(['atob', 'fromCharCode', 'fromCodePoint', 'unescape', 'TextDecoder', 'reverse']);
// Things that hand back the page's globals; a computed property on one (or using one as a value) can reach anything.
const GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames', 'opener', 'navigator', 'document', 'location', 'Object', 'Reflect',
  'HTMLElement', 'Element', 'Node', 'EventTarget', 'HTMLFormElement', 'HTMLInputElement', 'Document', 'Window', 'prototype']);
const LOAD_PROPS = new Set(['src', 'srcset', 'href', 'action', 'formAction', 'formaction', 'poster', 'ping', 'codebase', 'imageSrcset', 'xlink:href']);
const DANGER_TAGS = /^(script|iframe|object|embed|frame|base|meta|portal|fencedframe)$/i;
// Inline handler attributes (on + an event's name) and srcdoc: an attribute name worked out at run time is
// only a worry when it could be one of these. (Not just /^on/: "once" and "oneUp" aren't handlers.)
const HANDLER_ATTR = /^(srcdoc|on(abort|afterprint|animation(end|iteration|start)|auxclick|before(input|print|unload)|blur|cancel|canplay(through)?|change|click|close|contextmenu|copy|cuechange|cut|dblclick|drag(end|enter|leave|over|start)?|drop|durationchange|emptied|ended|error|focus(in|out)?|formdata|hashchange|input|invalid|key(down|press|up)|load(eddata|edmetadata|start)?|message(error)?|mouse(down|enter|leave|move|out|over|up|wheel)|offline|online|page(hide|show)|paste|pause|play(ing)?|pointer(cancel|down|enter|leave|move|out|over|up)|popstate|progress|ratechange|reset|resize|scroll(end)?|search|seek(ed|ing)|select(start|ionchange)?|show|stalled|storage|submit|suspend|timeupdate|toggle|touch(cancel|end|move|start)|transition(cancel|end|run|start)|unload|volumechange|waiting|wheel))$/i;
// Namespace URIs (xmlns), not places a request goes
const NOT_SITES = new Set(['www.w3.org', 'w3.org']);
const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'write', 'writeln', 'parseFromString', 'setHTMLUnsafe']);
const TIMERS = new Set(['setTimeout', 'setInterval']);

function hostsIn(text) {
  const out = [];
  const re = /(?:\b(?:https?|wss?|ftp):)?\/\/([a-z0-9.-]+\.[a-z]{2,}|\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/gi;
  let m;
  while ((m = re.exec(text))) {
    // (a protocol-relative //host only counts where a URL could start: not "a // comment-ish" inside text)
    if (!/^[a-z]+:/i.test(m[0]) && m.index > 0 && !/[\s'"`(=,]/.test(text[m.index - 1])) continue;
    out.push(m[1].toLowerCase());
  }
  return out;
}
function ownHost(host, sites) {
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * The powers in `code`: [{key, fact, found, line}], one per key, in a fixed order. `sites`: the hosts the
 * mod is for (its folder's site and its @match hosts); URLs for those don't count as another site.
 */
function powersOf(code, { sites = [] } = {}) {
  const found = new Map(); // key -> {names:Set, line}
  const add = (key, name, line) => {
    if (!found.has(key)) found.set(key, { names: new Set(), line, lines: new Set() });
    found.get(key).names.add(name);
    found.get(key).lines.add(line);
  };
  let toks;
  try { toks = tokenize(String(code)); } catch (e) { add('hidden', `code TRIF can't read: ${e.message}`, 1); return finish(found); }
  if (!compiles(blanked(toks)) && compiles(String(code))) add('hidden', 'code TRIF reads differently from the browser', 1);
  const site = sites.map((s) => String(s).toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''));
  // Every string the code could hand to something worked out at run time: its string literals, template
  // pieces, literals joined with +, and object keys ({ onload: … } then setAttribute(k, v)).
  const cands = new Set();
  const CMP = new Set(['===', '!==', '==', '!=', 'case']);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // (a string only compared with, el.tagName === 'SCRIPT' or typeof x === 'object', is never handed on)
    if (t.t === 'str' && !(CMP.has(toks[k - 1]?.v) || CMP.has(toks[k + 1]?.v))) cands.add(t.v);
    if (t.t === 'tpl') for (const piece of t.v.split('\u0000')) cands.add(piece.trim());
    if (t.t === 'id' && toks[k + 1] && toks[k + 1].t === 'p' && toks[k + 1].v === ':') cands.add(t.v);
    if (t.t === 'str' && toks[k + 1] && toks[k + 1].v === '+' && toks[k + 2] && toks[k + 2].t === 'str' && !(toks[k - 1] && toks[k - 1].v === '+')) {
      let joined = t.v, j = k;
      while (toks[j + 1] && toks[j + 1].v === '+' && toks[j + 2] && toks[j + 2].t === 'str') { joined += toks[j + 2].v; j += 2; }
      cands.add(joined);
      classifyName(joined, t.line, true, [{}, { t: 'p', v: '(' }], 0); // ('fe' + 'tch': what it spells)
      if (/<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:/i.test(joined)) add('hidden', 'HTML or code spelled out in pieces', t.line);
    }
    // Strings put together from literal pieces in other ways spell names too: ['s', 'r', 'c'].join(''),
    // 'sr'.concat('c'), `${'s'}rc`. Work them out, and count what they spell like any other string.
    const spelled = (joined) => {
      cands.add(joined);
      classifyName(joined, t.line, true, [{}, { t: 'p', v: '(' }], 0);
      if (/<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:/i.test(joined)) add('hidden', 'HTML or code spelled out in pieces', t.line);
    };
    const lit = (x) => x && (x.t === 'str' || (x.t === 'tpl' && !x.interp));
    if (t.t === 'p' && t.v === '[' && lit(toks[k + 1])) { // [ 'a', 'b', … ].join( 'sep'? )
      const parts = [];
      let j = k + 1;
      while (lit(toks[j])) { parts.push(toks[j].v); if (toks[j + 1]?.v === ',') j += 2; else { j++; break; } }
      if (toks[j]?.v === ']' && toks[j + 1]?.v === '.' && toks[j + 2]?.v === 'join' && toks[j + 3]?.v === '(') {
        const sep = lit(toks[j + 4]) && toks[j + 5]?.v === ')' ? toks[j + 4].v : toks[j + 4]?.v === ')' ? ',' : null;
        if (sep !== null) spelled(parts.join(sep));
      }
    }
    if (lit(t) && toks[k + 1]?.v === '.' && toks[k + 2]?.v === 'concat' && toks[k + 3]?.v === '(') { // 'a'.concat('b', …)
      let joined = t.v, j = k + 4;
      while (lit(toks[j])) { joined += toks[j].v; if (toks[j + 1]?.v === ',') j += 2; else { j++; break; } }
      if (toks[j]?.v === ')') spelled(joined);
    }
    if (t.t === 'tpl' && t.interp) { // `${'s'}rc`: a template whose every ${} is one literal
      const pieces = t.v.split('\u0000');
      const inner = [];
      let j = k + 1, ok = true;
      for (let n = 0; n < pieces.length - 1 && ok; n++) {
        if (toks[j]?.v === '${' && lit(toks[j + 1]) && toks[j + 2]?.v === '}$') { inner.push(toks[j + 1].v); j += 3; } else ok = false;
      }
      if (ok) spelled(pieces.map((p, n) => p + (inner[n] ?? '')).join(''));
    }
  }
  const decodes = toks.some((t, k) => {
    if (t.t !== 'id' || !DECODERS.has(t.v)) return false;
    // atob straight into bytes (Uint8Array.from(atob(…)): an embedded sound or picture), not a name
    if (t.v === 'atob' && toks.slice(Math.max(0, k - 4), k).map((x) => x.v).join(' ') === 'Uint8Array . from (') return false;
    // .reverse() on an array is everyday code; only a string's ('…'.split('').reverse()) makes names
    if (t.v === 'reverse') return toks.slice(Math.max(0, k - 8), k).some((x, i, a) => x.v === 'split' && a[i + 2]?.t === 'str' && a[i + 2].v === '');
    return true;
  });
  const could = (re) => decodes || [...cands].some((c) => re.test(c));
  const RISKY_NAMES = new RegExp(`^(${[...SENDS, ...ACTS, ...HIDDEN, 'eval', 'open', 'location', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'src', 'href', 'action', 'srcdoc', 'setAttribute', 'createElement', 'write'].join('|')})$`);

  const isName = (t) => t && (t.t === 'id' || ((t.t === 'str' || (t.t === 'tpl' && !t.interp))));
  const nameOf = (t) => (t.t === 'id' ? t.v : t.v);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], prev = toks[k - 1], next = toks[k + 1];
    const afterDot = prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');
    // a computed member: x[ … ]
    if (t.t === 'p' && t.v === '[' && prev && ((prev.t === 'id' && !KEYWORDS_BEFORE_REGEX.has(prev.v) && !/^(of|in|const|let|var|yield|else|do|case)$/.test(prev.v)) || (prev.t === 'p' && (prev.v === ')' || prev.v === ']')))) {
      // find the closing ]
      let depth = 0, j = k;
      for (; j < toks.length; j++) {
        if (toks[j].t === 'p' && (toks[j].v === '[' || toks[j].v === '(' || toks[j].v === '{' || toks[j].v === '${')) depth++;
        if (toks[j].t === 'p' && (toks[j].v === ']' || toks[j].v === ')' || toks[j].v === '}' || toks[j].v === '}$')) { depth--; if (!depth) break; }
      }
      const inner = toks.slice(k + 1, j);
      const literal = inner.length === 1 && (inner[0].t === 'num' || inner[0].t === 'str' || (inner[0].t === 'tpl' && !inner[0].interp));
      if (literal && inner[0].t !== 'num') {
        classifyName(inner[0].v, inner[0].line, true, toks, j);
      } else if (!literal) {
        // x[k](…), x[k] = …, window[k]: harmless unless k could be a risky name (the code has such a
        // string, or makes strings TRIF can't read)
        const after = toks[j + 1];
        const callAfter = after && after.t === 'p' && (after.v === '(' || after.v === '`');
        const assignAfter = after && after.t === 'p' && after.v === '=';
        const onGlobal = prev.t === 'id' && GLOBALS.has(prev.v) && !(toks[k - 2] && toks[k - 2].t === 'p' && toks[k - 2].v === '.');
        if ((callAfter || onGlobal) && could(RISKY_NAMES)) add('hidden', onGlobal ? `${prev.v}[…] with a name worked out at run time` : 'x[…]() with a name worked out at run time', t.line);
        else if (assignAfter) {
          // (el[k] = fn for an onclick is ordinary code: a handler property only takes functions)
          if (could(/^(innerHTML|outerHTML|srcdoc)$/)) add('hidden', 'x[…] = with a name worked out at run time', t.line);
          else if (could(/^(src|srcset|href|action|formAction|poster|ping)$/)) add('loads', 'x[…] = with a name worked out at run time', t.line);
        }
      }
      continue;
    }
    if (t.t === 'id') {
      const v = t.v;
      classifyName(v, t.line, afterDot, toks, k);
      continue;
    }
    if ((t.t === 'str' || (t.t === 'tpl' && !t.interp)) && /url\(|@import|image-set\(/i.test(t.v) && (next?.v === '+' || prev?.v === '+')) {
      // "url(" + something worked out + ")": CSS that loads from an address built at run time, wherever the
      // string goes (a style element's text, cssText, a property)
      const other = next?.v === '+' ? toks[k + 2] : toks[k - 2];
      if (other && !(other.t === 'str' || other.t === 'num')) add('loads', 'CSS url(…) or @import with an address built at run time', t.line);
    }
    if (t.t === 'tpl' && t.interp && /(?:url\(|@import|image-set\()[^)\u0000]*\u0000/i.test(t.v)) add('loads', 'CSS url(…) or @import with an address built at run time', t.line);
    if (t.t === 'str' || t.t === 'tpl') {
      const text = t.v;
      for (const h of hostsIn(text)) if (!ownHost(h, site) && !NOT_SITES.has(h)) add(`site:${h}`, h, t.line);
      if (/javascript:/i.test(text)) add('hidden', 'a javascript: URL', t.line);
      if (/<\s*(script|iframe|object|embed|frame|base|meta)\b/i.test(text)) add('hidden', `HTML with <${/<\s*(\w+)/.exec(text)[1].toLowerCase()}>`, t.line);
      if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(text)) add('hidden', 'an inline event handler', t.line);
      if (t.t === 'tpl' && t.interp && /url\(\s*['"]?\u0000|(?:src|href|action|srcset|poster|data)\s*=\s*['"]?\u0000/i.test(text)) add('loads', 'an address built into HTML or CSS', t.line);
      if (t.t === 'tpl' && t.interp && /(?:https?:|wss?:)?\/\/[^\u0000\s'"]*\u0000/i.test(text)) add('loads', 'an address built at run time', t.line);
    }
  }
  return finish(found);

  // what a name means where it's used
  function classifyName(v, line, member, ts, k) {
    const nx = ts[k + 1];
    const called = nx && nx.t === 'p' && nx.v === '(';
    const assigned = nx && nx.t === 'p' && /^(=|\+=)$/.test(nx.v);
    if (SENDS.has(v)) {
      if ((v === 'submit' || v === 'requestSubmit' || v === 'postMessage') && !member) return; // (a function of its own called submit)
      add('sends', v, line);
      return;
    }
    if (ACTS.has(v)) {
      if (v === 'click' && !member) return;
      if (v === 'showModal') return;
      if (v === 'dispatchEvent') { if (!dispatchIsHarmless(ts, k)) add('acts', 'dispatchEvent', line); return; }
      add('acts', v === 'click' ? '.click()' : v, line);
      return;
    }
    if (UI_EVENT_CLASSES.has(v) && ts[k - 1] && ts[k - 1].t === 'id' && ts[k - 1].v === 'new') { add('acts', `new ${v}`, line); return; }
    if (v === 'location' && (assigned || (nx && nx.t === 'p' && nx.v === '.' && ts[k + 2] && /^(href|assign|replace|pathname|search|hash|host|hostname|protocol|port)$/.test(ts[k + 2].v) && ts[k + 3] && ts[k + 3].t === 'p' && /^(=|\(|\+=)$/.test(ts[k + 3].v)))) {
      add('navigates', 'location', line);
      return;
    }
    if (v === 'open' && called && (!member || (ts[k - 2] && ts[k - 2].t === 'id' && /^(window|self|globalThis)$/.test(ts[k - 2].v)))) { add('navigates', 'window.open', line); return; }
    if (v === 'navigate' && member && called && ts[k - 2] && ts[k - 2].v === 'navigation') { add('navigates', 'navigation.navigate', line); return; }
    if (HIDDEN.has(v)) {
      if (v === 'constructor' && !member) return;
      if (v === 'constructor' && !called && !(nx && nx.t === 'p' && nx.v === '.')) return; // (reading .constructor to compare classes)
      if (v === 'getOwnPropertyDescriptor' || v === 'getOwnPropertyDescriptors') add('hidden', `Object.${v} (a property's setter by name)`, line), v = null;
      if (v === null) return;
      add('hidden', v === 'Function' ? 'Function' : v, line);
      return;
    }
    if (TIMERS.has(v) && called) {
      const arg = ts[k + 2];
      if (arg && (arg.t === 'str' || arg.t === 'tpl')) add('hidden', `${v} with a string`, line);
      return;
    }
    if (v === 'import' && called) { add('hidden', 'import()', line); return; }
    if (v === 'createElement' && called) {
      const arg = ts[k + 2], close = ts[k + 3];
      const tag = arg && (arg.t === 'str' || (arg.t === 'tpl' && !arg.interp)) && close && close.v === ')' ? arg.v.toLowerCase() : null;
      if (tag === null) { if (could(DANGER_TAGS)) add('hidden', 'createElement with a tag worked out at run time', line); }
      else if (DANGER_TAGS.test(tag)) add('hidden', `a <${tag}> element`, line);
      return;
    }
    if (v === 'assign' && called && member && ts[k - 2]?.v === 'Object') {
      // Object.assign(target, { src: u }) sets target.src like img.src = u does; { [k]: v } could be any name
      let depth = 0;
      for (let j = k + 1; j < ts.length; j++) {
        const x = ts[j];
        if (depth === 2 && x.v === '[' && (ts[j - 1]?.v === '{' || ts[j - 1]?.v === ',')) { add('loads', 'Object.assign with a property name worked out at run time', line); break; }
        if (['(', '[', '{', '${'].includes(x.v)) depth++;
        if ([')', ']', '}', '}$'].includes(x.v)) { depth--; if (!depth) break; }
        if (depth === 2 && ts[j - 1]?.v !== '.' && (x.t === 'id' || x.t === 'str') && ts[j + 1]?.v === ':' && (ts[j - 1]?.v === '{' || ts[j - 1]?.v === ',')) {
          if (LOAD_PROPS.has(x.v) && !literalValue(ts, j + 2)) { add('loads', `Object.assign with ${x.v}`, line); break; }
          if (/^(innerHTML|outerHTML|srcdoc)$/.test(x.v) || /^on[a-z]+$/.test(x.v) && x.v !== 'once') { add('hidden', `Object.assign with ${x.v}`, line); break; }
        }
      }
      return;
    }
    if (v === 'setAttributeNS' && called) {
      // (namespace, name, value): the name second
      let j = k + 2, depth = 0;
      for (; j < ts.length; j++) { if (['(', '[', '{'].includes(ts[j].v)) depth++; if ([')', ']', '}'].includes(ts[j].v)) depth--; if (!depth && ts[j].v === ',') break; }
      const arg = ts[j + 1], comma = ts[j + 2];
      const name = arg && (arg.t === 'str' || (arg.t === 'tpl' && !arg.interp)) && comma && comma.v === ',' ? arg.v.toLowerCase().replace(/^xlink:/, '') : null;
      if (name === null) add('hidden', 'setAttributeNS with a name worked out at run time', line);
      else if (/^on/.test(name)) add('hidden', 'an inline event handler', line);
      else if (LOAD_PROPS.has(name) || name === 'style') { if (!literalValue(ts, j + 3)) add('loads', `setAttributeNS(…, '${name}', …)`, line); }
      return;
    }
    if (v === 'setAttribute' && called) {
      const arg = ts[k + 2], comma = ts[k + 3];
      const name = arg && (arg.t === 'str' || (arg.t === 'tpl' && !arg.interp)) && comma && comma.v === ',' ? arg.v.toLowerCase() : null;
      if (name === null) {
        if (could(HANDLER_ATTR)) add('hidden', 'setAttribute with a name worked out at run time', line);
        else if (could(/^(src|srcset|href|xlink:href|action|formaction|poster|ping|style)$/i)) add('loads', 'setAttribute with a name worked out at run time', line);
      }
      else if (/^on/.test(name)) add('hidden', 'an inline event handler', line);
      else if (LOAD_PROPS.has(name) || name === 'style' || name === 'srcdoc') {
        if (!literalValue(ts, k + 4)) add('loads', `setAttribute('${name}', …)`, line);
      }
      return;
    }
    if (member && LOAD_PROPS.has(v) && assigned && !literalValue(ts, k + 2)) { add('loads', `.${v} = …`, line); return; }
    if (member && (v === 'cssText' || v === 'backgroundImage' || v === 'background' || v === 'content' || v === 'listStyleImage' || v === 'borderImage' || v === 'cursor' || v === 'mask' || v === 'maskImage') && assigned && !literalValue(ts, k + 2)) {
      if (exprHasUrl(ts, k + 2)) add('loads', `style.${v} with url(…)`, line);
      return;
    }
    if (member && v === 'setProperty' && called && exprHasUrl(ts, k + 2)) { add('loads', 'style.setProperty with url(…)', line); return; }
    if (HTML_SINKS.has(v) && member && (assigned || called)) {
      if (v === 'write' || v === 'writeln') { if (ts[k - 2] && ts[k - 2].v === 'document') add('hidden', `document.${v}`, line); return; }
      // HTML from pieces worked out while running could hold an inline handler TRIF can't see
      const start = assigned ? k + 2 : k + 2;
      if (!htmlIsSafe(ts, start)) add('hidden', `${v} with HTML built at run time`, line);
    }
  }
}

// dispatchEvent(new CustomEvent('my-event')) / new Event('tss-test-boss'): the mod's own events, not a
// click or key press on the page. Anything else (an event object from elsewhere, a UI event type) acts.
function dispatchIsHarmless(ts, k) {
  const a = ts[k + 2], b = ts[k + 3], c = ts[k + 4], d = ts[k + 5];
  if (!(ts[k + 1] && ts[k + 1].v === '(' && a && a.t === 'id' && a.v === 'new' && b && (b.v === 'CustomEvent' || b.v === 'Event') && c && c.v === '(')) return false;
  if (!(d && (d.t === 'str' || (d.t === 'tpl' && !d.interp)))) return false;
  return !UI_EVENTS.test(d.v);
}

// The value after `=` up to the end of the expression is one literal (a string, a template without ${}, a number)
function literalValue(ts, k) {
  const v = ts[k], after = ts[k + 1];
  if (!v) return false;
  const lit = v.t === 'str' || v.t === 'num' || (v.t === 'tpl' && !v.interp) || (v.t === 'id' && (v.v === 'null' || v.v === 'undefined'));
  if (!lit) return false;
  return !after || (after.t === 'p' && [';', ',', ')', '}', ']'].includes(after.v)) || after.t === 'id';
}

// Within the expression starting at k (to the next ; at depth 0), any url( in a string or template
function exprHasUrl(ts, k) {
  let depth = 0;
  for (let j = k; j < ts.length; j++) {
    const t = ts[j];
    if (t.t === 'p' && ['(', '[', '{', '${'].includes(t.v)) depth++;
    if (t.t === 'p' && [')', ']', '}', '}$'].includes(t.v)) { if (!depth) return false; depth--; }
    if (!depth && t.t === 'p' && (t.v === ';' || t.v === ',')) return false;
    if ((t.t === 'str' || t.t === 'tpl') && /url\(|image-set\(|@import/i.test(t.v)) return true;
  }
  return false;
}

// HTML assigned or inserted: safe when it's only literals (and +), or a template whose pieces don't open
// an attribute right where a ${} goes (`<b>${name}</b>` is fine; `<img src=${x}>` or `<a ${attr}>` isn't)
function htmlIsSafe(ts, k) {
  let depth = 0;
  for (let j = k; j < ts.length; j++) {
    const t = ts[j];
    if (t.t === 'p' && ['(', '[', '{'].includes(t.v)) depth++;
    if (t.t === 'p' && [')', ']', '}'].includes(t.v)) { if (!depth) return true; depth--; }
    if (!depth && t.t === 'p' && (t.v === ';' || t.v === ',')) return true;
    if (t.t === 'tpl' && t.interp) {
      const pieces = t.v.split('\u0000');
      for (let p = 0; p < pieces.length - 1; p++) {
        // inside a tag (an unclosed <) at the point of a ${}: an attribute could be anything
        const before = pieces.slice(0, p + 1).join('');
        const lastOpen = before.lastIndexOf('<'), lastClose = before.lastIndexOf('>');
        if (lastOpen > lastClose) return false;
      }
    }
    if (t.t === 'p' && t.v === '+' ) {
      // literal + something worked out: only safe if the literal before isn't inside a tag
      const s = ts[j - 1];
      if (s && (s.t === 'str' || s.t === 'tpl')) {
        const lastOpen = s.v.lastIndexOf('<'), lastClose = s.v.lastIndexOf('>');
        if (lastOpen > lastClose) return false;
      }
    }
  }
  return true;
}

const ORDER = ['sends', 'acts', 'navigates', 'loads', 'hidden'];
function finish(found) {
  const keys = [...found.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((key) => {
    const { names, line, lines } = found.get(key);
    const list = [...names].slice(0, 4);
    const f = list.join(', ') + (names.size > 4 ? '…' : '');
    return { key, fact: key.startsWith('site:') ? siteFact(key.slice(5)) : FACTS[key](f), found: [...names], line, lines: [...lines].sort((a, b) => a - b) };
  });
}

/** The hosts a mod is for: its folder's site and its @match patterns' hosts. */
function modSites(mod) {
  const out = new Set();
  const folder = String(mod.id || '').split('/')[0];
  if (folder && folder !== 'all-sites') out.add(folder.toLowerCase().replace(/^www\./, ''));
  for (const m of mod.matches || []) {
    const h = /^[^:]+:\/\/([^/]+)/.exec(m);
    if (h && h[1] !== '*') out.add(h[1].replace(/^\*\./, '').replace(/^www\./, '').toLowerCase());
  }
  return [...out];
}

module.exports = { powersOf, modSites, tokenize, blanked };

},
"./mods": function (module, exports, require) {
'use strict';
// Mod discovery and header parsing. Shared by host.js (pushes mods to the extension) and
// cli.js (`trif mods`, `status`, `doctor`), so both always agree on what a mod is.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_TO_EXTENSION } = require('./framing');
const { within, ignoresCase, unsafeName, shownName } = require('./pathcheck');

const RUN_AT = {
  'document-start': 'document_start',
  'document_start': 'document_start',
  'start': 'document_start',
  'document-end': 'document_end',
  'document_end': 'document_end',
  'end': 'document_end',
  'document-idle': 'document_idle',
  'document_idle': 'document_idle',
  'idle': 'document_idle',
};

// What a shipped mod's `@source` says: `webmods` (the ones shipped while TRIF was called WebMods) or `trif`.
const SHIPPED_SOURCES = new Set(['webmods', 'trif']);
function isShippedSource(source) { return SHIPPED_SOURCES.has(String(source || '').toLowerCase()); }

const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;
const HEADER_LINE = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*?))?\s*$/;

function isIgnoredName(name) {
  return name.startsWith('_') || name.startsWith('.');
}

// Parse the `// ==WebMod==` block. Returns raw header values plus warnings; defaults are applied
// by buildMod because they depend on the folder and file name.
function parseHeader(code) {
  const out = { hasHeader: false, name: null, description: null, matches: [], excludes: [], runAt: null, risk: null, source: null, version: null, rules: false, sandboxed: false, powers: [], clicks: [], events: [], migrate: [], warnings: [] };
  const lines = String(code).replace(/^﻿/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => HEADER_START.test(l));
  if (start === -1) return out;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADER_END.test(lines[i])) { end = i; break; }
  }
  if (end === -1) {
    out.warnings.push('found "// ==WebMod==" but no closing "// ==/WebMod=="; header ignored');
    return out;
  }
  out.hasHeader = true;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(HEADER_LINE);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] || '').trim();
    switch (key) {
      case 'name':
        if (value) out.name = value;
        break;
      case 'description':
        out.description = value;
        break;
      case 'match':
        if (value) out.matches.push(value);
        break;
      case 'exclude':
      case 'exclude-match':
        if (value) out.excludes.push(value);
        break;
      case 'risk': {
        // `@risk <0|1|2> [what makes it that tier]`: see "Account safety" in AGENTS.md.
        const r = /^([0-2])\b\s*(.*)$/.exec(value);
        if (r) out.risk = { tier: Number(r[1]), why: r[2].replace(/^[(:\-–—\s]+|[)\s]+$/g, '') };
        else out.warnings.push(`@risk should start with 0, 1 or 2 (got "${value}")`);
        break;
      }
      // `@source webmods` (or `@source trif`: SHIPPED_SOURCES) and `@version <n>` mark a mod TRIF ships
      // (examples/; they say webmods, from before the rename, so users' copies still match), which setup keeps up
      // to date while the user's copy is unchanged (preinstalled.js). Anyone may write them; the updater
      // also checks the mod is one it shipped.
      case 'source':
        if (value) out.source = value.toLowerCase();
        break;
      case 'version':
        if (value) out.version = value;
        break;
      // `@style` (or `@rules`, its name before): a style mod (lib/rules.js): data after the header, run by
      // TRIF's own code. Inside TRIF it's still a "rules" mod (`rules: true`).
      case 'style':
      case 'rules':
        out.rules = true;
        break;
      // `@boxed` (or `@sandboxed`, its name before): a boxed mod (docs/SAFE-MODS.md): its JavaScript runs in
      // TRIF's own world, with only TRIF's API (extension/sandbox.js). Inside TRIF it's `sandboxed: true`.
      case 'boxed':
      case 'sandboxed':
        out.sandboxed = true;
        break;
      // `@powers sound, read-drafts`: what a boxed mod asks for beyond the sandbox (lib/boxpowers.js); raw
      // here, checked by buildMod
      case 'powers':
        if (value) out.powers.push(value);
        break;
      // `@click the play button: button.play`: what a boxed mod with the click power may click
      case 'click':
        if (value) out.clicks.push(value);
        break;
      // `@events trif-endscreen-switch`: the page's own custom events a boxed mod listens for
      case 'events':
        if (value) out.events.push(value);
        break;
      // `@migrate localStorage my-key`: what a boxed mod's free version kept in the site's storage, brought
      // into its own settings once (listed on the hold)
      case 'migrate':
        if (value) out.migrate.push(value);
        break;
      case 'run-at': {
        const mapped = RUN_AT[value.toLowerCase()];
        if (mapped) out.runAt = mapped;
        else out.warnings.push(`unknown @run-at "${value}"; using document-start`);
        break;
      }
      default:
        break; // unknown keys are ignored
    }
  }
  return out;
}

// The folder for mods with no single home site (every site, or several unrelated ones).
const ALL_SITES = 'all-sites';

function defaultMatches(site) {
  if (site === ALL_SITES) return ['*://*/*'];
  const host = String(site).toLowerCase().replace(/:\d+$/, '');
  // `*.<ip>` is not a meaningful (or valid) host pattern, so IPs only get the exact pattern.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return [`*://${host}/*`];
  return [`*://${host}/*`, `*://*.${host}/*`];
}

// The header's `@style` and `@boxed` lines spelled `@rules` and `@sandboxed` (for the hash only: buildMod).
const NEW_NAMES = { style: 'rules', boxed: 'sandboxed' };
function oldSpelling(code) {
  const text = String(code);
  if (!/@(style|boxed)\b/i.test(text)) return text;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => HEADER_START.test(l.replace(/\r$/, '')));
  if (start === -1) return text;
  for (let i = start + 1; i < lines.length && !HEADER_END.test(lines[i].replace(/\r$/, '')); i++) {
    lines[i] = lines[i].replace(/^(\s*\/\/\s*@)(style|boxed)(?=\s|\r|$)/i, (m, pre, name) => pre + NEW_NAMES[name.toLowerCase()]);
  }
  return lines.join('\n');
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// Build a protocol Mod object. Only the contract's fields go into `mod`; warnings ride alongside.
function buildMod({ site, file, code }) {
  const base = path.basename(file).replace(/\.js$/, '');
  const header = parseHeader(code);
  const meta = {
    id: `${site}/${base}`,
    site,
    file: path.resolve(file),
    name: header.name || base,
    description: header.description || '',
    matches: header.matches.length ? header.matches : defaultMatches(site),
    excludes: header.excludes,
    runAt: header.runAt || 'document_start',
    risk: header.risk, // {tier, why} or null when the header doesn't say
    source: header.source, // 'webmods' (or 'trif') for the mods TRIF ships, else what the header says, or null
    version: header.version, // the header's @version, or null
  };
  // (`sandboxed` only when it is: the hashes of every other mod stay as they were. The code is hashed with its
  // header's new names spelled the old way, so a mod that only changes `@rules` to `@style`, or `@sandboxed` to
  // `@boxed`, keeps its hash: what was allowed for it, and whether it waits, stay as they were.)
  const metaJson = JSON.stringify([meta.id, meta.name, meta.description, meta.matches, meta.excludes, meta.runAt, meta.risk, header.rules, ...(header.sandboxed ? ['sandboxed'] : [])]);
  const hash = sha1(metaJson + '\n' + oldSpelling(code));
  if (header.rules && header.sandboxed) throw new Error('a mod is either a style mod (@style) or a boxed mod (@boxed), not both');
  if (header.powers.length && !header.sandboxed) throw new Error('powers (@powers) are for boxed mods (@boxed): a free mod has every power the page has, and a style mod none');
  // A style section (lib/stylesection.js): taken out of the code before anything reads it. `code` has its lines
  // blank, `text` is the file; `style` is what TRIF applies (its CSS) and hands the code (the settings' values);
  // `codeHash` is the code's own version: the file without the section, with what the settings are, so held.js
  // can tell a change to the section alone. (`hash` stays the file's: the browser re-registers on any change.)
  const section = require('./stylesection').parseSection(code);
  if (section && header.rules) throw new Error('a style mod is all style: its CSS and hide list go in its JSON, without a // ==Style== section');
  const styled = section ? {
    text: code, style: { css: section.css, values: section.values, settings: section.decl },
    codeHash: sha1(JSON.stringify([metaJson, 'style', section.decl]) + '\n' + oldSpelling(section.without)),
  } : {};
  if (section) code = section.code;
  if (header.sandboxed) {
    // (its powers, checked against the menu: throws a PowersError for the scanner to report)
    const bp = require('./boxpowers');
    const { names: powers, args: powerArgs } = bp.parsePowersWithArgs(header.powers, meta);
    const clicks = bp.parseClicks(header.clicks);
    if (clicks.length && !powers.includes('click')) throw new bp.PowersError('@click lines are for a mod with the click power (@powers click)');
    if (powers.includes('click') && !clicks.length) throw new bp.PowersError('the click power needs what it may click: // @click the play button: button.play');
    if (clicks.length) powerArgs.click = clicks;
    const events = bp.parseEvents(header.events);
    if (events.length) powerArgs.events = events;
    const migrate = bp.parseMigrate(header.migrate);
    if (migrate.length) powerArgs.migrate = migrate;
    return { mod: { ...meta, sandboxed: true, ...(powers.length ? { powers } : {}), ...(Object.keys(powerArgs).length ? { powerArgs } : {}), code, hash, ...styled }, warnings: header.warnings };
  }
  if (header.rules) {
    // (what runs is TRIF's code with the checked rules; throws a RulesError for the scanner to report)
    const rules = require('./rules');
    const parsed = rules.parseRules(code);
    return { mod: { ...meta, rules: true, text: code, code: rules.rulesCode(parsed, meta.id), selectors: rules.selectorsOf(parsed), hash }, warnings: header.warnings };
  }
  return { mod: { ...meta, code, hash, ...styled }, warnings: header.warnings };
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// The system's real path (links resolved, and on macOS each component in its on-disk case), or null.
function realOrNull(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

// A run may write its site's folder, so it can plant a link there (sites/x.com/a.js -> ~/.ssh/id_rsa, or
// sites/evil -> ~/.ssh). The helper reads mods outside any sandbox, so an entry whose real path is outside
// the real mods folder is never a mod: it's skipped, with a warning (`skipped`). Links within the mods
// folder are fine.
const LINK_OUTSIDE = 'is a link to somewhere outside the mods folder; ignored';
// (and an entry whose name TRIF couldn't safely write into the code it generates, or show: skipped the same way)
const BAD_NAME = 'ignored';

// List candidate mod files: <modsDir>/<site>/<mod>.js, skipping names starting with _ or ., and entries
// whose real path isn't inside the real mods folder. `skipped` (an array) collects those: {id, file, warning}.
function listModFiles(modsDir, skipped = null) {
  const files = [];
  const root = realOrNull(modsDir);
  if (!root) return files;
  const ci = ignoresCase(root);
  const inside = (p) => !!p && within(p, root, { ci });
  const skip = (id, file, warning = LINK_OUTSIDE) => { if (skipped) skipped.push({ id, file, warning }); };
  let sites;
  try { sites = fs.readdirSync(modsDir); } catch { return files; }
  for (const site of sites.sort()) {
    if (isIgnoredName(site)) continue;
    // (a name is a mod's id, which TRIF writes into the code it generates: pathcheck.js unsafeName)
    const badSite = unsafeName(site);
    if (badSite) { skip(`${shownName(site)}/`, path.join(modsDir, shownName(site)), `${BAD_NAME}: the folder ${badSite}`); continue; }
    const siteDir = path.join(modsDir, site);
    const st = statSafe(siteDir);
    if (!st || !st.isDirectory()) continue;
    if (!inside(realOrNull(siteDir))) { skip(`${site}/`, siteDir); continue; }
    let names;
    try { names = fs.readdirSync(siteDir); } catch { continue; }
    for (const name of names.sort()) {
      if (isIgnoredName(name) || !name.endsWith('.js') || name === '.js') continue;
      const badMod = unsafeName(name);
      if (badMod) { skip(`${site}/${shownName(name.slice(0, -3))}`, path.join(siteDir, shownName(name)), `${BAD_NAME}: the file ${badMod}`); continue; }
      const file = path.join(siteDir, name);
      const fst = statSafe(file);
      if (!fst || !fst.isFile()) continue;
      if (!inside(realOrNull(file))) { skip(`${site}/${name.slice(0, -3)}`, file); continue; }
      files.push({ site, file, mtimeMs: fst.mtimeMs, size: fst.size });
    }
  }
  return files;
}

/**
 * Read a mod file only if it really is inside the mods folder: the file opened is the one whose real path
 * was checked (same device and inode after opening), so swapping in a link between the check and the read
 * doesn't work either. Throws otherwise.
 */
function readModFile(modsDir, file) {
  const root = realOrNull(modsDir);
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const real = realOrNull(file);
    const rst = real ? statSafe(real) : null;
    if (!root || !real || !within(real, root, { ci: ignoresCase(root) }) || !rst || rst.ino !== st.ino || rst.dev !== st.dev) {
      throw new Error(LINK_OUTSIDE);
    }
    if (!st.isFile()) throw new Error('not a file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

// Cheap fingerprint of the folder (names + mtimes + sizes) for change polling.
function folderFingerprint(modsDir) {
  return listModFiles(modsDir).map((f) => `${f.file}:${f.mtimeMs}:${f.size}`).join('\n');
}

// Read and parse every mod. Returns { mods, problems: [{id, file, error}], warnings: [{id, file, warning}] }
// (links outside the mods folder are among the warnings).
function scanMods(modsDir) {
  const mods = [];
  const problems = [];
  const warnings = [];
  for (const { site, file } of listModFiles(modsDir, warnings)) {
    const id = `${site}/${path.basename(file, '.js')}`;
    let code;
    try {
      code = readModFile(modsDir, file);
    } catch (e) {
      if (e.message === LINK_OUTSIDE) warnings.push({ id, file, warning: LINK_OUTSIDE });
      else problems.push({ id, file, error: `can't read file: ${e.message}` });
      continue;
    }
    let built;
    try { built = buildMod({ site, file, code }); } catch (e) { problems.push({ id, file, error: e.message }); continue; }
    const { mod, warnings: w } = built;
    for (const warning of w) warnings.push({ id, file, warning });
    mods.push(mod);
  }
  return { mods, problems, warnings };
}

// How big mods may be. Chrome and Firefox take at most 1 MB per native message, so a set bigger than that
// goes in parts (modsParts below) to an extension that says it can take them (hello `features`). The caps
// leave room under what browsers handle well (docs/PROTOCOL.md "How big mods can be" has the numbers):
// with 16 MB and eight changes in a row, headless Firefox 159 peaked at 1.2-1.3 GB in all (Chrome 156 at
// 0.7), where a 48 MB set, before the extension stopped asking Firefox for every script's code on every
// message, took it to 7.4 GB. Each change still passes the changed mod through the browser several times,
// and Firefox frees those copies late, so the per-mod cap matters as much as the total.
const MAX_MOD_BYTES = 4 * 1024 * 1024;
const MAX_MODS_BYTES = 16 * 1024 * 1024;
// (Sizes rounded up, so one just over a cap never reads as the cap itself: "4.1 MB; up to 4 MB".)
const MB = (n) => `${Math.ceil(n / (1024 * 1024) * 10) / 10} MB`;

/**
 * The mods TRIF sends, within the caps: a mod over `perMod` bytes of code is rejected; if the rest are over
 * `total` together, the largest are left out until they fit. Returns { mods, errors: [{id, error, limit}] }
 * (`limit`: 'mod' or 'total', so `trif doctor` can say what to do).
 */
function planMods(mods, { perMod = MAX_MOD_BYTES, total = MAX_MODS_BYTES } = {}) {
  const errors = [];
  let kept = [];
  for (const m of mods) {
    const size = Buffer.byteLength(String(m.code ?? ''));
    if (size > perMod) errors.push({ id: m.id, limit: 'mod', error: `mod is ${MB(size)}; a mod can be up to ${MB(perMod)}, so it was not sent to the browser (keep sounds, pictures and other big data out of its code)` });
    else kept.push({ m, size });
  }
  let sum = kept.reduce((n, s) => n + s.size, 0);
  if (sum > total) {
    const dropped = new Set();
    for (const s of [...kept].sort((a, b) => b.size - a.size)) {
      if (sum <= total) break;
      dropped.add(s);
      sum -= s.size;
      errors.push({ id: s.m.id, limit: 'total', error: `all mods together are over ${MB(total)}, the most TRIF sends to the browser; this one (the largest, ${MB(s.size)}) was not sent` });
    }
    kept = kept.filter((s) => !dropped.has(s));
  }
  return { mods: kept.map((s) => s.m), errors };
}

/**
 * For an extension that can't take a set in parts (0.2.4 and older): the {type:"mods"} message must fit in one
 * 1 MB native message. Mods that are too big on their own are rejected; if the set as a whole is still too
 * big, the largest are dropped. `who` names the extension in the errors ("TRIF 0.2.4 in Chrome"), whose
 * `limit` is 'extension': updating the extension lifts it.
 */
function planModsMessage(mods, { limit = MAX_TO_EXTENSION - 4096, who = 'this version of the extension' } = {}) {
  const errors = [];
  const update = `${who} takes at most 1 MB of mods; update it to send more`;
  const sized = mods.map((m) => ({ m, size: Buffer.byteLength(JSON.stringify(m)) }));
  let kept = [];
  for (const s of sized) {
    if (s.size > limit - 64) {
      errors.push({ id: s.m.id, limit: 'extension', error: `mod is ${Math.ceil(s.size / 1024)} KB and ${update}, so it was not sent` });
    } else {
      kept.push(s);
    }
  }
  const overhead = Buffer.byteLength(JSON.stringify({ type: 'mods', mods: [] }));
  let total = kept.reduce((n, s) => n + s.size + 1, overhead);
  if (total > limit) {
    const bySize = [...kept].sort((a, b) => b.size - a.size);
    const dropped = new Set();
    for (const s of bySize) {
      if (total <= limit) break;
      dropped.add(s);
      total -= s.size + 1;
      errors.push({ id: s.m.id, limit: 'extension', error: `all mods together are over 1 MB and ${update}; this (largest) mod was not sent` });
    }
    kept = kept.filter((s) => !dropped.has(s));
  }
  return { mods: kept.map((s) => s.m), errors };
}

/**
 * A message's JSON text cut into {type:"modsPart", set, i, n, data} messages, each under `limit` bytes as
 * sent (the slices are JSON-escaped again inside a part, so quotes and backslashes count twice, and anything
 * past ASCII up to three times). The extension joins the `data` of parts 0..n-1 of one `set` and parses it.
 */
function modsParts(json, set, limit = MAX_TO_EXTENSION) {
  const budget = limit - 256; // room for the part's own fields
  const slices = [];
  for (let pos = 0; pos < json.length;) {
    let want = Math.min(json.length - pos, budget);
    for (;;) {
      let end = pos + want;
      // (Not between the halves of a surrogate pair: each half alone would be escaped as \uXXXX.)
      if (end < json.length && end > pos + 1 && /[\ud800-\udbff]/.test(json[end - 1])) end--;
      const slice = json.slice(pos, end);
      const size = Buffer.byteLength(JSON.stringify(slice));
      if (size <= budget) { slices.push(slice); pos = end; break; }
      want = Math.max(1, Math.floor(want * (budget / size) * 0.98));
    }
  }
  return slices.map((data, i) => ({ type: 'modsPart', set, i, n: slices.length, data }));
}

/**
 * The mods to send an extension that takes 'modsSame' (hello `features`): a mod it already has, the same
 * id and hash as in the last set sent to it (`had`: id -> hash), goes without its code, marked `same`; the
 * extension takes the code from the copy it has. So a change to one mod sends that mod's code, not every
 * mod's again: with big mods, each whole copy costs the browser memory it can be slow to give back.
 */
function withSame(mods, had) {
  if (!had) return mods;
  return mods.map((m) => (typeof m.hash === 'string' && had.get(m.id) === m.hash ? { ...m, code: undefined, same: true } : m));
}

/**
 * Mods renamed on disk between two scans: a mod's id is its site folder and file name, so a renamed file
 * is a new id while the old one is gone; the same code in the same site folder is the same mod. Returns
 * [{from, to}], each old id paired once. (extension/lib.js findRenames does the same with the mods the
 * extension last got.)
 */
function findRenames(prev, next) {
  const before = new Set(prev.map((m) => m.id));
  const now = new Set(next.map((m) => m.id));
  const gone = prev.filter((m) => !now.has(m.id));
  const out = [];
  for (const m of next) {
    if (!gone.length) break;
    if (before.has(m.id)) continue;
    const i = gone.findIndex((g) => g.site === m.site && g.code === m.code);
    if (i === -1) continue;
    out.push({ from: gone[i].id, to: m.id });
    gone.splice(i, 1);
  }
  return out;
}

// The metadata of a mod, without its code (for listings).
function summarize(mod) {
  const { code, ...rest } = mod;
  return { ...rest, size: Buffer.byteLength(code) };
}

module.exports = {
  SHIPPED_SOURCES, isShippedSource,
  RUN_AT, ALL_SITES, parseHeader, defaultMatches, buildMod, listModFiles, readModFile, folderFingerprint, scanMods, LINK_OUTSIDE, BAD_NAME,
  planMods, planModsMessage, modsParts, withSame, MAX_MOD_BYTES, MAX_MODS_BYTES, summarize, isIgnoredName, sha1, findRenames,
};

},
"./stylesection": function (module, exports, require) {
'use strict';
// A mod's style section: the part of a boxed or free mod that TRIF applies itself, so an edit there (a
// colour, a size, what's hidden) can't change what the code does and never asks the user again.
//
//   // ==WebMod==
//   // @name   Calm feed
//   // @match  https://x.com/*
//   // @boxed
//   // ==/WebMod==
//   // ==Style==
//   // {
//   //   "css": ["article { font-size: var(--size); }", ".trif-box-mark { outline: 2px solid var(--accent); }"],
//   //   "hide": ["[data-testid=sidebarColumn]"],
//   //   "settings": {
//   //     "size":   { "type": "number", "value": 16, "min": 10, "max": 40, "unit": "px" },
//   //     "accent": { "type": "colour", "value": "#1d9bf0" },
//   //     "marks":  { "type": "on-off", "value": true },
//   //     "layout": { "type": "choice", "value": "list", "options": ["list", "grid"] }
//   //   }
//   // }
//   // ==/Style==
//   if (trif.style.marks) trif.observe('article', (a) => a.classes.add('trif-box-mark'));
//
// The section comes right after the header (blank lines between are fine): `// ==Style==`, a JSON object on
// `//` lines, `// ==/Style==`. In it:
//   css       CSS (text, or a list of lines), checked as a style mod's is (rules.js checkCss: nothing that
//             loads from an address); `var(--<setting>)` is the setting's value
//   hide      selectors to hide, as a style mod's
//   settings  typed values for the code: number (min, max, optional step and unit), colour (#rgb, #rrggbb,
//             with alpha too), on-off (true or false), choice (one of `options`: words)
//
// How it's kept from the code (the condition: the code must never read the section as text, or a "style"
// edit could carry code or data into it unasked):
//   - buildMod strips it before anything else sees the code: the mod's `code` (what TRIF reads for powers,
//     hashes, and sends to the browser) has those lines blank (so line numbers stay the file's), and the
//     section's text goes nowhere as text. The browser gets `style: {css, values, settings}`: the CSS TRIF
//     built from it, which TRIF puts on the page itself (as it does a style mod's), and the settings' values,
//     checked against their types, which the code reads as `trif.style.<name>` (`settings`, what each one
//     is, stays with TRIF). No string the code gets is longer
//     than a choice's word or a colour.
//   - what the settings are (their names, types, ranges and choices) is part of the code: hashed with it
//     (`codeHash`), so changing one is judged as a code change. Only the values, the CSS and the hide list
//     are style.
//   - The CSS is on the page, as a style mod's is: page code can see how things look (as it can for every
//     style mod, which an agent may write without asking). So the section gives the code nothing a style mod
//     couldn't already show it, plus the typed values.
// held.js lets a change run straight away when only the section changed since the version TRIF last let
// run (the same codeHash).

const { checkCss, checkSelector } = require('./rules');

class StyleError extends Error {}

const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;
const START = /^\s*\/\/\s*==Style==\s*$/i;
const END = /^\s*\/\/\s*==\/Style==\s*$/i;
const COMMENT = /^\s*\/\/ ?(.*?)\r?$/;

const MAX = { css: 200000, hide: 500, settings: 40, options: 20, section: 300000 };
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const WORD = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UNITS = new Set(['px', 'em', 'rem', '%', 'vh', 'vw', 'vmin', 'vmax', 'ch', 'ex', 'pt', 's', 'ms', 'deg', 'turn', 'fr', 'dvh', 'dvw', 'svh', 'svw', 'lh']);
// (a type's name as an agent may write it -> TRIF's)
const TYPES = { number: 'number', colour: 'colour', color: 'colour', 'on-off': 'on-off', onoff: 'on-off', boolean: 'on-off', choice: 'choice' };
const KEYS = { number: ['type', 'value', 'min', 'max', 'step', 'unit'], colour: ['type', 'value'], 'on-off': ['type', 'value'], choice: ['type', 'value', 'options'] };

/** Where the section is: {start, end} (line indexes of its two markers), or null when there's none. Throws when misplaced. */
function findSection(lines) {
  const at = [];
  for (let i = 0; i < lines.length; i++) if (START.test(lines[i]) || END.test(lines[i])) at.push(i);
  if (!at.length) return null;
  const first = (lines[0] || '').replace(/^﻿/, '');
  const hs = HEADER_START.test(first) ? 0 : lines.findIndex((l) => HEADER_START.test(l));
  let he = -1;
  if (hs !== -1) for (let i = hs + 1; i < lines.length; i++) if (HEADER_END.test(lines[i])) { he = i; break; }
  const place = 'a style section (// ==Style== … // ==/Style==) goes right after the header\'s // ==/WebMod== line';
  if (he === -1) throw new StyleError(`${place}, and this mod has no header`);
  let start = he + 1;
  while (start < lines.length && !lines[start].trim()) start++;
  if (!START.test(lines[start] || '') || at[0] !== start) throw new StyleError(`${place} (only blank lines between)`);
  const end = at[1];
  if (end === undefined || !END.test(lines[end])) throw new StyleError('the style section has no closing // ==/Style== line');
  if (at.length > 2) throw new StyleError('a mod has one style section');
  return { start, end };
}

/** A setting's value as CSS text. */
function cssValue(name, s) {
  if (s.type === 'number') return `${s.value}${s.unit || ''}`;
  if (s.type === 'colour' || s.type === 'choice') return s.value;
  throw new StyleError(`"css": var(--${name}) is an on-off setting, which CSS can't use as a value (the code can: trif.style.${name})`);
}

function checkSetting(name, s, problems) {
  const at = `"settings".${name}`;
  if (!NAME.test(name)) { problems.push(`${at}: a setting's name is a letter, then letters, digits or _ (up to 40)`); return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) { problems.push(`${at} must be an object { type, value, … }`); return null; }
  const type = TYPES[String(s.type || '').toLowerCase()];
  if (!type) { problems.push(`${at}.type must be number, colour, on-off or choice`); return null; }
  for (const k of Object.keys(s)) if (!KEYS[type].includes(k)) problems.push(`${at}: "${k}" isn't for a ${type} setting (it has ${KEYS[type].join(', ')})`);
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (type === 'number') {
    if (!fin(s.min) || !fin(s.max) || !(s.min < s.max)) { problems.push(`${at}: a number setting needs "min" and "max", numbers, min below max`); return null; }
    if (s.step !== undefined && !(fin(s.step) && s.step > 0)) problems.push(`${at}.step must be a number above 0`);
    if (s.unit !== undefined && !UNITS.has(s.unit)) problems.push(`${at}.unit must be one of ${[...UNITS].join(', ')}`);
    if (!fin(s.value) || s.value < s.min || s.value > s.max) { problems.push(`${at}.value must be a number from ${s.min} to ${s.max}`); return null; }
    return { decl: { type, min: s.min, max: s.max, ...(s.step !== undefined ? { step: s.step } : {}), ...(s.unit ? { unit: s.unit } : {}) }, value: s.value };
  }
  if (type === 'colour') {
    if (typeof s.value !== 'string' || !COLOUR.test(s.value)) { problems.push(`${at}.value must be a colour as #rgb or #rrggbb (or with alpha: #rgba, #rrggbbaa)`); return null; }
    return { decl: { type }, value: s.value.toLowerCase() };
  }
  if (type === 'on-off') {
    if (typeof s.value !== 'boolean') { problems.push(`${at}.value must be true or false`); return null; }
    return { decl: { type }, value: s.value };
  }
  const opts = s.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > MAX.options || !opts.every((o) => typeof o === 'string' && WORD.test(o)) || new Set(opts).size !== opts.length) {
    problems.push(`${at}.options must be 2 to ${MAX.options} different words (a letter, then letters, digits or -, up to 40)`);
    return null;
  }
  if (!opts.includes(s.value)) { problems.push(`${at}.value must be one of its options (${opts.join(', ')})`); return null; }
  return { decl: { type, options: [...opts] }, value: s.value };
}

/**
 * The section's JSON checked: {css (TRIF's CSS: the section's, settings filled in, then the hide rules), values
 * ({name: value}), decl (what the settings are: part of the code)}. Throws a StyleError with every problem.
 */
function checkSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new StyleError('the style section must be a JSON object');
  const problems = [];
  for (const k of Object.keys(spec)) if (!['css', 'hide', 'settings'].includes(k)) problems.push(`unknown key "${k}" (a style section has css, hide, settings)`);
  const settings = {};
  const decl = {};
  const values = {};
  if (spec.settings !== undefined) {
    if (!spec.settings || typeof spec.settings !== 'object' || Array.isArray(spec.settings)) problems.push('"settings" must be an object: { "name": { "type": …, "value": … } }');
    else {
      const names = Object.keys(spec.settings);
      if (names.length > MAX.settings) problems.push(`at most ${MAX.settings} settings`);
      for (const name of names.slice(0, MAX.settings)) {
        const r = checkSetting(name, spec.settings[name], problems);
        if (r) { settings[name] = { ...r.decl, value: r.value }; decl[name] = r.decl; values[name] = r.value; }
      }
    }
  }
  let css = '';
  if (spec.css !== undefined) {
    const parts = typeof spec.css === 'string' ? [spec.css] : Array.isArray(spec.css) && spec.css.every((l) => typeof l === 'string') ? spec.css : null;
    if (!parts) problems.push('"css" must be text, or a list of lines');
    else css = parts.join('\n');
  }
  if (css.length > MAX.css) problems.push(`"css" can be up to ${MAX.css} characters`);
  // (var(--name) for a setting: its value, as text; any other var() is the page's, left as it is)
  if (!problems.length) {
    try { css = css.replace(/var\(\s*--([A-Za-z][A-Za-z0-9_]*)\s*(?:,[^()]*)?\)/g, (m, name) => (Object.prototype.hasOwnProperty.call(settings, name) ? cssValue(name, settings[name]) : m)); } catch (e) { problems.push(e.message); }
  }
  const hide = [];
  if (spec.hide !== undefined) {
    if (!Array.isArray(spec.hide) || spec.hide.length > MAX.hide) problems.push(`"hide" must be a list of at most ${MAX.hide} selectors`);
    else for (const [i, sel] of spec.hide.entries()) { const p = checkSelector(sel); if (p) problems.push(`"hide"[${i}]: ${p}`); else hide.push(sel); }
  }
  if (hide.length) css += `${css ? '\n' : ''}${hide.join(',\n')} { display: none !important; }`;
  if (!problems.length && css) { const p = checkCss(css); if (p) problems.push(`"css": ${p}`); }
  if (problems.length) throw new StyleError(`style section: ${problems.join('; ')}`);
  return { css, values, decl };
}

/**
 * A mod file's style section, or null when it has none: {css, values, decl, code (the file with the section's
 * lines blank: what runs), without (the file with them taken out: what's hashed as the code)}. Throws a
 * StyleError when it's there but wrong (the mod then doesn't load, and `trif check` says why).
 */
function parseSection(text) {
  const src = String(text);
  if (!/==\/?Style==/i.test(src)) return null;
  const lines = src.split('\n');
  const at = findSection(lines);
  if (!at) return null;
  const body = [];
  for (let i = at.start + 1; i < at.end; i++) {
    const m = COMMENT.exec(lines[i]);
    if (!m) { if (!lines[i].trim()) continue; throw new StyleError(`line ${i + 1}: every line of the style section is a // comment`); }
    body.push(m[1]);
  }
  const json = body.join('\n');
  if (json.length > MAX.section) throw new StyleError(`the style section can be up to ${MAX.section} characters`);
  if (!json.trim()) throw new StyleError('the style section needs a JSON object between its two lines');
  let spec;
  try { spec = JSON.parse(json); } catch (e) { throw new StyleError(`the style section isn't valid JSON: ${e.message}`); }
  const r = checkSpec(spec);
  const code = lines.map((l, i) => (i >= at.start && i <= at.end ? '' : l)).join('\n');
  const without = lines.filter((l, i) => i < at.start || i > at.end).join('\n');
  return { ...r, code, without, lines: [at.start + 1, at.end + 1] };
}

/**
 * The style a waiting change brings, put on the version that keeps running meanwhile (host.js): `now`'s CSS,
 * and its values where `was`'s settings take them (a setting of the same name and type, in its range or among
 * its choices); `was`'s own values for the rest. So a change to both waits only for its code part. null when
 * the change has no style section.
 */
function restyle(was, now) {
  if (!now) return null;
  const settings = (was && was.settings) || {};
  const values = { ...((was && was.values) || {}) };
  for (const [name, d] of Object.entries(settings)) {
    if (!Object.prototype.hasOwnProperty.call(now.values || {}, name)) continue;
    const v = now.values[name];
    const n = now.settings && now.settings[name];
    if (!n || n.type !== d.type) continue;
    if (d.type === 'number' ? typeof v === 'number' && v >= d.min && v <= d.max : d.type === 'choice' ? d.options.includes(v) : d.type === 'colour' ? typeof v === 'string' && COLOUR.test(v) : typeof v === 'boolean') values[name] = v;
  }
  // (the CSS: the new one, whatever the settings: TRIF applies it, as it would a style mod's, and the code
  // doesn't get it)
  return { css: String(now.css || ''), values, settings };
}

module.exports = { parseSection, checkSpec, restyle, StyleError, START, END };

},
"./framing": function (module, exports, require) {
'use strict';
// Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON.

// Chrome refuses host->extension messages over 1 MB.
const MAX_TO_EXTENSION = 1024 * 1024;
// Extension->host messages can be much larger (screenshots, response bodies); cap for sanity.
const MAX_FROM_EXTENSION = 256 * 1024 * 1024;

function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Bytes received but not yet used, kept as the chunks they arrived in. A big message arrives in
 * thousands of small chunks; joining them all on every chunk would copy the message over and over
 * (gigabytes for a 20 MB screenshot), so bytes are only joined when they're taken.
 */
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /** The first n bytes (n <= length), without removing them. */
  peek(n) {
    const first = this.chunks[0];
    if (first.length >= n) return first.subarray(0, n);
    const parts = [];
    for (let i = 0, got = 0; got < n; i++) { parts.push(this.chunks[i]); got += this.chunks[i].length; }
    return Buffer.concat(parts).subarray(0, n);
  }

  /** Removes and returns the first n bytes (n <= length). */
  take(n) {
    let i = 0;
    let got = 0;
    while (got < n) got += this.chunks[i++].length;
    const joined = i === 1 ? this.chunks[0] : Buffer.concat(this.chunks.slice(0, i), got);
    this.chunks.splice(0, i);
    if (got > n) this.chunks.unshift(joined.subarray(n));
    this.length -= n;
    return joined.subarray(0, n);
  }

  clear() {
    this.chunks = [];
    this.length = 0;
  }
}

/**
 * Turns pushed chunks into messages. onError(err) gets bad JSON frames (skipped; the next frame is still
 * read) and frames over maxLength. An oversize length means the stream can't be trusted any more (it's
 * most likely out of step, so every later "length" would be garbage), so that error has `fatal: true`
 * and the decoder ignores everything after it: whoever owns the stream should close it.
 */
class Decoder {
  constructor(onMessage, onError = () => {}, maxLength = MAX_FROM_EXTENSION) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.maxLength = maxLength;
    this.queue = new ByteQueue();
    this.need = -1; // the current frame's body length, once its header is read
    this.failed = false;
  }

  push(chunk) {
    if (this.failed) return;
    this.queue.push(chunk);
    for (;;) {
      if (this.need < 0) {
        if (this.queue.length < 4) return;
        const len = this.queue.take(4).readUInt32LE(0);
        if (len > this.maxLength) {
          this.failed = true;
          this.queue.clear();
          const e = new Error(`frame of ${len} bytes exceeds the ${this.maxLength}-byte limit; ignoring the rest of the stream`);
          e.fatal = true;
          this.onError(e);
          return;
        }
        this.need = len;
      }
      if (this.queue.length < this.need) return;
      const body = this.queue.take(this.need);
      this.need = -1;
      let msg;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch (e) {
        this.onError(new Error(`bad JSON frame: ${e.message}`));
        continue;
      }
      this.onMessage(msg);
    }
  }
}

module.exports = { encode, Decoder, ByteQueue, MAX_TO_EXTENSION, MAX_FROM_EXTENSION };

},
"./pathcheck": function (module, exports, require) {
'use strict';
// "Is this path inside that folder?" for checks that are security boundaries (a run's file options, the
// mods folder, the folders a run may read or write). Comparing strings isn't enough:
//   - links: sites/x.com/a.js can be a link to ~/.ssh/id_rsa, and sites/x.com/link/.. isn't sites/;
//   - case: APFS (the macOS default) and NTFS ignore case, so /Users/tim/.TRIF/Config.json is
//     ~/.trif/config.json, while a string check (or Node's fs.realpathSync, which keeps the case it was
//     given) says it's somewhere else.
// So both paths are made real first with the operating system's realpath (fs.realpathSync.native, which on
// macOS also gives each existing component the case it has on disk), and a path that doesn't exist yet is
// the real path of its nearest existing parent plus the rest. Then they're compared with a separator
// boundary (/a/bc isn't inside /a/b), ignoring case (and Unicode normalization) on volumes that do.

const fs = require('fs');
const path = require('path');

function nativeReal(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/**
 * The real path of `p` (relative to the current folder if it isn't absolute), as far as it exists: the
 * operating system resolves every link and `..` in the existing part; the rest is added on as written
 * (`..` in it is resolved by name: there's nothing on disk to follow).
 */
function realish(p) {
  const s = String(p);
  let cur = path.isAbsolute(s) ? s : `${process.cwd()}${path.sep}${s}`;
  const rest = [];
  for (let i = 0; i < 4096; i++) {
    const r = nativeReal(cur);
    if (r) return rest.length ? path.join(r, ...rest.reverse()) : r;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.push(path.basename(cur));
    cur = parent;
  }
  return path.resolve(s);
}

// Whether names on the volume holding `dir` (a real, existing path) ignore case: cached per device.
// Checked by looking up the last component with its letters' case swapped; when that can't say (no
// letters, or nothing to look at), macOS and Windows count as ignoring case.
const caseCache = new Map();
function platformIgnoresCase(platform = process.platform) { return platform === 'darwin' || platform === 'win32'; }
function ignoresCase(dir) {
  let cur = dir;
  for (let i = 0; i < 4096; i++) {
    let st = null;
    try { st = fs.statSync(cur); } catch { /* go up */ }
    if (st) {
      if (caseCache.has(st.dev)) return caseCache.get(st.dev);
      const base = path.basename(cur);
      const swapped = base.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
      let v;
      if (swapped === base || base === '') v = platformIgnoresCase();
      else {
        try { const s2 = fs.statSync(path.join(path.dirname(cur), swapped)); v = s2.dev === st.dev && s2.ino === st.ino; } catch { v = false; }
      }
      caseCache.set(st.dev, v);
      return v;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return platformIgnoresCase();
}

function fold(s, ci) { return ci ? s.normalize('NFC').toLowerCase() : s; }

/**
 * Whether `child` is inside `parent` (both already real, e.g. from realish), `ci` saying whether to ignore
 * case. `orEqual`: the folder itself counts.
 */
function within(child, parent, { ci = false, orEqual = false } = {}) {
  const c = fold(child, ci);
  const p = fold(parent, ci);
  if (c === p) return orEqual;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}

/**
 * Whether `child` is inside `parent`: real paths (links and `..` resolved by the system), a separator
 * boundary, case ignored where the parent's volume ignores it. `orEqual`: the folder itself counts.
 */
function isInside(child, parent, { orEqual = false } = {}) {
  const p = realish(parent);
  return within(realish(child), p, { ci: ignoresCase(p), orEqual });
}

/** Whether two paths name the same place (real paths, case as the volume treats it). */
function samePath(a, b) {
  const rb = realish(b);
  return within(realish(a), rb, { ci: ignoresCase(rb), orEqual: true });
}

// File and folder names a site or mod may not have: they mean something else to a file system (Windows'
// reserved device names; a trailing dot or space, which Windows drops; `:`, the old Mac path separator and
// Windows' stream marker), or go somewhere else (`..`, separators, control characters).
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** Why `name` can't be a site or mod folder/file name ('' when it can). */
function badName(name) {
  const s = String(name ?? '');
  if (!s) return 'empty';
  if (s === '.' || s === '..') return 'not a name';
  if (/[/\\:\0-\x1f\x7f]/.test(s)) return 'has a character file names can\'t have (/ \\ : or a control character)';
  if (/[. ]$/.test(s)) return 'ends with a dot or a space';
  if (/^\s/.test(s)) return 'starts with a space';
  if (RESERVED.test(s)) return 'is a reserved name';
  if (s.length > 200) return 'is too long';
  return '';
}

// A site folder's or mod file's name as the scanner takes it (mods.js listModFiles): anything a file system
// allows, since people name their own files, except characters that end a line or hide text. The name becomes
// the mod's id, which TRIF writes into the code it generates (a `//# sourceURL=` comment) and shows in the
// panel: a line break in it (U+2028 and U+2029 are line breaks to JavaScript too) would end that comment and
// make the rest of the name code; a direction override would show another name than the one on disk.
const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
/** Why `name` can't be a site folder's or mod file's name to the scanner ('' when it can). */
function unsafeName(name) {
  const s = String(name ?? '');
  if (!s) return 'empty';
  if (UNSAFE_IN_NAME.test(s)) return 'has a line break, a control character or a hidden direction mark in its name';
  if (s.length > 200) return 'is too long';
  return '';
}
/** `name` for a message: its unsafe characters shown as "?". */
function shownName(name) { return String(name ?? '').replace(new RegExp(UNSAFE_IN_NAME.source, 'g'), '?').slice(0, 200); }

module.exports = { realish, ignoresCase, within, isInside, samePath, badName, unsafeName, shownName, platformIgnoresCase };

},
"./scope": function (module, exports, require) {
'use strict';
// Side-panel agent runs are limited to one site: the "scope", the registrable domain of the page the
// chat is about (en.wikipedia.org -> wikipedia.org). Page commands from a run may only touch tabs in
// the scope (enforced by the extension, see extension/lib.js `hostInScope`), and mods a run writes
// that match pages outside it are held until the user approves them (host.js). See docs/PROTOCOL.md
// "Run scope".

// Two-label public suffixes common enough to matter (no full Public Suffix List: no dependencies).
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'com.br', 'com.mx', 'co.in', 'co.za', 'com.cn',
  'com.tw', 'com.hk', 'co.kr', 'com.sg', 'com.tr', 'com.ar', 'co.il', 'com.my', 'co.id', 'com.ph',
]);
// Hosting domains where every subdomain belongs to someone else.
const SHARED_SUFFIXES = new Set([
  'github.io', 'githubusercontent.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'blogspot.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'glitch.me',
  'substack.com', 'tumblr.com', 'wordpress.com', 'neocities.org', 'fly.dev', 'onrender.com',
]);

function cleanHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

/** The scope for a host or site name: "www.news.bbc.co.uk" -> "bbc.co.uk", "x.com" -> "x.com". */
function scopeFor(host) {
  const h = cleanHost(host).replace(/^www\./, '');
  if (!h || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  const keep = MULTI_SUFFIXES.has(last2) || SHARED_SUFFIXES.has(last2) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function hostInScope(host, scope) {
  const h = cleanHost(host);
  return !!scope && (h === scope || h.endsWith('.' + scope));
}

// Whether a Chrome match pattern only matches pages in `scope` (no <all_urls>, any-host patterns, file://…).
function patternInScope(pattern, scope) {
  const m = /^(\*|https?):\/\/([^/]*)\//i.exec(String(pattern || '').trim());
  if (!m) return false;
  let host = cleanHost(m[2].replace(/:(\*|\d+)$/, ''));
  if (host.startsWith('*.')) host = host.slice(2);
  if (!host || host.includes('*')) return false;
  return hostInScope(host, scope);
}

// A sensitive host under a registrable domain (mail.google.com) is a site of its own (extension/lib.js
// "sensitive sites"): the extension sends a run the host as its scope, and the sites of their own it knows
// of (`splits`), so the run's folder is sites/mail.google.com/ and sites/google.com/ is another site's, and
// the other way round.

const cleanSite = (h) => cleanHost(h).replace(/^www\./, '');
const SITE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A list of sites of their own from a message: clean host names, each under a longer registrable domain. */
function cleanSplits(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => cleanSite(x)).filter((x) => SITE_RE.test(x) && scopeFor(x) !== x && x.endsWith(`.${scopeFor(x)}`)))].slice(0, 500).sort();
}

/** The site `host` is in: the longest of `splits` it's in, else its registrable domain. */
function scopeOf(host, splits = []) {
  const h = cleanSite(host);
  let best = null;
  for (const s of splits || []) if (hostInScope(h, s) && (!best || s.length > best.length)) best = s;
  return best || scopeFor(h);
}

/**
 * A run's scope: the one the extension sent when it's the site itself or a part of it under the same
 * registrable domain (mail.google.com for inbox.mail.google.com), else the site's registrable domain.
 */
function runScope(site, asked) {
  const s = cleanSite(site);
  const a = cleanSite(asked);
  if (a && SITE_RE.test(a) && hostInScope(s, a) && scopeFor(a) === scopeFor(s) && (a === scopeFor(s) || a.endsWith(`.${scopeFor(s)}`))) return a;
  return scopeFor(s);
}

/** The mod's @match patterns that reach outside `scope` (empty: the mod stays inside it). */
function outOfScope(mod, scope) {
  const matches = Array.isArray(mod && mod.matches) ? mod.matches : [];
  return matches.filter((p) => !patternInScope(p, scope));
}

module.exports = { scopeFor, hostInScope, patternInScope, outOfScope, scopeOf, runScope, cleanSplits };

},
"./diff": function (module, exports, require) {
'use strict';
// A line diff for the panel's "Show what changed" on a waiting change to a mod: hunks of changed lines with
// a little context, as [{t: ' ' | '-' | '+', s: line}], '…' lines between hunks. Common lines at both
// ends are trimmed first; the middle is diffed by longest common subsequence while that's cheap, and
// otherwise shown as all removed then all added (still correct, just coarse).

const MAX_CELLS = 4e6; // the middle's lines before x after (the LCS table)

function lineDiff(before, after, { context = 3, maxLines = 4000 } = {}) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const ops = []; // full sequence: [t, s]
  for (let i = 0; i < start; i++) ops.push([' ', a[i]]);
  if (midA.length * midB.length <= MAX_CELLS) {
    // LCS table, from the end
    const n = midA.length, m = midB.length;
    const W = m + 1;
    const L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = midA[i] === midB[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push([' ', midA[i]]); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) ops.push(['-', midA[i++]]);
      else ops.push(['+', midB[j++]]);
    }
    while (i < n) ops.push(['-', midA[i++]]);
    while (j < m) ops.push(['+', midB[j++]]);
  } else {
    for (const s of midA) ops.push(['-', s]);
    for (const s of midB) ops.push(['+', s]);
  }
  for (let i = endA; i < a.length; i++) ops.push([' ', a[i]]);
  // keep changed lines and `context` lines around them
  const keep = new Uint8Array(ops.length);
  ops.forEach(([t], k) => { if (t !== ' ') for (let d = -context; d <= context; d++) if (k + d >= 0 && k + d < ops.length) keep[k + d] = 1; });
  const out = [];
  let gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) { gap = true; continue; }
    if (gap && out.length) out.push({ t: '…', s: '' });
    gap = false;
    out.push({ t: ops[k][0], s: ops[k][1].length > 400 ? `${ops[k][1].slice(0, 400)}…` : ops[k][1] });
    if (out.length >= maxLines) { out.push({ t: '…', s: '(more changes not shown)' }); break; }
  }
  return out;
}

module.exports = { lineDiff };

}
};
const cache = {};
function require(name) {
  if (BUILTINS[name]) return BUILTINS[name];
  const key = name.replace(/\.js$/, '');
  if (cache[key]) return cache[key].exports;
  if (!SOURCES[key]) throw new Error(`the app has no ${name}`);
  const module = { exports: {} };
  cache[key] = module;
  SOURCES[key](module, module.exports, require);
  return module.exports;
}
// A whole mod file on the iPhone (branch ios-poc): read the way the helper reads one (helper/lib/mods.js buildMod,
// bundled before this by prepare.js with the files it needs), named the way an import names one
// (helper/lib/share.js: its site from its @match, its name from the file's or its @name), what needs the user's
// OK worked out the way held.js does (a boxed mod's powers and their combinations, boxpowers.js; what TRIF's
// reading of a free mod's code finds, powers.js), and the code each world runs made ready. Ends by defining `api`.

const helperMods = require('./mods');
const boxPowers = require('./boxpowers');
const codePowers = require('./powers');
const lineDiff = require('./diff').lineDiff;

/** A Chrome-style match pattern (https://x.com/*, *://*.x.com/*, <all_urls>) as a test of an address. */
function matchesUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return (patterns || []).some((p) => {
    if (p === '<all_urls>') return /^https?:$/.test(u.protocol);
    const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
    if (!m) return false;
    if (m[1] !== '*' && u.protocol !== `${m[1]}:`) return false;
    if (m[1] === '*' && !/^https?:$/.test(u.protocol)) return false;
    const host = m[2];
    if (host !== '*') {
      if (host.startsWith('*.')) { const base = host.slice(2); if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false; }
      else if (u.hostname !== host) return false;
    }
    const path = new RegExp(`^${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return path.test(u.pathname + u.search);
  });
}
const appliesTo = (url, matches, excludes) => matchesUrl(url, matches) && !matchesUrl(url, excludes || []);

// (as helper/lib/share.js has them)
const SITE_RE = /^(?:all-sites|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;
const hostOfMatch = (m) => {
  if (m === '<all_urls>') return '*';
  const x = /^(?:\*|https?|file|ftp):\/\/([^/]+)\//.exec(String(m));
  if (!x) return null;
  return x[1].toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
};
const nameOf = (s) => String(s || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function stripShipped(text) {
  return String(text).split(/\r?\n/).filter((l) => !/^\s*\/\/\s*@(source|version)\b/i.test(l)).join('\n');
}

/** The site a mod is kept under: its @match's one host; for several, the page's if it's one of them, else the first; every site: all-sites. */
function siteFor(header, here) {
  const hosts = [...new Set(header.matches.map(hostOfMatch).filter(Boolean))];
  if (hosts.includes('*')) return 'all-sites';
  const ok = hosts.filter((x) => SITE_RE.test(x));
  const h = String(here || '').toLowerCase().replace(/^www\./, '');
  if (ok.length === 1) return ok[0];
  if (h && ok.includes(h)) return h;
  if (ok.length) return ok[0];
  return h && SITE_RE.test(h) ? h : null;
}

// (a line's hash, as held.js keeps them: a later version is asked about again only for a new or changed line)
const lineHash = (text) => require('crypto').createHash('sha1').update(String(text).trim()).digest('hex').slice(0, 16);

/** What needs the user's OK before the mod runs: [{key, fact, power?, lines?}], as held.js needsOf has it (no run scope here). */
function needsOf(mod) {
  if (mod.rules) return [];
  if (mod.sandboxed) return boxPowers.powerNeeds(mod).filter((n) => !n.soft).map((n) => ({ key: n.key, fact: n.fact, power: n.power }));
  const lines = String(mod.code || '').split('\n');
  const out = codePowers.powersOf(mod.code || '', { sites: codePowers.modSites(mod) })
    .map((p) => ({ key: p.key, fact: p.fact, lines: [...new Set((p.lines || []).map((n) => lineHash(lines[n - 1] || '')))] }));
  if (mod.risk && mod.risk.tier >= 2) out.push({ key: 'risk2', fact: 'says it changes what the site receives (risk 2)' });
  return out;
}

/** The needs not yet allowed: `allowed` is {key: [line hashes]} (allowed.json's shape for one mod). */
function waiting(needs, allowed) {
  const a = allowed || {};
  return (needs || []).filter((n) => !Object.prototype.hasOwnProperty.call(a, n.key) || (n.lines || []).some((l) => !(a[n.key] || []).includes(l)));
}

/** `allowed` with these needs added (Allow). */
function allow(needs, allowed) {
  const out = Object.assign({}, allowed || {});
  for (const n of needs || []) out[n.key] = [...new Set([...(out[n.key] || []), ...(n.lines || [])])];
  return out;
}

/**
 * A mod's text -> everything the app keeps and runs, or {error}. `file`: the file's name (an import), else the
 * mod is named by its @name; `site`: the site to keep it under, when known; `here`: the page's host (which of
 * several sites). `shipped`: keep @source/@version (only TRIF's own mods; an import or a chat never does).
 */
function readMod(text, { file = '', site = '', here = '', shipped = false } = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  if (!raw.trim()) return { error: 'the file is empty' };
  if (Buffer.byteLength(raw) > helperMods.MAX_MOD_BYTES) return { error: `the file is bigger than a mod can be (${helperMods.MAX_MOD_BYTES / 1024 / 1024} MB)` };
  const code = shipped ? raw : stripShipped(raw);
  let header;
  try { header = helperMods.parseHeader(code); } catch (e) { return { error: `this mod's header has a problem: ${(e && e.message) || e}` }; }
  if (!header.hasHeader) return { error: 'this file has no // ==WebMod== header, so it isn\'t a mod TRIF can read' };
  const s = site || siteFor(header, here);
  if (!s) return { error: 'its @match lines name no site' };
  const base = nameOf(file) || nameOf(header.name) || 'mod';
  let mod;
  try { mod = helperMods.buildMod({ site: s, file: `${base}.js`, code }).mod; } catch (e) { return { error: `this mod's header has a problem: ${(e && e.message) || e}` }; }
  const tier = mod.rules ? 'style' : mod.sandboxed ? 'boxed' : 'free';
  const id = mod.id;
  const m = matchesUrl.toString();
  const guard = `if (!(${m})(location.href, ${JSON.stringify(mod.matches)}) || (${m})(location.href, ${JSON.stringify(mod.excludes || [])})) return;`;
  // (each world keeps the ids of the mods that started in it on this page: the Mods tab's "Running on this page")
  const ran = `(globalThis.__trifRan = globalThis.__trifRan || []).push(${JSON.stringify(id)});`;
  let script, world, at;
  if (tier === 'style') {
    script = `(function () { ${guard}\n${ran}\n${mod.code}\n})();`;
    world = 'trif'; at = 'start';
  } else if (tier === 'boxed') {
    const grant = { powers: mod.powers || [], args: mod.powerArgs || {}, ...(mod.style ? { style: { css: String(mod.style.css || ''), values: mod.style.values || {} } } : {}) };
    script = `(function () { ${guard}\n` +
      'if (!globalThis.__trifSandbox) { if (typeof globalThis.__trifStartSandbox !== "function") return; globalThis.__trifStartSandbox(); }\n' +
      `${ran}\nglobalThis.__trifSandbox.run(${JSON.stringify(id)}, ${JSON.stringify(String(mod.code))}, ${JSON.stringify(grant)});\n})();`;
    world = 'box'; at = 'end';
  } else {
    // (its errors kept on the page, for the chat and the Mods tab: Browser.modErrors)
    script = `(async function () { ${guard}\n${ran}\n${String(mod.code)}\n})().catch((e) => { (window.__trifModErrors = window.__trifModErrors || []).push(${JSON.stringify(id)} + ": " + ((e && e.message) || e)); console.error("TRIF mod ${id}:", e); });`;
    world = 'page'; at = mod.runAt === 'document_start' ? 'start' : 'end';
  }
  return {
    id, site: s, name: mod.name, description: mod.description || '', tier, matches: mod.matches, excludes: mod.excludes || [],
    sites: s === 'all-sites' ? ['all-sites'] : codePowers.modSites(mod), runAt: mod.runAt, powers: mod.powers || [], powerArgs: mod.powerArgs || {},
    powerInfo: mod.sandboxed ? boxPowers.powerInfo(mod) : null, risk: mod.risk || null, hash: mod.hash,
    needs: needsOf(mod), code: code, script, world, at,
  };
}

/** The first mod file in a chat's reply: a ```js block holding ==WebMod==, or the text itself. */
function findMod(text) {
  const t = String(text);
  for (const x of t.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) if (/==WebMod==/.test(x[1])) return x[1];
  const at = t.search(/^\s*\/\/\s*==WebMod==/m);
  return at === -1 ? null : t.slice(at);
}

// (the probe's earlier name for readMod)
const parseMod = (text, opts) => readMod(text, opts);

const api = { readMod, parseMod, findMod, matchesUrl, appliesTo, needsOf, waiting, allow, lineDiff, nameOf, siteFor };

return api;
})();
