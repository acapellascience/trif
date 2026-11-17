'use strict';
// Phone sync end to end (docs/PHONE-SYNC.md section 12): a stand-in phone (tests/phone-link-client.js, its
// `sync`) against the real helper, helper/host.js run as a browser runs it, in a temp workspace, with a fake
// extension as the side panel, a fake keychain, a stand-in dns-sd, the listener on 127.0.0.1 alone at a port the
// system picks, and the stand-in agent (tests/phone-link-agent.js: no model) for a phone run. The story:
//   - the first sync joins the two sets: the phone's mods into the computer's phone twin, the twin's to the phone;
//     a mod that can act waits for the user's OK on the computer, its hold naming the phone, in the side panel's
//     mods message; a style mod runs at once; an every-site mod and bad ids stay out, touching nothing;
//   - the sync's own writes nudge nobody; a desktop edit of a twin nudges the phone, which takes it; a phone edit
//     comes over, the version before in the computer's history;
//   - both sides change one mod (the computer's change lands between the plan and the put: `changed`); the next
//     sync keeps both, the computer's beside it as "(from your computer)", on both devices, and the panel says so;
//   - deletes both ways go to a trash: the phone's to the computer's trash/, the panel's to the phone's;
//   - a twin with a run working is left for later; refusals (not a mod, too big, an id the plan didn't ask for,
//     a stale sync, two begins in a second, a twin that's a link); a second phone has a base of its own;
//   - the panel's switch off: every sync.* is `off`, nothing is written, a twin's change nudges nobody.
// What must hold throughout: nothing outside sites/phone~*/ in the mods folder changes, and nothing is written
// outside the workspace's own folders.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, tempDir, waitFor } = require('./fake-extension');
const { standInAgent } = require('./phone-link-agent');
const { makeFakeKeychain } = require('./fake-keychain');
const { makeStandIn } = require('./fake-dns-sd');
const { PhoneClient } = require('./phone-link-client');
const { generateKeyPair, keyId } = require('../helper/lib/phonelink/noise');

const { home, go } = standInAgent('wm-pse-');
const extra = tempDir('wm-psex-');
const priv = `${home}-private`;
const sites = path.join(home, 'sites');
const chain = makeFakeKeychain(path.join(extra, 'keychain'));
const standIn = makeStandIn(path.join(extra, 'bin'));
const env = { ...chain.env, TRIF_DNS_SD: standIn.bin, TRIF_AGENT_KILL_GRACE_MS: '300' };
const phones = [];
let ext = null;

