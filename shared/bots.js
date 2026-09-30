// Bots. They play by the same rules as people: they send the same inputs and clicks, see through
// glass but not walls, and turn at a limited speed. They do know where everyone is (as if they could
// hear them), but only fight who they can see.
//
// Each tick a bot:
//   1. looks for enemies it can see, and notices when it's been seen for long enough to react
//   2. every so often, rethinks its job: which plate needs weight (or less weight), which object
//      to photograph and from how far so it develops at the right weight, where to stand to develop it
//   3. takes a chance when it has one: cover when someone's focusing on it, something heavy dropped
//      from the ceiling onto a player standing still, an emulsion floor dissolved under someone
//   4. otherwise fights whoever it's locked on to, or gets on with the job
import { PLAYER, FLASH, CRUSH, GRAVITY, CAMERA } from './config.js';
import { aimedProp, solvePlacement, canSee } from './camera.js';
import { dist, dist2d, lookAt, angleDiff, clamp, basis } from './math.js';

const EYE = PLAYER.eye;
const eyeOf = p => [p[0], p[1] + EYE, p[2]];
const chest = p => [p[0], p[1] + 1.15, p[2]];

export class Brain {
  constructor(m, pl, diff) {
    this.m = m; this.pl = pl; this.d = diff;
    const mates = m.players.filter(p => p.team === pl.team && p !== pl).length;
    this.slot = mates;                            // spreads bots across plates
    this.roamer = m.settings.size >= 5 && mates >= 3;
    this.reset();
  }
  reset() {
    const pl = this.pl;
    this.look = { yaw: pl.yaw, pitch: 0 };
    this.want = { yaw: pl.yaw, pitch: 0 };
    this.path = null; this.pathI = 0; this.pathFor = null; this.pathT = 0;
    this.dest = null; this.job = null; this.tact = null;
    this.thinkT = 0.3 + this.m.rand() * 0.5;
    this.seen = new Map(); this.target = null;
    this.stuckT = 0; this.bestD = Infinity;
    this.strafe = this.m.rand() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.coverCd = 2; this.tactCd = 2; this.aimHold = 0; this.jumpCd = 0;
    this.wob = this.m.rand() * 100;
  }

  update(dt) {
    const m = this.m, pl = this.pl;
    const out = { f: 0, r: 0, jump: false, yaw: this.look.yaw, pitch: this.look.pitch, aim: false, frame: 0, actions: [] };
    this.coverCd -= dt; this.tactCd -= dt; this.jumpCd -= dt; this.thinkT -= dt;
    if (this.frozen) return out;   // held still for a staged screenshot
    if (m.phase !== 'live') { this.turn(dt); out.yaw = this.look.yaw; out.pitch = this.look.pitch; return out; }
    this.perceive(dt);
    if (!this.tact && this.tactCd <= 0) this.chances();
    if (this.thinkT <= 0) { this.thinkT = this.d.think * (0.7 + m.rand() * 0.8) + 0.25; this.strategize(); }

    let hold = false;
    if (this.job && this.job.done) this.job = null;
    if (this.tact) hold = this.doTact(dt, out);
    else if (this.target && pl.bulbs > 0) this.fight(dt, out);
    else if (this.job) this.doJob(dt, out);
    this.turn(dt);
    out.yaw = this.look.yaw; out.pitch = this.look.pitch;
    if (!hold) this.walk(dt, out);
    return out;
  }

  // ---------- senses ----------
  perceive(dt) {
    const m = this.m, pl = this.pl, eye = eyeOf(pl.pos);
    let best = null, bd = Infinity;
    for (const e of m.players) {
      if (e.team === pl.team || !e.alive) { this.seen.delete(e.id); continue; }
      const d = dist(e.pos, pl.pos);
      const vis = d < FLASH.range + 4 && canSee(m.A, eye, chest(e.pos), pl.collider);
      const s = vis ? (this.seen.get(e.id) || 0) + dt : 0;
      this.seen.set(e.id, s);
      if (vis && s >= this.d.react) {
        const sticky = this.target && this.target.id === e.id ? 4 : 0;
        if (d - sticky < bd) { bd = d - sticky; best = e; }
      }
    }
    this.target = best;
  }
  watchers() { return this.m.players.filter(o => o.alive && o.focus && o.focus.id === this.pl.id && o.focus.t > 0.12); }

