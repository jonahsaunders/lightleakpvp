// Walking: a kinematic capsule driven by Rapier's character controller. The browser runs this for
// your own player; the server runs it for bots and to check the positions players report.
// Players pass through each other; everything else blocks them.
import { PLAYER, DT } from './config.js';
import { clamp } from './math.js';

const JUMP_V = Math.sqrt(2 * PLAYER.gravity * PLAYER.jump);

export function createMover(A, pl) {
  const c = A.world.createCharacterController(0.02);
  c.setUp({ x: 0, y: 1, z: 0 });
  c.enableAutostep(PLAYER.step, 0.1, true);
  c.enableSnapToGround(0.25);
  c.setMaxSlopeClimbAngle(50 * Math.PI / 180);
  c.setApplyImpulsesToDynamicBodies(false);
  pl.ctrl = c;
  pl.vel = pl.vel || [0, 0, 0];
  pl.prev = pl.pos.slice();
  pl.grounded = false;
}

function notPlayers(A) {
  return c => { const i = A.colliders.get(c.handle); return !i || i.kind !== 'player'; };
}

// Try to move a capsule by `want`; returns the movement the controller allows.
export function tryMove(A, pl, want) {
  pl.ctrl.computeColliderMovement(pl.collider, { x: want[0], y: want[1], z: want[2] }, A.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, notPlayers(A));
  const m = pl.ctrl.computedMovement();
  return { m: [m.x, m.y, m.z], grounded: pl.ctrl.computedGrounded() };
}

// input: { f, r, jump, yaw } with f and r in -1..1
export function stepMover(A, pl, input, frozen = false) {
  pl.prev = pl.pos.slice();
  const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
  let wx = -sy * input.f + cy * input.r, wz = -cy * input.f - sy * input.r;
  const l = Math.hypot(wx, wz);
  if (l > 1) { wx /= l; wz /= l; }
  if (frozen) wx = wz = 0;
  const v = pl.vel, acc = (pl.grounded ? 60 : 14) * DT;
  v[0] += clamp(wx * PLAYER.speed - v[0], -acc, acc);
  v[2] += clamp(wz * PLAYER.speed - v[2], -acc, acc);
  if (pl.grounded && input.jump && !frozen) { v[1] = JUMP_V; pl.grounded = false; }
  // grounded: don't push into the floor (the controller then sometimes refuses the sideways part)
  if (pl.grounded && v[1] <= 0) v[1] = 0;
  else v[1] = Math.max(v[1] - PLAYER.gravity * DT, -30);
  const want = [v[0] * DT, v[1] * DT, v[2] * DT];
  const { m, grounded } = tryMove(A, pl, want);
  const fall = -v[1];
  pl.grounded = grounded;
  if (pl.grounded && v[1] < 0) v[1] = 0;
  if (want[1] > 0 && m[1] < want[1] * 0.5) v[1] = 0; // bumped a ceiling
  if (Math.abs(want[0]) > 1e-6) v[0] *= clamp(m[0] / want[0], 0, 1);
  if (Math.abs(want[2]) > 1e-6) v[2] *= clamp(m[2] / want[2], 0, 1);
  pl.pos[0] += m[0]; pl.pos[1] += m[1]; pl.pos[2] += m[2];
  A.placeBody(pl);
  return { landed: pl.grounded && fall > 9 ? fall : 0 };
}
