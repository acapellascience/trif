#!/usr/bin/env node
'use strict';
// A browser check of the Tune Composer on its dev page (tests/dev/serve.js): Chrome for Testing, headless
// and muted, driven over the DevTools protocol. Layout screenshots, editing with the mouse and keys, keys
// left alone in the page's own fields, Save and reload, and the sound rendered offline (an
// OfflineAudioContext: its length and that it isn't silent), never played out loud.
//
//   node tests/dev/check.js --work <scratch dir> --out <dir for screenshots and results.json>
//
// Not part of `npm test`. Run it under a runner that holds the shared browser lock, one browser at a time.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { findChrome } = require('../e2e/lib/chrome');
const { sleep, waitFor, freePort } = require('../e2e/lib/util');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const WORK = path.resolve(opt('--work', fs.mkdtempSync('/tmp/tune-check-')));
const OUT = path.resolve(opt('--out', path.join(WORK, 'out')));
fs.mkdirSync(OUT, { recursive: true });

class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.waiting = new Map(); this.listeners = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => { this.ws = ws; resolve(this); };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== undefined && this.waiting.has(m.id)) {
          const w = this.waiting.get(m.id);
          this.waiting.delete(m.id);
          if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result);
        } else if (m.method) for (const fn of this.listeners) fn(m);
      };
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.waiting.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${method}: timed out`)); }, 60000);
    });
  }
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome for Testing not found (tests/e2e/.browsers or TRIF_E2E_CHROME)');
  const sitePort = await freePort(), cdpPort = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(sitePort)], { stdio: 'ignore' });
  const browser = spawn(chrome, [
    '--headless=new', '--mute-audio', `--user-data-dir=${path.join(WORK, 'profile')}`, `--remote-debugging-port=${cdpPort}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update', '--disable-background-networking',
    '--password-store=basic', '--use-mock-keychain', '--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { browser.kill('SIGKILL'); } catch {} try { server.kill(); } catch {} };
  process.on('exit', cleanup);
  try {
    const ver = await waitFor('Chrome', async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(), { timeoutMs: 30000 });
    const cdp = await new Cdp(ver.webSocketDebuggerUrl).connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    cdp.listeners.push((m) => {
      if (m.sessionId !== sid) return;
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    const size = (width, height, dpr = 2) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }, sid);
    await size(1280, 900);
    const js = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const go = async (url) => { await cdp.send('Page.navigate', { url }, sid); await sleep(300); await waitFor('the page', () => js('document.readyState === "complete"')); };
    const shot = async (name, clip) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, sid);
      fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
      return path.join(OUT, name);
    };
    const mouse = async (type, x, y, button = 'left', extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra }, sid);
    const click = async (x, y, button = 'left', modifiers = 0) => { await mouse('mouseMoved', x, y, 'none'); await mouse('mousePressed', x, y, button, { modifiers }); await mouse('mouseReleased', x, y, button, { modifiers }); await sleep(60); };
    const KEYS = { Space: [' ', 32], Escape: ['Escape', 27], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], Backspace: ['Backspace', 8] };
    const key = async (code, modifiers = 0) => {
      const [k, vk] = KEYS[code] || (code.startsWith('Key') ? [code.slice(3).toLowerCase(), code.charCodeAt(3)] : [code.slice(5), code.charCodeAt(5)]);
      const text = !modifiers && k.length === 1 ? k : undefined;
      await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: modifiers & 8 && k.length === 1 ? k.toUpperCase() : k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) }, sid);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }, sid);
      await sleep(60);
    };
    // where things are, from the page
    const notes = (ch) => js(`document.querySelectorAll('#tcp-panel .tcp-lane[data-ch=${ch}] .tcp-n').length`);
    const widths = (ch) => js(`[...document.querySelectorAll('#tcp-panel .tcp-lane[data-ch=${ch}] .tcp-n')].map((n) => n.offsetWidth)`);
    // the middle of a cell: col 0–15; for a melodic lane, `pitchFromTop` rows below the top of what's in view
    const cell = (ch, col, row) => js(`(() => {
      const lane = document.querySelector('#tcp-panel .tcp-lane[data-ch=${ch}]'), roll = lane.querySelector('.tcp-roll'), sc = lane.querySelector('.tcp-scroll');
      const r = roll.getBoundingClientRect(), s = sc.getBoundingClientRect(), drums = '${ch}' === 'noise';
      const y = drums ? r.top + (7 - ${row}) * 12 + 6 : r.top + Math.floor((s.top + 10 + ${row} * 7 - r.top) / 7) * 7 + 3.5;
      return { x: r.left + 36 + ${col} * 22 + 11, y };
    })()`);
    const clickSel = async (sel) => { const p = await js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await click(p.x, p.y); };
    const panelBox = () => js(`(() => { const r = document.getElementById('tcp-panel').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: Math.min(innerHeight, r.height + 16) }; })()`);

    // --- opened on Edit profile, with the demo tune ---
    await js('localStorage.clear()').catch(() => {});
    await go(`http://127.0.0.1:${sitePort}/settings/profile`);
    await js('localStorage.clear()');
    await go(`http://127.0.0.1:${sitePort}/settings/profile`);
    await waitFor('the composer', () => js('!!document.getElementById("tcp-panel")'));
    await sleep(300);
    check('the "♪ Tune" button sits right before Save', await js('document.querySelector("[data-testid=Profile_Save_Button]").previousElementSibling?.id === "tcp-open"'));
    const demo = await js(`({ p1: document.querySelectorAll('.tcp-lane[data-ch=p1] .tcp-n').length, tri: document.querySelectorAll('.tcp-lane[data-ch=tri] .tcp-n').length, noise: document.querySelectorAll('.tcp-lane[data-ch=noise] .tcp-n').length,
      tabs: document.querySelectorAll('#tcp-panel .tcp-tab').length, order: document.querySelectorAll('#tcp-panel .tcp-o').length, meter: document.querySelector('#tcp-panel .tcp-mtext').textContent, status: document.querySelector('#tcp-panel .tcp-status').textContent })`);
    check('the demo tune is loaded (6 patterns, 8 bars, notes in pattern A)', demo.tabs === 6 && demo.order === 8 && demo.p1 === 7 && demo.tri === 6 && demo.noise === 9, demo);
    const demoBytes = +/(\d+) bytes/.exec(demo.meter)[1];
    check('the meter shows the demo’s size: one corner of three', demoBytes > 100 && demoBytes <= 440 && /uses 1 of 3 corners · [\d,]+ to spare/.test(demo.meter), demo.meter);
    const fit = await js(`(() => { const p = document.getElementById('tcp-panel'); const r = p.getBoundingClientRect(); return { w: r.width, h: r.height, overflowX: p.scrollWidth > p.clientWidth, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, lanesFit: [...p.querySelectorAll('.tcp-lane')].every((l) => l.scrollWidth <= l.clientWidth + 1) }; })()`);
    check('the panel fits in the window: no sideways scrolling, lanes inside it', !fit.overflowX && fit.lanesFit && fit.right >= 0 && fit.bottom >= 0, fit);
    const shots = [await shot('1-composer-on-x.png'), await shot('2-composer-panel.png', await panelBox())];

    // --- the mouse: place, drag, remove ---
    await clickSel('#tcp-panel .tcp-tabs .tcp-act'); // + New
    const after = await js(`({ tabs: document.querySelectorAll('#tcp-panel .tcp-tab').length, order: document.querySelectorAll('#tcp-panel .tcp-o').length, sel: document.querySelector('#tcp-panel .tcp-tab[aria-pressed=true]').textContent })`);
    check('+ New makes pattern G, adds it to the song, and selects it', after.tabs === 7 && after.order === 9 && after.sel === 'G', after);
    check('pattern G starts empty', (await notes('p1')) === 0 && (await notes('noise')) === 0);
    let c = await cell('p1', 0, 5);
    await click(c.x, c.y);
    check('a click places a note, 2 rows long', (await notes('p1')) === 1 && (await widths('p1'))[0] === 2 * 22 - 2, await widths('p1'));
    const a = await cell('p1', 4, 7), b = await cell('p1', 7, 7);
    await mouse('mouseMoved', a.x, a.y, 'none'); await mouse('mousePressed', a.x, a.y);
    for (let x = a.x; x <= b.x; x += 8) await mouse('mouseMoved', x, a.y, 'left', { buttons: 1 });
    await mouse('mouseMoved', b.x, b.y, 'left', { buttons: 1 }); await mouse('mouseReleased', b.x, b.y); await sleep(60);
    check('dragging sets a note’s length (4 rows)', (await notes('p1')) === 2 && (await widths('p1'))[1] === 4 * 22 - 2, await widths('p1'));
    await click(c.x, c.y);
    check('clicking a note again removes it', (await notes('p1')) === 1);
    await click(a.x, a.y, 'right');
    check('right-click removes a note', (await notes('p1')) === 0);
    c = await cell('noise', 0, 0);
    await click(c.x, c.y);
    const d = await cell('noise', 4, 1);
    await click(d.x, d.y);
    check('drum pads: a kick and a snare', (await notes('noise')) === 2);

    // --- keys: the piano, and X's fields left alone ---
    await key('ArrowDown'); // (noise → Pulse 1)
    check('↓ moves to the next lane (Pulse 1, after Noise)', await js('document.querySelector("#tcp-panel .tcp-lane[data-sel]")?.dataset.ch') === 'p1');
    await key('KeyA'); await key('KeyD'); await key('KeyG');
    check('the piano keys enter notes at the cursor (A D G: three notes)', (await notes('p1')) === 3, await widths('p1'));
    await js('document.getElementById("name").focus()');
    await key('KeyA'); await key('KeyS'); await key('Space');
    const field = await js('document.getElementById("name").value');
    check('typing in the page’s own field goes to the field, not the piano', field.replace('Tim Blais', '') === 'as ' && (await notes('p1')) === 3, field);
    await js('document.getElementById("name").blur()');
    await js(`(() => { const e = document.querySelector('[role=textbox]'); e.focus(); })()`);
    await key('KeyF');
    check('…and in a contenteditable post box', (await js('document.querySelector("[role=textbox]").textContent')) === 'f' && (await notes('p1')) === 3);
    await js('document.activeElement.blur()');
    await key('KeyZ', 2); // Ctrl+Z
    check('Ctrl+Z undoes the last note', (await notes('p1')) === 2);
    await clickSel('#tcp-panel .tcp-foot .tcp-btn:nth-child(2)'); // Undo
    check('Undo (the button) too', (await notes('p1')) === 1);
    await key('Backspace');
    check('Backspace deletes the note before the cursor', (await notes('p1')) === 0);
    await key('KeyA'); await key('KeyE'); await key('KeyG'); await key('KeyK');

    // --- play (muted), with the playhead ---
    await clickSel('#tcp-panel .tcp-seg button[data-v=pattern]');
    await key('Space');
    await sleep(700);
    const play = await js(`({ label: document.querySelector('#tcp-panel .tcp-play').textContent, ph: getComputedStyle(document.querySelector('#tcp-panel .tcp-lane[data-ch=p1] .tcp-ph')).display, left: document.querySelector('#tcp-panel .tcp-lane[data-ch=p1] .tcp-ph').style.left })`);
    check('Space plays: the button says Stop, the playhead moves over the pattern', /Stop/.test(play.label) && play.ph === 'block', play);
    await clickSel('#tcp-panel .tcp-seg button[data-v=song]');
    await clickSel('#tcp-panel .tcp-o');
    await sleep(500);
    shots.push(await shot('3-composer-playing.png', await panelBox()));
    await key('Space');
    check('Space again stops', /Play/.test(await js('document.querySelector("#tcp-panel .tcp-play").textContent')));

    // --- Save, reload ---
    const meter = await js('document.querySelector("#tcp-panel .tcp-mtext").textContent');
    await clickSel('#tcp-panel .tcp-foot .tcp-primary');
    const stored = await js('(() => { const s = localStorage.getItem("trifTuneComposer.song"); return s && atob(s).length; })()');
    check('Save keeps the encoded bytes (as many as the meter says)', stored === +/(\d+) bytes/.exec(meter)[1], { stored, meter });
    await go(`http://127.0.0.1:${sitePort}/settings/profile`);
    await waitFor('the composer again', () => js('!!document.getElementById("tcp-panel")'));
    const back = await js(`({ tabs: document.querySelectorAll('#tcp-panel .tcp-tab').length, status: document.querySelector('#tcp-panel .tcp-status').textContent })`);
    check('after a reload the saved tune is back', back.tabs === 7 && back.status === 'Saved.', back);
    await key('KeyT', 1 | 8);
    check('Alt+Shift+T closes it', !(await js('!!document.getElementById("tcp-panel")')));
    await clickSel('.dialog .x'); // (Edit profile's own close: the mock goes to /home)
    await sleep(1000);
    check('away from Edit profile there’s no button', !(await js('!!document.getElementById("tcp-open")')));
    await key('KeyT', 1 | 8);
    check('Alt+Shift+T opens it anywhere', await js('!!document.getElementById("tcp-panel")'));
    check('…with each lane where it was (the demo’s notes in view)', await js(`[...document.querySelectorAll('#tcp-panel .tcp-lane[data-ch=p2] .tcp-n')].some((n) => { const s = n.closest('.tcp-scroll').getBoundingClientRect(), r = n.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom; })`));

    // --- a narrow window ---
    await size(760, 820);
    await sleep(200);
    const narrow = await js(`(() => { const p = document.getElementById('tcp-panel'); const r = p.getBoundingClientRect(); return { left: r.left, right: innerWidth - r.right, overflowX: p.scrollWidth > p.clientWidth + 1, scrollsDown: p.scrollHeight > p.clientHeight }; })()`);
    check('in a 760×820 window it stays on screen (scrolling down, not sideways)', narrow.left >= 0 && narrow.right >= 0 && !narrow.overflowX, narrow);
    shots.push(await shot('4-composer-narrow.png'));
    await size(1280, 900);

    // --- the sound, rendered offline (never played) ---
    const audio = await js(`(async () => {
      const src = await (await fetch('/mod/tune-composer.js')).text();
      const grab = (n) => src.slice(src.indexOf('/* ' + n + ':begin */'), src.indexOf('/* ' + n + ':end */'));
      const { TuneCodec: C, TuneSynth: S, TUNE_DEMO } = new Function(grab('tune-codec') + grab('tune-synth') + grab('tune-demo') + '; return { TuneCodec, TuneSynth, TUNE_DEMO };')();
      const song = C.fromText(TUNE_DEMO), rd = 60 / (song.tempo * song.rpb);
      const stats = (buf, from = 0, to = buf.length) => { const d = buf.getChannelData(0); let s = 0, peak = 0; for (let i = from; i < to; i++) { s += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); } return { rms: Math.sqrt(s / Math.max(1, to - from)), peak }; };
      const buf = await S.render(song);
      const bar = Math.round(16 * rd * buf.sampleRate), bars = song.order.map((_, i) => +stats(buf, i * bar, (i + 1) * bar).rms.toFixed(4));
      const win = Math.round(0.02 * buf.sampleRate), d = buf.getChannelData(0);
      let loud = 0, wins = 0;
      for (let i = 0; i + win <= song.order.length * bar; i += win, wins++) { let s = 0; for (let j = i; j < i + win; j++) s += d[j] * d[j]; if (Math.sqrt(s / win) > 0.003) loud++; }
      const solo = {};
      for (const ch of C.CHANNELS) {
        const only = { ...song, patterns: song.patterns.map((p) => ({ p1: [], p2: [], tri: [], noise: [], [ch]: C.laneOf(p, ch) })) };
        solo[ch] = +stats(await S.render(C.normalize(only))).rms.toFixed(4);
      }
      const drums = [];
      for (let k = 0; k < 8; k++) { const b = await S.render(C.normalize({ ...song, patterns: [{ noise: [{ row: 0, len: 8, drum: k }] }], order: [0] })); drums.push(+stats(b, 0, Math.round(0.06 * b.sampleRate)).rms.toFixed(4)); }
      const duties = [];
      for (let k = 0; k < 4; k++) duties.push(+stats(await S.render(C.normalize({ ...song, inst: { ...song.inst, p1: { ...song.inst.p1, duty: k, decay: 0 } }, patterns: [{ p1: [{ row: 0, len: 16, pitch: 36 }] }], order: [0] }))).rms.toFixed(4));
      const sweep = stats(await S.render(C.normalize({ ...song, inst: { ...song.inst, p1: { duty: 2, vol: 12, decay: 0, sweep: { neg: false, period: 0, shift: 1 } } }, patterns: [{ p1: [{ row: 0, len: 16, pitch: 36 }] }], order: [0] }))).rms;
      const all = stats(buf);
      return { duration: buf.duration, expected: song.order.length * 16 * rd + 0.5, rms: +all.rms.toFixed(4), peak: +all.peak.toFixed(3), bars, loud: +(loud / wins).toFixed(3), solo, drums, duties, sweepZapRms: +sweep.toFixed(4), bytes: C.encode(song).length };
    })()`);
    check('the demo renders for its full length (8 bars at 140 bpm, plus the tail)', Math.abs(audio.duration - audio.expected) < 0.001, { duration: audio.duration, expected: audio.expected });
    check('…and isn’t silent anywhere: every bar has sound, nearly every 20 ms', audio.bars.every((r) => r > 0.02) && audio.loud > 0.95, { bars: audio.bars, loud: audio.loud });
    check('…and doesn’t clip', audio.peak < 1 && audio.peak > 0.1, { peak: audio.peak, rms: audio.rms });
    check('each channel makes sound on its own', Object.values(audio.solo).every((r) => r > 0.005), audio.solo);
    check('all 8 drums sound (their first 60 ms)', audio.drums.every((r) => r > 0.02), audio.drums);
    check('all 4 duties sound, the narrow ones quieter', audio.duties.every((r) => r > 0.01) && audio.duties[0] < audio.duties[2], audio.duties);
    check('a fast downward sweep runs out of range and goes quiet early', audio.sweepZapRms < audio.duties[2] / 3, { zap: audio.sweepZapRms, held: audio.duties[2] });
    check('the browser’s encoding of the demo is the same size as the meter’s', audio.bytes === demoBytes, audio.bytes);
    check('no errors on the page', errors.length === 0, errors);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, audio, shots }, null, 2));
    console.log(`screenshots:\n${shots.join('\n')}`);
  } finally {
    cleanup();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
