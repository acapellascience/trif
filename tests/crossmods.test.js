'use strict';
// Cross-mod approval (helper/lib/crossmods.js, docs/SAFE-MODS.md "Across mods: the page-wide rules"): the
// combinations across two boxed mods on a site, on the newer mod's hold, keyed by both mods and the powers; asked
// again only for what a new power makes; nothing on a switch; and the sandbox lets an act through beside another
// mod's power only when that pair, with that mod, is approved (tests/sandbox-harness.js runs its own code).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, reviewItems, reviewMod, loadAllowed } = require('../helper/lib/held');
const cross = require('../helper/lib/crossmods');
const bp = require('../helper/lib/boxpowers');
const { tempDir } = require('./fake-extension');
const { sandboxPage } = require('./sandbox-harness');
const vm = require('vm');

const boxed = (name, powers, extra = '') => `// ==WebMod==\n// @name ${name}\n// @match https://x.com/*\n// @boxed\n${powers ? `// @powers ${powers}\n` : ''}${extra}// ==/WebMod==\ntrif.hide('.ad');\n`;
function home() {
  const h = tempDir('trif-cross-');
  const ws = { home: h, modsDir: path.join(h, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(h, 'seen.json'), '{}\n'); // (not the first time: every mod here is new)
  return ws;
}
const write = (ws, file, code, at) => { const f = path.join(ws.modsDir, 'x.com', file); fs.writeFileSync(f, code); if (at) fs.utimesSync(f, at, at); };
const sync = (ws) => { const { mods } = scanMods(ws.modsDir); return { mods, held: updateHeld(ws, mods, []) }; };

// The sandbox's page-wide rules, run here (extension/sandbox.js, from ACT_PARTNERS to signalOk), as a page with two
// boxed mods: a (acting) and b. b has done what its powers let it do to be refused beside: it was handed a picture
// (edit-uploads), changed a draft and a picture, its go-to brought the user here, and the two share a channel when
// both have mods. checkAct throws as the sandbox would for a's act.
function runtimePage(a, b) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const from = src.indexOf('  const ACT_PARTNERS = pageWide.actPartners;'), to = src.indexOf('  // write-drafts and addresses');
  assert.ok(from > 0 && to > from, 'the page-wide rules in sandbox.js');
  const ctx = vm.runInNewContext(`const pageWide = ${JSON.stringify(cross.PAGE_WIDE)}; const fail = (why) => { throw new TypeError('TRIF sandbox: ' + why); }; const reported = []; const report = (mod, e) => reported.push([mod, e.message]);
const channels = new Map(), apis = new Map(), draftWriters = new Set(); const SANDBOX = false, send = null, G = {}, location = { href: '' };
${src.slice(from, to)}
({ reported, partnersOk, soundOk, clickOk, signalOk, inPlay, uploadReaders, uploadEditors, channels, apis, draftWriters, setArrived: (m) => { arrivedBy = m; } })`);
  const api = (id, m, with_ = []) => ({ mod: id, powers: new Set(m.powers), combo: new Set(cross.comboOf({ sandboxed: true, ...m })), cross: new Set(with_) });
  const B = api('b', b);
  ctx.apis.set('b', B);
  for (const p of B.combo) ctx.inPlay.add(p);
  if (B.powers.has('edit-uploads')) { ctx.uploadReaders.add('b'); ctx.uploadEditors.add('b'); }
  if (B.powers.has('write-drafts')) ctx.draftWriters.add('b');
  if (B.powers.has('go-to')) ctx.setArrived('b');
  const checkAct = (act, with_) => {
    const A = api('a', a, with_);
    ctx.apis.set('a', A);
    for (const p of A.combo) ctx.inPlay.add(p);
    ctx.channels.clear();
    if (A.powers.has('mods') && B.powers.has('mods')) ctx.channels.set('c', new Set([{ mod: 'a' }, { mod: 'b' }]));
    if (act === 'click') return ctx.clickOk(A);
    if (act === 'page-events') return ctx.signalOk(A);
    if (act === 'sound') return ctx.soundOk(A);
    return ctx.partnersOk(A, act);
  };
  checkAct.reported = ctx.reported;
  return checkAct;
}
const ACTS = Object.keys(cross.PAGE_WIDE.actPartners);

