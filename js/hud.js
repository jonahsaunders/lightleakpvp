// Everything drawn in HTML over the 3D view.
import { G } from './state.js';
import { CAMERA, NAMES, TEAMS, FILM, FLASH, EXPOSURE, MODES } from '../shared/config.js';
import { frameRect, ratioLabel } from '../shared/camera.js';
import { grainDataURL } from './materials.js';

const THREE = window.THREE;
const $ = id => document.getElementById(id);
let toastTimer = 0, bannerTimer = 0;

export function initHUD() {
  $('grain').style.backgroundImage = `url(${grainDataURL()})`;
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
export function flash() {
  const fl = $('flash');
  fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
}
export function filmSwitched() {
  const f = $('negflash');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  toast(G.filmMode === 'neg' ? 'Negative film loaded: what you develop dissolves things.' : 'Film loaded.');
}
export function banner(text, color) {
  const b = $('banner');
  b.textContent = text; b.style.color = color || '';
  b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('on'), 2200);
}
// Caught in someone's flash (or under something heavy): a white-out, and which way it came from.
let hurtFrom = null, hurtT = 0;
export function exposed(from) {
  const w = $('whiteout');
  w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
  hurtFrom = from && from.avatar ? from.avatar.group.position.clone() : null;
  hurtT = performance.now();
}

// ---------- the roll and the film ----------
export function updateRoll() {
  const m = G.L && G.L.match;
  if (!m) return;
  $('hud').classList.toggle('negative', G.filmMode === 'neg');
  const r = $('roll');
  r.innerHTML = '';
  const now = performance.now();
  for (let i = 0; i < CAMERA.roll; i++) {
    const s = document.createElement('div');
    const p = G.roll[i];
    s.className = 'slot' + (p ? ' photo' : '') + (p && p.neg ? ' neg' : '') + (i === G.selected ? ' sel' : '');
    if (p) {
      const img = document.createElement('img'); img.alt = '';
      if (p.img) img.src = p.img;
      const age = now - p.born;
      if (age < 2200) { img.classList.add('fresh'); img.style.animationDelay = `${-age}ms`; }
      const cap = document.createElement('div'); cap.className = 'cap';
      cap.textContent = `${p.neg ? 'NEG · ' : ''}${p.label} · ${p.d0.toFixed(1)} m`;
      s.append(img, cap);
      if (p.rot) { const t = document.createElement('div'); t.className = 'turn'; t.textContent = `↻ ${p.rot * 90}°`; s.appendChild(t); }
    }
    const k = document.createElement('kbd'); k.className = 'k'; k.textContent = i + 1;
    s.appendChild(k);
    r.appendChild(s);
  }
}
function cells(n, max, cls) { let s = ''; for (let i = 0; i < max; i++) s += `<span class="cell ${cls}${i < n ? ' full' : ''}"></span>`; return s; }
let lastFilm = '';
function updateFilm(m) {
  const p = m.private;
  const key = `${p.f}|${p.n}|${p.b}|${G.filmMode}`;
  if (key === lastFilm) return;
  lastFilm = key;
  $('film').innerHTML = `
    <div class="filmrow${G.filmMode === 'pos' ? ' active' : ''}">FILM<div class="cells">${cells(p.f, FILM.pos.max, 'pos')}</div></div>
    <div class="filmrow${G.filmMode === 'neg' ? ' active' : ''}">NEGATIVE · T<div class="cells">${cells(p.n, FILM.neg.max, 'neg')}</div></div>
    <div class="filmrow active">FLASH<div class="cells">${cells(p.b, FLASH.bulbs, 'bulb')}</div></div>`;
}

