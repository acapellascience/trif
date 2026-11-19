'use strict';
// Phone sync, the session side (docs/PHONE-SYNC.md sections 4-7): what a paired phone's session may ask to keep
// its mods and the computer's phone twins, sites/phone~<site>/, the same. sync.js decides; this does it.
//
//   sync.begin  the phone's mods ({id, rev}) → the plan (sync.js `plan`) against the twins' files and this
//               phone's base. The computer does its own part at once: a mod deleted on the phone goes to the
//               trash; a conflict's computer version is written beside it (`-from-computer`).
//   sync.get    a mod of the plan's `give`: the computer's file as it is now.
//   sync.put    a mod of the plan's `want`: checked as an import is, then written (history first, a temporary
//               file renamed into place, the twin a real folder), marked in synced.json for held.js.
//   sync.end    the phone's revisions now: the base moves for each id both sides agree on.
//   sync.changed  (computer → phone, `changed()`): a twin changed here; no mod, no name. At most every 2 s.
//
// What it may touch: the twins' .js files (by the ids sync.js turns into paths, never a path from the phone),
// history/, trash/, $TRIF_HOME/synced.json and the base in the private folder. A twin where a run is working is
// left alone (`later`). Every-site phone mods (`all-sites/…`) sync with sites/phone~all-sites/ (D10). Approval is held.js's, on the computer, as for any file from outside: what the
// phone approved counts for nothing here.
//
// Beside the text (an app that says `switches: true` in sync.begin; older peers send and get none of it):
//   - switches (D12): each manifest row's `sw` {on, off, at}; the computer's are the extension's (`switches.get()`,
//     its last report). sync.js planSwitches decides; the plan's `switches` are what the phone sets, and what the
//     computer takes goes to the extension at sync.end (`switches.set`). The base moves at sync.end only where the
//     phone's (sync.end's `switches`) and the extension's last report agree, so nothing is taken as done unseen.
//   - the approval hint (D13): each row's `ok` {rev, tier, powers} (the phone allows that revision there), kept in
//     $TRIF_HOME/synced-allowed.json for held.js's card words; the plan's `allowed`: the same for every twin mod
//     not held here. Never an approval, on either side.
//
// The switch: `enabled` (a function; link.js passes the user's setting: on for a paired phone, D11). Off, every sync.* is `off` and
// nothing is read or written.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../paths');
const S = require('./sync');
const { PHONE_PREFIX, isPhoneSite } = require('../scope');
const { ownTwin } = require('../stage');
const { buildMod, parseHeader, scanMods, isIgnoredName } = require('../mods');
const { ignoresCase } = require('../pathcheck');
const { splitsOf } = require('../sitecombos');
const history = require('../history');
const trash = require('../trash');
const held = require('../held');
const MI = require('../modid');
const { moveKeys } = require('../rename');

const TWINS_MAX = 16 * 1024 * 1024; // (the phone twins together: the helper's limit for all mods)
const BEGIN_EVERY_MS = 1000;
const NUDGE_EVERY_MS = 2000;
const HEADER_RE = /^\s*\/\/\s*==WebMod==\s*$/m;
const WHY = {
  big: 'over 1 MB',
  capitals: 'the same name as a mod on the computer but for capitals',
  notFile: 'something on the computer at that name isn\'t a mod file',
  notText: 'the computer\'s file isn\'t UTF-8 text',
  notFolder: 'the phone mods\' folder for that site on the computer isn\'t a plain folder',
  many: 'more than 500 phone mods on the computer',
};

const fail = (code, message) => new S.SyncError(code, message);
const utf8 = (buf) => { const s = buf.toString('utf8'); return Buffer.from(s, 'utf8').equals(buf) ? s : null; };
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, ''); // (trash.js's)

