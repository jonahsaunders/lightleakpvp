// Headless checks.
//   1. The server: two players connect over WebSockets, make and join a room, play, and one leaves.
//   2. Bots play real matches on every map, as fast as the machine allows.
//
//   npm test                 the server, then every map at every size it's made for, both modes
//   node test/run.mjs quick  the server, then one short match per map
// A match passes if nothing throws, the bots actually do the things the game is about (take photos,
// develop, dissolve, flash, score), and the plates change hands.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import RAPIER from '../vendor/rapier.mjs';
import { Match } from '../shared/match.js';
import { DT } from '../shared/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('quick');
const only = process.argv.find(a => a.startsWith('map='))?.slice(4);
const secs = Number(process.argv.find(a => a.startsWith('secs='))?.slice(5)) || (quick ? 90 : 240);
await RAPIER.init();

const index = JSON.parse(readFileSync(join(root, 'maps', 'index.json'), 'utf8'));
let failed = 0;

// ---------- the server ----------
async function serverTest() {
  const require = createRequire(import.meta.url);
  const { start } = require('../server.js');
  const WebSocket = require('ws');
  const srv = await start({ port: 0, quiet: true });
  const client = name => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const c = { ws, name, got: {}, last: {}, send: m => ws.send(JSON.stringify(m)), events: [] };
    ws.on('message', d => { const m = JSON.parse(d); c.got[m.t] = (c.got[m.t] || 0) + 1; c.last[m.t] = m; if (m.t === 'e') c.events.push(...m.l); });
    ws.on('open', () => { c.send({ t: 'hello', name }); resolve(c); });
  });
  const until = async (fn, ms = 5000) => { for (const t = Date.now(); Date.now() - t < ms; await new Promise(r => setTimeout(r, 20))) if (fn()) return true; return false; };
  const why = [];
  const a = await client('Ada'), b = await client('Bo');
  await until(() => a.got.welcome && b.got.welcome);
  a.send({ t: 'create', settings: { size: 1, mode: 'plates', map: 'contact-sheet', fill: false } });
  if (!await until(() => b.last.rooms && b.last.rooms.rooms.length === 1)) why.push("the other player didn't see the new room");
  b.send({ t: 'join', room: b.last.rooms.rooms[0].id });
  if (!await until(() => a.last.room && a.last.room.room.members.length === 2)) why.push("joining didn't reach the host");
  a.send({ t: 'chat', text: 'hello' });
  if (!await until(() => b.got.chat)) why.push('chat did not arrive');
  a.send({ t: 'start' });
  if (!await until(() => a.got.start && b.got.start)) why.push('the match did not start for both');
  else {
    const teams = a.last.start.players.map(p => p.team).sort().join('');
    if (teams !== '01') why.push(`teams were ${teams}, not one each`);
    if (!await until(() => (a.got.s || 0) > 20 && (b.got.s || 0) > 20)) why.push('snapshots are not arriving');
    a.ws.close();
    if (!await until(() => b.events.some(e => e.e === 'left'))) why.push("a player leaving wasn't announced");
    const n = b.got.s;
    if (!await until(() => b.got.s > n + 20)) why.push('the match stopped when a player left');
  }
  b.ws.close();
  srv.close();
  if (why.length) failed++;
  console.log(`${why.length ? 'FAIL' : 'PASS'}  server: lobby, rooms, chat, a 1v1 over WebSockets, a player leaving`);
  if (why.length) console.log(`      ${why.join('\n      ')}`);
}
await serverTest();

function play(map, size, mode, seconds, seed = 7) {
  const counts = {};
  const out = (id, msg) => {
    if (msg.t !== 'e') return;
    for (const ev of msg.l) counts[ev.e + (ev.how ? ':' + ev.how : '')] = (counts[ev.e + (ev.how ? ':' + ev.how : '')] || 0) + 1;
  };
  const t0 = performance.now();
  const m = new Match(RAPIER, map, { mode, size, difficulty: 'normal', seed }, out);
  const navMs = performance.now() - t0;
  let id = 0;
  for (const team of [0, 1]) for (let i = 0; i < size; i++) m.addPlayer({ id: `b${++id}`, name: `Bot ${id}`, team, bot: true });
  m.start();
  const ticks = Math.round(seconds / DT);
  const t1 = performance.now();
  let i = 0;
  for (; i < ticks && m.phase !== 'over'; i++) m.step();
  const ms = performance.now() - t1;
  const res = { map: map.id, size, mode, simSeconds: (i * DT).toFixed(0), msPerTick: (ms / i).toFixed(2), navNodes: m.nav.nodes.length, navMs: navMs.toFixed(0),
    score: m.score.join('-'), rounds: m.rounds.join('-'), phase: m.phase, winner: m.winner, props: m.A.props.length, counts };
  m.free();
  return res;
}

function check(r, mode) {
  const c = r.counts, why = [];
  if (!c.photo) why.push('no photos taken');
  if (!c.develop) why.push('nothing developed');
  if (!c.flash) why.push('no flashes');
  if (mode === 'plates' && !c.plate) why.push('no plate changed hands');
  if (mode === 'plates' && r.score === '0-0') why.push('nobody scored');
  if (!c['elim:flash'] && !c['elim:crush'] && !c['elim:void']) why.push('nobody was knocked out');
  return why;
}

for (const id of index.maps) {
  if (only && id !== only) continue;
  const map = JSON.parse(readFileSync(join(root, 'maps', `${id}.json`), 'utf8'));
  const sizes = quick ? [map.sizes[map.sizes.length - 1]] : map.sizes;
  for (const size of sizes) for (const mode of quick ? ['plates'] : ['plates', 'lastlight']) {
    let r, why;
    try { r = play(map, size, mode, secs); why = check(r, mode); } catch (e) { r = { map: id, size, mode }; why = [e.stack]; }
    if (why.length) failed++;
    console.log(`${why.length ? 'FAIL' : 'PASS'}  ${id.padEnd(15)} ${size}v${size} ${mode.padEnd(9)} ${r.simSeconds ?? '-'}s  score ${r.score ?? '-'}  rounds ${r.rounds ?? '-'}  ${r.msPerTick ?? '-'} ms/tick  nav ${r.navNodes ?? '-'} nodes`);
    if (r.counts) console.log(`      ${Object.entries(r.counts).filter(([k]) => !['spawn', 'phase'].includes(k)).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    if (why.length) console.log(`      ${why.join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
