'use strict';
// Site approval (helper/lib/sitecombos.js, docs/SAFE-MODS.md "Across mods: one approval per site"): a site's boxed
// mods' powers together; a mod that adds a holding power to what the site approved asks, showing the site's lists
// with what it adds marked new, and approving it approves the site's new union; switched on, such a mod waits;
// off or deleted, nothing is asked or taken away. The sandbox (its own code, run here) lets an act through beside
// another mod's power when the site approved both, and refuses it otherwise.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, reviewItems, reviewMod, loadAllowed } = require('../helper/lib/held');
const sites = require('../helper/lib/sitecombos');
const C = require('../helper/lib/combinations');
const bp = require('../helper/lib/boxpowers');
const { tempDir } = require('./fake-extension');
const { sandboxPage } = require('./sandbox-harness');

const boxed = (name, powers, extra = '') => `// ==WebMod==\n// @name ${name}\n// @match https://x.com/*\n// @boxed\n${powers ? `// @powers ${powers}\n` : ''}${extra}// ==/WebMod==\ntrif.hide('.ad');\n`;
function home() {
  const h = tempDir('trif-site-');
  const ws = { home: h, modsDir: path.join(h, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(h, 'seen.json'), '{}\n'); // (not the first time: every mod here is new)
  return ws;
}
const write = (ws, file, code) => fs.writeFileSync(path.join(ws.modsDir, 'x.com', file), code);
const sync = (ws) => { const { mods } = scanMods(ws.modsDir); return { mods, held: updateHeld(ws, mods, []) }; };
const lines = (h) => bp.factLines(h.needs, h.facts);
const items = (r, k) => r[k].map((x) => `${x.t}${x.new ? ' (new)' : ''}`);
const CLICK = '// @click the button: #go\n';

test('a mod that adds a holding power to its site asks, with the site\'s lists (what it adds marked new); approving it approves the site\'s new union', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  let { held } = sync(ws);
  assert.deepEqual(held['x.com/reader'].needs, ['power:keys']); // (alone on its site: nothing across mods)
  approveHeld(ws.home, 'x.com/reader');
  assert.deepEqual(sites.approvedUnion(loadAllowed(ws.home), 'x.com'), []);
  write(ws, 'clicker.js', boxed('Clicker', 'click', CLICK));
  ({ held } = sync(ws));
  const h = held['x.com/clicker'];
  assert.deepEqual(h.needs, ['power:click:the button: #go', 'site:x.com:keys+click']);
  assert.deepEqual(lines(h), ['it can click these for you: the button (#go)', 'it adds to what your x.com mods can do together']);
  const r = h.reach[0];
  assert.deepEqual([r.order, r.heads], [['act', 'see', 'go'], { act: 'Your x.com mods can:', see: 'They can see:', go: 'It could end up in:' }]);
  assert.deepEqual([items(r, 'act'), items(r, 'see'), items(r, 'go'), items(r, 'flags')], [['click the button (new)'], ['the keys you press (new)'], ['clicks the site sees (new)'], ['So something they read could be sent from your account. (new)']]);
  assert.deepEqual(bp.siteLines(r), ['x.com mods can: click the button (new)', 'they can see: the keys you press (new)', 'it could end up in: clicks the site sees (new)', 'So something they read could be sent from your account. (new)']);
  assert.equal(held['x.com/reader'], undefined);
  approveHeld(ws.home, 'x.com/clicker');
  assert.deepEqual(sites.approvedUnion(loadAllowed(ws.home), 'x.com'), ['keys', 'click']);
  // (another mod adding nothing new: nothing for the site; controls and mods never ask alone, preload only beside a read)
  write(ws, 'clicker2.js', boxed('Clicker two', 'click, controls, mods', CLICK));
  ({ held } = sync(ws));
  assert.deepEqual(held['x.com/clicker2'].needs, ['power:controls', 'power:mods', 'power:click:the button: #go']);
  write(ws, 'pre.js', boxed('Sooner', 'preload'));
  ({ held } = sync(ws));
  assert.deepEqual(held['x.com/pre'].needs, ['power:preload', 'site:x.com:keys+controls+mods+preload+click']);
  // (a writer: the post-for-you flag)
  approveHeld(ws.home, 'x.com/clicker2'); approveHeld(ws.home, 'x.com/pre');
  write(ws, 'writer.js', boxed('Writer', 'write-drafts'));
  ({ held } = sync(ws));
  assert.deepEqual(items(held['x.com/writer'].reach[0], 'flags'), ['So something they read could be sent from your account.', 'So they could post for you. (new)']);
  assert.deepEqual(items(held['x.com/writer'].reach[0], 'go'), ['your posts and drafts (new)', 'clicks the site sees', 'which pictures load']);
  approveHeld(ws.home, 'x.com/writer');
  const { mods } = sync(ws);
  assert.deepEqual(sites.siteOkFor(mods.find((m) => m.id === 'x.com/clicker'), mods, loadAllowed(ws.home)), ['x.com keys+controls+mods+preload+click+write-drafts']);
});

