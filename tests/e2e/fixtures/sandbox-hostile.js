// ==WebMod==
// @name        E2E Hostile sandboxed mod
// @match       *://127.0.0.1/sandbox.html*
// @sandboxed
// @run-at      document-idle
// ==/WebMod==

// A sandboxed mod that tries every escape in docs/SAFE-MODS.md "Sandboxed: the world" (tests/e2e/scenario.js
// sandboxedCheck). Each probe records what happened, as data on the page: "refused: <why>" (TRIF or the
// language said no), "absent" (the thing isn't there: undefined, null, false), or "did: <what>" (it worked:
// an escape, unless the scenario says that one is fine). The scenario also checks, from outside, that the
// test server saw nothing, the page noticed nothing, and the tab went nowhere.
const R = {};
const port = page.url.split('/')[2].split(':')[1];
const other = 'http://localhost:' + port; // another site (the same test server, under another name)
const t = (name, fn) => {
  try {
    const v = fn();
    R[name] = v === undefined || v === null || v === false ? 'absent' : 'did: ' + String(v).slice(0, 100);
  } catch (e) {
    R[name] = 'refused: ' + String(e && e.message).slice(0, 160);
  }
};
const absent = (name) => t('global ' + name, () => (typeof globalThis[name] === 'undefined' ? undefined : typeof globalThis[name]));

// ---- the network: no API for it, and nothing that would load from an address
for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'Worker', 'SharedWorker', 'navigator', 'Image', 'Request', 'importScripts']) absent(n);
t('sendBeacon', () => navigator.sendBeacon(other + '/e2e-sbx-leak-beacon', 'x'));
t('image at another site', () => { const i = page.create('img'); i.setAttr('src', other + '/e2e-sbx-leak-img'); page.body.append(i); return 'set'; });
t('image at this site, with a query', () => { const i = page.create('img'); i.setAttr('src', '/e2e-sbx-leak-query?d=1'); page.body.append(i); return 'set'; });
t('image at a new address on this site', () => { const i = page.create('img'); i.setAttr('src', '/e2e-sbx-leak-path.png'); page.body.append(i); return 'set'; });
t('the page\'s image pointed at another site', () => { page.find('#pimg').setAttr('src', other + '/e2e-sbx-leak-pimg'); return 'set'; });
t('CSS url() to another site (trif.css)', () => { trif.css('body { background-image: url(' + other + '/e2e-sbx-leak-css) }'); return 'added'; });
t('CSS url() in a style value', () => { page.body.style('background-image', 'url(' + other + '/e2e-sbx-leak-style)'); return 'set'; });
t('CSS image-set()', () => { trif.css('body { background-image: image-set("' + other + '/e2e-sbx-leak-set" 1x) }'); return 'added'; });
t('CSS @import', () => { trif.css('@import "' + other + '/e2e-sbx-leak-import";'); return 'added'; });
t('CSS url() spelled with an escape', () => { trif.css('body { background: u\\72l(' + other + '/e2e-sbx-leak-esc) }'); return 'added'; });
t('CSS @font-face from another site', () => { trif.css('@font-face { font-family: x; src: url(' + other + '/e2e-sbx-leak-font) }'); return 'added'; });
t('trif.hide with a selector that closes its rule', () => { trif.hide('a } body { background: url(' + other + '/e2e-sbx-leak-hide) } b'); return 'added'; });
for (const tag of ['link', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'meta', 'base', 'style', 'svg', 'video', 'audio', 'source', 'template', 'portal']) t('<' + tag + '> element', () => (page.create(tag), 'made'));
t('a link to another site', () => { page.find('#plink').setAttr('href', other + '/e2e-sbx-leak-href'); return 'set'; });
t('a link to this site with a query', () => { page.find('#plink').setAttr('href', '/two.html?leak=1'); return 'set'; });

// ---- code from strings
for (const n of ['eval', 'Function', 'Compartment', 'lockdown', 'harden']) absent(n);
t('the Function constructor, through a function', () => (function () {}).constructor('return 1')());
t('the async Function constructor', () => (async function () {}).constructor('return 1'));
t('the generator Function constructor', () => (function* () {}).constructor('yield 1'));
t('a timer with code in a string', () => setTimeout('__hits.push("string-timer")', 1));

