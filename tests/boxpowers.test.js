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
  assert.deepEqual(held['x.com/beeper'].needs, ['power:read-drafts', 'power:sound', 'power:together:read-drafts+sound']);
  assert.deepEqual(held['x.com/beeper'].facts, ['can read what you type on this site, but can\'t send it anywhere', 'can play sounds', 'could turn what it reads into sounds that a device nearby could pick up']);
  approveHeld(home, 'x.com/beeper');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  // a new version of its code, the same powers: runs
  fs.writeFileSync(file, head('read-drafts, sound') + 'trif.audio().tone({ frequency: 880 });\nconsole.log("changed");\n');
  assert.deepEqual(updateHeld(ws, scan(), []), {});
  // a new power: held for that one only
  fs.writeFileSync(file, head('read-drafts, sound, keys') + 'trif.audio().tone({});\n');
  held = updateHeld(ws, scan(), []);
  assert.deepEqual(held['x.com/beeper'].needs, ['power:keys', 'power:together:keys+sound']);
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

test('the hold sentences name the site; the menu has 21 powers (twelve, and nine in 0.3)', () => {
  assert.equal(bp.NAMES.length, 21);
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
    ['power:together:go-to+click', 'could take you to a page and click things there for you'],
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

test('combinations: each warned one a mod has is a need of its own, the strongest first; approving a pair doesn\'t cover a triple; more than three powers: one general warning', () => {
  const keys = (p) => bp.powerNeeds(build(head(p, p.includes('click') ? '// @click the send button: button.send\n' : '')).mod).filter((n) => n.power === 'together').map((n) => [n.key, n.fact]);
  assert.deepEqual(keys('write-drafts'), []);
  assert.deepEqual(keys('write-drafts, keys'), [['power:together:keys+write-drafts', 'could put what it reads into something you post']]);
  assert.deepEqual(keys('read-drafts, click, write-drafts'), [
    ['power:together:read-drafts+click+write-drafts', 'could put what it reads into a post and send it for you'],
    ['power:together:click+write-drafts', 'could write a post and send it for you'],
    ['power:together:read-drafts+write-drafts', 'could put what it reads into something you post'],
    ['power:together:read-drafts+click', 'could let what it reads decide what it clicks for you'],
  ]);
  // (two reads and write-drafts: two needs, one line on the hold)
  const two = bp.powerNeeds(build(head('keys, read-drafts, write-drafts')).mod);
  assert.deepEqual(bp.factLines(two.map((n) => n.key), two.map((n) => n.fact)).filter((l) => /^together/.test(l)), ['together, it could put what it reads into something you post']);
  // (four powers: the general warning, keyed by the set; the combinations still needs, without lines)
  const many = bp.powerNeeds(build(head('read-drafts, sound, media, write-drafts')).mod).filter((n) => n.power === 'together');
  assert.deepEqual(many[0], { key: 'power:together:many:read-drafts+sound+media+write-drafts', fact: 'Mods with many powers can act in unspecific or powerful ways. Treat this with caution.', power: 'together', soft: false, lines: [] });
  assert.deepEqual(many.slice(1).map((n) => [n.key, n.fact]), [['power:together:read-drafts+write-drafts', ''], ['power:together:read-drafts+media', ''], ['power:together:read-drafts+sound', '']]);
  assert.equal(bp.factLine(many[0].key, many[0].fact), 'Mods with many powers can act in unspecific or powerful ways. Treat this with caution.');
  // the hold: write-drafts and keys each allowed alone, then the pair asks; the pair allowed, adding click asks for the triple
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const dir = path.join(ws.modsDir, 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  updateHeld(ws, [], []);
  const file = path.join(dir, 'fixer.js');
  const scan = () => scanMods(ws.modsDir).mods;
  const step = (p, extra = '') => { fs.writeFileSync(file, head(p, extra) + 'page.find("textarea");\n'); return updateHeld(ws, scan(), [])['x.com/fixer']; };
  assert.equal(step(''), undefined);
  step('write-drafts'); approveHeld(home, 'x.com/fixer');
  step('keys'); approveHeld(home, 'x.com/fixer');
  let held = step('keys, write-drafts');
  assert.deepEqual(held.needs, ['power:together:keys+write-drafts']);
  assert.deepEqual(held.facts, ['could put what it reads into something you post']);
  approveHeld(home, 'x.com/fixer');
  held = step('keys, write-drafts, click', '// @click the send button: button.send\n');
  assert.deepEqual(held.needs, ['power:click:the send button: button.send', 'power:together:keys+click+write-drafts', 'power:together:click+write-drafts', 'power:together:keys+click']);
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

test('a free mod whose header says risk 2 doesn\'t break the hold (its risk2 need has no lines)', () => {
  const home = tempDir('trif-pw-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const dir = path.join(ws.modsDir, 'x.com');
  fs.mkdirSync(dir, { recursive: true });
  updateHeld(ws, [], []);
  fs.writeFileSync(path.join(dir, 'reorder.js'), '// ==WebMod==\n// @name Reorder\n// @match *://x.com/*\n// @risk 2 changes the sort order\n// ==/WebMod==\ndocument.title = "x";\n');
  const mods = scanMods(ws.modsDir).mods;
  assert.doesNotThrow(() => updateHeld(ws, mods, []));
});

test('0.3\'s powers (WIDEN.md class B): their header values, checked; their hold sentences; @migrate a need of its own', () => {
  const facts = (p, extra) => bp.powerNeeds(build(head(p, extra)).mod).filter((n) => !/^power:together/.test(n.key)).map((n) => n.fact);
  assert.deepEqual(facts('block-events mouseover keydown click(button.cancel)'), ['can keep this site from seeing some of what you do here (the mouse moving over things, keys, clicks on button.cancel), so the site doesn\'t react to it']);
  assert.throws(() => build(head('block-events submit')), /isn't an event it may keep/);
  assert.throws(() => build(head('block-events focus')), /isn't an event it may keep/);
  assert.throws(() => build(head('block-events click')), /click only on what it names/);
  assert.throws(() => build(head('block-events')), /needs the events it keeps/);
  assert.deepEqual(facts('page-events trif-demo-reset'), ['can send this page\'s own code these signals: trif-demo-reset']);
  for (const bad of ['click', 'htmx:trigger', 'turbo:visit', 'trif:filter-request']) assert.throws(() => build(head(`page-events ${bad}`)), /page-events/);
  assert.deepEqual(facts('site-storage session:trif-demo-state local:trifProfileStyler.mine:* cookie:twid'), ['can read and change what this site keeps under: trif-demo-state, trifProfileStyler.mine:*, twid (a cookie: only read)']);
  for (const bad of ['local:*', 'local:auth_token', 'session:sessionid', 'cookie:csrftoken', 'other:x', 'local:ab*']) assert.throws(() => build(head(`site-storage ${bad}`)), /site-storage/);
  assert.deepEqual(facts('rewrite-requests HomeTimeline variables.enableRanking=false'), ['changes what x.com receives from this page: enableRanking set to false (in HomeTimeline requests)']);
  for (const bad of ['HomeTimeline', 'HomeTimeline variables.url=https://evil.example/', 'HomeTimeline variables.x="a b"', 'Home/Timeline variables.x=1']) assert.throws(() => build(head(`rewrite-requests ${bad}`)), /rewrite-requests/);
  assert.deepEqual(facts('image-variants pbs.twimg.com _normal.→_400x400.'), ['can load other sizes of pictures this page shows (from pbs.twimg.com)']);
  assert.deepEqual(build(head('image-variants pbs.twimg.com _normal.->_400x400.')).mod.powerArgs, { 'image-variants': ['pbs.twimg.com _normal.→_400x400.'] });
  assert.throws(() => build(head('image-variants pbs.twimg.com a→//evil.example/')), /image-variants/);
  assert.deepEqual(facts('embeds www.youtube.com/embed'), ['can play videos this page links to, inside the page (from youtube.com)']);
  assert.throws(() => build(head('embeds evil.example/embed')), /isn't a player/);
  assert.deepEqual(facts('local-fonts'), ['can see which fonts are installed on this computer (and this site could see that too)']);
  assert.deepEqual(facts('edit-uploads'), ['can change pictures you attach on this site before you post them']);
  // (preload: soft, as controls)
  assert.deepEqual(bp.powerNeeds(build(head('preload')).mod).map((n) => [n.fact, n.soft]), [['can make this page load its pictures sooner', true]]);
  // (the widened ones)
  assert.deepEqual(facts('go-to reload /?mods=[red|blue]'), ['can reload this page; it can take you to these pages on x.com: /?mods=one of red, blue, or to a link the page shows']);
  assert.throws(() => build(head('go-to /?mods=[red|evil.example]')), /isn't a plain word/);
  assert.deepEqual(build(head('site-data ytInitialData')).mod.powerArgs, { 'site-data': ['ytInitialData'] });
  for (const bad of ['fetch', 'location', 'onload']) assert.throws(() => build(head(`site-data ${bad}`)), /isn't a data global/);
  assert.match(facts('search-box https://www.x.com/{link}/{query}')[0], /searches www\.x\.com \(in the place a link on the page names\)$/);
  // @migrate: listed on the hold, a need of its own; whole names, never a login's
  const m = build(head('sound', '// @migrate localStorage rrRave.zoom rrRave.on\n')).mod;
  assert.deepEqual(m.powerArgs, { migrate: ['local:rrRave.zoom', 'local:rrRave.on'] });
  assert.deepEqual(bp.powerNeeds(m).map((n) => [n.key, n.fact]).find(([k]) => /^power:migrate:/.test(k)), ['power:migrate:local:rrRave.on | local:rrRave.zoom', 'brings over its old settings from what this site keeps under: rrRave.zoom, rrRave.on (once)']);
  // (it reads the site's storage, so for the combinations it counts as site-storage: review F7)
  assert.deepEqual(bp.powerNeeds(m).filter((n) => n.power === 'together').map((n) => n.key), ['power:together:site-storage+sound']);
  assert.throws(() => build(head('sound', '// @migrate localStorage auth.token\n')), /named like a login/);
  assert.throws(() => build(head('sound', '// @migrate cookies x\n')), /@migrate/);
});
