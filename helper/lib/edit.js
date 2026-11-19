'use strict';
// Editing a mod in the side panel's code card (Edit, then Save): the helper checks the text as `trif check`
// checks a file and writes it, never the extension. The model is the iPhone app's (mobile/, its code card's Edit).
//
//   checkText(text, {site, file}) -> {ok, errors: [{line, message}], lint: [{what, why, lines}], tier}
//     The header (powers, clicks, a mod with two tiers), a style mod's rules and CSS, a style section, the code's
//     syntax, and for a boxed mod what the sandbox would refuse (sandboxlint.js). Each problem with the line it's
//     on where that can be told, so the editor can go to it. Nothing broken is saved.
//   saveEdit(ws, {id, text, base}) -> {ok: false, check} | {ok: false, conflict: true} | {ok: true, saved, stamp, hash}
//     `base` is the hash (fileHash) of the text the editor started from: when the file isn't that any more (another
//     editor, an agent, another browser's panel saved it meanwhile), nothing is written. The version before goes
//     into the mod's history (history.js, source `edit`), and held.js is told the change is the user's edit
//     (recordEdit), so the next sync judges it as any change plus what an edit adds (a site, becoming free).
//   undoEdit(ws, {id, stamp, hash}) -> {id, restored}
//     Undo right after Save: the version kept at `stamp` back, if the file is still the edit (`hash`).
//
// The mod's id stays its file's: a new @name only changes the name shown (mods.js buildMod); Rename (lib/rename.js)
// moves the file too. A saved edit gets a stable id (@id) if it has none.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { buildMod, parseHeader, MAX_MOD_BYTES } = require('./mods');
const trash = require('./trash');
const history = require('./history');

class EditError extends Error {}

/** The hash an edit is checked against: the file's text, as the code card got it (mod.code). */
const fileHash = (text) => crypto.createHash('sha1').update(String(text)).digest('hex');

