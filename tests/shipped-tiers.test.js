'use strict';
// 0.3.0 ships twelve of Tim's mods as style or boxed mods, and adds Oppish (boxed). Checked here: each example's
// tier and that it checks out clean; that what each free version kept in the site's storage still reaches the
// boxed one (@migrate, or site-storage on the same keys); and the update a 0.2 workspace gets: unchanged copies
// become the new tier, an edited copy is offered it, nothing waits for the user's OK for a power (TRIF's own
// version), they're still Tim's mods, and Oppish arrives switched off.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, tempDir } = require('./fake-extension');
const { parseHeader, buildMod, scanMods } = require('../helper/lib/mods');
const { sandboxLint } = require('../helper/lib/sandboxlint');
const { parseRules } = require('../helper/lib/rules');
const S = require('../helper/lib/preinstalled');
const H = require('../helper/lib/held');

const EXAMPLES = path.join(REPO, 'examples', 'sites');
const read = (id) => fs.readFileSync(path.join(EXAMPLES, `${id}.js`), 'utf8');
const modOf = (id) => buildMod({ site: id.split('/')[0], file: path.join(EXAMPLES, `${id}.js`), code: read(id) }).mod;

// Every shipped mod's tier from 0.3.0 (the rest stay free mods).
const TIERS = {
  'www.google.com/hide-ai-in-results': 'style', 'www.google.com/hide-extra-sections': 'style', 'www.google.com/dvd-logo': 'boxed',
  'www.google.com/oppish': 'boxed', 'amazon.com/simple-home': 'boxed', 'amazon.com/simple-shopping': 'boxed',
  'x.com/follow-status': 'boxed', 'x.com/rainbow-rave': 'boxed', 'x.com/profile-styler': 'boxed', 'x.com/post-styler': 'boxed',
  'x.com/style-encoder': 'boxed', 'x.com/tune-composer': 'boxed', 'timsrobot.com/skip-to-sandbox': 'boxed',
};
const tierOf = (h) => (h.rules ? 'style' : h.sandboxed ? 'boxed' : 'free');

test('0.3.0 tiers: Tim\'s mods ship as style, boxed or free mods, each checking out clean, all still TRIF\'s and off at first', () => {
  for (const { id, on } of S.PREINSTALLED) {
    const text = read(id);
    const h = parseHeader(text);
    assert.strictEqual(tierOf(h), TIERS[id] || 'free', id);
    assert.ok(['webmods', 'trif'].includes(h.source) && /^\d+$/.test(h.version), `${id}: @source and @version`);
    assert.strictEqual(on, false, `${id} starts off`);
    if (h.rules) parseRules(text); // (throws with what's wrong)
    if (h.sandboxed) assert.deepStrictEqual(sandboxLint(text, { powers: modOf(id).powers }), [], `${id}: nothing the sandbox would refuse`);
  }
  assert.deepStrictEqual(S.PREINSTALLED.filter((p) => p.id.startsWith('www.google.com/')).map((p) => p.id),
    ['www.google.com/hide-ai-in-results', 'www.google.com/hide-extra-sections', 'www.google.com/dvd-logo', 'www.google.com/oppish']);
  assert.deepStrictEqual(modOf('www.google.com/oppish').powers || [], [], 'Oppish: no powers');
  assert.strictEqual(parseHeader(read('www.google.com/oppish')).version, '1');
});

// What each free version kept in the site's storage (localStorage unless `session:`), and how the boxed one gets it.
const KEPT = {
  'x.com/rainbow-rave': ['wmRainbow.zoom'], // (@migrate: into its TRIF setting)
  'x.com/profile-styler': ['trifProfileStyler.mine', 'trifProfileStyler.mine:someone'],
  'x.com/post-styler': ['trifProfileStyler.mine:someone'], // (its own cache of pictures read starts over: TRIF's settings)
  'x.com/style-encoder': ['trifProfileStyler.mine:someone', 'trifTuneComposer.song'],
  'x.com/tune-composer': ['trifTuneComposer.song', 'trifTuneComposer.song.unread', 'trifTuneComposer.pos'],
  'timsrobot.com/skip-to-sandbox': ['session:trif-demo-state'],
};
const covers = (pattern, key) => (pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern);

test('0.3.0 tiers: what the free versions kept in the site\'s storage reaches the boxed ones (settings carry over)', () => {
  for (const [id, keys] of Object.entries(KEPT)) {
    const m = modOf(id);
    const args = m.powerArgs || {};
    const storage = (args['site-storage'] || []).flatMap((a) => String(a).split(/\s+/));
    const migrate = args.migrate || [];
    for (const k of keys) {
      const key = k.includes(':') && /^(session|local):/.test(k) ? k : `local:${k}`;
      assert.ok(storage.some((p) => covers(p, key)) || migrate.includes(key), `${id}: ${key}`);
    }
  }
  assert.deepStrictEqual(modOf('x.com/rainbow-rave').powerArgs.migrate, ['local:wmRainbow.zoom']);
  // The rest kept nothing there (follow-status read X's twid cookie for who you are; it reads the page now).
  for (const id of Object.keys(TIERS)) {
    if (KEPT[id] || TIERS[id] === 'style' || id === 'www.google.com/oppish') continue;
    assert.deepStrictEqual(modOf(id).powerArgs?.migrate || [], [], id);
  }
});

