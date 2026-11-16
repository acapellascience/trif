'use strict';
// Builds trif-fence.exe from fence.cs with the C# compiler every Windows has (.NET Framework 4's csc.exe).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function build(dir) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const csc = [path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((f) => fs.existsSync(f));
  if (!csc) throw new Error('no csc.exe (.NET Framework 4) on this computer');
  const exe = path.join(dir, 'trif-fence.exe');
  fs.mkdirSync(dir, { recursive: true });
  const t = Date.now();
  const r = spawnSync(csc, ['/nologo', '/o+', '/r:System.Web.Extensions.dll', `/out:${exe}`, path.join(__dirname, 'fence.cs')], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exe)) throw new Error(`csc failed:\n${r.stdout}\n${r.stderr}`);
  console.log(`built ${exe} with ${csc} in ${Date.now() - t} ms (${fs.statSync(exe).size} bytes)`);
  return exe;
}

/** spy.exe (spy.cs): what the probe can't do from node: the clipboard, other programs' command lines. */
function buildSpy(dir) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const csc = [path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((f) => fs.existsSync(f));
  const exe = path.join(dir, 'spy.exe');
  const r = spawnSync(csc, ['/nologo', '/o+', '/r:System.Windows.Forms.dll', '/r:System.Management.dll', `/out:${exe}`, path.join(__dirname, 'spy.cs')], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exe)) throw new Error(`csc failed:\n${r.stdout}\n${r.stderr}`);
  return exe;
}

module.exports = { build, buildSpy };
