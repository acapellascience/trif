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
