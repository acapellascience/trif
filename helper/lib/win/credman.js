'use strict';
// keyring.js on Windows: Windows Credential Manager, one "generic credential" per key (Control Panel →
// Credential Manager → Windows Credentials lists them, as "TRIF open model key/openrouter" and so on).
//
// Windows has no command-line tool that can read a generic credential back (cmdkey only lists and
// writes them, and takes the secret in its argv: any same-user process can read a command line). So
// the helper calls the Win32 credential API (CredReadW / CredWriteW / CredDeleteW in advapi32) from
// Windows PowerShell 5.1, through a few lines of C# compiled by Add-Type (powershell.js runs it):
//   - the script is constant and holds no secret;
//   - what varies goes in on its STDIN as one JSON line {op, target, user, hex}: the key as hex, so no
//     character can be misread on the way;
//   - a key read back comes out on its STDOUT, as hex, to the helper alone;
//   - stored as CRED_PERSIST_LOCAL_MACHINE: this user, this computer (not roamed to others).
// Exit status 44 means "no such credential", like macOS's `security`.
//
// As with the macOS Keychain items /usr/bin/security makes, any program running as the same user can ask
// Credential Manager for a generic credential: this keeps keys out of files, environments and command
// lines, not away from the user's own programs.

const { runPowerShell, psComplaint } = require('./powershell');

const NAME = 'Windows Credential Manager';
const NOT_FOUND = 44;
// CRED_MAX_CREDENTIAL_BLOB_SIZE: a generic credential holds at most 5 * 512 bytes.
const MAX_BYTES = 2560;

const SCRIPT = `$ErrorActionPreference = 'Stop'
try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TrifCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public uint LastWrittenLow; public uint LastWrittenHigh;
    public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL cred, uint flags);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr p);
  private const uint GENERIC = 1;
  private const int NOT_FOUND = 1168;
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, GENERIC, 0, out p)) {
      int e = Marshal.GetLastWin32Error();
      if (e == NOT_FOUND) return null;
      throw new Win32Exception(e);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] b = new byte[c.CredentialBlobSize];
      if (b.Length > 0) Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      string hex = BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
      Array.Clear(b, 0, b.Length);
      return hex;
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string hex) {
    byte[] b = new byte[hex.Length / 2];
    for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
    IntPtr blob = Marshal.AllocHGlobal(b.Length);
    try {
      Marshal.Copy(b, 0, blob, b.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = GENERIC; c.TargetName = target; c.UserName = user; c.Persist = 2;
      c.CredentialBlobSize = (uint)b.Length; c.CredentialBlob = blob;
      if (!CredWrite(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int i = 0; i < b.Length; i++) Marshal.WriteByte(blob, i, 0);
      Marshal.FreeHGlobal(blob);
      Array.Clear(b, 0, b.Length);
    }
  }
  public static bool Delete(string target) {
    if (CredDelete(target, GENERIC, 0)) return true;
    int e = Marshal.GetLastWin32Error();
    if (e == NOT_FOUND) return false;
    throw new Win32Exception(e);
  }
}
'@
  switch ($req.op) {
    'get' { $hex = [TrifCred]::Read($req.target); if ($hex -eq $null) { exit 44 }; [Console]::Out.Write($hex); exit 0 }
    'has' { $hex = [TrifCred]::Read($req.target); if ($hex -eq $null) { exit 44 }; exit 0 }
    'set' { [TrifCred]::Write($req.target, $req.user, $req.hex); exit 0 }
    'delete' { if ([TrifCred]::Delete($req.target)) { exit 0 }; exit 44 }
  }
  [Console]::Error.WriteLine('unknown operation'); exit 2
} catch {
  [Console]::Error.WriteLine($_.Exception.Message); exit 1
}
`;

/** The credential's name in Credential Manager: "<service>/<account>". */
function target(service, account) { return `${service}/${account}`; }

/** {value, error}, like keyring.getKey. */
async function getKey(service, account, opts = {}) {
  const r = await runPowerShell(SCRIPT, { op: 'get', target: target(service, account) }, opts);
  if (r.code === 0 && /^([0-9a-f]{2})+$/.test(r.stdout.trim())) return { value: Buffer.from(r.stdout.trim(), 'hex').toString('utf8'), error: null };
  if (r.code === NOT_FOUND) return { value: null, error: null };
  return { value: null, error: `couldn't read the key from ${NAME}: ${psComplaint(r)}` };
}

/** {stored, error}, like keyring.hasKey. */
async function hasKey(service, account, opts = {}) {
  const r = await runPowerShell(SCRIPT, { op: 'has', target: target(service, account) }, opts);
  if (r.code === 0) return { stored: true, error: null };
  if (r.code === NOT_FOUND) return { stored: false, error: null };
  return { stored: false, error: `couldn't check ${NAME}: ${psComplaint(r)}` };
}

/** Stores `key` (already checked by keyring.keyProblem). Throws an Error that never contains it. */
async function setKey(service, account, key, opts = {}) {
  const bytes = Buffer.from(key, 'utf8');
  if (bytes.length > MAX_BYTES) throw new Error(`that key is too long for ${NAME} (${MAX_BYTES} bytes at most)`);
  const hex = bytes.toString('hex');
  const r = await runPowerShell(SCRIPT, { op: 'set', target: target(service, account), user: account, hex }, opts);
  if (r.code !== 0) {
    let why = psComplaint(r);
    for (const v of [key, hex]) why = why.split(v).join('[redacted]');
    throw new Error(`couldn't save the key in ${NAME}: ${why}`);
  }
}

/** {removed}; throws on failure. */
async function removeKey(service, account, opts = {}) {
  const r = await runPowerShell(SCRIPT, { op: 'delete', target: target(service, account) }, opts);
  if (r.code === 0) return { removed: true };
  if (r.code === NOT_FOUND) return { removed: false };
  throw new Error(`couldn't remove the key from ${NAME}: ${psComplaint(r)}`);
}

module.exports = { NAME, SCRIPT, MAX_BYTES, target, getKey, hasKey, setKey, removeKey };
