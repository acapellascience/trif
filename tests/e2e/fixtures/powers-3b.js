// ==WebMod==
// @name        E2E Boxed mod, the other end of a channel
// @match       *://127.0.0.1/powers3.html*
// @boxed
// @powers      mods, click
// @click       the other button: #pbtn
// @run-at      document-idle
// ==/WebMod==

// The other end of e2e-pw3's channel (tests/e2e/scenario.js powers3Check): answers what it hears. And a
// click beside e2e-pw3's read (read-drafts), which this mod didn't ask for: refused by the page-wide rule unless
// the user approved the site's mods together, which the holds ask (site approval), so it goes through here.
setTimeout(() => {
  let r;
  try { page.find('#pbtn').click(); r = 'clicked'; } catch (e) { r = `refused: ${e.message}`; }
  page.root.setAttr('data-trif-box-pw3b-click', r);
}, 300);
const ch = trif.channel('e2e');
ch.on((msg, info) => {
  if (msg && msg.echo) return;
  ch.send({ echo: msg, by: 'b' });
  page.root.setAttr('data-trif-box-pw3b', `${JSON.stringify(msg)} from ${info.from}`);
});
