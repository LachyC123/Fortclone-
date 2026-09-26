import * as THREE from 'three';
import { CollisionWorld, ColFlags, OBB } from '../physics/Collision';
import { PAL } from '../render/Palette';
import { clamp, damp, lerp } from '../core/math';
import type { FX } from '../fx/FX';
import { PShape } from '../fx/Particles';
import { audio } from '../audio/Audio';
import { mergeChildren } from '../render/Merge';
import { BugSpecies, BugStats, SPECIES_BY_ID, statsFor, BASE_BUG_STATS } from '../progression/Bugs';
import { G } from '../render/Detail';

export const BUG = {
  radius: 0.14,
  throwSpeed: 19,
  upBias: 0.16, // radians added to the aim pitch
  gravity: 16,
  restitution: 0.42,
  friction: 0.78,
  window: 6, // seconds you can blink after throwing
  cooldownAfterBlink: 8,
  cooldownAfterExpire: 2.5,
  maxFlight: 3.2,
  step: 1 / 120,
};

export type BugState = 'docked' | 'flying' | 'landed' | 'returning' | 'piloted';

export interface BugOwner {
  isLocal: boolean;
  alive: boolean;
  dockWorld(out: THREE.Vector3): THREE.Vector3;
  facingYaw(): number;
}

const _n = new THREE.Vector3();
/** normal of the last surface a sticky bug grabbed */
export const _stuck = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Pure trajectory simulation — shared by gameplay and the aiming arc so the preview never lies. */
export function simulateBug(cw: CollisionWorld, pos: THREE.Vector3, vel: THREE.Vector3, dt: number, onBounce?: (n: THREE.Vector3, speed: number, o: OBB) => void, stats: BugStats = BASE_BUG_STATS): boolean {
  vel.y -= stats.gravity * dt;
  pos.addScaledVector(vel, dt);
  let settled = false;
  cw.resolveSphere(pos, BUG.radius, ColFlags.BlocksBug, (n, _d, o) => {
    const vn = vel.dot(n);
    if (stats.sticky) {
      // Stickle: splat and hold on to whatever it touched first
      if (onBounce && vn < -1.2) onBounce(n, -vn, o);
      vel.set(0, 0, 0);
      _stuck.copy(n);
      settled = true;
      return;
    }
    if (vn < 0) {
      const impact = -vn;
      vel.addScaledVector(n, -vn * (1 + stats.restitution));
      // tangential friction
      const vnn = vel.dot(n);
      _v.copy(vel).addScaledVector(n, -vnn).multiplyScalar(BUG.friction);
      vel.copy(_v).addScaledVector(n, vnn);
      if (onBounce && impact > 1.2) onBounce(n, impact, o);
    }
    if (n.y > 0.65 && vel.lengthSq() < 1.6 * 1.6) settled = true;
  }, 2);
  return settled;
}

/**
 * The Blinkbug: every rascal's glowing little accomplice. Throw it, then swap places with it.
 */
export class Blinkbug {
  root = new THREE.Group();
  private bodyG = new THREE.Group();
  private wingL: THREE.Mesh;
  private wingR: THREE.Mesh;
  private eyeL: THREE.Group;
  private eyeR: THREE.Group;
  private halo: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private legs: THREE.Mesh[] = [];
  private antennae: THREE.Group[] = [];
  state: BugState = 'docked';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  cooldown = 0;
  cooldownMax = 1;
  window = 0;
  private flightT = 0;
  private acc = 0;
  private squash = 0;
  private squashV = 0;
  private yaw = 0;
  private t = Math.random() * 10;
  private chirpT = 3;
  private idleLook = 0;
  private lookT = 0;
  private retFrom = new THREE.Vector3();
  private retT = 0;
  private retDur = 0.4;
  private dizzyT = 0;
  private wasReady = true;
  private zzzT = 0;
  excited = false;
  panic = 0;
  private baseScale = 1;

  species: BugSpecies;
  stats: BugStats;
  /** set when a sticky bug grabs a wall (blink lands you beside it) */
  stuckN: THREE.Vector3 | null = null;
  tint: number;

