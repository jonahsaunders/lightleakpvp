// A match as the page sees it. The server (or the practice lobby in this page) is in charge; this
// keeps a copy of the arena for walking, the ghost of the photo you're holding and what the camera
// can see, moves you straight away, and shows everyone and everything else a tenth of a second in
// the past so their movement is smooth.
import { G, emit } from './state.js';
import { DT, PLAYER, CAMERA, TEAMS, MODES } from '../shared/config.js';
import { Arena } from '../shared/arena.js';
import { expandMap } from '../shared/mapdef.js';
import { createMover, stepMover } from '../shared/move.js';
import { framedProps, solvePlacement } from '../shared/camera.js';
import { r3 } from '../shared/math.js';
import { buildView, propMesh, disposeProp, stepPlates, UNIT_BOX } from './view.js';
import { Avatar } from './avatar.js';
import { SFX, playAt, startAmbience, stopAmbience } from './audio.js';
import { grow, fadeOut, burst, stepFX, clearFX } from './fx.js';
import { vmShot, vmDevelop } from './viewmodel.js';

const THREE = window.THREE;
const V3 = THREE.Vector3;
const INTERP = 0.1;

// Samples of something moving, by server time; read back at any time between them.
class Track {
  constructor() { this.s = []; }
  push(t, v) { const s = this.s; if (s.length && t <= s[s.length - 1].t) s[s.length - 1] = { t, v }; else s.push({ t, v }); if (s.length > 30) s.shift(); }
  reset(t, v) { this.s = [{ t, v }]; }
  at(t) {
    const s = this.s;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0].v;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= t) {
      const a = s[i], b = s[i + 1];
      if (!b) return a.v;
      return { a: a.v, b: b.v, k: (t - a.t) / (b.t - a.t) };
    }
    return s[s.length - 1].v;
  }
  get last() { return this.s.length ? this.s[this.s.length - 1].v : null; }
}
const lerpArr = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
function slerpArr(a, b, k) {
  const qa = new THREE.Quaternion().fromArray(a), qb = new THREE.Quaternion().fromArray(b);
  return qa.slerp(qb, k).toArray();
}
const angLerp = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };

export class ClientMatch {
  constructor(net, msg, { practice = false, name = '' } = {}) {
    this.net = net; this.practice = practice;
    this.settings = msg.settings; this.mode = MODES[msg.settings.mode];
    this.scoreLimit = msg.scoreLimit;
    this.def = expandMap(msg.map);
    this.mapName = msg.map.name;
    const A = this.A = new Arena(G.R, this.def, { client: true });
    const L = this.L = G.L = { def: this.def, A, group: new THREE.Group(), animate: [], match: this };
    G.scene.add(L.group);
    buildView(L);
    this.youId = msg.you;
    this.players = new Map();
    for (const p of msg.players) {
      const pl = { ...p, track: new Track(), alive: true, flags: 0, exposure: 0, avatar: null, vel: [0, 0, 0], speed: 0 };
      this.players.set(p.id, pl);
    }
    this.me = this.players.get(this.youId);
    this.team = this.me.team;
    for (const pl of this.players.values()) {
      if (pl === this.me) continue;
      pl.avatar = new Avatar(pl.team, pl.name, { mate: pl.team === this.team });
      L.group.add(pl.avatar.group);
      pl.pos = [0, -100, 0];
      A.addPlayerBody(pl);          // a capsule in our copy, so the ghost knows where people stand
    }
    // you
    const me = this.me;
    me.pos = msg.pos.slice(); me.vel = [0, 0, 0]; me.yaw = msg.yaw; me.pitch = 0; me.epoch = msg.epoch;
    A.addPlayerBody(me);
    createMover(A, me);
    me.prev = me.pos.slice();
    this.lookReset = { yaw: msg.yaw, pitch: 0 };
    this.props = new Map();
    for (const d of msg.props) this.addProp(d, false);
    for (const id of msg.erased) this.setErased(id, true, false);
    this.phase = msg.phase; this.phaseT = msg.phaseT; this.clock = msg.clock;
    this.score = msg.score; this.rounds = msg.rounds;
    this.private = { f: 4, n: 2, b: 3, ex: 0, al: 1, rs: 0, fc: 0, w: [], cd: 0, ep: msg.epoch };
    this.offset = null;
    this.tickN = 0;
    this.rid = 0; this.thumbs = new Map(); this.ridToId = new Map(); this.rots = new Map();
    this.feed = []; this.results = null;
    this.deathAt = null; this.killer = null;
    this.lastPhaseBeep = -1;
    G.roll = []; G.selected = -1; G.filmMode = 'pos'; G.frameIdx = 0; G.alive = true;
    A.world.step();
    startAmbience('match');
  }

