// TRIF in the chat (proof of concept, branch ios-poc; Tim, 11-13 and 11-15): a small mod for claude.ai and
// chatgpt.com, run in a world of its own beside their page (ClaudePane.chatWorld), so their code can't reach
// it. What it does, and nothing else:
//   - an "Add to TRIF" button under each code block that holds a whole mod file (==WebMod== … ==/WebMod==):
//     a tap hands the block's text to the app, which shows its Add this mod? sheet (the BUTTON path);
//   - fill(text, png): puts text (and a picture) into the message box, as a paste, for the person to send;
//   - the person's send (the send button, or Return in the message box) told to the app, which goes back to
//     the tab; then the reply watched until it's done (for the chat button's dots and its replied mark), and the mod
//     files in its code blocks (ones that weren't there before the send) handed to the app, which asks Add this mod?
//     about each (Tim, 11-15; kept, 11-16) (the AUTO path). Only the assistant's code, and only from a reply TRIF saw
//     arrive in this page (Tim, 11-18: never the person's own pasted code, never an old chat's: turnOf, track).
//   - a file the person opens in the chat's own viewer (Claude's, over the conversation, when a .js in a reply is
//     tapped): the code it shows is read off the screen, as a code block's is, and handed to the app for Add this mod?;
//     and while a viewer (or anything) is over the message box, nothing is filled in: the app waits (usableEditor,
//     viewer; Tim, 11-16).
// It reads only what the page shows: never the sites' own internal routes (their APIs), never a session token or
// cookie (Tim, 11-16: nothing against Claude's or ChatGPT's terms). A .js file in a reply comes to TRIF only when
// the person taps it (a download the app catches: ModDownloads). It never sends a message, never reads the
// conversation except code blocks and whether a reply is still being written, and keeps nothing.
(() => {
  if (globalThis.__trifChat) return;
  const post = (m) => { try { return window.webkit.messageHandlers.trif.postMessage(m); } catch (e) { return null; } };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10; };

  /** The message box: Claude's and ChatGPT's are ProseMirror editors; else the last visible editable thing. */
  function editor() {
    const list = [...document.querySelectorAll('div.ProseMirror[contenteditable="true"], #prompt-textarea, [contenteditable="true"], textarea')].filter(visible);
    return list[list.length - 1] || null;
  }

  // ---- the conversation in front, or something over it (Tim, 11-16: a tapped .js opened Claude's file viewer, and
  // the page's data was being filled into the message box hidden under it) ------------------------------------------
  // Claude's and ChatGPT's viewers (a file, an artifact, a canvas), as best known without signing in: unverified, so
  // what's covering the message box is also found by looking, whatever its markup (covered(), below). All in one place.
  const VIEWER = [
    '[role="dialog"]', '[aria-modal="true"]',
    '[data-testid*="artifact" i]', '[data-testid*="file-viewer" i]', '[data-testid*="file-preview" i]', '[data-testid*="code-viewer" i]',
    '[class*="artifact-panel" i]', '[class*="file-viewer" i]', '[id*="artifact" i]', 'section[aria-label*="artifact" i]', '[data-testid="canvas"]',
  ].join(', ');
  /** A viewer's own address: Claude's /chat/<id>/files/…, /artifacts/…; ChatGPT's canvas. */
  const VIEWER_ROUTE = /\/(files|artifacts?|canvas)\b/i;
  const VIEWER_MIN = 0.35; // (how much of the window a viewer covers, at least: not a menu or a tooltip)

  /** An element that's shown: in the layout, not hidden from people (aria-hidden, inert), with a size. */
  function shown(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  /** What's over the message box: the thing on top at its middle, if that isn't the box (or inside it), else null. */
  function covered(ed) {
    const r = ed.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 1), innerHeight - 1);
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return document.body; // (off the screen)
    const top = document.elementFromPoint(x, y);
    const box = composerBox() || ed;
    if (!top || top === ed || ed.contains(top) || box.contains(top) || top.contains(box)) return null;
    return top;
  }
  /** The message box, only if a person could use it now: shown, on the screen, nothing over it. */
  function usableEditor() {
    const ed = editor();
    return ed && shown(ed) && !covered(ed) ? ed : null;
  }
  /** An open viewer: one of VIEWER's, big enough, shown; or whatever covers the message box (its outermost layer);
   *  or the viewer's own address. {root, why} or null. */
  function viewer() {
    const big = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight * VIEWER_MIN; };
    for (const el of document.querySelectorAll(VIEWER)) if (!el.closest('[data-trif]') && shown(el) && big(el)) return { root: el, why: 'a viewer' };
    const ed = editor();
    const over = ed && covered(ed);
    if (over && over !== document.body) {
      // (the layer it belongs to: its highest ancestor that's positioned over the page)
      let root = over;
      for (let n = over; n && n !== document.body; n = n.parentElement) if (/fixed|absolute|sticky/.test(getComputedStyle(n).position) && big(n)) root = n;
      if (big(root)) return { root, why: 'something over the message box' };
    }
    if (VIEWER_ROUTE.test(location.pathname)) return { root: document.querySelector('main') || document.body, why: 'a viewer\'s address' };
    return null;
  }
  /** The code a viewer shows, as text: its code elements, without their line numbers (elements a person can't select,
   *  aria-hidden, or named for line numbers, hidden for the moment of reading). */
  function viewerCode(root) {
    const blocks = [...root.querySelectorAll('pre, code, [class*="code" i], [data-testid*="code" i]')].filter((n) => !n.parentElement.closest('pre, code'));
    const texts = [];
    for (const b of blocks.length ? blocks : [root]) {
      const nums = [...b.querySelectorAll('*')].filter((n) => /line-?num|linenumber|gutter/i.test(`${n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className} ${n.getAttribute('data-testid') || ''}`)
        || getComputedStyle(n).userSelect === 'none' || n.getAttribute('aria-hidden') === 'true');
      const was = nums.map((n) => n.style.display);
      nums.forEach((n) => { n.style.display = 'none'; });
      try { texts.push(b.innerText || b.textContent || ''); } finally { nums.forEach((n, i) => { n.style.display = was[i]; }); }
    }
    const all = texts.join('\n');
    const a = all.search(/^.*==WebMod==/m), z = all.search(/==\/WebMod==/);
    if (a === -1 || z === -1) return null;
    return all.slice(all.lastIndexOf('\n', a) + 1);
  }
  /** (each viewer once: what it showed, by its text) */
  let viewerSeen = '';
  // (the person's last tap on the page, kept across a load: a viewer is offered only when a tap opened it, or a reply
  // in this page did; one the chat reopens by itself (on load, its address) shows old code: Tim, 11-17, "spurious
  // asks to add old code when I open Claude chat")
  // (and where that tap was: a viewer is offered only when the tap that opened it was inside one of the assistant's
  // replies (a file card there); a tap on the person's own pasted-text card opens their own text: Tim, 11-18, "When I
  // paste code into Claude in the app, the app reads it as a mod")
  const TAP_KEY = '__trifTap';
  let tap = { at: 0, reply: false };
  try { const t = JSON.parse(sessionStorage.getItem(TAP_KEY) || 'null'); if (t && typeof t.at === 'number') tap = { at: t.at, reply: t.reply === true }; } catch (e) { /* (no storage: this load's taps only) */ }
  const tapped = (e) => {
    if (!e.isTrusted) return;
    let reply = false;
    try { reply = !!turnOf(e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement); } catch (err) { /* (not known: not a reply's) */ }
    tap = { at: Date.now(), reply };
    try { sessionStorage.setItem(TAP_KEY, JSON.stringify(tap)); } catch (err) { /* (as above) */ }
  };
  for (const t of ['pointerdown', 'touchstart', 'click']) document.addEventListener(t, tapped, { capture: true, passive: true });
  /** (whether the viewer up now may be offered: decided once, as it opens; '' = yes, else why not) */
  let viewerWhyNot = null;
  function lookAtViewer() {
    const v = viewer();
    if (!v) { viewerSeen = ''; viewerWhyNot = null; return; }
    if (viewerWhyNot === null) {
      const now = Date.now();
      // (a tap a moment ago opened it: offered if the tap was in a reply; no tap: offered only while a reply TRIF saw
      // arrive is being written or just was (the chat opening a file of its own reply), else it's old)
      viewerWhyNot = now - tap.at < 6000 ? (tap.reply ? '' : 'opened by a tap outside the assistant\'s replies')
        : (watch && watch.live.size) || (last && last.live.size && now - last.at < 120000) ? '' : 'opened with no tap and no new reply';
    }
    const code = viewerCode(v.root);
    const name = ((v.root.innerText || '').match(/[\w.() -]+\.js\b/) || [''])[0].trim();
    const key = `${name}|${code ? code.length : 0}|${(code || '').slice(0, 200)}`;
    if (key === viewerSeen) return;
    viewerSeen = key;
    const path = location.pathname.replace(/[^/]{24,}/g, '…');
    if (viewerWhyNot) { if (code) post({ type: 'viewer', why: v.why, name, path, text: '', skipped: viewerWhyNot }); return; }
    post({ type: 'viewer', why: v.why, name, path, text: code || '' });
  }

  /** One paste into the message box: true if the page took it (its paste handler cancelled the event). */
  function paste(ed, dt) {
    let ev;
    try { ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); } catch (e) { return false; }
    ed.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  /**
   * Puts `text` (and a PNG, base64) into the message box, as the person's own pastes would go: the picture
   * first, on its own (a page takes a picture and drops text pasted with it), then the text; typed in if
   * the page doesn't take a pasted text. `name`: the text as an attached file of that name instead (the report
   * after a mod is added: Tim, 11-13), so the person's own words stay theirs.
   */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let pdfPastedAt = 0;
  // (each attachment's own tile: never the row they sit in, Claude's [data-cds="MessageAttachments"], whose label
  // would cover every tile in it: Tim, 11-14, saw the instruction labelled "TRIF screenshot", the row marked
  // while only the picture was in it)
  const TILES = '[data-testid="file-thumbnail"], [data-cds^="MessageAttachments"]:not([data-cds="MessageAttachments"]), span[class*="group/composer-attachment"]';
  /** The page's own file input for the message box: one that takes any file or text (not pictures only). */
  function fileInput(file) {
    const box = composerBox();
    const all = [...(box && box.closest('form') || document).querySelectorAll('input[type="file"]'), ...document.querySelectorAll('input[type="file"]')];
    // (only one that takes this kind of file: 11-16, logged-out chatgpt.com's files input takes pictures only, and a
    // text file given to it said "The selected file is not a supported image." over the chat, which read as the
    // screenshot failing)
    const usable = all.filter((i) => !i.disabled && accepts(i, file));
    return usable.find((i) => /file/i.test(`${i.id} ${i.name}`) && !/photo|camera/i.test(`${i.id} ${i.name}`)) || usable.find((i) => !/camera/i.test(`${i.id} ${i.name}`)) || null;
  }
  /** Whether a file input's accept takes this file (by its type or its name's ending). */
  function accepts(input, file) {
    const list = (input.accept || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return list.some((a) => a === '*/*' || a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))) || (a.startsWith('.') && name.endsWith(a)));
  }
  /** The message box takes no text files at all (only pictures: logged-out chatgpt.com): its file inputs say so. */
  function picturesOnly() {
    const ins = [...document.querySelectorAll('input[type="file"]')].filter((i) => !i.disabled);
    return ins.length > 0 && !ins.some((i) => accepts(i, new File([''], 'x.txt', { type: 'text/plain' })));
  }
  /** How many attachment tiles in the message box carry this name (in their text, a picture's alt or a label). */
  function tiles(label) {
    return [...document.querySelectorAll(TILES)].filter((t) => `${t.textContent || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')]
      .map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`.includes(label)).length;
  }

  let settled = false; // (that moment waited once for this page)
  async function fill(text, png, name, pdf, picture) {
    // (the message box, as soon as it's there (every 100 ms, 10 s at most), not the page's whole load: claude.ai
    // goes on loading for seconds after its box works. Then, if the page is still loading, a moment for the box to
    // take pastes (it was a paste taken late: 11-14), 600 ms at most)
    let ed = usableEditor();
    for (let i = 0; !ed && i < 100; i++) { await wait(100); ed = usableEditor(); }
    if (!ed) return viewer() ? 'something over the message box' : 'no message box';
    if (document.readyState !== 'complete' && !settled) await Promise.race([new Promise((r) => addEventListener('load', r, { once: true })), wait(600)]);
    settled = true;
    ed.focus();
    const said = [];
    if (png) {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const pic = new File([bytes], picture || 'TRIF screenshot.png', { type: /\.jpe?g$/i.test(picture || '') ? 'image/jpeg' : 'image/png' });
      dt.items.add(pic);
      if (paste(ed, dt)) said.push('picture pasted');
      else {
        // (not taken as a paste: given to the page's own picture input, as its picker would)
        const input = fileInput(pic);
        if (input) {
          try { input.files = dt.files; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); said.push(`picture given to its ${input.id || 'file'} input`); }
          catch (e) { said.push('picture not taken'); }
        } else said.push('picture not taken (no input for pictures)');
      }
      await wait(300);
    }
    if (pdf) {
      // (the whole page, after the screenshot of the screen, on its own as the picture is)
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'TRIF full page.pdf', { type: 'application/pdf' }));
      pdfPastedAt = Date.now();
      said.push(paste(editor() || ed, dt) ? 'PDF pasted' : 'PDF not taken');
      await wait(300);
    }
    if (text && name && picturesOnly()) said.push('this chat takes pictures only as files: the text typed in');
    else if (text && name) {
      // (a chat that has only just loaded may take the file late, without saying so at the paste: Tim, 11-14,
      // got the attachment and the whole text typed in too. So: its tile looked for, and one more try, before
      // the text goes in as text)
      // (11-16, Tim's iPhone: chatgpt.com put a pasted file's text in the box, not as a file. So the page's own file
      // input comes second, given the file as a person picking it would (its files, then its change event), then the
      // file dropped on the box as a drag would, then one more paste)
      const label = name.replace(/\.[^.]*$/, '');
      for (const how of ['paste', 'file input', 'drop', 'paste']) {
        const before = tiles(label);
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: 'text/plain' }));
        let took = false;
        if (how === 'paste') took = paste(editor() || ed, dt);
        else if (how === 'drop') {
          // (as a file dragged onto the message box: dragenter, dragover, then drop, each carrying the file)
          const target = composerBox() || editor() || ed;
          try {
            for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
          } catch (e) { said.push('drop refused'); continue; }
        } else {
          const input = fileInput(dt.files[0]);
          if (!input) { said.push('no file input'); continue; }
          try { input.files = dt.files; } catch (e) { said.push('file input refused'); continue; }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // (taken: a tile with the file's name in the box; the text in the box instead: not. Either can come late, so
        // looked for 2.5 s; a paste the page cancelled with neither seen counts as taken, as before)
        const snippet = text.slice(0, 60);
        for (let i = 0; i < 25 && tiles(label) <= before && !composerText().includes(snippet); i++) await wait(100);
        if (tiles(label) > before) { said.push(`text attached (${how})`); return said.join(', '); }
        if (how === 'paste' && took && !composerText().includes(snippet)) { said.push('text attached (paste, no tile seen)'); return said.join(', '); }
        // (the page took the paste as text after all: that text out again before the next try)
        if (composerText().includes(text.slice(0, 60))) { await clearTrif(); said.push(`${how}: went in as text, taken out`); }
        else said.push(`${how}: file not taken`);
        await wait(300);
      }
      said.push('so as text');
    }
    if (text) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      if (paste(ed, dt)) said.push('text pasted');
      else {
        if (ed.localName === 'textarea') { ed.value += text; ed.dispatchEvent(new Event('input', { bubbles: true })); }
        else document.execCommand('insertText', false, text);
        said.push('text typed');
      }
    }
    return said.join(', ') || 'nothing';
  }

  /** (BUTTON path) Under each finished mod file in a code block, an Add to TRIF button (once): the person's tap hands it over. */
  function mark() {
    // (what TRIF attached, by its file's name: its tile marked for the small pill above, the label its name)
    // (Claude's tiles, then ChatGPT's: a span of the group/composer-attachment class; a picture's name only in
    // its alt or its remove button's label)
    for (const row of document.querySelectorAll('[data-cds="MessageAttachments"][data-trif-chip]')) row.removeAttribute('data-trif-chip');
    for (const tile of document.querySelectorAll(TILES)) {
      if (tile.querySelector(TILES)) continue; // (a tile around tiles: a row by another name)
      const names = `${tile.textContent || ''} ${tile.getAttribute('aria-label') || ''} ${tile.title || ''} ${[...tile.querySelectorAll('img[alt], [aria-label], [title]')]
        .map((i) => i.alt || i.getAttribute('aria-label') || i.title).join(' ')}`;
      let label = ['TRIF instruction', 'TRIF follow-up', 'TRIF screenshot', 'TRIF full page', 'TRIF pointer'].find((l) => names.includes(l));
      // (Claude's PDF tile shows only "PDF", its name nowhere: the one TRIF pasted in the last few minutes)
      if (!label && /^\s*PDF\s*$/.test(tile.textContent || '') && Date.now() - pdfPastedAt < 300000) label = 'TRIF full page';
      if (label && tile.getAttribute('data-trif-chip') !== label) tile.setAttribute('data-trif-chip', label);
      else if (!label && tile.hasAttribute('data-trif-chip')) tile.removeAttribute('data-trif-chip');
    }
    // (no button while a reply is being written: a mod's header comes before its code, so a button then would
    // hand over half a mod)
    if (replying()) return;
    // (only under the assistant's code: never in the message box, the person's own message or a pasted preview)
    for (const { pre, text, reply } of modBlocks()) {
      if (!reply) continue;
      if (pre.nextElementSibling && pre.nextElementSibling.classList.contains('trif-add')) continue;
      const b = document.createElement('button');
      b.className = 'trif-add';
      b.type = 'button';
      b.textContent = 'Add to TRIF';
      b.setAttribute('style', 'all:initial;display:inline-block;margin:6px 0 10px;padding:6px 14px;border-radius:999px;' +
        'background:#34d399;color:#04291c;font:600 14px -apple-system,system-ui,sans-serif;cursor:pointer;');
      // (handed over on the press itself, before the page's own handlers can swallow the click: some take the
      // pointer events of everything inside a reply)
      let handed = 0;
      const hand = (e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - handed < 800) return; handed = Date.now(); post({ type: 'mod', text: text() }); };
      b.addEventListener('click', hand, true);
      b.addEventListener('touchend', hand, true);
      pre.after(b);
    }
  }
  // The send button in TRIF's green (Tim, 11-14): Claude paints it on a layer inside the button
  // ([data-cds-part=paint]); ChatGPT on the button. And what TRIF attaches (the page, "TRIF instruction"; after a
  // mod is added, "TRIF follow-up", "TRIF screenshot" and "TRIF full page") as small pills saying so, not big tiles
  // (data-trif-chip, set by mark below); their remove buttons stay.
  // (each pill's words: what TRIF attached, said as TRIF's (Tim, 11-16: "make it clear … those are attachments"); the
  // key is the file's name, which the chat and the model see, unchanged)
  const PILLS = {
    'TRIF instruction': 'From TRIF: page & guide',
    'TRIF follow-up': 'From TRIF: the page now',
    'TRIF screenshot': 'From TRIF: screenshot',
    'TRIF full page': 'From TRIF: full page',
    'TRIF pointer': 'From TRIF: your pick',
  };
  const pillWords = Object.entries(PILLS).map(([k, w]) => `
    span[data-trif-chip="${k}"][class*="composer-attachment"]::before,
    [data-trif-chip="${k}"] [data-cds-card-body]::after,
    [data-trif-chip="${k}"][class*="group/thumbnail"] > div:first-child::before { content: "${w}"; }`).join('');
  const style = document.createElement('style');
  style.textContent = pillWords + `
    button[data-testid="chat-input-send"]:not(:disabled) [data-cds-part="paint"],
    button[data-testid="send-button"]:not(:disabled), #composer-submit-button:not(:disabled),
    button[aria-label="Send"]:not(:disabled), button[data-testid="composer-speech-button"], button[aria-label*="voice" i] {
      background: #34d399 !important; background-color: #34d399 !important; border-color: transparent !important;
    }
    button[data-testid="chat-input-send"]:not(:disabled), button[data-testid="send-button"]:not(:disabled),
    #composer-submit-button:not(:disabled), button[aria-label="Send"]:not(:disabled), button[data-testid="composer-speech-button"],
    button[aria-label*="voice" i] { color: #04291c !important; }
    :is(button[aria-label="Send"], button[data-testid="composer-speech-button"], button[aria-label*="voice" i]) svg { color: #04291c !important; }
    /* (ChatGPT's tile: its picture and name hidden, the label before them, its remove button kept) */
    span[data-trif-chip][class*="composer-attachment"] { width: auto !important; height: auto !important; }
    span[data-trif-chip][class*="composer-attachment"] > .composer-attachment-surface.flex { display: none !important; }
    span[data-trif-chip][class*="composer-attachment"]::before {
      display: inline-block; padding: 7px 16px; border-radius: 999px; background: #e3f7ee; color: #0f6b4a;
      font: 600 13px/1.2 -apple-system, system-ui, sans-serif; white-space: nowrap;
    }
    [data-trif-chip] { width: auto !important; height: auto !important; min-width: 0 !important; align-self: flex-start; }
    [data-trif-chip] [data-cds-card-body] { padding: 6px 14px !important; flex-direction: row !important; align-items: center !important; }
    [data-trif-chip] [data-cds-card-body] > div, [data-trif-chip] img, [data-trif-chip] picture { display: none !important; }
    [data-trif-chip] [data-cds-card-body]::after {
      font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip] .cds-card-fill { background: #e3f7ee !important; }
    /* (Claude's picture-preview tile, a PDF's: a fixed box with the preview and "pdf" in it; the box made a pill,
       its insides hidden, the remove button kept: Tim, 11-14) */
    [data-trif-chip][class*="group/thumbnail"] > div:first-child {
      width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important;
      border-radius: 999px !important; border: 0 !important; box-shadow: none !important; background: #e3f7ee !important;
      padding: 7px 16px !important; font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip][class*="group/thumbnail"] > div:first-child > * { display: none !important; }
    /* (dark by the page's own colours where the message box is, not the phone's setting: a chat can be set to light
       on a dark phone. data-trif-tone, set by lookUpdate) */
    :root[data-trif-tone="dark"] [data-trif-chip] .cds-card-fill { background: rgba(52, 211, 153, 0.16) !important; }
    :root[data-trif-tone="dark"] [data-trif-chip] [data-cds-card-body]::after { color: #34d399; }
    :root[data-trif-tone="dark"] span[data-trif-chip][class*="composer-attachment"]::before { background-color: rgba(52, 211, 153, 0.16); color: #34d399; }
    :root[data-trif-tone="dark"] [data-trif-chip][class*="group/thumbnail"] > div:first-child { background: rgba(52, 211, 153, 0.16) !important; color: #34d399; }`;
  (document.head || document.documentElement).append(style);

  // The send, and the reply after it (Tim, 11-15: "the moment you hit send, trif pops you back over to your
  // tab … when claude is done, TRIF just goes and gets the code").
  //   Sent: a tap on the send button, Return in the message box, or the composer's form submitted, and then,
  //   within 2.5 s, the page showing it went: a new message of the person's, a stop button, or the message box
  //   emptied. (Return that only made a new line, or a send the page refused, isn't a send.)
  //   Still working: Claude's stop button ("Stop response") or its reply marked data-is-streaming="true";
  //   ChatGPT's stop button (data-testid="stop-button", "Stop streaming"). Done: that's gone, and the last reply
  //   hasn't changed for 1.2 s. If neither was ever seen (a chat that changed its page), done is the last reply
  //   unchanged for 6 s with the message box there and no stop button.
  //   Watched with a MutationObserver, its checks at most every half second and once more after the page goes
  //   quiet; it stops when the reply is done (or after 15 minutes).
  const STOP = 'button[aria-label="Stop response"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[data-testid="stop-button"], [data-is-streaming="true"]';
  const SEND = 'button[data-testid="send-button"], #composer-submit-button, button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send"], button[data-testid="chat-input-send"]';
  // (ChatGPT's mobile page since 11-16 marks its messages li[data-message-role], the reply's li gets
  // data-message-complete when it's done, and its conversations are /uc/<id> logged out: seen logged out, 11-16)
  const USER = '[data-testid="user-message"], [data-message-author-role="user"], [data-message-role="user"]';
  const REPLY = '[data-is-streaming], .font-claude-response, .font-claude-message, [data-message-author-role="assistant"], [data-message-role="assistant"]';
  /** A reply being written, by its own mark (Claude's). */
  const STREAMING = '[data-is-streaming="true"]';
  /** ChatGPT's last reply hasn't been marked complete yet (its newer page marks each one when it's done). */
  function incomplete() {
    const all = document.querySelectorAll('li[data-message-role="assistant"]');
    const last = all[all.length - 1];
    return !!last && !last.hasAttribute('data-message-complete');
  }
  const replying = () => !!document.querySelector(STOP);

  /** The message box's surroundings (where what's attached shows): its widest ancestor, up to eight levels, that
   *  holds none of the conversation's messages. */
  function composerBox() {
    const ed = editor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 8; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || p === document.documentElement || p.querySelector(USER) || p.querySelector(REPLY)) break;
      n = p;
    }
    return n;
  }
  function composerText() {
    const ed = editor();
    return ed ? String(ed.localName === 'textarea' ? ed.value : ed.textContent || '').trim() : '';
  }
  /** What's in the message box now: its text, and the names of what's attached. */
  function composer() {
    const box = composerBox();
    const names = box ? [...box.querySelectorAll(TILES)].filter((t) => !t.querySelector(TILES))
      .map((t) => `${t.textContent || ''} ${t.getAttribute('data-trif-chip') || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')].map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`) : [];
    return { text: composerText(), names };
  }

  // Whose a code block is (Tim, 11-18: "When I paste code into Claude in the app, the app reads it as a mod and wants
  // to add it"). A positive rule: only code inside one of the assistant's replies is ever offered or gets Add to
  // TRIF. The nearest message around it is a reply (REPLY), not the person's (USER); the outermost reply there holds
  // none of the person's messages and not the message box; and the block isn't in anything editable. Everything
  // else is no one's and never offered: the message box (with pasted code rendered as a block), a pasted-text
  // preview, the person's own sent message (a code block or a pasted card in it), and markup TRIF doesn't know.
  // When it can't tell, no.
  /** The assistant's turn a node is in (its outermost reply element), or null. */
  function turnOf(el, ed = editor(), box = composerBox()) {
    if (!el || !el.closest) return null;
    if (el.closest('[contenteditable]:not([contenteditable="false"]), textarea, input')) return null;
    const near = el.closest(`${USER}, ${REPLY}`);
    if (!near || !near.matches(REPLY) || near.closest(USER)) return null;
    let top = near;
    for (let p = top.parentElement && top.parentElement.closest(REPLY); p; p = p.parentElement && p.parentElement.closest(REPLY)) top = p;
    if (top.querySelector(USER) || (ed && top.contains(ed)) || (box && (box.contains(top) || top.contains(box)))) return null;
    return top;
  }
  /** The assistant's turns on the page (outermost), in page order. */
  function turns() {
    const ed = editor(), box = composerBox();
    const out = [];
    for (const el of document.querySelectorAll(REPLY)) { const t = turnOf(el, ed, box); if (t && !out.includes(t)) out.push(t); }
    return out;
  }

  /** The mod files in code blocks: [{ key: its header, raw, pre, reply: the assistant's turn it's in or null, text }], in page order. */
  function modBlocks() {
    const out = [];
    const ed = editor(), box = composerBox();
    // (not the code a viewer shows over the chat: that's read as the viewer's, without its line numbers, lookAtViewer)
    const v = viewer();
    const over = v && v.root !== document.body && v.root.localName !== 'main' ? v.root : null;
    // (a code block: a pre, or a code editor's box (CodeMirror's .cm-editor, which some chats use), the outermost)
    for (const pre of document.querySelectorAll(CODE_BLOCKS)) {
      if (pre.parentElement && pre.parentElement.closest(CODE_BLOCKS)) continue;
      if (pre.closest(VIEWER) || (over && over.contains(pre))) continue;
      const raw = pre.textContent || '';
      const end = raw.search(/==\/WebMod==/);
      if (raw.indexOf('==WebMod==') === -1 || end === -1) continue;
      out.push({ key: raw.slice(0, end), raw, pre, reply: turnOf(pre, ed, box), text: () => blockText(pre) || raw });
    }
    return out;
  }
  const CODE_BLOCKS = 'pre, .cm-editor, [data-code-block]';
  /** A code block's text, line by line: its lines as shown (a code editor puts each in an element of its own, so
   *  textContent runs them together); from the mod's header on. */
  function blockText(el) {
    const lines = el.querySelectorAll('.cm-line');
    let t = lines.length ? [...lines].map((l) => l.textContent || '').join('\n') : ((el.querySelector('code') || el).innerText || '');
    const a = t.search(/^.*==WebMod==/m);
    if (a > 0) t = t.slice(t.lastIndexOf('\n', a) + 1);
    return t;
  }
  /** What tells a reply is still changing: the last reply's text (or, without one, how much text the page has). */
  function signature() {
    const all = document.querySelectorAll(REPLY);
    const last = all[all.length - 1];
    return last ? `${all.length}:${last.textContent || ''}` : `page:${document.body ? document.body.textContent.length : 0}`;
  }

  let sending = false;
  let watch = null;
  let last = null; // after a reply: { seen: the mod files known, path } (a mod that turns up late is still offered)
  function maybeSent(how) {
    if (sending || watch) return;
    const c = composer();
    if (!c.text && !c.names.length) return;
    const withInstructions = c.names.some((n) => n.includes('TRIF instruction')) || c.text.includes('--- How TRIF mods are written ---');
    const users = document.querySelectorAll(USER).length;
    const seen = new Set(modBlocks().map((b) => b.raw));
    // (what was on the page before this send: its messages and replies are never this send's reply)
    const usersBefore = new Set(document.querySelectorAll(USER));
    const repliesBefore = new Set(turns());
    const convo = convoOf(location.pathname);
    sending = true;
    const t0 = Date.now();
    const check = () => {
      const now = composer();
      const went = document.querySelectorAll(USER).length > users || replying() || (!now.text && !now.names.length);
      if (went) {
        sending = false;
        post({ type: 'sent', how, withInstructions });
        startWatch(seen, { mode: 'send', usersBefore, repliesBefore, convo });
      } else if (Date.now() - t0 > 2500) sending = false;
      else setTimeout(check, 150);
    };
    setTimeout(check, 100);
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest(SEND);
    if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') maybeSent('button');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const ed = editor();
    if (ed && (ed === e.target || ed.contains(e.target))) maybeSent('return');
  }, true);
  document.addEventListener('submit', (e) => { const ed = editor(); if (ed && e.target && e.target.contains && e.target.contains(ed)) maybeSent('form'); }, true);

  // Only a reply TRIF saw arrive is the reply (Tim, 11-18: "it's still the case that sometimes opening an old chat
  // gets spurious pickups of old code as mods"). A positive rule, as the code's owner above: a reply's code is
  // offered only if that reply came after the person's message sent in this page (one that wasn't on the page at
  // the send), wasn't on the page at the send, and was seen being written while TRIF watched: Claude's own
  // streaming mark on it, or its text changing from one look to the next. Anything that was there when the chat
  // opened, or that renders whole without being written (an old conversation loading in pieces, its messages
  // late, a re-render when scrolled up), is history and never offered. The watch belongs to its conversation: the
  // chat going to another one (by its address: /chat/<id>, /c/<id>, /uc/<id>) ends it with nothing offered; a new
  // chat getting its first address is the same one. When TRIF can't tell, nothing. (The app's memory of what was
  // offered, ChatOffers.swift, is the second guard.)
  const CONVO = /\/(?:chat|c|uc)\/[^/?#]+/;
  const convoOf = (p) => (String(p || '').match(CONVO) || [''])[0];
  /** The person's message this watch is for: the last in page order of those that weren't there at the send. */
  function sentMessage(w) {
    const fresh = [...document.querySelectorAll(USER)].filter((u) => !w.usersBefore.has(u));
    return fresh[fresh.length - 1] || null;
  }
  /** One look: which replies are being written (w.live). (TRIF's own Add to TRIF isn't the reply's writing.) */
  function track(w) {
    const anchor = w.mode === 'send' ? sentMessage(w) : latestUser();
    w.anchored = w.anchored || !!anchor;
    if (!anchor) return;
    for (const r of turns()) {
      if (w.repliesBefore.has(r) || w.live.has(r)) continue;
      if (!(anchor.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) || anchor.contains(r)) continue;
      const text = (r.textContent || '').split('Add to TRIF').join('');
      const prev = w.looks.get(r);
      if (prev !== undefined && prev !== text) w.grew.set(r, (w.grew.get(r) || 0) + 1);
      w.looks.set(r, text);
      // (after a reload (resume) a reply that's merely late to render could change once as it fills in: twice there)
      if (r.matches(STREAMING) || r.querySelector(STREAMING) || (w.grew.get(r) || 0) >= (w.mode === 'send' ? 1 : 2)) w.live.add(r);
    }
  }
  function startWatch(seen, how) {
    stopWatch();
    const w = { seen, saw: false, sig: null, at: Date.now(), started: Date.now(), timer: 0, queued: false, mo: null,
      mode: how.mode, usersBefore: how.usersBefore || new Set(), repliesBefore: how.repliesBefore || new Set(), convo: how.convo || '',
      live: new Set(), looks: new WeakMap(), grew: new WeakMap(), anchored: false };
    watch = w;
    w.mo = new MutationObserver(() => {
      if (w.queued) return;
      w.queued = true;
      setTimeout(() => { w.queued = false; settle(w); }, 500);
    });
    w.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'aria-label', 'disabled', 'data-message-complete'] });
    settle(w);
  }
  function stopWatch() {
    if (!watch) return;
    watch.mo.disconnect();
    clearTimeout(watch.timer);
    watch = null;
  }
  function settle(w) {
    if (watch !== w) return;
    clearTimeout(w.timer);
    // (still the same conversation: a new chat's first address is; any other is the person gone elsewhere)
    const c = convoOf(location.pathname);
    if (c !== w.convo) { if (!w.convo) w.convo = c; else return finish(w, 'left'); }
    track(w);
    const now = Date.now();
    const busy = replying();
    if (busy) w.saw = true;
    const sig = signature();
    if (sig !== w.sig) { w.sig = sig; w.at = now; }
    const quiet = now - w.at;
    // (ChatGPT's reply not marked complete yet: not done, however quiet, for up to 90 s of quiet: it pauses while it
    // searches or thinks, which ended the watch early, 11-16, its mod then only picked up late)
    const pending = incomplete();
    const done = !busy && !!editor() && (pending ? quiet >= 90000 : w.saw ? quiet >= 1200 : quiet >= 6000);
    if (done) return finish(w, w.saw ? 'done' : 'quiet');
    if (now - w.started > 15 * 60000) return finish(w, 'timed out');
    // (one more look once the page has gone quiet: nothing else wakes this up when nothing changes)
    w.timer = setTimeout(() => settle(w), !busy && w.saw ? 1300 : busy ? 4000 : 6100);
  }
  /** The reply's done: told to the app (the dots stop), with its new mod files. */
  function finish(w, why) {
    stopWatch();
    if (why === 'left') {
      // (another conversation in front: nothing from it offered, nothing late either)
      last = null;
      held(w, why, modBlocks().filter((b) => !w.seen.has(b.raw)));
      post({ type: 'done', why, mods: [], stop: w.saw });
      return;
    }
    track(w);
    last = { seen: w.seen, live: w.live, convo: w.convo, at: Date.now() };
    const mods = autoPickup(w, why);
    // (code in the reply but no mod read from it: said, with what there was, for the diagnostics)
    if (!mods.length) {
      const all = document.querySelectorAll(REPLY);
      const r = all[all.length - 1];
      const blocks = r ? r.querySelectorAll(`${CODE_BLOCKS}, code`).length : 0;
      const header = !!r && /==WebMod==/.test(r.textContent || '');
      if (blocks || header) post({ type: 'nopickup', blocks, header, kinds: r ? [...new Set([...r.querySelectorAll(`${CODE_BLOCKS}, code`)].map((n) => n.localName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(/\s+/)[0] : '')))].slice(0, 5).join(' ') : '', path: location.pathname.replace(/[^/]{20,}/g, '…') });
    }
    post({ type: 'done', why, mods, stop: w.saw });
  }
  /** The person's latest message (after a reload, resume: a reply still being written comes after it). */
  function latestUser() {
    const users = document.querySelectorAll(USER);
    return users[users.length - 1] || null;
  }
  /** (AUTO path) The mod files in the replies TRIF saw arrive (w.live) that weren't there before the send, the latest
   *  of each (by its header); every block on the page then counts as seen. */
  function autoPickup(w, why) {
    // (a mod by its header, ==WebMod== to ==/WebMod==, whatever is around it)
    const keyOf = (t) => { const end = t.search(/==\/WebMod==/); return end === -1 ? t : t.slice(t.indexOf('==WebMod=='), end).replace(/\s+/g, ' '); };
    const byKey = new Map();
    const all = modBlocks();
    const notOffered = [];
    for (const b of all) {
      if (w.seen.has(b.raw)) continue;
      if (b.reply && w.live.has(b.reply)) { const t = b.text(); byKey.set(keyOf(t), t); } else notOffered.push(b);
    }
    for (const b of all) w.seen.add(b.raw);
    held(w, why, notOffered);
    return [...byKey.values()];
  }
  /** Mod files on the page that weren't offered, and why (for the diagnostics' "chat offers" lines): outside the
   *  assistant's replies (the person's own, the message box), or in a reply TRIF didn't see arrive (history). */
  function held(w, why, blocks) {
    if (!blocks.length) return;
    const outside = blocks.filter((b) => !b.reply).length;
    post({ type: 'held', why, outside, history: blocks.length - outside, anchored: w.anchored, live: w.live.size, mode: w.mode,
      path: location.pathname.replace(/[^/]{20,}/g, '…') });
  }

  /** (AUTO path) After a reply, a mod file that turns up later on the same conversation (a chat that paused, a revised block). */
  let lateSig = '';
  let lateTimer = 0;
  function late() {
    if (!last || watch || sending || replying() || convoOf(location.pathname) !== last.convo) return;
    // (only more of a reply TRIF saw arrive; anything else (old code rendering late, the person's own, the message
    // box) is seen, never offered)
    for (const r of last.live) if (!r.isConnected) last.live.delete(r);
    const all = modBlocks();
    const live = (b) => !!b.reply && last.live.has(b.reply);
    for (const b of all) if (!live(b)) last.seen.add(b.raw);
    const fresh = all.filter((b) => live(b) && !last.seen.has(b.raw));
    const sig = fresh.map((b) => b.raw).join('\n');
    // (offered once it's the same on two looks, the second a moment later even if nothing else changes)
    if (!fresh.length || sig !== lateSig) { lateSig = sig; if (fresh.length) { clearTimeout(lateTimer); lateTimer = setTimeout(late, 1500); } return; }
    lateSig = '';
    const byKey = new Map();
    for (const b of fresh) { byKey.set(b.key, b); last.seen.add(b.raw); }
    post({ type: 'done', why: 'late', mods: [...byKey.values()].map((b) => (b.pre.querySelector('code') || b.pre).innerText || b.raw), stop: false });
  }

  /** Whether this conversation already has TRIF's instructions in it (sent before, outside the message box). */
  function hasContext() {
    const count = (t) => (t.match(/TRIF instruction|--- How TRIF mods are written ---/g) || []).length;
    const box = composerBox();
    return count(document.body ? document.body.textContent || '' : '') > count(box ? box.textContent || '' : '');
  }
  /** For the app: is there a message box, is anything in it, does the chat have TRIF's instructions, is it replying. */
  function state() {
    const c = composer();
    const ours = trifInBox(c);
    const v = viewer();
    return JSON.stringify({ editor: !!editor(), usable: !!usableEditor(), viewer: v ? v.why : null, has: !!(c.text || c.names.length), trif: ours.count, others: ours.others, context: hasContext(), working: replying() || !!watch, replying: replying() });
  }

  // ---- what TRIF put in the message box (11-16: the page went in twice after leaving the chat and coming back) ----
  const OUR_FILE = /TRIF (instruction|follow-up|screenshot|full page)/;
  const OUR_TEXT = /^(I'm looking at \S+ in TRIF, an app|Here's .{1,300} in TRIF now:)/;
  /** How many of TRIF's things are in the box (its files' tiles, its text typed in), and whether anything else is. */
  function trifInBox(c = composer()) {
    const mine = c.names.filter((n) => OUR_FILE.test(n)).length;
    const text = OUR_TEXT.test(c.text);
    return { count: mine + (text ? 1 : 0), others: c.names.length - mine > 0 || (!!c.text && !text) };
  }
  /** Takes TRIF's things out of the box, as the person would: each tile's own remove button; TRIF's typed text
   *  cleared only when the box holds nothing else. Returns how many are left. */
  async function clearTrif() {
    const box = composerBox();
    if (!box) return 0;
    for (const t of [...box.querySelectorAll(TILES)].filter((x) => !x.querySelector(TILES))) {
      const label = `${t.textContent || ''} ${t.getAttribute('data-trif-chip') || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')].map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`;
      if (!OUR_FILE.test(label)) continue;
      const buttons = [...t.querySelectorAll('button')];
      const x = buttons.find((b) => /remove|delete|close/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`)) || buttons[buttons.length - 1];
      if (x) { x.click(); await wait(150); }
    }
    const c = composer();
    if (OUR_TEXT.test(c.text) && !c.names.some((n) => !OUR_FILE.test(n))) {
      const ed = editor();
      if (ed) {
        ed.focus();
        if (ed.localName === 'textarea') { ed.value = ''; ed.dispatchEvent(new Event('input', { bubbles: true })); }
        else { document.execCommand('selectAll'); document.execCommand('delete'); }
      }
    }
    return trifInBox().count;
  }
  /** The app's chat page loaded again while a reply was being written: watched again, from the person's last message. */
  function resume() {
    const users = document.querySelectorAll(USER);
    const lastUser = users[users.length - 1];
    const seen = new Set(modBlocks().filter((b) => !lastUser || !(lastUser.compareDocumentPosition(b.pre) & Node.DOCUMENT_POSITION_FOLLOWING)).map((b) => b.raw));
    // (no send in this page: only a reply after the person's latest message that's still being written now)
    startWatch(seen, { mode: 'resume', convo: convoOf(location.pathname) });
    return 'watching';
  }
  /** Opened at the reply: the person's last message at the top, the reply under it. */
  function showReply() {
    const users = document.querySelectorAll(USER);
    const lastUser = users[users.length - 1];
    if (lastUser) lastUser.scrollIntoView({ block: 'start' });
    return lastUser ? 'shown' : 'no message';
  }

  // The reply kept in view (Tim, 11-14): after a send, Claude scrolls the new message to the top of the
  // conversation, with room below it for the reply; in a pane this short that left only the empty room in view,
  // the reply and its "working" line above it. So: when the conversation's last message is wholly above what
  // shows (nothing but space below everything), it's brought back to sit 60% of the way down. Never when the
  // person has scrolled up to read (then the last message is below the view, not above it).
  const MSGS = '[data-testid="user-message"], [data-is-streaming], .font-claude-response, [data-message-author-role], [data-message-role]';
  function scrollerOf(el) {
    for (let n = el && el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }
  function reveal() {
    const all = document.querySelectorAll(MSGS);
    const last = all[all.length - 1];
    const sc = last && scrollerOf(last);
    if (!sc) return;
    const box = sc.getBoundingClientRect(), r = last.getBoundingClientRect();
    if (r.height > 0 && r.bottom < box.top + 24) sc.scrollTop -= box.top + box.height * 0.6 - r.bottom;
  }

  /** (development) Where things are: each scrolling element, the last message, the window. */
  function metrics() {
    const desc = (n) => n ? `${n.localName}${n.id ? `#${n.id}` : ''}${n.getAttribute('data-testid') ? `[data-testid=${n.getAttribute('data-testid')}]` : ''}.${String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).split(/\s+/).slice(0, 4).join('.')}` : null;
    const rect = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; };
    const scrollers = [...document.querySelectorAll('*')].filter((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4)
      .map((n) => ({ el: desc(n), rect: rect(n), scrollTop: Math.round(n.scrollTop), scrollHeight: n.scrollHeight, clientHeight: n.clientHeight }));
    const all = document.querySelectorAll(MSGS);
    const last = all[all.length - 1];
    return JSON.stringify({ innerHeight, visual: window.visualViewport && Math.round(visualViewport.height), docScroll: Math.round((document.scrollingElement || document.documentElement).scrollTop),
      messages: all.length, last: last && { el: desc(last), rect: rect(last), scroller: desc(scrollerOf(last)) }, scrollers }, null, 1);
  }


  // ---- TRIF's look in the chat (Tim, 11-16: "make it clear that like, hello this is trif, those are attachments,
  // what would you like to fix on your website? insert our robot"). Cosmetic only: nothing here changes what's sent.
  //   - A new, empty conversation: TRIF's robot and a greeting in the service's own greeting's place (its heading kept
  //     in the layout, made invisible), or just above the message box when no such heading is found. The greeting is
  //     TRIF's own layer on the body, outside the page's own tree, and takes no touches.
  //   - What TRIF attached: the pills (above) say "From TRIF: …", with the robot before the words.
  //   - The services' upsells (Upgrade, Get Plus, Try Go…) hidden: only buttons and links with exactly such words. Never
  //     their names, logos, terms, privacy or "can make mistakes" lines.
  // Logged-in markup can't be seen here (no sign-ins): every selector is by role, text or what the page shows.
  let lookSite = '';
  let robot = null; // { rim, face, eyes: [..], colours } from the app (RobotShape), so it's TRIF's own shape
  const GREETING = {
    hello: 'Hello, this is TRIF',
    ask: (site) => site ? `What would you like to fix on ${site}?` : 'What would you like to fix on this site?',
    attached: 'TRIF has attached the page below. Say what bothers you, then send.',
  };
  const UPSELL = /^(upgrade( (plan|now|to (plus|pro|max|team|go)))?|upgrade your plan|get (plus|pro|max|go)|try (chatgpt )?(plus|pro|max|go)( (free|for free))?|try (plus|pro|max|go),? free|claim (free )?offer|see plans( (and|&) pricing)?|view plans)$/i;
  const BRAND = /claude|chatgpt|openai|anthropic/i;
  const SVGNS = 'http://www.w3.org/2000/svg';
  function robotSvg(size) {
    if (!robot) return null;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    for (const [points, fill] of [[robot.rim, robot.colours.rim], [robot.face, robot.colours.face], ...robot.eyes.map((e) => [e, robot.colours.eye])]) {
      const p = document.createElementNS(SVGNS, 'polygon');
      p.setAttribute('points', points);
      p.setAttribute('fill', fill);
      svg.append(p);
    }
    return svg;
  }
  /** The robot as a picture for CSS (the pills): an SVG data address made from the same shape. */
  function robotURL() {
    if (!robot) return '';
    const polys = [[robot.rim, robot.colours.rim], [robot.face, robot.colours.face], ...robot.eyes.map((e) => [e, robot.colours.eye])]
      .map(([pts, fill]) => `<polygon points='${pts}' fill='${fill}'/>`).join('');
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'>${polys}</svg>`)}")`;
  }
  const lookStyle = document.createElement('style');
  lookStyle.textContent = `
    [data-trif-hidden] { display: none !important; }
    [data-trif-greeting-hidden] { visibility: hidden !important; }
    #trif-greeting { all: initial; position: fixed; z-index: 20; pointer-events: none; display: flex; flex-direction: column;
      align-items: center; gap: 6px; text-align: center; font: 15px/1.35 -apple-system, system-ui, sans-serif; box-sizing: border-box;
      padding: 0 20px; transition: opacity .2s; }
    #trif-greeting[hidden] { display: none; }
    #trif-greeting .trif-hello { font: 600 21px/1.25 -apple-system, system-ui, sans-serif; letter-spacing: -0.01em; margin-top: 4px; }
    #trif-greeting .trif-ask { font: 400 16px/1.35 -apple-system, system-ui, sans-serif; }
    #trif-greeting .trif-small { font: 400 13px/1.35 -apple-system, system-ui, sans-serif; margin-top: 2px; }
    #trif-greeting[data-tone="light"] .trif-hello, #trif-greeting[data-tone="light"] .trif-ask { color: #18181b; }
    #trif-greeting[data-tone="light"] .trif-small { color: #52525b; }
    #trif-greeting[data-tone="light"] .trif-site { color: #1f8a5b; font-weight: 600; }
    #trif-greeting[data-tone="dark"] .trif-hello, #trif-greeting[data-tone="dark"] .trif-ask { color: #f4f4f5; }
    #trif-greeting[data-tone="dark"] .trif-small { color: #a1a1aa; }
    #trif-greeting[data-tone="dark"] .trif-site { color: #34d399; font-weight: 600; }
    /* (little room, the keyboard up on a small phone: the robot beside two lines, the explanation left out) */
    #trif-greeting.trif-tight { flex-direction: row; align-items: center; justify-content: center; gap: 10px; text-align: left; }
    #trif-greeting.trif-tight svg { width: 34px; height: 34px; flex: none; }
    #trif-greeting.trif-tight .trif-words { align-items: flex-start; }
    #trif-greeting.trif-tight .trif-hello { font-size: 16px; margin-top: 0; }
    #trif-greeting.trif-tight .trif-ask { font-size: 14px; }
    #trif-greeting.trif-tight .trif-small { display: none; }
    #trif-greeting .trif-words { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    /* (an attachment of TRIF's in markup this doesn't know: the robot before it, on a green tint, its name kept) */
    [data-trif-chip]:not([class*="composer-attachment"]):not([class*="group/thumbnail"]):not(:has([data-cds-card-body])) {
      background: #e3f7ee !important; color: #0f6b4a !important; }
    [data-trif-chip]:not([class*="composer-attachment"]):not([class*="group/thumbnail"]):not(:has([data-cds-card-body]))::before {
      content: ""; display: inline-block; width: 16px; height: 16px; flex: none; vertical-align: -3px; margin-right: 2px;
      background: var(--trif-robot) no-repeat center / 16px 16px; }
    :root[data-trif-tone="dark"] [data-trif-chip]:not([class*="composer-attachment"]):not([class*="group/thumbnail"]):not(:has([data-cds-card-body])) {
      background: rgba(52, 211, 153, 0.16) !important; color: #34d399 !important; }`;
  (document.head || document.documentElement).append(lookStyle);
  const pillRobot = document.createElement('style');
  (document.head || document.documentElement).append(pillRobot);

  /** The page is dark where the message box is: the first background behind it that isn't see-through. */
  function pageDark() {
    const lum = (c) => { const m = String(c).match(/[\d.]+/g); if (!m || m.length < 3 || (m.length > 3 && Number(m[3]) < 0.5)) return null; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    for (let n = composerBox(); n; n = n.parentElement) { const l = lum(getComputedStyle(n).backgroundColor); if (l !== null) return l < 0.45; }
    for (const n of [document.body, document.documentElement]) { const l = n && lum(getComputedStyle(n).backgroundColor); if (l !== null && l !== undefined) return l < 0.45; }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  /** The service's own greeting in an empty conversation: a heading above the message box, with words only (no
   *  logo or picture in it), not naming the service, not in a menu, the side bar or a dialog. */
  let hiddenHeading = null;
  function serviceGreeting(boxTop, minTop) {
    if (hiddenHeading && hiddenHeading.isConnected) return hiddenHeading;
    for (const h of document.querySelectorAll('h1, h2, [data-testid*="greeting" i]')) {
      // (a header, form or footer around it is allowed: chatgpt.com's mobile page puts its greeting in a footer, with
      // the message box (logged out, 11-16); the page's top bar isn't, as the heading must be below it and above the
      // box; a heading with a link in it (terms, privacy) never)
      if (h.closest('nav, aside, [role="dialog"], [role="menu"], [data-trif]') || h.querySelector('svg, img, picture, video, canvas, a')) continue;
      const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 80 || BRAND.test(t) || !shown(h)) continue;
      const r = h.getBoundingClientRect();
      if (r.height < 14 || r.width < 60 || r.bottom > boxTop || r.top < minTop - 4) continue;
      return h;
    }
    return null;
  }
  /** The message box's surroundings as they show: the outermost of its ancestors (up to eight) that has a size and
   *  holds none of the messages nor a heading (chatgpt.com's mobile page wraps it in boxes of no size, and its form
   *  holds the greeting too). */
  function composerRect(ed) {
    let best = ed.getBoundingClientRect();
    for (let n = ed, i = 0; i < 8; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || p.querySelector(USER) || p.querySelector(REPLY) || p.querySelector('h1, h2')) break;
      const r = p.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && r.height < innerHeight * 0.9) best = r;
      n = p;
    }
    return best;
  }
  function unhideHeading() {
    if (hiddenHeading) hiddenHeading.removeAttribute('data-trif-greeting-hidden');
    hiddenHeading = null;
  }
  let card = null;
  function greetingCard() {
    if (card && card.isConnected) return card;
    card = document.createElement('div');
    card.id = 'trif-greeting';
    card.setAttribute('data-trif', 'greeting');
    card.setAttribute('aria-live', 'polite');
    const pic = robotSvg(52);
    if (pic) card.append(pic);
    const words = document.createElement('div');
    words.className = 'trif-words';
    for (const cls of ['trif-hello', 'trif-ask', 'trif-small']) { const d = document.createElement('div'); d.className = cls; words.append(d); }
    card.append(words);
    document.body.append(card);
    return card;
  }
  /** Where the greeting goes, and whether at all: an empty conversation, the message box usable, nothing over it. */
  function placeGreeting() {
    const ed = usableEditor();
    const box = ed;
    const empty = !document.querySelector(USER) && !document.querySelector(REPLY);
    if (!robot || !box || !empty || viewer() || !document.body) { unhideHeading(); if (card) card.hidden = true; return; }
    const b = composerRect(ed);
    const c = greetingCard();
    c.querySelector('.trif-hello').textContent = GREETING.hello;
    const ask = c.querySelector('.trif-ask');
    const words = GREETING.ask(lookSite);
    if (ask.getAttribute('data-words') !== words) {
      ask.setAttribute('data-words', words);
      ask.textContent = '';
      // (the site in TRIF's green: the words around it as text)
      const at = lookSite ? words.indexOf(lookSite) : -1;
      if (at < 0) ask.textContent = words;
      else { const s = document.createElement('span'); s.className = 'trif-site'; s.textContent = lookSite; ask.append(words.slice(0, at), s, words.slice(at + lookSite.length)); }
    }
    const attached = !!document.querySelector('[data-trif-chip]');
    c.querySelector('.trif-small').textContent = attached ? GREETING.attached : '';
    c.setAttribute('data-tone', document.documentElement.getAttribute('data-trif-tone') || (pageDark() ? 'dark' : 'light'));
    c.hidden = false;
    const width = Math.min(innerWidth, 420);
    c.style.width = `${width}px`;
    c.style.left = `${Math.round((innerWidth - width) / 2)}px`;
    // (the room: under the page's own top bar (a header at the top of the window), above the message box)
    let minTop = 12;
    for (const hd of document.querySelectorAll('header, [role="banner"]')) {
      const r = hd.getBoundingClientRect();
      if (r.top <= 8 && r.height > 0 && r.height < 160 && r.bottom > minTop && shown(hd)) minTop = r.bottom + 8;
    }
    const h = serviceGreeting(b.top, minTop);
    const fit = (tight) => {
      c.classList.toggle('trif-tight', tight);
      const height = c.getBoundingClientRect().height;
      let top = h ? (() => { const r = h.getBoundingClientRect(); return r.top + r.height / 2 - height / 2; })() : b.top - height - 20;
      top = Math.max(minTop, Math.min(top, b.top - height - 8));
      return top + height <= b.top - 4 ? top : null;
    };
    if (h && h !== hiddenHeading) { unhideHeading(); hiddenHeading = h; h.setAttribute('data-trif-greeting-hidden', ''); }
    if (!h) unhideHeading();
    let top = fit(false);
    if (top === null) top = fit(true);
    // (no room even for that: nothing, and the service's own greeting shown again)
    if (top === null) { c.hidden = true; unhideHeading(); return; }
    c.style.top = `${Math.round(top)}px`;
    // (something opened over that place, a side bar or a menu: the greeting isn't drawn over it)
    const mid = document.elementFromPoint(innerWidth / 2, Math.min(innerHeight - 1, Math.max(1, top + 26)));
    if (mid && mid.closest('nav, aside, [role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')) c.hidden = true;
  }
  /** The upsells hidden (only a button or link whose own words are one, and nothing that holds the message box). */
  function hideUpsells() {
    for (const el of document.querySelectorAll('a, button, [role="button"], [role="menuitem"]')) {
      if (el.hasAttribute('data-trif-hidden') || el.closest('[data-trif]')) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 40 || !UPSELL.test(t)) continue;
      const ed = editor();
      if (ed && el.contains(ed)) continue;
      el.setAttribute('data-trif-hidden', 'upsell');
    }
  }
  let lookQueued = false;
  function setTone() {
    const tone = pageDark() ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-trif-tone') !== tone) document.documentElement.setAttribute('data-trif-tone', tone);
  }
  function lookSoon() { if (!lookQueued) { lookQueued = true; requestAnimationFrame(() => { lookQueued = false; try { setTone(); placeGreeting(); } catch (e) {} }); } }
  function lookUpdate() { try { hideUpsells(); } catch (e) {} lookSoon(); }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(lookSoon, 300)); } catch (e) {}
  addEventListener('resize', lookSoon);
  addEventListener('scroll', lookSoon, { capture: true, passive: true });
  if (window.visualViewport) visualViewport.addEventListener('resize', lookSoon);
  /** From the app: the site this chat is for, and TRIF's robot (RobotShape's polygons and colours). */
  function look(site, shape) {
    lookSite = String(site || '');
    if (shape && shape.rim && !robot) {
      robot = shape;
      if (card) { card.remove(); card = null; }
      const u = robotURL();
      pillRobot.textContent = `
        :root { --trif-robot: ${u}; }
        span[data-trif-chip][class*="composer-attachment"]::before, [data-trif-chip] [data-cds-card-body]::after,
        [data-trif-chip][class*="group/thumbnail"] > div:first-child::before {
          display: inline-block; background-image: ${u}; background-repeat: no-repeat; background-size: 16px 16px;
          background-position: 0 center; padding-left: 22px !important; }
        span[data-trif-chip][class*="composer-attachment"]::before { background-position: 12px center; padding-left: 34px !important; }`;
    }
    lookUpdate();
    return 'ok';
  }

  let queued = false;
  // (one observer for the buttons, the pills, keeping the reply in view and a mod that turns up late: at most
  // every 400 ms, only when the page changes)
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); reveal(); late(); lookAtViewer(); lookUpdate(); }, 400); } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  mark();
  addEventListener('popstate', () => setTimeout(lookAtViewer, 300));

  /** (development) The message box's surroundings, as HTML, to see how a chat builds its chips and buttons. */
  function dump() {
    try { var m = metrics(); } catch (e) { m = String(e); }
    return `<!-- ${m} -->\n` + dumpBox();
  }
  function dumpBox() {
    const ed = editor();
    let box = ed;
    for (let i = 0; box && i < 8; i++) box = box.parentElement;
    return (box || document.body).outerHTML.slice(0, 60000);
  }

  globalThis.__trifChat = { fill, editor, dump, state, resume, showReply, clearTrif, look, viewer: () => { const v = viewer(); return v ? v.why : null; } };
})();
