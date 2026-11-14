'use strict';
// "Hide this" and "Point TRIF at this" (the right-click menu): the page side (extension/hidethis.js), run from
// its source text in a fresh vm context against a small fake DOM, as chrome.scripting runs it in a page, for
// how it names an element (the iPhone probe's way: a stable attribute, else its position), "All N like it",
// "Everywhere on <site>", that it never takes html or body, and Wider stopping below body; and the plain
// parts the background uses (extension/pointed.js): the CSS it puts in a page, the crop, the agent's block.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const rules = require('../helper/lib/rules');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'hidethis.js'), 'utf8');

// ---- a fake DOM: elements, and selectors as hidethis.js writes them (compounds joined by > or a space)

function splitTop(sel, seps) {
  const out = [];
  let cur = '', q = null, br = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { cur += c; if (c === '\\') { cur += sel[++i]; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '(') br++;
    if (c === ']' || c === ')') br--;
    if (!br && seps.includes(c)) { out.push(cur); out.push(c); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function parseSelector(sel) {
  // [[combinator, compound], ...] from the left
  const toks = splitTop(sel.trim(), ['>', ' ']).map((t) => (t === ' ' || t === '>' ? t : t.trim()));
  const steps = [];
  let comb = null;
  for (const t of toks) {
    if (t === '>') comb = '>';
    else if (t === ' ' || t === '') { if (!comb) comb = ' '; }
    else { steps.push([steps.length ? comb || ' ' : null, compileCompound(t)]); comb = null; }
  }
  if (!steps.length) throw new SyntaxError(`'${sel}' is not a valid selector`);
  return steps;
}
function compileCompound(c) {
  const m = /^([a-z][a-z0-9-]*|\*)?(.*)$/i.exec(c);
  const tests = [];
  if (m[1] && m[1] !== '*') tests.push((el) => el.localName === m[1].toLowerCase());
  let rest = m[2];
  while (rest) {
    let x;
    if ((x = /^#([A-Za-z_][\w-]*)/.exec(rest))) { const id = x[1]; tests.push((el) => el.id === id); }
    else if ((x = /^\.([A-Za-z_][\w-]*)/.exec(rest))) { const k = x[1]; tests.push((el) => el.classList.includes(k)); }
    else if ((x = /^\[([\w-]+)="((?:[^"\\]|\\.)*)"\]/.exec(rest))) { const [, a, v] = x; const val = v.replace(/\\(.)/g, '$1'); tests.push((el) => el.getAttribute(a) === val); }
    else if ((x = /^:nth-of-type\((\d+)\)/.exec(rest))) { const n = Number(x[1]); tests.push((el) => !el.parentElement || el.parentElement.children.filter((s) => s.localName === el.localName).indexOf(el) + 1 === n); }
    else if ((x = /^:nth-child\((\d+)\)/.exec(rest))) { const n = Number(x[1]); tests.push((el) => !el.parentElement || el.parentElement.children.indexOf(el) + 1 === n); }
    else throw new SyntaxError(`'${c}' is not a valid selector`);
    rest = rest.slice(x[0].length);
  }
  return (el) => tests.every((f) => f(el));
}
function matchesSel(el, sel) {
  const steps = parseSelector(sel);
  const at = (node, i) => {
    const [comb, f] = steps[i];
    if (!f(node)) return false;
    if (i === 0) return true;
    if (comb === '>') return !!node.parentElement && at(node.parentElement, i - 1);
    for (let up = node.parentElement; up; up = up.parentElement) if (at(up, i - 1)) return true;
    return false;
  };
  return at(el, steps.length - 1);
}

class El {
  constructor(tag, attrs = {}, kids = []) {
    this.nodeType = 1;
    this.localName = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.ownText = '';
    this.styles = {};
    const self = this;
    this.style = {
      setProperty(k, v, p = '') { self.styles[k] = [v, p]; },
      getPropertyValue(k) { return self.styles[k] ? self.styles[k][0] : ''; },
      getPropertyPriority(k) { return self.styles[k] ? self.styles[k][1] : ''; },
      removeProperty(k) { delete self.styles[k]; },
    };
    for (const k of kids) this.append(k);
  }
  get id() { return this.attrs.id || ''; }
  get classList() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get parentNode() { return this.parentElement; }
  getAttribute(a) { return a in this.attrs ? this.attrs[a] : null; }
  hasAttribute(a) { return a in this.attrs; }
  append(...kids) { for (const k of kids) { if (k == null) continue; if (typeof k === 'string') { this.ownText += k; continue; } k.parentElement = this; this.children.push(k); } }
  matches(sel) { return matchesSel(this, sel); }
  contains(o) { for (let x = o; x; x = x.parentElement) if (x === this) return true; return false; }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(' '); }
  get innerText() { return this.textContent; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { parseSelector(sel); return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 40, x: 10, y: 20 }; }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs || {}, kids.flat());

function load(body) {
  const html = h('html', {}, h('head', {}), body);
  const doc = { documentElement: html, body, querySelectorAll: (s) => html.querySelectorAll(s), querySelector: (s) => html.querySelector(s) };
  const ctx = { document: doc, Date, Math, Number, String, Object, Array, JSON, setTimeout, clearTimeout, scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 800, location: { hostname: 'x.com' } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { k: ctx.__trifHide, ctx, doc };
}

// A feed of cards: build-tool classes (sc-bdVaJa, css-1dbjc4n) that mustn't name anything, test ids that should.
function feedPage() {
  const card = (n, promo = false) => h('article', { class: 'css-1dbjc4n card', 'data-testid': 'tweet' },
    h('div', { class: 'sc-bdVaJa' }, `Post ${n}`), h('span', { class: 'icon' }, '♥'), promo ? h('div', { 'aria-label': 'Promoted' }, 'Ad') : null);
  return h('body', {},
    h('header', { id: 'top' }, h('nav', { role: 'navigation' }, 'Home')),
    h('main', { class: 'feed' }, card(1), card(2, true), card(3), card(4, true)),
    h('div', { class: 'x1lliihq' }, h('div', {}, 'sidebar one'), h('div', {}, 'sidebar two')),
    h('trend-box', {}, 'Trends'));
}

test('naming: a stable name where it has one, else its position; each selector finds exactly that element; none needs an escape', () => {
  const body = feedPage();
  const { k } = load(body);
  const main = body.children[1];
  const card2 = main.children[1];
  const cases = [
    [body.children[0], '#top'],
    [body.children[0].children[0], 'nav[role="navigation"]'],
    [main, 'main.feed'],
    [card2, 'main.feed > article:nth-of-type(2)'],
    [card2.children[0], 'main.feed > article:nth-of-type(2) > div:nth-of-type(1)'],
    [card2.children[2], 'main.feed > article:nth-of-type(2) > div[aria-label="Promoted"]'],
    [body.children[2].children[1], 'div > div:nth-of-type(2)'],
    [body.children[3], 'trend-box'],
  ];
  for (const [el, want] of cases) {
    const s = k.selectorFor(el);
    assert.strictEqual(s.selector, want);
    assert.strictEqual(s.matches, 1, want);
    assert.deepStrictEqual(body.parentElement.querySelectorAll(s.selector), [el], want);
    assert.strictEqual(rules.checkSelector(s.selector), null, `a style mod takes ${want}`);
  }
  assert.strictEqual(k.selectorFor(card2).how, 'position');
  assert.strictEqual(k.selectorFor(body.children[0]).how, 'id');
  // never html or body
  assert.strictEqual(k.selectorFor(body), null);
  assert.strictEqual(k.selectorFor(body.parentElement), null);
  // made-up names are left out: build tools' classes, ids that need an escape, attributes with long numbers
  const odd = h('body', {}, h('div', { id: '6col', class: 'a1b2c3 sc-bdVaJa', 'aria-label': 'Item 123456' }), h('div', {}));
  const { k: k2 } = load(odd);
  assert.strictEqual(k2.selectorFor(odd.children[0]).selector, 'body > div:nth-of-type(1)');
});

test('All N like it: the siblings by the same name, under the parent\'s; only where it makes sense', () => {
  const body = feedPage();
  const { k } = load(body);
  const main = body.children[1];
  const like = k.likeIt(main.children[2]);
  assert.deepStrictEqual({ ...like }, { selector: 'main.feed > article[data-testid="tweet"]', how: 'test id', matches: 4 });
  assert.strictEqual(rules.checkSelector(like.selector), null);
  // a child of body: its siblings are the page's parts, so no
  assert.strictEqual(k.likeIt(body.children[2]), null);
  // the only one of its kind, or the same tag among a card's other parts: no
  assert.strictEqual(k.likeIt(main.children[1].children[2]), null);
  // a list of one tag: yes
  const list = h('body', {}, h('section', { class: 'results' }, h('ul', {}, h('li', {}, 'a'), h('li', {}, 'b'), h('li', {}, 'c'))));
  const { k: k3 } = load(list);
  assert.deepStrictEqual({ ...k3.likeIt(list.children[0].children[0].children[1]) }, { selector: 'ul > li', how: 'tag', matches: 3 });
  // the only one of its name among its siblings (the icon in a card): no (Everywhere on <site> is the way to all of those)
  assert.strictEqual(k.likeIt(main.children[0].children[1]), null);
});

test('Everywhere on <site>: the element\'s own name without its path, never a bare tag, id, position or generic attribute', () => {
  const body = feedPage();
  const { k } = load(body);
  const main = body.children[1];
  const promo = main.children[1].children[2];
  assert.deepStrictEqual({ ...k.everywhere(promo) }, { selector: 'div[aria-label="Promoted"]', how: 'attribute', matches: 2 });
  assert.deepStrictEqual({ ...k.everywhere(main.children[0]) }, { selector: 'article[data-testid="tweet"]', how: 'test id', matches: 4 });
  assert.deepStrictEqual({ ...k.everywhere(main.children[0].children[1]) }, { selector: 'span.icon', how: 'class', matches: 4 });
  assert.deepStrictEqual({ ...k.everywhere(body.children[3]) }, { selector: 'trend-box', how: 'custom element', matches: 1 });
  assert.strictEqual(k.everywhere(body.children[0]), null, 'an id only');
  assert.strictEqual(k.everywhere(body.children[0].children[0]), null, 'a role only');
  assert.strictEqual(k.everywhere(main.children[0].children[0]), null, 'a build tool\'s class only');
  assert.strictEqual(k.everywhere(body.children[2].children[0]), null, 'a bare tag only');
});

test('which element: never html or body or what\'s outside body; inside an svg, the svg; the recorded right-click, if recent', () => {
  const svg = h('svg', {}, h('g', {}, h('path', {})));
  const body = h('body', {}, h('div', { class: 'box' }, svg));
  const { k, ctx, doc } = load(body);
  assert.strictEqual(k.usable(body), null);
  assert.strictEqual(k.usable(doc.documentElement), null);
  assert.strictEqual(k.usable(doc.documentElement.children[0]), null, 'head');
  assert.strictEqual(k.usable(svg.children[0].children[0]), svg);
  ctx.__trifContext = { target: svg.children[0], at: Date.now(), frame: body.children[0] };
  assert.strictEqual(k.target({}), svg);
  assert.strictEqual(k.target({ inFrame: true }), body.children[0]);
  ctx.__trifContext.at = Date.now() - 10 * 60000;
  assert.strictEqual(k.target({}), null, 'an old right-click');
  // Firefox's own answer first
  ctx.browser = { menus: { getTargetElement: (id) => (id === 7 ? body.children[0] : null) } };
  assert.strictEqual(k.target({ targetElementId: 7 }), body.children[0]);
});

test('Point TRIF at this: the pill\'s words, the element\'s own (in quotes) or its tag', () => {
  const body = h('body', {}, h('button', { 'aria-label': 'Sign in' }, 'x'), h('p', {}, 'A long paragraph of words that goes on for well over forty characters'), h('img', {}));
  const { k } = load(body);
  assert.strictEqual(k.label(body.children[0]), '“Sign in”');
  assert.strictEqual(k.label(body.children[1]), '“A long paragraph of words that goes on…”');
  assert.strictEqual(k.label(body.children[2]), '<img>');
});

test('pointed.js: the page\'s CSS for a hidden selector, the selectors it takes, the crop, the agent\'s block', async () => {
  const p = await import('../extension/pointed.js');
  assert.strictEqual(p.hideCss('a.b'), 'a.b { display: none !important; }');
  assert.strictEqual(p.hiddenModId('x.com'), 'x.com/hidden');
  assert.deepStrictEqual(Object.values(p.MENU_TITLES), ['Hide this', 'Point TRIF at this']);
  for (const ok of ['a.b > c', 'div[aria-label="a {b}; @c"]', 'main.feed > article:nth-of-type(2)']) assert.ok(p.plainSelector(ok), ok);
  for (const bad of ['a { x }', 'a; b', '@media', 'a\\62', 'a /* c */', 'div[x="open', 'a[x="1\n2"]', '', 'url(x)']) assert.ok(!p.plainSelector(bad), bad);
  // crop: at 2x, with room around, cut to the capture; nothing when it's out of view
  assert.deepStrictEqual(p.cropBox({ x: 100, y: 50, w: 200, h: 100 }, { w: 1000, h: 800 }, { width: 2000, height: 1600 }), { sx: 184, sy: 84, sw: 432, sh: 232 });
  assert.deepStrictEqual(p.cropBox({ x: -50, y: 700, w: 200, h: 300 }, { w: 1000, h: 800 }, { width: 1000, height: 800 }), { sx: 0, sy: 692, sw: 158, sh: 108 });
  assert.strictEqual(p.cropBox({ x: 10, y: 900, w: 20, h: 20 }, { w: 1000, h: 800 }, { width: 1000, height: 800 }), null);
  const block = p.pointedBlock({ url: 'https://x.com/home', selector: 'main.feed > article:nth-of-type(2)', matches: 1, how: 'position', tag: 'article',
    rect: { x: 10, y: 940, w: 600, h: 120 }, text: 'Post 2 ```', html: '<article class="card">Post 2</article>' }, 'sites/x.com/files/pointed.png');
  assert.match(block, /^\n\n\(The user right-clicked an element on the page and chose "Point TRIF at this"/);
  assert.match(block, /- Selector: `main\.feed > article:nth-of-type\(2\)` \(finds only this element; named by position\)/);
  assert.match(block, /- Size and place: 600×120 CSS px at x 10, y 940 of the page, a <article>/);
  assert.match(block, /- Screenshot of it: sites\/x\.com\/files\/pointed\.png/);
  assert.match(block, /````text\nPost 2 ```\n````/, 'a fence longer than any in the text');
  assert.match(block, /```html\n<article class="card">Post 2<\/article>\n```\n\)$/);
  assert.doesNotMatch(p.pointedBlock({ url: 'u', selector: null, rect: null, text: '', html: '' }), /Screenshot|visible text|HTML/);
});
