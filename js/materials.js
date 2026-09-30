// Procedural textures and the materials built from them. Nothing here is loaded from disk.
//
// Architectural surfaces are painted as height, colour and roughness, and normal maps are derived
// from the height. They tile seamlessly (periodic noise) and are mapped in world space (see
// worldBox), so every wall's grid lines up with every other wall's: one panel is one metre, which
// keeps the grid useful as a ruler for judging sizes.
const THREE = window.THREE;

let aniso = 4;
const PX = 256;       // pixels per metre on architectural textures
const SPAN = 4;       // metres covered by one architectural texture before it repeats

// ---------- small helpers ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function paint(w, h, draw) { const c = canvas(w, h); draw(c.getContext('2d'), w, h); return c; }
function texture(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Seeded so textures look the same every run.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = t => t * t * (3 - 2 * t);

// Periodic value noise: tiles seamlessly across a `size` square.
function valueNoise(size, cells, seed) {
  const rand = rng(seed), lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size), s = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s, y0 = Math.floor(fy), ty = smooth(fy - y0), r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * s, x0 = Math.floor(fx), tx = smooth(fx - x0), c0 = x0 % cells, c1 = (x0 + 1) % cells;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
      const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}
function fbm(size, octaves, seed, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Height field → tangent-space normal map (OpenGL convention), wrapping at the edges.
function normalCanvas(h, size, strength) {
  const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (h[yr + xp] - h[yr + xm]) * strength;
      const dy = (h[yp + x] - h[ym + x]) * strength;
      let nx = -dx, ny = dy, nz = 1; // canvas y runs down the texture, so flip it for +v
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (yr + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Float fields → canvases.
function rgbCanvas(size, fill) {
  const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data, col = [0, 0, 0];
  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    fill(i, col);
    d[p] = clamp01(col[0]) * 255; d[p + 1] = clamp01(col[1]) * 255; d[p + 2] = clamp01(col[2]) * 255; d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function greyCanvas(size, field) { return rgbCanvas(size, (i, c) => { c[0] = c[1] = c[2] = field[i]; }); }
const hex = s => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];

// Distance (in pixels) from the nearest panel seam, for panels `cell` pixels across.
function seamDist(x, y, cell) { const u = x % cell, v = y % cell; return Math.min(u, v, cell - 1 - u, cell - 1 - v); }

// A panelled surface: per-panel tint, grooved seams, pores, stains. Returns a material.
function panelled(opts) {
  const size = PX * SPAN, cell = PX * (opts.panel || 1);
  const { seed } = opts;
  const rand = rng(seed);
  const cellsAcross = size / cell;
  const tint = Array.from({ length: cellsAcross * cellsAcross }, () => 1 + (rand() - 0.5) * (opts.vary ?? 0.1));
  const rvar = Array.from({ length: cellsAcross * cellsAcross }, () => (rand() - 0.5) * 0.1);
  const macro = fbm(size, 4, seed + 1, 2);        // big stains and mottling
  const micro = fbm(size, 3, seed + 2, 32);       // surface grain
  const h = new Float32Array(size * size), rough = new Float32Array(size * size), shade = new Float32Array(size * size);
  const pores = [];
  for (let i = 0; i < (opts.pores || 0); i++) pores.push([rand() * size, rand() * size, 1 + rand() * 2.5]);
  const streaks = [];
  for (let i = 0; i < (opts.streaks || 0); i++) streaks.push([Math.floor(rand() * size), rand() * cell * 0.8, 2 + rand() * 5, rand() * 0.12]);
  const groove = opts.groove ?? 5, chamfer = opts.chamfer ?? 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, ci = Math.floor(y / cell) * cellsAcross + Math.floor(x / cell);
    const sd = seamDist(x, y, cell);
    const edge = sd < groove ? 0 : sd < groove + chamfer ? smooth((sd - groove) / chamfer) : 1;
    h[i] = edge * 0.9 + micro[i] * 0.1;
    let s = tint[ci] * (0.86 + macro[i] * 0.28) * (0.94 + micro[i] * 0.12);
    if (sd < groove) s *= 0.78;
    shade[i] = s;
    rough[i] = clamp01((opts.rough ?? 0.85) + rvar[ci] + (macro[i] - 0.5) * (opts.roughVar ?? 0.15) + (sd < groove ? 0.1 : 0));
  }
  for (const [px, py, r] of pores) for (let y = Math.floor(py - r); y <= py + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) {
    const xx = (x + size) % size, yy = (y + size) % size, d = Math.hypot(x - px, y - py);
    if (d < r) { const i = yy * size + xx; h[i] -= 0.25 * (1 - d / r); shade[i] *= 0.8; }
  }
  // water streaks running down from the top of some panels
  for (const [x0, len, w, dark] of streaks) {
    const top = Math.floor(rand() * cellsAcross) * cell + groove + chamfer;
    for (let y = top; y < top + len; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y % size) * size + (x % size), fade = 1 - (y - top) / len;
      shade[i] *= 1 - dark * fade; rough[i] = clamp01(rough[i] - 0.08 * fade);
    }
  }
  const col = hex(opts.color);
  const map = rgbCanvas(size, (i, c) => { const s = shade[i]; c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s; });
  const mat = new THREE.MeshStandardMaterial({
    map: texture(map, { repeat: true }),
    normalMap: texture(normalCanvas(h, size, opts.bump ?? 6), { repeat: true, srgb: false }),
    roughnessMap: texture(greyCanvas(size, rough), { repeat: true, srgb: false }),
    roughness: 1, metalness: opts.metal ?? 0, envMapIntensity: opts.env ?? 0.5,
  });
  mat.normalScale.set(1, 1);
  return mat;
}

// ---------- props (textured once per face) ----------
function propSurface(size, draw, heightFn, roughFn, strength) {
  const h = new Float32Array(size * size), r = new Float32Array(size * size);
  const noise = fbm(size, 3, size + 7, 16);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    h[i] = heightFn(x, y, noise[i]);
    r[i] = roughFn(x, y, noise[i]);
  }
  return {
    map: texture(paint(size, size, draw)),
    normalMap: texture(normalCanvas(h, size, strength), { srgb: false }),
    roughnessMap: texture(greyCanvas(size, r), { srgb: false }),
  };
}
function grain(g, w, h, n, alpha, rand) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * alpha})` : `rgba(255,255,255,${rand() * alpha * 0.6})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export const MAT = {};
export const PROP = {};
export const PRINT_TEX = [];
export let ENV = null;

