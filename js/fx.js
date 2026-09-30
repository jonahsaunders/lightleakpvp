// Visual effects for developing and dissolving. Purely cosmetic: nothing here touches the simulation.
import { G } from './state.js';
import { softDot } from './materials.js';

const THREE = window.THREE;
let dot = null;
const live = [];

// A spray of droplets from a box: warm and rising when something develops, red and falling when
// something dissolves.
export function burst(center, size, { color = 0xffd9b0, count = 90, up = 1, spread = 1 } = {}) {
  if (G.headless || !G.L) return;
  dot = dot || softDot();
  const n = count, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // start on the surface of the box
    const f = Math.floor(Math.random() * 3), s = Math.random() < 0.5 ? -0.5 : 0.5;
    const p = [(Math.random() - 0.5) * size[0], (Math.random() - 0.5) * size[1], (Math.random() - 0.5) * size[2]];
    p[f] = s * size[f];
    pos[i * 3] = center.x + p[0]; pos[i * 3 + 1] = center.y + p[1]; pos[i * 3 + 2] = center.z + p[2];
    vel[i * 3] = p[0] * spread * (0.6 + Math.random());
    vel[i * 3 + 1] = up * (0.4 + Math.random() * 1.2);
    vel[i * 3 + 2] = p[2] * spread * (0.6 + Math.random());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: dot, color, size: 0.07, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.userData.noAO = true;
  G.L.group.add(pts);
  live.push({ obj: pts, t: 0, life: 0.9, step(dt, k) {
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      vel[i * 3 + 1] -= (up > 0 ? 1.5 : 6) * dt;
      a[i * 3] += vel[i * 3] * dt; a[i * 3 + 1] += vel[i * 3 + 1] * dt; a[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 1 - k;
  }, dispose() { geo.dispose(); mat.dispose(); } });
}

// A fading copy of something that was just dissolved: it lifts a little, reddens and goes.
export function fadeOut(mesh) {
  if (G.headless || !G.L || !mesh) return;
  const ghost = new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({
    color: 0x5a1208, emissive: 0xd8452f, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  ghost.position.copy(mesh.getWorldPosition(new THREE.Vector3()));
  ghost.quaternion.copy(mesh.getWorldQuaternion(new THREE.Quaternion()));
  ghost.scale.copy(mesh.getWorldScale(new THREE.Vector3()));
  ghost.userData.noAO = true;
  G.L.group.add(ghost);
  const y0 = ghost.position.y, s0 = ghost.scale.clone();
  live.push({ obj: ghost, t: 0, life: 0.6, step(dt, k) {
    ghost.material.opacity = 0.85 * (1 - k);
    ghost.position.y = y0 + k * 0.25;
    ghost.scale.copy(s0).multiplyScalar(1 + k * 0.06);
  }, dispose() { ghost.material.dispose(); } });
  const size = [ghost.scale.x, ghost.scale.y, ghost.scale.z];
  if (mesh.geometry.parameters && mesh.geometry.parameters.width) { size[0] *= mesh.geometry.parameters.width; size[1] *= mesh.geometry.parameters.height; size[2] *= mesh.geometry.parameters.depth; }
  burst(ghost.position, size, { color: 0xff4a2a, count: 120, up: -0.3, spread: 0.6 });
}

// Newly developed props grow out of a slightly smaller shell over a fraction of a second.
export function grow(prop) {
  if (G.headless || !prop) return;
  const m = prop.mesh, s = prop.size;
  live.push({ obj: null, t: 0, life: 0.35, step(dt, k) {
    const e = 1 - Math.pow(1 - k, 3);
    m.scale.set(s[0] * (0.9 + 0.1 * e), s[1] * (0.9 + 0.1 * e), s[2] * (0.9 + 0.1 * e));
  }, dispose() { m.scale.set(...s); } });
  burst(m.position, s, { color: 0xffe2c0, count: 70, up: 0.6, spread: 0.4 });
}

export function stepFX(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.life);
    f.step(dt, k);
    if (k >= 1) { if (f.obj && f.obj.parent) f.obj.parent.remove(f.obj); f.dispose(); live.splice(i, 1); }
  }
}
export function clearFX() { while (live.length) { const f = live.pop(); if (f.obj && f.obj.parent) f.obj.parent.remove(f.obj); f.dispose(); } }
