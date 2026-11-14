// The element the user last right-clicked, for "Hide this" and "Point TRIF at this" (the right-click menu,
// background.js onMenuClick; hidethis.js reads it). Chrome's menu click doesn't say which element it was
// (Firefox's does: menus.getTargetElement), so this keeps it: in the extension's isolated world of the top
// frame, on the pages TRIF has access to (registered for <all_urls>, which the browser narrows to those).
// Also the frame the mouse last went into: a menu opened inside a frame is about that frame here. Nothing is
// sent anywhere; the background asks for it only when its menu is clicked.
(() => {
  if (globalThis.__trifContext) return;
  const rec = globalThis.__trifContext = { target: null, frame: null, at: 0 };
  addEventListener('contextmenu', (e) => { rec.target = e.target; rec.at = Date.now(); }, true);
  addEventListener('mouseover', (e) => {
    const t = e.target;
    if (t && (t.localName === 'iframe' || t.localName === 'frame' || t.localName === 'embed' || t.localName === 'object')) rec.frame = t;
  }, true);
})();
