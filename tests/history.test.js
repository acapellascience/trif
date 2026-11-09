'use strict';
// helper/lib/history.js: what a side-panel run changed can be undone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const history = require('../helper/lib/history');

function makeWs() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-history-'));
  const modsDir = path.join(home, 'sites');
  fs.mkdirSync(path.join(modsDir, 'x.com'), { recursive: true });
  return { home, modsDir };
}
const file = (ws, id) => path.join(ws.modsDir, `${id}.js`);
const rel = (ws, id) => path.relative(ws.home, file(ws, id));

test('a run\'s changes are kept; undo puts back the version before, and can itself be undone', () => {
  const ws = makeWs();
  fs.writeFileSync(file(ws, 'x.com/a'), 'v1');
  const before = history.contentsSnapshot(ws);
  fs.writeFileSync(file(ws, 'x.com/a'), 'v2'); // the run edits a
  fs.writeFileSync(file(ws, 'x.com/b'), 'new'); // and creates b
  const ids = history.recordChanges(ws, before, [rel(ws, 'x.com/a'), rel(ws, 'x.com/b'), 'sites/x.com/_notes.txt']);
  assert.deepEqual(ids.sort(), ['x.com/a', 'x.com/b']);
  assert.deepEqual(history.listHistory(ws, 'x.com/a').map((e) => e.kind), ['version']);
  assert.deepEqual(history.listHistory(ws, 'x.com/b').map((e) => e.kind), ['created']);
  // undo: a is v1 again, and what it replaced (v2) is kept
  assert.equal(history.undoChange(ws, 'x.com/a').restored, 'previous');
  assert.equal(fs.readFileSync(file(ws, 'x.com/a'), 'utf8'), 'v1');
  assert.equal(history.listHistory(ws, 'x.com/a').length, 1);
  history.undoChange(ws, 'x.com/a'); // undo the undo
  assert.equal(fs.readFileSync(file(ws, 'x.com/a'), 'utf8'), 'v2');
  // b was new: undo moves it to the trash
  assert.equal(history.undoChange(ws, 'x.com/b').restored, 'removed');
  assert.equal(fs.existsSync(file(ws, 'x.com/b')), false);
  assert.ok(fs.readdirSync(path.join(ws.home, 'trash', 'x.com')).some((n) => n.startsWith('b@')));
  assert.throws(() => history.undoChange(ws, 'x.com/b'), /no changes to undo/);
  assert.throws(() => history.undoChange(ws, '../etc/passwd'), /isn't a mod id/);
});
