'use strict';
// Phone sync by stable id (docs/PHONE-SYNC.md 2a, 3, 4, 7; D17, Tim 2026-11-18): the session against a fake phone
// that says `ids: true`, in a temp workspace with the real held.js, history and rename. Proven here: a rename on the
// phone moves the computer's file (no delete and add; what's kept by its id follows); a rename on the computer reaches
// the phone as a rename; a rename on one side and an edit on the other merge; two different mods with one name stay
// apart; an old phone (no ids) still syncs; a conflict's copy gets an id of its own; every-site mods both ways (D10).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { tempDir } = require('./fake-extension');
const S = require('../helper/lib/phonelink/sync');
const MI = require('../helper/lib/modid');
const { PhoneSync } = require('../helper/lib/phonelink/syncsession');
const held = require('../helper/lib/held');
const { scanMods } = require('../helper/lib/mods');
const { renameMod } = require('../helper/lib/rename');

const cleanups = [];
test.after(() => { for (const c of cleanups) c(); });

const PHONE = { id: '0123456789abcdef', name: 'Test iPhone' };
const U1 = '11111111-aaaa-4bbb-8ccc-000000000001';
const U2 = '22222222-aaaa-4bbb-8ccc-000000000002';
const mod = (name, uid = null, body = 'document.body.style.color = "red"') => `// ==WebMod==\n// @name ${name}\n${uid ? `// @id ${uid}\n` : ''}// ==/WebMod==\n${body}\n`;

function setup() {
  const home = tempDir('wm-psids-');
  const priv = `${home}-private`;
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  fs.mkdirSync(priv, { recursive: true });
  cleanups.push(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(priv, { recursive: true, force: true }); });
  const ws = { home, modsDir: path.join(home, 'sites'), private: priv };
  const store = new EventEmitter();
  store.list = () => [PHONE];
  const server = { handlers: new Map(), sessions: new Set(), handle(t, fn) { this.handlers.set(t, fn); } };
  const session = { phone: PHONE, open: true, sent: [], send(o) { this.sent.push(o); return true; } };
  server.sessions.add(session);
  let t = 1e12;
  const sync = new PhoneSync(store, server, { list: () => [], scopes: () => [] }, { getWorkspace: () => ws, now: () => t }).start();
  fs.mkdirSync(path.join(ws.modsDir, 'other.com'));
  fs.writeFileSync(path.join(ws.modsDir, 'other.com', 'seed.js'), mod('Seed'));
  held.updateHeld(ws, scanMods(ws.modsDir).mods, []);
  const ask = async (msg) => server.handlers.get(msg.t)(session, msg);
  const file = (rel) => path.join(ws.modsDir, rel);
  const write = (rel, text) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), text); };
  const read = (rel) => fs.readFileSync(file(rel), 'utf8');
  const exists = (rel) => fs.existsSync(file(rel));
  /** One whole sync as an app from 11-18 does it (ids: true): `phone` id -> text, changed in place. old: an older app. */
  const round = async (phone, { old = false } = {}) => {
    t += 1500;
    const rows = Object.entries(phone).map(([id, text]) => {
      const row = { id, rev: S.rev(text) };
      if (!old) { const m = MI.readMeta(text); if (m.uid) row.uid = m.uid; Object.assign(row, MI.revs(text)); }
      return row;
    });
    const plan = await ask({ t: 'sync.begin', ...(old ? {} : { ids: true }), mods: rows });
    for (const r of plan.renames || []) { assert.ok(!phone[r.to], `the phone has nothing at ${r.to}`); phone[r.to] = phone[r.from]; delete phone[r.from]; }
    const puts = {};
    for (const w of plan.want) puts[w.id] = await ask({ t: 'sync.put', syncId: plan.syncId, mod: w.id, code: phone[w.id] });
    for (const g of plan.give) {
      const got = await ask({ t: 'sync.get', syncId: plan.syncId, mod: g.id });
      if (!g.merge) assert.equal(S.rev(got.code), g.rev);
      phone[g.id] = got.code;
    }
    for (const id of plan.remove) delete phone[id];
    const done = await ask({ t: 'sync.end', syncId: plan.syncId, have: Object.entries(phone).map(([id, text]) => ({ id, rev: S.rev(text) })) });
    return { plan, puts, done };
  };
  const trashed = () => { try { return fs.readdirSync(path.join(ws.home, 'trash', 'phone~example.com')); } catch { return []; } };
  return { ws, ask, file, write, read, exists, round, trashed };
}

