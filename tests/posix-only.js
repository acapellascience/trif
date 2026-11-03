'use strict';
// For test files that only run on macOS and Linux, in place of require('node:test'):
//   const test = require('./posix-only')('why');
// Elsewhere it's node:test itself. On Windows each test is reported as skipped with the reason, and the
// file's top-level hooks (test.after) do nothing, so `npm test` runs there without these. They use Unix
// sockets (<home>/helper.sock), #!/bin/sh fake agents, file modes, symlinks or POSIX signals; making them
// Windows-proof is later work (tests/windows.test.js covers Windows' own code paths).

const test = require('node:test');

module.exports = function posixOnly(reason) {
  if (process.platform !== 'win32') return test;
  const skip = `macOS/Linux only: ${reason}`;
  const skipped = (name, ...rest) => test(name, { skip }, () => {});
  for (const hook of ['before', 'after', 'beforeEach', 'afterEach']) skipped[hook] = () => {};
  skipped.skip = skipped;
  skipped.todo = skipped;
  skipped.only = skipped;
  return skipped;
};
