'use strict';
// SPIKE, whole-box step 9 (Windows): what runs first inside the AppContainer, before Claude Code. An
// AppContainer can't reach a port on this computer outside it (loopback is closed to it unless an
// administrator exempts it), but it may open a named pipe whose security names it (pipe-bridge.cs, outside,
// carries the pipe to TRIF's relay). Claude Code only speaks TCP to a proxy, so this listens on a port of its
// own inside the container (127.0.0.1, an ephemeral port) and carries each connection to the pipe, untouched;
// then starts the command (Claude Code) with every "{SHIM}" in its arguments and environment replaced by
// 127.0.0.1:<that port>, and ends with its status. Inside the box, so it can do nothing the box doesn't let
// it: the relay outside still decides where a tunnel may go.
//
//   node box-shim.js <command> <args…>        env TRIF_SHIM_PIPE=\\.\pipe\<name>

const net = require('net');
const { spawn } = require('child_process');

const pipe = process.env.TRIF_SHIM_PIPE;
if (!pipe || !/^\\\\\.\\pipe\\[A-Za-z0-9._-]{1,200}$/.test(pipe)) { console.error('box-shim: TRIF_SHIM_PIPE must name a pipe'); process.exit(2); }

const server = net.createServer((client) => {
  client.pause();
  const up = net.connect(pipe);
  up.on('connect', () => { client.pipe(up); up.pipe(client); client.resume(); });
  up.on('error', (e) => { console.error(`box-shim: the pipe: ${e.code || e.message}`); client.destroy(); });
  client.on('error', () => up.destroy());
  up.on('close', () => client.destroy());
  client.on('close', () => up.destroy());
});
server.on('error', (e) => { console.error(`box-shim: listen: ${e.code || e.message}`); process.exit(3); });
server.listen(0, '127.0.0.1', () => {
  const at = `127.0.0.1:${server.address().port}`;
  const sub = (s) => String(s).split('{SHIM}').join(at);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'TRIF_SHIM_PIPE') env[k] = sub(v);
  const [cmd, ...args] = process.argv.slice(2);
  const child = spawn(cmd, args.map(sub), { env, stdio: 'inherit', windowsHide: true });
  child.on('error', (e) => { console.error(`box-shim: start: ${e.message}`); process.exit(4); });
  child.on('exit', (code, sig) => { server.close(); process.exit(code === null ? 1 : code); });
});
