'use strict';
// Powers for boxed mods (docs/POWERS.md), the helper's side: the header, the menu, the hold on the set of
// powers (not the code), trif check / trif mods. What each power gives is tested in the browsers
// (tests/e2e/scenario.js powersCheck), its registration in tests/extension.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildMod, scanMods } = require('../helper/lib/mods');
const { updateHeld, approveHeld, reviewItems } = require('../helper/lib/held');
const bp = require('../helper/lib/boxpowers');
const { sandboxLint } = require('../helper/lib/sandboxlint');
const { runCli, writeMod, tempDir } = require('./fake-extension');

const head = (powers, extra = '') => `// ==WebMod==\n// @name Beeper\n// @match https://x.com/*\n// @boxed\n${powers ? `// @powers ${powers}\n` : ''}${extra}// ==/WebMod==\n`;
const build = (code) => buildMod({ site: 'x.com', file: '/w/sites/x.com/beeper.js', code });

test('@powers: from the menu, in the menu\'s order, boxed mods only; not on the menu or not built yet: an error', () => {
  assert.deepEqual(build(head('sound, read-drafts')).mod.powers, ['read-drafts', 'sound']);
  assert.deepEqual(build(head('keys', '// @powers controls\n')).mod.powers, ['keys', 'controls']);
  assert.equal(build(head('')).mod.powers, undefined);
  assert.throws(() => build(head('fetch')), /"fetch" isn't a power/);
  // (every power on the menu is built now; the "not in this version yet" error stays for later ones)
  assert.deepEqual(bp.NAMES.filter((n) => !bp.MENU[n].built), []);
  assert.throws(() => buildMod({ site: 'x.com', file: '/w/a.js', code: '// ==WebMod==\n// @name A\n// @powers sound\n// ==/WebMod==\n' }), /powers \(@powers\) are for boxed mods/);
  // (the scanner reports it, not sent)
  const home = tempDir('trif-pw-');
  const dir = path.join(home, 'sites', 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bad.js'), head('microphone'));
  const { problems } = scanMods(path.join(home, 'sites'));
  assert.match(problems[0].error, /"microphone" isn't a power/);
});

test('the hold: a boxed mod with powers waits once for its set; the same powers in a new version don\'t ask again; a new power does', () => {
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const dir = path.join(ws.modsDir, 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  updateHeld(ws, [], []); // (first sync: nothing yet)
  const file = path.join(dir, 'beeper.js');
  const scan = () => scanMods(ws.modsDir).mods;
  // no powers: never held
  fs.writeFileSync(file, head('') + 'trif.hide("a");\n');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  // sound and read-drafts: held, with the two sentences
  fs.writeFileSync(file, head('sound, read-drafts') + 'trif.audio().tone({});\n');
  let held = updateHeld(ws, scan(), []);
  assert.deepEqual(held['x.com/beeper'].needs, ['power:read-drafts', 'power:sound']);
  assert.deepEqual(held['x.com/beeper'].facts, ['can read what you type on this site, but can\'t send it anywhere', 'can play sounds']);
  approveHeld(home, 'x.com/beeper');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  // a new version of its code, the same powers: runs
  fs.writeFileSync(file, head('read-drafts, sound') + 'trif.audio().tone({ frequency: 880 });\nconsole.log("changed");\n');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  // a new power: held for that one only
  fs.writeFileSync(file, head('read-drafts, sound, keys') + 'trif.audio().tone({});\n');
  held = updateHeld(ws, scan(), []);
  assert.deepEqual(held['x.com/beeper'].needs, ['power:keys']);
  approveHeld(home, 'x.com/beeper');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
});

test('controls don\'t hold on their own, but are listed when something else holds', () => {
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const dir = path.join(ws.modsDir, 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  updateHeld(ws, [], []);
  const file = path.join(dir, 'tuner.js');
  fs.writeFileSync(file, head('controls') + 'page.create("input");\n');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  fs.writeFileSync(file, head('controls, sound') + 'page.create("input");\n');
  const held = updateHeld(ws, scanMods(ws.modsDir).mods, []);
  assert.deepEqual(held['x.com/tuner'].facts, ['can play sounds', 'can add its own controls (sliders, pickers)']);
  // (a mod the user had before: listed to review, unless it's controls alone)
  const mods = [build(head('controls')).mod, { ...build(head('keys')).mod, id: 'x.com/keys' }];
  const review = reviewItems(home, mods, {});
  assert.deepEqual(Object.keys(review), ['x.com/keys']);
});

test('the hold sentences name the site; the menu has twelve powers', () => {
  assert.equal(bp.NAMES.length, 12);
  assert.deepEqual(bp.powerNeeds({ site: 'x.com', powers: ['sound'] }), [{ key: 'power:sound', fact: 'can play sounds', power: 'sound', soft: false, lines: [] }]);
  assert.match(bp.MENU['site-data'].hold('x.com'), /what x\.com sends this page/);
  assert.match(bp.MENU['search-box'].hold(bp.siteOf({ site: 'all-sites' })), /the sites it runs on/);
});

test('trif check: a boxed mod\'s powers and what its hold says; an unknown one is an error; the lint knows what powers give', async () => {
  const home = tempDir();
  const f = writeMod(home, 'x.com', 'beeper.js', head('sound') + 'trif.audio().tone({});\n');
  let r = await runCli(['check', f], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /with these powers, and only these \(TRIF enforces them\): sound\./);
  assert.match(r.stdout, /waits for the user's OK once for this set of powers/);
  assert.match(r.stdout, /^- it can play sounds$/m);
  r = await runCli(['check', f, '--json'], { home });
  assert.deepEqual(JSON.parse(r.stdout).powers, [{ key: 'power:sound', power: 'sound', fact: 'can play sounds', holds: true }]);
  const c = writeMod(home, 'x.com', 'tuner.js', head('controls') + 'page.create("input");\n');
  r = await runCli(['check', c], { home });
  assert.match(r.stdout, /don't make it wait for the user's OK on their own/);
  const bad = writeMod(home, 'x.com', 'bad.js', head('network'));
  r = await runCli(['check', bad], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"network" isn't a power/);
  const undeclared = writeMod(home, 'x.com', 'quiet.js', head('') + 'trif.audio().tone({});\npage.create("select");\n');
  r = await runCli(['check', undeclared], { home });
  assert.match(r.stdout, /- trif\.audio: needs the sound power/);
  assert.match(r.stdout, /- create\('select'\): needs the controls power/);
  assert.deepEqual(sandboxLint('trif.audio()', { powers: ['sound'] }), []);
});

test('trif mods: a boxed mod with powers says so', async () => {
  const home = tempDir();
  writeMod(home, 'x.com', 'beeper.js', head('sound, keys') + 'trif.audio();\n');
  const r = await runCli(['mods'], { home });
  assert.match(r.stdout, /kind: boxed mod with powers: keys, sound \(runs in TRIF's sandbox, with only TRIF's API and those powers; waits for the user's OK once for that set\)/);
});

test('registration: a boxed mod\'s powers go with its code, from the header the helper read', async () => {
  const lib = await import('../extension/lib.js');
  const s = lib.modToUserScript({ id: 'x.com/beeper', matches: ['*://x.com/*'], sandboxed: true, powers: ['sound'], code: '// @powers keys\ntrif.audio();' });
  assert.match(s.js[0].code, /__trifSandbox\.run\("x\.com\/beeper", ".*", \{"powers":\["sound"\],"args":\{\}\}\)/);
  const p = lib.modToUserScript({ id: 'x.com/beeper', matches: ['*://x.com/*'], sandboxed: true, unsandboxed: true, powers: ['sound'], code: 'x' });
  assert.match(p.js[0].code, /\('page', "x\.com\/beeper", __trifMod, \{"powers":\["sound"\],"args":\{\}\}\); \}\)\(\);/);
});

test('search-box: takes the site\'s search address, with {query}, on the mod\'s own site; it\'s in the key, so a new address asks again', () => {
  const m = build(head('search-box https://www.x.com/search?q={query}, site-data, page-data')).mod;
  assert.deepEqual(m.powers, ['site-data', 'page-data', 'search-box']);
  assert.deepEqual(m.powerArgs, { 'search-box': ['https://www.x.com/search?q={query}'] });
  assert.deepEqual(bp.powerNeeds(m).map((n) => [n.key, n.fact]), [
    ['power:site-data', 'can see and filter what x.com sends this page (posts, profiles), but can\'t send anything'],
    ['power:page-data', 'can read the data x.com keeps behind what\'s on the page'],
    ['power:search-box:https://www.x.com/search?q={query}', 'adds a search box that searches www.x.com'],
  ]);
  assert.throws(() => build(head('search-box')), /search-box takes the site's search address/);
  assert.throws(() => build(head('search-box https://evil.example/s?q={query}')), /evil\.example isn't this mod's site/);
  assert.throws(() => build(head('search-box https://x.com/search')), /needs to be an http\(s\) address with \{query\}/);
  assert.throws(() => build(head('sound loud')), /the sound power takes nothing after its name/);
});

test('go-to takes literal pages of the site (no query, # or *); click takes `@click words: selector` lines; both are in the key', () => {
  const m = build(head('go-to /home /i/bookmarks, click, media', '// @click the play button: button.play\n// @click the next page: a.next\n')).mod;
  assert.deepEqual(m.powers, ['media', 'go-to', 'click']);
  assert.deepEqual(m.powerArgs, { 'go-to': ['/home', '/i/bookmarks'], click: ['the play button: button.play', 'the next page: a.next'] });
  assert.deepEqual(bp.powerNeeds(m).map((n) => [n.key, n.fact]), [
    ['power:media', 'can play and pause video and audio on this page'],
    ['power:go-to:/home | /i/bookmarks', 'can take you to these pages on x.com: /home, /i/bookmarks, or to a link the page shows'],
    ['power:click:the next page: a.next | the play button: button.play', 'can click these for you: the play button (button.play), the next page (a.next)'],
  ]);
  // (no pages: links the page shows only)
  assert.equal(bp.powerNeeds(build(head('go-to')).mod)[0].fact, 'can take you to a link a page on x.com shows');
  assert.throws(() => build(head('go-to /search?q=x')), /isn't a page of this site/);
  assert.throws(() => build(head('go-to https://evil.example/')), /isn't a page of this site/);
  assert.throws(() => build(head('go-to /a/*')), /isn't a page of this site/);
  assert.throws(() => build(head('go-to /a/../b')), /isn't a page of this site/);
  assert.throws(() => build(head('click')), /the click power needs what it may click/);
  assert.throws(() => build(head('media', '// @click the play button: button.play\n')), /@click lines are for a mod with the click power/);
  assert.throws(() => build(head('click', '// @click button.play\n')), /say what it is, then a colon and its selector/);
  assert.throws(() => build(head('click', '// @click the field: input[value=x]\n')), /that selector isn't one TRIF takes/);
  assert.throws(() => build(head('click', '// @click the field: a\\:b\n')), /that selector isn't one TRIF takes/);
  // (a different selector asks again)
  const k = (c) => bp.powerNeeds(build(head('click', `// @click the play button: ${c}\n`)).mod)[0].key;
  assert.notEqual(k('button.play'), k('button'));
});

test('write-drafts with a read power: the combination is a need of its own, so it holds even when each was approved alone', () => {
  assert.deepEqual(bp.powerNeeds(build(head('write-drafts')).mod).map((n) => n.key), ['power:write-drafts']);
  const both = bp.powerNeeds(build(head('write-drafts, read-drafts, page-data, sound')).mod);
  assert.deepEqual(both.map((n) => n.key), ['power:read-drafts', 'power:page-data', 'power:sound', 'power:write-drafts', 'power:together:write-drafts+read-drafts+page-data']);
  assert.equal(both[4].fact, bp.TOGETHER);
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const dir = path.join(ws.modsDir, 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  updateHeld(ws, [], []);
  const file = path.join(dir, 'fixer.js');
  const scan = () => scanMods(ws.modsDir).mods;
  fs.writeFileSync(file, head('') + 'page.find("textarea");\n');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  fs.writeFileSync(file, head('write-drafts') + 'page.find("textarea");\n');
  updateHeld(ws, scan(), []);
  approveHeld(home, 'x.com/fixer');
  fs.writeFileSync(file, head('keys') + 'page.find("textarea");\n');
  updateHeld(ws, scan(), []);
  approveHeld(home, 'x.com/fixer');
  // (write-drafts and keys, each allowed before: the pair still asks)
  fs.writeFileSync(file, head('keys, write-drafts') + 'page.find("textarea");\n');
  const held = updateHeld(ws, scan(), []);
  assert.deepEqual(held['x.com/fixer'].needs, ['power:together:write-drafts+keys']);
  assert.deepEqual(held['x.com/fixer'].facts, [bp.TOGETHER]);
});

test('mods alone doesn\'t hold (like controls); the lint knows .click(), .play() and trif.goTo need their powers', () => {
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  fs.mkdirSync(path.join(ws.modsDir, 'x.com'), { recursive: true });
  updateHeld(ws, [], []);
  fs.writeFileSync(path.join(ws.modsDir, 'x.com', 'talker.js'), head('mods') + 'trif.channel("a");\n');
  assert.deepEqual(updateHeld(ws, scanMods(ws.modsDir).mods, []), {});
  const msgs = (code, powers) => sandboxLint(code, { powers }).map((p) => p.why).join('\n');
  assert.match(msgs('page.find("#b").click();', []), /click power/);
  assert.doesNotMatch(msgs('page.find("#b").click();', ['click']), /click power/);
  assert.match(msgs('page.find("video").play();', []), /media power/);
  assert.match(msgs('trif.goTo("/home");', []), /go-to power/);
  assert.match(msgs('trif.channel("x");', []), /mods power/);
  assert.match(msgs('page.find("textarea").setValue("x");', []), /write-drafts power/);
  assert.doesNotMatch(msgs('trif.goTo("/home"); trif.channel("x");', ['go-to', 'mods']), /power/);
});
