'use strict';
// A stand-in for macOS's dns-sd (the phone link's announcer, helper/lib/phonelink/bonjour.js): the real one
// would announce on the Wi-Fi, so no test ever runs it. Given as TRIF_DNS_SD. Not a test file itself.
//
//   const standIn = makeStandIn(dir);
//   standIn.bin        the program: writes its pid and arguments to calls.log beside it, then waits to be killed
//   standIn.calls()    → [{pid, argv}]
//   standIn.die(true)  the next ones leave at once (false: they wait again)
//   makeStandIn(dir, {windows: true}): Windows' trif-dnssd.exe instead, ended by closing its input

const fs = require('fs');
const path = require('path');

const STANDIN = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + '\\n');
if (fs.existsSync(path.join(__dirname, 'die'))) process.exit(1);
setInterval(() => {}, 1000);
`;

// (Windows' trif-dnssd.exe: a .js the announcer runs with Node; it holds the record until its standard input
// closes, then says so in calls.log ({pid, ended: 'stdin'}) and exits)
const STANDIN_WINDOWS = `'use strict';
const fs = require('fs');
const path = require('path');
const log = (o) => fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify(o) + '\\n');
log({ pid: process.pid, argv: process.argv.slice(2) });
if (fs.existsSync(path.join(__dirname, 'die'))) process.exit(3);
process.stdin.resume();
process.stdin.on('end', () => { log({ pid: process.pid, ended: 'stdin' }); process.exit(0); });
`;

function makeStandIn(dir, { windows = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, windows ? 'trif-dnssd.js' : 'dns-sd');
  fs.writeFileSync(bin, windows ? STANDIN_WINDOWS : STANDIN);
  fs.chmodSync(bin, 0o755);
  const calls = () => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  return { dir, bin, calls, die: (on) => (on ? fs.writeFileSync(path.join(dir, 'die'), '') : fs.rmSync(path.join(dir, 'die'), { force: true })) };
}

module.exports = { makeStandIn };
