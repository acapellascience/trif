// Run webmods.dev locally without Cloudflare: node site/dev.js [port]. Reports are printed here instead of
// emailed. (Node 18+ has the Request/Response the Worker uses.)
import http from 'node:http';
import worker from './src/index.js';

const port = Number(process.argv[2]) || 8787;
const env = {
  REPORT_TO: 'you@example.com',
  REPORT_FROM: 'reports@webmods.dev',
  EMAIL: { async send(msg) { console.log(`\n--- email to ${msg.to} (reply to ${msg.replyTo || '-'})\nSubject: ${msg.subject}\n\n${msg.text}`); return { messageId: 'dev' }; } },
};

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`webmods.dev on http://127.0.0.1:${port}`));
