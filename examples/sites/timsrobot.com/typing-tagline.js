// ==WebMod==
// @name        Typing Tagline
// @description The line under the title types itself out like a terminal, with a blinking cursor; then "your own coding agent" glows green
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// The tagline is main > section.hero > p.tagline (plain text). It's hidden from the first paint so the
// full sentence doesn't flash before typing starts; a 3 s fallback un-hides it if anything goes wrong.
// The not-yet-typed part stays in the line, invisible, so each letter appears where it ends up
// (the line is centred) and nothing reflows while typing.

(() => {
  const GLOW = 'your own coding agent';
  const html = document.documentElement;

  const style = document.createElement('style');
  style.textContent = `
    html:not([data-tt-ready]) .hero .tagline { visibility: hidden; }
    .tt-rest { visibility: hidden; }
    .tt-cursor {
      display: inline-block; width: 0.55em; height: 1.05em; margin: 0 1px;
      vertical-align: -0.15em; background: #39ff7a; box-shadow: 0 0 6px #39ff7a;
      animation: tt-blink 1s steps(1, end) infinite;
    }
    .tt-typing .tt-cursor { animation: none; }           /* solid while typing, like a real terminal */
    @keyframes tt-blink { 50% { opacity: 0; } }
    .tt-glow {
      color: #5dff8f;
      animation: tt-glow-in 1.2s ease-out forwards, tt-pulse 2.8s ease-in-out 1.2s infinite;
    }
    @keyframes tt-glow-in {
      from { color: inherit; text-shadow: none; }
      to   { color: #5dff8f; text-shadow: 0 0 6px #39ff7a, 0 0 16px #1fd65f, 0 0 30px #12a84a; }
    }
    @keyframes tt-pulse {
      0%, 100% { text-shadow: 0 0 6px #39ff7a, 0 0 16px #1fd65f, 0 0 30px #12a84a; }
      50%      { text-shadow: 0 0 4px #39ff7a, 0 0 10px #1fd65f, 0 0 18px #12a84a; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tt-cursor, .tt-glow { animation: none; }
      .tt-glow { text-shadow: 0 0 6px #39ff7a, 0 0 16px #1fd65f; }
    }
  `;
  html.append(style);
  const reveal = () => html.setAttribute('data-tt-ready', '');
  setTimeout(reveal, 3000);

  const el = (tag, cls, text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };

  const start = () => {
    try {
      const p = document.querySelector('.hero .tagline');
      if (!p || p.hasAttribute('data-tt-done')) { reveal(); return; }
      p.setAttribute('data-tt-done', '');
      const text = p.textContent.trim();
      const g = text.indexOf(GLOW);
      p.setAttribute('aria-label', text);

      const finish = () => {
        p.classList.remove('tt-typing');
        p.textContent = '';
        const parts = g < 0 ? [document.createTextNode(text)] : [
          document.createTextNode(text.slice(0, g)),
          el('span', 'tt-glow', GLOW),
          document.createTextNode(text.slice(g + GLOW.length)),
        ];
        p.append(...parts, el('span', 'tt-cursor'));
        p.querySelectorAll('span').forEach((s) => s.setAttribute('aria-hidden', 'true'));
      };

      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); reveal(); return; }

      const typed = el('span', 'tt-typed'), cursor = el('span', 'tt-cursor'), rest = el('span', 'tt-rest', text);
      [typed, cursor, rest].forEach((s) => s.setAttribute('aria-hidden', 'true'));
      p.textContent = '';
      p.classList.add('tt-typing');
      p.append(typed, cursor, rest);
      reveal();

      let i = 0;
      const step = () => {
        try {
          i++;
          typed.textContent = text.slice(0, i);
          rest.textContent = text.slice(i);
          if (i >= text.length) { setTimeout(finish, 250); return; }
          const ch = text[i - 1];
          // Human-ish rhythm: a little jitter, a beat after spaces and punctuation.
          setTimeout(step, 45 + Math.random() * 45 + (ch === ' ' ? 40 : 0) + (/[.,]/.test(ch) ? 200 : 0));
        } catch (e) { window.trif?.warn('typing failed', String(e)); finish(); }
      };
      // Blink a few times at an empty prompt before typing.
      cursor.style.animation = 'tt-blink 1s steps(1, end) infinite';
      setTimeout(() => { cursor.style.animation = ''; step(); }, 900);
    } catch (e) { window.trif?.warn('typing tagline failed', String(e)); reveal(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
