#!/usr/bin/env node
'use strict';
// The iPhone app's mod matrix (Tim, 11-19: "a systematic test of making mods on the iPhone app"): where a request
// starts, where the person is when the mod arrives, what arrives, and what happens after, run against the stand-in
// chats in the iOS Simulator. docs/IOS-MOD-MATRIX.md has the table and what each row found.
//
//   node mobile/test/ios-matrix.js                 every case
//   node mobile/test/ios-matrix.js --only A1,B3    those
//   node mobile/test/ios-matrix.js --list          the cases
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
const GPT_HOME = `${BASE}/chat.html?gpt&gptin&keep`;
const TAG = `r${Date.now().toString(36).slice(-5)}`;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
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
  const js = `const ed = document.querySelector('.ProseMirror'); if (!ed) return 'no box';
    ed.append(document.createTextNode(' ' + ${JSON.stringify(words)})); ed.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const b = document.querySelector('button[aria-label="Send message"], button[aria-label="Send"]'); if (!b) return 'no send';
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

add('B11', 'where', 'The app killed mid-reply and launched again: nothing stale, the chat shows the finished reply with Add to TRIF, not offered by itself', async () => {
  const r = await ask(words('B11', 'wait 20'));
  if (!r.ok) return ['FAIL', `send: ${r.why}`];
  await sleep(2500);
  await launch();
  const l = await links();
  const stale = l.links.some((x) => / working /.test(x));
  const badges = await step({ tabbadges: 1 });
  await step({ sheet: 'chat' });
  await sleep(4000);
  const add = await until(async () => { const t = await panejs('return [...document.querySelectorAll("button, [role=button]")].some((b) => /Add to TRIF/.test(b.textContent)) ? "yes" : "no " + location.pathname + " " + document.querySelectorAll("pre").length'); return { ok: /yes/.test(t), t }; }, 20000);
  const o = await offer();
  shot('B11-relaunched-chat');
  await step({ closechat: 1 });
  return [!stale && add.ok && !o.id ? 'PASS' : 'FAIL', `links after launch: ${l.links[0]}; badges ${badges.replace(/\n/g, ' ')}; Add to TRIF in the chat: ${add.ok} (${add.t}); offered by itself: ${o.id || 'no'}`];
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

module.exports = { step, until, launch, links, offer, modlist, ask, send, goToChat, tabs, reset, runsHere, words, modId, TAG, cases, shot, panejs, pagejs, chat, sleep, serve, cleanPrefs };

async function main() {
  if (args.includes('--list')) { for (const c of cases) console.log(`${c.id}\t${c.area}\t${c.name}`); return; }
  const only = (opt('--only') || '').split(',').filter(Boolean);
  await serve();
  try { sim('terminate', DEV, APP); } catch (e) {}
  await sleep(800);
  cleanPrefs();
  await launch();
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
