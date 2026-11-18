'use strict';
// Phone sync's core (docs/PHONE-SYNC.md): phone mods kept the same on the iPhone and in the computer's phone
// twins, sites/phone~<site>/. This file decides; it touches no mod. What it has:
//
//   parseId(id)        a phone mod's id, `<site>/<name>`, as the wire carries it -> {site, name, folder, file}, or
//                      a SyncError `bad-mod`. The helper adds `phone~` itself: no id can name a desktop folder.
//   idOf(folder, file) the other way, for a twin's file (null: not a phone mod the sync takes).
//   rev(text)          a revision: the SHA-256 of the file's UTF-8 bytes, hex. Nothing is normalised.
//   readManifest(list) the phone's `sync.begin` mods, checked: {revs: Map id -> rev, skipped: [{id, why}]}.
//   plan({...})        the three-way rule of section 4: what each side does.
//   siblingId, renameHeader   a conflict's mod kept beside it: `<name>-from-computer`, "@name … (from your computer)".
//   loadBase, saveBase, deleteBase   <private>/phone-link/sync/<phone id>.json: {v: 1, base: {id: rev}, sw?, at},
//                      mode 600 (`sw`: the switches' base, {key: switchKey}, loadSwitchBase).
//   syncKey, keyOfModId, modIdOfKey   the ONE place a mod is keyed for its switch and its approval hint (today its
//                      id; a stable id can take over later without touching the rest).
//   readSwitch, switchKey, planSwitches   the switches' three-way rule (D12): a mod's on/off and per-site switches
//                      follow the last change on either side; changed on both: the latest change wins.
//   readHint, hintFits, tierOf   the approval hint (D13): the other device allowed this exact revision. Never an
//                      approval: words on the hold's card.
//
// The computer alone keeps the base. Equal revisions are in sync whatever the base says, so a lost answer costs
// nothing: the next sync sets the base again.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { badName, unsafeName } = require('../pathcheck');
const { PHONE_PREFIX } = require('../scope');

const ALL_SITES = 'all-sites';
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/; // (remoterun.js's)
const NAME_MAX = 120;
const MAX_MODS = 500;
const MOD_MAX = 1024 * 1024;
const REV_RE = /^[0-9a-f]{64}$/;
const PHONE_ID_RE = /^[0-9a-f]{16}$/;
const SIBLING = '-from-computer';
const SIBLING_NAME = ' (from your computer)';

class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Why a mod's name isn't one the sync takes, or ''. */
function nameRefused(name) {
  if (typeof name !== 'string' || !name) return 'no name';
  if (name.length > NAME_MAX) return 'a name over 120 characters';
  if (name.startsWith('.') || name.startsWith('_')) return 'a name TRIF doesn\'t load (it starts with . or _)';
  const why = badName(name) || unsafeName(name);
  return why ? `a name that ${why}` : '';
}

/** `<site>/<name>` -> {id, site, name, folder: 'phone~<site>', file: '<name>.js'}. Throws SyncError bad-mod. */
function parseId(id) {
  if (typeof id !== 'string' || id.length > 400) throw new SyncError('bad-mod', 'a mod id that isn\'t text');
  const cut = id.indexOf('/');
  if (cut < 1 || id.indexOf('/', cut + 1) !== -1) throw new SyncError('bad-mod', 'a mod id that isn\'t <site>/<name>');
  const site = id.slice(0, cut);
  const name = id.slice(cut + 1);
  if (site !== ALL_SITES && (site.length > 253 || !HOST_RE.test(site))) throw new SyncError('bad-mod', 'a mod id whose site isn\'t a plain site name');
  const why = nameRefused(name);
  if (why) throw new SyncError('bad-mod', `a mod id with ${why}`);
  return { id, site, name, folder: PHONE_PREFIX + site, file: `${name}.js` };
}

/** A twin's file -> the phone's id for it, or null (not a phone twin, not a .js mod, a name the sync refuses). */
function idOf(folder, file) {
  if (typeof folder !== 'string' || !folder.startsWith(PHONE_PREFIX) || typeof file !== 'string' || !file.endsWith('.js')) return null;
  try { return parseId(`${folder.slice(PHONE_PREFIX.length)}/${file.slice(0, -3)}`).id; } catch { return null; }
}

