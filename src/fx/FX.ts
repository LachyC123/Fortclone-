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

  sparkBurst(p: THREE.Vector3, color: number, n = 12) {
    this.glow.emit(p, { count: n, color: [color, 0xffffff], speed: [2, 6], spread: 1, life: [0.2, 0.5], size: [0.08, 0.16], sizeEnd: 0.1, shape: PShape.Sparkle, drag: 3 });
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

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = this.flashI * Math.max(0, this.flashT / this.flashDur);
    } else this.flash.intensity = 0;
  }
}
