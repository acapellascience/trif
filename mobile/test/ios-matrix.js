#!/usr/bin/env node
'use strict';
// The iPhone app's mod matrix (Tim, 11-19: "a systematic test of making mods on the iPhone app"): where a request
// starts, where the person is when the mod arrives, what arrives, and what happens after, run against the stand-in
// chats in the iOS Simulator. docs/IOS-MOD-MATRIX.md has the table and what each row found.
//
//   node mobile/test/ios-matrix.js                 every case
//   node mobile/test/ios-matrix.js --only A1,B3    those
//   node mobile/test/ios-matrix.js --list          the cases
//   node mobile/test/ios-matrix.js --gpt thread --only A2,B4,C9,F1,F2   ChatGPT's rows on its page of 11-20
//
// Needs: the Simulator booted (TRIF_SIM, default the SE 531D07B3) with the app installed (a Debug build: the dev steps),
// and the device lock taken (~/WebMods-worktrees/loop-prompts/devlock.sh take ios). It starts mobile/serve.js on 8377
// and 8378 if they aren't up. It launches the app with -chathome (Claude's stand-in) and -gpthome (ChatGPT's, ?gptin),
// so nothing here ever reaches claude.ai or chatgpt.com. Each run's mods are named Mx… with a run tag in their code
// (never offered before); the run's own mods are deleted at the start of the next run. Screenshots (--shots <dir>)
// for the cases that take them. Results: a line per case, and $TMPDIR/trif-ios-matrix-last.json.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DEV = process.env.TRIF_SIM || '531D07B3-0AE6-4010-B14F-B79E9DF95CBE';
const APP = 'com.timsrobot.trifprobe.browser';
const BASE = 'http://localhost:8377';
const OTHER = 'http://127.0.0.1:8378';
const CLAUDE_HOME = `${BASE}/chat.html?greet=claude&keep`;
const TAG = `r${Date.now().toString(36).slice(-5)}`;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
// (`--gpt thread`: ChatGPT's stand-in as its page of 11-20 (chat.html?thread); else ?gptin, its page of 11-19)
const GPT_HOME = `${BASE}/chat.html?${opt('--gpt') ? `${opt('--gpt')}&keep` : 'gpt&gptin&keep'}`;
const SHOTS = opt('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sim = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let docs = null;
const container = () => sim('get_app_container', DEV, APP, 'data');
const docsDir = () => (docs = docs || path.join(container(), 'Documents'));

/** One dev step (TrifProbeApp Model.runStep): its answer, or '(no answer)'. */
async function step(obj, wait = 12) {
  const out = path.join(docsDir(), 'step-out.txt');
  try { fs.unlinkSync(out); } catch (e) {}
  fs.writeFileSync(path.join(docsDir(), 'step.json'), JSON.stringify(obj));
  sim('spawn', DEV, 'notifyutil', '-p', 'com.trif.probe.step');
  for (let i = 0; i < wait * 10; i++) {
    if (fs.existsSync(out)) { await sleep(60); return fs.readFileSync(out, 'utf8'); }
    await sleep(100);
  }
  return '(no answer)';
}
/** Waits until `fn()` gives something truthy (polled), or the time's up: its last answer. */
async function until(fn, ms = 30000, every = 700) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last && last.ok) return last; await sleep(every); }
  return last || { ok: false };
}
const shot = (name) => {
  if (!SHOTS) return null;
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  try { sim('io', DEV, 'screenshot', f); } catch (e) { return null; }
  return f;
};

function up(port) {
  return new Promise((r) => http.get(`http://localhost:${port}/feed.html`, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
}
const servers = [];
async function serve() {
  for (const port of [8377, 8378]) {
    if (await up(port)) continue;
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js'), String(port)], { stdio: 'ignore' });
    servers.push(p);
    for (let i = 0; i < 30 && !(await up(port)); i++) await sleep(100);
  }
}

/** The app's preferences plist (written only while the app is stopped). */
const prefs = () => path.join(container(), 'Library', 'Preferences', `${APP}.plist`);
function pb(cmd) { try { return execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, prefs()], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } }
/** The stand-ins' leftovers out of the prefs: their conversations, projects, chat links and the chat-offer memory
 *  (Simulator data, never a real account's: only stand-in addresses are dropped from lastChat). */
function cleanPrefs() {
  // (plutil -p: top-level `  "key" => "value"` lines; the plist has data and dates, so no JSON)
  const dump = execFileSync('plutil', ['-p', prefs()], { encoding: 'utf8' });
  for (const m of dump.matchAll(/^ {2}"((?:lastChat|chatProject)\.[^"]*)" => "([^"]*)"/gm)) {
    if (m[2].startsWith('http://localhost:8377')) pb(`Delete :${m[1]}`);
  }
  for (const k of ['chatLinks', 'chatOffers']) pb(`Delete :${k}`);
  // (and the stand-ins' own project prefs (11-20): their project, its instructions' flag, the first-use card's answer;
  // a stand-in run keeps them apart, "….standin")
  for (const m of dump.matchAll(/^ {2}"(chatProject(?:Guide|Offer)?\.[^"]*\.standin)" => /gm)) pb(`Delete :${m[1]}`);
}

async function launch(extra = []) {
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(600);
  sim('launch', DEV, APP, '-nosafe', '-chathome', CLAUDE_HOME, '-gpthome', GPT_HOME, ...extra);
  await sleep(3500);
  for (let i = 0; i < 20 && (await step({ tabhosts: 1 }, 3)) === '(no answer)'; i++) await sleep(500);
}

// ---- the app's state, read through steps
const links = async () => {
  const t = await step({ links: 1 });
  const lines = t.split('\n');
  const banners = (lines.find((l) => l.startsWith('banners: ')) || 'banners: ').slice(9).split('; ').filter(Boolean);
  const shown = lines.find((l) => l.startsWith('shown tab')) || '';
  return { text: t, links: lines.filter((l) => /^(Claude|ChatGPT) /.test(l)), banners, shown, offer: (/offer (.*)$/.exec(shown) || [])[1] || 'none' };
};
const offer = async () => {
  const t = await step({ offerstate: 1 });
  const m = /^shown: ([^\s,]+)/.exec(t);
  return { text: t, id: m && m[1] !== 'none' ? m[1] : null, queued: Number((/queued: (\d+)/.exec(t) || [])[1] || 0), came: (/came (\S+)/.exec(t) || [])[1], everywhere: /everywhere true/.test(t), held: /held true/.test(t) };
};
const modlist = async (site = '') => (await step({ modlist: site })).split('\n').filter(Boolean).map((l) => { const [id, name, s, on, hist, len] = l.split('\t'); return { id, name, site: s, on: on === 'on', held: / held/.test(on), history: Number((hist || '').replace('history ', '')), len: Number(len) }; });
const chat = async () => step({ chat: 1 });
/** chat.js's state() in the shown chat (a JSON string, as it returns it). */
const chatState = async () => { try { let v = JSON.parse(await step({ chatjs: 'return __trifChat.state()' })); if (typeof v === 'string') v = JSON.parse(v); return v || {}; } catch (e) { return {}; } };
const pagejs = async (js) => step({ pagejs: js });
const panejs = async (js) => step({ panejs: js });

/** The person's words typed into the stand-in's box after TRIF's fill, and its Send pressed (a click there counts
 *  as the stand-in's send, which only the stand-in allows: never on claude.ai or chatgpt.com). */
async function send(words) {
  // (the shown box and Send: ?thread keeps the page it left in the document, hidden, as chatgpt.com does)
  const js = `const vis = (e) => e.getClientRects().length > 0;
    const ed = [...document.querySelectorAll('.ProseMirror')].filter(vis).pop(); if (!ed) return 'no box';
    ed.append(document.createTextNode(' ' + ${JSON.stringify(words)})); ed.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const b = [...document.querySelectorAll('button[aria-label="Send message"], button[aria-label="Send"]')].filter(vis).pop(); if (!b) return 'no send';
    b.click(); return 'sent';`;
  return panejs(js);
}
/** A chat opened for the shown tab, as Go to chat (the robot's list) opens it: shown and filled. */
async function goToChat(service = 'Claude') {
  await step({ service });
  await step({ sheet: 'chat' });
  // (filled: TRIF's attachments in the box)
  // (filled: TRIF's attachments in the box; a conversation that already has this page may get nothing new, so a
  // usable box 3 s on is enough)
  const t0 = Date.now();
  return until(async () => { const s = await chatState(); return { ok: s.usable && (s.trif > 0 || s.has || Date.now() - t0 > 3000), s: JSON.stringify(s) }; }, 15000, 600);
}
/** A request sent from the shown tab's chat: the words are the stand-in's (mobile/shared/pages/chat.html). */
async function ask(words, service = 'Claude') {
  const g = await goToChat(service);
  if (!g.ok) return { ok: false, why: `chat not filled: ${g.s}` };
  const s = await send(words);
  if (s !== 'sent') return { ok: false, why: s };
  // (the send seen: the chat closes and goes back to the tab)
  const c = await until(async () => { const t = await chat(); return { ok: /shown: false/.test(t) && /activity: working/.test(t), t }; }, 8000, 400);
  return { ok: c.ok, why: c.t };
}
const words = (id, extra = '') => `called Mx${id}${TAG} ask ${TAG} ${id} ${extra}`.trim();
const modId = (id, site = 'localhost') => `${site}/mx${id.toLowerCase()}${TAG}`;
const reset = async () => {
  // (an earlier case's offers still queued: each comes up 1.2 s after the last closes)
  for (let i = 0; i < 6; i++) { await step({ cancelOffer: 1 }); if (!(await offer()).queued) break; await sleep(1600); }
  for (let i = 0; i < 4; i++) await step({ banner: 'dismiss' });
  await step({ sheet: 'none' });
  await step({ closechat: 1 });
};
async function tabs() {
  // (tab 0: localhost's feed; tab 1: another localhost page; tab 2: another site's (127.0.0.1:8378))
  const hosts = (await step({ tabhosts: 1 })).split(' ');
  while (hosts.length < 3) { await step({ newtab: '' }); hosts.push('-'); }
  for (const [n, u] of [[0, `${BASE}/feed.html`], [1, `${BASE}/plain.html`], [2, `${OTHER}/feed.html`]]) { await step({ select: n }); await step({ go: u }); await sleep(900); }
  await step({ select: 0 });
  await sleep(800);
}
/** Whether the shown page runs the mod: its style (the stand-in's CSS carries the run's words). */
const runsHere = async (needle) => /yes/.test(await pagejs(`return [...document.querySelectorAll('style')].some((s) => s.textContent.includes(${JSON.stringify(needle)})) || document.documentElement.getAttribute('data-standin-free') === ${JSON.stringify(needle)} ? 'yes' : 'no'`));

// ---- the cases: each returns [status, what was seen]; status PASS / FAIL / BLOCKED
const cases = [];
const add = (id, area, name, run) => cases.push({ id, area, name, run });

add('A1', 'start', 'Claude: Go to chat on the page, sent, mod offered on its own tab, added, runs', async () => {
  const r = await ask(words('A1'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await until(async () => { const x = await offer(); return { ok: !!x.id, ...x }; }, 30000);
  if (!o.ok) return ['FAIL', `no offer: ${o.text} ${(await links()).text}`];
  if (o.id !== modId('A1')) return ['FAIL', `offered ${o.id}`];
  shot('A1-offer');
  await step({ addOffer: 1 });
  const ran = await until(async () => ({ ok: await runsHere(`${TAG} A1`) }), 12000);
  const l = await links();
  return [ran.ok ? 'PASS' : 'FAIL', `offered ${o.id} came ${o.came}; runs on the page: ${ran.ok}; link: ${l.links[0] || '-'}`];
});

add('A2', 'start', 'ChatGPT (signed-in stand-in): Go to chat, sent, offered, added, runs', async () => {
  const r = await ask(words('A2'), 'ChatGPT');
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await until(async () => { const x = await offer(); return { ok: !!x.id, ...x }; }, 30000);
  if (!o.ok) return ['FAIL', `no offer: ${o.text}`];
  await step({ addOffer: 1 });
  const ran = await until(async () => ({ ok: await runsHere(`${TAG} A2`) }), 12000);
  await step({ service: 'Claude' });
  return [ran.ok && o.id === modId('A2') ? 'PASS' : 'FAIL', `offered ${o.id}; runs: ${ran.ok}`];
});

// (helpers for the cases below)
const gotOffer = (ms = 30000) => until(async () => { const x = await offer(); return { ok: !!x.id, ...x }; }, ms);
const gotBanner = (site, ms = 30000) => until(async () => { const l = await links(); return { ok: l.banners.some((b) => b.startsWith(`${site} `)), ...l }; }, ms);
/** Nothing more turns up for `ms`: no offer, no banner (the chat-offer memory: shown once). */
const quiet = async (ms = 6000) => { await sleep(ms); const o = await offer(); const l = await links(); return { ok: !o.id && !l.banners.length, o: o.text, b: l.banners.join('; ') }; };
const shown = async () => Number((/shown tab (-?\d+)/.exec((await links()).shown) || [])[1]);
const mark = () => pagejs('window.__mxMark = 1; return "marked"');
const marked = async () => /yes/.test(await pagejs('return window.__mxMark ? "yes" : "no"'));
const addAndRun = async (needle, ms = 12000) => { await step({ addOffer: 1 }); return (await until(async () => ({ ok: await runsHere(needle) }), ms)).ok; };
const hasMod = async (id) => (await modlist()).find((m) => m.id === id);

add('A3', 'start', 'Quick ask (the robot\'s box): the strip filled, the person\'s Send, the style mod added at once, Undo', async () => {
  const q0 = await step({ quick: words('A3') });
  const strip = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /waitingSend|waiting/i.test(s), s }; }, 20000);
  if (!strip.ok) return ['FAIL', `strip: ${strip.s} (${q0})`];
  shot('A3-strip');
  // (the person's own Send in the strip: TRIF never presses it)
  const b = await panejs(`const b = document.querySelector('button[aria-label="Send message"]'); if (!b) return 'no send'; b.click(); return 'ok'`);
  const done = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /done|replied|card/i.test(s), s }; }, 30000);
  if (!done.ok) return ['FAIL', `not done: ${done.s} (${b})`];
  const added = await hasMod(modId('A3'));
  const ran = (await until(async () => ({ ok: await runsHere(`${TAG} A3`) }), 10000)).ok;
  shot('A3-done');
  const u = await step({ quickundo: 1 });
  await sleep(1500);
  const gone = !(await hasMod(modId('A3')));
  return [added && ran && gone ? 'PASS' : 'FAIL', `${done.s.slice(0, 120)}; added ${!!added}, runs ${ran}, undone ${gone} (${u.slice(0, 60)})`];
});

