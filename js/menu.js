// The title screen: practice against bots, the online lobby and rooms, how to play, settings.
import { MODES, SIZES, DIFFICULTY, TEAMS } from '../shared/config.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`lightleakpvp.${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(`lightleakpvp.${k}`, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const SIZE_NAME = { 1: '1 v 1', 2: '2 v 2', 5: '5 v 5' };
const DIFF_NAME = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

let ctx = null;
let online = { state: 'connect', rooms: [], room: null, myId: null, server: '', maps: [] };
const practice = Object.assign({ size: 2, mode: 'plates', map: 'contact-sheet', difficulty: 'normal' }, store.get('practice', {}));

export function initMenu(c) {
  ctx = c;
  for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => tab(b.dataset.tab);
  renderPractice();
  renderOnline();
}
export function tab(name) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of ['practice', 'online', 'howto', 'settings']) $(`tab-${t}`).hidden = t !== name;
}
export function menuMessage(text) { $('menu-msg').hidden = !text; $('menu-msg').textContent = text || ''; }
export function playerName() { return store.get('name', '') || ''; }

// ---------- shared pickers ----------
function picker(label, value, options, onPick) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  wrap.innerHTML = `<div class="lbl">${label}</div>`;
  const opts = document.createElement('div'); opts.className = 'opts';
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'opt' + (o.value === value ? ' on' : '');
    b.innerHTML = `${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}`;
    b.disabled = !!o.disabled;
    b.onclick = () => onPick(o.value);
    opts.appendChild(b);
  }
  wrap.appendChild(opts);
  return wrap;
}
function mapOptions(maps, size) {
  return maps.map(m => ({ value: m.id, label: m.name, note: `${m.sizes.map(s => SIZE_NAME[s]).join(' · ')} · ${m.blurb}`, fits: m.sizes.includes(size) }))
    .sort((a, b) => (b.fits ? 1 : 0) - (a.fits ? 1 : 0));
}
function settingsPickers(el, s, onChange, maps) {
  el.appendChild(picker('TEAMS', s.size, SIZES.map(n => ({ value: n, label: SIZE_NAME[n] })), v => { s.size = v; const fit = maps.find(m => m.sizes.includes(v)); if (fit && !maps.find(m => m.id === s.map)?.sizes.includes(v)) s.map = fit.id; onChange(); }));
  el.appendChild(picker('MODE', s.mode, Object.entries(MODES).map(([k, m]) => ({ value: k, label: m.name, note: m.blurb })), v => { s.mode = v; onChange(); }));
  el.appendChild(picker('ARENA', s.map, mapOptions(maps, s.size), v => { s.map = v; onChange(); }));
  el.appendChild(picker('BOTS', s.difficulty, Object.keys(DIFFICULTY).map(k => ({ value: k, label: DIFF_NAME[k] })), v => { s.difficulty = v; onChange(); }));
}