/** A twin's file, read without following a link: {buf, text} | {link: true} (not a plain file) | null (none). */
function readFile(dir, file) {
  let st;
  try { st = fs.lstatSync(path.join(dir, file)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (!st.isFile()) return { link: true };
  if (st.size > S.MOD_MAX) return { big: true, size: st.size };
  const fd = fs.openSync(path.join(dir, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) return { link: true };
    const buf = fs.readFileSync(fd);
    return { buf, text: utf8(buf), size: buf.length };
  } finally { fs.closeSync(fd); }
}

const plainDir = (dir) => { try { const st = fs.lstatSync(dir); return st.isDirectory() ? true : 'other'; } catch { return false; } };

class PhoneSync {
  /**
   * store, server: the phone link's Store and Server. runs: the helper's Runs (list(): a twin with a run is left
   * for later; scopes(): for held.js). Options:
   *   home | getWorkspace     the workspace.        log: (line) => void.
   *   afterWrite: () => held map | null   the helper looks at the mods again (host.js syncMods) and says what's
   *     held; without it, held.js is asked here.
   *   enabled: () => bool     the switch (default on).
   *   switches: {get: () => Map modId -> {on, off, at} | null (null: the extension hasn't said: no switch sync),
   *     set: ([{modId, on, off, at}]) => bool}   the phone twins' switches in the browser (host.js).
   *   synced: (phoneId) => void   a sync with that phone ended (its Settings line changed: link.js tells the panels).
   *   now: for tests.
   */
  constructor(store, server, runs, opts = {}) {
    this.store = store;
    this.server = server;
    this.runs = runs;
    this.getWorkspace = typeof opts.getWorkspace === 'function' ? opts.getWorkspace : () => P.workspace(opts.home);
    this.log = typeof opts.log === 'function' ? opts.log : () => {};
    this.afterWrite = typeof opts.afterWrite === 'function' ? opts.afterWrite : null;
    this.enabled = typeof opts.enabled === 'function' ? opts.enabled : () => true;
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.synced = typeof opts.synced === 'function' ? opts.synced : () => {};
    this.switches = opts.switches && typeof opts.switches.get === 'function' && typeof opts.switches.set === 'function' ? opts.switches : null;
    this.syncs = new Map(); // phone id -> the sync going on
    this.begun = new Map(); // phone id -> when its last sync.begin came
    this.nudged = new Map(); // phone id -> when it was last sent sync.changed
    this.last = new Map(); // phone id -> {at, fromPhone, toPhone, waiting, conflicts, skipped}: for the Settings line
    this.started = false;
    this.onChange = () => { try { this._removed(); } catch (e) { this.log(`phone sync: couldn't clear a removed phone's sync (${e.message})`); } };
  }

  start() {
    if (this.started) return this;
    this.started = true;
    for (const [t, fn] of [['sync.begin', this._begin], ['sync.get', this._get], ['sync.put', this._put], ['sync.end', this._end]]) {
      this.server.handle(t, (session, msg) => { if (!this.enabled()) throw fail('off', 'syncing phone mods is off on this computer'); return fn.call(this, session, msg); });
    }
    this.store.on('change', this.onChange);
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.store.removeListener('change', this.onChange);
    for (const t of ['sync.begin', 'sync.get', 'sync.put', 'sync.end']) this.server.handlers.delete(t);
    this.syncs.clear();
  }

  /** A phone twin changed on the computer: each paired phone with a live session is told, at most every 2 s. */
  changed() {
    if (!this.enabled()) return 0;
    const now = this.now();
    let sent = 0;
    for (const session of this.server.sessions || []) {
      const id = session.phone && session.phone.id;
      if (!id || !session.open || this.syncs.has(id)) continue; // (a sync going on: the phone ends it and sees)
      if (now - (this.nudged.get(id) || 0) < NUDGE_EVERY_MS) continue;
      this.nudged.set(id, now);
      try { if (session.send({ t: 'sync.changed' })) sent++; } catch { /* closed */ }
    }
    return sent;
  }

  /**
   * Sync now, from the panel: each paired phone with a live session (or `phoneId`'s alone) is told to sync, at once
   * (not held to the 2 s of `changed`). Returns the ids of the phones told; a phone that's syncing just now isn't
   * told again (that sync ends and is shown). [] when syncing is off, or no phone is connected just now.
   */
  nudge(phoneId = null) {
    if (!this.enabled()) return [];
    const told = [];
    for (const session of this.server.sessions || []) {
      const id = session.phone && session.phone.id;
      if (!id || !session.open || (phoneId && id !== phoneId)) continue;
      if (this.syncs.has(id)) { told.push(id); continue; }
      this.nudged.set(id, this.now());
      try { if (session.send({ t: 'sync.changed' })) told.push(id); } catch { /* closed */ }
    }
    return [...new Set(told)];
  }

  /** What the last sync with a phone did (null: none since the helper started). */
  status(phoneId) { return this.last.get(phoneId) || null; }

  // ------------------------------------------------------------ the computer's side

  /** Every twin's .js mod: {mods: Map id -> {rev, text}, leave: Map id -> why, folders: [names]}. */
  _scan(ws) {
    const mods = new Map();
    const leave = new Map();
    const folders = [];
    if (plainDir(ws.modsDir) !== true) return { mods, leave, folders };
    for (const folder of fs.readdirSync(ws.modsDir).sort()) {
      if (!isPhoneSite(folder) || isIgnoredName(folder)) continue;
      const dir = path.join(ws.modsDir, folder);
      if (plainDir(dir) !== true) continue; // (a link where a twin would be: not read)
      folders.push(folder);
      let names = [];
      try { names = fs.readdirSync(dir).sort(); } catch { continue; }
      for (const file of names) {
        const id = S.idOf(folder, file);
        if (!id) continue;
        let f;
        try { f = readFile(dir, file); } catch { continue; }
        if (!f) continue;
        if (f.link) leave.set(id, WHY.notFile);
        else if (f.big) leave.set(id, WHY.big);
        else if (f.text === null) leave.set(id, WHY.notText);
        else if (mods.size >= S.MAX_MODS) leave.set(id, WHY.many);
        else mods.set(id, { rev: S.rev(f.buf), text: f.text, uid: MI.readMeta(f.text).uid });
      }
    }
    // (one id to a folder: a copied file's id is the first file's, mods.js scanMods)
    const owner = new Set();
    for (const [id, m] of [...mods].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!m.uid) continue;
      const k = `${S.parseId(id).site}#${m.uid}`;
      if (owner.has(k)) m.uid = null; else owner.add(k);
    }
    return { mods, leave, folders };
  }

  /** The twin folders a run is working in now (a phone run, a desktop phone-view chat): ids there wait. */
  _busy(ws) {
    let list = [];
    try { list = this.runs && typeof this.runs.list === 'function' ? this.runs.list() : []; } catch { list = []; }
    const scopes = list.map((r) => r && r.scope).filter((s) => isPhoneSite(s));
    if (!scopes.length) return () => false;
    const splits = splitsOf(ws.home);
    return (folder) => scopes.some((scope) => ownTwin(folder, scope, splits));
  }

  _current(ws, id) {
    const { folder, file } = S.parseId(id);
    const dir = path.join(ws.modsDir, folder);
    const kind = plainDir(dir);
    if (kind === 'other') return { link: true };
    if (!kind) return null;
    return readFile(dir, file);
  }

  // ------------------------------------------------------------ what a session asks

  _own(session, msg) {
    const sync = this.syncs.get(session.phone.id);
    if (!sync || sync.session !== session || typeof msg.syncId !== 'string' || msg.syncId !== sync.syncId) throw fail('no-sync', 'no such sync going on (start again with sync.begin)');
    return sync;
  }

  _begin(session, msg) {
    const phone = session.phone;
    const now = this.now();
    if (now - (this.begun.get(phone.id) || -Infinity) < BEGIN_EVERY_MS) throw fail('busy', 'one sync a second');
    this.begun.set(phone.id, now);
    this.syncs.delete(phone.id); // (a new sync.begin ends the one before)
    const { revs, skipped } = S.readManifest(msg.mods);
    const ws = this.getWorkspace();
    let { mods: computer, leave, folders } = this._scan(ws);
    // (APFS: a phone id that differs from the computer's only in capitals is the same file there)
    if (ignoresCase(ws.modsDir)) {
      const lowIds = new Map([...computer.keys(), ...leave.keys()].map((id) => [id.toLowerCase(), id]));
      const lowDirs = new Map(folders.map((f) => [f.toLowerCase(), f]));
      for (const id of revs.keys()) {
        const other = lowIds.get(id.toLowerCase());
        const { folder } = S.parseId(id);
        const dir = lowDirs.get(folder.toLowerCase());
        // (with ids, a pair may differ in capitals only when it was renamed: pairing decides; else left as before)
        if (dir && dir !== folder) leave.set(id, WHY.capitals);
        else if (other && other !== id && !(msg.ids === true && computer.has(other))) leave.set(id, WHY.capitals);
      }
    }
    for (const id of revs.keys()) {
      if (plainDir(path.join(ws.modsDir, S.parseId(id).folder)) === 'other') leave.set(id, WHY.notFolder);
    }
    const busy = this._busy(ws);
    let base = S.loadBase(ws.private, phone.id);
    let baseMeta = S.loadBaseMeta(ws.private, phone.id);

    // Stable ids (D17, an app that says `ids: true`): which rows are one mod, renames, two mods with one name kept
    // apart. The computer's own moves happen now (its files, what it keeps by their ids); the phone's come in the plan.
    const ids = msg.ids === true;
    const rowsById = new Map();
    for (const m of Array.isArray(msg.mods) ? msg.mods : []) if (m && typeof m.id === 'string' && revs.has(m.id)) rowsById.set(m.id, m);
    const REV = /^[0-9a-f]{64}$/;
    const phoneParts = new Map();
    const phoneUid = new Map();
    for (const [id, m] of rowsById) {
      if (typeof m.uid === 'string' && MI.isId(m.uid)) phoneUid.set(id, m.uid);
      if (REV.test(m.body) && REV.test(m.meta)) phoneParts.set(id, { body: m.body, meta: m.meta });
    }
    let renames = [];
    const apart = new Map();
    if (ids) {
      const live = (id) => !leave.has(id) && !busy(S.parseId(id).folder);
      const pr = new Map([...revs.keys()].filter(live).map((id) => [id, { uid: phoneUid.get(id) || null }]));
      const cr = new Map([...computer].filter(([id]) => live(id)).map(([id, m]) => [id, { uid: m.uid || null }]));
      const pu = S.pairUp({ phone: pr, computer: cr, baseMeta });
      // (the computer's moves: renamed on the phone, or moved beside a mod of the phone's with the same name)
      const moved = new Map();
      for (const mv of pu.computerMoves) {
        const m = computer.get(mv.from);
        try {
          let text = m.text;
          if (mv.apart) text = S.renameHeader(text);
          if (text !== m.text && mv.from === mv.to) this._write(ws, mv.to, text, { text: m.text }, null);
          else if (mv.from !== mv.to) this._move(ws, mv.from, mv.to, text);
          moved.set(mv.from, { to: mv.to, text });
          if (mv.apart) apart.set(mv.to, mv.apart);
        } catch (e) {
          this.log(`phone sync: couldn't move ${mv.from} to ${mv.to} (${e.code || e.message})`);
          leave.set(mv.from, 'later');
          for (const r of pu.phoneRenames) if (r.to === mv.to) leave.set(r.from, 'later');
        }
      }
      if (moved.size) {
        const next = new Map();
        for (const [id, m] of computer) {
          const mv = moved.get(id);
          if (!mv) { if (!next.has(id)) next.set(id, m); continue; }
          const buf = Buffer.from(mv.text, 'utf8');
          next.set(mv.to, { rev: S.rev(buf), text: mv.text, uid: m.uid, size: buf.length });
        }
        computer = next;
        this._refresh(ws);
      }
      renames = pu.phoneRenames.filter((r) => !leave.has(r.from));
      // (the phone's side, as it will be: the rest of the plan names the new ids)
      for (const r of renames) {
        for (const map of [revs, phoneParts, phoneUid, rowsById]) if (map.has(r.from)) { map.set(r.to, map.get(r.from)); map.delete(r.from); }
      }
      // (the base follows each mod to its id)
      for (const mv of pu.baseMoves) {
        if (Object.prototype.hasOwnProperty.call(base, mv.from)) { base[mv.to] = base[mv.from]; delete base[mv.from]; }
        if (baseMeta[mv.from]) { baseMeta[mv.to] = baseMeta[mv.from]; delete baseMeta[mv.from]; }
      }
    }

    for (const id of new Set([...revs.keys(), ...computer.keys(), ...Object.keys(base)])) {
      if (!leave.has(id) && busy(S.parseId(id).folder)) leave.set(id, 'later');
    }
    const compRevs = new Map([...computer].map(([id, m]) => [id, m.rev]));
    const compParts = new Map([...computer].filter(([, m]) => m.text !== null).map(([id, m]) => [id, MI.revs(m.text)]));
    const p = S.plan({ phone: revs, computer: compRevs, base, leave, parts: ids ? { phone: phoneParts, computer: compParts, base: baseMeta } : null });
    // (what's left alone on the computer's side only, a big mod there: named too)
    for (const [id, why] of leave) {
      if (revs.has(id) || compRevs.has(id) || Object.prototype.hasOwnProperty.call(base, id)) continue;
      if (why === 'later') p.later.push(id); else p.skipped.push({ id, why });
    }

    // The computer's own part, now: deleted on the phone → its file to the trash; a conflict → its version beside.
    const trashed = [];
    for (const id of p.trash) {
      try { this._toTrash(ws, id); trashed.push(id); delete base[id]; compRevs.delete(id); } catch (e) {
        this.log(`phone sync: couldn't move ${id} to the trash (${e.code || e.message})`);
        skipped.push({ id, why: 'couldn\'t be moved to the trash on the computer' });
      }
    }
    const give = [];
    const conflicts = [];
    for (const g of p.give) {
      if (!g.conflict) { give.push({ ...g, ...(apart.has(g.id) ? { apart: apart.get(g.id) } : {}) }); continue; }
      const c = p.conflicts.find((x) => x.sibling === g.id);
      try {
        // (a mod of its own beside it: " (from your computer)", and a new stable id if the mod had one)
        let text = S.renameHeader(computer.get(c.id).text);
        if (MI.readMeta(text).uid || ids) text = MI.withMeta(text, { uid: MI.newId() });
        this._write(ws, g.id, text, null, null);
        const r = S.rev(text);
        compRevs.set(g.id, r);
        give.push({ id: g.id, rev: r, conflict: c.id });
        conflicts.push({ id: c.id, sibling: g.id });
      } catch (e) {
        // (the sibling couldn't be written: the phone's version isn't taken either, so nothing is lost)
        this.log(`phone sync: couldn't keep ${c.id}'s computer version beside it (${e.code || e.message})`);
        p.want = p.want.filter((w) => w.id !== c.id);
        skipped.push({ id: c.id, why: 'changed on both, and the computer couldn\'t keep both yet' });
      }
    }
    for (const [id, r] of Object.entries(p.agreed)) { base[id] = r; if (compParts.has(id)) baseMeta[id] = { ...(computer.get(id).uid ? { uid: computer.get(id).uid } : {}), ...compParts.get(id) }; }
    for (const id of p.gone) { delete base[id]; delete baseMeta[id]; }
    try { S.saveBase(ws.private, phone.id, base, now, undefined, baseMeta); } catch (e) { this.log(`phone sync: couldn't save the base (${e.code || e.message})`); }

    // Every mod's sync key (D16): by its stable id where it has one, else its file id
    const keyToId = new Map();
    const keyOf = (id) => {
      const uid = (computer.get(id) && computer.get(id).uid) || phoneUid.get(id) || null;
      const k = S.syncKey(id, uid);
      keyToId.set(k, id);
      return k;
    };
    // Beside the text: the switches and the approval hint (an app that says it knows them)
    const knows = msg.switches === true;
    let sw = { toPhone: [], toComputer: [], agreed: {} };
    let allowed = [];
    let hinted = false;
    if (knows) {
      const rows = rowsById;
      // (the hints: this phone's rows replace what it said before)
      const hints = new Map();
      for (const [id, m] of rows) { const h = S.readHint(m.ok); if (h && h.rev === revs.get(id)) hints.set(keyOf(id), h); }
      try { hinted = held.recordSyncedAllowed(ws.home, phone, hints); } catch (e) { this.log(`phone sync: couldn't keep the phone's approvals as hints (${e.code || e.message})`); }
      // (the switches: the ids both sides have once the files are done; a conflict's sibling starts as a new mod does)
      const report = this.switches ? this.switches.get() : null;
      if (report) {
        const siblings = new Set(conflicts.map((c) => c.sibling));
        const want = new Set(p.want.map((w) => w.id));
        const both = [...Object.keys(p.agreed), ...want, ...give.filter((g) => !siblings.has(g.id)).map((g) => g.id)];
        const phoneSw = new Map();
        const compSw = new Map();
        const swBase = S.loadSwitchBase(ws.private, phone.id);
        const baseSw = {};
        for (const id of both) {
          const key = keyOf(id);
          if (revs.has(id)) { const v = S.readSwitch(rows.get(id) && rows.get(id).sw); if (v) phoneSw.set(key, v); } else phoneSw.set(key, null);
          if (compRevs.has(id)) { const v = report.get(S.modIdOf(id)); if (v) compSw.set(key, S.readSwitch(v)); } else compSw.set(key, null);
          // (an older base by file id, or the id it had before a rename this sync)
          const was = [key, id, ...renames.filter((r) => r.to === id).map((r) => r.from)].find((k) => Object.prototype.hasOwnProperty.call(swBase, k));
          if (was) baseSw[key] = swBase[was];
        }
        sw = S.planSwitches({ ids: both.map(keyOf), phone: phoneSw, computer: compSw, base: baseSw });
      }
      // (what's allowed here: every twin mod not held, by its revision now)
      const heldNow = held.loadHeld(ws.home);
      for (const [id, m] of computer) {
        if (!compRevs.has(id) || compRevs.get(id) !== m.rev) continue;
        const { folder, file, name } = S.parseId(id);
        if (heldNow[`${folder}/${name}`]) continue;
        let built;
        try { built = buildMod({ site: folder, file, code: m.text }).mod; } catch { continue; }
        allowed.push({ id, rev: m.rev, tier: S.tierOf(built), powers: built.sandboxed && Array.isArray(built.powers) ? [...built.powers].sort() : [] });
      }
    }
    if (trashed.length || conflicts.length || hinted) this._refresh(ws);

    const syncId = `s${crypto.randomBytes(8).toString('hex')}`;
    const byKey = (x) => ({ ...x, id: keyToId.get(x.id) || x.id }); // (the wire names a mod by its file id)
    const sync = {
      syncId, session, phone: { id: phone.id, name: phone.name }, startedAt: now,
      want: new Map(p.want.map((w) => [w.id, w])), give: new Map(give.map((g) => [g.id, g])),
      remove: new Set(p.remove), compRevs, conflicts, trashed, written: [], held: new Set(),
      skipped: [...skipped, ...p.skipped], knows, swToComputer: sw.toComputer.map(byKey), keyToId, uids: new Map([...computer].map(([id, m]) => [id, m.uid || null])),
      merges: new Map(p.merges.map((x) => [x.id, x])), renames, moved: renames.length,
    };
    this.syncs.set(phone.id, sync);
    const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k === 'id' || k === 'rev' || ((k === 'back' || k === 'conflict' || k === 'merge' || k === 'apart') && v)));
    return {
      t: 'sync.plan', syncId,
      want: p.want.map(strip), give: give.map(strip), remove: p.remove, later: p.later, skipped: sync.skipped,
      ...(ids ? { renames } : {}),
      ...(knows ? { switches: sw.toPhone.map(byKey), allowed } : {}),
    };
  }

  _get(session, msg) {
    const sync = this._own(session, msg);
    const id = typeof msg.mod === 'string' ? msg.mod : '';
    if (!sync.give.has(id)) throw fail('bad-mod', 'that mod isn\'t one this sync gives');
    const f = this._current(this.getWorkspace(), id);
    if (!f || f.link || f.big || f.text === null) throw fail('changed', 'that mod changed on the computer since the plan: the next sync decides');
    let name = null;
    try { name = parseHeader(f.text).name; } catch { /* the file's name then */ }
    return { t: 'sync.mod', mod: id, name: name || S.parseId(id).name, code: f.text };
  }

  _put(session, msg) {
    const sync = this._own(session, msg);
    const id = typeof msg.mod === 'string' ? msg.mod : '';
    if (!sync.want.has(id)) throw fail('bad-mod', 'that mod isn\'t one this sync asked for');
    const code = msg.code;
    if (typeof code !== 'string') throw fail('bad-mod', 'that isn\'t a mod file');
    const bytes = Buffer.from(code, 'utf8');
    if (bytes.length > S.MOD_MAX) throw fail('too-big', 'a mod over 1 MB');
    if (bytes.toString('utf8') !== code) throw fail('bad-mod', 'that isn\'t UTF-8 text');
    if (code.includes('\0')) throw fail('bad-mod', 'that isn\'t a mod file (it has a NUL)');
    if (!HEADER_RE.test(code)) throw fail('bad-mod', 'that isn\'t a mod file (no // ==WebMod== header)');
    const { folder, file, name } = S.parseId(id);
    let text = code;
    const merge = sync.merges && sync.merges.get(id);
    if (merge) {
      // (a rename on one side, an edit on the other: the body's side with the other's @name and @id, D17)
      const cur = this._current(this.getWorkspace(), id);
      if (!cur || cur.link || cur.big || cur.text === null) throw fail('changed', 'that mod changed on the computer since the plan: the next sync decides');
      const bodySide = merge.body === 'phone' ? code : cur.text;
      const metaSide = MI.readMeta(merge.meta === 'phone' ? code : cur.text);
      text = MI.withMeta(bodySide, { ...(metaSide.name ? { name: metaSide.name } : {}), ...(metaSide.uid ? { uid: metaSide.uid } : {}) });
    }
    let hash;
    try { hash = buildMod({ site: folder, file, code: text }).mod.hash; } catch (e) { throw fail('bad-mod', `that mod doesn't read: ${String(e.message).slice(0, 200)}`); }
    const ws = this.getWorkspace();
    if (this._busy(ws)(folder)) throw fail('changed', 'a run is working on that site on the computer now: the next sync decides');
    const was = this._current(ws, id);
    if (was && (was.link || was.big || was.text === null)) throw fail('changed', 'that mod changed on the computer since the plan: the next sync decides');
    const wasRev = was ? S.rev(was.buf) : null;
    const planned = sync.compRevs.has(id) ? sync.compRevs.get(id) : null;
    if (wasRev !== planned) throw fail('changed', 'that mod changed on the computer since the plan: the next sync decides');
    const out = Buffer.from(text, 'utf8');
    if (out.length > S.MOD_MAX) throw fail('too-big', 'a mod over 1 MB');
    const r = S.rev(out);
    if (merge && sync.give.has(id)) sync.give.get(id).rev = r;
    if (wasRev !== r) {
      const total = this._twinsSize(ws) - (was ? was.size : 0) + out.length;
      if (total > TWINS_MAX) throw fail('too-big', 'the phone mods on the computer would be over 16 MB together');
      this._write(ws, id, text, was, { hash, phone: sync.phone });
      sync.compRevs.set(id, r);
      sync.written.push(id);
    }
    const map = this._refresh(ws);
    const isHeld = !!(map && map[`${folder}/${name}`] && map[`${folder}/${name}`].hash === hash);
    if (isHeld) sync.held.add(id); else sync.held.delete(id);
    return { mod: id, rev: r, held: isHeld };
  }

  _end(session, msg) {
    const sync = this._own(session, msg);
    this.syncs.delete(sync.phone.id);
    const have = new Map();
    for (const m of Array.isArray(msg.have) ? msg.have.slice(0, S.MAX_MODS * 2) : []) {
      if (m && typeof m.id === 'string' && typeof m.rev === 'string' && /^[0-9a-f]{64}$/.test(m.rev)) have.set(m.id, m.rev);
    }
    const ws = this.getWorkspace();
    const base = S.loadBase(ws.private, sync.phone.id);
    const baseMeta = S.loadBaseMeta(ws.private, sync.phone.id);
    const ids = new Set([...sync.want.keys(), ...sync.give.keys(), ...sync.remove]);
    let agreed = 0;
    for (const id of ids) {
      let f = null;
      try { f = this._current(ws, id); } catch { continue; }
      const C = f && f.buf && f.text !== null ? S.rev(f.buf) : f ? undefined : null;
      if (C === undefined) continue; // (not a plain mod file there now: the next sync decides)
      const Pv = have.has(id) ? have.get(id) : null;
      if (Pv !== C) continue;
      if (C === null) { delete base[id]; delete baseMeta[id]; } else { base[id] = C; const u = MI.readMeta(f.text).uid; baseMeta[id] = { ...(u ? { uid: u } : {}), ...MI.revs(f.text) }; }
      agreed++;
    }
    // The switches: what the computer takes goes to the browser now; the base moves where both sides agree as last
    // seen (the phone's now, the extension's last report: a switch sent now is confirmed by its next report).
    let swBase;
    let switched = 0;
    if (sync.knows && this.switches) {
      const takes = sync.swToComputer.filter((x) => { try { return !!this._current(ws, x.id); } catch { return false; } });
      if (takes.length) {
        try { if (this.switches.set(takes.map((x) => ({ modId: S.modIdOf(x.id), on: x.on, off: x.off, at: x.at })))) switched = takes.length; } catch (e) { this.log(`phone sync: couldn't send the switches to the browser (${e.message})`); }
      }
      const report = this.switches.get();
      if (report && Array.isArray(msg.switches)) {
        swBase = S.loadSwitchBase(ws.private, sync.phone.id);
        const phoneNow = new Map(); // key -> [file id, switch]
        for (const x of msg.switches.slice(0, S.MAX_MODS * 2)) {
          if (!x || typeof x.id !== 'string') continue;
          try { S.parseId(x.id); } catch { continue; }
          const v = S.readSwitch(x);
          if (!v) continue;
          let uid = null;
          try { const f = this._current(ws, x.id); uid = f && f.text ? MI.readMeta(f.text).uid : null; } catch { /* the file id */ }
          phoneNow.set(S.syncKey(x.id, uid || (sync.uids && sync.uids.get(x.id)) || null), [x.id, v]);
        }
        for (const [key, [id, v]] of phoneNow) {
          const c = report.get(S.modIdOf(id));
          const cv = c ? S.readSwitch(c) : null;
          if (cv && S.switchKey(cv) === S.switchKey(v)) swBase[key] = S.switchKey(v);
          if (key !== id) delete swBase[id]; // (an older base's entry by file id: the key has it now)
        }
        // (a mod on neither side any more: out of the switches' base)
        const known = new Set([...report.keys()]);
        for (const key of Object.keys(swBase)) {
          if (phoneNow.has(key)) continue;
          const id = sync.keyToId && sync.keyToId.get(key);
          if (key.includes('#') ? !(id && known.has(S.modIdOf(id))) : !known.has(S.modIdOf(key))) delete swBase[key];
        }
      }
    }
    try { S.saveBase(ws.private, sync.phone.id, base, this.now(), swBase, baseMeta); } catch (e) { this.log(`phone sync: couldn't save the base (${e.code || e.message})`); }
    // (a mod's name as the user sees it: its @name, else the id's)
    const nameOf = (id) => { try { const f = this._current(ws, id); const n = f && f.text ? parseHeader(f.text).name : null; if (n) return String(n).slice(0, 120); } catch { /* the id's */ } return S.parseId(id).name; };
    const heldMap = held.loadHeld(ws.home);
    const marks = held.loadSynced(ws.home);
    const waiting = [];
    for (const [hid, h] of Object.entries(heldMap)) {
      if (!h || !h.phone || !isPhoneSite(hid.split('/')[0])) continue;
      const syncedBy = marks[hid];
      if (!syncedBy || syncedBy.phone !== sync.phone.id) continue;
      const id = S.idOf(hid.split('/')[0], `${hid.slice(hid.indexOf('/') + 1)}.js`);
      if (!id) continue;
      waiting.push({ id, name: nameOf(id) });
    }
    const toPhone = [...sync.give.keys()].filter((id) => have.get(id) === sync.give.get(id).rev).length + [...sync.remove].filter((id) => !have.has(id)).length;
    const done = { synced: agreed, waiting, conflicts: sync.conflicts };
    this.last.set(sync.phone.id, {
      at: this.now(), fromPhone: sync.written.length + sync.trashed.length, toPhone, waiting: waiting.length,
      conflicts: sync.conflicts.map((c) => nameOf(c.id)), skipped: sync.skipped.length, switched,
    });
    try { this.synced(sync.phone.id); } catch { /* the panel's line, no more */ }
    return { t: 'sync.done', ...done };
  }

  // ------------------------------------------------------------ writes

  /** Writes `text` at the id's file: the twin a real folder (made if missing), history first, a fresh temporary file renamed into place. */
  _write(ws, id, text, was, mark) {
    const { folder, file, name } = S.parseId(id);
    if (plainDir(ws.modsDir) !== true) throw fail('bad-mod', 'the mods folder isn\'t a plain folder');
    const dir = path.join(ws.modsDir, folder);
    const kind = plainDir(dir);
    if (kind === 'other') throw fail('bad-mod', 'the phone twin on the computer isn\'t a plain folder');
    if (!kind) fs.mkdirSync(dir);
    const target = path.join(dir, file);
    let st = null;
    try { st = fs.lstatSync(target); } catch { /* new */ }
    if (st && !st.isFile()) throw fail('changed', 'something on the computer at that name isn\'t a mod file');
    if (!was && st) throw fail('changed', 'that mod is on the computer now: the next sync decides');
    history.writeEntry(ws, folder, name, was ? was.text : null, this.now(), 'phone');
    if (mark) held.recordSynced(ws.home, `${folder}/${name}`, mark.hash, mark.phone);
    const tmp = path.join(dir, `.sync-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o644 });
    try {
      if (plainDir(dir) !== true) throw fail('bad-mod', 'the phone twin on the computer isn\'t a plain folder');
      fs.renameSync(tmp, target);
    } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
  }

  /** A twin's mod moved to another file id (renamed on the phone, or beside a mod of the phone's with its name): what
   * the helper keeps by its id first (lib/rename.js moveKeys), then the file (`text`: as it ends; history keeps it). */
  _move(ws, from, to, text) {
    const a = S.parseId(from);
    const b = S.parseId(to);
    if (a.folder !== b.folder) throw fail('bad-mod', 'a mod moves within its site only');
    const dir = path.join(ws.modsDir, a.folder);
    if (plainDir(dir) !== true) throw fail('bad-mod', 'the phone twin on the computer isn\'t a plain folder');
    const st = fs.lstatSync(path.join(dir, a.file));
    if (!st.isFile()) throw fail('changed', 'something on the computer at that name isn\'t a mod file');
    moveKeys(ws, [{ from: `${a.folder}/${a.name}`, to: `${b.folder}/${b.name}` }]);
    require('../rename').moveFile(ws, `${a.folder}/${a.name}`, b.file, text);
  }

  /** The twin's file to trash/<folder>/<name>@<stamp>.js (trash.js's layout: `trif restore` brings it back). */
  _toTrash(ws, id) {
    const { folder, file, name } = S.parseId(id);
    const dir = path.join(ws.modsDir, folder);
    if (plainDir(dir) !== true) throw fail('bad-mod', 'the phone twin on the computer isn\'t a plain folder');
    const st = fs.lstatSync(path.join(dir, file));
    if (!st.isFile()) throw fail('changed', 'something on the computer at that name isn\'t a mod file');
    const tdir = path.join(ws.home, 'trash', folder);
    fs.mkdirSync(tdir, { recursive: true });
    const now = this.now();
    let to = path.join(tdir, `${name}@${stampOf(now)}.js`);
    for (let n = 1; fs.existsSync(to); n++) to = path.join(tdir, `${name}@${stampOf(now + n)}.js`);
    fs.renameSync(path.join(dir, file), to);
    try { trash.emptyTrash(ws, { now }); } catch { /* next time */ }
  }

  _twinsSize(ws) {
    let total = 0;
    for (const folder of fs.readdirSync(ws.modsDir)) {
      if (!isPhoneSite(folder) || plainDir(path.join(ws.modsDir, folder)) !== true) continue;
      for (const f of fs.readdirSync(path.join(ws.modsDir, folder))) {
        if (!f.endsWith('.js') || isIgnoredName(f)) continue;
        try { const st = fs.lstatSync(path.join(ws.modsDir, folder, f)); if (st.isFile()) total += st.size; } catch { /* gone */ }
      }
    }
    return total;
  }

  /** The helper looks at the mods again: the held map after (null: couldn't tell). */
  _refresh(ws) {
    try {
      if (this.afterWrite) return this.afterWrite();
      const scopes = this.runs && typeof this.runs.scopes === 'function' ? this.runs.scopes() : [];
      return held.updateHeld(ws, scanMods(ws.modsDir).mods, scopes);
    } catch (e) {
      this.log(`phone sync: couldn't look at the mods again (${e.message})`);
      return null;
    }
  }

  /** The store changed: a phone that isn't paired any more loses its base and any sync going on. */
  _removed() {
    const paired = new Set(this.store.list().map((p) => p.id));
    for (const id of [...this.syncs.keys()]) if (!paired.has(id)) this.syncs.delete(id);
    for (const id of [...this.last.keys()]) if (!paired.has(id)) this.last.delete(id);
    const dir = path.join(this.getWorkspace().private, 'phone-link', 'sync');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const id = n.endsWith('.json') ? n.slice(0, -5) : '';
      if (/^[0-9a-f]{16}$/.test(id) && !paired.has(id)) S.deleteBase(this.getWorkspace().private, id);
    }
  }
}

module.exports = { PhoneSync, TWINS_MAX, WHY };
