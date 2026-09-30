// Boot, input, the loop, and getting between the menus and a match.
import RAPIER from '../vendor/rapier.mjs';
import { G } from './state.js';
import { DT, CAMERA, TEAMS, MODES } from '../shared/config.js';
import { Arena } from '../shared/arena.js';
import { expandMap } from '../shared/mapdef.js';
import { initMaterials, ENV } from './materials.js';
import { setQuality, renderFrame, resizePost } from './post.js';
import { initHUD, toast, flash, filmSwitched, banner, exposed, updateRoll, frameHUD, scoreboard, resultsHTML } from './hud.js';
import { SFX, unlockAudio } from './audio.js';
import { initViewmodel, stepViewmodel, vmSwitch } from './viewmodel.js';
import { SET, applySettings, settingsPanel } from './settings.js';
import { buildView, propMesh } from './view.js';
import { ClientMatch } from './game.js';
import { Online, Local } from './net.js';
import { initMenu, menuMessage, tab, lobbyUI, playerName, renderOnline } from './menu.js';

const THREE = window.THREE;
const $ = id => document.getElementById(id);

// ---------- renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0908);
scene.fog = new THREE.Fog(0x0b0908, 30, 90);
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 10, 0.05, 250);
camera.rotation.order = 'YXZ';
scene.add(camera);
Object.assign(G, { renderer, scene, camera });
function resize() {
  if (!innerWidth || !innerHeight) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  resizePost();
}
addEventListener('resize', resize);

// ---------- state ----------
let net = null, game = null, practice = false, practiceSettings = null, address = '', maps = {};
let showcase = null, paused = false, locked = false, showScores = false;

// ---------- input ----------
const live = { keys: new Set(), yaw: 0, pitch: 0, aimHeld: false, actions: [], pad: { lx: 0, ly: 0, jump: false, aim: false } };
const q4 = v => Math.round(v * 1e4) / 1e4;
function liveInput() {
  const k = live.keys, pad = live.pad;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - pad.ly, r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + pad.lx;
  return {
    f: THREE.MathUtils.clamp(f, -1, 1), r: THREE.MathUtils.clamp(r, -1, 1),
    jump: k.has('Space') || pad.jump, yaw: q4(live.yaw), pitch: q4(live.pitch),
    frozen: paused,
    setLook(y, p) { live.yaw = y; live.pitch = p; this.yaw = y; this.pitch = p; },
  };
}
const playing = () => game && G.mode === 'playing';
function act(a) { if (playing()) live.actions.push(a); }

addEventListener('keydown', e => {
  if (!playing() || paused) return;
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  live.keys.add(e.code);
  if (e.code === 'Tab') showScores = true;
  if (e.repeat) return;
  const map = { KeyF: 'aimtoggle', KeyG: 'frame:cycle', KeyX: 'discard', KeyT: 'film', KeyQ: 'rotate:-1', KeyE: 'rotate:1', Digit1: 'select:0', Digit2: 'select:1', Digit3: 'select:2' };
  if (map[e.code]) act(map[e.code]);
});
addEventListener('keyup', e => { live.keys.delete(e.code); if (e.code === 'Tab') showScores = false; });
addEventListener('blur', () => { live.keys.clear(); live.aimHeld = false; showScores = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('click', () => { if (playing() && !paused && !locked) lock(); });
addEventListener('mousedown', e => {
  if (!playing() || !locked || paused) return;
  if (e.button === 2) live.aimHeld = true;
  if (e.button === 0) act('click');
});
addEventListener('mouseup', e => { if (e.button === 2) live.aimHeld = false; });
addEventListener('mousemove', e => {
  if (!locked || !playing() || paused) return;
  const s = 0.0022 * (camera.fov / SET.fov) * SET.sens;
  live.yaw -= e.movementX * s;
  live.pitch = THREE.MathUtils.clamp(live.pitch - e.movementY * s * (SET.invertY ? -1 : 1), -1.5, 1.5);
});
let wheelAcc = 0;
addEventListener('wheel', e => {
  if (!playing() || !locked || paused) return;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  const d = wheelAcc > 0 ? 1 : -1;
  wheelAcc = 0;
  if (G.aim) act(`frame:${-d}`);
  else if (G.roll.length) act(`cycle:${d}`);
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && playing() && !paused) openPause();
});
function lock() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* stays unlocked */ } }

