'use strict';
// Prints a file: what /bin/cat is elsewhere, for Codex's `auth` command on Windows (agents/codex.js
// proxyAuth: the run's key-proxy token, in a file of the run's own folder, never in a command line).
//   node print-file.js <file>
process.stdout.write(require('fs').readFileSync(process.argv[2]));