  // ---------- server time ----------
  serverNow() { return performance.now() / 1000 - (this.offset ?? 0); }
  sync(k) {
    const sample = performance.now() / 1000 - k * DT;
    if (this.offset == null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
  }

  // ---------- messages ----------
  handle(m) {
    if (m.t === 's') this.snapshot(m);
    else if (m.t === 'e') for (const ev of m.l) this.event(ev);
    else if (m.t === 'roll') this.setRoll(m.roll);
    else if (m.t === 'over') { this.results = m; stopAmbience(); const won = m.winner === this.team; if (m.winner >= 0) (won ? SFX.win : SFX.lose)(); emit('over', m); }
  }

  snapshot(m) {
    this.sync(m.k);
    const t = m.k * DT;
    this.phase = m.ph; this.phaseT = m.pt; this.clock = m.c; this.score = m.sc; this.rounds = m.rw;
    for (const [id, x, y, z, yaw, pitch, flags, ex] of m.p) {
      const pl = this.players.get(id);
      if (!pl) continue;
      pl.flags = flags; pl.exposure = ex;
      if (pl === this.me) continue;
      const last = pl.track.last;
      if (last) { pl.vel = [(x - last.pos[0]) * 30, 0, (z - last.pos[2]) * 30]; }
      pl.track.push(t, { pos: [x, y, z], yaw, pitch });
      const alive = !!(flags & 1);
      if (alive && !pl.alive) { pl.avatar.revive(); pl.track.reset(t, { pos: [x, y, z], yaw, pitch }); }
      pl.alive = alive;
    }
    for (const [id, x, y, z, qx, qy, qz, qw] of m.o) {
      const p = this.props.get(id);
      if (!p) continue;
      p.track.push(t, { pos: [x, y, z], q: [qx, qy, qz, qw] });
      this.A.setPropPose(p.prop, [x, y, z], [qx, qy, qz, qw]);
    }
    m.pl.forEach(([load, m0, m1, owner, on], i) => { const P = this.A.plates[i]; Object.assign(P, { load, mass: [m0, m1], owner, on: !!on }); });
    if (m.me) {
      const was = this.private;
      this.private = m.me;
      if (m.me.fc && m.me.fc[1] >= 1 && !(was.fc && was.fc[1] >= 1)) SFX.lock();
      if (m.me.w.length && !was.w.length) SFX.warn();
      if (!m.me.al && G.alive) G.alive = false;
    }
  }

  event(ev) {
    const me = this.me, A = this.A;
    const at = ev.at;
    const heard = fn => { if (at) playAt(at, this.earPos(), me.yaw, fn); else fn(); };
    switch (ev.e) {
      case 'prop+': {
        const p = this.addProp(ev.p, ev.fx === 'develop');
        if (ev.fx === 'respawn') burst(p.mesh.position, p.prop.size, { color: 0xffe2c0, count: 40, up: 0.4, spread: 0.3 });
        break;
      }
      case 'prop-': this.removeProp(ev.id, ev.fx !== 'fall'); break;
      case 'erase': this.setErased(ev.id, true, true); break;
      case 'regrow': this.setErased(ev.id, false, true); break;
      case 'develop': if (ev.by !== me.id) heard(() => SFX.develop()); else SFX.develop(); break;
      case 'dissolve': if (ev.by !== me.id) heard(() => SFX.erase()); else SFX.erase(); break;
      case 'photo': if (ev.by !== me.id) { heard(() => SFX.shutter()); this.avatarOf(ev.by)?.fire(); } break;
      case 'flash': {
        const shooter = this.avatarOf(ev.by);
        if (shooter) shooter.fire();
        if (ev.by !== me.id) heard(() => SFX.bulb());
        if (ev.to === me.id && !ev.safe) { emit('exposed', this.players.get(ev.by)); SFX.exposed(); }
        if (ev.by === me.id && !ev.safe) SFX.confirm();
        if (ev.safe && ev.by === me.id) emit('toast', 'They just developed: flashes pass straight through for a moment.');
        break;
      }
      case 'hit': {
        if (ev.to === me.id && ev.how === 'crush') { SFX.land(2); emit('shake', 0.5); emit('exposed', this.players.get(ev.by)); }
        const av = this.avatarOf(ev.to); if (av) av.hit();
        break;
      }
      case 'elim': {
        const who = this.players.get(ev.to), by = ev.by && this.players.get(ev.by);
        this.feed.push({ who, by, how: ev.how, t: performance.now() });
        if (this.feed.length > 6) this.feed.shift();
        const av = this.avatarOf(ev.to);
        if (av) { av.die(); heard(() => SFX.ruined()); }
        if (ev.to === me.id) {
          G.alive = false; this.deathAt = { pos: me.pos.slice(), yaw: me.yaw, pitch: me.pitch, t: performance.now() }; this.killer = by || null; this.deathHow = ev.how;
          SFX.ruined(); G.roll = []; G.selected = -1; emit('rollChanged');
        } else if (ev.by === me.id) { SFX.knocked(); emit('toast', `You ruined ${who.name}'s print.`); }
        break;
      }
      case 'spawn': {
        const pl = this.players.get(ev.id);
        if (!pl) break;
        if (pl === me) {
          me.pos = ev.pos.slice(); me.prev = me.pos.slice(); me.vel = [0, 0, 0]; me.epoch = ev.ep;
          A.placeBody(me, true);
          if (!ev.correction) { this.lookReset = { yaw: ev.yaw, pitch: 0 }; G.alive = true; this.deathAt = null; if (this.phase === 'live') SFX.respawn(); }
        } else { pl.track.reset(this.serverNow(), { pos: ev.pos, yaw: ev.yaw, pitch: 0 }); pl.alive = true; pl.avatar.revive(); }
        break;
      }
      case 'plate': {
        const P = A.plates[ev.i];
        if (ev.owner === this.team) { SFX.plateOurs(); emit('toast', `Plate ${P.name} is yours.`); }
        else if (ev.was === this.team) { SFX.plateTheirs(); emit('toast', ev.owner >= 0 ? `${TEAMS[ev.owner].name} took plate ${P.name}.` : `You lost plate ${P.name}.`); }
        break;
      }
      case 'phase': {
        this.phase = ev.ph; this.phaseT = ev.t;
        if (ev.ph === 'live') SFX.beep(true);
        if (ev.ph === 'roundover') { const won = ev.winner === this.team; emit('banner', ev.winner < 0 ? 'Round drawn' : won ? 'Round won' : 'Round lost', ev.winner < 0 ? null : TEAMS[ev.winner].color); (ev.winner < 0 ? SFX.plate : won ? SFX.plateOurs : SFX.plateTheirs)(); }
        if (ev.ph === 'countdown' && ev.round > 0) emit('banner', `Round ${ev.round + 1}`, null);
        break;
      }
      case 'reset':
        for (const id of [...this.props.keys()]) this.removeProp(id, false);
        for (const s of A.statics) if (s.erased) this.setErased(s.id, false, false);
        for (const d of ev.props) this.addProp(d, false);
        clearFX();
        break;
      case 'took': this.ridToId.set(ev.rid, ev.id); this.attachThumb(ev.rid); break;
      case 'developed': break;
      case 'deny': SFX.deny(); emit('toast', ev.text); if (ev.rid) this.thumbs.delete(ev.rid); break;
      case 'left': emit('toast', `${ev.name.replace(/ \(bot\)$/, '')} left; a bot took over.`); break;
    }
  }

  avatarOf(id) { const p = this.players.get(id); return p && p.avatar; }
  earPos() { return G.camera.position.toArray(); }

  addProp(d, fresh) {
    const [id, type, size, pos, quat, team, owner] = d;
    if (this.props.has(id)) this.removeProp(id, false);
    const prop = this.A.addProp({ id, type, size, pos, quat, team, owner });
    const mesh = propMesh(type, size, team);
    mesh.position.fromArray(pos); mesh.quaternion.fromArray(quat);
    mesh.userData.prop = prop;
    this.L.group.add(mesh);
    const p = { prop, mesh, track: new Track(), flash: fresh ? 1 : 0 };
    p.track.reset(this.serverNow(), { pos, q: quat });
    this.props.set(id, p);
    if (fresh) grow({ mesh, size });
    return p;
  }
  removeProp(id, fx) {
    const p = this.props.get(id);
    if (!p) return;
    if (fx) fadeOut(p.mesh);
    this.L.group.remove(p.mesh);
    disposeProp(p.mesh);
    this.A.removeProp(p.prop);
    this.props.delete(id);
  }
  setErased(id, erased, fx) {
    const s = this.A.statics[id], mesh = this.L.staticMesh.get(id);
    if (!s) return;
    if (erased) { if (fx && mesh) fadeOut(mesh); this.A.eraseStatic(s); if (mesh) mesh.visible = false; }
    else {
      this.A.restoreStatic(s);
      if (mesh) { mesh.visible = true; if (fx) burst(mesh.position, [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]], { color: 0xff5a3a, count: 60, up: 0.3, spread: 0.2 }); }
    }
  }

