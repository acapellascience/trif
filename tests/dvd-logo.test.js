'use strict';
// examples/sites/www.google.com/dvd-logo.js, a boxed mod since 0.3.0, run in a vm with a small stand-in for
// TRIF's sandbox API (page, its element stand-ins, trif.changes; helper/workspace/BOXED.md): the logo bounces
// inside the viewport, changes tint at each edge, never catches clicks, and holds still with "reduce motion"
// on. Also: it checks out clean as a boxed mod, and existing workspaces get it, switched off, from their next
// setup. (The real sandbox runs it in the e2e.)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO, tempDir } = require('./fake-extension');
const { parseHeader } = require('../helper/lib/mods');
const { sandboxLint } = require('../helper/lib/sandboxlint');
const { preinstallMods, loadPreinstalled, PREINSTALLED } = require('../helper/lib/preinstalled');

const FILE = path.join(REPO, 'examples', 'sites', 'www.google.com', 'dvd-logo.js');
const CODE = fs.readFileSync(FILE, 'utf8');

// An element stand-in: tag, attributes, styles (style(k) reads, style(k, v) sets, null removes), children.
function el(tag, { attrs = {}, rect = { left: 0, top: 0, width: 0, height: 0 } } = {}) {
  const e = {
    tag, attrs: { ...attrs }, styles: {}, children: [], parent: null, rectValue: rect, hidden: false,
    attr(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttr(k, v) { this.attrs[k] = String(v); },
    removeAttr(k) { delete this.attrs[k]; },
    style(k, ...v) {
      if (!v.length) return this.styles[k] ?? '';
      if (v[0] === null || v[0] === '') delete this.styles[k]; else this.styles[k] = String(v[0]);
      return undefined;
    },
    hide() { this.hidden = true; },
    rect() { const r = this.rectValue; return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }; },
    append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } },
    prepend(...c) { for (const x of c.reverse()) { x.parent = this; this.children.unshift(x); } },
    find() { return null; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
    clone() { return el(this.tag, { attrs: {} }); },
  };
  return e;
}

/** A Google home page with its logo (`logo`, or none), a viewport of w×h, and a frame clock to step. */
function page({ w = 1000, h = 600, reduce = false, logo = true, src = '/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png' } = {}) {
  const body = el('body');
  const img = logo ? el('img', { attrs: { src, class: 'lnXdpd' }, rect: { left: 364, top: 200, width: 272, height: 92 } }) : null;
  const media = { matches: reduce, listeners: [], onChange(fn) { this.listeners.push(fn); } };
  let frames = [];
  let now = 0;
  const pageApi = {
    url: 'https://www.google.com/', body, root: { clientWidth: w, clientHeight: h },
    find: (s) => (img && s === 'img.lnXdpd' ? img : null),
    create: (t) => el(t),
    matchMedia: () => media,
  };
  const trif = { changes: () => () => {} };
  const ctx = {
    page: pageApi, trif, URL,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
    setTimeout: () => 0,
  };
  // (as the sandbox runs a boxed mod: its code as the body of an async function, so a top-level return works)
  vm.runInNewContext(`(async function () {\n${CODE}\n})()`, ctx, { filename: FILE });
  return {
    img, body, media,
    dvd: () => body.children[0] || null,
    /** Runs the animation for `seconds` at 60 frames a second; returns [{x, y, tint}] per frame. */
    run(seconds) {
      const out = [];
      for (let i = 0; i < seconds * 60; i++) {
        const fns = frames; frames = [];
        now += 1000 / 60;
        for (const fn of fns) fn(now);
        const d = this.dvd();
        if (!d) continue;
        const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(d.style('transform'));
        out.push({ x: +x, y: +y, tint: d.style('background-color') || d.style('filter') });
      }
      return out;
    },
    setReduce(on) { media.matches = on; for (const fn of media.listeners) fn(on); },
  };
}