const padPrev = [];
function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find(p => p && p.connected);
  const pad = live.pad;
  if (!gp) { pad.lx = pad.ly = 0; pad.jump = pad.aim = false; return; }
  const dz = v => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
  const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const edge = i => { const now = pressed(i), was = padPrev[i]; padPrev[i] = now; return now && !was; };
  if (!playing() || paused) {
    if (edge(9) && paused) resume();
    for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = pressed(i);
    return;
  }
  pad.lx = dz(gp.axes[0] || 0); pad.ly = dz(gp.axes[1] || 0);
  const lookX = dz(gp.axes[2] || 0), lookY = dz(gp.axes[3] || 0);
  const speed = 2.8 * SET.sens * (camera.fov / SET.fov);
  live.yaw -= lookX * Math.abs(lookX) * speed * dt;
  live.pitch = THREE.MathUtils.clamp(live.pitch - lookY * Math.abs(lookY) * speed * dt * (SET.invertY ? -1 : 1), -1.5, 1.5);
  pad.jump = pressed(0);
  pad.aim = !!(gp.buttons[6] && gp.buttons[6].value > 0.4);
  if (edge(7)) act('click');
  if (edge(2)) act('film');
  if (edge(3)) act('discard');
  if (edge(4)) act(G.aim ? 'frame:-1' : 'cycle:-1');
  if (edge(5)) act(G.aim ? 'frame:1' : 'cycle:1');
  if (edge(12)) act('frame:1');
  if (edge(13)) act('frame:-1');
  if (edge(14)) act('rotate:-1');
  if (edge(15)) act('rotate:1');
  showScores = pressed(8);
  if (edge(9)) { document.exitPointerLock?.(); openPause(); }
  for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = pressed(i);
}

// Your clicks and keys, turned into what they mean right now.
function handle(a) {
  const [name, arg] = a.split(':');
  const n = Number(arg);
  if (!G.alive) return;
  if (name === 'click') { if (G.aim) game.act('shoot'); else if (G.selected >= 0) game.act('develop'); }
  else if (name === 'aimtoggle') { G.aimToggle = !G.aimToggle; if (G.aimToggle) G.selected = -1; updateRoll(); }
  else if (name === 'select') { G.selected = n >= G.roll.length || G.selected === n ? -1 : n; G.aimToggle = false; updateRoll(); }
  else if (name === 'cycle') { const k = G.roll.length; if (!k) return; G.selected = G.selected < 0 ? (n > 0 ? 0 : k - 1) : (G.selected + n + k) % k; G.aimToggle = false; updateRoll(); }
  else if (name === 'rotate') game.rotate(n);
  else if (name === 'discard') game.act('discard');
  else if (name === 'frame') {
    const last = CAMERA.frames.length - 1;
    const next = arg === 'cycle' ? (G.frameIdx + 1) % (last + 1) : THREE.MathUtils.clamp(G.frameIdx + n, 0, last);
    if (next !== G.frameIdx) SFX.click();
    G.frameIdx = next;
  } else if (name === 'film') { G.filmMode = G.filmMode === 'pos' ? 'neg' : 'pos'; SFX.click(); filmSwitched(); vmSwitch(); updateRoll(); }
}

