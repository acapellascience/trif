'use strict';
// A fake WebMods extension for helper tests: spawns helper/host.js like Chrome would and speaks
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

// An environment that can never touch the real ~/.webmods or browser folders.
function testEnv(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(home, 'fakehome'),
    WEBMODS_HOME: home,
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

  send(msg) { this.child.stdin.write(encode(msg)); }

  hello({ userScripts = true, version = '0.1.0', chrome = '140.0.0.0' } = {}) {
    this.send({ type: 'hello', version, userScripts, chrome });
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

  async waitForSocket(timeout = 5000) {
    const net = require('net');
    await waitFor(() => new Promise((resolve) => {
      const s = net.connect(this.sock);
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

module.exports = { FakeExtension, runCli, writeMod, tempDir, testEnv, waitFor, sleep, REPO, HOST_JS, CLI_JS };
