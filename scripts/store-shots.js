#!/usr/bin/env node
'use strict';
// The Chrome Web Store's images (CHROMEWEBSTORE.md "Graphics"): 1280×800 screenshots of the real side
// panel beside a made-up site, and the 440×280 small promo tile, into store/images/.
//
//   node scripts/store-shots.js [--out DIR] [--keep]
//
// Headless and muted (tests/e2e/lib/chrome.js: Chrome for Testing, --headless=new --mute-audio), in a
// scratch home under /tmp: this checkout's setup (--copy) with a stand-in `claude` that only says it's
// logged in (no agent runs: the chat is set out in the panel's storage, as a run leaves it), three mods for
// a made-up site (thedaily.example), served from 127.0.0.1. Nothing of anyone's real browser, ~/.trif or
// agents is read or written. One browser at a time: with TRIF_BROWSER_LOCK set to a folder path, it waits
// for that lock (mkdir), as tests/e2e runs do. --keep leaves the scratch folder (and says where).
//
// Each screenshot is two captures, the page (880 px) and the panel (400 px), put side by side in one more
// page and captured again, so it's what Chrome shows with its side panel open, at exactly 1280×800.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { ChromeDriver } = require('../tests/e2e/lib/chrome');
const { scratchEnv } = require('../tests/e2e/lib/install');
const { waitFor, sleep, killMatching, runAsync } = require('../tests/e2e/lib/util');

const REPO = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(REPO, 'store', 'images'));
const KEEP = args.includes('--keep');
const SITE = 'thedaily.example';
const OTHER = 'recipes.example';
const PAGE_W = 880;
const PANEL_W = 400;
const H = 800;

// ---- the made-up sites ----------------------------------------------------------------------------

const ARTICLES = [
  ['City council approves the new riverside bike path', 'After two years of plans and public meetings, the council voted 7 to 2 on Tuesday night to build a protected bike path along the east bank of the river, from the old ferry landing to the market bridge. Work starts in the spring, and the first section should open by the end of summer. The path will be separated from traffic by a low planted barrier, with new crossings at the school and the sports field, and benches every few hundred metres.', 'Local'],
  ['The library will stay open late on weekdays', 'Starting next month, the main branch stays open until 9 pm from Monday to Thursday. The extra hours come from a grant for evening study space, and the reading room on the second floor gets new lamps and power outlets at every table. The children\'s floor keeps its usual hours, and the café downstairs will stay open until 8.', 'Community'],
  ['A guide to the farmers market this weekend', 'Apples are at their best, the bakery stall is back after its summer break, and there will be a free cider tasting at noon. Here is what to look for, where to park, and which stalls take cards. Come early for the sourdough: it usually sells out by ten.', 'Food'],
];

