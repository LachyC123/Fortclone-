import * as THREE from 'three';
import { shared } from '../render/Materials';
import type { FX } from '../fx/FX';
import { PShape } from '../fx/Particles';
import { rand } from '../core/math';
import { audio } from '../audio/Audio';

export interface GloomPhase {
  wait: number;
  shrink: number;
  radius: number;
  dps: number;
}

/** Tuned for ~6–8 minute matches (about 6.7 minutes of Gloom from the barge to the last circle). */
export const GLOOM_PHASES: GloomPhase[] = [
  { wait: 80, shrink: 45, radius: 72, dps: 1 },
  { wait: 55, shrink: 40, radius: 44, dps: 2 },
  { wait: 45, shrink: 32, radius: 24, dps: 4 },
  { wait: 35, shrink: 25, radius: 10, dps: 7 },
  { wait: 25, shrink: 22, radius: 0.5, dps: 12 },
];
const START_R = 150;

/**
 * THE GLOOM: a colourful, strange storm that swallows the island. A tall swirling violet wall
 * with a glowing base line; inside it the world goes dim and purple, wind howls and motes whirl.
 */
export class Gloom {
  center = new THREE.Vector2(0, 0);
  radius = 150;
  private fromC = new THREE.Vector2();
  private fromR = 150;
  nextC = new THREE.Vector2();
  nextR = 150;
  phase = 0;
  phaseT = 0;
  state: 'idle' | 'waiting' | 'shrinking' | 'done' = 'idle';
  private wall: THREE.Mesh;
  private ring: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private t = 0;
  private lightningT = 4;

