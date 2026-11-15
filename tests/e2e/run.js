#!/usr/bin/env node
'use strict';
// TRIF's end-to-end browser suite (opt-in; not part of `npm test`). See docs/TESTING.md.
//
//   node tests/e2e/run.js [firefox|chrome|all] [--agent] [--codex] [--oss] [--upgrade-from <tgz>] [--skip-fresh]
//                         [--work <dir>] [--out <dir>] [--headful] [--claude-model haiku] [--codex-model M]
//                         [--oss-model qwen/qwen3-coder]
// --guidance: the same two requests with main's AGENTS.md and this checkout's, a real Claude Code run each
// (--guidance-repeats N); results in guidance.json. See docs/TESTING.md.
// --oss: open-model (codex-oss) runs through OpenRouter, with the key already saved in your Keychain (the
// panel's API key field, or `trif agent open-model --provider openrouter --set-key`); skipped without one.
// The key is never read from the environment, shown or logged.
//
// Each scenario packs this checkout (npm pack), installs it into a scratch home, starts a throwaway
// browser profile connected to that home's helper, and checks the chain end to end. Nothing in your
// real browsers, profiles, ~/.trif or native host manifests is read or written (the suite checks the
// manifests and configs are unchanged at the end).

const fs = require('fs');
const path = require('path');
const { Results, killMatching } = require('./lib/util');
const { startServers } = require('./lib/server');
const I = require('./lib/install');
const { run } = require('./lib/util');
const { Scenario } = require('./scenario');

function parseArgs(argv) {
  const o = { browsers: [], agent: false, codex: false, upgradeFrom: [], skipFresh: false, headless: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === 'firefox' || a === 'chrome') o.browsers.push(a);
    else if (a === 'all') o.browsers.push('firefox', 'chrome');
    else if (a === '--agent') o.agent = true;
    else if (a === '--codex') o.codex = true;
    else if (a === '--oss') o.oss = true;
    else if (a === '--guidance') o.guidance = true;
    else if (a === '--guidance-repeats') o.guidanceRepeats = Number(val());
    else if (a === '--oss-model') o.ossModel = val();
    else if (a === '--upgrade-from') o.upgradeFrom.push(path.resolve(val()));
    else if (a === '--skip-fresh') o.skipFresh = true;
    else if (a === '--work') o.work = path.resolve(val());
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--headful') o.headless = false;
    else if (a === '--claude-model') o.claudeModel = val();
    else if (a === '--codex-model') o.codexModel = val();
    else if (a === '-h' || a === '--help') { o.help = true; }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.browsers.length) o.browsers.push('firefox');
  o.browsers = [...new Set(o.browsers)];
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (o.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  for (const t of o.upgradeFrom) if (!fs.existsSync(t)) { console.error(`no such tarball: ${t}`); return 2; }
  // Short paths: the helper binds unix sockets in the scratch home (macOS allows ~104 bytes).
  const work = o.work || `/tmp/trif-e2e-${process.getuid()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = o.out ? path.join(o.out, stamp) : path.join(work, 'results', stamp);
  fs.mkdirSync(work, { recursive: true });
  const results = new Results(out);
  console.log(`TRIF e2e: ${o.browsers.join(', ')}${o.agent ? ' + Claude Code agent runs' : ''}${o.codex ? ' + Codex agent runs' : ''}${o.oss ? ' + open-model runs (OpenRouter)' : ''}`);
  console.log(`work ${work}\nresults ${out}`);

  const t0 = Date.now();
  let servers;
  const cleanup = async () => { if (servers) await servers.close().catch(() => {}); await killMatching(work + '/'); };
  process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
  try {
    results.setGroup('package');
    let tgz;
    await results.check('npm pack this checkout', () => { tgz = I.packRepo(path.join(work, 'pack')); return path.basename(tgz); });
    if (!tgz) return 1;
    // The Firefox add-on: built from this checkout, as release.js does (the npm package has the Chrome manifest).
    const fxDir = path.join(I.REPO, 'dist', 'firefox');
    if (o.browsers.includes('firefox')) {
      await results.check('build the Firefox add-on', () => {
        const r = run(process.execPath, [path.join(I.REPO, 'scripts', 'build-extension.js'), 'firefox'], { cwd: I.REPO });
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
        return path.relative(I.REPO, fxDir);
      });
    }
    servers = await startServers(path.join(work, 'certs'));
    results.log(`servers: http://127.0.0.1:${servers.port} https://x.com:${servers.tlsPort}`);

    for (const browser of o.browsers) {
      const kinds = [...(o.skipFresh ? [] : [{ kind: 'fresh' }]), ...o.upgradeFrom.map((t) => ({ kind: 'upgrade', oldTgz: t }))];
      let agentDone = false;
      for (const k of kinds) {
        const t = Date.now();
        const name = k.kind === 'fresh' ? 'fresh' : `up-${path.basename(k.oldTgz).replace(/\.tgz$/, '').replace(/[^\w.-]/g, '')}`;
        const sc = new Scenario({
          browser, kind: k.kind, oldTgz: k.oldTgz, newTgz: tgz, results, servers,
          work: path.join(work, `${browser === 'firefox' ? 'ff' : 'cr'}-${name}`.slice(0, 24)),
          agent: o.agent && !agentDone, codex: o.codex && !agentDone, oss: o.oss && !agentDone, claudeModel: o.claudeModel, codexModel: o.codexModel,
          ossModel: o.ossModel, guidance: o.guidance && !agentDone, guidanceRepeats: o.guidanceRepeats,
          headless: o.headless, extensionDirFirefox: fxDir,
        });
        agentDone = true; // agent runs once per browser, in its first scenario
        servers.requests.length = 0; // (each scenario's checks read what the servers saw: only its own)
        await sc.run();
        console.log(`  (${browser} ${k.kind}: ${((Date.now() - t) / 1000).toFixed(0)} s)`);
      }
    }
  } finally {
    await cleanup();
  }
  const { text, failed } = results.summary();
  console.log(text);
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots and logs in ${out}`);
  return failed ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