add('A4', 'start', 'Voice (the robot held, a recording as the microphone): the strip filled with the words heard, the person\'s Send, added', async () => {
  const n = 100 + Math.floor(Math.random() * 899);
  const wav = path.join(os.tmpdir(), `trif-matrix-${TAG}.wav`);
  try { execFileSync('say', ['-v', 'Samantha', '-o', wav, '--data-format=LEI16@16000', `Make the headings green. Ask voice ${n}.`]); } catch (e) { return ['BLOCKED', `say: ${e.message}`]; }
  await launch(['-speechfile', wav]);
  await step({ select: 0 });
  await step({ robothold: 1 });
  await sleep(5000);
  await step({ robothold: 0 }, 20);
  const strip = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /waitingSend|waiting/i.test(s), s }; }, 25000);
  const box = await panejs('const e = document.querySelector(".ProseMirror"); return e ? e.textContent.slice(-80) : "no box"');
  if (!strip.ok) { await launch(); return ['FAIL', `strip: ${strip.s}; box: ${box}`]; }
  shot('A4-voice-strip');
  await panejs(`const b = document.querySelector('button[aria-label="Send message"]'); if (b) b.click(); return 'ok'`);
  const done = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /done|replied|card/i.test(s), s }; }, 30000);
  const ran = (await until(async () => ({ ok: await runsHere(`voice ${n}`) }), 10000)).ok;
  await launch();
  try { fs.unlinkSync(wav); } catch (e) {}
  return [done.ok && ran ? 'PASS' : 'FAIL', `heard into the box: "${box.trim()}"; ${done.s ? done.s.slice(0, 100) : ''}; runs ${ran}`];
});

add('A5', 'start', 'The Mods sheet\'s "make a mod"', async () => ['BLOCKED', 'there is no such entry in the Mods tab (its empty state says to open the chat); the robot\'s list (Go to chat, the box) is the page\'s way in']);

add('A6', 'start', 'More (the Claude API engine, against mobile/mock-api.js): a quick ask sent directly, the style mod added at once', async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, '..', 'mock-api.js'), '8379'], { stdio: 'ignore' });
  servers.push(mock);
  await sleep(800);
  await launch(['-apibase', 'http://localhost:8379']);
  await step({ select: 0 });
  await step({ more: true });
  await step({ sheet: 'chat' });
  await sleep(3500);
  const k = await step({ paneljs: `window.webkit.messageHandlers.panel.postMessage({ type: 'key.set', engine: 'claude-api', key: 'sk-test-not-a-real-key' });
    await new Promise((r) => setTimeout(r, 600)); const b = document.getElementById('settings-btn'); if (b) { b.click(); await new Promise((r) => setTimeout(r, 400)); b.click(); }
    await new Promise((r) => setTimeout(r, 800)); const a = document.getElementById('agent'); if (!a) return 'no #agent';
    a.value = 'claude-api'; a.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 600));
    // (a new chat: mock-api.js reads the ask words from a conversation's first message, and the panel keeps its chat
    // across launches, so a second run's mod was the first run's code: skipped as in Recently deleted, 11-19)
    const n = document.getElementById('new-chat'); if (n) { n.click(); await new Promise((r) => setTimeout(r, 500)); }
    return a.value;` });
  await step({ closechat: 1 });
  const label = await step({ enginelabel: 1 });
  await step({ quick: words('A6') });
  const done = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /done|card|failed/i.test(s), s }; }, 45000, 1000);
  const ran = (await until(async () => ({ ok: await runsHere(`${TAG} A6`) }), 10000)).ok;
  shot('A6-more-done');
  const qh = (await modlist('localhost')).find((m) => m.id === 'localhost/quieter-headings');
  if (qh) await step({ panelmsg: { type: 'delete', id: qh.id } });
  await step({ more: false });
  await launch();
  mock.kill();
  return [/done/i.test(done.s || '') && ran ? 'PASS' : 'FAIL', `agent ${k}; ${label}; ${(done.s || '').slice(0, 140)}; runs ${ran}`];
});

