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

// Walks CSS outside quoted strings: `visit(char, i)` for each character there. A backslash outside a
// string is refused (an escape can spell a function's or rule's name: u\72l( is url().
function outsideStrings(css, visit) {
  let q = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); if (e === -1) return 'an unclosed comment'; i = e + 1; continue; }
    const r = visit(c, i);
    if (r) return r;
  }
  return q ? 'an unclosed string' : null;
}

/**
 * CSS a rules mod may have: anything that changes how the page looks, but nothing that loads from an
 * address (which can carry what the page shows to another site): url() only with data:, and no @import,
 * image-set(), image(), cross-fade(), element(), or the old script-running properties. null when fine.
 */
function checkCss(css) {
  const flat = [];
  const bad = outsideStrings(css, (c, i) => {
    if (c === '\\') return 'a backslash escape outside a string (an escape can spell url( or @import)';
    flat.push([c, i]);
    return null;
  });
  if (bad) return bad;
  const text = flat.map(([c]) => c).join('').toLowerCase();
  if (/@import\b/.test(text)) return '@import loads from an address; put the CSS here instead';
  if (/(?:^|[^a-z-])(?:-webkit-)?(image-set|image|cross-fade|element)\s*\(/.test(text)) return 'image-set(), image(), cross-fade() and element() can load from an address';
  if (/expression\s*\(|-moz-binding|behavior\s*:/.test(text)) return 'that property runs code';
  // url(…): only data: (the argument read from the original text, quotes and all)
  const re = /url\s*\(/gi;
  let m;
  const orig = flat.map(([c]) => c).join('');
  while ((m = re.exec(orig))) {
    const start = flat[m.index + m[0].length - 1][1] + 1;
    const arg = css.slice(start).replace(/^\s*["']?\s*/, '');
    if (!/^data:/i.test(arg)) return 'url() loads from an address: only data: is allowed in a style mod';
  }
  return null;
}

// A selector: it goes into querySelectorAll, and into generated CSS (`sel { display: none !important }`),
// so it may not close the rule or start another, and no escapes (as in checkCss).
function checkSelector(sel) {
  if (typeof sel !== 'string' || !sel.trim() || sel.length > MAX.selector) return `a selector must be text, 1 to ${MAX.selector} characters`;
  return outsideStrings(sel, (c) => ('{};@\\'.includes(c) ? `"${c}" can't be in a selector here` : null));
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
          if (p && (p.closest('script,style,textarea,[contenteditable=""],[contenteditable=true]'))) continue;
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
  return `// TRIF rules mod ${JSON.stringify(String(id || ''))}: TRIF's own code, the mod's rules as data (helper/lib/rules.js)\n` +
    `(${rulesRuntime.toString()})(${JSON.stringify(spec)});\n`;
}

module.exports = { parseRules, checkRules, checkCss, checkSelector, checkRegex, rulesRuntime, rulesCode, RulesError };
