'use strict';
// Can a phone reach the phone link through Windows Firewall? (`trif doctor` on Windows, when the link is on.)
//
// TRIF adds no rule and asks for no administrator: Windows itself asks "Allow access?" for node.exe the first
// time the link listens (a phone being paired, or one paired already), and keeps the answer as inbound rules
// for that program, Allow or Block, each for some network profiles (Private, Public, Domain). This reads those
// rules and the profile of each network the computer is on now, through PowerShell's NetSecurity module
// (Get-NetFirewallApplicationFilter, Get-NetConnectionProfile: words that aren't translated, unlike netsh's),
// and says which: allowed here, blocked here, allowed elsewhere only, or not asked yet. A Block for a profile
// wins over an Allow, as in the firewall. Read only. A few seconds (PowerShell, its module).

const { runPowerShellSync, psComplaint } = require('./powershell');

// TRIF_FIREWALL: the marker tests/fake-powershell.js tells this script by.
const SCRIPT = `# TRIF_FIREWALL
$ErrorActionPreference = 'Stop'
$req = [Console]::In.ReadLine() | ConvertFrom-Json
$rules = @()
foreach ($f in @(Get-NetFirewallApplicationFilter -Program $req.program -ErrorAction SilentlyContinue)) {
  foreach ($r in @($f | Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
    if ([string]$r.Direction -eq 'Inbound' -and [string]$r.Enabled -eq 'True') { $rules += @{ action = [string]$r.Action; profile = [string]$r.Profile } }
  }
}
$networks = @()
foreach ($p in @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)) { $networks += [string]$p.NetworkCategory }
@{ rules = $rules; networks = $networks } | ConvertTo-Json -Compress -Depth 4
`;

// A network's category as the firewall's profile names it.
const PROFILE_OF = { public: 'Public', private: 'Private', domainauthenticated: 'Domain' };

/** Whether a rule's profile ("Any", "Private", "Domain, Private") covers `profile`. */
function covers(ruleProfile, profile) {
  const parts = String(ruleProfile || '').split(/[,\s]+/).filter(Boolean).map((p) => p.toLowerCase());
  return parts.includes('any') || parts.includes(profile.toLowerCase());
}

/**
 * From the rules and networks: {state, networks}. state: 'allowed' (every network the computer is on now lets
 * node.exe in), 'blocked' (a Block rule covers one of them), 'elsewhere' (rules, but none for this network's
 * profile: Windows blocks it here without asking again), 'unasked' (no rule for node.exe yet: Windows asks the
 * first time the link listens), 'offline' (no network).
 */
function verdict({ rules = [], networks = [] } = {}) {
  const profiles = [...new Set((Array.isArray(networks) ? networks : [networks]).map((n) => PROFILE_OF[String(n).toLowerCase()]).filter(Boolean))];
  const list = (Array.isArray(rules) ? rules : [rules]).filter((r) => r && typeof r === 'object');
  if (!profiles.length) return { state: 'offline', networks: [] };
  if (!list.length) return { state: 'unasked', networks: profiles };
  const blocked = profiles.filter((p) => list.some((r) => /^block$/i.test(r.action) && covers(r.profile, p)));
  if (blocked.length) return { state: 'blocked', networks: blocked };
  const open = profiles.filter((p) => list.some((r) => /^allow$/i.test(r.action) && covers(r.profile, p)));
  return open.length === profiles.length ? { state: 'allowed', networks: profiles } : { state: 'elsewhere', networks: profiles.filter((p) => !open.includes(p)) };
}

/** Reads the rules for `program` (node.exe's full path): verdict's answer, or {state: 'unknown', error}. */
function check(program, { env = process.env, bin = null, run = runPowerShellSync } = {}) {
  const r = run(SCRIPT, { program }, { env, bin, timeout: 30000 });
  if (r.code !== 0) return { state: 'unknown', error: psComplaint(r) };
  let j;
  try { j = JSON.parse(String(r.stdout || '').trim()); } catch { return { state: 'unknown', error: 'PowerShell answered something that isn\'t JSON' }; }
  return verdict(j || {});
}

/**
 * doctor's line for a verdict: {status, title, fix?}. (Drafts, docs/WINDOWS-STRINGS.md 41–45.)
 */
function doctorCheck(v) {
  const where = (v.networks || []).map((p) => p.toLowerCase()).join(' and ');
  const allowFix = 'in Windows Security, Firewall & network protection, "Allow an app through firewall": tick Node.js JavaScript Runtime for Private (and make your home Wi-Fi a private network in Settings, Network & internet)';
  switch (v.state) {
    case 'allowed': return { status: 'ok', title: `phone link: Windows Firewall lets a phone reach this computer (Node.js is allowed on ${where} networks)` };
    case 'blocked': return { status: 'warn', title: `phone link: Windows Firewall blocks Node.js on this ${where} network, so a phone can't reach this computer`, fix: allowFix };
    case 'elsewhere': return { status: 'warn', title: `phone link: Windows Firewall lets Node.js in on other networks, not this ${where} one, so a phone can't reach this computer here`, fix: allowFix };
    case 'unasked': return { status: 'info', title: 'phone link: Windows will ask whether Node.js can use the network the first time you connect a phone: allow it on private networks' };
    case 'offline': return { status: 'info', title: 'phone link: this computer isn\'t on a network just now' };
    default: return { status: 'info', title: `phone link: couldn't read Windows Firewall's rules for Node.js (${v.error || 'unknown'})` };
  }
}

module.exports = { SCRIPT, verdict, check, doctorCheck, covers };
