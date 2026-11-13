'use strict';
// helper/lib/sandboxlint.js: what a boxed mod's code uses that the box doesn't give it, and boxable() for trif check.
const test = require('node:test');
const assert = require('node:assert/strict');

test('boxable: a free mod that only uses what the box has elsewhere reads as boxable; one that needs the page doesn\'t', () => {
  const { boxable } = require('../helper/lib/sandboxlint');
  const dom = `(() => { const mo = new MutationObserver(() => { const a = document.getElementById('main'); if (a && a.querySelector('.wall')) a.remove(); }); mo.observe(document, { childList: true, subtree: true }); })();`;
  const r = boxable(dom);
  assert.equal(r.boxable, true);
  assert.ok(r.swaps.some((s) => /^document: use page/.test(s)) && r.swaps.some((s) => /^MutationObserver: use trif\.observe/.test(s)));
  for (const page of [
    'const f = window.fetch; window.fetch = (...a) => f(...a);',
    'const x = new XMLHttpRequest();',
    'localStorage.setItem("a", "b");',
    'history.pushState({}, "", "/x");',
    'document.body.innerHTML = "<b>x</b>"; window.__app.state = 1;',
    'eval("1");',
  ]) assert.equal(boxable(page).boxable, false, page);
  assert.deepEqual(boxable('trif.log("plain")'), { boxable: true, swaps: [] });
});
