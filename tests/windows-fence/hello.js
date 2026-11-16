'use strict';
// Run inside the fence by run.js: a script in the profile folder that loads a module beside TRIF's code.
const { encode } = require('../helper/lib/framing');
console.log('script-ok', encode({ ok: true }).length, require('path').basename(__filename));