test('dvd-logo: a shipped boxed mod for the Google home page, off at first, render-only, no powers', () => {
  const h = parseHeader(CODE);
  assert.strictEqual(h.name, 'DVD Logo');
  assert.ok(h.description.length > 0);
  assert.deepStrictEqual(h.matches, ['https://www.google.com/', 'https://www.google.com/?*', 'https://www.google.com/webhp*']);
  assert.deepStrictEqual([h.source, h.version, h.risk && h.risk.tier, h.sandboxed, h.powers], ['webmods', '3', 0, true, []]);
  assert.deepStrictEqual(sandboxLint(CODE), [], 'nothing the sandbox would refuse');
  assert.deepStrictEqual(PREINSTALLED.find((p) => p.id === 'www.google.com/dvd-logo'), { id: 'www.google.com/dvd-logo', on: false });
});

test('dvd-logo: the logo bounces inside the viewport, a new tint at every edge, never catching clicks', () => {
  const p = page();
  const d = p.dvd();
  assert.ok(d, 'the bouncing copy is on the page');
  assert.strictEqual(p.img.style('visibility'), 'hidden', 'the logo itself keeps its place, hidden');
  assert.strictEqual(d.style('pointer-events'), 'none');
  assert.strictEqual(d.style('position'), 'fixed');
  assert.match(d.style('mask'), /googlelogo_color_272x92dp\.png/);
  const frames = p.run(20);
  assert.ok(frames.every((f) => f.x >= 0 && f.x <= 1000 - 272 && f.y >= 0 && f.y <= 600 - 92), 'stays inside');
  assert.ok(frames.some((f) => f.x === 0) && frames.some((f) => f.x === 1000 - 272), 'reaches both sides');
  assert.ok(frames.some((f) => f.y === 0) && frames.some((f) => f.y === 600 - 92), 'and top and bottom');
  // The tint changes exactly on the frames that touch an edge.
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const edge = f.x === 0 || f.x === 1000 - 272 || f.y === 0 || f.y === 600 - 92;
    assert.strictEqual(f.tint !== frames[i - 1].tint, edge, `frame ${i}: ${JSON.stringify(f)}`);
  }
  assert.ok(new Set(frames.map((f) => f.tint)).size >= 4);
});

test('dvd-logo: with reduce motion the logo holds still; turning it on mid-way puts the logo back', () => {
  const still = page({ reduce: true });
  assert.strictEqual(still.dvd(), null);
  assert.strictEqual(still.img.style('visibility'), '');
  assert.deepStrictEqual(still.run(2), []);
  still.setReduce(false);
  assert.ok(still.dvd(), 'starts once the setting is off');
  const p = page();
  p.run(1);
  p.setReduce(true);
  assert.strictEqual(p.dvd(), null);
  assert.strictEqual(p.img.style('visibility'), '');
});

test('dvd-logo: a logo from elsewhere is copied and color-turned instead of masked; no logo, nothing happens', () => {
  const p = page({ src: 'https://doodles.example/doodle.gif' });
  const d = p.dvd();
  assert.strictEqual(d.style('mask'), '');
  assert.strictEqual(d.children.length, 1);
  const frames = p.run(10);
  assert.ok(frames.length > 0);
  assert.match(d.style('filter'), /hue-rotate\(\d+(\.\d+)?deg\)/);
  const none = page({ logo: false });
  assert.strictEqual(none.dvd(), null);
});

test('dvd-logo: an existing workspace gets it, switched off, from its next setup', () => {
  const home = tempDir();
  const sites = path.join(home, 'sites');
  const examples = path.join(REPO, 'examples', 'sites');
  const older = PREINSTALLED.filter((p) => p.id !== 'www.google.com/dvd-logo').map((p) => p.id);
  // As 0.1.x left it: everything else offered already.
  fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify({ offered: older, startOff: ['x.com/punk-fonts'], sitesOn: ['google.com'] }));
  const r = preinstallMods(home, sites, examples);
  assert.deepStrictEqual(r.added, ['www.google.com/dvd-logo']);
  assert.deepStrictEqual(r.on, []);
  const st = loadPreinstalled(home);
  assert.ok(st.offered.includes('www.google.com/dvd-logo'));
  assert.deepStrictEqual(st.startOff, ['x.com/punk-fonts', 'www.google.com/dvd-logo']);
  assert.strictEqual(fs.readFileSync(path.join(sites, 'www.google.com', 'dvd-logo.js'), 'utf8'), CODE);
  assert.deepStrictEqual(preinstallMods(home, sites, examples).added, [], 'offered once');
});
