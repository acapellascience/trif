#!/usr/bin/env node
'use strict';
// Writes the files in mobile/shared/gen that are made from other files (mods.js and panel-kit.js: below):
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

// mods.js: what the app needs to take a whole mod file: the helper's own reading of it (helper/lib/mods.js
// buildMod: the header, the hash, a style section, a boxed mod's powers and their values), TRIF's style rules
// (rules.js), what a boxed mod's powers need allowing (boxpowers.js, combinations.js) and what TRIF's reading of
// a free mod's code finds (powers.js), what the sandbox would refuse in a boxed mod (sandboxlint.js), each file as it is, in a small CommonJS bundle with stand-ins for the
// Node built-ins they name but don't use here; then mobile/shared/modfile.js, which makes each mod's ready code
// for its world, as globalThis.__trifMods. The app runs it in JavaScriptCore.
const MODS_OUT = path.join(__dirname, 'shared', 'gen', 'mods.js');
const HELPER_LIBS = ['rules', 'combinations', 'boxpowers', 'powers', 'mods', 'stylesection', 'framing', 'pathcheck', 'scope', 'diff', 'sandboxlint'];
function modsFile() {
  const libs = HELPER_LIBS.map((n) => `${JSON.stringify(`./${n}`)}: function (module, exports, require) {\n${fs.readFileSync(path.join(ROOT, 'helper', 'lib', `${n}.js`), 'utf8')}\n}`);
  const shims = fs.readFileSync(path.join(__dirname, 'shared', 'node-shims.js'), 'utf8');
  const own = fs.readFileSync(path.join(__dirname, 'shared', 'modfile.js'), 'utf8');
  return `// Made by mobile/prepare.js from helper/lib/{${HELPER_LIBS.join(',')}}.js, mobile/shared/node-shims.js and mobile/shared/modfile.js: don't edit.\n` +
    `globalThis.__trifMods = (function () {\n'use strict';\n${shims}\nconst SOURCES = {\n${libs.join(',\n')}\n};\n` +
    'const cache = {};\nfunction require(name) {\n  if (BUILTINS[name]) return BUILTINS[name];\n  const key = name.replace(/\\.js$/, \'\');\n  if (cache[key]) return cache[key].exports;\n  if (!SOURCES[key]) throw new Error(`the app has no ${name}`);\n  const module = { exports: {} };\n  cache[key] = module;\n  SOURCES[key](module, module.exports, require);\n  return module.exports;\n}\n' +
    `${own}\nreturn api;\n})();\n`;
}

// panel-kit.js: what the Mods tab (TrifProbe/Web/mods.html) shares with the desktop side panel, as it is: the row
// icons (extension/icons.js), how noticeable a mod is and its icons' words (modlevel.js), the explanations
// behind each "i" (explain.js with explain.json), the switch (modswitch.js) and the robot's outline from the
// panel's bar (sidepanel.html), as one plain script (their exports made top-level declarations).
const KIT_OUT = path.join(__dirname, 'shared', 'gen', 'panel-kit.js');
function kitFile() {
  const plain = (file) => fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export (const|function|async function|let) /gm, '$1 ')
    .replace(/import\.meta\.url/g, 'location.href');
  const html = fs.readFileSync(path.join(ROOT, 'extension', 'sidepanel.html'), 'utf8');
  const bar = /<button id="bar-robot"[^>]*>\s*<svg[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  if (!bar) throw new Error('sidepanel.html: no #bar-robot svg');
  const robot = [...bar[1].matchAll(/<polygon class="(rim|face|eye)" points="([^"]+)"\/>/g)].map((m) => ({ cls: m[1], points: m[2] }));
  if (!robot.some((p) => p.cls === 'rim') || robot.filter((p) => p.cls === 'eye').length !== 2) throw new Error('sidepanel.html: the robot has no rim or eyes');
  const explain = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'explain.json'), 'utf8'));
  return `// Made by mobile/prepare.js from extension/{icons,modlevel,explain,modswitch}.js, explain.json and sidepanel.html's robot: don't edit.\n` +
    `(function () {\n${['icons.js', 'modlevel.js', 'explain.js', 'modswitch.js'].map(plain).join('\n')}\n` +
    `setExplain(${JSON.stringify(explain)});\nconst ROBOT = ${JSON.stringify(robot)};\n` +
    'globalThis.__trifPanel = { ICONS, iconSvg, modIcons, modLevel, levelWords, ICON_LABELS, term, moreText, warningByLine, modSwitch, setSwitch, syncSwitches, shownEnabled, switchError, onSwitchChange, ROBOT };\n})();\n';
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
  const files = [[OUT, await runtimeFile()], [CHECKS_OUT, checksFile()], [MODS_OUT, modsFile()], [KIT_OUT, kitFile()], [GUIDE_OUT, guideFile()]];
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
module.exports = { runtimeFile, checksFile, modsFile, kitFile, stepBody, OUT, CHECKS_OUT, MODS_OUT, KIT_OUT };
