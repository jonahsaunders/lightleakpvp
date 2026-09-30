// What the arena looks like. Builds meshes for the walls, floors, glass and emulsion the client's
// Arena has colliders for, plus the look-only things: plates' readouts, lights, trim, dust, drying
// lines, benches, team signs and the old enlarger. Nothing here affects play.
import { G } from './state.js';
import { MAT, PRINT_TEX, worldBox, propMaterial, canvasTexture, stencilTexture } from './materials.js';
import { dressRoom, glassFrame, ceilingPanel, dust, tray, plateVisual, decal } from './dressing.js';
import { TEAMS } from '../shared/config.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const EDGES = new THREE.EdgesGeometry(UNIT_BOX);
const DEEP = ['wall', 'wall', 'floor', 'wall', 'wall', 'wall'];

export function buildView(L) {
  const { def, A } = L;
  const r = def.room;
  G.scene.background.setHex(0x0b0908); G.scene.fog.color.setHex(0x0b0908);
  G.scene.fog.near = 30; G.scene.fog.far = 90;
  L.staticMesh = new Map();
  for (const s of A.statics) {
    if (s.mat === 'bench') continue;
    const mat = s.mat === 'emulsion' ? MAT.emulsion.clone() : s.mat === 'floor' && s.max[1] - s.min[1] > 1 ? DEEP.map(k => MAT[k]) : MAT[s.mat] || MAT.wall;
    const mesh = new THREE.Mesh(worldBox(s.min, s.max), mat);
    mesh.position.set((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = !!(s.src && s.src.cast) || s.mat === 'emulsion';
    if (s.mat === 'emulsion') mesh.userData.ownMaterial = true;
    if (s.mat === 'glass') { mesh.receiveShadow = false; mesh.renderOrder = 2; mesh.userData.noAO = true; glassFrame(s.min, s.max); }
    mesh.visible = !s.erased;
    L.group.add(mesh);
    L.staticMesh.set(s.id, mesh);
  }
  // the pits: near-black far below, so a drop reads as deep rather than as a hole in the world
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), new THREE.MeshBasicMaterial({ color: 0x070504, fog: false }));
  haze.rotation.x = -Math.PI / 2; haze.position.set((r.x0 + r.x1) / 2, def.killY - 4, (r.z0 + r.z1) / 2);
  L.group.add(haze);
  L.plateView = A.plates.map(p => plateView(L, p));
  for (const l of def.lights || []) addLight(L, l);
  lightRoom(L, r);
  for (const d of def.decor || []) addDecor(L, d);
  const avoid = (def.decor || []).filter(d => d.kind === 'safelight' || d.kind === 'sign').map(d => [d.pos[0], d.pos[2]]);
  dressRoom({ ...r, floor: true }, avoid);
  L.animate.push(dust(r, Math.round((r.x1 - r.x0) * (r.z1 - r.z0) * r.h * 0.12)));
  // each team's end glows faintly in its colour
  for (const t of [0, 1]) {
    const sp = def.spawns[t];
    const c = sp.reduce((a, s) => a.add(new V3(...s.pos)), new V3()).multiplyScalar(1 / sp.length);
    const l = new THREE.PointLight(TEAMS[t].hex, 0.5, 14, 2); l.position.set(c.x, 2.6, c.z); L.group.add(l);
  }
}

function lightRoom(L, r) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const span = Math.max(r.x1 - r.x0, r.z1 - r.z0) / 2 + 4;
  const sun = new THREE.DirectionalLight(0xffe0c0, 0.5);
  sun.position.set(cx + 8, 50, cz + 12); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 100 });
  L.group.add(sun, sun.target);
  L.group.add(new THREE.HemisphereLight(0xd9c6b0, 0x261c18, 0.42));
}

function addLight(L, l) {
  const [x, y, z] = l.pos;
  if (l.panel) ceilingPanel(x, y, z, l.w || 2, l.d || 1, l.floorY ?? 0);
  const color = l.color ? parseInt(l.color.replace('#', ''), 16) : 0xffe2bc;
  const light = new THREE.PointLight(color, l.intensity ?? 0.9, l.dist ?? 16, 2);
  light.position.set(x, l.panel ? y - 0.4 : y, z);
  L.group.add(light);
}

