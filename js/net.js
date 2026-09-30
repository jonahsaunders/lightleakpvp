// Two ways to reach a lobby, with the same shape: `send(message)`, and `onmessage` / `onclose`.
//
//   Online   a WebSocket to a Lightleak PvP server (the one that served this page, or any other)
//   Local    a lobby running right here, for practice against bots; no network at all
import { Lobby } from '../shared/lobby.js';

export class Online {
  constructor(address) {
    this.onmessage = null; this.onclose = null; this.onopen = null;
    this.url = toWsUrl(address);
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.onopen && this.onopen();
    this.ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } if (this.onmessage) this.onmessage(m); };
    this.ws.onclose = e => this.onclose && this.onclose(e);
    this.ws.onerror = () => {};
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  pump() {}
  close() { this.onclose = null; try { this.ws.close(); } catch (e) { /* already closed */ } }
}

// "192.168.1.20", "192.168.1.20:5190", "example.com", "wss://…" → a WebSocket URL
export function toWsUrl(address) {
  let a = String(address || '').trim();
  if (/^wss?:\/\//.test(a)) return a.endsWith('/ws') ? a : `${a.replace(/\/$/, '')}/ws`;
  const secure = /^https:\/\//.test(a);
  a = a.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/:\d+$/.test(a) && !secure) a += ':5190';
  return `${secure ? 'wss' : 'ws'}://${a}/ws`;
}

export class Local {
  constructor(R, maps) {
    this.onmessage = null; this.onclose = null;
    this.lobby = new Lobby(R, maps, { name: 'Practice', local: true });
    this.inbox = [];
    this.client = this.lobby.connect(m => this.inbox.push(structuredClone(m)));
    this.last = performance.now();
  }
  send(m) { this.lobby.message(this.client, structuredClone(m)); }
  // Runs the practice match by real time and hands over what it said. Called every frame.
  pump() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.lobby.step(dt);
    const msgs = this.inbox.splice(0);
    for (const m of msgs) if (this.onmessage) this.onmessage(m);
  }
  close() { this.lobby.disconnect(this.client); this.onmessage = null; }
}
