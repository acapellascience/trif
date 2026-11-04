// A stand-in for a Workers assets binding (env.EXTENSION: wrangler.toml [assets]) that reads a folder on
// disk, for site/dev.js and tests/site.test.js.
import fs from 'node:fs';
import path from 'node:path';

export function localAssets(dir) {
  const root = path.resolve(dir);
  return {
    async fetch(request) {
      const url = new URL(typeof request === 'string' ? request : request.url);
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
      try { return new Response(fs.readFileSync(file)); } catch { return new Response('Not found', { status: 404 }); }
    },
  };
}
