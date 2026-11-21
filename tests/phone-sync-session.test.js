'use strict';
// Phone sync, the session side (helper/lib/phonelink/syncsession.js; docs/PHONE-SYNC.md sections 4-7), against a
// fake session and server in a temp workspace: the real held.js, history.js and trash layout. No network.
// What is proven here: adds and edits both ways; deletes go to the trash; a conflict keeps both; a change that
// can do more than style waits for the user's OK on the computer (held.js, naming the phone) and a style mod runs
// at once; history before replace; a twin with a run is left for later; every-site mods sync (D10); the
// refusals (bad ids, not a mod, too big, changed since the plan, a link for a twin, a stale or second sync, off);
// a removed phone's base goes; the nudge carries nothing and comes at most every 2 s.

const test = require('./on-windows')(__filename);
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { tempDir } = require('./fake-extension');
const S = require('../helper/lib/phonelink/sync');
const { PhoneSync } = require('../helper/lib/phonelink/syncsession');
const held = require('../helper/lib/held');
const { scanMods } = require('../helper/lib/mods');

const cleanups = [];
test.after(() => { for (const c of cleanups) c(); });

const PHONE = { id: '0123456789abcdef', name: 'Test iPhone' };
const mod = (name, body = 'document.body.style.color = "red"') => `// ==WebMod==\n// @name ${name}\n// ==/WebMod==\n${body}\n`;
const style = (name, css = '#ad') => `// ==WebMod==\n// @name ${name}\n// @match https://example.com/*\n// @style\n// ==/WebMod==\n{ "hide": ["${css}"] }\n`;
const CLICKS = 'document.querySelector("button").click()';

function setup({ enabled = () => true, runs = [], switches = null } = {}) {
  const home = tempDir('wm-psync-');
  const priv = `${home}-private`;
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  fs.mkdirSync(priv, { recursive: true });
  cleanups.push(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(priv, { recursive: true, force: true }); });
  const ws = { home, modsDir: path.join(home, 'sites'), private: priv };
  const store = new EventEmitter();
  store.phones = [PHONE];
  store.list = () => store.phones;
  const server = { handlers: new Map(), sessions: new Set(), handle(t, fn) { this.handlers.set(t, fn); } };
  const session = { phone: PHONE, open: true, sent: [], send(o) { this.sent.push(o); return true; } };
  server.sessions.add(session);
  let t = 1e12;
  const fakeRuns = { list: () => runs, scopes: () => [] };
  const sync = new PhoneSync(store, server, fakeRuns, { getWorkspace: () => ws, enabled, now: () => t, ...(switches ? { switches } : {}) }).start();
  // (held.js's first look: what's there is the user's, as it is; a desktop mod so that it's remembered)
  fs.mkdirSync(path.join(ws.modsDir, 'other.com'));
  fs.writeFileSync(path.join(ws.modsDir, 'other.com', 'seed.js'), mod('Seed'));
  held.updateHeld(ws, scanMods(ws.modsDir).mods, []);
  const ask = async (msg) => {
    const fn = server.handlers.get(msg.t);
    return fn(session, msg);
  };
  const later = (ms = 1500) => { t += ms; };
  const file = (rel) => path.join(ws.modsDir, rel);
  const write = (rel, text) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), text); };
  const read = (rel) => fs.readFileSync(file(rel), 'utf8');
  /** One whole sync as the phone does it: begin, take what's given, send what's wanted, end. `phone`: id -> text (changed in place). */
  const round = async (phone) => {
    later();
    const plan = await ask({ t: 'sync.begin', mods: Object.entries(phone).map(([id, text]) => ({ id, rev: S.rev(text) })) });
    const puts = {};
    for (const w of plan.want) puts[w.id] = await ask({ t: 'sync.put', syncId: plan.syncId, mod: w.id, code: phone[w.id] });
    for (const g of plan.give) {
      const got = await ask({ t: 'sync.get', syncId: plan.syncId, mod: g.id });
      assert.equal(S.rev(got.code), g.rev);
      phone[g.id] = got.code;
    }
    for (const id of plan.remove) delete phone[id];
    const done = await ask({ t: 'sync.end', syncId: plan.syncId, have: Object.entries(phone).map(([id, text]) => ({ id, rev: S.rev(text) })) });
    return { plan, puts, done };
  };
  /**
   * One whole sync as an app that knows switches and hints does it: `phone` id -> {text, sw, ok?} (changed in place;
   * a new mod from the computer gets `sw` from the plan's switches, as the app takes one off and then sets it).
   */
  const roundSw = async (phone) => {
    later();
    const plan = await ask({ t: 'sync.begin', switches: true, mods: Object.entries(phone).map(([id, m]) => ({ id, rev: S.rev(m.text), sw: m.sw, ...(m.ok ? { ok: m.ok } : {}) })) });
    const puts = {};
    for (const w of plan.want) puts[w.id] = await ask({ t: 'sync.put', syncId: plan.syncId, mod: w.id, code: phone[w.id].text });
    for (const g of plan.give) {
      const got = await ask({ t: 'sync.get', syncId: plan.syncId, mod: g.id });
      phone[g.id] = phone[g.id] ? { ...phone[g.id], text: got.code } : { text: got.code, sw: { on: false, off: [], at: 0 } };
    }
    for (const id of plan.remove) delete phone[id];
    for (const x of plan.switches) if (phone[x.id]) phone[x.id].sw = { on: x.on, off: x.off, at: x.at };
    const done = await ask({ t: 'sync.end', syncId: plan.syncId, have: Object.entries(phone).map(([id, m]) => ({ id, rev: S.rev(m.text) })),
      switches: Object.entries(phone).map(([id, m]) => ({ id, ...m.sw })) });
    return { plan, puts, done };
  };
  return { ws, store, server, session, sync, ask, later, file, write, read, round, roundSw };
}

