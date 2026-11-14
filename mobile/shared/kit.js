// TRIF's mobile probes: the code that runs beside a page, in a world of its own (the Safari extension's
// content world; the browser app's WKContentWorld). One classic script, no imports, nothing the page can
// reach: it installs globalThis.__trifKit, which both probes call.
//
// What's here is what the "point at it, no AI" idea needs, so the probes can say how well it holds on a
// phone: naming an element with a selector that still finds it tomorrow, hiding by selector, an outline of
// the page small enough to paste to Claude or hand an on-device model, and a tap-to-pick mode.
(() => {
  'use strict';
  if (globalThis.__trifKit) return;
  const D = document;

  // ---- naming an element ---------------------------------------------------------------------------
  // A class or id is worth naming if it reads like a name someone chose: words of letters, joined by - or _
  // (a part of digits alone is fine: col-6). Names a build tool made (css-1dbjc4n, x1lliihq, sc-bdVaJa) mix
  // letters and digits inside one part, and change with the site's next release.
  const partOk = (p) => /^\d{1,2}$/.test(p) || (/^[A-Za-z]+$/.test(p) && !(p.length <= 8 && /[a-z]/.test(p) && (p.match(/[A-Z]/g) || []).length >= 2));
  const chosen = (name) => typeof name === 'string' && name.length > 1 && name.length <= 40 && /[A-Za-z]{2}/.test(name)
    && name.split(/[-_]+/).filter(Boolean).every(partOk);
  const esc = (s) => CSS.escape(s);
  const quoted = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const count = (sel, root = D) => { try { return root.querySelectorAll(sel).length; } catch { return -1; } };
  const NAMING_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-component', 'data-type', 'role', 'aria-label', 'name', 'type', 'rel', 'itemprop'];

  /** What an element can be called by itself, best first: [selector part, how it was named]. */
  function namesOf(el) {
    const tag = el.localName;
    const out = [];
    if (el.id && chosen(el.id)) out.push([`#${esc(el.id)}`, 'id']);
    for (const a of NAMING_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length <= 60 && !/[\n\r]/.test(v) && (a.startsWith('data-') ? true : !/\d{3,}/.test(v))) out.push([`${tag}[${a}=${quoted(v)}]`, a.startsWith('data-') ? 'test id' : 'attribute']);
    }
    if (tag.includes('-')) out.push([tag, 'custom element']);
    const classes = [...el.classList].filter(chosen).slice(0, 3);
    if (classes.length) out.push([`${tag}.${classes.map(esc).join('.')}`, 'class']);
    if (classes.length > 1) out.push([`${tag}.${esc(classes[0])}`, 'class']);
    out.push([tag, 'tag']);
    return out;
  }

  /**
   * A selector for exactly this element: {selector, how, depth, matches}. `how` is the weakest kind of name
   * it had to use ("position" means nth-of-type somewhere: the kind that breaks when the page shifts).
   */
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    const rank = ['id', 'test id', 'custom element', 'attribute', 'class', 'tag', 'position'];
    let weakest = 0;
    const note = (how) => { weakest = Math.max(weakest, rank.indexOf(how)); };
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 8; depth++, node = node.parentElement) {
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
      const same = parent ? [...parent.children].filter((c) => c.localName === node.localName) : [node];
      parts.unshift(`${node.localName}:nth-of-type(${same.indexOf(node) + 1})`);
      note('position');
    }
    const selector = parts.join(' > ');
    return { selector, how: rank[weakest], depth: parts.length, matches: count(selector) };
  }

  /** A selector for this element and the ones like it (the other cards in a feed): {selector, matches}, or null. */
  function similarTo(el) {
    if (!el || !el.parentElement) return null;
    const parent = el.parentElement;
    for (const [part, how] of namesOf(el)) {
      if (how === 'id') continue;
      const sibs = [...parent.children].filter((c) => c.matches(part));
      if (sibs.length < 2) continue;
      const up = selectorFor(parent);
      if (!up) return null;
      const selector = `${up.selector} > ${part}`;
      return { selector, how, matches: count(selector) };
    }
    return null;
  }

  // ---- hiding --------------------------------------------------------------------------------------
  // Three ways to put a style rule into a page; the probes try each, since a page's own security policy can
  // refuse some of them. Here they're one call that says which way worked.
  let sheet = null, styleEl = null;
  function hide(selectors) {
    const css = selectors.filter((s) => count(s) >= 0).map((s) => `${s} { display: none !important; }`).join('\n');
    const tried = [];
    try {
      sheet = sheet || new CSSStyleSheet();
      sheet.replaceSync(css);
      if (!D.adoptedStyleSheets.includes(sheet)) D.adoptedStyleSheets = [...D.adoptedStyleSheets, sheet];
      tried.push('adopted sheet');
      return { way: 'adopted sheet', rules: sheet.cssRules.length, tried };
    } catch (e) { tried.push(`adopted sheet: ${e.message}`); }
    try {
      styleEl = styleEl || D.createElement('style');
      styleEl.textContent = css;
      if (!styleEl.isConnected) (D.head || D.documentElement).append(styleEl);
      if (styleEl.sheet && styleEl.sheet.cssRules.length) return { way: 'style element', rules: styleEl.sheet.cssRules.length, tried };
      tried.push('style element: no rules took');
    } catch (e) { tried.push(`style element: ${e.message}`); }
    return { way: null, rules: 0, tried };
  }
  /** How many elements each saved selector finds now (0 for a rule the page has outgrown). */
  const matchesOf = (selectors) => selectors.map((s) => ({ selector: s, matches: count(s) }));

  // ---- describing ----------------------------------------------------------------------------------
  const textOf = (el, max = 60) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  function describe(el) {
    const r = el.getBoundingClientRect();
    const s = selectorFor(el);
    const sim = similarTo(el);
    return {
      tag: el.localName, text: textOf(el), selector: s && s.selector, how: s && s.how, matches: s && s.matches,
      similar: sim && sim.matches > 1 ? sim : null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }

  /**
   * The page as a short outline: what's on it and what each part could be called. Lines of
   * "<indent><name> <w>x<h> “first words”", repeated siblings folded to one line with a count, stopping at
   * maxChars. Meant to fit a paste to Claude, or an on-device model's few thousand tokens.
   */
  function outline(maxChars = 6000) {
    const lines = [`${D.title || '(no title)'} | ${location.hostname}${location.pathname}`];
    let used = lines[0].length;
    const vw = innerWidth, vh = innerHeight;
    const LANDMARK = /^(header|nav|main|aside|footer|section|article|form|dialog|h[1-6]|video|iframe|table|ul|ol)$/;
    const nameOf = (el) => { const n = namesOf(el)[0]; return n[1] === 'tag' && el.localName === 'div' ? null : n[0]; };
    const big = (r) => r.width * r.height > vw * vh * 0.04;
    const walk = (el, depth) => {
      if (used >= maxChars || depth > 9) return;
      const kids = [...el.children].filter((c) => !/^(script|style|link|meta|noscript|template|svg|path|br)$/.test(c.localName));
      const seen = new Map();
      for (const c of kids) {
        if (used >= maxChars) return;
        const r = c.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) { continue; }
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const pinned = cs.position === 'fixed' || cs.position === 'sticky';
        const name = nameOf(c);
        const worth = pinned || LANDMARK.test(c.localName) || c.hasAttribute('role') || (name && big(r)) || c.localName.includes('-');
        if (!worth) { walk(c, depth); continue; }
        const key = name || c.localName;
        if (seen.has(key)) { seen.get(key).n++; continue; }
        const line = { n: 1, at: lines.length };
        seen.set(key, line);
        const text = /^(h[1-6]|nav|header|footer|form|dialog)$/.test(c.localName) || !c.children.length || pinned ? textOf(c, 50) : '';
        lines.push(`${'  '.repeat(Math.min(depth, 6))}${key}${pinned ? ` (${cs.position})` : ''} ${Math.round(r.width)}x${Math.round(r.height)}${text ? ` “${text}”` : ''}`);
        used += lines[lines.length - 1].length + 1;
        walk(c, depth + 1);
      }
      for (const { n, at } of seen.values()) if (n > 1) { lines[at] += ` ×${n}`; used += 4; }
    };
    if (D.body) walk(D.body, 0);
    const text = lines.join('\n').slice(0, maxChars);
    return { text, chars: text.length, lines: lines.length, tokens: Math.ceil(text.length / 3.6), cut: used >= maxChars };
  }

  // ---- pointing ------------------------------------------------------------------------------------
  // The marker over the chosen element: one fixed box on <html>, styled through the style object (a page's
  // policy can refuse a style attribute or a <style>, never this).
  let marker = null, chosenEl = null;
  function mark(el) {
    chosenEl = el;
    if (!el) { if (marker) marker.remove(); return null; }
    if (!marker) {
      marker = D.createElement('trif-probe-marker');
      const st = marker.style;
      st.setProperty('position', 'fixed', 'important'); st.setProperty('z-index', '2147483646', 'important');
      st.setProperty('pointer-events', 'none', 'important'); st.setProperty('box-sizing', 'border-box', 'important');
      st.setProperty('border', '3px solid #e5484d', 'important'); st.setProperty('background', 'rgba(229, 72, 77, 0.18)', 'important');
      st.setProperty('border-radius', '6px', 'important'); st.setProperty('display', 'block', 'important');
      st.setProperty('margin', '0', 'important'); st.setProperty('padding', '0', 'important');
    }
    const r = el.getBoundingClientRect();
    marker.style.setProperty('left', `${r.left}px`, 'important'); marker.style.setProperty('top', `${r.top}px`, 'important');
    marker.style.setProperty('width', `${r.width}px`, 'important'); marker.style.setProperty('height', `${r.height}px`, 'important');
    if (!marker.isConnected) D.documentElement.append(marker);
    return describe(el);
  }
  /** The element at a point of the viewport (CSS pixels), marked: its description, or null. */
  function at(x, y) {
    if (marker) marker.remove();
    let el = D.elementFromPoint(x, y);
    // (into open shadow roots, where the thing the finger is on usually is)
    for (let i = 0; el && el.shadowRoot && i < 5; i++) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    if (!el || el === D.documentElement || el === D.body) return mark(null);
    return mark(el);
  }
  /** The chosen element's parent instead (the whole card, not the picture in it). */
  const wider = () => (chosenEl && chosenEl.parentElement && chosenEl.parentElement !== D.body ? mark(chosenEl.parentElement) : chosenEl ? describe(chosenEl) : null);
  const unmark = () => { mark(null); };
  /** The first element a selector finds, marked (for a selector that came from somewhere else: a chat, a model). */
  const pick = (selector) => { let el = null; try { el = D.querySelector(selector); } catch { return null; } return el ? mark(el) : null; };

  /**
   * The page's parts and their sizes, for telling a chat what its mod did (proof of concept): the outline's
   * kind of elements, plus every field and search box, each by a selector that finds it again. At most `max`.
   */
  function layout(max = 300) {
    const out = [];
    const seen = new Set();
    const LANDMARK = /^(header|nav|main|aside|footer|section|article|form|dialog|h[1-6]|video|iframe|table|ul|ol|input|textarea|select|button)$/;
    for (const el of D.querySelectorAll('body *')) {
      if (out.length >= max) break;
      if (/^(script|style|link|meta|noscript|template|svg|path|br)$/.test(el.localName)) continue;
      const worth = LANDMARK.test(el.localName) || el.hasAttribute('role') || el.id || el.hasAttribute('data-testid') || el.hasAttribute('aria-label');
      if (!worth) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      let sel;
      try { sel = selectorFor(el).selector; } catch (e) { continue; }
      if (!sel || seen.has(sel)) continue;
      seen.add(sel);
      out.push({ sel, w: Math.round(r.width), h: Math.round(r.height), text: textOf(el, 40) });
    }
    return out;
  }

  /** What became of `before` (layout()): the parts now gone, hidden or shrunk to almost nothing. */
  function compare(before) {
    const changed = [];
    for (const b of before || []) {
      let el = null;
      try { el = D.querySelector(b.sel); } catch (e) { continue; }
      let what = null, now = '';
      if (!el) what = 'gone';
      else {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        now = `${Math.round(r.width)}x${Math.round(r.height)}`;
        if (cs.display === 'none' || cs.visibility === 'hidden') what = 'hidden';
        else if (r.width < 4 || r.height < 4) what = 'shrunk to nothing';
        else if (r.width * r.height < b.w * b.h * 0.25) what = 'much smaller';
      }
      if (what) changed.push({ sel: b.sel, what, was: `${b.w}x${b.h}`, now, text: b.text });
    }
    return changed;
  }

  globalThis.__trifKit = { selectorFor, similarTo, hide, matchesOf, describe, outline, layout, compare, at, wider, unmark, pick, chosen: () => chosenEl, count };
})();