test('what cross-mod approval offers is exactly what the sandbox refuses: for random pairs of mods, each act refused has its pair offered, approving it lifts the refusal, and nothing else is offered', () => {
  const C = require('../helper/lib/combinations');
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = () => { const n = 1 + rnd(4); const out = new Set(); while (out.size < n) out.add(C.POWERS[rnd(C.POWERS.length)]); return [...out]; };
  let refusals = 0;
  for (let i = 0; i < 400; i++) {
    const a = { id: 'x.com/a', sandboxed: true, powers: pick(), ...(rnd(5) === 0 ? { powerArgs: { migrate: ['local:k'] } } : {}) };
    const b = { id: 'x.com/b', sandboxed: true, powers: pick(), ...(rnd(5) === 0 ? { powerArgs: { migrate: ['local:k'] } } : {}) };
    const offered = cross.crossPairs(a, b).map((w) => w.combo);
    const withAll = offered.map((k) => `${k.split('+').sort().join('+')} b`); // (the page's ids here: a and b)
    const used = new Set();
    for (const act of a.powers.filter((p) => ACTS.includes(p))) {
      const check = runtimePage(a, b);
      let refused = false;
      try { check(act, []); } catch (e) { refused = true; assert.match(e.message, /lifts it/); }
      const mine = cross.refusedPairs({ powers: a.powers, combo: cross.comboOf(a) }, { powers: b.powers, combo: cross.comboOf(b) }).filter(([x]) => x === act).map(([x, y]) => C.keyOf([x, y]));
      assert.equal(refused, mine.length > 0, `${act}: ${a.powers} beside ${b.powers}`);
      if (!refused) continue;
      refusals++;
      for (const k of mine) { assert.ok(offered.includes(k), `${k} refused but not offered`); assert.equal(typeof C.COMBINATIONS[k], 'object', `${k} refused but not a warned pair`); used.add(k); }
      // approved (everything offered for the two): it goes through; any one of its pairs left out: refused again
      assert.doesNotThrow(() => runtimePage(a, b)(act, withAll), `${act} with the pairs approved`);
      for (const k of mine) assert.throws(() => runtimePage(a, b)(act, withAll.filter((w) => w !== `${k.split('+').sort().join('+')} b`)), /lifts it/, `${act} without ${k}`);
    }
    // (and the other way round: b's acts beside a)
    for (const act of b.powers.filter((p) => ACTS.includes(p))) {
      for (const [x, y] of cross.refusedPairs({ powers: b.powers, combo: cross.comboOf(b) }, { powers: a.powers, combo: cross.comboOf(a) })) if (x === act) used.add(C.keyOf([x, y]));
    }
    // nothing offered that isn't refused one way or the other
    for (const k of offered) assert.ok(used.has(k), `${k} offered for ${a.powers} / ${b.powers} but nothing refuses it`);
  }
  assert.ok(refusals > 50, `only ${refusals} refusals tried`);
});

