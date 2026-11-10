// timsrobot.com/notes/<slug>: Tim's longer posts, ported from X so people who aren't on X can read them.
// node site/build-notes.js [slug…]
//
// Each note is a folder, site/notes/<slug>/:
//   article.json  what the post is: the article read out of X (title, and its blocks: paragraphs with their
//                 bold, italics and links, headings, list items, pictures, videos and embedded posts), from
//                 the article's page by extract.js there (trif run --tab <id> -f site/notes/extract.js).
//   note.json     what X doesn't say: { "x": the post's address on X, "date": "YYYY-MM-DD", "posts": { <id>:
//                 { "caption": a caption under an embedded post, "noQuote": true to shoot it without the post it quotes } } }.
// Its pictures and videos are copied here, into site/public/notes/<slug>/ (the Worker serves that folder:
// wrangler.toml [assets], staged by stage-assets.js), so the page loads nothing from X:
//   - pictures as X serves them (name=large), once: a file already there isn't downloaded again;
//   - videos re-encoded for the web (H.264, at most 1280 wide, AAC, moov first), with a still from them as
//     the poster;
//   - embedded posts as pictures: post-<id>.png, made by shoot-posts.js (they need a browser).
// Then it writes site/src/notes-data.js, which the Worker renders (src/notes.js). Run it again after a new
// article.json; it only fetches what isn't there yet.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NOTES_DIR = path.join(HERE, 'notes');
export const PUBLIC_NOTES = path.join(HERE, 'public', 'notes');
export const OUT = path.join(HERE, 'src', 'notes-data.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/**
 * A text block's html, as the extractor wrote it (each piece of text wrapped on its own: <a><s><i><b>text</b></i></s></a>,
 * any of them left out), tidied: neighbouring pieces with the same styles and link joined, a link kept to
 * where it really goes (X's t.co links are shown by the text they stand for), line breaks as <br>.
 */
export function cleanInline(html, { bold = true } = {}) {
  const runs = [];
  const re = /(?:<a href="([^"]*)" data-text="([^"]*)">)?(<s>)?(<i>)?(<b>)?([^<]*)(?:<\/b>)?(?:<\/i>)?(?:<\/s>)?(?:<\/a>)?/y;
  for (let m; re.lastIndex < html.length && (m = re.exec(html)) && m[0];) {
    let [, href, shown, s, i, b, text] = m;
    if (href && /^https?:\/\/t\.co\//.test(href)) {
      const t = unesc(shown || '').trim();
      href = /^https?:\/\//.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) ? `https://${t}` : href;
    }
    runs.push({ href: href ? unesc(href) : '', s: !!s, i: !!i, b: bold && !!b, text });
  }
  if (re.lastIndex < html.length) throw new Error(`a text block the builder can't read, at: ${html.slice(re.lastIndex, re.lastIndex + 60)}`);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.href === r.href && last.s === r.s && last.i === r.i && last.b === r.b) last.text += r.text;
    else merged.push({ ...r });
  }
  let out = '';
  for (let k = 0; k < merged.length;) {
    const href = merged[k].href;
    let inner = '';
    for (; k < merged.length && merged[k].href === href; k++) {
      const r = merged[k];
      let t = r.text.replace(/\n/g, '<br>');
      if (r.b) t = `<b>${t}</b>`;
      if (r.i) t = `<i>${t}</i>`;
      if (r.s) t = `<s>${t}</s>`;
      inner += t;
    }
    out += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
  }
  return out.replace(/(<br>)+$/, '').trim();
}

const plain = (html) => unesc(html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')).trim();

function size(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return { w, h };
}

async function download(url, file) {
  if (fs.existsSync(file)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return true;
}

/** The best source among a video's addresses: the biggest mp4, else the playlist. */
function videoSource(urls) {
  const mp4 = urls.filter((u) => /\.mp4(\?|$)/.test(u)).map((u) => {
    const m = /\/(\d+)x(\d+)\//.exec(u);
    return { u, area: m ? m[1] * m[2] : 0 };
  }).sort((a, b) => b.area - a.area)[0];
  return mp4?.u || urls.find((u) => /\.m3u8/.test(u));
}

// (Cloudflare serves files up to 25 MB; a long video's bitrate is capped to keep it under MAX_VIDEO, and one
// that would get too few bits a frame at 1280 wide is made 960 wide)
const MAX_VIDEO = 14e6;
function encodeVideo(src, file) {
  if (fs.existsSync(file)) return false;
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim()) || 60;
  const videoBits = Math.floor((MAX_VIDEO * 8) / seconds - 128e3);
  const width = videoBits < 1.2e6 ? 960 : 1280;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale='min(${width},iw)':-2`, '-c:v', 'libx264', '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-crf', '26', '-maxrate', String(videoBits), '-bufsize', String(videoBits * 2), '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${file}.part.mp4`], { stdio: 'inherit' });
  fs.renameSync(`${file}.part.mp4`, file);
  return true;
}

function posterFor(video, file) {
  if (fs.existsSync(file)) return;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.1', '-i', video, '-frames:v', '1', '-q:v', '3', file]);
}

const mediaId = (url) => /\/(?:media|amplify_video(?:_thumb)?|ext_tw_video(?:_thumb)?)\/([\w-]+)/.exec(url)?.[1];

