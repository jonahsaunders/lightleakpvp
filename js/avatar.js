// Other players, as you see them: prints come to life. A pale paper figure in a darkroom apron of
// its team's colour, carrying a camera. It walks, raises the camera to its eye to aim (the lens
// glows while it's pulling focus), whitens as it takes exposure, and burns out when it's ruined.
import { TEAMS } from '../shared/config.js';
import { leatherMaterial } from './materials.js';

const THREE = window.THREE;

function mat(color, rough = 0.8, metal = 0, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, envMapIntensity: 0.6 });
}

export class Avatar {
  constructor(team, name, { mate = false } = {}) {
    const tc = new THREE.Color(TEAMS[team].hex);
    this.team = team;
    this.group = new THREE.Group();
    this.mats = [];
    const own = m => { this.mats.push(m); return m; };
    const paper = own(mat(0xe9e1cf, 0.7)), cloth = own(mat(0x1d1a18, 0.9));
    const apron = own(mat(tc.clone().multiplyScalar(0.75), 0.65, 0, tc.clone().multiplyScalar(0.12)));
    const trim = own(mat(0x2a2623, 0.5, 0.6));
    const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const box = (parent, w, h, d, m, x, y, z) => add(parent, new THREE.BoxGeometry(w, h, d), m, x, y, z);

    // legs swing from the hips
    this.legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.position.set(0.1 * s, 0.86, 0); this.group.add(hip);
      box(hip, 0.14, 0.82, 0.16, cloth, 0, -0.41, 0);
      box(hip, 0.15, 0.08, 0.24, trim, 0, -0.82, -0.04);
      return hip;
    });
    this.body = new THREE.Group(); this.body.position.y = 0.86; this.group.add(this.body);
    box(this.body, 0.42, 0.62, 0.24, cloth, 0, 0.31, 0);
    box(this.body, 0.38, 0.78, 0.02, apron, 0, 0.12, -0.13);               // the apron, front and back straps
    box(this.body, 0.05, 0.3, 0.02, apron, -0.14, 0.5, 0.13);
    box(this.body, 0.05, 0.3, 0.02, apron, 0.14, 0.5, 0.13);
    box(this.body, 0.44, 0.05, 0.26, apron, 0, 0.2, 0);                    // a band round the middle
    // head: a paper face with darkroom goggles
    this.head = new THREE.Group(); this.head.position.y = 0.72; this.body.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.13, 20, 14), paper, 0, 0.02, 0);
    box(this.head, 0.24, 0.05, 0.06, trim, 0, 0.04, -0.1);
    const lensMat = own(mat(0x101418, 0.1, 0.3, tc.clone().multiplyScalar(0.5)));
    for (const s of [-1, 1]) add(this.head, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), lensMat, 0.055 * s, 0.04, -0.13).rotation.x = Math.PI / 2;
    add(this.head, new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), apron, 0, 0.05, 0.02).scale.set(1, 0.8, 1.05); // cap
    // arms and the camera: the camera rides on its own group so it can come up to the eye
    this.arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.position.set(0.27 * s, 0.56, 0); this.body.add(sh);
      box(sh, 0.1, 0.52, 0.1, cloth, 0, -0.26, 0);
      add(sh, new THREE.SphereGeometry(0.055, 10, 8), paper, 0, -0.54, 0);
      return sh;
    });
    this.cam = new THREE.Group(); this.body.add(this.cam);
    box(this.cam, 0.17, 0.09, 0.06, leatherMaterial(), 0, 0, 0);
    box(this.cam, 0.172, 0.018, 0.062, trim, 0, 0.05, 0);
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0x0b1014, emissive: tc, emissiveIntensity: 0.2, roughness: 0.1 });
    this.mats.push(this.lensMat);
    add(this.cam, new THREE.CylinderGeometry(0.035, 0.038, 0.06, 18), this.lensMat, 0, -0.005, -0.055).rotation.x = Math.PI / 2;
    this.bulb = add(this.cam, new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }), 0.06, 0.06, -0.02);
    this.bulb.visible = false;
    this.flashLight = new THREE.PointLight(0xfff2de, 0, 14, 2);
    this.flashLight.position.set(0, 0, -0.2); this.cam.add(this.flashLight);

    // a name over the head: always for your team, when you look at them for the other
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '700 30px system-ui, "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(12,10,9,0.55)'; const w = Math.min(250, g.measureText(name).width + 28); g.fillRect(128 - w / 2, 10, w, 44);
    g.fillStyle = TEAMS[team].color; g.fillRect(128 - w / 2, 50, w, 4);
    g.fillStyle = '#efe6d2'; g.fillText(name, 128, 43);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    this.tag.scale.set(1.0, 0.25, 1); this.tag.position.y = 2.15; this.tag.renderOrder = 10; this.tag.userData.noAO = true;
    this.group.add(this.tag);
    this.mate = mate;

    this.walk = 0; this.raise = 0; this.flashT = 0; this.dead = 0; this.exposure = 0; this.glow = 0;
    this.group.traverse(o => { o.userData.noAO = o.userData.noAO || false; });
  }

  // state: { pos, yaw, pitch, aim, speed, exposure, safe, focus (0..1), tagVisible }
  update(dt, s) {
    const g = this.group;
    g.position.set(s.pos[0], s.pos[1], s.pos[2]);
    g.rotation.y = s.yaw;
    this.walk += dt * Math.min(s.speed, 6) * 1.9;
    const swing = Math.sin(this.walk) * Math.min(1, s.speed / 3) * 0.6;
    this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
    this.raise += ((s.aim ? 1 : 0) - this.raise) * Math.min(1, dt * 10);
    const r = this.raise, p = s.pitch;
    this.head.rotation.x = p * 0.8;
    this.body.rotation.x = p * 0.15;
    // the camera comes up from the chest to the eye, and points where they look
    this.cam.position.set(0.02, 0.36 + (0.72 - 0.36) * r + Math.sin(p) * 0.25 * r, -0.2 - 0.06 * r);
    this.cam.rotation.x = p * (0.3 + 0.7 * r);
    for (const [i, a] of this.arms.entries()) {
      a.rotation.x = 0.55 + 0.85 * r + p * r * 0.8 + (i ? -swing : swing) * 0.4 * (1 - r);
      a.rotation.z = (i ? -1 : 1) * 0.25 * (0.6 + r);
    }
    // pulling focus: the lens glows brighter
    this.lensMat.emissiveIntensity = 0.25 + (s.focus || 0) * 3.5 + (this.flashT > 0 ? 6 : 0);
    // the flash itself
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flashLight.intensity = this.flashT * 60;
      this.bulb.visible = this.flashT > 0.08;
    } else { this.flashLight.intensity = 0; this.bulb.visible = false; }
    // exposure whitens them; spawn protection shimmers
    this.exposure += (s.exposure - this.exposure) * Math.min(1, dt * 6);
    this.glow = Math.max(0, this.glow - dt * 3);
    const white = Math.min(1.5, this.exposure * 0.35 + this.glow + (s.safe ? 0.25 + Math.sin(performance.now() / 90) * 0.15 : 0));
    for (const m of this.mats) if (m !== this.lensMat) { if (!m.userData.base) m.userData.base = m.emissive.clone(); m.emissive.copy(m.userData.base).lerp(new THREE.Color(1, 0.96, 0.9), Math.min(1, white)); }
    this.tag.visible = s.tagVisible;
    // burning out
    if (this.dead > 0) {
      this.dead += dt;
      const k = Math.min(1, this.dead / 0.9);
      g.scale.set(1 + k * 0.1, 1 - k * 0.95, 1 + k * 0.1);
      for (const m of this.mats) { m.transparent = true; m.opacity = 1 - k; m.emissive.setRGB(1, 0.9 - k * 0.5, 0.8 - k * 0.7); }
      if (k >= 1) g.visible = false;
    }
  }
  fire() { this.flashT = 0.18; }
  hit() { this.glow = 1; }
  die() { if (this.dead <= 0) this.dead = 0.001; }
  revive() {
    this.dead = 0; this.group.visible = true; this.group.scale.set(1, 1, 1);
    for (const m of this.mats) { m.transparent = false; m.opacity = 1; if (m.userData.base) m.emissive.copy(m.userData.base); }
  }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.tag.material.map.dispose(); this.tag.material.dispose();
  }
}
