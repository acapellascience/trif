// The phone view's page script (docs/MOBILE-EDIT.md; extension/phone.js). A classic script, registered with
// chrome.scripting.registerContentScripts in the page's own world (MAIN) at document_start, in every frame,
// on the sites TRIF has access to, only while a phone window is open. It runs on every page of those sites,
// so the first thing it does is decide whether this document is in the phone tab, synchronously, before the
// site's first script: the phone tab's declarativeNetRequest rules add `Server-Timing: trif-phone` to its
// pages' responses (phone.js phoneRules), and nothing else gets that entry. A page that isn't in the phone tab
// returns at once, with nothing changed.
//
// In the phone tab it makes the page's JavaScript see what Safari on an iPhone shows it: the user agent (the
// request headers are the rules' job), no navigator.userAgentData (Safari has none), touch (maxTouchPoints,
// ontouchstart, TouchEvent, matchMedia's pointer and hover), an iPhone's screen, window.orientation; and a
// mouse that behaves like a finger: a press is a touch (touchstart, touchmove, touchend from the mouse's
// press, drag and release), pointer events say "touch", and a mouse that only moves over the page (a hover,
// which a finger can't do) isn't passed to the page's scripts.
//
// What it can't change: CSS (@media (hover: hover) and (pointer: fine) in style sheets still match the
// mouse; :hover still applies), workers' navigator, and requests no tab owns (a service worker's). The
// device pixel ratio stays the screen's own: style sheets and image-set() go by the real one, and a page
// whose JavaScript saw another would draw its canvases at the wrong size.

