// setMarkdown: a Sanitizer that drops everything without throwing (Safari's TRIF, Tim 11-20: an empty What's new)
// falls back to renderMarkdown's own (safe) HTML; one that keeps the content is used as is.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
let setMarkdown;
before(async () => { ({ setMarkdown } = await import('../extension/markdown.js')); });

function fakeNode(setHTML) {
  return {
    textContent: '', html: null,
    setHTML,
    set innerHTML(v) { this.html = v; this.textContent = v.replace(/<[^>]*>/g, ''); },
  };
}

test('a Sanitizer that empties the notes falls back to the rendered HTML', () => {
  const n = fakeNode(function () { this.textContent = ''; });
  setMarkdown(n, '- **Style mods make every replacement**, not just the first one.');
  assert.match(n.html, /<strong>Style mods make every replacement<\/strong>/);
});

test('a Sanitizer that keeps the content is used, no fallback', () => {
  const n = fakeNode(function (html) { this.textContent = html.replace(/<[^>]*>/g, ''); this.viaSanitizer = true; });
  setMarkdown(n, 'Hello **there**');
  assert.equal(n.viaSanitizer, true);
  assert.equal(n.html, null);
});

test('a Sanitizer that throws falls back as before', () => {
  const n = fakeNode(() => { throw new TypeError('old shape'); });
  setMarkdown(n, 'Hi');
  assert.match(n.html, /Hi/);
});
