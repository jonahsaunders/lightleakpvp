// Staging for README screenshots (npm run shots). Practice only: it reaches into the match running
// in this page to put you somewhere, hand you a photo, or point you at someone.
import { PLAYER } from '../shared/config.js';

const W = () => window.lightleakpvp;
const room = () => [...W().net.lobby.rooms.values()][0];
const server = () => room().match;
const mine = () => server().byId.get(W().game.youId);
const look = (from, to) => ({ yaw: Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])), pitch: Math.atan2(to[1] - from[1], Math.hypot(to[0] - from[0], to[2] - from[2])) });

export function teleport(x, z, yaw, pitch = 0) {
  const pl = mine(), m = server();
  pl.pos = [x, 0.02, z]; pl.yaw = yaw; pl.pitch = pitch;
  m.correct(pl);
  W().look(yaw, pitch);
}
// Photograph a prop from where you stand (server side, so it's a real photo).
export function photo(pred) {
  const m = server(), pl = mine();
  const eye = [pl.pos[0], pl.pos[1] + PLAYER.eye, pl.pos[2]];
  const p = m.A.props.filter(pred).sort((a, b) => Math.hypot(a.pos[0] - eye[0], a.pos[2] - eye[2]) - Math.hypot(b.pos[0] - eye[0], b.pos[2] - eye[2]))[0];
  if (!p) return false;
  const l = look(eye, p.pos);
  m.handle(pl, { a: 'shoot', yaw: l.yaw, pitch: l.pitch, fr: 0 });
  return true;
}
// Look at the nearest enemy (or a point), camera up.
export function aimAtEnemy() {
  const g = W().game, pl = mine();
  const e = server().players.filter(o => o.team !== pl.team && o.alive).sort((a, b) => Math.hypot(a.pos[0] - pl.pos[0], a.pos[2] - pl.pos[2]) - Math.hypot(b.pos[0] - pl.pos[0], b.pos[2] - pl.pos[2]))[0];
  if (!e) return false;
  const c = g.players.get(e.id).avatar.group.position;
  const l = look([g.me.pos[0], g.me.pos[1] + PLAYER.eye, g.me.pos[2]], [c.x, c.y + 1.15, c.z]);
  W().look(l.yaw, l.pitch);
  W().live.aimHeld = true;
  return true;
}
// Freeze the bots where they are (so a staged moment holds still).
export function freezeBots(on = true) { for (const p of server().players) if (p.bot) p.bot.frozen = on; }
// Put the nearest enemy bot somewhere, facing you.
export function teleportEnemy(x, z) {
  const m = server(), pl = mine();
  const e = m.players.find(o => o.team !== pl.team && o.alive);
  if (!e) return;
  e.pos = [x, 0.02, z]; e.vel = [0, 0, 0];
  m.A.placeBody(e, true);
  if (e.bot) { e.bot.frozen = true; e.bot.look.yaw = Math.atan2(-(pl.pos[0] - x), -(pl.pos[2] - z)); }
}
