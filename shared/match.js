// One match: the authoritative simulation. It runs on the server for online games and in the page
// for practice; either way it talks only through `out(playerId | null, message)` (null = everyone).
//
// Movement is reported by each player's own browser (it feels instant) and checked here against the
// same character controller: a move through a wall or faster than running gets corrected. Everything
// else (photos, developing, dissolving, flashes, plates, damage) is decided here.
//
//   Phases   countdown → live → (lastlight: roundover → countdown → live …) → over
//   Plates   a plate in range belongs to the team with more of its own developed weight on it;
//            each held plate scores a point a second
//   Damage   a flash (hold someone in the focus box until it locks, then click) is one mark; a falling
//            object hurts by momentum; three marks and your print is ruined. Falling out is instant.
import { DT, SNAP_EVERY, PLAYER, CAMERA, FILM, FLASH, EXPOSURE, CRUSH, RESPAWN, SPAWN_SAFE, PROP_CAP, EMULSION_REGROW, PROP_RESPAWN, MODES, DIFFICULTY } from './config.js';
import { Arena } from './arena.js';
import { expandMap } from './mapdef.js';
import { createMover, stepMover, tryMove } from './move.js';
import { framedProps, makePhoto, solvePlacement, flashTarget } from './camera.js';
import { qAxis, dist, dist2d, r3, rng, sub } from './math.js';
import { NavGrid } from './nav.js';
import { Brain } from './bots.js';

const D2R = Math.PI / 180;

export class Match {
  // settings: { mode, size, difficulty, seed, scoreLimit, timeLimit }
  constructor(R, mapSrc, settings, out) {
    this.R = R;
    this.mapSrc = mapSrc;
    this.def = expandMap(mapSrc);
    this.settings = { mode: 'plates', size: 2, difficulty: 'normal', seed: 1, ...settings };
    this.mode = MODES[this.settings.mode];
    this.out = out || (() => {});
    this.rand = rng(this.settings.seed);
    this.A = new Arena(R, this.def);
    this.nav = new NavGrid(this.A);
    this.players = [];
    this.byId = new Map();
    this.tick = 0; this.time = 0;
    this.phase = 'lobby'; this.phaseT = 0;
    this.clock = 0;
    this.score = [0, 0]; this.scoreAcc = [0, 0];
    this.rounds = [0, 0]; this.round = 0;
    this.scoreLimit = this.settings.scoreLimit || this.def.score || 150;
    this.propSeq = 0;
    this.respawnQueue = [];
    this.events = []; this.priv = new Map();
    this.winner = null;
    this.feed = [];
    this.spawnMapProps();
  }

  // ---------- setup ----------
  spawnMapProps() {
    for (const p of this.def.props) {
      const q = qAxis([0, 1, 0], (p.rot || 0) * D2R);
      const home = { type: p.type, size: p.size, pos: [p.pos[0], p.pos[1] + p.size[1] / 2, p.pos[2]], quat: q };
      this.A.addProp({ id: ++this.propSeq, ...home, team: -1, home });
    }
    this.A.world.step();
    for (const p of this.A.props) this.A.syncProp(p);
  }

  addPlayer({ id, name, team, bot = false }) {
    const pl = {
      id, name, team, bot: null, human: !bot, connected: !bot,
      pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, aim: false, frame: 0, grounded: false,
      epoch: 0, alive: false, exposure: 0, lastHit: -99, lastFade: 0, lastAttacker: null, respawnAt: 0, safeUntil: 0,
      film: { pos: FILM.pos.max, neg: FILM.neg.max }, filmT: { pos: 0, neg: 0 }, bulbs: FLASH.bulbs, bulbT: 0, flashCd: 0,
      roll: [], photoSeq: 0, developed: [], focus: null, watchers: [],
      actions: [], lastInput: 0, stats: { portraits: 0, elims: 0, crushes: 0, deaths: 0, tonnes: 0, plates: 0 },
    };
    this.A.addPlayerBody(pl);
    createMover(this.A, pl);
    pl.collider.setEnabled(false);
    if (bot) pl.bot = new Brain(this, pl, DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal);
    this.players.push(pl);
    this.byId.set(id, pl);
    return pl;
  }