// The line of the first thing JSON.parse would stop at, by JSON's grammar (Node's own messages say where only in
// newer versions, and as a position): null when nothing is wrong.
function jsonErrorLine(text) {
  const t = String(text);
  let i = 0;
  const fail = () => { throw new Error(String(t.slice(0, i).split('\n').length)); };
  const ws = () => { while (i < t.length && /\s/.test(t[i])) i++; };
  const lit = (w) => { if (t.startsWith(w, i)) i += w.length; else fail(); };
  const str = () => {
    i++;
    while (i < t.length && t[i] !== '"') {
      if (t[i] === '\n') fail();
      if (t[i] === '\\') { i++; if (!/["\\/bfnrtu]/.test(t[i] || '')) fail(); }
      i++;
    }
    if (t[i] !== '"') fail();
    i++;
  };
  const value = () => {
    ws();
    const c = t[i];
    if (c === '{') {
      i++; ws();
      if (t[i] === '}') { i++; return; }
      for (;;) { ws(); if (t[i] !== '"') fail(); str(); ws(); if (t[i] !== ':') fail(); i++; value(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === '}') { i++; return; } fail(); }
    }
    if (c === '[') {
      i++; ws();
      if (t[i] === ']') { i++; return; }
      for (;;) { value(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === ']') { i++; return; } fail(); }
    }
    if (c === '"') return str();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i));
    if (!m || !m[0]) fail();
    i += m[0].length;
  };
  try { value(); ws(); if (i < t.length) fail(); return null; } catch (e) { return Number(e.message) || null; }
}

const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;

// The header line a problem is about: the @key it names, or the one a power's problem comes from.
function headerLine(lines, start, end, message) {
  const m = String(message);
  const key = /@([\w-]+)/.exec(m);
  const want = key ? key[1] : /power/.test(m) ? 'powers' : /match/.test(m) ? 'match' : null;
  if (!want || start === -1) return null;
  const names = want === 'style' ? ['style', 'rules'] : want === 'boxed' ? ['boxed', 'sandboxed'] : [want];
  for (let i = start + 1; i < end; i++) if (names.some((n) => new RegExp(`^\\s*//\\s*@${n}\\b`, 'i').test(lines[i]))) return i + 1;
  return null;
}

// The line of the first key `"name"` after `from` (a style mod's rule, a style section's setting)
function keyLine(lines, from, name) {
  for (let i = Math.max(0, from); i < lines.length; i++) if (lines[i].includes(`"${name}"`)) return i + 1;
  return null;
}

/** An edit, checked as `trif check` checks a file. See the top of this file. */
function checkText(text, { site = '', file = 'mod.js' } = {}) {
  const raw = String(text ?? '');
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => HEADER_START.test(l.replace(/^﻿/, '')));
  let end = -1;
  if (start !== -1) for (let i = start + 1; i < lines.length; i++) if (HEADER_END.test(lines[i])) { end = i; break; }
  const header = parseHeader(raw);
  const tierOf = (h) => (h.rules ? 'style' : h.sandboxed ? 'boxed' : 'free');
  const fail = (errors, lint = []) => ({ ok: false, errors, lint, tier: tierOf(header) });
  if (Buffer.byteLength(raw) > MAX_MOD_BYTES) return fail([{ line: null, message: `a mod can be up to ${MAX_MOD_BYTES / 1024 / 1024} MB` }]);
  if (start !== -1 && end === -1) return fail([{ line: start + 1, message: 'found "// ==WebMod==" but no closing "// ==/WebMod==", so the header would be ignored' }]);
  let built;
  try { built = buildMod({ site, file, code: raw }).mod; } catch (e) {
    const message = String(e && e.message ? e.message : e);
    // a style mod's JSON: where JSON.parse stopped, in the file's lines (its comment lines kept as blank lines)
    if (/^the rules aren't valid JSON/.test(message)) {
      const body = lines.slice(end + 1).map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n').replace(/^(\s*)\(/, '$1 ').replace(/\)\s*;?\s*$/, '');
      const at = jsonErrorLine(body);
      return fail([{ line: at === null ? null : end + 1 + at, message }]);
    }
    // a style section's (stylesection.js): "line N: …", its JSON, or the setting a problem names
    const section = lines.findIndex((l) => /^\s*\/\/\s*==Style==\s*$/i.test(l));
    if (e instanceof require('./stylesection').StyleError) {
      const said = /^line (\d+): /.exec(message);
      if (said) return fail([{ line: Number(said[1]), message: message.slice(said[0].length) }]);
      if (/isn't valid JSON/.test(message) && section !== -1) {
        const close = lines.findIndex((l, i) => i > section && /^\s*\/\/\s*==\/Style==\s*$/i.test(l));
        const body = lines.slice(section + 1, close === -1 ? lines.length : close).map((l) => l.replace(/^\s*\/\/ ?/, '')).join('\n');
        const at = jsonErrorLine(body);
        return fail([{ line: at === null ? section + 1 : section + 1 + at, message }]);
      }
      const parts = message.replace(/^style section: /, '').split('; ');
      return fail(parts.map((p) => { const k = /^"([\w-]+)"/.exec(p); return { line: (k && section !== -1 && keyLine(lines, section, k[1])) || (section === -1 ? null : section + 1), message: p }; }));
    }
    // a style mod's rules: each problem, on the line of the rule it names
    if (e instanceof require('./rules').RulesError) {
      const parts = message.split('; ');
      return fail(parts.map((p) => { const k = /^"([\w-]+)"/.exec(p) || /^unknown rule "([\w-]+)"/.exec(p); return { line: (k && keyLine(lines, end + 1, k[1])) || null, message: p }; }));
    }
    return fail([{ line: headerLine(lines, start, end, message), message }]);
  }
  const tier = built.rules ? 'style' : built.sandboxed ? 'boxed' : 'free';
  if (tier === 'style') return { ok: true, errors: [], lint: [], tier };
  // The syntax, as trif check compiles it: nothing runs. (A boxed mod's code runs inside an async function:
  // a top-level return or await is fine there. Its style section's lines are blank in `code`, so lines stay.)
  try {
    new vm.Script(built.sandboxed ? `(async function () {\n${built.code}\n})` : built.code, { filename: 'mod.js', lineOffset: built.sandboxed ? -1 : 0 });
  } catch (e) {
    const m = /^mod\.js:(\d+)/.exec(String(e && e.stack));
    return { ok: false, errors: [{ line: m ? Math.min(Math.max(1, Number(m[1])), lines.length) : null, message: String(e && e.message ? e.message : e) }], lint: [], tier };
  }
  // A boxed mod: what the sandbox doesn't give it, which would fail when it runs (iPhone's Save refuses it too)
  const lint = tier === 'boxed' ? require('./sandboxlint').sandboxLint(built.code, { powers: built.powers || [] }) : [];
  return { ok: !lint.length, errors: [], lint, tier };
}

