// Tuning shared by the server, the browser and the bots. Nothing in shared/ touches the DOM or
// three.js, so the same simulation runs in Node (online matches) and in the page (practice).
export const VERSION = '0.1.0';
export const PROTOCOL = 1;

export const DT = 1 / 60;                 // fixed simulation step
export const SNAP_EVERY = 2;              // ticks between snapshots (30 a second)
export const GRAVITY = 18;                // for props
export const PLAYER = {
  gravity: 22, jump: 1.3, speed: 5.6, eye: 1.6, height: 1.75, radius: 0.3, step: 0.45,
};
export const CAMERA = {
  fov: 75, aimFov: 52, range: 60, roll: 3,
  minDim: 0.15, maxDim: 6,                // a developed photo stays inside these sizes overall (smaller than the campaign's 10 m)
  maxGroup: 5,                            // objects one photo can hold
  frames: [0, 0.3, 0.5, 0.75, 1],         // capture frame sizes: 0 is "just what's under the crosshair"
};
export const DENSITY = { crate: 0.6, steel: 3, plank: 0.6 };
export const NAMES = { crate: 'Crate', steel: 'Steel block', plank: 'Plank' };

// Film comes back on its own; negatives more slowly. Flash bulbs are for portraits.
export const FILM = { pos: { max: 4, every: 5 }, neg: { max: 2, every: 9 } };
export const FLASH = {
  bulbs: 3, every: 3.2,                   // bulbs held and seconds to get one back
  range: 26,                              // metres a flash reaches
  cone: 0.12,                             // half-width of the focus box, as a tangent (about 7 degrees)
  focus: 0.55,                            // seconds to pull focus onto someone
  refocus: 0.5,                           // a flash knocks focus back by this much of that
  cooldown: 0.8,                          // seconds between flashes
};
export const EXPOSURE = { marks: 3, fadeAfter: 4, fadeEvery: 3 };
// A falling object hurts by momentum (tonnes times metres a second): 1, 2 or 3 marks.
export const CRUSH = { speed: 4.5, impulse: [1.2, 5, 10] };
export const RESPAWN = 5;                 // seconds before a ruined print develops again
export const SPAWN_SAFE = 2;              // seconds of protection after developing
export const PROP_CAP = 5;                // developed things alive per player; the oldest goes first
export const EMULSION_REGROW = 25;        // seconds before dissolved emulsion sets again
export const PROP_RESPAWN = 15;           // seconds before a map's own crate or block comes back

export const TEAMS = [
  { name: 'Safelight', short: 'RED', color: '#e8553b', hex: 0xe8553b },
  { name: 'Cyanotype', short: 'BLUE', color: '#4aa8d8', hex: 0x4aa8d8 },
];

export const MODES = {
  plates: { name: 'Plates', blurb: 'Hold the plates with your own weight. Each held plate scores a point a second.', respawn: true, time: 480 },
  lastlight: { name: 'Last Light', blurb: 'No second prints. Knock out the other team; first to three rounds.', respawn: false, time: 120, rounds: 3 },
};
export const SIZES = [1, 2, 5];
export const DIFFICULTY = {
  easy: { turn: 2.4, react: 0.8, wobble: 0.06, think: 0.6, hesitate: 0.6, crush: false },
  normal: { turn: 4, react: 0.45, wobble: 0.03, think: 0.35, hesitate: 0.25, crush: true },
  hard: { turn: 7, react: 0.25, wobble: 0.012, think: 0.2, hesitate: 0.06, crush: true },
};

export const BOT_NAMES = ['Halide', 'Tungsten', 'Bromide', 'Gelatin', 'Albumen', 'Collodion', 'Nitrate', 'Umber', 'Sepia', 'Stopbath',
  'Vignette', 'Aperture', 'Grain', 'Fixer', 'Silver', 'Iris', 'Shutter', 'Emulsion', 'Selenium', 'Platinum'];