  constructor(private scene: THREE.Scene, private fx: FX) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.time, uR: { value: 64 } },
      vertexShader: `
        varying vec2 vUv; varying vec3 vWp;
        void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `
        uniform float uTime; uniform float uR;
        varying vec2 vUv; varying vec3 vWp;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
        void main(){
          float ang = atan(vWp.z, vWp.x);
          float circ = ang * uR;
          vec2 p = vec2(circ * 0.08, vWp.y * 0.06 - uTime * 0.25);
          float n = noise(p * 2.0) * 0.6 + noise(p * 5.0 + uTime * 0.2) * 0.4;
          float streak = smoothstep(0.55, 0.9, noise(vec2(circ * 0.02 + uTime * 0.05, vWp.y * 0.01 - uTime * 0.6)));
          vec3 deep = vec3(0.30, 0.10, 0.52);
          vec3 glow = vec3(0.85, 0.45, 1.0);
          vec3 col = mix(deep, glow, n * 0.6 + streak * 0.5);
          float h = vWp.y;
          float base = smoothstep(3.0, 0.0, abs(h - 0.5));
          col += vec3(1.0, 0.7, 1.0) * base * 0.8;
          float a = 0.34 + n * 0.25 + streak * 0.25 + base * 0.4;
          a *= smoothstep(140.0, 60.0, h) * smoothstep(-40.0, -5.0, h);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 200, 96, 1, true), this.mat);
    this.wall.position.y = 50;
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 5;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 128), new THREE.MeshBasicMaterial({ color: 0xe8a0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.25;
    this.wall.visible = this.ring.visible = false;
    scene.add(this.wall, this.ring);
  }

  reset() {
    this.center.set(0, 0);
    this.radius = START_R;
    this.nextC.set(0, 0);
    this.nextR = START_R;
    this.phase = 0;
    this.phaseT = 0;
    this.state = 'idle';
    this.wall.visible = this.ring.visible = false;
  }

  start() {
    this.reset();
    this.state = 'waiting';
    this.pickNext();
    this.wall.visible = this.ring.visible = true;
  }

  private pickNext() {
    const ph = GLOOM_PHASES[this.phase];
    if (!ph) return;
    // new circle fully inside the current one, biased toward the island middle
    const slack = Math.max(0, this.radius - ph.radius);
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * slack * 0.85;
      const c = new THREE.Vector2(this.center.x + Math.cos(a) * r, this.center.y + Math.sin(a) * r);
      if (c.length() + ph.radius < 94 || i === 19) {
        this.nextC.copy(c);
        break;
      }
    }
    this.nextR = ph.radius;
  }

  get dps() {
    return GLOOM_PHASES[Math.min(this.phase, GLOOM_PHASES.length - 1)].dps;
  }

  /** seconds until the next change, and what that change is */
  timer(): { label: string; t: number } {
    const ph = GLOOM_PHASES[this.phase];
    if (!ph || this.state === 'done') return { label: 'THE GLOOM IS EVERYWHERE', t: 0 };
    if (this.state === 'waiting') return { label: 'GLOOM CLOSES IN', t: ph.wait - this.phaseT };
    return { label: 'THE GLOOM IS MOVING', t: ph.shrink - this.phaseT };
  }

  outside(p: THREE.Vector3) {
    return Math.hypot(p.x - this.center.x, p.z - this.center.y) > this.radius;
  }

  /** 0 deep inside the safe zone, 1 at/over the edge */
  edgeness(p: THREE.Vector3) {
    const d = Math.hypot(p.x - this.center.x, p.z - this.center.y);
    return THREE.MathUtils.clamp((d - (this.radius - 6)) / 6, 0, 1.5);
  }

  update(dt: number, camPos: THREE.Vector3) {
    this.t += dt;
    if (this.state === 'idle') return;
    const ph = GLOOM_PHASES[this.phase];
    this.phaseT += dt;
    if (ph) {
      if (this.state === 'waiting' && this.phaseT >= ph.wait) {
        this.state = 'shrinking';
        this.phaseT = 0;
        this.fromC.copy(this.center);
        this.fromR = this.radius;
      } else if (this.state === 'shrinking') {
        const k = Math.min(1, this.phaseT / ph.shrink);
        const e = k * k * (3 - 2 * k);
        this.center.lerpVectors(this.fromC, this.nextC, e);
        this.radius = this.fromR + (this.nextR - this.fromR) * e;
        if (k >= 1) {
          this.phase++;
          this.phaseT = 0;
          if (this.phase >= GLOOM_PHASES.length) this.state = 'done';
          else {
            this.state = 'waiting';
            this.pickNext();
          }
        }
      }
    }
    const r = Math.max(0.5, this.radius);
    this.wall.scale.set(r, 1, r);
    this.wall.position.set(this.center.x, 50, this.center.y);
    this.mat.uniforms.uR.value = r;
    this.ring.scale.set(r, r, r);
    this.ring.position.set(this.center.x, 0.25, this.center.y);

    // whirling motes along the wall near the camera, and thick inside the Gloom
    const dx = camPos.x - this.center.x, dz = camPos.z - this.center.y;
    const dist = Math.hypot(dx, dz);
    const nearWall = Math.abs(dist - r) < 35;
    if (nearWall && Math.random() < dt * 30) {
      const a = Math.atan2(dz, dx) + rand(-0.6, 0.6) * Math.min(1, 30 / Math.max(5, r));
      const p = new THREE.Vector3(this.center.x + Math.cos(a) * r, camPos.y + rand(-6, 10), this.center.y + Math.sin(a) * r);
      this.fx.glow.emit(p, { count: 1, color: [0xd49bff, 0xff9ad5, 0x9f7bff], speed: [1, 3], spread: 1, life: [1, 2], size: [0.2, 0.4], shape: Math.random() < 0.4 ? PShape.Star : PShape.Soft, drag: 0.5 });
    }
    if (dist > r && Math.random() < dt * 25) {
      const p = new THREE.Vector3(camPos.x + rand(-8, 8), camPos.y + rand(-3, 5), camPos.z + rand(-8, 8));
      this.fx.soft.emit(p, { count: 1, color: [0x6b2fb3, 0x9f7bff, 0x3d1f66], speed: [2, 5], dir: new THREE.Vector3(-dz, 0, dx).normalize(), spread: 0.4, life: [0.8, 1.4], size: [0.6, 1.2], sizeEnd: 2, alpha: 0.35 });
    }
    // distant purple lightning inside the storm
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = rand(2.5, 6);
      const a = Math.random() * Math.PI * 2, rr = r + rand(8, 30);
      const p = new THREE.Vector3(this.center.x + Math.cos(a) * rr, rand(20, 45), this.center.y + Math.sin(a) * rr);
      this.fx.glow.emit(p, { count: 3, color: 0xe8c0ff, speed: 0, life: 0.18, size: rand(8, 14), sizeEnd: 1.3, alpha: 0.8 });
      for (let i = 0; i < 8; i++) this.fx.glow.emit(p.clone().setY(p.y - i * 3), { count: 1, color: 0xffffff, speed: 0.5, life: 0.2, size: 1.2, alpha: 0.9 });
      // every other flash is a proper bolt down to the ground, with thunder rolling in after it
      if (Math.random() < 0.55) this.fx.bolt(p.clone().setY(p.y + 25), 0);
      audio.thunder(p);
      this.lastStrike = p;
    }
  }
  lastStrike: THREE.Vector3 | null = null;
}
