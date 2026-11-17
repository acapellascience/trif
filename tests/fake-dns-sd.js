'use strict';
// A stand-in for macOS's dns-sd (the phone link's announcer, helper/lib/phonelink/bonjour.js): the real one
// would announce on the Wi-Fi, so no test ever runs it. Given as TRIF_DNS_SD. Not a test file itself.
//
//   const standIn = makeStandIn(dir);
//   standIn.bin        the program: writes its pid and arguments to calls.log beside it, then waits to be killed
//   standIn.calls()    → [{pid, argv}]
//   standIn.die(true)  the next ones leave at once (false: they wait again)

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

function makeStandIn(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'dns-sd');
  fs.writeFileSync(bin, STANDIN);
  fs.chmodSync(bin, 0o755);
  const calls = () => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  return { dir, bin, calls, die: (on) => (on ? fs.writeFileSync(path.join(dir, 'die'), '') : fs.rmSync(path.join(dir, 'die'), { force: true })) };
}

module.exports = { makeStandIn };