  // ---------- your photos ----------
  setRoll(list) {
    const selId = G.roll[G.selected]?.id;
    G.roll = list.map(p => ({ ...p, rot: this.rots.get(p.id) || 0, img: this.thumbFor(p.id), born: this.bornOf(p.id) }));
    G.selected = G.roll.findIndex(p => p.id === selId);
    emit('rollChanged');
  }
  bornOf(id) { this.born = this.born || new Map(); if (!this.born.has(id)) this.born.set(id, performance.now()); return this.born.get(id); }
  thumbFor(id) { for (const [rid, pid] of this.ridToId) if (pid === id && this.thumbs.has(rid)) return this.thumbs.get(rid); return ''; }
  attachThumb(rid) {
    const id = this.ridToId.get(rid), img = this.thumbs.get(rid);
    if (id == null || !img) return;
    const p = G.roll.find(x => x.id === id);
    if (p && !p.img) { p.img = img; emit('rollChanged'); }
  }
  thumbTaken(rid, img) { this.thumbs.set(rid, img); this.attachThumb(rid); }

  // ---------- the camera, as this page sees it ----------
  view() {
    const e = G.camera.position;
    return { eye: [e.x, e.y, e.z], yaw: this.me.yaw, pitch: this.me.pitch, frame: G.frameIdx, self: this.me.collider };
  }
  framed() { return framedProps(this.A, this.view()); }
  placement(photo) { return solvePlacement(this.A, this.view(), photo, photo.rot || 0, this.team); }
  locked() { const f = this.private.fc; return f && f[1] >= 1 ? this.players.get(f[0]) : null; }