// ---- inline handlers, javascript: URLs, srcdoc, HTML
t('an onclick attribute on the page\'s button', () => { page.find('#pbtn').setAttr('onclick', '__hits.push("onclick-set")'); return 'set'; });
t('an onerror attribute on a new image', () => { const i = page.create('img'); i.setAttr('onerror', '__hits.push("onerror")'); page.body.append(i); return 'set'; });
t('a javascript: link', () => { page.find('#plink').setAttr('href', 'javascript:__hits.push("js-url")'); return 'set'; });
t('srcdoc on the page\'s frame', () => { page.find('#frm').setAttr('srcdoc', '<p>leak</p>'); return 'set'; });
t('innerHTML with a handler', () => { const d = page.create('div'); d.innerHTML = '<img src=x onerror="__hits.push(1)">'; page.body.append(d); return 'set'; });
t('insertAdjacentHTML', () => page.body.insertAdjacentHTML('beforeend', '<img src=x onerror="__hits.push(2)">'));
t('code written into an empty script the page made', () => { page.find('#gadget').setText('__hits.push("gadget")'); return 'set'; });
t('code appended to an empty script the page made', () => { page.find('#gadget').append('__hits.push("gadget2")'); return 'set'; });
t('CSS written into the page\'s style element', () => { page.find('#pstyle').setText('body { background: url(' + other + '/e2e-sbx-leak-pstyle) }'); return 'set'; });
t('trif.text rewriting the page\'s style element', () => {
  trif.text('#pstyle', () => 'body { background: url(' + other + '/e2e-sbx-leak-ptext) }');
  return page.find('#pstyle').text.includes('leak') ? 'written' : undefined;
});

// ---- other windows and frames, the page's globals and prototypes
for (const n of ['window', 'document', 'self', 'top', 'parent', 'frames', 'opener', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB',
  'caches', 'cookieStore', 'chrome', 'browser', 'postMessage', 'open', 'alert', '__pageSecret', '__hits', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser', 'customElements', 'trustedTypes']) absent(n);
t('the page\'s globals from the compartment\'s global', () => Object.getOwnPropertyNames(globalThis).filter((n) => /^on|document|window|webkit|chrome/.test(n)).join() || undefined);
t('a frame\'s window', () => page.find('#frm').contentWindow);
t('a frame\'s document', () => page.find('#frm').contentDocument);
t('into a frame', () => page.find('#frm').find('h1'));
t('a frame by index', () => globalThis[0]);
t('the language\'s prototypes (Array.prototype)', () => { Array.prototype.__trifEscape = 1; return 'set'; });
t('the language\'s prototypes (Object.prototype)', () => { Object.prototype.__trifEscape = 1; return 'set'; });
t('a stand-in\'s prototype', () => { Object.getPrototypeOf(page.root).sneaky = 1; return 'set'; });
t('a stand-in itself', () => { page.root.sneaky = 1; return 'set'; });
t('a stand-in method on something TRIF didn\'t make', () => { Object.getPrototypeOf(page.root).append.call({}, 'x'); return 'called'; });
const plainError = (fn) => () => { try { fn(); } catch (e) { return Object.getPrototypeOf(e) === TypeError.prototype ? undefined : 'another kind: ' + Object.prototype.toString.call(e) + ' ' + (e && e.constructor && e.constructor.name); } return 'no error'; };
t('a DOMException through classes', plainError(() => page.body.classes.add('two words')));
t('a DOMException through a canvas', plainError(() => { const c = page.create('canvas').canvas(); c.arc(0, 0, -1, 0, 1); }));
t('a DOMException through a selector', plainError(() => page.body.closest('[[[')));
t('a browser error object (a DOMException) reaching the mod', () => {
  try { page.find('[[['); } catch (e) { return Object.getPrototypeOf(e) === TypeError.prototype ? undefined : 'another kind: ' + Object.prototype.toString.call(e) + ' ' + (e && e.constructor && e.constructor.name); }
  return 'no error';
});

// ---- synthetic input
t('click()', () => page.find('#fb').click());
t('dispatchEvent', () => page.find('#fb').dispatchEvent);
t('focus()', () => page.find('#fi').focus);
t('submit()', () => page.find('#f').submit);
t('requestSubmit()', () => page.find('#f').requestSubmit);
t('a form field\'s value', () => { page.find('#fi').setAttr('value', 'changed'); return 'set'; });
t('a textarea\'s text', () => { page.find('#ta').setText('changed'); return 'set'; });
t('an option\'s text', () => { page.find('#opt').setText('changed'); return 'set'; });
t('execCommand', () => document.execCommand('copy'));

// ---- navigation
t('location', () => { location.href = '/e2e-sbx-leak-nav'; return 'set'; });
t('window.open', () => open('/e2e-sbx-leak-open'));
t('a target=_blank link, made', () => { page.find('#plink').setAttr('target', '_blank'); return 'set'; });
t('a target=_blank link, clicked', () => page.find('#blank').click());

// ---- the clipboard, cookies and storage, messages
t('the clipboard', () => navigator.clipboard.writeText('x'));
t('cookies', () => document.cookie);
t('localStorage', () => localStorage.getItem('x'));
t('postMessage to the page', () => postMessage('x', '*'));

page.root.setAttr('data-sbx-hostile', JSON.stringify(R));