const quiet = (r) => assert.deepEqual([r.plan.want, r.plan.give, r.plan.remove, r.plan.renames || []], [[], [], [], []], 'in sync');

test('a rename on the phone moves the computer\'s file: no delete and add, what it was allowed kept', async () => {
  const s = setup();
  const phone = { 'example.com/calmer-feed': mod('Calmer feed', U1) };
  await s.round(phone);
  assert.equal(s.read('phone~example.com/calmer-feed.js'), phone['example.com/calmer-feed']);
  quiet(await s.round(phone));
  // (the computer looked at it: seen.json has it by its id)
  held.updateHeld(s.ws, scanMods(s.ws.modsDir).mods, []);
  // renamed on the phone: its @name line and its file id
  phone['example.com/quiet-feed'] = MI.withMeta(phone['example.com/calmer-feed'], { name: 'Quiet feed' });
  delete phone['example.com/calmer-feed'];
  const r = await s.round(phone);
  assert.deepEqual(r.plan.renames, [], 'the computer moved its own file: nothing for the phone to rename');
  assert.deepEqual(r.plan.want, [{ id: 'example.com/quiet-feed' }]);
  assert.deepEqual([r.plan.give, r.plan.remove], [[], []]);
  assert.ok(!s.exists('phone~example.com/calmer-feed.js'));
  assert.equal(s.read('phone~example.com/quiet-feed.js'), phone['example.com/quiet-feed']);
  assert.deepEqual(s.trashed(), [], 'nothing went to the trash: a rename, not a delete');
  const seen = JSON.parse(fs.readFileSync(path.join(s.ws.home, 'seen.json'), 'utf8'));
  assert.ok(seen['phone~example.com/quiet-feed'] && !seen['phone~example.com/calmer-feed'], 'what TRIF let run moved with it');
  assert.ok(fs.readdirSync(path.join(s.ws.home, 'history', 'phone~example.com')).every((n) => n.startsWith('quiet-feed@')), 'its history too');
  quiet(await s.round(phone));
});

test('a rename on the computer reaches the phone as a rename', async () => {
  const s = setup();
  const phone = { 'example.com/calmer-feed': mod('Calmer feed', U1) };
  await s.round(phone);
  const r0 = renameMod(s.ws, { id: 'phone~example.com/calmer-feed', name: 'Quiet feed' });
  assert.equal(r0.id, 'phone~example.com/quiet-feed');
  const r = await s.round(phone);
  assert.deepEqual(r.plan.renames, [{ from: 'example.com/calmer-feed', to: 'example.com/quiet-feed' }]);
  assert.deepEqual(r.plan.give.map((g) => g.id), ['example.com/quiet-feed'], 'then its new @name line');
  assert.deepEqual([r.plan.want, r.plan.remove], [[], []]);
  assert.equal(MI.readMeta(phone['example.com/quiet-feed']).name, 'Quiet feed');
  assert.equal(MI.readMeta(phone['example.com/quiet-feed']).uid, U1);
  assert.deepEqual(Object.keys(phone), ['example.com/quiet-feed']);
  quiet(await s.round(phone));
});

test('a rename on one side and an edit on the other: both kept in one mod (merge), either way round', async () => {
  const s = setup();
  const phone = { 'example.com/feed': mod('Feed', U1) };
  await s.round(phone);
  // renamed on the phone, edited on the computer
  phone['example.com/news'] = MI.withMeta(phone['example.com/feed'], { name: 'News' });
  delete phone['example.com/feed'];
  s.write('phone~example.com/feed.js', mod('Feed', U1, 'document.body.style.color = "blue"'));
  let r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/news', merge: true }]);
  assert.deepEqual(r.plan.give, [{ id: 'example.com/news', merge: true }]);
  const both = mod('News', U1, 'document.body.style.color = "blue"');
  assert.equal(phone['example.com/news'], both);
  assert.equal(s.read('phone~example.com/news.js'), both);
  assert.ok(!s.exists('phone~example.com/feed.js'));
  quiet(await s.round(phone));
  // edited on the phone, renamed on the computer
  phone['example.com/news'] = mod('News', U1, 'document.body.style.color = "green"');
  renameMod(s.ws, { id: 'phone~example.com/news', name: 'Headlines' });
  r = await s.round(phone);
  assert.deepEqual(r.plan.renames, [{ from: 'example.com/news', to: 'example.com/headlines' }]);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/headlines', merge: true }]);
  const both2 = mod('Headlines', U1, 'document.body.style.color = "green"');
  assert.equal(phone['example.com/headlines'], both2);
  assert.equal(s.read('phone~example.com/headlines.js'), both2);
  quiet(await s.round(phone));
  // an edit of the code on both: still a conflict, both kept, and the copy is a mod of its own (a new id)
  phone['example.com/headlines'] = mod('Headlines', U1, 'a()');
  s.write('phone~example.com/headlines.js', mod('Headlines', U1, 'b()'));
  r = await s.round(phone);
  const sib = r.plan.give.find((g) => g.conflict);
  assert.equal(sib.id, 'example.com/headlines-from-computer');
  const copy = MI.readMeta(phone[sib.id]);
  assert.equal(copy.name, 'Headlines (from your computer)');
  assert.ok(copy.uid && copy.uid !== U1, 'the kept copy has an id of its own');
  quiet(await s.round(phone));
});

