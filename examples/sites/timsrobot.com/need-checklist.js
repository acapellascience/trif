// ==WebMod==
// @name        Need Checklist
// @description Turns the "What you need" list into a checklist with an icon per item (Mac, browser, Node, robot) whose boxes tick themselves one by one; click a box to tick or untick it
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  const h2 = [...document.querySelectorAll('h2')].find((h) => /what you need/i.test(h.textContent));
  const ul = h2?.nextElementSibling;
  if (!ul || ul.tagName !== 'UL' || ul.hasAttribute('data-nc')) return;
  ul.setAttribute('data-nc', '');

  const style = document.createElement('style');
  style.textContent = `
    ul[data-nc] { list-style: none !important; padding-left: 0 !important; }
    ul[data-nc] > li { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
    .nc-box { flex: none; width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid #5a5a56;
      display: grid; place-items: center; transition: background .25s, border-color .25s, transform .25s; cursor: pointer; }
    .nc-box:hover { border-color: #8a8a84; }
    .nc-box:focus-visible { outline: 2px solid #3ddc84; outline-offset: 2px; }
    .nc-box svg { width: 12px; height: 12px; stroke: #18181a; stroke-width: 3; fill: none;
      stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 20; stroke-dashoffset: 20;
      transition: stroke-dashoffset .3s .1s ease-out; }
    .nc-icon { flex: none; width: 20px; height: 20px; stroke: currentColor; stroke-width: 1.7; fill: none;
      stroke-linecap: round; stroke-linejoin: round; opacity: .8; transition: color .3s, opacity .3s; }
    .nc-text { transition: opacity .3s; }
    li.nc-done .nc-box { background: #3ddc84; border-color: #3ddc84; transform: scale(1.15); }
    li.nc-done.nc-settled .nc-box { transform: scale(1); }
    li.nc-done .nc-box svg { stroke-dashoffset: 0; }
    li.nc-done .nc-icon { color: #3ddc84; opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .nc-box, .nc-box svg, .nc-icon { transition: none !important; } }
  `;
  document.head.append(style);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = (cls, shapes) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      s.append(el);
    }
    return s;
  };
  const ICONS = {
    mac: [['rect', { x: 4, y: 5, width: 16, height: 11, rx: 1.5 }], ['path', { d: 'M2 19h20' }]],
    browser: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 9h18' }],
      ['circle', { cx: 6, cy: 6.5, r: .6 }], ['circle', { cx: 8.5, cy: 6.5, r: .6 }]],
    node: [['path', { d: 'M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z' }], ['path', { d: 'M9.5 9.5v5M9.5 9.5l5 5v-5' }]],
    robot: [['rect', { x: 5, y: 8, width: 14, height: 11, rx: 2.5 }], ['path', { d: 'M12 8V5M9.5 15h5' }],
      ['circle', { cx: 12, cy: 4, r: 1 }], ['circle', { cx: 9.5, cy: 12, r: .8 }], ['circle', { cx: 14.5, cy: 12, r: .8 }]],
  };
  // Pick the icon by what the item says, so reordering the list keeps the right icons.
  const iconFor = (text) => /mac|linux/i.test(text) ? 'mac' : /chrome|firefox|browser/i.test(text) ? 'browser'
    : /node/i.test(text) ? 'node' : /agent|claude|codex|model/i.test(text) ? 'robot' : null;

  const items = [...ul.children].filter((li) => li.tagName === 'LI');
  for (const li of items) {
    const text = document.createElement('span');
    text.className = 'nc-text';
    text.append(...li.childNodes);
    const box = document.createElement('span');
    box.className = 'nc-box';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'false');
    box.append(svg('', [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]]));
    li.append(box);
    const icon = iconFor(text.textContent);
    if (icon) li.append(svg('nc-icon', ICONS[icon]));
    li.append(text);
  }

  const setDone = (li, done) => {
    li.classList.toggle('nc-done', done);
    li.classList.remove('nc-settled');
    li.querySelector('.nc-box')?.setAttribute('aria-checked', String(done));
    if (done) setTimeout(() => li.classList.add('nc-settled'), 250); // the little pop, then settle
  };

  // The boxes are real checkboxes: click (or Enter on a focused one) toggles it. Once you've touched one,
  // the automatic ticking leaves it alone.
  for (const li of items) {
    const box = li.querySelector('.nc-box');
    if (!box) continue;
    box.tabIndex = 0;
    const toggle = () => { li.setAttribute('data-nc-touched', ''); setDone(li, !li.classList.contains('nc-done')); };
    box.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toggle(); } });
  }

  // Tick them one by one once the list scrolls into view.
  const run = () => items.forEach((li, i) => setTimeout(() => {
    if (!li.hasAttribute('data-nc-touched')) setDone(li, true);
  }, 400 + i * 550));
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
  }, { threshold: 0.5 });
  io.observe(ul);
})();
