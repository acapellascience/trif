// The approval card: every hold (a boxed mod's powers, a free mod TRIF found can do more, an agent's change
// waiting, a boxed mod this browser can't sandbox) as one card over the page, with Allow, Show code, Don't allow
// and Not now. The side panel's (sidepanel.js) and the All mods page's (allmods.js): one card, so a hold looks
// and is answered the same wherever it's found. Nothing here runs a mod: Allow and Don't allow are the
// background's mod.approve and mod.reject, which the helper checks against the hold's hash.
//
// createApproval({ request, openCode, tabId, site, changed }):
//   request(msg)   the page's way to the background (a promise of the reply)
//   openCode(id)   the code card for a mod (its "Show code" links)
//   tabId()        the tab to reload once a mod is allowed, or undefined
//   site(m)        the site the page is about (or mod m's), for "An agent wrote it in your chat on …" when its hold doesn't say
//   changed()      called when the queue or the card's open state changes (a "N waiting" badge, say)

import { el, button, cardRobot, addMore, powerTerm, warningTerm, siteOf, siteBoxes, freeWarning, fileLink, iconOf } from './cards.js';
import { warningByLine } from './explain.js';

export function createApproval({ request, openCode = () => {}, tabId = () => undefined, site = () => '', changed = () => {} }) {
  // ---- The approval dialog ---------------------------------------------------------------------------
  // Every hold (a boxed mod's powers, a free mod TRIF found can do more, an agent's change waiting, and a boxed
  // mod this browser can't sandbox) is one card centred over the dimmed panel: the mod, its kind, site and
  // file, what it asks for or what TRIF found, the combination warnings in red, one note line; Allow, Show code,
  // Not now (and × and Esc). Several waiting: "1 of N", one after another. It opens when a hold first appears,
  // or when the panel opens with something waiting; after Not now, only a new hold opens it again: the rows say
  // "on hold" and the badge at the top ("N waiting") reopens it.
  const approval = { queue: [], at: 0, seen: new Set(), done: new Set(), dialog: null, parts: null, shownKey: null };
  // (a group: several mods one side-panel run made or changed, waiting together: one card, groupHolds)
  const holdKey = (m) => (m.group ? m.group.map(holdKey).join('|') : `${m.id}@${(m.held || m.pending)?.hash || ''}`);
  const holdOf = (m) => (m.group ? holdOf(m.group[0]) : m.held || m.pending);
  // What waits for the user, as cards: the mods one side-panel run made or changed together (held for that run:
  // by 'agent', its runId) as one card; every other mod on its own.
  function groupHolds(list) {
    const out = [];
    const byRun = new Map();
    for (const m of list) {
      const h = holdOf(m);
      const run = h && h.by === 'agent' && h.runId ? h.runId : null;
      if (!run) { out.push(m); continue; }
      if (!byRun.has(run)) { const g = { id: m.id, name: m.name, group: [], runId: run }; byRun.set(run, g); out.push(g); }
      byRun.get(run).group.push(m);
    }
    return out.map((x) => (x.group && x.group.length === 1 ? x.group[0] : x));
  }

  function holdTag(m, text, labelId) {
    const b = el('button', 'tag on-hold', text);
    b.type = 'button';
    b.title = 'Waiting for your OK: open it';
    b.setAttribute('aria-describedby', labelId);
    b.addEventListener('click', () => openApproval(m.id));
    return b;
  }

  function approvalDialog() {
    if (approval.dialog) return approval.parts;
    const d = el('dialog', 'approval');
    d.id = 'approval';
    d.setAttribute('aria-labelledby', 'approval-name');
    const top = el('div', 'ap-top');
    const count = el('span', 'ap-count');
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.title = 'Not now';
    x.setAttribute('aria-label', 'Not now');
    top.append(count, x);
    const who = el('div', 'ap-who');
    const robot = el('span', 'ap-robot');
    robot.append(cardRobot());
    const nameBox = el('div');
    const name = el('h2', 'ap-name');
    name.id = 'approval-name';
    const meta = el('div', 'ap-meta');
    const chip = el('span', 'ap-chip');
    const where = el('span', 'ap-where');
    meta.append(chip, where);
    nameBox.append(name, meta);
    who.append(robot, nameBox);
    const lead = el('p', 'ap-lead');
    const facts = el('ul', 'ap-facts');
    const together = el('div', 'ap-together');
    const group = el('div', 'ap-group'); // (a request's several mods: renderGroup)
    const siteBox = el('div', 'ap-sites');
    const note = el('p', 'ap-note');
    const claim = el('p', 'ap-claim');
    const err = el('p', 'ap-err');
    err.setAttribute('role', 'alert');
    const codeBox = el('pre', 'ap-code');
    const allow = button('Allow', 'go ap-allow', () => decideApproval('mod.approve'));
    const show = button('Show code', 'ap-show', () => toggleApprovalCode());
    const reject = button('Don\'t allow', 'ap-reject', () => decideApproval('mod.reject'));
    reject.title = 'The version before stays; the change is kept in its history (trif history).';
    const later = button('Not now', 'text ap-later', () => notNow());
    x.addEventListener('click', () => notNow());
    const acts = el('div', 'ap-actions');
    acts.append(allow, show, reject, later);
    d.append(top, who, lead, facts, together, group, siteBox, note, claim, err, codeBox, acts);
    // Esc is Not now; Tab stays in the card (showModal makes the panel inert, and this keeps the focus from
    // leaving for the browser's own controls too)
    d.addEventListener('cancel', (e) => { e.preventDefault(); notNow(); });
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...d.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.closest('[hidden]') && n.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.append(d);
    approval.dialog = d;
    approval.parts = { count, name, chip, where, lead, facts, together, group, siteBox, note, claim, err, codeBox, allow, show, reject, later };
    return approval.parts;
  }

  // From renderMods: what's waiting here. Opens the dialog for a hold not seen before; keeps an open one in step.
  function updateApprovals(mods, { opens = () => true } = {}) {
    approval.queue = groupHolds(mods.filter((m) => holdOf(m) && !approval.done.has(holdKey(m))));
    const fresh = approval.queue.filter((m) => !approval.seen.has(holdKey(m)) && opens(m));
    const open = !!approval.dialog?.open;
    if (open) {
      const cur = approval.queue.findIndex((m) => holdKey(m) === approval.shownKey);
      if (cur >= 0) approval.at = cur;
      else approval.at = Math.min(approval.at, approval.queue.length - 1);
      if (!approval.queue.length) closeApproval();
      else renderApproval();
    } else if (fresh.length && !document.querySelector('dialog[open]:not(#approval)')) {
      // (not over another of TRIF's cards, an import's question say: it opens when that one's done)
      approval.at = approval.queue.indexOf(fresh[0]);
      showApproval();
    }
    changed();
  }

  function openApproval(id) {
    const i = approval.queue.findIndex((m) => m.id === id || (m.group && m.group.some((x) => x.id === id)));
    approval.at = i >= 0 ? i : 0;
    if (approval.queue.length) showApproval();
  }

  function showApproval() {
    approvalDialog();
    for (const m of approval.queue) approval.seen.add(holdKey(m));
    renderApproval();
    if (!approval.dialog.open) approval.dialog.showModal();
    changed();
  }

  function closeApproval() {
    if (approval.dialog?.open) approval.dialog.close();
    approval.shownKey = null;
    changed();
  }

  // Not now: the next one waiting, or close (the rows and the badge keep it findable)
  function notNow() {
    if (approval.at + 1 < approval.queue.length) { approval.at++; renderApproval(); return; }
    closeApproval();
  }

  function renderApproval() {
    const P = approvalDialog();
    const m = approval.queue[approval.at];
    if (!m) { closeApproval(); return; }
    const info = holdOf(m);
    const key = holdKey(m);
    const kind = m.held ? (info.by === 'sandbox' ? 'sandbox' : 'held') : 'pending';
    const n = approval.queue.length;
    P.count.textContent = n > 1 ? `${approval.at + 1} of ${n} waiting for your OK` : 'Waiting for your OK';
    // (the same hold: leave the code open, the buttons as they are; unless what it waits for changed, as when a
    // combination with another mod was approved on that one's card)
    const needsNow = JSON.stringify(m.group ? m.group.map((x) => holdOf(x).needs || []) : info.needs || []);
    if (approval.shownKey === key && approval.shownNeeds === needsNow) return;
    approval.shownKey = key;
    approval.shownNeeds = needsNow;
    approval.dialog.dataset.mod = m.id;
    P.group.hidden = !m.group;
    P.facts.hidden = !!m.group;
    // (no chip: the card is in its mod's tier colour, as the code card is: Tim, 11-13. A group's card: the
    // riskiest of its mods' colours, each mod keeping its chip)
    P.chip.hidden = true;
    const groupOf = (x) => (x.rules ? 'rules' : x.sandboxed ? 'sandboxed' : 'page');
    const tiers = (m.group || [m]).map(groupOf);
    approval.dialog.dataset.group = ['page', 'sandboxed', 'rules'].find((g) => tiers.includes(g));
    P.together.classList.remove('ap-free');
    if (m.group) { renderGroup(P, m); return; }
    P.name.textContent = m.name || m.id;
    const k = m.rules ? ['style', 'Style mod'] : m.sandboxed ? ['boxed', 'Boxed mod'] : ['free', 'Free mod'];
    P.chip.className = `ap-chip ${k[0]}`;
    P.chip.textContent = k[1];
    const file = String(m.file || '').split(/[\\/]/).pop() || `${m.id.split('/').pop()}.js`;
    P.where.replaceChildren(`${info.site || m.id.split('/')[0]} · `, fileLink(file, 'Show the code', () => openCode(m.id)));
    P.lead.textContent = info.asks ? 'It asks for these powers. TRIF holds it to them:'
      : kind === 'pending' ? 'A change to it is waiting. TRIF found that the new version:'
        : kind === 'sandbox' ? 'This browser can\'t run it in TRIF\'s sandbox:'
          : 'TRIF found that this mod:';
    // the lines: each power or finding with its icon; the combinations (power:together:…) in the red box,
    // the strongest first as the helper sent them, a sentence once
    const needs = Array.isArray(info.needs) ? info.needs : [];
    const all = (Array.isArray(info.facts) ? info.facts : [String(info.reason || '')]).map((f, i) => ({ f, key: needs[i] || '' }));
    const plain = all.filter((x) => x.f && !/^power:together:/.test(x.key) && !siteOf(x.key));
    const warns = [];
    for (const x of all) if (x.f && /^power:together:/.test(x.key) && !warns.some((w) => w.f === x.f)) warns.push(x);
    // (each line with its "more": a power's explanation, or a warning's)
    P.facts.replaceChildren(...plain.map((x) => {
      const li = el('li');
      const text = el('span', 'ap-text');
      text.append(el('span', 'ap-line', info.asks ? `It ${x.f}.` : x.f));
      li.append(el('span', 'ap-ic', iconOf(x.key)), addMore(text, info.asks ? powerTerm(x.key) : null));
      li.firstChild.setAttribute('aria-hidden', 'true');
      return li;
    }));
    P.together.replaceChildren(...warns.map((x) => {
      const line = el('p');
      const many = /^power:together:many:/.test(x.key);
      const words = el('span', 'ap-line');
      if (many) words.textContent = x.f;
      else words.append(el('b', null, 'Together,'), ` it ${x.f}.`);
      line.append(words);
      return addMore(line, many ? warningByLine(x.f) : warningTerm(`together, it ${x.f}`));
    }));
    P.together.hidden = !warns.length;
    // A free mod: what that means, as plainly as a boxed mod's warnings, its first words in coral (Tim, 11-13)
    const free = !m.rules && !m.sandboxed && kind !== 'sandbox';
    if (free) {
      const p = el('p');
      p.append(...freeWarning());
      P.together.replaceChildren(p);
      P.together.classList.add('ap-free');
      P.together.hidden = false;
    }
    // (then what it adds to its site's boxed mods together: helper/lib/sitecombos.js)
    P.siteBox.replaceChildren(...siteBoxes(info.reach));
    P.siteBox.hidden = !P.siteBox.childNodes.length;
    const fromAgent = kind !== 'sandbox' && info.by !== 'outside' && info.by !== 'switch' && info.by !== 'edit';
    const who = info.by === 'switch' ? 'You switched it on, and it adds to what this site\'s boxed mods can do together.' : info.by === 'edit' ? 'You edited it.' : m.imported && !fromAgent ? 'You imported it from a file.' : fromAgent ? `An agent ${kind === 'pending' ? 'changed' : 'wrote'} it in your chat on ${info.site || site(m)}.` : 'It\'s new or changed since TRIF last let it run.';
    P.note.textContent = kind === 'sandbox' ? 'Allow runs this version as a free mod, in this browser only.'
      : kind === 'pending' ? `${who} The version before keeps running until you decide.`
        : info.asks ? `${who} Updates that ask for the same powers won't ask again.`
          : who; // (a free mod's: its warning above says what it can do)
    P.claim.replaceChildren();
    P.claim.hidden = !info.claim;
    if (info.claim) P.claim.append(el('span', 'ap-claim-who', fromAgent ? 'The agent says: ' : 'The mod says: '), document.createTextNode(`“${info.claim}”`));
    P.err.hidden = true;
    P.err.textContent = '';
    P.codeBox.hidden = true;
    P.codeBox.replaceChildren();
    P.show.textContent = kind === 'pending' ? 'Show what changed' : 'Show code';
    P.show.hidden = false;
    P.reject.hidden = kind !== 'pending';
    for (const b of [P.allow, P.show, P.reject]) b.disabled = false;
  }

  // One card for the mods one side-panel run made or changed: each mod's lines under its name, with Show code (the
  // code card, over this one), then the site's box once; Allow is for all of them, Not now leaves them all waiting.
  function renderGroup(P, g) {
    const ms = g.group;
    const infos = ms.map(holdOf);
    const site = infos[0].site || ms[0].id.split('/')[0];
    P.name.textContent = `${ms.length} mods from one request`;
    P.where.replaceChildren(site);
    P.lead.textContent = infos.every((i) => i.asks) ? 'They ask for these powers. TRIF holds them to them:' : 'TRIF found that these mods:';
    P.together.replaceChildren();
    P.together.hidden = true;
    P.group.replaceChildren(...ms.map((m, n) => {
      const info = infos[n];
      const sec = el('section', 'ap-mod');
      const head = el('div', 'ap-mod-head');
      const kind = m.rules ? ['style', 'Style mod'] : m.sandboxed ? ['boxed', 'Boxed mod'] : ['free', 'Free mod'];
      head.append(el('b', 'ap-mod-name', m.name || m.id), el('span', `ap-chip ${kind[0]}`, kind[1]), fileLink('Show code', `Show the code of ${m.name || m.id}`, () => openCode(m.id), 'ap-mod-code'));
      if (m.pending && !m.held) head.append(el('span', 'ap-mod-change', 'changed'));
      const needs = Array.isArray(info.needs) ? info.needs : [];
      const all = (Array.isArray(info.facts) ? info.facts : [String(info.reason || '')]).map((f, i) => ({ f, key: needs[i] || '' }));
      const ul = el('ul', 'ap-facts');
      for (const x of all.filter((y) => y.f && !/^power:together:/.test(y.key) && !siteOf(y.key))) {
        const li = el('li');
        li.append(el('span', 'ap-ic', iconOf(x.key)), el('span', 'ap-line', info.asks ? `It ${x.f}.` : x.f));
        li.firstChild.setAttribute('aria-hidden', 'true');
        ul.append(li);
      }
      sec.append(head, ul);
      const warns = [...new Set(all.filter((y) => y.f && /^power:together:/.test(y.key)).map((y) => (/^power:together:many:/.test(y.key) ? y.f : `\u0000${y.f}`)))];
      if (warns.length) {
        const box = el('div', 'ap-together');
        for (const w of warns) { const p = el('p'); if (w[0] === '\u0000') p.append(el('b', null, 'Together,'), ` it ${w.slice(1)}.`); else p.textContent = w; box.append(p); }
        sec.append(box);
      }
      return sec;
    }));
    // (the site's box once: the widest reach of each site among them)
    const bySite = new Map();
    for (const r of infos.flatMap((i) => i.reach || [])) { const was = bySite.get(r.site); const size = (x) => x.see.length + x.act.length + x.go.length; if (!was || size(r) > size(was)) bySite.set(r.site, r); }
    P.siteBox.replaceChildren(...siteBoxes([...bySite.values()]));
    P.siteBox.hidden = !bySite.size;
    const agentWrote = infos.some((i) => i.by === 'agent');
    P.note.textContent = `${agentWrote ? `An agent made or changed them in your chat on ${site}.` : ''} Allow is for all of them; Not now leaves them all waiting.`.trim();
    P.claim.replaceChildren();
    P.claim.hidden = true;
    P.err.hidden = true;
    P.err.textContent = '';
    P.codeBox.hidden = true;
    P.codeBox.replaceChildren();
    P.show.hidden = true;
    P.reject.hidden = true;
    for (const b of [P.allow, P.show, P.reject]) b.disabled = false;
  }

  async function toggleApprovalCode() {
    const P = approval.parts;
    const m = approval.queue[approval.at];
    if (!m) return;
    const pending = !m.held && !!m.pending;
    if (!P.codeBox.hidden) { P.codeBox.hidden = true; P.show.textContent = pending ? 'Show what changed' : 'Show code'; return; }
    P.show.disabled = true;
    try {
      if (pending) {
        const r = await request({ type: 'mod.diff', id: m.id });
        P.codeBox.replaceChildren(...r.lines.map((l) => el('span', l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'ctx', `${l.t === '…' ? '…' : l.t} ${l.s}\n`)));
      } else {
        const r = await request({ type: 'mod.code', id: m.id });
        P.codeBox.textContent = r.code + (r.truncated ? '\n…' : '');
      }
      P.codeBox.hidden = false;
      P.show.textContent = pending ? 'Hide what changed' : 'Hide code';
    } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; } finally { P.show.disabled = false; }
  }

  async function decideApproval(type) {
    const P = approval.parts;
    const m = approval.queue[approval.at];
    if (!m) return;
    const info = holdOf(m);
    P.allow.disabled = P.reject.disabled = true;
    P.err.hidden = true;
    try {
      // (a request's mods: Allow is for all of them, one after another)
      if (m.group) { for (const x of m.group) { await request({ type, id: x.id, hash: holdOf(x).hash, tab: tabId() }); approval.done.add(holdKey(x)); } }
      else await request({ type, id: m.id, hash: info.hash, tab: tabId() });
      // (done here; the next status drops it too) on to the next one, or close
      approval.done.add(holdKey(m));
      approval.queue.splice(approval.at, 1);
      approval.shownKey = null;
      if (!approval.queue.length) closeApproval();
      else { approval.at = Math.min(approval.at, approval.queue.length - 1); renderApproval(); }
    } catch (e) {
      P.allow.disabled = P.reject.disabled = false;
      P.err.textContent = String(e?.message ?? e);
      P.err.hidden = false;
    }
    changed();
  }

  return { approval, holdKey, holdOf, groupHolds, holdTag, updateApprovals, openApproval, showApproval, closeApproval, renderApproval };
}
