'use strict';
// helper/lib/winbox.js (whole-box step 9b', W3): the parts that run anywhere: SIDs, ports, the scripts'
// text, and reading what's in force. Running the scripts: tests/whole-box/win-w3-probe.js on windows-latest.

const test = require('node:test');
const assert = require('node:assert');
const w = require('../helper/lib/winbox');

const SID = w.containerSid(w.CONTAINER);
const PORTS = { relay: 47391, keyProxy: 47392 };

test('SIDs as Windows derives them', () => {
  // (registryRead's is Windows' well-known one; the container's is checked against Windows on CI)
  assert.strictEqual(w.capabilitySid('registryRead'), 'S-1-15-3-1024-1065365936-1281604716-3511738428-1654721687-432734479-3232135806-4053264122-3456934681');
  assert.match(SID, /^S-1-15-2(-\d+){7}$/);
  assert.strictEqual(w.containerSid('TRIF.FULLSANDBOX'), SID, 'case doesn\'t matter');
  assert.notStrictEqual(w.containerSid('trif.fullsandbox2'), SID);
});

test('ports: the excluded ranges, busy ports, the firewall ranges', () => {
  const ex = w.parseExcluded(`
Protocol tcp Port Exclusion Ranges

Start Port    End Port
----------    --------
      5357        5357
     47301       47400
     50000       50059     *

* - Administered port exclusions.
`);
  assert.deepStrictEqual(ex, [[5357, 5357], [47301, 47400], [50000, 50059]]);
  assert.deepStrictEqual(w.choosePorts(ex), { relay: 47491, keyProxy: 47492 });
  assert.deepStrictEqual(w.choosePorts([], new Set([47392])), { relay: 47491, keyProxy: 47492 }, 'the pair must both be free');
  assert.deepStrictEqual(w.choosePorts([], new Set()), PORTS);
  assert.strictEqual(w.choosePorts([[1, 65535]]), null);
  assert.deepStrictEqual(w.otherPorts([47391, 47392]), ['1-47390', '47393-65535']);
  assert.deepStrictEqual(w.otherPorts([2, 3]), ['1', '4-65535']);
  assert.deepStrictEqual(w.otherPorts([65534, 65535]), ['1-65533']);
  assert.deepStrictEqual(w.otherPorts([65533, 65534]), ['1-65532', '65535']);
  assert.deepStrictEqual(w.portsFromDescription(w.describe(PORTS)), PORTS);
  assert.strictEqual(w.portsFromDescription('ports=47391,47500'), null, 'the key proxy is the next port');
  assert.strictEqual(w.portsFromDescription('nothing'), null);
});

test('the rules leave exactly TRIF\'s two ports on 127.0.0.1, TCP', () => {
  const r = w.rules(PORTS);
  assert.deepStrictEqual(r.map((x) => x.protocol), ['TCP', 'TCP', 'UDP', 'Any']);
  assert.deepStrictEqual(r.map((x) => x.direction || 'Outbound'), ['Outbound', 'Outbound', 'Outbound', 'Inbound']);
  // every TCP port is blocked by the first rule except the two; those two are blocked by the second rule
  // everywhere but 127.0.0.1
  const blocked = (port, addr) => r.some((x) => x.protocol === 'TCP'
    && (x.remotePort.includes('Any') || x.remotePort.some((s) => { const [a, b = a] = s.split('-').map(Number); return port >= a && port <= b; }))
    && (x.remoteAddress.includes('Any') || x.remoteAddress.some((s) => {
      if (s.includes(':')) return addr.includes(':');
      if (addr.includes(':')) return false;
      const n = (ip) => ip.split('.').reduce((t, o) => t * 256 + Number(o), 0);
      const [a, b = a] = s.split('-');
      return n(addr) >= n(a) && n(addr) <= n(b);
    })));
  for (const p of [1, 80, 443, 3000, 47390, 47393, 65535]) assert.ok(blocked(p, '127.0.0.1'), `port ${p}`);
  assert.ok(!blocked(47391, '127.0.0.1') && !blocked(47392, '127.0.0.1'));
  for (const a of ['127.0.0.2', '127.0.0.0', '10.0.0.5', '192.168.1.1', '0.0.0.0', '255.255.255.255', '::1', 'fe80::1']) {
    assert.ok(blocked(47391, a) && blocked(47392, a), a);
  }
});

