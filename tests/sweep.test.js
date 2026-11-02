// `trif sweep`: the in-page sweep (extension/sweep.js) run from its source text in a fresh vm context
// against a small fake DOM (so it's self-contained, as chrome.scripting needs), and the CLI side
// (helper/lib/sweep.js): option parsing and the report.
const assert = require('node:assert');
const vm = require('node:vm');
const { test, before } = require('node:test');
const { sweepArgs, formatSweep, SweepUsageError } = require('../helper/lib/sweep');
const cli = require('../helper/cli');

let sweepPage;
before(async () => { ({ sweepPage } = await import('../extension/sweep.js')); });

// ---- a fake DOM: just what sweepPage uses

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const INHERITED = new Set(['color', 'fill', 'stroke', 'text-shadow']);
const DEFAULTS = {
  color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'box-shadow': 'none', 'text-shadow': 'none',
  'border-top-color': 'rgb(0, 0, 0)', 'border-right-color': 'rgb(0, 0, 0)', 'border-bottom-color': 'rgb(0, 0, 0)', 'border-left-color': 'rgb(0, 0, 0)',
  'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
  'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
  'outline-color': 'rgb(0, 0, 0)', 'outline-style': 'none', 'outline-width': '0px', 'text-decoration-color': 'rgb(0, 0, 0)', 'text-decoration-line': 'none',
  fill: 'rgb(0, 0, 0)', stroke: 'none', position: 'static', content: 'normal', display: 'block',
};
const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// Simple selectors only: tag, #id, .class, [attr], [attr=value], compound, comma lists.
function compile(sel) {
  return sel.split(',').map((part) => {
    part = part.trim();
    if (!part || /[\s>+~]/.test(part)) throw new SyntaxError(`'${sel}' is not a valid selector`);
    const re = /^([a-z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|[\w-]+))?\])*)$/i;
    const m = re.exec(part);
    if (!m) throw new SyntaxError(`'${sel}' is not a valid selector`);
    const tests = [];
    if (m[1] && m[1] !== '*') tests.push((el) => el.localName === m[1].toLowerCase());
    for (const t of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
      if (t[0] === '#') tests.push((el) => el.id === t.slice(1));
      else if (t[0] === '.') tests.push((el) => el.classList.includes(t.slice(1)));
      else {
        const [, name, quoted, bare] = /^\[([\w-]+)(?:=(?:"([^"]*)"|([\w-]+)))?\]$/.exec(t);
        const v = quoted ?? bare;
        tests.push((el) => el.hasAttribute(name) && (v === undefined || el.getAttribute(name) === v));
      }
    }
    return (el) => tests.every((f) => f(el));
  });
}
const matchesSel = (el, sel) => compile(sel).some((f) => f(el));

class Text { constructor(data) { this.nodeType = 3; this.data = data; this.nextSibling = null; } }

