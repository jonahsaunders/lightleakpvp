// Architectural detail and atmosphere. Nothing here collides or affects play.
//
// Everything is placed so that no two surfaces share a plane where both can be seen (that is what
// makes textures flicker): trims stand proud of walls, runs are shortened at corners instead of
// overlapping, and decals sit a few millimetres off the wall with a polygon offset.
import { G } from './state.js';
import { MAT, stencilTexture, softDot, shaftTexture, worldBox } from './materials.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;

function box(min, max, mat, { shadow = false } = {}) {
  const m = new THREE.Mesh(worldBox(min, max), mat);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.receiveShadow = true; m.castShadow = shadow;
  G.L.group.add(m);
  return m;
}

// Baseboards, a cornice, and pilaster ribs every few metres. `avoid` lists wall spots to keep clear.
export function dressRoom(r, avoid) {
  const { x0, x1, z0, z1, h } = r;
  const d = r.door || { x: Infinity, w: 0 }, dx = d.x, dw = d.w || 2;
  const T = MAT.trim;
  const floor = r.floor !== false;
  const bb = 0.135, bt = 0.035, cor = 0.195, ct = 0.05;
  // runs along x (north and south walls) are full length; runs along z stop short of them
  const runs = (y0, y1, t) => {
    const out = [];
    out.push([[x0, y0, z1 - t], [x1, y1, z1]]);                                     // south
    out.push([[x0, y0, z0 + t], [x0 + t, y1, z1 - t]]);                             // west
    out.push([[x1 - t, y0, z0 + t], [x1, y1, z1 - t]]);                             // east
    if (!isFinite(dx)) { out.push([[x0, y0, z0], [x1, y1, z0 + t]]); return out; }  // no door: one run
    const gap0 = dx - dw / 2 - 0.18, gap1 = dx + dw / 2 + 0.18;                      // north: into the door jambs, which hide the ends
    if (gap0 > x0) out.push([[x0, y0, z0], [gap0, y1, z0 + t]]);
    if (gap1 < x1) out.push([[gap1, y0, z0], [x1, y1, z0 + t]]);
    return out;
  };
  if (floor) {
    // darker panelling up to hand height with a rail on top, then the baseboard in front of it all
    // (odd heights, so no trim face lands level with a ledge or plinth top)
    for (const [a, b] of runs(0, 0.985, 0.02)) box(a, b, MAT.wainscot);
    for (const [a, b] of runs(0.985, 1.055, 0.045)) box(a, b, T);
    for (const [a, b] of runs(0, bb, bt)) box(a, b, T);
  }
  for (const [a, b] of runs(h - cor, h, ct)) box(a, b, T);

  // ribs: 0.2 wide, 0.06 proud, from the floor to the cornice
  // 0.19 wide: edges at ±0.095 from a 4 m mark, where authored blocks (on 0.1 m steps) never end
  const rw = 0.19, rp = 0.06, top = h - cor, bottom = 0;
  const clear = (x, z) => !avoid.some(p => Math.hypot(p[0] - x, p[1] - z) < 0.9);
  for (let x = Math.ceil((x0 + 1.5) / 4) * 4; x <= x1 - 1.5; x += 4) {
    if (clear(x, z1)) box([x - rw / 2, bottom, z1 - rp], [x + rw / 2, top, z1], T);
    if (Math.abs(x - dx) > dw / 2 + 0.8 && clear(x, z0)) box([x - rw / 2, bottom, z0], [x + rw / 2, top, z0 + rp], T);
  }
  for (let z = Math.ceil((z0 + 1.5) / 4) * 4; z <= z1 - 1.5; z += 4) {
    if (clear(x0, z)) box([x0, bottom, z - rw / 2], [x0 + rp, top, z + rw / 2], T);
    if (clear(x1, z)) box([x1 - rp, bottom, z - rw / 2], [x1, top, z + rw / 2], T);
  }
}

