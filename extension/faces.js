// The robot's faces (scripts/render-icon.js draws them): its toolbar icon per tab, and the side panel's
// robots (sidepanel.js). One face at a time, by precedence:
//   paused  (the agent ran code in the tab: tablock.js)   white pause bars
//   blocked (the user blocked the tab's site in TRIF)      red, a red cross for eyes
//   off     (TRIF is off on the tab's site)                 a blank face
//   login   (the agent isn't logged in; every tab)          yellow, hollow eyes
//   normal                                                  as usual
// Paused first: it's about what the page can do right now (posting blocked), whatever else is true. A
// disconnected site keeps the normal face (the panel shows it grey), and so does TRIF missing a part (the
// helper, user scripts: the panel's red), which the toolbar never showed.

export const FACE_FILES = { normal: 'robot', paused: 'robot-paused', blocked: 'robot-blocked', off: 'robot-off', login: 'robot-login' };

/** The toolbar's icon paths for a face (the sizes manifest.json's action.default_icon has). */
export function facePaths(face) {
  const name = FACE_FILES[face] || FACE_FILES.normal;
  return { 16: `icons/${name}-16.png`, 32: `icons/${name}-32.png` };
}

/** The face for a tab: locked, its site's state ('on' | 'off' | 'disconnected' | 'blocked' | null), logged out. */
export function toolbarFace({ locked = false, state = null, loggedOut = false } = {}) {
  if (locked) return 'paused';
  if (state === 'blocked') return 'blocked';
  if (state === 'off') return 'off';
  if (loggedOut) return 'login';
  return 'normal';
}
