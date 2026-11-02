// `trif sweep`: every instance of a kind of thing on the page, so agents change classes of things
// rather than the one or two instances the user named, and can count what's left afterwards.
//
// sweepPage runs in the page's isolated world (chrome.scripting.executeScript), which turns it into code
// by its source text: it must be self-contained, with no references to anything outside its own body
// (tests/sweep.test.js runs its source in a fresh vm context, which would catch one). It never throws:
// problems come back as {error}.

/**
 * opts: {selector?, text?, color?, tolerance? (0-255, per channel), limit? (matches returned, default 200),
 * budget? (ms, default 4000), scroll? (scroll to the bottom first, for lazy content, then back)}.
 * At least one of selector, text and color. With selector and text: elements matching the selector
 * whose text matches. With selector and color: elements using the colour inside selector matches.
 */
export async function sweepPage(opts) {
  try {
    const o = opts || {};
    const t0 = Date.now();
    const LIMIT = Math.min(Math.max(1, Math.floor(Number(o.limit)) || 200), 2000);
    const BUDGET = Math.min(Math.max(200, Number(o.budget) || 4000), 30000);
    const MAX_ELEMENTS = 100000;
    const GROUPS = 40;
    const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

    // ---- the query
    const selector = typeof o.selector === 'string' && o.selector.trim() ? o.selector.trim() : null;
    if (selector) {
      try { document.createDocumentFragment().querySelector(selector); } catch { return { error: `invalid CSS selector: ${selector}` }; }
    }
    let textRe = null;
    if (typeof o.text === 'string' && o.text !== '') {
      const m = /^\/(.+)\/([a-z]*)$/s.exec(o.text);
      try { textRe = m ? new RegExp(m[1], m[2].replace(/[gy]/g, '')) : new RegExp(o.text, 'i'); } catch (e) { return { error: `invalid regex ${o.text}: ${e.message}` }; }
    }
    const colorQuery = typeof o.color === 'string' && o.color.trim() ? o.color.trim() : null;
    if (!selector && !textRe && !colorQuery) return { error: 'nothing to look for: give a selector, text or color' };
    const tolerance = Math.min(255, Math.max(0, Number.isFinite(Number(o.tolerance)) && o.tolerance !== null && o.tolerance !== '' ? Number(o.tolerance) : 2));

    // ---- colours: computed values are mostly rgb()/rgba(); anything else is drawn on a 1x1 canvas
    let ctx2d = null;
    const canvasCtx = () => {
      if (!ctx2d) { const c = document.createElement('canvas'); c.width = 1; c.height = 1; ctx2d = c.getContext('2d', { willReadFrequently: true }); }
      return ctx2d;
    };
    const colorCache = new Map();
    const parseNum = (s, scale) => { s = s.trim(); return s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s); };
    const toRgba = (str) => {
      const key = String(str).trim().toLowerCase();
      if (colorCache.has(key)) return colorCache.get(key);
      let v = null;
      let m;
      if ((m = /^#([0-9a-f]{3,8})$/.exec(key)) && [3, 4, 6, 8].includes(m[1].length)) {
        let h = m[1];
        if (h.length <= 4) h = [...h].map((c) => c + c).join('');
        v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      } else if ((m = /^rgba?\(([^)]*)\)$/.exec(key))) {
        const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
        if (parts.length >= 3 && !parts.slice(0, 3).some((p) => p === 'none' || Number.isNaN(parseFloat(p)))) {
          v = [parseNum(parts[0], 255), parseNum(parts[1], 255), parseNum(parts[2], 255), parts[3] === undefined ? 1 : parseNum(parts[3], 1)];
        }
      } else if (key === 'transparent') {
        v = [0, 0, 0, 0];
      }
      if (!v) {
        try {
          const c = canvasCtx();
          c.fillStyle = '#010203';
          c.fillStyle = key;
          const normalized = String(c.fillStyle).toLowerCase();
          if (normalized !== '#010203' || key === '#010203') {
            if (normalized !== key && /^(#|rgba?\()/.test(normalized)) v = toRgba(normalized);
            else {
              c.clearRect(0, 0, 1, 1);
              c.fillRect(0, 0, 1, 1);
              const d = c.getImageData(0, 0, 1, 1).data;
              v = [d[0], d[1], d[2], d[3] / 255];
            }
          }
        } catch { v = null; }
      }
      colorCache.set(key, v);
      return v;
    };
    const fmt = (c) => (c[3] >= 1 ? `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})` : `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${+c[3].toFixed(3)})`);
    let target = null;
    if (colorQuery) {
      target = toRgba(colorQuery);
      if (!target) return { error: `not a CSS colour: ${colorQuery}` };
    }
    const TOKEN_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\)/gi;
    const namedRe = colorQuery && /^[a-z]+$/i.test(colorQuery) ? new RegExp(`(^|[^-\\w])${colorQuery}(?![-\\w])`, 'i') : null;
    const sameColor = (c) => !!c && c[3] > 0 && Math.abs(c[0] - target[0]) <= tolerance && Math.abs(c[1] - target[1]) <= tolerance &&
      Math.abs(c[2] - target[2]) <= tolerance && (target[3] >= 1 || Math.abs(c[3] - target[3]) <= 0.05);
    // The matching colour in a CSS value ("0 1px 2px rgba(29, 155, 240, 0.5)", a gradient), or null.
    const colorIn = (value) => {
      if (!value || value === 'none') return null;
      const tokens = String(value).match(TOKEN_RE);
      if (tokens) for (const t of tokens) { const c = toRgba(t); if (sameColor(c)) return fmt(c); }
      if (namedRe && namedRe.test(value)) return colorQuery.toLowerCase();
      return null;
    };

    // ---- walking the page: the document, open (and, where the browser lets extensions, closed) shadow
    // roots, and same-origin frames
    const shadowOf = (el) => {
      if (el.shadowRoot) return { root: el.shadowRoot, closed: false };
      try {
        const r = (globalThis.chrome && chrome.dom && chrome.dom.openOrClosedShadowRoot) ? chrome.dom.openOrClosedShadowRoot(el) : el.openOrClosedShadowRoot;
        if (r) return { root: r, closed: true };
      } catch { /* not allowed */ }
      return null;
    };
    const styleCache = new WeakMap();
    const styleOf = (el) => {
      let s = styleCache.get(el);
      if (!s) { s = (el.ownerDocument.defaultView || window).getComputedStyle(el); styleCache.set(el, s); }
      return s;
    };
    const frameOfDoc = new Map(); // a frame's document -> its <iframe> element
    const parentOf = (el) => {
      if (el.parentElement) return el.parentElement;
      const root = el.getRootNode ? el.getRootNode() : null;
      if (root && root.host) return root.host;
      if (root && frameOfDoc.has(root)) return frameOfDoc.get(root);
      return null;
    };

    // ---- describing elements
    const STABLE_CLASS = /^[a-z][a-z_-]{2,24}$/i;
    const signature = (el, pseudo) => {
      let s = el.localName;
      const role = el.getAttribute('role');
      if (role) s += `[role=${role}]`;
      const tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-qa');
      if (tid) s += `[data-testid=${clip(tid, 40)}]`;
      else {
        const cls = [...(el.classList || [])].filter((c) => STABLE_CLASS.test(c)).slice(0, 2);
        if (cls.length) s += '.' + cls.join('.');
      }
      return s + (pseudo || '');
    };
    const describe = (el) => {
      let s = el.localName;
      if (el.id) s += '#' + clip(el.id, 30);
      const cls = [...(el.classList || [])].slice(0, 3).map((c) => clip(c, 24));
      if (cls.length) s += '.' + cls.join('.');
      for (const a of ['role', 'data-testid', 'aria-label', 'href', 'name', 'type']) {
        const v = el.getAttribute(a);
        if (v) s += `[${a}=${JSON.stringify(clip(v, 40))}]`;
      }
      return s;
    };
    const textOf = (el) => clip(el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '', 70);

    // Where an element is: the closest landmark or widget around it (crossing shadow and frame
    // boundaries), memoized up the tree.
    const LANDMARK_TAGS = { header: 'header', nav: 'nav', main: 'main', aside: 'aside', footer: 'footer', dialog: 'dialog', form: 'form', menu: 'menu' };
    const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'region', 'dialog', 'alertdialog', 'menu', 'menubar', 'listbox', 'tooltip', 'tablist', 'toolbar', 'feed', 'form']);
    const ownLandmark = (el) => {
      const role = el.getAttribute('role');
      let base = null;
      if (role && LANDMARK_ROLES.has(role)) base = `[role=${role}]`;
      else if (LANDMARK_TAGS[el.localName]) base = LANDMARK_TAGS[el.localName];
      else if (el.localName === 'section' && el.hasAttribute('aria-label')) base = 'section';
      if (!base) return null;
      const label = el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.id;
      return label ? `${base} "${clip(label, 30)}"` : base;
    };
    const landmarkCache = new Map();
    const landmarkOf = (el) => {
      const path = [];
      let cur = el;
      let found = 'page';
      while (cur) {
        if (landmarkCache.has(cur)) { found = landmarkCache.get(cur); break; }
        path.push(cur);
        const own = ownLandmark(cur);
        if (own) { found = own; break; }
        cur = parentOf(cur);
      }
      for (const p of path) landmarkCache.set(p, found);
      return found;
    };
    const positionCache = new Map();
    const positionOf = (el) => {
      const path = [];
      let cur = el;
      let found = null;
      while (cur) {
        if (positionCache.has(cur)) { found = positionCache.get(cur); break; }
        path.push(cur);
        const p = styleOf(cur).position;
        if (p === 'fixed' || p === 'sticky') { found = p; break; }
        cur = parentOf(cur);
      }
      for (const p of path) positionCache.set(p, found);
      return found;
    };
    const visibleOf = (el) => {
      try {
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      } catch { /* old browser */ }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const inViewOf = (el, inFrame) => {
      if (inFrame) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };

    // ---- what matches
    const COLOR_PROPS = [
      // [property, inherited, guard(style) -> whether the property paints anything]
      ['color', true],
      ['background-color', false],
      ['background-image', false],
      ['border-top-color', false, (s) => s.borderTopStyle !== 'none' && s.borderTopStyle !== 'hidden' && parseFloat(s.borderTopWidth) > 0],
      ['border-right-color', false, (s) => s.borderRightStyle !== 'none' && s.borderRightStyle !== 'hidden' && parseFloat(s.borderRightWidth) > 0],
      ['border-bottom-color', false, (s) => s.borderBottomStyle !== 'none' && s.borderBottomStyle !== 'hidden' && parseFloat(s.borderBottomWidth) > 0],
      ['border-left-color', false, (s) => s.borderLeftStyle !== 'none' && s.borderLeftStyle !== 'hidden' && parseFloat(s.borderLeftWidth) > 0],
      ['outline-color', false, (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0],
      ['box-shadow', false],
      ['text-shadow', true],
      ['text-decoration-color', false, (s) => s.textDecorationLine && s.textDecorationLine !== 'none'],
      ['fill', true, null, true],
      ['stroke', true, (s) => s.stroke !== 'none', true],
    ];
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const colorHits = (el) => {
      const hits = [];
      const s = styleOf(el);
      const svg = el.namespaceURI === SVG_NS;
      const parent = parentOf(el);
      const ps = parent ? styleOf(parent) : null;
      for (const [prop, inherited, guard, svgOnly] of COLOR_PROPS) {
        if (svgOnly && !svg) continue;
        const v = s.getPropertyValue(prop);
        // Inherited properties count where they're set, not on every descendant that inherits them.
        if (inherited && ps && ps.getPropertyValue(prop) === v) continue;
        if (guard && !guard(s)) continue;
        const c = colorIn(v);
        if (c) hits.push({ prop, value: clip(v, 120) });
      }
      for (const pseudo of ['::before', '::after']) {
        let p;
        try { p = (el.ownerDocument.defaultView || window).getComputedStyle(el, pseudo); } catch { continue; }
        if (!p || p.content === 'none' || p.content === 'normal' || p.display === 'none') continue;
        for (const [prop, inherited, guard] of COLOR_PROPS) {
          const v = p.getPropertyValue(prop);
          if (inherited && s.getPropertyValue(prop) === v) continue;
          if (guard && !guard(p)) continue;
          if (colorIn(v)) hits.push({ prop, value: clip(v, 120), pseudo });
        }
      }
      return hits;
    };
    const ownText = (el) => {
      let t = '';
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.data;
      return t;
    };
    const ATTRS = ['aria-label', 'title', 'alt', 'placeholder'];
    const textHit = (el, whole) => {
      const t = whole ? el.textContent || '' : ownText(el);
      if (t && textRe.test(t)) return { in: whole ? 'text' : 'own text', text: clip(t, 70) };
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && textRe.test(v)) return { in: a, text: clip(v, 70) };
      }
      return null;
    };
    const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link']);

    // ---- lazy content: scroll down to the bottom, then back
    let scrolled = null;
    if (o.scroll) {
      const x0 = scrollX;
      const y0 = scrollY;
      const until = Date.now() + Math.min(15000, BUDGET * 2);
      let steps = 0;
      let lastHeight = -1;
      let still = 0;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      while (Date.now() < until && steps < 60) {
        const h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
        const atBottom = scrollY + innerHeight >= h - 2;
        if (atBottom) {
          if (h === lastHeight && ++still >= 2) break;
        } else still = 0;
        lastHeight = h;
        scrollBy(0, Math.max(200, Math.floor(innerHeight * 0.9)));
        steps++;
        await sleep(atBottom ? 600 : 250);
      }
      const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      scrollTo(x0, y0);
      await sleep(150);
      scrolled = { steps, height, ms: Date.now() - t0 };
    }

    // ---- the sweep
    const deadline = Date.now() + BUDGET;
    const out = {
      url: location.href, title: document.title,
      query: { selector, text: o.text || null, color: colorQuery, tolerance: colorQuery ? tolerance : null, scroll: !!o.scroll },
      target: target ? fmt(target) : null,
      scanned: { elements: 0, roots: 1, shadowRoots: 0, closedShadowRoots: 0, frames: 0, ms: 0 },
      scrolled, partial: null,
      skipped: { crossOriginFrames: [], unreadableSheets: [] },
      total: 0,
      summary: { visible: 0, hidden: 0, inViewport: 0, fixed: 0, sticky: 0, inShadowRoots: 0, inFrames: 0, regions: {}, props: {} },
      groups: [], matches: [], rules: null,
    };
    const groups = new Map();
    const roots = [{ root: document, where: 'document', frame: null }];
    let stop = false;
    for (let ri = 0; ri < roots.length && !stop; ri++) {
      const r = roots[ri];
      let all;
      try { all = r.root.querySelectorAll('*'); } catch { continue; }
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if ((out.scanned.elements & 255) === 0 && Date.now() > deadline) {
          out.partial = `stopped at the time limit (${BUDGET} ms) after ${out.scanned.elements} elements; narrow it with --selector, or raise --timeout`;
          stop = true;
          break;
        }
        if (out.scanned.elements >= MAX_ELEMENTS) {
          out.partial = `stopped after ${MAX_ELEMENTS} elements`;
          stop = true;
          break;
        }
        out.scanned.elements++;
        const sh = shadowOf(el);
        if (sh) {
          roots.push({ root: sh.root, where: `shadow root of ${clip(describe(el), 80)}${sh.closed ? ' (closed)' : ''}`, frame: r.frame, inShadow: true });
          out.scanned.shadowRoots++;
          if (sh.closed) out.scanned.closedShadowRoots++;
        }
        if (el.localName === 'iframe' || el.localName === 'frame') {
          let doc = null;
          try { doc = el.contentDocument; } catch { doc = null; }
          if (doc && doc.documentElement) {
            frameOfDoc.set(doc, el);
            roots.push({ root: doc, where: `frame ${clip(el.getAttribute('src') || el.name || describe(el), 80)}`, frame: el, inFrame: true });
            out.scanned.frames++;
          } else {
            let host = el.getAttribute('src') || '(no src)';
            try { host = new URL(host, location.href).host || host; } catch { /* keep */ }
            if (out.skipped.crossOriginFrames.length < 20 && !out.skipped.crossOriginFrames.includes(host)) out.skipped.crossOriginFrames.push(host);
          }
        }
        if (textRe && !selector && SKIP_TEXT.has(el.localName)) continue;

        // Does it match?
        let hit = null;
        if (selector && !colorQuery) {
          if (!el.matches(selector)) continue;
          if (textRe) { const t = textHit(el, true); if (!t) continue; hit = { text: t }; } else hit = {};
        } else if (textRe && !colorQuery) {
          const t = textHit(el, false);
          if (!t) continue;
          hit = { text: t };
        } else {
          if (selector && !el.closest(selector)) continue;
          if (textRe && !textHit(el, true)) continue;
          const hits = colorHits(el);
          if (!hits.length) continue;
          hit = { props: hits };
        }

        out.total++;
        const s = out.summary;
        const region = landmarkOf(el);
        const position = positionOf(el);
        const visible = visibleOf(el);
        const inView = visible ? inViewOf(el, !!r.inFrame) : false;
        s.regions[region] = (s.regions[region] || 0) + 1;
        if (visible) s.visible++; else s.hidden++;
        if (inView) s.inViewport++;
        if (position === 'fixed') s.fixed++;
        if (position === 'sticky') s.sticky++;
        if (r.inShadow) s.inShadowRoots++;
        if (r.inFrame) s.inFrames++;
        const props = hit.props ? [...new Set(hit.props.map((h) => h.prop.replace(/^border-\w+-color$/, 'border')))] : [];
        for (const p of props) s.props[p] = (s.props[p] || 0) + 1;
        const pseudo = hit.props && hit.props.every((h) => h.pseudo) ? hit.props[0].pseudo : '';
        const sig = signature(el, pseudo) + (props.length ? ` ${props.join(',')}` : '');
        let g = groups.get(sig);
        if (!g) {
          g = { signature: sig, count: 0, visible: 0, regions: {}, example: null };
          groups.set(sig, g);
        }
        g.count++;
        if (visible) g.visible++;
        g.regions[region] = (g.regions[region] || 0) + 1;
        const detail = out.matches.length < LIMIT || (!g.example);
        if (detail) {
          const m = {
            element: clip(describe(el), 160), text: hit.text ? hit.text.text : textOf(el), region, position, visible, inViewport: inView,
            root: r.where,
          };
          if (hit.text && hit.text.in !== 'own text') m.matchedIn = hit.text.in;
          if (hit.props) m.props = hit.props;
          if (!g.example) g.example = { element: m.element, text: m.text, region, position };
          if (out.matches.length < LIMIT) out.matches.push(m);
        }
      }
    }
    out.scanned.roots = roots.length;
    out.groups = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, GROUPS);
    out.groupCount = groups.size;

    // ---- stylesheet rules and custom properties that use the colour
    if (colorQuery) {
      const sheets = [];
      const seen = new Set();
      const addSheet = (sheet, where) => { if (sheet && !seen.has(sheet)) { seen.add(sheet); sheets.push({ sheet, where }); } };
      for (const r of roots) {
        try { for (const sh of r.root.styleSheets || []) addSheet(sh, r.where); } catch { /* none */ }
        try { for (const sh of r.root.adoptedStyleSheets || []) addSheet(sh, `${r.where} (constructed)`); } catch { /* none */ }
      }
      const rules = { total: 0, list: [], variables: [], usingVariables: { total: 0, list: [] }, sheets: sheets.length };
      const varNames = new Set();
      const allDecls = []; // [selector, prop, value, sheet] for the var() pass, bounded
      const sheetName = (sheet, where) => {
        const href = sheet.href ? clip(sheet.href.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, ''), 60) : null;
        return href || (sheet.ownerNode ? `<${sheet.ownerNode.localName}> in ${where}` : where);
      };
      const walk = (list, sheetLabel, depth) => {
        if (!list || depth > 8) return;
        for (const rule of list) {
          if (Date.now() > deadline + 2000) { out.partial = out.partial || 'stylesheets: stopped at the time limit'; return; }
          if (rule.cssRules && !rule.style) walk(rule.cssRules, sheetLabel, depth + 1);
          if (rule.styleSheet) { try { walk(rule.styleSheet.cssRules, sheetLabel, depth + 1); } catch { /* cross-origin import */ } }
          const st = rule.style;
          if (!st) continue;
          const sel = clip(rule.selectorText || rule.keyText || (rule.type === 6 ? '@page' : rule.type === 5 ? '@font-face' : '@rule'), 100);
          for (let i = 0; i < st.length; i++) {
            const prop = st[i];
            const value = st.getPropertyValue(prop);
            if (allDecls.length < 200000 && value.includes('var(--')) allDecls.push([sel, prop, value, sheetLabel]);
            if (!colorIn(value)) continue;
            if (prop.startsWith('--')) {
              if (!varNames.has(prop) && rules.variables.length < 60) rules.variables.push({ name: prop, value: clip(value, 80), selector: sel, sheet: sheetLabel });
              varNames.add(prop);
            } else {
              rules.total++;
              if (rules.list.length < 100) rules.list.push({ selector: sel, prop, value: clip(value, 100), sheet: sheetLabel });
            }
          }
          if (rule.cssRules && rule.style) walk(rule.cssRules, sheetLabel, depth + 1); // nested rules
        }
      };
      for (const { sheet, where } of sheets) {
        let list;
        try { list = sheet.cssRules; } catch {
          if (rules.unreadable === undefined) rules.unreadable = 0;
          rules.unreadable++;
          if (out.skipped.unreadableSheets.length < 20) out.skipped.unreadableSheets.push(clip(sheet.href || where, 100));
          continue;
        }
        walk(list, sheetName(sheet, where), 0);
      }
      // Variables defined with the colour, and the rules that use them (one level: var(--a) where --a is one).
      if (varNames.size) {
        const rootStyle = getComputedStyle(document.documentElement);
        for (const v of rules.variables) v.computed = clip(rootStyle.getPropertyValue(v.name), 60) || null;
        const uses = {};
        for (const [sel, prop, value, sheetLabel] of allDecls) {
          const names = (value.match(/var\(\s*(--[\w-]+)/g) || []).map((x) => x.replace(/^var\(\s*/, '')).filter((n) => varNames.has(n));
          if (!names.length) continue;
          for (const n of names) uses[n] = (uses[n] || 0) + 1;
          rules.usingVariables.total++;
          if (rules.usingVariables.list.length < 60) rules.usingVariables.list.push({ selector: sel, prop, value: clip(value, 100), sheet: sheetLabel });
        }
        for (const v of rules.variables) v.uses = uses[v.name] || 0;
      }
      out.rules = rules;
    }
    out.scanned.ms = Date.now() - t0;
    return out;
  } catch (e) {
    return { error: `sweep failed in the page: ${e && e.message ? e.message : e}` };
  }
}
