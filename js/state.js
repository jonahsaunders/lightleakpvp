// The page's shared state. Modules read and write it directly; it keeps the wiring simple.
// (The match itself lives in shared/ and reaches the page only as messages.)
export const G = {
  R: null,            // Rapier
  renderer: null, scene: null, camera: null,
  L: null,            // the match being shown (see game.js)
  roll: [],           // your photos, with thumbnails
  selected: -1,       // index into roll, or -1
  filmMode: 'pos',    // 'pos' or 'neg'
  frameIdx: 0,        // index into CAMERA.frames
  aim: false,         // camera raised this frame
  alive: false,
  headless: false,
  mode: 'title',      // title | playing | paused
  hooks: {},
};

export function emit(name, ...args) { const f = G.hooks[name]; if (f) f(...args); }