  // ---------- the fixed tick: you move, and tell the server ----------
  tick(input) {
    const me = this.me, A = this.A;
    this.tickN++;
    if (this.lookReset) { input.setLook(this.lookReset.yaw, this.lookReset.pitch); this.lookReset = null; }
    me.yaw = input.yaw; me.pitch = input.pitch;
    const now = this.serverNow() - INTERP;
    // other players' capsules where we're drawing them
    for (const pl of this.players.values()) {
      if (pl === me) continue;
      const s = this.sampleOf(pl, now);
      if (s) { pl.pos = pl.alive ? s.pos : [0, -100, 0]; A.placeBody(pl, true); }
    }
    const frozen = this.phase === 'countdown' || this.phase === 'roundover' || this.phase === 'over' || input.frozen;
    if (G.alive && this.private.al) stepMover(A, me, input, frozen);
    else me.prev = me.pos.slice();
    A.world.step();
    if (this.tickN % 2 === 0) {
      this.net.send({ t: 'in', ep: me.epoch, pos: me.pos.map(r3), vel: me.vel.map(r3), yaw: r3(me.yaw), pitch: r3(me.pitch), aim: !!G.aim, fr: G.frameIdx, g: me.grounded ? 1 : 0 });
    }
  }
  sampleOf(pl, t) {
    const s = pl.track.at(t);
    if (!s) return null;
    if (!s.a) return s;
    return { pos: lerpArr(s.a.pos, s.b.pos, s.k), yaw: angLerp(s.a.yaw, s.b.yaw, s.k), pitch: s.a.pitch + (s.b.pitch - s.a.pitch) * s.k };
  }

