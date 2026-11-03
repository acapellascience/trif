// ==WebMod==
// @name        Terminal Box
// @description Turns the "Yours, on your computer" box into a little terminal window that types `ls ~/.trif/sites/timsrobot.com`, lists our mods, then prints the paragraph
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  // Mods can't read the disk, so the listing is written here. Add new mods to it as they're made.
  const MODS = ['jelly-buttons.js', 'living-robot.js', 'need-checklist.js', 'neon-title.js', 'rainbow-rave.js',
    'sticker-badges.js', 'terminal-box.js', 'typing-tagline.js'];
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
    .tb-ls { display: grid; grid-template-columns: repeat(auto-fill, minmax(16ch, 1fr)); gap: 0 1.5ch; margin: 2px 0 10px; }
    .tb-ls span { color: #f0c674; opacity: 0; transition: opacity .15s; }
    .tb-ls span.tb-on { opacity: 1; }
    [data-tb] .tb-body p { margin: 0 0 10px !important; font: inherit !important; color: #d7d7d2 !important;
      opacity: 0; transform: translateY(3px); transition: opacity .5s, transform .5s; }
    [data-tb] .tb-body p.tb-on { opacity: 1; transform: none; }
    [data-tb] .tb-body p code { color: #6cb6ff; background: none !important; border: 0 !important; padding: 0 !important; font: inherit; }
    .tb-cursor { display: inline-block; width: .6em; height: 1.1em; vertical-align: -.2em; background: #d7d7d2;
      animation: tb-blink 1s steps(1) infinite; }
    .tb-typing .tb-cursor { animation: none; }
    @keyframes tb-blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .tb-cursor { animation: none; } .tb-ls span, [data-tb] .tb-body p { transition: none; } }
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
  body.append(first, ls, para);
  box.prepend(bar);
  box.append(body);

  const finish = () => {
    typed.textContent = COMMAND;
    ls.querySelectorAll('span').forEach((s) => s.classList.add('tb-on'));
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
        const spans = [...ls.querySelectorAll('span')];
        spans.forEach((s, k) => setTimeout(() => s.classList.add('tb-on'), 250 + k * 70));
        setTimeout(finish, 250 + spans.length * 70 + 350);
      } catch (e) { window.trif?.warn('terminal-box', String(e)); finish(); }
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