class Root {
  constructor() { this.children = []; this.styleSheets = []; this.adoptedStyleSheets = []; }
  append(c) { this.children.push(c); c.rootNode = this; return c; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (sel === '*' || matchesSel(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

class Element {
  constructor(doc, tag, { attrs = {}, style = {}, pseudo = {}, text = '', rect = { width: 100, height: 20, top: 10, left: 0 }, ns = HTML_NS, children = [] } = {}) {
    this.ownerDocument = doc;
    this.localName = tag;
    this.namespaceURI = ns;
    this.attrs = { ...attrs };
    this.id = attrs.id || '';
    this.classList = (attrs.class || '').split(/\s+/).filter(Boolean);
    this.styleOwn = style;
    this.pseudoStyles = pseudo;
    this.rect = rect;
    this.children = [];
    this.parentElement = null;
    this.rootNode = null;
    this.shadowRoot = null;
    this.closedRoot = null;
    this.firstChild = null;
    this.textNodes = [];
    if (text) this.addText(text);
    for (const c of children) this.append(c);
  }
  addText(t) { const n = new Text(t); if (this.textNodes.length) this.textNodes[this.textNodes.length - 1].nextSibling = n; else this.firstChild = n; this.textNodes.push(n); }
  append(c) { c.parentElement = this; this.children.push(c); return c; }
  get textContent() { return this.textNodes.map((n) => n.data).join('') + this.children.map((c) => c.textContent).join(''); }
  getAttribute(n) { return Object.hasOwn(this.attrs, n) ? this.attrs[n] : null; }
  hasAttribute(n) { return Object.hasOwn(this.attrs, n); }
  matches(sel) { return matchesSel(this, sel); }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null; }
  getRootNode() { let e = this; while (e.parentElement) e = e.parentElement; return e.rootNode || this.ownerDocument; }
  getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; }
  checkVisibility() { return !(this.styleOwn.display === 'none' || this.styleOwn.visibility === 'hidden') && this.rect.width > 0; }
}

class Doc extends Root {
  constructor() { super(); this.title = 'Fake page'; this.defaultView = null; }
  get documentElement() { return this.children[0]; }
  createDocumentFragment() { return { querySelector: (sel) => { compile(sel); return null; } }; }
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('only canvas');
    // fillStyle normalizes the few names the tests use; getImageData returns the last fill.
    const NAMES = { blue: '#0000ff', pink: '#ffc0cb', hotpink: '#ff69b4' };
    let fill = '#000000';
    return { width: 1, height: 1, getContext: () => ({
      get fillStyle() { return fill; },
      set fillStyle(v) { const k = String(v).toLowerCase(); if (NAMES[k]) fill = NAMES[k]; else if (/^#[0-9a-f]{6}$/.test(k)) fill = k; },
      clearRect() {}, fillRect() {},
      getImageData() { return { data: [parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5, 7), 16), 255] }; },
    }) };
  }
}

// The computed style of an element (or its pseudo-element): own values, inherited ones from the parent
// in the flat tree, else defaults.
function computed(el, pseudo) {
  const flatParent = (e) => e.parentElement || (e.getRootNode().host) || null;
  const lookup = (e, prop) => {
    if (Object.hasOwn(e.styleOwn, prop)) return e.styleOwn[prop];
    if (INHERITED.has(prop)) { const p = flatParent(e); if (p) return lookup(p, prop); }
    return DEFAULTS[prop];
  };
  let get;
  if (pseudo) {
    const own = el.pseudoStyles[pseudo];
    if (!own) return { content: 'none', display: 'inline', getPropertyValue: () => '' };
    get = (prop) => (Object.hasOwn(own, prop) ? own[prop] : INHERITED.has(prop) ? lookup(el, prop) : DEFAULTS[prop]);
  } else get = (prop) => lookup(el, prop);
  const s = { getPropertyValue: get };
  for (const prop of Object.keys(DEFAULTS)) Object.defineProperty(s, camel(prop), { get: () => get(prop) });
  return s;
}

function sheet(rules, { href = null, readable = true } = {}) {
  const decl = (obj) => { const keys = Object.keys(obj); const st = { length: keys.length, getPropertyValue: (p) => obj[p] ?? '' }; keys.forEach((k, i) => { st[i] = k; }); return st; };
  const list = rules.map((r) => (r.media ? { cssRules: r.media.map((x) => ({ selectorText: x[0], style: decl(x[1]) })) } : { selectorText: r[0], style: decl(r[1]) }));
  return { href, ownerNode: href ? null : { localName: 'style' }, get cssRules() { if (!readable) throw new Error('SecurityError'); return list; } };
}

/** The page the tests sweep: promos in the main column, a sticky header, a shadow root, a same-origin frame. */
function fakePage() {
  const doc = new Doc();
  const E = (tag, o = {}, ...children) => new Element(doc, tag, { ...o, children });
  const BLUE = 'rgb(29, 155, 240)';
  const html = E('html', {},
    E('body', {},
      E('header', { attrs: { class: 'top' }, style: { position: 'sticky', 'background-color': BLUE } },
        E('a', { attrs: { href: '/' }, text: 'Home' }),
        E('div', { attrs: { class: 'promo', 'data-testid': 'promo' }, text: 'Sponsored: buy now' })),
      E('main', {},
        E('div', { attrs: { class: 'promo card' }, text: 'Sponsored deal', style: { 'border-top-style': 'solid', 'border-top-width': '1px', 'border-top-color': BLUE } }),
        E('div', { attrs: { class: 'promo card' }, text: 'Another deal', style: { display: 'none' }, rect: { width: 0, height: 0, top: 0, left: 0 } }),
        E('p', { attrs: { class: 'post' }, text: 'Plain post', style: { color: BLUE } },
          E('span', { text: 'inherits blue, not counted' })),
        E('p', { attrs: { class: 'post', 'aria-label': 'sponsored post' }, text: 'labelled', style: { 'box-shadow': `0px 1px 2px ${BLUE}` } }),
        E('div', { attrs: { class: 'grad' }, style: { 'background-image': `linear-gradient(rgb(255, 255, 255), ${BLUE})` }, rect: { width: 100, height: 20, top: 2000, left: 0 } }),
        E('div', { attrs: { class: 'badge' }, pseudo: { '::before': { content: '"*"', color: BLUE } } }),
        E('div', { attrs: { class: 'thin' }, style: { 'border-top-color': BLUE } }), // no border width: not painted
        E('svg', { ns: SVG_NS, style: { fill: BLUE } }, E('path', { ns: SVG_NS })),
        E('div', { attrs: { id: 'host', class: 'widget' } }),
        E('iframe', { attrs: { src: '/frame.html' } }),
        E('iframe', { attrs: { src: 'https://ads.example.net/x' } })),
      E('div', { attrs: { role: 'menu', 'aria-label': 'More' } },
        E('div', { attrs: { role: 'menuitem', class: 'promo' }, text: 'Sponsored link' }))));
  doc.append(html);
  // Shadow root on #host with a promo inside.
  const host = doc.querySelectorAll('#host')[0];
  const shadow = new Root();
  shadow.host = host;
  shadow.append(new Element(doc, 'div', { attrs: { class: 'promo' }, text: 'Sponsored in shadow', style: { 'background-color': 'rgba(29, 155, 240, 0.1)' } }));
  host.shadowRoot = shadow;
  shadow.styleSheets = [sheet([['.promo', { 'background-color': 'rgba(29, 155, 240, 0.1)' }]])];
  // A same-origin frame with one promo, and a cross-origin one (contentDocument null).
  const [same, cross] = doc.querySelectorAll('iframe');
  const fdoc = new Doc();
  const fhtml = new Element(fdoc, 'html', { children: [new Element(fdoc, 'body', { children: [new Element(fdoc, 'div', { attrs: { class: 'promo' }, text: 'Sponsored in frame' })] })] });
  fdoc.append(fhtml);
  fdoc.defaultView = { getComputedStyle: computed };
  same.contentDocument = fdoc;
  cross.contentDocument = null;
  doc.defaultView = { getComputedStyle: computed };
  doc.styleSheets = [
    sheet([[':root', { '--brand': '#1d9bf0', '--other': '#ff0000' }], ['.top', { 'background-color': 'var(--brand)' }], ['.link', { color: '#1D9BF0' }],
      { media: [['.dark .link', { 'border-top-color': 'rgb(29 155 240 / 1)' }]] }, ['.x', { color: 'var(--other)' }]]),
    sheet([['.y', { color: 'blue' }]], { href: 'https://cdn.example.net/site.css?v=1', readable: false }),
  ];
  return doc;
}

async function sweep(opts, { doc = fakePage(), clock } = {}) {
  const ctx = {
    document: doc, location: { href: 'https://example.com/home' }, innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0,
    getComputedStyle: computed, window: null, setTimeout, URL, scrollBy() {}, scrollTo() {},
  };
  ctx.window = ctx;
  if (clock) ctx.Date = { now: clock };
  vm.createContext(ctx);
  // Through JSON, as chrome.scripting hands results back.
  return JSON.parse(JSON.stringify(await vm.runInContext(`(${sweepPage.toString()})(${JSON.stringify(opts)})`, ctx)));
}

// ---- the in-page sweep

test('sweep --selector: every instance, in shadow roots and same-origin frames, with where each is', async () => {
  const r = await sweep({ selector: '.promo' });
  assert.ifError(r.error);
  assert.strictEqual(r.total, 6);
  assert.strictEqual(r.scanned.shadowRoots, 1);
  assert.strictEqual(r.scanned.frames, 1);
  assert.deepStrictEqual(r.skipped.crossOriginFrames, ['ads.example.net']);
  assert.strictEqual(r.summary.inShadowRoots, 1);
  assert.strictEqual(r.summary.inFrames, 1);
  assert.strictEqual(r.summary.sticky, 1, 'the header promo is in a sticky header');
  assert.strictEqual(r.summary.hidden, 1);
  assert.strictEqual(r.summary.regions.main, 4, 'main: two cards, the shadow one (through its host), the frame one (through its iframe)');
  assert.strictEqual(r.summary.regions.header, 1);
  assert.strictEqual(r.summary.regions['[role=menu] "More"'], 1);
  const shadowed = r.matches.find((m) => m.root.startsWith('shadow root'));
  assert.match(shadowed.root, /div#host\.widget/);
  assert.strictEqual(shadowed.region, 'main');
  assert.ok(r.groups.some((g) => g.signature === 'div[data-testid=promo]' && g.count === 1));
  assert.ok(r.groups.some((g) => g.signature === 'div.promo.card' && g.count === 2));
  assert.strictEqual(r.matches.find((m) => m.text === 'Another deal').visible, false);
});

test('sweep --text: own text and labels, case-insensitive; with --selector, the whole text of matches', async () => {
  const r = await sweep({ text: 'sponsored' });
  assert.ifError(r.error);
  // header promo, main card, aria-label post, menu item, shadow, frame (not their ancestors, whose own text doesn't match)
  assert.strictEqual(r.total, 6);
  assert.strictEqual(r.matches.find((m) => m.matchedIn === 'aria-label').text, 'sponsored post');
  const exact = await sweep({ text: '/^Sponsored/' });
  assert.strictEqual(exact.total, 5, '/re/ without flags is case-sensitive');
  const both = await sweep({ selector: 'main', text: 'Sponsored deal' });
  assert.strictEqual(both.total, 1);
  assert.strictEqual(both.matches[0].element, 'main');
});

test('sweep --color: computed colours where they are set, pseudo-elements, gradients, shadows, SVG; and the stylesheets', async () => {
  const r = await sweep({ color: '#1d9bf0' });
  assert.ifError(r.error);
  assert.strictEqual(r.target, 'rgb(29, 155, 240)');
  const els = r.matches.map((m) => `${m.element} ${m.props.map((p) => (p.pseudo || '') + p.prop).join(',')}`);
  assert.deepStrictEqual(els.sort(), [
    'div.badge ::beforecolor',
    'div.grad background-image',
    'div.promo background-color',
    'div.promo.card border-top-color',
    'header.top background-color',
    'p.post[aria-label="sponsored post"] box-shadow',
    'p.post color',
    'svg fill',
  ].sort(), 'not the span inheriting blue, not the border with no width, not the path inheriting fill');
  assert.strictEqual(r.summary.props.border, 1);
  assert.strictEqual(r.summary.inViewport, r.summary.visible - 1, 'the gradient is below the fold');
  const rules = r.rules;
  assert.strictEqual(rules.unreadable, 1);
  assert.deepStrictEqual(r.skipped.unreadableSheets, ['https://cdn.example.net/site.css?v=1']);
  assert.deepStrictEqual(rules.variables.map((v) => [v.name, v.uses]), [['--brand', 1]]);
  assert.deepStrictEqual(rules.list.map((x) => x.selector).sort(), ['.dark .link', '.link', '.promo'].sort(), 'media rules and shadow-root sheets included');
  assert.deepStrictEqual(rules.usingVariables.list.map((x) => x.selector), ['.top']);
});

test('sweep --color: tolerance, named colours, alpha, and --selector to limit it', async () => {
  const off = await sweep({ color: 'rgb(31, 150, 240)' });
  assert.strictEqual(off.total, 0);
  const near = await sweep({ color: 'rgb(31, 150, 240)', tolerance: 6 });
  assert.strictEqual(near.total, 8);
  const tinted = await sweep({ color: 'rgba(29, 155, 240, 0.1)' });
  assert.deepStrictEqual(tinted.matches.map((m) => m.element), ['div.promo'], 'with an alpha, only that alpha');
  const within = await sweep({ color: '#1d9bf0', selector: 'main' });
  assert.strictEqual(within.total, 6, 'only inside main (not the header, not the shadow root)');
  const named = await sweep({ color: 'blue' });
  assert.ifError(named.error);
  assert.strictEqual(named.target, 'rgb(0, 0, 255)');
});

test('sweep: bad queries come back as errors, never throws', async () => {
  assert.match((await sweep({})).error, /nothing to look for/);
  assert.match((await sweep({ selector: 'div[[' })).error, /invalid CSS selector/);
  assert.match((await sweep({ text: '(' })).error, /invalid regex/);
  assert.match((await sweep({ color: 'notacolour' })).error, /not a CSS colour/);
  const broken = await sweep({ selector: 'div' }, { doc: { createDocumentFragment: () => ({ querySelector() {} }), querySelectorAll() { throw new Error('boom'); }, title: '' } });
  assert.strictEqual(broken.total, 0, 'a root that can\'t be listed is skipped');
});

test('sweep: stops at its time budget and says so; caps the matches it returns', async () => {
  let t = 0;
  const doc = fakePage();
  const body = doc.documentElement.children[0];
  for (let i = 0; i < 600; i++) body.append(new Element(doc, 'div'));
  const r = await sweep({ selector: '*', budget: 500 }, { doc, clock: () => { t += 400; return t; } });
  assert.match(r.partial, /time limit \(500 ms\)/);
  const capped = await sweep({ selector: '*', limit: 3 });
  assert.strictEqual(capped.matches.length, 3);
  assert.ok(capped.total > 3);
});

// ---- the CLI side

test('sweepArgs: options, validation, and how long to wait', () => {
  const p = (argv) => sweepArgs(cli.parseArgs(argv).opts);
  assert.deepStrictEqual(p(['--selector', '.promo']), { selector: '.promo', timeout: 9000 });
  assert.deepStrictEqual(p(['--color', '#1d9bf0', '--tolerance', '8', '--limit', '50', '--timeout', '2000', '--scroll']),
    { color: '#1d9bf0', tolerance: 8, limit: 50, budget: 2000, scroll: true, timeout: 2000 + 4000 + 1000 + 5000 });
  assert.deepStrictEqual(p(['--text', 'Sponsored', '--selector=article']), { selector: 'article', text: 'Sponsored', timeout: 9000 });
  assert.throws(() => p([]), SweepUsageError);
  assert.throws(() => p(['--selector', ' ']), /needs a value/);
  assert.throws(() => p(['--selector', 'a', '--tolerance', '3']), /goes with --color/);
  assert.throws(() => p(['--color', 'red', '--tolerance', '300']), /0 to 255/);
  assert.throws(() => p(['--text', 'x', '--limit', '0']), /positive integer/);
});

test('formatSweep: counts, where, kinds, stylesheets, what was skipped', async () => {
  const r = await sweep({ color: '#1d9bf0' });
  const text = formatSweep(r);
  assert.match(text, /^sweep --color '#1d9bf0' \(rgb\(29, 155, 240\), ±2\)/);
  assert.match(text, /\n8 matches {2}\(\d+ elements scanned, incl\. 1 shadow root and 1 frame, \d+ ms\)/);
  assert.match(text, /where {3}main 7 · /);
  assert.match(text, /1 sticky/);
  assert.match(text, /stylesheets {2}3 rules use it; 1 variable defines it, used by 1 rule \(3 sheets read, 1 unreadable: cross-origin\)/);
  assert.match(text, /--brand: #1d9bf0 {3}\(:root; used 1×\)/);
  assert.match(text, /not searched: cross-origin frames \(ads\.example\.net\)/);
  const many = formatSweep(await sweep({ selector: '*' }));
  assert.match(many, /kinds \(\d+\):/);
  assert.match(many, /^ {4} {3}2 {2}div\.promo\.card/m);
  const none = formatSweep(await sweep({ selector: '.nothing' }));
  assert.match(none, /^0 matches/m);
  assert.match(none, /Nothing matched/);
});

test('trif sweep is a known command with help', () => {
  const help = require('../helper/lib/help');
  assert.ok(help.COMMANDS.sweep);
  assert.match(help.commandHelp('sweep'), /--selector <css>/);
  assert.match(help.mainHelp('/w'), /sweep \[TAB\]/);
});