  // ---------- actions ----------
  act(a) {
    const me = this.me;
    const base = { t: 'a', ep: me.epoch, pos: me.pos.map(r3), yaw: r3(me.yaw), pitch: r3(me.pitch), fr: G.frameIdx, rid: ++this.rid };
    if (a === 'shoot') {
      const target = this.locked();
      if (target) {
        if (this.private.b < 1) { SFX.deny(); emit('toast', 'Out of flash bulbs. One comes back every few seconds.'); return; }
        if (this.private.cd > 0) return;
        SFX.bulb(); emit('flash'); vmShot();
        this.net.send({ ...base, a: 'shoot' });
        return;
      }
      if (!this.framed().length) { SFX.deny(); emit('toast', 'Nothing to photograph there.'); return; }
      const neg = G.filmMode === 'neg';
      if ((neg ? this.private.n : this.private.f) < 1) { SFX.deny(); emit('toast', neg ? 'Out of negative film. It comes back on its own.' : 'Out of film. It comes back on its own.'); return; }
      if (G.roll.length >= CAMERA.roll) { SFX.deny(); emit('toast', 'Your hands are full. Develop one, or throw one away (X).'); return; }
      SFX.shutter(); SFX.lever(); SFX.eject(); emit('flash'); vmShot();
      G.pendingThumb = { rid: base.rid, neg };
      this.net.send({ ...base, a: 'shoot', neg });
    } else if (a === 'develop') {
      const photo = G.roll[G.selected];
      if (!photo) return;
      const pl = this.placement(photo);
      if (!pl) { SFX.deny(); emit('toast', 'Aim at something to develop onto.'); return; }
      if (!pl.valid) { SFX.deny(); emit('toast', photo.neg ? 'Nothing there for the negative to dissolve.' : pl.reason === 'TOO CLOSE' ? "Someone's standing there." : "It won't fit there."); return; }
      vmDevelop();
      this.net.send({ ...base, a: 'develop', id: photo.id, rot: photo.rot || 0 });
    } else if (a === 'discard') {
      const photo = G.roll[G.selected];
      if (!photo) return;
      this.net.send({ ...base, a: 'discard', id: photo.id });
      emit('toast', 'Photo thrown away.');
    }
  }
  rotate(n) {
    const photo = G.roll[G.selected];
    if (!photo) return;
    photo.rot = ((photo.rot || 0) + n + 4) % 4;
    this.rots.set(photo.id, photo.rot);
    SFX.click(); emit('rollChanged');
  }