add('B2', 'where', 'Arrives while on another tab of the same site: offered there at once', async () => {
  const r = await ask(words('B2', 'wait 8'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await step({ select: 1 });
  const o = await gotOffer();
  const tab = await shown();
  if (!o.ok) return ['FAIL', `no offer on tab ${tab}: ${(await links()).text}`];
  const ran = await addAndRun(`${TAG} B2`);
  return [o.id === modId('B2') && tab === 1 && ran ? 'PASS' : 'FAIL', `offered ${o.id} on tab ${tab}, runs on plain.html ${ran}`];
});

add('B3', 'where', 'Arrives while on another site: the done banner names the chat\'s site, no sheet; Go to <site> shows its tab and the offer', async () => {
  const r = await ask(words('B3', 'wait 8'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await step({ select: 2 });
  const b = await gotBanner('localhost');
  const o1 = await offer();
  if (!b.ok) return ['FAIL', `no banner: ${b.text}`];
  shot('B3-banner');
  await step({ banner: 'go' });
  const o = await gotOffer(8000);
  const tab = await shown();
  const ran = o.ok && await addAndRun(`${TAG} B3`);
  return [!o1.id && o.id === modId('B3') && tab === 0 && ran ? 'PASS' : 'FAIL', `banner ${b.banners[0]}; sheet before Go: ${o1.id || 'none'}; after Go: tab ${tab}, offer ${o.id}; runs ${ran}`];
});

add('B4', 'where', 'Arrives while the robot view shows another service\'s chat for another site: banner over the chat, Add from it', async () => {
  const r = await ask(words('B4', 'wait 10'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await step({ select: 2 });
  const g = await goToChat('ChatGPT');
  const b = await gotBanner('localhost');
  const c = await chat();
  shot('B4-banner-over-chat');
  if (!b.ok) return ['FAIL', `no banner (chat: ${c}; ${g.s})`];
  await step({ banner: 'add' });
  const o = await gotOffer(8000);
  shot('B4-offer-over-chat');
  await step({ addOffer: 1 });
  await sleep(1200);
  const m = await hasMod(modId('B4'));
  const st = await step({ status: 1 });
  await step({ closechat: 1 });
  await step({ service: 'Claude' });
  return [o.id === modId('B4') && m && /shown: true/.test(c) ? 'PASS' : 'FAIL', `banner ${b.banners[0]} while ${c.slice(0, 60)}; offer ${o.id}; added ${!!m}; note "${st}"`];
});

add('B5', 'where', 'Arrives while the robot view shows the same service\'s chat for another site', async () => {
  const r = await ask(words('B5', 'wait 10'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await step({ select: 2 });
  const g = await goToChat('Claude');
  const b = await gotBanner('localhost');
  const chats = await step({ chats: 1 });
  if (!b.ok) return ['FAIL', `no banner (${chats}; ${g.s})`];
  await step({ banner: 'go' });
  const o = await gotOffer(8000);
  const c = await chat();
  return [o.id === modId('B5') && /shown: false/.test(c) ? 'PASS' : 'FAIL', `banner ${b.banners[0]}; chats ${chats.replace(/\n/g, ' | ')}; Go → ${c.slice(0, 40)}, offer ${o.id}`];
});

for (const [id, sheet] of [['B6', 'mods'], ['B7', 'tabs'], ['B8', 'history']]) {
  add(id, 'where', `Arrives on its own tab while the ${sheet} sheet is open: shown once, after or over the sheet`, async () => {
    const r = await ask(words(id, 'wait 8'));
    if (!r.ok) return ['FAIL', `send: ${r.why}`];
    await sleep(600);
    await step({ sheet });
    const w = await until(async () => { const o = await offer(); const l = await links(); return { ok: !!o.id || l.banners.length > 0, o, l }; }, 30000);
    shot(`${id}-${sheet}-open`);
    if (!w.ok) return ['FAIL', `nothing: ${w.l && w.l.text}`];
    const how = w.o.id ? `offer ${w.o.id} over the ${sheet} sheet` : `banner ${w.l.banners[0]}`;
    await step({ sheet: 'none' });
    await sleep(1500);
    let o = await offer();
    if (!o.id) { await step({ banner: 'add' }); o = await gotOffer(6000); }
    const ok = o.id === modId(id);
    await step({ addOffer: 1 });
    const q = await quiet(4000);
    return [ok && q.ok ? 'PASS' : 'FAIL', `${how}; then offer ${o.id}; nothing more: ${q.ok} ${q.b}`];
  });
}

add('B6b', 'where', 'The banner\'s Add tapped while the Mods sheet is still open: Add this mod? comes up (over it, or once it closes), once', async () => {
  const r = await ask(words('B6b', 'wait 6'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(600);
  await step({ sheet: 'mods' });
  const b = await gotBanner('localhost');
  if (!b.ok) return ['FAIL', `no banner: ${b.text}`];
  await step({ banner: 'add' });
  await sleep(2000);
  const during = await offer();
  shot('B6b-add-over-mods');
  await step({ sheet: 'none' });
  await sleep(2000);
  const after = await offer();
  shot('B6b-after-mods-closed');
  await step({ addOffer: 1 });
  await sleep(1200);
  const m = await hasMod(modId('B6b'));
  const q = await quiet(3000);
  return [after.id === modId('B6b') && m && q.ok ? 'PASS' : 'FAIL', `with the sheet open: offer ${during.id || 'none'}; sheet closed: ${after.id || 'none'}; added ${!!m}; nothing more ${q.ok} (look at the two shots: is it seen?)`];
});

add('B9', 'where', 'Arrives while the app is in the background: offered (or the banner) once on return', async () => {
  const r = await ask(words('B9', 'wait 6'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  sim('launch', DEV, 'com.apple.Preferences');
  await sleep(14000);
  sim('launch', DEV, APP);
  await sleep(2500);
  const w = await until(async () => { const o = await offer(); const l = await links(); return { ok: !!o.id || l.banners.length > 0, o, l }; }, 25000);
  try { sim('terminate', DEV, 'com.apple.Preferences'); } catch (e) {}
  if (!w.ok) return ['FAIL', `nothing on return: ${w.l && w.l.text}`];
  let o = w.o;
  if (!o.id) { await step({ banner: 'add' }); o = await gotOffer(6000); }
  await step({ addOffer: 1 });
  const q = await quiet(4000);
  return [o.id === modId('B9') && q.ok ? 'PASS' : 'FAIL', `${w.o.id ? 'offer' : `banner ${w.l.banners[0]}`} → ${o.id}; nothing more: ${q.ok}`];
});

// ---- a reply picked up after TRIF wasn't running (SentNotes, Tim 11-20: "is there a way to automatically pick up the
// fact that there's a new mod when the app restarts?")
const notes = async () => (await step({ sentnotes: 1 })).trim();
const notesFile = () => path.join(container(), 'Library', 'Application Support', 'chat-sent.json');
/** Diagnostics lines (kind, text) since a time (the app's own file, written a moment after each line). */
const diag = (kind, since) => {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(container(), 'Library', 'Application Support', 'diagnostics.json'), 'utf8'));
    return list.filter((e) => e.kind === kind && (e.at + 978307200) * 1000 >= since).map((e) => e.text);
  } catch (e) { return []; }
};
/** A first exchange in the shown tab's chat whose mod is offered and dismissed (an older mod in the conversation). */
async function older(id) {
  const r = await ask(words(id));
  if (!r.ok) return `send: ${r.why}`;
  const o = await gotOffer();
  if (!o.ok) return `no offer for the first exchange: ${o.text}`;
  await step({ cancelOffer: 1 });
  await sleep(1500);
  return null;
}
/** The pickup's banner for localhost holding `id`, its Add → Add this mod? for it, added; then nothing more. */
async function pickedUp(id, ms = 40000) {
  const b = await until(async () => { const l = await links(); return { ok: l.banners.some((x) => x.startsWith('localhost ') && x.includes(id)), ...l }; }, ms);
  if (!b.ok) return { ok: false, why: `no banner holding ${id}: ${b.text}` };
  const waiting = b.links.find((x) => x.startsWith('Claude localhost ')) || '';
  shot(`${id.replace(/[^\w-]+/g, "-")}-pickup-banner`);
  await step({ banner: 'add' });
  const o = await gotOffer(8000);
  await step({ addOffer: 1 });
  await sleep(1500);
  const q = await quiet(5000);
  return { ok: o.id === id && q.ok, why: `banner ${b.banners[0]}; the link ${waiting.split(' ').slice(0, 3).join(' ')}; Add → ${o.id || 'none'}; nothing more ${q.ok}${q.ok ? '' : ` (${q.o} / ${q.b})`}`, waiting };
}

add('B11', 'where', 'The app killed mid-reply and launched again: the reply picked up (the banner with its mod, the chats list waiting), offered once, an older mod in that conversation never', async () => {
  const t0 = Date.now();
  const first = await older('B11a');
  if (first) return ['FAIL', first];
  const r = await ask(words('B11', 'wait 20'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(1500);
  const noted = await notes();
  await launch();
  const p = await pickedUp(modId('B11'));
  const left = await notes();
  const lines = diag('pickup', t0);
  // (launched again: nothing more)
  await launch();
  await sleep(6000);
  const again = await quiet(3000);
  // (the older exchange's mod never handed over by the page: the chat-offers memory would skip it anyway, so its line is read)
  const handed = diag('chat offers', t0).filter((l) => /^pickup from/.test(l));
  const olderHanded = handed.some((l) => l.includes(modId('B11a')));
  return [p.ok && /Claude\|localhost/.test(noted) && left === 'none' && again.ok && !olderHanded && handed.length === 1 && / waiting /.test(p.waiting) ? 'PASS' : 'FAIL', `${p.why}; the note at the send: ${noted.slice(0, 70)}; after: ${left}; relaunched again, nothing: ${again.ok}; handed over: ${handed.join(' | ')}; log: ${lines.join(' | ').slice(0, 220)}`];
});

add('B12', 'where', 'The app away past its background time and the chat page lost (WebKit ended it): on return the reply is picked up from the note, the banner, once', async () => {
  const t0 = Date.now();
  const r = await ask(words('B12', 'wait 25'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  // (the chat page made big, so its WebKit process is the one to end)
  await panejs('window.__mxBig = new Uint8Array(160e6).fill(1); return "big"');
  await sleep(1500);
  const pid = (() => {
    const ps = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' }).split('\n').filter((l) => /com\.apple\.WebKit\.WebContent/.test(l) && /CoreSimulator/.test(l));
    const big = ps.map((l) => l.trim().split(/\s+/)).map(([p, rss]) => ({ p: Number(p), rss: Number(rss) })).sort((a, b) => b.rss - a.rss)[0];
    return big && big.rss > 150000 ? big.p : null;
  })();
  if (!pid) return ['BLOCKED', 'the chat page\'s WebKit process not found'];
  sim('launch', DEV, 'com.apple.Preferences');
  await sleep(4000);
  try { process.kill(pid, 'SIGKILL'); } catch (e) { return ['BLOCKED', `kill: ${e.message}`]; }
  await sleep(40000);
  sim('launch', DEV, APP);
  await sleep(2500);
  const p = await pickedUp(modId('B12'), 45000);
  try { sim('terminate', DEV, 'com.apple.Preferences'); } catch (e) {}
  const left = await notes();
  return [p.ok && left === 'none' ? 'PASS' : 'FAIL', `${p.why}; notes after: ${left}; log: ${[...diag('background', t0), ...diag('ended', t0), ...diag('pickup', t0)].join(' | ').slice(0, 300)}`];
});

add('B13', 'where', 'A note whose reply was offered already (the mod added from it): nothing again at the next launch', async () => {
  const t0 = Date.now();
  const r = await ask(words('B13', 'wait 15'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(1000);
  const saved = fs.readFileSync(notesFile(), 'utf8');
  await launch();
  const p = await pickedUp(modId('B13'));
  if (!p.ok) return ['FAIL', `first pickup: ${p.why}`];
  // (the same note put back, as if TRIF had stopped again before seeing the reply end: its mod is installed now)
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(800);
  fs.writeFileSync(notesFile(), saved);
  await launch();
  await sleep(12000);
  const q = await quiet(3000);
  const lines = diag('pickup', t0);
  return [q.ok && lines.some((l) => /offered before: nothing again/.test(l)) && (await notes()) === 'none' ? 'PASS' : 'FAIL', `first: ${p.why}; again: nothing shown ${q.ok} (${q.o || '-'} / ${q.b || '-'}); log: ${lines.join(' | ').slice(0, 260)}`];
});

add('B14', 'where', 'A note over an hour old: dropped at launch, nothing loaded or offered', async () => {
  const t0 = Date.now();
  const r = await ask(words('B14', 'wait 15'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(1000);
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(800);
  const list = JSON.parse(fs.readFileSync(notesFile(), 'utf8'));
  for (const n of list) n.at -= 3700;
  fs.writeFileSync(notesFile(), JSON.stringify(list));
  await launch();
  await sleep(12000);
  const q = await quiet(3000);
  const chats = await step({ chats: 1 });
  const lines = diag('pickup', t0);
  return [q.ok && lines.some((l) => /older than an hour/.test(l)) && !/working/.test(chats) && (await notes()) === 'none' ? 'PASS' : 'FAIL', `nothing shown ${q.ok}; chats: ${chats.replace(/\n/g, ' / ')}; log: ${lines.join(' | ').slice(0, 200)}`];
});

add('B15', 'where', 'A quick ask killed mid-reply and launched again: its pill back working, its look-only mod added when picked up (Done · Undo), once', async () => {
  const t0 = Date.now();
  await step({ quick: words('B15', 'wait 20') });
  const strip = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /waitingSend|waiting/i.test(s), s }; }, 20000);
  if (!strip.ok) return ['FAIL', `strip: ${strip.s}`];
  const b = await panejs(`const b = document.querySelector('button[aria-label="Send message"]'); if (!b) return 'no send'; b.click(); return 'ok'`);
  const working = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /working/i.test(s), s }; }, 8000);
  if (!working.ok) return ['FAIL', `not working after the Send (${b}): ${working.s}`];
  await sleep(1500);
  const noted = await notes();
  await launch();
  const back = await step({ quickstate: 1 });
  const done = await until(async () => { const s = await step({ quickstate: 1 }); return { ok: /done/i.test(s), s }; }, 40000);
  const added = await hasMod(modId('B15'));
  shot('B15-quick-pickup-done');
  const q = await quiet(4000);
  const u = await step({ quickundo: 1 });
  await sleep(1500);
  const gone = !(await hasMod(modId('B15')));
  return [/quick/.test(noted) && /working/.test(back) && done.ok && added && q.ok && gone ? 'PASS' : 'FAIL', `the note: ${noted.slice(0, 80)}; after the launch: ${back.slice(0, 80)}; then ${done.s.slice(0, 100)}; added ${!!added}; nothing else shown ${q.ok}; Undo removed it ${gone}; log: ${diag('pickup', t0).join(' | ').slice(0, 200)}`];
});

add('C2', 'what', 'Full code (a free mod): offered as such, added, runs in the page', async () => {
  const r = await ask(`full code called MxC2${TAG} ask ${TAG}C2`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  if (!o.ok) return ['FAIL', `no offer: ${o.text}`];
  const ran = await addAndRun(`${TAG}C2`);
  return [ran ? 'PASS' : 'FAIL', `${o.text.slice(0, 140)}; runs ${ran}`];
});

add('C3', 'what', 'An every-site mod: the offer says every site, added, runs on another site too', async () => {
  const r = await ask(words('C3', 'everywhere'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  if (!o.ok) return ['FAIL', `no offer: ${o.text}`];
  shot('C3-every-site-offer');
  const ran = await addAndRun(`${TAG} C3`);
  await step({ select: 2 });
  await sleep(2500);
  const there = (await until(async () => ({ ok: await runsHere(`${TAG} C3`) }), 8000)).ok;
  const m = (await modlist()).find((x) => /mxc3/.test(x.id));
  if (m) await step({ panelmsg: { type: 'delete', id: m.id } });
  return [o.everywhere && ran && there ? 'PASS' : 'FAIL', `${o.text.slice(0, 160)}; runs here ${ran}, on 127.0.0.1 ${there}`];
});

add('C4', 'what', 'An update of an added mod (same @id): offered as that mod, added as a new version of it', async () => {
  const w1 = `modid mxu${TAG} called MxC4${TAG} ask ${TAG} alpha`;
  const r = await ask(w1);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o1 = await gotOffer();
  await addAndRun(`${TAG} alpha`);
  const r2 = await ask(`modid mxu${TAG} called MxC4${TAG} ask ${TAG} beta`);
  if (!r2.ok) return ['FAIL', `send 2: ${r2.why}`];
  const o2 = await gotOffer();
  shot('C4-update-offer');
  const ran = await addAndRun(`${TAG} beta`);
  const mine = (await modlist()).filter((m) => m.name === `MxC4${TAG}`);
  return [o1.id && o2.id === o1.id && mine.length === 1 && mine[0].history >= 1 && ran ? 'PASS' : 'FAIL', `first ${o1.id}, update ${o2.id}; mods named so: ${mine.length}, history ${mine.map((m) => m.history)}; runs the new one ${ran}`];
});

add('C5', 'what', 'Two mods in one reply: offered one after the other, both added', async () => {
  const r = await ask(words('C5', 'two'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  shot('C5-first-of-two');
  await step({ addOffer: 1 });
  const o2 = await until(async () => { const x = await offer(); return { ok: !!x.id && x.id !== o.id, ...x }; }, 8000);
  await step({ addOffer: 1 });
  await sleep(1200);
  const both = !!(await hasMod(o.id)) && !!(await hasMod(o2.id));
  return [o.queued === 1 && o2.ok && both ? 'PASS' : 'FAIL', `first ${o.id} (queued ${o.queued}), then ${o2.id}; both kept ${both}`];
});

add('C6', 'what', 'A mod that needs an OK (powers): offered, added on hold, the approval card, Allow → runs', async () => {
  const r = await ask(words('C6', 'powers'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  if (!o.ok) return ['FAIL', `no offer: ${o.text}`];
  await step({ addOffer: 1 });
  await sleep(1500);
  const held = (await modlist()).find((m) => m.id === o.id);
  shot('C6-held-card');
  await step({ approve: o.id });
  await sleep(1500);
  const after = (await modlist()).find((m) => m.id === o.id);
  await step({ sheet: 'none' });
  if (after) await step({ panelmsg: { type: 'delete', id: after.id } });
  return [held && held.held && after && !after.held ? 'PASS' : 'FAIL', `${o.text.slice(0, 150)}; added held ${held && held.held}; after Allow held ${after && after.held}`];
});

add('C7', 'what', 'Broken code: not offered; the done banner says the mod can\'t be added (the note alone was gone in 2 s)', async () => {
  const r = await ask(`broken ${TAG}`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const b = await gotBanner('localhost', 20000);
  const o = await offer();
  shot('C7-broken-banner');
  return [!o.id && b.ok && b.banners.some((x) => /unreadable: /.test(x)) ? 'PASS' : 'FAIL', `offer ${o.id || 'none'}; banners ${(b.banners || []).join('; ') || 'none'}`];
});

add('C8', 'what', 'A long reply written slowly (40 s): the tab\'s badge working meanwhile, offered once at the end', async () => {
  const r = await ask(words('C8', 'long wait 40'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(8000);
  const mid = await step({ tabbadges: 1 });
  const early = await offer();
  const o = await gotOffer(60000);
  await step({ addOffer: 1 });
  const q = await quiet(5000);
  return [/^0 localhost: working/m.test(mid) && !early.id && o.id === modId('C8') && q.ok ? 'PASS' : 'FAIL', `badges mid-reply ${mid.split('\n')[0]}; offered early ${early.id || 'no'}; at the end ${o.id}; nothing more ${q.ok}`];
});

add('C9', 'what', 'Two chats replying at once (Claude for localhost, ChatGPT for 127.0.0.1): each offered for its own site', async () => {
  const r = await ask(words('C9a', 'wait 12'));
  if (!r.ok) return ['FAIL', `send 1: ${r.why}`];
  await step({ select: 2 });
  const r2 = await ask(words('C9b', 'wait 8'), 'ChatGPT');
  if (!r2.ok) return ['FAIL', `send 2: ${r2.why}`];
  const o = await gotOffer(30000);
  const b = await gotBanner('localhost', 30000);
  shot('C9-two-at-once');
  await step({ addOffer: 1 });
  await step({ banner: 'go' });
  const o2 = await gotOffer(8000);
  await step({ addOffer: 1 });
  await step({ service: 'Claude' });
  return [o.id === modId('C9b', '127.0.0.1') && b.ok && o2.id === modId('C9a') ? 'PASS' : 'FAIL', `on 127.0.0.1: ${o.id}; banner ${b.banners && b.banners[0]}; Go → ${o2.id}`];
});

add('D1', 'after', 'Shown once: the chat opened again (its conversation drawn again) offers nothing more; a dismissed banner stays dismissed', async () => {
  const r = await ask(words('D1', 'wait 6'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await step({ select: 2 });
  const b = await gotBanner('localhost');
  await step({ banner: 'dismiss' });
  await step({ select: 0 });
  await sleep(1000);
  await step({ sheet: 'chat' });
  await sleep(2000);
  await step({ reload: 'matrix' });
  await step({ chatback: 1 });
  const q1 = await quiet(7000);
  await step({ closechat: 1 });
  const q2 = await quiet(3000);
  return [b.ok && q1.ok && q2.ok ? 'PASS' : 'FAIL', `banner ${b.banners && b.banners[0]} dismissed; chat open again: nothing ${q1.ok} (${q1.o} ${q1.b}); closed: nothing ${q2.ok}`];
});

add('D3', 'after', 'Added on its own tab: the page loads again and runs it', async () => {
  await mark();
  const r = await ask(words('D3'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  const ran = await addAndRun(`${TAG} D3`);
  const reloaded = !(await marked());
  return [ran && reloaded ? 'PASS' : 'FAIL', `offer ${o.id}; reloaded ${reloaded}; runs ${ran}`];
});

add('D4', 'after', 'Added while the page plays: not loaded again (it runs from the next load)', async () => {
  const p = await pagejs(`const sr = 8000, n = sr * 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const a = document.createElement('audio'); a.loop = true; a.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); document.body.append(a);
    window.__mxMark = 1; try { await a.play(); } catch (e) { return 'refused ' + e; } return a.paused ? 'paused' : 'playing';`);
  if (!/playing/.test(p)) return ['BLOCKED', `the page's sound didn't play: ${p}`];
  const r = await ask(words('D4'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  await step({ addOffer: 1 });
  await sleep(5000);
  const kept = await marked();
  await pagejs('for (const a of document.querySelectorAll("audio")) { a.pause(); a.remove(); } return "ok"');
  return [o.id && kept ? 'PASS' : 'FAIL', `playing: ${p}; offer ${o.id}; page kept (not reloaded) ${kept}`];
});

add('D5', 'after', 'Switched off and on again from the Mods tab: the page follows', async () => {
  const r = await ask(words('D5'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  const ran = await addAndRun(`${TAG} D5`);
  await step({ enable: { id: o.id, on: false } });
  const off = (await until(async () => ({ ok: !(await runsHere(`${TAG} D5`)) }), 10000)).ok;
  await step({ enable: { id: o.id, on: true } });
  const on = (await until(async () => ({ ok: await runsHere(`${TAG} D5`) }), 10000)).ok;
  return [ran && off && on ? 'PASS' : 'FAIL', `runs ${ran}; off → gone ${off}; on → back ${on}`];
});

add('D6', 'after', 'Badges: the tab sent from shows the chat working, then plain; another tab none', async () => {
  const r = await ask(words('D6', 'wait 8'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const mid = await step({ tabbadges: 1 });
  const o = await gotOffer();
  await step({ addOffer: 1 });
  await sleep(1000);
  const end = await step({ tabbadges: 1 });
  const line = (t, n) => (t.split('\n')[n] || '').replace(/^\d+ /, '');
  // (tab 1, the same site but not the tab sent from: no badge)
  return [/working/.test(line(mid, 0)) && !/working/.test(line(end, 0)) && /none/.test(line(mid, 1)) ? 'PASS' : 'FAIL', `mid: ${mid.replace(/\n/g, ' | ')}; after: ${end.replace(/\n/g, ' | ')}; offer ${o.id}`];
});

add('D8', 'after', 'The chat remembers its site: the same conversation again from the site\'s tab, another for another site', async () => {
  const r = await ask(words('D8'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  await step({ addOffer: 1 });
  const conv = (/at: (\S+)/.exec(await chat()) || [])[1];
  await step({ sheet: 'chat' });
  await sleep(2500);
  const again = (/at: (\S+)/.exec(await chat()) || [])[1];
  await step({ closechat: 1 });
  await step({ select: 2 });
  await step({ sheet: 'chat' });
  await sleep(2500);
  const other = (/at: (\S+)/.exec(await chat()) || [])[1];
  await step({ closechat: 1 });
  return [conv && /\/chat\//.test(conv) && again === conv && other !== conv ? 'PASS' : 'FAIL', `sent in ${conv}; again from localhost ${again}; from 127.0.0.1 ${other}; offer ${o.id}`];
});

// ---- edit blocks (Tim, 11-19: a chat changes a mod by edit blocks, not the whole file again; a shortened file caught).
// F1 makes the run's mod MxF1<tag>; the others change it. Each starts a new conversation, so TRIF's fill gives the mod's
// code with its "edit with: TRIF edit <file> <version>" line (the stand-in's "editing <Name>" picks it).
const EDIT = require(path.join(__dirname, '..', 'shared', 'core', 'mod-edit.js'));
const boxText = async () => panejs("const ed = document.querySelector('.ProseMirror'); return ed ? ed.innerText : 'no box'");
/** A new conversation on the service, the request sent from the shown tab. */
const askNew = async (w, service = 'Claude') => { await step({ service }); await step({ newchat: 1 }); await sleep(2500); await step({ closechat: 1 }); return ask(w, service); };
/** The refusal: no offer, the note, the banner over the tab; then the chat opened (Open chat: nothing filled) and the
 *  message TRIF put in its box. Never sent. */
async function refused(name) {
  const b = await gotBanner('localhost', 25000);
  const o = await offer();
  const note = await step({ status: 1 });
  shot(`${name}-banner`);
  await step({ banner: 'open' });
  await sleep(1800);
  const box = await boxText();
  shot(`${name}-box`);
  await step({ closechat: 1 });
  await step({ banner: 'dismiss' });
  // (the note goes after 2 s: the banner keeps its words)
  return { ok: b.ok && !o.id, note, box, o: o.text, banners: (b.banners || []).join('; ') };
}
const f1 = () => modId('F1');

add('F1', 'edit', 'Claude: a mod of the run\'s, then changed by an edit block: "Change this mod?" with 1 change, added, the new code runs, its History has the old', async () => {
  const r0 = await ask(words('F1'));
  if (!r0.ok) return ['FAIL', `send: ${r0.why}`];
  const o0 = await gotOffer();
  if (o0.id !== f1()) return ['FAIL', `first offer ${o0.id}`];
  if (!(await addAndRun(`${TAG} F1`))) return ['FAIL', 'the first version doesn\'t run'];
  const r = await askNew(`editing MxF1${TAG} edit ask ${TAG} F1e`);
  if (!r.ok) return ['FAIL', `send (edit): ${r.why}`];
  const o = await gotOffer();
  shot('F1-change-review');
  const edits = (/edits (\w+)/.exec(o.text) || [])[1];
  const ran = await addAndRun(`${TAG} F1e`);
  const m = (await modlist()).find((x) => x.id === f1());
  return [o.id === f1() && edits === '1' && ran && m && m.history >= 1 ? 'PASS' : 'FAIL', `offered ${o.id} edits ${edits}; runs: ${ran}; history ${m && m.history}`];
});

add('F2', 'edit', 'ChatGPT (signed-in stand-in): two edit blocks in two code blocks of one reply: one offer, 2 changes, added, runs', async () => {
  const r = await askNew(`editing MxF1${TAG} edit two ask ${TAG} F2e`, 'ChatGPT');
  await step({ service: 'Claude' });
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  shot('F2-two-changes');
  const edits = (/edits (\w+)/.exec(o.text) || [])[1];
  const ran = await addAndRun(`${TAG} F2e`);
  const code = await step({ modcode: f1() });
  return [o.id === f1() && edits === '2' && ran && code.includes('#standin-edited') ? 'PASS' : 'FAIL', `offered ${o.id} edits ${edits}; runs: ${ran}; second change in: ${code.includes('#standin-edited')}`];
});

add('F3', 'edit', 'A stale version (the mod changed since the chat saw it): nothing applied; the note; the banner; the chat\'s box asks again with the mod\'s code now (never sent)', async () => {
  const before = await step({ modcode: f1() });
  const r = await askNew(`editing MxF1${TAG} stale edit ask ${TAG} F3e`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const x = await refused('F3-stale');
  const same = (await step({ modcode: f1() })) === before;
  const v = EDIT.version(before);
  const asks = /were for an earlier version/.test(x.box) && x.box.includes(`TRIF edit ${f1()} ${v}`) && x.box.includes('#b5179e');
  return [x.ok && same && /don't fit/.test(x.note + x.banners) && asks ? 'PASS' : 'FAIL', `no offer ${!x.o.includes('shown: ' + f1())}; mod unchanged ${same}; note "${x.note}"; box asks again with the code ${asks}; banners ${x.banners}`];
});

add('F4', 'edit', 'A shortened whole file ("// ... rest unchanged ..."): refused; the note; the chat\'s box asks for the whole file', async () => {
  const before = await step({ modcode: f1() });
  const r = await askNew(`editing MxF1${TAG} shortened ${TAG} F4`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const x = await refused('F4-shortened');
  const same = (await step({ modcode: f1() })) === before;
  return [x.ok && same && /leaves out part/.test(x.note + x.banners) && /leaves part of the mod out/.test(x.box) ? 'PASS' : 'FAIL', `mod unchanged ${same}; note "${x.note}"; box "${x.box.slice(0, 140)}"`];
});

add('F5', 'edit', 'An edit block whose SEARCH isn\'t in the mod: nothing applied; the box asks again', async () => {
  const before = await step({ modcode: f1() });
  const r = await askNew(`editing MxF1${TAG} edit nomatch ${TAG} F5`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const x = await refused('F5-nomatch');
  const same = (await step({ modcode: f1() })) === before;
  return [x.ok && same && /doesn't match the mod/.test(x.box) ? 'PASS' : 'FAIL', `mod unchanged ${same}; note "${x.note}"; box "${x.box.slice(0, 140)}"`];
});

add('F6', 'edit', 'Pasted edit blocks (the clipboard path): offered with its changes; pasted stale ones: the message copied, nothing changed', async () => {
  const code = await step({ modcode: f1() });
  const line = code.split('\n').find((l) => /#[0-9a-f]{6}/i.test(l));
  if (!line) return ['FAIL', `no colour line in ${code.slice(0, 200)}`];
  const blk = `<<<<<<< SEARCH\n${line}\n=======\n${line.replace(/#[0-9a-f]{6}/i, '#123456')}\n>>>>>>> REPLACE`;
  await step({ offer: `\`\`\`\nTRIF edit ${f1()} ${EDIT.version(code)}\n${blk}\n\`\`\`` });
  const o = await until(async () => { const y = await offer(); return { ok: !!y.id, ...y }; }, 8000);
  const edits = (/edits (\w+)/.exec(o.text || '') || [])[1];
  await step({ cancelOffer: 1 });
  await step({ offer: `TRIF edit ${f1()} 00000000\n${blk}` });
  await sleep(1500);
  const note = await step({ status: 1 });
  const o2 = await offer();
  return [o.id === f1() && edits === '1' && /copied/.test(note) && !o2.id ? 'PASS' : 'FAIL', `pasted: offered ${o.id} edits ${edits}; stale paste: note "${note}", offer ${o2.id || 'none'}`];
});

/** More with the Claude API engine against mock-api.js (as A6), a new chat; `then` runs; More switched off after. */
async function withMore(then) {
  const mock = spawn(process.execPath, [path.join(__dirname, '..', 'mock-api.js'), '8379'], { stdio: 'ignore' });
  servers.push(mock);
  await sleep(800);
  try {
    await launch(['-apibase', 'http://localhost:8379']);
    await step({ select: 0 });
    await step({ more: true });
    await step({ sheet: 'chat' });
    await sleep(3500);
    await step({ paneljs: `window.webkit.messageHandlers.panel.postMessage({ type: 'key.set', engine: 'claude-api', key: 'sk-test-not-a-real-key' });
      await new Promise((r) => setTimeout(r, 600)); const b = document.getElementById('settings-btn'); if (b) { b.click(); await new Promise((r) => setTimeout(r, 400)); b.click(); }
      await new Promise((r) => setTimeout(r, 800)); const a = document.getElementById('agent'); if (!a) return 'no #agent';
      a.value = 'claude-api'; a.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 600));
      const n = document.getElementById('new-chat'); if (n) { n.click(); await new Promise((r) => setTimeout(r, 500)); }
      return a.value;` });
    await step({ closechat: 1 });
    return await then();
  } finally {
    await step({ more: false });
    await launch();
    mock.kill();
  }
}

add('F7', 'edit', 'More (the Claude API engine, mock-api.js): a quick ask whose reply is an edit block: applied to the mod, added at once (a look-only change), Done', async () => withMore(async () => {
  const before = (await modlist('localhost')).map((m) => [m.id, m.len]);
  await step({ quick: `mock edit ask ${TAG} F7` });
  const done = await until(async () => { const q = await step({ quickstate: 1 }); return { ok: /done|card|failed/i.test(q), s: q }; }, 45000, 1000);
  const after = await modlist('localhost');
  const changed = [];
  for (const m of after) { const b = before.find(([id]) => id === m.id); if (b && b[1] !== m.len) changed.push(m.id); }
  const code = changed.length ? await step({ modcode: changed[0] }) : '';
  return [/done/i.test(done.s || '') && changed.length === 1 && code.includes(`/* ${TAG} F7 */`) ? 'PASS' : 'FAIL', `${(done.s || '').slice(0, 120)}; changed ${changed.join(', ') || 'none'}`];
}));

add('F8', 'edit', 'More: a stale edit: nothing changed; the message asking again in the panel\'s own box (never sent)', async () => withMore(async () => {
  const before = (await modlist('localhost')).map((m) => `${m.id} ${m.len}`).join('\n');
  await step({ quick: `mock edit stale ask ${TAG} F8` });
  await sleep(9000);
  const after = (await modlist('localhost')).map((m) => `${m.id} ${m.len}`).join('\n');
  await step({ sheet: 'chat' });
  await sleep(1500);
  const input = await step({ paneljs: `const i = document.querySelector('#input'); return i ? i.value : 'no input'` });
  shot('F8-more-stale');
  await step({ paneljs: `const i = document.querySelector('#input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1;` });
  await step({ closechat: 1 });
  return [before === after && /were for an earlier version/.test(input) ? 'PASS' : 'FAIL', `mods unchanged ${before === after}; the panel's box: "${input.slice(0, 120)}"`];
}));

// ---- the phone link (phone-link's tests/phone-link-computer.js: the real helper's Store, Server, Runs and sync with a
// stand-in agent, in a temp home; --computer <phone-link worktree>, default ~/WebMods-worktrees/phone-link)
let pc = null;
async function computer() {
  if (pc) return pc;
  const dir = opt('--computer') || path.join(os.homedir(), 'WebMods-worktrees', 'phone-link');
  const file = path.join(dir, 'tests', 'phone-link-computer.js');
  if (!fs.existsSync(file)) return null;
  const p = spawn(process.execPath, [file, '--seconds', '1500'], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  servers.push(p);
  const lines = [];
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { try { lines.push(JSON.parse(buf.slice(0, i))); } catch (e) {} buf = buf.slice(i + 1); } });
  const next = async (pred, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = lines.findIndex(pred); if (i >= 0) return lines.splice(i, 1)[0]; await sleep(150); } return null; };
  const first = await next((l) => l.port && l.qr);
  if (!first) return null;
  pc = { ...first, say: (t) => p.stdin.write(`${t}\n`), next };
  return pc;
}
async function paired() {
  const c = await computer();
  if (!c) return null;
  await launch(['-linkhost', `127.0.0.1:${c.port}`]);
  await step({ phonepair: c.qr });
  const ok = await until(async () => { const t = await step({ phonepair: 1 }); return { ok: /paired/i.test(t) && !/not paired|pairing/i.test(t), t }; }, 20000, 800);
  return ok.ok ? c : { error: ok.t };
}

add('D7', 'after', 'A mod added from a chat syncs to the computer (the stand-in computer\'s phone twin gets it)', async () => {
  const c = await paired();
  if (!c) return ['BLOCKED', 'no phone-link worktree (tests/phone-link-computer.js)'];
  if (c.error) return ['FAIL', `pairing: ${c.error}`];
  await tabs();
  // (a site with a dot: the computer skips localhost mods)
  await step({ select: 1 });
  await step({ go: 'https://example.com/' });
  await sleep(2500);
  // (a free mod: the stand-in computer's EDIT appends JavaScript, which only a free mod can take: a style mod's edit
  // is refused by the phone, rightly)
  const r = await ask(`full code called MxD7${TAG} ask ${TAG}D7`);
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  const o = await gotOffer();
  await step({ addOffer: 1 });
  await sleep(4500);
  await step({ sync: 1 });
  const got = await until(async () => { c.say('twin'); const t = await c.next((l) => l.twin, 5000); const f = t && Object.entries(t.twin).find(([, v]) => v.includes(`${TAG}D7`)); return { ok: !!f, f: f && f[0], all: t && Object.keys(t.twin) }; }, 25000, 1500);
  return [o.id && got.ok ? 'PASS' : 'FAIL', `offer ${o.id}; on the computer: ${got.f || `not there (${(got.all || []).join(', ')})`}`];
});

add('A8', 'start', 'A chat on the computer (a desktop phone-view chat for the phone\'s mod): its change arrives by sync while the phone is on another site, runs when the site is shown', async () => {
  const c = pc;
  if (!c) return ['BLOCKED', 'needs D7 first (the pairing and the mod on the computer)'];
  const id = modId('D7', 'example.com');
  const before = await step({ modcode: id });
  if (/^no mod/.test(before)) return ['BLOCKED', `D7's mod isn't here: ${before}`];
  await step({ select: 2 });
  await mark();
  c.say('run example.com EDIT:1f8a5b');
  const done = await c.next((l) => l.runDone, 60000);
  const changed = await until(async () => { const t = await step({ modcode: id }); return { ok: t !== before && /1f8a5b/.test(t), t }; }, 30000, 1500);
  const kept = await marked();
  await step({ select: 1 });
  await sleep(2500);
  const runs = /yes/.test(await pagejs('return [...document.querySelectorAll("style")].some((s) => s.textContent.includes("1f8a5b")) || !!document.querySelector("[style*=\'1f8a5b\'], [style*=\'31, 138, 91\']") ? "yes" : "no"'));
  return [done && changed.ok && kept ? 'PASS' : 'FAIL', `computer's run: ${JSON.stringify(done)}; the phone's mod changed ${changed.ok}; the other site's page left alone ${kept}; its colour on example.com ${runs}`];
});

// ---- TRIF's chats in a project of their own (Tim 11-20): the first-use card asked once, Set it up (TRIF fills the
// forms, the person's Create and Save are the stand-in's buttons clicked here, as the person's taps), the project
// noticed by its address, new chats in it with the page only, a project gone, the form left without Create
const projState = async () => step({ projectstate: 1 });
async function projReset() {
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(800);
  cleanPrefs();
  await launch();
  await step({ select: 0 });
}
const cardShown = async () => /yes/.test(await step({ chatjs: `const g = document.getElementById('trif-greeting'), o = g && g.querySelector('.trif-offer'); return o && !o.hidden && !g.hidden && o.getBoundingClientRect().height > 0 ? 'yes' : 'no'` }));
const cardUp = (ms = 9000) => until(async () => ({ ok: await cardShown() }), ms, 600);
/** A new chat for the shown tab (Start over), filled. */
async function newChat(service) {
  await step({ service });
  await step({ sheet: 'chat' });
  await sleep(1200);
  await step({ newchat: 1 });
  return until(async () => { const s = await chatState(); return { ok: s.usable && s.trif > 0, s: JSON.stringify(s) }; }, 15000, 600);
}
const chatAt = async () => (/at: (\S+)/.exec(await chat()) || [])[1] || '';
const projOf = (st, service) => (new RegExp(`^${service}: .*project (\\S+), guide (\\w+)`, 'm').exec(st) || []).slice(1);
const pageOnly = async () => /yes/.test(await step({ chatjs: `return document.documentElement.hasAttribute('data-trif-pageonly') ? 'yes' : 'no'` }));

add('P1', 'project', 'Claude: the project card on the first new chat; Not now: gone, and never again', async () => {
  await projReset();
  const g = await newChat('Claude');
  if (!g.ok) return ['FAIL', `no fill: ${g.s}`];
  const up = await cardUp();
  shot('P1-card');
  // (told to the app once it has stayed in view 2 s)
  const st0 = (await until(async () => { const st = await projState(); return { ok: /Claude: offer shown/.test(st), st }; }, 6000, 500)).st || '';
  await step({ chatjs: `document.querySelector('#trif-greeting .trif-later').click(); return 1` });
  await sleep(1200);
  const gone = !(await cardShown());
  const st1 = await projState();
  await newChat('Claude');
  await sleep(4000);
  const again = await cardShown();
  return [up.ok && /Claude: offer shown/.test(st0) && gone && /Claude: offer declined/.test(st1) && !again ? 'PASS' : 'FAIL', `card up ${up.ok}; ${st0.split('\n')[0]} → ${st1.split('\n')[0]}; gone at once ${gone}; a new chat's card ${again}`];
});

add('P2', 'project', 'ChatGPT: the card\'s Set it up: the side bar\'s form filled, the person\'s Create, the project noticed, its settings\' instructions filled, the person\'s Save, a new chat in the project with the page only; a send there: its /g/…/c/ conversation kept', async () => {
  await projReset();
  const g = await newChat('ChatGPT');
  if (!g.ok) return ['FAIL', `no fill: ${g.s}`];
  if (!(await cardUp()).ok) return ['FAIL', 'no card'];
  await step({ chatjs: `document.querySelector('#trif-greeting .trif-setup').click(); return 1` });
  const form = await until(async () => { const v = await panejs(`const i = document.getElementById('chatgpt-project-name'); return i ? i.value + '|' + (document.getElementById('trif-hint') ? 'hint' : '') : 'none'`); return { ok: /^TRIF\|hint/.test(v), v }; }, 20000);
  if (!form.ok) return ['FAIL', `form: ${form.v}`];
  shot('P2-form');
  await panejs(`document.getElementById('chatgpt-project-name').form.querySelector('button[type="submit"]').click(); return 1`);
  const made = await until(async () => { const st = await projState(); const [u] = projOf(st, 'ChatGPT'); return { ok: /\/g\/g-p-[0-9a-f]{32}-trif\/project$/.test(u || ''), st }; }, 15000);
  if (!made.ok) return ['FAIL', `not noticed: ${made.st}`];
  const filled = await until(async () => { const v = await panejs(`const t = document.getElementById('pi-text'); return t ? String(t.value.includes('This project is for making TRIF mods')) : 'none'`); return { ok: v === 'true', v }; }, 15000);
  if (!filled.ok) return ['FAIL', `instructions: ${filled.v}; ${made.st}`];
  shot('P2-instructions');
  await panejs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Save').click(); return 1`);
  const saved = await until(async () => { const st = await projState(); return { ok: projOf(st, 'ChatGPT')[1] === 'true', st }; }, 10000);
  const inNew = await until(async () => { const s = await chatState(); const at = await chatAt(); return { ok: s.usable && s.trif > 0 && /\/g\/g-p-[0-9a-f]{32}-trif\/project/.test(at), at }; }, 20000);
  const only = await pageOnly();
  shot('P2-new-chat');
  const s = await send(words('P2'));
  const working = await until(async () => { const t = await chat(); return { ok: /activity: working/.test(t), t }; }, 8000, 400);
  await sleep(2500);
  const conv = { l: (await links()).links[0] || '' };
  const at = await chatAt();
  const o = await gotOffer(30000); await step({ cancelOffer: 1 });
  await newChat('ChatGPT');
  const back = await chatAt();
  return [saved.ok && inNew.ok && only && s === 'sent' && working.ok && o.ok && /\/g\/g-p-[^/]+\/c\//.test(at) && /\/project$/.test(back) ? 'PASS' : 'FAIL',
    `saved ${saved.ok}; new chat ${inNew.at}; page only ${only}; sent ${s}, working ${working.ok}, conversation ${at}; link ${conv.l}; offered ${o.id}; next new chat ${back}`];
});

add('P3', 'project', 'Claude: ⋯ Set it up: /projects/create filled (name, description), the person\'s Create, Set project instructions filled, the person\'s Save, new chats start in the project', async () => {
  await projReset();
  await step({ projectsetup: 'Claude' });
  const form = await until(async () => { const v = await panejs(`const n = document.getElementById('np-name'), d = document.getElementById('np-desc'); return n ? n.value + '|' + d.value : 'none'`); return { ok: /^TRIF\|Mods for websites/.test(v), v }; }, 20000);
  if (!form.ok) return ['FAIL', `form: ${form.v}`];
  await panejs(`document.querySelector('.create').click(); return 1`);
  const filled = await until(async () => { const v = await panejs(`const t = document.getElementById('pi-text'); return t ? String(t.value.includes('This project is for making TRIF mods')) : 'none'`); return { ok: v === 'true', v }; }, 20000);
  if (!filled.ok) return ['FAIL', `instructions: ${filled.v}; ${await projState()}`];
  await panejs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => /Save instructions/.test(b.textContent)).click(); return 1`);
  const saved = await until(async () => { const st = await projState(); return { ok: projOf(st, 'Claude')[1] === 'true', st }; }, 10000);
  const inNew = await until(async () => { const s = await chatState(); const at = await chatAt(); return { ok: s.usable && s.trif > 0 && /\/project\/p-[0-9a-f]{8}$/.test(at), at }; }, 20000);
  const only = await pageOnly();
  const s = await send(words('P3'));
  await until(async () => { const t = await chat(); return { ok: /activity: working/.test(t), t }; }, 8000, 400);
  await sleep(1500);
  const at = await chatAt();
  const o = await gotOffer(30000); await step({ cancelOffer: 1 });
  await newChat('Claude');
  const back = await chatAt();
  const noCard = !(await cardShown());
  return [saved.ok && inNew.ok && only && o.ok && /\/chat\//.test(at) && /\/project\/p-/.test(back) && noCard ? 'PASS' : 'FAIL', `saved ${saved.ok}; new chat ${inNew.at}; page only ${only}; sent ${s} → ${at}; offered ${o.id}; next new chat ${back}; card ${!noCard}`];
});

add('P4', 'project', 'The project gone (deleted on the stand-in, after P3): the next new chat is an ordinary one with the full instructions; the project forgotten; no card', async () => {
  const st0 = await projState();
  const [u] = projOf(st0, 'Claude');
  const id = (/\/project\/(p-[0-9a-f]{8})/.exec(u || '') || [])[1];
  if (!id) return ['BLOCKED', `needs P3's project: ${st0.split('\n')[0]}`];
  await new Promise((r) => http.get(`${BASE}/standin-project/${id}/delete`, (res) => { res.resume(); res.on('end', r); }).on('error', r));
  await step({ service: 'Claude' });
  await step({ sheet: 'chat' });
  await sleep(1200);
  await step({ newchat: 1 });
  const fell = await until(async () => { const st = await projState(); const s = await chatState(); return { ok: /Claude: offer \w+, project none/.test(st) && s.usable && s.trif > 0, st, at: await chatAt() }; }, 25000, 800);
  const only = await pageOnly();
  const card = await cardShown();
  return [fell.ok && !only && !card ? 'PASS' : 'FAIL', `${(fell.st || '').split('\n')[0]}; at ${fell.at}; page only ${only}; card ${card}`];
});

add('P5', 'project', 'Claude: sent past the card without an answer: never again', async () => {
  await projReset();
  const g = await newChat('Claude');
  if (!g.ok) return ['FAIL', `no fill: ${g.s}`];
  const up = await cardUp();
  await until(async () => ({ ok: /Claude: offer shown/.test(await projState()) }), 6000, 500);
  const s = await send(words('P5'));
  await until(async () => { const t = await chat(); return { ok: /activity: working/.test(t), t }; }, 8000, 400);
  const st = await projState();
  await gotOffer(30000); await step({ cancelOffer: 1 });
  await newChat('Claude');
  await sleep(4000);
  const again = await cardShown();
  return [up.ok && s === 'sent' && /Claude: offer ignored/.test(st) && !again ? 'PASS' : 'FAIL', `card ${up.ok}; sent ${s}; ${st.split('\n')[0]}; a new chat's card ${again}`];
});

add('P6', 'project', 'Claude: Set it up, then the form\'s Cancel: nothing kept, ordinary chats, no card again', async () => {
  await projReset();
  const g = await newChat('Claude');
  if (!g.ok) return ['FAIL', `no fill: ${g.s}`];
  if (!(await cardUp()).ok) return ['FAIL', 'no card'];
  await step({ chatjs: `document.querySelector('#trif-greeting .trif-setup').click(); return 1` });
  const form = await until(async () => { const v = await panejs(`const n = document.getElementById('np-name'); return n ? n.value : 'none'`); return { ok: v === 'TRIF', v }; }, 20000);
  if (!form.ok) return ['FAIL', `form: ${form.v}`];
  await panejs(`document.querySelector('.cancel').click(); return 1`);
  const over = await until(async () => { const st = await projState(); return { ok: /chat Claude [^\n]*setup none/.test(st) && /Claude: offer accepted, project none/.test(st), st }; }, 10000);
  await newChat('Claude');
  await sleep(4000);
  const again = await cardShown();
  const at = await chatAt();
  return [over.ok && !again && !/\/project\//.test(at) ? 'PASS' : 'FAIL', `${(over.st || '').replace(/\n/g, ' / ')}; card ${again}; at ${at}`];
});

// ---- site access (Tim 11-20: "is that disconnection actually robust?"): what access.html's OWN scripts saw of TRIF,
// sent to serve.js's /standin-access (never through TRIF), and every way the app reads a page tried on it (readcheck)
const reports = async (base, clear = true) => {
  const got = await new Promise((r) => http.get(`${base}/standin-access`, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { try { r(JSON.parse(b)); } catch (e) { r([]); } }); }).on('error', () => r([])));
  if (clear) await new Promise((r) => http.get(`${base}/standin-access?clear`, (res) => { res.resume(); res.on('end', r); }).on('error', r));
  return got;
};
/** Nothing of TRIF's in what a page's own scripts saw: no TRIF globals, no handler, no style or attribute of TRIF's. */
const clean = (r) => r.pageStart === 'undefined' && r.free === 'undefined' && r.trifRan === 'undefined' && !r.globals.length && !r.handlers.length && r.webkit === 'undefined' && !r.trifAttrs.length && r.trifNodes === 0 && r.probeColor === 'rgb(1, 2, 3)' && r.rootBorder === '';
const accessOf = async () => (await step({ access: 1 })).split('\n').find((l) => l.startsWith('*')) || '';
async function landed(base, href, ms = 9000) {
  return until(async () => { const l = (await reports(base, false)).filter((r) => r.when === 'loaded' && r.href.startsWith(href)); return { ok: l.length > 0, r: l[l.length - 1] }; }, ms, 500);
}

add('S1', 'access', 'A disconnected site: its page\'s own scripts see nothing of TRIF (no handler, no globals, no mods, no every-site mods), the tab\'s controller holds 0 scripts and no handler, every read refused', async () => {
  await step({ disconnect: '127.0.0.1' });
  await reports(OTHER);
  await step({ go: `${OTHER}/access.html?s1` });
  const l = await landed(OTHER, `${OTHER}/access.html?s1`);
  const a = await accessOf();
  const rc = await step({ readcheck: 1 });
  const refused = rc.split('\n').filter((x) => /REFUSED|none/.test(x)).length;
  await step({ connect: '127.0.0.1' });
  return [l.ok && clean(l.r) && /controller plain 0 user script\(s\), handler off/.test(a) && refused === 10 ? 'PASS' : 'FAIL', `page saw ${JSON.stringify(l.r || {}).slice(0, 300)}; ${a}; refused ${refused}/10`];
});

add('S2', 'access', 'A connected page with a frame from a disconnected site: TRIF in the page, nothing in the frame', async () => {
  await step({ disconnect: '127.0.0.1' });
  await reports(BASE); await reports(OTHER);
  await step({ go: `${BASE}/access.html?frame=${OTHER}` });
  const top = await landed(BASE, `${BASE}/access.html?frame=`);
  const fr = await landed(OTHER, `${OTHER}/access.html?inframe`);
  await step({ connect: '127.0.0.1' });
  return [top.ok && top.r.pageStart === 'object' && fr.ok && fr.r.frame && clean(fr.r) ? 'PASS' : 'FAIL', `page: start ${top.r && top.r.pageStart}; frame: ${JSON.stringify(fr.r || {}).slice(0, 260)}`];
});

add('S3', 'access', 'A redirect from a connected site to a disconnected one lands with nothing of TRIF (the controller set at the response)', async () => {
  await step({ disconnect: '127.0.0.1' });
  await reports(OTHER);
  await step({ go: `${BASE}/standin-redirect?to=${encodeURIComponent(`${OTHER}/access.html?s3`)}` });
  const l = await landed(OTHER, `${OTHER}/access.html?s3`);
  await step({ connect: '127.0.0.1' });
  return [l.ok && clean(l.r) ? 'PASS' : 'FAIL', JSON.stringify(l.r || {}).slice(0, 300)];
});

add('S4', 'access', 'Back to a page WebKit kept with TRIF in it, after its site was disconnected: loaded again, nothing of TRIF', async () => {
  await step({ go: `${OTHER}/access.html?s4` });
  const first = await landed(OTHER, `${OTHER}/access.html?s4`);
  await step({ go: `${BASE}/plain.html` });
  await sleep(2500);
  await step({ disconnect: '127.0.0.1' });
  await reports(OTHER);
  await step({ back: true });
  const l = await landed(OTHER, `${OTHER}/access.html?s4`);
  await step({ connect: '127.0.0.1' });
  return [first.ok && first.r.pageStart === 'object' && l.ok && clean(l.r) ? 'PASS' : 'FAIL', `before: start ${first.r && first.r.pageStart}; after: ${JSON.stringify(l.r || {}).slice(0, 260)}`];
});

add('S5', 'access', 'Disconnected: the robot gives the card and nothing is read; Connect: readable at once, a quick ask fills the chat', async () => {
  await step({ disconnect: '127.0.0.1' });
  await step({ go: `${OTHER}/access.html?s5` });
  await landed(OTHER, `${OTHER}/access.html?s5`);
  await step({ quick: words('S5') });
  await sleep(1500);
  const q0 = await step({ quickstate: 1 });
  await step({ sheet: 'none' });
  await step({ connect: '127.0.0.1' });
  await sleep(1500);
  const rc = await step({ readcheck: 1 });
  await step({ quick: words('S5') });
  const q = await until(async () => { const t = await step({ quickstate: 1 }); return { ok: /waitingSend/.test(t) && /in true/.test(t), t }; }, 20000, 800);
  await step({ quickcancel: 1 });
  return [!/waitingSend|working|starting/.test(q0) && /outline: \d+ chars/.test(rc) && q.ok ? 'PASS' : 'FAIL', `disconnected: ${q0.split('\n')[0]}; connected: ${rc.split('\n').find((x) => x.startsWith('outline'))}; ${q.t || ''}`];
});

module.exports = { step, until, launch, links, offer, modlist, ask, send, goToChat, tabs, reset, runsHere, words, modId, TAG, cases, shot, panejs, pagejs, chat, sleep, serve, cleanPrefs };

async function main() {
  if (args.includes('--list')) { for (const c of cases) console.log(`${c.id}\t${c.area}\t${c.name}`); return; }
  const only = (opt('--only') || '').split(',').filter(Boolean);
  await serve();
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(800);
  cleanPrefs();
  // (and the notes of sends a run left (SentNotes): no pickup of an earlier run's chat)
  try { fs.unlinkSync(notesFile()); } catch (e) {}
  await launch();
  // (site access, 11-20: every site starts disconnected; the stand-ins' hosts are connected for the run, as a person
  // would connect them; S1-S5 disconnect 127.0.0.1 for a moment and connect it again)
  for (const h of ['localhost', '127.0.0.1']) await step({ connect: h });
  // (the last run's mods out: Mx… names)
  for (const m of await modlist()) if (/^Mx/.test(m.name)) await step({ panelmsg: { type: 'delete', id: m.id } });
  await tabs();
  const results = [];
  for (const c of cases) {
    if (only.length && !only.includes(c.id)) continue;
    await reset();
    await step({ select: 0 });
    let r;
    const t0 = Date.now();
    try { r = await c.run(); } catch (e) { r = ['FAIL', `threw: ${e.stack || e}`]; }
    const line = { id: c.id, area: c.area, name: c.name, status: r[0], seen: String(r[1]).replace(/\s+/g, ' ').slice(0, 600), s: Math.round((Date.now() - t0) / 1000) };
    results.push(line);
    console.log(`${line.status.padEnd(7)} ${c.id} ${c.name} (${line.s} s)\n        ${line.seen}`);
  }
  const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(`\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')} (tag ${TAG})`);
  fs.writeFileSync(path.join(os.tmpdir(), 'trif-ios-matrix-last.json'), JSON.stringify({ tag: TAG, at: new Date().toISOString(), results }, null, 1));
  for (const p of servers) p.kill();
}
if (require.main === module) main().catch((e) => { console.error(e); for (const p of servers) p.kill(); process.exit(1); });
