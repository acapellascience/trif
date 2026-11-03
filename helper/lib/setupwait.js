'use strict';
// After `trif setup` prints its next steps, at a terminal: wait for the browser and say when each step
// is done, so the person following them sees it work. The browser starts the helper once TRIF is
// installed in it (native messaging), and the extension says hello with whether user scripts are on:
// the same as `trif status` sees, read from every helper in the workspace (one per browser).
//
// Ctrl-C skips the wait; so does --no-wait, and anything but a terminal (scripts, tests, --json).
// Safari has no wait: its bridge runs on its own, and its app is built by hand (README).

const { listHelpers } = require('./helpers');

const POLL_MS = 1000;
const TIMEOUT_MS = 10 * 60 * 1000;

/** What the browsers setup set up wait for, in words: "Chrome", "Firefox", "Chrome or Firefox"; null for none. */
function waitingFor(targets) {
  const chromium = targets.find((t) => !t.firefox && !t.safari && t.key !== 'custom');
  const firefox = targets.some((t) => t.firefox);
  if (chromium && firefox) return { name: `${chromium.label === 'Google Chrome' ? 'Chrome' : chromium.label} or Firefox`, how: 'install TRIF there (the steps above)' };
  if (chromium) return { name: chromium.label === 'Google Chrome' ? 'Chrome' : chromium.label, how: 'drag the folder onto chrome://extensions' };
  if (firefox) return { name: 'Firefox', how: 'open the add-on link' };
  return null;
}

/** {connected, userScripts, browser} from the helpers in `home` (connected: an extension said hello). */
async function probe(home) {
  const withExt = (await listHelpers(home)).filter((h) => h.info && h.info.extension);
  const on = withExt.find((h) => h.info.extension.userScripts);
  const h = on || withExt[0];
  return { connected: !!h, userScripts: !!on, browser: h ? h.info.extension.browser || 'Chrome' : null };
}

/**
 * Waits, printing as it goes: "Waiting for <browser>: <how>…", then "✓ Connected" and the next step,
 * then "✓ User scripts on" and the way to start. Returns 'done', 'connected' (when it was already),
 * 'timeout' or 'skipped' (stop() called: Ctrl-C).
 * opts: { targets, print(line), probe() -> {connected, userScripts, browser}, trif (the CLI as typed),
 *         sleep(ms), now(), timeoutMs, onStop(fn) (registers what Ctrl-C calls) }
 */
async function waitForBrowser({ targets, print, probe: check, trif = 'trif', sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now, timeoutMs = TIMEOUT_MS, onStop = () => {} }) {
  const what = waitingFor(targets);
  if (!what) return 'none';
  let state = await check();
  if (state.connected && state.userScripts) return 'connected';
  let stopped = false;
  onStop(() => { stopped = true; });
  const until = now() + timeoutMs;
  print('');
  if (!state.connected) {
    print(`Waiting for ${what.name}: ${what.how}… (Ctrl-C to skip)`);
    while (!stopped && now() < until) {
      await sleep(POLL_MS);
      state = await check();
      if (state.connected) break;
    }
    if (stopped) return 'skipped';
    if (!state.connected) return timedOut(print, what.name, trif);
    print(`✓ Connected (${state.browser})`);
  }
  if (!state.userScripts) {
    print(state.browser === 'Firefox'
      ? 'Now click “Allow user scripts” on the TRIF setup tab that just opened, then Allow.'
      : 'Now flip “Allow User Scripts” on the TRIF setup tab that just opened.');
    while (!stopped && now() < until) {
      await sleep(POLL_MS);
      state = await check();
      if (state.userScripts) break;
    }
    if (stopped) return 'skipped';
    if (!state.userScripts) return timedOut(print, state.browser || what.name, trif);
  }
  print('✓ User scripts on. Open any website, click the TRIF icon, and ask for a change.');
  return 'done';
}

function timedOut(print, name, trif) {
  print(`Stopped waiting for ${name}. The steps above still work; if it doesn't connect, run: ${trif} doctor`);
  return 'timeout';
}

module.exports = { waitForBrowser, waitingFor, probe, POLL_MS, TIMEOUT_MS };
