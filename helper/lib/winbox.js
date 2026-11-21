'use strict';
// TRIF's full sandbox on Windows, its network (whole-box step 9b', Tim's pick W3, 11-21; docs/WHOLE-BOX.md
// "Windows without an administrator?"). Every boxed run is in ONE AppContainer (CONTAINER; each run's own
// folders on a capability of its own: fence.cs `runCapability`), and one administrator step at setup gives
// that container:
//   - Windows' loopback exemption (CheckNetIsolation LoopbackExempt -a -p=<its SID>): without it nothing in
//     an AppContainer reaches a port on this computer, and a container with no network capability can't
//     listen either (round 9), so no TRIF relay;
//   - firewall rules naming it (New-NetFirewallRule -Package <its SID>, group RULE_GROUP), block rules (a
//     block wins over any allow): TCP to every port but TRIF's two (the relay, the key proxy), TCP to those
//     two anywhere but 127.0.0.1, all UDP, and everything inbound. (The container has a network capability,
//     NET_CAPABILITY: without one nothing connects at all; the rules close what it opens.) So the box reaches TRIF's relay and key proxy and nothing
//     else on this computer, as on the Mac (the internet stays closed: no internetClient).
//
//   - TRIF's own WFP filters (helper/lib/win/wfp.cs; round 11): round 10 found that Windows Firewall rules
//     don't filter traffic on this computer itself (with the exemption the box reached every port on
//     127.0.0.1, this computer's own address, ::1 and UDP, rules or not; they did close the internet and the
//     network). The filters, in a sublayer of TRIF's above the firewall's, permit TCP to 127.0.0.1 at TRIF's
//     two ports for the container and block everything else it tries (connect, accept, listen; IPv4, IPv6).
//     The elevated script compiles them from its own command line (Add-Type); status reads them back with
//     the compiled wfp.exe. (Not wired into runs yet: the Windows run code is on branch windows.)
//
// Turning the setting off takes both out (the administrator again). Before every boxed run status() must
// say ready (the rules in force, in the ACTIVE store, so a policy that ignores local rules shows; every
// firewall profile on), else the run doesn't start in the box (the older-protection card, its reason).
//
// The ports are chosen at setup (not in Windows' excluded ranges, free) and written in the rules'
// description, which status() reads back; TRIF's relay and key proxy then listen on exactly those (a run
// doesn't start in the box if they can't).
//
// This file is platform-neutral where it can be (the scripts as text, the parsing: unit-tested anywhere);
// running them needs Windows PowerShell (setup/remove elevated through Windows' administrator prompt).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const CONTAINER = 'TRIF.FullSandbox';
// The run's network capability. With none, Windows refuses every socket in the container, exemption or not
// (windows-latest, round 10), so the box has one and the rules close all of it but TRIF's two ports.
// (Which one: the least that works with the exemption, round 10's probe; see WHOLE-BOX.md.)
const NET_CAPABILITY = 'privateNetworkClientServer';
const RULE_GROUP = 'TRIF full sandbox';
const PORT_CANDIDATES = [47391, 47491, 46391, 45391, 44391, 43391, 42391, 41391, 39391, 38391];
const IPV4_BUT_LOOPBACK = ['0.0.0.0-127.0.0.0', '127.0.0.2-255.255.255.255'];
const IPV6_ALL = '::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff';

// --------------------------------------------------------------------------- SIDs (Windows' derivation)
// An AppContainer's SID from its name: S-1-15-2- and the first 7 little-endian 32-bit words of
// SHA-256(the name in lower case, UTF-16LE) (what DeriveAppContainerSidFromAppContainerName gives; checked
// against it on windows-latest). A capability's: S-1-15-3-1024- and all 8 words of SHA-256(the name in
// upper case, UTF-16LE) (DeriveCapabilitySidsFromName).
function words(text, n) {
  const h = crypto.createHash('sha256').update(Buffer.from(text, 'utf16le')).digest();
  return Array.from({ length: n }, (_, i) => h.readUInt32LE(i * 4));
}
const containerSid = (name) => `S-1-15-2-${words(String(name).toLowerCase(), 7).join('-')}`;
const capabilitySid = (name) => `S-1-15-3-1024-${words(String(name).toUpperCase(), 8).join('-')}`;
const SID_RE = /^S-1-15-2(-\d{1,10}){7}$/;

