'use strict';
// SPIKE, whole-box step 9: run by node INSIDE the AppContainer (win-net-probe.js). Tries each way out it's
// given in WBN_TARGETS ({label: pipe name | {port, host}}) and its own loopback (a server in this process;
// a client in this process and in another process of the same container), and prints {label: outcome} as
// JSON: "echo ok" (the other end answered), or the error.
//   node win-inside.js                 the probe
//   node win-inside.js client <port>   (the other process: connect to 127.0.0.1:<port>, print the outcome)

const net = require('net');
const { spawn } = require('child_process');

function tryOne(how) {
  return new Promise((resolve) => {
    let s;
    try { s = net.connect(how); } catch (e) { resolve(`throw ${e.code || e.message}`); return; }
    let got = '';
    let done = false;
    const end = (x) => { if (!done) { done = true; s.destroy(); resolve(x); } };
    s.setTimeout(6000, () => end('timeout'));
    s.on('connect', () => s.write('PING\n'));
    s.on('data', (d) => { got += d; if (got.includes('ECHO PING')) end('echo ok'); });
    s.on('error', (e) => end(e.code || e.message));
    s.on('close', () => end(got ? `odd: ${got.slice(0, 40)}` : 'closed'));
  });
}

if (process.argv[2] === 'client') {
  tryOne({ port: Number(process.argv[3]), host: '127.0.0.1' }).then((x) => { console.log(x); process.exit(0); });
} else {
  (async () => {
    const o = {};
    const srv = net.createServer((c) => { c.on('data', (d) => c.write(`ECHO ${d}`)); c.on('error', () => {}); });
    const lp = await new Promise((r) => { srv.on('error', (e) => r(`listen ${e.code || e.message}`)); srv.listen(0, '127.0.0.1', () => r(srv.address().port)); });
    if (typeof lp === 'number') {
      o['loopback, same process'] = await tryOne({ port: lp, host: '127.0.0.1' });
      o['loopback, another process'] = await new Promise((r) => {
        const c = spawn(process.execPath, [__filename, 'client', String(lp)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        c.stdout.on('data', (d) => { out += d; });
        c.stderr.on('data', (d) => { out += d; });
        c.on('error', (e) => r(`spawn ${e.code || e.message}`));
        c.on('exit', () => r(out.trim() || 'no answer'));
      });
    } else o['loopback, listen'] = lp;
    for (const [k, v] of Object.entries(JSON.parse(process.env.WBN_TARGETS || '{}'))) o[k] = await tryOne(v);
    srv.close();
    console.log(JSON.stringify(o));
    process.exit(0);
  })();
}