  // A player who left is taken over by a bot, so the teams stay even.
  leave(id) {
    const pl = this.byId.get(id);
    if (!pl || !pl.human) return;
    pl.human = false; pl.connected = false;
    pl.name = `${pl.name} (bot)`;
    pl.bot = new Brain(this, pl, DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal);
    this.event({ e: 'left', id, name: pl.name });
  }

  start() {
    for (const pl of this.players) this.respawn(pl, true);
    this.setPhase('countdown', 4);
    this.clock = this.settings.timeLimit || this.mode.time;
    for (const pl of this.players) if (pl.human) this.out(pl.id, this.startMessage(pl));
  }
  startMessage(pl) {
    return {
      t: 'start', you: pl.id, epoch: pl.epoch, map: this.mapSrc, settings: this.settings, scoreLimit: this.scoreLimit,
      players: this.players.map(p => ({ id: p.id, name: p.name, team: p.team, bot: !p.human })),
      props: this.A.props.map(propData),
      erased: this.A.statics.filter(s => s.erased).map(s => s.id),
      phase: this.phase, phaseT: this.phaseT, clock: this.clock, score: this.score, rounds: this.rounds,
      pos: pl.pos, yaw: pl.yaw,
    };
  }

  // ---------- messages from players ----------
  // Where a player says they are (their browser moves them). Checked against the controller.
  input(id, m) {
    const pl = this.byId.get(id);
    if (!pl || !pl.human || m.ep !== pl.epoch) return;
    pl.yaw = +m.yaw || 0; pl.pitch = Math.max(-1.5, Math.min(1.5, +m.pitch || 0));
    pl.aim = !!m.aim; pl.frame = Math.max(0, Math.min(CAMERA.frames.length - 1, m.fr | 0));
    pl.lastInput = this.time;
    if (!pl.alive || this.phase === 'over' || !Array.isArray(m.pos)) return;
    const want = sub(m.pos.map(Number), pl.pos);
    if (want.some(v => !isFinite(v))) return;
    const since = Math.max(DT, Math.min(0.25, this.time - (pl.lastMove || 0)));
    pl.lastMove = this.time;
    const frozen = this.phase === 'countdown' || this.phase === 'roundover';
    const reach = frozen ? 0.05 : PLAYER.speed * since * 1.6 + 0.3;
    const horiz = Math.hypot(want[0], want[2]);
    let bad = horiz > reach || want[1] > 2.2;
    if (!bad) {
      const { m: got } = tryMove(this.A, pl, want);
      if (dist(got, want) > 0.45) bad = true;
    }
    if (bad) { this.correct(pl); return; }
    pl.pos = m.pos.map(Number);
    pl.vel = Array.isArray(m.vel) ? m.vel.map(Number) : [0, 0, 0];
    pl.grounded = !!m.g;
    this.A.placeBody(pl);
  }
  correct(pl) {
    pl.epoch++;
    pl.vel = [0, 0, 0];
    this.A.placeBody(pl, true);
    this.privateEvent(pl.id, { e: 'spawn', id: pl.id, pos: pl.pos.map(r3), yaw: pl.yaw, ep: pl.epoch, correction: true });
  }
  action(id, m) {
    const pl = this.byId.get(id);
    if (!pl || !pl.human) return;
    if (m.ep !== pl.epoch) return;
    // the camera pose when they clicked, if it's close to where we think they are
    if (Array.isArray(m.pos) && dist(m.pos, pl.pos) < 1.2) m.eyeFrom = m.pos.map(Number);
    pl.actions.push(m);
  }