const fails = (code) => (e) => e instanceof S.SyncError && e.code === code;

test('adds and edits both ways; deletes go to the trash; then in sync, nothing to do', async () => {
  const s = setup();
  s.write('phone~example.com/from-computer.js', mod('From the computer'));
  const phone = { 'example.com/from-phone': mod('From the phone') };
  let r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/from-phone' }]);
  assert.deepEqual(r.plan.give.map((g) => g.id), ['example.com/from-computer']);
  assert.equal(s.read('phone~example.com/from-phone.js'), phone['example.com/from-phone']);
  assert.equal(phone['example.com/from-computer'], mod('From the computer'));
  assert.deepEqual(r.puts['example.com/from-phone'], { mod: 'example.com/from-phone', rev: S.rev(mod('From the phone')), held: false });
  assert.equal(r.done.synced, 2);
  assert.deepEqual(Object.keys(S.loadBase(s.ws.private, PHONE.id)).sort(), ['example.com/from-computer', 'example.com/from-phone']);
  assert.equal(fs.statSync(S.basePath(s.ws.private, PHONE.id)).mode & 0o777, 0o600);
  // (a new file has a history marker: the desktop's Undo takes it away again)
  const hist = fs.readdirSync(path.join(s.ws.home, 'history', 'phone~example.com'));
  assert.ok(hist.some((n) => /^from-phone@.*\.created$/.test(n)), hist.join());
  assert.equal(s.sync.status(PHONE.id).fromPhone, 1);
  assert.equal(s.sync.status(PHONE.id).toPhone, 1);

  r = await s.round(phone);
  assert.deepEqual([r.plan.want, r.plan.give, r.plan.remove], [[], [], []]);

  // edited on each side
  phone['example.com/from-computer'] = mod('From the computer', 'document.title = "phone"');
  s.write('phone~example.com/from-phone.js', mod('From the phone', 'document.title = "computer"'));
  const before = s.read('phone~example.com/from-computer.js');
  r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/from-computer' }]);
  assert.deepEqual(r.plan.give.map((g) => g.id), ['example.com/from-phone']);
  assert.match(s.read('phone~example.com/from-computer.js'), /"phone"/);
  assert.match(phone['example.com/from-phone'], /"computer"/);
  // (history keeps what it replaced, marked as the phone's change)
  const dir = path.join(s.ws.home, 'history', 'phone~example.com');
  const entry = fs.readdirSync(dir).find((n) => /^from-computer@.*\.js$/.test(n));
  assert.equal(fs.readFileSync(path.join(dir, entry), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(dir, entry.replace(/\.js$/, '.source')), 'utf8'), 'phone');

  // deleted on the phone: to the computer's trash
  delete phone['example.com/from-computer'];
  r = await s.round(phone);
  assert.ok(!fs.existsSync(s.file('phone~example.com/from-computer.js')));
  const trashed = fs.readdirSync(path.join(s.ws.home, 'trash', 'phone~example.com'));
  assert.ok(trashed.some((n) => /^from-computer@\d{8}T\d{9}Z\.js$/.test(n)), trashed.join());
  // deleted on the computer: the phone is told to remove it, and the base lets go of it
  fs.unlinkSync(s.file('phone~example.com/from-phone.js'));
  r = await s.round(phone);
  assert.deepEqual(r.plan.remove, ['example.com/from-phone']);
  assert.deepEqual(phone, {});
  assert.deepEqual(S.loadBase(s.ws.private, PHONE.id), {});
});

