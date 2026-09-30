// Every sound is synthesised here; there are no audio files.
//
// Four buses (effects, voice, music, ambience) feed a master bus with a touch of room reverb, so
// the settings can balance them. Ambience is a quiet room tone per level; music is a slow
// generative bed of soft chords that changes mood for the final room.
let actx = null, master = null, reverb = null;
const bus = {};
const vol = { master: 0.9, sfx: 1, voice: 0.9, music: 0.5, ambience: 0.6 };
let noiseBuf = null;

export function unlockAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; return; }
    master = actx.createGain(); master.connect(actx.destination);
    // a small, dark room: short generated impulse response
    reverb = actx.createConvolver();
    const len = Math.floor(actx.sampleRate * 1.6), ir = actx.createBuffer(2, len, actx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5; }
    reverb.buffer = ir;
    const wet = actx.createGain(); wet.gain.value = 0.22;
    reverb.connect(wet).connect(master);
    for (const k of ['sfx', 'voice', 'music', 'ambience']) {
      bus[k] = actx.createGain();
      bus[k].connect(master);
      if (k !== 'ambience') bus[k].connect(reverb);
    }
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  }
  if (actx.state === 'suspended') actx.resume();
}

export function setVolume(name, v) { vol[name] = v; applyVolumes(); }
export function getVolumes() { return { ...vol }; }
function applyVolumes() {
  if (!actx) return;
  master.gain.value = vol.master;
  for (const k in bus) bus[k].gain.value = vol[k];
}

// ---------- building blocks ----------
// While `place` is set, effects go through a panner and a distance gain instead of straight out.
let place = null;
const dest = to => (place && to === 'sfx' ? place : bus[to]);
function noise(dur, freq, q, gain, delay = 0, to = 'sfx', type = 'bandpass') {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest(to));
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, type, gain, delay = 0, to = 'sfx', attack = 0.01) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest(to));
  o.start(t); o.stop(t + dur + 0.05);
}

// Play a sound as if it came from `pos`, heard at `ear` facing `yaw`: quieter with distance,
// panned left or right, and muffled a little when it's far.
export function playAt(pos, ear, yaw, fn) {
  if (!actx) return;
  const dx = pos[0] - ear[0], dy = pos[1] - ear[1], dz = pos[2] - ear[2];
  const d = Math.hypot(dx, dy, dz);
  const g = actx.createGain(); g.gain.value = Math.min(1, 1.6 / (1 + d * 0.22));
  if (g.gain.value < 0.02) return;
  const pan = actx.createStereoPanner();
  // right is (cos yaw, 0, -sin yaw)
  pan.pan.value = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d)) : 0;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1200, 16000 / (1 + d * 0.12));
  g.connect(lp).connect(pan).connect(bus.sfx);
  place = g;
  try { fn(); } finally { place = null; }
}
const click = (f, g, d = 0) => noise(0.012, f, 3, g, d);

