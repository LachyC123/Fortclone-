import * as THREE from 'three';
import { ParticlePool, PShape } from './Particles';
import { PAL } from '../render/Palette';
import { CollisionWorld, ColFlags, Surface } from '../physics/Collision';
import { rand } from '../core/math';

interface Tracer {
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
  dur: number;
  len: number;
  width: number;
  color: THREE.Color;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  active: boolean;
  billboard: boolean;
}

interface Debris {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  size: number;
  color: THREE.Color;
}

interface Casing {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  bounced: boolean;
  color: THREE.Color;
  loud: boolean;
}

interface Bolt {
  line: THREE.Line;
  t: number;
  active: boolean;
}

interface Smear {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  active: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();

const SURFACE_COLORS: Record<Surface, number[]> = {
  grass: [0x7cc35a, 0x5aa347, 0x9b7a4f],
  dirt: [0x9b7a4f, 0x7a5a3b],
  stone: [0xd8d0c0, 0xb8ae9c, 0xffffff],
  wood: [0xd3a26f, 0xb07a4f, 0x8a5a3b],
  metal: [0xffe28a, 0xffffff, 0xc0c8d0],
  water: [0xbff3ff, 0x7fdcef, 0xffffff],
  cloth: [0xfff6e6, 0xe6d8c0],
};

/**
 * Central FX service: particles, bullet tracers, shockwave rings, bullet decals, chunky debris,
 * blink smears and the (single, permanent) dynamic flash light.
 */
export class FX {
  soft: ParticlePool;
  glow: ParticlePool;
  private tracers: Tracer[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private rings: Ring[] = [];
  private decalMesh: THREE.InstancedMesh;
  private decalCursor = 0;
  private debris: Debris[] = [];
  private debrisMesh: THREE.InstancedMesh;
  private smears: Smear[] = [];
  private casings: Casing[] = [];
  private casingMesh: THREE.InstancedMesh;
  private bolts: Bolt[] = [];
  /** set by the game: brass tinks for casings near the listener */
  onCasingLand: ((p: THREE.Vector3) => void) | null = null;
  flash: THREE.PointLight;
  private flashT = 0;
  private flashDur = 0.06;
  private flashI = 0;
  group = new THREE.Group();

  constructor(private scene: THREE.Scene, private cw: CollisionWorld, maxParticles: number) {
    this.soft = new ParticlePool(Math.floor(maxParticles * 0.55), false);
    this.glow = new ParticlePool(Math.floor(maxParticles * 0.45), true);
    this.group.add(this.soft.points, this.glow.points);

    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerMesh = new THREE.InstancedMesh(tg, tm, 64);
    this.tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);

    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, r0: 0, r1: 1, active: false, billboard: false });
    }

    const dg = new THREE.CircleGeometry(0.07, 8);
    const dm = new THREE.MeshBasicMaterial({ color: 0x2a2030, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    this.decalMesh = new THREE.InstancedMesh(dg, dm, 80);
    this.decalMesh.count = 80;
    for (let i = 0; i < 80; i++) this.decalMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.decalMesh.frustumCulled = false;
    this.group.add(this.decalMesh);

    const bg = new THREE.BoxGeometry(1, 1, 1);
    const bm = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    this.debrisMesh = new THREE.InstancedMesh(bg, bm, 120);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(120 * 3), 3);
    this.debrisMesh.count = 0;
    this.debrisMesh.castShadow = false;
    this.debrisMesh.frustumCulled = false;
    this.group.add(this.debrisMesh);

    for (let i = 0; i < 4; i++) {
      const g = new THREE.CapsuleGeometry(0.34, 1.0, 4, 10);
      g.translate(0, 0.85, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: PAL.blink, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.smears.push({ mesh: m, t: 0, dur: 0.3, active: false });
    }

    // shell casings: tiny brass cylinders that spin out of the gun and bounce once or twice
    const cg = new THREE.CylinderGeometry(0.022, 0.022, 0.075, 6);
    cg.rotateZ(Math.PI / 2);
    this.casingMesh = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.8, emissive: 0x2a1c00 }), 64);
    this.casingMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.casingMesh.count = 0;
    this.casingMesh.castShadow = false;
    this.casingMesh.frustumCulled = false;
    this.group.add(this.casingMesh);

    // lightning bolts (Gloom): a few reusable jagged lines
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf6e0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.bolts.push({ line, t: 0, active: false });
    }

    // Always present (intensity 0 when idle) so toggling it never forces shader recompiles
    this.flash = new THREE.PointLight(0xffc070, 0, 9, 2);
    this.group.add(this.flash);
    scene.add(this.group);
  }

  setParticleLimit(n: number) {
    this.soft.limit = Math.min(this.soft.max, Math.floor(n * 0.55));
    this.glow.limit = Math.min(this.glow.max, Math.floor(n * 0.45));
  }

  onResize(h: number, fov: number) {
    this.soft.setViewportHeight(h, fov);
    this.glow.setViewportHeight(h, fov);
  }

  lightFlash(p: THREE.Vector3, color: number, intensity: number, dur = 0.06) {
    this.flash.position.copy(p);
    this.flash.color.setHex(color);
    this.flashI = intensity;
    this.flash.intensity = intensity;
    this.flashT = dur;
    this.flashDur = dur;
  }

  /* ------------------------------------------------------ primitives */

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, width = 0.05, speed = 260) {
    if (this.tracers.length >= 64) this.tracers.shift();
    const dist = a.distanceTo(b);
    this.tracers.push({ a: a.clone(), b: b.clone(), t: 0, dur: Math.max(0.05, dist / speed), len: Math.min(5, dist * 0.6), width, color: new THREE.Color(color) });
  }

  ring(p: THREE.Vector3, color: number, r0: number, r1: number, dur: number, normal?: THREE.Vector3, billboard = false) {
    const ring = this.rings.find((r) => !r.active) ?? this.rings[0];
    ring.active = true;
    ring.t = 0;
    ring.dur = dur;
    ring.r0 = r0;
    ring.r1 = r1;
    ring.billboard = billboard;
    const m = ring.mesh;
    m.visible = true;
    m.position.copy(p);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    if (!billboard) {
      const n = normal ?? _p.set(0, 1, 0);
      m.quaternion.setFromUnitVectors(_z, n);
    }
  }

  decal(p: THREE.Vector3, n: THREE.Vector3) {
    _q.setFromUnitVectors(_z, n);
    const s = rand(0.8, 1.3);
    _m.compose(_p.copy(p).addScaledVector(n, 0.012), _q, _s.set(s, s, s));
    this.decalMesh.setMatrixAt(this.decalCursor, _m);
    this.decalCursor = (this.decalCursor + 1) % 80;
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  chunk(p: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.08, life = 1.6) {
    if (this.debris.length >= 120) this.debris.shift();
    this.debris.push({ pos: p.clone(), vel: vel.clone(), rot: new THREE.Euler(rand(0, 6), rand(0, 6), 0), spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), life, size, color: new THREE.Color(color) });
  }

  smear(from: THREE.Vector3, to: THREE.Vector3, color = PAL.blink) {
    const s = this.smears.find((x) => !x.active) ?? this.smears[0];
    s.active = true;
    s.t = 0;
    s.dur = 0.32;
    const m = s.mesh;
    m.visible = true;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    // stretch a ghost capsule from origin toward destination
    const d = _dir.subVectors(to, from);
    const len = d.length();
    m.position.copy(from);
    m.userData.to = to.clone();
    m.userData.from = from.clone();
    m.userData.len = len;
    m.quaternion.identity();
  }

  /* ------------------------------------------------------ composite effects */

  muzzle(p: THREE.Vector3, dir: THREE.Vector3, color = 0xffd27a, big = false) {
    this.glow.emit(p, { count: big ? 10 : 5, color: [color, 0xffffff], speed: [2, 7], spread: 0.35, dir, life: [0.05, 0.12], size: big ? [0.3, 0.5] : [0.18, 0.3], sizeEnd: 0.2, shape: PShape.Sparkle, drag: 6 });
    this.soft.emit(p, { count: big ? 5 : 2, color: [0xe8e0d0, 0xd0c8bc], speed: [0.5, 1.5], spread: 0.6, dir, up: 0.6, life: [0.5, 0.9], size: [0.18, 0.3], sizeEnd: 3, alpha: 0.35, drag: 2 });
    this.lightFlash(p, color, big ? 6 : 3.5, 0.05);
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, surface: Surface) {
    const cols = SURFACE_COLORS[surface] ?? SURFACE_COLORS.stone;
    this.soft.emit(p, { count: 6, color: cols, speed: [1.5, 4], spread: 0.7, dir: n, gravity: 9, life: [0.25, 0.5], size: [0.06, 0.12], sizeEnd: 0.5, shape: PShape.Confetti, drag: 1.5, spin: 10 });
    this.soft.emit(p, { count: 2, color: cols[0], speed: [0.3, 1], spread: 0.5, dir: n, life: [0.4, 0.7], size: [0.2, 0.35], sizeEnd: 2.4, alpha: 0.4, drag: 2 });
    if (surface === 'metal') this.glow.emit(p, { count: 6, color: [0xffe28a, 0xffffff], speed: [3, 7], spread: 0.6, dir: n, gravity: 14, life: [0.15, 0.35], size: [0.05, 0.08], sizeEnd: 0.4, shape: PShape.Sparkle });
    if (surface === 'wood' && Math.random() < 0.6) this.chunk(p, _p.copy(n).multiplyScalar(rand(2, 4)).add(new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1))), 0xd3a26f, 0.06, 1.2);
    if (surface === 'water') this.soft.emit(p, { count: 8, color: [0xffffff, 0xbff3ff], speed: [2, 4], spread: 0.3, dir: _p.set(0, 1, 0), gravity: 14, life: [0.3, 0.6], size: [0.08, 0.16], sizeEnd: 0.6 });
    if (surface !== 'water' && surface !== 'grass' && surface !== 'cloth') this.decal(p, n);
  }

  hitSplat(p: THREE.Vector3, headshot: boolean) {
    // no blood: toy "stuffing" sparkles + a flash of colour
    this.glow.emit(p, { count: headshot ? 12 : 6, color: headshot ? [0xfff27a, 0xffffff, 0xffb13d] : [0xffffff, 0xffe9a8], speed: [2, 5], spread: 1, life: [0.15, 0.35], size: headshot ? [0.14, 0.24] : [0.1, 0.16], sizeEnd: 0.2, shape: headshot ? PShape.Star : PShape.Sparkle, drag: 4 });
    this.soft.emit(p, { count: headshot ? 5 : 3, color: [0xfff6e6, 0xf2d7b0], speed: [1, 3], spread: 1, up: 1, gravity: 6, life: [0.4, 0.8], size: [0.07, 0.12], sizeEnd: 0.6, shape: PShape.Confetti, spin: 8 });
    if (headshot) this.ring(p, 0xfff27a, 0.1, 0.7, 0.22, undefined, true);
  }

  dust(p: THREE.Vector3, amount: number, color = 0xe8dcc0) {
    this.soft.emit(p, { count: Math.ceil(amount), color: [color, 0xffffff], speed: [0.4, 1.8], spread: 1, up: 0.5, life: [0.35, 0.7], size: [0.15, 0.28], sizeEnd: 2.6, alpha: 0.45, drag: 3, jitter: 0.15 });
  }

  landBurst(p: THREE.Vector3, impact: number, surface: Surface) {
    if (surface === 'water') {
      // splash: a crown of droplets and a ripple ring
      this.soft.emit(p, { count: Math.min(26, 8 + impact), color: [0xffffff, 0xbff3ff, 0x7fdcef], speed: [2, 3 + impact * 0.3], spread: 0.45, dir: _dir.set(0, 1, 0), gravity: 16, life: [0.4, 0.8], size: [0.08, 0.16], sizeEnd: 0.6, jitter: 0.3 });
      this.soft.emit(p, { count: 4, color: 0xffffff, speed: [0.3, 1], spread: 1, up: 0.5, life: [0.4, 0.7], size: [0.4, 0.6], sizeEnd: 2, alpha: 0.5, drag: 3 });
      this.ring(_p.copy(p).setY(p.y + 0.04), 0xdff8ff, 0.2, 1.4 + impact * 0.08, 0.6);
      this.ring(_p.copy(p).setY(p.y + 0.04), 0xffffff, 0.1, 0.9 + impact * 0.05, 0.8);
      return;
    }
    const n = Math.min(18, 4 + impact * 0.8);
    const c = surface === 'grass' ? 0xd9e8b0 : surface === 'wood' ? 0xe0c49a : 0xe8dcc0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _dir.set(Math.cos(a), 0.15, Math.sin(a));
      this.soft.emit(p, { count: 1, color: [c, 0xffffff], speed: [2 + impact * 0.2, 3 + impact * 0.3], spread: 0.15, dir: _dir, life: [0.35, 0.6], size: [0.2, 0.32], sizeEnd: 2.2, alpha: 0.5, drag: 5 });
    }
    if (surface === 'grass') this.soft.emit(p, { count: Math.ceil(impact * 0.5), color: [0x7cc35a, 0xa6d86a], speed: [1.5, 3], spread: 0.5, dir: _dir.set(0, 1, 0), gravity: 8, life: [0.4, 0.8], size: [0.05, 0.09], shape: PShape.Confetti, spin: 10 });
    if (impact > 12) this.ring(p.clone().setY(p.y + 0.05), 0xffffff, 0.2, 2.2, 0.35);
  }

  blinkBurst(p: THREE.Vector3, arriving: boolean) {
    const c = [PAL.blink, 0xffffff, PAL.blinkDeep, 0xb0ffff];
    this.glow.emit(p, { count: arriving ? 34 : 22, color: c, speed: arriving ? [3, 8] : [1, 4], spread: 1, life: [0.25, 0.6], size: [0.1, 0.26], sizeEnd: 0.1, shape: PShape.Sparkle, drag: arriving ? 4 : 2, jitter: 0.3, spin: 6 });
    this.glow.emit(p, { count: 3, color: PAL.blink, speed: 0, life: 0.18, size: arriving ? 2.2 : 1.4, sizeEnd: 1.8, alpha: 0.5 });
    this.ring(p, PAL.blink, 0.2, arriving ? 2.6 : 1.6, arriving ? 0.35 : 0.3);
    this.ring(_p.copy(p).setY(p.y + 0.9), 0xffffff, 0.1, arriving ? 1.8 : 1.1, 0.25, undefined, true);
    this.lightFlash(p.clone().setY(p.y + 1), PAL.blink, arriving ? 9 : 5, 0.25);
  }

  bugTrail(p: THREE.Vector3) {
    this.glow.emit(p, { count: 1, color: [PAL.blink, 0xc8ffff], speed: 0.2, life: [0.25, 0.45], size: [0.1, 0.18], sizeEnd: 0.1, shape: Math.random() < 0.3 ? PShape.Sparkle : PShape.Soft, jitter: 0.04 });
  }

  pickupSparkle(p: THREE.Vector3, color: number) {
    this.glow.emit(p, { count: 16, color: [color, 0xffffff], speed: [1.5, 4], spread: 1, up: 1, life: [0.25, 0.55], size: [0.1, 0.2], sizeEnd: 0.1, shape: PShape.Sparkle, drag: 3, spin: 8 });
    this.ring(p, color, 0.1, 1.1, 0.3, undefined, true);
  }

  healPuff(p: THREE.Vector3) {
    this.glow.emit(p, { count: 2, color: [0x9dff8a, 0xffffff, 0xff9ad5], speed: [0.4, 1.2], spread: 1, up: 1.4, life: [0.5, 0.9], size: [0.12, 0.2], sizeEnd: 0.4, shape: PShape.Star, jitter: 0.4, drag: 1 });
  }

  elimination(p: THREE.Vector3, colors: number[]) {
    const c = [...colors, 0xffffff, PAL.mustard, PAL.pink, PAL.turquoise];
    this.glow.emit(p, { count: 4, color: 0xffffff, speed: 0, life: 0.2, size: 3.2, sizeEnd: 1.5, alpha: 0.7 });
    this.glow.emit(p, { count: 30, color: c, speed: [4, 10], spread: 1, up: 2, gravity: 4, life: [0.5, 1.1], size: [0.15, 0.3], sizeEnd: 0.1, shape: PShape.Star, drag: 2.5, spin: 10 });
    this.soft.emit(p, { count: 40, color: c, speed: [3, 9], spread: 1, up: 4, gravity: 9, life: [1.2, 2.2], size: [0.08, 0.14], sizeEnd: 0.8, shape: PShape.Confetti, drag: 1.2, spin: 14 });
    this.ring(p, 0xffffff, 0.3, 4.5, 0.45);
    this.ring(p, PAL.mustard, 0.2, 3.2, 0.55, undefined, true);
    for (let i = 0; i < 10; i++) this.chunk(p, new THREE.Vector3(rand(-5, 5), rand(4, 9), rand(-5, 5)), c[i % c.length], rand(0.1, 0.2), 2.2);
    this.lightFlash(p, 0xffe6a0, 10, 0.3);
  }

  /** Toy explosion: white flash, fat candy fireball, confetti, smoke ring, chunks. No gore, lots of pop. */
  explosion(p: THREE.Vector3, R: number) {
    this.glow.emit(p, { count: 3, color: 0xffffff, speed: 0, life: 0.15, size: R * 1.6, sizeEnd: 1.4, alpha: 0.9 });
    this.glow.emit(p, { count: 26, color: [0xffe08a, 0xffb347, 0xff7a5c, 0xff5c8a], speed: [3, R * 2.4], spread: 1, up: 2, life: [0.3, 0.6], size: [0.6, 1.2], sizeEnd: 0.3, drag: 5 });
    this.glow.emit(p, { count: 24, color: [0xffffff, PAL.mustard, PAL.pink, PAL.turquoise], speed: [6, 14], spread: 1, up: 3, gravity: 8, life: [0.5, 1], size: [0.12, 0.22], shape: PShape.Star, drag: 2, spin: 10 });
    this.soft.emit(p, { count: 18, color: [0x8a7a8a, 0xb0a4b0, 0xd8d0d8], speed: [1, 4], spread: 1, up: 1.5, life: [1.2, 2.2], size: [0.7, 1.2], sizeEnd: 2.8, alpha: 0.55, drag: 2 });
    this.soft.emit(p, { count: 30, color: [PAL.mustard, PAL.pink, PAL.turquoise, PAL.lavender, 0xffffff], speed: [4, 10], spread: 1, up: 5, gravity: 10, life: [1.2, 2], size: [0.08, 0.14], shape: PShape.Confetti, drag: 1.2, spin: 14 });
    this.ring(p.clone().setY(p.y + 0.1), 0xffffff, 0.3, R * 1.4, 0.4);
    this.ring(p, 0xffb347, 0.3, R * 1.1, 0.35, undefined, true);
    for (let i = 0; i < 8; i++) this.chunk(p, new THREE.Vector3(rand(-6, 6), rand(4, 10), rand(-6, 6)), [0x5a4a3a, 0x8a7a6a, PAL.mustard][i % 3], rand(0.08, 0.18), 1.8);
    this.lightFlash(p.clone().setY(p.y + 0.8), 0xffb347, 14, 0.35);
  }

  /** Two weapons fusing into a better one. */
  fuseBurst(p: THREE.Vector3, color: number) {
    this.glow.emit(p, { count: 40, color: [color, 0xffffff, color], speed: [2, 7], spread: 1, up: 1, life: [0.4, 0.9], size: [0.12, 0.28], shape: PShape.Star, drag: 3, spin: 12 });
    this.glow.emit(p, { count: 4, color, speed: 0, life: 0.3, size: 2.4, sizeEnd: 1.8, alpha: 0.7 });
    for (let i = 0; i < 3; i++) this.ring(p, i === 1 ? 0xffffff : color, 0.2, 1.4 + i * 0.8, 0.35 + i * 0.12, undefined, true);
    this.ring(p.clone().setY(p.y - 0.9), color, 0.2, 3, 0.5);
    this.lightFlash(p, color, 10, 0.4);
  }

  sparkBurst(p: THREE.Vector3, color: number, n = 12) {
    this.glow.emit(p, { count: n, color: [color, 0xffffff], speed: [2, 6], spread: 1, life: [0.2, 0.5], size: [0.08, 0.16], sizeEnd: 0.1, shape: PShape.Sparkle, drag: 3 });
  }

  /** A spent casing flicked out of the right side of the gun. */
  casing(p: THREE.Vector3, right: THREE.Vector3, fwd: THREE.Vector3, shell = false, loud = false) {
    if (this.casings.length >= 64) this.casings.shift();
    const v = new THREE.Vector3().copy(right).multiplyScalar(rand(2.2, 3.4)).addScaledVector(fwd, rand(-0.6, 0.4));
    v.y += rand(2.2, 3.4);
    this.casings.push({ pos: p.clone(), vel: v, rot: new THREE.Euler(0, rand(0, 6), 0), spin: new THREE.Vector3(rand(-20, 20), rand(-30, 30), rand(-20, 20)), life: rand(1.4, 2), bounced: false, color: new THREE.Color(shell ? 0xe0463c : 0xf2c14e), loud });
  }

  /** Leaves shaken out of a canopy (bullets, explosions) — they flutter down slowly. */
  leaves(p: THREE.Vector3, n = 6) {
    this.soft.emit(p, { count: n, color: [0x7cc35a, 0x5aa347, 0xa6d86a, 0xd9c35a], speed: [0.6, 2.2], spread: 1, up: 0.6, gravity: 1.4, drag: 2.2, life: [1.6, 2.8], size: [0.09, 0.15], sizeEnd: 0.9, shape: PShape.Confetti, spin: 7, jitter: 0.3 });
  }

  /** Cartoon KO: little stars circling where the head was. */
  koStars(p: THREE.Vector3) {
    this.glow.emit(p, { count: 5, color: [0xfff27a, 0xffffff, 0xffb13d], speed: [1.2, 2.2], spread: 1, up: 1.5, gravity: 2, life: [0.5, 0.8], size: [0.16, 0.26], sizeEnd: 0.3, shape: PShape.Star, drag: 3, spin: 10 });
  }

  /** Party cannon: a directional blast of confetti and streamers (victory!). */
  confettiCannon(p: THREE.Vector3, dir: THREE.Vector3) {
    const c = [PAL.mustard, PAL.pink, PAL.turquoise, PAL.lavender, 0xffffff, 0x9dff8a];
    this.soft.emit(p, { count: 46, color: c, speed: [8, 16], spread: 0.35, dir, gravity: 6, life: [2, 3.4], size: [0.1, 0.17], sizeEnd: 0.9, shape: PShape.Confetti, drag: 1.6, spin: 16 });
    this.glow.emit(p, { count: 14, color: c, speed: [6, 12], spread: 0.3, dir, gravity: 3, life: [0.6, 1.1], size: [0.18, 0.3], sizeEnd: 0.2, shape: PShape.Star, drag: 2, spin: 10 });
    this.glow.emit(p, { count: 2, color: 0xffffff, speed: 0, life: 0.12, size: 1.6, sizeEnd: 1.4, alpha: 0.8 });
    this.soft.emit(p, { count: 4, color: [0xe8e0d0, 0xffffff], speed: [1, 2], spread: 0.5, dir, life: [0.6, 1], size: [0.4, 0.6], sizeEnd: 2.5, alpha: 0.4, drag: 2 });
  }

  /** A jagged lightning bolt from the sky down to (or near) the ground. */
  bolt(top: THREE.Vector3, bottomY: number) {
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    b.active = true;
    b.t = 0;
    const pos = b.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = pos.count;
    let x = top.x, z = top.z;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      pos.setXYZ(i, x, top.y + (bottomY - top.y) * k, z);
      x += rand(-1.6, 1.6);
      z += rand(-1.6, 1.6);
    }
    pos.needsUpdate = true;
    b.line.visible = true;
    this.glow.emit(_p.set(x, bottomY, z), { count: 2, color: 0xf0d0ff, speed: 0, life: 0.25, size: 7, sizeEnd: 1.5, alpha: 0.6 });
  }

  /* ------------------------------------------------------ update */

  update(dt: number, camera: THREE.Camera) {
    this.soft.update(dt);
    this.glow.update(dt);

    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const k = tr.t / tr.dur;
      if (k > 1.6) {
        this.tracers.splice(i, 1);
        continue;
      }
      const dist = tr.a.distanceTo(tr.b);
      const head = Math.min(1, k) * dist;
      const tail = Math.max(0, head - tr.len * (k > 1 ? Math.max(0, 1.6 - k) / 0.6 : 1));
      _dir.subVectors(tr.b, tr.a).normalize();
      const l = Math.max(0.01, head - tail);
      _p.copy(tr.a).addScaledVector(_dir, head);
      _q.setFromUnitVectors(_z, _dir.clone().negate());
      const w = tr.width * (k > 1 ? Math.max(0, 1.6 - k) / 0.6 : 1);
      _m.compose(_p, _q, _s.set(w, w, l));
      this.tracerMesh.setMatrixAt(n, _m);
      this.tracerMesh.setColorAt(n, tr.color);
      n++;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;

    // rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const s = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.setScalar(s);
      if (r.billboard) r.mesh.quaternion.copy(camera.quaternion);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }

    // debris
    let dn = 0;
    const tmpN = _dir;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      d.vel.y -= 18 * dt;
      d.pos.addScaledVector(d.vel, dt);
      let bounced = false;
      this.cw.resolveSphere(d.pos, d.size * 0.5, ColFlags.BlocksMove, (nn) => {
        tmpN.copy(nn);
        bounced = true;
      }, 1);
      if (bounced) {
        const vn = d.vel.dot(tmpN);
        if (vn < 0) d.vel.addScaledVector(tmpN, -vn * 1.4);
        d.vel.multiplyScalar(0.7);
        d.spin.multiplyScalar(0.7);
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      const s = d.size * Math.min(1, d.life * 3);
      _q.setFromEuler(d.rot);
      _m.compose(d.pos, _q, _s.set(s, s, s));
      this.debrisMesh.setMatrixAt(dn, _m);
      this.debrisMesh.setColorAt(dn, d.color);
      dn++;
    }
    this.debrisMesh.count = dn;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;

    // smears: a ghost that stretches toward the destination then snaps & fades
    for (const s of this.smears) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const from = s.mesh.userData.from as THREE.Vector3, to = s.mesh.userData.to as THREE.Vector3;
      const e = 1 - Math.pow(1 - k, 4);
      const d = _dir.subVectors(to, from);
      const len = d.length();
      // orient capsule's local Y along travel, stretched
      if (len > 0.01) {
        d.normalize();
        s.mesh.quaternion.setFromUnitVectors(_p.set(0, 1, 0), d);
        const stretch = Math.max(1, (len * (1 - e)) / 1.7 + 0.5);
        s.mesh.scale.set(1 - k * 0.7, stretch, 1 - k * 0.7);
        s.mesh.position.copy(from).addScaledVector(d, len * e * 0.85).addScaledVector(_p.set(0, 1, 0), 0);
      }
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }

    // casings
    let cn = 0;
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.casings.splice(i, 1);
        continue;
      }
      c.vel.y -= 20 * dt;
      c.pos.addScaledVector(c.vel, dt);
      let hitN = false;
      this.cw.resolveSphere(c.pos, 0.03, ColFlags.BlocksMove, (nn) => {
        tmpN.copy(nn);
        hitN = true;
      }, 1);
      if (hitN) {
        const vn = c.vel.dot(tmpN);
        if (vn < -1.2) {
          c.vel.addScaledVector(tmpN, -vn * 1.45);
          c.vel.multiplyScalar(0.55);
          c.spin.multiplyScalar(0.6);
          if (!c.bounced && c.loud) this.onCasingLand?.(c.pos);
          c.bounced = true;
        } else if (vn < 0) {
          c.vel.addScaledVector(tmpN, -vn);
          c.vel.multiplyScalar(0.8);
          c.spin.multiplyScalar(0.8);
        }
      }
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      _q.setFromEuler(c.rot);
      const s = Math.min(1, c.life * 4);
      _m.compose(c.pos, _q, _s.set(s, s, s));
      this.casingMesh.setMatrixAt(cn, _m);
      this.casingMesh.setColorAt(cn, c.color);
      cn++;
    }
    this.casingMesh.count = cn;
    if (cn) {
      this.casingMesh.instanceMatrix.needsUpdate = true;
      if (this.casingMesh.instanceColor) this.casingMesh.instanceColor.needsUpdate = true;
    }

    // lightning: bright flash, quick flicker, gone
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      const mat = b.line.material as THREE.LineBasicMaterial;
      mat.opacity = b.t < 0.05 ? 1 : b.t < 0.09 ? 0.2 : b.t < 0.15 ? 0.9 : Math.max(0, 1 - (b.t - 0.15) / 0.2);
      if (b.t > 0.35) {
        b.active = false;
        b.line.visible = false;
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = this.flashI * Math.max(0, this.flashT / this.flashDur);
    } else this.flash.intensity = 0;
  }
}
