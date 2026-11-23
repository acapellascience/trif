'use strict';
// The phone link's announcer on Windows (helper/lib/phonelink/bonjour.js): trif-dnssd.exe, from dnssd.cs
// beside this file, built on the user's computer by Windows' own C# compiler as the fence is (fence.js): into
// <home>\bin\trif-dnssd-<hash of its source>.exe, nothing compiled shipped, a new source a new file. It calls
// Windows' own DNS-SD API (dnsapi.dll DnsServiceRegister, Windows 10 1809 and later), takes the Mac's
// `dns-sd -R` arguments, and holds the record until its standard input closes. No Bonjour install.
//
// Why an .exe and not PowerShell with Add-Type: the record lives as long as a process holds it, and a
// PowerShell started for each record compiles its C# again each time (seconds, on every listener change); the
// fence already builds the same way, once per version, and is started in a moment after that.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { cscPath } = require('./fence');

const SOURCE = path.join(__dirname, 'dnssd.cs');
const NAME = /^trif-dnssd-[0-9a-f]{12}\.exe$/;

function sourceHash() { return crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').slice(0, 12); }

/** Where the program for this version of the source goes. */
function programFile(binDir) { return path.join(binDir, `trif-dnssd-${sourceHash()}.exe`); }

/**
 * The program, built if it isn't there: {file, error}. Synchronous (about two seconds, once per version).
 * `binDir`: the workspace's bin folder. `csc` (tests): the compiler, in place of Windows' own.
 */
function program(binDir, { env = process.env, run = spawnSync, csc: cscFile } = {}) {
  const exe = programFile(binDir);
  if (fs.existsSync(exe)) return { file: exe, error: null };
  const csc = cscFile !== undefined ? cscFile : cscPath({ env });
  if (!csc) return { file: null, error: 'Windows\' C# compiler (csc.exe, part of .NET Framework 4) isn\'t on this computer, so TRIF can\'t build its announcer' };
  const tmp = `${exe}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp.exe`;
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const r = run(csc, ['/nologo', '/o+', `/out:${tmp}`, SOURCE], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (r.error || r.status !== 0 || !fs.existsSync(tmp)) return { file: null, error: `couldn't build TRIF's announcer: ${String((r.error && r.error.message) || r.stdout || r.stderr || `csc.exe exited ${r.status}`).trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400)}` };
    try { fs.renameSync(tmp, exe); } catch (e) { if (!fs.existsSync(exe)) throw e; } // (another helper built it meanwhile)
    for (const n of fs.readdirSync(binDir)) {
      if (NAME.test(n) && n !== path.basename(exe)) { try { fs.unlinkSync(path.join(binDir, n)); } catch { /* in use */ } }
    }
    return { file: exe, error: null };
  } catch (e) {
    return { file: null, error: `couldn't build TRIF's announcer: ${e.message}` };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ }
  }
}

module.exports = { SOURCE, sourceHash, programFile, program };