test('the conversion run\'s case: a mod with both halves of a pair beside one with one half (Skip to Sandbox and R for Random)', () => {
  const skip = { id: 'x.com/skip', name: 'Skip to Sandbox', sandboxed: true, powers: ['site-storage', 'page-events'], powerArgs: { 'site-storage': ['local:a'], 'page-events': ['x-y'] } };
  const r = { id: 'x.com/r', name: 'R for Random', sandboxed: true, powers: ['site-storage', 'go-to'], powerArgs: { 'site-storage': ['local:b'] } };
  // go-to+site-storage is R's own, but Skip's site-storage writes are refused beside R's go-to: offered
  assert.deepEqual(cross.crossPairs(skip, r).map((w) => w.combo).sort(), ['go-to+page-events', 'site-storage+go-to'].sort());
  assert.throws(() => runtimePage(skip, r)('site-storage', []), /changing what the site keeps is off on this page while another boxed mod here has the go-to power/);
  assert.doesNotThrow(() => runtimePage(skip, r)('site-storage', ['go-to+site-storage b']));
  // (the needs, on whichever mod's hold: both pairs, keyed by the other mod)
  assert.deepEqual(cross.crossNeeds(skip, [skip, r]).map((n) => n.key).sort(), ['power:with:x.com/r:go-to+page-events', 'power:with:x.com/r:site-storage+go-to']);
  // (Post Styler's picture reads beside Profile Styler's local-fonts: offered, and approved, allowed)
  const post = { id: 'x.com/post', sandboxed: true, powers: ['image-variants', 'page-data'] }, prof = { id: 'x.com/prof', sandboxed: true, powers: ['local-fonts', 'page-data'] };
  assert.deepEqual(cross.crossPairs(post, prof).map((w) => w.combo), ['local-fonts+image-variants']);
  assert.throws(() => runtimePage(post, prof)('image-variants', []), /local-fonts power/);
  assert.doesNotThrow(() => runtimePage(post, prof)('image-variants', ['image-variants+local-fonts b']));
  // (sound beside a read: only offered where they share a channel, both with mods, as only then it's refused)
  assert.deepEqual(cross.crossPairs({ sandboxed: true, powers: ['sound'] }, { sandboxed: true, powers: ['keys'] }), []);
  assert.doesNotThrow(() => runtimePage({ powers: ['sound'] }, { powers: ['keys'] })('sound', []));
  assert.deepEqual(cross.crossPairs({ sandboxed: true, powers: ['sound', 'mods'] }, { sandboxed: true, powers: ['keys', 'mods'] }).map((w) => w.combo), ['keys+sound']);
  assert.throws(() => runtimePage({ powers: ['sound', 'mods'] }, { powers: ['keys', 'mods'] })('sound', []), /shares a channel/);
  // (a pair of mods says each sentence once: two pairs with one warning are one line)
  const n2 = cross.crossNeeds(skip, [skip, r]);
  assert.deepEqual(bp.factLines(n2.map((n) => n.key), n2.map((n) => n.fact), cross.namesFor(n2)), ['together with R for Random, it could take you to a page and set off that page\'s own actions there']);
  // (a refusal is in the mod's errors once per act, whatever it catches)
  const once = runtimePage(skip, r);
  for (let i = 0; i < 3; i++) assert.throws(() => once('site-storage', []));
  assert.equal(once.reported.length, 1);
  assert.match(once.reported[0][1], /^TRIF sandbox: changing what the site keeps is off/);
  // (a mod beside one that has every half itself: nothing refused, nothing offered)
  assert.deepEqual(cross.crossPairs({ sandboxed: true, powers: ['sound'] }, { sandboxed: true, powers: ['controls'] }), []);
  assert.deepEqual(cross.crossPairs({ sandboxed: true, powers: ['keys'] }, { sandboxed: true, powers: ['click'] }).map((w) => w.combo), ['keys+click']);
  const m = (id, matches) => ({ id, matches, sandboxed: true, powers: ['keys'] });
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('y.com/b', ['*://y.com/*'])), false);
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('x.com/b', ['*://*.x.com/*'])), true);
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('all-sites/b', ['*://*/*'])), true);
  assert.deepEqual(cross.comboOf({ sandboxed: true, powers: ['go-to'], powerArgs: { migrate: ['local:a'] } }), ['site-storage', 'go-to']);
  assert.deepEqual(cross.parseKey('power:with:localhost:3000/a:keys+click'), { with: 'localhost:3000/a', combo: 'keys+click' });
});