function dailyPage() {
  const cards = ARTICLES.map(([t, p, tag]) => `<article><span class="tag">${tag}</span><h2><a href="#">${t}</a></h2>
<p class="by">By the newsroom · 2 hours ago</p><p>${p}</p></article>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Daily Example</title><style>
body { margin: 0; font: 15px/1.5 Georgia, serif; color: #1d1d1f; background: #fbfaf7; }
header { border-bottom: 3px double #1d1d1f; padding: 18px 28px 10px; display: flex; align-items: baseline; justify-content: space-between; }
header h1 { margin: 0; font-size: 30px; letter-spacing: .5px; }
nav a { margin-left: 16px; color: #1d1d1f; font: 13px system-ui, sans-serif; text-decoration: none; }
.wrap { display: grid; grid-template-columns: 1fr 230px; gap: 28px; padding: 22px 28px; }
article { border-bottom: 1px solid #ddd8cc; padding: 0 0 16px; margin: 0 0 16px; }
article h2 { margin: 4px 0 2px; font-size: 21px; line-height: 1.25; } article h2 a { color: inherit; text-decoration: none; }
.tag { font: 600 11px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 1px; color: #a0522d; }
.by { margin: 0 0 6px; color: #777; font: 12px system-ui, sans-serif; }
aside.trending { background: #fff; border: 1px solid #ddd8cc; padding: 14px; font: 13px/1.45 system-ui, sans-serif; align-self: start; }
aside.trending h3 { margin: 0 0 8px; font-size: 14px; color: #b00020; }
aside.trending li { margin: 0 0 8px; }
.newsletter { position: fixed; left: 28px; right: 28px; bottom: 18px; background: #1d1d1f; color: #fff; padding: 14px 18px; border-radius: 10px;
  font: 14px system-ui, sans-serif; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 8px 30px rgb(0 0 0 / .25); }
.newsletter button { font: 600 13px system-ui, sans-serif; background: #f4c430; border: 0; border-radius: 6px; padding: 8px 14px; }
</style></head><body>
<header><h1>The Daily Example</h1><nav><a href="#">Local</a><a href="#">Community</a><a href="#">Food</a><a href="#">Opinion</a></nav></header>
<div class="wrap"><main>${cards}</main>
<aside class="trending"><h3>🔥 Trending now</h3><ol><li>You won't believe what this cat did next</li><li>10 celebrities who look like vegetables</li><li>This one weird trick for parking downtown</li><li>Readers are furious about pancakes</li><li>What your sandwich says about you</li></ol></aside></div>
<div class="newsletter"><span>Get the Daily Example in your inbox every morning!</span><button>Subscribe</button></div>
</body></html>`;
}

function recipesPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Weeknight Recipes</title><style>
body { margin: 0; font: 15px/1.55 system-ui, sans-serif; color: #222; background: #fff; }
header { background: #2f6f4e; color: #fff; padding: 18px 28px; font-size: 22px; font-weight: 700; }
main { padding: 22px 28px; max-width: 760px; } h2 { margin: 0 0 6px; } .meta { color: #777; font-size: 13px; }
li { margin: 4px 0; }
</style></head><body><header>Weeknight Recipes</header><main>
<h2>One-pan lemon chickpeas</h2><p class="meta">25 minutes · serves 4</p>
<p>A bright, filling dinner from things you probably have already. Brown the onions, add the chickpeas and lemon, and let it all simmer while the rice cooks.</p>
<h3>Ingredients</h3><ul><li>2 cans of chickpeas, drained</li><li>1 onion, sliced</li><li>2 lemons</li><li>A handful of spinach</li><li>Salt, pepper, olive oil</li></ul>
<h3>Method</h3><ol><li>Soften the onion in oil for 8 minutes.</li><li>Add the chickpeas, the zest and juice of one lemon, and a splash of water.</li><li>Simmer 10 minutes, stir in the spinach, and serve with the other lemon in wedges.</li></ol>
</main></body></html>`;
}

// ---- the mods (as an agent would write them, in the scratch home's mods folder) -------------------

const MODS = {
  'calm-reading.js': `// ==WebMod==
// @name        Calm Reading
// @description no trending sidebar, no newsletter box, bigger text
// @style
// ==/WebMod==
${JSON.stringify({ css: '.trending, .newsletter { display: none !important; }\n.wrap { grid-template-columns: 1fr !important; max-width: 680px; }\narticle p { font-size: 17px; line-height: 1.65; }' }, null, 2)}
`,
  'reading-time.js': `// ==WebMod==
// @name        Reading Time
// @description how long each article takes to read
// @boxed
// ==/WebMod==
await trif.ready;
for (const a of page.findAll('article')) {
  if (a.find('.trif-box-rt')) continue;
  const words = (a.text || '').split(/\\s+/).filter(Boolean).length;
  const badge = page.create('span');
  badge.classes.add('trif-box-rt');
  badge.setText(\` · \${Math.max(1, Math.round(words / 200))} min read\`);
  badge.style('color', '#2f6f4e');
  badge.style('font-weight', '600');
  const by = a.find('.by');
  if (by) by.append(badge);
}
`,
  'jump-keys.js': `// ==WebMod==
// @name        Jump Keys
// @description j and k move between articles
// ==/WebMod==
let at = -1;
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  const list = [...document.querySelectorAll('article')];
  if (e.key === 'j') at = Math.min(list.length - 1, at + 1);
  else if (e.key === 'k') at = Math.max(0, at - 1);
  else return;
  list[at]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
`,
};

const CHAT = [
  { role: 'user', text: 'hide the trending sidebar and that newsletter box, and make the articles easier to read' },
  { role: 'tool', text: 'ran trif sweep \'aside, .newsletter, article p\'' },
  { role: 'tool', text: `wrote sites/${SITE}/calm-reading.js` },
  { role: 'tool', text: `ran trif check ${SITE}/calm-reading && trif reload` },
  { role: 'assistant', text: `Done: **Calm Reading** hides the Trending sidebar and the newsletter box, and sets the articles in one wider column with bigger text. I checked after the reload: no sidebar or newsletter box left, 3 articles at 17 px. It's a style mod, so it can only change how the page looks.` },
  { role: 'user', text: 'can it say how long each one takes to read?' },
  { role: 'tool', text: `wrote sites/${SITE}/reading-time.js` },
  { role: 'tool', text: `ran trif check ${SITE}/reading-time && trif reload` },
  { role: 'assistant', text: 'Added **Reading Time**: each article\'s byline now ends with its reading time ("· 1 min read"). It\'s a boxed mod: it reads the articles and adds the line, and TRIF\'s box keeps it from sending or clicking anything.' },
].map((m, i) => ({ ...m, t: i * 9000 }));

// ---- the promo tile and the side-by-side page ------------------------------------------------------

function tilePage() {
  const svg = fs.readFileSync(path.join(REPO, 'extension', 'icons', 'robot-shaded.svg'), 'utf8');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
body { background: radial-gradient(120% 90% at 20% 10%, #23312b 0%, #18181a 60%); color: #ececea; font-family: -apple-system, system-ui, sans-serif;
  display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 18px; padding: 0 30px; box-sizing: border-box; }
.robot svg { width: 132px; height: 132px; display: block; }
h1 { margin: 0; font-size: 25px; line-height: 1.12; letter-spacing: -0.01em; }
p { margin: 10px 0 0; font-size: 15px; line-height: 1.35; color: #a2a29d; }
b { color: #43c98d; font-weight: 600; }
</style></head><body><div class="robot">${svg}</div><div><h1>Tim's Robot Internet Fixer</h1><p>Fix any website with <b>your own coding agent</b>.</p></div></body></html>`;
}

function sideBySide(page, panel) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #000; }
body { display: flex; } img { display: block; height: 800px; } .panel { width: ${PANEL_W}px; border-left: 1px solid #3a3a3e; box-sizing: border-box; object-fit: cover; object-position: right top; }
</style></head><body><img src="${page}" width="${PAGE_W}"><img class="panel" src="${panel}"></body></html>`;
}

// ---- running it ------------------------------------------------------------------------------------

function lock() {
  const dir = process.env.TRIF_BROWSER_LOCK;
  if (!dir) return () => {};
  return (async () => {
    for (;;) {
      try { fs.mkdirSync(dir); break; } catch { /* someone else's run */ }
      if (fs.existsSync(path.join(dir, 'owner')) && /PAUSED/.test(fs.readFileSync(path.join(dir, 'owner'), 'utf8'))) { await sleep(20000); continue; }
      console.log('waiting for the browser lock…');
      await sleep(15000);
    }
    fs.writeFileSync(path.join(dir, 'owner'), `store-shots (${process.pid})\n`);
    return () => fs.rmSync(dir, { recursive: true, force: true });
  })();
}

async function main() {
  const work = fs.mkdtempSync('/tmp/trif-shots-');
  const home = path.join(work, 'h');
  fs.mkdirSync(home, { recursive: true });
  const unlock = await lock();
  let d = null;
  let server = null;
  try {
    // A stand-in `claude`: logged in, nothing more (the panel then shows its message box, ready).
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\ncase "$*" in\n  *--version*) echo "2.1.300 (Claude Code)";;\n  *"auth status"*) echo \'{"loggedIn":true,"authMethod":"claude.ai"}\';;\n  *) exit 1;;\nesac\n', { mode: 0o755 });
    const PATH = [bin, '/usr/bin', '/bin'].join(':');
    const env = scratchEnv(home, { PATH, TRIF_DEFAULT_AGENT_DIRS: '', TRIF_KEYCHAIN_BIN: path.join(work, 'no-keychain'), TRIF_UPDATE_DELAY: '2000000000', TRIF_CLAUDE_MANAGED_DIR: path.join(work, 'no-managed') });
    const s = spawnSync(process.execPath, [path.join(REPO, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--no-wait', '--browser', 'chrome', '--no-examples'], { env, cwd: home, encoding: 'utf8', timeout: 180000 });
    if (s.status !== 0) throw new Error(`setup failed:\n${s.stdout}\n${s.stderr}`);
    const trif = path.join(home, '.trif', 'bin', 'trif');
    const sites = path.join(home, '.trif', 'sites', SITE);
    fs.mkdirSync(sites, { recursive: true });
    for (const [f, code] of Object.entries(MODS)) fs.writeFileSync(path.join(sites, f), code);
    const check = spawnSync(trif, ['check', `${SITE}/calm-reading`, `${SITE}/reading-time`], { env, encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`trif check:\n${check.stdout}${check.stderr}`);

    // The sites, the side-by-side page and the tile, from 127.0.0.1 (Chrome maps the made-up hosts there).
    const files = path.join(work, 'files');
    fs.mkdirSync(files);
    server = http.createServer((req, res) => {
      const host = String(req.headers.host || '').split(':')[0];
      const u = new URL(req.url, 'http://x');
      const send = (body, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
      if (host === SITE) return send(dailyPage());
      if (host === OTHER) return send(recipesPage());
      if (u.pathname === '/tile') return send(tilePage());
      if (u.pathname === '/side') return send(sideBySide(u.searchParams.get('a'), u.searchParams.get('b')));
      const f = path.join(files, path.basename(u.pathname));
      if (u.pathname.startsWith('/f/') && fs.existsSync(f)) return send(fs.readFileSync(f), 'image/png');
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const site = (h) => `http://${h}:${port}/`;

    d = new ChromeDriver({
      userDataDir: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'), home, headless: true,
      env: { HOME: home, PATH, TRIF_DEFAULT_AGENT_DIRS: '', TRIF_KEYCHAIN_BIN: path.join(work, 'no-keychain'), TRIF_CLAUDE_MANAGED_DIR: path.join(work, 'no-managed') },
      extensionDir: path.join(home, '.trif', 'app', 'extension'), siteAccess: [SITE, OTHER], hosts: [SITE, OTHER],
    });
    await d.start();
    await d.installExtension();
    const control = await d.openTab(`${d.origin}/onboarding.html`);
    await d.grantUserScripts(control);
    const cli = async (a) => JSON.parse((await runAsync(trif, [...a, '--json'], { env, cwd: home, timeoutMs: 30000 })).stdout || 'null');
    await waitFor('the helper', async () => (await cli(['status']).catch(() => null))?.extension?.userScripts, { timeoutMs: 40000 });
    // TRIF on for the made-up site (Chrome has it already: the test build's host_permissions), the agent
    // allowed to run code there, and the chat as two runs leave it.
    const ext = (fn, a = []) => d.eval(control, fn, a);
    await ext(`async (site, chat) => { await chrome.storage.local.set({ agentSites: { [site]: 'run' }, ['chat:' + site]: { sessionId: null, agent: 'claude', messages: chat, run: null, last: null } }); }`, [SITE, CHAT]);
    await waitFor('the mods', async () => ((await cli(['mods']))?.mods || []).length >= 3, { timeoutMs: 20000 });

    // The test window, and the panel following it (as the e2e does: a window of its own, sized as Chrome's).
    const win = await ext(`async (url) => { const w = await chrome.windows.create({ url, width: 1300, height: 900, focused: true }); return { windowId: w.id, tabId: w.tabs[0].id }; }`, [site(SITE)]);
    const pageCtx = await d.findPage((u) => u.startsWith(site(SITE)));
    await ext(`async (url) => { await chrome.windows.create({ url, width: ${PANEL_W}, height: ${H} }); }`, [`${d.origin}/sidepanel.html?window=${win.windowId}`]);
    const panel = await d.findPage('sidepanel.html');
    await d.viewport(pageCtx, { width: PAGE_W, height: H });
    await d.viewport(panel, { width: PANEL_W, height: H });
    await d.colorScheme(panel, 'dark');
    // TRIF on for the site, as its "Fix thedaily.example" button does (the test build has the site's access).
    await waitFor('the panel\'s Fix button', async () => d.eval(panel, 'async () => { const b = document.querySelector("#gate-btn"); return !!b && b.offsetParent !== null && /^Fix /.test(b.textContent); }').catch(() => false), { timeoutMs: 20000 });
    await d.click(panel, '#gate-btn');
    await waitFor('TRIF on for the site', async () => ((await cli(['status']))?.extension?.sitesOn || []).includes(SITE), { timeoutMs: 20000 });
    // The two the chat made are on (a chat's mods start on); Jump Keys came from outside the chat: new and off.
    for (const m of ['calm-reading', 'reading-time']) await runAsync(trif, ['enable', `${SITE}/${m}`], { env, cwd: home, timeoutMs: 30000 });
    const reload = async () => { await d.eval(pageCtx, 'async () => { location.reload(); }').catch(() => {}); await sleep(2500); };
    await reload();
    await waitFor('Reading Time on the page', async () => d.eval(pageCtx, 'async () => !!document.querySelector(".trif-box-rt")').catch(() => false), { timeoutMs: 20000 });

    fs.mkdirSync(OUT, { recursive: true });
    const sideShot = async (name) => {
      await sleep(1200);
      await d.screenshot(pageCtx, path.join(files, `${name}-a.png`));
      await d.screenshot(panel, path.join(files, `${name}-b.png`));
      const tab = await d.openTab(`http://127.0.0.1:${port}/side?a=/f/${name}-a.png&b=/f/${name}-b.png`);
      await d.viewport(tab, { width: 1280, height: H });
      await sleep(800);
      await d.screenshot(tab, path.join(OUT, `${name}.png`));
      await d.cdp.send('Target.closeTarget', { targetId: tab }).catch(() => {});
      console.log(`wrote ${path.relative(REPO, path.join(OUT, `${name}.png`))}`);
    };

    // 1: the chat that made the mods, beside the page with them on (the mods list folded, so the chat shows).
    await d.eval(panel, 'async () => { const m = document.querySelector("#mods"); if (m) m.open = false; document.querySelector("#chat")?.scrollTo(0, 1e6); }').catch(() => {});
    await sideShot('screenshot-1-chat');

    // 2: the site's mods, the three kinds (a new chat: the list shows all its rows while the chat is empty).
    await ext('async (site) => { await chrome.storage.local.set({ ["chat:" + site]: { sessionId: null, agent: "claude", messages: [], run: null, last: null } }); }', [SITE]);
    await sleep(800);
    await d.eval(panel, 'async () => { const m = document.querySelector("#mods"); if (m) m.open = true; }').catch(() => {});
    await sideShot('screenshot-2-mods');

    // 3: a site TRIF isn't on: nothing runs there until "Fix <site>" (Chrome asked for that one site already
    // here: the test build has its access, as after the user allowed it).
    await d.navigate(pageCtx, site(OTHER));
    await sleep(1500);
    await sideShot('screenshot-3-site-access');

    // 4: the setup page, everything ticked.
    await d.viewport(control, { width: 1280, height: H });
    await d.colorScheme(control, 'dark');
    await d.eval(control, 'async () => { location.reload(); }').catch(() => {});
    await sleep(2500);
    await d.screenshot(control, path.join(OUT, 'screenshot-4-setup.png'));
    console.log(`wrote ${path.relative(REPO, path.join(OUT, 'screenshot-4-setup.png'))}`);

    // The small promo tile.
    const tile = await d.openTab(`http://127.0.0.1:${port}/tile`);
    await d.viewport(tile, { width: 440, height: 280 });
    await sleep(600);
    await d.screenshot(tile, path.join(OUT, 'promo-small-440x280.png'));
    console.log(`wrote ${path.relative(REPO, path.join(OUT, 'promo-small-440x280.png'))}`);
    const problems = (await d.consoleProblems()).filter((p) => p.level === 'error');
    if (problems.length) console.log(`console errors:\n${problems.map((p) => `  ${p.source}: ${p.text}`).join('\n')}`);
  } finally {
    if (d) await d.stop().catch(() => {});
    if (server) server.close();
    await killMatching(work + '/').catch(() => {});
    await unlock();
    if (KEEP) console.log(`kept ${work}`); else fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
