'use strict';
// The Mods tab's code (mods.html, branch ios-poc): the desktop side panel's mods list rebuilt from the app's state
// (ModsPanel.swift modsState), with the panel's own markup and classes so its styles apply as they are: the tiers
// with their On / Off and "i" (sidepanel.js groupHeading, openTierCard), each mod's row (modItem: the light, the
// name, the power icons, one tag, the switch or "on hold", the description, </> and the bin), the approval card
// (renderApproval), the code card (codeViewDialog: Details, Code, History with See differences and Restore).
// Every change is a message to the app (ask), which answers and sends the state again (trifRender).
// What isn't here, and why: dragging rows into an order (a phone scrolls), Open in editor / Show in Finder (no
// files to show), a fix run's Undo fix and an update's notice (no agent runs or shipped mods on the phone yet),
// the review note (every mod here was read when it came).

(() => {
  const K = globalThis.__trifPanel;
  const { iconSvg, modIcons, modLevel, levelWords, term, moreText, warningByLine, modSwitch, syncSwitches, shownEnabled, switchError, onSwitchChange } = K;
  const ask = (msg) => window.webkit.messageHandlers.app.postMessage(msg);
  const $ = (id) => document.getElementById(id);
  const ui = { list: $('mod-list'), empty: $('mods-empty'), undo: $('undo-note'), undoText: $('undo-text'), hiddenBox: $('hidden-box'), hiddenList: $('hidden-list'), tip: $('icon-tip') };
  const view = { state: null, rows: new Map(), foldOpen: false, foldFor: null };

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label, className, onClick) {
    const b = el('button', className ? `btn ${className}` : 'btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  const errText = (e) => String((e && e.message) || e);

  // ---- the tiers (sidepanel.js GROUP_TEXT; lib.js GROUPS, GROUP_NAMES) ----------------------------------------
  const GROUPS = ['rules', 'sandboxed', 'page'];
  const GROUP_TEXT = {
    rules: ['Style mods', 'Change how the page looks.'],
    sandboxed: ['Boxed mods', 'Do what you\'ve allowed.'],
    page: ['Free mods', 'Anything code can do.'],
  };
  const TIER_TERMS = { rules: 'style-mods', sandboxed: 'boxed-mods', page: 'free-mods' };
  const modGroup = (m) => (m.rules ? 'rules' : m.sandboxed ? 'sandboxed' : 'page');
  const site = () => view.state?.site || '';
  const groupOff = (g) => (view.state?.groupsOff || []).includes(g);
  const switchSite = (m) => (m.multi ? site() : undefined);

  // "more": a line's explanation (explain.json), unfolded in place under it (sidepanel.js addMore)
  let moreSeq = 0;
  function addMore(host, t) {
    const text = moreText(t);
    if (!text) return host;
    const box = el('span', 'more-text', text);
    box.id = `more-${++moreSeq}`;
    box.hidden = true;
    const btn = el('button', 'more-btn');
    btn.type = 'button';
    btn.append(iconSvg('info'));
    btn.title = 'More';
    btn.setAttribute('aria-label', 'More');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', box.id);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      box.hidden = !box.hidden;
      btn.classList.toggle('open', !box.hidden);
      btn.title = box.hidden ? 'More' : 'Less';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', String(!box.hidden));
    });
    host.append(' ', btn, box);
    return host;
  }
  const powerTerm = (key) => { const p = /^power:([\w-]+)/.exec(String(key || '')); return p && p[1] !== 'together' ? term('powers', p[1]) : null; };
  const warningTerm = (s) => { const t = String(s || '').trim(); const u = t.charAt(0).toUpperCase() + t.slice(1); return warningByLine(u) || warningByLine(`${u}.`); };

  // The robot on TRIF's cards (sidepanel.js cardRobot): his frame and eyes from the panel's bar, or </> for eyes.
  function cardRobot(face = 'eyes') {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.setAttribute('aria-hidden', 'true');
    for (const cls of ['rim', 'face', ...(face === 'eyes' ? ['eye'] : [])]) {
      for (const p of K.ROBOT.filter((x) => x.cls === cls)) {
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('class', cls);
        poly.setAttribute('points', p.points);
        svg.append(poly);
      }
    }
    if (face === 'code') {
      const code = document.createElementNS(NS, 'path');
      code.setAttribute('class', 'code');
      code.setAttribute('d', 'M48 47 L31 64 L48 81 M80 47 L97 64 L80 81 M71 40 L57 88');
      svg.append(code);
    }
    return svg;
  }

  // The tier's card: its name, line and whole explanation (sidepanel.js openTierCard)
  function openTierCard(g) {
    const t = term('tiers', TIER_TERMS[g]);
    if (!t) return;
    let d = $('tier-card');
    if (!d) {
      d = el('dialog', 'approval tier-card');
      d.id = 'tier-card';
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      document.body.append(d);
    }
    d.dataset.group = g;
    const head = el('div', 'tc-head');
    const name = el('h2', 'tc-name', GROUP_TEXT[g][0]);
    name.id = 'tier-card-name';
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => d.close());
    head.append(name, x);
    const body = el('div', 'tc-body');
    body.append(el('p', 'tc-line', t.line));
    for (const para of moreText(t).split(/\n\s*\n/)) if (para.trim()) body.append(el('p', null, para.trim()));
    d.replaceChildren(head, body);
    d.setAttribute('aria-labelledby', name.id);
    if (!d.open) d.showModal();
  }

  const collapsed = new Set();
  try { for (const g of JSON.parse(localStorage.getItem('groupsCollapsed') || '[]')) collapsed.add(g); } catch { /* none */ }
  const headings = new Map();
  function applyCollapsed() {
    ui.list.dataset.collapsed = [...collapsed].join(' ');
    for (const [g, li] of headings) {
      li.classList.toggle('collapsed', collapsed.has(g));
      li.querySelector('.group-toggle')?.setAttribute('aria-expanded', String(!collapsed.has(g)));
    }
  }
  function groupHeading(g) {
    let li = headings.get(g);
    if (!li) {
      li = el('li', 'mod-group');
      li.dataset.group = g;
      const id = `mod-group-${g}`;
      const name = el('h3', 'mod-group-name');
      name.id = id;
      const toggle = el('button', 'group-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.append(el('span', 'group-name-text', GROUP_TEXT[g][0]), el('span', 'group-count'));
      toggle.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>');
      toggle.addEventListener('click', () => {
        if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g);
        try { localStorage.setItem('groupsCollapsed', JSON.stringify([...collapsed])); } catch { /* this time only */ }
        applyCollapsed();
      });
      name.append(toggle);
      const sw = el('div', 'group-switch');
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-labelledby', id);
      const setGroup = async (on) => {
        if (sw.hasAttribute('aria-busy') || on === !groupOff(g)) return;
        sw.setAttribute('aria-busy', 'true');
        try { await ask({ type: 'group', group: g, enabled: on }); } catch (e) { showUndo(`Couldn't switch ${GROUP_TEXT[g][0]} ${on ? 'on' : 'off'}: ${errText(e)}`, false); }
        finally { sw.removeAttribute('aria-busy'); }
      };
      for (const on of [false, true]) {
        const btn = el('button', 'gs-btn', on ? 'On' : 'Off');
        btn.type = 'button';
        btn.dataset.on = String(on);
        btn.addEventListener('click', () => setGroup(on));
        sw.append(btn);
      }
      const row = el('div', 'mod-group-row');
      row.append(name, sw);
      const note = el('p', 'mod-group-note', GROUP_TEXT[g][1]);
      if (moreText(term('tiers', TIER_TERMS[g]))) {
        const info = el('button', 'more-btn tier-info');
        info.type = 'button';
        info.append(iconSvg('info'));
        info.title = `About ${GROUP_TEXT[g][0].toLowerCase()}`;
        info.setAttribute('aria-label', info.title);
        info.setAttribute('aria-haspopup', 'dialog');
        info.addEventListener('click', (e) => { e.stopPropagation(); openTierCard(g); });
        note.append(' ', info);
      }
      li.append(row, note);
      headings.set(g, li);
      applyCollapsed();
    }
    const off = groupOff(g);
    const sw = li.querySelector('.group-switch');
    for (const btn of sw.querySelectorAll('.gs-btn')) btn.setAttribute('aria-pressed', String((btn.dataset.on === 'true') === !off));
    sw.title = off ? `Off on ${site()}: none of these run here. Tap to switch them on here.` : `On on ${site()}: tap to stop all of these running here (each mod's own switch is kept).`;
    li.classList.toggle('off', off);
    return li;
  }

  // ---- a mod's row (sidepanel.js modItem, updateModItem) -----------------------------------------------------
  const CODE_ICON = '<svg class="code-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.7 4 .9 8l3.8 4M11.3 4l3.8 4-3.8 4M9.3 2.3 6.7 13.7"/></svg>';
  const BIN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V2.75h3V4.5M4 4.5l.7 8.75h6.6L12 4.5M6.75 7v4M9.25 7v4"/></svg>';
  let labelSeq = 0;

  function holdTag(m, text, labelId) {
    const b = el('button', 'tag on-hold', text);
    b.type = 'button';
    b.title = 'Waiting for your OK: open it';
    b.setAttribute('aria-describedby', labelId);
    b.addEventListener('click', () => openApproval(m.id));
    return b;
  }

  function showIconTip(box, m, icons) {
    const tip = ui.tip;
    const ul = el('ul');
    for (const i of icons) {
      const li = el('li');
      const svgs = (i.keys || [i.key]).map(iconSvg).filter(Boolean);
      li.append(...svgs, el('span', null, i.title));
      ul.append(li);
    }
    const more = button('Details', 'link-btn', () => { hideTip(); openCodeView(m.id, { tab: 'details' }); });
    tip.replaceChildren(ul, more);
    tip.hidden = false;
    const r = box.getBoundingClientRect();
    const w = Math.min(tip.offsetWidth, window.innerWidth - 32);
    tip.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - 16 - w))}px`;
    const below = r.bottom + 6;
    tip.style.top = `${below + tip.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - 6 - tip.offsetHeight) : below}px`;
  }
  function hideTip() { ui.tip.hidden = true; }
  document.addEventListener('click', (e) => { if (!ui.tip.hidden && !ui.tip.contains(e.target) && !e.target.closest('.mod-icons')) hideTip(); }, true);
  window.addEventListener('scroll', hideTip, { passive: true });

  function modItem(m) {
    const li = el('li');
    li.dataset.mod = m.id;
    li.dataset.group = modGroup(m);
    const labelId = `mod-name-${++labelSeq}`;
    const name = el('h3', 'mod-name');
    const light = el('span', 'light');
    const label = el('span', null, m.name);
    label.id = labelId;
    name.append(label);
    const icons = modIcons(m, site());
    if (icons.length) {
      const box = el('button', 'mod-icons');
      box.type = 'button';
      box.setAttribute('aria-label', icons.map((i) => i.title).join('\n'));
      box.setAttribute('aria-describedby', labelId);
      icons.forEach((i, n) => {
        if (n && i.level && !icons[n - 1].level) box.append(el('span', 'mod-ic-sep'));
        const ic = el('span', `mod-ic ${i.tone}`);
        ic.dataset.icon = i.key;
        ic.title = i.title;
        const svgs = (i.keys || [i.key]).map(iconSvg).filter(Boolean);
        if (svgs.length) ic.append(...svgs); else ic.textContent = i.key;
        box.append(ic);
      });
      // (no hover on a phone: a tap shows what each icon says, with Details)
      box.addEventListener('click', (e) => { e.stopPropagation(); if (!ui.tip.hidden && ui.tip.dataset.mod === m.id) { hideTip(); return; } ui.tip.dataset.mod = m.id; showIconTip(box, m, icons); });
      name.append(box);
    }
    const tag = el('span', 'tag row-tag');
    tag.dataset.rank = '3';
    tag.hidden = true;
    name.append(tag);
    if (m.pending && !m.held) {
      const t = holdTag(m, 'change on hold', labelId);
      t.classList.add('row-tag');
      t.dataset.rank = '1';
      name.append(t);
    }
    if (Array.isArray(m.errors) && m.errors.length) {
      const badge = el('button', 'tag err-badge row-tag', m.errors.length > 1 ? `${m.errors.length} errors` : 'error');
      badge.dataset.rank = '2';
      badge.type = 'button';
      badge.title = `New error: ${m.errors[0]}`;
      badge.addEventListener('click', (e) => { e.stopPropagation(); openCodeView(m.id, { error: { message: m.errors[0] } }); });
      name.append(badge);
    }
    const main = el('div', 'mod-main');
    const desc = m.description ? el('div', 'mod-desc', m.description) : null;
    if (desc) desc.title = m.description;
    main.append(light, name);
    const row = el('div', 'mod-row');
    const right = el('div', 'mod-right');
    const tools = el('div', 'mod-tools');
    const apply = (id, enabled, s) => ask({ type: 'enable', id, enabled, ...(s ? { site: s } : {}) });
    if (m.held) {
      li.classList.add('held');
      right.append(holdTag(m, 'on hold', labelId));
    } else {
      right.append(modSwitch(document, { id: m.id, site: switchSite(m), enabled: m.on, labelId, apply }));
    }
    const code = el('button', 'icon-btn mod-code');
    code.type = 'button';
    code.title = 'Show code';
    code.setAttribute('aria-label', 'Show code');
    code.setAttribute('aria-describedby', labelId);
    code.innerHTML = CODE_ICON;
    code.addEventListener('click', () => openCodeView(m.id));
    const bin = el('button', 'icon-btn mod-delete');
    bin.type = 'button';
    bin.title = 'Delete';
    bin.setAttribute('aria-label', 'Delete');
    bin.setAttribute('aria-describedby', labelId);
    bin.innerHTML = BIN_ICON;
    bin.addEventListener('click', async () => {
      bin.disabled = true;
      try { await ask({ type: 'delete', id: m.id }); } catch (e) { bin.disabled = false; rowError(li, errText(e)); }
    });
    tools.append(code, bin);
    const grip = el('span', 'mod-grip');
    row.append(grip, main, right, ...(desc ? [desc] : []), tools);
    const err = el('div', 'mod-err');
    err.hidden = true;
    li.append(row, err);
    return li;
  }

  function rowError(li, text) {
    const err = li.querySelector('.mod-err');
    err.textContent = text;
    err.hidden = !text;
  }

  function showOneTag(li, held) {
    const all = [...li.querySelectorAll('.mod-name .row-tag')];
    for (const t of all) if (!t.textContent) t.hidden = true;
    const tags = all.filter((t) => t.textContent).sort((a, b) => a.dataset.rank - b.dataset.rank);
    tags.forEach((t, i) => { t.hidden = held || i > 0; });
  }

  function updateModItem(li, m) {
    li.classList.toggle('group-off', groupOff(modGroup(m)));
    const light = li.querySelector('.light');
    if (m.held) {
      light.classList.remove('on');
      light.title = 'On hold';
      li.querySelector('.tag').textContent = '';
      showOneTag(li, true);
      rowError(li, '');
      return;
    }
    const on = shownEnabled(m.id, m.on, switchSite(m));
    li.classList.toggle('off', !on);
    const running = on && m.applies && !groupOff(modGroup(m)) && m.running;
    light.classList.toggle('on', running);
    light.title = running ? 'Running on this page' : !on ? 'Switched off' : 'Not running on this page';
    const tag = li.querySelector('.tag');
    tag.textContent = !on && m.newOff ? (m.newOff === 'update' ? 'updated' : 'new') : '';
    tag.title = !on && m.newOff === 'update' ? 'You imported a new version of it, so TRIF switched it off: switch it on once you\'ve looked at it.'
      : !on && m.newOff ? 'TRIF switched it off because it came from outside your chat: switch it on once you\'ve looked at it.' : '';
    showOneTag(li, false);
    rowError(li, switchError(m.id, switchSite(m)) || (m.cant ? 'Can\'t run here on iPhone: this page didn\'t let it start.' : ''));
  }

  let foldLi = null;
  function foldLine(n) {
    if (!foldLi) {
      foldLi = el('li', 'mods-fold');
      const b = el('button', 'mods-fold-btn');
      b.type = 'button';
      b.append(el('span', 'mods-fold-text'));
      b.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>');
      b.addEventListener('click', () => { view.foldOpen = !view.foldOpen; renderMods(); });
      foldLi.append(b);
    }
    foldLi.querySelector('.mods-fold-text').textContent = `${n} more for other ${site()} pages`;
    foldLi.querySelector('.mods-fold-btn').setAttribute('aria-expanded', String(!!view.foldOpen));
    foldLi.classList.toggle('open', !!view.foldOpen);
    return foldLi;
  }

  function renderMods() {
    const st = view.state;
    const mods = GROUPS.flatMap((g) => (st?.mods || []).filter((m) => modGroup(m) === g));
    if (view.foldFor !== st?.site) { view.foldFor = st?.site; view.foldOpen = false; }
    // (the ones whose @match doesn't cover this page fold into one line at the bottom, as on desktop)
    const other = st?.url ? mods.filter((m) => !m.applies) : [];
    const otherIds = new Set(other.map((m) => m.id));
    const shown = view.foldOpen ? mods : mods.filter((m) => !otherIds.has(m.id));
    ui.empty.hidden = mods.length > 0;
    ui.empty.textContent = st?.site ? `No mods for ${st.site} yet. Open the chat, say what to fix, and add the mod it writes.` : 'Open a site to see its mods.';
    const rows = new Map();
    for (const m of mods) {
      const key = JSON.stringify([st.site, m.name, m.description, m.held || null, m.pending || null, m.powers, m.powerInfo, m.risk || null, m.errors, m.matches, m.multi, m.sandboxed, m.rules]);
      const old = view.rows.get(m.id);
      rows.set(m.id, old && old.key === key ? old : { key, li: modItem(m) });
    }
    view.rows = rows;
    const want = [];
    for (const g of GROUPS) {
      const inGroup = shown.filter((m) => modGroup(m) === g);
      if (!inGroup.length && !(groupOff(g) && mods.some((m) => modGroup(m) === g))) continue;
      want.push(groupHeading(g), ...inGroup.map((m) => rows.get(m.id).li));
    }
    if (other.length) want.push(foldLine(other.length));
    want.forEach((li, i) => { if (ui.list.children[i] !== li) ui.list.insertBefore(li, ui.list.children[i] || null); });
    while (ui.list.children.length > want.length) ui.list.lastElementChild.remove();
    const byId = new Map(mods.map((m) => [m.id, m]));
    for (const li of ui.list.children) if (li.dataset.mod) updateModItem(li, byId.get(li.dataset.mod));
    for (const [g, li] of headings) {
      const inGroup = mods.filter((m) => modGroup(m) === g);
      const on = inGroup.filter((m) => !m.held && shownEnabled(m.id, m.on, switchSite(m))).length;
      const count = li.querySelector('.group-count');
      count.replaceChildren(el('span', 'gc-on', String(on)), el('span', 'gc-all', `/${inGroup.length}`));
      count.title = `${on} of ${inGroup.length} switched on`;
    }
    syncSwitches(ui.list, (id) => byId.get(id)?.on);
    renderHidden();
    updateApprovals(mods);
  }
  onSwitchChange(() => renderMods());

  // ---- what was hidden by pointing (the phone's own: a long press on the page) --------------------------------
  function renderHidden() {
    const list = view.state?.hidden || [];
    ui.hiddenBox.hidden = !list.length;
    ui.hiddenList.replaceChildren(...list.map((h) => {
      const li = el('li');
      const show = button('Show again', 'link-btn', async () => { show.disabled = true; try { await ask({ type: 'unhide', id: h.id }); } catch { show.disabled = false; } });
      li.append(el('code', null, h.selector), show);
      return li;
    }));
  }

  // ---- Undo after a delete --------------------------------------------------------------------------------
  function showUndo(text, undo) {
    ui.undoText.textContent = text;
    $('undo-btn').hidden = !undo;
    ui.undo.hidden = !text;
  }
  $('undo-btn').addEventListener('click', async () => { try { await ask({ type: 'undoDelete' }); } catch { /* gone */ } });
  $('import-mod').addEventListener('click', () => ask({ type: 'import' }));

  // ---- the approval card (sidepanel.js approvalDialog, renderApproval, decideApproval) ------------------------
  const holdOf = (m) => m.held || m.pending;
  const holdKey = (m) => `${m.id}@${holdOf(m)?.hash || ''}:${(holdOf(m)?.needs || []).join(',')}`;
  const approval = { dialog: null, parts: null, queue: [], at: 0, seen: new Set(), done: new Set(), shownKey: null };
  const FACT_ICONS = {
    'read-drafts': '✎', keys: '⌨', 'site-data': '⇣', 'page-data': '◫', sound: '♪', controls: '◐', mods: '⇆', media: '▶',
    'search-box': '⌕', 'go-to': '↪', click: '◉', 'write-drafts': '⇄',
    'site-storage': '▤', 'local-fonts': 'Aa', 'image-variants': '▣', preload: '⇡', embeds: '▷', 'rewrite-requests': '⇌', 'block-events': '⊘', 'page-events': '↯', 'edit-uploads': '⧉', migrate: '⇢',
    sends: '↗', loads: '↗', site: '↗', acts: '◉', navigates: '↪', hidden: '?', match: '◎', risk2: '⚠',
  };
  const iconOf = (key) => { const k = String(key || ''); const p = /^power:([\w-]+)/.exec(k); return FACT_ICONS[p ? p[1] : k.split(':')[0]] || '•'; };
  const freeWarning = () => [el('b', null, 'A free mod can do anything the page can do,'), ' including posting or sending as you. Only enable free mods that you trust.'];

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
    chip.hidden = true;
    const where = el('span', 'ap-where');
    meta.append(chip, where);
    nameBox.append(name, meta);
    who.append(robot, nameBox);
    const lead = el('p', 'ap-lead');
    const facts = el('ul', 'ap-facts');
    const together = el('div', 'ap-together');
    const note = el('p', 'ap-note');
    const err = el('p', 'ap-err');
    err.setAttribute('role', 'alert');
    const codeBox = el('pre', 'ap-code');
    const allow = button('Allow', 'go ap-allow', () => decideApproval('approve'));
    const show = button('Show code', 'ap-show', () => toggleApprovalCode());
    const reject = button('Don\'t allow', 'ap-reject', () => decideApproval('reject'));
    reject.title = 'The version before stays; the change is kept in its history.';
    const later = button('Not now', 'text ap-later', () => notNow());
    x.addEventListener('click', () => notNow());
    const acts = el('div', 'ap-actions');
    acts.append(allow, show, reject, later);
    d.append(top, who, lead, facts, together, note, err, codeBox, acts);
    d.addEventListener('cancel', (e) => { e.preventDefault(); notNow(); });
    document.body.append(d);
    approval.dialog = d;
    approval.parts = { count, name, where, lead, facts, together, note, err, codeBox, allow, show, reject };
    return approval.parts;
  }

  // What's waiting here. Opens the card for a hold not seen before; keeps an open one in step.
  function updateApprovals(mods) {
    approval.queue = mods.filter((m) => holdOf(m) && !approval.done.has(holdKey(m)));
    const fresh = approval.queue.filter((m) => !approval.seen.has(holdKey(m)));
    if (approval.dialog?.open) {
      const cur = approval.queue.findIndex((m) => holdKey(m) === approval.shownKey);
      approval.at = cur >= 0 ? cur : Math.min(approval.at, approval.queue.length - 1);
      if (!approval.queue.length) closeApproval(); else renderApproval();
    } else if (fresh.length && !document.querySelector('dialog[open]')) {
      approval.at = approval.queue.indexOf(fresh[0]);
      showApproval();
    }
  }
  function openApproval(id) {
    const i = approval.queue.findIndex((m) => m.id === id);
    approval.at = i >= 0 ? i : 0;
    if (approval.queue.length) showApproval();
  }
  function showApproval() {
    approvalDialog();
    for (const m of approval.queue) approval.seen.add(holdKey(m));
    approval.shownKey = null;
    renderApproval();
    if (!approval.dialog.open) approval.dialog.showModal();
  }
  function closeApproval() {
    if (approval.dialog?.open) approval.dialog.close();
    approval.shownKey = null;
  }
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
    if (approval.shownKey === key) return;
    approval.shownKey = key;
    const kind = m.held ? 'held' : 'pending';
    const n = approval.queue.length;
    P.count.textContent = n > 1 ? `${approval.at + 1} of ${n} waiting for your OK` : 'Waiting for your OK';
    approval.dialog.dataset.mod = m.id;
    approval.dialog.dataset.group = modGroup(m);
    P.name.textContent = m.name || m.id;
    P.where.textContent = `${info.site || m.site} · ${m.file}`;
    P.lead.textContent = info.asks ? 'It asks for these powers. TRIF holds it to them:'
      : kind === 'pending' ? 'A change to it is waiting. TRIF found that the new version:' : 'TRIF found that this mod:';
    const all = (info.facts || []).map((f, i) => ({ f, key: (info.needs || [])[i] || '' }));
    const plain = all.filter((x) => x.f && !/^power:together:/.test(x.key) && !/^site:.+:[a-z+-]+$/.test(x.key));
    const warns = [];
    for (const x of all) if (x.f && /^power:together:/.test(x.key) && !warns.some((w) => w.f === x.f)) warns.push(x);
    P.facts.replaceChildren(...plain.map((x) => {
      const li = el('li');
      const text = el('span', 'ap-text');
      text.append(el('span', 'ap-line', info.asks ? `It ${x.f}.` : x.f));
      // (a power's line icon, as the code card's Details has it: some of the panel's characters, ⌨ say, aren't in
      // the phone's fonts)
      const ic = el('span', 'ap-ic');
      const p = /^power:([\w-]+)/.exec(x.key);
      const svg = p ? iconSvg(p[1] === 'migrate' ? '@migrate' : p[1]) : null;
      if (svg) ic.append(svg); else ic.textContent = iconOf(x.key);
      ic.setAttribute('aria-hidden', 'true');
      li.append(ic, addMore(text, info.asks ? powerTerm(x.key) : null));
      return li;
    }));
    P.together.classList.remove('ap-free');
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
    if (!m.rules && !m.sandboxed) {
      const p = el('p');
      p.append(...freeWarning());
      P.together.replaceChildren(p);
      P.together.classList.add('ap-free');
      P.together.hidden = false;
    }
    const fromAgent = info.by === 'chat';
    const who = m.imported || info.by === 'import' ? 'You imported it from a file.' : fromAgent ? `An agent ${kind === 'pending' ? 'changed' : 'wrote'} it in your chat on ${info.site || site()}.` : 'It\'s new or changed since TRIF last let it run.';
    P.note.textContent = kind === 'pending' ? `${who} The version before keeps running until you decide.`
      : info.asks ? `${who} Updates that ask for the same powers won't ask again.` : who;
    P.err.hidden = true;
    P.codeBox.hidden = true;
    P.codeBox.replaceChildren();
    P.show.textContent = kind === 'pending' ? 'Show what changed' : 'Show code';
    P.reject.hidden = kind !== 'pending';
    for (const b of [P.allow, P.show, P.reject]) b.disabled = false;
  }

  const diffLines = (lines) => lines.map((l) => el('span', l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'ctx', `${l.t === '…' ? '…' : l.t} ${l.s}\n`));
  async function toggleApprovalCode() {
    const P = approval.parts;
    const m = approval.queue[approval.at];
    if (!m) return;
    const pending = !m.held && !!m.pending;
    if (!P.codeBox.hidden) { P.codeBox.hidden = true; P.show.textContent = pending ? 'Show what changed' : 'Show code'; return; }
    P.show.disabled = true;
    try {
      if (pending) P.codeBox.replaceChildren(...diffLines((await ask({ type: 'diff', id: m.id })).lines));
      else P.codeBox.textContent = (await ask({ type: 'code', id: m.id })).code;
      P.codeBox.hidden = false;
      P.show.textContent = pending ? 'Hide what changed' : 'Hide code';
    } catch (e) { P.err.textContent = errText(e); P.err.hidden = false; } finally { P.show.disabled = false; }
  }

  async function decideApproval(type) {
    const P = approval.parts;
    const m = approval.queue[approval.at];
    if (!m) return;
    P.allow.disabled = P.reject.disabled = true;
    P.err.hidden = true;
    try {
      approval.done.add(holdKey(m));
      approval.queue.splice(approval.at, 1);
      approval.shownKey = null;
      if (!approval.queue.length) closeApproval(); else { approval.at = Math.min(approval.at, approval.queue.length - 1); renderApproval(); }
      await ask({ type, id: m.id });
    } catch (e) {
      P.allow.disabled = P.reject.disabled = false;
      P.err.textContent = errText(e);
      P.err.hidden = false;
    }
  }

  // ---- the code card (sidepanel.js codeViewDialog, openCodeView, renderDetails, the History tab) -------------
  const codeView = { dialog: null, parts: null, id: null, text: '', error: null, version: null, diff: false };
  function codeViewDialog() {
    if (codeView.dialog) return codeView.parts;
    const d = el('dialog', 'approval code-view');
    d.id = 'code-view';
    d.setAttribute('aria-labelledby', 'code-view-name');
    const top = el('div', 'ap-top');
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.title = 'Close';
    x.setAttribute('aria-label', 'Close');
    top.append(el('span', 'ap-count', 'Code'), x);
    const who = el('div', 'ap-who');
    const robot = el('span', 'ap-robot');
    robot.append(cardRobot('code'));
    const nameBox = el('div');
    const name = el('h2', 'ap-name');
    name.id = 'code-view-name';
    const meta = el('div', 'ap-meta');
    const where = el('span', 'ap-where');
    meta.append(where);
    nameBox.append(name, meta);
    who.append(robot, nameBox);
    const versions = el('div', 'cv-versions');
    versions.setAttribute('role', 'group');
    versions.setAttribute('aria-label', 'Version');
    const vRan = button('Running now', 'cv-ran', () => loadCode('ran'));
    const vNew = button('Waiting for your OK', 'cv-new', () => loadCode('file'));
    versions.append(vRan, vNew);
    const errorBox = el('div', 'ap-together cv-error');
    errorBox.hidden = true;
    const codeBox = el('pre', 'cv-code wrap');
    codeBox.tabIndex = 0;
    codeBox.setAttribute('aria-label', 'The mod\'s code');
    const note = el('p', 'ap-note cv-note');
    const err = el('p', 'ap-err');
    err.setAttribute('role', 'alert');
    const tabs = el('div', 'cv-tabs');
    tabs.setAttribute('role', 'tablist');
    const tab = (label, cls, fn) => { const b = button(label, `cv-tab ${cls}`, fn); b.setAttribute('role', 'tab'); return b; };
    const codeTab = tab('Code', 'cv-tab-code', () => showCodeTab());
    const detailsTab = tab('Details', 'cv-tab-details', () => setCodeTab('details'));
    const historyBtn = tab('History', 'cv-tab-history', () => showHistoryTab());
    tabs.append(detailsTab, codeTab, historyBtn);
    const details = el('div', 'cv-details');
    details.hidden = true;
    const hTools = el('div', 'cv-h-tools');
    hTools.hidden = true;
    const hDiff = button('See differences', 'cv-h-diff', () => showVersion(codeView.version, !codeView.diff));
    hDiff.setAttribute('aria-pressed', 'false');
    const hRestore = button('Restore', 'cv-h-restore', (ev) => restoreVersion(ev.currentTarget));
    hTools.append(hDiff, hRestore);
    const copy = button('Copy', 'cv-copy', () => copyCode());
    const exportBtn = button('Export', 'cv-export', () => exportMod());
    const acts = el('div', 'ap-actions');
    acts.append(copy, exportBtn);
    const historyBox = el('ul', 'cv-history-list');
    historyBox.hidden = true;
    x.addEventListener('click', () => d.close());
    d.append(top, who, tabs, versions, errorBox, hTools, codeBox, details, historyBox, note, err, acts);
    d.addEventListener('close', () => setTimeout(() => renderMods(), 0));
    document.body.append(d);
    codeView.dialog = d;
    codeView.parts = { name, where, details, detailsTab, versions, vRan, vNew, errorBox, codeBox, historyBox, historyBtn, codeTab, hTools, hDiff, hRestore, exportBtn, note, err, copy };
    return codeView.parts;
  }

  const modById = (id) => (view.state?.mods || []).find((x) => x.id === id);
  function openCodeView(id, { error = null, tab = 'code' } = {}) {
    const m = modById(id);
    if (!m) return;
    const P = codeViewDialog();
    codeView.id = id;
    codeView.dialog.dataset.mod = id;
    codeView.dialog.dataset.group = modGroup(m);
    P.name.textContent = m.name || m.id;
    P.where.textContent = `${m.site} · ${m.file}`;
    renderDetails(P, m);
    P.versions.hidden = !m.pending;
    P.copy.textContent = 'Copy';
    P.historyBtn.disabled = !m.history;
    setCodeTab(tab === 'details' ? 'details' : 'code');
    codeView.error = error;
    P.errorBox.hidden = !error;
    P.errorBox.replaceChildren();
    if (error) P.errorBox.append(el('b', null, 'New error: '), String(error.message || ''));
    if (!codeView.dialog.open) codeView.dialog.showModal();
    loadCode('file');
  }

  async function loadCode(version) {
    const P = codeView.parts;
    const id = codeView.id;
    P.vRan.setAttribute('aria-pressed', String(version === 'ran'));
    P.vNew.setAttribute('aria-pressed', String(version !== 'ran'));
    P.err.hidden = true;
    P.note.hidden = true;
    P.codeBox.replaceChildren();
    try {
      const r = await ask({ type: 'code', id, ...(version === 'ran' ? { version: 'ran' } : {}) });
      if (codeView.id !== id) return;
      codeView.text = String(r.code ?? '');
      renderCode(P.codeBox, codeView.text);
    } catch (e) { P.err.textContent = errText(e); P.err.hidden = false; }
  }

  const CODE_TOKENS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`)|\b(const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|async|await|try|catch|finally|throw|true|false|null|undefined|this|typeof|instanceof|switch|case|break|continue|default|delete|void|yield)\b|\b(\d+(?:\.\d+)?)\b/g;
  function codeLine(cls, text, source = text, extra = 0) {
    const line = el('span', cls);
    const lead = /^[ \t]*/.exec(source || '')[0];
    line.style.setProperty('--ind', `${[...lead].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0) + extra}ch`);
    line.append(el('span', 'lc', text));
    return line;
  }
  function renderCode(box, text) {
    const pieces = [];
    if (text.length <= 300000) {
      let at = 0;
      for (const t of text.matchAll(CODE_TOKENS)) {
        if (t.index > at) pieces.push([text.slice(at, t.index), null]);
        pieces.push([t[0], t[1] ? 'c' : t[2] ? 's' : t[3] ? 'k' : 'n']);
        at = t.index + t[0].length;
      }
      if (at < text.length) pieces.push([text.slice(at), null]);
    } else pieces.push([text, null]);
    const source = text.split('\n');
    let line = codeLine('l', '', source[0]);
    const lines = [line];
    for (const [t, cls] of pieces) {
      t.split('\n').forEach((part, i) => {
        if (i > 0) { line = codeLine('l', '', source[lines.length]); lines.push(line); }
        if (part) line.firstChild.append(cls ? el('span', `t${cls}`, part) : document.createTextNode(part));
      });
    }
    box.replaceChildren(...lines);
  }

  const DETAILS_TIER = {
    'style-mods': ['Style mod:', ' changes how the page looks.'],
    'boxed-mods': ['Boxed mod:', ' can do what you\'ve allowed.'],
    'free-mods': ['Free mod:', ' can do anything code can do.'],
  };
  function renderDetails(P, m) {
    const out = [];
    const tierId = m.rules ? 'style-mods' : m.sandboxed ? 'boxed-mods' : 'free-mods';
    const tierTerm = term('tiers', tierId);
    const tierLine = el('p', 'cv-d-tier');
    tierLine.append(el('b', null, DETAILS_TIER[tierId][0]), DETAILS_TIER[tierId][1]);
    if (m.rules || m.sandboxed) out.push(tierTerm ? addMore(tierLine, tierTerm) : tierLine);
    else {
      out.push(tierLine);
      const warn = tierTerm ? moreText(tierTerm).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) : [];
      if (warn.length) { const box = el('div', 'ap-together cv-d-free'); for (const x of warn) box.append(el('p', null, x)); out.push(box); }
    }
    const facts = m.sandboxed ? (m.powerInfo?.facts || []) : [];
    if (facts.length) {
      out.push(el('p', 'ap-lead', 'It asks for these powers. TRIF holds it to them:'));
      const ul = el('ul', 'ap-facts cv-d-facts');
      for (const f of facts) {
        const li = el('li');
        const ic = el('span', 'ap-ic');
        ic.setAttribute('aria-hidden', 'true');
        const svg = iconSvg(f.power === 'migrate' ? '@migrate' : f.power);
        if (svg) ic.append(svg); else ic.textContent = iconOf(`power:${f.power}`);
        const text = el('span', 'ap-text');
        text.append(el('span', 'ap-line', `It ${f.fact}.`));
        li.append(ic, addMore(text, f.power === 'migrate' ? term('powers', 'migrate') : powerTerm(`power:${f.power}`)));
        ul.append(li);
      }
      out.push(ul);
    }
    const warns = m.sandboxed ? (m.powerInfo?.warnings || []) : [];
    if (warns.length) {
      const box = el('div', 'ap-together');
      for (const w of warns) {
        const line = el('p');
        const words = el('span', 'ap-line');
        const t = /^together, it (.*)$/i.exec(w);
        if (t) words.append(el('b', null, 'Together,'), ` it ${t[1]}${/[.!?]$/.test(t[1]) ? '' : '.'}`);
        else words.textContent = w.charAt(0).toUpperCase() + w.slice(1);
        line.append(words);
        box.append(addMore(line, warningTerm(w)));
      }
      out.push(box);
    }
    const level = modLevel(m);
    if (level) {
      const key = level >= 2 ? 'changes-requests' : 'noticeable';
      const p = el('p', 'cv-d-level');
      const ic = el('span', 'ap-ic');
      ic.setAttribute('aria-hidden', 'true');
      const svg = iconSvg(key);
      if (svg) ic.append(svg);
      p.append(ic, el('span', null, levelWords(m, site() || m.site)));
      out.push(addMore(p, term('chips', key)));
    }
    const everywhere = m.site === 'all-sites';
    for (const l of [
      ...(everywhere ? ['Runs on every site.'] : (m.sites || []).length > 1 ? [`Runs on ${m.sites.join(', ')}.`] : []),
      ...(m.cant ? ['Can\'t run here on iPhone: this page didn\'t let it start.'] : []),
    ]) out.push(el('p', null, l));
    P.details.replaceChildren(...out);
  }

  const HISTORY_SOURCE = {
    chat: 'before your agent changed it in a chat', fix: 'before a fix', restore: 'before you restored an older version',
    import: 'before an import replaced it', undo: 'before an undo',
  };
  function setCodeTab(which) {
    const P = codeView.parts;
    P.codeTab.setAttribute('aria-selected', String(which === 'code'));
    P.detailsTab.setAttribute('aria-selected', String(which === 'details'));
    P.historyBtn.setAttribute('aria-selected', String(which === 'history' || which === 'version'));
    P.historyBox.hidden = which !== 'history';
    P.details.hidden = which !== 'details';
    P.codeBox.hidden = which === 'history' || which === 'details';
    P.hTools.hidden = which !== 'version';
    if (which !== 'code') P.versions.hidden = true;
  }
  function showCodeTab() {
    const P = codeView.parts;
    P.note.hidden = true;
    setCodeTab('code');
    P.versions.hidden = !modById(codeView.id)?.pending;
    loadCode('file');
  }
  async function showHistoryTab() {
    const P = codeView.parts;
    P.err.hidden = true;
    P.note.hidden = true;
    setCodeTab('history');
    let r;
    try { r = await ask({ type: 'history', id: codeView.id }); } catch (e) { P.err.textContent = errText(e); P.err.hidden = false; return; }
    const entries = r.entries || [];
    if (!entries.length) { P.historyBox.replaceChildren(el('li', 'cv-history-empty', 'No earlier versions kept. TRIF keeps the version before each change your chat makes, a restore or an import, for 30 days.')); return; }
    P.historyBox.replaceChildren(...entries.map((e) => {
      const li = el('li');
      li.dataset.stamp = e.stamp;
      const when = new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const row = el('button', 'cv-h-row');
      row.type = 'button';
      row.append(el('span', 'cv-h-when', when), el('span', 'cv-h-from', HISTORY_SOURCE[e.source] || ''));
      row.addEventListener('click', () => showVersion({ ...e, when }, false));
      li.append(row);
      return li;
    }));
  }
  async function showVersion(e, diff) {
    if (!e) return;
    const P = codeView.parts;
    P.err.hidden = true;
    codeView.version = e;
    codeView.diff = diff;
    try {
      const r = await ask({ type: diff ? 'historyDiff' : 'historyCode', id: codeView.id, stamp: e.stamp });
      if (diff) P.codeBox.replaceChildren(...r.lines.map((l) => codeLine(`l ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'}`, `${l.t === '…' ? '…' : l.t} ${l.s}`, l.s, 2)));
      else { codeView.text = String(r.code ?? ''); renderCode(P.codeBox, codeView.text); }
      setCodeTab('version');
      P.hDiff.setAttribute('aria-pressed', String(!!diff));
      P.hRestore.disabled = false;
      P.note.textContent = diff ? `What changed since the version from ${e.when} (- then, + now).` : `The version from ${e.when}.`;
      P.note.hidden = false;
    } catch (x) { P.err.textContent = errText(x); P.err.hidden = false; }
  }
  async function restoreVersion(b) {
    const P = codeView.parts;
    const e = codeView.version;
    if (!e) return;
    b.disabled = true;
    try {
      await ask({ type: 'restore', id: codeView.id, stamp: e.stamp });
      setCodeTab('code');
      await loadCode('file');
      P.note.textContent = `Restored the version from ${e.when}. The one before is in History.`;
      P.note.hidden = false;
    } catch (x) { b.disabled = false; P.err.textContent = errText(x); P.err.hidden = false; }
  }
  async function copyCode() {
    const P = codeView.parts;
    let ok = false;
    try { await ask({ type: 'copy', text: codeView.text }); ok = true; } catch { ok = false; }
    P.copy.textContent = ok ? 'Copied' : 'Couldn\'t copy';
    setTimeout(() => { P.copy.textContent = 'Copy'; }, 1500);
  }
  async function exportMod() {
    const P = codeView.parts;
    P.err.hidden = true;
    try { await ask({ type: 'export', id: codeView.id }); } catch (e) { P.err.textContent = `Couldn't export: ${errText(e)}`; P.err.hidden = false; }
  }

  // ---- from the app ----------------------------------------------------------------------------------------
  window.trifRender = (state, openId) => {
    view.state = state;
    renderMods();
    showUndo(state.deleted ? `Deleted ${state.deleted}.` : '', true);
    if (codeView.dialog?.open && codeView.id) {
      const m = modById(codeView.id);
      if (!m) codeView.dialog.close(); else renderDetails(codeView.parts, m);
    }
    if (openId) openApproval(openId);
  };
  ask({ type: 'state' }).then((t) => window.trifRender(JSON.parse(t))).catch(() => {});
})();