let asked = 0;
async function panel(cmd, args = {}) {
  const id = `p${++asked}`;
  ext.send({ type: 'request', id, cmd, args });
  const r = await ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
function everyFile(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) everyFile(p, out);
    else if (d.isFile()) out.push([p, fs.readFileSync(p, 'utf8')]);
  }
  return out;
}
/** The mods folder outside the phone twins: relative path → text. */
function desktop() {
  const out = {};
  for (const [p, text] of everyFile(sites)) { const rel = path.relative(sites, p); if (!rel.startsWith('phone~')) out[rel] = text; }
  return out;
}
const file = (rel) => path.join(sites, rel);
const read = (rel) => fs.readFileSync(file(rel), 'utf8');
const put = (rel, text) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), text); };
const qrOf = (qr) => { const u = new URL(qr); return { key: Buffer.from(u.searchParams.get('k'), 'base64url'), secret: u.searchParams.get('s') }; };
const HELLO = { t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mod = (name, body = 'document.body.style.color = "red"') => `// ==WebMod==\n// @name ${name}\n// ==/WebMod==\n${body}\n`;
const style = (name, css = '#ad') => `// ==WebMod==\n// @name ${name}\n// @match https://example.com/*\n// @style\n// ==/WebMod==\n{ "hide": ["${css}"] }\n`;
const CLICKS = 'document.querySelector("button").click()';

// (one sync.begin a second per phone: each sync waits for its turn)
const lastBegin = new Map();
async function sync(phone, mods, opts) {
  const wait = (lastBegin.get(phone) || 0) + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastBegin.set(phone, Date.now());
  const r = await phone.sync(mods, opts);
  assert.equal(r.plan.t, 'sync.plan', JSON.stringify(r.plan));
  assert.equal(r.done && r.done.t, 'sync.done', JSON.stringify(r.done));
  return r;
}
const nudges = (phone) => { const n = phone.kept.filter((m) => m.t === 'sync.changed').length; phone.kept = phone.kept.filter((m) => m.t !== 'sync.changed'); return n; };
const noNudge = (phone, ms) => assert.rejects(phone.next((m) => m.t === 'sync.changed', { timeout: ms }), /no such message/);
const nudged = (phone) => phone.next((m) => m.t === 'sync.changed', { timeout: 10000 });
const syncedOf = async (id) => (await panel('phone.status')).phones.find((p) => p.id === id).synced;

test.after(async () => {
  for (const p of phones) { try { await p.close(); } catch { /* closed */ } }
  if (ext) { try { await ext.close(); } catch { /* gone */ } }
  for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const dir of [home, priv, extra]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
});

test('phone sync end to end: join, edits both ways, a conflict, deletes both ways, held, later, refusals, off', async () => {
  // The user's desktop mods, and a phone twin mod made on the computer.
  put('x.com/mine.js', mod('Mine'));
  put('example.com/desk-site.js', mod('A desktop mod of the same site'));
  put('all-sites/dark.js', mod('Dark'));
  put('phone~example.com/desk.js', mod('Desk'));
  const desktopBefore = desktop();

  ext = new FakeExtension({ home, env });
  await ext.waitForSocket();
  ext.hello();
  await panel('phone.on');
  const window = await panel('phone.pair.start');
  const { key: computerKey, secret } = qrOf(window.qr);
  const port = window.port;
  const keysA = generateKeyPair();
  const idA = keyId(keysA.publicKey);
  const A = await PhoneClient.connect({ port, computerKey, keys: keysA, name: 'Tim\'s iPhone', pair: secret });
  phones.push(A);
  assert.equal((await A.request(HELLO)).t, 'hello');
  assert.equal((await panel('phone.status')).sync, true, 'on for a paired phone (D11)');
  assert.equal(await syncedOf(idA), null, 'not synced yet');

  // ---- The first sync joins the two sets.
  const onPhone = {
    'example.com/no-ads': style('No ads'),
    'example.com/clicker': mod('Clicker', CLICKS),
    'example.com/plain': mod('Plain'),
    'all-sites/every': mod('Every site'),
  };
  const bad = ['../../etc/passwd', 'example.com/../../x', 'phone~example.com/a', 'x.com/a/b', 'EXAMPLE.COM/a', 'example.com/.hidden', 'example.com/a\u0000'];
  lastBegin.set(A, Date.now());
  const s1 = await A.request({ t: 'sync.begin', mods: [...Object.entries(onPhone).map(([id, t]) => ({ id, rev: PhoneClient.rev(t) })), ...bad.map((id) => ({ id, rev: PhoneClient.rev('x') }))] });
  assert.equal(s1.t, 'sync.plan', JSON.stringify(s1));
  for (const id of bad) assert.ok(s1.skipped.some((s) => s.id === id || s.id === id.slice(0, 400)), `${JSON.stringify(id)} skipped`);
  assert.ok(s1.skipped.some((s) => s.id === 'all-sites/every' && /every-site/.test(s.why)), JSON.stringify(s1.skipped));
  assert.deepEqual(s1.want.map((w) => w.id).sort(), ['example.com/clicker', 'example.com/no-ads', 'example.com/plain']);
  assert.deepEqual(s1.give.map((g) => g.id), ['example.com/desk']);
  assert.deepEqual([s1.remove, s1.later], [[], []]);
  // (that sync is ended by the next begin: the stand-in's own sync below, a second later)
  const r1 = await sync(A, onPhone);
  assert.deepEqual(Object.values(r1.puts).map((p) => [p.t, p.mod, p.held]).sort(), [['ok', 'example.com/clicker', true], ['ok', 'example.com/no-ads', false], ['ok', 'example.com/plain', false]]);
  assert.equal(onPhone['example.com/desk'], mod('Desk'), 'the twin\'s mod is on the phone');
  for (const id of ['no-ads', 'clicker', 'plain']) assert.equal(read(`phone~example.com/${id}.js`), onPhone[`example.com/${id}`]);
  assert.equal(fs.existsSync(file('phone~all-sites')), false, 'every-site mods stay on the phone (D10)');
  assert.deepEqual(r1.done.waiting, [{ id: 'example.com/clicker', name: 'Clicker' }]);
  assert.deepEqual(r1.done.conflicts, []);
  // The side panel: the clicker waits for the user's OK, from the phone; the style mod and the plain one don't.
  const mods1 = await ext.nextMods((ms) => ms.some((m) => m.id === 'phone~example.com/clicker' && m.held)
    && ['no-ads', 'plain'].every((n) => ms.some((m) => m.id === `phone~example.com/${n}`)));
  const clicker = mods1.find((m) => m.id === 'phone~example.com/clicker');
  assert.deepEqual([clicker.held.by, clicker.held.phone], ['outside', 'Tim\'s iPhone']);
  for (const id of ['phone~example.com/no-ads', 'phone~example.com/plain']) {
    const m = mods1.find((x) => x.id === id);
    assert.ok(m && !m.held && !m.pending, `${id} runs at once: ${JSON.stringify(m && (m.held || m.pending))}`);
  }
  const line1 = await syncedOf(idA);
  assert.deepEqual([line1.fromPhone, line1.toPhone, line1.waiting, line1.conflicts], [3, 1, 1, []]);
  assert.equal(typeof line1.at, 'number');
  // The sync's own writes nudge nobody; and the next sync has nothing to do.
  await noNudge(A, 3000);
  const r2 = await sync(A, onPhone);
  assert.deepEqual([r2.plan.want, r2.plan.give, r2.plan.remove], [[], [], []]);

  // ---- A desktop edit of the twin (as the phone view's chat or code card makes one): the phone is nudged and
  // takes it. A phone edit comes over, the version before in the computer's history.
  nudges(A);
  put('phone~example.com/desk.js', mod('Desk', 'document.body.style.color = "blue"'));
  assert.deepEqual(await nudged(A), { t: 'sync.changed' });
  onPhone['example.com/plain'] = mod('Plain', 'document.body.style.color = "green"');
  onPhone['example.com/no-ads'] = style('No ads', '#ad, .promo');
  const r3 = await sync(A, onPhone);
  assert.deepEqual(r3.plan.give.map((g) => g.id), ['example.com/desk']);
  assert.deepEqual(r3.plan.want.map((w) => w.id).sort(), ['example.com/no-ads', 'example.com/plain']);
  assert.equal(onPhone['example.com/desk'], read('phone~example.com/desk.js'));
  assert.equal(read('phone~example.com/plain.js'), onPhone['example.com/plain']);
  assert.equal(r3.puts['example.com/no-ads'].held, false, 'a style change applies at once');
  const hist = path.join(home, 'history', 'phone~example.com');
  const kept = fs.readdirSync(hist).filter((n) => /^plain@.*\.js$/.test(n));
  assert.deepEqual(kept.map((n) => fs.readFileSync(path.join(hist, n), 'utf8')), [mod('Plain')], 'the version before the phone\'s, in the history');
  assert.equal(fs.readFileSync(path.join(hist, kept[0].replace(/\.js$/, '.source')), 'utf8'), 'phone');

  // ---- Both sides change the desk mod; the computer's change lands between the plan and the put.
  onPhone['example.com/desk'] = mod('Desk', 'document.body.style.color = "phone"');
  const COMPUTER = mod('Desk', 'document.body.style.color = "computer"');
  const r4 = await sync(A, onPhone, { beforePuts: () => put('phone~example.com/desk.js', COMPUTER) });
  assert.deepEqual([r4.puts['example.com/desk'].t, r4.puts['example.com/desk'].code], ['error', 'changed']);
  assert.equal(read('phone~example.com/desk.js'), COMPUTER, 'nothing written over the computer\'s change');
  await nudged(A);
  const r5 = await sync(A, onPhone);
  assert.deepEqual(r5.plan.want, [{ id: 'example.com/desk', conflict: true }]);
  assert.deepEqual(r5.plan.give, [{ id: 'example.com/desk-from-computer', rev: PhoneClient.rev(COMPUTER.replace('@name Desk', '@name Desk (from your computer)')), conflict: 'example.com/desk' }]);
  assert.deepEqual(r5.done.conflicts, [{ id: 'example.com/desk', sibling: 'example.com/desk-from-computer' }]);
  assert.equal(read('phone~example.com/desk.js'), onPhone['example.com/desk'], 'the phone\'s keeps the name (D5)');
  assert.equal(read('phone~example.com/desk-from-computer.js'), onPhone['example.com/desk-from-computer'], 'both devices have both');
  assert.match(onPhone['example.com/desk-from-computer'], /^\/\/ @name Desk \(from your computer\)$/m);
  assert.deepEqual((await syncedOf(idA)).conflicts, ['Desk']);
  const r6 = await sync(A, onPhone);
  assert.deepEqual([r6.plan.want, r6.plan.give, r6.plan.remove], [[], [], []], 'in sync after the conflict');

  // ---- Deletes both ways, each to a trash.
  const plainText = onPhone['example.com/plain'];
  delete onPhone['example.com/plain'];
  const r7 = await sync(A, onPhone);
  assert.deepEqual([r7.plan.want, r7.plan.give, r7.plan.remove], [[], [], []]);
  assert.equal(fs.existsSync(file('phone~example.com/plain.js')), false);
  const trashed = path.join(home, 'trash', 'phone~example.com');
  assert.deepEqual(fs.readdirSync(trashed).filter((n) => /^plain@.*\.js$/.test(n)).map((n) => fs.readFileSync(path.join(trashed, n), 'utf8')), [plainText]);
  nudges(A);
  await panel('mod.delete', { id: 'phone~example.com/desk-from-computer', scope: 'phone~example.com' });
  await nudged(A);
  const sibling = onPhone['example.com/desk-from-computer'];
  const r8 = await sync(A, onPhone);
  assert.deepEqual(r8.plan.remove, ['example.com/desk-from-computer']);
  assert.equal(A.trash['example.com/desk-from-computer'], sibling, 'to the phone\'s Recently deleted');
  assert.equal('example.com/desk-from-computer' in onPhone, false);

  // ---- A twin with a run working is left for later: a phone run on example.com, paused.
  A.onTool = () => ({ text: 'not asked in this test', error: true });
  const started = await A.request({ t: 'run.start', url: 'https://example.com/', page: '<main></main>', chat: 'c1', prompt: 'PAUSE:sync a bar' });
  assert.equal(started.t, 'run.started', JSON.stringify(started));
  await A.next((m) => m.t === 'run.event' && m.runId === started.runId && /Working/.test(JSON.stringify(m.event)), { timeout: 30000 });
  onPhone['example.com/no-ads'] = style('No ads', '#ad, .promo, .banner');
  const r9 = await sync(A, onPhone);
  assert.deepEqual(r9.plan.later.sort(), ['example.com/clicker', 'example.com/desk', 'example.com/no-ads']);
  assert.deepEqual([r9.plan.want, r9.plan.give], [[], []]);
  assert.equal(read('phone~example.com/no-ads.js'), style('No ads', '#ad, .promo'), 'not written while the run works');
  go('sync');
  await A.next((m) => m.t === 'run.event' && m.runId === started.runId && m.event.kind === 'done', { timeout: 30000 });
  const r10 = await waitFor(async () => { const r = await sync(A, onPhone); return r.plan.later.length ? null : r; }, { timeout: 20000, interval: 0, message: 'the twin to be free' });
  assert.deepEqual(r10.plan.want, [{ id: 'example.com/no-ads' }]);
  assert.equal(read('phone~example.com/no-ads.js'), onPhone['example.com/no-ads']);

  // ---- Refusals. Not a mod, too big: nothing written, and the base doesn't move (asked again next time).
  onPhone['example.com/words'] = 'just some words';
  onPhone['example.com/huge'] = mod('Huge', `// ${'x'.repeat(1024 * 1024)}`);
  const r11 = await sync(A, onPhone);
  assert.deepEqual([r11.puts['example.com/words'].t, r11.puts['example.com/words'].code], ['error', 'bad-mod']);
  assert.deepEqual([r11.puts['example.com/huge'].t, r11.puts['example.com/huge'].code], ['error', 'too-big']);
  for (const n of ['words', 'huge']) assert.equal(fs.existsSync(file(`phone~example.com/${n}.js`)), false);
  delete onPhone['example.com/words'];
  delete onPhone['example.com/huge'];
  // An id the plan didn't ask for or give; a stale sync; two begins in a second.
  await sleep(1100);
  lastBegin.set(A, Date.now());
  const plan = await A.request({ t: 'sync.begin', mods: Object.entries(onPhone).map(([id, t]) => ({ id, rev: PhoneClient.rev(t) })) });
  assert.equal(plan.t, 'sync.plan');
  assert.equal((await A.request({ t: 'sync.put', syncId: plan.syncId, mod: 'x.com/mine', code: mod('Not yours') })).code, 'bad-mod');
  assert.equal((await A.request({ t: 'sync.get', syncId: plan.syncId, mod: 'example.com/desk' })).code, 'bad-mod');
  assert.equal((await A.request({ t: 'sync.begin', mods: [] })).code, 'busy');
  assert.equal((await A.request({ t: 'sync.end', syncId: plan.syncId, have: [] })).t, 'sync.done');
  assert.equal((await A.request({ t: 'sync.put', syncId: plan.syncId, mod: 'example.com/desk', code: mod('Late') })).code, 'no-sync');
  // A twin that's a link elsewhere: left alone, nothing written where it leads.
  const elsewhere = path.join(extra, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, file('phone~evil.example'));
  onPhone['evil.example/a'] = mod('A');
  const r12 = await sync(A, onPhone);
  assert.ok(r12.plan.skipped.some((s) => s.id === 'evil.example/a'), JSON.stringify(r12.plan.skipped));
  assert.deepEqual(r12.plan.want, []);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.unlinkSync(file('phone~evil.example'));
  delete onPhone['evil.example/a'];

  // ---- A second phone has a base of its own: its first sync joins (it gets every twin mod; nothing removed).
  const window2 = await panel('phone.pair.start');
  const B = await PhoneClient.connect({ port: window2.port, computerKey, keys: generateKeyPair(), name: 'Phone B', pair: qrOf(window2.qr).secret });
  phones.push(B);
  await B.request(HELLO);
  const onB = {};
  const rB = await sync(B, onB);
  assert.deepEqual(rB.plan.remove, []);
  assert.deepEqual(Object.keys(onB).sort(), ['example.com/clicker', 'example.com/desk', 'example.com/no-ads']);
  for (const id of Object.keys(onB)) assert.equal(onB[id], onPhone[id]);

  // ---- Off in the panel: every sync.* refused, nothing written, a twin's change nudges nobody. On again.
  assert.equal((await panel('phone.sync', { on: false })).sync, false);
  await sleep(1100);
  onPhone['example.com/no-ads'] = style('No ads', '#off');
  const off = await A.request({ t: 'sync.begin', mods: Object.entries(onPhone).map(([id, t]) => ({ id, rev: PhoneClient.rev(t) })) });
  assert.deepEqual([off.t, off.code], ['error', 'off']);
  assert.equal((await A.request({ t: 'sync.put', syncId: plan.syncId, mod: 'example.com/no-ads', code: onPhone['example.com/no-ads'] })).code, 'off');
  nudges(A);
  put('phone~example.com/desk.js', mod('Desk', 'document.body.style.color = "off"'));
  await noNudge(A, 3000);
  assert.equal(read('phone~example.com/no-ads.js'), style('No ads', '#ad, .promo, .banner'));
  assert.equal((await panel('phone.sync', { on: true })).sync, true);
  lastBegin.set(A, Date.now());
  const r13 = await sync(A, onPhone);
  assert.deepEqual(r13.plan.want, [{ id: 'example.com/no-ads' }]);
  assert.deepEqual(r13.plan.give.map((g) => g.id), ['example.com/desk']);

  // Throughout: the desktop mods are as they were, and nothing landed outside the workspace's folders.
  assert.deepEqual(desktop(), desktopBefore);
  assert.deepEqual(fs.readdirSync(extra).sort(), ['bin', 'elsewhere', 'keychain']);
});
