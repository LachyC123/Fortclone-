import * as THREE from 'three';

export const PShape = { Soft: 0, Sparkle: 1, Confetti: 2, Ring: 3, Star: 4 } as const;
export type PShape = (typeof PShape)[keyof typeof PShape];

export interface EmitOpts {
  count?: number;
  color?: number | number[];
  speed?: number | [number, number];
  /** 0 = directional (along dir), 1 = full sphere */
  spread?: number;
  dir?: THREE.Vector3;
  up?: number;
  gravity?: number;
  drag?: number;
  life?: number | [number, number];
  size?: number | [number, number];
  sizeEnd?: number; // multiplier at end of life
  alpha?: number;
  shape?: PShape;
  jitter?: number; // spawn position jitter radius
  /** pull toward a point (loot attraction) */
  attract?: THREE.Vector3 | null;
  spin?: number;
}

const _d = new THREE.Vector3();

/**
 * One draw call per pool. CPU-simulated point sprites with procedural shapes in the fragment
 * shader (soft puff, sparkle, confetti, ring, star) — cheap and very flexible.
 */
export class ParticlePool {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private rot: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private size0: Float32Array;
  private sizeEnd: Float32Array;
  private alpha0: Float32Array;
  private spin: Float32Array;
  private attract: (THREE.Vector3 | null)[];
  private cursor = 0;
  active = 0;
  limit: number;

  constructor(public max: number, additive: boolean) {
    this.limit = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.sizeEnd = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.attract = new Array(max).fill(null);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float shape; attribute float rot; attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vRot;
        void main(){
          vColor = color; vAlpha = alpha; vShape = shape; vRot = rot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vRot;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float c = cos(vRot), s = sin(vRot);
          p = mat2(c, -s, s, c) * p;
          float r = length(p);
          float a;
          if (vShape < 0.5) { a = smoothstep(1.0, 0.2, r); }
          else if (vShape < 1.5) { float st = max(1.0 - abs(p.x) * 6.0 - abs(p.y) * 1.2, 1.0 - abs(p.y) * 6.0 - abs(p.x) * 1.2); a = clamp(st, 0.0, 1.0) + smoothstep(0.5, 0.0, r) * 0.8; }
          else if (vShape < 2.5) { a = step(abs(p.x), 0.9) * step(abs(p.y), 0.5); }
          else if (vShape < 3.5) { a = smoothstep(0.12, 0.0, abs(r - 0.78)); }
          else { float ang = atan(p.y, p.x); float k = 0.55 + 0.35 * cos(ang * 5.0); a = smoothstep(k + 0.08, k - 0.04, r); }
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setViewportHeight(h: number, fov: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, o: EmitOpts) {
    const n = o.count ?? 1;
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      if (this.active >= this.limit) return;
      // find a free slot (ring cursor; overwrite oldest if full)
      let i = this.cursor;
      for (let tries = 0; tries < this.max; tries++) {
        if (this.life[i] <= 0) break;
        i = (i + 1) % this.max;
      }
      this.cursor = (i + 1) % this.max;
      if (this.life[i] <= 0) this.active++;
      const colSpec = o.color ?? 0xffffff;
      c.setHex(Array.isArray(colSpec) ? colSpec[Math.floor(Math.random() * colSpec.length)] : colSpec);
      const j = o.jitter ?? 0;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 2 * j;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 2 * j;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 2 * j;
      const sp = Array.isArray(o.speed) ? o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]) : o.speed ?? 2;
      const spread = o.spread ?? 1;
      _d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (_d.lengthSq() < 1e-4) _d.set(0, 1, 0);
      _d.normalize();
      if (o.dir) _d.multiplyScalar(spread).add(o.dir).normalize();
      this.vel[i * 3] = _d.x * sp;
      this.vel[i * 3 + 1] = _d.y * sp + (o.up ?? 0);
      this.vel[i * 3 + 2] = _d.z * sp;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      const life = Array.isArray(o.life) ? o.life[0] + Math.random() * (o.life[1] - o.life[0]) : o.life ?? 0.6;
      this.life[i] = life;
      this.maxLife[i] = life;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
      const sz = Array.isArray(o.size) ? o.size[0] + Math.random() * (o.size[1] - o.size[0]) : o.size ?? 0.2;
      this.size0[i] = sz;
      this.size[i] = sz;
      this.sizeEnd[i] = o.sizeEnd ?? 0.3;
      this.alpha0[i] = o.alpha ?? 1;
      this.alpha[i] = o.alpha ?? 1;
      this.shape[i] = o.shape ?? PShape.Soft;
      this.rot[i] = Math.random() * 6.28;
      this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 0);
      this.attract[i] = o.attract ?? null;
    }
  }

  update(dt: number) {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        this.size[i] = 0;
        continue;
      }
      active++;
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      const at = this.attract[i];
      if (at) {
        const dx = at.x - this.pos[i * 3], dy = at.y - this.pos[i * 3 + 1], dz = at.z - this.pos[i * 3 + 2];
        const k = 14 * dt;
        this.vel[i * 3] += dx * k;
        this.vel[i * 3 + 1] += dy * k;
        this.vel[i * 3 + 2] += dz * k;
      }
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] * (1 + (this.sizeEnd[i] - 1) * t);
      // quick fade-in, ease-out fade
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 12) * (1 - t * t);
      this.rot[i] += this.spin[i] * dt;
    }
    this.active = active;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('shape') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('rot') as THREE.BufferAttribute).needsUpdate = true;
  }
}
