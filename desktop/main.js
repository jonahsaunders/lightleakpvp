'use strict';
// Lightleak PvP desktop app: runs a game server inside the app and shows the game in a window.
// Practice needs nothing else. "Host a game on this network" opens the same server to other
// computers on port 5190; they join from their own app, or from a browser at http://<address>:5190.
//
//   npm run desktop   run from source
//   npm run smoke     start it hidden, host on the network, play a few seconds of practice, and quit
//   npm run shots     stage bot matches and capture the README's screenshots into docs/
//   npm run dist      build the Windows installer and portable .exe into dist/
const path = require('path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { start } = require('../server.js');

const SMOKE = process.argv.includes('--smoke');
const SHOTS = process.argv.includes('--shots');
let win = null, srv = null;

async function boot() {
  srv = await start({ port: 0, quiet: true });
  ipcMain.handle('host-lan', async () => {
    try { return await srv.listenLan(5190); } catch (e) { return { error: `Couldn't open port 5190: ${e.message}` }; }
  });
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: 'Lightleak PvP', backgroundColor: '#120f0d', autoHideMenuBar: true, show: !SMOKE && !SHOTS,
    ...(SHOTS ? { width: 1280, height: 720, useContentSize: true } : {}),
    webPreferences: { offscreen: SHOTS, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${srv.port}/`)) e.preventDefault(); });
  await win.loadURL(`http://127.0.0.1:${srv.port}/`);
  if (SMOKE) await smoke();
  if (SHOTS) await shots();
}

// Each shot: which match to play, how long to let the bots play it, and where to put the camera.
// With `cam`, the HUD is hidden and the camera placed; with `stage`, js/stage.js sets up a moment
// in your own view.
const SHOT_LIST = [
  { name: 'title' },
  { name: 'contact-sheet', match: { size: 2, map: 'contact-sheet' }, play: 35, cam: { pos: [10.5, 6.2, -13], at: [0, 0, 1] } },
  { name: 'enlarger-floor', match: { size: 5, map: 'enlarger-floor' }, play: 45, cam: { pos: [-15, 9.5, -22], at: [0, 1, 2] } },
  { name: 'drying-hall', match: { size: 5, map: 'drying-hall' }, play: 40, cam: { pos: [11, 7.5, -22], at: [0, 1.5, 2] } },
  { name: 'ghost', match: { size: 1, map: 'contact-sheet', difficulty: 'easy' }, play: 2,
    stage: `S.freezeBots(); S.teleport(-5, -12, 0); await wait(500); S.photo(p => p.type === 'steel' && p.size[0] > 1 && p.pos[2] < 0); await wait(700); S.teleport(0, -6.4, Math.PI, -0.24); await wait(600); W.act('select:0'); await wait(900);` },
  { name: 'lock', match: { size: 1, map: 'contact-sheet', difficulty: 'easy' }, play: 2,
    stage: `S.freezeBots(); S.teleportEnemy(2, 2.5); S.teleport(-0.5, -7.5, Math.PI); await wait(600); S.aimAtEnemy(); await wait(1500); S.aimAtEnemy(); await wait(200);` },
];

async function shots() {
  const fs = require('fs');
  const root = path.join(__dirname, '..'), out = path.join(root, 'docs', 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  win.webContents.setFrameRate(30);
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (code, ms = 30000) => { for (const t = Date.now(); Date.now() - t < ms; await wait(250)) if (await js(code)) return true; return false; };
  await until('!!document.querySelector("#tab-practice button")');
  await wait(2000);
  for (const s of SHOT_LIST) {
    if (s.match) {
      await js(`window.__cam = null; document.getElementById('hud').style.visibility = ''; window.lightleakpvp.startPractice(${JSON.stringify({ mode: 'plates', difficulty: 'normal', fill: true, ...s.match })})`);
      await until('!!(window.lightleakpvp.game && window.lightleakpvp.game.phase === "live")');
      await wait(s.play * 1000);
      if (s.cam) await js(`window.__cam = ${JSON.stringify(s.cam)}; document.getElementById('hud').style.visibility = 'hidden'`);
      if (s.stage) await js(`(async () => { const S = await import('/js/stage.js'); const W = window.lightleakpvp; const wait = ms => new Promise(r => setTimeout(r, ms)); ${s.stage} })()`);
      await wait(1500);
    }
    win.webContents.invalidate();
    await wait(300);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${s.name}.jpg`), img.toJPEG(86));
    console.log(`${s.name.padEnd(16)} → docs/screenshots/${s.name}.jpg`);
    if (s.match) await js(`window.lightleakpvp.live.aimHeld = false`);
  }
  app.exit(0);
}

async function smoke() {
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (code, ms = 30000) => { for (const t = Date.now(); Date.now() - t < ms; await wait(250)) if (await js(code)) return true; return false; };
  const fail = why => { console.log(`FAIL  ${why}`); app.exit(1); };
  if (!await until('!!document.querySelector("#tab-practice button")')) return fail('the title screen never appeared');
  console.log('PASS  title screen');
  const lan = await js('window.desktop.hostLan()');
  if (lan.error) return fail(lan.error);
  console.log(`PASS  hosting on the network: ${lan.lan.join(', ') || '(no network address)'}`);
  await js(`window.lightleakpvp.startPractice({ size: 2, mode: 'plates', map: 'contact-sheet', difficulty: 'normal', fill: true })`);
  if (!await until('!!(window.lightleakpvp.game && window.lightleakpvp.game.phase === "live")')) return fail('the practice match never went live');
  await wait(6000);
  const s = JSON.parse(await js('JSON.stringify({ clock: window.lightleakpvp.game.clock, props: window.lightleakpvp.game.props.size })'));
  console.log(`PASS  practice match running (${Math.round(s.clock)} s left, ${s.props} objects)`);
  app.exit(0);
}

app.whenReady().then(boot).catch(e => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (srv) srv.close(); });
