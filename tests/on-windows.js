'use strict';
// For test files with tests that can't run on Windows yet, in place of require('node:test'):
//   const test = require('./on-windows')(__filename);
// Everywhere else it's node:test itself. On Windows, each test of the file that tests/windows-skips.json
// names is reported skipped, with the reason given there; the rest run. That file is the list of what's
// left for Windows, test by test (docs/WINDOWS.md); a test taken off it must pass on windows-latest.
// TRIF_TEST_POSIX_ON_WINDOWS=1 runs them all anyway, to see which pass by now.
// (tests/posix-only.js is the older, coarser way: a whole file skipped. A few files still use it.)

const path = require('path');
const test = require('node:test');

module.exports = function onWindows(file) {
  if (process.platform !== 'win32' || process.env.TRIF_TEST_POSIX_ON_WINDOWS) return test;
  const { reasons, files } = require('./windows-skips.json');
  const skips = files[path.basename(file)] || {};
  const why = (name) => (Object.prototype.hasOwnProperty.call(skips, name) ? `Windows: ${reasons[skips[name]] || skips[name]}` : null);
  const wrapped = (name, ...rest) => {
    const skip = why(name);
    if (!skip) return test(name, ...rest);
    return test(name, { skip }, () => {});
  };
  for (const k of ['before', 'after', 'beforeEach', 'afterEach', 'describe', 'it', 'mock']) wrapped[k] = test[k];
  wrapped.skip = test.skip;
  wrapped.todo = test.todo;
  wrapped.only = test.only;
  return wrapped;
};
