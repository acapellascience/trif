// Made by mobile/prepare.js from helper/lib/rules.js and mobile/shared/modfile.js: don't edit.
globalThis.__trifMods = (function () {
const module = { exports: {} };
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

const rules = module.exports;
// A whole mod file, as a chat hands it over (proof of concept, branch ios-poc): its header read, its tier
// worked out the way the helper does (helper/lib/mods.js), and the code each world runs made ready. Wrapped
// into shared/gen/mods.js by prepare.js, after helper/lib/rules.js (as `rules`). Ends by defining `api`.

/** The header's lines: `// @key value`, between ==WebMod== and ==/WebMod==; each key's values in order. */
function readHeader(text) {
  const t = String(text).replace(/^﻿/, '');
  const start = t.search(/^\s*\/\/\s*==WebMod==\s*$/m);
  const end = t.search(/^\s*\/\/\s*==\/WebMod==\s*$/m);
  if (start === -1 || end === -1 || end < start) throw new Error('no ==WebMod== header');
  const keys = {};
  for (const line of t.slice(start, end).split('\n')) {
    const m = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*))?$/.exec(line);
    if (m) (keys[m[1].toLowerCase()] = keys[m[1].toLowerCase()] || []).push((m[2] || '').trim());
  }
  return keys;
}

/** A Chrome-style match pattern (https://x.com/*, *://*.x.com/*, <all_urls>) as a test of an address. */
function matchesUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return patterns.some((p) => {
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

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mod';

/**
 * A mod file -> {id, name, description, tier: 'style'|'boxed'|'free', matches, sites, runAt, powers, code,
 * script, world: 'trif'|'box'|'page', at: 'start'|'end'}, or {error}. `script` is what the app installs:
 * the mod behind a check of the page's address.
 */
function parseMod(text) {
  try {
    const h = readHeader(text);
    const name = (h.name && h.name[0]) || 'Untitled mod';
    const matches = (h.match || []).concat(h.include || []).filter(Boolean);
    if (!matches.length) throw new Error('the header needs at least one @match line');
    const style = !!(h.style || h.rules), boxed = !!(h.boxed || h.sandboxed);
    if (style && boxed) throw new Error('a mod is either a style mod (@style) or a boxed mod (@boxed), not both');
    const tier = style ? 'style' : boxed ? 'boxed' : 'free';
    const id = slug(name);
    const powers = (h.powers || []).join(' ').split(/[\s,]+/).filter(Boolean);
    const runAt = (h['run-at'] && h['run-at'][0]) || '';
    const sites = [...new Set(matches.map((p) => (/^[^:]+:\/\/([^/]+)/.exec(p) || [])[1] || p))];
    const guard = `if (!(${matchesUrl.toString()})(location.href, ${JSON.stringify(matches)})) return;`;
    let script, world, at;
    if (tier === 'style') {
      const code = rules.rulesCode(rules.parseRules(text), id);
      script = `(function () { ${guard}\n${code}\n})();`;
      world = 'trif'; at = 'start';
    } else if (tier === 'boxed') {
      script = `(function () { ${guard}\n` +
        'if (!globalThis.__trifSandbox) { if (typeof globalThis.__trifStartSandbox !== "function") return; globalThis.__trifStartSandbox(); }\n' +
        `globalThis.__trifSandbox.run(${JSON.stringify(id)}, ${JSON.stringify(String(text))}, { powers: ${JSON.stringify(powers)}, args: {} });\n})();`;
      world = 'box'; at = 'end';
    } else {
      script = `(async function () { ${guard}\n${String(text)}\n})().catch((e) => console.error("TRIF mod ${id}:", e));`;
      world = 'page'; at = runAt === 'document-start' ? 'start' : 'end';
    }
    const description = (h.description && h.description[0]) || '';
    return { id, name, description, tier, matches, sites, runAt, powers, code: String(text), script, world, at };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** The first mod file in a chat's reply: a ```js block holding ==WebMod==, or the text itself. */
function findMod(text) {
  const t = String(text);
  for (const m of t.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) if (/==WebMod==/.test(m[1])) return m[1];
  const at = t.search(/^\s*\/\/\s*==WebMod==/m);
  return at === -1 ? null : t.slice(at);
}

const api = { parseMod, findMod, matchesUrl, readHeader };

return api;
})();
