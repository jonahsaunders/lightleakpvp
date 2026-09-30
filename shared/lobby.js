// Rooms and matches. The server runs one of these for everyone who connects; practice runs one in
// the page with just you in it. Either way a client is `{ send(message) }` and talks in messages:
//
//   hello { name }                 → welcome { id, maps, rooms }
//   rooms                          → rooms { rooms }
//   create { settings, name }      make a room and join it
//   join { room } / quick { size, mode } / leave
//   set { settings }               the host changes mode, size, map, bots
//   team { team } / chat { text } / start
//   in { … } / a { … }             during a match: where you are, and what you clicked
import { VERSION, PROTOCOL, DT, MODES, SIZES, DIFFICULTY, BOT_NAMES } from './config.js';
import { Match } from './match.js';

let seq = 0;
const clean = (s, n = 18) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Lobby {
  // maps: { id: map source }. local: practice (one player, starts straight away).
  constructor(R, maps, { name = 'Lightleak PvP', local = false } = {}) {
    this.R = R; this.maps = maps; this.name = name; this.local = local;
    this.clients = new Map();
    this.rooms = new Map();
  }

  mapList() {
    return Object.values(this.maps).map(m => ({ id: m.id, name: m.name, sizes: m.sizes, blurb: m.blurb }));
  }
  summary(r) {
    return { id: r.id, name: r.name, ...r.settings, humans: r.members.length, state: r.state, host: this.clients.get(r.hostId)?.name || '' };
  }
  roomList() { return [...this.rooms.values()].map(r => this.summary(r)); }
  broadcastRooms() { for (const c of this.clients.values()) if (!c.room) c.send({ t: 'rooms', rooms: this.roomList() }); }

  connect(send) {
    const c = { id: `p${++seq}`, name: 'Player', send, room: null };
    this.clients.set(c.id, c);
    return c;
  }
  disconnect(c) {
    this.leaveRoom(c);
    this.clients.delete(c.id);
  }

  message(c, m) {
    if (!m || typeof m !== 'object') return;
    const r = c.room;
    switch (m.t) {
      case 'hello':
        c.name = clean(m.name) || `Player ${c.id.slice(1)}`;
        c.send({ t: 'welcome', id: c.id, version: VERSION, protocol: PROTOCOL, server: this.name, maps: this.mapList(), rooms: this.roomList() });
        break;
      case 'rooms': c.send({ t: 'rooms', rooms: this.roomList() }); break;
      case 'create': this.create(c, m.settings || {}, m.name); break;
      case 'join': this.join(c, this.rooms.get(m.room)); break;
      case 'quick': this.quick(c, m); break;
      case 'leave': this.leaveRoom(c); c.send({ t: 'rooms', rooms: this.roomList() }); break;
      case 'set':
        if (r && r.hostId === c.id && r.state === 'lobby') { r.settings = this.settings({ ...r.settings, ...m.settings }); this.fitTeams(r); this.sendRoom(r); this.broadcastRooms(); }
        break;
      case 'team':
        if (r && r.state === 'lobby') {
          const me = r.members.find(x => x.id === c.id), t = m.team === 1 ? 1 : 0;
          if (me && r.members.filter(x => x.team === t).length < r.settings.size) { me.team = t; this.sendRoom(r); }
        }
        break;
      case 'chat':
        if (r) { const text = clean(m.text, 160); if (text) for (const x of r.members) this.clients.get(x.id)?.send({ t: 'chat', from: c.name, text }); }
        break;
      case 'start': if (r && r.hostId === c.id) this.start(r); break;
      case 'back': if (r && r.state === 'over') this.toLobby(r); break;
      case 'in': if (r && r.match) r.match.input(c.id, m); break;
      case 'a': if (r && r.match) r.match.action(c.id, m); break;
      case 'ping': c.send({ t: 'pong', at: m.at }); break;
    }
  }

  settings(s) {
    const size = SIZES.includes(+s.size) ? +s.size : 2;
    const mode = MODES[s.mode] ? s.mode : 'plates';
    const fits = Object.values(this.maps).filter(m => m.sizes.includes(size));
    const map = this.maps[s.map] ? s.map : (fits[0] || Object.values(this.maps)[0]).id;
    return { mode, size, map, difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : 'normal', fill: s.fill !== false };
  }
  create(c, settings, name) {
    this.leaveRoom(c);
    const r = { id: `r${++seq}`, name: clean(name, 28) || `${c.name}'s room`, hostId: c.id, settings: this.settings(settings), members: [], state: 'lobby', match: null, acc: 0, overAt: 0, seed: (Date.now() ^ (seq * 7919)) >>> 0 };
    this.rooms.set(r.id, r);
    this.join(c, r);
    if (this.local) this.start(r);
  }
  join(c, r) {
    if (!r) { c.send({ t: 'error', text: 'That room has gone.' }); return; }
    if (r.state !== 'lobby') { c.send({ t: 'error', text: "That match has already started. Try again when it's over." }); return; }
    if (r.members.length >= r.settings.size * 2) { c.send({ t: 'error', text: 'That room is full.' }); return; }
    this.leaveRoom(c);
    const count = t => r.members.filter(x => x.team === t).length;
    r.members.push({ id: c.id, name: c.name, team: count(0) <= count(1) ? 0 : 1 });
    c.room = r;
    this.sendRoom(r);
    this.broadcastRooms();
  }
  quick(c, m) {
    const size = SIZES.includes(+m.size) ? +m.size : 2, mode = MODES[m.mode] ? m.mode : 'plates';
    const open = [...this.rooms.values()].find(r => r.state === 'lobby' && r.settings.size === size && r.settings.mode === mode && r.members.length < size * 2);
    if (open) this.join(c, open); else this.create(c, { size, mode });
  }
  fitTeams(r) {
    for (const t of [0, 1]) {
      const on = r.members.filter(x => x.team === t);
      for (const x of on.slice(r.settings.size)) x.team = 1 - t;
    }
  }
  leaveRoom(c) {
    const r = c.room;
    if (!r) return;
    c.room = null;
    r.members = r.members.filter(x => x.id !== c.id);
    if (r.match) r.match.leave(c.id);
    if (!r.members.length) { if (r.match) r.match.free(); this.rooms.delete(r.id); }
    else {
      if (r.hostId === c.id) r.hostId = r.members[0].id;
      this.sendRoom(r);
    }
    this.broadcastRooms();
  }
  sendRoom(r) {
    const msg = { t: 'room', room: { ...this.summary(r), hostId: r.hostId, members: r.members } };
    for (const x of r.members) this.clients.get(x.id)?.send(msg);
  }

  start(r) {
    if (r.state !== 'lobby') return;
    const s = r.settings;
    const teams = [0, 1].map(t => r.members.filter(x => x.team === t));
    if (!s.fill && (!teams[0].length || !teams[1].length)) {
      this.clients.get(r.hostId)?.send({ t: 'error', text: 'Each team needs someone on it. Turn on bots to fill the empty places.' });
      return;
    }
    const match = new Match(this.R, this.maps[s.map], { mode: s.mode, size: s.size, difficulty: s.difficulty, seed: r.seed++ }, (id, msg) => {
      if (id === null) { for (const x of r.members) this.clients.get(x.id)?.send(msg); }
      else this.clients.get(id)?.send(msg);
    });
    const names = BOT_NAMES.slice().sort(() => match.rand() - 0.5);
    let b = 0;
    for (const t of [0, 1]) {
      for (const x of teams[t].slice(0, s.size)) match.addPlayer({ id: x.id, name: x.name, team: t });
      if (s.fill) for (let i = teams[t].length; i < s.size; i++) match.addPlayer({ id: `b${++b}`, name: names[(b - 1) % names.length], team: t, bot: true });
    }
    r.match = match; r.state = 'playing'; r.acc = 0; r.overAt = 0;
    match.start();
    this.broadcastRooms();
  }
  toLobby(r) {
    if (r.match) r.match.free();
    r.match = null; r.state = 'lobby';
    this.sendRoom(r);
    this.broadcastRooms();
  }

  // Advance every running match by real time (the host calls this often).
  step(seconds) {
    for (const r of this.rooms.values()) {
      if (!r.match) continue;
      if (r.state === 'playing') {
        r.acc = Math.min(r.acc + seconds, DT * 10);
        while (r.acc >= DT) {
          r.acc -= DT;
          r.match.step();
          if (r.match.phase === 'over') { r.state = 'over'; r.overAt = 20; this.broadcastRooms(); break; }
        }
      } else if (r.state === 'over') {
        r.overAt -= seconds;
        if (r.overAt <= 0) this.toLobby(r);
      }
    }
  }
}
