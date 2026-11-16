// TRIF in the chat (proof of concept, branch ios-poc; Tim, 11-13 and 11-15): a small mod for claude.ai and
// chatgpt.com, run in a world of its own beside their page (ClaudePane.chatWorld), so their code can't reach
// it. What it does, and nothing else:
//   - an "Add to TRIF" button under each code block that holds a whole mod file (==WebMod== … ==/WebMod==):
//     a tap hands the block's text to the app, which shows its Add this mod? sheet (the BUTTON path);
//   - fill(text, png): puts text (and a picture) into the message box, as a paste, for the person to send;
//   - the person's send (the send button, or Return in the message box) told to the app, which goes back to
//     the tab; then the reply watched until it's done (for the chat button's dots and its replied mark), and the mod
//     files in its code blocks (ones that weren't there before the send) handed to the app, which asks Add this mod?
//     about each (Tim, 11-15; kept, 11-16) (the AUTO path).
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
  function lookAtViewer() {
    const v = viewer();
    if (!v) { viewerSeen = ''; return; }
    const code = viewerCode(v.root);
    const name = ((v.root.innerText || '').match(/[\w.() -]+\.js\b/) || [''])[0].trim();
    const key = `${name}|${code ? code.length : 0}|${(code || '').slice(0, 200)}`;
    if (key === viewerSeen) return;
    viewerSeen = key;
    post({ type: 'viewer', why: v.why, name, path: location.pathname.replace(/[^/]{24,}/g, '…'), text: code || '' });
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
  function fileInput() {
    const box = composerBox();
    const all = [...(box && box.closest('form') || document).querySelectorAll('input[type="file"]'), ...document.querySelectorAll('input[type="file"]')];
    const usable = all.filter((i) => !i.disabled);
    // (one that takes text; else the one for files rather than photos or the camera: chatgpt.com's mobile composer has
    // #octane-mobile-composer-files-input beside its photos and camera inputs; logged out it takes pictures only)
    return usable.find((i) => !i.accept || /text|\.txt|\*\/\*/.test(i.accept))
      || usable.find((i) => /file/i.test(`${i.id} ${i.name}`) && !/photo|camera/i.test(`${i.id} ${i.name}`)) || null;
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
      dt.items.add(new File([bytes], picture || 'TRIF screenshot.png', { type: /\.jpe?g$/i.test(picture || '') ? 'image/jpeg' : 'image/png' }));
      said.push(paste(ed, dt) ? 'picture pasted' : 'picture not taken');
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
    if (text && name) {
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
          const input = fileInput();
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
    for (const pre of document.querySelectorAll('pre')) {
      if (pre.nextElementSibling && pre.nextElementSibling.classList.contains('trif-add')) continue;
      const t = pre.textContent || '';
      if (!t.includes('==WebMod==') || !t.includes('==/WebMod==')) continue;
      const b = document.createElement('button');
      b.className = 'trif-add';
      b.type = 'button';
      b.textContent = 'Add to TRIF';
      b.setAttribute('style', 'all:initial;display:inline-block;margin:6px 0 10px;padding:6px 14px;border-radius:999px;' +
        'background:#34d399;color:#04291c;font:600 14px -apple-system,system-ui,sans-serif;cursor:pointer;');
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'mod', text: pre.innerText || '' }); });
      pre.after(b);
    }
  }
  // The send button in TRIF's green (Tim, 11-14): Claude paints it on a layer inside the button
  // ([data-cds-part=paint]); ChatGPT on the button. And what TRIF attaches (the page, "TRIF instruction"; after a
  // mod is added, "TRIF follow-up", "TRIF screenshot" and "TRIF full page") as small pills saying so, not big tiles
  // (data-trif-chip, set by mark below); their remove buttons stay.
  const style = document.createElement('style');
  style.textContent = `
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
    span[data-trif-chip="TRIF instruction"][class*="composer-attachment"]::before { content: "TRIF instruction"; }
    span[data-trif-chip="TRIF follow-up"][class*="composer-attachment"]::before { content: "TRIF follow-up"; }
    span[data-trif-chip="TRIF screenshot"][class*="composer-attachment"]::before { content: "TRIF screenshot"; }
    span[data-trif-chip="TRIF full page"][class*="composer-attachment"]::before { content: "TRIF full page"; }
    span[data-trif-chip="TRIF pointer"][class*="composer-attachment"]::before { content: "TRIF pointer"; }
    [data-trif-chip] { width: auto !important; height: auto !important; min-width: 0 !important; align-self: flex-start; }
    [data-trif-chip] [data-cds-card-body] { padding: 6px 14px !important; flex-direction: row !important; align-items: center !important; }
    [data-trif-chip] [data-cds-card-body] > div, [data-trif-chip] img, [data-trif-chip] picture { display: none !important; }
    [data-trif-chip] [data-cds-card-body]::after {
      font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip] .cds-card-fill { background: #e3f7ee !important; }
    [data-trif-chip="TRIF instruction"] [data-cds-card-body]::after { content: "TRIF instruction"; }
    [data-trif-chip="TRIF follow-up"] [data-cds-card-body]::after { content: "TRIF follow-up"; }
    [data-trif-chip="TRIF screenshot"] [data-cds-card-body]::after { content: "TRIF screenshot"; }
    [data-trif-chip="TRIF full page"] [data-cds-card-body]::after { content: "TRIF full page"; }
    [data-trif-chip="TRIF pointer"] [data-cds-card-body]::after { content: "TRIF pointer"; }
    /* (Claude's picture-preview tile, a PDF's: a fixed box with the preview and "pdf" in it; the box made a pill,
       its insides hidden, the remove button kept: Tim, 11-14) */
    [data-trif-chip][class*="group/thumbnail"] > div:first-child {
      width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important;
      border-radius: 999px !important; border: 0 !important; box-shadow: none !important; background: #e3f7ee !important;
      padding: 7px 16px !important; font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip][class*="group/thumbnail"] > div:first-child > * { display: none !important; }
    [data-trif-chip="TRIF instruction"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF instruction"; }
    [data-trif-chip="TRIF follow-up"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF follow-up"; }
    [data-trif-chip="TRIF screenshot"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF screenshot"; }
    [data-trif-chip="TRIF full page"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF full page"; }
    [data-trif-chip="TRIF pointer"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF pointer"; }
    @media (prefers-color-scheme: dark) {
      [data-trif-chip] .cds-card-fill { background: rgba(52, 211, 153, 0.16) !important; }
      [data-trif-chip] [data-cds-card-body]::after { color: #34d399; }
      span[data-trif-chip][class*="composer-attachment"]::before { background: rgba(52, 211, 153, 0.16); color: #34d399; }
      [data-trif-chip][class*="group/thumbnail"] > div:first-child { background: rgba(52, 211, 153, 0.16) !important; color: #34d399; }
    }`;
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
  const USER = '[data-testid="user-message"], [data-message-author-role="user"]';
  const REPLY = '[data-is-streaming], .font-claude-response, [data-message-author-role="assistant"]';
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

  /** The mod files in code blocks: [{ key: its header, text }], in page order. */
  function modBlocks(onlyAfter) {
    const out = [];
    // (not the code a viewer shows over the chat: that's read as the viewer's, without its line numbers, lookAtViewer)
    const v = viewer();
    const over = v && v.root !== document.body && v.root.localName !== 'main' ? v.root : null;
    for (const pre of document.querySelectorAll('pre')) {
      if (onlyAfter && !(onlyAfter.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (pre.closest(VIEWER) || (over && over.contains(pre))) continue;
      const raw = pre.textContent || '';
      const end = raw.search(/==\/WebMod==/);
      if (raw.indexOf('==WebMod==') === -1 || end === -1) continue;
      out.push({ key: raw.slice(0, end), raw, pre });
    }
    return out;
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
    sending = true;
    const t0 = Date.now();
    const check = () => {
      const now = composer();
      const went = document.querySelectorAll(USER).length > users || replying() || (!now.text && !now.names.length);
      if (went) {
        sending = false;
        post({ type: 'sent', how, withInstructions });
        startWatch(seen);
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

  function startWatch(seen) {
    stopWatch();
    const w = { seen, saw: false, sig: null, at: Date.now(), started: Date.now(), timer: 0, queued: false, mo: null };
    watch = w;
    w.mo = new MutationObserver(() => {
      if (w.queued) return;
      w.queued = true;
      setTimeout(() => { w.queued = false; settle(w); }, 500);
    });
    w.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'aria-label', 'disabled'] });
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
    const now = Date.now();
    const busy = replying();
    if (busy) w.saw = true;
    const sig = signature();
    if (sig !== w.sig) { w.sig = sig; w.at = now; }
    const quiet = now - w.at;
    const done = !busy && !!editor() && (w.saw ? quiet >= 1200 : quiet >= 6000);
    if (done) return finish(w, w.saw ? 'done' : 'quiet');
    if (now - w.started > 15 * 60000) return finish(w, 'timed out');
    // (one more look once the page has gone quiet: nothing else wakes this up when nothing changes)
    w.timer = setTimeout(() => settle(w), !busy && w.saw ? 1300 : busy ? 4000 : 6100);
  }
  /** The reply's done: told to the app (the dots stop), with its new mod files. */
  function finish(w, why) {
    stopWatch();
    last = { seen: w.seen, path: location.pathname };
    post({ type: 'done', why, mods: autoPickup(w.seen), stop: w.saw });
  }
  /** (AUTO path) The mod files in code blocks that weren't there before the send, the latest of each (by its header);
   *  all of them then count as seen. */
  function autoPickup(seen) {
    // (a mod by its header, ==WebMod== to ==/WebMod==, whatever is around it)
    const keyOf = (t) => { const end = t.search(/==\/WebMod==/); return end === -1 ? t : t.slice(t.indexOf('==WebMod=='), end).replace(/\s+/g, ' '); };
    const byKey = new Map();
    for (const b of modBlocks()) if (!seen.has(b.raw)) { const t = (b.pre.querySelector('code') || b.pre).innerText || b.raw; byKey.set(keyOf(t), t); }
    for (const b of modBlocks()) seen.add(b.raw);
    return [...byKey.values()];
  }

  /** (AUTO path) After a reply, a mod file that turns up later on the same conversation (a chat that paused, a revised block). */
  let lateSig = '';
  let lateTimer = 0;
  function late() {
    if (!last || watch || sending || replying() || location.pathname !== last.path) return;
    const fresh = modBlocks().filter((b) => !last.seen.has(b.raw));
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
    startWatch(seen);
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
  const MSGS = '[data-testid="user-message"], [data-is-streaming], .font-claude-response, [data-message-author-role]';
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

  let queued = false;
  // (one observer for the buttons, the pills, keeping the reply in view and a mod that turns up late: at most
  // every 400 ms, only when the page changes)
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); reveal(); late(); lookAtViewer(); }, 400); } })
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

  globalThis.__trifChat = { fill, editor, dump, state, resume, showReply, clearTrif, viewer: () => { const v = viewer(); return v ? v.why : null; } };
})();