// --------------------------------------------------------------------------- ports
const validPort = (p) => Number.isInteger(p) && p >= 2 && p <= 65534;

/** `netsh interface ipv4 show excludedportrange protocol=tcp` -> [[start, end]] */
function parseExcluded(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^\s*(\d{1,5})\s+(\d{1,5})\b/gm)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a <= b && b <= 65535) out.push([a, b]);
  }
  return out;
}

/** The first candidate pair {relay: p, keyProxy: p+1} with neither excluded nor in `busy` (a Set). */
function choosePorts(excluded = [], busy = new Set(), candidates = PORT_CANDIDATES) {
  const bad = (p) => busy.has(p) || excluded.some(([a, b]) => p >= a && p <= b);
  for (const p of candidates) if (validPort(p) && !bad(p) && !bad(p + 1)) return { relay: p, keyProxy: p + 1 };
  return null;
}

/** Every TCP port but `allowed` (sorted, distinct) as firewall ranges: ['1-47390', '47393-65535']. */
function otherPorts(allowed) {
  const a = [...new Set(allowed)].sort((x, y) => x - y);
  const out = [];
  let from = 1;
  for (const p of a) { if (p > from) out.push(from === p - 1 ? String(from) : `${from}-${p - 1}`); from = p + 1; }
  if (from <= 65535) out.push(from === 65535 ? '65535' : `${from}-65535`);
  return out;
}

const describe = (ports) => `TRIF's full sandbox: only TRIF's relay and key proxy on this computer. ports=${ports.relay},${ports.keyProxy}`;
const portsFromDescription = (d) => {
  const m = /\bports=(\d{1,5}),(\d{1,5})\s*$/.exec(String(d || ''));
  const r = m && { relay: Number(m[1]), keyProxy: Number(m[2]) };
  return r && validPort(r.relay) && r.keyProxy === r.relay + 1 ? r : null;
};

/** The three rules, as status() expects to find them. */
function rules(ports) {
  const two = [String(ports.relay), String(ports.keyProxy)];
  return [
    { name: 'TRIF.FullSandbox.OtherPorts', display: 'TRIF full sandbox: other ports', protocol: 'TCP', remotePort: otherPorts([ports.relay, ports.keyProxy]), remoteAddress: ['Any'] },
    { name: 'TRIF.FullSandbox.OtherAddresses', display: 'TRIF full sandbox: TRIF\'s ports elsewhere', protocol: 'TCP', remotePort: two, remoteAddress: [...IPV4_BUT_LOOPBACK, IPV6_ALL] },
    { name: 'TRIF.FullSandbox.Udp', display: 'TRIF full sandbox: UDP', protocol: 'UDP', remotePort: ['Any'], remoteAddress: ['Any'] },
    { name: 'TRIF.FullSandbox.Inbound', display: 'TRIF full sandbox: inbound', direction: 'Inbound', protocol: 'Any', remotePort: ['Any'], remoteAddress: ['Any'] },
  ];
}

// --------------------------------------------------------------------------- scripts (Windows PowerShell 5.1)
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const psList = (a) => a.map(psq).join(',');
const CNI = "(Join-Path $env:SystemRoot 'System32\\CheckNetIsolation.exe')";

function checkArgs(sid, ports) {
  if (!SID_RE.test(sid)) throw new Error(`not an AppContainer SID: ${sid}`);
  if (ports && !(validPort(ports.relay) && ports.keyProxy === ports.relay + 1)) throw new Error('bad ports');
}

/** Run as an administrator: the exemption and the rules (old ones of the group first). Writes JSON
 *  {ok, steps:[...], error?} to `resultFile` if given, and prints it. */
