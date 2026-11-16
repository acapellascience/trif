'use strict';
// Reading and writing files for a side-panel run, from inside the run's fence (docs/WINDOWS.md "The
// sandbox"). helper/mcp.js starts this (through trif-fence.exe, in the run's AppContainer) for the file
// tools it offers an agent that has none of its own it can be held to: Codex on Windows, whose shell is
// off there. One request on stdin (JSON), one answer on stdout (JSON: {ok, text}).
//
// What it may open isn't decided here: the fence lets this program read the run's working folder and write
// its sites\ (other sites' folders read-only), and nothing else on the computer. Paths are taken relative
// to the working folder (the current folder), as the agent is told to give them. The limits below are only
// about size: what's worth sending to a model.

const fs = require('fs');
const path = require('path');

const MAX_READ = 256 * 1024;
const MAX_WRITE = 4 * 1024 * 1024;
const MAX_LIST = 1000;
const MAX_HITS = 200;
const MAX_LINE = 400;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const rel = (p) => path.relative(process.cwd(), p) || '.';
const slashes = (p) => p.split(path.sep).join('/');

// A refusal in the agent's terms: the fence's "no" isn't an error in the file.
function why(e, p, changing = false) {
  if (e && (e.code === 'EPERM' || e.code === 'EACCES')) return `${slashes(rel(p))}: this chat can't ${changing ? 'change' : 'open'} that (it reads its working folder and changes its own site's folder in sites/, nothing else)`;
  if (e && e.code === 'ENOENT') return `${slashes(rel(p))}: nothing there`;
  if (e && e.code === 'EISDIR') return `${slashes(rel(p))} is a folder`;
  if (e && e.code === 'ENOTDIR') return `${slashes(rel(p))} isn't a folder`;
  return `${slashes(rel(p))}: ${e && e.message ? e.message : e}`;
}

function resolve(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('`path` must be a file or folder name, e.g. sites/x.com/hide-banner.js');
  return path.resolve(process.cwd(), p);
}

function walk(dir, depth, out, max) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= max) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) {
      out.push({ p, dir: true });
      if (depth > 0 && !SKIP_DIRS.has(e.name)) walk(p, depth - 1, out, max);
    } else if (e.isFile()) out.push({ p, dir: false });
  }
}

const OPS = {
  read({ path: p, offset = 1, limit = 2000 }) {
    const file = resolve(p);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(why(e, file)); }
    const lines = text.split('\n');
    const from = Math.max(1, Number(offset) || 1);
    const some = lines.slice(from - 1, from - 1 + Math.max(1, Number(limit) || 2000));
    let body = some.join('\n');
    const cut = body.length > MAX_READ;
    if (cut) body = body.slice(0, MAX_READ);
    const more = cut || from - 1 + some.length < lines.length;
    return body + (more ? `\n[… ${lines.length} lines in all: pass offset and limit for the rest]` : '');
  },
  write({ path: p, content }) {
    const file = resolve(p);
    if (typeof content !== 'string') throw new Error('`content` must be the file\'s whole text');
    if (content.length > MAX_WRITE) throw new Error('too big for one file');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    } catch (e) { throw new Error(why(e, file, true)); }
    return `wrote ${slashes(rel(file))} (${Buffer.byteLength(content)} bytes)`;
  },
  edit({ path: p, old, new: next, all = false }) {
    const file = resolve(p);
    if (typeof old !== 'string' || !old || typeof next !== 'string') throw new Error('`old` (the text to replace, exactly as it is in the file) and `new` must be text');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(why(e, file)); }
    const count = text.split(old).length - 1;
    if (!count) throw new Error(`${slashes(rel(file))}: \`old\` isn't in the file as given (read it again: it must match exactly, spaces and line breaks included)`);
    if (count > 1 && !all) throw new Error(`${slashes(rel(file))}: \`old\` is there ${count} times: give more of the text around it, or pass all: true`);
    try { fs.writeFileSync(file, all ? text.split(old).join(next) : text.replace(old, () => next)); } catch (e) { throw new Error(why(e, file, true)); }
    return `changed ${slashes(rel(file))}${count > 1 ? ` (${count} places)` : ''}`;
  },
  list({ path: p = '.', depth = 1 }) {
    const dir = resolve(p);
    try { if (!fs.statSync(dir).isDirectory()) throw Object.assign(new Error('not a folder'), { code: 'ENOTDIR' }); } catch (e) { throw new Error(why(e, dir)); }
    const out = [];
    walk(dir, Math.min(6, Math.max(0, Number(depth) || 0)), out, MAX_LIST);
    if (!out.length) return '(empty)';
    return out.map((x) => `${slashes(rel(x.p))}${x.dir ? '/' : ''}`).join('\n') + (out.length >= MAX_LIST ? `\n[… more than ${MAX_LIST}: list a folder inside]` : '');
  },
  search({ pattern, path: p = '.', ignoreCase = false }) {
    if (typeof pattern !== 'string' || !pattern) throw new Error('`pattern` must be a regular expression, e.g. "@match"');
    let re;
    try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); } catch (e) { throw new Error(`\`pattern\` isn't a regular expression: ${e.message}`); }
    const root = resolve(p);
    const files = [];
    let st;
    try { st = fs.statSync(root); } catch (e) { throw new Error(why(e, root)); }
    if (st.isDirectory()) walk(root, 8, files, 20000); else files.push({ p: root, dir: false });
    const hits = [];
    for (const f of files) {
      if (f.dir || hits.length >= MAX_HITS) continue;
      let text;
      try { if (fs.statSync(f.p).size > 2 * 1024 * 1024) continue; text = fs.readFileSync(f.p, 'utf8'); } catch { continue; }
      if (text.includes('\0')) continue; // (not text)
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) if (re.test(lines[i])) hits.push(`${slashes(rel(f.p))}:${i + 1}: ${lines[i].trim().slice(0, MAX_LINE)}`);
    }
    return hits.length ? hits.join('\n') + (hits.length >= MAX_HITS ? `\n[… the first ${MAX_HITS}]` : '') : 'no matches';
  },
};

function handle(req) {
  const op = req && OPS[req.op];
  if (!op) return { ok: false, text: 'unknown file operation' };
  try { return { ok: true, text: op(req.args && typeof req.args === 'object' ? req.args : {}) }; } catch (e) { return { ok: false, text: e.message }; }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let req = null;
    try { req = JSON.parse(input); } catch { /* answered below */ }
    process.stdout.write(JSON.stringify(req ? handle(req) : { ok: false, text: 'bad request' }), () => process.exit(0));
  });
}

module.exports = { handle, OPS };