test('a new mod\'s hold carries its combinations with the boxed mod already there, in words that name it; approving records the pair for both', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  let { held } = sync(ws);
  assert.deepEqual(held['x.com/reader'].needs, ['power:keys']); // (alone: nothing across)
  approveHeld(ws.home, 'x.com/reader');
  write(ws, 'clicker.js', boxed('Clicker', 'click', '// @click the button: #go\n'));
  ({ held } = sync(ws));
  const h = held['x.com/clicker'];
  assert.deepEqual(h.needs, ['power:click:the button: #go', 'power:with:x.com/reader:keys+click']);
  assert.deepEqual(h.withNames, { 'x.com/reader': 'Key Reader' });
  assert.equal(held['x.com/reader'], undefined); // (the other mod isn't asked again)
  assert.deepEqual(bp.factLines(h.needs, h.facts, h.withNames), ['it can click these for you: the button (#go)', 'together with Key Reader, it could let what it reads decide what it clicks for you']);
  assert.deepEqual(reviewItems(ws.home, scanMods(ws.modsDir).mods, held), {}); // (and no review of the reader for it)
  approveHeld(ws.home, 'x.com/clicker');
  const allowed = loadAllowed(ws.home);
  assert.ok(allowed['x.com/clicker'].powers.includes('power:with:x.com/reader:keys+click'));
  assert.equal(cross.approved(allowed, 'x.com/reader', 'x.com/clicker', 'keys+click'), true);
  const { mods } = sync(ws);
  const byId = (id) => mods.find((m) => m.id === id);
  assert.deepEqual(cross.approvedWith(byId('x.com/clicker'), mods, allowed), ['keys+click x.com/reader']);
  assert.deepEqual(cross.approvedWith(byId('x.com/reader'), mods, allowed), ['keys+click x.com/clicker']);
  assert.deepEqual(reviewItems(ws.home, mods, {}), {});
});

test('a later version that adds a power asks again for what that power makes, not for what was approved', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  sync(ws); approveHeld(ws.home, 'x.com/reader');
  write(ws, 'clicker.js', boxed('Clicker', 'click', '// @click the button: #go\n'));
  sync(ws); approveHeld(ws.home, 'x.com/clicker');
  // the clicker gains page-events: its own power, and keys+page-events with the reader; keys+click isn't asked again
  write(ws, 'clicker.js', boxed('Clicker', 'click, page-events app-ping', '// @click the button: #go\n'));
  let { held } = sync(ws);
  assert.deepEqual(held['x.com/clicker'].needs, ['power:page-events:app-ping', 'power:with:x.com/reader:keys+page-events']);
  approveHeld(ws.home, 'x.com/clicker');
  // the reader gains site-data: with the clicker, site-data+click and site-data+page-events (its own hold carries them)
  write(ws, 'reader.js', boxed('Key Reader', 'keys, site-data'));
  ({ held } = sync(ws));
  // (the strongest first: handing what it reads to the page's code, then letting it decide clicks)
  assert.deepEqual(held['x.com/reader'].needs, ['power:site-data', 'power:with:x.com/clicker:site-data+page-events', 'power:with:x.com/clicker:site-data+click']);
  assert.equal(held['x.com/clicker'], undefined);
  // (the same version with the same powers again: nothing)
  approveHeld(ws.home, 'x.com/reader');
  write(ws, 'reader.js', boxed('Key Reader', 'keys, site-data') + '// a new version\n');
  ({ held } = sync(ws));
  assert.deepEqual(held, {});
});

test('switching a mod off needs nothing; on again, an approved pair isn\'t asked again, and one never approved is a review on the newer mod', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'), new Date(Date.now() - 60000));
  sync(ws); approveHeld(ws.home, 'x.com/reader');
  // the reader off in the one browser there: a clicker written now has nothing across
  cross.saveSwitches(ws.home, 'Chrome:1', ['x.com/reader'], ['x.com/reader']);
  write(ws, 'clicker.js', boxed('Clicker', 'click', '// @click the button: #go\n'));
  let { held, mods } = sync(ws);
  assert.deepEqual(held['x.com/clicker'].needs, ['power:click:the button: #go']);
  approveHeld(ws.home, 'x.com/clicker');
  ({ held, mods } = sync(ws));
  assert.deepEqual(reviewItems(ws.home, mods, held), {});
  // the reader on again (in one browser of two that know it): neither is held; the newer one, the clicker, reviews the pair
  cross.saveSwitches(ws.home, 'Firefox:2', ['x.com/reader', 'x.com/clicker'], []);
  ({ held, mods } = sync(ws));
  assert.deepEqual(held, {});
  const r = reviewItems(ws.home, mods, held);
  assert.deepEqual(Object.keys(r), ['x.com/clicker']);
  assert.deepEqual(r['x.com/clicker'].needs, ['power:with:x.com/reader:keys+click']);
  assert.deepEqual(r['x.com/clicker'].withNames, { 'x.com/reader': 'Key Reader' });
  // "Looks right" approves it; off and on again: nothing more
  reviewMod(ws.home, mods.find((m) => m.id === 'x.com/clicker'), mods);
  assert.deepEqual(reviewItems(ws.home, mods, held), {});
  cross.saveSwitches(ws.home, 'Firefox:2', ['x.com/reader', 'x.com/clicker'], ['x.com/reader']);
  cross.saveSwitches(ws.home, 'Firefox:2', ['x.com/reader', 'x.com/clicker'], []);
  ({ held, mods } = sync(ws));
  assert.deepEqual([held, reviewItems(ws.home, mods, held)], [{}, {}]);
  // (off: every browser that knows it has it off; a mod no browser knows is on)
  const off = cross.offFn(ws.home);
  assert.equal(off('x.com/reader'), false);
  assert.equal(off('x.com/unknown'), false);
});

