'use strict';
// A minimal MCP server over stdio (newline-delimited JSON-RPC), for tests/windows-fence/agents.js: one
// tool, `trif`, that takes {args: [..]} and answers with what it was given. It stands in for TRIF's own
// commands offered to an agent as a tool, with no shell in between. Asked for {args: ['try', <file>, <port>]}
// it tries to read that file and to connect to that port on this computer, and says how each went: run
// inside the fence, both must fail.
const fs = require('fs');
const log = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
let buf = '';
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (log) fs.appendFileSync(log, `${line.slice(0, 400)}\n`);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'trif', version: '0.0.0' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'trif', description: 'Run a trif command: {args: ["status"]}', inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'] } }] } });
    else if (m.method === 'tools/call') {
      const args = (m.params && m.params.arguments && m.params.arguments.args) || [];
      if (args[0] !== 'try') { send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `mcp-trif-ok ${JSON.stringify(m.params && m.params.arguments)}` }] } }); continue; }
      let read;
      try { read = `read: ${fs.readFileSync(args[1], 'utf8').slice(0, 40)}`; } catch (e) { read = `read refused (${e.code})`; }
      const s = require('net').connect({ host: '127.0.0.1', port: Number(args[2]) });
      const done = (net) => { try { s.destroy(); } catch { /* gone */ } send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `mcp-trif-try ${read}; ${net}` }] } }); };
      s.setTimeout(3000, () => done('connect refused (timeout)'));
      s.on('connect', () => done('connected'));
      s.on('error', (e) => done(`connect refused (${e.code})`));
    }
    else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