test('a quiet power added to a site asks only when it completes a warned combination there', () => {
  const m = (id, powers) => ({ id, site: 'x.com', matches: ['*://x.com/*'], sandboxed: true, powers });
  // (sound beside a reader: read-into-sound, asks; beside a clicker: nothing warned, doesn't)
  assert.equal(sites.siteNeeds(m('x.com/s', ['sound']), [m('x.com/r', ['keys']), m('x.com/s', ['sound'])]).length, 1);
  assert.deepEqual(sites.siteNeeds(m('x.com/s', ['sound']), [m('x.com/c', ['click']), m('x.com/s', ['sound'])]), []);
  for (const q of ['controls', 'mods', 'embeds', 'media', 'preload']) assert.deepEqual(sites.siteNeeds(m('x.com/q', [q]), [m('x.com/c', ['click']), m('x.com/q', [q])]), [], q);
  // (preload, media, embeds beside a read: their warned combinations ask)
  for (const q of ['preload', 'media', 'embeds']) assert.equal(sites.siteNeeds(m('x.com/q', [q]), [m('x.com/r', ['site-data']), m('x.com/q', [q])]).length, 1, q);
  // (a power that asks, beside anything: asks)
  assert.equal(sites.siteNeeds(m('x.com/k', ['keys']), [m('x.com/c', ['controls']), m('x.com/k', ['keys'])]).length, 1);
});

test('switched on, a mod that adds a holding power to the site waits; off or deleted, nothing is asked or taken away; added again, nothing is asked', () => {
  const ws = home();
  write(ws, 'clicker.js', boxed('Clicker', 'click', CLICK));
  sync(ws); approveHeld(ws.home, 'x.com/clicker');
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker'], []);
  // the reader written while off in the browser: it asks for itself only when on; here it's written, approved, then off
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  sync(ws);
  // (its hold has the site's union: approving its own power without it isn't possible, so: off before it's approved)
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader'], ['x.com/reader']);
  let { held, mods } = sync(ws);
  assert.deepEqual(held['x.com/reader'].needs, ['power:keys', 'site:x.com:keys+click']); // (new: still asks, on or off)
  approveHeld(ws.home, 'x.com/reader');
  // (the site's approval taken back to the clicker's, as if the reader had been approved before the site's lists)
  const allowed = loadAllowed(ws.home);
  allowed['x.com/reader'].powers = allowed['x.com/reader'].powers.filter((k) => !/^site:/.test(k));
  fs.writeFileSync(path.join(ws.home, 'allowed.json'), JSON.stringify(allowed));
  ({ held } = sync(ws));
  assert.deepEqual(held, {}); // (off: nothing to ask)
  // on again: it waits, as a new mod would, with the site's lists
  const sw = sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader'], []);
  assert.deepEqual(sw.switchedOn, ['x.com/reader']);
  ({ held, mods } = sync(ws));
  assert.equal(held['x.com/reader'].by, 'switch');
  assert.deepEqual(held['x.com/reader'].needs, ['site:x.com:keys+click']);
  assert.deepEqual(items(held['x.com/reader'].reach[0], 'see'), ['the keys you press (new)']);
  approveHeld(ws.home, 'x.com/reader');
  ({ held } = sync(ws));
  assert.deepEqual(held, {});
  assert.deepEqual(sites.loadSwitched(ws.home), {});
  // off and on again: nothing; the clicker deleted: nothing, and the site keeps its approval; added again: nothing
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader'], ['x.com/reader']);
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader'], []);
  ({ held } = sync(ws));
  assert.deepEqual(held, {});
  fs.unlinkSync(path.join(ws.modsDir, 'x.com', 'clicker.js'));
  ({ held } = sync(ws));
  assert.deepEqual(held, {});
  assert.deepEqual(sites.approvedUnion(loadAllowed(ws.home), 'x.com'), ['keys', 'click']);
  write(ws, 'clicker.js', boxed('Clicker', 'click', CLICK));
  ({ held, mods } = sync(ws));
  assert.deepEqual(held, {});
  assert.deepEqual(reviewItems(ws.home, mods, held), {});
  // (a mod switched on, then off again before it's approved: no hold left)
  write(ws, 'pager.js', boxed('Pager', 'page-events app-ping'));
  sync(ws); approveHeld(ws.home, 'x.com/pager');
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader', 'x.com/pager'], ['x.com/pager']);
  const a2 = loadAllowed(ws.home);
  for (const v of Object.values(a2)) v.powers = v.powers.filter((k) => !/^site:/.test(k) || k === 'site:x.com:keys+click');
  fs.writeFileSync(path.join(ws.home, 'allowed.json'), JSON.stringify(a2));
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader', 'x.com/pager'], []);
  ({ held } = sync(ws));
  assert.deepEqual([held['x.com/pager'].by, held['x.com/pager'].needs], ['switch', ['site:x.com:keys+page-events+click']]);
  sites.saveSwitches(ws.home, 'Chrome:1', ['x.com/clicker', 'x.com/reader', 'x.com/pager'], ['x.com/pager']);
  ({ held } = sync(ws));
  assert.deepEqual(held, {});
});