test('a conflict keeps both: the phone\'s at the name, the computer\'s beside it, on both sides', async () => {
  const s = setup();
  s.write('phone~example.com/dark.js', mod('Dark'));
  const phone = {};
  await s.round(phone);
  phone['example.com/dark'] = mod('Dark', 'document.title = "phone"');
  s.write('phone~example.com/dark.js', mod('Dark', 'document.title = "computer"'));
  const r = await s.round(phone);
  assert.deepEqual(r.plan.want, [{ id: 'example.com/dark', conflict: true }]);
  assert.deepEqual(r.plan.give.map((g) => [g.id, g.conflict]), [['example.com/dark-from-computer', 'example.com/dark']]);
  assert.deepEqual(r.done.conflicts, [{ id: 'example.com/dark', sibling: 'example.com/dark-from-computer' }]);
  assert.match(s.read('phone~example.com/dark.js'), /"phone"/);
  const sibling = s.read('phone~example.com/dark-from-computer.js');
  assert.match(sibling, /@name Dark \(from your computer\)/);
  assert.match(sibling, /"computer"/);
  assert.equal(phone['example.com/dark-from-computer'], sibling);
  // (the computer's version is in history too)
  const dir = path.join(s.ws.home, 'history', 'phone~example.com');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('dark@') && /"computer"/.test(fs.readFileSync(path.join(dir, n), 'utf8'))));
  const again = await s.round(phone);
  assert.deepEqual([again.plan.want, again.plan.give, again.plan.remove], [[], [], []]);
  // an edit beats a delete: deleted on the phone while changed on the computer, it comes back
  delete phone['example.com/dark'];
  s.write('phone~example.com/dark.js', mod('Dark', 'document.title = "edited"'));
  const back = await s.round(phone);
  assert.deepEqual(back.plan.give.map((g) => [g.id, !!g.back]), [['example.com/dark', true]]);
  assert.match(phone['example.com/dark'], /"edited"/);
});

test('approval on the computer: a change that can do more waits, naming the phone; a style mod runs at once', async () => {
  const s = setup();
  const phone = { 'example.com/clicker': mod('Clicker', CLICKS), 'example.com/no-ads': style('No ads') };
  const r = await s.round(phone);
  assert.equal(r.puts['example.com/clicker'].held, true);
  assert.equal(r.puts['example.com/no-ads'].held, false);
  const h = held.loadHeld(s.ws.home)['phone~example.com/clicker'];
  assert.equal(h.by, 'outside');
  assert.equal(h.phone, 'Test iPhone');
  assert.deepEqual(r.done.waiting, [{ id: 'example.com/clicker', name: 'Clicker' }]);
  assert.equal(s.sync.status(PHONE.id).waiting, 1);
  // a style change to a style mod: at once
  phone['example.com/no-ads'] = style('No ads', '.promo');
  const r2 = await s.round(phone);
  assert.equal(r2.puts['example.com/no-ads'].held, false);
  // a mod the computer allowed before isn't helped by the phone: a new clicking line waits again
  held.approveHeld(s.ws.home, 'phone~example.com/clicker');
  phone['example.com/clicker'] = mod('Clicker', `${CLICKS}\ndocument.querySelector("a.next").click()`);
  const r3 = await s.round(phone);
  assert.equal(r3.puts['example.com/clicker'].held, true);
});

