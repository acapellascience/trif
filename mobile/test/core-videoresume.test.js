'use strict';
// mobile/shared/core/video-resume.js (which loads pick a video up where it was, and the sites' video ids, Tim 11-18)
// against video-resume-cases.json, the answers the iPhone's VideoResume.decide / videoID / asksForTime / samePage gave
// before the move (mobile/test/videoresume.test.js holds the Swift to them). Also through the generated
// mobile/shared/gen/core.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.join(__dirname, '..', 'shared', 'core');
const C = JSON.parse(fs.readFileSync(path.join(CORE, 'video-resume-cases.json'), 'utf8'));
const A = C.addresses, PARTS = new Map(A.map(([a, p]) => [a, p]));
const at = (url) => ({ url, parts: PARTS.get(url) });

function run(V, where) {
  for (const [a, p, w] of A) {
    assert.equal(V.videoID(p), w.id, `${where} videoID ${JSON.stringify(a)}`);
    assert.equal(V.asksForTime(p), w.asks, `${where} asksForTime ${JSON.stringify(a)}`);
  }
  for (const [i, j, w] of C.same) assert.equal(V.samePage(at(A[i][0]), at(A[j][0])), w, `${where} samePage ${A[i][0]} ${A[j][0]}`);
  for (const [f, w] of C.decide) {
    const saved = f.saved && { ...f.saved, parts: PARTS.get(f.saved.url) };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(V.decide({ saved, address: at(f.address) }))), w, `${where} decide ${JSON.stringify(f)}`);
  }
}

test('core/video-resume.js gives the iPhone\'s answers', () => {
  run(require(path.join(CORE, 'video-resume.js')), 'module');
  const whys = new Set(C.decide.map(([, w]) => w.why));
  for (const w of ['nothing kept', 'kept more than 30 minutes ago', 'a live stream', 'it had ended', 'another page or video',
    'the address asks for its own time', 'in its first 5 s', 'in its last 10 s', 'resume']) assert.ok(whys.has(w), w);
  assert.ok(C.same.some(([i, j, w]) => w && i !== j) && A.some(([, p]) => !p || p.host == null));
});

test('gen/core.js: TrifCore.videoResume in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  run(vm.runInContext('TrifCore.videoResume', ctx), 'gen');
  assert.equal(vm.runInContext('TrifCore.call("videoResume.videoID", JSON.stringify([{host: "youtu.be", path: "/x", query: null, fragment: null}]))', ctx), '"yt:x"');
});