// ---------- the top of the screen ----------
const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let lastTop = '';
function updateTop(m) {
  const mode = MODES[m.settings.mode];
  const plates = m.A.plates.map(p => `<span class="chip" style="${p.owner >= 0 ? `background:${TEAMS[p.owner].color};color:#120f0d` : ''}" title="Plate ${p.name}">${p.name}</span>`).join('');
  const rounds = t => mode.respawn ? '' : `<div class="pips">${Array.from({ length: mode.rounds }, (_, i) => `<i class="${i < m.rounds[t] ? 'on' : ''}"></i>`).join('')}</div>`;
  const clock = m.phase === 'countdown' ? 'READY' : fmtClock(m.clock);
  const html = `
    <div class="side red${m.team === 0 ? ' you' : ''}"><div class="n">${TEAMS[0].name.toUpperCase()}</div><div class="s">${mode.respawn ? m.score[0] : m.rounds[0]}</div>${rounds(0)}</div>
    <div class="mid"><div class="clock">${clock}</div><div class="goal">${mode.respawn ? `FIRST TO ${m.scoreLimit}` : `ROUND ${Math.min(m.rounds[0] + m.rounds[1] + 1, mode.rounds * 2 - 1)}`}</div><div class="chips">${plates}</div></div>
    <div class="side blue${m.team === 1 ? ' you' : ''}"><div class="n">${TEAMS[1].name.toUpperCase()}</div><div class="s">${mode.respawn ? m.score[1] : m.rounds[1]}</div>${rounds(1)}</div>`;
  if (html !== lastTop) { $('scorebar').innerHTML = html; lastTop = html; }
}
const HOW = { flash: '⚡', crush: '▼', void: '↓', floor: '↓' };
let lastFeed = '';
function updateFeed(m) {
  const now = performance.now();
  const items = m.feed.filter(f => now - f.t < 7000);
  const html = items.map(f => {
    const who = `<b style="color:${TEAMS[f.who.team].color}">${esc(f.who.name)}</b>`;
    if (!f.by || f.by === f.who) return `<div>${who} ${f.how === 'void' ? 'fell into the dark' : 'was ruined'}</div>`;
    return `<div><b style="color:${TEAMS[f.by.team].color}">${esc(f.by.name)}</b> <span class="how">${HOW[f.how] || '·'}</span> ${who}</div>`;
  }).join('');
  if (html !== lastFeed) { $('feed').innerHTML = html; lastFeed = html; }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- per frame ----------
const ghost = { group: null, meshes: [], land: [], mat: null, edgeMat: null, landMat: null };
const HILITE = new THREE.Color(0x2a1a0a), ERASE = new THREE.Color(0x6a1006);
let lit = [];
function ensureGhost() {
  if (ghost.group && ghost.group.parent === G.scene) return;
  ghost.group = new THREE.Group();
  ghost.mat = new THREE.MeshBasicMaterial({ color: 0x8fc27a, transparent: true, opacity: 0.2, depthWrite: false });
  ghost.edgeMat = new THREE.LineBasicMaterial({ color: 0x8fc27a });
  ghost.landMat = new THREE.LineBasicMaterial({ color: 0x8fc27a, transparent: true, opacity: 0.35 });
  ghost.meshes = []; ghost.land = [];
  ghost.group.userData.noAO = true;
  G.scene.add(ghost.group);
}
function ghostBox(i) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  while (ghost.meshes.length <= i) {
    const m = new THREE.Mesh(box, ghost.mat); m.renderOrder = 3; m.userData.noAO = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), ghost.edgeMat));
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(box), ghost.landMat);
    ghost.meshes.push(m); ghost.land.push(l);
    ghost.group.add(m, l);
  }
  return [ghost.meshes[i], ghost.land[i]];
}
function setLit(m, props, color) {
  for (const mesh of lit) if (mesh.parent) mesh.material.emissive.copy(mesh.userData.teamEmissive);
  lit = [];
  for (const p of props) {
    const e = m.props.get(p.id);
    if (e) { e.mesh.material.emissive.copy(color); lit.push(e.mesh); }
  }
}
let litStatics = [];
function litEmulsion(m, list) {
  for (const s of litStatics) { const mesh = m.L.staticMesh.get(s.id); if (mesh) mesh.material.emissive.setHex(0x2a0603); }
  litStatics = list;
  for (const s of list) { const mesh = m.L.staticMesh.get(s.id); if (mesh) mesh.material.emissive.setHex(0x8a1a0c); }
}

const v3 = new THREE.Vector3();
function toScreen(pos) {
  v3.set(pos.x, pos.y, pos.z).project(G.camera);
  return { x: (v3.x + 1) / 2 * innerWidth, y: (1 - v3.y) / 2 * innerHeight, behind: v3.z > 1 };
}

