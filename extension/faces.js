// The robot's faces (scripts/render-icon.js draws them): its toolbar icon per tab, and the side panel's
// robots (sidepanel.js). One face at a time, by precedence:
//   paused  (the agent ran code in the tab: tablock.js)   white, pause bars for eyes
//   blocked (the user blocked the tab's site in TRIF)      red, a cross for eyes
//   disconnected (TRIF can't reach the tab's site)          grey, a broken link for eyes
//   off     (TRIF is off on the tab's site)                 a blank face
//   robotless (no chat agent in this browser; every tab)    off's blank face, in the usual green
//   login   (the agent isn't logged in; every tab)          yellow, hollow eyes
// Always one colour: the frame and what's on the face share it (docs/STYLE.md).
//   normal                                                  as usual
// Paused first: it's about what the page can do right now (posting blocked), whatever else is true.
// Blocked, disconnected and off are a site's states (one at a time), and win over robotless and logged
// out, which are every tab's. Robotless wins over logged out (no agent to log in to: the yellow face never
// shows then); its icon is off's, which is already green. TRIF missing a part (the helper, user scripts:
// the panel's red) keeps the usual face, as the toolbar never showed it.

export const FACE_FILES = { normal: 'robot', paused: 'robot-paused-white', 'paused-light': 'robot-paused-light', blocked: 'robot-blocked', disconnected: 'robot-disconnected', off: 'robot-off', robotless: 'robot-off', login: 'robot-login' };

/** The toolbar's icon paths for a face (the sizes manifest.json's action.default_icon has). */
export function facePaths(face) {
  const name = FACE_FILES[face] || FACE_FILES.normal;
  return { 16: `icons/${name}-16.png`, 32: `icons/${name}-32.png` };
}

/** The face for a tab: locked, its site's state ('on' | 'off' | 'disconnected' | 'blocked' | null), robotless, logged out; light: a light toolbar. */
export function toolbarFace({ locked = false, state = null, robotless = false, loggedOut = false, light = false } = {}) {
  if (locked) return light ? 'paused-light' : 'paused'; // (white on a dark toolbar; flipped on a light one)
  if (state === 'blocked') return 'blocked';
  if (state === 'disconnected') return 'disconnected';
  if (state === 'off') return 'off';
  if (robotless) return 'robotless';
  if (loggedOut) return 'login';
  return 'normal';
}
