// A page that behaves like x.com's home timeline, to measure what the iPhone app adds to a heavy page (branch
// ios-poc): atomic CSS classes made as cells appear and put in with CSSStyleSheet.insertRule (react-native-web's
// way), a virtualised list of up to 2000 absolutely positioned cells (translateY) recycled as it scrolls, pages of
// JSON fetched as the end comes near, and counters changing in the visible cells several times a second.
// heavy.html allows inline styles, as X does; heavy-strict.html doesn't (the app's style mirror is active there).
// With #bench in the address it scrolls itself for 20 seconds and puts what it measured in window.__bench.
(function () {
  'use strict';
  const CELL = 168, MAX = 2000, PAGE = 20;
  const items = [];
  let fetching = false, pages = 0;
  // (one style element, rules added one by one)
  const styleEl = document.createElement('style');
  document.head.append(styleEl);
  const sheet = styleEl.sheet;
  const made = new Map();
  let ruleCount = 0;
  const cls = (decl) => {
    let c = made.get(decl);
    if (c) return c;
    c = `r-${(made.size + 1).toString(36)}`;
    made.set(decl, c);
    try { if (sheet) { sheet.insertRule(`.${c}{${decl}}`, sheet.cssRules.length); ruleCount++; } } catch (e) { /* refused */ }
    return c;
  };
  const base = [cls('margin:0;font:15px/1.4 -apple-system,sans-serif;background:#000;color:#e7e9ea'), cls('display:block')];
  document.documentElement.classList.add(...base);
  document.body.classList.add(...base);

  const main = document.createElement('main');
  main.setAttribute('role', 'main');
  const column = document.createElement('div');
  column.dataset.testid = 'primaryColumn';
  const header = document.createElement('div');
  header.className = [cls('position:sticky;top:0;z-index:2;height:53px;display:flex'), cls('background:rgba(0,0,0,.65);backdrop-filter:blur(12px)')].join(' ');
  for (const [i, t] of ['For you', 'Following'].entries()) {
    const tab = document.createElement('a');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(i === 0));
    tab.textContent = t;
    tab.className = cls('flex:1;display:flex;align-items:center;justify-content:center;color:#e7e9ea;font-weight:700');
    header.append(tab);
  }
  const section = document.createElement('section');
  const list = document.createElement('div');
  list.className = cls('position:relative');
  section.append(list);
  column.append(header, section);
  main.append(column);
  document.body.append(main);

  const avatar = (n) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="hsl(${(n * 47) % 360},60%,50%)"/></svg>`)}`;
  const pool = [];
  const cellFor = () => {
    const cell = document.createElement('div');
    cell.dataset.testid = 'cellInnerDiv';
    cell.className = cls('position:absolute;left:0;right:0;top:0;border-bottom:1px solid #2f3336;padding:12px 16px;box-sizing:border-box');
    cell.style.height = `${CELL}px`;
    cell.innerHTML = '<article><img width="40" height="40" alt=""><b></b> <span class="h"></span><p></p><div class="c"></div></article>';
    return cell;
  };
  const shown = new Map(); // index -> cell
  function render() {
    const top = window.scrollY - section.offsetTop;
    const from = Math.max(0, Math.floor(top / CELL) - 4);
    const to = Math.min(items.length, Math.ceil((top + innerHeight) / CELL) + 4);
    for (const [i, cell] of shown) if (i < from || i >= to) { shown.delete(i); cell.remove(); pool.push(cell); }
    for (let i = from; i < to; i++) {
      if (shown.has(i)) continue;
      const it = items[i];
      const cell = pool.pop() || cellFor();
      cell.style.transform = `translateY(${i * CELL}px)`;
      const a = cell.firstChild;
      a.children[0].src = avatar(it.author);
      a.children[1].textContent = `Person ${it.author}`;
      a.children[1].className = cls(`color:hsl(${(it.author * 47) % 360},70%,75%)`);
      a.children[2].textContent = `@p${it.author} · ${it.id}m`;
      a.children[3].textContent = it.text;
      a.children[3].className = cls(`margin:4px 0;font-size:${14 + (it.author % 3)}px`);
      a.children[4].textContent = `♥ ${it.likes}`;
      shown.set(i, cell);
      list.append(cell);
    }
    list.style.height = `${items.length * CELL}px`;
    if (to > items.length - 3 * Math.ceil(innerHeight / CELL)) more();
  }
  async function more() {
    if (fetching || items.length >= MAX) return;
    fetching = true;
    try {
      const r = await fetch(`heavy-feed.json?p=${pages}`, { cache: 'no-store' });
      const page = await r.json();
      for (const t of page.items) items.push({ id: items.length + 1, author: (t.author + pages * 7) % 300, text: t.text, likes: t.likes });
      pages++;
    } catch (e) { /* the next scroll asks again */ }
    fetching = false;
    render();
  }
  let queued = false;
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } }, { passive: true });
  // (counters changing in what's on screen, as likes and views do)
  setInterval(() => { for (const [i, cell] of shown) { items[i].likes += (i % 3); cell.querySelector('.c').textContent = `♥ ${items[i].likes}`; } }, 300);
  more().then(more).then(more);

  if (/bench/.test(location.hash)) {
    setTimeout(() => {
      // (idle time: how often a message to itself gets through while the page scrolls; whatever else runs on the
      // main thread, the app's worlds included, leaves fewer)
      let pings = 0, pinging = true;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { pings++; if (pinging) ch.port2.postMessage(0); };
      ch.port2.postMessage(0);
      const gaps = [];
      let last = performance.now(), start = last;
      const step = (now) => {
        gaps.push(now - last);
        last = now;
        window.scrollBy(0, 80);
        if (now - start < 20000) requestAnimationFrame(step);
        else {
          pinging = false;
          const sorted = gaps.slice().sort((a, b) => a - b);
          window.__bench = {
            seconds: Math.round((now - start) / 100) / 10, frames: gaps.length, fps: Math.round(gaps.length / ((now - start) / 1000)),
            over50: gaps.filter((g) => g > 50).length, over100: gaps.filter((g) => g > 100).length, max: Math.round(sorted[sorted.length - 1]),
            p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), items: items.length, rules: ruleCount, cells: shown.size, scrolled: Math.round(scrollY),
            elements: document.getElementsByTagName('*').length, pingsPerSecond: Math.round(pings / ((now - start) / 1000)),
          };
        }
      };
      requestAnimationFrame(step);
    }, 1500);
  }
})();
