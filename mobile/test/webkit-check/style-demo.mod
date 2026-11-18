// ==WebMod==
// @name        Style section demo
// @match       http://localhost/*
// @run-at      document-start
// ==/WebMod==
// ==Style==
// {
//   "css": [
//     "html::before { content: 'STYLE SECTION APPLIED'; display: block; position: fixed; left: 0; right: 0; top: 30%; z-index: 2147483000; padding: 24px 8px; text-align: center; font: 900 var(--titleSize)/1.1 'Helvetica Neue', Helvetica, sans-serif; color: #fff; background: var(--accent); }",
//     "html[data-demo-ran] body { outline: 12px solid var(--accent); }"
//   ],
//   "settings": {
//     "accent":    { "type": "colour", "value": "#0866ff" },
//     "titleSize": { "type": "number", "value": 34, "min": 16, "max": 40, "unit": "px" }
//   }
// }
// ==/Style==
document.documentElement.setAttribute('data-demo-ran', String(trif.style.titleSize));
window.trif?.log?.('demo: on ' + location.pathname + ', titleSize ' + trif.style.titleSize);
window.trif?.warn('demo: a warning');
