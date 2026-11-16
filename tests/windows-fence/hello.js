'use strict';
// Run inside the fence by run.js: a script in the profile folder that loads a module of TRIF's code
// (node hello.js <path to helper/lib/framing.js>).
const { encode } = require(process.argv[2]);
console.log('script-ok', encode({ ok: true }).length, require('path').basename(__filename));