  // ---------- the tick ----------
  step() {
    this.tick++; this.time += DT;
    this.phaseT -= DT;
    this.stepPhase();
    const live = this.phase === 'live';
    for (const pl of this.players) {
      if (pl.bot && pl.alive) {
        const input = pl.bot.update(DT);
        pl.yaw = input.yaw; pl.pitch = input.pitch; pl.aim = !!input.aim; pl.frame = input.frame || 0;
        stepMover(this.A, pl, input, !live);
        for (const a of input.actions) pl.actions.push(a);
      }
      const acts = pl.actions.splice(0);
      if (live && pl.alive) for (const a of acts) this.handle(pl, a);
    }
    this.A.world.step();
    this.stepProps();
    this.stepPlates(live);
    this.stepStatics();
    for (const pl of this.players) this.stepPlayer(pl, live);
    this.stepMode(live);
    if (this.tick % SNAP_EVERY === 0) this.snapshot();
    this.flush();
  }

  setPhase(ph, t) {
    this.phase = ph; this.phaseT = t;
    this.event({ e: 'phase', ph, t, round: this.round, rounds: this.rounds, winner: this.winner });
  }
  stepPhase() {
    if (this.phase === 'countdown' && this.phaseT <= 0) this.setPhase('live', 0);
    else if (this.phase === 'roundover' && this.phaseT <= 0) this.resetRound();
  }

  // ---------- actions ----------
  viewOf(pl, m = {}) {
    const p = m.eyeFrom || pl.pos;
    return { eye: [p[0], p[1] + PLAYER.eye, p[2]], yaw: m.yaw ?? pl.yaw, pitch: m.pitch ?? pl.pitch, frame: m.fr ?? pl.frame, self: pl.collider };
  }
  handle(pl, m) {
    if (m.a === 'shoot') this.shoot(pl, m);
    else if (m.a === 'develop') this.develop(pl, m);
    else if (m.a === 'discard') {
      const i = pl.roll.findIndex(p => p.id === m.id);
      if (i >= 0) { pl.roll.splice(i, 1); this.sendRoll(pl); }
    }
  }
  deny(pl, text, rid) { this.privateEvent(pl.id, { e: 'deny', text, rid }); }

  // Click with the camera up: a flash if someone's locked in the focus box, otherwise a photo.
  shoot(pl, m) {
    if (typeof m.yaw === 'number') { pl.yaw = m.yaw; pl.pitch = m.pitch; }
    const view = this.viewOf(pl, m);
    const f = pl.focus;
    if (f && f.t >= FLASH.focus) {
      if (pl.flashCd > 0) return;
      if (pl.bulbs < 1) { this.deny(pl, 'Out of flash bulbs.', m.rid); return; }
      const target = this.byId.get(f.id);
      if (!target || !target.alive) return;
      pl.bulbs--; pl.flashCd = FLASH.cooldown;
      f.t = FLASH.focus * (1 - FLASH.refocus);
      const safe = target.safeUntil > this.time;
      this.event({ e: 'flash', by: pl.id, to: target.id, at: view.eye.map(r3), safe });
      if (!safe) { pl.stats.portraits++; this.hurt(target, 1, pl, 'flash'); }
      return;
    }
    const neg = !!m.neg;
    const group = framedProps(this.A, view);
    if (!group.length) { this.deny(pl, 'Nothing to photograph there.', m.rid); return; }
    const kind = neg ? 'neg' : 'pos';
    if (pl.film[kind] <= 0) { this.deny(pl, neg ? 'Out of negative film. It comes back in a few seconds.' : 'Out of film. It comes back in a few seconds.', m.rid); return; }
    if (pl.roll.length >= CAMERA.roll) { this.deny(pl, 'Your hands are full. Develop or throw away (X) a photo first.', m.rid); return; }
    if (pl.film[kind] === FILM[kind].max) pl.filmT[kind] = 0;
    pl.film[kind]--;
    const photo = { id: ++pl.photoSeq, ...makePhoto(view, group, neg) };
    pl.roll.push(photo);
    this.privateEvent(pl.id, { e: 'took', rid: m.rid, id: photo.id });
    this.event({ e: 'photo', by: pl.id, at: view.eye.map(r3), neg });
    this.sendRoll(pl);
  }