/** One note: its blocks, with its media fetched into site/public/notes/<slug>/. */
export async function buildNote(slug, { fetchMedia = true } = {}) {
  const dir = path.join(NOTES_DIR, slug);
  const article = JSON.parse(fs.readFileSync(path.join(dir, 'article.json'), 'utf8'));
  const meta = fs.existsSync(path.join(dir, 'note.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'note.json'), 'utf8')) : {};
  const media = path.join(PUBLIC_NOTES, slug);
  fs.mkdirSync(media, { recursive: true });
  const blocks = [];
  const files = [];
  const note = (msg) => console.log(`  ${slug}: ${msg}`);
  for (const b of article.blocks) {
    if (b.type === 'text') {
      const kind = /header-one/.test(b.kind) ? 'h2' : /header/.test(b.kind) ? 'h2' : /list-item/.test(b.kind) ? 'li' : /blockquote/.test(b.kind) ? 'quote' : 'p';
      const html = cleanInline(b.html, { bold: kind !== 'h2' });
      if (html) blocks.push({ t: kind, html });
    } else if (b.type === 'image') {
      for (const url of b.imgs) {
        const ext = /format=(\w+)/.exec(url)?.[1] || 'jpg';
        const name = `${mediaId(url) || `image-${blocks.length}`}.${ext}`;
        const file = path.join(media, name);
        if (fetchMedia && await download(url, file)) note(`fetched ${name}`);
        const { w, h } = size(file);
        files.push(name);
        blocks.push({ t: 'img', src: name, w, h, caption: b.caption || '' });
      }
    } else if (b.type === 'video') {
      for (const v of b.vids) {
        const id = mediaId(v.poster) || mediaId(v.urls[0] || '') || `video-${blocks.length}`;
        const name = `video-${id}.mp4`, poster = `video-${id}.jpg`;
        const file = path.join(media, name);
        const src = videoSource(v.urls);
        if (!fs.existsSync(file)) {
          if (!fetchMedia) throw new Error(`${slug}: ${name} is missing (run node site/build-notes.js)`);
          if (!src) throw new Error(`${slug}: no address for video ${id}`);
          note(`encoding ${name} from ${src.split('?')[0]}`);
          encodeVideo(src, file);
        }
        posterFor(file, path.join(media, poster));
        const { w, h } = size(file);
        files.push(name, poster);
        blocks.push({ t: 'video', src: name, poster, w, h, caption: b.caption || '' });
      }
    } else if (b.type === 'tweet') {
      const href = b.urls[0];
      const id = /status\/(\d+)/.exec(href)?.[1];
      const name = `post-${id}.png`;
      const file = path.join(media, name);
      if (!fs.existsSync(file)) throw new Error(`${slug}: ${name} is missing: node site/shoot-posts.js ${slug} ${id}`);
      const { w, h } = size(file);
      files.push(name);
      blocks.push({ t: 'post', src: name, w: Math.round(w / 2), h: Math.round(h / 2), href, alt: postAlt(b, { noQuote: !!meta.posts?.[id]?.noQuote }), caption: meta.posts?.[id]?.caption || '' });
    }
  }
  // the link preview: the TL;DR (or the first paragraph), and the first picture
  const first = blocks.find((x) => x.t === 'p');
  const description = first ? plain(first.html).replace(/^TL;DR:\s*/i, '').slice(0, 300) : '';
  // (a picture shaped like a link card, 1.3 to 2.4 times as wide as it's tall, and big enough; note.json's
  // "image" picks one by name)
  const image = blocks.find((x) => x.t === 'img' && x.src === meta.image)
    || blocks.find((x) => x.t === 'img' && x.w >= 600 && x.w / x.h >= 1.3 && x.w / x.h <= 2.4) || blocks.find((x) => x.t === 'img');
  if (!meta.x || /PLACEHOLDER/.test(meta.x)) note('note.json has no address on X yet ("x"): the page says it\'s coming');
  return { slug, title: article.title, description, x: meta.x && !/PLACEHOLDER/.test(meta.x) ? meta.x : '', date: meta.date || '', image: image ? { src: image.src, w: image.w, h: image.h } : null, files, blocks };
}

/** An embedded post's alt text: who, when, what it says, and what it quotes (from the card's text). */
export function postAlt(b, { noQuote = false } = {}) {
  const lines = (b.all || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const parts = [];
  let i = 0;
  const counter = (l) => /^[\d.,]+[KM]?$/.test(l) || /^\d+:\d\d$/.test(l); // (likes, replies, views, a video's length)
  const one = () => {
    const name = lines[i++] || '', handle = lines[i++] || '';
    if (lines[i] === '·') i++;
    const when = lines[i++] || '';
    const text = [];
    for (; i < lines.length && lines[i] !== 'Quote'; i++) if (!counter(lines[i])) text.push(lines[i]);
    return `${name} (${handle}), ${when}: ${text.join(' ').replace(/\s+/g, ' ').trim()}`;
  };
  if (lines.length < 3) return (b.text || '').replace(/\s+/g, ' ').trim();
  parts.push(`A post by ${one()}`);
  if (lines[i] === 'Quote' && !noQuote) { i++; parts.push(`quoting ${one()}`); }
  return parts.join('. ');
}

export function notesModule(notes) {
  return `// Generated by site/build-notes.js from site/notes/*/: don't edit (run node site/build-notes.js).
export const NOTES = ${JSON.stringify(Object.fromEntries(notes.map((n) => [n.slug, n])), null, 1)};
`;
}

export async function writeNotes({ fetchMedia = true, only = [] } = {}) {
  const slugs = fs.readdirSync(NOTES_DIR).filter((s) => fs.existsSync(path.join(NOTES_DIR, s, 'article.json')));
  const notes = [];
  for (const slug of slugs) notes.push(only.length && !only.includes(slug) && fetchMedia ? await buildNote(slug, { fetchMedia: false }) : await buildNote(slug, { fetchMedia }));
  const text = notesModule(notes);
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (old !== text) fs.writeFileSync(OUT, text);
  return old !== text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(await writeNotes({ only: process.argv.slice(2) }) ? `wrote ${path.relative(process.cwd(), OUT)}` : 'up to date');
}
