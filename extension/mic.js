// mic.html: asks for the microphone for TRIF's own origin (dictation.js), tells the panel that opened it (by
// MIC_CHANNEL, with the question's id from ?ask=) and closes itself once it's allowed.
import { BROWSER } from './lib.js';
import { DICTATION_WORDS, MIC_PAGE_WORDS, MIC_CHANNEL, wordsFor, micSettingsUrl, micPermission } from './dictation.js';

const ask = new URLSearchParams(location.search).get('ask') || '';
const channel = new BroadcastChannel(MIC_CHANNEL);
const $ = (id) => document.getElementById(id);
const say = (result) => channel.postMessage({ type: 'mic', ask, result });
const w = (table, vars) => wordsFor(table, BROWSER, vars);

$('title').textContent = MIC_PAGE_WORDS.title;
document.title = MIC_PAGE_WORDS.title;
$('lead').textContent = MIC_PAGE_WORDS.lead;
$('where').textContent = w(DICTATION_WORDS.firstUse);
$('again').textContent = MIC_PAGE_WORDS.askAgain;
$('settings').textContent = DICTATION_WORDS.openSettings;
$('close').textContent = MIC_PAGE_WORDS.closeTab;

let done = false;

function show(text, { kind = '', again = false, settings = false, close = false } = {}) {
  const s = $('state');
  s.textContent = text;
  s.className = kind;
  $('again').hidden = !again;
  $('settings').hidden = !settings || !micSettingsUrl(BROWSER, location.origin);
  $('close').hidden = !close;
}

async function closeSelf() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) { await chrome.tabs.remove(tab.id); return; }
  } catch { /* not a tab */ }
  window.close();
}

function allowed() {
  if (done) return;
  done = true;
  show(MIC_PAGE_WORDS.granted, { kind: 'ok' });
  say('granted');
  setTimeout(closeSelf, 900);
}

async function request() {
  show(w(MIC_PAGE_WORDS.asking));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop(); // (only the permission: nothing is recorded here)
    allowed();
  } catch (e) {
    if (done) return;
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' || e?.name === 'NotReadableError') {
      show(DICTATION_WORDS.noMic, { kind: 'bad', again: true, close: true });
      say('nomic');
      return;
    }
    if ((await micPermission()) === 'denied') {
      show(w(DICTATION_WORDS.blocked), { kind: 'bad', settings: true, close: true });
      say('denied');
    } else {
      show(MIC_PAGE_WORDS.dismissed, { again: true, close: true }); // (the question closed unanswered: ask again)
    }
  }
}

$('again').addEventListener('click', request);
$('close').addEventListener('click', closeSelf);
$('settings').addEventListener('click', () => {
  const url = micSettingsUrl(BROWSER, location.origin);
  if (url) chrome.tabs.create({ url }).catch(() => {});
});
// (allowed later, in the browser's settings: the panel hears it, and this closes)
navigator.permissions?.query({ name: 'microphone' }).then((p) => {
  p.addEventListener('change', () => { if (p.state === 'granted') allowed(); });
}, () => {});

request();