test('two different mods with the same name, made apart, stay two mods', async () => {
  const s = setup();
  s.write('phone~example.com/calmer-feed.js', mod('Calmer feed', U2, 'computer()'));
  const phone = { 'example.com/calmer-feed': mod('Calmer feed', U1, 'phone()') };
  const r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/calmer-feed' }], 'the phone\'s keeps the name (D5)');
  const g = r.plan.give.find((x) => x.apart);
  assert.deepEqual([g.id, g.apart], ['example.com/calmer-feed-from-computer', 'example.com/calmer-feed']);
  assert.equal(MI.readMeta(phone[g.id]).uid, U2, 'the computer\'s keeps its id: the same mod, moved beside');
  assert.equal(MI.readMeta(s.read('phone~example.com/calmer-feed.js')).uid, U1);
  assert.ok(!r.done.conflicts.length, 'not a conflict: two mods');
  quiet(await s.round(phone));
  // and a later rename of either stays its own
  phone['example.com/phone-feed'] = MI.withMeta(phone['example.com/calmer-feed'], { name: 'Phone feed' });
  delete phone['example.com/calmer-feed'];
  await s.round(phone);
  assert.ok(s.exists('phone~example.com/phone-feed.js') && s.exists('phone~example.com/calmer-feed-from-computer.js'));
  quiet(await s.round(phone));
});

test('ids on one side only, and an old phone without them: paired by file id as before', async () => {
  const s = setup();
  // the computer's copy has no id yet, the phone's (stamped by an edit there) has one: the same mod by its name
  s.write('phone~example.com/a.js', mod('A'));
  const phone = { 'example.com/a': mod('A') };
  await s.round(phone);
  phone['example.com/a'] = MI.withMeta(phone['example.com/a'], { uid: U1 });
  let r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/a' }], 'only the phone changed: its stamped copy goes over');
  assert.equal(MI.readMeta(s.read('phone~example.com/a.js')).uid, U1);
  // an old phone renames by delete + add, and gets nothing it can't read (no renames, no merges)
  const old = { 'example.com/a': phone['example.com/a'] };
  await s.round(old, { old: true });
  old['example.com/b'] = MI.withMeta(old['example.com/a'], { name: 'B' });
  delete old['example.com/a'];
  r = await s.round(old, { old: true });
  assert.equal(r.plan.renames, undefined);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/b' }]);
  assert.equal(s.trashed().length, 1, 'the old id went to the trash, as before');
  quiet(await s.round(old, { old: true }));
});

test('every-site mods sync both ways (D10), and are read with every site\'s matches', async () => {
  const s = setup();
  s.write('phone~all-sites/dark.js', mod('Dark', U2));
  const phone = { 'all-sites/big-text': mod('Big text', U1) };
  const r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'all-sites/big-text' }]);
  assert.deepEqual(r.plan.give.map((g) => g.id), ['all-sites/dark']);
  assert.equal(s.read('phone~all-sites/big-text.js'), phone['all-sites/big-text']);
  const m = scanMods(s.ws.modsDir).mods.find((x) => x.id === 'phone~all-sites/big-text');
  assert.deepEqual(m.matches, ['*://*/*']);
  assert.equal(m.phone, true);
  quiet(await s.round(phone));
});
