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

test('the combinations across two mods: of their powers together, those neither has alone', () => {
  assert.deepEqual(cross.crossWarnings(['keys'], ['click']).map((w) => w.combo), ['keys+click']);
  // (a pair within one mod is that mod's own hold's; a triple across both is the pair's and the triple's)
  assert.deepEqual(cross.crossWarnings(['keys', 'click'], ['click']).map((w) => w.combo), []);
  assert.deepEqual(cross.crossWarnings(['keys', 'write-drafts'], ['click']).map((w) => w.combo).sort(), ['click+write-drafts', 'keys+click', 'keys+click+write-drafts'].sort());
  assert.deepEqual(cross.crossWarnings(['sound'], ['controls']), []);
  // (@migrate is site-storage, as everywhere)
  assert.deepEqual(cross.comboOf({ sandboxed: true, powers: ['go-to'], powerArgs: { migrate: ['local:a'] } }), ['site-storage', 'go-to']);
  assert.equal(cross.keyFor('x.com/a', 'keys+click'), 'power:with:x.com/a:keys+click');
  assert.deepEqual(cross.parseKey('power:with:localhost:3000/a:keys+click'), { with: 'localhost:3000/a', combo: 'keys+click' });
  // (mods on different sites aren't peers; one that runs everywhere is everyone's)
  const m = (id, matches) => ({ id, matches, sandboxed: true, powers: ['keys'] });
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('y.com/b', ['*://y.com/*'])), false);
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('x.com/b', ['*://*.x.com/*'])), true);
  assert.equal(cross.sharesSite(m('x.com/a', ['*://x.com/*']), m('all-sites/b', ['*://*/*'])), true);
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