// ---------- practice ----------
function renderPractice() {
  const el = $('tab-practice');
  el.innerHTML = '';
  settingsPickers(el, practice, () => { store.set('practice', practice); renderPractice(); }, ctx.maps);
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<button class="btn" id="go-practice">Play against bots</button><span class="note" style="margin:0">You on ${TEAMS[0].name}, bots everywhere else. Runs entirely in this window.</span>`;
  el.appendChild(row);
  $('go-practice').onclick = () => ctx.startPractice({ ...practice, fill: true });
}

// ---------- online ----------
export function renderOnline() {
  const el = $('tab-online');
  const o = online;
  if (o.state === 'connect' || o.state === 'connecting') {
    const addr = store.get('server', '') || ctx.defaultServer || '';
    el.innerHTML = `
      <div class="row" style="gap:14px;align-items:flex-end">
        <div class="field" style="margin:0"><div class="lbl">YOUR NAME</div><input type="text" id="on-name" maxlength="18" value="${esc(playerName())}" placeholder="Name"></div>
        <div class="field" style="margin:0;flex:1;min-width:220px"><div class="lbl">SERVER</div><input type="text" id="on-addr" style="width:100%;box-sizing:border-box" value="${esc(addr)}" placeholder="192.168.1.20 or example.com:5190"></div>
        <button class="btn" id="on-connect" ${o.state === 'connecting' ? 'disabled' : ''}>${o.state === 'connecting' ? 'Connecting…' : 'Connect'}</button>
      </div>
      ${ctx.hostLan ? `<div class="row" style="margin-top:16px"><button class="btn ghost" id="on-host">Host a game on this network</button><span class="note" id="host-info" style="margin:0"></span></div>` : ''}
      <div class="note">${ctx.defaultServer ? `This page came from a Lightleak PvP server at <code>${esc(ctx.defaultServer)}</code>, so it's filled in. ` : ''}
        To play with friends, one of you runs a server: the desktop app's <b>Host a game</b> button, or <code>npm run server</code> from the source. Everyone else connects to that computer's address (port 5190), or just opens <code>http://&lt;address&gt;:5190</code> in a browser.</div>`;
    $('on-connect').onclick = () => {
      const name = $('on-name').value.trim() || 'Player', address = $('on-addr').value.trim();
      if (!address) { $('on-addr').focus(); return; }
      store.set('name', name); store.set('server', address);
      online.state = 'connecting'; renderOnline();
      ctx.connect(address, name);
    };
    if (ctx.hostLan) $('on-host').onclick = async () => {
      $('on-host').disabled = true;
      const info = await ctx.hostLan().catch(e => ({ error: e.message }));
      if (info.error) { $('host-info').textContent = info.error; $('on-host').disabled = false; return; }
      $('host-info').innerHTML = info.lan.length ? `Hosting. Friends connect to ${info.lan.map(a => `<code>${esc(a)}</code>`).join(' or ')}.` : 'Hosting, but this computer has no network address right now.';
      $('on-addr').value = ctx.defaultServer;
    };
    return;
  }
  if (o.state === 'lobby') {
    const s = Object.assign({ size: 2, mode: 'plates', map: 'contact-sheet', difficulty: 'normal', fill: true }, store.get('roomSettings', {}));
    el.innerHTML = `
      <div class="row" style="justify-content:space-between"><div><b>${esc(o.server)}</b> <span class="note">as ${esc(playerName())}</span></div><button class="btn ghost small" id="on-disc">Disconnect</button></div>
      <div class="field" style="margin-top:14px"><div class="lbl">QUICK MATCH</div><div class="row">${SIZES.map(n => `<button class="btn ghost" data-quick="${n}">${SIZE_NAME[n]}</button>`).join('')}<span class="note" style="margin:0">Joins a room that's waiting, or opens one. Bots fill any empty places.</span></div></div>
      <div class="field"><div class="lbl">ROOMS</div><div class="rooms" id="room-list"></div></div>
      <details id="create"><summary class="btn ghost small" style="display:inline-block">Make a room</summary><div id="create-body" style="margin-top:14px"></div></details>`;
    $('on-disc').onclick = () => ctx.disconnect();
    for (const b of el.querySelectorAll('[data-quick]')) b.onclick = () => ctx.send({ t: 'quick', size: +b.dataset.quick, mode: 'plates' });
    const list = $('room-list');
    list.innerHTML = o.rooms.length ? o.rooms.map(r => `<div class="roomrow"><div><b>${esc(r.name)}</b><div class="meta">${SIZE_NAME[r.size]} · ${MODES[r.mode].name} · ${esc(o.maps.find(m => m.id === r.map)?.name || r.map)} · ${r.humans}/${r.size * 2} people${r.state !== 'lobby' ? ' · playing' : ''}</div></div><span></span><button class="btn small" data-join="${r.id}" ${r.state !== 'lobby' || r.humans >= r.size * 2 ? 'disabled' : ''}>Join</button></div>`).join('') : '<div class="note">No rooms yet. Make one, or use quick match.</div>';
    for (const b of list.querySelectorAll('[data-join]')) b.onclick = () => ctx.send({ t: 'join', room: b.dataset.join });
    const body = $('create-body');
    const draw = () => {
      body.innerHTML = '';
      settingsPickers(body, s, () => { store.set('roomSettings', s); draw(); }, o.maps);
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<label class="row" style="gap:6px"><input type="checkbox" id="c-fill" ${s.fill ? 'checked' : ''}> Fill empty places with bots</label><button class="btn" id="c-go">Make room</button>`;
      body.appendChild(row);
      $('c-fill').onchange = e => { s.fill = e.target.checked; store.set('roomSettings', s); };
      $('c-go').onclick = () => ctx.send({ t: 'create', settings: s });
    };
    draw();
    if (online.createOpen) $('create').open = true;
    $('create').ontoggle = () => { online.createOpen = $('create').open; };
    return;
  }
  if (o.state === 'room') {
    const r = o.room, host = r.hostId === o.myId;
    const mapName = o.maps.find(m => m.id === r.map)?.name || r.map;
    const col = t => {
      const on = r.members.filter(m => m.team === t);
      const empty = r.size - on.length;
      return `<div class="team" style="border-top-color:${TEAMS[t].color}"><h4 style="color:${TEAMS[t].color}">${TEAMS[t].name.toUpperCase()}</h4>
        ${on.map(m => `<div>${esc(m.name)}${m.id === r.hostId ? ' <span class="bot">HOST</span>' : ''}${m.id === o.myId ? ' <span class="bot">YOU</span>' : ''}</div>`).join('')}
        ${empty > 0 ? `<div class="empty">${empty} ${r.fill ? `bot${empty > 1 ? 's' : ''}` : `empty place${empty > 1 ? 's' : ''}`}</div>` : ''}</div>`;
    };
    el.innerHTML = `
      <div class="row" style="justify-content:space-between"><div><b style="font-size:18px">${esc(r.name)}</b><div class="note" style="margin:2px 0 0">${SIZE_NAME[r.size]} · ${MODES[r.mode].name} · ${esc(mapName)} · ${DIFF_NAME[r.difficulty]} bots${r.state !== 'lobby' ? ' · <b>playing</b>' : ''}</div></div>
        <button class="btn ghost small" id="rm-leave">Leave room</button></div>
      <div class="teams">${col(0)}${col(1)}</div>
      <div class="row">
        <button class="btn ghost" id="rm-swap">Switch team</button>
        ${host ? `<button class="btn" id="rm-start">Start match</button><label class="row" style="gap:6px"><input type="checkbox" id="rm-fill" ${r.fill ? 'checked' : ''}> Bots fill empty places</label>` : '<span class="note" style="margin:0">Waiting for the host to start.</span>'}
      </div>
      ${host ? '<details style="margin-top:14px"><summary class="btn ghost small" style="display:inline-block">Change the match</summary><div id="rm-set" style="margin-top:12px"></div></details>' : ''}
      <div id="chatlog">${o.chat.map(c => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join('')}</div>
      <div class="row" style="margin-top:6px"><input type="text" id="chat-in" maxlength="160" placeholder="Say something" style="flex:1"><button class="btn ghost small" id="chat-go">Send</button></div>`;
    $('chatlog').scrollTop = 1e6;
    $('rm-leave').onclick = () => ctx.send({ t: 'leave' });
    $('rm-swap').onclick = () => { const me = r.members.find(m => m.id === o.myId); ctx.send({ t: 'team', team: me && me.team === 0 ? 1 : 0 }); };
    if (host) {
      $('rm-start').onclick = () => ctx.send({ t: 'start' });
      $('rm-fill').onchange = e => ctx.send({ t: 'set', settings: { fill: e.target.checked } });
      const s = { size: r.size, mode: r.mode, map: r.map, difficulty: r.difficulty };
      settingsPickers($('rm-set'), s, () => ctx.send({ t: 'set', settings: s }), o.maps);
    }
    const sendChat = () => { const v = $('chat-in').value.trim(); if (v) ctx.send({ t: 'chat', text: v }); $('chat-in').value = ''; };
    $('chat-go').onclick = sendChat;
    $('chat-in').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); };
  }
}

// ---------- what the server tells the lobby ----------
export const lobbyUI = {
  welcome(m, address) { Object.assign(online, { state: 'lobby', rooms: m.rooms, maps: m.maps, myId: m.id, server: `${m.server} · ${address}`, room: null, chat: [] }); menuMessage(''); renderOnline(); },
  rooms(list) { online.rooms = list; if (online.state === 'lobby') renderOnline(); },
  room(r) { const was = online.room && online.room.id; online.room = r; online.state = 'room'; if (was !== r.id) online.chat = []; if (!document.activeElement || document.activeElement.id !== 'chat-in') renderOnline(); },
  left() { online.room = null; online.state = 'lobby'; renderOnline(); },
  chat(from, text) { online.chat.push({ from, text }); if (online.chat.length > 40) online.chat.shift(); const log = $('chatlog'); if (log) { log.insertAdjacentHTML('beforeend', `<div><b>${esc(from)}:</b> ${esc(text)}</div>`); log.scrollTop = 1e6; } },
  disconnected(reason) { online.state = 'connect'; online.room = null; renderOnline(); if (reason) menuMessage(reason); },
  get inRoom() { return online.state === 'room'; },
};
