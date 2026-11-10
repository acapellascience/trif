// ==WebMod==
// @name        E2E Boxed mod, the other end of a channel
// @match       *://127.0.0.1/powers3.html*
// @boxed
// @powers      mods
// @run-at      document-idle
// ==/WebMod==

// The other end of e2e-pw3's channel (tests/e2e/scenario.js powers3Check): answers what it hears.
const ch = trif.channel('e2e');
ch.on((msg, info) => {
  if (msg && msg.echo) return;
  ch.send({ echo: msg, by: 'b' });
  page.root.setAttr('data-trif-box-pw3b', `${JSON.stringify(msg)} from ${info.from}`);
});
