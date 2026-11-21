'use strict';
// For test files with tests that can't run on Windows yet, in place of require('node:test'):
//   const test = require('./on-windows')(__filename);
// Everywhere else it's node:test itself. On Windows, each test of the file that tests/windows-skips.json
// names is reported skipped, with the reason given there; the rest run ("*": the whole file, its hooks too).
// That file is the list of what's left for Windows, test by test (docs/WINDOWS.md); a test taken off it must
// pass on windows-latest.
// TRIF_TEST_POSIX_ON_WINDOWS=1 runs them all anyway, to see which pass by now.
// (tests/posix-only.js is the older, coarser way: a whole file skipped. A few files still use it.)

const path = require('path');
const test = require('node:test');

module.exports = function onWindows(file) {
  if (process.platform !== 'win32' || process.env.TRIF_TEST_POSIX_ON_WINDOWS) return test;
  const { reasons, files } = require('./windows-skips.json');
  const skips = files[path.basename(file)] || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(skips, k);
  const why = (name) => { const k = has(name) ? name : has('*') ? '*' : null; return k ? `Windows: ${reasons[skips[k]] || skips[k]}` : null; };
  const wrapped = (name, ...rest) => {
    const skip = why(name);
    if (!skip) return test(name, ...rest);
    return test(name, { skip }, () => {});
  };
  // "*": every test of the file is skipped, and its before/after hooks don't run either (they set up what only
  // those tests use, and a hook that throws fails the run on Node 18 even with every test skipped).
  const all = has('*');
  const hook = (k) => (all ? () => {} : test[k]);
  wrapped.before = hook('before');
  wrapped.after = hook('after');
  for (const k of ['beforeEach', 'afterEach', 'describe', 'it', 'mock']) wrapped[k] = test[k];
  wrapped.skip = test.skip;
  wrapped.todo = test.todo;
  wrapped.only = test.only;
  return wrapped;
};
