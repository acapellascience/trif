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
//   syncKey, keyOfModId, modIdOf   the ONE place a mod is keyed for its switch and its approval hint: its stable id
//                      where it has one (`<site>#<uid>`, D16/D17), else its file id.
//   pairUp, byParts    stable ids (D17): which rows are one mod and the file id each ends at (renames, mods kept
//                      apart); both changed in different parts (a rename and an edit): decided part by part.
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
 *   parts: (D17, an app that sends them) {phone, computer: Map id -> {body, meta}, base: {id: {body, meta}}}: both changed,
 *     the body and the name/id are decided apart (byParts): a merge is `want {id, merge}` + `give {id, merge}` and
 *     `merges: [{id, body: 'phone'|'computer', meta: 'phone'|'computer'}]` (whose text gives which part)
 * Returns {want: [{id, back?, conflict?}], give: [{id, rev, back?} | {id: sibling, conflict: id} (its rev is known
 *   once the computer has written it)], remove: [id] (the phone trashes),
 *   trash: [id] (the computer trashes), conflicts: [{id, sibling, rev}] (the computer's rev, to write beside),
 *   later: [id], skipped: [{id, why}], agreed: {id: rev} (in sync now: the base for them), gone: [id] (on neither
 *   side any more: out of the base)}.
 */
function plan({ phone, computer, base = {}, leave = new Map(), parts = null }) {
  const out = { want: [], give: [], remove: [], trash: [], conflicts: [], later: [], skipped: [], agreed: {}, gone: [], merges: [] };
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
    } else if (byParts(id, P, C, B, parts, out)) { // both changed, in different parts (D17): decided part by part
      // (done: byParts pushed the want, the give, or a merge)
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

/**
 * Both sides changed a mod: its body (the file without @name and @id) and its name and id (meta) decided apart, each by
 * the three-way rule (docs/PHONE-SYNC.md 4, D17). A body changed on both is a conflict (false: the caller's conflict
 * row). The meta changed on both, or no base: the phone's (D5). Pushes the result into `out`; true when it decided.
 */
function byParts(id, P, C, B, parts, out) {
  if (!parts) return false;
  const pp = parts.phone && parts.phone.get(id);
  const cp = parts.computer && parts.computer.get(id);
  const bp = B !== null ? parts.base && parts.base[id] : null;
  if (!pp || !cp || (B !== null && !bp)) return false;
  const pick = (x, y, b, tie) => (x === y ? 'same' : b && x === b ? 'computer' : b && y === b ? 'phone' : tie);
  const body = pick(pp.body, cp.body, bp && bp.body, 'conflict');
  if (body === 'conflict') return false;
  const meta = pick(pp.meta, cp.meta, bp && bp.meta, 'phone');
  const from = body === 'same' ? (meta === 'computer' ? 'computer' : 'phone') : body;
  if (meta === 'same' || meta === from) {
    if (from === 'phone') out.want.push({ id }); else out.give.push({ id, rev: C });
    return true;
  }
  out.want.push({ id, merge: true });
  out.give.push({ id, merge: true });
  out.merges.push({ id, body: from, meta });
  return true;
}

/**
 * Pairing (docs/PHONE-SYNC.md 4, D17): which phone row and which computer file are one mod, and the file id each ends
 * at. phone, computer: Map id -> {uid?}; baseMeta: {id: {uid?}} (the base's ids then). Pairs by site and stable id
 * where both have one, then by file id where at most one has an id (two different ids at one file id: two mods). A
 * pair whose ids differ was renamed: the phone's id unless only the computer renamed it (the base's id is the phone's
 * then); both or no base: the phone's (D5). Two that end at one id (any case): the one the phone has there keeps it,
 * the computer's moves beside it (`<name>-from-computer`, siblingId). Returns {phoneRenames: [{from, to}],
 * computerMoves: [{from, to, apart?}] (apart: the id it moved away from, which another mod keeps), baseMoves: [{from,
 * to}], uidOf: Map final id -> uid}.
 */
function pairUp({ phone, computer, baseMeta = {} }) {
  const siteOf = (id) => id.slice(0, id.indexOf('/'));
  const entries = []; // {p, c, uid}
  const usedP = new Set();
  const usedC = new Set();
  const cBy = new Map();
  for (const [id, r] of computer) if (r && r.uid && !cBy.has(`${siteOf(id)}#${r.uid}`)) cBy.set(`${siteOf(id)}#${r.uid}`, id);
  for (const [id, r] of phone) {
    const c = r && r.uid ? cBy.get(`${siteOf(id)}#${r.uid}`) : null;
    if (!c || usedC.has(c)) continue;
    entries.push({ p: id, c, uid: r.uid });
    usedP.add(id);
    usedC.add(c);
  }
  for (const [id, r] of phone) {
    if (usedP.has(id) || !computer.has(id) || usedC.has(id)) continue;
    const cu = computer.get(id) && computer.get(id).uid;
    if (r && r.uid && cu && r.uid !== cu) continue;
    entries.push({ p: id, c: id, uid: (r && r.uid) || cu || null });
    usedP.add(id);
    usedC.add(id);
  }
  for (const id of phone.keys()) if (!usedP.has(id)) entries.push({ p: id, c: null, uid: phone.get(id) && phone.get(id).uid || null });
  for (const id of computer.keys()) if (!usedC.has(id)) entries.push({ p: null, c: id, uid: computer.get(id) && computer.get(id).uid || null });
  const baseIdOf = (e) => {
    if (e.uid) for (const [id, m] of Object.entries(baseMeta)) if (m && m.uid === e.uid && siteOf(id) === siteOf(e.p || e.c)) return id;
    return null;
  };
  for (const e of entries) {
    e.base = baseIdOf(e) || (e.p && Object.prototype.hasOwnProperty.call(baseMeta, e.p) ? e.p : e.c && Object.prototype.hasOwnProperty.call(baseMeta, e.c) ? e.c : null);
    e.to = !e.p ? e.c : !e.c || e.p === e.c ? e.p : e.base === e.p ? e.c : e.p;
  }
  const taken = new Set([...phone.keys(), ...computer.keys()].map((x) => x.toLowerCase()));
  const claims = new Map();
  for (const e of entries) { const k = e.to.toLowerCase(); if (!claims.has(k)) claims.set(k, []); claims.get(k).push(e); }
  for (const list of claims.values()) {
    if (list.length < 2) continue;
    const keep = list.find((e) => e.p && e.p.toLowerCase() === e.to.toLowerCase()) || list.find((e) => e.c && e.c.toLowerCase() === e.to.toLowerCase()) || list[0];
    for (const e of list) {
      if (e === keep) continue;
      const sibling = siblingId(keep.to, taken);
      taken.add(sibling.toLowerCase());
      e.apart = keep.to;
      e.to = sibling;
    }
  }
  const out = { phoneRenames: [], computerMoves: [], baseMoves: [], uidOf: new Map() };
  for (const e of entries) {
    if (e.p && e.p !== e.to) out.phoneRenames.push({ from: e.p, to: e.to });
    if (e.c && (e.c !== e.to || e.apart)) out.computerMoves.push({ from: e.c, to: e.to, ...(e.apart ? { apart: e.apart } : {}) });
    if (e.base && e.base !== e.to) out.baseMoves.push({ from: e.base, to: e.to });
    if (e.uid) out.uidOf.set(e.to, e.uid);
  }
  return out;
}

// ---- beside the text: the switches (D12) and the approval hint (D13), keyed by syncKey

/** A phone mod's sync key (D16): `<site>#<uid>` for a mod with a stable id (docs/PHONE-SYNC.md 2a), else its file
 * id (`<site>/<name>`, the wire's). Every switch and hint record goes through here, so a renamed mod keeps them. */
function syncKey(id, uid = null) { const p = parseId(id); return uid && /^[a-z0-9][a-z0-9-]{7,63}$/.test(uid) ? `${p.site}#${uid}` : p.id; }
/** The helper's mod id (`phone~<site>/<name>`) -> its sync key, or null (not a phone twin's mod the sync takes).
 * `uid`: the mod's stable id, if it has one. */
function keyOfModId(modId, uid = null) {
  const s = String(modId || '');
  const cut = s.indexOf('/');
  if (cut < 1) return null;
  const id = idOf(s.slice(0, cut), `${s.slice(cut + 1)}.js`);
  return id ? syncKey(id, uid) : null;
}
/** A file id -> the helper's mod id. */
function modIdOf(id) { const { folder, name } = parseId(id); return `${folder}/${name}`; }

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
    // (by sync key: a file id, or <site>#<uid>)
    const hash = id.indexOf('#');
    try { if (hash > 0) { parseId(`${id.slice(0, hash)}/x`); if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(id.slice(hash + 1))) continue; } else parseId(id); } catch { continue; }
    out[id] = k;
  }
  return out;
}

