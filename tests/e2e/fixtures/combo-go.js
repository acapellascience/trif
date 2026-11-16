// ==WebMod==
// @name        E2E Combo go
// @match       *://127.0.0.1/combo-go.html*
// @boxed
// @powers      go-to /combo-dest.html
// @run-at      document-start
// ==/WebMod==

// The split pair across a navigation (tests/e2e/scenario.js comboFixesCheck, review F3): go-to alone, at
// once, to a page where another boxed mod (e2e-combo-act) runs, which has click and page-events but no go-to.
// There, that mod's clicks and signals are refused until the user's own click or key.
trif.goTo('/combo-dest.html');
