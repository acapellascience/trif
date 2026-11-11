// The robot's faces (scripts/render-icon.js draws them): its toolbar icon per tab, and the side panel's
// robots (sidepanel.js). One face at a time, by precedence:
//   paused  (the agent ran code in the tab: tablock.js)   white, pause bars for eyes
//   blocked (the user blocked the tab's site in TRIF)      red, a cross for eyes
//   disconnected (TRIF can't reach the tab's site)          grey, a broken link for eyes
//   off     (TRIF is off on the tab's site)                 a blank face
//   login   (the agent isn't logged in; every tab)          yellow, hollow eyes
// Always one colour: the frame and what's on the face share it (docs/STYLE.md).
//   normal                                                  as usual
// Paused first: it's about what the page can do right now (posting blocked), whatever else is true.
// Blocked, disconnected and off are a site's states (one at a time), and win over logged out, which is
// every tab's. TRIF missing a part (the helper, user scripts: the panel's red) keeps the usual face, as
// the toolbar never showed it.

export const FACE_FILES = { normal: 'robot', paused: 'robot-paused-white', 'paused-light': 'robot-paused-light', blocked: 'robot-blocked', disconnected: 'robot-disconnected', off: 'robot-off', login: 'robot-login' };

/** The toolbar's icon paths for a face (the sizes manifest.json's action.default_icon has). */
export function facePaths(face) {
  const name = FACE_FILES[face] || FACE_FILES.normal;
  return { 16: `icons/${name}-16.png`, 32: `icons/${name}-32.png` };
}

/** The toolbar's face for a tab: always the usual robot (the panel shows the state). */
export function toolbarFace() {
  // The toolbar icon stays the usual green robot, beside the browser's other extensions (Tim, 2026-11-11): the
  // faces are the side panel's (its bar and gate), not the toolbar's.
  return 'normal';
}
