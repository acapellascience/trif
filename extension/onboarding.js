// Status page: helper connection, the "Allow User Scripts" switch, installed mods.
// Polls the service worker, which also re-checks the switch on every status request.

const $ = (sel) => document.querySelector(sel);

function setSection(id, ok, title, detail) {
  const el = document.getElementById(id);
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
  el.querySelector('.title').textContent = title;
  const d = el.querySelector('.detail');
  d.replaceChildren(...(Array.isArray(detail) ? detail : [detail ?? '']));
}

function code(text) {
  const c = document.createElement('code');
  c.textContent = text;
  return c;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function render(s) {
  if (s.helper.connected) {
    setSection('helper', true, 'Helper connected', 'Your coding agent can use the webmods command.');
  } else {
    setSection('helper', false, 'Helper not connected', [
      'Run ', code('webmods setup'), ' in a terminal, then quit and restart Chrome.',
      ...(s.helper.error ? [el('br'), `Chrome says: ${s.helper.error}`] : []),
    ]);
  }
  $('#reconnect').hidden = s.helper.connected;

  if (s.userScripts) {
    setSection('userscripts', true, 'User scripts allowed', 'Mods can run on websites.');
  } else {
    setSection('userscripts', false, 'User scripts are off',
      'Open the extension settings and turn on "Allow User Scripts".');
  }
  $('#settings').hidden = !!s.userScripts;

  const list = $('#mod-list');
  list.replaceChildren();
  const modsDetail = $('#mods .detail');
  if (!s.mods.length) {
    modsDetail.replaceChildren('No mods yet. Open your coding agent in ', code('~/.webmods'), ' and ask it to change a website.');
  } else {
    modsDetail.replaceChildren();
    for (const m of s.mods) {
      const li = el('li');
      const name = el('div', 'mod-name', m.name);
      if (!m.registered) name.append(el('span', 'tag', s.userScripts ? 'not active' : 'paused'));
      li.append(name, el('div', 'mod-id', m.id));
      if (m.description) li.append(el('div', 'mod-desc', m.description));
      if (m.error) li.append(el('div', 'mod-err', m.error));
      list.append(li);
    }
  }
  const rec = s.recording.length ? ` · recording requests on ${s.recording.join(', ')}` : '';
  $('#footer').textContent = `WebMods ${s.version} · Chrome ${s.chrome}${rec}`;
}

async function refresh() {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'status' });
    if (s && !s.error) render(s);
  } catch (e) {
    console.warn('status failed', e);
  }
}

$('#settings').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
$('#reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  setTimeout(refresh, 800);
});

refresh();
setInterval(refresh, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