export function initMaterials(renderer) {
  aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  Object.assign(MAT, {
    // cast concrete wall panels, weathered
    wall: panelled({ seed: 3, color: '#6b645c', rough: 0.86, pores: 900, streaks: 60, bump: 7, vary: 0.12 }),
    // lower-wall panelling: darker, smoother, half-metre boards
    wainscot: panelled({ seed: 41, color: '#3d3833', rough: 0.6, roughVar: 0.2, panel: 0.5, groove: 3, chamfer: 3, bump: 5, vary: 0.08, env: 0.6 }),
    // sealed concrete floor tiles: darker and a little glossy in patches
    floor: panelled({ seed: 5, color: '#3b3530', rough: 0.55, roughVar: 0.45, pores: 300, groove: 3, chamfer: 2, bump: 5, vary: 0.14, env: 0.8 }),
    // perforated acoustic ceiling tiles
    ceil: ceilingMaterial(),
    // terrazzo for ledges and plinths
    ledge: terrazzoMaterial(),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 1 }),
    door: ribbedMetal('#343a3f', 11),
    trim: brushedMetal('#26292c', 17),
    trimLight: brushedMetal('#5a534b', 19),
    safelight: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff4a2a, emissiveIntensity: 2.2 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe6c8, emissiveIntensity: 2.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd8ebe6, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, reflectivity: 0.6, envMapIntensity: 1.2, depthWrite: false }),
    emulsion: emulsionMaterial(),
    // decor
    wood: new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.7 }),
    metal: brushedMetal('#2c2f31', 23),
    tray: new THREE.MeshStandardMaterial({ color: 0xe0d9ca, roughness: 0.35 }),
    liquid: new THREE.MeshStandardMaterial({ color: 0x4a140c, roughness: 0.02, metalness: 0.1, envMapIntensity: 1.5 }),
    string: new THREE.LineBasicMaterial({ color: 0x8a7a66 }),
  });

  PROP.crate = crateSurface();
  PROP.steel = steelSurface();
  PROP.plank = plankSurface();

  // Prints that hang on the drying lines: blurry sepia "photos" of nothing in particular.
  for (let i = 0; i < 6; i++) {
    const rand = rng(100 + i * 7);
    PRINT_TEX.push(texture(paint(96, 120, (g, w, h) => {
      g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
      const grd = g.createLinearGradient(0, 8, 0, 96);
      grd.addColorStop(0, `hsl(28, 25%, ${50 + rand() * 20}%)`); grd.addColorStop(1, `hsl(20, 30%, ${15 + rand() * 20}%)`);
      g.fillStyle = grd; g.fillRect(8, 8, w - 16, 88);
      g.fillStyle = `rgba(30,18,10,${0.4 + rand() * 0.3})`;
      for (let k = 0; k < 3; k++) { const s = 10 + rand() * 26; g.fillRect(8 + rand() * (w - 16 - s), 96 - s - rand() * 30, s, s); }
    })));
  }

  ENV = buildEnvironment(renderer);
}

