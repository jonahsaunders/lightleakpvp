// The physical arena: a Rapier world built from an expanded map, with its walls, emulsion,
// plates and props. The server runs the real one (props are dynamic bodies); the browser keeps a
// copy (props are kinematic bodies moved to wherever the server says) for walking, the ghost of a
// photo you're holding and what the camera can see.
import { DT, GRAVITY, DENSITY, PLAYER } from './config.js';
import { toObj, qObj, fromObj, qFromObj, qRot, add } from './math.js';

export const propMass = (type, size) => DENSITY[type] * size[0] * size[1] * size[2];

export class Arena {
  constructor(R, def, { client = false } = {}) {
    this.R = R; this.def = def; this.client = client;
    this.world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = DT;
    this.colliders = new Map();   // collider handle → { kind, ref }
    this.statics = [];            // walls, floors, glass, emulsion; `id` is the index
    this.props = [];
    this.propById = new Map();
    this.plates = [];
    this.killY = def.killY;
    this.buildRoom(def.room);
    for (const b of def.blocks) this.addBlock(b.min, b.max, b.mat || 'ledge', b);
    for (const d of def.decor || []) if (d.kind === 'bench') this.addBench(d);
    def.plates.forEach((p, i) => this.addPlate(p, i));
    this.world.step();
  }