function addDecor(L, d) {
  const rot = THREE.MathUtils.degToRad(d.rot || 0);
  if (d.kind === 'bench') {
    const [x, y, z] = d.pos, len = d.len || 2.4, g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.9), MAT.wood); top.position.y = 0.9; g.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), MAT.metal); leg.position.set(sx * (len / 2 - 0.1), 0.45, sz * 0.35); g.add(leg);
    }
    for (let i = 0; i < Math.floor(len / 0.8); i++) tray(g, -len / 2 + 0.45 + i * 0.8, 0.94, 0);
    g.position.set(x, y, z); g.rotation.y = rot;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    L.group.add(g);
  } else if (d.kind === 'line') {
    const a = new V3(...d.from), b = new V3(...d.to);
    L.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), MAT.string));
    const n = d.prints ?? Math.floor(a.distanceTo(b) / 0.8);
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / n);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshStandardMaterial({ map: PRINT_TEX[(((i + Math.round(a.x + a.z)) % PRINT_TEX.length) + PRINT_TEX.length) % PRINT_TEX.length], side: THREE.DoubleSide, roughness: 0.6 }));
      m.userData.ownMaterial = true;
      m.position.copy(p).add(new V3(0, -0.22, 0));
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      m.rotation.z = ((i * 37) % 7 - 3) * 0.02;
      L.group.add(m);
    }
  } else if (d.kind === 'safelight') {
    const [x, y, z] = d.pos;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.12), MAT.safelight);
    lamp.position.set(x, y, z); lamp.rotation.y = rot; L.group.add(lamp);
    const out = new V3(0, 0, 0.6).applyAxisAngle(new V3(0, 1, 0), rot);
    const glow = new THREE.PointLight(0xff3a22, 0.8, 12, 2); glow.position.set(x + out.x, y, z + out.z); L.group.add(glow);
  } else if (d.kind === 'sign') {
    const t = TEAMS[d.team];
    decal(stencilTexture([[t.name.toUpperCase(), 84], ['DARKROOM · THIS WAY IN', 34, 700]], { color: t.color }), [d.pos[0], d.pos[1], d.pos[2]], 2.6, 1.3, rot);
  } else if (d.kind === 'enlarger') enlarger(L, d.pos);
}

// The Curator's head, switched off and hanging where it fell silent, over the island.
function enlarger(L, [x, y, z]) {
  const g = new THREE.Group();
  const box = (w, h, d, px, py, pz, mat = MAT.door) => { const m = new THREE.Mesh(worldBox([px - w / 2, py - h / 2, pz - d / 2], [px + w / 2, py + h / 2, pz + d / 2]), mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
  const hy = y - 3.6;
  box(3.4, 2.6, 3.4, 0, hy, 0);
  box(3.7, 0.2, 3.7, 0, hy - 1.2, 0, MAT.trim);
  box(3.7, 0.2, 3.7, 0, hy + 1.2, 0, MAT.trim);
  const bellows = new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.9 });
  for (let i = 0; i < 5; i++) box(2.2 - i * 0.2, 0.2, 2.2 - i * 0.2, 0, hy - 1.45 - i * 0.24, 0, i % 2 ? MAT.trim : bellows);
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x0a0c0e, emissive: 0x8a2a14, emissiveIntensity: 0.5, roughness: 0.05 }));
  eye.position.set(0, hy - 2.7, 0); g.add(eye);
  // three red straps up to the ceiling
  for (const a of [0, 2.1, 4.2]) box(0.35, y - hy - 1.3, 0.12, Math.cos(a) * 1.3, (y + hy + 1.3) / 2, Math.sin(a) * 1.3, MAT.emulsion);
  g.position.set(x, 0, z);
  L.group.add(g);
  const spot = new THREE.SpotLight(0xffd2b0, 2.2, 20, 0.55, 0.6, 1);
  spot.position.set(x, hy - 2.8, z); spot.target.position.set(x, 0, z);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0008;
  L.group.add(spot, spot.target);
}

