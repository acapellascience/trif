// ==WebMod==
// @name        Three-Column Feed
// @description Home feed three posts wide, still scrolling
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  // The home feed is a virtualized list: <article>s are direct children of a flex column whose inline
  // padding-top/bottom stand in for unmounted posts. We turn that list into a 3-column CSS grid.
  // This works with Instagram's virtualizer because it measures each post as (next post's top - this
  // post's top): posts sharing a row measure 0 and the last in the row measures the row height.
  // Two fixes on top:
  //  - Each post is pinned to column (index % 3) + 1, so when posts above unmount the rest don't shuffle
  //    columns. The index is the "index" prop React passes to the feed row (found via the fiber).
  //  - The list's sizeCache guesses 800px for posts it hasn't measured; in a grid that's 3x too tall,
  //    so for unmeasured posts we return a third of the guess (patched on that one cache instance only).
  // There are no stable selectors for the feed's wrappers, so they're marked from JS (data-wmg-*).
  const COLS = 3;
  const root = document.documentElement;

  const addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);
  };
  addStyle(`
    html[data-wmg-home] [data-wmg-frame] { padding-left: var(--wmg-left, 88px) !important; padding-right: 16px !important; box-sizing: border-box !important; }
    html[data-wmg-home] [data-wmg-wide] { max-width: none !important; width: 100% !important; --x-width: 100% !important; --x-maxWidth: 100% !important; }
    html[data-wmg-home] [data-wmg-list] { display: grid !important; grid-template-columns: repeat(${COLS}, minmax(0, 1fr)) !important; column-gap: 16px !important; align-items: start !important; }
    html[data-wmg-home] [data-wmg-list] > * { min-width: 0 !important; width: auto !important; max-width: none !important; grid-column: 1 / -1; }
    ${Array.from({ length: COLS }, (_, i) => `html[data-wmg-home] [data-wmg-list] > [data-wmg-col="${i + 1}"] { grid-column: ${i + 1}; }`).join('\n')}
  `);

  const fiberKey = (el) => Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  const fiberOf = (el) => { const k = fiberKey(el); return k ? el[k] : null; };

  // Index of a list child: walk up its fiber until the list's own fiber.
  const indexOf = (child, list) => {
    for (let f = fiberOf(child), i = 0; f && i < 40; i++, f = f.return) {
      if (f.stateNode === list) return null;
      const idx = f.memoizedProps?.index;
      if (typeof idx === 'number') return idx;
    }
    return null;
  };

  const patched = new WeakSet();
  const patchSizeCache = (list) => {
    for (let f = fiberOf(list), i = 0; f && i < 15; i++, f = f.return) {
      const sc = f.memoizedProps?.sizeCache;
      if (!sc || typeof sc.getSize !== 'function' || typeof sc.setSize !== 'function') continue;
      if (patched.has(sc)) return;
      patched.add(sc);
      const measured = new Set();
      const setSize0 = sc.setSize, getSize0 = sc.getSize;
      sc.setSize = function (i) { measured.add(i); return setSize0.apply(this, arguments); };
      sc.getSize = function (i) {
        const size = getSize0.apply(this, arguments);
        return measured.has(i) ? size : size / COLS;
      };
      return;
    }
  };

  const pin = (child, list) => {
    const idx = indexOf(child, list);
    const col = idx == null ? null : String((idx % COLS) + 1);
    if (col == null) child.removeAttribute('data-wmg-col');
    else if (child.getAttribute('data-wmg-col') !== col) child.setAttribute('data-wmg-col', col);
  };

  let list = null;
  let warned = false;
  const findList = () => {
    const article = document.querySelector('main article');
    const l = article?.parentElement;
    if (!l) return null;
    // Sanity check: the feed list is a flex column whose children are posts.
    if (!l.style.paddingTop && !l.style.paddingBottom) {
      if (!warned) { warned = true; window.webmods?.warn('feed list shape changed: no virtualizer padding'); }
      return null;
    }
    return l;
  };

  const navRight = () => {
    let right = 0;
    for (const a of document.querySelectorAll('a[href="/"]')) {
      for (let p = a, i = 0; p && i < 12; i++, p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if (r.height >= innerHeight * 0.8 && r.left <= 1 && r.width < innerWidth / 2) right = Math.max(right, r.right);
      }
    }
    return right;
  };

  const mark = () => {
    const main = list.closest('main');
    if (!main) return;
    list.setAttribute('data-wmg-list', '');
    // Widen every wrapper between the list and <main>; the one directly under <main> gets the padding
    // that keeps posts clear of the fixed left menu.
    for (let p = list.parentElement; p && p !== main; p = p.parentElement) {
      if (p.parentElement === main) {
        if (!p.hasAttribute('data-wmg-frame')) p.setAttribute('data-wmg-frame', '');
        const r = main.getBoundingClientRect();
        root.style.setProperty('--wmg-left', `${Math.max(0, navRight() - r.left) + 16}px`);
      } else if (!p.hasAttribute('data-wmg-wide')) p.setAttribute('data-wmg-wide', '');
    }
    patchSizeCache(list);
    for (const c of list.children) pin(c, list);
  };

  const isHome = () => location.pathname === '/';
  const update = () => {
    try {
      root.toggleAttribute('data-wmg-home', isHome());
      if (!isHome()) return;
      if (!list?.isConnected) { list = findList(); if (!list) return; }
      mark();
    } catch (e) { window.webmods?.warn(String(e)); }
  };

  // Synchronous on mutations of the list itself, so a new or re-ordered post is pinned before paint
  // (a delay would show posts jumping columns). Anything else is handled by a debounced pass.
  let queued = false;
  new MutationObserver((records) => {
    try {
      if (list?.isConnected && isHome()) {
        for (const r of records) if (r.target === list) for (const n of r.addedNodes) if (n.nodeType === 1) pin(n, list);
      }
    } catch (e) { window.webmods?.warn(String(e)); }
    if (!queued) { queued = true; setTimeout(() => { queued = false; update(); }, 150); }
  }).observe(root, { childList: true, subtree: true });

  // Route changes re-render <main>, which the observer above sees; no need to patch history.
  addEventListener('popstate', update);
  addEventListener('resize', () => { if (queued) return; queued = true; setTimeout(() => { queued = false; update(); }, 150); });
  update();
})();
