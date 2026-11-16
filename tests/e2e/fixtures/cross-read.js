// ==WebMod==
// @name        E2E Cross read
// @match       *://127.0.0.1/cross.html*
// @boxed
// @powers      keys
// @run-at      document-start
// ==/WebMod==

// Site approval (tests/e2e/scenario.js siteApprovalCheck): a mod with a read (keys) and nothing that acts. Beside
// it, the other mod's click makes a warned pair split between two mods: refused until the user approves the site's
// mods together.
page.on('keydown', (e) => { if (e.key) page.root.setAttr('data-trif-box-cm-key', String(e.key)); });
