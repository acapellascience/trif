// Try a style mod's rules on the live page, with TRIF's own style-mod runtime (helper/lib/rules.js rulesRuntime),
// before you hand the mod over. Made by skill/build.js from skill/src/scripts/page/try-style.template.js: don't edit.
//
// Paste all of this into the page (it lasts until undo() or a reload), then:
//   await __trifTry.style({ css, hide, replace, filter })   what each rule hit: counts and short samples
//   await __trifTry.report()                                 the same again (after scrolling, say: rules re-apply)
//   __trifTry.undo()                                         the page back as it was
// A style section's object works too ({ css: [lines], hide, settings }): var(--name) gets the setting's value.
// It runs TRIF's code, not TRIF's checks (what CSS may load, selector limits): scripts/check-mod.js has those.
(() => {
  if (window.__trifTry) { try { window.__trifTry.undo(); } catch { /* a page that changed it */ } }
  const tries = [];
  const SAMPLES = 4;
  const clip = (s, n = 70) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const all = (sel) => { try { return [...document.querySelectorAll(sel)]; } catch (e) { return { error: `not a selector the browser takes: ${e.message}` }; } };
  const showing = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const id = (el.getAttribute('data-testid') && `[data-testid=${el.getAttribute('data-testid')}]`) || (el.id && `#${el.id}`) || (el.getAttribute('aria-label') && `[aria-label="${clip(el.getAttribute('aria-label'), 40)}"]`) || '';
    const on = showing(el);
    // (a hidden element's innerText runs its lines together: its text nodes, spaced, instead)
    const text = on ? el.innerText : [el, ...el.querySelectorAll('*')].map((x) => [...x.childNodes].filter((c) => c.nodeType === 3).map((c) => c.data.trim()).join(' ')).filter(Boolean).join(' ');
    return `${el.tagName.toLowerCase()}${id} ${on ? `${Math.round(r.width)}x${Math.round(r.height)}` : '(hidden)'} "${clip(text, 50)}"`;
  };
  const selectorsOf = /*SELECTORS_OF*/;

  // A style mod's rules, or a style section's object, as TRIF hands them to its runtime (rules.js checkRules,
  // stylesection.js checkSpec: what they'd accept, without their checks).
  const normalize = (r) => {
    r = r || {};
    const settings = r.settings || {};
    let css = Array.isArray(r.css) ? r.css.join('\n') : String(r.css || '');
    css = css.replace(/var\(\s*--([A-Za-z][A-Za-z0-9_]*)\s*(?:,[^()]*)?\)/g, (m, name) => {
      const s = Object.prototype.hasOwnProperty.call(settings, name) ? settings[name] : null;
      if (!s) return m;
      return s.type === 'number' ? `${s.value}${s.unit || ''}` : String(s.value);
    });
    return {
      css,
      hide: Array.isArray(r.hide) ? r.hide : [],
      replace: (Array.isArray(r.replace) ? r.replace : []).map((x) => ({ in: x.in || 'body', find: x.find, regex: !!x.regex, caseless: !!x.caseless, with: x.with })),
      filter: Array.isArray(r.filter) ? r.filter : [],
    };
  };

  const settle = () => new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 600); // (a tab in the background has no frames)
  });

  async function style(rules) {
    const spec = normalize(rules);
    const id = `trif-try-${Date.now().toString(36)}-${tries.length + 1}`;
    const t = { id, spec, hidden: new Map(), texts: new Map(), observers: [], sheet: null, before: {}, samples: {}, matched: {}, dead: false, warnings: [] };
    for (const sel of spec.hide) { const els = all(sel); t.before[sel] = Array.isArray(els) ? els.filter(showing).length : null; t.samples[sel] = Array.isArray(els) ? els.slice(0, SAMPLES).map(describe) : []; t.matched[sel] = Array.isArray(els) ? els.length : 0; }
    const __t = {
      hid: (el) => { if (!t.dead && !t.hidden.has(el)) t.hidden.set(el, [el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]); },
      txt: (n) => { if (!t.dead && !t.texts.has(n)) t.texts.set(n, n.data); },
    };
    // (TRIF's runtime, below, uses these names: here they're ours, so undo() can stop it)
    const MutationObserver = class extends window.MutationObserver { constructor(cb) { super(cb); t.observers.push(this); } };
    const requestAnimationFrame = (fn) => window.requestAnimationFrame(() => { if (!t.dead) fn(); });
    const rulesRuntime = /*RULES_RUNTIME*/;
    tries.push(t);
    rulesRuntime(spec, id);
    // (the page's world: a page whose Content-Security-Policy refuses inline styles leaves the <style> empty, which
    // TRIF's own doesn't meet. A constructed sheet instead, and a note: the mod itself is fine there.)
    const el = document.querySelector(`style[data-trif-style="${id}"]`);
    const cssText = spec.css + (spec.hide.length ? `\n${spec.hide.join(',\n')} { display: none !important; }` : '');
    if (cssText.trim() && el && !(el.sheet && el.sheet.cssRules.length) && /\{/.test(cssText)) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        t.sheet = sheet;
        t.warnings.push('this page\'s security policy kept a <style> from working, so the test used a constructed style sheet; TRIF\'s own style isn\'t affected');
      } catch (e) { t.warnings.push(`the CSS didn't apply on this page (${e.message})`); }
    }
    await settle();
    return report();
  }

  async function report() {
    await settle();
    const out = { tries: tries.length, css: [], hide: [], filter: [], replace: [], warnings: [] };
    for (const t of tries) {
      out.warnings.push(...t.warnings);
      for (const sel of selectorsOf({ css: t.spec.css })) {
        const els = all(sel);
        out.css.push({ selector: sel, matches: Array.isArray(els) ? els.length : els.error });
      }
      for (const sel of t.spec.hide) {
        const els = all(sel);
        if (!Array.isArray(els)) { out.hide.push({ selector: sel, error: els.error }); continue; }
        out.hide.push({ selector: sel, matches: els.length, wereShowing: t.before[sel], samplesBefore: t.samples[sel], ...(els.length !== t.matched[sel] ? { samplesNow: els.slice(0, SAMPLES).map(describe) } : {}) });
      }
      for (const f of t.spec.filter) {
        const items = all(f.items);
        if (!Array.isArray(items)) { out.filter.push({ items: f.items, error: items.error }); continue; }
        const hidden = items.filter((x) => t.hidden.has(x));
        const kept = items.filter((x) => !t.hidden.has(x));
        const rule = f.hideIfText !== undefined ? { hideIfText: f.hideIfText } : f.hideIfRegex !== undefined ? { hideIfRegex: f.hideIfRegex } : { hideIfHas: f.hideIfHas };
        out.filter.push({ items: f.items, ...rule, matches: items.length, hidden: hidden.length, hiddenSamples: hidden.slice(0, SAMPLES).map((x) => clip(x.innerText || x.textContent)), keptSamples: kept.slice(0, SAMPLES).map((x) => clip(x.innerText || x.textContent)) });
      }
      if (t.spec.replace.length) {
        const changed = [...t.texts].filter(([n]) => n.isConnected);
        out.replace.push({ rules: t.spec.replace.map((r) => `${r.in}: ${r.find} → ${r.with}`), textsChanged: changed.length, samples: changed.slice(0, SAMPLES).map(([n, was]) => `${clip(was, 40)} → ${clip(n.data, 40)}`) });
      }
    }
    for (const x of [...out.css, ...out.hide]) if (x.matches === 0) out.warnings.push(`${x.selector} matches nothing here (wrong selector, another page type, or not loaded yet)`);
    for (const f of out.filter) if (f.matches === 0) out.warnings.push(`${f.items} matches nothing here`);
    return out;
  }

  function undo() {
    let n = 0;
    for (const t of tries.splice(0)) {
      t.dead = true;
      for (const o of t.observers) o.disconnect();
      for (const s of document.querySelectorAll(`style[data-trif-style="${t.id}"]`)) s.remove();
      if (t.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== t.sheet);
      for (const [el, [v, p]] of t.hidden) { el.style.removeProperty('display'); if (v) el.style.setProperty('display', v, p); }
      for (const [node, data] of t.texts) if (node.isConnected) node.data = data;
      n++;
    }
    return { undone: n, left: document.querySelectorAll('style[data-trif-style^="trif-try-"]').length };
  }

  window.__trifTry = { style, report, undo };
  return 'try-style ready: await __trifTry.style(rules), await __trifTry.report(), __trifTry.undo()';
})();
