// ==WebMod==
// @name        Neon Title
// @description The title glows like a neon sign
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

// The title is the page's only <h1> (main > section.hero > h1, plain text). The CSS applies before the
// first paint, so the tube starts dark rather than flashing the normal title first.

(() => {
  const css = `
    :root {
      --nt-tube: #ffd9f2;          /* the hot core of the tube */
      --nt-glow: #ff2fb4;          /* the coloured light around it */
      --nt-off: rgba(255, 120, 200, 0.16);   /* an unlit tube: faint pink glass */
    }
    main h1 {
      color: var(--nt-off) !important;
      text-shadow: none;
      animation: nt-warmup 2.4s linear 0.35s forwards;
    }
    /* Lit: white-pink core, then rings of glow spreading out. */
    @keyframes nt-warmup {
      0%, 4%, 7%, 14%, 17%, 30%, 33%, 52%, 55% { color: var(--nt-off); text-shadow: none; }
      5%, 6%, 15%, 16%, 31%, 32%, 53%, 54% {
        color: var(--nt-tube);
        text-shadow: 0 0 4px #fff, 0 0 10px var(--nt-glow), 0 0 22px var(--nt-glow);
      }
      /* Warming up: on for good, brightening into full glow. */
      60% { color: var(--nt-tube); text-shadow: 0 0 3px #fff, 0 0 8px var(--nt-glow), 0 0 16px var(--nt-glow); }
      100% {
        color: var(--nt-tube);
        text-shadow: 0 0 2px #fff, 0 0 6px #fff, 0 0 12px var(--nt-glow), 0 0 26px var(--nt-glow),
                     0 0 46px var(--nt-glow), 0 0 80px var(--nt-glow);
      }
    }
    /* After warming up, a slow faint hum in brightness. */
    main h1.nt-lit {
      color: var(--nt-tube) !important;
      text-shadow: 0 0 2px #fff, 0 0 6px #fff, 0 0 12px var(--nt-glow), 0 0 26px var(--nt-glow),
                   0 0 46px var(--nt-glow), 0 0 80px var(--nt-glow);
      animation: nt-hum 3.2s ease-in-out infinite alternate;
    }
    @keyframes nt-hum { from { opacity: 1; } to { opacity: 0.93; } }
    /* The one bad letter: sputters off for a moment every so often. */
    /* The wave: each letter bobs, delayed by its index so the wave rolls left to right.
       Words are nowrap so the title only wraps between words. */
    main h1 .nt-word { white-space: nowrap; }
    main h1 .nt-ch {
      display: inline-block;
      animation: nt-wave 1.8s ease-in-out calc(var(--nt-i) * 0.08s - 3.6s) infinite;
    }
    @keyframes nt-wave {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-0.18em); }
    }
    main h1.nt-lit .nt-ch.nt-bad {
      animation: nt-wave 1.8s ease-in-out calc(var(--nt-i) * 0.08s - 3.6s) infinite,
                 nt-sputter 7s linear 1.5s infinite;
    }
    @keyframes nt-sputter {
      0%, 88%, 89.6%, 91%, 92.4%, 100% { color: inherit; text-shadow: inherit; }
      88.6%, 90.2%, 91.6% { color: var(--nt-off); text-shadow: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      main h1, main h1.nt-lit, main h1 .nt-ch { animation: none !important; }
      main h1 { color: var(--nt-tube) !important;
        text-shadow: 0 0 2px #fff, 0 0 6px #fff, 0 0 12px var(--nt-glow), 0 0 26px var(--nt-glow), 0 0 46px var(--nt-glow); }
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).append(style);

  const setup = () => {
    try {
      const h1 = document.querySelector('main h1');
      if (!h1) { window.trif?.warn('neon title: no <h1> found'); return; }
      // Hand over to the steady glow when the warm-up ends.
      h1.addEventListener('animationend', (e) => {
        if (e.target === h1 && e.animationName === 'nt-warmup') h1.classList.add('nt-lit');
      });
      if (h1.children.length) return;   // only plain-text titles (and only once)
      // Split into letters (for the wave), grouped in words, spaces left as text so they don't collapse.
      // One letter is the faulty tube: the "o" of "Robot" if it's there, else the 4th letter.
      const text = h1.textContent.trim();
      const r = text.indexOf('Robot');
      const badAt = r >= 0 ? r + 1 : 3;
      h1.setAttribute('aria-label', text);   // screen readers read the title, not single letters
      const parts = [];
      let pos = 0, n = 0;
      for (const piece of text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { parts.push(' '); pos += piece.length; continue; }
        const word = document.createElement('span');
        word.className = 'nt-word';
        word.setAttribute('aria-hidden', 'true');
        for (const ch of piece) {
          const s = document.createElement('span');
          s.className = pos === badAt ? 'nt-ch nt-bad' : 'nt-ch';
          s.style.setProperty('--nt-i', String(n++));
          s.textContent = ch;
          word.append(s);
          pos += ch.length;
        }
        parts.push(word);
      }
      h1.replaceChildren(...parts);
    } catch (e) { window.trif?.warn('neon title failed', String(e)); }
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})();
