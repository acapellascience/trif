'use strict';
// A mod's stable id and its name (docs/PHONE-SYNC.md section 2a, D17; Tim, 2026-11-18): the header's `// @id <id>`
// line, which travels with the mod through export, import, sync and copying, apart from its name and its file's.
// The rules here are pure text (no file, no clock but `newId`'s randomness): the iPhone's shared core
// (mobile/shared/core/mod-id.js on ios-poc) is the same algorithm, held to the same cases
// (tests/fixtures/mod-id-cases.json).
//
//   isId(v)                 a stable id: 8-64 lower-case letters, digits and hyphens, starting with a letter or digit
//   newId()                 a new one: a random UUID (v4), lower case
//   readMeta(text)          {name, uid, header}: the header's name (the last non-empty @name, as mods.js reads it), its
//                           first @id line's value if that's an id, and whether there's a whole ==WebMod== block
//   bodyText(text)          the file without the header's @name and @id lines (each whole line, its line ending too)
//   metaText(text)          `<name>\n<uid>` ('' for either missing): what a rename changes
//   withMeta(text, {name, uid})   the text with its @name line's value set (added after the header's first line when
//                           there's none) and its @id line's (added after the @name line); undefined leaves one as it is
//   slug(name)              the file name a name gives (the phone's modfile.js nameOf): '' when nothing is left
//   fileFor(name, taken, own)     `<slug>.js`, or `<slug>-2.js`… when another mod's file has it (`taken`: file names
//                           in the folder, any case; `own`: the mod's own file now, which doesn't count as taken)
//   checkName(name)         why a new name can't be one ('' when it can): 1-80 characters, no line breaks
//   revs(text)              {body, meta}: SHA-256 hex of bodyText and metaText (sync's part revisions)

const crypto = require('crypto');

const ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;
const HEADER_START = /^\s*\/\/\s*==WebMod==\s*$/i;
const HEADER_END = /^\s*\/\/\s*==\/WebMod==\s*$/i;
const META_LINE = /^\s*\/\/\s*@(name|id)(?:\s|$)/i;
const NAME_LINE = /^(\s*\/\/\s*@name)(?:(\s+)(.*?))?(\s*)$/i;
const ID_LINE = /^(\s*\/\/\s*@id)(?:(\s+)(.*?))?(\s*)$/i;
const NAME_MAX = 80;

const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const newId = () => crypto.randomUUID().toLowerCase();

// The text as lines, each with its own ending ('\n', '\r\n' or none for the last), and where the header block is.
function lines(text) {
  const t = String(text ?? '');
  const out = [];
  const re = /[^\n]*(\n|$)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m[0] === '' ) break;
    out.push(m[0]);
  }
  const bare = (l) => l.replace(/\r?\n$/, '');
  let start = -1;
  let end = -1;
  for (let i = 0; i < out.length; i++) {
    if (start === -1) { if (HEADER_START.test(bare(out[i]).replace(/^\uFEFF/, ''))) start = i; continue; }
    if (HEADER_END.test(bare(out[i]))) { end = i; break; }
  }
  if (end === -1) start = -1;
  return { list: out, start, end, bare };
}

function readMeta(text) {
  const { list, start, end, bare } = lines(text);
  let name = null;
  let uid = null;
  let idSeen = false;
  for (let i = start + 1; start !== -1 && i < end; i++) {
    const l = bare(list[i]);
    const n = NAME_LINE.exec(l);
    if (n && /^\s*\/\/\s*@name(\s|$)/i.test(l)) { if (n[3]) name = n[3].trim(); continue; }
    const d = ID_LINE.exec(l);
    if (d && /^\s*\/\/\s*@id(\s|$)/i.test(l) && !idSeen) { idSeen = true; const v = (d[3] || '').trim(); if (isId(v)) uid = v; }
  }
  return { name, uid, header: start !== -1 };
}

function bodyText(text) {
  const { list, start, end, bare } = lines(text);
  if (start === -1) return String(text ?? '');
  return list.filter((l, i) => !(i > start && i < end && META_LINE.test(bare(l)))).join('');
}

function metaText(text) {
  const { name, uid } = readMeta(text);
  return `${name || ''}\n${uid || ''}`;
}

function withMeta(text, { name, uid } = {}) {
  const { list, start, end, bare } = lines(text);
  if (start === -1) return String(text ?? '');
  const eol = (list[start].match(/\r?\n$/) || ['\n'])[0];
  let nameAt = -1;
  let idAt = -1;
  for (let i = start + 1; i < end; i++) {
    const l = bare(list[i]);
    if (/^\s*\/\/\s*@name(\s|$)/i.test(l)) { if (NAME_LINE.exec(l)[3] || nameAt === -1) nameAt = i; }
    else if (idAt === -1 && /^\s*\/\/\s*@id(\s|$)/i.test(l)) idAt = i;
  }
  const out = list.slice();
  const set = (i, re, value) => {
    const l = bare(out[i]);
    const ending = out[i].slice(l.length);
    const m = re.exec(l);
    out[i] = `${m[1]}${m[2] || ' '}${value}${ending}`;
  };
  if (name !== undefined) {
    const v = String(name).trim();
    if (nameAt !== -1) set(nameAt, NAME_LINE, v);
    else { out.splice(start + 1, 0, `// @name ${v}${eol}`); nameAt = start + 1; if (idAt !== -1) idAt++; }
  }
  if (uid !== undefined) {
    if (idAt !== -1) set(idAt, ID_LINE, uid);
    else {
      const after = nameAt !== -1 ? nameAt : start;
      out.splice(after + 1, 0, `// @id ${uid}${(out[after].match(/\r?\n$/) || [eol])[0]}`);
    }
  }
  return out.join('');
}

function slug(name) {
  return String(name || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

function fileFor(name, taken = [], own = null) {
  const base = slug(name) || 'mod';
  const ownLow = own ? String(own).toLowerCase() : null;
  const used = new Set([...taken].map((t) => String(t).toLowerCase()).filter((t) => t !== ownLow));
  for (let n = 1; ; n++) {
    const file = `${n === 1 ? base : `${base}-${n}`}.js`;
    if (!used.has(file.toLowerCase())) return file;
  }
}

function checkName(name) {
  if (typeof name !== 'string') return 'a name is text';
  const v = name.trim();
  if (!v) return 'a name can\'t be empty';
  if (/[\r\n\u2028\u2029]/.test(v)) return 'a name is one line';
  if ([...v].length > NAME_MAX) return `a name can be up to ${NAME_MAX} characters`;
  return '';
}

const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(String(s), 'utf8')).digest('hex');
function revs(text) { return { body: sha256(bodyText(text)), meta: sha256(metaText(text)) }; }

module.exports = { ID_RE, NAME_MAX, isId, newId, readMeta, bodyText, metaText, withMeta, slug, fileFor, checkName, revs };