  develop(pl, m) {
    const i = pl.roll.findIndex(p => p.id === m.id);
    const photo = pl.roll[i];
    if (!photo) return;
    if (typeof m.yaw === 'number') { pl.yaw = m.yaw; pl.pitch = m.pitch; }
    const view = this.viewOf(pl, m);
    const pl2 = solvePlacement(this.A, view, photo, (m.rot | 0) & 3, pl.team);
    if (!pl2) { this.deny(pl, 'Aim at something to develop onto.', m.rid); return; }
    if (!pl2.valid) { this.deny(pl, photo.neg ? 'Nothing there for the negative to dissolve.' : pl2.reason === 'TOO CLOSE' ? "Someone's standing there." : "It won't fit there.", m.rid); return; }
    pl.roll.splice(i, 1);
    if (photo.neg) {
      for (const r of pl2.erase) {
        if (r.body) {
          const h = Math.max(...r.size) / 2;
          this.creditFloor([r.pos[0] - h, r.pos[1] - h, r.pos[2] - h], [r.pos[0] + h, r.pos[1] + h, r.pos[2] + h], pl);
          this.removeProp(r, 'dissolve');
        } else {
          this.creditFloor(r.min, r.max, pl);
          this.A.eraseStatic(r); r.regrowAt = this.time + EMULSION_REGROW; this.event({ e: 'erase', id: r.id });
        }
      }
      this.event({ e: 'dissolve', by: pl.id, at: pl2.center.map(r3) });
    } else {
      for (const pose of pl2.poses) {
        const p = this.A.addProp({ id: ++this.propSeq, type: pose.type, size: pose.size, pos: pose.pos, quat: pose.q, team: pl.team, owner: pl.id });
        p.born = this.time;
        pl.developed.push(p.id);
        this.event({ e: 'prop+', p: propData(p), fx: 'develop' });
      }
      pl.stats.tonnes += pl2.mass;
      this.event({ e: 'develop', by: pl.id, at: pl2.center.map(r3) });
      // everyone gets a few things; developing more dissolves your oldest
      while (pl.developed.length > PROP_CAP) {
        const old = this.A.propById.get(pl.developed.shift());
        if (old) this.removeProp(old, 'cap');
      }
    }
    this.privateEvent(pl.id, { e: 'developed', rid: m.rid, id: photo.id });
    this.sendRoll(pl);
  }
  // Dissolving the floor under someone counts as pushing them, if they fall.
  creditFloor(min, max, by) {
    for (const o of this.players) {
      if (!o.alive || o.team === by.team) continue;
      if (o.pos[0] > min[0] - 0.4 && o.pos[0] < max[0] + 0.4 && o.pos[2] > min[2] - 0.4 && o.pos[2] < max[2] + 0.4 && Math.abs(o.pos[1] - max[1]) < 0.6) {
        o.lastAttacker = { id: by.id, time: this.time, how: 'floor' };
      }
    }
  }

  removeProp(p, fx) {
    this.A.removeProp(p);
    this.event({ e: 'prop-', id: p.id, fx });
    if (p.owner != null) { const o = this.byId.get(p.owner); if (o) { const i = o.developed.indexOf(p.id); if (i >= 0) o.developed.splice(i, 1); } }
    if (p.home) this.respawnQueue.push({ home: p.home, at: this.time + PROP_RESPAWN });
  }

