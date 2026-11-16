// A page that has changed the built-ins before anything of TRIF's asks for them (after its own body is
// built, since it needs them too). Code in the page's own world gets these; code in a world of its own
// shouldn't notice. Each stand-in counts its calls, so the page can show who walked into them.
(() => {
  const calls = {};
  window.__probeTampered = calls;
  const trap = (owner, name, lie) => {
    const real = owner[name];
    if (typeof real !== 'function') return;
    owner[name] = function () { calls[name] = (calls[name] || 0) + 1; return lie === undefined ? real.apply(this, arguments) : lie; };
  };
  // these lie
  trap(Document.prototype, 'querySelector', null);
  trap(Document.prototype, 'querySelectorAll', []);
  trap(Element.prototype, 'querySelector', null);
  trap(Element.prototype, 'querySelectorAll', []);
  trap(Document.prototype, 'elementFromPoint', null);
  trap(Element.prototype, 'getBoundingClientRect', { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
  trap(JSON, 'stringify', '"the page answered instead"');
  trap(Array.prototype, 'map', []);
  trap(Array.prototype, 'filter', []);
  trap(Array.prototype, 'join', 'the page answered instead');
  trap(String.prototype, 'trim', 'the page answered instead');
  trap(window, 'getComputedStyle', { display: 'none', position: 'static', getPropertyValue: () => '' });
  // these only watch
  trap(Element.prototype, 'append');
  trap(Node.prototype, 'appendChild');
  trap(window, 'fetch');
  // and what was added to the page after this point, which any page can see whatever world added it
  const added = [];
  window.__probeSawAdded = added;
  try {
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && added.length < 50) added.push(n.localName); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* no observer */ }
})();
