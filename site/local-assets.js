// A stand-in for a Workers assets binding (env.ASSETS: wrangler.toml [assets]) that reads folders on disk, for
// site/dev.js and tests/site.test.js: localAssets(dir), or localAssets({ prefix: dir, … }) (stage-assets.js
// MOUNTS: the longest matching prefix wins). Like the real one it answers a Range request with 206.
import fs from 'node:fs';
import path from 'node:path';

export function localAssets(dirs) {
  const mounts = Object.entries(typeof dirs === 'string' ? { '': dirs } : dirs).map(([prefix, dir]) => [prefix, path.resolve(dir)])
    .sort((a, b) => b[0].length - a[0].length);
  return {
    async fetch(request) {
      const req = typeof request === 'string' ? new Request(request) : request;
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, '');
      const mount = mounts.find(([prefix]) => rel.startsWith(prefix));
      if (!mount) return new Response('Not found', { status: 404 });
      const [prefix, root] = mount;
      const file = path.resolve(root, `./${rel.slice(prefix.length)}`);
      if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
      let body;
      try { body = fs.readFileSync(file); } catch { return new Response('Not found', { status: 404 }); }
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start >= body.length || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.length}` } });
        return new Response(body.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': String(end - start + 1) } });
      }
      return new Response(body, { headers: { 'Content-Length': String(body.length) } });
    },
  };
}
