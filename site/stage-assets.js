// The files the Worker serves from its assets binding (wrangler.toml [assets]: ASSETS, the folder
// site/.assets/, which isn't in git). build-demo.js stages it before every deploy (wrangler.toml [build] runs
// it), from:
//   - ext/: the side panel files the demo uses (src/demo.js EXTENSION_FILES, only those), from the demo's
//     frozen copy, site/demo/panel/ (not extension/: work on the extension never changes the demo);
//   - everything in site/public/ (the notes' pictures and videos: build-notes.js), at the same paths.
// The Worker runs first for every request (run_worker_first), so nothing here is served unless index.js asks
// for it. site/dev.js and tests/site.test.js use the folders themselves (MOUNTS, local-assets.js) instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_FILES } from './src/demo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STAGE = path.join(HERE, '.assets');
export const PUBLIC = path.join(HERE, 'public');
export const EXTENSION_DIR = path.join(HERE, 'demo', 'panel');
/** Where each path prefix in the binding comes from (local-assets.js reads them in place). */
export const MOUNTS = { 'ext/': EXTENSION_DIR, '': PUBLIC };

export function stageAssets(stage = STAGE) {
  fs.rmSync(stage, { recursive: true, force: true });
  let files = 0;
  for (const f of EXTENSION_FILES) {
    fs.mkdirSync(path.dirname(path.join(stage, 'ext', f)), { recursive: true });
    fs.copyFileSync(path.join(EXTENSION_DIR, f), path.join(stage, 'ext', f));
    files++;
  }
  if (fs.existsSync(PUBLIC)) {
    fs.cpSync(PUBLIC, stage, { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
    const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
    files += count(PUBLIC);
  }
  return files;
}