// ---------- the network ----------
function onNet(m) {
  switch (m.t) {
    case 'welcome':
      if (practice) net.send({ t: 'create', settings: practiceSettings });
      else lobbyUI.welcome(m, address);
      break;
    case 'rooms': lobbyUI.rooms(m.rooms); break;
    case 'room': if (!practice) lobbyUI.room(m.room); break;
    case 'error': if (game) toast(m.text); else menuMessage(m.text); break;
    case 'chat': lobbyUI.chat(m.from, m.text); if (game) toast(`${m.from}: ${m.text}`); break;
    case 'start': beginMatch(m); break;
    case 'pong': if (game) game.ping = Math.round(performance.now() - m.at); break;
    default: if (game) game.handle(m);
  }
}
function connect(addr, name) {
  closeNet();
  practice = false; address = addr;
  const n = net = new Online(addr);
  n.onopen = () => n.send({ t: 'hello', name });
  n.onmessage = onNet;
  n.onclose = () => {
    if (net !== n) return;
    net = null;
    const was = !!game;
    endMatch();
    lobbyUI.disconnected(was ? 'Lost the connection to the server.' : `Couldn't reach a Lightleak PvP server at ${addr}.`);
    showMenu();
  };
}
function closeNet() { if (net) { const n = net; net = null; n.close(); } }
function startPractice(settings) {
  closeNet();
  unlockAudio();
  practice = true; practiceSettings = settings;
  net = new Local(G.R, maps);
  net.onmessage = onNet;
  net.send({ t: 'hello', name: playerName() || 'You' });
}

// ---------- a match ----------
function beginMatch(msg) {
  endMatch(true);
  dropShowcase();
  unlockAudio();
  game = new ClientMatch(net, msg, { practice });
  live.yaw = msg.yaw; live.pitch = 0; live.actions.length = 0;
  G.mode = 'playing'; G.aimToggle = false; paused = false; showScores = false;
  $('menu').hidden = true; $('results').hidden = true; $('pause').hidden = true; $('hud').hidden = false;
  $('keys').innerHTML = '<kbd>RMB</kbd> camera · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> photos<br><kbd>T</kbd> negative · <kbd>Q</kbd><kbd>E</kbd> turn · <kbd>X</kbd> throw away<br><kbd>Tab</kbd> scores';
  const mode = MODES[msg.settings.mode];
  $('netinfo').innerHTML = `<b>${msg.map.name}</b><br>${mode.name} · ${msg.settings.size}v${msg.settings.size} · you're <span style="color:${TEAMS[game.team].color}">${TEAMS[game.team].name}</span>`;
  updateRoll();
  banner(`${mode.name} · ${msg.map.name}`, TEAMS[game.team].color);
  lock();
}
function endMatch(keepNet = false) {
  if (game) { game.destroy(); game = null; }
  G.mode = 'title'; paused = false;
  $('hud').hidden = true; $('pause').hidden = true;
  if (!keepNet && practice) { closeNet(); practice = false; }
}
function showMenu() {
  endMatch(!practice);
  document.exitPointerLock?.();
  $('results').hidden = true;
  $('menu').hidden = false;
  if (!showcase) makeShowcase();
}
function openPause() {
  if (!game) return;
  paused = true;
  live.keys.clear(); live.aimHeld = false; G.aimToggle = false; showScores = false;
  $('pause-kind').textContent = practice ? 'PRACTICE' : 'ONLINE';
  $('pause-note').textContent = practice ? 'The practice match is paused.' : 'The match carries on without you while this is open.';
  settingsPanel($('settings-panel-2'));
  $('pause').hidden = false;
}
function resume() { paused = false; $('pause').hidden = true; lock(); }
$('resume').onclick = resume;
$('leave').onclick = () => {
  if (practice) { showMenu(); tab('practice'); }
  else { net && net.send({ t: 'leave' }); lobbyUI.left(); showMenu(); tab('online'); }
};
G.hooks = {
  toast, flash, rollChanged: updateRoll, banner,
  exposed(from) { exposed(from); },
  shake(a) { if (SET.shake) shake = Math.max(shake, a); },
  over(r) {
    document.exitPointerLock?.();
    setTimeout(() => {
      if (!game || game.results !== r) return;
      $('results-body').innerHTML = resultsHTML(r, game.me);
      $('res-again').textContent = practice ? 'Play again' : 'Back to the room';
      $('results').hidden = false;
      $('hud').hidden = true;
    }, 2200);
  },
};
$('res-again').onclick = () => {
  $('results').hidden = true;
  if (practice) { const s = practiceSettings; endMatch(); startPractice(s); }
  else { net && net.send({ t: 'back' }); endMatch(true); $('menu').hidden = false; tab('online'); renderOnline(); if (!showcase) makeShowcase(); }
};
$('res-menu').onclick = () => {
  if (!practice && net) net.send({ t: 'leave' }), lobbyUI.left();
  showMenu();
};

