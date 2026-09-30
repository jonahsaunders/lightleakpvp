// Just enough vector and quaternion maths for the simulation, on plain arrays so it serialises.
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const addScaled = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const toObj = a => ({ x: a[0], y: a[1], z: a[2] });
export const fromObj = o => [o.x, o.y, o.z];
export const qObj = q => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
export const qFromObj = o => [o.x, o.y, o.z, o.w];

export function qAxis(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export const qYaw = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
export function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export const qInv = q => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q, v) {
  const [x, y, z] = v, [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

// The camera's axes for a yaw and pitch (three.js convention: looking down -z, rotation order YXZ).
export function basis(yaw, pitch) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return {
    fwd: [-sy * cp, sp, -cy * cp],
    right: [cy, 0, -sy],
    up: [sy * sp, cp, cy * sp],
  };
}
// Camera-space coordinates of a world point (z negative in front).
export function toCam(b, eye, p) {
  const d = sub(p, eye);
  return [dot(d, b.right), dot(d, b.up), -dot(d, b.fwd)];
}
// Yaw and pitch that look from `a` at `b`.
export function lookAt(a, b) {
  const d = sub(b, a);
  return { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) };
}
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Seeded random numbers, so a match with the same seed plays the same.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
export const r3 = v => Math.round(v * 1000) / 1000;
