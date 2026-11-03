// Run timsrobot.com locally without Cloudflare: node site/dev.js [port]. Reports are printed here instead of
// emailed. (Node 18+ has the Request/Response the Worker uses.) The demo's files are bundled again first
// (build-demo.js), and the side panel's files are read from extension/ (as wrangler.toml [assets] serves them).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDemoModule } from './build-demo.js';
import { localAssets } from './local-assets.js';

if (writeDemoModule()) console.log('bundled site/demo/ into site/src/demo-files.js');
const { default: worker } = await import('./src/index.js');

const port = Number(process.argv[2]) || 8787;
const env = {
  REPORT_TO: 'you@example.com',
  REPORT_FROM: 'reports@timsrobot.com',
  EMAIL: { async send(msg) { console.log(`\n--- email to ${msg.to} (reply to ${msg.replyTo || '-'})\nSubject: ${msg.subject}\n\n${msg.text}`); return { messageId: 'dev' }; } },
  EXTENSION: localAssets(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension')),
};

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`timsrobot.com on http://127.0.0.1:${port}`));