export function frameHUD(m) {
  ensureGhost();
  updateTop(m);
  updateFeed(m);
  updateFilm(m);
  const p = m.private;
  const prompt = $('prompt'), vf = $('vf');
  ghost.group.visible = false;
  // exposure
  $('exposure-pips').innerHTML = Array.from({ length: EXPOSURE.marks }, (_, i) => `<span class="pip${i < p.ex ? ' on' : ''}"></span>`).join('');
  $('exposure').classList.toggle('hot', p.ex > 0);
  $('overexposure').style.opacity = G.alive ? (p.ex / EXPOSURE.marks) * 0.6 : 0;
  // which way the last hit came from
  const hurt = $('hurt');
  const hk = 1 - (performance.now() - hurtT) / 1400;
  if (hurtFrom && hk > 0 && G.alive) {
    const cam = G.camera.position, dx = hurtFrom.x - cam.x, dz = hurtFrom.z - cam.z;
    const ang = Math.atan2(dx, -dz) + m.me.yaw;
    hurt.style.opacity = hk; hurt.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
  } else hurt.style.opacity = 0;
  // someone has you in frame
  const watch = $('watch');
  watch.hidden = !p.w.length || !G.alive;
  if (p.w.length && G.alive) {
    const most = Math.max(...p.w.map(w => w[1]));
    watch.classList.toggle('locked', most >= 1);
    $('watch-arrows').innerHTML = p.w.map(([id, k]) => {
      const pl = m.players.get(id);
      if (!pl || !pl.avatar) return '';
      const a = pl.avatar.group.position, cam = G.camera.position;
      const ang = Math.atan2(a.x - cam.x, -(a.z - cam.z)) + m.me.yaw;
      return `<div class="arrow${k >= 1 ? ' locked' : ''}" style="transform: translate(-50%, -50%) rotate(${ang}rad)"><i></i></div>`;
    }).join('');
  }
  // dead: who did it, and how long until you develop again
  const dead = $('dead');
  dead.hidden = G.alive || m.phase === 'over';
  if (!G.alive) {
    const how = { flash: 'caught in their flash', crush: 'crushed', void: 'into the dark', floor: 'into the dark' }[m.deathHow] || 'ruined';
    $('dead-by').innerHTML = m.killer && m.killer !== m.me ? `<b style="color:${TEAMS[m.killer.team].color}">${esc(m.killer.name)}</b> · ${how}` : how;
    $('dead-t').textContent = MODES[m.settings.mode].respawn ? `Developing again in ${Math.ceil(p.rs)}…` : 'Out until the next round. Watching your team.';
  }
  // countdown
  const cd = $('countdown');
  cd.hidden = m.phase !== 'countdown';
  if (m.phase === 'countdown') cd.textContent = Math.max(1, Math.ceil(m.phaseT));
  // the lock ring on whoever you're focusing on
  const ring = $('lockring');
  const f = p.fc && G.aim && G.alive ? p.fc : null;
  const target = f && m.players.get(f[0]);
  if (target && target.avatar) {
    const s = toScreen(target.avatar.group.position.clone().add(new THREE.Vector3(0, 1.1, 0)));
    ring.hidden = s.behind;
    const size = 140 - 80 * f[1];
    ring.style.left = `${s.x}px`; ring.style.top = `${s.y}px`; ring.style.width = ring.style.height = `${size}px`;
    ring.classList.toggle('locked', f[1] >= 1);
    $('lock-name').textContent = f[1] >= 1 ? `${target.name} · LOCKED` : target.name;
  } else ring.hidden = true;

  vf.hidden = !G.aim || !G.alive;
  $('hud').classList.toggle('aiming', G.aim);
  $('roll').hidden = G.aim;
  if (!G.alive) { prompt.textContent = ''; setLit(m, [], HILITE); litEmulsion(m, []); return; }

  if (G.aim) {
    litEmulsion(m, []);
    const locked = m.locked();
    const group = locked ? [] : m.framed();
    setLit(m, group, HILITE);
    const { frac } = frameRect(G.frameIdx);
    const fr = $('vf-frame');
    fr.hidden = !frac;
    if (frac) { fr.style.width = `${frac * 100}%`; fr.style.height = `${frac * 100}%`; }
    $('vf-size').textContent = frac ? `FRAME ${Math.round(frac * 100)}% · WHEEL` : 'FRAME: ONE THING · WHEEL TO WIDEN';
    vf.classList.toggle('locked', group.length > 0 || !!locked);
    vf.classList.toggle('negative', G.filmMode === 'neg');
    $('vf-mode').textContent = G.filmMode === 'neg' ? 'NEGATIVE' : 'FILM';
    if (locked) {
      $('vf-subject').textContent = `PORTRAIT · ${locked.name.toUpperCase()}`;
      $('vf-dist').textContent = '';
      prompt.innerHTML = p.b > 0 ? `<span class="ok">CLICK</span> flash ${esc(locked.name)}` : '<span class="bad">NO FLASH BULBS</span>';
    } else if (group.length) {
      const e = G.camera.position;
      const c = group.reduce((a, q) => a.add(new THREE.Vector3(...q.pos)), new THREE.Vector3()).multiplyScalar(1 / group.length);
      const mass = group.reduce((s, q) => s + q.mass, 0);
      const what = group.length > 1 ? `${group.length} OBJECTS` : `${NAMES[group[0].type].toUpperCase()} · ${fmtM(Math.max(...group[0].size))} m`;
      $('vf-subject').textContent = `${what} · ${fmtT(mass)} t`;
      $('vf-dist').textContent = `${c.distanceTo(e).toFixed(1)} m`;
      const film = G.filmMode === 'neg' ? p.n : p.f;
      prompt.innerHTML = film > 0 ? `<span class="ok">CLICK</span> take ${G.filmMode === 'neg' ? 'a negative' : 'a photo'}` : '<span class="bad">OUT OF FILM</span>';
    } else if (f && f[1] < 1) {
      $('vf-subject').textContent = 'FOCUSING…'; $('vf-dist').textContent = ''; prompt.textContent = '';
    } else {
      $('vf-subject').textContent = 'No subject';
      $('vf-dist').textContent = frac ? `frame ${Math.round(frac * 100)}%` : '';
      prompt.textContent = '';
    }
    return;
  }
  const photo = G.roll[G.selected];
  if (!photo) { setLit(m, [], HILITE); litEmulsion(m, []); prompt.textContent = ''; return; }
  const pl = m.placement(photo);
  if (!pl) { setLit(m, [], HILITE); litEmulsion(m, []); prompt.innerHTML = '<span class="bad">NO SURFACE</span>'; return; }
  ghost.group.visible = true;
  const col = photo.neg ? (pl.valid ? 0xf06a4f : 0x7a6a60) : pl.valid ? 0x8fc27a : 0xe0574a;
  ghost.mat.color.setHex(photo.neg ? 0x120f0d : col);
  ghost.mat.opacity = photo.neg ? 0.45 : 0.2;
  ghost.edgeMat.color.setHex(col); ghost.landMat.color.setHex(col);
  for (let i = 0; i < ghost.meshes.length; i++) { ghost.meshes[i].visible = false; ghost.land[i].visible = false; }
  pl.poses.forEach((pose, i) => {
    const [gm, land] = ghostBox(i);
    gm.visible = true;
    gm.position.fromArray(pose.pos); gm.quaternion.fromArray(pose.q); gm.scale.fromArray(pose.size);
    if (!photo.neg && pl.drop > 0.05 && isFinite(pl.drop)) {
      land.visible = true;
      land.position.fromArray(pose.pos); land.position.y -= pl.drop; land.quaternion.fromArray(pose.q); land.scale.fromArray(pose.size);
    }
  });
  if (photo.neg) {
    setLit(m, pl.erase.filter(r => r.body), ERASE);
    litEmulsion(m, pl.erase.filter(r => !r.body));
    const who = pl.erase.filter(r => r.body && r.team >= 0);
    const note = who.length ? ` (${who.map(r => r.team === m.team ? 'yours' : 'theirs').filter((v, i, a) => a.indexOf(v) === i).join(' and ')})` : '';
    prompt.innerHTML = pl.valid ? `<div><span class="ok">CLICK</span> dissolve ${pl.erase.length} thing${pl.erase.length > 1 ? 's' : ''}${note}</div>` : `<div><span class="bad">${pl.reason}</span></div>`;
    return;
  }
  setLit(m, [], HILITE); litEmulsion(m, []);
  const dims = `${fmtM(pl.size[0])} × ${fmtM(pl.size[1])} × ${fmtM(pl.size[2])} m · ${fmtT(pl.mass)} t`;
  const scale = pl.nice ? `<span class="snap">${ratioLabel(pl.nice)}</span>` : `×${pl.k.toFixed(2)}`;
  const fall = !isFinite(pl.drop) ? ' · <span class="bad">FALLS AWAY</span>' : pl.drop > 1.5 ? ` · drops ${pl.drop.toFixed(1)} m` : '';
  let plate = '';
  if (pl.plate) {
    const P = pl.plate, over = P.max != null && P.load > P.max;
    const state = P.owner === m.team ? '✓ yours' : P.owner >= 0 ? '✕ still theirs' : over ? '✕ too heavy' : P.load < P.need ? `✕ needs ${fmtT(P.need)}` : '✕ even';
    plate = ` · plate ${P.name} <span class="${P.owner === m.team ? 'ok' : 'bad'}">${fmtT(P.load)} t ${state}</span>`;
  }
  const head = pl.valid ? '<span class="ok">CLICK</span> develop' : `<span class="bad">${pl.reason}</span>`;
  prompt.innerHTML = `<div>${head} · ${scale}</div><div class="sub">${dims}${plate}${fall}</div>`;
}

