// How noticeable a mod is, and the one chip its row shows (sidepanel.js). In one place, so the row and the
// code card say the same.
//
// Levels: 0 nothing to say, 1 noticeable (the site's own scripts could tell something's different),
// 2 changes requests (it changes what the site receives).
// A boxed mod's level comes from its powers, which TRIF enforces, never from what its header says. A free
// or style mod's comes from its @risk, and TRIF's reading of its code can raise it, never lower it.
// A power or finding not listed here (a newer helper's) counts for nothing, and still counts as a power.

// (0.3's powers too: keeping events or signalling the page's own code, its storage, uploads you post, other
// sizes of its pictures, the fonts on this computer: each something the site's scripts could tell)
export const POWER_LEVEL = {
  'rewrite-requests': 2,
  'block-events': 1, 'site-data': 1, click: 1, 'write-drafts': 1, media: 1,
  'page-events': 1, 'site-storage': 1, 'edit-uploads': 1, 'image-variants': 1, 'local-fonts': 1,
};
export const FOUND_LEVEL = { sends: 1, acts: 1 };

const levelOf = (table, name) => (Object.prototype.hasOwnProperty.call(table, name) ? table[name] : 0);

export function modLevel(m) {
  if (m?.sandboxed) return Math.max(0, ...(Array.isArray(m.powers) ? m.powers : []).map((p) => levelOf(POWER_LEVEL, p)));
  const said = Number(m?.risk?.tier) || 0;
  const found = (Array.isArray(m?.found) ? m.found : []).map((f) => levelOf(FOUND_LEVEL, String(f).split(':')[0]));
  return Math.max(said, ...found);
}

const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the level means, for the chip's tooltip and the code card; '' at level 0. */
export function levelWords(m, site) {
  const level = modLevel(m);
  const why = !m?.sandboxed && m?.risk?.why ? ` ${m.risk.why}` : '';
  if (level >= 2) return `Changes requests: this mod changes what ${site} receives, which it could notice (rate limits or an account flag are possible).${why}`;
  if (level === 1) return `Noticeable: ${site} could tell something's different${m?.sandboxed && (m.powers || []).includes('site-data') ? ' (what it sends isn\'t all shown)' : ''}.${why}`;
  return '';
}

/** A boxed mod's powers in words: one line each (by name when this version has no words for it). */
export function powerLines(m) {
  if (!m?.sandboxed || !Array.isArray(m.powers)) return [];
  const facts = new Map((m.powerInfo?.facts || []).map((f) => [f.power, f.fact]));
  return m.powers.map((p) => (facts.get(p) ? `${p} ${facts.get(p)}` : p));
}

/** The row's chip, or null when there's nothing to say: {text, tone: 'muted'|'green'|'amber', title}. */
export function modChip(m, site) {
  const level = modLevel(m);
  const n = m?.sandboxed && Array.isArray(m.powers) ? m.powers.length : 0;
  const parts = [...(n ? [`${n} power${n === 1 ? '' : 's'}`] : []), ...(level >= 2 ? ['changes requests'] : level === 1 ? ['noticeable'] : [])];
  if (!parts.length) return null;
  const warnings = m?.sandboxed ? (m.powerInfo?.warnings || []) : [];
  const tone = level >= 2 || warnings.length ? 'amber' : n ? 'green' : 'muted';
  const title = [...powerLines(m), ...warnings.map(upper), ...(level ? [levelWords(m, site)] : [])].join('\n');
  return { text: parts.join(' · '), tone, title };
}
