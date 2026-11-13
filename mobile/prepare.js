#!/usr/bin/env node
'use strict';
// Writes the two files in mobile/shared/gen that are made from other files:
//
// - sandbox-runtime.js: TRIF's sandbox runtime (extension/sandbox.js) as one file that defines
//   globalThis.__trifStartSandbox and doesn't start it, so a probe can start it inside a try and report why
//   it failed. Both probes load it after SES (extension/vendor/ses.umd.min.js).
// - browser-checks.json: the browser probe's JavaScript checks (mobile/browser-probe/checks.js) as text the
//   app can hand to WKWebView. Each step becomes the body of an async function that gets `prevJson` and
//   returns JSON text.
//
//   node mobile/prepare.js           write them
//   node mobile/prepare.js --check   exit 1 if either isn't what the current sources give

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'shared', 'gen', 'sandbox-runtime.js');

async function runtimeFile() {
  const sb = await import(pathToFileURL(path.join(ROOT, 'extension', 'sandbox.js')).href);
  return `// Made by mobile/prepare.js from extension/sandbox.js: don't edit. Needs SES loaded first.\nglobalThis.__trifStartSandbox = function () {\n${sb.sandboxRuntimeCode()}\n};\n`;
}

const CHECKS_OUT = path.join(__dirname, 'shared', 'gen', 'browser-checks.json');
const stepBody = (fn) => `const prev = JSON.parse(prevJson);\nconst out = await (${fn.toString()})(prev);\nreturn JSON.stringify(out === undefined ? null : out);`;
function checksFile() {
  const checks = require('./browser-probe/checks');
  return `${JSON.stringify(checks.map((c) => ({ id: c.id, group: c.group, title: c.title, steps: c.steps.map(([world, fn]) => ({ world, body: stepBody(fn) })) })), null, 1)}\n`;
}

async function main() {
  const files = [[OUT, await runtimeFile()], [CHECKS_OUT, checksFile()]];
  for (const [file, text] of files) {
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`${path.relative(ROOT, file)} is out of date: run node mobile/prepare.js`); process.exit(1); }
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(ROOT, file)} (${(text.length / 1024).toFixed(0)} KB)`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { runtimeFile, checksFile, stepBody, OUT, CHECKS_OUT };
