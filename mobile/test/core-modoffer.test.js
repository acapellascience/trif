'use strict';
// mobile/shared/core/mod-offer.js (a chat's mod read for the chat's site, Tim 11-18; the coral "runs on another site"
// box, 11-17) against mod-offer-cases.json, the answers the iPhone's Browser.offerFromChat and ModOfferView gave before
// the move (mobile/test/modoffer.test.js holds the Swift to them). Also through the generated mobile/shared/gen/core.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'mod-offer-cases.json'), 'utf8'));

function run(O, where) {
  for (const [c, h, [here, came]] of cases.from) assert.deepStrictEqual({ ...O.from(c, h) }, { here, came }, `${where} from ${JSON.stringify(c)} ${JSON.stringify(h)}`);
  for (const [c, h, [here, came]] of cases.tap) assert.deepStrictEqual({ ...O.from(c, h) }, { here, came }, `${where} tap ${JSON.stringify(c)} ${JSON.stringify(h)}`);
  for (const [f, s, ss, want] of cases.elsewhere) assert.deepStrictEqual(JSON.parse(JSON.stringify(O.elsewhere(f, s, ss))), want, `${where} elsewhere ${f} ${s} ${JSON.stringify(ss)}`);
}

test('core/mod-offer.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'mod-offer.js')), 'module');
  assert.ok(cases.from.length > 100 && cases.elsewhere.length > 100);
});

test('gen/core.js: TrifCore.modOffer in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.modOffer', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("modOffer.from", JSON.stringify(["phone~m.x.com", "www.google.com"]))', ctx), '{"here":"m.x.com","came":"x.com"}');
});

test('sorting: code point order, as Swift sorts (an astral character after U+FFFD)', () => {
  const O = require(path.join(CORE, 'mod-offer.js'));
  assert.deepStrictEqual(O.elsewhere('x.com', 'x.com', ['\u{1F600}.com', '�.com', 'b.com']).others, ['b.com', '�.com', '\u{1F600}.com']);
});

test('Add to TRIF\'s tap takes the same rule (round 8: phone~<site> is <site>, as a reply handed over)', () => {
  assert.ok(cases.tap.some(([c]) => c.startsWith('phone~')));
  const swift = fs.readFileSync(path.join(__dirname, '..', 'browser-probe', 'TrifProbe', 'Browser.swift'), 'utf8');
  const tap = swift.slice(swift.indexOf('func offer(text pasted: String?'), swift.indexOf('// MARK: hiding'));
  assert.match(tap, /ModOfferRules\.from\(chatSite: chatSite, shown: host\)/);
  assert.match(tap, /m\.cameFrom = came/);
  assert.doesNotMatch(tap, /chatSite\.isEmpty \? host : chatSite/);
});