// The last release before 0.3.0, whose shipped mods a workspace has when it updates.
const BEFORE = 'v0.2.7';
const git = (args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const hasTag = (() => { try { git(['rev-parse', '-q', '--verify', `refs/tags/${BEFORE}^{commit}`]); return true; } catch { return false; } })();
function released(id) { try { return git(['show', `${BEFORE}:examples/sites/${id}.js`]); } catch { return null; } }

test('0.3.0 tiers: a 0.2 workspace\'s update: unchanged copies become the new tier, an edited one is offered it, nothing waits for a power, Oppish arrives off',
  { skip: !hasTag && `no git tag ${BEFORE}` }, () => {
    const root = tempDir();
    // The examples as the release before shipped them (Oppish wasn't one), with this checkout's history.
    const old = path.join(root, 'old', 'sites');
    for (const { id } of S.PREINSTALLED) {
      const code = released(id);
      if (!code) continue;
      fs.mkdirSync(path.dirname(path.join(old, id)), { recursive: true });
      fs.writeFileSync(path.join(old, `${id}.js`), code);
    }
    fs.copyFileSync(path.join(REPO, 'examples', 'shipped-history.json'), path.join(root, 'old', 'shipped-history.json'));
    assert.ok(!fs.existsSync(path.join(old, 'www.google.com', 'oppish.js')));
    const home = path.join(root, 'ws');
    fs.mkdirSync(home);
    const ws = { home, modsDir: path.join(home, 'sites') };
    S.preinstallMods(home, ws.modsDir, old, S.PREINSTALLED, S.SITES_ON, { add: 'all' });
    S.updateShippedMods(home, ws.modsDir, old);
    H.updateHeld(ws, scanMods(ws.modsDir).mods, []); // (what the user had, as TRIF first saw it)
    // The user changed their Post Styler.
    const EDITED = 'x.com/post-styler';
    fs.appendFileSync(path.join(ws.modsDir, `${EDITED}.js`), '\n// mine\n');

    // The update: setup with the new examples.
    const pre = S.preinstallMods(home, ws.modsDir, EXAMPLES);
    const up = S.updateShippedMods(home, ws.modsDir, EXAMPLES);
    assert.deepStrictEqual(pre.added, ['www.google.com/oppish'], 'Oppish arrives for those who have Google\'s mods');
    assert.deepStrictEqual(pre.on, []);
    const st = S.loadPreinstalled(home);
    assert.ok(st.startOff.includes('www.google.com/oppish'), 'switched off by each browser when it first sees it');
    const changed = Object.keys(TIERS).filter((id) => id !== 'www.google.com/oppish');
    assert.deepStrictEqual(up.updated.map((u) => u.id).sort(), [...changed.filter((id) => id !== EDITED), 'x.com/space-shooter'].sort());
    assert.deepStrictEqual(up.waiting, [{ id: EDITED, version: parseHeader(read(EDITED)).version }]);
    for (const id of changed.filter((x) => x !== EDITED)) {
      assert.strictEqual(fs.readFileSync(path.join(ws.modsDir, `${id}.js`), 'utf8'), read(id), `${id}: the new version`);
      assert.strictEqual(fs.readFileSync(S.baseFile(home, id), 'utf8'), read(id), `${id}: its base, for held.js`);
      assert.ok(st.shipped[id].auto, `${id}: stamped, so each browser switches it off once, as any update TRIF puts in place`);
    }
    // The edited copy stays the free mod it was, with the boxed one waiting beside it.
    assert.match(fs.readFileSync(path.join(ws.modsDir, `${EDITED}.js`), 'utf8'), /\/\/ mine\n$/);
    assert.strictEqual(tierOf(parseHeader(fs.readFileSync(path.join(ws.modsDir, `${EDITED}.js`), 'utf8'))), 'free');
    assert.strictEqual(fs.readFileSync(S.newFile(home, EDITED), 'utf8'), read(EDITED));
    assert.deepStrictEqual(Object.keys(S.pendingUpdates(home, scanMods(ws.modsDir).mods)), [EDITED]);

    // Nothing TRIF shipped waits for the user's OK for a power: its shipped version is what's allowed. (Where
    // several boxed mods run on one site, what they can do together is the site's to approve: sitecombos.js.)
    const mods = scanMods(ws.modsDir).mods;
    const held = H.updateHeld(ws, mods, []);
    for (const [id, h] of Object.entries(held)) assert.ok(h.needs.every((k) => k.startsWith('site:')), `${id}: ${h.needs}`);
    assert.deepStrictEqual(S.changedShipped(EXAMPLES, mods.filter((m) => m.id !== EDITED)), {}, 'still Tim\'s mods (the panel says so)');
    // Using the new version makes the edited one boxed too, also without a hold for its powers.
    S.useNewVersion(ws, EDITED);
    assert.strictEqual(fs.readFileSync(path.join(ws.modsDir, `${EDITED}.js`), 'utf8'), read(EDITED));
    const again = H.updateHeld(ws, scanMods(ws.modsDir).mods, []);
    for (const [id, h] of Object.entries(again)) assert.ok(h.needs.every((k) => k.startsWith('site:')), `${id}: ${h.needs}`);
  });