function ceilingMaterial() {
  const size = PX * SPAN, h = new Float32Array(size * size), micro = fbm(size, 2, 71, 32);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, sd = seamDist(x, y, PX);
    const hole = (x % 16 - 8) ** 2 + (y % 16 - 8) ** 2 < 5 && sd > 14;
    h[i] = (sd < 4 ? 0 : 1) - (hole ? 0.5 : 0) + micro[i] * 0.05;
  }
  const col = hex('#2a2521');
  const map = rgbCanvas(size, (i, c) => { const s = 0.75 + h[i] * 0.25 + micro[i] * 0.1; c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s; });
  return new THREE.MeshStandardMaterial({
    map: texture(map, { repeat: true }),
    normalMap: texture(normalCanvas(h, size, 4), { repeat: true, srgb: false }),
    roughness: 0.95, envMapIntensity: 0.2,
  });
}

function terrazzoMaterial() {
  const size = PX * SPAN, rand = rng(29);
  const base = fbm(size, 3, 31, 8), shade = new Float32Array(size * size), chips = new Float32Array(size * size), h = new Float32Array(size * size);
  const chipCol = new Float32Array(size * size).fill(-1);
  for (let i = 0; i < 26000; i++) {
    const cx = rand() * size, cy = rand() * size, r = 0.8 + rand() * 1.8, v = rand();
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (Math.hypot(x - cx, (y - cy) * 1.3) < r) chipCol[((y + size) % size) * size + ((x + size) % size)] = v;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, sd = seamDist(x, y, PX);
    h[i] = sd < 3 ? 0 : 1;
    shade[i] = 0.9 + base[i] * 0.2;
    chips[i] = chipCol[i];
  }
  const col = hex('#8a8074');
  const map = rgbCanvas(size, (i, c) => {
    let s = shade[i];
    if (chips[i] >= 0) s *= chips[i] < 0.5 ? 0.78 + chips[i] * 0.2 : 1.04 + chips[i] * 0.1;
    if (h[i] === 0) s *= 0.72;
    c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s * (chips[i] > 0.9 ? 0.8 : 1);
  });
  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = 0.45 + base[i] * 0.25 + (h[i] === 0 ? 0.3 : 0);
  return new THREE.MeshStandardMaterial({
    map: texture(map, { repeat: true }),
    normalMap: texture(normalCanvas(h, size, 3), { repeat: true, srgb: false }),
    roughnessMap: texture(greyCanvas(size, rough), { repeat: true, srgb: false }),
    roughness: 1, envMapIntensity: 0.7,
  });
}

function brushedMetal(color, seed) {
  const size = 512, rand = rng(seed), streak = new Float32Array(size * size);
  const rows = Array.from({ length: size }, () => rand());
  const n = fbm(size, 2, seed, 8);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) streak[y * size + x] = rows[y] * 0.5 + n[y * size + x] * 0.5;
  const col = hex(color);
  const map = rgbCanvas(size, (i, c) => { const s = 0.85 + streak[i] * 0.3; c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s; });
  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = 0.32 + streak[i] * 0.2;
  return new THREE.MeshStandardMaterial({
    map: texture(map, { repeat: true }), roughnessMap: texture(greyCanvas(size, rough), { repeat: true, srgb: false }),
    roughness: 1, metalness: 0.75, envMapIntensity: 0.9,
  });
}

