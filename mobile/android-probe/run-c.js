#!/usr/bin/env node
'use strict';
// Part C, by itself, on the running headless emulator: C1 network, C2 background video (without and with the
// foreground service), C3 pinned shortcut. Writes results/c.log (the app's lines + the server's) and
// results/c*.png, and prints PASS/FAIL lines.
//
//   ./emu.sh start && ./gradlew -q assembleDebug && node run-c.js [c1,c2,c2keep,c3]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { start } = require('./serve.js');

const ADB = path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const PKG = 'com.timsrobot.trif.probe', ACT = `${PKG}/.CheckActivity`;
const OUT = path.join(__dirname, 'results');
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readLog = () => { try { return adb('exec-out', 'run-as', PKG, 'cat', 'files/c.log'); } catch { return ''; } };
const shot = (name) => { const f = path.join(OUT, name); fs.writeFileSync(f, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })); try { execFileSync('sips', ['-Z', '800', f], { stdio: 'ignore' }); } catch { /* full size */ } };
const ui = () => { adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); return adb('exec-out', 'cat', '/sdcard/ui.xml'); };
const nodes = (xml) => [...xml.matchAll(/<node [^>]*>/g)].map((m) => { const a = (k) => (new RegExp(` ${k}="([^"]*)"`).exec(m[0]) || [])[1]; const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a('bounds')).slice(1).map(Number); return { text: a('text'), desc: a('content-desc'), x: (b[0] + b[2]) >> 1, y: (b[1] + b[3]) >> 1 }; });
const tap = (n) => adb('shell', 'input', 'tap', String(n.x), String(n.y));
const verdicts = [];
const verdict = (ok, name, why) => { const l = `${ok ? 'PASS' : 'FAIL'} ${name}: ${why}`; verdicts.push(l); console.log(l); };
const fresh = () => { adb('shell', 'am', 'force-stop', PKG); try { adb('shell', 'run-as', PKG, 'rm', '-f', 'files/c.log'); } catch { /* none yet */ } };
const pageLines = (text, kind) => text.split('\n').filter((l) => / PAGE \{/.test(l)).map((l) => ({ ts: Number(l.split(' ')[0]), ...JSON.parse(l.slice(l.indexOf('{'))) })).filter((o) => o.kind === kind);

async function c1(server) {
  fresh();
  adb('shell', 'am', 'start', '-n', ACT, '--es', 'mode', 'net');
  let text = '';
  for (let i = 0; i < 15 && !pageLines(text, 'net').length; i++) { await sleep(1000); text = readLog(); }
  fs.appendFileSync(path.join(OUT, 'c.log'), `# C1\n${text}`);
  const r = pageLines(text, 'net')[0] || {};
  const seen = text.split('\n').filter((l) => / SEEN /.test(l));
  const post = seen.find((l) => / SEEN POST \S*\/echo /.test(l));
  verdict(!!post && r.post && r.post.body === 'probe-body-42', 'C1.post', post ? `shouldInterceptRequest saw "${post.split(' SEEN ')[1]}"; the server got body "${r.post && r.post.body}"` : 'the POST was never seen');
  verdict(true, 'C1.noBody', 'WebResourceRequest has method, url and headers only: no body in the API at all');
  const ws = seen.filter((l) => /\/ws\b|ws:\/\//.test(l));
  verdict(r.ws === 'echo:probe-ws-hello' && !ws.length && server.some((l) => /^WS /.test(l)), 'C1.noWebSocket', `the page's WebSocket worked (${r.ws || r.wsError}), shouldInterceptRequest saw ${ws.length} WebSocket requests (of ${seen.length} requests)`);
}

async function c2(fgs, keep = false) {
  const name = `C2.${fgs ? 'fgs' : 'noFgs'}${keep ? '+keepVisible' : ''}`;
  fresh();
  adb('shell', 'am', 'start', '-n', ACT, '--es', 'mode', 'video', '--ez', 'fgs', String(fgs), '--ez', 'keep', String(keep));
  await sleep(8000);
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await sleep(2000);
  const services = adb('shell', 'dumpsys', 'activity', 'services', PKG);
  await sleep(38000);
  const proc = adb('shell', 'dumpsys', 'activity', 'processes', PKG).split('\n').filter((l) => /isFrozen|mFrozen|freez/i.test(l)).map((l) => l.trim()).slice(0, 3).join(' | ');
  adb('shell', 'am', 'start', '-n', ACT, '-f', '0x00020000'); // back to the front, the same activity
  await sleep(4000);
  shot(`${name.replace('.', '-')}.png`);
  const text = readLog();
  fs.appendFileSync(path.join(OUT, 'c.log'), `# ${name}\n${text}# services: ${/isForeground=true/.test(services) ? 'foreground service running' : 'no foreground service'}; process: ${proc}\n`);
  const lines = text.split('\n'), tsOf = (re) => { const l = lines.find((x) => re.test(x)); return l ? Number(l.split(' ')[0]) : 0; };
  const stop = tsOf(/ LIFE stop/), back = lines.filter((x) => / LIFE start/.test(x)).map((x) => Number(x.split(' ')[0]))[1] || 0;
  const v = pageLines(text, 'video').filter((o) => o.t !== undefined);
  const before = v.filter((o) => o.ts <= stop).pop(), after = v.find((o) => o.ts > back + 500) || v[v.length - 1];
  const inBg = v.filter((o) => o.ts > stop && o.ts < back);
  if (!stop || !back || !before || !after) return verdict(false, name, `incomplete run (stop=${stop} back=${back} reports=${v.length})`);
  const wall = (after.wall - before.wall) / 1000, played = after.t - before.t;
  verdict(played / wall > 0.9, name, `in the background ${((back - stop) / 1000).toFixed(0)} s: the video moved ${played.toFixed(1)} s in ${wall.toFixed(1)} s of wall time (${Math.round(100 * played / wall)}%), ${inBg.length} reports arrived meanwhile, paused events: ${v.filter((o) => o.why === 'pause').length}; ${/isForeground=true/.test(services) ? 'foreground service on' : 'no foreground service'}`);
}

async function c3() {
  // a clean start: uninstalling removes any shortcut an earlier run pinned
  adb('uninstall', PKG); adb('install', path.join(__dirname, 'app/build/outputs/apk/debug/app-debug.apk'));
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  adb('shell', 'am', 'start', '-n', ACT, '--es', 'mode', 'pin');
  await sleep(3000);
  shot('c3-1-dialog.png');
  let all = nodes(ui());
  const add = all.find((n) => /^(add|add to home screen|add automatically)$/i.test(n.text || ''));
  console.log('pin dialog texts:', all.map((n) => n.text).filter(Boolean).join(' | '));
  if (!add) return verdict(false, 'C3.dialog', 'no Add button on screen (see c3-1-dialog.png)');
  tap(add);
  await sleep(2000);
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await sleep(2500);
  shot('c3-2-home.png');
  all = nodes(ui());
  let icon = all.find((n) => /Probe site/.test(`${n.text} ${n.desc}`));
  if (!icon) { adb('shell', 'input', 'swipe', '900', '1500', '100', '1500', '300'); await sleep(1500); shot('c3-2-home-page2.png'); all = nodes(ui()); icon = all.find((n) => /Probe site/.test(`${n.text} ${n.desc}`)); } // Pixel Launcher puts it on page 2
  verdict(!!icon, 'C3.icon', icon ? 'the launcher shows a "Probe site" icon' : `no "Probe site" icon on the home screen (texts: ${all.map((n) => n.text || n.desc).filter(Boolean).join(' | ')})`);
  if (!icon) return;
  tap(icon);
  await sleep(6000);
  shot('c3-3-site.png');
  const text = readLog();
  fs.appendFileSync(path.join(OUT, 'c.log'), `# C3\n${text}`);
  const site = text.split('\n').find((l) => / SITE /.test(l)) || '';
  verdict(/systemBarsVisible=false/.test(site) && /plain\.html/.test(site), 'C3.fullScreen', site ? site.split(' SITE ')[1] : 'the shortcut did not open site mode');
}

(async () => {
  const only = (process.argv[2] || 'c1,c2,c2keep,c3').split(',');
  const server = [];
  const servers = start(undefined, (l) => server.push(l));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'c.log'), '');
  const clip = path.join(__dirname, 'build/clip.mp4'); // C2's video: 60 s test pattern with a silent sound track, made locally
  if (!fs.existsSync(clip)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=60', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart', clip]);
  adb('reverse', 'tcp:8477', 'tcp:8477'); adb('reverse', 'tcp:8478', 'tcp:8478');
  adb('shell', 'am', 'force-stop', PKG);
  adb('install', '-r', path.join(__dirname, 'app/build/outputs/apk/debug/app-debug.apk'));
  try { adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
  try {
    if (only.includes('c1')) await c1(server);
    if (only.includes('c2')) { await c2(false); await c2(true); }
    if (only.includes('c2keep')) { await c2(true, true); await c2(false, true); }
    if (only.includes('c3')) await c3();
  } finally {
    adb('shell', 'am', 'force-stop', PKG);
    servers.forEach((s) => s.close());
    fs.appendFileSync(path.join(OUT, 'c.log'), `# server\n${server.join('\n')}\n# verdicts\n${verdicts.join('\n')}\n`);
  }
})();