function setupScript({ sid, ports, resultFile = null }) {
  checkArgs(sid, ports);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$r = @{ ok = $false; steps = @() }',
    'try {',
    `  Get-NetFirewallRule -Group ${psq(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    `  $o = & ${CNI} LoopbackExempt -a ${psq(`-p=${sid}`)} 2>&1 | Out-String`,
    "  if ($LASTEXITCODE -ne 0) { throw \"CheckNetIsolation: $LASTEXITCODE $o\" }",
    "  $r.steps += 'exempt'",
  ];
  for (const x of rules(ports)) {
    lines.push(`  New-NetFirewallRule -Name ${psq(x.name)} -DisplayName ${psq(x.display)} -Group ${psq(RULE_GROUP)} -Description ${psq(describe(ports))} -Direction ${x.direction || 'Outbound'} -Action Block -Profile Any -Package ${psq(sid)} -Protocol ${x.protocol}${x.remotePort[0] === 'Any' ? '' : ` -RemotePort ${psList(x.remotePort)}`}${x.remoteAddress[0] === 'Any' ? '' : ` -RemoteAddress ${psList(x.remoteAddress)}`} | Out-Null`);
    lines.push(`  $r.steps += ${psq(x.name)}`);
  }
  lines.push(...wfpLines(['add', sid, String(ports.relay), String(ports.keyProxy)], 'wfp', true));
  lines.push('  $r.ok = $true', '} catch { $r.error = "$_" }', ...finish(resultFile));
  return lines.join('\n');
}

// ---- TRIF's own WFP filters (helper/lib/win/wfp.cs), the loopback part the firewall rules don't hold (round
// 10). The elevated script compiles the source from its own (encoded) command line with Add-Type, so nothing
// it runs as an administrator is read from a file. (Comments and indentation dropped, then gzip: the
// command line's 32767 characters.)
const WFP_CS = path.join(__dirname, 'win', 'wfp.cs');
function wfpSourceB64() {
  const src = fs.readFileSync(WFP_CS, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
  return zlib.gzipSync(Buffer.from(src, 'utf8'), { level: 9 }).toString('base64');
}
function wfpLines(args, step, strict) {
  return [
    `  $gz = New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(,[Convert]::FromBase64String('${wfpSourceB64()}'))), [IO.Compression.CompressionMode]::Decompress)`,
    '  $src = (New-Object IO.StreamReader($gz)).ReadToEnd()',
    "  if (-not ('TrifWfp' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }",
    `  $w = [TrifWfp]::Run(@(${psList(args)}))`,
    strict ? "  if ($w -notlike '{\"ok\":true*') { throw \"WFP: $w\" }" : "  if ($w -notlike '{\"ok\":true*') { $r.wfpError = \"$w\" }",
    `  $r.steps += ${psq(step)}`,
  ];
}

/** Run as an administrator: the rules and the exemption out. */
function removeScript({ sid, resultFile = null }) {
  checkArgs(sid);
  return [
    "$ErrorActionPreference = 'Stop'",
    '$r = @{ ok = $false; steps = @() }',
    'try {',
    `  Get-NetFirewallRule -Group ${psq(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    "  $r.steps += 'rules'",
    `  $o = & ${CNI} LoopbackExempt -d ${psq(`-p=${sid}`)} 2>&1 | Out-String`,
    "  $r.steps += 'exemption'",
    ...wfpLines(['remove'], 'wfp', false),
    '  if ($r.wfpError) { throw $r.wfpError }',
    '  $r.ok = $true',
    '} catch { $r.error = "$_" }',
    ...finish(resultFile),
  ].join('\n');
}

function finish(resultFile) {
  return [
    '$j = $r | ConvertTo-Json -Compress -Depth 4',
    ...(resultFile ? [`[IO.File]::WriteAllText(${psq(resultFile)}, $j)`] : []),
    '$j',
  ];
}

/** No administrator needed: what's in force, as JSON on one line. */
function statusScript({ sid }) {
  checkArgs(sid);
  return [
    "$ErrorActionPreference = 'Continue'",
    `$ex = (& ${CNI} LoopbackExempt -s 2>&1 | Out-String)`,
    '$prof = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { @{ name = "$($_.Name)"; enabled = "$($_.Enabled)" } })',
    `$rules = @(Get-NetFirewallRule -Group ${psq(RULE_GROUP)} -PolicyStore ActiveStore -ErrorAction SilentlyContinue | ForEach-Object {`,
    '  $p = $_ | Get-NetFirewallPortFilter; $a = $_ | Get-NetFirewallAddressFilter; $k = $_ | Get-NetFirewallApplicationFilter',
    '  @{ name = "$($_.Name)"; enabled = "$($_.Enabled)"; action = "$($_.Action)"; direction = "$($_.Direction)"; profile = "$($_.Profile)"; description = "$($_.Description)";',
    '     package = "$($k.Package)"; program = "$($k.Program)"; protocol = "$($p.Protocol)"; remotePort = @($p.RemotePort | ForEach-Object { "$_" }); localPort = @($p.LocalPort | ForEach-Object { "$_" });',
    '     remoteAddress = @($a.RemoteAddress | ForEach-Object { "$_" }) }',
    '})',
    '@{ exemptions = $ex; profiles = $prof; rules = $rules } | ConvertTo-Json -Compress -Depth 5',
  ].join('\n');
}