function ribbedMetal(color, seed) {
  const size = PX * SPAN, rand = rng(seed), h = new Float32Array(size * size), n = fbm(size, 3, seed, 16);
  const scratches = [];
  for (let i = 0; i < 160; i++) scratches.push([rand() * size, rand() * size, (rand() - 0.5) * 0.6, 20 + rand() * 90]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, u = x % 64;
    h[i] = (u < 6 ? smooth(u / 6) : u > 58 ? smooth((64 - u) / 6) : 1) + n[i] * 0.04;
    const rv = (x % 64 - 32) ** 2 + (y % 128 - 64) ** 2;
    if (rv < 20) h[i] += 0.5 * (1 - rv / 20);
  }
  const col = hex(color), mark = new Float32Array(size * size);
  for (const [sx, sy, slope, len] of scratches) for (let t = 0; t < len; t++) { const x = Math.floor(sx + t) % size, y = Math.floor(sy + t * slope + size) % size; mark[y * size + x] = 1; }
  const map = rgbCanvas(size, (i, c) => { const s = (0.8 + n[i] * 0.3) * (mark[i] ? 1.5 : 1) * (0.7 + h[i] * 0.3); c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s; });
  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = 0.4 + n[i] * 0.2 + (mark[i] ? -0.15 : 0);
  return new THREE.MeshStandardMaterial({
    map: texture(map, { repeat: true }), normalMap: texture(normalCanvas(h, size, 5), { repeat: true, srgb: false }),
    roughnessMap: texture(greyCanvas(size, rough), { repeat: true, srgb: false }), roughness: 1, metalness: 0.65, envMapIntensity: 1,
  });
}

// Emulsion: the light-sensitive film that negatives can dissolve. Wet-looking, with slow ripples.
function emulsionMaterial() {
  const size = 512, n = fbm(size, 4, 51, 4), rand = rng(52);
  const h = new Float32Array(size * size), shade = new Float32Array(size * size);
  const drips = Array.from({ length: 14 }, () => [Math.floor(rand() * size), 60 + rand() * 260, 2 + rand() * 4]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    h[i] = n[i] + Math.sin((y + n[i] * 40) * 0.05) * 0.08;
    shade[i] = 0.75 + n[i] * 0.5;
  }
  for (const [x0, len, w] of drips) for (let y = 0; y < len; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * size + (x % size), f = 1 - y / len; h[i] += 0.3 * f; shade[i] += 0.25 * f;
  }
  const col = hex('#2a0805');
  const map = rgbCanvas(size, (i, c) => { const s = shade[i]; c[0] = col[0] * s; c[1] = col[1] * s; c[2] = col[2] * s; });
  const m = new THREE.MeshPhysicalMaterial({
    map: texture(map, { repeat: true }), normalMap: texture(normalCanvas(h, size, 3), { repeat: true, srgb: false }),
    roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3,
    emissive: 0x2a0603, emissiveIntensity: 0.5,
  });
  return m;
}