// ---------- plates ----------
function plateView(L, p) {
  const min = p.lo, max = p.hi;
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a1a14, emissive: 0x6a6258 });
  const mesh = plateVisual(min, max, mat);
  mesh.userData.ownMaterial = true;
  const { canvas, tex } = canvasTexture(256, 160);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.userData.ownMaterial = true; sprite.userData.ownMap = true; sprite.userData.noAO = true;
  sprite.scale.set(1.9, 1.19, 1);
  sprite.position.set(p.pos[0], p.pos[1] + 2.8, p.pos[2]);
  L.group.add(sprite);
  // a column of the owner's colour, visible from across the arena
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.set(p.pos[0], p.pos[1] + 6, p.pos[2]); beam.scale.y = 12; beam.userData.noAO = true; beam.userData.ownMaterial = true;
  L.group.add(beam);
  const v = { p, mesh, mat, canvas, tex, beam, baseY: mesh.position.y, shown: '' };
  drawPlate(v);
  return v;
}
const fmtT = v => (v < 10 ? v.toFixed(1) : Math.round(v).toString());
export function drawPlate(v) {
  const p = v.p;
  const key = `${Math.round(p.load * 10)}|${Math.round(p.mass[0] * 10)}|${Math.round(p.mass[1] * 10)}|${p.owner}`;
  if (key === v.shown) return;
  v.shown = key;
  const g = v.canvas.getContext('2d');
  const own = p.owner >= 0 ? TEAMS[p.owner].color : null;
  const over = p.max != null && p.load > p.max + 1e-6;
  g.clearRect(0, 0, 256, 160);
  g.fillStyle = '#120f0dd9'; g.fillRect(4, 4, 248, 152);
  g.strokeStyle = own || (over ? '#f0a04f' : '#6a6258'); g.lineWidth = 5; g.strokeRect(4, 4, 248, 152);
  g.textAlign = 'center';
  g.fillStyle = own || '#efe6d2'; g.font = '900 34px system-ui, "Segoe UI", sans-serif';
  g.fillText(`PLATE ${p.name}`, 128, 40);
  g.fillStyle = '#a39a8a'; g.font = '700 17px ui-monospace, Consolas, monospace';
  g.fillText(`NEEDS ${fmtT(p.need)}–${fmtT(p.max)} t`, 128, 64);
  g.font = '700 36px ui-monospace, Consolas, monospace';
  g.fillStyle = over ? '#f0a04f' : own || '#efe6d2';
  g.fillText(`${fmtT(p.load)} t${over ? ' ✕' : ''}`, 128, 104);
  // the bar: each team's developed weight in its colour, the rest grey; ticks at need and max
  const top = (p.max ?? p.need * 2) * 1.25, W = 208, x0 = 24;
  g.fillStyle = '#3a322c'; g.fillRect(x0, 120, W, 16);
  let x = x0;
  const seg = (m, col) => { const w = Math.min(W - (x - x0), W * m / top); g.fillStyle = col; g.fillRect(x, 120, w, 16); x += w; };
  seg(p.mass[0], TEAMS[0].color); seg(p.mass[1], TEAMS[1].color); seg(Math.max(0, p.load - p.mass[0] - p.mass[1]), '#a39a8a');
  g.fillStyle = '#efe6d2';
  g.fillRect(x0 + W * p.need / top, 114, 2, 28);
  if (p.max != null) g.fillRect(x0 + W * p.max / top, 114, 2, 28);
  v.tex.needsUpdate = true;
  v.mat.emissive.setHex(p.owner >= 0 ? TEAMS[p.owner].hex : over ? 0x9a5a20 : 0x6a6258);
  v.beam.material.color.setHex(p.owner >= 0 ? TEAMS[p.owner].hex : 0xffffff);
  v.beam.material.opacity = p.owner >= 0 ? 0.35 : 0;
}
export function stepPlates(L, dt) {
  for (const v of L.plateView) {
    drawPlate(v);
    v.mesh.position.y += ((v.p.owner >= 0 ? v.baseY - 0.03 : v.baseY) - v.mesh.position.y) * Math.min(1, dt * 12);
  }
}

// ---------- props ----------
// A crate, block or plank; things a team developed carry an outline in its colour.
export function propMesh(type, size, team) {
  const mesh = new THREE.Mesh(UNIT_BOX, propMaterial(type));
  mesh.userData.ownMaterial = true;
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.castShadow = mesh.receiveShadow = true;
  if (team >= 0) {
    const edge = new THREE.LineSegments(EDGES, new THREE.LineBasicMaterial({ color: TEAMS[team].hex, transparent: true, opacity: 0.9 }));
    edge.scale.setScalar(1.004); edge.userData.noAO = true;
    mesh.add(edge);
    mesh.material.emissive.setHex(TEAMS[team].hex).multiplyScalar(0.06);
    mesh.userData.teamEmissive = mesh.material.emissive.clone();
  } else mesh.userData.teamEmissive = new THREE.Color(0, 0, 0);
  return mesh;
}
export function disposeProp(mesh) {
  mesh.material.dispose();
  for (const c of mesh.children) c.material && c.material.dispose();
}
