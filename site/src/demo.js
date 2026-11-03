// The home page's demo: the real TRIF side panel (the extension's own files, /demo/ext/…, with shim.js
// standing in for the extension's background) docked to the right of the home page itself, whose mods it
// switches: the page reloads as /?mods=a,b with them. The demo's own scripts and the recorded chats are in
// site/demo/, the mods are the ones TRIF ships for this page (examples/sites/timsrobot.com), all bundled
// into demo-files.js by site/build-demo.js.

import { FILES, MODS, CHATS, ORDER } from './demo-files.js';
import { HOME, homePage } from './pages.js';

// The extension files the side panel loads (sidepanel.html's links and scripts, and everything they
// import), served from the extension's folder: nothing else of it is. tests/site.test.js checks this list
// still covers what the panel loads.
export const EXTENSION_FILES = new Set([
  'sidepanel.html', 'sidepanel.css', 'switch.css', 'sidepanel.js', 'lib.js', 'runtime.js', 'markdown.js', 'login.js',
  'modswitch.js', 'openmodel.js', 'manifest.json', 'icons/robot-32.png', 'icons/robot-shaded.svg', 'icons/robot-shaded-red.svg',
]);

const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', svg: 'image/svg+xml', html: 'text/html; charset=utf-8' };
export const typeFor = (file) => TYPES[file.split('.').pop()] || 'application/octet-stream';

// What the demo says itself (the panel's own words are the extension's).
const WORDS = {
  recorded: 'Recorded chats: pick one to replay it',
  replaying: 'Replaying a recording, sped up about {n}×',
  allReplayed: 'Recorded chats',
  allReplayedNote: 'That’s all the recordings. Switch the mods above on and off, or get TRIF and make your own.',
  notLive: 'This demo only replays recorded chats, so nothing reads what you type here: pick one under “Recorded chats”. ' +
    'The real TRIF sends your message to your own coding agent (Claude Code, Codex or an open model) on your computer, and it writes the mod.',
  codexModels: 'In TRIF, this lists the models your Codex account can use.',
  noKeys: 'This demo doesn’t take keys.',
  noLogin: 'This demo is logged in already.',
  notHere: 'That doesn’t work in this demo.',
};

const MOD_BY_SLUG = new Map(MODS.map((m) => [m.slug, m]));

// Someone running the real TRIF here, on for this site, has its own copies of these mods: the extension
// marks the page (<html data-trif="on">, before any of the page's scripts) and the demo stands aside, so
// each mod's script does nothing then. Wrapped as TRIF wraps a mod (in a function), so it runs the same.
const MARKED = 'document.documentElement.getAttribute("data-trif") === "on"';

/**
 * A bundled mod's script by file name ("fireworks.js"), or null. A document-idle mod's script is deferred
 * (homeWith), and deferred scripts run before DOMContentLoaded, where TRIF runs such a mod after it: so it
 * waits for DOMContentLoaded, and the mods meet the page (and each other) as they do with TRIF.
 */
export function modScript(file) {
  const m = /^([a-z0-9-]+)\.js$/.exec(file);
  const mod = m && MOD_BY_SLUG.get(m[1]);
  if (!mod) return null;
  const body = `(() => { if (${MARKED}) return;\n${mod.code}\n})();\n`;
  if (mod.runAt === 'document-start') return body;
  return `(() => { const run = () => {\n${body}};\nif (document.readyState === 'complete') run(); else addEventListener('DOMContentLoaded', run, { once: true }); })();\n`;
}

/** The bundled mods named in `param` ("a,b,c"), in the bundle's order; names it doesn't have are ignored. */
export function modsFrom(param) {
  const want = new Set(String(param || '').split(',').map((s) => s.trim()));
  return MODS.filter((m) => want.has(m.slug));
}

/**
 * The home page with the mods named in `param` (the demo's ?mods=), as TRIF would run them: document-start
 * ones before the page, the rest after it. Nothing from `param` but the names of bundled mods is used.
 */
export function homeWith(param) {
  const mods = modsFrom(param);
  if (!mods.length) return HOME;
  const tag = (m, defer) => `\n<script src="/demo/mods/${m.slug}.js"${defer ? ' defer' : ''}></script>`;
  return homePage({
    head: mods.filter((m) => m.runAt === 'document-start').map((m) => tag(m, false)).join(''),
    tail: mods.filter((m) => m.runAt !== 'document-start').map((m) => tag(m, true)).join(''),
  });
}

/** The extension's sidepanel.html with the demo's stand-in for the extension (and its styles) added. */
export function panelHtml(html) {
  const add = '<link rel="stylesheet" href="/demo/panel.css">\n<script src="/demo/shim.js"></script>\n';
  if (!html.includes('</head>')) throw new Error('sidepanel.html has no </head>');
  return html.replace('</head>', `${add}</head>`);
}

// The data shim.js runs with: the mods as the panel lists them, the recordings, the words above.
const SHIM_DATA = {
  mods: MODS.map(({ slug, id, name, description, matches, risk }) => ({ slug, id, name, description, matches, risk })),
  order: ORDER, // the panel's order for them, as TRIF ships it (the extension's defaultOrder)
  chats: CHATS,
  words: WORDS,
};
const placeholder = '/*DEMO_DATA*/null';
if (!FILES['shim.js'].includes(placeholder)) throw new Error('shim.js lost its data placeholder');

export const DEMO_FILES = {
  '/demo.js': { body: FILES['tab.js'], type: TYPES.js },
  '/demo/panel.css': { body: FILES['panel.css'], type: TYPES.css },
  '/demo/shim.js': { body: FILES['shim.js'].replace(placeholder, () => JSON.stringify(SHIM_DATA)), type: TYPES.js },
};