function crateSurface() {
  const size = 512, rand = rng(11), board = 34, brace = 30;
  const onFrame = (x, y) => x < board || y < board || x > size - board || y > size - board;
  const surf = propSurface(size, (g, w, h) => {
    g.fillStyle = '#9a6b3c'; g.fillRect(0, 0, w, h);
    // planks
    for (let y = 0, k = 0; y < h; y += 64, k++) { g.fillStyle = `hsl(28, ${38 + (k % 3) * 4}%, ${38 + ((k * 7) % 5) * 2}%)`; g.fillRect(0, y, w, 62); }
    for (let i = 0; i < 180; i++) { g.strokeStyle = `rgba(60,36,16,${0.1 + rand() * 0.2})`; g.lineWidth = 1; const y = rand() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w / 3, y + rand() * 6 - 3, w * 2 / 3, y + rand() * 6 - 3, w, y + rand() * 4 - 2); g.stroke(); }
    grain(g, w, h, 5000, 0.12, rand);
    // frame and brace: darker boards
    g.fillStyle = 'rgba(70,44,22,0.55)';
    g.fillRect(0, 0, w, board); g.fillRect(0, h - board, w, board); g.fillRect(0, 0, board, h); g.fillRect(w - board, 0, board, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 4); g.fillRect(-w * 0.7, -brace / 2, w * 1.4, brace); g.restore();
    // worn edges
    g.strokeStyle = 'rgba(210,170,120,0.35)'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#2a1b0e';
    for (const [x, y] of [[17, 17], [w - 17, 17], [17, h - 17], [w - 17, h - 17], [w / 2, 17], [w / 2, h - 17], [17, h / 2], [w - 17, h / 2]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  }, (x, y, n) => {
    const plankGap = y % 64 < 2 ? -0.4 : 0;
    const raised = onFrame(x, y) || Math.abs(x - (size - y)) / Math.SQRT2 < brace / 2 ? 0.5 : 0;
    const edge = Math.min(x, y, size - 1 - x, size - 1 - y) < 3 ? -0.3 : 0;
    return raised + plankGap + edge + n * 0.12;
  }, (x, y, n) => 0.7 + n * 0.25, 5);
  return { ...surf, roughness: 1, metalness: 0 };
}

function steelSurface() {
  const size = 512, rand = rng(23), bev = 26;
  const surf = propSurface(size, (g, w, h) => {
    g.fillStyle = '#6d757a'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 7000, 0.1, rand);
    g.fillStyle = 'rgba(30,34,36,0.45)'; g.fillRect(bev, bev, w - bev * 2, h - bev * 2);
    // a painted hazard band, chipped
    g.save(); g.beginPath(); g.rect(bev + 20, h / 2 - 34, w - bev * 2 - 40, 68); g.clip();
    for (let x = -80, i = 0; x < w; x += 36, i++) { g.fillStyle = i % 2 ? '#1c1a18' : '#d8a42c'; g.beginPath(); g.moveTo(x, h / 2 + 34); g.lineTo(x + 36, h / 2 + 34); g.lineTo(x + 104, h / 2 - 34); g.lineTo(x + 68, h / 2 - 34); g.fill(); }
    for (let i = 0; i < 90; i++) { g.fillStyle = '#5c6367'; g.beginPath(); g.arc(bev + 20 + rand() * (w - bev * 2 - 40), h / 2 - 34 + rand() * 68, 1 + rand() * 4, 0, 7); g.fill(); }
    g.restore();
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(210,215,218,${0.1 + rand() * 0.25})`; g.lineWidth = 1; const x = rand() * w, y = rand() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 80, y + (rand() - 0.5) * 30); g.stroke(); }
    g.fillStyle = '#a4acb0';
    for (const x of [bev / 2, w - bev / 2]) for (const y of [bev / 2, h - bev / 2, h / 2]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
  }, (x, y, n) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    let h = d < bev ? 0.6 + 0.4 * (d / bev) : 0.8;
    for (const cx of [bev / 2, size - bev / 2]) for (const cy of [bev / 2, size - bev / 2, size / 2]) { const r = Math.hypot(x - cx, y - cy); if (r < 7) h += 0.5 * (1 - r / 7); }
    return h + n * 0.03;
  }, (x, y, n) => 0.3 + n * 0.3, 6);
  return { ...surf, roughness: 1, metalness: 0.7 };
}

function plankSurface() {
  const size = 512, rand = rng(37), n2 = fbm(size, 3, 38, 8);
  const surf = propSurface(size, (g, w, h) => {
    g.fillStyle = '#b8894f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const x = rand() * w; g.strokeStyle = `rgba(110,72,36,${0.15 + rand() * 0.3})`; g.lineWidth = 1 + rand() * 2; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 14 * (rand() - 0.5), h / 3, x - 14 * (rand() - 0.5), h * 2 / 3, x + 5, h); g.stroke(); }
    for (let k = 0; k < 3; k++) { const cx = rand() * w, cy = rand() * h; g.strokeStyle = 'rgba(90,56,26,0.5)'; for (let r = 3; r < 16; r += 3) { g.beginPath(); g.ellipse(cx, cy, r * 0.6, r * 1.6, 0, 0, 7); g.stroke(); } }
    grain(g, w, h, 3000, 0.1, rand);
    g.strokeStyle = 'rgba(70,46,22,0.6)'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  }, (x, y) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    return (d < 10 ? d / 10 : 1) + n2[y * size + x] * 0.08 + Math.sin(x * 0.35 + n2[y * size + x] * 8) * 0.03;
  }, (x, y, n) => 0.65 + n * 0.25, 4);
  return { ...surf, roughness: 1, metalness: 0 };
}

// A dim, warm room with bright ceiling panels and a red strip, prefiltered for reflections.
function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 20), new THREE.MeshBasicMaterial({ color: 0x2a2420, side: THREE.BackSide }));
  room.position.y = 3; scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x14110f }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.99; scene.add(floor);
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4], [0, 0]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.78).multiplyScalar(6) }));
    p.rotation.x = Math.PI / 2; p.position.set(x, 6.9, z); scene.add(p);
  }
  const red = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.12).multiplyScalar(3) }));
  red.position.set(0, 3.5, -9.9); scene.add(red);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return env;
}

// Box geometry mapped in world space, one texture across SPAN metres, so neighbouring boxes'
// panels line up. `min`/`max` are the box's world corners; the geometry is centred on its middle.
export function worldBox(min, max) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const cx = min[0] + w / 2, cy = min[1] + h / 2, cz = min[2] + d / 2;
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k, x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
    let u, v;
    if (f === 0) { u = -z; v = y; } else if (f === 1) { u = z; v = y; }
    else if (f === 2) { u = x; v = -z; } else if (f === 3) { u = x; v = z; }
    else if (f === 4) { u = x; v = y; } else { u = -x; v = y; }
    uv.setXY(i, u / SPAN, v / SPAN);
  }
  return g;
}

export function propMaterial(type) {
  const p = PROP[type];
  return new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap, roughness: p.roughness, metalness: p.metalness, envMapIntensity: 0.8 });
}

// A canvas the page can draw on repeatedly (plate readouts).
export function canvasTexture(w, h) {
  const c = canvas(w, h);
  return { canvas: c, tex: texture(c) };
}

// Painted signage: stencilled text on a transparent background, for decals.
export function stencilTexture(lines, { w = 512, h = 256, color = 'rgba(214,205,188,0.85)' } = {}) {
  const c = paint(w, h, (g) => {
    g.fillStyle = color; g.textBaseline = 'top';
    let y = 8;
    for (const [text, size, weight = 800] of lines) {
      g.font = `${weight} ${size}px "Arial Narrow", "Segoe UI", system-ui, sans-serif`;
      g.fillText(text, 8, y); y += size * 1.05;
    }
    // weather it: knock pixels out so it reads as paint on concrete
    const img = g.getImageData(0, 0, w, h), d = img.data, rand = rng(lines.length * 13 + w);
    for (let i = 3; i < d.length; i += 4) if (d[i] && rand() < 0.18) d[i] *= 0.3 + rand() * 0.4;
    g.putImageData(img, 0, 0);
  });
  const t = texture(c); t.premultiplyAlpha = false;
  return t;
}

// An index card with a typed title and ruled lines (the text itself shows in the HUD).
export function cardTexture(title) {
  const c = paint(256, 170, (g, w, h) => {
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 900, 0.06, rng(title.length + 3));
    g.strokeStyle = '#c0412e'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 34); g.lineTo(w, 34); g.stroke();
    g.strokeStyle = '#9fb3c4'; g.lineWidth = 1;
    for (let y = 56; y < h; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#2a2320'; g.font = '700 17px ui-monospace, Consolas, monospace';
    g.fillText(title.toUpperCase().slice(0, 22), 12, 26);
    g.fillStyle = '#3b332b88';
    for (let y = 50, i = 0; y < h - 10; y += 20, i++) g.fillRect(12, y, 90 + ((i * 53) % 130), 4);
  });
  return texture(c);
}

// Pebbled black leatherette for the camera body.
let leather = null;
export function leatherMaterial() {
  if (leather) return leather;
  const size = 256, rand = rng(61), h = new Float32Array(size * size), n = fbm(size, 2, 62, 32);
  for (let i = 0; i < 2600; i++) {
    const cx = rand() * size, cy = rand() * size, r = 2 + rand() * 3;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy); if (d < r) { const k = ((y + size) % size) * size + ((x + size) % size); h[k] = Math.max(h[k], 1 - d / r); }
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.8 + n[i] * 0.2;
  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = 0.72 + (1 - h[i]) * 0.25;
  leather = new THREE.MeshStandardMaterial({
    color: 0x0b0a09, roughness: 1, metalness: 0, envMapIntensity: 0.15,
    normalMap: texture(normalCanvas(h, size, 2.5), { repeat: true, srgb: false }),
    roughnessMap: texture(greyCanvas(size, rough), { repeat: true, srgb: false }),
  });
  leather.normalMap.repeat.set(3, 3); leather.roughnessMap.repeat.set(3, 3);
  return leather;
}

// Soft round sprite for dust motes and light shafts.
export function softDot(size = 64) {
  return texture(paint(size, size, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  }), { srgb: false });
}
// Vertical fade for light shafts: bright at the top, gone at the bottom.
export function shaftTexture() {
  return texture(paint(8, 256, (g, w, h) => {
    const r = g.createLinearGradient(0, 0, 0, h);
    r.addColorStop(0, 'rgba(255,236,210,1)'); r.addColorStop(0.25, 'rgba(255,236,210,0.35)'); r.addColorStop(0.8, 'rgba(255,236,210,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }), { srgb: false });
}

// Film grain for the HUD overlay.
export function grainDataURL() {
  const rand = rng(77);
  return paint(160, 160, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }).toDataURL();
}
