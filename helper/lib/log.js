'use strict';
// Append-only log file with simple size-based rotation. Never writes to stdout.

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 2 * 1024 * 1024;

function createLogger(file, { stderr = false } = {}) {
  let writes = 0;
  // Once stderr's reader is gone (the browser or test that started us died), writes fail with EPIPE
  // asynchronously. Unhandled, that was an uncaught exception, which logged to stderr again: a busy
  // loop that kept the orphaned helper spinning. Stop using stderr instead.
  if (stderr) process.stderr.on('error', () => { stderr = false; });
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }

  function rotateIfNeeded() {
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
    } catch { /* missing file is fine */ }
  }
  rotateIfNeeded();

  function write(level, ...args) {
    const text = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: Infinity }))).join(' ');
    const line = `${new Date().toISOString()} [${process.pid}] ${level.toUpperCase()} ${text}\n`;
    if (++writes % 200 === 0) rotateIfNeeded();
    try { fs.appendFileSync(file, line); } catch { /* nowhere else to put it */ }
    if (stderr && (level === 'error' || level === 'warn')) {
      try { process.stderr.write(line); } catch { /* ignore */ }
    }
  }

  return {
    file,
    write,
    info: (...a) => write('info', ...a),
    warn: (...a) => write('warn', ...a),
    error: (...a) => write('error', ...a),
    debug: (...a) => write('debug', ...a),
  };
}

module.exports = { createLogger };
