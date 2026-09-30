// The final image: ambient occlusion, bloom, filmic grading and anti-aliasing.
//
//   high    SSAO + bloom + grade + SMAA
//   medium  bloom + grade + SMAA
//   low     straight to the screen with the renderer's own tone mapping
//
// The scene renders into half-float targets in linear light, so bloom sees real highlight values and
// the dark rooms don't band; the grade pass does exposure, ACES, a warm split-tone and sRGB at the end.
import { G } from './state.js';

const THREE = window.THREE;
let composer = null, ssao = null, bloom = null, grade = null, smaa = null, quality = 'high';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1.15 }, lift: { value: new THREE.Vector3(0.012, 0.006, 0.004) }, vignette: { value: 0.35 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform vec3 lift;
    uniform float vignette;
    varying vec2 vUv;
    // ACES filmic fit (Narkowicz)
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
      c = aces(c);
      // warm the shadows a touch, keep the highlights neutral
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += lift * (1.0 - l);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
    }`,
};

export function setQuality(q) {
  quality = q;
  const r = G.renderer;
  if (q === 'low') {
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.outputEncoding = THREE.sRGBEncoding;
  } else {
    // the grade pass does both
    r.toneMapping = THREE.NoToneMapping;
    r.outputEncoding = THREE.LinearEncoding;
    build();
  }
  // materials compile their tone mapping and encoding in, so recompile
  G.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
}
export function getQuality() { return quality; }

function build() {
  const r = G.renderer;
  const size = r.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  composer = new THREE.EffectComposer(r, target);
  if (quality === 'high') {
    ssao = new THREE.SSAOPass(G.scene, G.camera, size.x, size.y);
    ssao.kernelRadius = 0.55;
    ssao.minDistance = 0.0006;
    ssao.maxDistance = 0.012;
    ssao.beautyRenderTarget.texture.type = THREE.HalfFloatType;
    // see-through things (glass, light shafts, dust, labels, the ghost) would cast false shadows
    const normals = ssao.renderOverride.bind(ssao);
    ssao.renderOverride = (...args) => {
      const hidden = [];
      G.scene.traverse(o => {
        if (!o.visible) return;
        const m = o.material;
        if (o.userData.noAO || o.isSprite || o.isPoints || o.isLine || (m && !Array.isArray(m) && m.transparent)) { o.visible = false; hidden.push(o); }
      });
      normals(...args);
      for (const o of hidden) o.visible = true;
    };
    composer.addPass(ssao);
  } else {
    ssao = null;
    composer.addPass(new THREE.RenderPass(G.scene, G.camera));
  }
  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 0.9);
  composer.addPass(bloom);
  grade = new THREE.ShaderPass(GradeShader);
  composer.addPass(grade);
  smaa = new THREE.SMAAPass(size.x, size.y);
  composer.addPass(smaa);
}

export function resizePost() {
  if (!composer) return;
  const size = G.renderer.getDrawingBufferSize(new THREE.Vector2());
  composer.setSize(size.x / G.renderer.getPixelRatio(), size.y / G.renderer.getPixelRatio());
}

// Brighter outdoors: the epilogue turns exposure up.
export function setExposure(e) { if (grade) grade.uniforms.exposure.value = e; G.renderer.toneMappingExposure = e; }

export function renderFrame() {
  if (quality === 'low' || !composer) G.renderer.render(G.scene, G.camera);
  else composer.render();
}
