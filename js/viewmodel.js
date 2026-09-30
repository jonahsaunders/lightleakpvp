// The camera in your hands, and the photo you're holding. Cosmetic only; driven by events and
// the per-frame state. An original design: a small rangefinder-style body with a film lever.
import { G } from './state.js';
import { leatherMaterial } from './materials.js';

const THREE = window.THREE;
let root = null, cam = null, button = null, lever = null, printMesh = null, card = null, cardMat = null, negLamp = null;
let t = 0, bob = 0, swayX = 0, swayY = 0, lastYaw = 0, lastPitch = 0;
let raise = 0, shotT = -1, devT = -1, cardIn = 0, cardFor = null, cardRot = -1, switchT = -1;

function mat(color, rough, metal = 0) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 1 }); }

export function initViewmodel() {
  root = new THREE.Group();
  root.userData.noAO = true;
  G.camera.add(root);

  cam = new THREE.Group();
  cam.scale.setScalar(0.85);
  root.add(cam);
  const leather = leatherMaterial(), chrome = mat(0x7d7870, 0.32, 0.85), black = mat(0x0c0c0d, 0.45, 0.3);
  chrome.envMapIntensity = 0.7;
  const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); cam.add(o); return o; };
  const cyl = (r0, r1, h, x, y, z, m, seg = 28) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); cam.add(o); return o; };
  box(0.15, 0.078, 0.048, 0, 0, 0, leather);                   // body
  box(0.152, 0.016, 0.05, 0, 0.047, 0, chrome);               // top plate
  box(0.152, 0.008, 0.05, 0, -0.043, 0, chrome);              // base plate
  box(0.024, 0.016, 0.004, -0.052, 0.022, -0.026, mat(0x223036, 0.05, 0.2)); // viewfinder window
  box(0.012, 0.012, 0.004, 0.056, 0.022, -0.026, mat(0x223036, 0.05, 0.2));  // rangefinder window
  cyl(0.031, 0.031, 0.012, -0.004, -0.004, -0.03, chrome);    // lens mount
  cyl(0.027, 0.029, 0.034, -0.004, -0.004, -0.052, black);    // barrel
  for (let i = 0; i < 3; i++) cyl(0.0295, 0.0295, 0.004, -0.004, -0.004, -0.042 - i * 0.009, chrome); // focus ring ridges
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1216, roughness: 0.02, metalness: 0.1, clearcoat: 1, envMapIntensity: 2 });
  cyl(0.02, 0.02, 0.003, -0.004, -0.004, -0.07, glass);
  button = cyl(0.006, 0.006, 0.008, 0.05, 0.058, 0.004, chrome); button.rotation.x = 0;
  // the back and top, which is what you mostly see: eyepiece, frame counter, rewind knob, lugs
  box(0.03, 0.02, 0.006, -0.05, 0.022, 0.026, black);                                   // eyepiece surround
  box(0.022, 0.013, 0.002, -0.05, 0.022, 0.0295, mat(0x0a1418, 0.03, 0.2));            // eyepiece glass
  cyl(0.011, 0.011, 0.006, 0.028, 0.058, 0.004, chrome).rotation.x = 0;                // frame counter dial
  const counter = cyl(0.007, 0.007, 0.002, 0.028, 0.062, 0.004, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xefe6d2, emissiveIntensity: 0.25 }));
  counter.rotation.x = 0;
  cyl(0.009, 0.009, 0.012, -0.055, 0.06, 0.004, chrome).rotation.x = 0;              // rewind knob
  cyl(0.004, 0.004, 0.02, -0.055, 0.07, 0.004, chrome).rotation.x = 0;
  for (const x of [-0.078, 0.078]) box(0.006, 0.012, 0.01, x, 0.03, 0, chrome);        // strap lugs
  box(0.15, 0.003, 0.049, 0, 0.0385, 0, chrome);                                        // trim line under the top plate
  lever = new THREE.Group(); lever.position.set(0.04, 0.056, 0.012); cam.add(lever);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.003, 0.008), chrome); arm.position.set(0.017, 0, 0); lever.add(arm);
  negLamp = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff8a3a, emissiveIntensity: 0 }));
  negLamp.position.set(-0.02, 0.056, 0.008); cam.add(negLamp);
  // the print that slides out of the base after a shot
  const pm = new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.7 });
  printMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.002, 0.09), pm);
  printMesh.visible = false; cam.add(printMesh);
  cam.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // the photo you're holding, in the other hand
  cardMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  card = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.102), cardMat);
  card.visible = false; root.add(card);
}