// The mod's own file, from its id (never a path from the message), as a plain file inside the mods folder.
function modFile(ws, id) {
  const { site, mod } = trash.parseId(id);
  const file = path.join(ws.modsDir, site, `${mod}.js`);
  let st;
  try { st = fs.lstatSync(file); } catch { throw new EditError(`there's no mod ${site}/${mod}`); }
  if (st.isSymbolicLink()) throw new EditError(`${site}/${mod} is a link to another file: edit that file instead`);
  if (!st.isFile()) throw new EditError(`there's no mod ${site}/${mod}`);
  return { site, mod, file, id: `${site}/${mod}` };
}

function writeText(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  fs.renameSync(tmp, file);
}

/** Save an edit. See the top of this file. */
function saveEdit(ws, { id, text, base }) {
  const f = modFile(ws, String(id ?? ''));
  if (typeof text !== 'string') throw new EditError('the edit must be text');
  if (typeof base !== 'string' || !base) throw new EditError('missing the version the edit started from');
  const current = fs.readFileSync(f.file, 'utf8');
  if (fileHash(current) !== base) return { ok: false, conflict: true, id: f.id };
  // (the editor's lines end in \n: a file whose lines end in \r\n keeps them)
  let edited = text;
  if (current.includes('\r\n') && !edited.includes('\r\n')) edited = edited.replace(/\n/g, '\r\n');
  const check = checkText(edited, { site: f.site, file: f.file });
  if (!check.ok) return { ok: false, check, id: f.id };
  if (edited === current) return { ok: true, saved: false, id: f.id, hash: base };
  // (TRIF writes it for the person: it gets a stable id if it has none, docs/PHONE-SYNC.md 2a)
  const M = require('./modid');
  if (!M.readMeta(edited).uid && M.readMeta(edited).header) edited = M.withMeta(edited, { uid: M.readMeta(current).uid || M.newId() });
  const held = require('./held');
  // What the version before could do, for held.js: the version TRIF last let run (it keeps running while the
  // edit waits), or the file as it was
  // (a new mod that's waiting and never ran: nothing of it counts as allowed, as on the iPhone)
  const before = held.lastRun(ws.home, f.id) ?? (held.loadHeld(ws.home)[f.id] ? null : current);
  let was = null;
  if (before !== null) { try { was = buildMod({ site: f.site, file: f.file, code: before }).mod; } catch { /* the version before didn't read: everything asks */ } }
  const now = buildMod({ site: f.site, file: f.file, code: edited }).mod;
  const kept = history.writeEntry(ws, f.site, f.mod, current, Date.now(), 'edit');
  const stamp = /@(\d{8}T\d{9}Z)\.js$/.exec(kept)[1];
  held.recordEdit(ws.home, f.id, now.hash, was);
  writeText(f.file, edited);
  return { ok: true, saved: true, id: f.id, stamp, hash: fileHash(edited) };
}

/** Undo right after Save. See the top of this file. */
function undoEdit(ws, { id, stamp, hash }) {
  const f = modFile(ws, String(id ?? ''));
  if (typeof hash !== 'string' || fileHash(fs.readFileSync(f.file, 'utf8')) !== hash) throw new EditError(`${f.id} changed again since you saved it, so the version before isn't put back: History has it`);
  const r = history.restoreEntry(ws, f.id, String(stamp ?? ''), 'undo');
  return { id: r.id, restored: r.restored };
}

module.exports = { checkText, saveEdit, undoEdit, fileHash, jsonErrorLine, EditError };