test('mods the user has, from before site approvals: the site\'s union is asked once, by the newest mod with a power it adds; "Looks right" approves it', () => {
  const ws = home();
  write(ws, 'reader.js', boxed('Key Reader', 'keys'));
  write(ws, 'clicker.js', boxed('Clicker', 'click', CLICK));
  sync(ws); approveHeld(ws.home, 'x.com/reader'); approveHeld(ws.home, 'x.com/clicker');
  const allowed = loadAllowed(ws.home);
  for (const a of Object.values(allowed)) a.powers = a.powers.filter((k) => !/^site:/.test(k));
  fs.writeFileSync(path.join(ws.home, 'allowed.json'), JSON.stringify(allowed));
  fs.utimesSync(path.join(ws.modsDir, 'x.com', 'reader.js'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const { held, mods } = sync(ws);
  assert.deepEqual(held, {});
  const r = reviewItems(ws.home, mods, held);
  assert.deepEqual(Object.keys(r), ['x.com/clicker']);
  assert.deepEqual(r['x.com/clicker'].needs, ['site:x.com:keys+click']);
  reviewMod(ws.home, mods.find((m) => m.id === 'x.com/clicker'), mods);
  assert.deepEqual(reviewItems(ws.home, mods, held), {});
});

// ---- the sandbox's page-wide rules, run here (extension/sandbox.js, from ACT_PARTNERS to signalOk), on a page
// with a site's boxed mods: each other mod has done what its powers let it do to be refused beside (handed a
// picture, changed a draft and a picture, its go-to brought the user here; a channel with every mod that has mods).
function sitePage(list) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const from = src.indexOf('  const ACT_PARTNERS = pageWide.actPartners;'), to = src.indexOf('  // write-drafts and addresses');
  assert.ok(from > 0 && to > from, 'the page-wide rules in sandbox.js');
  const ctx = vm.runInNewContext(`const pageWide = ${JSON.stringify(sites.PAGE_WIDE)}; const fail = (why) => { throw new TypeError('TRIF sandbox: ' + why); }; const reported = []; const report = (mod, e) => reported.push([mod, e.message]);
const channels = new Map(), apis = new Map(), draftWriters = new Set(); const SANDBOX = false, send = null, G = {}, location = { href: '' };
${src.slice(from, to)}
({ reported, partnersOk, soundOk, clickOk, signalOk, inPlay, uploadReaders, uploadEditors, channels, apis, draftWriters, setArrived: (m) => { arrivedBy = m; } })`);
  return (actor, act, approved) => {
    ctx.apis.clear(); ctx.inPlay.clear(); ctx.uploadReaders.clear(); ctx.uploadEditors.clear(); ctx.draftWriters.clear(); ctx.channels.clear(); ctx.setArrived(null);
    const talk = [];
    for (const m of list) {
      const a = { mod: m.id, powers: new Set(m.powers), combo: new Set(sites.comboOf({ sandboxed: true, ...m })), site: new Set(approved) };
      ctx.apis.set(m.id, a);
      for (const p of a.combo) ctx.inPlay.add(p);
      if (a.powers.has('mods')) talk.push({ mod: m.id });
      if (m.id === actor) continue;
      if (a.powers.has('edit-uploads')) { ctx.uploadReaders.add(m.id); ctx.uploadEditors.add(m.id); }
      if (a.powers.has('write-drafts')) ctx.draftWriters.add(m.id);
      if (a.powers.has('go-to')) ctx.setArrived(m.id);
    }
    if (talk.length > 1) ctx.channels.set('c', new Set(talk));
    const A = ctx.apis.get(actor);
    if (act === 'click') return ctx.clickOk(A);
    if (act === 'page-events') return ctx.signalOk(A);
    if (act === 'sound') return ctx.soundOk(A);
    return ctx.partnersOk(A, act);
  };
}
const ACTS = Object.keys(sites.PAGE_WIDE.actPartners);
// (what the sandbox refuses an actor's act beside the site's other mods: its pairs)
const refused = (list, actor, act) => {
  const a = list.find((m) => m.id === actor);
  return [...new Set(list.filter((m) => m !== a).flatMap((b) => sites.refusedPairs(sites.shapeOf({ sandboxed: true, ...a }), sites.shapeOf({ sandboxed: true, ...b })).filter(([x]) => x === act).map(([x, y]) => C.keyOf([x, y]))))];
};

test('the drift test: for random sets of a site\'s mods, the sandbox refuses exactly the pairs whose powers the site hasn\'t both approved, and approving what the holds asked lets every act through', () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = () => { const n = 1 + rnd(3); const out = new Set(); while (out.size < n) out.add(C.POWERS[rnd(C.POWERS.length)]); return [...out]; };
  let refusals = 0;
  for (let i = 0; i < 250; i++) {
    const list = Array.from({ length: 2 + rnd(3) }, (_, k) => ({ id: `x.com/m${k}`, site: 'x.com', matches: ['*://x.com/*'], sandboxed: true, powers: pick(), ...(rnd(6) === 0 ? { powerArgs: { migrate: ['local:k'] } } : {}) }));
    // (the mods arrive one by one; a hold that asks for the site is approved)
    const allowed = {};
    for (let k = 0; k < list.length; k++) allowed[list[k].id] = { powers: sites.siteNeeds(list[k], list.slice(0, k + 1), { allowed }).map((n) => n.key) };
    const approved = sites.approvedUnion(allowed, 'x.com');
    const check = sitePage(list);
    for (const a of list) {
      for (const act of a.powers.filter((p) => ACTS.includes(p))) {
        const pairs = refused(list, a.id, act);
        // with nothing approved: refused exactly when there's a pair, each a warned one
        let threw = false;
        try { check(a.id, act, []); } catch (e) { threw = true; assert.match(e.message, /this site's mods together lifts it/); }
        assert.equal(threw, pairs.length > 0, `${act} of ${a.powers} beside ${list.filter((m) => m !== a).map((m) => m.powers).join(' / ')}`);
        for (const k of pairs) assert.equal(typeof C.COMBINATIONS[k], 'object', `${k} refused but not a warned pair`);
        if (!pairs.length) continue;
        refusals++;
        // approving what the holds asked: it goes through; the partner of one of its pairs not approved: refused
        for (const k of pairs) for (const p of k.split('+')) assert.ok(approved.includes(p), `${k} refused, ${p} never approved`);
        assert.doesNotThrow(() => check(a.id, act, approved), `${act} of ${a.powers}, the site's union approved`);
        for (const k of pairs) { const partner = k.split('+').find((p) => p !== act) || act; assert.throws(() => check(a.id, act, approved.filter((x) => x !== partner)), /lifts it/); }
      }
    }
  }
  assert.ok(refusals > 50, `only ${refusals} refusals tried`);
});

test('the conversion run\'s shapes: a mod with both halves beside one with one half (Skip to Sandbox and R for Random; Post Styler and Profile Styler), sound only over a channel, refusals in the mod\'s errors once', () => {
  const skip = { id: 'x.com/skip', site: 'x.com', matches: ['*://x.com/*'], sandboxed: true, powers: ['site-storage', 'page-events'] };
  const r = { id: 'x.com/r', site: 'x.com', matches: ['*://x.com/*'], sandboxed: true, powers: ['site-storage', 'go-to'] };
  const check = sitePage([skip, r]);
  assert.throws(() => check('x.com/skip', 'site-storage', []), /changing what the site keeps is off on this page while another boxed mod here has the go-to power/);
  // (R first, then Skip, which adds page-events to the site: approving it approves the site's union)
  const allowed = { 'x.com/r': { powers: sites.siteNeeds(r, [r]).map((n) => n.key) } };
  assert.deepEqual(sites.siteNeeds(skip, [r, skip], { allowed }).map((n) => n.key), ['site:x.com:site-storage+go-to+page-events']);
  allowed['x.com/skip'] = { powers: sites.siteNeeds(skip, [r, skip], { allowed }).map((n) => n.key) };
  const ok = sites.approvedUnion(allowed, 'x.com');
  assert.doesNotThrow(() => check('x.com/skip', 'site-storage', ok));
  assert.doesNotThrow(() => check('x.com/r', 'go-to', ok));
  const post = { id: 'x.com/post', sandboxed: true, powers: ['image-variants', 'page-data'] }, prof = { id: 'x.com/prof', sandboxed: true, powers: ['local-fonts', 'page-data'] };
  assert.throws(() => sitePage([post, prof])('x.com/post', 'image-variants', []), /local-fonts power/);
  assert.doesNotThrow(() => sitePage([post, prof])('x.com/post', 'image-variants', ['image-variants', 'local-fonts']));
  assert.doesNotThrow(() => sitePage([{ id: 's', powers: ['sound'] }, { id: 'k', powers: ['keys'] }])('s', 'sound', []));
  assert.throws(() => sitePage([{ id: 's', powers: ['sound', 'mods'] }, { id: 'k', powers: ['keys', 'mods'] }])('s', 'sound', []), /shares a channel/);
  // (in the mod's errors once per act, however often it's tried)
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  assert.match(src, /if \(!refusedOnce\.has\(k\)\) \{ refusedOnce\.add\(k\); report\(api\.mod, err\); \}/);
});

test('the sandbox, whole: the site\'s approved powers let the act through on that site, not on another', async () => {
  const body = [{ tag: 'button', attrs: { id: 'go', type: 'button' } }];
  const clicker = 'try { page.find("#go").click(); page.root.setAttr("data-trif-box-r", "ok"); } catch (e) { page.root.setAttr("data-trif-box-r", e.message); }';
  const click = { powers: ['click'], args: { click: ['the button: #go'] } };
  const result = (p) => p.doc.documentElement.getAttribute('data-trif-box-r');
  for (const [site, want] of [[[], /keys power.*this site's mods together lifts it/], [['x.com keys+click'], /^ok$/], [['www.x.com keys+controls+click'], /^ok$/], [['y.com keys+click'], /keys power/], [['x.com keys+page-events'], /keys power/], [['x.com click'], /keys power/]]) {
    const p = await sandboxPage({ body });
    p.run('x.com/reader', '', { powers: ['keys'], args: { site } });
    p.run('x.com/clicker', clicker, { ...click, args: { ...click.args, site } });
    await p.tick();
    assert.match(result(p), want, JSON.stringify(site));
    assert.equal(p.el('go').clicks, want.source === '^ok$' ? 1 : 0);
    if (want.source !== '^ok$') assert.equal(p.errors().filter((e) => e.mod === 'x.com/clicker').length, 1); // (logged, though the mod caught it)
  }
});