export const SFX = {
  // a mechanical shutter: trigger, curtain, spring
  shutter() { click(5200, 0.9); noise(0.03, 3000, 1.2, 0.5, 0.012); click(2400, 0.5, 0.055); tone(1900, 1500, 0.05, 'triangle', 0.03, 0.02); },
  // the film advance lever: a short ratchet
  lever() { for (let i = 0; i < 4; i++) click(2800 + i * 150, 0.28, 0.12 + i * 0.045); },
  // the print sliding out of the camera
  eject() { noise(0.35, 700, 1.5, 0.12, 0.1); tone(95, 110, 0.35, 'sawtooth', 0.015, 0.1); },
  wind() { noise(0.12, 1400, 2, 0.25); },
  // developing: a wet swish and a rising shimmer as the emulsion sets
  develop() { noise(0.45, 900, 0.5, 0.35); noise(0.25, 2400, 2, 0.12, 0.08); tone(220, 660, 0.45, 'sine', 0.1); tone(330, 990, 0.5, 'sine', 0.05, 0.05); },
  // dissolving: a falling fizz
  erase() { noise(0.6, 3500, 0.6, 0.35); noise(0.5, 600, 0.4, 0.3); tone(900, 140, 0.5, 'sine', 0.1); },
  deny() { tone(150, 120, 0.16, 'square', 0.04); },
  click() { click(3000, 0.35); },
  plate() { tone(660, 660, 0.18, 'triangle', 0.12); tone(990, 990, 0.3, 'triangle', 0.1, 0.11); },
  door() { noise(1.0, 140, 0.7, 0.9); tone(70, 45, 1.0, 'sawtooth', 0.05); noise(0.2, 1800, 2, 0.15, 0.95); },
  land(v = 1) { noise(0.16, 220, 1, Math.min(0.8, 0.25 * v)); click(900, 0.1 * v); },
  // footsteps: concrete scuff, a knock on wood, a ring on steel, a tick on glass
  step(surface, left) {
    const p = left ? 1 : 1.08;
    if (surface === 'crate' || surface === 'plank') { noise(0.09, 380 * p, 2, 0.35); click(1200 * p, 0.12); }
    else if (surface === 'steel' || surface === 'door') { noise(0.07, 1500 * p, 3, 0.2); tone(1400 * p, 1300 * p, 0.12, 'triangle', 0.02); }
    else if (surface === 'glass') { click(4000 * p, 0.15); }
    else { noise(0.08, 900 * p, 1.2, 0.22); noise(0.05, 3200 * p, 1.5, 0.06); }
  },
  undo() { tone(700, 350, 0.18, 'sine', 0.08); noise(0.15, 2000, 1, 0.08); },
  fall() { noise(0.5, 600, 0.4, 0.25); },
  done() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.5, 'triangle', 0.08, i * 0.1, 'music')); },
  // the Curator's voice: soft chirps, one per couple of letters, slightly varied
  voice(pitch = 1) { tone(420 * pitch, 380 * pitch, 0.05, 'sine', 0.03, 0, 'voice'); tone(840 * pitch, 760 * pitch, 0.03, 'sine', 0.008, 0, 'voice'); },
  card() { noise(0.09, 3000, 0.7, 0.12); },
  // the Enlarger
  charge(t) { tone(200, 900, t, 'sawtooth', 0.03); tone(100, 450, t, 'sine', 0.05); },
  flash() { noise(0.5, 5000, 0.4, 0.9); tone(1800, 200, 0.5, 'sine', 0.12); },
  boom() { noise(1.2, 90, 0.6, 1); tone(60, 30, 1.2, 'sawtooth', 0.12); },
  shutter2() { noise(0.8, 400, 0.8, 0.6); tone(120, 240, 0.8, 'square', 0.03); },
  dying() { [880, 660, 440, 330, 220, 110].forEach((f, i) => tone(f, f * 0.7, 0.6, 'sine', 0.08, i * 0.35)); },
  // PvP: a flashbulb going off, being caught in one, landing one, and a print being ruined
  bulb() { click(6000, 0.8); noise(0.25, 4200, 0.5, 0.7); tone(2600, 900, 0.3, 'sine', 0.08); noise(0.5, 900, 0.8, 0.12, 0.05); },
  exposed() { noise(0.6, 6000, 0.3, 0.6); tone(3200, 1800, 0.6, 'sine', 0.06); tone(90, 60, 0.4, 'sawtooth', 0.05); },
  confirm() { tone(1320, 1320, 0.07, 'triangle', 0.09); tone(1760, 1760, 0.09, 'triangle', 0.07, 0.06); },
  ruined() { noise(0.9, 2500, 0.4, 0.5); tone(700, 90, 0.9, 'sawtooth', 0.05); tone(1400, 200, 0.7, 'sine', 0.05, 0.05); },
  knocked() { [1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.08, i * 0.06)); },
  lock() { tone(2200, 2200, 0.05, 'square', 0.025); },
  warn() { tone(880, 880, 0.08, 'square', 0.03); tone(660, 660, 0.08, 'square', 0.03, 0.1); },
  plateOurs() { tone(523, 523, 0.18, 'triangle', 0.1, 0, 'music'); tone(784, 784, 0.3, 'triangle', 0.09, 0.12, 'music'); },
  plateTheirs() { tone(392, 392, 0.2, 'triangle', 0.1, 0, 'music'); tone(311, 311, 0.35, 'triangle', 0.09, 0.14, 'music'); },
  beep(hi) { tone(hi ? 1320 : 880, hi ? 1320 : 880, hi ? 0.35 : 0.12, 'sine', 0.12, 0, 'music'); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.6, 'triangle', 0.08, i * 0.12, 'music')); },
  lose() { [440, 415, 392, 330].forEach((f, i) => tone(f, f * 0.98, 0.7, 'sine', 0.08, i * 0.22, 'music')); },
  respawn() { noise(0.5, 900, 0.5, 0.25); tone(220, 660, 0.5, 'sine', 0.08); },
};

