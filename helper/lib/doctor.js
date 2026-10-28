'use strict';
// `webmods doctor`: check every link in the chain and print a concrete fix for each failure.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { browserTable } = require('./browsers');
const { request } = require('./client');
const { scanMods, planModsMessage } = require('./mods');
const { isExecutable } = require('./setup');

const EXT_URL = `chrome://extensions/?id=${P.EXTENSION_ID}`;

function parseWrapper(text) {
  const m = text.match(/exec\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const un = (s) => s.replace(/\\(.)/g, '$1');
  return { node: un(m[1]), script: un(m[2]) };
}

function nodeMajor(version) {
  const m = /^v?(\d+)/.exec(String(version).trim());
  return m ? Number(m[1]) : 0;
}

function tail(file, n) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.trimEnd().split('\n').slice(-n);
  } catch { return []; }
}

/** opts: { home, nativeDir } -> Promise<{ ok, checks: [{status, title, detail?, fix?}] }> */
async function doctor(opts = {}) {
  const ws = P.workspace(opts.home);
  const checks = [];
  const add = (status, title, fix, detail) => checks.push({ status, title, fix, detail });
  const setupFix = 'run: webmods setup   (or: node ' + P.CLI_JS + ' setup)';

  // Node
  const major = nodeMajor(process.version);
  if (major >= 18) add('ok', `Node ${process.version}`);
  else add('fail', `Node ${process.version} is too old (WebMods needs Node 18 or newer)`, 'install a current Node from https://nodejs.org or with your package manager, then run webmods setup again');

  // Workspace
  if (fs.existsSync(ws.home) && fs.existsSync(ws.modsDir)) add('ok', `workspace ${ws.home}`);
  else add('fail', `workspace ${ws.home} is missing${fs.existsSync(ws.home) ? ` its mods folder ${ws.modsDir}` : ''}`, setupFix);
  if (ws.configError) add('fail', ws.configError, `fix or delete ${path.join(ws.home, 'config.json')}`);
  if (fs.existsSync(ws.home)) {
    if (fs.existsSync(path.join(ws.home, 'AGENTS.md'))) add('ok', 'AGENTS.md present');
    else add('warn', `${path.join(ws.home, 'AGENTS.md')} is missing (agents won't know how to write mods)`, setupFix);
    // Written by setup since the side panel arrived; without it, side-panel runs of Claude Code can't edit or run anything.
    if (fs.existsSync(path.join(ws.home, '.claude', 'settings.json'))) add('ok', 'agent permissions present');
    else add('warn', `${path.join(ws.home, '.claude', 'settings.json')} is missing (side-panel agents can't edit mods or run webmods)`, setupFix);
  }

  // Host wrapper
  let wrapperOk = false;
  if (!fs.existsSync(ws.hostWrapper)) {
    add('fail', `host wrapper ${ws.hostWrapper} is missing`, setupFix);
  } else if (!isExecutable(ws.hostWrapper)) {
    add('fail', `host wrapper ${ws.hostWrapper} is not executable`, `chmod +x ${ws.hostWrapper}   (or ${setupFix})`);
  } else {
    const w = parseWrapper(fs.readFileSync(ws.hostWrapper, 'utf8'));
    if (!w) {
      add('fail', `host wrapper ${ws.hostWrapper} doesn't look like a WebMods wrapper`, setupFix);
    } else if (!isExecutable(w.node)) {
      add('fail', `host wrapper points at node ${w.node}, which doesn't exist (Node moved or was upgraded?)`, setupFix);
    } else if (!fs.existsSync(w.script)) {
      add('fail', `host wrapper points at ${w.script}, which doesn't exist (repo moved?)`, setupFix);
    } else {
      const r = spawnSync(w.node, ['--version'], { encoding: 'utf8', timeout: 5000 });
      const v = (r.stdout || '').trim();
      if (nodeMajor(v) < 18) {
        add('fail', `host wrapper's node ${w.node} is ${v || 'not runnable'}; WebMods needs Node 18+`, 'install a current Node, then ' + setupFix);
      } else {
        wrapperOk = true;
        add('ok', `host wrapper ${ws.hostWrapper} (node ${v})`);
        if (path.resolve(w.script) !== P.HOST_JS) {
          add('warn', `host wrapper runs ${w.script}, not this copy (${P.HOST_JS})`, setupFix);
        }
      }
    }
  }

  // Native host manifests
  let targets;
  if (opts.nativeDir) {
    targets = [{ key: 'custom', label: opts.nativeDir, nativeDir: path.resolve(opts.nativeDir), detected: true }];
  } else {
    targets = browserTable().filter((b) => b.detected || fs.existsSync(path.join(b.nativeDir, `${P.HOST_NAME}.json`)));
  }
  if (!targets.length) {
    add('fail', 'no Chromium browser profile found (looked for Chrome, Chromium, Brave, Edge, Arc)', 'install and open Google Chrome once, then ' + setupFix);
  }
  let manifestsOk = 0;
  for (const t of targets) {
    const file = path.join(t.nativeDir, `${P.HOST_NAME}.json`);
    const fix = `${setupFix}${t.key !== 'custom' ? ` --browser ${t.key}` : ''}`;
    if (!fs.existsSync(file)) { add('fail', `${t.label}: native host manifest missing (${file})`, fix); continue; }
    let m;
    try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      add('fail', `${t.label}: native host manifest is not valid JSON (${file})`, fix); continue;
    }
    const problems = [];
    if (m.name !== P.HOST_NAME) problems.push(`name is ${JSON.stringify(m.name)}, expected "${P.HOST_NAME}"`);
    if (m.type !== 'stdio') problems.push('type is not "stdio"');
    if (m.path !== ws.hostWrapper) problems.push(`path is ${JSON.stringify(m.path)}, expected ${ws.hostWrapper}`);
    else if (!fs.existsSync(m.path)) problems.push(`path ${m.path} doesn't exist`);
    if (!Array.isArray(m.allowed_origins) || !m.allowed_origins.includes(P.EXTENSION_ORIGIN)) {
      problems.push(`allowed_origins doesn't include ${P.EXTENSION_ORIGIN}`);
    }
    if (problems.length) add('fail', `${t.label}: native host manifest ${file}: ${problems.join('; ')}`, fix);
    else { manifestsOk++; add('ok', `${t.label}: native host manifest`); }
  }

  // CLI on PATH
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const onPath = pathDirs.some((d) => isExecutable(path.join(d, 'webmods')));
  if (onPath) add('ok', '`webmods` is on PATH');
  else add('warn', '`webmods` is not on your PATH', `add ${ws.bin} to PATH: echo 'export PATH="${ws.bin}:$PATH"' >> ~/.zshrc  (then open a new terminal)`);

  // Helper / extension
  let info = null;
  try {
    info = await request(ws.sock, 'ping', {}, 3000);
  } catch (e) {
    const stale = fs.existsSync(ws.sock);
    const fixLines = [
      'open Chrome (the helper only runs while Chrome is running with the WebMods extension).',
      `If Chrome is open: check the extension is installed and enabled at ${EXT_URL}`,
      `  (Load unpacked from ${path.join(P.REPO_ROOT, 'extension')}; its ID must be ${P.EXTENSION_ID}).`,
      'On that page, click "service worker" and look at the console: "Specified native messaging host not found"',
      '  means the manifest is missing or wrong (fix the manifest checks above, then reload the extension);',
      '  "Native host has exited" means the helper crashed: see the log below.',
    ];
    if (!wrapperOk || !manifestsOk) fixLines.unshift('first fix the failures above, then:');
    add('fail',
      stale ? `helper isn't running (socket ${ws.sock} exists but nothing is listening)` : `helper isn't running (no socket at ${ws.sock})`,
      fixLines.join('\n'));
    const lines = tail(ws.log, 8);
    if (lines.length) checks[checks.length - 1].detail = `last lines of ${ws.log}:\n` + lines.join('\n');
  }
  if (info) {
    add('ok', `helper running (pid ${info.pid}, v${info.helper})`);
    if (!info.extension) {
      add('fail', 'the helper is running but the extension never said hello', `reload the extension at ${EXT_URL} (or restart Chrome) and run webmods doctor again; check ${ws.log}`);
    } else {
      add('ok', `extension v${info.extension.version} on Chrome ${info.extension.chrome}`);
      if (info.extension.userScripts) add('ok', '"Allow User Scripts" is on');
      else add('fail', '"Allow User Scripts" is OFF, so mods can\'t run', `open ${EXT_URL}, turn on "Allow User Scripts", then reload your tabs`);
    }
    for (const e of (info.modsApplied && info.modsApplied.errors) || []) {
      add('fail', `extension couldn't register ${e.id}: ${e.error}`, 'fix the mod\'s @match/@exclude patterns (see AGENTS.md)');
    }
  }

  // Mods
  const { mods, problems, warnings } = scanMods(ws.modsDir);
  const plan = planModsMessage(mods);
  const modProblems = [...problems, ...plan.errors];
  if (fs.existsSync(ws.modsDir)) {
    if (!modProblems.length) add('ok', `${mods.length} mod(s) in ${ws.modsDir}`);
    for (const p of modProblems) add('fail', `mod ${p.id}: ${p.error}`, p.error.includes('1 MB') ? 'make the mod smaller (move data out, or split it)' : 'check the file');
    for (const w of warnings) add('warn', `mod ${w.id}: ${w.warning}`, 'fix the header (see AGENTS.md)');
  }

  // Coding agents for the side panel (optional: mods work without them).
  const agents = require('./agents');
  const listed = agents.listAgents(ws);
  const env = agents.agentEnv(ws);
  const termDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const { findExecutable } = require('./agents/util');
  for (const a of listed.agents) {
    const adapter = agents.getAdapter(a.id);
    const label = `${a.name}${adapter.note ? ` (${adapter.note})` : ''}`;
    const another = listed.agents.some((x) => x.available);
    if (!a.available) {
      const here = findExecutable(adapter.binary, termDirs);
      if (here) add('warn', `${label} is at ${here}, but the helper won't find it there`, 'run webmods setup in this terminal (it records your PATH for the helper)');
      else if (another) add('info', `${label}: not found (optional)`);
      else add('warn', `${label}: not found (the side panel needs a coding agent)`, adapter.missing);
      continue;
    }
    add('ok', `${label} ${a.version || ''} (${a.path})`.replace(/ {2,}/g, ' '));
    if (adapter.loginStatus) {
      const st = adapter.loginStatus({ path: a.path, env, cwd: fs.existsSync(ws.home) ? ws.home : undefined });
      if (st.loggedIn === true) add('ok', `${a.name} is logged in${st.detail ? ` (${st.detail})` : ''}`);
      else if (st.loggedIn === false) add('warn', `${a.name} isn't logged in, so the side panel can't use it`, adapter.loginFix);
    }
  }

  return { ok: !checks.some((c) => c.status === 'fail'), checks };
}

function formatDoctor({ ok, checks }) {
  const tag = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', info: '-   ' };
  const out = [];
  for (const c of checks) {
    out.push(`${tag[c.status]}  ${c.title}`);
    if (c.fix) {
      const [first, ...rest] = c.fix.split('\n');
      out.push(`      fix: ${first}`);
      for (const r of rest) out.push(`           ${r}`);
    }
    if (c.detail) for (const d of c.detail.split('\n')) out.push(`      | ${d}`);
  }
  out.push('');
  const fails = checks.filter((c) => c.status === 'fail').length;
  out.push(ok ? 'All good.' : `${fails} problem(s) found. Fix them in order (top first) and run webmods doctor again.`);
  return out.join('\n');
}

module.exports = { doctor, formatDoctor, parseWrapper };
