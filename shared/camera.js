// The camera, as in Lightleak: what's in frame, taking a photo, and where a photo would develop.
// Plus the PvP part: whether someone is in your focus box for a flash.
//
// A photo stores its objects in the photographer's frame of reference (yaw only), so a scene
// develops the way it looked to you. Developing scales everything by k = d / d0: the distance from
// your eye to where it lands over the distance it was when you took it.
//
// Every function takes a `view`: { eye, yaw, pitch, frame, self } where `self` is the collider to
// ignore (your own capsule). Nothing here changes the world.
import { CAMERA, FLASH, NAMES, PLAYER } from './config.js';
import { propMass } from './arena.js';
import { basis, toCam, sub, add, scale, addScaled, norm, len, dist, dot, qYaw, qMul, qInv, qRot, clamp } from './math.js';

const tanHalf = Math.tan(CAMERA.aimFov * Math.PI / 360);

export function centerHit(A, view, opts = {}) {
  const b = basis(view.yaw, view.pitch);
  return A.ray(view.eye, b.fwd, CAMERA.range, { exclude: view.self, ...opts });
}

// The prop under the crosshair, looking through glass.
export function aimedProp(A, view) {
  const h = centerHit(A, view, { glass: false });
  return h && h.info && h.info.kind === 'prop' ? h.info.ref : null;
}

// Can the camera see any of this prop? Glass is transparent, everything else blocks.
function visible(A, view, p) {
  for (const pt of [p.pos, ...A.propCorners(p, 0.85)]) {
    const d = sub(pt, view.eye), l = len(d);
    if (l > CAMERA.range) continue;
    const h = A.ray(view.eye, scale(d, 1 / l), l + 0.01, { glass: false, exclude: view.self });
    if (!h || (h.info && h.info.ref === p) || h.toi > l - 0.05) return true;
  }
  return false;
}

export function frameRect(frame) {
  const f = CAMERA.frames[frame] || 0;
  return { tx: 0.96 * f * tanHalf, ty: 0.72 * f * tanHalf, frac: f };
}

// Everything a photo taken right now would contain, nearest first.
export function framedProps(A, view) {
  const aimed = aimedProp(A, view);
  const { tx, ty, frac } = frameRect(view.frame);
  if (!frac) return aimed ? [aimed] : [];
  const b = basis(view.yaw, view.pitch);
  const out = new Set(aimed ? [aimed] : []);
  for (const p of A.props) {
    if (out.has(p)) continue;
    const c = toCam(b, view.eye, p.pos);
    if (c[2] > -0.1 || Math.abs(c[0] / -c[2]) > tx || Math.abs(c[1] / -c[2]) > ty) continue;
    if (dist(p.pos, view.eye) > CAMERA.range) continue;
    if (visible(A, view, p)) out.add(p);
  }
  return [...out].sort((a, c) => dist(a.pos, view.eye) - dist(c.pos, view.eye)).slice(0, CAMERA.maxGroup);
}

function itemCorners(it, k) {
  const out = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    out.push(scale(add(qRot(it.q, [a * it.size[0] / 2, b * it.size[1] / 2, c * it.size[2] / 2]), it.p), k));
  }
  return out;
}

// The photo you'd get of `group` from this view.
export function makePhoto(view, group, neg) {
  const yawQ = qYaw(view.yaw), inv = qInv(yawQ);
  const ref = group[0].pos;
  const items = group.map(p => ({ type: p.type, size: p.size.slice(), p: qRot(inv, sub(p.pos, ref)), q: qMul(inv, p.quat) }));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const it of items) for (const c of itemCorners(it, 1)) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
  const center = scale(add(lo, hi), 0.5);
  for (const it of items) it.p = sub(it.p, center);
  const worldCenter = add(qRot(yawQ, center), ref);
  return {
    neg,
    items,
    half: scale(sub(hi, lo), 0.5),
    d0: Math.max(0.3, dist(worldCenter, view.eye)),
    mass: group.reduce((m, p) => m + p.mass, 0),
    label: group.length > 1 ? `${group.length} objects` : NAMES[group[0].type],
    n: group.length,
  };
}

// ---------- developing ----------
function clampK(k, photo) {
  const maxExtent = 2 * Math.max(...photo.half);
  const minDim = Math.min(...photo.items.map(it => Math.min(...it.size)));
  return clamp(k, CAMERA.minDim / minDim, CAMERA.maxDim / maxExtent);
}
// Sizes snap to clean ratios near one, so "the same size" doesn't need the exact spot.
const NICE = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
function snapK(k, photo) {
  let best = null;
  for (const n of NICE) if (Math.abs(k / n - 1) < 0.07 && (!best || Math.abs(k / n - 1) < Math.abs(k / best - 1))) best = n;
  return best ? { k: clampK(best, photo), nice: best } : { k, nice: null };
}
export function ratioLabel(n) {
  if (n == null) return '';
  if (n === 1) return 'same size';
  const frac = { 0.25: '¼', [1 / 3]: '⅓', 0.5: '½', [2 / 3]: '⅔', 0.75: '¾' }[n];
  return frac ? `${frac} size` : `${n}× size`;
}

const groupQuat = (yaw, rot) => qMul(qYaw(yaw), qYaw(rot * Math.PI / 2));
function poses(photo, center, qG, k) {
  return photo.items.map(it => ({ type: it.type, size: it.size.map(v => v * k), pos: add(qRot(qG, scale(it.p, k)), center), q: qMul(qG, it.q) }));
}

