'use strict';
// Lightleak PvP's server: serves the game to browsers and runs the matches.
//
//   node server.js           http://127.0.0.1:5190 on this computer only
//   node server.js --lan     also reachable from other computers (http://<your address>:5190)
//   PORT=6000 node server.js --lan
//
// Anyone who opens the address in a browser gets the game, already pointed at this server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
const PUBLIC = ['index.html', 'js/', 'shared/', 'vendor/', 'maps/', 'desktop/icon.png', 'LICENSES.md'];

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function staticHandler(info) {
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (url.pathname === '/api/info') return send(res, 200, JSON.stringify(info()), TYPES['.json']);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (!PUBLIC.some(p => rel === p || (p.endsWith('/') && rel.startsWith(p)))) return send(res, 404, 'Not found');
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  };
}

// Starts the lobby and one listener. `listenLan(port)` adds a second listener on every network
// interface, sharing the same lobby (the desktop app's "Host on LAN").
async function start({ port = 5190, host = '127.0.0.1', name = `${os.hostname()}'s server`, quiet = false } = {}) {
  const { default: RAPIER } = await import('./vendor/rapier.mjs');
  const { Lobby } = await import('./shared/lobby.js');
  const { VERSION, PROTOCOL } = await import('./shared/config.js');
  await RAPIER.init();
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', 'index.json'), 'utf8'));
  const maps = {};
  for (const id of index.maps) maps[id] = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', `${id}.json`), 'utf8')), id };
  const lobby = new Lobby(RAPIER, maps, { name });
  const servers = [];
  let lanPort = null;
  const info = () => ({ game: 'lightleakpvp', version: VERSION, protocol: PROTOCOL, name, lan: lanPort ? lanAddresses().map(a => `${a}:${lanPort}`) : [] });

  function listen(p, h) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(staticHandler(info));
      const wss = new WebSocketServer({ server: srv, path: '/ws', perMessageDeflate: false, maxPayload: 64 * 1024 });
      wss.on('connection', ws => {
        ws._socket?.setNoDelay?.(true);
        const client = lobby.connect(msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
        ws.on('message', data => { let m; try { m = JSON.parse(data); } catch (e) { return; } try { lobby.message(client, m); } catch (e) { console.error(e); } });
        ws.on('close', () => lobby.disconnect(client));
        ws.on('error', () => {});
      });
      srv.once('error', reject);
      srv.listen(p, h, () => { servers.push({ srv, wss }); resolve(srv.address().port); });
    });
  }

  const boundPort = await listen(port, host);
  // the match clock: advance by real time
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Number(now - last) / 1e9;
    last = now;
    try { lobby.step(dt); } catch (e) { console.error(e); }
  }, 4);
  if (!quiet) console.log(`Lightleak PvP ${VERSION} at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}/`);
  if (host === '0.0.0.0') { lanPort = boundPort; if (!quiet) for (const a of lanAddresses()) console.log(`  on your network: http://${a}:${boundPort}/`); }

  return {
    port: boundPort, lobby, info,
    async listenLan(p = 5190) {
      if (lanPort) return info();
      lanPort = await listen(p, '0.0.0.0').catch(() => listen(0, '0.0.0.0'));
      return info();
    },
    close() { clearInterval(timer); for (const { srv, wss } of servers) { for (const c of wss.clients) c.terminate(); wss.close(); srv.close(); } },
  };
}

module.exports = { start, lanAddresses };

if (require.main === module) {
  const lan = process.argv.includes('--lan');
  const port = Number(process.env.PORT) || 5190;
  start({ port, host: lan ? '0.0.0.0' : '127.0.0.1' }).catch(e => { console.error(e.message || e); process.exit(1); });
}
