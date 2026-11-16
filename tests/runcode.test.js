// Side-panel runs read only the TRIF code listed in runs.js (trifCode). Every extension/ file the helper
// loads has to be on that list, or every `trif` command in a run crashes when it starts (0.2.7: sitecombos.js
// read extension/pagewide.js, and the sandbox refused it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

function helperFiles(dir = path.join(REPO, 'helper')) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...helperFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every extension/ file the helper reads is readable in side-panel runs', () => {
  const { trifCode } = require('../helper/lib/runs');
  const code = trifCode();
  const readable = (f) => code.some((c) => f === c || f.startsWith(c + path.sep));
  const found = new Set();
  for (const file of helperFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    // require('../../extension/x.json') and the like
    for (const m of src.matchAll(/require\(\s*['"]((?:\.\.\/)+extension\/[^'"]+)['"]\s*\)/g)) found.add(path.resolve(path.dirname(file), m[1]));
    // path.join(__dirname, '..', '..', 'extension', 'x.js')
    for (const m of src.matchAll(/path\.join\(\s*__dirname((?:\s*,\s*'\.\.')+)\s*,\s*'extension'\s*,\s*'([^']+)'\s*\)/g)) {
      const ups = (m[1].match(/'\.\.'/g) || []).length;
      found.add(path.resolve(path.dirname(file), ...Array(ups).fill('..'), 'extension', m[2]));
    }
  }
  assert.ok(found.size >= 2, `found ${[...found].join(', ')}`);
  const missing = [...found].filter((f) => fs.existsSync(f) && !readable(fs.realpathSync(f)));
  assert.deepEqual(missing.map((f) => path.relative(REPO, f)), []);
});