// --------------------------------------------------------------------------- reading what's in force
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]).map(String);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
// (Windows writes an IPv6 range back in its own spelling, and may write 0.0.0.0-127.0.0.0 as given or as a
// subnet; compare what it means, not how it's spelled)
function normAddr(a) {
  const s = String(a).trim().toLowerCase();
  if (s === IPV6_ALL || s === '::/0' || s === '::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') return 'ipv6:all';
  return s;
}

/**
 * parseStatus(jsonText, {sid}) -> {ready, ports, problems: [...]}. Problems: 'noStatus', 'notExempt',
 * 'firewallOff' (a profile off: the rules wouldn't be enforced), 'rulesMissing', 'rulesChanged' (a rule
 * there but not as made: disabled, allowing, other ports, another program, a different container), 'extraRule'
 * (another rule in the group: an allow could open what the blocks close... a block wins, but say so).
 */
// TRIF's WFP filters as `wfp status` prints them -> {ports, problems}: 'filtersMissing' (none, or not all,
// or the sublayer gone), 'filtersChanged' (there but not as made), 'filtersUnknown' (couldn't read them).
function parseWfp(text, { sid }) {
  let w;
  try { w = JSON.parse(String(text || '').trim().split(/\r?\n/).filter(Boolean).pop()); } catch { return { ports: null, problems: ['filtersUnknown'] }; }
  if (!w || w.ok !== true || !Array.isArray(w.filters)) return { ports: null, problems: ['filtersUnknown'] };
  const problems = [];
  // (not found: FWP_E_SUBLAYER_NOT_FOUND / FWP_E_FILTER_NOT_FOUND; anything else, e.g. access denied: unknown)
  if (!w.sublayer) problems.push(w.sublayerError === '0x80320007' ? 'filtersMissing' : 'filtersUnknown');
  else if (w.sublayer.weight !== 65535) problems.push('filtersChanged');
  const want = WFP_FILTERS;
  if (w.filters.length !== want.length || w.filters.some((f) => f.missing === '0x80320003')) problems.push('filtersMissing');
  if (w.filters.some((f) => f.missing && f.missing !== '0x80320003')) problems.push('filtersUnknown');
  let ports = null;
  for (const f of w.filters.filter((x) => !x.missing)) {
    const x = want.find((y) => y.key === String(f.key).toLowerCase());
    const conds = Array.isArray(f.conditions) ? f.conditions : [];
    const pkg = conds.filter((c) => c.field === 'package');
    let ok = !!x && f.ourSublayer === true && f.layer === x.layer && f.action === x.action && (f.flags & 1) === 1
      && pkg.length === 1 && pkg[0].match === 0 && String(pkg[0].value).toUpperCase() === sid.toUpperCase();
    if (ok && x.action === 'permit') {
      const one = (field) => { const c = conds.filter((y) => y.field === field); return c.length === 1 ? c[0] : null; };
      const proto = one('protocol');
      const addr = one('remoteAddress');
      const port = one('remotePort');
      ok = conds.length === 4 && proto && proto.match === 0 && proto.value === 6 && addr && addr.match === 0 && addr.value === 0x7F000001
        && port && port.match === 5 && Array.isArray(port.value) && validPort(port.value[0]) && port.value[1] === port.value[0] + 1;
      if (ok) ports = { relay: port.value[0], keyProxy: port.value[1] };
    } else if (ok) ok = conds.length === 1 && (f.flags & 8) === 8;
    if (!ok) problems.push('filtersChanged');
  }
  return { ports, problems: [...new Set(problems)] };
}

