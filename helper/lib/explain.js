'use strict';
// The four layers of every term the side panel shows (extension/explain.json, the one table): its label
// (1-3 words), its line (the approved sentence: the approval card, a chip's hover, trif status), its
// explanation (2-4 sentences, behind "more" in the panel) and notes for agents. For `trif explain` and
// docs/EXPLAIN.md (written out from the table; tests/explain.test.js checks the file is this):
// node -e "process.stdout.write(require('./helper/lib/explain').toMarkdown())" > docs/EXPLAIN.md
//
// The code keeps its own labels and lines (boxpowers.js, combinations.js, extension/modlevel.js, the
// panel); tests/explain.test.js checks each against the table. A combination warning the table has no
// entry for yet shows its line alone.

const TABLE = require('../../extension/explain.json');

const GROUPS = TABLE.groups;
const TERMS = TABLE.terms;
const groupTitle = (id) => (GROUPS.find((g) => g.id === id) || { title: id }).title;

// (a label without its placeholders, for finding a term by it: "{N} power(s)" is "power(s)")
const bare = (s) => String(s || '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The terms a word names: by id ("read-drafts", or "agent-levels/off" for one of two), by label ("Ask
 * first", "@migrate", "power(s)"), case aside. Several when they share it (Off: an agent level and a face).
 */
function find(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return [];
  const byKey = TERMS.filter((t) => `${t.group}/${t.id}` === w);
  if (byKey.length) return byKey;
  const byId = TERMS.filter((t) => t.id === w);
  const byLabel = TERMS.filter((t) => !byId.includes(t) && (t.label.toLowerCase() === w || bare(t.label) === bare(w) || t.label.toLowerCase() === `@${w}`));
  return [...byId, ...byLabel];
}

/** `trif explain`: every term, by group. */
function listText() {
  const lines = ['What the side panel\'s words mean. trif explain <term> (an id or a label) shows one: its line, explanation and notes for agents.'];
  for (const g of GROUPS) {
    const ts = TERMS.filter((t) => t.group === g.id);
    if (!ts.length) continue;
    lines.push('', `${g.title}:`);
    const w = Math.max(...ts.map((t) => t.id.length)) + 2;
    for (const t of ts) lines.push(`  ${t.id.padEnd(w)}${t.label}`);
  }
  return lines.join('\n');
}

/** `trif explain <term>`: one term's layers. */
function termText(t) {
  return [
    `${t.label}  (${groupTitle(t.group)}: ${t.group}/${t.id})`,
    `Line: ${t.line}`,
    '',
    t.explanation,
    '',
    'For agents:',
    ...t.agent_notes.map((n) => `- ${n}`),
  ].join('\n');
}

/** docs/EXPLAIN.md: the whole table, all four layers. */
function toMarkdown() {
  const out = [
    '# What the panel\'s words mean',
    '',
    'Written out from extension/explain.json (tests/explain.test.js checks this file is that table):',
    '`node -e "process.stdout.write(require(\'./helper/lib/explain\').toMarkdown())" > docs/EXPLAIN.md`.',
    '',
    'Every term the side panel shows has four layers: its label (1-3 words: a row chip, a power\'s name), its',
    'line (the approved sentence: the approval card, a chip\'s hover, `trif status`), its explanation (2-4',
    'sentences, behind "more" in the panel) and notes for agents (`trif explain <term>`). The code keeps its',
    'own labels and lines; the tests check each against the table. "Drafted": written for this table, not',
    'shown in the panel as such.',
  ];
  for (const g of GROUPS) {
    const ts = TERMS.filter((t) => t.group === g.id);
    if (!ts.length) continue;
    out.push('', `## ${g.title}`);
    for (const t of ts) {
      const d = (layer) => ((t.drafted || []).includes(layer) ? ' (drafted)' : '');
      out.push('', `### ${t.label}`, '', `\`${t.group}/${t.id}\`${t.approved ? `, approved ${t.approved}` : ''}`, '',
        `- **Label**${d('label')}: ${t.label}`, `- **Line**${d('line')}: ${t.line}`, `- **Explanation**: ${t.explanation}`, '- **For agents**:',
        ...t.agent_notes.map((n) => `  - ${n}`));
    }
  }
  return out.join('\n') + '\n';
}

module.exports = { TABLE, GROUPS, TERMS, find, listText, termText, toMarkdown, groupTitle };
