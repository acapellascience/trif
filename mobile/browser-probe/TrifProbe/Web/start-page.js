// At the very start of every page, in the page's own world: notes how early that was (the place a free
// mod would run). One global, which the checks read.
(function () {
  if (window.top !== window || window.__trifProbePageStart) return;
  var root = document.documentElement;
  window.__trifProbePageStart = {
    ms: Math.round(performance.now() * 10) / 10, readyState: document.readyState,
    pageRan: root ? root.getAttribute('data-page-ran') !== null : false, head: !!document.head, body: !!document.body, scripts: document.scripts.length,
  };
})();
