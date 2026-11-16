// ==WebMod==
// @name        Sticker Badges
// @description Turns the small print into stickers
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  const SOURCE = /^\s*Free and open source\.\s*In beta, for Mac\.\s*$/;
  const BADGES = [
    { text: 'Free & open source', bg: '#44e0a8', fg: '#0d2b20', tilt: -4 },
    { text: 'In beta', bg: '#ffd84d', fg: '#3a2e00', tilt: 3 },
    { text: 'For Mac', bg: '#ff8fb1', fg: '#3d0d1d', tilt: -2 },
  ];

  const style = document.createElement('style');
  style.textContent = `
    .sb-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 12px; margin: 14px 0 !important; }
    .sb-badge {
      display: inline-block; padding: 5px 13px 6px; border-radius: 999px;
      font: 700 13px/1.2 -apple-system, system-ui, "Segoe UI", sans-serif; letter-spacing: .02em;
      background: var(--sb-bg); color: var(--sb-fg);
      border: 2.5px solid #fff;
      box-shadow: 0 3px 0 rgba(0,0,0,.35), 0 6px 14px rgba(0,0,0,.3);
      transform: rotate(var(--sb-tilt)) scale(0); opacity: 0;
      animation: sb-pop .55s cubic-bezier(.34,1.8,.5,1) forwards;
      animation-delay: calc(.35s + var(--sb-i) * .28s);
      cursor: default; user-select: none;
    }
    .sb-badge:hover { transform: rotate(0deg) scale(1.08) !important; transition: transform .15s; }
    @keyframes sb-pop {
      0%   { transform: rotate(calc(var(--sb-tilt) - 20deg)) scale(0); opacity: 0; }
      60%  { opacity: 1; }
      100% { transform: rotate(var(--sb-tilt)) scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sb-badge { animation: none; transform: rotate(var(--sb-tilt)); opacity: 1; }
    }
  `;
  (document.head || document.documentElement).append(style);

  const apply = () => {
    for (const p of document.querySelectorAll('p:not([data-sb-done])')) {
      if (!SOURCE.test(p.textContent)) continue;
      p.setAttribute('data-sb-done', '');
      p.setAttribute('aria-label', p.textContent.trim());
      p.classList.add('sb-row');
      p.textContent = '';
      BADGES.forEach((b, i) => {
        const s = document.createElement('span');
        s.className = 'sb-badge';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = b.text;
        s.style.cssText = `--sb-bg:${b.bg};--sb-fg:${b.fg};--sb-tilt:${b.tilt}deg;--sb-i:${i}`;
        p.append(s);
      });
      window.trif?.log('badges added');
    }
  };

  const run = () => { try { apply(); } catch (e) { window.trif?.warn(String(e)); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