  constructor(private cw: CollisionWorld, private fx: FX, private owner: BugOwner, species: BugSpecies = SPECIES_BY_ID.zippit) {
    this.species = species;
    this.stats = statsFor(species);
    const tint = (this.tint = species.tint);
    const L = species.look;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.55, roughness: 0.3, transparent: !!L.ghost, opacity: L.ghost ? 0.72 : 1 });
    const belly = new THREE.MeshStandardMaterial({ color: species.belly, emissive: species.belly, emissiveIntensity: 0.3, roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const ink = new THREE.MeshStandardMaterial({ color: 0x1d1726, roughness: 0.2 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.3, metalness: 0.2 });
    const wingMat = new THREE.MeshBasicMaterial({ color: species.wing, transparent: true, opacity: L.longWings ? 0.7 : 0.55, side: THREE.DoubleSide, depthWrite: false });
    const bulb = new THREE.MeshBasicMaterial({ color: 0xfff6a0 });

    this.root.add(this.bodyG);
    const body = new THREE.Mesh(G.sphere(0.13, 16, 12), this.bodyMat);
    body.scale.set(1, 0.9, 1.1);
    body.castShadow = true;
    this.bodyG.add(body);
    const bellyM = new THREE.Mesh(G.sphere(0.09, 12, 8), belly);
    bellyM.position.set(0, -0.04, -0.05);
    this.bodyG.add(bellyM);
    // big googly eyes
    const mkEye = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.05, -0.1);
      const w = new THREE.Mesh(G.sphere(0.055, 12, 10), white);
      const p = new THREE.Mesh(G.sphere(0.03, 10, 8), ink);
      p.position.z = -0.035;
      const hl = new THREE.Mesh(G.sphere(0.01, 6, 4), white);
      hl.position.set(0.012, 0.012, -0.06);
      g.add(w, p, hl);
      this.bodyG.add(g);
      return g;
    };
    this.eyeL = mkEye(-0.05);
    this.eyeR = mkEye(0.05);
    // antennae with glowing bulbs
    for (const sx of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(sx * 0.04, 0.1, -0.03);
      const stalk = new THREE.Mesh(G.cylinder(0.008, 0.008, 0.12, 4), ink);
      stalk.position.y = 0.06;
      const b = new THREE.Mesh(G.sphere(0.022, 8, 6), bulb);
      b.position.y = 0.12;
      a.add(stalk, b);
      a.rotation.z = -sx * 0.4;
      this.bodyG.add(a);
      this.antennae.push(a);
    }
    // species extras
    if (L.horns) {
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(G.cone(0.03, 0.09, 6), new THREE.MeshStandardMaterial({ color: 0xfff1d8, roughness: 0.5 }));
        h.position.set(sx * 0.075, 0.1, -0.05);
        h.rotation.z = -sx * 0.6;
        this.bodyG.add(h);
      }
    }
    if (L.pincers) {
      for (const sx of [-1, 1]) {
        const pc = new THREE.Mesh(G.torus(0.035, 0.012, 5, 10, Math.PI * 1.2), ink);
        pc.position.set(sx * 0.045, -0.04, -0.13);
        pc.rotation.set(Math.PI / 2, 0, sx > 0 ? Math.PI * 0.9 : -Math.PI * 0.1);
        this.bodyG.add(pc);
      }
    }
    if (L.crown) {
      const c = new THREE.Mesh(G.cylinder(0.05, 0.045, 0.04, 10, 1, true), gold);
      c.position.set(0, 0.13, 0.01);
      this.bodyG.add(c);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = new THREE.Mesh(G.cone(0.012, 0.035, 4), gold);
        sp.position.set(Math.cos(a) * 0.048, 0.165, 0.01 + Math.sin(a) * 0.048);
        this.bodyG.add(sp);
      }
    }
    if (L.leaf) {
      const lf = new THREE.Mesh(G.sphere(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4fbf4a, roughness: 0.6 }));
      lf.scale.set(1, 0.18, 0.55);
      lf.position.set(0.02, 0.13, 0.03);
      lf.rotation.set(0.2, 0.6, 0.35);
      this.bodyG.add(lf);
    }
    // wings
    const wg = new THREE.CircleGeometry(0.12, 12);
    wg.scale(L.longWings ? 0.55 : 0.6, L.longWings ? 1.45 : 1, 1);
    wg.translate(0, L.longWings ? 0.15 : 0.1, 0);
    this.wingL = new THREE.Mesh(wg, wingMat);
    this.wingR = new THREE.Mesh(wg, wingMat);
    this.wingL.position.set(-0.05, 0.08, 0.05);
    this.wingR.position.set(0.05, 0.08, 0.05);
    this.bodyG.add(this.wingL, this.wingR);
    // stubby legs (springs for Hopper, sucker feet for Stickle)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(G.capsule(0.015, 0.04, 2, 4), ink);
      l.position.set(i % 2 ? 0.06 : -0.06, -0.11, i < 2 ? -0.04 : 0.04);
      this.bodyG.add(l);
      this.legs.push(l);
      if (L.springs) {
        for (let k = 0; k < 3; k++) {
          const coil = new THREE.Mesh(G.torus(0.018, 0.005, 4, 10), gold);
          coil.position.set(l.position.x, -0.13 - k * 0.016, l.position.z);
          coil.rotation.x = Math.PI / 2;
          this.bodyG.add(coil);
        }
      }
      if (L.suckers) {
        const sk = new THREE.Mesh(G.sphere(0.022, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff8fc0, roughness: 0.5 }));
        sk.scale.set(1, 0.45, 1);
        sk.position.set(l.position.x, -0.14, l.position.z);
        this.bodyG.add(sk);
      }
    }
    // soft halo
    this.halo = new THREE.Mesh(G.sphere(species.ability === 'ping' ? 0.34 : 0.22, 12, 8), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.root.add(this.halo);
    this.bodyG.scale.setScalar(L.scale ?? 1);
    this.baseScale = L.scale ?? 1;
    // merge static bits: eyes, antennae and body+legs each become one draw call
    const flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: tint, emissiveIntensity: 0.0 });
    for (const e of [this.eyeL, this.eyeR, ...this.antennae]) mergeChildren(e, flat);
    body.userData.keep = true; // glows: keeps its own emissive material
    mergeChildren(this.bodyG, flat);
    this.legs = [];
  }

  /** a happy wiggle (collection screen taps, hatching) */
  poke() {
    this.squashV += 9;
    this.excited = true;
    this.idleLook = (Math.random() - 0.5) * 2;
    audio.chirp(this.root.position, 1.1 + Math.random() * 0.4, 0.25);
  }

  /** hide the docked bug on far-away rascals (it's tiny at that range) */
  setFar(far: boolean) {
    this.root.visible = !(far && this.state === 'docked') && this.owner.alive;
  }

  get ready() {
    return this.state === 'docked' && this.cooldown <= 0;
  }
  get canBlink() {
    return (this.state === 'flying' || this.state === 'landed') && this.window > 0;
  }
  get out() {
    return this.state === 'flying' || this.state === 'landed';
  }

  /** Initial velocity for a throw along an aim direction. */
  static throwVelocity(dir: THREE.Vector3, out: THREE.Vector3, speed = BUG.throwSpeed) {
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    const yawX = dir.x, yawZ = dir.z;
    const h = Math.hypot(yawX, yawZ) || 1;
    const p = clamp(pitch + BUG.upBias, -0.9, 1.35);
    const cp = Math.cos(p);
    return out.set((yawX / h) * cp * speed, Math.sin(p) * speed, (yawZ / h) * cp * speed);
  }

  throw(from: THREE.Vector3, vel: THREE.Vector3) {
    if (!this.ready) return false;
    this.state = 'flying';
    this.pos.copy(from);
    this.vel.copy(vel);
    this.flightT = 0;
    this.window = this.stats.window;
    this.stuckN = null;
    this.acc = 0;
    this.squashV = 6;
    audio.bugThrow(from);
    audio.chirp(from, 1.3, 0.4);
    this.fx.glow.emit(from, { count: 8, color: [PAL.blink, 0xffffff], speed: [1, 3], spread: 1, life: [0.2, 0.4], size: [0.08, 0.14], shape: PShape.Sparkle });
    return true;
  }

  /** Called when the owner blinks: the bug appears where the owner was, dizzy, then flies home. */
  swapped(ownerOldPos: THREE.Vector3) {
    this.pos.copy(ownerOldPos).setY(ownerOldPos.y + 0.9);
    this.dizzyT = 0.3;
    this.beginReturn(this.stats.cooldown);
  }

  private beginReturn(cd: number) {
    this.state = 'returning';
    this.retFrom.copy(this.pos);
    this.retT = 0;
    this.window = 0;
    this.cooldown = cd;
    this.cooldownMax = cd;
    this.wasReady = false;
    const d = this.pos.distanceTo(this.owner.dockWorld(_p));
    this.retDur = clamp(d / 22, 0.25, 0.8);
  }

  recall() {
    if (this.out) {
      audio.chirp(this.pos, 0.8);
      this.beginReturn(BUG.cooldownAfterExpire);
    }
  }

  /** Owner eliminated but gets a second chance: the bug carries their spark. */
  startPilot(from: THREE.Vector3) {
    this.state = 'piloted';
    this.pos.copy(from);
    this.window = 0;
    this.cooldown = 0;
    this.root.visible = true;
    this.squashV = 10;
  }

  /** Owner eliminated: shocked face, then vanish. */
  vanish() {
    this.panic = 1;
    this.fx.sparkBurst(this.root.position, PAL.blink, 14);
    this.state = 'docked';
    this.root.visible = false;
  }

  reset() {
    this.state = 'docked';
    this.cooldown = 0;
    this.window = 0;
    this.root.visible = true;
    this.panic = 0;
  }

  update(dt: number) {
    this.t += dt;
    if (!this.owner.alive && this.state !== 'piloted') return;
    if (this.cooldown > 0 && this.state !== 'returning') this.cooldown = Math.max(0, this.cooldown - dt);
    else if (this.state === 'returning') this.cooldown = Math.max(0, this.cooldown - dt);

    switch (this.state) {
      case 'flying':
        this.updateFlying(dt);
        break;
      case 'landed':
        this.window -= dt;
        if (this.window <= 0) this.recall();
        break;
      case 'returning': {
        if (this.dizzyT > 0) {
          this.dizzyT -= dt;
          if (Math.random() < 0.3) this.fx.glow.emit(_p.copy(this.pos).setY(this.pos.y + 0.22), { count: 1, color: PAL.mustard, speed: 0.5, life: 0.3, size: 0.09, shape: PShape.Star });
          break;
        }
        this.retT += dt / this.retDur;
        const k = Math.min(1, this.retT);
        const e = k * k * (3 - 2 * k);
        const dock = this.owner.dockWorld(_p);
        this.pos.lerpVectors(this.retFrom, dock, e);
        this.pos.y += Math.sin(k * Math.PI) * Math.min(2.5, this.retFrom.distanceTo(dock) * 0.25);
        this.fx.bugTrail(this.pos);
        if (k >= 1) {
          this.state = 'docked';
          this.squashV = -5;
          audio.chirp(this.pos, 1.1, 0.25);
        }
        break;
      }
      case 'docked':
        break;
    }

    // becoming ready again
    if (this.state === 'docked' && this.cooldown <= 0 && !this.wasReady) {
      this.wasReady = true;
      this.squashV = 8;
      this.fx.sparkBurst(this.root.position, PAL.blink, 10);
      if (this.owner.isLocal) audio.bugReady();
    }

    this.animate(dt);
  }

  private updateFlying(dt: number) {
    this.flightT += dt;
    this.window -= dt;
    this.acc += dt;
    let settled = false;
    while (this.acc >= BUG.step) {
      this.acc -= BUG.step;
      settled = simulateBug(this.cw, this.pos, this.vel, BUG.step, (n, impact) => {
        if (this.stats.sticky) {
          this.stuckN = n.clone();
          audio.splat(this.pos);
        }
        this.squashV -= Math.min(10, impact * 0.9);
        audio.bugBounce(this.pos, impact);
        if (impact > 3) audio.chirp(this.pos, 1.4 + Math.random() * 0.3, 0.3);
        this.fx.dust(_p.copy(this.pos).addScaledVector(n, -BUG.radius), Math.min(5, impact * 0.5));
        this.fx.glow.emit(this.pos, { count: 3, color: [PAL.blink, 0xffffff], speed: [1, 3], spread: 1, life: 0.2, size: 0.08, shape: PShape.Sparkle });
      }, this.stats) || settled;
      if (settled) break;
    }
    this.fx.bugTrail(this.pos);
    if (settled || this.flightT > BUG.maxFlight) {
      this.state = 'landed';
      this.vel.set(0, 0, 0);
      this.squashV = -6;
      this.lookT = 0;
      audio.chirp(this.pos, 1.0, 0.3);
      this.fx.ring(_p.copy(this.pos).setY(this.pos.y - BUG.radius + 0.02), PAL.blink, 0.1, 0.9, 0.35);
    }
    if (this.window <= 0) this.recall();
    // fell off the world
    if (this.pos.y < -30) this.recall();
  }

  private animate(dt: number) {
    const t = this.t;
    this.squashV += (-this.squash * 220 - this.squashV * 12) * dt;
    this.squash += this.squashV * dt;
    const sq = clamp(this.squash * 0.06, -0.45, 0.45);
    const bs = this.baseScale;
    this.bodyG.scale.set((1 - sq * 0.6) * bs, (1 + sq) * bs, (1 - sq * 0.6) * bs);

    let flap = 0;
    let glow = 0.55;
    let eyeScaleY = 1;
    let bob = 0;
    const cdK = this.cooldownMax > 0 ? this.cooldown / this.cooldownMax : 0;

    if (this.state === 'docked') {
      const dock = this.owner.dockWorld(_p);
      // spring-follow the dock so it bounces with the backpack
      this.root.position.x = damp(this.root.position.x, dock.x, 30, dt);
      this.root.position.y = damp(this.root.position.y, dock.y, 30, dt);
      this.root.position.z = damp(this.root.position.z, dock.z, 30, dt);
      this.pos.copy(this.root.position);
      const sleepy = this.cooldown > 0;
      bob = Math.sin(t * 3) * 0.015;
      this.yaw = damp(this.yaw, this.owner.facingYaw() + this.idleLook, 8, dt);
      flap = this.excited ? Math.sin(t * 70) * 0.9 : Math.sin(t * 2) * 0.1;
      glow = sleepy ? 0.12 + (1 - cdK) * 0.3 : this.excited ? 1.1 : 0.55 + Math.sin(t * 4) * 0.1;
      eyeScaleY = sleepy ? 0.25 : 1;
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = 1 + Math.random() * 2.5;
        this.idleLook = (Math.random() - 0.5) * 2.2;
        if (!sleepy && Math.random() < 0.35) this.squashV += 4;
      }
      if (sleepy) {
        this.zzzT -= dt;
        if (this.zzzT <= 0) {
          this.zzzT = 0.8;
          this.fx.soft.emit(_p.copy(this.root.position).setY(this.root.position.y + 0.2), { count: 1, color: 0xe6f0ff, speed: 0.3, up: 0.6, life: 0.9, size: 0.1, sizeEnd: 1.4, alpha: 0.6, shape: PShape.Ring });
        }
      } else {
        this.chirpT -= dt;
        if (this.chirpT <= 0) {
          this.chirpT = 4 + Math.random() * 8;
          audio.chirp(this.root.position, 1, this.owner.isLocal ? 0.12 : 0.08);
          this.squashV += 5;
        }
      }
    } else if (this.state === 'flying') {
      this.root.position.copy(this.pos);
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > 0.5) this.yaw = Math.atan2(-this.vel.x, -this.vel.z);
      flap = Math.sin(t * 80) * 1.1;
      glow = 1.2;
      eyeScaleY = 1.25;
    } else if (this.state === 'landed') {
      this.root.position.copy(this.pos);
      bob = Math.abs(Math.sin(t * 6)) * 0.03 * (this.window < 2 ? 2.5 : 1);
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = 0.6 + Math.random();
        this.idleLook = (Math.random() - 0.5) * 4;
      }
      this.yaw = damp(this.yaw, this.idleLook, 6, dt);
      flap = Math.sin(t * 5) * 0.4;
      // beacon pulse speeds up as the window closes
      const urgency = 1 - this.window / this.stats.window;
      glow = 0.8 + Math.sin(t * (6 + urgency * 14)) * 0.4;
      if (Math.random() < dt * 6) this.fx.glow.emit(_p.copy(this.pos).setY(this.pos.y + 0.1), { count: 1, color: PAL.blink, speed: 0.3, up: 1.2, life: 0.6, size: 0.08, shape: PShape.Sparkle });
    } else {
      this.root.position.copy(this.pos);
      flap = Math.sin(t * 70) * 1;
      glow = 1;
      if (this.dizzyT > 0) this.yaw += dt * 20;
    }

    this.root.position.y += bob;
    this.root.rotation.set(0, this.yaw, this.state === 'flying' ? Math.sin(t * 20) * 0.3 : 0);
    this.wingL.rotation.set(0.3, 0.5 + flap, 0.2);
    this.wingR.rotation.set(0.3, -0.5 - flap, -0.2);
    this.eyeL.scale.set(1, eyeScaleY, 1);
    this.eyeR.scale.set(1, eyeScaleY, 1);
    this.bodyMat.emissiveIntensity = lerp(this.bodyMat.emissiveIntensity, glow, 0.2);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = this.state === 'docked' ? (this.excited ? 0.12 : 0) : 0.08 + glow * 0.14;
    this.halo.scale.setScalar(0.8 + glow * 0.4);
    for (let i = 0; i < this.antennae.length; i++) this.antennae[i].rotation.x = Math.sin(t * 5 + i) * 0.2 + (this.state === 'flying' ? 0.8 : 0);
    const legWiggle = this.state === 'landed' ? Math.sin(t * 20) * 0.3 : 0.4;
    for (let i = 0; i < this.legs.length; i++) this.legs[i].rotation.x = legWiggle * (i % 2 ? 1 : -1);
  }
}
