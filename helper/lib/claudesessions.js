'use strict';
// A chat's Claude Code session across TRIF's two ways of running it (docs/WHOLE-BOX-PROGRESS.md step 5b,
// round 6's finding): runs in TRIF's full sandbox keep their sessions in TRIF's own config folder for Claude
// Code (<private>/agent-config/claude, wholebox.js), runs with the older protection (or with the setting off)
// in the user's own (~/.claude, or $CLAUDE_CONFIG_DIR). A chat that changes between them (the older
// protection chosen on the card, the setting switched mid-chat) would `--resume` a session its config
// folder doesn't have, or an old copy of it.
//
// Claude Code keeps a session as <config>/projects/<the working folder, escaped>/<id>.jsonl (and, for long
// tool output, a folder <id>/ beside it), and finds it by id under projects/ (2.1.319: claude.js afterRun).
// So before a resumed run, settle():
//   - the session is newest in the run's own folder (or only there): resume it, as now;
//   - it's newer in the user's folder and the run is boxed: copied into the box's folder (the box gets the
//     chat's earlier turns; nothing leaves the box);
//   - it's newer in the box's folder and the run isn't boxed: not resumed, a new session (the turns the box
//     wrote never reach the user's own Claude Code, which runs outside the box: a boxed run could have written
//     anything there). Whether to carry them over is Tim's call (For Tim, round 8).
//   - in neither: resumed as now (Claude Code says it can't find it: claude.js's error words).

const fs = require('fs');
const path = require('path');

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** {file, dir, mtimeMs} of the session `id` under <configDir>/projects/*, or null. */
function find(configDir, id) {
  if (!configDir || !ID.test(String(id || ''))) return null;
  const projects = path.join(configDir, 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }); } catch { return null; }
  let best = null;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(projects, d.name, `${id}.jsonl`);
    let st;
    try { st = fs.lstatSync(file); } catch { continue; }
    if (!st.isFile()) continue; // (a link isn't followed)
    if (!best || st.mtimeMs > best.mtimeMs) best = { file, dir: d.name, mtimeMs: st.mtimeMs };
  }
  return best;
}

/**
 * settle({sessionId, boxed, boxConfig, userConfig}) -> {sessionId, action, from?}
 * action: 'none' (no session) | 'resume' | 'copied' (into the box's folder) | 'fresh' (sessionId null).
 */
function settle({ sessionId, boxed, boxConfig, userConfig }) {
  if (!sessionId) return { sessionId: null, action: 'none' };
  const target = boxed ? boxConfig : userConfig;
  const other = boxed ? userConfig : boxConfig;
  const t = find(target, sessionId);
  const o = find(other, sessionId);
  if (!o || (t && t.mtimeMs >= o.mtimeMs)) return { sessionId, action: 'resume' };
  if (!boxed) return { sessionId: null, action: 'fresh', from: 'box' };
  const dest = path.join(target, 'projects', o.dir);
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  fs.copyFileSync(o.file, path.join(dest, `${sessionId}.jsonl`));
  fs.chmodSync(path.join(dest, `${sessionId}.jsonl`), 0o600);
  const extra = path.join(path.dirname(o.file), sessionId);
  try {
    if (fs.lstatSync(extra).isDirectory()) fs.cpSync(extra, path.join(dest, sessionId), { recursive: true, force: true, dereference: false, verbatimSymlinks: true, filter: (src) => !fs.lstatSync(src).isSymbolicLink() });
  } catch { /* none */ }
  return { sessionId, action: 'copied', from: 'user' };
}

module.exports = { find, settle };