  // ---------- statics ----------
  staticCollider(min, max) {
    const R = this.R;
    const hx = (max[0] - min[0]) / 2, hy = (max[1] - min[1]) / 2, hz = (max[2] - min[2]) / 2;
    return this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min[0] + hx, min[1] + hy, min[2] + hz).setFriction(0.8));
  }
  addBlock(min, max, mat = 'wall', src = null) {
    const kind = mat === 'glass' ? 'glass' : mat === 'emulsion' ? 'emulsion' : 'static';
    const s = { id: this.statics.length, kind, mat, min: min.slice(), max: max.slice(), collider: null, erased: false, src, regrowAt: 0 };
    s.collider = this.staticCollider(min, max);
    this.colliders.set(s.collider.handle, { kind, ref: s });
    this.statics.push(s);
    return s;
  }
  buildRoom(r) {
    const t = 0.5, { x0, x1, z0, z1, h } = r;
    const S = (a, b, mat = 'wall') => this.addBlock(a, b, mat, { room: true });
    if (r.floor !== false) S([x0 - t, -t, z0 - t], [x1 + t, 0, z1 + t], 'floor');
    S([x0 - t, h, z0 - t], [x1 + t, h + t, z1 + t], 'ceil');
    S([x0 - t, -20, z0], [x0, h, z1]);
    S([x1, -20, z0], [x1 + t, h, z1]);
    S([x0 - t, -20, z0 - t], [x1 + t, h, z0]);
    S([x0 - t, -20, z1], [x1 + t, h, z1 + t]);
  }
  // Benches are solid: one box for the whole thing, drawn as a bench by the browser.
  addBench(d) {
    const [x, y, z] = d.pos, rot = (d.rot || 0) * Math.PI / 180, len = d.len || 2.4;
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const hx = (len / 2) * c + 0.45 * s, hz = (len / 2) * s + 0.45 * c;
    this.addBlock([x - hx, y, z - hz], [x + hx, y + 1.02, z + hz], 'bench', { bench: true });
  }
  eraseStatic(s) {
    if (s.erased) return;
    s.erased = true;
    this.colliders.delete(s.collider.handle);
    this.world.removeCollider(s.collider, true);
    s.collider = null;
  }
  restoreStatic(s) {
    if (!s.erased) return;
    s.erased = false;
    s.collider = this.staticCollider(s.min, s.max);
    this.colliders.set(s.collider.handle, { kind: s.kind, ref: s });
  }

  // ---------- plates ----------
  addPlate(def, i) {
    const [x, y, z] = def.pos, [w, d] = def.size;
    const lo = [x - w / 2, y, z - d / 2], hi = [x + w / 2, y + 0.08, z + d / 2];
    const collider = this.staticCollider(lo, hi);
    const p = { i, name: def.name, need: def.need, max: def.max ?? null, lo, hi, pos: def.pos, size: def.size, collider,
      load: 0, mass: [0, 0], owner: -1, on: false, held: 0 };
    this.colliders.set(collider.handle, { kind: 'plate', ref: p });
    this.plates.push(p);
  }
  touching(a, b) {
    let n = 0;
    this.world.contactPair(a, b, m => { n += m.numContacts(); });
    return n > 0;
  }
  // Everything resting on the plate, directly or stacked, and how much of it each team developed.
  plateLoad(plate) {
    const seen = new Set(), queue = [], mass = [0, 0];
    this.world.contactPairsWith(plate.collider, c => {
      const info = this.colliders.get(c.handle);
      if (info && info.kind === 'prop' && this.touching(plate.collider, c)) queue.push(info.ref);
    });
    let load = 0;
    while (queue.length) {
      const p = queue.pop();
      if (seen.has(p)) continue;
      seen.add(p); load += p.mass;
      if (p.team >= 0) mass[p.team] += p.mass;
      const y = p.pos[1];
      this.world.contactPairsWith(p.collider, c => {
        const info = this.colliders.get(c.handle);
        if (info && info.kind === 'prop' && !seen.has(info.ref) && info.ref.pos[1] > y + 0.05 && this.touching(p.collider, c)) queue.push(info.ref);
      });
    }
    return { load, mass };
  }
  // Whose plate is it? Only while the load is in range, and only by the weight a team put there.
  static ownerOf(plate, load, mass) {
    const ok = load >= plate.need - 1e-6 && (plate.max == null || load <= plate.max + 1e-6);
    if (!ok || Math.abs(mass[0] - mass[1]) < 1e-6) return { ok, owner: -1 };
    return { ok, owner: mass[0] > mass[1] ? 0 : 1 };
  }

  // ---------- props ----------
  addProp({ id, type, size, pos, quat, team = -1, owner = null, lin, ang, home = null }) {
    const R = this.R;
    const desc = this.client
      ? R.RigidBodyDesc.kinematicPositionBased()
      : R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3);
    desc.setTranslation(pos[0], pos[1], pos[2]).setRotation(qObj(quat));
    const body = this.world.createRigidBody(desc);
    if (lin && !this.client) body.setLinvel(toObj(lin), true);
    if (ang && !this.client) body.setAngvel(toObj(ang), true);
    const collider = this.world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setDensity(DENSITY[type]).setFriction(0.8).setRestitution(0), body);
    const p = { id, type, size: size.slice(), mass: propMass(type, size), team, owner, body, collider, pos: pos.slice(), quat: quat.slice(),
      home, peak: 0, hurt: new Map(), born: 0 };
    this.colliders.set(collider.handle, { kind: 'prop', ref: p });
    this.props.push(p);
    this.propById.set(id, p);
    return p;
  }
  removeProp(p) {
    if (!this.propById.has(p.id)) return;
    this.colliders.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.props.splice(this.props.indexOf(p), 1);
    this.propById.delete(p.id);
  }
  syncProp(p) {
    p.pos = fromObj(p.body.translation());
    p.quat = qFromObj(p.body.rotation());
  }
  setPropPose(p, pos, quat) {
    p.pos = pos; p.quat = quat;
    p.body.setTranslation(toObj(pos), true);
    p.body.setRotation(qObj(quat), true);
  }
  propCorners(p, shrink = 1) {
    const out = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
      out.push(add(qRot(p.quat, [a * p.size[0] / 2 * shrink, b * p.size[1] / 2 * shrink, c * p.size[2] / 2 * shrink]), p.pos));
    }
    return out;
  }

  // ---------- players ----------
  addPlayerBody(pl) {
    const R = this.R, half = (PLAYER.height - 2 * PLAYER.radius) / 2;
    pl.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pl.pos[0], pl.pos[1] + PLAYER.height / 2, pl.pos[2]));
    pl.collider = this.world.createCollider(R.ColliderDesc.capsule(half, PLAYER.radius).setFriction(0), pl.body);
    this.colliders.set(pl.collider.handle, { kind: 'player', ref: pl });
  }
  removePlayerBody(pl) {
    if (!pl.body) return;
    this.colliders.delete(pl.collider.handle);
    this.world.removeRigidBody(pl.body);
    pl.body = pl.collider = null;
    if (pl.ctrl) { this.world.removeCharacterController(pl.ctrl); pl.ctrl = null; }
  }
  // Put a player's capsule where the player stands (feet at pos).
  placeBody(pl, teleport = false) {
    if (!pl.body) return;
    const c = { x: pl.pos[0], y: pl.pos[1] + PLAYER.height / 2, z: pl.pos[2] };
    if (teleport) pl.body.setTranslation(c, true);
    pl.body.setNextKinematicTranslation(c);
  }

  // ---------- queries ----------
  // First hit along a ray. Glass is see-through to cameras and flashes (glass: false skips it);
  // players are skipped unless asked for.
  ray(origin, dir, max, { glass = true, players = false, exclude = null, props = true } = {}) {
    const R = this.R;
    const hit = this.world.castRayAndGetNormal(new R.Ray(toObj(origin), toObj(dir)), max, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude || undefined, undefined, c => {
      const i = this.colliders.get(c.handle);
      if (!i) return true;
      if (!glass && i.kind === 'glass') return false;
      if (!players && i.kind === 'player') return false;
      if (!props && i.kind === 'prop') return false;
      return true;
    });
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { toi: t, point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], normal: fromObj(hit.normal), info: this.colliders.get(hit.collider.handle) || null, collider: hit.collider };
  }
  // Colliders a box would overlap by more than `slack` metres, with the deepest contact.
  overlaps(pose, slack = 0.005, filter = null) {
    const R = this.R, out = [];
    const shape = new R.Cuboid(pose.size[0] / 2, pose.size[1] / 2, pose.size[2] / 2);
    const pos = toObj(pose.pos), rot = qObj(pose.q);
    this.world.intersectionsWithShape(pos, rot, shape, c => {
      if (filter && !filter(this.colliders.get(c.handle))) return true;
      const hit = shape.contactShape(pos, rot, c.shape, c.translation(), c.rotation(), 0);
      if (hit && hit.distance < -slack) out.push({ collider: c, hit, info: this.colliders.get(c.handle) });
      return true;
    }, R.QueryFilterFlags.EXCLUDE_SENSORS);
    return out;
  }
  // Everything a box touches at all.
  touchedBy(pose) {
    const R = this.R, out = [];
    const shape = new R.Cuboid(pose.size[0] / 2, pose.size[1] / 2, pose.size[2] / 2);
    this.world.intersectionsWithShape(toObj(pose.pos), qObj(pose.q), shape, c => {
      const i = this.colliders.get(c.handle);
      if (i) out.push(i);
      return true;
    }, R.QueryFilterFlags.EXCLUDE_SENSORS);
    return out;
  }
  // How far a box falls before it lands on something (Infinity if never).
  dropOf(pose) {
    const R = this.R;
    const hit = this.world.castShape(toObj(pose.pos), qObj(pose.q), { x: 0, y: -1, z: 0 }, new R.Cuboid(pose.size[0] / 2, pose.size[1] / 2, pose.size[2] / 2), 0, 60, false, R.QueryFilterFlags.EXCLUDE_SENSORS);
    return hit ? hit.time_of_impact ?? hit.timeOfImpact : Infinity;
  }

  free() { this.world.free(); }
}