// Where, and how big, a photo would develop from this view. Null if there's nothing to develop onto.
// `team` lets it say what a plate underneath would read, and whose it would be.
export function solvePlacement(A, view, photo, rot = 0, team = -1) {
  const h = centerHit(A, view);
  if (!h) return null;
  const qG = groupQuat(view.yaw, rot);
  let center = h.point.slice(), k;

  if (photo.neg) {
    const sn = snapK(clampK(h.toi / photo.d0, photo), photo);
    k = sn.k;
    const ps = poses(photo, center, qG, k);
    const erase = new Set();
    for (const pose of ps) for (const i of A.touchedBy(pose)) if (i.kind === 'prop' || i.kind === 'emulsion') erase.add(i.ref);
    return { neg: true, center, k, nice: sn.nice, poses: ps, erase: [...erase], valid: erase.size > 0, reason: erase.size ? '' : 'NOTHING TO DISSOLVE', size: scale(photo.half, 2 * k) };
  }

  const n = h.normal;
  const corners = photo.items.flatMap(it => itemCorners(it, 1)).map(c => qRot(qG, c));
  const ext = kk => { let e = -Infinity; for (const c of corners) e = Math.max(e, -dot(c, n) * kk); return e; };
  k = clampK(h.toi / photo.d0, photo);
  for (let i = 0; i < 6; i++) {
    center = addScaled(h.point, n, ext(k) + 0.01);
    k = clampK(dist(center, view.eye) / photo.d0, photo);
  }
  const sn = snapK(k, photo);
  k = sn.k;
  center = addScaled(h.point, n, ext(k) + 0.01);

  // nudge out of anything it clips (not people: that's "too close")
  const start = center.slice();
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const pose of poses(photo, center, qG, k)) {
      const o = A.overlaps(pose, 0.005, i => !i || i.kind !== 'player')[0];
      if (o) { center = addScaled(center, [o.hit.normal1.x, o.hit.normal1.y, o.hit.normal1.z], o.hit.distance - 0.003); moved = true; break; }
    }
    if (!moved) break;
  }
  const ps = poses(photo, center, qG, k);
  let valid = dist(center, start) < 1.5, reason = valid ? '' : 'NO ROOM';
  if (valid) for (const pose of ps) {
    const o = A.overlaps(pose, 0.01);
    if (o.length) { valid = false; reason = o.some(x => x.info && x.info.kind === 'player') ? 'TOO CLOSE' : 'NO ROOM'; break; }
  }
  let drop = Infinity;
  for (const pose of ps) drop = Math.min(drop, A.dropOf(pose));
  const mass = photo.items.reduce((m, it) => m + propMass(it.type, it.size.map(v => v * k)), 0);
  const size = scale(photo.half, 2 * k);
  // which plate it will come to rest on, and what that plate will then read
  let plate = null;
  if (isFinite(drop)) {
    const land = [center[0], center[1] - drop, center[2]];
    for (const p of A.plates) {
      if (land[0] > p.lo[0] && land[0] < p.hi[0] && land[2] > p.lo[2] && land[2] < p.hi[2] && land[1] - size[1] / 2 < p.hi[1] + 0.3) {
        const load = p.load + mass, m = p.mass.slice();
        if (team >= 0) m[team] += mass;
        const ok = load >= p.need - 1e-6 && (p.max == null || load <= p.max + 1e-6);
        const owner = !ok || Math.abs(m[0] - m[1]) < 1e-6 ? -1 : m[0] > m[1] ? 0 : 1;
        plate = { i: p.i, name: p.name, load, need: p.need, max: p.max, ok, owner };
      }
    }
  }
  return { neg: false, center, k, nice: sn.nice, poses: ps, valid, reason, drop, mass, size, plate };
}

// ---------- flash ----------
const SAMPLE_Y = [0.55, 1.15, 1.6];
// The enemy nearest the middle of your focus box that the flash can reach, or null.
// `others` are { id, team, pos, alive } and `team` is yours.
export function flashTarget(A, view, others, team) {
  const b = basis(view.yaw, view.pitch);
  let best = null;
  for (const o of others) {
    if (!o.alive || o.team === team) continue;
    if (dist(o.pos, view.eye) > FLASH.range + 2) continue;
    for (const y of SAMPLE_Y) {
      const pt = [o.pos[0], o.pos[1] + y, o.pos[2]];
      const c = toCam(b, view.eye, pt);
      const depth = -c[2];
      if (depth < 0.3) continue;
      const d = dist(pt, view.eye);
      if (d > FLASH.range) continue;
      const ax = Math.abs(c[0]) / depth, ay = Math.abs(c[1]) / depth;
      if (ax > FLASH.cone + PLAYER.radius / depth || ay > FLASH.cone + 0.2 / depth) continue;
      const h = A.ray(view.eye, norm(sub(pt, view.eye)), d, { glass: false, exclude: view.self });
      if (h && h.toi < d - 0.35) continue;
      const score = Math.hypot(ax, ay);
      if (!best || score < best.score) best = { id: o.id, score, dist: d };
      break;
    }
  }
  return best;
}

// Can `from` see a point? (For bots deciding who they can see.)
export function canSee(A, from, to, exclude) {
  const d = sub(to, from), l = len(d);
  const h = A.ray(from, scale(d, 1 / l), l, { glass: false, exclude });
  return !h || h.toi > l - 0.35;
}
