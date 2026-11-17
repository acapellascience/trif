#!/usr/bin/env node
'use strict';
// Packs the TRIF skill (skill/trif/, made by skill/build.js) two ways, into skill/dist/ (or --out <dir>):
//
//   trif-skill.zip        for claude.ai: Customize → Skills → upload (code execution on). The ZIP holds the
//                         folder trif/ with SKILL.md at its top, as claude.ai expects.
//   trif-plugin/          a Claude Code plugin: .claude-plugin/plugin.json and skills/trif/.
//   .claude-plugin/marketplace.json
//                         makes skill/dist/ a local plugin marketplace, to try the plugin before it's published:
//                         /plugin marketplace add <path to skill/dist>, then /plugin install trif@trif-local.
//
// Nothing is uploaded or published: that's Tim's. The ZIP is the same bytes for the same files (fixed dates,
// sorted names), so a rebuild that changes nothing changes nothing.
//
//   node skill/package.js [--out <dir>]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { files, checkFrontmatter, NAME } = require('./build');

const ROOT = path.join(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// ---- a small ZIP writer (deflate, no dependency): local headers, then the central directory
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// (1 Jan 2026, 00:00, in DOS time: every entry the same, so the bytes depend only on the files)
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** A ZIP of [[name, Buffer]] (names with / for folders; folders themselves are implied). */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // (UTF-8 names)
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** What a ZIP holds: [{name, data}] (for the tests: this writer's own ZIPs, deflate or stored). */
function unzip(buf) {
  const out = [];
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10); const size = buf.readUInt32LE(at + 20); const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30); const comment = buf.readUInt16LE(at + 32); const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body), crc: buf.readUInt32LE(at + 16) });
    at += 46 + nameLen + extra + comment;
  }
  return out;
}

function pluginJson(description) {
  return {
    name: NAME,
    version: VERSION,
    description,
    author: { name: 'Tim Blais' },
    homepage: 'https://timsrobot.com',
    repository: 'https://github.com/acapellascience/trif',
    license: 'MIT',
    keywords: ['trif', 'browser', 'userscripts', 'websites', 'mods'],
  };
}

function marketplaceJson(description) {
  return {
    name: 'trif-local',
    description: 'TRIF\'s skill, built locally from the TRIF repository, to try before it\'s published.',
    owner: { name: 'Tim Blais' },
    plugins: [{ name: NAME, source: './trif-plugin', description, version: VERSION }],
  };
}

function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }

/** Builds both into `out`; returns {zip, plugin, marketplace, files}. */
function pack(out) {
  const all = files();
  const { description } = checkFrontmatter(all.find(([p]) => p === 'SKILL.md')[1]);
  fs.rmSync(path.join(out, 'trif-plugin'), { recursive: true, force: true });
  const zipFile = path.join(out, 'trif-skill.zip');
  write(zipFile, zip(all.map(([p, t]) => [`${NAME}/${p}`, Buffer.from(t, 'utf8')])));
  const plugin = path.join(out, 'trif-plugin');
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginJson(description), null, 2)}\n`);
  for (const [p, t] of all) write(path.join(plugin, 'skills', NAME, p), t);
  const market = path.join(out, '.claude-plugin', 'marketplace.json');
  write(market, `${JSON.stringify(marketplaceJson(description), null, 2)}\n`);
  return { zip: zipFile, plugin, marketplace: market, files: all.length };
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(i === -1 ? path.join(__dirname, 'dist') : process.argv[i + 1]);
  const r = pack(out);
  console.log(`${path.relative(process.cwd(), r.zip)} (${(fs.statSync(r.zip).size / 1024).toFixed(0)} KB, ${r.files} files): upload on claude.ai`);
  console.log(`${path.relative(process.cwd(), r.plugin)}/: the Claude Code plugin; ${path.relative(process.cwd(), path.dirname(path.dirname(r.marketplace))) || '.'} is a local marketplace for it`);
}

module.exports = { pack, zip, unzip, crc32, pluginJson, marketplaceJson };
