// Two TRIFs in one browser profile: the one loaded unpacked (~/.trif/app/extension, or a checkout: the dev
// ID) and the Chrome Web Store's. Someone moving to the store's has both for a while, and both would run
// every mod on a site both are on (twice: a text swap doubled, two copies of a button). So each asks the
// other TRIF IDs the helper names (its 'identity' message: helper/host.js sendIdentity) over Chrome's
// extension-to-extension messages, and the unpacked one leaves every site the store's runs mods on to it
// (`ceded`), running only the rest: nothing stops before the store's TRIF has it (Chrome gives each its own
// site access, switches and chats, so moving is site by site). Both panels say to remove the unpacked one.
//
// Only the IDs the helper names are answered or believed (Chrome sets sender.id; a page can't send these:
// no externally_connectable matches). Pure helpers here; background.js does the messaging.

export const TWIN_MESSAGE = 'trif.twin';

/** The identity message, checked: { id, kind, others: [{id, kind}] }, or null. */
export function normalizeIdentity(msg) {
  const isId = (x) => typeof x === 'string' && /^[a-p]{32}$/.test(x);
  const kinds = new Set(['unpacked', 'store', 'other']);
  if (!msg || !isId(msg.id) || !kinds.has(msg.kind)) return null;
  const others = (Array.isArray(msg.others) ? msg.others : [])
    .filter((o) => o && isId(o.id) && o.id !== msg.id && kinds.has(o.kind)).slice(0, 8).map((o) => ({ id: o.id, kind: o.kind }));
  return { id: msg.id, kind: msg.kind, others };
}

/** What a TRIF tells another about itself (asking, and answering): whether it runs mods, and where. */
export function twinState({ version, kind, connected, userScripts, paused, sites }) {
  const ready = !!connected && !!userScripts && !paused;
  return { type: TWIN_MESSAGE, version: String(version || ''), kind, ready, sites: ready ? [...(sites || [])].slice(0, 2000) : [] };
}

/**
 * A twin's message as this TRIF keeps it ({id, kind, version, ready, sites}), or null if it isn't from one
 * of the other TRIFs the helper named. `kind` is the helper's word for that ID, never the message's.
 */
export function readTwin(identity, senderId, msg) {
  const known = identity?.others?.find((o) => o.id === senderId);
  if (!known || !msg || msg.type !== TWIN_MESSAGE) return null;
  const sites = Array.isArray(msg.sites) ? msg.sites.filter((s) => typeof s === 'string' && s.length < 260).slice(0, 2000) : [];
  return { id: senderId, kind: known.kind, version: typeof msg.version === 'string' ? msg.version.slice(0, 20) : '', ready: msg.ready === true, sites: msg.ready === true ? sites : [] };
}

/**
 * The sites this TRIF leaves to a twin: only the unpacked one leaves any, and only those a store (or
 * other) TRIF runs mods on now. An exact match: a site this one has on that the other doesn't stays here.
 */
export function cededSites(identity, twins) {
  if (identity?.kind !== 'unpacked') return [];
  const out = new Set();
  for (const t of twins || []) if (t.kind !== 'unpacked' && t.ready) for (const s of t.sites) out.add(s);
  return [...out].sort();
}

/** What the panel says about a twin (sidepanel.js renderTwin): null when there's none. */
export function twinNotice(identity, twins) {
  if (!identity || !twins?.length) return null;
  if (identity.kind === 'unpacked') {
    const store = twins.find((t) => t.kind !== 'unpacked');
    return store ? { me: 'unpacked', other: store.id, ceded: cededSites(identity, twins).length, otherReady: store.ready } : null;
  }
  const unpacked = twins.find((t) => t.kind === 'unpacked');
  return unpacked ? { me: identity.kind, other: unpacked.id, otherRunning: unpacked.ready && unpacked.sites.length > 0 } : null;
}
