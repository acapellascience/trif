'use strict';
// CSS for the checkers' tests (tests/hardening.test.js, tests/css-browser.test.js): ordinary CSS, and CSS
// where a checker that reads strings, comments or url() differently from a browser would miss what loads.
// `canary`: the address that must never be loaded by CSS a style mod is allowed.

const CANARY = 'https://canary.example/x';

function cssCases(CANARY) {
  return [
  'a { color: red }',
  'a { background: url(data:image/png;base64,AAAA) }',
  'a { background: url( "data:image/png;base64,AAAA" ) }',
  `a { background: url(${CANARY}) }`,
  `a { background: URL("${CANARY}") }`,
  `a { background: image-set("${CANARY}" 1x) }`,
  `@import "${CANARY}";`,
  'a::after { content: "url(x) /* not a comment */ @import" }',
  // a string CSS ends at the line break: what follows is live CSS, not the string's text
  `a { --x: "\n} html { background: image-set("${CANARY}" 1x) } b { --y: " }`,
  `a { --x: '\n} html { background: url(${CANARY}) } b { --y: ' }`,
  `a { --x: "\r} @import "${CANARY}"; b { --y: " }`,
  `a { --x: "\f} html { background: url(${CANARY}) } b { --y: " }`,
  'a::after { content: "two \\\nlines" }', // (an escaped line break continues the string: fine)
  // an unquoted url() is one token: a /* in it starts no comment
  `a { background: url(data:,/*) } html { background: url(${CANARY}) } b { background: url(data:,*/) }`,
  `a { background: url(data:,/*) } html { background: image-set("${CANARY}" 1x) } b { c: url(data:,*/) }`,
  `a { background: url(data:,x"y) }`,
  `a { background: url(data:,x y) }`,
  'a { background: url("data:,x" }',
  `a { background: url("\\68${CANARY.slice(1)}") }`,
  'a { color: red /* never closed',
  'a { content: "never closed',
  `a { background: u\\72l(${CANARY}) }`,
  `a { background: src("${CANARY}") }`,
];
}

module.exports = { CANARY, cssCases };
