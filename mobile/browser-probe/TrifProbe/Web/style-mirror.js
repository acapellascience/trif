// A <style> that TRIF's own code puts into a page, kept working where the page's security policy refuses it
// (style-src without 'unsafe-inline': strict.html, github.com…). On desktop a browser exempts an extension's
// worlds from the page's policy; WebKit applies it to an app's content worlds too, but not to a constructed style
// sheet (the probe's styles.own check). So, in the world this runs in (TRIF's for style mods, the box for boxed
// mods; ModStore.userScripts puts it first in each), a style element appended there that the page refused gets
// a constructed sheet with its text, adopted by its document or shadow root, kept in step with its text, and
// dropped when the element is. A style element the page accepted is left alone.
(() => {
  if (globalThis.__trifStyleMirror) return;
  globalThis.__trifStyleMirror = true;
  const sheets = new WeakMap(); // style element -> {sheet, root, watch}
  const roots = (st) => { const r = st.getRootNode && st.getRootNode(); return r && 'adoptedStyleSheets' in r ? r : null; };
  const drop = (st) => {
    const m = sheets.get(st);
    if (!m) return;
    sheets.delete(st);
    m.watch.disconnect();
    try { m.root.adoptedStyleSheets = m.root.adoptedStyleSheets.filter((s) => s !== m.sheet); } catch (e) { /* gone */ }
  };
  const mirror = (st) => {
    if (!st || st.nodeName !== 'STYLE' || !st.isConnected) return;
    if (!sheets.has(st) && st.sheet) return; // (the page took it)
    const root = roots(st);
    if (!root) return;
    let m = sheets.get(st);
    try {
      if (!m) {
        m = { sheet: new CSSStyleSheet(), root, watch: new MutationObserver(() => { if (st.isConnected) { try { m.sheet.replaceSync(st.textContent || ''); } catch (e) { /* bad CSS */ } } else drop(st); }) };
        sheets.set(st, m);
        m.watch.observe(st, { characterData: true, childList: true, subtree: true });
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, m.sheet];
      }
      m.sheet.replaceSync(st.textContent || '');
    } catch (e) { /* this page won't take it either way */ }
  };
  const after = (nodes) => { for (const n of nodes) if (n && n.nodeName === 'STYLE') mirror(n); };
  const P = Node.prototype, E = Element.prototype;
  const wrap = (proto, name, fn) => { const orig = proto[name]; if (typeof orig !== 'function') return; proto[name] = function (...a) { const r = orig.apply(this, a); fn(this, a); return r; }; };
  for (const name of ['append', 'prepend', 'before', 'after', 'replaceWith']) wrap(E, name, (self, a) => after(a));
  wrap(P, 'appendChild', (self, a) => after([a[0]]));
  wrap(P, 'insertBefore', (self, a) => after([a[0]]));
  wrap(E, 'remove', (self) => { if (self.nodeName === 'STYLE') drop(self); });
  wrap(P, 'removeChild', (self, a) => { if (a[0] && a[0].nodeName === 'STYLE') drop(a[0]); });
})();