// ---------- the title screen's backdrop: an arena, slowly turning ----------
function makeShowcase() {
  const src = maps['drying-hall'] || Object.values(maps)[0];
  if (!src) return;
  const def = expandMap(src);
  const A = new Arena(G.R, def, { client: true });
  const L = G.L = { def, A, group: new THREE.Group(), animate: [] };
  scene.add(L.group);
  buildView(L);
  for (const p of def.props) {
    const m = propMesh(p.type, p.size, -1);
    m.position.set(p.pos[0], p.pos[1] + p.size[1] / 2, p.pos[2]);
    m.rotation.y = THREE.MathUtils.degToRad(p.rot || 0);
    L.group.add(m);
  }
  showcase = { L, t: 0 };
}
function dropShowcase() {
  if (!showcase) return;
  const L = showcase.L;
  scene.remove(L.group);
  L.group.traverse(o => { if (o.userData.ownMaterial) { if (o.material.map && o.userData.ownMap) o.material.map.dispose(); o.material.dispose(); } });
  L.A.free();
  if (G.L === L) G.L = null;
  showcase = null;
}

// ---------- footsteps ----------
let stride = 0, leftFoot = false;
function footsteps(dt) {
  const me = game.me;
  const speed = Math.hypot(me.vel[0], me.vel[2]);
  if (!me.grounded || speed < 0.5 || !G.alive) { stride = Math.min(stride, 0.45); return; }
  stride += speed * dt;
  if (stride < 0.62) return;
  stride = 0; leftFoot = !leftFoot;
  const hit = game.A.ray([me.pos[0], me.pos[1] + 0.2, me.pos[2]], [0, -1, 0], 0.5, { exclude: me.collider });
  const info = hit && hit.info;
  SFX.step(!info ? 'concrete' : info.kind === 'prop' ? info.ref.type : info.kind === 'glass' ? 'glass' : info.kind === 'plate' ? 'steel' : 'concrete', leftFoot);
}

// ---------- the loop ----------
let last = performance.now(), acc = 0, shake = 0, pingT = 0, logicFov = CAMERA.fov, lastDrawn = performance.now();
// When the window isn't being drawn (minimised, hidden), keep the match going without drawing it.
setInterval(() => { const now = performance.now(); if (now - lastDrawn > 250) frame(now, false); }, 50);
function frame(now, draw = true) {
  if (draw) { requestAnimationFrame(frame); lastDrawn = now; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (Math.abs(camera.aspect - innerWidth / innerHeight) > 1e-3) resize();
  pollGamepad(dt);
  if (net && !(practice && paused)) { if (practice) net.pump(); }
  if (net && !practice) { pingT -= dt; if (pingT <= 0 && game) { pingT = 2; net.send({ t: 'ping', at: performance.now() }); } }
  if (game) {
    G.aim = !paused && G.alive && (live.aimHeld || live.pad.aim || G.aimToggle);
    if (!(practice && paused)) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n++ < 6) {
        acc -= DT;
        const input = liveInput();
        for (const a of live.actions.splice(0)) handle(a);
        game.tick(input);
        if (!game) break;
      }
      if (acc > DT * 6) acc = 0;
    }
    if (game) {
      const target = G.aim ? CAMERA.aimFov : SET.fov;
      logicFov += (target - logicFov) * Math.min(1, dt * 14);
      if (Math.abs(camera.fov - logicFov) > 0.01) { camera.fov = logicFov; camera.updateProjectionMatrix(); }
      game.placeCamera(camera, Math.min(1, acc / DT));
      if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.3; camera.position.y += (Math.random() - 0.5) * shake * 0.3; shake = Math.max(0, shake - dt * 1.5); }
      // a placed camera, for README screenshots (npm run shots)
      if (window.__cam) { camera.position.fromArray(window.__cam.pos); camera.lookAt(...window.__cam.at); }
      camera.updateMatrixWorld();
      game.frame(dt);
      frameHUD(game);
      scoreboard(game, showScores || game.phase === 'over');
      const me = game.me;
      stepViewmodel(dt, { moving: Math.hypot(me.vel[0], me.vel[2]) > 0.5, grounded: me.grounded, yaw: me.yaw, pitch: me.pitch });
      footsteps(dt);
    }
  } else if (showcase) {
    showcase.t += dt * 0.04;
    const t = showcase.t, r = showcase.L.def.room;
    camera.position.set(Math.sin(t) * (r.x1 - 3), 5.5, Math.cos(t) * (r.z1 * 0.55));
    camera.lookAt(0, 1.5, 0);
    if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
    for (const f of showcase.L.animate) f(dt);
    stepViewmodel(dt, { moving: false, grounded: true, yaw: 0, pitch: 0 });
  }
  if (!draw) return;
  renderFrame();
  if (G.pendingThumb) finishThumb();
}

