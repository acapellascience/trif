// Android's adapter, in TRIF's world after world-call.js: the iPhone scripts post to the app with
// window.webkit.messageHandlers.trif.postMessage(body), which gives back a promise of the app's answer. Here that
// goes through the app's message object, `trifApp`: `{post, body}` out, `{answer, ok, value | error}` back.
// The Mods tab's page (mods.html, the page world of a WebView of its own) posts to `app` instead: ModsPanel.kt
// puts this in with the last line's name changed.
((name) => {
  const app = globalThis.trifApp;
  if (!app || globalThis.webkit) return;
  const stringify = JSON.stringify, parse = JSON.parse;
  const waiting = new Map();
  let n = 0;
  app.addEventListener('message', (e) => {
    let m;
    try { m = parse(e.data); } catch (err) { return; }
    if (!m || typeof m.answer !== 'number' || !waiting.has(m.answer)) return;
    const w = waiting.get(m.answer);
    waiting.delete(m.answer);
    if (m.ok) w.resolve(m.value); else w.reject(new Error(m.error || 'the app refused it'));
  });
  const postMessage = (body) => new Promise((resolve, reject) => {
    const id = ++n;
    waiting.set(id, { resolve, reject });
    try { app.postMessage(stringify({ post: id, body })); } catch (err) { waiting.delete(id); reject(err); }
  });
  Object.defineProperty(globalThis, 'webkit', { value: Object.freeze({ messageHandlers: Object.freeze({ [name]: Object.freeze({ postMessage }) }) }) });
})('trif');