// ---------- ambience and music ----------
let amb = null, musicTimer = null, mood = 'archive';
export function startAmbience(kind = 'archive') {
  if (!actx) return;
  stopAmbience();
  mood = kind;
  const t = actx.currentTime;
  const out = actx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1, t + 2);
  out.connect(bus.ambience);
  const nodes = [];
  // room tone: filtered noise and a faint mains hum from the safelights
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'outside' ? 1400 : 320;
  const ng = actx.createGain(); ng.gain.value = kind === 'outside' ? 0.05 : 0.07;
  src.connect(lp).connect(ng).connect(out); src.start();
  nodes.push(src);
  if (kind !== 'outside') for (const [f, g] of [[50, 0.018], [100, 0.01], [150, 0.004]]) {
    const o = actx.createOscillator(); o.frequency.value = f;
    const og = actx.createGain(); og.gain.value = g;
    o.connect(og).connect(out); o.start(); nodes.push(o);
  }
  amb = { out, nodes };
  playChord(0);
}
export function stopAmbience() {
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  if (!amb || !actx) return;
  const t = actx.currentTime, a = amb;
  a.out.gain.cancelScheduledValues(t); a.out.gain.setValueAtTime(a.out.gain.value, t); a.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  setTimeout(() => a.nodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } }), 900);
  amb = null;
}

// Slow chords: warm and unresolved in the archive, a tense pulse at the end, open outside.
const PROGRESSIONS = {
  match: [[146.8, 185, 220, 277], [130.8, 164.8, 196, 247], [110, 146.8, 174.6, 220], [123.5, 155.6, 185, 233]],
  archive: [[196, 247, 294, 370], [174.6, 220, 262, 330], [164.8, 207.7, 247, 311], [174.6, 220, 277, 349]],
  enlarger: [[110, 131, 165, 208], [104, 131, 156, 208], [98, 123, 147, 185], [104, 131, 156, 196]],
  outside: [[262, 330, 392, 494], [220, 277, 330, 440], [247, 311, 370, 466], [262, 330, 392, 523]],
};
function playChord(i) {
  if (!actx || !amb) return;
  const chords = PROGRESSIONS[mood] || PROGRESSIONS.archive;
  const chord = chords[i % chords.length];
  const len = mood === 'enlarger' ? 4.5 : mood === 'match' ? 6 : 9;
  const t = actx.currentTime;
  for (const [j, f] of chord.entries()) {
    const o = actx.createOscillator(); o.type = j === 0 ? 'triangle' : 'sine';
    o.frequency.value = f / (j === 0 ? 2 : 1);
    o.detune.value = (j - 1.5) * 4;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(j === 0 ? 0.05 : 0.022, t + len * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.1);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    o.connect(lp).connect(g).connect(bus.music);
    o.start(t); o.stop(t + len * 1.15);
  }
  if (mood === 'match') for (let k = 0; k < 12; k++) tone(73.4, 70, 0.18, 'sine', k % 3 ? 0.025 : 0.05, k * (len / 12), 'music', 0.01);
  if (mood === 'enlarger') for (let k = 0; k < 8; k++) tone(55, 50, 0.3, 'sine', 0.06, k * (len / 8), 'music', 0.02);
  musicTimer = setTimeout(() => playChord(i + 1), len * 1000);
}
