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
  // (a mod's own words after ours: a sentence of its own, capital first, full stop last)
  const said = !m?.sandboxed && m?.risk?.why ? String(m.risk.why).trim() : '';
  const why = said ? ` ${upper(said)}${/[.!?]$/.test(said) ? '' : '.'}` : '';
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

// Each icon's hover: a few words, the same for every mod (Tim, 11-13: the user has seen and allowed the full
// warnings once; they're in the code card's Details tab). A power newer than this table: its name.
export const ICON_LABELS = {
  'read-drafts': 'Reads what you type', 'write-drafts': 'Changes what you type', keys: 'Sees your key presses',
  'site-data': 'Filters what the site sends', 'page-data': 'Reads the page\'s data', 'site-storage': 'Uses the site\'s storage',
  'local-fonts': 'Sees your fonts', 'image-variants': 'Loads other picture sizes', sound: 'Plays sounds', controls: 'Adds its own controls',
  mods: 'Talks to your other mods', preload: 'Loads pictures sooner', media: 'Plays and pauses media', 'search-box': 'Adds a search box',
  'go-to': 'Takes you to pages', embeds: 'Plays linked videos', 'rewrite-requests': 'Changes the site\'s requests',
  'block-events': 'Hides your actions from the site', 'page-events': 'Signals the page', click: 'Clicks for you',
  'edit-uploads': 'Edits pictures you post', '@migrate': 'Brings over old settings', noticeable: 'Noticeable to the site',
  'changes-requests': 'Changes what the site receives',
  free: 'Runs as code, with no limits', // (a free mod's chip and infinity, one icon: Tim, 11-13)
};

/**
 * The row's icons (extension/icons.js), in place of the chip's words: one per power, then one for how noticeable
 * it is, each with its few words on hover (ICON_LABELS), all the same grey. [] when there's nothing to say.
 * Each: {key: an ICONS key, title, tone: 'muted'}.
 */
export function modIcons(m, site) {
  const level = modLevel(m);
  const out = [];
  if (m?.sandboxed) {
    const facts = new Map((m.powerInfo?.facts || []).map((f) => [f.power, f.fact]));
    for (const p of Array.isArray(m.powers) ? m.powers : []) out.push({ key: p, title: ICON_LABELS[p] || p, tone: 'muted', power: p });
    if (facts.has('migrate')) out.push({ key: '@migrate', title: ICON_LABELS['@migrate'], tone: 'muted', power: 'migrate' });
  }
  // A free mod (not boxed, not a style mod): the chip and infinity, whatever its code reading found, so it
  // doesn't look harmless beside a boxed mod's powers; then the eye only where something was found (Tim, 11-13).
  if (m && !m.sandboxed && !m.rules) out.push({ key: 'free', keys: ['cpu', 'infinity'], title: ICON_LABELS.free, tone: 'muted' });
  if (level >= 2) out.push({ key: 'changes-requests', title: ICON_LABELS['changes-requests'], tone: 'muted', level });
  else if (level === 1) out.push({ key: 'noticeable', title: ICON_LABELS.noticeable, tone: 'muted', level });
  return out;
}
