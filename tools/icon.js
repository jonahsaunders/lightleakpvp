'use strict';
// Draws the app icon (desktop/icon.png, 512×512) with no image libraries: Lightleak's lens, its
// aperture split between the two teams' colours, and a streak of light leaking across the line.
// Run: node tools/icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 512;
const px = Buffer.alloc(N * N * 4);
const mix = (a, b, t) => a + (b - a) * t;
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
    // rounded-square tile
    const q = Math.max(Math.abs(u), Math.abs(v));
    const corner = Math.hypot(Math.max(Math.abs(u) - 0.78, 0), Math.max(Math.abs(v) - 0.78, 0));
    let a = q < 0.78 ? 1 : corner < 0.2 ? 1 : 0;
    if (corner >= 0.2 && corner < 0.215 && q >= 0.78) a = (0.215 - corner) / 0.015;
    let r = 18, g = 15, b = 13;
    const d = Math.hypot(u, v);
    // lens barrel and glass
    if (d < 0.72) { r = 34; g = 29; b = 26; }
    if (d < 0.62) { const t = d / 0.62; r = mix(58, 20, t); g = mix(22, 12, t); b = mix(16, 10, t); }
    // six-bladed aperture opening
    const ang = Math.atan2(v, u);
    const hex = 0.3 / Math.cos(((ang + Math.PI / 6) % (Math.PI / 3) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6);
    if (d < hex) {
      const t = d / hex, cyan = u - v * 0.35 > 0.02, seam = Math.abs(u - v * 0.35 - 0.02) < 0.018;
      if (seam) { r = 20; g = 16; b = 14; }
      else if (cyan) { r = mix(150, 56, t); g = mix(214, 150, t); b = mix(240, 206, t); }
      else { r = mix(250, 216, t); g = mix(120, 69, t); b = mix(90, 47, t); }
    }
    // the light leak: a warm diagonal streak
    const s = Math.abs(u * 0.7 + v * 0.7 + 0.15);
    const leak = Math.max(0, 1 - s / 0.22) * Math.max(0, 1 - Math.abs(u - v) / 1.8) * 0.75;
    r = mix(r, 255, leak); g = mix(g, 196, leak); b = mix(b, 150, leak);
    const i = (y * N + x) * 4;
    px[i] = clamp(r); px[i + 1] = clamp(g); px[i + 2] = clamp(b); px[i + 3] = clamp(a * 255);
  }
}

// minimal PNG encoder
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'desktop', 'icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