  // ---------- fighting ----------
  fight(dt, out) {
    const pl = this.pl, e = this.target;
    const lead = e.vel ? [e.vel[0] * 0.08, 0, e.vel[2] * 0.08] : [0, 0, 0];
    const aimAt = chest([e.pos[0] + lead[0], e.pos[1], e.pos[2] + lead[2]]);
    const la = lookAt(eyeOf(pl.pos), aimAt);
    this.wob += dt;
    const w = this.d.wobble;
    this.want = { yaw: la.yaw + Math.sin(this.wob * 2.3) * w, pitch: la.pitch + Math.cos(this.wob * 1.7) * w * 0.6 };
    out.aim = true;
    const f = pl.focus;
    if (f && f.id === e.id && f.t >= FLASH.focus + this.d.hesitate && pl.flashCd <= 0) out.actions.push({ a: 'shoot' });
    // keep moving sideways so you're harder to hold in frame
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 0.6 + this.m.rand() * 1.1; }
    this.fighting = true;
  }

  // ---------- chances: cover, a drop from the ceiling, the floor out from under someone ----------
  chances() {
    const m = this.m, pl = this.pl, A = m.A;
    const eye = eyeOf(pl.pos);
    const posPhotos = pl.roll.filter(p => !p.neg), negPhotos = pl.roll.filter(p => p.neg);
    // cover: someone is pulling focus on us
    const w = this.watchers();
    if (w.length && posPhotos.length && this.coverCd <= 0 && (pl.exposure >= 1 || w[0].focus.t > 0.25)) {
      const a = w[0];
      for (const ph of posPhotos) {
        const size = Math.max(...ph.half) * 2;
        const d = clamp(1.5 * ph.d0 / Math.max(size, 0.1), 2.2, 7);
        const dx = a.pos[0] - pl.pos[0], dz = a.pos[2] - pl.pos[2], l = Math.hypot(dx, dz) || 1;
        const pt = [pl.pos[0] + dx / l * d, pl.pos[1], pl.pos[2] + dz / l * d];
        const la = lookAt(eye, pt);
        const view = { eye, yaw: la.yaw, pitch: la.pitch, frame: 0, self: pl.collider };
        const pred = solvePlacement(A, view, ph, 0, pl.team);
        if (pred && pred.valid && pred.size[1] >= 1.1) {
          this.tact = { yaw: la.yaw, pitch: la.pitch, t: 0, photo: ph.id, check: p => p.valid };
          this.coverCd = 7;
          return;
        }
      }
      this.coverCd = 1.5;
    }
    const enemies = m.players.filter(e => e.alive && e.team !== pl.team && (this.seen.get(e.id) || 0) > 0);
    // a heavy drop onto someone standing still
    if (this.d.crush && posPhotos.length) {
      for (const e of enemies) {
        const speed = e.vel ? Math.hypot(e.vel[0], e.vel[2]) : 0;
        if (speed > 1.6 || dist(e.pos, pl.pos) > 22) continue;
        const up = A.ray([e.pos[0], e.pos[1] + 1.9, e.pos[2]], [0, 1, 0], 14, { players: false });
        if (!up || up.toi < 1.2) continue;
        const la = lookAt(eye, up.point);
        const view = { eye, yaw: la.yaw, pitch: la.pitch, frame: 0, self: pl.collider };
        for (const ph of posPhotos) {
          const pred = solvePlacement(A, view, ph, 0, pl.team);
          if (!pred || !pred.valid || !isFinite(pred.drop) || pred.drop < 1.8) continue;
          const land = [pred.center[0], pred.center[1] - pred.drop, pred.center[2]];
          if (dist2d(land, e.pos) > 0.8) continue;
          if (pred.mass * Math.sqrt(2 * GRAVITY * pred.drop) < CRUSH.impulse[1]) continue;
          this.tact = { yaw: la.yaw, pitch: la.pitch, t: 0, photo: ph.id, check: p => p.valid && isFinite(p.drop) && p.drop > 1.5 };
          this.tactCd = 4;
          return;
        }
      }
    }
    // an emulsion floor with nothing underneath
    if (negPhotos.length) {
      for (const e of enemies) {
        const under = A.ray([e.pos[0], e.pos[1] + 0.2, e.pos[2]], [0, -1, 0], 0.8);
        if (!under || !under.info || under.info.kind !== 'emulsion') continue;
        const s = under.info.ref;
        const below = A.ray([e.pos[0], s.min[1] - 0.05, e.pos[2]], [0, -1, 0], 30);
        if (below && below.toi < 6) continue;
        const pt = [clamp(e.pos[0], s.min[0] + 0.2, s.max[0] - 0.2), s.max[1], clamp(e.pos[2], s.min[2] + 0.2, s.max[2] - 0.2)];
        const la = lookAt(eye, pt);
        const view = { eye, yaw: la.yaw, pitch: la.pitch, frame: 0, self: pl.collider };
        const pred = solvePlacement(A, view, negPhotos[0], 0, pl.team);
        if (pred && pred.valid && pred.erase.includes(s)) {
          this.tact = { yaw: la.yaw, pitch: la.pitch, t: 0, photo: negPhotos[0].id, check: p => p.valid };
          this.tactCd = 3;
          return;
        }
      }
    }
    this.tactCd = 0.4;
  }
  doTact(dt, out) {
    const t = this.tact, pl = this.pl;
    t.t += dt;
    this.want = { yaw: t.yaw, pitch: t.pitch };
    if (!pl.roll.some(p => p.id === t.photo) || t.t > 1.6) { this.tact = null; return false; }
    if (Math.abs(angleDiff(this.look.yaw, t.yaw)) < 0.02 && Math.abs(this.look.pitch - t.pitch) < 0.02) {
      const view = { eye: eyeOf(pl.pos), yaw: this.look.yaw, pitch: this.look.pitch, frame: 0, self: pl.collider };
      const ph = pl.roll.find(p => p.id === t.photo);
      const pred = solvePlacement(this.m.A, view, ph, 0, pl.team);
      if (pred && t.check(pred)) out.actions.push({ a: 'develop', id: t.photo, rot: 0 });
      this.tact = null;
    }
    return true;
  }

  // ---------- strategy ----------
  strategize() {
    const m = this.m, pl = this.pl;
    if (this.job && (this.job.t > this.job.timeout || this.job.done)) this.job = null;
    if (this.job && this.job.kind !== 'guard' && this.job.kind !== 'hunt') return;
    this.job = null;
    const lastlight = !m.mode.respawn;
    if (lastlight) {
      const tie = m.A.plates.filter(p => p.owner === pl.team).length <= m.A.plates.filter(p => p.owner === 1 - pl.team).length;
      if (m.clock < 40 && tie && this.slot % 2 === 0) { this.platesJob(); if (this.job) return; }
      // something to drop on people, if there's time
      if (!pl.roll.some(p => !p.neg) && pl.film.pos > 0 && m.rand() < 0.5) { this.photoJob(1.5 + m.rand() * 2, true); if (this.job) return; }
      this.huntJob();
      return;
    }
    if (this.roamer && m.rand() < 0.5) { this.huntJob(); if (this.job) return; }
    this.platesJob();
    if (!this.job) this.huntJob();
  }

  choosePlate() {
    const m = this.m, pl = this.pl;
    const others = m.players.filter(p => p !== pl && p.team === pl.team && p.bot && p.bot.job && p.bot.job.plate != null);
    let best = null, bs = -Infinity;
    for (const P of m.A.plates) {
      let s = P.owner === pl.team ? 0.2 : P.owner === -1 ? 0.9 : 1.15;
      if (this.roamer && P.owner === 1 - pl.team) s += 0.4;
      s -= dist2d(pl.pos, P.pos) / 45;
      s -= 0.45 * others.filter(o => o.bot.job.plate === P.i).length;
      s += ((P.i + this.slot) % m.A.plates.length === 0 ? 0.15 : 0);
      if (s > bs) { bs = s; best = P; }
    }
    return best;
  }

  // What does this plate need from us?
  needOf(P) {
    const team = this.pl.team, my = P.mass[team], en = P.mass[1 - team], L = P.load, max = P.max ?? Infinity;
    const onPlate = this.m.A.props.filter(p => onTop(p, P));
    if (L > max + 1e-6) {
      const pick = onPlate.filter(p => p.team !== team).sort((a, b) => b.mass - a.mass)[0] || onPlate.sort((a, b) => b.mass - a.mass)[0];
      return pick ? { kind: 'dissolve', prop: pick } : { kind: 'hold' };
    }
    if (P.owner === team) return { kind: 'hold' };
    let lo = Math.max(P.need - L, en - my + 0.25, 0.3), hi = max - L;
    if (lo > hi) {
      const pick = onPlate.filter(p => p.team === 1 - team).sort((a, b) => b.mass - a.mass)[0] || onPlate.filter(p => p.team < 0).sort((a, b) => b.mass - a.mass)[0];
      return pick ? { kind: 'dissolve', prop: pick } : { kind: 'hold' };
    }
    if (!isFinite(hi)) hi = lo * 2 + 2;
    return { kind: 'add', lo, hi, target: lo + (hi - lo) * 0.45 };
  }

  platesJob() {
    const pl = this.pl, P = this.choosePlate();
    if (!P) return;
    const need = this.needOf(P);
    if (need.kind === 'hold') { this.guardJob(P); return; }
    if (need.kind === 'dissolve') {
      const neg = pl.roll.find(p => p.neg);
      if (neg) {
        const stand = this.standFor(need.prop.pos, 5, 3, false, need.prop);
        if (stand) this.job = { kind: 'develop', plate: P.i, photo: neg.id, stand, point: need.prop.pos.slice(), aimProp: need.prop, t: 0, timeout: 14, tries: 0 };
        return;
      }
      if (pl.film.neg > 0 && pl.roll.length < CAMERA.roll) {
        const stand = this.standFor(need.prop.pos, 5, 2, false, need.prop);
        if (stand) this.job = { kind: 'shoot', plate: P.i, prop: need.prop, neg: true, stand, t: 0, timeout: 14 };
        return;
      }
      this.guardJob(P);
      return;
    }
    const point = [P.pos[0], P.hi[1], P.pos[2]];
    for (const ph of pl.roll) {
      if (ph.neg) continue;
      const d = this.devDistance(ph, need.target);
      if (!d) continue;
      const stand = this.standFor(point, d, 1.5);
      if (stand) { this.job = { kind: 'develop', plate: P.i, photo: ph.id, stand, point, need, d, t: 0, timeout: 16, tries: 0 }; return; }
    }
    if (pl.roll.length >= CAMERA.roll) {
      // hands full of the wrong photos: throw the least useful one away
      const junk = pl.roll.find(p => !p.neg && !this.devDistance(p, need.target)) || pl.roll[0];
      pl.actions.push({ a: 'discard', id: junk.id });
      return;
    }
    if (pl.film.pos <= 0) { this.guardJob(P); return; }
    this.sourceJob(P, need);
  }
  // From how far away must this photo be developed to weigh `mass`?
  devDistance(ph, mass) {
    const maxExtent = 2 * Math.max(...ph.half);
    const k = Math.min(Math.cbrt(mass / ph.mass), (CAMERA.maxDim * 0.95) / maxExtent);
    const d = k * ph.d0;
    return d >= 2.4 && d <= 18 ? d : null;
  }
  // Something to photograph, from a distance that'll develop at the right weight about 6 m away.
  sourceJob(P, need) {
    const m = this.m, pl = this.pl;
    let best = null, bc = Infinity;
    for (const p of m.A.props) {
      if (m.A.plates.some(Q => onTop(p, Q))) continue;
      const k = Math.cbrt(need.target / p.mass);
      if (Math.max(...p.size) * k > CAMERA.maxDim * 0.9 || Math.min(...p.size) * k < 0.2) continue;
      let d0 = 6 / k;
      if (d0 < 1.7) d0 = 1.7;
      if (d0 > 16) d0 = 16;
      const dDev = k * d0;
      if (dDev < 2.6 || dDev > 16) continue;
      const cost = dist(pl.pos, p.pos) + dist(p.pos, P.pos) * 0.5 + (p.team === 1 - pl.team ? 3 : 0);
      if (cost < bc) { bc = cost; best = { p, d0 }; }
    }
    if (!best) { this.guardJob(P); return; }
    const stand = this.standFor(best.p.pos, best.d0, 1, false, best.p);
    if (!stand) { this.guardJob(P); return; }
    this.job = { kind: 'shoot', plate: P.i, prop: best.p, neg: false, stand, t: 0, timeout: 16 };
  }
  // A photo to keep in hand: something close, so it develops big.
  photoJob(d0) {
    const m = this.m, pl = this.pl;
    const near = m.A.props.filter(p => dist(p.pos, pl.pos) < 16 && !m.A.plates.some(Q => onTop(p, Q)))
      .sort((a, b) => b.mass / (1 + dist(b.pos, pl.pos)) - a.mass / (1 + dist(a.pos, pl.pos)))[0];
    if (!near) return;
    const stand = this.standFor(near.pos, d0, 1.2, false, near);
    if (stand) this.job = { kind: 'shoot', prop: near, neg: false, stand, t: 0, timeout: 10 };
  }
  guardJob(P) {
    const spot = this.standFor([P.pos[0], P.pos[1] + 0.5, P.pos[2]], 3 + (this.slot % 3), 2.5, true);
    this.job = { kind: 'guard', plate: P.i, stand: spot || nodePos(this.m.nav.nearest(P.pos)), t: 0, timeout: 2.5 + this.m.rand() * 2 };
  }
  huntJob() {
    const pl = this.pl;
    const enemies = this.m.players.filter(e => e.alive && e.team !== pl.team).sort((a, b) => dist(a.pos, pl.pos) - dist(b.pos, pl.pos));
    if (!enemies.length) return;
    this.job = { kind: 'hunt', id: enemies[0].id, t: 0, timeout: 3 };
  }

  // Can an eye see a point (or the prop there)? The prop itself doesn't count as in the way.
  sees(e, point, prop = null) {
    const d = [point[0] - e[0], point[1] - e[1], point[2] - e[2]], l = Math.hypot(...d);
    const h = this.m.A.ray(e, [d[0] / l, d[1] / l, d[2] / l], l, { glass: false, exclude: this.pl.collider });
    return !h || h.toi > l - 0.35 || (prop ? h.info && h.info.ref === prop : dist(h.point, point) < 1.2);
  }
  // A place to stand whose eye is about `d` from `point` and can see it. Nearest to us wins.
  standFor(point, d, tol = 1, anyView = false, prop = null) {
    const nav = this.m.nav, pl = this.pl;
    const cand = [];
    for (const n of nav.nodes) {
      if (Math.abs(n.x - point[0]) > d + tol + 1 || Math.abs(n.z - point[2]) > d + tol + 1) continue;
      if (!nav.ok(n) || n.y < point[1] - 3.5) continue;
      const e = [n.x, n.y + EYE, n.z];
      const dd = dist(e, point);
      if (Math.abs(dd - d) > tol || dist2d(e, point) < 1.2) continue;
      cand.push({ n, c: Math.hypot(n.x - pl.pos[0], n.y - pl.pos[1], n.z - pl.pos[2]) + Math.abs(dd - d) * 2 + (n.floor ? 4 : 0) });
    }
    cand.sort((a, b) => a.c - b.c);
    for (const { n } of cand.slice(0, 14)) {
      if (anyView || this.sees([n.x, n.y + EYE, n.z], point, prop)) return nodePos(n);
    }
    return null;
  }

  doJob(dt, out) {
    const j = this.job, pl = this.pl, m = this.m;
    j.t += dt;
    const eye = eyeOf(pl.pos);
    if (j.kind === 'hunt') {
      const e = m.byId.get(j.id);
      if (!e || !e.alive) { j.done = true; return; }
      this.dest = e.pos.slice();
      this.lookAlong();
      return;
    }
    if (j.kind === 'guard') {
      this.dest = j.stand;
      const P = m.A.plates[j.plate];
      // glance around, mostly towards the enemy side
      const la = lookAt(eye, [P.pos[0] + Math.sin(j.t * 0.7 + this.slot) * 6, P.pos[1] + 1, P.pos[2] + Math.cos(j.t * 0.5) * 6]);
      if (dist2d(pl.pos, j.stand) < 1.2) this.want = la; else this.lookAlong();
      return;
    }
    this.dest = j.stand;
    const there = dist2d(pl.pos, j.stand) < 0.7 && Math.abs(pl.pos[1] - j.stand[1]) < 0.6;
    if (j.kind === 'shoot') {
      if (!m.A.propById.has(j.prop.id)) { j.done = true; return; }
      if (pl.roll.length >= CAMERA.roll || pl.film[j.neg ? 'neg' : 'pos'] <= 0) { j.done = true; return; }
      if (!there) { this.aimHold = 0; this.lookAlong(); return; }
      this.dest = null;
      this.want = lookAt(eye, j.prop.pos);
      out.aim = true;
      this.aimHold += dt;
      const view = { eye, yaw: this.look.yaw, pitch: this.look.pitch, frame: 0, self: pl.collider };
      if (this.aimHold > 0.3 && Math.abs(angleDiff(this.look.yaw, this.want.yaw)) < 0.03 && Math.abs(this.look.pitch - this.want.pitch) < 0.03) {
        if (aimedProp(m.A, view) === j.prop) {
          out.actions.push({ a: 'shoot', neg: j.neg });
          j.done = true;
          this.thinkT = Math.min(this.thinkT, 0.15);
        } else if (this.aimHold > 2) j.done = true;
      }
      return;
    }
    if (j.kind === 'develop') {
      const ph = pl.roll.find(p => p.id === j.photo);
      if (!ph) { j.done = true; return; }
      if (j.aimProp) { if (!m.A.propById.has(j.aimProp.id)) { j.done = true; return; } j.point = j.aimProp.pos.slice(); }
      if (!there) { this.lookAlong(); return; }
      this.dest = null;
      this.want = lookAt(eye, j.point);
      if (Math.abs(angleDiff(this.look.yaw, this.want.yaw)) > 0.02 || Math.abs(this.look.pitch - this.want.pitch) > 0.02) return;
      const view = { eye, yaw: this.look.yaw, pitch: this.look.pitch, frame: 0, self: pl.collider };
      const pred = solvePlacement(m.A, view, ph, 0, pl.team);
      const P = m.A.plates[j.plate];
      if (ph.neg) {
        if (pred && pred.valid && (!j.aimProp || pred.erase.includes(j.aimProp))) out.actions.push({ a: 'develop', id: ph.id, rot: 0 });
        j.done = true;
        return;
      }
      if (pred && pred.valid && pred.plate && pred.plate.i === P.i && pred.plate.owner === pl.team) {
        out.actions.push({ a: 'develop', id: ph.id, rot: 0 });
        j.done = true;
        this.thinkT = Math.min(this.thinkT, 0.6);
        return;
      }
      // wrong weight or it would slide off: step closer or further and try again
      if (++j.tries > 3 || !pred || !pred.valid) {
        if (pred && pred.valid && pred.plate && pred.plate.i === P.i && pred.plate.load <= (P.max ?? Infinity)) out.actions.push({ a: 'develop', id: ph.id, rot: 0 });
        j.done = true;
        return;
      }
      const want = j.need ? j.need.target : pred.mass;
      const d = clamp(dist(eye, j.point) * Math.cbrt(want / Math.max(0.05, pred.mass)), 2.4, 18);
      const stand = this.standFor(j.point, d, 0.8);
      if (stand) j.stand = stand; else j.done = true;
    }
  }

  // Look where we're going.
  lookAlong() {
    const pl = this.pl;
    const n = this.path && this.path[this.pathI];
    const to = n ? nodePos(n) : this.dest;
    if (!to) return;
    const dx = to[0] - pl.pos[0], dz = to[2] - pl.pos[2];
    if (Math.hypot(dx, dz) > 0.3) this.want = { yaw: Math.atan2(-dx, -dz), pitch: -0.05 };
  }

  turn(dt) {
    const rate = this.d.turn * dt;
    const dy = angleDiff(this.look.yaw, this.want.yaw);
    this.look.yaw += clamp(dy, -rate, rate);
    this.look.pitch += clamp(this.want.pitch - this.look.pitch, -rate * 0.7, rate * 0.7);
    this.look.pitch = clamp(this.look.pitch, -1.45, 1.45);
  }

  // ---------- walking the grid ----------
  walk(dt, out) {
    const pl = this.pl, m = this.m;
    let dir = null;
    if (this.dest) {
      this.pathT -= dt;
      const goalMoved = !this.pathFor || dist(this.pathFor, this.dest) > 1.5;
      if (!this.path || goalMoved || this.pathT <= 0) {
        this.path = m.nav.path(pl.pos, this.dest);
        this.pathI = 0; this.pathFor = this.dest.slice(); this.pathT = 2.5; this.bestD = Infinity; this.stuckT = 0;
        if (this.path && this.path.length > 1) this.pathI = 1;
      }
      if (this.path) {
        let n = this.path[this.pathI];
        while (n && dist2d(pl.pos, [n.x, 0, n.z]) < 0.45 && Math.abs(pl.pos[1] - n.y) < 1.4 && this.pathI < this.path.length - 1) {
          this.pathI++; n = this.path[this.pathI]; this.bestD = Infinity; this.stuckT = 0;
        }
        const final = this.pathI >= this.path.length - 1;
        const to = final ? this.dest : [n.x, n.y, n.z];
        const dx = to[0] - pl.pos[0], dz = to[2] - pl.pos[2], d = Math.hypot(dx, dz);
        if (d > (final ? 0.35 : 0.1)) dir = [dx / d, dz / d];
        // jump up a ledge, or out of a corner we're stuck in
        const prev = this.path[this.pathI - 1];
        const link = prev && m.nav.link(prev, n);
        if (link && link.jump && d < 1.6 && pl.grounded && this.jumpCd <= 0) { out.jump = true; this.jumpCd = 0.5; }
        if (d < this.bestD - 0.25) { this.bestD = d; this.stuckT = 0; }
        else if (dir) {
          this.stuckT += dt;
          if (this.stuckT > 0.8 && pl.grounded && this.jumpCd <= 0) { out.jump = true; this.jumpCd = 0.9; }
          if (this.stuckT > 2.5) { this.path = null; this.stuckT = 0; }
        }
      } else if (this.dest) {
        const dx = this.dest[0] - pl.pos[0], dz = this.dest[2] - pl.pos[2], d = Math.hypot(dx, dz);
        if (d > 0.5) dir = [dx / d, dz / d];
      }
    }
    if (this.fighting) {
      // sidestep while fighting; keep a little distance
      const b = basis(this.look.yaw, 0);
      const side = [b.right[0] * this.strafe, b.right[2] * this.strafe];
      dir = dir ? [dir[0] * 0.6 + side[0] * 0.6, dir[1] * 0.6 + side[1] * 0.6] : side;
      this.fighting = false;
    }
    if (!dir) return;
    // world direction → input relative to where we're looking
    const sy = Math.sin(this.look.yaw), cy = Math.cos(this.look.yaw);
    out.f = clamp(-sy * dir[0] - cy * dir[1], -1, 1);
    out.r = clamp(cy * dir[0] - sy * dir[1], -1, 1);
    // don't walk off the edge of an emulsion bridge that's gone, or into a pit
    const ahead = [pl.pos[0] + dir[0] * 0.7, pl.pos[1] + 0.5, pl.pos[2] + dir[1] * 0.7];
    const floor = m.A.ray(ahead, [0, -1, 0], 8);
    const goingDown = this.path && this.path[this.pathI] && this.path[this.pathI].y < pl.pos[1] - 0.6;
    if (!floor && !goingDown && pl.grounded) { out.f = 0; out.r = 0; this.path = null; }
  }
}

function nodePos(n) { return n ? [n.x, n.y, n.z] : null; }
function onTop(p, P) {
  return p.pos[0] > P.lo[0] - 0.4 && p.pos[0] < P.hi[0] + 0.4 && p.pos[2] > P.lo[2] - 0.4 && p.pos[2] < P.hi[2] + 0.4 && p.pos[1] > P.hi[1] && p.pos[1] < P.hi[1] + 4;
}