// (wfp.cs's filters: keys, layers, actions)
const WFP_FILTERS = [
  { key: '5452e1f0-7769-4b49-8000-747269660010', layer: 'connect4', action: 'permit' },
  { key: '5452e1f0-7769-4b49-8000-747269660011', layer: 'connect4', action: 'block' },
  { key: '5452e1f0-7769-4b49-8000-747269660012', layer: 'connect6', action: 'block' },
  { key: '5452e1f0-7769-4b49-8000-747269660013', layer: 'accept4', action: 'block' },
  { key: '5452e1f0-7769-4b49-8000-747269660014', layer: 'accept6', action: 'block' },
  { key: '5452e1f0-7769-4b49-8000-747269660015', layer: 'listen4', action: 'block' },
  { key: '5452e1f0-7769-4b49-8000-747269660016', layer: 'listen6', action: 'block' },
];

function parseStatus(text, { sid, wfp = undefined }) {
  let s;
  try { s = JSON.parse(String(text || '').trim().split(/\r?\n/).filter(Boolean).pop()); } catch { return { ready: false, ports: null, problems: ['noStatus'] }; }
  if (!s || typeof s !== 'object') return { ready: false, ports: null, problems: ['noStatus'] };
  const problems = [];
  const ex = String(s.exemptions || '');
  if (!new RegExp(`SID:\\s*${sid.replace(/-/g, '\\-')}\\s*$`, 'im').test(ex)) problems.push('notExempt');
  const profiles = Array.isArray(s.profiles) ? s.profiles : s.profiles ? [s.profiles] : [];
  if (profiles.length < 3 || profiles.some((p) => String(p.enabled) !== 'True')) problems.push('firewallOff');
  const found = Array.isArray(s.rules) ? s.rules : s.rules ? [s.rules] : [];
  const ports = found.length ? portsFromDescription(found[0].description) : null;
  if (!ports) problems.push(found.length ? 'rulesChanged' : 'rulesMissing');
  else {
    const want = rules(ports);
    for (const w of want) {
      const f = found.find((x) => x.name === w.name);
      if (!f) { problems.push('rulesMissing'); continue; }
      const ok = f.enabled === 'True' && f.action === 'Block' && f.direction === (w.direction || 'Outbound') && /^any$/i.test(f.profile)
        && String(f.package).toUpperCase() === sid.toUpperCase() && /^any$/i.test(f.program || 'Any')
        && String(f.protocol).toUpperCase() === w.protocol.toUpperCase() && sameList(arr(f.remotePort), w.remotePort) && sameList(arr(f.localPort).length ? arr(f.localPort) : ['Any'], ['Any'])
        && sameList(arr(f.remoteAddress).map(normAddr), w.remoteAddress.map(normAddr)) && portsFromDescription(f.description)?.relay === ports.relay;
      if (!ok) problems.push('rulesChanged');
    }
    if (found.some((x) => !want.some((w) => w.name === x.name))) problems.push('extraRule');
  }
  if (wfp !== undefined) {
    const f = parseWfp(wfp, { sid });
    problems.push(...f.problems);
    if (ports && f.ports && (f.ports.relay !== ports.relay)) problems.push('filtersChanged');
  }
  const uniq = [...new Set(problems)];
  return { ready: !uniq.length, ports, problems: uniq };
}

// --------------------------------------------------------------------------- running them (Windows)
const powershell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
// (a PowerShell 7 PSModulePath makes Windows PowerShell load 7's modules, which fail: round 9)
function psEnv(env = process.env) { const e = { ...env }; for (const k of Object.keys(e)) if (k.toUpperCase() === 'PSMODULEPATH') delete e[k]; return e; }

// (`stdin`: the script on standard input, one line, for the outer script of runElevated: the elevated one
// rides on ITS command line encoded, and encoding that twice would pass Windows' 32767 characters)
function runPs(script, { timeout = 60000, stdin = false } = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...(stdin ? ['-Command', '-'] : ['-EncodedCommand', encoded(script)])];
  const r = spawnSync(powershell(), args, { encoding: 'utf8', timeout, env: psEnv(), windowsHide: true, ...(stdin ? { input: `${script}\n` } : {}) });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? r.error.message : null };
}

/** The one-line outer script: Windows' administrator prompt for `script` (encoded on the elevated command
 *  line). */
function elevatedOuter(script) {
  return `$ErrorActionPreference = 'Stop'; try { $p = Start-Process -FilePath ${psq(powershell())} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${psList(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(script)])}; "exit $($p.ExitCode)" } catch { "declined: $_" }`;
}

/** The script as an administrator: directly if this process is one (`already`), else through Windows'
 *  administrator prompt (Start-Process -Verb RunAs; the person can say no: {ok: false, declined: true}). The
 *  script goes on the elevated command line (encoded), never in a file something else could change. */
