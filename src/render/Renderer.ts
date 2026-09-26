import * as THREE from 'three';
import { PAL } from './Palette';

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY_PRESETS: Record<Quality, { pixelRatio: number; shadows: boolean; shadowSize: number; particles: number; drawDist: number; grass: number }> = {
  low: { pixelRatio: 0.8, shadows: false, shadowSize: 512, particles: 700, drawDist: 140, grass: 0.35 },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, particles: 1400, drawDist: 200, grass: 0.7 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, particles: 2200, drawDist: 280, grass: 1 },
};

/**
 * Owns the WebGL renderer, the scene graph root, lights and the sky.
 * The sun's shadow camera follows the player so we get crisp shadows with a small shadow map.
 */
export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  quality: Quality;
  private sunOffset = new THREE.Vector3(38, 60, 22);
  private shadowTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);

    const fogColor = new THREE.Color(0xf6e3c6);
    this.scene.fog = new THREE.Fog(fogColor, 60, 230);
    this.scene.background = fogColor;

    this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0x8a7a5a, 1.25);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 180;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const fill = new THREE.DirectionalLight(0xb9a8ff, 0.35);
    fill.position.set(-30, 20, -40);
    this.scene.add(fill);

    this.sky = this.makeSky();
    this.scene.add(this.sky);

    this.applyQuality(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const p = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    this.camera.far = p.drawDist + 200;
    this.camera.updateProjectionMatrix();
    // materials need recompiling when shadow state changes
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on the action. Snapped to texels to avoid shimmering. */
  followShadows(center: THREE.Vector3) {
    const size = this.sun.shadow.mapSize.x;
    const texel = 68 / size;
    this.shadowTarget.set(Math.round(center.x / texel) * texel, Math.round(center.y / texel) * texel, Math.round(center.z / texel) * texel);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).add(this.sunOffset);
    this.sky.position.copy(this.camera.position);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(450, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x5fb4f0) },
        mid: { value: new THREE.Color(PAL.sky) },
        horizon: { value: new THREE.Color(0xffe6c2) },
        below: { value: new THREE.Color(0xf2d2e4) },
        sunDir: { value: this.sunOffset.clone().normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir;
        varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, y));
          c = mix(c, top, smoothstep(0.25, 0.85, y));
          c = mix(c, below, smoothstep(0.0, -0.35, y));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -10;
    return m;
  }
}