(() => {
  'use strict';
  const MARK = 'trif-phone';
  let mine = false;
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    mine = !!nav && Array.isArray(nav.serverTiming) && nav.serverTiming.some((e) => e.name === MARK);
    // (a frame: the rules mark every frame's document in the phone tab; about:blank and srcdoc frames, which
    // have no response, follow their parent)
    if (!mine && window !== top && (location.protocol === 'about:' || location.href === 'about:srcdoc')) {
      try { mine = !!parent.__trifPhone; } catch { /* another origin's: not ours to read */ }
    }
  } catch { /* no Performance timeline: leave the page as it is */ }
  if (!mine) return;

  // The profile, from phone.js PHONE (kept the same by tests/phone.test.js).
  const P = {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone', vendor: 'Apple Computer, Inc.', touchPoints: 5, screen: { width: 402, height: 874 },
  };

  const define = (obj, prop, get) => {
    try { Object.defineProperty(obj, prop, { get, set: undefined, configurable: true, enumerable: true }); } catch { /* sealed */ }
  };
  Object.defineProperty(window, '__trifPhone', { value: true, configurable: false, enumerable: false });

  // ---- navigator
  const N = Navigator.prototype;
  define(N, 'userAgent', () => P.ua);
  define(N, 'appVersion', () => P.ua.slice('Mozilla/'.length));
  define(N, 'platform', () => P.platform);
  define(N, 'vendor', () => P.vendor);
  define(N, 'maxTouchPoints', () => P.touchPoints);
  define(N, 'standalone', () => false);
  // (Safari has no User-Agent Client Hints: no navigator.userAgentData at all, so `'userAgentData' in navigator` is false)
  try { delete N.userAgentData; } catch { /* kept */ }
  try { if ('userAgentData' in navigator) define(N, 'userAgentData', () => undefined); } catch { /* kept */ }

  // ---- the screen, and the phone held upright
  const S = Screen.prototype;
  define(S, 'width', () => P.screen.width);
  define(S, 'height', () => P.screen.height);
  define(S, 'availWidth', () => P.screen.width);
  define(S, 'availHeight', () => P.screen.height);
  try {
    if (typeof ScreenOrientation !== 'undefined') {
      define(ScreenOrientation.prototype, 'type', () => 'portrait-primary');
      define(ScreenOrientation.prototype, 'angle', () => 0);
    }
  } catch { /* none */ }
  define(window, 'orientation', () => 0);
  define(window, 'outerWidth', () => innerWidth);
  define(window, 'outerHeight', () => P.screen.height);
  define(window, 'screenX', () => 0);
  define(window, 'screenY', () => 0);
  define(window, 'screenLeft', () => 0);
  define(window, 'screenTop', () => 0);

  // ---- touch: the handlers' properties (`'ontouchstart' in window`, a common check), the event classes,
  // document.createEvent('TouchEvent')
  const TOUCH = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
  const handlerProp = (proto, type) => {
    const key = Symbol(type);
    if (Object.prototype.hasOwnProperty.call(proto, `on${type}`)) return;
    try {
      Object.defineProperty(proto, `on${type}`, {
        configurable: true, enumerable: true,
        get() { return this[key] || null; },
        set(fn) {
          if (this[key]) this.removeEventListener(type, this[key]);
          this[key] = typeof fn === 'function' ? fn : null;
          if (this[key]) this.addEventListener(type, this[key]);
        },
      });
    } catch { /* sealed */ }
  };
  for (const proto of [Window.prototype, Document.prototype, HTMLElement.prototype, SVGElement.prototype]) {
    for (const t of [...TOUCH, 'orientationchange'].filter((x) => x !== 'orientationchange' || proto === Window.prototype)) handlerProp(proto, t);
  }
  let TouchCls = typeof Touch === 'function' ? Touch : null;
  let TouchEventCls = typeof TouchEvent === 'function' ? TouchEvent : null;
  // (a desktop without a touch screen may hide both: stand-ins with the same fields)
  if (!TouchCls) {
    TouchCls = class Touch {
      constructor(init = {}) {
        for (const k of ['identifier', 'target', 'clientX', 'clientY', 'screenX', 'screenY', 'pageX', 'pageY', 'radiusX', 'radiusY', 'rotationAngle', 'force']) this[k] = init[k] ?? (k === 'target' ? null : k === 'force' ? 1 : 0);
      }
    };
    Object.defineProperty(window, 'Touch', { value: TouchCls, configurable: true, writable: true });
  }
  const list = (touches) => {
    const l = [...touches];
    l.item = (i) => l[i] || null;
    return l;
  };
  if (!TouchEventCls) {
    TouchEventCls = class TouchEvent extends UIEvent {
      constructor(type, init = {}) {
        super(type, init);
        this._t = list(init.touches || []); this._c = list(init.changedTouches || []); this._g = list(init.targetTouches || []);
        for (const k of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) Object.defineProperty(this, k, { value: !!init[k] });
      }
      get touches() { return this._t; }
      get changedTouches() { return this._c; }
      get targetTouches() { return this._g; }
    };
    Object.defineProperty(window, 'TouchEvent', { value: TouchEventCls, configurable: true, writable: true });
  }
  const createEvent = Document.prototype.createEvent;
  Document.prototype.createEvent = function (kind) {
    if (/^touchevents?$/i.test(String(kind))) {
      try { return createEvent.call(this, kind); } catch { return new TouchEventCls(''); }
    }
    return createEvent.call(this, kind);
  };

  // ---- matchMedia: pointer and hover are a finger's. Each such feature in the query is replaced with one
  // that's always true or always false (min-width: 0 is always true), so `and`, `,`, `not` and `only` still work.
  const TRUE = '(min-width: 0px)';
  const FALSE = '(not (min-width: 0px))';
  const FEATURE = /\(\s*(any-)?(pointer|hover)\s*(?::\s*([a-z-]+)\s*)?\)/gi;
  const finger = (feature, value) => {
    if (!value) return feature === 'pointer'; // (`(pointer)`: there is one; `(hover)`: it can't)
    if (feature === 'pointer') return value.toLowerCase() === 'coarse';
    return value.toLowerCase() === 'none';
  };
  const rewrite = (q) => String(q).replace(FEATURE, (_, any, feature, value) => (finger(feature.toLowerCase(), value) ? TRUE : FALSE));
  const matchMedia = window.matchMedia;
  window.matchMedia = function (query) {
    const asked = String(query);
    const mql = matchMedia.call(this, rewrite(asked));
    if (rewrite(asked) !== asked) { try { Object.defineProperty(mql, 'media', { value: asked, configurable: true }); } catch { /* kept */ } }
    return mql;
  };

  // ---- the mouse as a finger
  try {
    if (typeof PointerEvent === 'function') {
      const desc = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'pointerType');
      if (desc && desc.get) define(PointerEvent.prototype, 'pointerType', function () { const t = desc.get.call(this); return t === 'mouse' ? 'touch' : t; });
    }
  } catch { /* kept */ }
  let down = null; // {target, id} while the button is held
  let ids = 0;
  let cancelled = false; // the page called preventDefault on touchstart: the mouse events that follow aren't its
  const touchOf = (e, target) => new TouchCls({ identifier: down ? down.id : ids, target, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, pageX: e.pageX, pageY: e.pageY, radiusX: 11, radiusY: 11, force: 1 });
  const send = (type, e, target, active) => {
    const t = touchOf(e, target);
    const ev = new TouchEventCls(type, { bubbles: true, cancelable: type !== 'touchcancel', composed: true, view: window, touches: active ? [t] : [], targetTouches: active ? [t] : [], changedTouches: [t] });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const HOVER_ONLY = ['mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave'];
  addEventListener('mousedown', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    down = { target: e.composedPath()[0] instanceof Node ? e.composedPath()[0] : e.target, id: ++ids };
    cancelled = send('touchstart', e, down.target, true);
    if (cancelled) e.stopImmediatePropagation();
  }, true);
  addEventListener('mousemove', (e) => {
    if (!e.isTrusted) return;
    if (!down) { e.stopImmediatePropagation(); return; } // (a hover)
    if (send('touchmove', e, down.target, true) || cancelled) e.stopImmediatePropagation();
  }, true);
  addEventListener('mouseup', (e) => {
    if (!e.isTrusted || !down) return;
    const prevented = send('touchend', e, down.target, false);
    down = null;
    if (prevented || cancelled) { e.stopImmediatePropagation(); cancelled = true; setTimeout(() => { cancelled = false; }, 0); }
  }, true);
  addEventListener('click', (e) => { if (e.isTrusted && cancelled) { e.stopImmediatePropagation(); e.preventDefault(); cancelled = false; } }, true);
  for (const type of HOVER_ONLY.filter((t) => t !== 'mousemove')) {
    addEventListener(type, (e) => { if (e.isTrusted && !down && (e.buttons || 0) === 0) e.stopImmediatePropagation(); }, true);
  }
})();