function rev(text) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8')).digest('hex');
}

/**
 * The phone's list, `[{id, rev}]`, checked: a bad id or revision is skipped with why; two ids that differ only in
 * capitals (one file on the Mac's disk) keep the first. Throws bad-request for a list that isn't one or is too long.
 */
function readManifest(list) {
  if (!Array.isArray(list)) throw new SyncError('bad-request', 'the phone\'s mods aren\'t a list');
  if (list.length > MAX_MODS) throw new SyncError('too-big', `more than ${MAX_MODS} mods`);
  const revs = new Map();
  const lower = new Set();
  const skipped = [];
  for (const m of list) {
    const id = m && typeof m.id === 'string' ? m.id : '';
    try { parseId(id); } catch (e) { skipped.push({ id: id.slice(0, 400), why: e.message }); continue; }
    if (!m || typeof m.rev !== 'string' || !REV_RE.test(m.rev)) { skipped.push({ id, why: 'no revision' }); continue; }
    if (lower.has(id.toLowerCase())) { skipped.push({ id, why: 'the same name as another mod but for capitals' }); continue; }
    lower.add(id.toLowerCase());
    revs.set(id, m.rev);
  }
  return { revs, skipped };
}

/** A free id beside `id` for the computer's version: `<site>/<name>-from-computer`, then -2, -3… `taken`: ids (any case). */
function siblingId(id, taken) {
  const { site, name } = parseId(id);
  const used = new Set([...taken].map((t) => String(t).toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? SIBLING : `${SIBLING}-${n}`;
    const candidate = `${site}/${name.slice(0, NAME_MAX - suffix.length).replace(/[. ]+$/, '')}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The header's @name line given " (from your computer)" (that line only; none, or no header: the text as it is). */
function renameHeader(code, suffix = SIBLING_NAME) {
  const parts = String(code).split(/(\r?\n)/); // (line endings kept as they are)
  let inHeader = false;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    if (!inHeader) { if (/^\s*\/\/\s*==WebMod==\s*$/i.test(line.replace(/^﻿/, ''))) inHeader = true; continue; }
    if (/^\s*\/\/\s*==\/WebMod==\s*$/i.test(line)) break;
    const m = /^(\s*\/\/\s*@name\s+)(.*?)(\s*)$/i.exec(line);
    if (m && m[2]) { parts[i] = `${m[1]}${m[2]}${suffix}${m[3]}`; return parts.join(''); }
  }
  return String(code);
}

/**
 * The three-way rule (docs/PHONE-SYNC.md section 4). Inputs:
 *   phone, computer: Map id -> rev (what each side has now; ids already checked)
 *   base: {id: rev} (the revision each had when the two last agreed)
 *   leave: Map id -> why, ids left alone this time (a twin with a run working: why 'later'; a mod over 1 MB on
 *     either side: 'too-big'): nothing is done to them and their base stays
 * Returns {want: [{id, back?, conflict?}], give: [{id, rev, back?} | {id: sibling, conflict: id} (its rev is known
 *   once the computer has written it)], remove: [id] (the phone trashes),
 *   trash: [id] (the computer trashes), conflicts: [{id, sibling, rev}] (the computer's rev, to write beside),
 *   later: [id], skipped: [{id, why}], agreed: {id: rev} (in sync now: the base for them), gone: [id] (on neither
 *   side any more: out of the base)}.
 */
function plan({ phone, computer, base = {}, leave = new Map() }) {
  const out = { want: [], give: [], remove: [], trash: [], conflicts: [], later: [], skipped: [], agreed: {}, gone: [] };
  const ids = [...new Set([...phone.keys(), ...computer.keys(), ...Object.keys(base)])].sort();
  const taken = new Set([...phone.keys(), ...computer.keys()]);
  for (const id of ids) {
    if (leave.has(id)) {
      const why = leave.get(id);
      if (why === 'later') out.later.push(id); else out.skipped.push({ id, why });
      continue;
    }
    const P = phone.has(id) ? phone.get(id) : null;
    const C = computer.has(id) ? computer.get(id) : null;
    const B = Object.prototype.hasOwnProperty.call(base, id) && REV_RE.test(base[id]) ? base[id] : null;
    if (P === C) {
      if (P === null) out.gone.push(id); else out.agreed[id] = P;
    } else if (P === B) { // only the computer changed
      if (C === null) out.remove.push(id); else out.give.push({ id, rev: C });
    } else if (C === B) { // only the phone changed
      if (P === null) out.trash.push(id); else out.want.push({ id });
    } else if (P === null) { // deleted on the phone, changed on the computer: the edit wins
      out.give.push({ id, rev: C, back: true });
    } else if (C === null) { // deleted on the computer, changed on the phone
      out.want.push({ id, back: true });
    } else { // both changed: both kept, the phone's at the id, the computer's beside it
      const sibling = siblingId(id, taken);
      taken.add(sibling);
      out.conflicts.push({ id, sibling, rev: C });
      out.want.push({ id, conflict: true });
      out.give.push({ id: sibling, conflict: id });
    }
  }
  return out;
}

// ---- beside the text: the switches (D12) and the approval hint (D13), keyed by syncKey

/** A phone mod's sync key, from its id (`<site>/<name>`, the wire's): today the id itself. Every switch and hint
 * record goes through here, so a stable id (coming) can replace it in one place. */
function syncKey(id) { return parseId(id).id; }
/** The helper's mod id (`phone~<site>/<name>`) -> its sync key, or null (not a phone twin's mod the sync takes). */
function keyOfModId(modId) {
  const s = String(modId || '');
  const cut = s.indexOf('/');
  if (cut < 1) return null;
  const id = idOf(s.slice(0, cut), `${s.slice(cut + 1)}.js`);
  return id ? syncKey(id) : null;
}
/** A sync key -> the helper's mod id. */
function modIdOfKey(key) { const { folder, name } = parseId(key); return `${folder}/${name}`; }

const OFF_SITE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** {on, off, at, fresh?} as the wire carries a switch: on (bool), off (the sites it's switched off on, sorted), at (ms
 * of its last change by the person; 0: never), fresh (off only because it came new from outside and was never
 * switched: no choice of the person's). Anything else: null. */
function readSwitch(v) {
  if (!v || typeof v !== 'object' || typeof v.on !== 'boolean') return null;
  const off = Array.isArray(v.off) ? [...new Set(v.off.filter((x) => typeof x === 'string' && x.length <= 253 && OFF_SITE_RE.test(x)))].sort().slice(0, 200) : [];
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? Math.min(Math.floor(v.at), 8.64e15) : 0;
  return { on: v.on, off, at, ...(v.fresh === true && !v.on && !at ? { fresh: true } : {}) };
}
/** What a switch is, without when: two equal keys are the same switch. */
const switchKey = (s) => `${s.on ? 'on' : 'off'}|${s.off.join(',')}`;

/** A switch as sent (no `fresh`: it's only for deciding). */
const sent = ({ id, on, off, at }) => ({ id, on, off, at });
/**
 * The switches' three-way rule (docs/PHONE-SYNC.md section 4b). ids: the keys both sides have once this sync's
 * files are done (never a removed one, nor a conflict's sibling). phone, computer: Map key -> switch, or null (that
 * side has no such mod yet: it takes the other's); a key missing from either: that side can't say (an older app or
 * extension), left alone. base: {key: switchKey}. Returns {toPhone, toComputer: [{id, on, off, at}], agreed: {key: switchKey}}.
 *   P = C: in sync. P = B: the computer's goes to the phone. C = B: the phone's to the computer. Both changed (or no
 *   base): the later change (`at`) wins; the same time: the phone's (as D5), unless the phone's is a fresh off (never a
 *   choice: a new mod from outside, never switched) and the computer's isn't.
 */
function planSwitches({ ids, phone, computer, base = {} }) {
  const out = { toPhone: [], toComputer: [], agreed: {} };
  for (const id of [...new Set(ids)].sort()) {
    if (!phone.has(id) || !computer.has(id)) continue;
    const P = phone.get(id);
    const C = computer.get(id);
    if (!P && !C) continue;
    if (!P) { out.toPhone.push(sent({ id, ...C })); continue; }
    if (!C) { out.toComputer.push(sent({ id, ...P })); continue; }
    const kp = switchKey(P);
    const kc = switchKey(C);
    if (kp === kc) { out.agreed[id] = kp; continue; }
    const B = Object.prototype.hasOwnProperty.call(base, id) ? base[id] : null;
    if (kp === B) out.toPhone.push(sent({ id, ...C }));
    else if (kc === B) out.toComputer.push(sent({ id, ...P }));
    else if (C.at > P.at) out.toPhone.push(sent({ id, ...C }));
    else if (C.at < P.at) out.toComputer.push(sent({ id, ...P }));
    // (the same time, both never switched as a rule after an update: a side whose off was never a choice yields)
    else if (P.fresh && !C.fresh) out.toPhone.push(sent({ id, ...C }));
    else out.toComputer.push(sent({ id, ...P }));
  }
  return out;
}

const TIERS = ['style', 'boxed', 'free'];
const POWER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** {rev, tier, powers} as the wire carries the other device's approval of a mod, or null. */
function readHint(v) {
  if (!v || typeof v !== 'object' || typeof v.rev !== 'string' || !REV_RE.test(v.rev) || !TIERS.includes(v.tier)) return null;
  const powers = Array.isArray(v.powers) ? [...new Set(v.powers.filter((p) => typeof p === 'string' && POWER_RE.test(p)))].sort().slice(0, 64) : [];
  return { rev: v.rev, tier: v.tier, powers };
}
/** A helper mod's tier, as the phone names them. */
const tierOf = (m) => (m && m.rules ? 'style' : m && m.sandboxed ? 'boxed' : 'free');
/**
 * Whether the other device's hint fits this version: the very revision it allowed, and what this one asks for
 * within what was allowed there (its tier no higher, every power among those). Never an approval.
 */
function hintFits(hint, { rev: r, tier, powers = [] }) {
  if (!hint || hint.rev !== r || !TIERS.includes(tier)) return false;
  if (TIERS.indexOf(tier) > TIERS.indexOf(hint.tier)) return false;
  return powers.every((p) => hint.powers.includes(p));
}

function basePath(privateDir, phoneId) {
  if (typeof phoneId !== 'string' || !PHONE_ID_RE.test(phoneId)) throw new SyncError('bad-request', 'not a phone id');
  return path.join(privateDir, 'phone-link', 'sync', `${phoneId}.json`);
}

/** The base for a phone: {id: rev}. A file that doesn't read, or rows that aren't right, count as none. */
function loadBase(privateDir, phoneId) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(basePath(privateDir, phoneId), 'utf8')); } catch { return {}; }
  const base = {};
  if (!obj || obj.v !== 1 || !obj.base || typeof obj.base !== 'object') return base;
  for (const [id, r] of Object.entries(obj.base)) {
    if (typeof r !== 'string' || !REV_RE.test(r)) continue;
    try { parseId(id); } catch { continue; }
    base[id] = r;
  }
  return base;
}

/** The switches' base for a phone: {key: switchKey} (none: {}). An older helper's file has none. */
function loadSwitchBase(privateDir, phoneId) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(basePath(privateDir, phoneId), 'utf8')); } catch { return {}; }
  const out = {};
  if (!obj || obj.v !== 1 || !obj.sw || typeof obj.sw !== 'object') return out;
  for (const [id, k] of Object.entries(obj.sw)) {
    if (typeof k !== 'string' || k.length > 20000 || !/^(on|off)\|/.test(k)) continue;
    try { parseId(id); } catch { continue; }
    out[id] = k;
  }
  return out;
}

/** `sw`: the switches' base to keep (undefined: the file's own, as it is). */
function saveBase(privateDir, phoneId, base, now = Date.now(), sw = undefined) {
  const file = basePath(privateDir, phoneId);
  const keep = sw === undefined ? loadSwitchBase(privateDir, phoneId) : sw;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, base, ...(Object.keys(keep).length ? { sw: keep } : {}), at: now }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function deleteBase(privateDir, phoneId) {
  try { fs.unlinkSync(basePath(privateDir, phoneId)); return true; } catch { return false; }
}

module.exports = {
  parseId, idOf, rev, readManifest, plan, siblingId, renameHeader, loadBase, saveBase, deleteBase, basePath, loadSwitchBase,
  syncKey, keyOfModId, modIdOfKey, readSwitch, switchKey, planSwitches, readHint, hintFits, tierOf, TIERS,
  SyncError, MAX_MODS, MOD_MAX, NAME_MAX, SIBLING, SIBLING_NAME, ALL_SITES,
};
