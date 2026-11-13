// "Agent on this site": how far an agent (the side panel's, or one in a terminal using `trif`) may reach into
// a site's tabs. The user's choice per site, on the panel's line over the message box and in Settings:
//   off   the agent can't read, screenshot or run code on the site's tabs (it can still write mods for it,
//         which go through the holds like any other)
//   look  it can read the page and take screenshots, but not run code there
//   run   it can run code too (`trif run`), as before, with the tab lock (tablock.js)
// A site with no choice is "ask": the first time an agent wants to run code there, the panel asks (Just
// this once / Always on this site / Not here, which sets look); reading is allowed. A site on the sensitive
// list (email, money, passwords, chats with people and with other AIs) is off until the user raises it.
// background.js checks every agent command against this (agentGate) before it touches a tab.
//
// Pure functions, shared by background.js, the side panel and tests/agentsites.test.js.

export const AGENT_LEVELS = ['off', 'look', 'run'];

// The sensitive list TRIF starts with: [pattern, why]. A pattern is a host (and its subdomains), or with
// `*` inside a label, any label like it (`*bank*`: a label with "bank" in it; `*.bank`: the .bank domain).
// `why` finishes "It's …" in the panel's line for a site that's off by default.
export const SENSITIVE_DEFAULT = [
  ['mail.google.com', 'email'], ['outlook.live.com', 'email'], ['outlook.office.com', 'email'], ['outlook.office365.com', 'email'],
  ['mail.yahoo.com', 'email'], ['mail.proton.me', 'email'], ['account.proton.me', 'email'], ['icloud.com', 'email and your Apple account'],
  ['paypal.com', 'payments'], ['dashboard.stripe.com', 'payments'], ['wise.com', 'banking'], ['revolut.com', 'banking'], ['monzo.com', 'banking'],
  ['n26.com', 'banking'], ['chase.com', 'banking'], ['wellsfargo.com', 'banking'], ['citi.com', 'banking'], ['capitalone.com', 'banking'],
  ['americanexpress.com', 'banking'], ['schwab.com', 'banking'], ['fidelity.com', 'banking'], ['vanguard.com', 'banking'],
  ['hsbc.com', 'banking'], ['barclays.co.uk', 'banking'], ['td.com', 'banking'], ['rbc.com', 'banking'], ['rbcroyalbank.com', 'banking'],
  ['bmo.com', 'banking'], ['cibc.com', 'banking'], ['tangerine.ca', 'banking'], ['desjardins.com', 'banking'],
  ['*bank*', 'banking'], ['*.bank', 'banking'],
  ['1password.com', 'a password manager'], ['1password.ca', 'a password manager'], ['1password.eu', 'a password manager'],
  ['bitwarden.com', 'a password manager'], ['lastpass.com', 'a password manager'], ['dashlane.com', 'a password manager'],
  ['discord.com', 'your messages'], ['web.whatsapp.com', 'your messages'],
  ['chatgpt.com', 'your chats with another AI'], ['openai.com', 'your chats with another AI'], ['claude.ai', 'your chats with another AI'],
];

/** A host as the setting names it: lower case, without a leading www. */
export function agentSiteOf(hostOrUrl) {
  let h = String(hostOrUrl || '').trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(h)) { try { h = new URL(h).hostname; } catch { return ''; } }
  h = h.replace(/\.$/, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+$/.test(h) && h.includes('.') ? h : '';
}

/** Whether `host` is matched by a sensitive pattern (a host and its subdomains; `*` within a label). */
export function patternMatches(pattern, host) {
  const p = String(pattern || '').trim().toLowerCase().replace(/^www\./, '');
  const h = String(host || '').toLowerCase();
  if (!p || !h) return false;
  if (!p.includes('*')) return h === p || h.endsWith(`.${p}`);
  const labels = h.split('.');
  const pl = p.split('.');
  const re = (lab) => new RegExp(`^${lab.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')).join('[a-z0-9-]*')}$`);
  if (pl.length === 1) return labels.some((l) => re(pl[0]).test(l)); // (`*bank*`: any label)
  // (several labels: the host's last labels, as a suffix: `*.bank`)
  if (labels.length < pl.length) return false;
  const tail = labels.slice(labels.length - pl.length);
  return pl.every((lab, i) => re(lab).test(tail[i]));
}