test('left alone: a twin with a run working (later), bad ids, too big, links; every-site mods sync (D10)', async () => {
  const runs = [{ runId: 'r1', site: 'busy.com', scope: 'phone~busy.com' }];
  const s = setup({ runs });
  s.write('phone~busy.com/a.js', mod('A'));
  s.write('phone~all-sites/everywhere.js', mod('Everywhere'));
  s.write('phone~example.com/huge.js', `${mod('Huge')}//${'x'.repeat(S.MOD_MAX)}`);
  fs.mkdirSync(path.join(s.ws.home, 'elsewhere'));
  fs.writeFileSync(path.join(s.ws.home, 'elsewhere', 'secret.js'), mod('Secret'));
  fs.symlinkSync(path.join(s.ws.home, 'elsewhere'), s.file('phone~linked.com'));
  fs.mkdirSync(s.file('phone~example.com'), { recursive: true });
  fs.symlinkSync(path.join(s.ws.home, 'elsewhere', 'secret.js'), s.file('phone~example.com/pointer.js'));
  s.later();
  const plan = await s.ask({ t: 'sync.begin', mods: [
    { id: 'busy.com/b', rev: S.rev('x') }, { id: 'all-sites/dark', rev: S.rev('y') }, { id: '../etc/passwd', rev: S.rev('z') },
    { id: 'example.com/pointer', rev: S.rev('w') }, { id: 'linked.com/secret', rev: S.rev(mod('Other')) },
  ] });
  assert.deepEqual(plan.later.sort(), ['busy.com/a', 'busy.com/b']);
  const why = Object.fromEntries(plan.skipped.map((k) => [k.id, k.why]));
  assert.match(why['../etc/passwd'], /site/);
  assert.equal(why['all-sites/dark'], undefined, 'every-site mods sync now (D10)');
  assert.equal(why['all-sites/everywhere'], undefined);
  assert.deepEqual(plan.want, [{ id: 'all-sites/dark' }], 'the phone\'s every-site mod: to sites/phone~all-sites/');
  assert.deepEqual(plan.give.map((g) => g.id), ['all-sites/everywhere'], 'and the computer\'s to the phone');
  assert.equal(why['example.com/huge'], 'over 1 MB');
  assert.match(why['example.com/pointer'], /isn't a mod file/);
  assert.match(why['linked.com/secret'], /isn't a plain folder/);
  assert.ok(![...plan.want, ...plan.give].some((x) => /pointer|secret|huge|busy/.test(x.id)), 'nothing read or written through a link, nothing too big, nothing of a busy twin');
  await assert.rejects(s.ask({ t: 'sync.put', syncId: plan.syncId, mod: 'linked.com/secret', code: mod('Other') }), fails('bad-mod'));
  assert.equal(fs.readFileSync(path.join(s.ws.home, 'elsewhere', 'secret.js'), 'utf8'), mod('Secret'));
  assert.ok(!fs.existsSync(path.join(s.ws.home, 'elsewhere', '.sync')), 'nothing written there');
  // a run starting on a twin after the plan: its put waits for the next sync
  runs.length = 0;
  s.later();
  const p2 = await s.ask({ t: 'sync.begin', mods: [{ id: 'busy.com/b', rev: S.rev(mod('B')) }] });
  assert.deepEqual(p2.want, [{ id: 'busy.com/b' }]);
  runs.push({ runId: 'r2', site: 'busy.com', scope: 'phone~busy.com' });
  await assert.rejects(s.ask({ t: 'sync.put', syncId: p2.syncId, mod: 'busy.com/b', code: mod('B') }), fails('changed'));
  assert.ok(!fs.existsSync(s.file('phone~busy.com/b.js')));
});

test('the Mac\'s disk ignores capitals: a phone mod named like a computer one but for them is left alone', { skip: !require('../helper/lib/pathcheck').ignoresCase(require('os').tmpdir()) && 'a disk that tells capitals apart' }, async () => {
  const s = setup();
  s.write('phone~example.com/dark.js', mod('Dark'));
  s.later();
  const plan = await s.ask({ t: 'sync.begin', mods: [{ id: 'example.com/Dark', rev: S.rev(mod('Other')) }] });
  assert.deepEqual(plan.skipped, [{ id: 'example.com/Dark', why: 'the same name as a mod on the computer but for capitals' }]);
  assert.deepEqual(plan.want, []);
  assert.equal(s.read('phone~example.com/dark.js'), mod('Dark'));
});

test('refusals: not a mod, too big, not asked for, changed since the plan, a stale or second sync, off', async () => {
  let on = true;
  const s = setup({ enabled: () => on });
  s.write('phone~example.com/keep.js', mod('Keep'));
  await s.round({ 'example.com/keep': mod('Keep') });
  s.later();
  const wanted = { 'example.com/new': mod('New'), 'example.com/keep': mod('Keep', 'document.title = "p"') };
  const plan = await s.ask({ t: 'sync.begin', mods: Object.entries(wanted).map(([id, text]) => ({ id, rev: S.rev(text) })) });
  const put = (mod, code) => s.ask({ t: 'sync.put', syncId: plan.syncId, mod, code });
  await assert.rejects(put('example.com/new', 'alert(1)'), fails('bad-mod'), 'no header');
  await assert.rejects(put('example.com/new', `${mod('New')}\0`), fails('bad-mod'), 'a NUL');
  await assert.rejects(put('example.com/new', '// ==WebMod==\n// @style\n// @boxed\n// ==/WebMod==\n'), fails('bad-mod'), 'a header the reader refuses');
  await assert.rejects(put('example.com/new', `${mod('New')}//${'x'.repeat(S.MOD_MAX)}`), fails('too-big'));
  await assert.rejects(put('example.com/new', `${mod('New')}\ud800`), fails('bad-mod'), 'not UTF-8');
  await assert.rejects(put('example.com/other', mod('Other')), fails('bad-mod'), 'not in the plan');
  await assert.rejects(s.ask({ t: 'sync.get', syncId: plan.syncId, mod: 'example.com/keep' }), fails('bad-mod'), 'not given');
  await assert.rejects(s.ask({ t: 'sync.put', syncId: 'sdeadbeef', mod: 'example.com/new', code: mod('New') }), fails('no-sync'));
  assert.ok(!fs.existsSync(s.file('phone~example.com/new.js')));
  // changed on the computer since the plan: not overwritten, the next sync decides
  s.write('phone~example.com/keep.js', mod('Keep', 'document.title = "c"'));
  await assert.rejects(put('example.com/keep', wanted['example.com/keep']), fails('changed'));
  assert.match(s.read('phone~example.com/keep.js'), /"c"/);
  // a second begin within a second: busy; after it, the first sync is over
  await assert.rejects(s.ask({ t: 'sync.begin', mods: [] }), fails('busy'));
  s.later();
  await s.ask({ t: 'sync.begin', mods: [] });
  await assert.rejects(put('example.com/new', mod('New')), fails('no-sync'));
  // more than 500 mods
  s.later();
  await assert.rejects(s.ask({ t: 'sync.begin', mods: Array.from({ length: 501 }, (_, i) => ({ id: `example.com/m${i}`, rev: S.rev(String(i)) })) }), fails('too-big'));
  // off: nothing answers, nothing is touched
  on = false;
  s.later();
  await assert.rejects(s.ask({ t: 'sync.begin', mods: [] }), fails('off'));
  assert.equal(s.sync.changed(), 0);
});

test('the nudge: no mod, no name, at most every 2 s, not during a sync; a removed phone\'s base goes', async () => {
  const s = setup();
  assert.equal(s.sync.changed(), 1);
  assert.equal(s.sync.changed(), 0);
  s.later(2100);
  assert.equal(s.sync.changed(), 1);
  assert.deepEqual(s.session.sent, [{ t: 'sync.changed' }, { t: 'sync.changed' }]);
  const plan = await s.ask({ t: 'sync.begin', mods: [] });
  s.later(2100);
  assert.equal(s.sync.changed(), 0, 'a sync going on');
  await s.ask({ t: 'sync.end', syncId: plan.syncId, have: [] });
  assert.equal(s.sync.changed(), 1);
  assert.ok(fs.existsSync(S.basePath(s.ws.private, PHONE.id)));
  s.store.phones = [];
  s.store.emit('change');
  assert.ok(!fs.existsSync(S.basePath(s.ws.private, PHONE.id)));
  assert.equal(s.sync.status(PHONE.id), null);
  s.sync.stop();
  assert.ok(!s.server.handlers.has('sync.begin'));
});


/** A stand-in extension's switches: its report (mod id -> {on, off, at}), and what the helper sent it (taken at once, as its next report says). */
function fakeSwitches({ said = true } = {}) {
  const report = new Map();
  const sent = [];
  return {
    report, sent,
    get: () => (said ? report : null),
    set: (list) => { sent.push(list); for (const x of list) report.set(x.modId, { on: x.on, off: x.off, at: x.at }); return true; },
  };
}
const on = (at = 0, off = []) => ({ on: true, off, at });
const off = (at = 0) => ({ on: false, off: [], at });

test('switches follow the last change on either side: in sync, the phone\'s, the computer\'s, both (the later wins), new mods both ways (D8), the base', async () => {
  const x = fakeSwitches();
  const s = setup({ switches: x });
  const base = () => S.loadSwitchBase(s.ws.private, PHONE.id);
  s.write('phone~example.com/a.js', mod('A'));
  x.report.set('phone~example.com/a', on());
  const phone = { 'example.com/a': { text: mod('A'), sw: on() } };
  let r = await s.roundSw(phone);
  assert.deepEqual(r.plan.switches, []);
  assert.deepEqual(base(), { 'example.com/a': 'on|' }, 'the same: in sync, the base set');
  // the phone switches it off: the computer takes it
  phone['example.com/a'].sw = off(5000);
  r = await s.roundSw(phone);
  assert.deepEqual(r.plan.switches, []);
  assert.deepEqual(x.sent.at(-1), [{ modId: 'phone~example.com/a', on: false, off: [], at: 5000 }]);
  assert.deepEqual(base(), { 'example.com/a': 'off|' });
  // the computer switches it on, off on one site: the phone takes it (the phone's own time doesn't matter: it didn't change)
  x.report.set('phone~example.com/a', on(4000, ['m.example.com']));
  r = await s.roundSw(phone);
  assert.deepEqual(r.plan.switches, [{ id: 'example.com/a', on: true, off: ['m.example.com'], at: 4000 }]);
  assert.deepEqual(phone['example.com/a'].sw, on(4000, ['m.example.com']));
  assert.deepEqual(base(), { 'example.com/a': 'on|m.example.com' });
  // both change: the later change wins (here the computer's), and the other way
  phone['example.com/a'].sw = off(6000);
  x.report.set('phone~example.com/a', on(7000));
  r = await s.roundSw(phone);
  assert.deepEqual(r.plan.switches, [{ id: 'example.com/a', ...on(7000) }]);
  phone['example.com/a'].sw = off(9000);
  x.report.set('phone~example.com/a', on(8000, ['x.example.com']));
  const sentBefore = x.sent.length;
  r = await s.roundSw(phone);
  assert.deepEqual(r.plan.switches, []);
  assert.deepEqual(x.sent.slice(sentBefore), [[{ modId: 'phone~example.com/a', on: false, off: [], at: 9000 }]]);
  // a mod new to the computer arrives with the phone's switch (on); one new to the phone with the computer's (on)
  phone['example.com/made-on-phone'] = { text: style('Made on phone'), sw: on(10000) };
  s.write('phone~example.com/made-here.js', style('Made here'));
  x.report.set('phone~example.com/made-here', on(0));
  r = await s.roundSw(phone);
  assert.ok(r.puts['example.com/made-on-phone'].rev);
  assert.deepEqual(x.sent.at(-1), [{ modId: 'phone~example.com/made-on-phone', on: true, off: [], at: 10000 }]);
  assert.deepEqual(r.plan.switches, [{ id: 'example.com/made-here', ...on(0) }]);
  assert.deepEqual(phone['example.com/made-here'].sw, on(0), 'not off as before D8: the computer\'s switch');
  assert.deepEqual(base(), { 'example.com/a': 'off|', 'example.com/made-here': 'on|', 'example.com/made-on-phone': 'on|' });
  // then nothing to do
  const n = x.sent.length;
  r = await s.roundSw(phone);
  assert.deepEqual([r.plan.switches, x.sent.length], [[], n]);
});

test('switches: an older app (no switches in its sync) and an extension that hasn\'t said leave every switch as it is', async () => {
  const x = fakeSwitches();
  const s = setup({ switches: x });
  s.write('phone~example.com/a.js', mod('A'));
  x.report.set('phone~example.com/a', off(9000));
  // an older app: no `switches: true`, no rows' sw: no switches in the plan, nothing sent, no switches' base
  const old = await s.round({ 'example.com/a': mod('A'), 'example.com/new': style('New') });
  assert.equal(old.plan.switches, undefined);
  assert.equal(old.plan.allowed, undefined);
  assert.deepEqual(x.sent, []);
  assert.deepEqual(S.loadSwitchBase(s.ws.private, PHONE.id), {});
  // an extension that hasn't said (an older one, or not yet): nothing either way
  const y = fakeSwitches({ said: false });
  const s2 = setup({ switches: y });
  s2.write('phone~example.com/a.js', mod('A'));
  const r = await s2.roundSw({ 'example.com/a': { text: mod('A'), sw: off(5) } });
  assert.deepEqual([r.plan.switches, y.sent], [[], []]);
});

test('the approval hint, computer side: the very revision the phone allowed says so on the hold; changed code or more powers: the normal card; never approved', async () => {
  const s = setup({ switches: fakeSwitches() });
  const boxed = (powers, body = 'trif.hide(".a")') => `// ==WebMod==\n// @name Boxer\n// @match https://example.com/*\n// @boxed\n${powers.split(' ').map((p) => `// @powers ${p}\n`).join('')}// ==/WebMod==\n${body}\n`;
  const clicker = mod('Clicker', CLICKS);
  const b1 = boxed('keys');
  const phone = {
    'example.com/clicker': { text: clicker, sw: on(), ok: { rev: S.rev(clicker), tier: 'free', powers: [] } },
    'example.com/boxer': { text: b1, sw: on(), ok: { rev: S.rev(b1), tier: 'boxed', powers: ['keys'] } },
  };
  const r = await s.roundSw(phone);
  assert.equal(r.puts['example.com/clicker'].held, true, 'held as held.js decides: the hint never approves');
  let h = held.loadHeld(s.ws.home);
  assert.equal(h['phone~example.com/clicker'].allowedOn, 'Test iPhone');
  assert.equal(h['phone~example.com/clicker'].phone, 'Test iPhone');
  if (h['phone~example.com/boxer']) assert.equal(h['phone~example.com/boxer'].allowedOn, 'Test iPhone');
  // the code changed on the phone since it was allowed there: the normal card
  const c2 = mod('Clicker', `${CLICKS}\n// more`);
  phone['example.com/clicker'] = { text: c2, sw: on(), ok: { rev: S.rev(clicker), tier: 'free', powers: [] } };
  // more powers than were allowed there (a reader that sees more than the phone's did): the normal card
  const b2 = boxed('keys read-drafts', 'trif.hide(".b")');
  phone['example.com/boxer'] = { text: b2, sw: on(), ok: { rev: S.rev(b2), tier: 'boxed', powers: ['keys'] } };
  await s.roundSw(phone);
  h = held.loadHeld(s.ws.home);
  assert.ok(h['phone~example.com/clicker'], 'still waiting');
  assert.equal(h['phone~example.com/clicker'].allowedOn, undefined);
  assert.ok(h['phone~example.com/boxer'], 'read-drafts waits');
  assert.equal(h['phone~example.com/boxer'].allowedOn, undefined);
  // allowed on the phone later, the file as it is: the next sync's hint says so on the same hold
  phone['example.com/clicker'].ok = { rev: S.rev(c2), tier: 'free', powers: [] };
  await s.roundSw(phone);
  assert.equal(held.loadHeld(s.ws.home)['phone~example.com/clicker'].allowedOn, 'Test iPhone');
  // no longer allowed there (Don't allow, or a new hold): gone again
  delete phone['example.com/clicker'].ok;
  await s.roundSw(phone);
  assert.equal(held.loadHeld(s.ws.home)['phone~example.com/clicker'].allowedOn, undefined);
});

test('the approval hint, phone side: the plan names what the computer allows (not held), by revision', async () => {
  const s = setup({ switches: fakeSwitches() });
  s.write('phone~example.com/look.js', style('Look'));
  s.write('phone~example.com/clicks.js', mod('Clicks', CLICKS));
  held.updateHeld(s.ws, scanMods(s.ws.modsDir).mods, []);
  const phone = {};
  const r = await s.roundSw(phone);
  const allowed = Object.fromEntries(r.plan.allowed.map((a) => [a.id, a]));
  assert.deepEqual(allowed['example.com/look'], { id: 'example.com/look', rev: S.rev(style('Look')), tier: 'style', powers: [] });
  assert.equal(allowed['example.com/clicks'], undefined, 'held here: no hint');
  held.approveHeld(s.ws.home, 'phone~example.com/clicks');
  held.updateHeld(s.ws, scanMods(s.ws.modsDir).mods, []);
  const r2 = await s.roundSw(phone);
  assert.deepEqual(held.loadHeld(s.ws.home), {});
  assert.deepEqual(r2.plan.allowed.map((a) => [a.id, a.tier]), [['example.com/clicks', 'free'], ['example.com/look', 'style']]);
});