// A chunky frame around the exit, and stencilled signage beside it.
export function doorFrame(r, label) {
  const d = r.door, dx = d.x, dw = d.w || 2, dy = d.y || 0, dh = d.h || 2.6, z0 = r.z0;
  const f = 0.18, p = 0.08;
  box([dx - dw / 2 - f, dy, z0], [dx - dw / 2, dy + dh + f, z0 + p], MAT.trimLight, { shadow: true });
  box([dx + dw / 2, dy, z0], [dx + dw / 2 + f, dy + dh + f, z0 + p], MAT.trimLight, { shadow: true });
  box([dx - dw / 2, dy + dh, z0], [dx + dw / 2, dy + dh + f, z0 + p], MAT.trimLight, { shadow: true });
  // the room's name, painted on the wall at eye height beside the door
  const side = dx - dw / 2 - 2.6 > r.x0 + 0.5 ? -1 : 1;
  const sx = dx + side * (dw / 2 + 1.6);
  if (sx - 1.2 < r.x0 || sx + 1.2 > r.x1) return;
  decal(stencilTexture(label), [sx, dy + 1.9, z0 + 0.004], 2.2, 1.1, 0);
}

export function decal(tex, pos, w, h, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  m.position.set(...pos); m.rotation.y = rotY;
  m.userData.ownMaterial = true; m.userData.ownMap = true; m.userData.noAO = true;
  G.L.group.add(m);
  return m;
}

// Glass gets a thin dark frame around its large face instead of glowing wireframe edges.
let frameSeq = 0;
export function glassFrame(min, max) {
  const size = [0, 1, 2].map(i => max[i] - min[i]);
  const thin = size.indexOf(Math.min(...size));
  const e = 0.0015 * (frameSeq++ % 5);            // stops neighbouring frames sharing a plane
  const bw = 0.05 + e, pad = 0.012 + e, over = 0.004 + e;
  const [a, b] = [0, 1, 2].filter(i => i !== thin);
  // the frame runs a few millimetres past the pane on every side, so the glass's edges sit inside it
  min = min.slice(); max = max.slice();
  min[a] -= over; max[a] += over; min[b] -= over; max[b] += over;
  const lo = min.slice(), hi = max.slice();
  lo[thin] -= pad; hi[thin] += pad;
  const bars = [];
  // two bars along axis a (full length), two along axis b (between them)
  for (const s of [0, 1]) {
    const m0 = lo.slice(), m1 = hi.slice();
    if (s === 0) m1[b] = min[b] + bw; else m0[b] = max[b] - bw;
    bars.push([m0, m1]);
    const n0 = lo.slice(), n1 = hi.slice();
    n0[b] = min[b] + bw; n1[b] = max[b] - bw;
    if (s === 0) n1[a] = min[a] + bw; else n0[a] = max[a] - bw;
    bars.push([n0, n1]);
  }
  for (const [p0, p1] of bars) box(p0, p1, MAT.trim, { shadow: true });
}

// A recessed ceiling panel: lit face, a trim surround, and a soft shaft of light below it.
export function ceilingPanel(x, y, z, w = 2, d = 1, floorY = 0) {
  const L = G.L;
  const face = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), MAT.panel);
  face.position.set(x, y - 0.03, z); L.group.add(face);
  const t = 0.07, f0 = y - 0.07, f1 = y - 0.001;
  box([x - w / 2 - t, f0, z - d / 2 - t], [x + w / 2 + t, f1, z - d / 2], MAT.trim);
  box([x - w / 2 - t, f0, z + d / 2], [x + w / 2 + t, f1, z + d / 2 + t], MAT.trim);
  box([x - w / 2 - t, f0, z - d / 2], [x - w / 2, f1, z + d / 2], MAT.trim);
  box([x + w / 2, f0, z - d / 2], [x + w / 2 + t, f1, z + d / 2], MAT.trim);
  // light shaft: an open four-sided frustum, additive and fading downwards
  const height = Math.max(1, y - 0.06 - floorY);
  const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.7, height, 4, 1, true);
  const shaft = new THREE.Mesh(geo, shaftMaterial());
  shaft.rotation.y = Math.PI / 4;
  shaft.scale.set(w, 1, d);
  shaft.position.set(x, y - 0.06 - height / 2, z);
  shaft.renderOrder = 5; shaft.userData.noAO = true;
  L.group.add(shaft);
}
let shaftMat = null;
function shaftMaterial() {
  if (!shaftMat) shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  return shaftMat;
}

