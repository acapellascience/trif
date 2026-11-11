'use strict';
// "Agent on this site" (extension/agentsites.js): levels, the sensitive list, what each command needs.
// The background's gate, the Ask and the panel's answers: tests/extension.test.js ("Agent on this site").

const test = require('node:test');
const assert = require('node:assert');

test('a site\'s level: the user\'s choice for it first, then the sensitive list (off), then a parent\'s choice, then ask', async () => {
  const A = await import('../extension/agentsites.js');
  assert.deepEqual(A.agentLevel('https://www.example.com/x', {}), { level: 'ask', by: 'default', site: 'example.com' });
  assert.equal(A.agentLevel('mail.google.com', {}).level, 'off');
  assert.equal(A.agentLevel('mail.google.com', {}).why, 'email');
  assert.equal(A.agentLevel('mail.google.com', { sites: { 'mail.google.com': 'look' } }).level, 'look');
  // (google.com set to run doesn't raise mail.google.com, which is on the list; it does raise maps.google.com)
  assert.equal(A.agentLevel('mail.google.com', { sites: { 'google.com': 'run' } }).level, 'off');
  assert.equal(A.agentLevel('maps.google.com', { sites: { 'google.com': 'run' } }).level, 'run');
  // (patterns: a label with "bank" in it, the .bank domain; a host and its subdomains)
  for (const h of ['online.bankofamerica.com', 'mybank.ca', 'secure.example.bank', 'www.paypal.com', 'vault.bitwarden.com', 'claude.ai', 'web.whatsapp.com', 'discord.com']) assert.equal(A.agentLevel(h, {}).level, 'off', h);
  for (const h of ['x.com', 'google.com', 'github.com', 'whatsapp.com', 'example.com']) assert.equal(A.agentLevel(h, {}).level, 'ask', h);
  // (the user's own list replaces TRIF's)
  assert.equal(A.agentLevel('mail.google.com', { sensitive: [{ pattern: 'x.com', why: 'mine' }] }).level, 'ask');
  assert.equal(A.agentLevel('x.com', { sensitive: [{ pattern: 'x.com', why: 'mine' }] }).why, 'mine');
  assert.deepEqual(A.normalizeAgentSites({ 'WWW.Example.com': 'run', 'bad site': 'run', 'x.com': 'maybe' }), { 'example.com': 'run' });
});

test('what each command needs: Off nothing, Look reading, Ask reading and a question before code, Run code everything', async () => {
  const A = await import('../extension/agentsites.js');
  const s = { sites: { 'look.com': 'look', 'off.com': 'off', 'run.com': 'run' } };
  for (const cmd of ['text', 'screenshot', 'sweep', 'requests', 'navigate', 'open']) {
    assert.equal(A.agentCheck(cmd, 'look.com', s), 'ok', cmd);
    assert.equal(A.agentCheck(cmd, 'ask.com', s), 'ok', cmd);
    assert.match(A.agentCheck(cmd, 'off.com', s), /"Agent on this site" is Off for off\.com: you can't read, screenshot or run code on its tabs\. You can still write mods for it/);
  }
  assert.equal(A.agentCheck('run', 'run.com', s), 'ok');
  assert.equal(A.agentCheck('run', 'ask.com', s), 'ask');
  assert.match(A.agentCheck('run', 'look.com', s), /set "Agent on this site" to Look for look\.com: you can read the page and take screenshots there, but not run code/);
  assert.match(A.agentCheck('run', 'mail.google.com', {}), /Off for mail\.google\.com \(it's email, so it's off unless the user raises it\)/);
  // (commands that touch no page work at every level)
  assert.equal(A.agentCheck('mod.enable', 'off.com', s), 'ok');
});

test('the panel: "Agent on this site" on the line over the message box, a menu of four, the note in the chat', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.html'), 'utf8');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(!header.includes('agent-level'), 'not in the header any more');
  const line = html.slice(html.indexOf('<div id="using-line"'), html.indexOf('<form id="composer"'));
  assert.match(line, /<button id="using"[^>]*>[\s\S]*<button id="agent-level"[^>]*aria-haspopup="menu"[^>]*aria-controls="agent-level-menu"/);
  const items = [...line.matchAll(/role="menuitemradio"[^>]*data-level="(\w+)"[^>]*>.*?<b>([^<]+)<\/b><span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(items, [
    ['off', 'Nothing', 'it can’t see or touch this site.'],
    ['look', 'Look', 'it can read the page and take screenshots.'],
    ['ask', 'Ask first', 'it can look, and asks you before running code here.'],
    ['run', 'Run code', 'it can change the page live; posting is paused while it does.'],
  ]);
  assert.match(line, /Mods for this site always wait for your OK, whatever you pick\./);
  const chat = html.slice(html.indexOf('<main id="chat"'), html.indexOf('</main>'));
  assert.ok(chat.indexOf('id="agent-site-note"') > 0 && chat.indexOf('id="agent-site-note"') < chat.indexOf('id="messages"'), 'the note: the chat\'s first line');
  const js = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  assert.match(js, /const LEVEL_WORDS = \{ off: 'Agent can’t see this site', look: 'Agent can look', ask: 'Agent asks before running code', run: 'Agent can run code' \};/);
  assert.match(js, /`Your agent can’t see \$\{site\}: it’s \$\{lv\.why \|\| 'on your list of sensitive sites'\}\. Change it below\.`/);
  // only where there's a chat: the site connected and the robot on
  assert.match(js, /const show = !!site && !!view\.status\?\.helper\?\.connected && !!siteScope\(\) && currentState\(\) === 'on';/);
});
