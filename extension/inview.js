// "What you're looking at now": the note each message sent from the side panel carries (Tim, 11-21: he scrolled
// to the problem, said "look, I've scrolled to it", and the agent took a screenshot and then searched the whole
// page by name). Captured as Send is pressed, from the panel's tab (the phone view's, in the phone view):
//   - a screenshot of exactly the visible viewport (screenshot.js, the way `trif screenshot` takes one), saved in
//     the run's screenshots folder by the helper (helper/lib/inview.js); never on a sensitive site;
//   - an outline of the elements in the viewport, each with a selector `trif run` / page.find take (inViewPage,
//     its naming rules mobile/shared/kit.js's), capped at a few KB, with the scroll position and viewport size;
//   - the selection, if the person has text selected on the page: its text and its element's selector.
// Only where TRIF lets a run read that page ("Agent on this site" not Off); on a sensitive site, no picture
// whatever the level. background.js captures it (captureInView with its deps) and puts it after the message
// (withInView), for a run's first message, a message that waited, and one written into a working run.
//
// inViewPage runs in the page's isolated world (chrome.scripting.executeScript), which turns it into code by its
// source text: it must be self-contained (tests/inview.test.js runs its source in a bare vm context). The rest
// is pure, for background.js and the tests.

export const IN_VIEW_HEADER = '--- In view when I sent this ---';
export const IN_VIEW_FOOTER = '--- End of what was in view ---';
export const OUTLINE_MAX = 3500; // characters of outline lines (the note's other lines are a few hundred more)
export const NOTES_MAX = 3; // notes kept with one message made of several that waited (the latest ones)

/**
 * The elements in the viewport, for the note. opts: {maxChars (the outline's cap, to pick how many to name),
 * budget (ms for the walk and the naming)}. Returns {url, title, vw, vh, dpr, sx, sy, pw, ph, scroller, entries,
 * selection, ms, partial, scanned} or {error}. Each entry: {sel, word, text, top, bottom, left, p (1 first: what's
 * cut last), parent (index of the nearest entry around it, or -1), selected?}.
 */
