// A walking grid for the bots, built once per match from the map's solid geometry.
//
// Every metre across the arena, a ray straight down finds each surface a player could stand on
// (there can be several: a balcony above a floor). Neighbouring spots link if you can walk, jump or
// drop between them. Emulsion is remembered, not baked in: a spot on an emulsion floor disappears
// while that floor is dissolved, and a link through an emulsion wall appears while the wall is gone.
import { PLAYER } from './config.js';

const CELL = 1;
const CLEAR = 0.32;           // half-width of the space a player needs
const JUMP_UP = 1.2, DROP = 7;

export class NavGrid {
  constructor(A) {
    this.A = A;
    const r = A.def.room;
    this.x0 = r.x0 + CELL / 2; this.z0 = r.z0 + CELL / 2;
    this.nx = Math.floor((r.x1 - r.x0) / CELL); this.nz = Math.floor((r.z1 - r.z0) / CELL);
    this.nodes = [];
    this.cols = new Map();
    this.build(r.h);
  }

  key(ix, iz) { return ix * 10000 + iz; }
  cellOf(x, z) { return [Math.round((x - this.x0) / CELL), Math.round((z - this.z0) / CELL)]; }

  build(h) {
    const A = this.A, R = A.R;
    for (let ix = 0; ix < this.nx; ix++) for (let iz = 0; iz < this.nz; iz++) {
      const x = this.x0 + ix * CELL, z = this.z0 + iz * CELL;
      const tops = [];
      A.world.intersectionsWithRay(new R.Ray({ x, y: h - 0.05, z }, { x: 0, y: -1, z: 0 }), h + 30, true, hit => {
        const info = A.colliders.get(hit.collider.handle);
        if (info && (info.kind === 'static' || info.kind === 'emulsion' || info.kind === 'plate')) tops.push({ y: h - 0.05 - hit.timeOfImpact, info });
        return true;
      });
      const list = [];
      for (const t of tops) {
        // room to stand: nothing solid from the ankles to above the head (emulsion is noted, not a no)
        const blockers = this.blockers(x, t.y + 0.1, z, t.y + PLAYER.height + 0.1);
        if (blockers === null) continue;
        const floor = t.info.kind === 'emulsion' ? t.info.ref : null;
        const n = { i: this.nodes.length, x, y: t.y, z, ix, iz, floor, blockers, links: [] };
        this.nodes.push(n); list.push(n);
      }
      if (list.length) this.cols.set(this.key(ix, iz), list);
    }
    for (const n of this.nodes) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const other = this.cols.get(this.key(n.ix + dx, n.iz + dz));
        if (!other) continue;
        for (const m of other) {
          const dy = m.y - n.y;
          if (dy > JUMP_UP || dy < -DROP) continue;
          const jump = dy > 0.42, drop = dy < -0.6;
          // diagonals need both corners open, so bots don't clip wall ends
          if (dx && dz && (!this.near(n.ix + dx, n.iz, n.y) || !this.near(n.ix, n.iz + dz, n.y))) continue;
          const top = Math.max(n.y, m.y);
          const b = this.blockers((n.x + m.x) / 2, top + 0.15, (n.z + m.z) / 2, top + PLAYER.height, Math.abs(dx) * CELL / 2, Math.abs(dz) * CELL / 2);
          if (b === null) continue;
          n.links.push({ to: m.i, cost: Math.hypot(dx, dz) * CELL + (jump ? 0.8 : 0) + (drop ? 0.5 : 0) + Math.abs(dy) * 0.3, jump, drop, blockers: b });
        }
      }
    }
  }
  // Is there a node in this column near height y?
  near(ix, iz, y) { const c = this.cols.get(this.key(ix, iz)); return !!c && c.some(m => Math.abs(m.y - y) < JUMP_UP); }
  // Solid things in a box: null if anything permanent is there, else the emulsion blocks in the way.
  blockers(x, y0, z, y1, ex = 0, ez = 0) {
    const A = this.A, R = A.R, out = [];
    let solid = false;
    const hy = (y1 - y0) / 2;
    A.world.intersectionsWithShape({ x, y: y0 + hy, z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Cuboid(CLEAR + ex, hy, CLEAR + ez), c => {
      const info = A.colliders.get(c.handle);
      if (!info) return true;
      if (info.kind === 'emulsion') out.push(info.ref);
      else if (info.kind === 'static' || info.kind === 'glass') solid = true;
      return !solid;
    });
    return solid ? null : out;
  }

  ok(n) { return (!n.floor || !n.floor.erased) && n.blockers.every(s => s.erased); }
  linkOk(l) { return l.blockers.every(s => s.erased); }

  // The usable node nearest a position (preferring ones at or just below your feet).
  nearest(pos, maxR = 3) {
    const [cx, cz] = this.cellOf(pos[0], pos[2]);
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const col = this.cols.get(this.key(cx + dx, cz + dz));
        if (!col) continue;
        for (const n of col) {
          if (!this.ok(n)) continue;
          const dy = pos[1] - n.y;
          const d = Math.hypot(n.x - pos[0], n.z - pos[2]) + (dy < -0.5 ? 6 - dy * 2 : Math.abs(dy) * 1.5);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best && r >= 1) break;
    }
    return best;
  }

  // A* from one position to another; returns a list of nodes, or null.
  path(from, to, maxExpand = 6000) {
    const a = this.nearest(from), b = this.nearest(to, 5);
    if (!a || !b) return null;
    if (a === b) return [b];
    const g = new Map([[a.i, 0]]), came = new Map();
    const open = new Heap();
    const hf = n => Math.hypot(n.x - b.x, n.y - b.y, n.z - b.z);
    open.push(a.i, hf(a));
    const closed = new Set();
    let expand = 0;
    while (open.size) {
      const i = open.pop();
      if (i === b.i) {
        const out = [];
        for (let k = i; k !== undefined; k = came.get(k)) out.push(this.nodes[k]);
        return out.reverse();
      }
      if (closed.has(i)) continue;
      closed.add(i);
      if (++expand > maxExpand) break;
      const n = this.nodes[i], gn = g.get(i);
      for (const l of n.links) {
        const m = this.nodes[l.to];
        if (closed.has(m.i) || !this.ok(m) || !this.linkOk(l)) continue;
        const cost = gn + l.cost + (m.floor ? 1.5 : 0);   // bots don't love standing on emulsion
        if (cost < (g.get(m.i) ?? Infinity)) { g.set(m.i, cost); came.set(m.i, i); open.push(m.i, cost + hf(m)); }
      }
    }
    return null;
  }
  link(a, b) { return a.links.find(l => l.to === b.i) || null; }
}

// A small binary heap of (id, priority).
class Heap {
  constructor() { this.ids = []; this.pr = []; }
  get size() { return this.ids.length; }
  push(id, p) {
    const ids = this.ids, pr = this.pr;
    let i = ids.length;
    ids.push(id); pr.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pr[up] <= p) break;
      ids[i] = ids[up]; pr[i] = pr[up]; i = up;
    }
    ids[i] = id; pr[i] = p;
  }
  pop() {
    const ids = this.ids, pr = this.pr, top = ids[0];
    const id = ids.pop(), p = pr.pop();
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mp = p;
        if (l < ids.length && pr[l] < mp) { m = l; mp = pr[l]; }
        if (r < ids.length && pr[r] < mp) { m = r; mp = pr[r]; }
        if (m === i) break;
        ids[i] = ids[m]; pr[i] = pr[m]; i = m;
      }
      ids[i] = id; pr[i] = p;
    }
    return top;
  }
}
