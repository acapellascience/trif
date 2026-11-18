'use strict';
// VideoResume.swift + Core.swift (Tim, 11-18: a video picks up where it was after its page loads again; the rules are the
// shared mobile/shared/core/video-resume.js called through JavaScriptCore) built for the Mac with swiftc and run with
// mobile/test/videoresume-check/main.swift against video-resume-cases.json: which loads resume (the same page within 30 minutes,
// not live, not another video, not the first 5 s or the last 10 s, not a link with its own time), the sites' video
// ids, and the page's own videoId (the JS in TRIF's world) giving the same ids as the Swift one, in node. macOS only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const APP = path.join(HERE, '..', 'browser-probe', 'TrifProbe');
const SWIFT = [path.join(APP, 'VideoResume.swift'), path.join(APP, 'Core.swift'), path.join(HERE, 'videoresume-check', 'main.swift')];
const ARGS = [path.join(HERE, '..', 'shared', 'core', 'video-resume-cases.json'), path.join(HERE, '..', 'shared', 'gen', 'core.js')];
const ADDRESSES = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/watch?feature=share&v=abc_-1', 'https://youtu.be/xyz?si=1',
  'https://m.youtube.com/shorts/S1?feature=share', 'https://www.youtube-nocookie.com/embed/E1', 'https://www.youtube.com/live/L1',
  'https://www.youtube.com/', 'https://music.youtube.com/watch?v=M1&list=2', 'https://vimeo.com/76979871', 'https://player.vimeo.com/video/12/',
  'https://vimeo.com/channels/staffpicks', 'http://127.0.0.1:8390/video.html?v=a', 'https://example.com/v/1',
];

test('VideoResume.swift: when a video is picked up again, and the page agrees on video ids', { skip: process.platform !== 'darwin' && 'macOS only', timeout: 180000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-videoresume-check-'));
  const bin = path.join(dir, 'check');
  try {
    execFileSync('xcrun', ['swiftc', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
    let out;
    try { out = execFileSync(bin, ARGS, { encoding: 'utf8', timeout: 20000 }); } catch (e) { out = `${e.stdout || ''}`; }
    assert.equal(out.trim().split('\n').filter((l) => !l.endsWith('µs')).join('\n'), 'video resume: ok');
    const swiftIds = execFileSync(bin, ['--videoid', ...ARGS], { input: ADDRESSES.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n');
    const videoId = new Function('return (' + execFileSync(bin, ['--videoid-script'], { encoding: 'utf8' }) + ')')();
    assert.deepEqual(ADDRESSES.map((a) => videoId(a) || '-'), swiftIds);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
