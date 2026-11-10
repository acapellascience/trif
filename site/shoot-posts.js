// Screenshots of X posts for a note (site/notes/<slug>/): node site/shoot-posts.js <slug> [id…]
// The posts a note embeds are shown as pictures, not X's embed script (which would load X, and its
// tracking, for every reader, and often shows nothing to someone who isn't logged in). Each one is
// rendered logged out from X's public embed page (platform.twitter.com/embed/Tweet.html), in the dark
// theme like the site, in a headless, muted Chrome for Testing (tests/e2e/.browsers: npm run
// browsers:install), and only the post's card is saved, at 2x, as public/notes/<slug>/post-<id>.png.
// Without ids it shoots every post in the note's article.json. Run it again when a post should be
// re-shot (an edited article, a post X restyled); build-notes.js then picks up the new sizes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSERS = path.join(HERE, '..', 'tests', 'e2e', '.browsers', 'chrome');

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const v of fs.existsSync(BROWSERS) ? fs.readdirSync(BROWSERS) : []) {
    const mac = path.join(BROWSERS, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    const mac64 = mac.replace('chrome-mac-arm64', 'chrome-mac-x64');
    const linux = path.join(BROWSERS, v, 'chrome-linux64', 'chrome');
    for (const p of [mac, mac64, linux]) if (fs.existsSync(p)) return p;
  }
  throw new Error('no Chrome for Testing: npm run browsers:install (or CHROME=/path/to/chrome)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each post's card, logged out, as a PNG (Buffer), with the post's text (for alt text). */
export async function shootPosts(ids, { scale = 2, width = 550, noQuote = [] } = {}) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-posts-'));
  const chrome = spawn(chromePath(), ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const shots = {};
  try {
    let tabs = [];
    for (let i = 0; i < 75 && !tabs.length; i++) {
      try { tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page'); } catch {}
      if (!tabs.length) await sleep(200);
    }
    if (!tabs.length) throw new Error("Chrome didn't start");
    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let seq = 0;
    const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send('Page.enable');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: width + 40, height: 1400, deviceScaleFactor: scale, mobile: false });
    for (const id of ids) {
      await send('Page.navigate', { url: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true&lang=en` });
      // the card, once its pictures have loaded
      let box = null;
      for (let i = 0; i < 60 && !box; i++) {
        await sleep(500);
        box = await evaluate(`(() => {
          const a = document.querySelector('article');
          if (!a || !a.innerText.trim()) return null;
          const imgs = [...a.querySelectorAll('img')];
          if (imgs.some((im) => !im.complete || !im.naturalWidth)) return null;
          // (note.json's posts.<id>.noQuote: the post without the post it quotes: the quoted one's box, the
          // outermost rounded, bordered box in the card holding a second @handle, is taken out first)
          if (${JSON.stringify(noQuote)}.includes(${JSON.stringify(id)})) {
            const boxes = [...a.querySelectorAll('div, a')].filter((e) => { const cs = getComputedStyle(e);
              return parseFloat(cs.borderTopWidth) >= 1 && parseFloat(cs.borderTopLeftRadius) >= 8 && /@\\w/.test(e.innerText) && !e.querySelector('video'); });
            const q = boxes.find((e) => !boxes.some((o) => o !== e && o.contains(e)));
            if (q) q.remove(); else return null;
          }
          const r = a.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, text: (a.querySelector('[data-testid=tweetText]') || a).innerText };
        })()`);
      }
      if (!box) throw new Error(`post ${id} didn't render logged out`);
      await sleep(800); // (fonts, the video's still)
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } });
      shots[id] = { png: Buffer.from(shot.result.data, 'base64'), text: box.text, width: Math.round(box.width), height: Math.round(box.height) };
    }
    ws.close();
  } finally {
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500).unref?.();
  }
  return shots;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [slug, ...given] = process.argv.slice(2);
  if (!slug) { console.error('usage: node site/shoot-posts.js <slug> [post id…]'); process.exit(2); }
  const dir = path.join(HERE, 'notes', slug);
  const article = JSON.parse(fs.readFileSync(path.join(dir, 'article.json'), 'utf8'));
  const ids = given.length ? given : article.blocks.filter((b) => b.type === 'tweet').map((b) => /status\/(\d+)/.exec(b.urls[0])[1]);
  const out = path.join(HERE, 'public', 'notes', slug);
  fs.mkdirSync(out, { recursive: true });
  const meta = fs.existsSync(path.join(dir, 'note.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'note.json'), 'utf8')) : {};
  const noQuote = Object.entries(meta.posts || {}).filter(([, o]) => o.noQuote).map(([pid]) => pid);
  const shots = await shootPosts(ids, { noQuote });
  for (const [id, s] of Object.entries(shots)) {
    fs.writeFileSync(path.join(out, `post-${id}.png`), s.png);
    console.log(`post-${id}.png ${s.width}x${s.height}`);
  }
}