// Draw a held photo as a print: white border, the image, the caption strip.
const cardCanvas = document.createElement('canvas');
cardCanvas.width = 200; cardCanvas.height = 240;
let cardTex = null;
function paintCard(photo) {
  const g = cardCanvas.getContext('2d');
  g.fillStyle = photo.neg ? '#2a2320' : '#efe6d2'; g.fillRect(0, 0, 200, 240);
  g.fillStyle = '#3b312c'; g.fillRect(12, 12, 176, 132);
  if (photo.img) { const im = new Image(); im.onload = () => { g.drawImage(im, 12, 12, 176, 132); if (cardTex) cardTex.needsUpdate = true; }; im.src = photo.img; }
  g.fillStyle = photo.neg ? '#efe6d2' : '#3b332b'; g.font = '600 15px ui-monospace, Consolas, monospace'; g.textAlign = 'center';
  g.fillText(`${photo.neg ? 'NEG · ' : ''}${photo.label}`.slice(0, 20), 100, 180);
  if (photo.rot) { g.fillStyle = '#d8452f'; g.fillText(`↻ ${photo.rot * 90}°`, 100, 206); }
  if (!cardTex) { cardTex = new THREE.CanvasTexture(cardCanvas); cardTex.encoding = THREE.sRGBEncoding; cardMat.map = cardTex; cardMat.needsUpdate = true; }
  cardTex.needsUpdate = true;
}

export function vmShot() { shotT = 0; }
export function vmDevelop() { devT = 0; }
export function vmSwitch() { switchT = 0; }

export function stepViewmodel(dt, { moving, grounded, yaw, pitch }) {
  if (!root) return;
  root.visible = !!G.L && G.mode === 'playing' && G.alive;
  if (!root.visible) return;
  t += dt;
  // walking bob and a little lag behind the mouse
  bob += dt * (moving && grounded ? 9 : 0);
  const walk = moving && grounded ? 1 : 0;
  let dy = yaw - lastYaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
  swayX += (-dy * 1.5 - swayX) * Math.min(1, dt * 10) ; swayY += ((pitch - lastPitch) * 1.5 - swayY) * Math.min(1, dt * 10);
  lastYaw = yaw; lastPitch = pitch;
  swayX = Math.max(-0.03, Math.min(0.03, swayX)); swayY = Math.max(-0.03, Math.min(0.03, swayY));
  // raising to the eye while aiming; gone once the viewfinder is up
  raise += ((G.aim ? 1 : 0) - raise) * Math.min(1, dt * 12);
  const bx = Math.sin(bob) * 0.006 * walk, by = Math.abs(Math.cos(bob)) * 0.006 * walk;
  cam.position.set(0.16 - 0.16 * raise + bx + swayX, -0.14 + 0.14 * raise - by + swayY, -0.34 + 0.14 * raise);
  cam.rotation.set(0.12 - 0.12 * raise, 0.32 - 0.32 * raise, 0.05);
  cam.visible = raise < 0.85;
  // shutter, lever and the print sliding out
  if (shotT >= 0) {
    shotT += dt;
    button.position.y = 0.058 - (shotT < 0.08 ? 0.003 : 0);
    cam.position.z += shotT < 0.1 ? 0.012 * (1 - shotT / 0.1) : 0;
    const lv = shotT > 0.15 && shotT < 0.55 ? Math.sin((shotT - 0.15) / 0.4 * Math.PI) : 0;
    lever.rotation.y = -lv * 0.9;
    printMesh.visible = shotT > 0.2 && shotT < 1.1;
    const e = Math.min(1, (shotT - 0.2) / 0.35);
    printMesh.position.set(0, -0.05 - 0.05 * e - (shotT > 0.7 ? (shotT - 0.7) * 0.4 : 0), 0.004 + (shotT > 0.7 ? (shotT - 0.7) * 0.1 : 0));
    printMesh.rotation.x = shotT > 0.7 ? (shotT - 0.7) * 2 : 0;
    if (shotT > 1.2) shotT = -1;
  }
  // negative film: a small amber lamp on the top plate, and a quick turn of the camera on switching
  const neg = G.filmMode === 'neg';
  negLamp.material.emissiveIntensity += ((neg ? 3 : 0) - negLamp.material.emissiveIntensity) * Math.min(1, dt * 8);
  if (switchT >= 0) { switchT += dt; cam.rotation.z += Math.sin(Math.min(1, switchT / 0.35) * Math.PI) * 0.25; if (switchT > 0.35) switchT = -1; }

  // the held photo: slides in from the lower left, flicks forward when developed
  const photo = G.selected >= 0 ? G.roll[G.selected] : null;
  if (photo && (photo !== cardFor || photo.rot !== cardRot || (photo.img && !cardFor?.painted))) { paintCard(photo); cardFor = photo; cardRot = photo.rot; photo.painted = !!photo.img; }
  if (!photo && devT < 0) cardFor = null;
  cardIn += (((photo || devT >= 0) && !G.aim ? 1 : 0) - cardIn) * Math.min(1, dt * 12);
  card.visible = cardIn > 0.01;
  let push = 0;
  if (devT >= 0) { devT += dt; push = Math.min(1, devT / 0.25); if (devT > 0.3) devT = -1; }
  card.position.set(-0.2 + swayX, -0.24 + 0.14 * cardIn + swayY - push * 0.02, -0.32 - push * 0.15);
  card.rotation.set(-0.2, 0.34, 0.1);
  cardMat.opacity = 1 - push; cardMat.transparent = push > 0;
}
