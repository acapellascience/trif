'use strict';
// mobile/shared/core/tab-list.js (the card the tab list opens at and its robot badges, Tim 11-18) against
// tab-list-cases.json, the answers the iPhone's ClaudePane.chatTabShown, TabsView.marked, ClaudePane.badge(for:) and ClaudePane.goToSite gave before the move
// (mobile/test/tablist.test.js holds the Swift to them). Also through the generated mobile/shared/gen/core.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const cases = JSON.parse(fs.readFileSync(path.join(CORE, 'tab-list-cases.json'), 'utf8'));

function run(L, where) {
  for (const [f, want] of cases.focus) assert.equal(L.focus(f), want, `${where} focus ${JSON.stringify(f)}`);
  for (const [f, want] of cases.marked) assert.equal(L.marked(f), want, `${where} marked ${JSON.stringify(f)}`);
  for (const [f, want] of cases.badges) assert.deepStrictEqual(JSON.parse(JSON.stringify(L.badges(f))), want, `${where} badges ${JSON.stringify(f)}`);
  for (const [f, want] of cases.goTo) assert.deepStrictEqual(JSON.parse(JSON.stringify(L.goTo(f))), want, `${where} goTo ${JSON.stringify(f)}`);
}

test('core/tab-list.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'tab-list.js')), 'module');
  assert.ok(cases.focus.filter(([, w]) => w).length > 100 && cases.marked.length > 200 && cases.badges.filter(([, w]) => Object.keys(w).length).length > 100);
  const kinds = (k) => cases.goTo.filter(([, w]) => k(w)).length;
  assert.ok(kinds((w) => w === null) > 50 && kinds((w) => w && w.tab) > 50 && kinds((w) => w && w.page) > 40 && kinds((w) => w && w.open && !w.page) > 400);
});

test('gen/core.js: TrifCore.tabList in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.tabList', ctx), 'gen');
  const tabs = [{ id: 'A', host: 'm.facebook.com' }, { id: 'B', host: 'x.com' }];
  assert.equal(vm.runInContext(`TrifCore.call("tabList.focus", ${JSON.stringify(JSON.stringify([{ open: true, more: false, link: null, chat: 'x.com', tabs, current: 'A' }]))})`, ctx), '"B"');
});

test('from Mods, the page or More\'s chat: the shown tab', () => {
  const L = require(path.join(CORE, 'tab-list.js'));
  const tabs = [{ id: 'A', host: 'x.com' }, { id: 'B', host: 'x.com' }];
  const link = { site: 'x.com', tab: 'B', state: 'read' };
  assert.equal(L.focus({ open: true, more: false, link, chat: null, tabs, current: 'A' }), 'B');
  assert.equal(L.focus({ open: false, more: false, link, chat: null, tabs, current: 'A' }), null);
  assert.equal(L.focus({ open: true, more: true, link, chat: null, tabs, current: 'A' }), null);
  assert.equal(L.marked({ focus: null, tabs: ['A', 'B'], current: 'A' }), 'A');
});

test('Go to <site>: its tab, else its page in a new tab, else the site\'s home; no site, nothing', () => {
  const L = require(path.join(CORE, 'tab-list.js'));
  const tabs = [{ id: 'A', host: 'www.x.com' }, { id: 'B', host: 'bbc.co.uk' }];
  const page = { url: 'https://mobile.x.com/i/flow', host: 'mobile.x.com' };
  assert.deepStrictEqual(L.goTo({ link: { site: 'x.com', tab: 'A', page }, chat: null, tabs, current: 'B' }), { tab: 'A' });
  assert.deepStrictEqual(L.goTo({ link: { site: 'x.com', tab: 'B', page }, chat: null, tabs, current: 'B' }), { open: page.url, page: true });
  assert.deepStrictEqual(L.goTo({ link: { site: 'x.com', tab: 'Z', page: { url: 'https://evil.org/?u=x.com', host: 'evil.org' } }, chat: null, tabs, current: 'B' }), { open: 'https://x.com/', page: false });
  assert.deepStrictEqual(L.goTo({ link: null, chat: 'x.com', tabs, current: 'B' }), { tab: 'A' });
  assert.equal(L.goTo({ link: null, chat: '', tabs, current: 'B' }), null);
  assert.equal(L.goTo({ link: null, chat: null, tabs, current: 'B' }), null);
});
