'use strict';
// The user's standing instructions for their agents ("talk like a caveman", "don't mention risk"):
// ~/.trif/instructions.md, edited from the side panel's settings (or by hand). CLAUDE.md imports it,
// so every Claude Code session in the workspace reads it; adapters that don't read CLAUDE.md get it in
// their run context. Side-panel runs can't edit it (claude adapter's denied tools), so a page can't
// talk an agent into rewriting it.

const fs = require('fs');
const path = require('path');

const FILE = 'instructions.md';
const MAX_LENGTH = 4000;

function instructionsFile(home) {
  return path.join(home, FILE);
}

/** The instructions, trimmed; '' when there are none. */
function readInstructions(home) {
  try { return fs.readFileSync(instructionsFile(home), 'utf8').trim(); } catch { return ''; }
}

/** Save the instructions (empty text removes the file). Returns what was saved. */
function writeInstructions(home, text) {
  if (typeof text !== 'string') throw new Error('instructions must be text');
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (t.length > MAX_LENGTH) throw new Error(`instructions are limited to ${MAX_LENGTH} characters (got ${t.length})`);
  const file = instructionsFile(home);
  if (!t) { fs.rmSync(file, { force: true }); return ''; }
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, t + '\n');
  fs.renameSync(tmp, file);
  return t;
}

/** For run contexts of agents that don't read CLAUDE.md: '' when there are none. */
function instructionsContext(text) {
  return text ? `\n\nThe user's own instructions for every run (${FILE}; see "The user's instructions" in AGENTS.md):\n${text}` : '';
}

module.exports = { FILE, MAX_LENGTH, instructionsFile, readInstructions, writeInstructions, instructionsContext };