// Crop the viewfinder out of the frame that was just drawn (the buffer is still intact).
const thumb = document.createElement('canvas');
thumb.width = 224; thumb.height = 168;
function finishThumb() {
  const t = G.pendingThumb;
  G.pendingThumb = null;
  if (!game) return;
  const k = renderer.getPixelRatio();
  const h = innerHeight * 0.72, w = Math.min(h * 4 / 3, innerWidth * 0.96);
  const g = thumb.getContext('2d');
  g.filter = t.neg ? 'invert(1) sepia(.2) contrast(1.2)' : 'sepia(.35) contrast(1.12) saturate(.9)';
  g.drawImage(renderer.domElement, (innerWidth - w) / 2 * k, (innerHeight - h) / 2 * k, w * k, h * k, 0, 0, thumb.width, thumb.height);
  g.filter = 'none';
  game.thumbTaken(t.rid, thumb.toDataURL('image/jpeg', 0.82));
}

// ---------- boot ----------
async function boot() {
  resize();
  initMaterials(renderer);
  scene.environment = ENV;
  initViewmodel();
  let q = 'high';
  try { q = localStorage.getItem('lightleakpvp.gfx') || 'high'; } catch (e) { /* default */ }
  setQuality(q);
  $('gfx').value = q;
  $('gfx').onchange = e => { setQuality(e.target.value); try { localStorage.setItem('lightleakpvp.gfx', e.target.value); } catch (err) { /* ignore */ } };
  settingsPanel($('settings-panel'));
  applySettings();
  initHUD();
  await RAPIER.init();
  G.R = RAPIER;
  const index = await fetch('maps/index.json', { cache: 'no-store' }).then(r => r.json());
  const list = await Promise.all(index.maps.map(id => fetch(`maps/${id}.json`, { cache: 'no-store' }).then(r => r.json()).then(m => ({ ...m, id }))));
  for (const m of list) maps[m.id] = m;
  // served by a Lightleak PvP server? Then that's the one to connect to.
  const info = await fetch('api/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const served = info && info.game === 'lightleakpvp' ? location.host : '';
  initMenu({
    maps: list.map(m => ({ id: m.id, name: m.name, sizes: m.sizes, blurb: m.blurb })),
    defaultServer: served,
    startPractice,
    connect,
    disconnect() { closeNet(); lobbyUI.disconnected(''); },
    send(m) { if (net && !practice) { net.send(m); if (m.t === 'leave') lobbyUI.left(); } },
    hostLan: window.desktop && window.desktop.hostLan ? () => window.desktop.hostLan() : null,
  });
  makeShowcase();
  requestAnimationFrame(t => frame(t));
  const qs = new URLSearchParams(location.search);
  if (qs.has('practice')) startPractice({ size: +(qs.get('size') || 2), mode: qs.get('mode') || 'plates', map: qs.get('map') || 'contact-sheet', difficulty: qs.get('bots') || 'normal', fill: true });
}
boot().catch(e => { console.error(e); menuMessage(`Couldn't start: ${e.message}`); });

// Handy for poking at the game from the dev console.
window.lightleakpvp = { G, get game() { return game; }, get net() { return net; }, live, act, startPractice, look: (yaw, pitch) => { live.yaw = yaw; live.pitch = pitch; } };