  // ---------- damage ----------
  hurt(target, marks, by, how) {
    if (!target.alive || target.safeUntil > this.time || this.phase !== 'live') return;
    target.exposure = Math.min(EXPOSURE.marks, target.exposure + marks);
    target.lastHit = this.time;
    if (by) target.lastAttacker = { id: by.id, time: this.time, how };
    this.event({ e: 'hit', to: target.id, by: by ? by.id : null, how, marks, ex: target.exposure });
    if (target.exposure >= EXPOSURE.marks) this.eliminate(target, by, how);
  }
  eliminate(pl, by, how) {
    if (!pl.alive) return;
    pl.alive = false;
    pl.collider.setEnabled(false);
    pl.exposure = 0; pl.focus = null; pl.aim = false;
    pl.roll.length = 0;
    pl.stats.deaths++;
    if (by && by !== pl && by.team !== pl.team) { by.stats.elims++; if (how === 'crush') by.stats.crushes++; }
    pl.respawnAt = this.mode.respawn ? this.time + RESPAWN : Infinity;
    this.event({ e: 'elim', to: pl.id, by: by ? by.id : null, how, at: pl.pos.map(r3) });
    this.sendRoll(pl);
  }
  respawn(pl, quiet = false) {
    const spots = this.def.spawns[pl.team];
    const enemies = this.players.filter(o => o.alive && o.team !== pl.team);
    const mates = this.players.filter(o => o !== pl && o.alive && o.team === pl.team);
    let best = spots[0], bestScore = -Infinity;
    for (const s of spots) {
      const near = enemies.length ? Math.min(...enemies.map(e => dist2d(e.pos, s.pos))) : 50;
      const crowd = mates.filter(o => dist2d(o.pos, s.pos) < 1.2).length;
      const sc = Math.min(near, 30) - crowd * 20 + this.rand() * 3;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    pl.pos = best.pos.slice(); pl.vel = [0, 0, 0];
    pl.yaw = best.yaw * D2R; pl.pitch = 0;
    pl.alive = true; pl.exposure = 0; pl.lastAttacker = null;
    pl.film = { pos: FILM.pos.max, neg: FILM.neg.max }; pl.bulbs = FLASH.bulbs;
    pl.safeUntil = this.time + (quiet ? 0 : SPAWN_SAFE);
    pl.epoch++;
    pl.collider.setEnabled(true);
    this.A.placeBody(pl, true);
    if (pl.bot) pl.bot.reset();
    this.event({ e: 'spawn', id: pl.id, pos: pl.pos.map(r3), yaw: pl.yaw, ep: pl.epoch });
    this.sendRoll(pl);
  }

  // ---------- world ----------
  stepProps() {
    const A = this.A;
    for (const p of A.props.slice()) {
      A.syncProp(p);
      const v = p.body.linvel();
      p.peak = Math.max(-v.y, p.peak * 0.8);
      if (p.pos[1] < A.killY - 6) { this.removeProp(p, 'fall'); continue; }
      if (p.peak < CRUSH.speed || this.phase !== 'live') continue;
      A.world.contactPairsWith(p.collider, c => {
        const info = A.colliders.get(c.handle);
        if (!info || info.kind !== 'player' || !A.touching(p.collider, c)) return;
        const pl = info.ref;
        if (!pl.alive || (p.team >= 0 && p.team === pl.team)) return;
        if (pl.pos[1] + PLAYER.height * 0.5 > p.pos[1]) return;   // only from above
        if ((p.hurt.get(pl.id) || -9) > this.time - 1) return;
        const impulse = p.mass * p.peak;
        const marks = impulse >= CRUSH.impulse[2] ? 3 : impulse >= CRUSH.impulse[1] ? 2 : impulse >= CRUSH.impulse[0] ? 1 : 0;
        if (!marks) return;
        p.hurt.set(pl.id, this.time);
        const by = p.owner != null ? this.byId.get(p.owner) : null;
        this.hurt(pl, marks, by, 'crush');
      });
    }
    // the map's own crates and blocks come back after a while, if there's room
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (this.time < r.at) continue;
      if (A.overlaps({ size: r.home.size, pos: r.home.pos, q: r.home.quat }, 0.001).length) { r.at = this.time + 2; continue; }
      this.respawnQueue.splice(i, 1);
      const p = A.addProp({ id: ++this.propSeq, ...r.home, team: -1, home: r.home });
      this.event({ e: 'prop+', p: propData(p), fx: 'respawn' });
    }
  }
  stepPlates(live) {
    for (const p of this.A.plates) {
      const { load, mass } = this.A.plateLoad(p);
      const { ok, owner } = Arena.ownerOf(p, load, mass);
      p.load = load; p.mass = mass; p.on = ok;
      // a change of hands has to hold for a moment: settling objects flicker in and out of contact
      if (owner === p.owner) p.pending = null;
      else if (!p.pending || p.pending.owner !== owner) p.pending = { owner, t: 0 };
      else if ((p.pending.t += DT) >= 0.4) {
        const was = p.owner;
        p.owner = owner; p.pending = null;
        this.event({ e: 'plate', i: p.i, owner, was });
      }
      if (live && owner >= 0 && this.mode.respawn) {
        this.scoreAcc[owner] += DT;
        for (const pl of this.players) if (pl.alive && pl.team === owner && dist2d(pl.pos, p.pos) < 8) pl.stats.plates += DT;
      }
    }
  }
  stepStatics() {
    for (const s of this.A.statics) {
      if (!s.erased || this.time < s.regrowAt) continue;
      const pose = { size: [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]], pos: [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2], q: [0, 0, 0, 1] };
      if (this.A.touchedBy(pose).some(i => i.kind === 'prop' || i.kind === 'player')) { s.regrowAt = this.time + 2; continue; }
      this.A.restoreStatic(s);
      this.event({ e: 'regrow', id: s.id });
    }
  }

  stepPlayer(pl, live) {
    if (!pl.alive) {
      if (this.time >= pl.respawnAt && this.phase !== 'over') this.respawn(pl);
      return;
    }
    // falling out of the arena
    if (pl.pos[1] < this.A.killY) {
      const la = pl.lastAttacker && this.time - pl.lastAttacker.time < 6 ? this.byId.get(pl.lastAttacker.id) : null;
      this.eliminate(pl, la, 'void');
      return;
    }
    // film and bulbs come back
    for (const k of ['pos', 'neg']) {
      if (pl.film[k] >= FILM[k].max) continue;
      pl.filmT[k] += DT;
      if (pl.filmT[k] >= FILM[k].every) { pl.filmT[k] = 0; pl.film[k]++; }
    }
    if (pl.bulbs < FLASH.bulbs) { pl.bulbT += DT; if (pl.bulbT >= FLASH.every) { pl.bulbT = 0; pl.bulbs++; } } else pl.bulbT = 0;
    pl.flashCd = Math.max(0, pl.flashCd - DT);
    // exposure fades if you keep out of trouble
    if (pl.exposure > 0 && this.time - pl.lastHit > EXPOSURE.fadeAfter && this.time - pl.lastFade > EXPOSURE.fadeEvery) { pl.exposure--; pl.lastFade = this.time; }
    // pulling focus on someone
    if (pl.aim && live) {
      const t = flashTarget(this.A, this.viewOf(pl), this.players, pl.team);
      if (t && pl.focus && pl.focus.id === t.id) pl.focus.t += DT;
      else pl.focus = t ? { id: t.id, t: DT } : null;
    } else pl.focus = null;
  }

  // ---------- modes ----------
  stepMode(live) {
    if (!live) return;
    this.clock = Math.max(0, this.clock - DT);
    if (this.mode.respawn) {
      for (const t of [0, 1]) while (this.scoreAcc[t] >= 1) { this.scoreAcc[t] -= 1; this.score[t]++; }
      const lead = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
      if (Math.max(...this.score) >= this.scoreLimit) this.finish(lead);
      else if (this.clock <= 0) this.finish(lead);
      return;
    }
    // Last Light: a round ends when a team is gone, or at the whistle (most plates held, then most standing)
    const alive = [0, 1].map(t => this.players.filter(p => p.team === t && p.alive).length);
    let winner = null;
    if (!alive[0] || !alive[1]) winner = !alive[0] && !alive[1] ? -1 : alive[0] ? 0 : 1;
    else if (this.clock <= 0) {
      const held = [0, 1].map(t => this.A.plates.filter(p => p.owner === t).length);
      winner = held[0] !== held[1] ? (held[0] > held[1] ? 0 : 1) : alive[0] !== alive[1] ? (alive[0] > alive[1] ? 0 : 1) : -1;
    }
    if (winner === null) return;
    if (winner >= 0) this.rounds[winner]++;
    this.winner = winner;
    if (winner >= 0 && this.rounds[winner] >= this.mode.rounds) this.finish(winner);
    else this.setPhase('roundover', 4);
  }
  resetRound() {
    this.round++;
    for (const p of this.A.props.slice()) this.A.removeProp(p);
    this.respawnQueue.length = 0;
    for (const s of this.A.statics) this.A.restoreStatic(s);
    for (const pl of this.players) { pl.developed.length = 0; pl.roll.length = 0; }
    this.spawnMapProps();
    this.event({ e: 'reset', props: this.A.props.map(propData) });
    for (const pl of this.players) this.respawn(pl, true);
    this.clock = this.mode.time;
    this.winner = null;
    this.setPhase('countdown', 3);
  }
  finish(winner) {
    this.winner = winner;
    this.setPhase('over', 0);
    this.out(null, { t: 'over', winner, score: this.score, rounds: this.rounds, mode: this.settings.mode, players: this.players.map(p => ({ id: p.id, name: p.name, team: p.team, bot: !p.human, stats: roundStats(p.stats) })) });
  }

  // ---------- output ----------
  event(ev) { this.events.push(ev); }
  privateEvent(id, ev) {
    const pl = this.byId.get(id);
    if (!pl || !pl.human) return;
    if (!this.priv.has(id)) this.priv.set(id, []);
    this.priv.get(id).push(ev);
  }
  flush() {
    if (this.events.length) { this.out(null, { t: 'e', l: this.events }); this.events = []; }
    for (const [id, l] of this.priv) if (l.length) this.out(id, { t: 'e', l });
    this.priv.clear();
  }
  sendRoll(pl) {
    if (!pl.human) return;
    this.out(pl.id, { t: 'roll', roll: pl.roll });
  }
  snapshot() {
    // who's pulling focus on whom
    for (const pl of this.players) pl.watchers.length = 0;
    for (const pl of this.players) if (pl.focus) { const t = this.byId.get(pl.focus.id); if (t) t.watchers.push([pl.id, r3(Math.min(1, pl.focus.t / FLASH.focus))]); }
    const players = this.players.map(p => [p.id, r3(p.pos[0]), r3(p.pos[1]), r3(p.pos[2]), r3(p.yaw), r3(p.pitch),
      (p.alive ? 1 : 0) | (p.aim ? 2 : 0) | (p.roll.length ? 8 : 0) | (p.safeUntil > this.time ? 16 : 0), p.exposure]);
    const props = [];
    for (const p of this.A.props) {
      const key = `${r3(p.pos[0])},${r3(p.pos[1])},${r3(p.pos[2])},${r3(p.quat[0])},${r3(p.quat[1])},${r3(p.quat[2])},${r3(p.quat[3])}`;
      if (key === p.sent) continue;
      p.sent = key;
      props.push([p.id, ...key.split(',').map(Number)]);
    }
    const plates = this.A.plates.map(p => [r3(p.load), r3(p.mass[0]), r3(p.mass[1]), p.owner, p.on ? 1 : 0]);
    const base = { t: 's', k: this.tick, ph: this.phase, pt: r3(this.phaseT), c: r3(this.clock), sc: this.score, rw: this.rounds, p: players, o: props, pl: plates };
    for (const pl of this.players) {
      if (!pl.human) continue;
      this.out(pl.id, { ...base, me: {
        f: pl.film.pos, n: pl.film.neg, b: pl.bulbs, ex: pl.exposure, al: pl.alive ? 1 : 0, ep: pl.epoch,
        rs: pl.alive ? 0 : r3(Math.max(0, pl.respawnAt - this.time)),
        fc: pl.focus ? [pl.focus.id, r3(Math.min(1, pl.focus.t / FLASH.focus))] : 0,
        w: pl.watchers, cd: r3(pl.flashCd),
      } });
    }
  }

  free() { this.A.free(); }
}

const propData = p => [p.id, p.type, p.size.map(r3), p.pos.map(r3), p.quat.map(r3), p.team, p.owner];
const roundStats = s => ({ ...s, tonnes: Math.round(s.tonnes * 10) / 10, plates: Math.round(s.plates) });
export { propData };