test('two new mods: either hold carries the pair; approving one takes it off the other\'s', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  write(ws, 'clicker.js', boxed('Clicker', 'click', '// @click the button: #go\n'));
  let { held } = sync(ws);
  assert.deepEqual(held['x.com/reader'].needs, ['power:keys', 'power:with:x.com/clicker:keys+click']);
  assert.deepEqual(held['x.com/clicker'].needs, ['power:click:the button: #go', 'power:with:x.com/reader:keys+click']);
  approveHeld(ws.home, 'x.com/reader');
  ({ held } = sync(ws));
  assert.deepEqual(held['x.com/clicker'].needs, ['power:click:the button: #go']);
});

test('the sandbox: an act beside another mod\'s power is refused, unless that pair with that mod is approved; a third mod\'s power still refuses', async () => {
  const body = [{ tag: 'button', attrs: { id: 'go', type: 'button' } }];
  const clicker = 'try { page.find("#go").click(); page.root.setAttr("data-trif-box-r", "ok"); } catch (e) { page.root.setAttr("data-trif-box-r", e.message); }';
  const click = { powers: ['click'], args: { click: ['the button: #go'] } };
  const result = (p) => p.doc.documentElement.getAttribute('data-trif-box-r');
  // (no approval: refused, as before cross-mod approval)
  let p = await sandboxPage({ body });
  p.run('x.com/reader', '', { powers: ['keys'] });
  p.run('x.com/clicker', clicker, click);
  await p.tick();
  assert.match(result(p), /clicking for the user is off on this page while another boxed mod here has the keys power.*the user's OK for the two mods together lifts it/);
  assert.equal(p.el('go').clicks, 0);
  // (approved with the reader: it clicks)
  p = await sandboxPage({ body });
  p.run('x.com/reader', '', { powers: ['keys'], args: { with: ['keys+click x.com/clicker'] } });
  p.run('x.com/clicker', clicker, { ...click, args: { ...click.args, with: ['keys+click x.com/reader'] } });
  await p.tick();
  assert.equal(result(p), 'ok');
  assert.equal(p.el('go').clicks, 1);
  // (approved with the reader, but another mod with a read is here too: refused)
  p = await sandboxPage({ body });
  p.run('x.com/reader', '', { powers: ['keys'] });
  p.run('x.com/other', '', { powers: ['site-data'] });
  p.run('x.com/clicker', clicker, { ...click, args: { ...click.args, with: ['keys+click x.com/reader'] } });
  await p.tick();
  assert.match(result(p), /has the site-data power/);
  // (an approval for another pair, or with another mod, doesn't count)
  p = await sandboxPage({ body });
  p.run('x.com/reader', '', { powers: ['keys'] });
  p.run('x.com/clicker', clicker, { ...click, args: { ...click.args, with: ['keys+page-events x.com/reader', 'keys+click x.com/someone-else'] } });
  await p.tick();
  assert.match(result(p), /has the keys power/);
  // (a signal, the same way)
  const signaller = 'try { trif.signal("app-ping", {}); page.root.setAttr("data-trif-box-r", "ok"); } catch (e) { page.root.setAttr("data-trif-box-r", e.message); }';
  p = await sandboxPage({ body });
  p.run('x.com/reader', '', { powers: ['site-data'] });
  p.run('x.com/sig', signaller, { powers: ['page-events'], args: { 'page-events': ['app-ping'], with: ['site-data+page-events x.com/reader'] } });
  await p.tick();
  assert.equal(result(p), 'ok');
});
