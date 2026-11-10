'use strict';
// `trif doctor`: check every link in the chain and print a concrete fix for each failure.

const fs = require('fs');
const path = require('path');
const { envVar } = require('./env');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { browserTable, browsersSetUp, manifestFiles, safariAgentPlist, legacySafariAgentPlist, legacySafariAgentLoaded, LEGACY_SAFARI_AGENT_LABEL } = require('./browsers');
const { request } = require('./client');
const { listHelpers, describeHelper } = require('./helpers');
const { scanMods, planMods, MAX_MOD_BYTES, MAX_MODS_BYTES } = require('./mods');
const { isExecutable } = require('./setup');
const { firefoxAddonUrl } = require('./update');

const EXT_URL = `chrome://extensions/?id=${P.EXTENSION_ID}`;

function parseWrapper(text) {
  const m = text.match(/exec\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const un = (s) => s.replace(/\\(.)/g, '$1');
  return { node: un(m[1]), script: un(m[2]) };
}

function readVersion(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

// (The folder itself counts; real paths, case as the volume does: pathcheck.js.)
function isInside(child, parent) {
  return require('./pathcheck').isInside(child, parent, { orEqual: true });
}

/**
 * Is the host wrapper's script a sensible one? Copy installs run <home>/app/helper/host.js (whichever
 * copy of the CLI is asking, e.g. `npx timsrobot doctor`); link installs run this checkout's host.js.
 * Returns null when fine, else { status, title, fix? }.
 */
function checkWrapperScript(script, ws) {
  const s = path.resolve(script);
  const appHost = path.join(ws.appDir, 'helper', 'host.js');
  if (s === appHost) {
    const v = readVersion(ws.appDir);
    if (v && v !== P.VERSION) {
      return {
        status: 'warn',
        title: `the installed copy in ${ws.appDir} is v${v}, but this trif is v${P.VERSION}`,
        fix: `to install v${P.VERSION}, run: node ${P.CLI_JS} setup --copy`,
      };
    }
    return null;
  }
  if (s === P.HOST_JS) return null;
  if (s.includes(`${path.sep}_npx${path.sep}`)) {
    return { status: 'warn', title: `host wrapper runs ${script}, inside npm's npx cache, which npm may delete` };
  }
  return { status: 'warn', title: `host wrapper runs ${script}, not this copy (${P.HOST_JS})` };
}

const SAFARI_PORT = require('../safari-bridge').PORT;

/** "1 mod", "14 mods". */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What to do when the helper isn't running, for the browsers set up (their native host manifests, or
 * Safari's bridge): the browser starts the helper, so each needs TRIF installed and turned on. One
 * browser: its steps in full. Several: a short line each. None known (an agent run can't see them):
 * Chrome's, the usual case.
 * browsers: { chromium: [labels], firefox, safari, extensionDir } -> lines
 */
function helperDownFix({ chromium = [], firefox = false, safari = false, extensionDir }) {
  const loadUnpacked = `Load unpacked from ${extensionDir}; its ID must be ${P.EXTENSION_ID}`;
  const several = (chromium.length ? 1 : 0) + (firefox ? 1 : 0) + (safari ? 1 : 0) > 1;
  if (several) {
    return [
      ...(chromium.length ? [`${chromium.join(' / ')}: check the TRIF extension is installed and turned on at ${EXT_URL} (${loadUnpacked}).`] : []),
      ...(firefox ? [`Firefox: install the TRIF add-on (open ${firefoxAddonUrl() || 'the signed trif-firefox.xpi'} in Firefox) and check it's on in about:addons; restart Firefox if it was open during setup.`] : []),
      ...(safari ? ['Safari: open TRIF.app once, turn TRIF on in Safari → Settings → Extensions, and check the Safari bridge above is running.'] : []),
      'The helper runs while one of them is open with TRIF turned on.',
    ];
  }
  if (firefox) {
    return [
      `install the TRIF add-on: open ${firefoxAddonUrl() || 'the signed trif-firefox.xpi'} in Firefox and click Add.`,
      'Installed already? Check it\'s turned on in about:addons, and restart Firefox if it was open during setup',
      '  (the helper only runs while Firefox is running with the add-on).',
      'Still not running? about:debugging#/runtime/this-firefox → TRIF → Inspect shows its console: "No such',
      '  native application" means the manifest is missing or wrong (fix the manifest checks above).',
    ];
  }
  if (safari) {
    return [
      'open TRIF.app once (it adds the TRIF extension to Safari), then turn TRIF on in Safari → Settings →',
      '  Extensions and allow it on every website.',
      'The helper runs through the Safari bridge: check the Safari bridge check above.',
    ];
  }
  const name = chromium.length === 1 ? chromium[0] : 'Chrome';
  return [
    `install the TRIF extension and turn it on at ${EXT_URL}`,
    `  (${loadUnpacked}), with ${name} open: the helper only runs while ${name} is running with TRIF.`,
    'Still not running? On that page, click "service worker" and look at the console: "Specified native messaging host not found"',
    '  means the manifest is missing or wrong (fix the manifest checks above, then reload the extension);',
    '  "Native host has exited" means the helper crashed: see the log below.',
  ];
}

/** Whether something accepts connections on 127.0.0.1:port. */
function portOpen(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = require('net').connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
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
  // From a git checkout, point at its CLI; otherwise npx fetches TRIF again if the install is broken.
  const setupFix = P.isGitCheckout()
    ? 'run: trif setup   (or: node ' + P.CLI_JS + ' setup)'
    : 'run: npx timsrobot setup   (or: trif setup)';
  let installRoot = P.REPO_ROOT; // where the wrapper's files are: its extension/ is what Chrome should load

  // Node
  const major = nodeMajor(process.version);
  if (major >= 18) add('ok', `Node ${process.version}`);
  else add('fail', `Node ${process.version} is too old (TRIF needs Node 18 or newer)`, 'install a current Node from https://nodejs.org or with your package manager, then run trif setup again');

  // Workspace
  if (fs.existsSync(ws.home) && fs.existsSync(ws.modsDir)) add('ok', `workspace ${ws.home}`);
  else add('fail', `workspace ${ws.home} is missing${fs.existsSync(ws.home) ? ` its mods folder ${ws.modsDir}` : ''}`, setupFix);
  if (ws.configError) add('fail', ws.configError, `fix or delete ${ws.configFile}`);
  // The private folder (settings, logs, screenshots): never readable by side-panel runs, so nothing of it
  // may be left in the workspace, which runs may read (see "Run scope" in docs/PROTOCOL.md).
  if (ws.privateError) add('warn', ws.privateError);
  if (!envVar('RUN_BOX')) {
    const left = require('./migrate').privateLeftovers(ws.home);
    if (left.length) add('warn', `TRIF's private files are still in the workspace, where side-panel runs can read them: ${left.map((f) => path.relative(ws.home, f)).join(', ')}`, `${setupFix} (it moves them to ${ws.private})`);
    else if (fs.existsSync(ws.private)) add('ok', `private folder ${ws.private} (settings, logs, screenshots; side-panel runs can't read it)`);
  }
  // A workspace moved from ~/.webmods (before 0.2.0, when TRIF was called WebMods): Chrome may load the
  // extension from ~/.webmods/app/extension, and PATHs may name ~/.webmods/bin, so the link must stay.
  const legacy = P.legacyHome();
  // A side-panel run's sandbox hides the home folder, ~/.webmods included, so the run can't see the link:
  // say it wasn't checked rather than warn that it's gone.
  const inRun = !!envVar('RUN_BOX');
  const moved = fs.existsSync(path.join(ws.home, require('./migrate').MARKER));
  if (inRun && moved) {
    add('info', `inside a side-panel agent run: the link ${legacy} -> ${ws.home} isn't checked (the run can't see it; run trif doctor in a terminal for that)`);
  } else if (!inRun && path.resolve(ws.home) === path.resolve(P.defaultHome()) && !opts.home) {
    let link = null;
    try { link = fs.lstatSync(legacy); } catch { /* none */ }
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
    if (link && link.isSymbolicLink() && real(legacy) === real(ws.home)) add('ok', `${legacy} links to ${ws.home} (from before 0.2.0; keep it)`);
    else if (link && link.isDirectory()) add('warn', `${legacy} is still a folder of its own (TRIF uses ${ws.home} since 0.2.0)`, `${setupFix} (it moves what's in ${legacy} into ${ws.home})`);
    else if (!link && moved) {
      add('warn', `${legacy} is gone, but this workspace was moved from there: a browser may still load TRIF from ${path.join(legacy, 'app', 'extension')}`,
        `put the link back: ln -s .trif ${legacy}`);
    }
  }
  if (fs.existsSync(ws.home)) {
    if (fs.existsSync(path.join(ws.home, 'AGENTS.md'))) add('ok', 'AGENTS.md present');
    else add('warn', `${path.join(ws.home, 'AGENTS.md')} is missing (agents won't know how to write mods)`, setupFix);
    // Written by setup since the side panel arrived; without it, side-panel runs of Claude Code can't edit or run anything.
    if (fs.existsSync(path.join(ws.home, '.claude', 'settings.json'))) add('ok', 'agent permissions present');
    else add('warn', `${path.join(ws.home, '.claude', 'settings.json')} is missing (side-panel agents can't edit mods or run trif)`, setupFix);
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
      add('fail', `host wrapper ${ws.hostWrapper} doesn't look like a TRIF wrapper`, setupFix);
    } else if (!isExecutable(w.node)) {
      add('fail', `host wrapper points at node ${w.node}, which doesn't exist (Node moved or was upgraded?)`, setupFix);
    } else if (!fs.existsSync(w.script)) {
      add('fail', `host wrapper points at ${w.script}, which doesn't exist (moved or deleted?)`, setupFix);
    } else {
      const r = spawnSync(w.node, ['--version'], { encoding: 'utf8', timeout: 5000 });
      const v = (r.stdout || '').trim();
      if (nodeMajor(v) < 18) {
        add('fail', `host wrapper's node ${w.node} is ${v || 'not runnable'}; TRIF needs Node 18+`, 'install a current Node, then ' + setupFix);
      } else {
        wrapperOk = true;
        installRoot = path.resolve(w.script, '..', '..');
        const copy = isInside(path.resolve(w.script), ws.appDir);
        add('ok', `host wrapper ${ws.hostWrapper} -> ${w.script} (${copy ? 'installed copy' : 'linked'}, node ${v})`);
        const problem = checkWrapperScript(w.script, ws);
        if (problem) add(problem.status, problem.title, problem.fix || setupFix);
      }
    }
  }

  // The browsers' setup lives outside the workspace (~/Library…), which a side-panel agent run's sandbox
  // can't read: there, say so instead of failing on it. The user's terminal checks it.
  let manifestsOk = 0;
  const setUp = { chromium: [], firefox: false, safari: false }; // the browsers set up, for helperDownFix
  if (inRun) {
    add('ok', "inside a side-panel agent run: the browsers' setup files aren't checked (the run can't read them; run trif doctor in a terminal for those)");
  } else {
    // Native host manifests
    let targets;
    let withManifest;
    if (opts.nativeDir) {
      targets = [{ key: 'custom', label: opts.nativeDir, nativeDirs: [path.resolve(opts.nativeDir)], detected: true }];
      withManifest = targets.filter((t) => fs.existsSync(manifestFiles(t)[0]));
    } else {
      const table = browserTable();
      // Set up: a manifest in one of its folders (browsers.js browsersSetUp: Chrome's folder alone, written
      // for Arc, isn't Chrome set up). Else, detected: setup would set it up, and its failure is above.
      withManifest = browsersSetUp(table).filter((b) => !b.safari);
      targets = table.filter((b) => !b.safari && (b.detected || withManifest.includes(b)));
    }
    const safari = !opts.nativeDir && browserTable().find((b) => b.safari && b.detected);
    for (const t of withManifest.length ? withManifest : targets) {
      if (t.firefox) setUp.firefox = true;
      else if (t.key !== 'custom' && !setUp.chromium.includes(t.label)) setUp.chromium.push(t.label);
    }
    setUp.safari = !!safari;
    if (!targets.length && !safari) {
      add('fail', 'no browser profile found (looked for Chrome, Chromium, Brave, Edge, Arc, Firefox)', 'install and open Google Chrome or Firefox once, then ' + setupFix);
    }
    const expectedOrigins = P.extensionOrigins(ws.config);
    const badIds = P.extensionIds(ws.config).invalid;
    if (badIds.length) {
      add('warn', `config.json extensionIds has entries that aren't extension IDs: ${badIds.map((x) => JSON.stringify(x)).join(', ')}`,
        `fix them (32 letters a-p each) in ${path.join(ws.home, 'config.json')}`);
    }
    for (const t of targets) {
      // The manifest the browser reads (Arc: Chrome's folder's; setup also writes one in its own).
      const file = manifestFiles(t)[0];
      const fix = `${setupFix}${t.key !== 'custom' ? ` --browser ${t.key}` : ''}`;
      if (!fs.existsSync(file)) {
        // A browser whose profile folder is there but which setup never did, while others are set up: one
        // installed (or first opened) after setup, which updates don't add (they keep the browsers set up),
        // one setup was told to leave out (--browser), or one long gone that left its folder. Not a problem
        // unless TRIF is meant to work in it. (Set up, but not where it reads: Arc, by an older setup.)
        const elsewhere = withManifest.includes(t);
        if ((withManifest.length || safari) && t.key !== 'custom' && !elsewhere) add('info', `${t.label}: not set up (only needed if you use TRIF in ${t.label})`, fix);
        else add('fail', `${t.label}: native host manifest missing (${file})${elsewhere ? `, where ${t.label} reads it` : ''}`, fix);
        continue;
      }
      let m;
      try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
        add('fail', `${t.label}: native host manifest is not valid JSON (${file})`, fix); continue;
      }
      const problems = [];
      if (m.name !== P.HOST_NAME) problems.push(`name is ${JSON.stringify(m.name)}, expected "${P.HOST_NAME}"`);
      if (m.type !== 'stdio') problems.push('type is not "stdio"');
      if (m.path !== ws.hostWrapper) problems.push(`path is ${JSON.stringify(m.path)}, expected ${ws.hostWrapper}`);
      else if (!fs.existsSync(m.path)) problems.push(`path ${m.path} doesn't exist`);
      if (t.firefox) {
        const ids = Array.isArray(m.allowed_extensions) ? m.allowed_extensions : [];
        if (!ids.includes(P.FIREFOX_EXTENSION_ID)) problems.push(`allowed_extensions doesn't include ${P.FIREFOX_EXTENSION_ID}`);
      } else {
        // Every TRIF extension ID (dev, Web Store, config.json extensionIds) must be allowed.
        const origins = Array.isArray(m.allowed_origins) ? m.allowed_origins : [];
        const missing = expectedOrigins.filter((o) => !origins.includes(o));
        if (missing.length) problems.push(`allowed_origins doesn't include ${missing.join(', ')}`);
      }
      if (problems.length) add('fail', `${t.label}: native host manifest ${file}: ${problems.join('; ')}`, fix);
      else { manifestsOk++; add('ok', `${t.label}: native host manifest`); }
    }

    // Safari: its bridge, instead of a native host manifest
    if (safari) {
      const plist = safariAgentPlist();
      let text = '';
    try { text = fs.readFileSync(plist, 'utf8'); } catch { /* unreadable: reported below as nothing to run */ }
    const args = [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      const bridgeJs = args.find((a) => a.endsWith('safari-bridge.js'));
      const fix = `${setupFix} --browser safari`;
      if (!bridgeJs || !fs.existsSync(bridgeJs)) add('fail', `Safari: the bridge's login item (${plist}) runs ${bridgeJs || 'nothing'}, which doesn't exist`, fix);
      else if (await portOpen(SAFARI_PORT)) add('ok', `Safari: the bridge is running (127.0.0.1:${SAFARI_PORT})`);
      else add('fail', `Safari: the bridge isn't running (nothing on 127.0.0.1:${SAFARI_PORT})`, `${fix}   (errors: ${ws.safariBridgeErr})`);
      if (!fs.existsSync(ws.safariToken)) add('fail', `Safari: the bridge's key ${ws.safariToken} is missing, so Safari can't connect`, fix);
    }
    // The bridge from before 0.2.0: wants the same port, and writes its errors into the workspace.
    if (!opts.nativeDir) {
      const legacyLoaded = legacySafariAgentLoaded();
      if (legacyLoaded || fs.existsSync(legacySafariAgentPlist())) {
        add('warn', `Safari: the bridge from before 0.2.0 (${LEGACY_SAFARI_AGENT_LABEL}) is still ${legacyLoaded ? 'running' : 'installed'}; it wants the new bridge's port and writes its errors into the workspace`,
          `${setupFix} --browser safari   (replaces it)`);
      }
    }
  }

  // CLI on PATH
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const onPath = pathDirs.some((d) => isExecutable(path.join(d, 'trif')));
  if (onPath) add('ok', '`trif` is on PATH');
  else add('warn', '`trif` is not on your PATH', `add ${ws.bin} to PATH: echo 'export PATH="${ws.bin}:$PATH"' >> ~/.zshrc  (then open a new terminal)`);

  // Helper / extension
  let info = null;
  try {
    // Inside an agent run, the helper that started it (see lib/helpers.js).
    const sock = envVar('SOCK') && !opts.home ? envVar('SOCK') : ws.sock;
    info = await request(sock, 'ping', {}, 3000);
  } catch (e) {
    const stale = fs.existsSync(ws.sock);
    const fixLines = helperDownFix({ ...setUp, extensionDir: path.join(installRoot, 'extension') });
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
      add('fail', 'the helper is running but the extension never said hello', `reload the extension at ${EXT_URL} (or restart Chrome) and run trif doctor again; check ${ws.log}`);
    } else {
      const firefox = info.extension.browser === 'Firefox';
      add('ok', `extension v${info.extension.version} on ${info.extension.browser || 'Chrome'} ${info.extension.chrome}`);
      if (info.extension.userScripts) add('ok', firefox ? 'user scripts are allowed' : '"Allow User Scripts" is on');
      else if (firefox) add('fail', 'user scripts aren\'t allowed, so mods can\'t run', 'click the TRIF toolbar button in Firefox, then "Allow user scripts", then reload your tabs');
      else add('fail', '"Allow User Scripts" is OFF, so mods can\'t run', `open ${EXT_URL}, turn on "Allow User Scripts", then reload your tabs`);
    }
    for (const e of (info.modsApplied && info.modsApplied.errors) || []) {
      add('fail', `extension couldn't register ${e.id}: ${e.error}`, 'fix the mod\'s @match/@exclude patterns (see AGENTS.md)');
    }
    // Each connected browser has its own helper; `trif` uses this one unless told --browser.
    const others = envVar('RUN_TOKEN') ? [] : (await listHelpers(ws.home)).filter((h) => h.pid !== info.pid);
    if (others.length) add('ok', `also connected: ${others.map(describeHelper).join(', ')}`, 'trif commands go to the default browser; add --browser <name|pid> to use another');
  }

  // Mods
  const { mods, problems, warnings } = scanMods(ws.modsDir);
  const plan = planMods(mods);
  const modProblems = [...problems, ...plan.errors];
  // The helper also leaves mods out for an extension too old to take more than 1 MB of them (limit 'extension').
  if (info) for (const e of info.modErrors || []) if (e.limit === 'extension') modProblems.push(e);
  const mb = (n) => `${n / (1024 * 1024)} MB`;
  const advice = {
    mod: `make the mod smaller: keep sounds, pictures and other big data out of its code (a mod can be up to ${mb(MAX_MOD_BYTES)})`,
    total: `remove mods you don't use, or make big ones smaller: all of them together can be up to ${mb(MAX_MODS_BYTES)}`,
    extension: info?.extension?.browser === 'Firefox' ? 'update the add-on: about:addons, the gear, Check for Updates'
      : info?.extension?.browser === 'Safari' ? 'build and open TRIF.app from this version' : `update the extension: reload TRIF on ${EXT_URL}`,
  };
  if (fs.existsSync(ws.modsDir)) {
    if (!modProblems.length) add('ok', `${plural(mods.length, 'mod')} in ${ws.modsDir}`);
    for (const p of modProblems) add('fail', `mod ${p.id}: ${p.error}`, advice[p.limit] || 'check the file');
    for (const w of warnings) add('warn', `mod ${w.id}: ${w.warning}`, 'fix the header (see AGENTS.md)');
  }

  // Coding agents for the side panel (optional: mods work without them). Inside a run they live outside
  // what its sandbox can read, and the run itself shows one works.
  if (inRun) return { ok: !checks.some((c) => c.status === 'fail'), checks };
  const agents = require('./agents');
  const listed = agents.listAgents(ws);
  const env = agents.agentEnv(ws);
  const termDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const { findExecutable } = require('./agents/util');
  // Each available agent's login (a saved API key counts: runs use it through a key proxy), first: an
  // agent that isn't logged in is only a warning when it's the default one, or the default can't run
  // either; otherwise it's only needed if picked in the side panel.
  const keys = require('./agentkeys');
  const logins = new Map();
  for (const a of listed.agents) {
    const adapter = agents.getAdapter(a.id);
    if (!a.available || adapter.doctorChecks || !adapter.loginStatus) continue;
    if (keys.AGENT_KEYS[a.id] && (await keys.hasAgentKey(a.id, { config: ws.config })).stored) continue;
    logins.set(a.id, adapter.loginStatus({ path: a.path, env, cwd: fs.existsSync(ws.home) ? ws.home : undefined }));
  }
  const def = listed.agents.find((a) => a.id === listed.default);
  const defaultReady = !!def?.available && logins.get(def.id)?.loggedIn !== false;
  for (const a of listed.agents) {
    const adapter = agents.getAdapter(a.id);
    if (adapter.doctorChecks) continue; // the open model, below
    const label = `${a.name}${adapter.note ? ` (${adapter.note})` : ''}`;
    const another = listed.agents.some((x) => x.available);
    if (!a.available) {
      const here = findExecutable(adapter.binary, termDirs);
      if (here) add('warn', `${label} is at ${here}, but the helper won't find it there`, 'run trif setup in this terminal (it records your PATH for the helper)');
      else if (another) add('info', `${label}: not found (optional)`);
      else add('warn', `${label}: not found (the side panel needs a coding agent)`, adapter.missing);
      continue;
    }
    add('ok', `${label} ${a.version || ''} (${a.path})`.replace(/ {2,}/g, ' '));
    const st = logins.get(a.id);
    if (st?.loggedIn === true) add('ok', `${a.name} is logged in${st.detail ? ` (${st.detail})` : ''}`);
    else if (st?.loggedIn === false && a.id !== listed.default && defaultReady) add('info', `${a.name} isn't logged in (only needed if you pick it in the side panel)`, adapter.loginFix);
    else if (st?.loggedIn === false) add('warn', `${a.name} isn't logged in, so the side panel can't use it`, adapter.loginFix);
  }
  // Open models through Codex (experimental, agents/codex-oss.js): set up in config.json `openModel`?
  const oss = listed.agents.find((a) => a.id === 'codex-oss');
  if (oss && !oss.available && ws.config.openModel) add('warn', 'Open model: set up, but it runs through Codex, which isn\'t available', agents.getAdapter('codex-oss').missing);
  else if (oss && oss.available) for (const c of await agents.getAdapter('codex-oss').doctorChecks(ws, { codexVersion: oss.version })) add(c.status, c.title, c.fix);
  // API keys for plain Claude Code / Codex runs: in the keyring, or still in config.json (agentkeys.js).
  for (const c of await require('./agentkeys').doctorChecks(ws)) add(c.status, c.title, c.fix);
  // API keys exported in the shell profile: readable by every same-user process (sysctl KERN_PROCARGS2),
  // an agent's sandboxed commands included. Only their presence is checked.
  const keyVars = agents.getAdapter('codex-oss').keyVarsCheck(process.env);
  if (keyVars) add(keyVars.status, keyVars.title, keyVars.fix);

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
  const warns = checks.filter((c) => c.status === 'warn').length;
  out.push(!ok ? `${plural(fails, 'problem')} found. Fix them in order (top first) and run trif doctor again.`
    : warns ? `No problems, but ${warns} warning${warns === 1 ? '' : 's'} above.` : 'All good.');
  return out.join('\n');
}

module.exports = { doctor, formatDoctor, parseWrapper, checkWrapperScript, helperDownFix };
