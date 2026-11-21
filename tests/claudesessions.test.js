'use strict';
// A chat's Claude Code session across TRIF's full sandbox and the older protection (claudesessions.js,
// docs/WHOLE-BOX-PROGRESS.md step 5b): scratch folders only, never ~/.claude.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cs = require('../helper/lib/claudesessions');

const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wbs-')));
const ID = '0b9c3f7e-1111-4222-8333-444455556666';
function put(config, dir, text, ageMs = 0) {
  const d = path.join(config, 'projects', dir);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${ID}.jsonl`);
  fs.writeFileSync(f, text);
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(f, t, t);
  return f;
}

test('settle: resume where it is; the user\'s turns copied into the box; the box\'s never out (a new session)', () => {
  const root = temp();
  const box = path.join(root, 'private', 'agent-config', 'claude');
  const user = path.join(root, 'home', '.claude');
  assert.deepStrictEqual(cs.settle({ sessionId: null, boxed: true, boxConfig: box, userConfig: user }), { sessionId: null, action: 'none' });
  // in neither: as now (Claude Code says so)
  assert.deepStrictEqual(cs.settle({ sessionId: ID, boxed: true, boxConfig: box, userConfig: user }), { sessionId: ID, action: 'resume' });
  // started with the older protection, then boxed: copied in, with its tool-output folder (links left out)
  put(user, '-private-tmp-stage-a', '{"user":1}\n', 5000);
  const extra = path.join(user, 'projects', '-private-tmp-stage-a', ID, 'tool-results');
  fs.mkdirSync(extra, { recursive: true });
  fs.writeFileSync(path.join(extra, 'r1.txt'), 'output');
  fs.symlinkSync('/etc/hosts', path.join(extra, 'link'));
  assert.deepStrictEqual(cs.settle({ sessionId: ID, boxed: true, boxConfig: box, userConfig: user }), { sessionId: ID, action: 'copied', from: 'user' });
  const copied = path.join(box, 'projects', '-private-tmp-stage-a', `${ID}.jsonl`);
  assert.strictEqual(fs.readFileSync(copied, 'utf8'), '{"user":1}\n');
  assert.strictEqual(fs.statSync(copied).mode & 0o777, 0o600);
  assert.strictEqual(fs.readFileSync(path.join(box, 'projects', '-private-tmp-stage-a', ID, 'tool-results', 'r1.txt'), 'utf8'), 'output');
  assert.ok(!fs.existsSync(path.join(box, 'projects', '-private-tmp-stage-a', ID, 'tool-results', 'link')));
  // the box's copy is now the newest: boxed runs resume it
  fs.appendFileSync(copied, '{"box":2}\n');
  assert.deepStrictEqual(cs.settle({ sessionId: ID, boxed: true, boxConfig: box, userConfig: user }), { sessionId: ID, action: 'resume' });
  // back to the older protection: the user's copy is older than the box's: a new session, nothing written outside
  const before = fs.readFileSync(path.join(user, 'projects', '-private-tmp-stage-a', `${ID}.jsonl`), 'utf8');
  assert.deepStrictEqual(cs.settle({ sessionId: ID, boxed: false, boxConfig: box, userConfig: user }), { sessionId: null, action: 'fresh', from: 'box' });
  assert.strictEqual(fs.readFileSync(path.join(user, 'projects', '-private-tmp-stage-a', `${ID}.jsonl`), 'utf8'), before);
  // a session that only ever ran outside, older protection again: resumed
  const user2 = path.join(root, 'home2', '.claude');
  put(user2, 'x', '{}\n');
  assert.deepStrictEqual(cs.settle({ sessionId: ID, boxed: false, boxConfig: box + '-none', userConfig: user2 }), { sessionId: ID, action: 'resume' });
});

test('find: only a plain file, the newest; ids that aren\'t ids find nothing', () => {
  const root = temp();
  put(root, 'a', 'old\n', 9000);
  const newer = put(root, 'b', 'new\n');
  assert.strictEqual(cs.find(root, ID).file, newer);
  fs.mkdirSync(path.join(root, 'projects', 'c'));
  fs.symlinkSync(newer, path.join(root, 'projects', 'c', 'linked.jsonl'));
  assert.strictEqual(cs.find(root, 'linked'), null, 'a link is not a session');
  for (const bad of ['../x', '', 'a/b', '.hidden', 'x'.repeat(200)]) assert.strictEqual(cs.find(root, bad), null, bad);
  assert.strictEqual(cs.find(path.join(root, 'nowhere'), ID), null);
});
