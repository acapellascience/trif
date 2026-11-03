// ==WebMod==
// @name        Jelly buttons
// @description Buttons wobble like jelly when you hover them
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// ==/WebMod==

// The page's buttons are links styled as a.btn ("Get it", "GitHub"); real <button>s are covered too.
// The site gives .btn "transition: all", which would smear the keyframes, so transform is taken out of it.

(() => {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes jb-jelly {
      0%   { transform: scale(1, 1); }
      25%  { transform: scale(1.18, 0.82); }
      40%  { transform: scale(0.86, 1.14); }
      55%  { transform: scale(1.08, 0.92); }
      70%  { transform: scale(0.96, 1.04); }
      85%  { transform: scale(1.02, 0.98); }
      100% { transform: scale(1, 1); }
    }
    main .btn, main button { transition-property: color, background-color, border-color, box-shadow, opacity !important; }
    main .btn:hover, main button:hover { animation: jb-jelly 0.7s ease-out both; }
    @media (prefers-reduced-motion: reduce) {
      main .btn:hover, main button:hover { animation: none; }
    }
  `;
  (document.head || document.documentElement).append(style);
})();
