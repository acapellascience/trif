// "Hide this" and "Point TRIF at this" (the browser's right-click menu, background.js onMenuClick): the part
// that runs in the page, in the extension's isolated world of the top frame (put there with
// scripting.executeScript when the menu is clicked; nothing the page can reach). One classic script, no
// imports: it installs globalThis.__trifHide, which background.js calls.
//
// - Which element: Firefox says (menus.getTargetElement); Chrome doesn't, so contextpick.js, on the pages TRIF
//   has access to, keeps the last right-clicked element (and the frame the mouse last went into: a menu in a
//   frame works on the frame's element here, in the top page). Never html or body, and nothing outside body.
// - Its name, a selector that still finds it tomorrow: the iPhone probe's way (mobile/shared/kit.js on the
//   ios-poc branch), ported: a stable attribute where it has one (an id or class that reads like a name
//   someone chose, a test id, a role, an aria-label…), else its position; "like it" is the same name for its
//   siblings (the other cards of a feed), under its parent's name.
// - Hide this: hidden at once (its own style), and a bar at the bottom of the page in a closed shadow root:
//   Wider (its parent instead; never body), All N like it, Everywhere on <site> (N here) (its own name
//   without its path; the first click outlines what it would hide, then Hide them), Undo. It goes away by
//   itself, or on Escape. The
//   background saves each change in the site's "Hidden on <site>" style mod (helper/lib/hidden.js).
// - Point TRIF at this: the element described for the agent (selector, trimmed HTML, text, where it is).
(() => {
  'use strict';
  // (one from before TRIF was updated or reloaded can't reach the extension any more: replaced)
  if (globalThis.__trifHide && (() => { try { return !!chrome.runtime?.id; } catch { return false; } })()) return;
  globalThis.__trifHide?.close?.();
  const D = document;

  // ---- naming an element (kit.js) -------------------------------------------------------------------
  // A class or id is worth naming if it reads like a name someone chose: words of letters, joined by - or _
  // (a part of digits alone is fine: col-6). Names a build tool made (css-1dbjc4n, x1lliihq, sc-bdVaJa) mix
  // letters and digits inside one part, and change with the site's next release. (And none that would need
  // a backslash escape in CSS, which a style mod's selectors can't have: helper/lib/rules.js.)
  const partOk = (p) => /^\d{1,2}$/.test(p) || (/^[A-Za-z]+$/.test(p) && !(p.length <= 8 && /[a-z]/.test(p) && (p.match(/[A-Z]/g) || []).length >= 2));
  const chosen = (name) => typeof name === 'string' && name.length > 1 && name.length <= 40 && /^[A-Za-z]/.test(name) && /[A-Za-z]{2}/.test(name)
    && /^[A-Za-z0-9_-]+$/.test(name) && name.split(/[-_]+/).filter(Boolean).every(partOk);
  const quoted = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const count = (sel, root = D) => { try { return root.querySelectorAll(sel).length; } catch { return -1; } };
  const plainTag = (t) => /^[a-z][a-z0-9-]*$/.test(t);
  const NAMING_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-component', 'data-type', 'role', 'aria-label', 'name', 'type', 'rel', 'itemprop'];

  /** What an element can be called by itself, best first: [selector part, how it was named]. */
  function namesOf(el) {
    const tag = plainTag(el.localName) ? el.localName : '*';
    const out = [];
    if (el.id && chosen(el.id)) out.push([`#${el.id}`, 'id']);
    for (const a of NAMING_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length <= 60 && !/[\n\r\f]/.test(v) && (a.startsWith('data-') ? true : !/\d{3,}/.test(v))) out.push([`${tag}[${a}=${quoted(v)}]`, a.startsWith('data-') ? 'test id' : 'attribute']);
    }
    if (tag.includes('-')) out.push([tag, 'custom element']);
    const classes = [...el.classList].filter(chosen).slice(0, 3);
    if (classes.length) out.push([`${tag}.${classes.join('.')}`, 'class']);
    if (classes.length > 1) out.push([`${tag}.${classes[0]}`, 'class']);
    out.push([tag, 'tag']);
    return out;
  }

  /**
   * A selector for exactly this element: {selector, how, depth, matches}. `how` is the weakest kind of name
   * it had to use ("position" means nth-of-type somewhere: the kind that breaks when the page shifts).
   * Null for html, body, and what isn't an element.
   */
  function selectorFor(el) {
    if (!el || el.nodeType !== 1 || el === D.documentElement || el === D.body) return null;
    const rank = ['id', 'test id', 'custom element', 'attribute', 'class', 'tag', 'position'];
    let weakest = 0;
    const note = (how) => { weakest = Math.max(weakest, rank.indexOf(how)); };
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 40; depth++, node = node.parentElement) {
      if (node === D.documentElement) { parts.unshift('html'); break; }
      if (node === D.body) { parts.unshift('body'); break; }
      // first, a name that finds this node alone in the whole page (with what's below it)
      let done = false;
      for (const [part, how] of namesOf(node)) {
        const whole = [part, ...parts].join(' > ');
        if (count(whole) === 1) { parts.unshift(part); note(how); done = true; break; }
      }
      if (done) return { selector: parts.join(' > '), how: rank[weakest], depth, matches: 1 };
      // otherwise the best name among its siblings, by position if they share it
      const parent = node.parentElement;
      const [part, how] = namesOf(node).find(([p]) => parent && [...parent.children].filter((c) => c.matches(p)).length === 1) || [null, null];
      if (part) { parts.unshift(part); note(how); continue; }
      if (!plainTag(node.localName)) {
        parts.unshift(`*:nth-child(${(parent ? [...parent.children].indexOf(node) : 0) + 1})`);
      } else {
        const same = parent ? [...parent.children].filter((c) => c.localName === node.localName) : [node];
        parts.unshift(`${node.localName}:nth-of-type(${same.indexOf(node) + 1})`);
      }
      note('position');
    }
    const selector = parts.join(' > ');
    return { selector, how: rank[weakest], depth: parts.length, matches: count(selector) };
  }

  /** A selector for this element and the ones like it (the other cards in a feed): {selector, how, matches}, or null. */
  function similarTo(el) {
    if (!el || !el.parentElement) return null;
    const parent = el.parentElement;
    for (const [part, how] of namesOf(el)) {
      if (how === 'id') continue;
      const sibs = [...parent.children].filter((c) => c.matches(part));
      if (sibs.length < 2) continue;
      const up = parent === D.body ? { selector: 'body' } : selectorFor(parent);
      if (!up) return null;
      const selector = `${up.selector} > ${part}`;
      return { selector, how, matches: count(selector) };
    }
    return null;
  }

  /** "All N like it", where it makes sense: more than one, not every part of the page, and this one among them. */
  const SIMILAR_MAX = 500;
  function likeIt(el) {
    if (!el || !el.parentElement || el.parentElement === D.body || el.parentElement === D.documentElement) return null;
    const s = similarTo(el);
    if (!s || s.matches < 2 || s.matches > SIMILAR_MAX) return null;
    // (by its tag alone, only in a list of those: every sibling the same tag, three or more, as a feed's items
    // are; not the ad among a card's other parts)
    if (s.how === 'tag') { const kids = [...el.parentElement.children]; if (kids.length < 3 || kids.some((c) => c.localName !== el.localName)) return null; }
    try { if (!el.matches(s.selector)) return null; } catch { return null; }
    return s;
  }

  /**
   * "Everywhere on <site>": the element by its own name, without its path, so it's hidden wherever that name
   * turns up on the site: the first of its names that's a test id, an aria-label or itemprop, a custom
   * element or a readable class; never a bare tag, an id, a position, or a generic attribute (role, type,
   * name, rel). {selector, how, matches: how many on this page}, or null.
   */
  function everywhere(el) {
    if (!el || el.nodeType !== 1) return null;
    for (const [part, how] of namesOf(el)) {
      if (how === 'tag' || how === 'id' || part.startsWith('*')) continue;
      if (how === 'attribute' && !/\[(aria-label|itemprop)=/.test(part)) continue;
      const n = count(part);
      if (n >= 1) return { selector: part, how, matches: n };
    }
    return null;
  }

  // ---- which element --------------------------------------------------------------------------------

  /** What a menu click is about: an element under body (inside an svg, the svg; html, body: none). */
  function usable(el) {
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el) return null;
    for (let up = el.parentElement; up; up = up.parentElement) if (up.localName === 'svg') el = up;
    if (!D.body || el === D.body || el === D.documentElement || !D.body.contains(el)) return null;
    return el;
  }

  /**
   * The element the menu was opened on. `targetElementId`: Firefox's (menus.getTargetElement), for a menu
   * in the top frame; `inFrame`: the menu was in a frame, so the frame's element here.
   */
  function target({ targetElementId = null, inFrame = false } = {}) {
    const rec = globalThis.__trifContext || {};
    if (inFrame) return usable(rec.frame || null);
    if (targetElementId != null) {
      const menus = globalThis.browser?.menus || globalThis.browser?.contextMenus;
      try { const el = menus?.getTargetElement?.(targetElementId); if (el) return usable(el); } catch { /* not this frame's */ }
    }
    // (contextpick.js: the last right-click, if it was a moment ago)
    if (rec.target && Date.now() - (rec.at || 0) < 120000) return usable(rec.target);
    return null;
  }

  // ---- hiding: the bar ------------------------------------------------------------------------------
  const BAR_MS = 9000; // (how long the bar stays without being touched)
  let bar = null;

  const CSS_TEXT = `
:host { all: initial; }
.bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483647;
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; padding: 6px; max-width: calc(100vw - 24px); box-sizing: border-box;
  border: 1px solid #e4e4e1; border-radius: 12px; background: #ffffff; color: #1d1d1f;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);
  font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.robot { width: 18px; height: 18px; margin: 0 2px 0 4px; flex: none; }
button { font: inherit; font-size: 12px; color: inherit; padding: 4px 10px; border: 1px solid #e4e4e1; border-radius: 7px;
  background: #f1f1ef; cursor: pointer; white-space: nowrap; }
button:hover { border-color: #9a9a9f; }
button:focus-visible { outline: 2px solid #1f8a5b; outline-offset: 1px; }
button:disabled { opacity: .45; cursor: default; border-color: #e4e4e1; }
button.undo { background: #34d399; border-color: transparent; color: #04291c; font-weight: 600; }
button.undo:hover { background: #2cb985; }
.err { max-width: 360px; padding: 0 6px; color: #c2512d; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .bar { border-color: #323236; background: #212124; color: #ececee; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
  button { border-color: #323236; background: #2a2a2e; }
  button:hover { border-color: #6f6f75; }
  button:focus-visible { outline-color: #34d399; }
  button:disabled { border-color: #323236; }
  .err { color: #f0866a; }
}`;
  // (the robot, drawn here: no markup parsed, whatever the page's policy on that)
  function robot() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = D.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'robot'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => { const x = D.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v); svg.append(x); };
    add('rect', { x: 4, y: 6, width: 16, height: 13, rx: 4, fill: '#34d399' });
    add('circle', { cx: 9.5, cy: 12.5, r: 1.6, fill: '#04291c' });
    add('circle', { cx: 14.5, cy: 12.5, r: 1.6, fill: '#04291c' });
    add('rect', { x: 11.2, y: 2.5, width: 1.6, height: 3.5, rx: 0.8, fill: '#34d399' });
    return svg;
  }

  function styleRoot(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch { /* (an older engine, or a world that can't adopt one: a style element) */ }
    const st = D.createElement('style');
    st.textContent = CSS_TEXT;
    root.append(st);
  }

  // The element's own style, so it's hidden at once whatever the page's CSS says (the saved style mod hides it
  // from the next load on; the background puts the same rule in the page meanwhile).
  function hideEls(b, sel) {
    let els = [];
    try { els = [...D.querySelectorAll(sel)]; } catch { return; }
    for (const el of els) {
      if (el === D.body || el === D.documentElement || b.hidden.some((h) => h[0] === el) || kept.some((h) => h[0] === el)) continue;
      b.hidden.push([el, el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]);
      el.style.setProperty('display', 'none', 'important');
    }
  }
  function showEls(b) {
    for (const [el, v, p] of b.hidden) { if (v) el.style.setProperty('display', v, p); else el.style.removeProperty('display'); }
    b.hidden.length = 0;
  }

  // The boxes over everything a selector finds, before hiding it everywhere (at most 200).
  let previewBox = null;
  function preview(selector) {
    if (previewBox) { previewBox.remove(); previewBox = null; }
    if (!selector) return 0;
    let els = [];
    try { els = [...D.querySelectorAll(selector)].slice(0, 200); } catch { return 0; }
    previewBox = D.createElement('trif-hide-preview');
    previewBox.style.setProperty('all', 'initial', 'important');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const x = D.createElement('trif-hide-mark');
      for (const [k, v] of [['all', 'initial'], ['position', 'fixed'], ['z-index', '2147483646'], ['pointer-events', 'none'], ['box-sizing', 'border-box'],
        ['border', '2px solid #f0866a'], ['background', 'rgba(240, 134, 106, 0.18)'], ['border-radius', '6px'], ['display', 'block'],
        ['left', `${r.left}px`], ['top', `${r.top}px`], ['width', `${r.width}px`], ['height', `${r.height}px`]]) x.style.setProperty(k, v, 'important');
      previewBox.append(x);
    }
    D.documentElement.append(previewBox);
    return els.length;
  }

  function arm(b) {
    clearTimeout(b.timer);
    if (!b.hover) b.timer = setTimeout(() => close(b), BAR_MS);
  }

  // What closed bars hid with the element's own style, kept so it can all come back without a reload
  // (reveal: the hidden mod switched off or gone, background.js syncPageHides).
  let kept = [];
  function reveal() {
    if (bar) { showEls(bar); close(bar); }
    showEls({ hidden: kept });
    kept = [];
    return true;
  }

  function close(b) {
    if (!b || b.closed) return;
    b.closed = true;
    preview(null);
    kept.push(...b.hidden);
    b.hidden = [];
    clearTimeout(b.timer);
    removeEventListener('keydown', b.onKey, true);
    b.host.remove();
    if (bar === b) bar = null;
  }

  function render(b) {
    const like = b.mode === 'one' ? likeIt(b.el) : null;
    const up = b.el.parentElement;
    b.wider.disabled = b.busy || !up || up === D.body || up === D.documentElement;
    b.all.hidden = !like;
    b.all.disabled = b.busy;
    if (like) b.all.textContent = `All ${like.matches} like it`;
    b.undo.disabled = b.busy;
    b.like = like;
    // (Everywhere on <site>: the first click shows what it would hide, the second hides them)
    const ev = b.mode === 'everywhere' ? null : everywhere(b.el);
    b.ev = ev && ev.selector !== b.sel ? ev : null;
    b.every.hidden = !b.ev;
    b.every.disabled = b.busy;
    if (!b.ev) b.previewing = false;
    if (b.ev) b.every.textContent = b.previewing ? 'Hide them' : `Everywhere on ${b.site} (${b.ev.matches} here)`;
    if (!b.previewing) preview(null);
  }

  const send = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r || {})); } catch (e) { resolve({ error: String(e?.message ?? e) }); }
  });

  // A change the bar makes: hidden here at once, then saved; if saving fails, the way it was, and why.
  async function change(b, next) {
    if (b.busy || b.closed) return;
    const before = { el: b.el, sel: b.sel, mode: b.mode };
    b.previewing = false;
    b.busy = true;
    b.err.hidden = true;
    showEls(b);
    Object.assign(b, next);
    hideEls(b, b.sel);
    render(b);
    const r = await send({ type: 'hide.set', token: b.token, selector: b.sel });
    b.busy = false;
    if (r?.error) {
      showEls(b);
      Object.assign(b, before);
      hideEls(b, b.sel);
      failed(b.token, r.error, { keep: true });
    }
    render(b);
    arm(b);
  }

  function showBar(token, el, sel, site) {
    if (bar) close(bar);
    const host = D.createElement('trif-hide-bar');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('display', 'block', 'important');
    const root = host.attachShadow({ mode: 'closed' });
    styleRoot(root);
    const box = D.createElement('div');
    box.className = 'bar';
    box.setAttribute('role', 'toolbar');
    box.append(robot());
    const btn = (text, cls = '') => { const x = D.createElement('button'); x.type = 'button'; x.textContent = text; if (cls) x.className = cls; return x; };
    const b = { token, host, el, sel, site: String(site || location.hostname), mode: 'one', hidden: [], timer: null, hover: false, busy: false, closed: false,
      wider: btn('Wider'), all: btn('All 2 like it'), every: btn('Everywhere'), undo: btn('Undo', 'undo'), err: D.createElement('span'), like: null, ev: null, previewing: false };
    b.err.className = 'err';
    b.err.hidden = true;
    box.append(b.wider, b.all, b.every, b.undo, b.err);
    root.append(box);
    b.act = {
      wider() {
        const up = b.el.parentElement;
        if (!up || up === D.body || up === D.documentElement) return;
        const s = selectorFor(up);
        if (s) change(b, { el: up, sel: s.selector, mode: 'one' });
      },
      all() { if (b.like) change(b, { sel: b.like.selector, mode: 'all' }); },
      every() {
        if (!b.ev || b.busy) return;
        if (!b.previewing) { b.previewing = true; preview(b.ev.selector); render(b); arm(b); return; }
        change(b, { sel: b.ev.selector, mode: 'everywhere' });
      },
      async undo() {
        if (b.busy) return;
        b.busy = true;
        b.previewing = false;
        showEls(b);
        render(b);
        const r = await send({ type: 'hide.undo', token: b.token });
        b.busy = false;
        if (r?.error) { hideEls(b, b.sel); failed(b.token, r.error, { keep: true }); render(b); arm(b); return; }
        close(b);
      },
    };
    // (only the user's own clicks: a page can't reach a closed shadow root, and its synthetic events aren't trusted)
    for (const name of ['wider', 'all', 'every', 'undo']) b[name].addEventListener('click', (e) => { if (e.isTrusted) b.act[name](); });
    box.addEventListener('pointerenter', () => { b.hover = true; clearTimeout(b.timer); });
    box.addEventListener('pointerleave', () => { b.hover = false; arm(b); });
    b.onKey = (e) => { if (e.key === 'Escape' && e.isTrusted) close(b); };
    addEventListener('keydown', b.onKey, true);
    D.documentElement.append(host);
    bar = b;
    hideEls(b, sel);
    render(b);
    arm(b);
    return b;
  }

  /**
   * Hide this: the element the menu was on, hidden, and the bar. Returns {selector, matches, how} or {error}.
   * `token`: the background's for this bar, sent back with each change.
   */
  function start({ token, site = '', targetElementId = null, inFrame = false } = {}) {
    const el = target({ targetElementId, inFrame });
    if (!el) return { error: 'no element' };
    const s = selectorFor(el);
    if (!s || s.matches !== 1) return { error: 'no selector' };
    showBar(String(token || ''), el, s.selector, site);
    return { selector: s.selector, matches: s.matches, how: s.how };
  }

  /** Saving failed (the background says): shown again, and why, in the bar; it goes once read. */
  function failed(token, message, { keep = false } = {}) {
    const b = bar;
    if (!b || b.token !== token) return false;
    if (!keep) { showEls(b); b.wider.hidden = true; b.all.hidden = true; b.undo.hidden = true; }
    b.err.textContent = String(message || '').slice(0, 300);
    b.err.hidden = false;
    arm(b);
    return true;
  }

  /** The bar's element, while it shows (the e2e reads it). */
  const state = () => (bar ? { selector: bar.sel, mode: bar.mode, like: bar.like ? bar.like.matches : 0, hidden: bar.hidden.length, wider: !bar.wider.disabled,
    buttons: [bar.wider, bar.all, bar.every, bar.undo].filter((x) => !x.hidden).map((x) => x.textContent), previewing: bar.previewing,
    marks: previewBox ? previewBox.children.length : 0, error: bar.err.hidden ? '' : bar.err.textContent } : null);

  /** The bar's buttons, for the e2e (a click it makes isn't the user's, so it would be ignored). Only TRIF's own world reaches this. */
  const press = (name) => { if (!bar || !bar.act[name]) return false; const x = bar[name]; if (x.hidden || x.disabled || bar.busy) return false; bar.act[name](); return true; };

  // ---- pointing ------------------------------------------------------------------------------------
  const textOf = (el, max) => (el.innerText || el.textContent || '').replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max);
  const HTML_MAX = 4000;
  const TEXT_MAX = 1500;

  /** The element's HTML for the agent: scripts and styles left out, long attribute values and svg drawings cut, at most HTML_MAX characters. */
  function trimmedHtml(el) {
    const copy = el.cloneNode(true);
    for (const x of copy.querySelectorAll('script, style, noscript, template')) x.remove();
    for (const x of [copy, ...copy.querySelectorAll('*')]) {
      if (x.localName === 'svg') x.replaceChildren();
      for (const a of [...x.attributes]) if (a.value.length > 200) x.setAttribute(a.name, `${a.value.slice(0, 120)}…`);
    }
    const html = copy.outerHTML.replace(/\s{2,}/g, ' ');
    return html.length > HTML_MAX ? `${html.slice(0, HTML_MAX)}… (${html.length - HTML_MAX} more characters)` : html;
  }

  /** What the panel's pill says: the element's own words, in quotes, or its tag. */
  function label(el) {
    const own = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '';
    const words = (own || textOf(el, 200)).replace(/\s+/g, ' ').trim();
    if (words) return `“${words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words}”`;
    return `<${el.localName}>`;
  }

  /**
   * Point TRIF at this: the element, described for the agent. Returns {label, selector, matches, how, tag,
   * html, text, rect: page CSS px, view: its box in the viewport, viewport: {w, h}} or {error}. (The
   * background takes the screenshot next, then flashes an outline on it: flash(view).)
   */
  function point({ targetElementId = null, inFrame = false } = {}) {
    const el = target({ targetElementId, inFrame });
    if (!el) return { error: 'no element' };
    const s = selectorFor(el);
    const r = el.getBoundingClientRect();
    return {
      label: label(el), selector: s ? s.selector : null, matches: s ? s.matches : 0, how: s ? s.how : null, tag: el.localName,
      html: trimmedHtml(el), text: textOf(el, TEXT_MAX),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      view: { x: r.left, y: r.top, w: r.width, h: r.height },
      viewport: { w: D.documentElement.clientWidth || innerWidth, h: D.documentElement.clientHeight || innerHeight },
    };
  }

  /** An outline on the pointed element for a moment, so the user sees what was taken. */
  function flash(r) {
    if (!r || !(r.w > 0 || r.width > 0)) return false;
    r = { left: r.left ?? r.x, top: r.top ?? r.y, width: r.width ?? r.w, height: r.height ?? r.h };
    const m = D.createElement('trif-point-mark');
    const st = m.style;
    const set = (k, v) => st.setProperty(k, v, 'important');
    set('all', 'initial'); set('position', 'fixed'); set('z-index', '2147483646'); set('pointer-events', 'none'); set('box-sizing', 'border-box');
    set('display', 'block'); set('border', '2px solid #34d399'); set('border-radius', '6px'); set('background', 'rgba(52, 211, 153, 0.12)');
    set('left', `${r.left - 2}px`); set('top', `${r.top - 2}px`); set('width', `${r.width + 4}px`); set('height', `${r.height + 4}px`);
    set('transition', 'opacity .4s');
    D.documentElement.append(m);
    setTimeout(() => { set('opacity', '0'); setTimeout(() => m.remove(), 450); }, 700);
    return true;
  }

  globalThis.__trifHide = { selectorFor, similarTo, likeIt, everywhere, preview, namesOf, usable, target, start, failed, close: () => close(bar), reveal, state, press, point, flash, label, trimmedHtml };
})();
