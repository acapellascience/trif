#!/usr/bin/env node
'use strict';
// Writes the files in mobile/shared/gen that are made from other files (mods.js and panel-kit.js: below):
//
// - sandbox-runtime.js: TRIF's sandbox runtime (extension/sandbox.js) as one file that defines
//   globalThis.__trifStartSandbox and doesn't start it, so a probe can start it inside a try and report why
//   it failed. Both probes load it after SES (extension/vendor/ses.umd.min.js).
// - RobotShape.swift (in the app's sources): the side panel's robot, its polygons and colours, for the app to draw.
// - browser-checks.json: the browser probe's JavaScript checks (mobile/browser-probe/checks.js) as text the
//   app can hand to WKWebView. Each step becomes the body of an async function that gets `prevJson` and
//   returns JSON text.
//
// - core.js: the phone apps' shared rules (mobile/shared/core/*.js, CommonJS modules) as one plain script defining
//   the global TrifCore, one object per module (app-links.js → TrifCore.appLinks), plus TrifCore.call(name, argsJSON)
//   → JSON, the iPhone's way in through JavaScriptCore (Core.swift). Android takes it from mobile/shared/gen too.
//
//   node mobile/prepare.js           write them
//   node mobile/prepare.js --check   exit 1 if any isn't what the current sources give

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
const CORE_DIR = path.join(__dirname, 'shared', 'core');
const CORE_OUT = path.join(__dirname, 'shared', 'gen', 'core.js');
const camel = (file) => file.replace(/\.js$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function coreFile() {
  const mods = fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.js')).sort();
  return '// Made by mobile/prepare.js from mobile/shared/core/*.js: don\'t edit. The phone apps\' shared rules ' +
    '(docs/MOBILE-BEHAVIOUR.md).\nvar TrifCore = (function () {\n\'use strict\';\nconst TrifCore = {};\n' +
    mods.map((f) => `TrifCore.${camel(f)} = (function () {\nconst module = { exports: {} };\n${fs.readFileSync(path.join(CORE_DIR, f), 'utf8')}\nreturn module.exports;\n})();\n`).join('') +
    '// name "module.fn", args a JSON array; the answer as JSON (null for undefined)\n' +
    'TrifCore.call = function (name, argsJSON) {\n  const dot = name.indexOf(\'.\');\n  const r = TrifCore[name.slice(0, dot)][name.slice(dot + 1)].apply(null, JSON.parse(argsJSON));\n  return JSON.stringify(r === undefined ? null : r);\n};\n' +
    'return TrifCore;\n})();\nif (typeof module === \'object\' && module && module.exports) module.exports = TrifCore;\n';
}

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
// the agent guide's style-mod section and the boxed-mod section, as the workspace has them, plus how a
// boxed mod asks for a power and the site-data power (filtering a feed's data: the chat can't open BOXED.md).
const GUIDE_OUT = path.join(__dirname, 'shared', 'gen', 'mod-guide.txt');
function guideFile() {
  const between = (file, start, end) => {
    const t = fs.readFileSync(path.join(ROOT, 'helper', 'workspace', file), 'utf8');
    const a = t.indexOf(start), b = t.indexOf(end, a + 1);
    if (a === -1 || b === -1) throw new Error(`${file}: no "${start}" … "${end}"`);
    return t.slice(a, b).trim();
  };
  const asking = between('BOXED.md', 'A boxed mod that needs one exception asks', '- `sound`');
  const siteData = between('BOXED.md', '- `site-data`', '- `page-data`');
  return `${between('AGENTS.md', '### Style mods: start here', '### A style section')}\n\n${between('BOXED.md', '## Boxed mods: when a style mod isn', '### Powers')}\n\n` +
    `### Powers (BOXED.md): filtering a feed's data\n\n${asking}\n\n${siteData}\n`;
}

// page-bridge.js: the page's side of the boxed powers that need one (site-data's trif.filterResponse first: a
// feed's JSON filtered before the site draws it), desktop's own (extension/runtime.js pageBridge), for the page's
// world; behind a test of the address (mobile/shared/modfile.js matchesUrl), so it starts only on the pages of the
// mods the app hands it: `(mods)` with [[matches, excludes], …]. As on desktop, it wraps fetch and XMLHttpRequest
// only once a mod allowed site-data asks for a filter.
const BRIDGE_OUT = path.join(__dirname, 'shared', 'gen', 'page-bridge.js');
async function bridgeFile() {
  const rt = await import(pathToFileURL(path.join(ROOT, 'extension', 'runtime.js')).href);
  const own = fs.readFileSync(path.join(__dirname, 'shared', 'modfile.js'), 'utf8');
  const m = /^function matchesUrl\(url, patterns\) \{[\s\S]*?^\}$/m.exec(own);
  if (!m) throw new Error('modfile.js: no matchesUrl');
  return '// Made by mobile/prepare.js from extension/runtime.js (pageBridge) and mobile/shared/modfile.js (matchesUrl): don\'t edit.\n' +
    `(function (mods) {\n${m[0]}\nif (!mods.some((x) => matchesUrl(location.href, x[0]) && !matchesUrl(location.href, x[1]))) return;\n` +
    `try { (${rt.pageBridge.toString()})(); }\ncatch (e) { console.error('[TRIF] bridge failed', e); }\n})`;
}

// RobotShape.swift: the robot the app draws (its chat button), TRIF's exactly: the polygons of the side panel's
// own robot (sidepanel.html #bar-robot: rim, face, eyes, in its 128 space) and its colours (sidepanel.css
// .bar-robot, switch.css --trif-green), as Swift, so the app never redraws it by hand.
const ROBOT_OUT = path.join(__dirname, 'browser-probe', 'TrifProbe', 'RobotShape.swift');
function robotSwiftFile() {
  const html = fs.readFileSync(path.join(ROOT, 'extension', 'sidepanel.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'extension', 'sidepanel.css'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'extension', 'switch.css'), 'utf8');
  const bar = /<button id="bar-robot"[^>]*>\s*<svg[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  if (!bar) throw new Error('sidepanel.html: no #bar-robot svg');
  const poly = (cls) => [...bar[1].matchAll(new RegExp(`<polygon class="${cls}" points="([^"]+)"/>`, 'g'))].map((m) => m[1]);
  const [rim] = poly('rim'), [face] = poly('face'), eyes = poly('eye');
  if (!rim || !face || eyes.length !== 2) throw new Error('sidepanel.html: the robot has no rim, face or two eyes');
  const pause = [...bar[1].matchAll(/<rect class="pause" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"\/>/g)].map((m) => m.slice(1).map(Number));
  if (pause.length !== 2) throw new Error('sidepanel.html: the robot has no pause bars');
  const hex = (re, from, what) => { const m = re.exec(from); if (!m) throw new Error(`no ${what}`); return m[1]; };
  const green = hex(/--trif-green:\s*(#[0-9a-f]{6})/i, sw, 'switch.css --trif-green');
  const faceColour = hex(/\.bar-robot \.face \{ fill: (#[0-9a-f]{6}); \}/i, css, 'sidepanel.css .bar-robot .face');
  const eyeColour = hex(/\.bar-robot \.eye \{ fill: (#[0-9a-f]{6}); \}/i, css, 'sidepanel.css .bar-robot .eye');
  const pts = (p) => `[${p.trim().split(/\s+/).map((xy) => { const [x, y] = xy.split(','); return `(${x}, ${y})`; }).join(', ')}]`;
  const rgb = (h) => `(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  return `// Made by mobile/prepare.js from extension/sidepanel.html's #bar-robot (its polygons), sidepanel.css (.bar-robot's\n` +
    `// face and eye fills) and switch.css (--trif-green, the rim): don't edit. In the robot's own 128 x 128 space.\n\n` +
    `enum RobotShape {\n` +
    `    static let rim: [(Double, Double)] = ${pts(rim)}\n` +
    `    static let face: [(Double, Double)] = ${pts(face)}\n` +
    `    static let eyes: [[(Double, Double)]] = [${eyes.map(pts).join(', ')}]\n` +
    `    /// The paused face's two bars: x, y, width, height, corner radius.\n` +
    `    static let pause: [(Double, Double, Double, Double, Double)] = [${pause.map((r) => `(${r.join(', ')})`).join(', ')}]\n` +
    `    static let rimColour = ${rgb(green)}\n    static let faceColour = ${rgb(faceColour)}\n    static let eyeColour = ${rgb(eyeColour)}\n}\n`;
}


// panel/: the desktop side panel itself (extension/sidepanel.html, .js, .css and every module it imports, its
// explanations and robot pictures), as the extension has them, for the robot view's More (the chat on an API key,
// or on this iPhone): served to a web view of its own (TrifProbe/PanelChat.swift) at trifpanel://panel/. Only the
// page changes: two lines before its own stylesheets end, the app's adapter (Web/panel-adapter.js: what the panel
// gets from the background and the helper on desktop) and the phone's few styles (Web/panel-phone.css).
const PANEL_DIR = path.join(__dirname, 'shared', 'gen', 'panel');
const PANEL_FILES = ['sidepanel.js', 'sidepanel.css', 'switch.css', 'lib.js', 'runtime.js', 'sandbox.js', 'pagewide.js', 'markdown.js',
  'login.js', 'agentsites.js', 'modlevel.js', 'icons.js', 'explain.js', 'explain.json', 'modswitch.js', 'openmodel.js'];
const PANEL_ICONS = /^(robot-shaded.*\.svg|robot-32\.png)$/;
const PANEL_HOOK = '<link rel="stylesheet" href="switch.css">';
function panelFiles() {
  const ext = path.join(ROOT, 'extension');
  const out = new Map();
  // (every module the panel imports, so a new import can't be left out: checked, not guessed)
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(path.join(ext, file), 'utf8');
    for (const m of text.matchAll(/^import [^;]*? from '\.\/([\w.-]+)';/gms)) walk(m[1]);
  };
  walk('sidepanel.js');
  const missing = [...seen].filter((f) => !PANEL_FILES.includes(f));
  if (missing.length) throw new Error(`the side panel imports ${missing.join(', ')}: add to PANEL_FILES in mobile/prepare.js`);
  for (const f of PANEL_FILES) out.set(f, fs.readFileSync(path.join(ext, f)));
  for (const f of fs.readdirSync(path.join(ext, 'icons')).filter((n) => PANEL_ICONS.test(n)).sort()) out.set(`icons/${f}`, fs.readFileSync(path.join(ext, 'icons', f)));
  const html = fs.readFileSync(path.join(ext, 'sidepanel.html'), 'utf8');
  if (!html.includes(PANEL_HOOK)) throw new Error(`sidepanel.html: no ${PANEL_HOOK}`);
  out.set('sidepanel.html', Buffer.from(html.replace(PANEL_HOOK, `${PANEL_HOOK}\n<!-- (the iPhone app: mobile/prepare.js) -->\n<link rel="stylesheet" href="panel-phone.css">\n<script src="panel-adapter.js"></script>`)));
  return out;
}

async function main() {
  const files = [[OUT, await runtimeFile()], [CHECKS_OUT, checksFile()], [MODS_OUT, modsFile()], [KIT_OUT, kitFile()], [GUIDE_OUT, guideFile()], [BRIDGE_OUT, await bridgeFile()], [ROBOT_OUT, robotSwiftFile()], [CORE_OUT, coreFile()]];
  for (const [file, text] of files) {
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`${path.relative(ROOT, file)} is out of date: run node mobile/prepare.js`); process.exit(1); }
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(ROOT, file)} (${(text.length / 1024).toFixed(0)} KB)`);
  }
  // (the panel's folder: the same files, and nothing else in it)
  const panel = panelFiles();
  const there = fs.existsSync(PANEL_DIR) ? listFiles(PANEL_DIR) : [];
  if (process.argv.includes('--check')) {
    const extra = there.filter((f) => !panel.has(f));
    const stale = [...panel].filter(([f, data]) => !fs.existsSync(path.join(PANEL_DIR, f)) || !fs.readFileSync(path.join(PANEL_DIR, f)).equals(data)).map(([f]) => f);
    if (extra.length || stale.length) { console.error(`mobile/shared/gen/panel is out of date (${[...stale, ...extra].join(', ')}): run node mobile/prepare.js`); process.exit(1); }
    return;
  }
  for (const f of there) if (!panel.has(f)) fs.rmSync(path.join(PANEL_DIR, f));
  for (const [f, data] of panel) { fs.mkdirSync(path.dirname(path.join(PANEL_DIR, f)), { recursive: true }); fs.writeFileSync(path.join(PANEL_DIR, f), data); }
  console.log(`wrote ${path.relative(ROOT, PANEL_DIR)} (${panel.size} files)`);
}

function listFiles(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { panelFiles, PANEL_DIR, runtimeFile, checksFile, modsFile, kitFile, bridgeFile, robotSwiftFile, coreFile, stepBody, OUT, CHECKS_OUT, MODS_OUT, KIT_OUT, BRIDGE_OUT, ROBOT_OUT, CORE_OUT };