// ---------- the scoreboard (Tab) and the results ----------
export function scoreboard(m, show) {
  const el = $('scores');
  el.hidden = !show;
  if (!show) return;
  const rows = t => [...m.players.values()].filter(p => p.team === t).map(p =>
    `<tr class="${p === m.me ? 'me' : ''}${p.alive ? '' : ' out'}"><td>${esc(p.name)}${p.bot ? ' <span class="bot">BOT</span>' : ''}</td><td>${'●'.repeat(p === m.me ? m.private.ex : p.exposure)}</td></tr>`).join('');
  el.innerHTML = [0, 1].map(t => `<div class="col"><h3 style="color:${TEAMS[t].color}">${TEAMS[t].name}${t === m.team ? ' · you' : ''}</h3><table>${rows(t)}</table></div>`).join('') +
    `<div class="foot">${esc(m.mapName)} · ${MODES[m.settings.mode].name} · ${m.settings.size}v${m.settings.size}${m.ping != null ? ` · ${m.ping} ms` : ''}</div>`;
}

export function resultsHTML(r, you) {
  const won = r.winner === you.team;
  const title = r.winner < 0 ? 'A draw' : won ? 'Your team wins' : `${TEAMS[r.winner].name} wins`;
  const score = r.mode === 'plates' ? `${r.score[0]} – ${r.score[1]}` : `${r.rounds[0]} – ${r.rounds[1]} rounds`;
  const best = (k) => r.players.reduce((a, p) => (p.stats[k] > (a ? a.stats[k] : 0) ? p : a), null);
  const mvp = r.players.slice().sort((a, b) => score2(b.stats) - score2(a.stats))[0];
  const card = p => `<div class="print${p.id === you.id ? ' me' : ''}" style="border-color:${TEAMS[p.team].color}">
      <div class="nm">${esc(p.name)}${p.bot ? ' <span class="bot">BOT</span>' : ''}${p === mvp ? ' <span class="mvp">BEST PRINT</span>' : ''}</div>
      <div class="st"><span>${p.stats.portraits}</span> portraits · <span>${p.stats.elims}</span> knockouts${p.stats.crushes ? ` (${p.stats.crushes} crushed)` : ''} · <span>${p.stats.deaths}</span> ruined</div>
      <div class="st"><span>${p.stats.tonnes}</span> t developed${r.mode === 'plates' ? ` · <span>${p.stats.plates}</span> s on plates` : ''}</div></div>`;
  return `<h1 style="color:${r.winner >= 0 ? TEAMS[r.winner].color : 'var(--paper)'}">${title}</h1>
    <div class="score">${score}</div>
    <div class="sheet">${[0, 1].map(t => `<div class="col"><h3 style="color:${TEAMS[t].color}">${TEAMS[t].name}</h3>${r.players.filter(p => p.team === t).map(card).join('')}</div>`).join('')}</div>
    ${best('crushes') ? `<div class="note">Heaviest hand: ${esc(best('crushes').name)} crushed ${best('crushes').stats.crushes}.</div>` : ''}`;
}
const score2 = s => s.elims * 3 + s.portraits + s.plates / 10 + s.tonnes / 20 - s.deaths;

function fmtM(v) { return v < 10 ? v.toFixed(2) : v.toFixed(1); }
function fmtT(v) { return v < 10 ? v.toFixed(1) : Math.round(v).toString(); }
