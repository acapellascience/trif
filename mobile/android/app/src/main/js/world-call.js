// Android's adapter, first in each of TRIF's worlds (TRIF's own, the box): the app's way to run code in this world
// and get its answer back (iPhone: WKWebView.callAsyncJavaScript(in: world); Android has no such call, only the
// message object the app gives this world, `trifApp`). It says hello at the page's start (that's how the app gets
// its way back to this page), then runs each `{call, code, args}` the app sends as an async function body with
// `args`, and answers `{reply, ok, value | error}` (value: what it returned, as JSON). Kept before SES, so the
// box's lockdown doesn't change what it uses.
(() => {
  const app = globalThis.trifApp;
  if (!app || globalThis.__trifWorldCall) return;
  const AsyncFunction = (async () => {}).constructor, stringify = JSON.stringify, parse = JSON.parse;
  globalThis.__trifWorldCall = true;
  const post = app.postMessage.bind(app);
  app.addEventListener('message', async (e) => {
    let m;
    try { m = parse(e.data); } catch (err) { return; }
    if (!m || typeof m.call !== 'number') return;
    let out;
    try {
      const v = await new AsyncFunction('args', String(m.code))(m.args || {});
      out = { reply: m.call, ok: true, value: v === undefined ? null : v };
    } catch (err) { out = { reply: m.call, ok: false, error: String((err && err.message) || err).slice(0, 2000) }; }
    try { post(stringify(out)); } catch (err) { post(stringify({ reply: m.call, ok: false, error: 'its answer is not JSON' })); }
  });
  post(stringify({ hello: location.href }));
})();
