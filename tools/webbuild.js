'use strict';
// Builds the static web version (for itch.io or any static host) into build/web, and zips it to
// build/lightleakpvp-web.zip when a zip tool is available. Practice works anywhere; online play
// needs the address of a Lightleak PvP server (npm run server).
//   npm run web
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'web');
const ZIP = path.join(ROOT, 'build', 'lightleakpvp-web.zip');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of ['index.html', 'js', 'shared', 'vendor', 'maps', 'LICENSES.md']) {
  fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true });
}
fs.mkdirSync(path.join(OUT, 'desktop'));
fs.copyFileSync(path.join(ROOT, 'desktop', 'icon.png'), path.join(OUT, 'desktop', 'icon.png'));

// Zip with whatever the system has: bsdtar (Windows 10+, macOS) writes a zip when the name
// ends in .zip; GNU tar can't, so fall back to `zip` or PowerShell.
const attempts = [
  ...(process.platform === 'win32' ? [['C:\\Windows\\System32\\tar.exe', ['-a', '-c', '-f', ZIP, '-C', OUT, '.']]] : []),
  ['tar', ['-a', '-c', '-f', ZIP, '-C', OUT, '.']],
  ['zip', ['-r', '-q', ZIP, '.'], { cwd: OUT }],
  ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${ZIP}' -Force`]],
];
let zipped = false;
for (const [cmd, args, opts] of attempts) {
  try {
    fs.rmSync(ZIP, { force: true });
    execFileSync(cmd, args, { stdio: 'ignore', ...opts });
    // GNU tar ignores -a and writes a tarball: check it's really a zip ("PK")
    if (fs.existsSync(ZIP) && fs.readFileSync(ZIP).subarray(0, 2).toString() === 'PK') { zipped = true; break; }
  } catch (e) { /* try the next one */ }
}
if (!zipped) fs.rmSync(ZIP, { force: true });

const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`Web build: ${path.relative(ROOT, OUT)} (${(size(OUT) / 1e6).toFixed(1)} MB)`);
console.log(zipped ? `Zipped:    ${path.relative(ROOT, ZIP)} — upload this to itch.io as an HTML game.` : 'Zip the build/web folder yourself to upload it.');