function runElevated(scriptFor, { already = false, dir = os.tmpdir(), timeout = 300000 } = {}) {
  const resultFile = path.join(dir, `trif-winbox-${crypto.randomBytes(6).toString('hex')}.json`);
  const script = scriptFor(resultFile);
  let r;
  if (already) r = runPs(script, { timeout });
  else {
    r = runPs(elevatedOuter(script), { timeout, stdin: true });
  }
  let out = null;
  try { out = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '')); } catch { /* none */ }
  try { fs.rmSync(resultFile, { force: true }); } catch { /* ok */ }
  if (out) return { ok: out.ok === true, steps: out.steps || [], error: out.error || null };
  const declined = /^declined:/m.test(r.stdout);
  return { ok: false, declined, error: (declined ? r.stdout.replace(/^declined:\s*/m, '') : `${r.stdout}${r.stderr}${r.error || ''}`).trim().slice(0, 500) };
}

/** status({sid, wfpExe}): what's in force. `wfpExe`: helper/lib/win/wfp.cs compiled (TRIF's bin, as the
 *  fence; reading needs no administrator); without it the filters count as unknown (not ready). */
function status({ sid = containerSid(CONTAINER), wfpExe = process.env.TRIF_WFP_EXE || null } = {}) {
  const r = runPs(statusScript({ sid }));
  let wfp = null;
  if (wfpExe) {
    const w = spawnSync(wfpExe, ['status'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    wfp = (w.stdout || '').trim() || null;
  }
  return { ...parseStatus(r.stdout, { sid, wfp }), raw: r.code === 0 ? undefined : `${r.stderr}${r.error || ''}`.slice(0, 500) };
}

function excludedPorts() {
  const r = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netsh.exe'), ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { encoding: 'utf8', windowsHide: true });
  return parseExcluded(r.stdout);
}

function busyPorts() {
  const r = runPs('Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalPort }');
  return new Set(r.stdout.split(/\s+/).filter(Boolean).map(Number));
}

/** setup({already, ports}) -> {ok, ports, declined?, error?, status}: the ports (given; else the ones the
 *  rules already have; else chosen: not excluded, nothing listening), then the one elevated step. (Choose
 *  before TRIF's own relay listens: it would count as busy.) */
function setup({ already = false, sid = containerSid(CONTAINER), dir, ports: given = null, wfpExe } = {}) {
  const now = status({ sid, wfpExe });
  const ports = given || (now.ports && !now.problems.includes('rulesChanged') ? now.ports : choosePorts(excludedPorts(), busyPorts()));
  if (!ports) return { ok: false, error: 'no free ports for TRIF\'s relay', status: now };
  const r = runElevated((resultFile) => setupScript({ sid, ports, resultFile }), { already, dir });
  const after = status({ sid, wfpExe });
  return { ...r, ok: r.ok && after.ready, ports, status: after };
}

function remove({ already = false, sid = containerSid(CONTAINER), dir, wfpExe } = {}) {
  const r = runElevated((resultFile) => removeScript({ sid, resultFile }), { already, dir });
  return { ...r, status: status({ sid, wfpExe }) };
}

module.exports = {
  CONTAINER, NET_CAPABILITY, RULE_GROUP, PORT_CANDIDATES, containerSid, capabilitySid, parseExcluded, choosePorts, otherPorts, rules,
  describe, portsFromDescription, setupScript, removeScript, statusScript, parseStatus, parseWfp, WFP_FILTERS, WFP_CS, elevatedOuter,
  runPs, runElevated, status, setup, remove, excludedPorts, busyPorts, encoded,
};

if (require.main === module) {
  // node helper/lib/winbox.js status | setup | remove | sid [name]   (the tests on windows-latest)
  const [cmd, arg] = process.argv.slice(2);
  const already = process.env.TRIF_WINBOX_ALREADY_ADMIN === '1';
  if (cmd === 'sid') console.log(containerSid(arg || CONTAINER));
  else if (cmd === 'status') console.log(JSON.stringify(status()));
  else if (cmd === 'setup') console.log(JSON.stringify(setup({ already })));
  else if (cmd === 'remove') console.log(JSON.stringify(remove({ already })));
  else { console.error('usage: winbox.js status|setup|remove|sid [name]'); process.exit(2); }
}