  // ---------- every rendered frame ----------
  frame(dt, alpha) {
    const now = this.serverNow() - INTERP;
    for (const pl of this.players.values()) {
      if (pl === this.me || !pl.avatar) continue;
      const s = this.sampleOf(pl, now);
      if (!s) continue;
      const tagVisible = pl.alive && (pl.team === this.team || this.lookingAt(pl));
      // their lens glows while they're pulling focus on you
      const watchingMe = this.private.w.find(w => w[0] === pl.id);
      pl.speed = Math.hypot(pl.vel[0], pl.vel[2]);
      pl.avatar.update(dt, { pos: s.pos, yaw: s.yaw, pitch: s.pitch, aim: !!(pl.flags & 2), speed: pl.speed, exposure: pl.exposure, safe: !!(pl.flags & 16), focus: watchingMe ? watchingMe[1] : 0, tagVisible });
    }
    for (const p of this.props.values()) {
      const s = p.track.at(now);
      if (s) {
        if (s.a) { p.mesh.position.fromArray(lerpArr(s.a.pos, s.b.pos, s.k)); p.mesh.quaternion.fromArray(slerpArr(s.a.q, s.b.q, s.k)); }
        else { p.mesh.position.fromArray(s.pos); p.mesh.quaternion.fromArray(s.q); }
      }
      if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 2.5); p.mesh.material.emissive.copy(p.mesh.userData.teamEmissive).add(new THREE.Color(p.flash, p.flash * 0.9, p.flash * 0.8)); }
    }
    stepPlates(this.L, dt);
    for (const f of this.L.animate) f(dt);
    stepFX(dt);
    // countdown beeps
    if (this.phase === 'countdown') { const n = Math.ceil(this.phaseT - 0.01); if (n !== this.lastPhaseBeep && n <= 3 && n > 0) { this.lastPhaseBeep = n; SFX.beep(false); } }
    else this.lastPhaseBeep = -1;
  }
  lookingAt(pl) {
    const cam = G.camera, s = pl.avatar.group.position;
    const v = new V3(s.x, s.y + 1.2, s.z).project(cam);
    return v.z < 1 && Math.abs(v.x) < 0.12 && Math.abs(v.y) < 0.2 && cam.position.distanceTo(s) < 30;
  }

  // Where the camera goes: your eyes, or, once your print is ruined, a slow look back at who did it.
  placeCamera(camera, alpha) {
    const me = this.me;
    if (!G.alive && this.deathAt) {
      const d = this.deathAt, k = Math.min(1, (performance.now() - d.t) / 1500);
      camera.position.set(d.pos[0], d.pos[1] + PLAYER.eye + k * 1.6, d.pos[2]);
      const kp = this.killer && this.killer !== me && this.killer.avatar ? this.killer.avatar.group.position : null;
      if (kp) {
        const look = new THREE.Matrix4().lookAt(camera.position, new V3(kp.x, kp.y + 1.2, kp.z), new V3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(look);
        camera.quaternion.slerp(q, 0.06);
      } else camera.rotation.set(d.pitch - k * 0.5, d.yaw, 0);
      return;
    }
    const p = lerpArr(me.prev, me.pos, alpha);
    camera.position.set(p[0], p[1] + PLAYER.eye, p[2]);
    camera.rotation.set(me.pitch, me.yaw, 0);
  }

  destroy() {
    stopAmbience();
    clearFX();
    for (const pl of this.players.values()) if (pl.avatar) pl.avatar.dispose();
    const L = this.L;
    G.scene.remove(L.group);
    L.group.traverse(o => {
      if (o.geometry && o.geometry !== UNIT_BOX && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.userData.ownMaterial) { if (o.material.map && o.userData.ownMap) o.material.map.dispose(); o.material.dispose(); }
    });
    this.A.free();
    G.L = null; G.roll = []; G.selected = -1; G.alive = false;
  }
}
