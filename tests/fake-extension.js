'use strict';
// A fake TRIF extension for helper tests: spawns helper/host.js like Chrome would and speaks
// native messaging over its stdio. Also small utilities shared by the helper and CLI tests.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encode, Decoder } = require('../helper/lib/framing');

const REPO = path.resolve(__dirname, '..');
const HOST_JS = path.join(REPO, 'helper', 'host.js');
const CLI_JS = path.join(REPO, 'helper', 'cli.js');

// Short temp dirs: unix socket paths are limited to ~104 bytes on macOS.
function tempDir(prefix = 'wm-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// The private folder of a test workspace (paths.js privateDir: <workspace>-private for a TRIF_HOME),
// made if it isn't there yet (so a test can put a config.json in it).
function privDir(home) {
  const dir = `${home}-private`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// PATH without any real coding agent on it (setup records PATH and the helper/doctor look agents up
// there), plus a folder with `node` so `#!/usr/bin/env node` scripts still work.
let safePath = null;
function agentFreePath() {
  if (safePath !== null) return safePath;
  const nodeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-node-')));
  fs.symlinkSync(process.execPath, path.join(nodeDir, 'node'));
  const has = (d, n) => { try { fs.accessSync(path.join(d, n), fs.constants.X_OK); return true; } catch { return false; } };
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter((d) => d && !has(d, 'claude') && !has(d, 'codex'));
  safePath = [nodeDir, ...dirs].join(path.delimiter);
  return safePath;
}

// An environment that can never touch the real ~/.trif, browser folders or coding agents.
function testEnv(home, extra = {}) {
  return {
    PATH: agentFreePath(),
    HOME: path.join(home, 'fakehome'),
    TRIF_HOME: home,
    TRIF_DEFAULT_AGENT_DIRS: '',
    TRIF_UPDATE_DELAY: '2000000000', // no update check over the network during a test
    TRIF_NO_LAUNCHCTL: '1', // setup --browser safari writes the bridge's agent but doesn't start it
    TRIF_BOX_ROOT: path.join(home, 'boxes'), // agent runs' mailboxes (runs.js boxRoot)
    // Never the real Keychain (lib/keyring.js): a tool that isn't there, unless a test brings a fake one.
    TRIF_KEYCHAIN_BIN: path.join(home, 'no-keychain', 'security'),
    ...extra,
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, { timeout = 5000, interval = 25, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${message}`);
    await sleep(interval);
  }
}

class FakeExtension {
  constructor({ home, env = {} }) {
    this.home = home;
    this.messages = [];      // every message received from the host
    this.badFrames = [];     // anything that wasn't valid framing/JSON
    this.handlers = {};      // cmd -> (args, msg) => result | Promise<result>; throw to answer ok:false
    this.autoRespond = true;
    this.waiters = [];
    this.child = spawn(process.execPath, [HOST_JS, 'chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/'], {
      env: testEnv(home, env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => { this.stderr += d; });
    const decoder = new Decoder((m) => this._onMessage(m), (e) => this.badFrames.push(e.message));
    this.child.stdout.on('data', (d) => decoder.push(d));
    this.exited = new Promise((resolve) => this.child.on('exit', (code, signal) => resolve({ code, signal })));
  }

  get sock() { return path.join(this.home, 'helper.sock'); }

  // This host's own socket, served whether or not it owns helper.sock (helper/lib/helpers.js).
  get ownSock() { return path.join(this.home, `helper-${this.child.pid}.sock`); }

  send(msg) { this.child.stdin.write(encode(msg)); }

  hello({ userScripts = true, version = '0.1.0', chrome = '140.0.0.0', browser, installId } = {}) {
    this.send({ type: 'hello', version, userScripts, chrome, ...(browser ? { browser } : {}), ...(installId ? { installId } : {}) });
  }

  _onMessage(msg) {
    this.messages.push(msg);
    this.waiters = this.waiters.filter((w) => {
      if (w.pred(msg)) { clearTimeout(w.timer); w.resolve(msg); return false; }
      return true;
    });
    if (msg.type === 'request' && this.autoRespond) this._answer(msg);
  }

  async _answer(msg) {
    const h = this.handlers[msg.cmd];
    if (!h) return; // no handler: never answer (lets tests exercise timeouts)
    try {
      const result = await h(msg.args, msg);
      this.send({ type: 'response', id: msg.id, ok: true, result });
    } catch (e) {
      this.send({ type: 'response', id: msg.id, ok: false, error: e.message });
    }
  }

  // Resolve with the next message (including already-received ones after index `since`) matching pred.
  next(pred, { timeout = 5000, since = 0 } = {}) {
    const found = this.messages.slice(since).find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`fake extension: no matching message within ${timeout}ms`));
      }, timeout);
      this.waiters.push(w);
    });
  }

  // Wait for a {type:"mods"} message received after `since` whose mods satisfy pred; resolves the mods array.
  async nextMods(pred = () => true, opts = {}) {
    const msg = await this.next((m) => m.type === 'mods' && pred(m.mods), opts);
    return msg.mods;
  }

  lastMods() {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].type === 'mods') return this.messages[i].mods;
    return null;
  }

  async waitForSocket(timeout = 5000, sock = this.sock) {
    const net = require('net');
    await waitFor(() => new Promise((resolve) => {
      const s = net.connect(sock);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    }), { timeout, message: 'helper socket' });
  }

  // Close stdin like Chrome does on disconnect; resolves with the exit status.
  async close(timeout = 5000) {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.stdin.end();
      const t = setTimeout(() => this.child.kill('SIGKILL'), timeout);
      const r = await this.exited;
      clearTimeout(t);
      return r;
    }
    return this.exited;
  }
}

// Run the CLI; resolves { code, stdout, stderr } (never rejects on non-zero exit).
function runCli(args, { home, env = {}, input, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI_JS, ...args], {
      env: testEnv(home, env), timeout, maxBuffer: 64 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function writeMod(home, site, name, code) {
  const dir = path.join(home, 'sites', site);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return file;
}

module.exports = { FakeExtension, runCli, writeMod, tempDir, privDir, testEnv, waitFor, sleep, REPO, HOST_JS, CLI_JS };
