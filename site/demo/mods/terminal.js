// ==WebMod==
// @name        Terminal Box
// @description Turns a box into a terminal
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  // Mods can't read the disk. On the home page's demo, the listing is the mods the demo has made so far
  // (its side panel keeps them in this tab's sessionStorage; else the ones the page's address runs);
  // anywhere else, the list written here.
  const FALLBACK = ['checklist.js', 'jelly.js', 'neon.js', 'rave.js', 'robot.js', 'stickers.js', 'tagline.js', 'terminal.js'];
  const demoMods = () => {
    const ok = (s) => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s);
    try {
      const saved = JSON.parse(sessionStorage.getItem('trif-demo-state') || 'null');
      if (saved?.v === 1 && Array.isArray(saved.mods) && saved.mods.filter(ok).length) return saved.mods.filter(ok);
    } catch {}
    const param = new URLSearchParams(location.search).get('mods');
    return param ? param.split(',').filter(ok) : null;
  };
  const listed = demoMods();
  const MODS = listed ? [...new Set([...listed, 'terminal'])].map((m) => `${m}.js`).sort() : FALLBACK;
  const COMMAND = 'ls ~/.trif/sites/timsrobot.com';

  const h2 = [...document.querySelectorAll('h2')].find((h) => /yours, on your computer/i.test(h.textContent));
  const box = h2?.parentElement;
  const para = h2?.nextElementSibling;
  if (!box || !para || para.tagName !== 'P' || box.hasAttribute('data-tb')) return;
  box.setAttribute('data-tb', '');

  const style = document.createElement('style');
  style.textContent = `
    [data-tb] { background: #0e0f10 !important; border: 1px solid #2c2d30; border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,.45); overflow: hidden; align-self: start;
      font-family: ui-monospace, Menlo, monospace; font-size: 13.5px; line-height: 1.55; }
    .tb-bar { display: flex; align-items: center; gap: 7px; padding: 8px 12px; background: #1f2023;
      border-bottom: 1px solid #2c2d30; }
    .tb-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
    [data-tb] .tb-bar h2 { flex: 1; margin: 0 !important; padding-right: 47px; text-align: center;
      font: 600 12.5px -apple-system, system-ui, sans-serif !important; color: #a9a9a4 !important;
      letter-spacing: 0 !important; }
    .tb-body { padding: 12px 14px 14px; color: #d7d7d2; min-height: 11em; }
    .tb-line { white-space: pre-wrap; word-break: break-all; }
    .tb-ps { color: #3ddc84; }
    .tb-path { color: #6cb6ff; }
    /* (as many columns as fit, ls-style: three in the half-width box on a computer, then two, then one as it
       narrows; each as wide as the longest name, fireworks.js and checklist.js, so fewer rows) */
    .tb-ls { display: grid; grid-template-columns: repeat(auto-fill, minmax(12ch, 1fr)); gap: 0 1.5ch; margin: 2px 0 10px; }
    /* (its own spans only, not ones another mod puts inside them: Gravity mode wraps each word in a span) */
    .tb-ls > span { color: #f0c674; opacity: 0; transition: opacity .15s; }
    .tb-ls > span.tb-on { opacity: 1; }
    [data-tb] .tb-body p { margin: 0 0 10px !important; font: inherit !important; color: #d7d7d2 !important;
      opacity: 0; transform: translateY(3px); transition: opacity .5s, transform .5s; }
    [data-tb] .tb-body p.tb-on { opacity: 1; transform: none; }
    [data-tb] .tb-body p code { color: #6cb6ff; background: none !important; border: 0 !important; padding: 0 !important; font: inherit; }
    .tb-cursor { display: inline-block; width: .6em; height: 1.1em; vertical-align: -.2em; background: #d7d7d2;
      animation: tb-blink 1s steps(1) infinite; }
    .tb-typing .tb-cursor { animation: none; }
    @keyframes tb-blink { 50% { opacity: 0; } }
    /* (on a computer, smaller: it sits beside What you need, and a long terminal pushed the page's end out of
       the window) */
    @media (min-width: 701px) { [data-tb] { font-size: 12px; line-height: 1.5; } }
    @media (prefers-reduced-motion: reduce) { .tb-cursor { animation: none; } .tb-ls > span, [data-tb] .tb-body p { transition: none; } }
  `;
  document.head.append(style);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const prompt = () => {
    const line = el('div', 'tb-line');
    line.append(el('span', 'tb-ps', 'you@mac'), ':', el('span', 'tb-path', '~'), '$ ');
    return line;
  };

  // Title bar with the traffic lights; the real h2 moves into it, so headings stay as they were.
  const bar = el('div', 'tb-bar');
  for (const c of ['#ff5f57', '#febc2e', '#28c840']) { const d = el('span', 'tb-dot'); d.style.background = c; bar.append(d); }
  bar.append(h2);

  const body = el('div', 'tb-body');
  const first = prompt();
  const typed = el('span');
  const cursor = el('span', 'tb-cursor');
  first.append(typed, cursor);
  const ls = el('div', 'tb-ls');
  ls.setAttribute('aria-label', 'Mods: ' + MODS.join(', '));
  for (const m of MODS) ls.append(el('span', '', m));
  // On the demo, mods made after this one join the page without a reload (its `trif-demo-mods` event):
  // the listing gains them, in ls order, as if the command had been run again.
  addEventListener('trif-demo-mods', (e) => {
    try {
      const ok = (s) => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s);
      const files = [...new Set([...(e.detail?.mods || []).filter(ok), 'terminal'])].map((m) => `${m}.js`).sort();
      const shown = ls.querySelectorAll(':scope > span').length && ls.querySelector(':scope > span.tb-on');
      ls.replaceChildren(...files.map((m) => { const s = el('span', '', m); if (shown) s.classList.add('tb-on'); return s; }));
      ls.setAttribute('aria-label', 'Mods: ' + files.join(', '));
    } catch (err) { window.trif?.warn('terminal', String(err)); }
  });
  body.append(first, ls, para);
  box.prepend(bar);
  box.append(body);

  const finish = () => {
    typed.textContent = COMMAND;
    ls.querySelectorAll(':scope > span').forEach((s) => s.classList.add('tb-on'));
    para.classList.add('tb-on');
    const last = prompt();
    last.append(cursor);
    body.append(last);
    body.classList.remove('tb-typing');
  };

  const play = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    body.classList.add('tb-typing');
    let i = 0;
    const type = () => {
      try {
        if (i < COMMAND.length) { typed.textContent += COMMAND[i++]; return setTimeout(type, 45 + Math.random() * 70); }
        // "Enter": the listing appears file by file, then the paragraph, then a fresh prompt.
        const spans = [...ls.querySelectorAll(':scope > span')];
        spans.forEach((s, k) => setTimeout(() => s.classList.add('tb-on'), 250 + k * 70));
        setTimeout(finish, 250 + spans.length * 70 + 350);
      } catch (e) { window.trif?.warn('terminal', String(e)); finish(); }
    };
    setTimeout(type, 400);
  };

  // Start when the box scrolls into view, so it isn't over before anyone sees it.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); play(); }
    }, { threshold: 0.4 });
    io.observe(box);
  } else finish();
})();
