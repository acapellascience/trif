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

// mods.js: what the app needs to take a whole mod file (proof of concept, branch ios-poc): TRIF's style
// rules (helper/lib/rules.js, as it is), a header reader and @match patterns, as globalThis.__trifMods. The
// app runs it in JavaScriptCore when a mod is added, and puts each mod's ready code in the right world.
const MODS_OUT = path.join(__dirname, 'shared', 'gen', 'mods.js');
function modsFile() {
  const rules = fs.readFileSync(path.join(ROOT, 'helper', 'lib', 'rules.js'), 'utf8');
  const own = fs.readFileSync(path.join(__dirname, 'shared', 'modfile.js'), 'utf8');
  return `// Made by mobile/prepare.js from helper/lib/rules.js and mobile/shared/modfile.js: don't edit.\n` +
    `globalThis.__trifMods = (function () {\nconst module = { exports: {} };\n${rules}\nconst rules = module.exports;\n${own}\nreturn api;\n})();\n`;
}

// mod-guide.txt: what the chat is told about writing a mod, with the page's outline (the copy for Claude):
// the agent guide's style-mod section and the boxed-mod section, as the workspace has them.
const GUIDE_OUT = path.join(__dirname, 'shared', 'gen', 'mod-guide.txt');
function guideFile() {
  const between = (file, start, end) => {
    const t = fs.readFileSync(path.join(ROOT, 'helper', 'workspace', file), 'utf8');
    const a = t.indexOf(start), b = t.indexOf(end, a + 1);
    if (a === -1 || b === -1) throw new Error(`${file}: no "${start}" … "${end}"`);
    return t.slice(a, b).trim();
  };
  return `${between('AGENTS.md', '### Style mods: start here', '### A style section')}\n\n${between('BOXED.md', '## Boxed mods: when a style mod isn', '### Powers')}\n`;
}

async function main() {
  const files = [[OUT, await runtimeFile()], [CHECKS_OUT, checksFile()], [MODS_OUT, modsFile()], [GUIDE_OUT, guideFile()]];
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