/** The sensitive list in use: the user's (from Settings), else TRIF's. [{pattern, why}] */
export function sensitiveList(user) {
  if (Array.isArray(user)) return user.map((x) => (typeof x === 'string' ? { pattern: x, why: '' } : { pattern: String(x?.pattern || ''), why: String(x?.why || '') })).filter((x) => x.pattern);
  return SENSITIVE_DEFAULT.map(([pattern, why]) => ({ pattern, why }));
}

/** Clean what storage holds: {site: level} with known levels and sites. */
export function normalizeAgentSites(v) {
  const out = {};
  if (v && typeof v === 'object') for (const [k, l] of Object.entries(v)) { const s = agentSiteOf(k); if (s && AGENT_LEVELS.includes(l)) out[s] = l; }
  return out;
}

/**
 * A host's level: {level: 'off'|'look'|'run'|'ask', by: 'user'|'sensitive'|'default', site, why?, pattern?}.
 * The user's choice for the host itself first; then the sensitive list (off); then their choice for a parent
 * domain (google.com's doesn't raise mail.google.com, which is on the list); then ask.
 */
export function agentLevel(hostOrUrl, { sites = {}, sensitive = null } = {}) {
  const site = agentSiteOf(hostOrUrl);
  if (!site) return { level: 'ask', by: 'default', site: '' };
  if (sites[site]) return { level: sites[site], by: 'user', site };
  const hit = sensitiveList(sensitive).find((x) => patternMatches(x.pattern, site));
  if (hit) return { level: 'off', by: 'sensitive', site, why: hit.why, pattern: hit.pattern };
  const labels = site.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    const parent = labels.slice(i).join('.');
    if (sites[parent]) return { level: sites[parent], by: 'user', site, from: parent };
  }
  return { level: 'ask', by: 'default', site };
}

// What each agent command needs on the site of the tab (or address) it works on. Not here: commands that
// touch no page (status without a tab, mod files, switches), which work at every level.
// (`run.box`: `trif run` in TRIF's box (background.js boxedRun): code that can read the page and change what
// it shows, and can't send or act. It needs no asking where the site's level is still "ask": the question is
// for code in the page's own world. Where the user said Look or Off, it's refused like any code.)
export const COMMAND_NEEDS = {
  run: 'run', 'run.box': 'box',
  text: 'look', sweep: 'look', screenshot: 'look', requests: 'look', request: 'look', errors: 'look', logs: 'look', record: 'look',
  reload: 'look', navigate: 'look', open: 'look', close: 'look', status: 'look',
};

const WORDS = { off: 'Off', look: 'Look', run: 'Run code', ask: 'Ask' };
export const levelWord = (l) => WORDS[l] || l;

/**
 * Whether a command may go ahead on a host: 'ok', 'ask' (code on a site set to ask: the panel asks the
 * user), or an Error-ready message for the agent, saying the level and what still works.
 */
export function agentCheck(cmd, hostOrUrl, settings) {
  const need = COMMAND_NEEDS[cmd];
  if (!need) return 'ok';
  const lv = agentLevel(hostOrUrl, settings);
  if (lv.level === 'run') return 'ok';
  if (lv.level === 'look') return need === 'look' ? 'ok' : `the user has set "Agent on this site" to Look for ${lv.site}: you can read the page and take screenshots there, but not run code (trif run). Work from what you can read, or ask the user to set it to Run code in TRIF's side panel`;
  if (lv.level === 'ask') return need === 'look' || need === 'box' ? 'ok' : 'ask';
  const why = lv.by === 'sensitive' ? ` (it's ${lv.why || 'on TRIF\'s list of sensitive sites'}, so it's off unless the user raises it)` : '';
  return `"Agent on this site" is Off for ${lv.site}${why}: you can't read, screenshot or run code on its tabs. You can still write mods for it (any that can do more than change the page wait for the user's OK, as usual); the user can change the setting in TRIF's side panel`;
}