test('the scripts: only the container\'s SID and the ports go in, quoted', () => {
  const s = w.setupScript({ sid: SID, ports: PORTS, resultFile: "C:\\Users\\o'neil\\r.json" });
  assert.match(s, new RegExp(`LoopbackExempt -a '-p=${SID}'`));
  assert.strictEqual((s.match(/New-NetFirewallRule /g) || []).length, 4);
  assert.strictEqual((s.match(/-Action Block/g) || []).length, 4);
  assert.ok(!/-Action Allow/.test(s));
  assert.match(s, /-RemotePort '1-47390','47393-65535'/);
  assert.match(s, /-RemotePort '47391','47392' -RemoteAddress '0\.0\.0\.0-127\.0\.0\.0','127\.0\.0\.2-255\.255\.255\.255','::-ffff/);
  assert.match(s, /'C:\\Users\\o''neil\\r\.json'/, 'quotes doubled');
  assert.match(s, /Get-NetFirewallRule -Group 'TRIF full sandbox' -ErrorAction SilentlyContinue \| Remove-NetFirewallRule/);
  assert.throws(() => w.setupScript({ sid: `${SID}'; rm -r C:\\`, ports: PORTS }), /not an AppContainer SID/);
  assert.throws(() => w.setupScript({ sid: SID, ports: { relay: 47391, keyProxy: 9 } }), /bad ports/);
  assert.throws(() => w.setupScript({ sid: 'S-1-5-32-544', ports: PORTS }), /not an AppContainer SID/);
  const d = w.removeScript({ sid: SID });
  assert.match(d, new RegExp(`LoopbackExempt -d '-p=${SID}'`));
  assert.match(d, /Remove-NetFirewallRule/);
  const st = w.statusScript({ sid: SID });
  assert.match(st, /-PolicyStore ActiveStore/);
  assert.ok(!/New-|Remove-|Set-| -a | -d /.test(st), 'status changes nothing');
  assert.strictEqual(Buffer.from(w.encoded('é'), 'base64').toString('utf16le'), 'é');
});

function good(ports = PORTS, sid = SID) {
  return {
    exemptions: `List Loopback Exempted AppContainers\r\n\r\n[1] -----------------------------------------------------------------\r\n    Name: ${w.CONTAINER}\r\n    SID:  ${sid}\r\n\r\nOK.\r\n`,
    profiles: ['Domain', 'Private', 'Public'].map((name) => ({ name, enabled: 'True' })),
    rules: w.rules(ports).map((x) => ({
      name: x.name, enabled: 'True', action: 'Block', direction: x.direction || 'Outbound', profile: 'Any', description: w.describe(ports), package: sid, program: 'Any',
      protocol: x.protocol, remotePort: x.remotePort, localPort: ['Any'], remoteAddress: x.remoteAddress,
    })),
  };
}

test('status: ready only with the exemption, every profile on, and the four rules as made', () => {
  const st = (o) => w.parseStatus(JSON.stringify(o), { sid: SID });
  assert.deepStrictEqual(st(good()), { ready: true, ports: PORTS, problems: [] });
  assert.deepStrictEqual(st(good({ relay: 47491, keyProxy: 47492 })).ports, { relay: 47491, keyProxy: 47492 });
  // (Windows spells the IPv6 range its own way)
  const g6 = good(); g6.rules[1].remoteAddress = [...g6.rules[1].remoteAddress.slice(0, 2), '::/0'];
  assert.ok(st(g6).ready);
  const mut = (f) => { const o = good(); f(o); return st(o); };
  assert.deepStrictEqual(mut((o) => { o.exemptions = 'OK.'; }).problems, ['notExempt']);
  assert.deepStrictEqual(mut((o) => { o.exemptions = o.exemptions.replace(SID, w.containerSid('other')); }).problems, ['notExempt']);
  assert.deepStrictEqual(mut((o) => { o.profiles[2].enabled = 'False'; }).problems, ['firewallOff']);
  assert.deepStrictEqual(mut((o) => { o.profiles.pop(); }).problems, ['firewallOff']);
  assert.deepStrictEqual(mut((o) => { o.rules = []; }).problems, ['rulesMissing']);
  assert.deepStrictEqual(mut((o) => { o.rules.pop(); }).problems, ['rulesMissing']);
  assert.deepStrictEqual(mut((o) => { o.rules[0].enabled = 'False'; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[0].action = 'Allow'; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[0].remotePort = ['1-47390', '47394-65535']; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[1].remoteAddress = ['127.0.0.2-255.255.255.255']; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[2].package = w.containerSid('other'); }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[2].program = 'C:\\x.exe'; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[0].profile = 'Private'; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules[3].direction = 'Outbound'; }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules.forEach((r) => { r.description = 'x'; }); }).problems, ['rulesChanged']);
  assert.deepStrictEqual(mut((o) => { o.rules.push({ ...o.rules[0], name: 'Someone.Else', action: 'Allow' }); }).problems, ['extraRule']);
  // (one rule: PowerShell's ConvertTo-Json gives an object, not a list)
  const one = good(); one.rules = one.rules[0];
  assert.deepStrictEqual(st(one).problems, ['rulesMissing']);
  assert.deepStrictEqual(w.parseStatus('', { sid: SID }).problems, ['noStatus']);
  assert.deepStrictEqual(w.parseStatus('warning\nnot json', { sid: SID }).problems, ['noStatus']);
  assert.ok(w.parseStatus(`WARNING: something\n${JSON.stringify(good())}`, { sid: SID }).ready, 'the last line');
});