export function inViewPage(opts) {
  try {
    const o = opts || {};
    const t0 = performance.now();
    const MAX = Math.min(Math.max(Number(o.maxChars) || 3500, 300), 12000);
    const BUDGET = Math.min(Math.max(Number(o.budget) || 160, 10), 3000);
    const late = () => performance.now() - t0 > BUDGET;
    const D = document;
    const root = D.documentElement;
    const vw = root.clientWidth || innerWidth;
    const vh = root.clientHeight || innerHeight;
    const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

    // ---- naming an element: mobile/shared/kit.js's rules (namesOf, chosen), kept the same
    const partOk = (p) => /^\d{1,2}$/.test(p) || (/^[A-Za-z]+$/.test(p) && !(p.length <= 8 && /[a-z]/.test(p) && (p.match(/[A-Z]/g) || []).length >= 2));
    const chosen = (name) => typeof name === 'string' && name.length > 1 && name.length <= 40 && /[A-Za-z]{2}/.test(name)
      && name.split(/[-_]+/).filter(Boolean).every(partOk);
    const esc = (s) => CSS.escape(s);
    const quoted = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const counts = new Map();
    const count = (sel) => {
      if (counts.has(sel)) return counts.get(sel);
      let n;
      try { n = D.querySelectorAll(sel).length; } catch { n = -1; }
      counts.set(sel, n);
      return n;
    };
    const NAMING_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-component', 'data-type', 'role', 'aria-label', 'name', 'type', 'rel', 'itemprop'];
    const namesOf = (el) => {
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
    };
    // A name that finds this element alone in the page (memoized: entries share their ancestors), or null.
    const UNIQUE_TAGS = new Set(['main', 'header', 'footer', 'nav', 'aside', 'h1']);
    const alone = new Map();
    const uniqueName = (el) => {
      if (alone.has(el)) return alone.get(el);
      let found = null;
      for (const [part, how] of namesOf(el)) {
        if (how === 'tag' && !UNIQUE_TAGS.has(el.localName)) continue;
        if (count(part) === 1) { found = part; break; }
      }
      alone.set(el, found);
      return found;
    };
    // Its best name among its siblings; by position (nth-of-type) when they share every name.
    const stepOf = (el) => {
      const parent = el.parentElement;
      const names = namesOf(el);
      if (!parent) return names[0][0];
      const sibs = [...parent.children];
      for (const [part] of names) {
        let n = 0;
        for (const c of sibs) { if (c.matches(part)) n++; if (n > 1) break; }
        if (n === 1) return part;
      }
      const same = sibs.filter((c) => c.localName === el.localName);
      const best = names.find(([, how]) => how !== 'tag');
      return `${best ? best[0] : el.localName}:nth-of-type(${same.indexOf(el) + 1})`;
    };
    // A selector for exactly this element: up from it to the nearest ancestor with a name of its own (or body),
    // child steps on the way; then as short as it can be and still find it alone: the unnamed steps left out,
    // then each named one but its own, one at a time (each try checked against the page).
    const selectorFor = (el) => {
      const parts = [];
      let node = el;
      for (let depth = 0; node && depth < 40; depth++, node = node.parentElement) {
        if (node === D.body) { parts.unshift('body'); break; }
        if (node === root) { parts.unshift('html'); break; }
        const own = uniqueName(node);
        if (own) { parts.unshift(own); break; }
        parts.unshift(stepOf(node));
      }
      if (!node) return null; // (not in the document any more)
      const strict = parts.join(' > ');
      if (parts.length < 2) return strict;
      const finds = (list) => { try { const a = D.querySelectorAll(list.join(' ')); return a.length === 1 && a[0] === el; } catch { return false; } };
      let best = parts.filter((p, i) => i === 0 || i === parts.length - 1 || /[[#.:]/.test(p) || p.includes('-'));
      if (!finds(best)) return strict;
      for (let i = best.length - 2; i >= 0 && !late(); i--) {
        const t = [...best.slice(0, i), ...best.slice(i + 1)];
        if (finds(t)) best = t;
      }
      const short = best.join(' ');
      return short.length < strict.length ? short : strict;
    };

    // ---- what's in the viewport
    const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'br', 'head', 'title', 'trif-probe-marker']);
    const REGION_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'dialog', 'form', 'menu']);
    const REGION_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'region', 'dialog', 'alertdialog', 'menu', 'menubar', 'listbox', 'tablist', 'toolbar', 'feed', 'form', 'grid', 'tree', 'table']);
    const ITEM_ROLES = new Set(['article', 'listitem', 'row', 'treeitem', 'cell', 'gridcell']);
    const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'switch', 'radio', 'slider']);
    const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
    const TEXT_TAGS = new Set(['p', 'span', 'div', 'td', 'th', 'li', 'label', 'time', 'blockquote', 'pre', 'code', 'dd', 'dt', 'figcaption', 'strong', 'em', 'b', 'i', 'small', 'summary', 'caption', 'legend', 'cite', 'q', 'mark']);
    const labelOf = (el) => el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
    const ownText = (el) => { let t = ''; for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.data; return t.trim(); };
    // [word, priority] for an element worth a line, or null. Priority 1 is cut last.
    const kindOf = (el) => {
      const tag = el.localName;
      const role = el.getAttribute('role');
      if (REGION_TAGS.has(tag) || (role && REGION_ROLES.has(role)) || (tag === 'section' && el.hasAttribute('aria-label'))) return [role || tag, 1];
      if (/^h[1-6]$/.test(tag) || role === 'heading') return ['heading', 1];
      if (tag === 'article' || (role && ITEM_ROLES.has(role))) return [role || 'article', 1];
      if (tag === 'input') return el.type === 'hidden' ? null : [`${el.type || 'text'} field`, 2];
      if (tag === 'textarea' || tag === 'select' || (role && FIELD_ROLES.has(role)) || el.getAttribute('contenteditable') === 'true') return [tag === 'select' ? 'menu' : 'text field', 2];
      if (tag === 'button' || (role && CONTROL_ROLES.has(role))) return [role || 'button', 3];
      if (tag === 'a' && el.hasAttribute('href')) return ['link', 3];
      if (tag === 'img' || role === 'img') return labelOf(el).trim().length >= 2 ? ['image', 3] : null;
      if (tag === 'video' || tag === 'iframe' || tag === 'canvas' || tag === 'table') return [tag, 2];
      if (el.hasAttribute('data-testid') || el.hasAttribute('data-test') || el.hasAttribute('data-test-id') || el.hasAttribute('data-qa')) return ['', 2];
      if (tag.includes('-') && !el.closest('svg')) return [tag, 3];
      if (TEXT_TAGS.has(tag) && ownText(el).length >= 2) return ['', 4];
      return null;
    };
    // The first words of an element's text, without reading all of a big one.
    const textOf = (el, max) => {
      let t = '';
      const w = D.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && SKIP.has(n.parentElement.localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      for (let n = w.nextNode(); n && t.length < max * 2; n = w.nextNode()) { const d = n.data.replace(/\s+/g, ' '); if (d.trim()) t += (t && !/\s$/.test(t) && !/^\s/.test(d) ? ' ' : '') + d; }
      return clip(t, max);
    };

    const all = D.body ? D.body.getElementsByTagName('*') : [];
    const cands = [];
    const index = new Map();
    let scanned = 0;
    let partial = false;
    for (let i = 0; i < all.length; i++) {
      if ((i & 255) === 0 && late()) { partial = true; break; }
      const el = all[i];
      scanned++;
      if (SKIP.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
      const kind = kindOf(el);
      if (!kind) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
      try { if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue; } catch { /* old browser */ }
      // (its parent entry: the nearest candidate around it)
      let parent = -1;
      for (let p = el.parentElement; p; p = p.parentElement) { const k = index.get(p); if (k !== undefined) { parent = k; break; } }
      const region = kind[1] === 1 && kind[0] !== 'heading' && kind[0] !== 'article';
      const label = clip(labelOf(el), 60);
      const text = region ? '' : kind[1] === 4 ? clip(ownText(el), 70) : textOf(el, kind[0] === 'article' || kind[0] === 'heading' ? 90 : 70);
      const c = { el, word: kind[0], p: kind[1], parent, label, text, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
      // (a wrapper with no name of its own and nothing the entry around it doesn't say: not worth a line)
      const up = parent >= 0 ? cands[parent] : null;
      const named = el.hasAttribute('data-testid') || el.hasAttribute('data-test') || el.hasAttribute('data-test-id') || el.hasAttribute('data-qa') || (el.id && chosen(el.id));
      if (up && c.p >= 2 && !c.label && !c.word && !named && (!c.text || (up.text && up.text.includes(c.text.replace(/…$/, ''))))) continue;
      if (named && !c.text && !c.label && c.p >= 2 && !c.word) continue;
      if (c.p === 4 && up && up.text && up.text.includes(c.text.replace(/…$/, ''))) continue;
      if (!c.text && !c.label && c.p >= 3) continue;
      index.set(el, cands.length);
      cands.push(c);
    }

    // ---- the selection: its text and the element around it (a field's own selection too, never a password's)
    let selection = null;
    try {
      const a = D.activeElement;
      if (a && (a.localName === 'textarea' || (a.localName === 'input' && /^(text|search|url|email|tel|)$/.test(a.type || ''))) && a.selectionEnd > a.selectionStart) {
        selection = { text: clip(a.value.slice(a.selectionStart, a.selectionEnd), 500), el: a, field: true };
      } else {
        const s = getSelection();
        const t = s && !s.isCollapsed ? String(s).replace(/\s+/g, ' ').trim() : '';
        if (t) {
          let n = s.getRangeAt(0).commonAncestorContainer;
          if (n && n.nodeType !== 1) n = n.parentElement;
          if (n && n.closest && !n.closest('input[type=password]')) selection = { text: clip(t, 500), el: n, field: false };
        }
      }
    } catch { selection = null; }
    if (selection) {
      const k = index.get(selection.el);
      if (k !== undefined) cands[k].selected = true;
      else {
        // (the nearest entry around it is marked; the selection's own element gets its own selector below)
        for (let p = selection.el.parentElement; p; p = p.parentElement) { const j = index.get(p); if (j !== undefined) { cands[j].holdsSelection = true; break; } }
      }
    }

    // ---- which get named: by priority, then top to bottom, until about the outline's cap (naming is the costly part)
    const order = cands.map((c, i) => i).sort((a, b) => cands[a].p - cands[b].p || a - b);
    const picked = new Set();
    let est = 0;
    for (const i of order) {
      const c = cands[i];
      const len = 60 + (c.text || c.label).length + 14;
      if (est + len > MAX * 1.15 && !c.selected && !c.holdsSelection) continue;
      est += len;
      picked.add(i);
    }
    const entries = [];
    const named = new Map(); // candidate index -> entry index
    for (const i of order) {
      if (!picked.has(i)) continue;
      if (late() && !cands[i].selected) { partial = true; continue; }
      let sel = null;
      try { sel = selectorFor(cands[i].el); } catch { sel = null; }
      if (!sel || sel.length > 300) continue;
      named.set(i, true);
      cands[i].sel = sel;
    }
    // (document order; each entry's parent: the nearest named entry around it)
    const entryIndex = new Map();
    cands.forEach((c, i) => {
      if (!c.sel) return;
      let parent = c.parent;
      while (parent >= 0 && !cands[parent].sel) parent = cands[parent].parent;
      const e = { sel: c.sel, word: c.word, text: c.text || c.label, top: c.top, bottom: c.bottom, left: c.left, p: c.p, parent: parent >= 0 ? entryIndex.get(parent) : -1 };
      if (c.label && c.text && c.label !== c.text && !c.sel.includes(c.label)) e.label = c.label;
      if (c.selected) e.selected = true;
      if (c.holdsSelection) e.holdsSelection = true;
      entryIndex.set(i, entries.length);
      entries.push(e);
    });
    let sel = null;
    if (selection) {
      let s = null;
      try { s = selectorFor(selection.el); } catch { s = null; }
      sel = { text: selection.text, selector: s, field: selection.field };
    }

    // ---- where the page is scrolled: the window, or the scroller under the middle of the viewport (a web app's
    // feed often scrolls a box of its own, not the page)
    let scroller = null;
    try {
      if (!scrollY) {
        for (let n = D.elementFromPoint(vw / 2, vh / 2); n && n !== D.body && n !== root; n = n.parentElement) {
          if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight + 4) { scroller = { sel: selectorFor(n), y: Math.round(n.scrollTop), height: n.scrollHeight }; break; }
        }
      }
    } catch { scroller = null; }
    return {
      url: location.href, title: D.title, vw, vh, dpr: devicePixelRatio || 1,
      sx: Math.round(scrollX), sy: Math.round(scrollY),
      pw: Math.max(root.scrollWidth, D.body ? D.body.scrollWidth : 0), ph: Math.max(root.scrollHeight, D.body ? D.body.scrollHeight : 0),
      scroller, entries, selection: sel, candidates: cands.length, scanned, partial, ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return { error: `the in-view outline failed in the page: ${e && e.message ? e.message : e}` };
  }
}

const clipText = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** One entry's line, without its indent: `<selector> (word) “text” y 120–420`. */
export function outlineLine(e) {
  const last = e.sel.split(/\s*>\s*|\s+/).pop() || '';
  // (the word only where the selector doesn't say what it is)
  const says = e.word && (last.includes(e.word) || last.startsWith(`${e.word}`) || (e.word === 'heading' && /^h[1-6]/.test(last)) || (e.word === 'link' && /^a[[.#:]|^a$/.test(last)));
  const bits = [e.sel];
  if (e.word && !says) bits.push(`(${e.word})`);
  if (e.text) bits.push(`“${e.text}”`);
  if (e.label) bits.push(`[${e.label}]`);
  bits.push(`y ${e.top}–${e.bottom}`);
  if (e.selected) bits.push('← the selection');
  else if (e.holdsSelection) bits.push('← holds the selection');
  return bits.join(' ');
}

/**
 * The outline as lines, top to bottom (document order), indented under the entry around each, cut to `maxChars`:
 * the lowest priority entries go first (plain text, then controls), so landmarks, items and headings stay, and
 * the selection's. Returns {text, shown, left}.
 */
export function formatOutline(entries, { maxChars = OUTLINE_MAX } = {}) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.sel === 'string' && e.sel) : [];
  const depthOf = (i, keep) => {
    let d = 0;
    for (let p = list[i].parent; p !== undefined && p >= 0 && d < 12; p = list[p] ? list[p].parent : -1) if (keep.has(p)) d++;
    return Math.min(d, 5);
  };
  const lineOf = (i, keep) => `${'  '.repeat(depthOf(i, keep))}${outlineLine(list[i])}`;
  // by priority, then top to bottom; the selection's first of all
  const order = list.map((e, i) => i).sort((a, b) => (list[b].selected || list[b].holdsSelection ? 1 : 0) - (list[a].selected || list[a].holdsSelection ? 1 : 0) || (list[a].p || 9) - (list[b].p || 9) || a - b);
  const keep = new Set();
  let used = 0;
  for (const i of order) {
    const len = outlineLine(list[i]).length + 11; // (an indent's worth, and the newline)
    if (used + len > maxChars) continue;
    keep.add(i);
    used += len;
  }
  let lines = [...keep].sort((a, b) => a - b).map((i) => lineOf(i, keep));
  // (exact now, with the indents as they came out)
  while (lines.join('\n').length > maxChars && keep.size) {
    const drop = [...keep].sort((a, b) => (list[b].p || 9) - (list[a].p || 9) || b - a)[0];
    keep.delete(drop);
    lines = [...keep].sort((a, b) => a - b).map((i) => lineOf(i, keep));
  }
  return { text: lines.join('\n'), shown: keep.size, left: list.length - keep.size };
}

/**
 * The note, as the agent reads it. `c`: inViewPage's result (or null: no outline, the page can't be read). `info`:
 * {tabId, phone ({device, width} in the phone view), shot (the screenshot's file), noShot (why there's none),
 * outlineWhy (why there's no outline), maxChars}. Returns the text, or null when there's nothing to say.
 */
export function inViewNote(c, info = {}) {
  const lines = [IN_VIEW_HEADER];
  const page = c && !c.error ? c : null;
  const where = info.phone ? `the phone view (${info.phone.device || 'a phone'}${info.phone.width ? `, ${info.phone.width} px wide` : ''})` : '';
  if (page) lines.push(`Page: ${page.url}${page.title ? ` (“${clipText(page.title, 80)}”)` : ''}${Number.isInteger(info.tabId) ? `, tab ${info.tabId}` : ''}${where ? `, in ${where}` : ''}`);
  else if (Number.isInteger(info.tabId)) lines.push(`Tab ${info.tabId}${where ? `, in ${where}` : ''}`);
  if (page) {
    const scroll = page.scroller && page.scroller.sel
      ? `the page's own scroller ${page.scroller.sel} scrolled to y ${page.scroller.y} of ${page.scroller.height}`
      : `scrolled to y ${page.sy} of ${page.ph}${page.sx ? `, x ${page.sx} of ${page.pw}` : ''}`;
    lines.push(`Viewport: ${page.vw}×${page.vh} CSS px, ${scroll}${page.dpr && page.dpr !== 1 ? `; ${page.dpr} device px per CSS px` : ''}.`);
  }
  if (info.shot) lines.push(`Screenshot of exactly this viewport: ${info.shot}`);
  else if (info.noShot) lines.push(`No screenshot: ${info.noShot}.`);
  if (page && page.selection && page.selection.text) {
    lines.push(`Selected${page.selection.field ? ' in a text field' : ''}: “${page.selection.text}”`);
    if (page.selection.selector) lines.push(`  in ${page.selection.selector}`);
  }
  if (page) {
    const o = formatOutline(page.entries, { maxChars: info.maxChars || OUTLINE_MAX });
    if (o.text) {
      lines.push('In view, top to bottom (CSS selectors for page.find / trif run; y: px from the viewport\'s top):');
      lines.push(o.text);
    } else lines.push('In view: no elements TRIF could name.');
    const more = o.left + Math.max(0, (page.candidates || 0) - (page.entries || []).length);
    if (more > 0 || page.partial) lines.push(`(${more > 0 ? `${more} more in view not listed, to keep this short` : 'not every element looked at'}${page.partial ? `: the page is big, and TRIF stopped after ${page.ms} ms` : ''}; trif run or trif sweep for the rest.)`);
  } else if (info.outlineWhy) lines.push(`No outline: ${info.outlineWhy}.`);
  if (lines.length === 1) return null;
  lines.push(IN_VIEW_FOOTER);
  return lines.join('\n');
}

/**
 * The message with its notes after it (the latest NOTES_MAX). Several notes (messages that waited, sent as one):
 * each says which message it came with.
 */
export function withInView(prompt, notes = []) {
  const list = (Array.isArray(notes) ? notes : []).filter((n) => n && typeof n.note === 'string' && n.note).slice(-NOTES_MAX);
  if (!list.length) return prompt;
  const parts = list.map((n) => (list.length > 1 && n.text
    ? n.note.replace(IN_VIEW_HEADER, `--- In view when I sent “${clipText(n.text, 50)}” ---`)
    : n.note));
  return `${prompt}\n\n${parts.join('\n\n')}`;
}

/**
 * Capture the note for a tab, at Send. deps: {tab ({id, url, windowId, active}), level ('off' | 'look' | 'run' |
 * 'ask': "Agent on this site" for the tab's host), sensitive (bool: on TRIF's sensitive list, never pictured),
 * pageCall(func, args) (in the tab's isolated world), capture() → dataUrl (the visible viewport), saveShot(dataUrl)
 * → file, phone?, now? (ms clock)}. Never throws. Returns {note, pictured, ms: {total, outline, shot}} or null when
 * the page may not be read at all.
 */
export async function captureInView(deps) {
  const now = deps.now || (() => Date.now());
  const t0 = now();
  const tab = deps.tab || {};
  if (deps.level === 'off' || !tab.url || !/^https?:/i.test(tab.url)) return null;
  const ms = { total: 0, outline: null, shot: null };
  // (never holding a message up for long: a page that doesn't answer, a picture the browser doesn't make)
  const LIMIT = deps.timeout || 1500;
  const inTime = (p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} took over ${LIMIT} ms`)), LIMIT))]);
  const outlineP = (async () => {
    const t = now();
    try { return await inTime(deps.pageCall(inViewPage, [{ maxChars: deps.maxChars || OUTLINE_MAX, budget: deps.budget || 160 }]), 'the page'); } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    } finally { ms.outline = now() - t; }
  })();
  const shotP = deps.sensitive ? Promise.resolve({ noShot: 'this site is on TRIF\'s sensitive list, and TRIF never pictures those' }) : (async () => {
    const t = now();
    try {
      const dataUrl = await inTime(deps.capture(), 'the browser\'s picture');
      if (!dataUrl) return { noShot: 'the browser gave no picture' };
      return { shot: await inTime(deps.saveShot(dataUrl), 'saving the picture') };
    } catch (e) {
      return { noShot: clipText(e && e.message ? e.message : e, 200).replace(/\.$/, '') };
    } finally { ms.shot = now() - t; }
  })();
  const [c, s] = await Promise.all([outlineP, shotP]);
  ms.total = now() - t0;
  const note = inViewNote(c && !c.error ? c : null, {
    tabId: tab.id, phone: deps.phone || null, shot: s.shot || null, noShot: s.shot ? null : s.noShot,
    outlineWhy: c && c.error ? clipText(c.error, 200).replace(/\.$/, '') : null, maxChars: deps.maxChars,
  });
  return note ? { note, pictured: !!s.shot, ms } : null;
}