/** The base's part revisions (D17): {id: {uid?, body, meta}} (none: {}). An older helper's file has none. */
function loadBaseMeta(privateDir, phoneId) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(basePath(privateDir, phoneId), 'utf8')); } catch { return {}; }
  const out = {};
  if (!obj || obj.v !== 1 || !obj.meta || typeof obj.meta !== 'object') return out;
  for (const [id, m] of Object.entries(obj.meta)) {
    if (!m || typeof m !== 'object' || !REV_RE.test(m.body) || !REV_RE.test(m.meta)) continue;
    try { parseId(id); } catch { continue; }
    out[id] = { ...(typeof m.uid === 'string' && /^[a-z0-9][a-z0-9-]{7,63}$/.test(m.uid) ? { uid: m.uid } : {}), body: m.body, meta: m.meta };
  }
  return out;
}

/** `sw`: the switches' base to keep, `meta`: the part revisions (undefined: the file's own, as they are; only ids in
 * `base` are kept). */
function saveBase(privateDir, phoneId, base, now = Date.now(), sw = undefined, meta = undefined) {
  const file = basePath(privateDir, phoneId);
  const keep = sw === undefined ? loadSwitchBase(privateDir, phoneId) : sw;
  const parts = meta === undefined ? loadBaseMeta(privateDir, phoneId) : meta;
  const m = Object.fromEntries(Object.entries(parts).filter(([id]) => Object.prototype.hasOwnProperty.call(base, id)));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, base, ...(Object.keys(m).length ? { meta: m } : {}), ...(Object.keys(keep).length ? { sw: keep } : {}), at: now }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function deleteBase(privateDir, phoneId) {
  try { fs.unlinkSync(basePath(privateDir, phoneId)); return true; } catch { return false; }
}

module.exports = {
  parseId, idOf, rev, readManifest, plan, byParts, pairUp, siblingId, renameHeader, loadBase, saveBase, deleteBase, basePath, loadSwitchBase, loadBaseMeta,
  syncKey, keyOfModId, modIdOf, readSwitch, switchKey, planSwitches, readHint, hintFits, tierOf, TIERS,
  SyncError, MAX_MODS, MOD_MAX, NAME_MAX, SIBLING, SIBLING_NAME, ALL_SITES,
};