// Dust motes drifting in the air. Returns a per-frame animator.
let dotTex = null;
export function dust(r, count) {
  const L = G.L;
  dotTex = dotTex || softDot();
  const n = Math.min(900, count);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  const y0 = r.floor === false ? 0 : 0.2;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = r.x0 + Math.random() * (r.x1 - r.x0);
    pos[i * 3 + 1] = y0 + Math.random() * (r.h - y0 - 0.3);
    pos[i * 3 + 2] = r.z0 + Math.random() * (r.z1 - r.z0);
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: dotTex, size: 0.022, color: 0xffe2c4, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.userData.noAO = true; pts.userData.ownMaterial = true;
  L.group.add(pts);
  let t = 0;
  const cam = G.camera.position;
  return dt => {
    t += dt;
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const s = seed[i];
      a[i * 3] += Math.sin(t * 0.3 + s) * 0.0015;
      a[i * 3 + 1] += Math.sin(t * 0.21 + s * 1.7) * 0.001 - 0.0004;
      a[i * 3 + 2] += Math.cos(t * 0.27 + s) * 0.0015;
      if (a[i * 3 + 1] < y0) a[i * 3 + 1] = r.h - 0.4;
      // a mote right in front of the lens would be drawn as a huge blob: move it somewhere else
      const dx = a[i * 3] - cam.x, dy = a[i * 3 + 1] - cam.y, dz = a[i * 3 + 2] - cam.z;
      if (dx * dx + dy * dy + dz * dz < 1.2) {
        a[i * 3] = r.x0 + Math.random() * (r.x1 - r.x0);
        a[i * 3 + 2] = r.z0 + Math.random() * (r.z1 - r.z0);
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
}

// A developing tray: hollow, so the liquid sits below the rim instead of sharing its top face.
export function tray(group, x, y, z) {
  const W = 0.6, D = 0.48, H = 0.07, t = 0.012;
  const add = (w, h, d, px, py, pz, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; group.add(m); };
  add(W, t, D, x, y + t / 2, z, MAT.tray);
  add(W, H - t, t, x, y + t + (H - t) / 2, z - D / 2 + t / 2, MAT.tray);
  add(W, H - t, t, x, y + t + (H - t) / 2, z + D / 2 - t / 2, MAT.tray);
  add(t, H - t, D - 2 * t, x - W / 2 + t / 2, y + t + (H - t) / 2, z, MAT.tray);
  add(t, H - t, D - 2 * t, x + W / 2 - t / 2, y + t + (H - t) / 2, z, MAT.tray);
  add(W - 2 * t, 0.025, D - 2 * t, x, y + t + 0.0125, z, MAT.liquid);
}

// A pressure plate's look: a dark frame around a pad with a glowing inset border.
// Returns the pad mesh (which sinks a little when the plate is satisfied).
let plateTex = null;
export function plateVisual(min, max, mat) {
  const L = G.L;
  if (!plateTex) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(22, 22, 212, 212);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
    for (let i = -256; i < 256; i += 28) { g.beginPath(); g.moveTo(40 + i, 216); g.lineTo(216 + i, 40); g.stroke(); }
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 38); g.fillRect(0, 218, 256, 38); g.fillRect(0, 0, 38, 256); g.fillRect(218, 0, 38, 256);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(22, 22, 212, 212);
    plateTex = new THREE.CanvasTexture(c);
  }
  mat.emissiveMap = plateTex; mat.emissiveIntensity = 1.6; mat.color.setHex(0x1c1a19); mat.roughness = 0.45; mat.metalness = 0.6;
  // plain UVs on the pad so the inset border fits it exactly
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const pad = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h, d - 0.1), mat);
  pad.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  pad.receiveShadow = true;
  L.group.add(pad);
  const t = 0.05, y0 = min[1], y1 = max[1] + 0.012;
  box([min[0], y0, min[2]], [max[0], y1, min[2] + t], MAT.trim);
  box([min[0], y0, max[2] - t], [max[0], y1, max[2]], MAT.trim);
  box([min[0], y0, min[2] + t], [min[0] + t, y1, max[2] - t], MAT.trim);
  box([max[0] - t, y0, min[2] + t], [max[0], y1, max[2] - t], MAT.trim);
  return pad;
}
