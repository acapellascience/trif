// Android's adapter, in TRIF's world of every frame (not only the main frame's): tells the app when this frame
// starts or stops playing sound, so a change to the mods doesn't reload a page that's playing (docs/MOBILE-BEHAVIOUR.md,
// "Which tabs load again"). iPhone asks WebKit, then the page (Browser.playing); Android's WebView has no such call,
// so each frame says it: a video or audio playing, not muted (a muted feed video doesn't count), as iPhone's
// pagePlaying. A frame playing in another origin's frame counts too (iPhone's "in a frame, maybe").
(() => {
  const app = globalThis.trifApp;
  if (!app || globalThis.__trifPlayingWatch) return;
  globalThis.__trifPlayingWatch = true;
  const post = app.postMessage.bind(app), stringify = JSON.stringify;
  const frame = Math.random().toString(36).slice(2);
  let was = false, timer = 0;
  const now = () => [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && !m.muted);
  const say = (p) => { if (p === was) return; was = p; try { post(stringify({ playing: p, frame })); } catch (e) { /* gone */ } };
  const check = () => {
    say(now());
    // (while playing, looked at again now and then: a media element taken out of the page stops without an event here)
    if (was && !timer) timer = setInterval(() => { say(now()); if (!was) { clearInterval(timer); timer = 0; } }, 3000);
  };
  for (const e of ['play', 'playing', 'pause', 'ended', 'volumechange', 'emptied']) document.addEventListener(e, check, true);
  addEventListener('pagehide', () => say(false), true);
})();
