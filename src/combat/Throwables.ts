import * as THREE from 'three';
import { ColFlags, RayHit, raySphere } from '../physics/Collision';
import type { GameCtx } from '../core/types';
import type { Actor } from '../entities/Actor';
import { UTILS, UtilId, UtilDef, buildItemModel } from './Items';
import { WeaponDef } from './Weapons';
import { PShape } from '../fx/Particles';
import { PAL } from '../render/Palette';
import { audio } from '../audio/Audio';
import { clamp, rand } from '../core/math';
import { raycastActors } from './Combat';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hit: RayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const UP = new THREE.Vector3(0, 1, 0);

export const THROW = { step: 1 / 120, gravity: 20, radius: 0.12 };

interface Thrown {
  def: UtilDef;
  owner: Actor;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  t: number;
  settled: boolean;
  settleT: number;
  stuck: boolean;
  stuckTo: Actor | null;
  stuckOffset: THREE.Vector3;
  beepT: number;
  acc: number;
  spin: THREE.Vector3;
  nid: number;
}

interface Smoke {
  pos: THREE.Vector3;
  r: number;
  t: number;
  life: number;
}

interface Pad {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  t: number;
  life: number;
  wobble: number;
  wobbleV: number;
  cooldown: Map<number, number>;
  nid: number;
}

interface Chicken {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  mesh: THREE.Object3D;
  legs: THREE.Object3D[];
  t: number;
  life: number;
  cluckT: number;
  hp: number;
  owner: Actor;
  nid: number;
}

interface Bolt {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Actor;
  def: WeaponDef;
  damage: number;
  mesh: THREE.Object3D;
  t: number;
  stuck: boolean;
  nid: number;
}

/** Bug Jammer: a bubble enemy Blinkbugs can't fly into */
interface Jammer {
  pos: THREE.Vector3;
  owner: Actor;
  team: number;
  t: number;
  life: number;
  hp: number;
  mesh: THREE.Object3D;
  dome: THREE.Mesh;
  humT: number;
  nid: number;
}

/** Snap Trap: waits on the ground for an enemy foot */
interface Trap {
  pos: THREE.Vector3;
  owner: Actor;
  team: number;
  t: number;
  snapT: number;
  mesh: THREE.Object3D;
  nid: number;
}

/** Tanglet web: slows enemies standing in it */
interface Web {
  pos: THREE.Vector3;
  owner: Actor;
  team: number;
  t: number;
  life: number;
  mesh: THREE.Mesh;
  nid: number;
}

export const JAMMER_R = 8;
const WEB_R = 3.2;

/** LAN: what the host tells clients about each world object: [id, kind, x, y, z, a, b] */
export type NetProp = [number, number, number, number, number, number, number];
const UTIL_LIST = Object.keys(UTILS) as UtilId[];
const PK = { util: 0, pad: 1, chicken: 2, bolt: 3, pumpkin: 4, gloop: 5, jammer: 6, trap: 7, web: 8 } as const;

let nextNid = 1;

/** grid lines + the soft bubble inside, faded together */
function setDome(dome: THREE.Mesh, o: number) {
  (dome.material as THREE.MeshBasicMaterial).opacity = o;
  const shell = dome.children[0] as THREE.Mesh | undefined;
  if (shell) (shell.material as THREE.MeshBasicMaterial).opacity = o * 0.55;
}

function webTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.lineCap = 'round';
  const spokes = 12;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124);
    g.stroke();
  }
  g.lineWidth = 2.2;
  for (let r = 16; r < 124; r += 15) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const rr = r + (i % 2 ? 3 : -2);
      const x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(128 + Math.cos(a - Math.PI / spokes) * (rr - 5), 128 + Math.sin(a - Math.PI / spokes) * (rr - 5), x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared projectile physics for utilities (and the arc preview). */
export function simulateThrow(ctx: { cw: GameCtx['cw'] }, def: UtilDef, pos: THREE.Vector3, vel: THREE.Vector3, dt: number, onHit?: (n: THREE.Vector3, speed: number) => void): { settled: boolean; hit: boolean } {
  vel.y -= THROW.gravity * dt;
  pos.addScaledVector(vel, dt);
  let settled = false, hit = false;
  ctx.cw.resolveSphere(pos, THROW.radius, ColFlags.BlocksBug, (n) => {
    const vn = vel.dot(n);
    hit = true;
    if (vn < 0) {
      const impact = -vn;
      vel.addScaledVector(n, -vn * (1 + def.bounce));
      const vnn = vel.dot(n);
      _v.copy(vel).addScaledVector(n, -vnn).multiplyScalar(0.7);
      vel.copy(_v).addScaledVector(n, vnn);
      onHit?.(n, impact);
    }
    if (n.y > 0.6 && vel.lengthSq() < 2) settled = true;
  }, 2);
  return { settled, hit };
}

export function throwVelocity(def: UtilDef, dir: THREE.Vector3, out: THREE.Vector3) {
  const pitch = Math.asin(clamp(dir.y, -1, 1));
  const h = Math.hypot(dir.x, dir.z) || 1;
  const p = clamp(pitch + 0.2, -0.8, 1.3);
  return out.set((dir.x / h) * Math.cos(p) * def.speed, Math.sin(p) * def.speed, (dir.z / h) * Math.cos(p) * def.speed);
}

/**
 * Everything thrown or fired that lives in the world for a while: utilities, their effects
 * (smoke clouds, jelly pads, wind-up chickens) and Sparkbow bolts.
 */
export class Throwables {
  thrown: Thrown[] = [];
  smokes: Smoke[] = [];
  pads: Pad[] = [];
  chickens: Chicken[] = [];
  bolts: Bolt[] = [];
  jammers: Jammer[] = [];
  traps: Trap[] = [];
  webs: Web[] = [];
  private domeGeo = new THREE.IcosahedronGeometry(1, 2);
  private domeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: true });
  private shellGeo = new THREE.SphereGeometry(0.99, 24, 16);
  private shellMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private webGeo = new THREE.CircleGeometry(WEB_R, 24).rotateX(-Math.PI / 2);
  private webTex: THREE.Texture | null = null;
  private padGeo = (() => {
    const g = new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.35, 1);
    return g;
  })();
  private padMat = new THREE.MeshStandardMaterial({ color: 0x7ee06a, roughness: 0.15, transparent: true, opacity: 0.82, emissive: 0x2a8a20, emissiveIntensity: 0.3 });

  constructor(private scene: THREE.Scene) {}

  throw(owner: Actor, id: UtilId, from: THREE.Vector3, vel: THREE.Vector3) {
    const def = UTILS[id];
    const mesh = buildItemModel(id);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.thrown.push({ def, owner, pos: from.clone(), vel: vel.clone(), mesh, t: 0, settled: false, settleT: 0, stuck: false, stuckTo: null, stuckOffset: new THREE.Vector3(), beepT: 0, acc: 0, spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), nid: nextNid++ });
    audio.throwWhoosh(from);
  }

  fireBolt(owner: Actor, def: WeaponDef, damage: number, from: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.boltMesh(def.projectile!.style ?? 'bolt');
    g.position.copy(from);
    this.scene.add(g);
    this.bolts.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(def.projectile!.speed), owner, def, damage, mesh: g, t: 0, stuck: false, nid: nextNid++ });
  }

  private boltMesh(style: 'bolt' | 'pumpkin' | 'gloop'): THREE.Object3D {
    const g = new THREE.Group();
    if (style === 'pumpkin') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.55, emissive: 0x6a2a00, emissiveIntensity: 0.3 }));
      body.scale.set(1, 0.85, 1);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0x4f8a3a }));
      stalk.position.y = 0.12;
      // a grumpy carved face that glows
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
      face.position.set(0, -0.02, -0.12);
      g.add(body, stalk, face);
      g.userData.spin = true;
    } else if (style === 'gloop') {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x9dff6b, roughness: 0.15, emissive: 0x3a8a20, emissiveIntensity: 0.5, transparent: true, opacity: 0.9 }));
      blob.scale.set(0.85, 0.85, 1.4);
      g.add(blob);
    } else {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6), new THREE.MeshStandardMaterial({ color: PAL.woodLight }));
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), new THREE.MeshBasicMaterial({ color: PAL.blink }));
      tip.position.z = -0.32;
      tip.scale.set(0.8, 0.8, 1.8);
      g.add(shaft, tip);
    }
    return g;
  }

  /** Is the line from a to b blocked by a smoke cloud? */
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3) {
    if (!this.smokes.length) return false;
    const d = _v.subVectors(b, a);
    const len = d.length();
    d.divideScalar(len || 1);
    for (const s of this.smokes) {
      const k = Math.min(1, s.t / 1.0) * Math.min(1, (s.life - s.t) / 1.5);
      const t = raySphere(a, d, s.pos, s.r * k);
      if (t >= 0 && t < len) return true;
    }
    return false;
  }

  /**
   * Bullet vs things that can be shot: chickens pop, enemy Bug Jammers take damage.
   * Returns t of the nearest hit or -1.
   */
  shootProps(o: THREE.Vector3, d: THREE.Vector3, maxT: number, ctx: GameCtx, shooter?: Actor | null, dmg = 20): number {
    let best = -1;
    let bc: Chicken | null = null, bj: Jammer | null = null;
    for (const c of this.chickens) {
      const t = raySphere(o, d, _v.copy(c.pos).setY(c.pos.y + 0.15), 0.25);
      if (t >= 0 && t < maxT && (best < 0 || t < best)) {
        best = t;
        bc = c;
      }
    }
    for (const j of this.jammers) {
      if (shooter && shooter.team === j.team) continue;
      const t = raySphere(o, d, _v.copy(j.pos).setY(j.pos.y + 0.15), 0.3);
      if (t >= 0 && t < maxT && (best < 0 || t < best)) {
        best = t;
        bj = j;
        bc = null;
      }
    }
    if (bj) this.hurtJammer(bj, dmg, shooter ?? null, ctx);
    else if (bc) this.popChicken(bc, ctx);
    return best;
  }

  update(dt: number, ctx: GameCtx) {
    this.updateThrown(dt, ctx);
    this.updateSmokes(dt, ctx);
    this.updatePads(dt, ctx);
    this.updateChickens(dt, ctx);
    this.updateBolts(dt, ctx);
    this.updateJammers(dt, ctx);
    this.updateTraps(dt, ctx);
    this.updateWebs(dt, ctx);
  }

  /** a new match: clear everything left lying around */
  clear() {
    for (const list of [this.thrown, this.pads, this.chickens, this.bolts, this.jammers, this.traps, this.webs] as { mesh: THREE.Object3D }[][]) {
      for (const o of list) this.scene.remove(o.mesh);
      list.length = 0;
    }
    this.smokes.length = 0;
  }

  /* ------------------------------------------------------------------ thrown items */

  private updateThrown(dt: number, ctx: GameCtx) {
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const th = this.thrown[i];
      th.t += dt;
      let trigger = false;
      if (th.stuck) {
        if (th.stuckTo) {
          if (!th.stuckTo.alive) th.stuckTo = null;
          else th.pos.copy(th.stuckTo.motor.pos).add(th.stuckOffset);
        }
      } else if (!th.settled) {
        th.acc += dt;
        while (th.acc >= THROW.step) {
          th.acc -= THROW.step;
          const prev = _v2.copy(th.pos);
          const r = simulateThrow(ctx, th.def, th.pos, th.vel, THROW.step, (n, speed) => {
            if (speed > 2) audio.thud(th.pos, Math.min(0.5, speed * 0.04));
            if (th.def.id === 'gust') trigger = true;
            if (th.def.sticky && !th.stuck) {
              th.stuck = true;
              th.vel.set(0, 0, 0);
              th.pos.addScaledVector(n, -0.05);
              audio.stick(th.pos);
            }
            if (th.def.id === 'bouncejam' && n.y > 0.6) trigger = true;
          });
          // sticky pops can latch onto rascals too
          if (th.def.sticky && !th.stuck) {
            const d = _n.subVectors(th.pos, prev);
            const len = d.length();
            if (len > 1e-4) {
              const ah = raycastActors(ctx, prev, d.divideScalar(len), len + 0.15, th.t < 0.15 ? th.owner : null);
              if (ah) {
                th.stuck = true;
                th.stuckTo = ah.actor;
                th.stuckOffset.copy(prev).addScaledVector(d, ah.t).sub(ah.actor.motor.pos);
                th.vel.set(0, 0, 0);
                audio.stick(th.pos);
                ah.actor.me?.hud.toast('STUCK! RUN!', '#ff5c8a');
              }
            }
          }
          if (r.settled && !th.stuck) {
            th.settled = true;
            th.settleT = th.t;
            break;
          }
          if (trigger || th.stuck) break;
        }
        th.mesh.rotation.x += th.spin.x * dt;
        th.mesh.rotation.z += th.spin.z * dt;
        if (th.def.id === 'fizzbomb' && Math.random() < dt * 30) ctx.fx.soft.emit(th.pos, { count: 1, color: [PAL.lavender, PAL.pink, PAL.mustard], speed: 0.3, life: 0.5, size: 0.14, sizeEnd: 2, alpha: 0.6 });
        if (th.pos.y < -30) {
          this.removeThrown(i);
          continue;
        }
      }
      th.mesh.position.copy(th.pos);

      // fuses & triggers
      const fuseStart = th.def.sticky ? (th.stuck ? th.t : Infinity) : th.settled ? th.settleT : Infinity;
      if (th.def.sticky && th.stuck) {
        th.beepT -= dt;
        const since = th.t - (th.settleT || (th.settleT = th.t));
        const rate = since > th.def.fuse * 0.6 ? 0.12 : 0.3;
        if (th.beepT <= 0) {
          th.beepT = rate;
          audio.beep(th.pos, since / th.def.fuse);
          ctx.fx.glow.emit(th.pos, { count: 1, color: 0xff2020, speed: 0, life: 0.12, size: 0.35, sizeEnd: 0.5 });
        }
        if (since >= th.def.fuse) trigger = true;
      } else if (th.t - fuseStart >= th.def.fuse) trigger = true;
      if (th.t > 6) trigger = true;

      if (trigger) {
        this.detonate(th, ctx);
        this.removeThrown(i);
      }
    }
  }

  private removeThrown(i: number) {
    this.scene.remove(this.thrown[i].mesh);
    this.thrown.splice(i, 1);
  }

  private detonate(th: Thrown, ctx: GameCtx) {
    const p = th.pos.clone();
    switch (th.def.id) {
      case 'fizzbomb':
        this.smokes.push({ pos: p.clone().setY(p.y + 1.2), r: 5.5, t: 0, life: 10 });
        audio.fizz(p);
        ctx.fx.ring(p.clone().setY(p.y + 0.1), PAL.lavender, 0.3, 5, 0.5);
        ctx.fx.glow.emit(p, { count: 20, color: [PAL.pink, PAL.mustard, PAL.turquoise, PAL.lavender], speed: [3, 7], spread: 1, up: 3, life: [0.3, 0.7], size: [0.15, 0.3], shape: PShape.Star, drag: 3 });
        ctx.emitSound({ pos: p, loudness: 25, source: th.owner, kind: 'impact' });
        break;
      case 'bouncejam': {
        const mesh = new THREE.Mesh(this.padGeo, this.padMat);
        mesh.position.copy(p).setY(p.y - THROW.radius + 0.02);
        mesh.scale.setScalar(0.01);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.pads.push({ pos: mesh.position.clone(), mesh, t: 0, life: 14, wobble: 0, wobbleV: 8, cooldown: new Map(), nid: nextNid++ });
        audio.splat(p);
        ctx.fx.soft.emit(p, { count: 16, color: [0x7ee06a, 0xb6ff9a, 0xffffff], speed: [2, 5], spread: 1, up: 3, gravity: 12, life: [0.4, 0.8], size: [0.1, 0.2], shape: PShape.Soft });
        break;
      }
      case 'chicken': {
        const mesh = buildItemModel('chicken', false);
        const legs = mesh.children.filter((c) => (c as THREE.Mesh).geometry.type === 'CylinderGeometry').slice(0, 2);
        mesh.scale.setScalar(1.6);
        this.scene.add(mesh);
        const yaw = Math.atan2(th.vel.x, th.vel.z) || th.owner.bodyYaw + Math.PI;
        this.chickens.push({ pos: p.clone(), vel: new THREE.Vector3(), yaw: Math.atan2(-(th.owner.intent.aimDir.x), -(th.owner.intent.aimDir.z)), mesh, legs, t: 0, life: 8, cluckT: 0, hp: 1, owner: th.owner, nid: nextNid++ });
        void yaw;
        audio.cluck(p, 1.4);
        break;
      }
      case 'gust':
        this.gust(p, th.owner, ctx);
        break;
      case 'stickypop':
        this.explode(p, th.owner, ctx, 60, 4.5, 'STICKY POP');
        break;
      case 'jammer':
        this.placeJammer(p.setY(p.y - THROW.radius), th.owner, ctx);
        break;
      case 'snaptrap':
        this.placeTrap(p.setY(p.y - THROW.radius), th.owner, ctx);
        break;
    }
  }

  gust(p: THREE.Vector3, owner: Actor, ctx: GameCtx) {
    const R = 6;
    audio.gust(p);
    ctx.fx.ring(p, 0xffffff, 0.3, R, 0.4);
    ctx.fx.ring(p.clone().setY(p.y + 0.8), 0xbfeaf2, 0.3, R * 0.8, 0.5, undefined, true);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      _n.set(Math.cos(a), rand(0, 0.5), Math.sin(a));
      ctx.fx.soft.emit(p, { count: 1, color: [0xffffff, 0xdff6ff], speed: [8, 12], spread: 0.1, dir: _n, life: [0.3, 0.5], size: [0.3, 0.5], sizeEnd: 2.5, alpha: 0.5, drag: 4 });
    }
    for (const a of ctx.actors) {
      if (!a.alive) continue;
      const d = _v.subVectors(a.motor.pos, p);
      d.y = 0;
      const dist = d.length();
      if (dist > R) continue;
      const k = 1 - dist / R;
      if (dist < 0.01) d.set(Math.sin(a.bodyYaw), 0, Math.cos(a.bodyYaw));
      d.normalize();
      a.motor.impulse(_v2.copy(d).multiplyScalar(9 + 9 * k).setY(6 + 5 * k));
      a.rig.onHit(0, 0);
      a.me?.shake(0.35);
    }
    ctx.world.pushProps(p, R, 10);
    ctx.emitSound({ pos: p.clone(), loudness: 25, source: owner, kind: 'impact' });
  }

  explode(p: THREE.Vector3, owner: Actor | null, ctx: GameCtx, maxDmg: number, R: number, weaponName: string) {
    audio.explosion(p);
    ctx.fx.explosion(p, R);
    const lp = ctx.localActor;
    if (lp) {
      const d = lp.motor.pos.distanceTo(p);
      ctx.shake(clamp(1.1 - d / 22, 0, 0.9));
    }
    for (const a of ctx.actors) {
      if (!a.alive) continue;
      const c = a.headCenter(_v).setY(a.motor.pos.y + 0.9);
      const dist = c.distanceTo(p);
      if (dist > R) continue;
      if (!ctx.cw.lineClear(p.clone().setY(p.y + 0.3), c, ColFlags.BlocksBullets)) continue;
      const k = 1 - dist / R;
      const dmg = Math.round(maxDmg * (0.35 + 0.65 * k) * (a === owner ? 0.5 : 1));
      const dir = _v2.subVectors(c, p).normalize();
      a.motor.impulse(dir.clone().multiplyScalar(7 * k + 2).setY(5 * k + 2));
      const killed = a.takeDamage(dmg, owner, false, dir, ctx, weaponName);
      if (owner?.me && a !== owner) {
        owner.me.hud.hitmarker(false, killed);
        owner.me.hud.damageNumber(c.clone().setY(c.y + 1), dmg, false);
      }
    }
    for (const ch of [...this.chickens]) if (ch.pos.distanceTo(p) < R) this.popChicken(ch, ctx);
    for (const j of [...this.jammers]) if (j.team !== owner?.team && j.pos.distanceTo(p) < R) this.hurtJammer(j, maxDmg, owner, ctx);
    ctx.world.pushProps(p, R, 12);
    ctx.emitSound({ pos: p.clone(), loudness: 70, source: owner, kind: 'gunshot' });
  }

  /* ------------------------------------------------------------------ effects */

  private updateSmokes(dt: number, ctx: GameCtx) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      if (s.t > s.life) {
        this.smokes.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, s.t / 1.0);
      const fade = Math.min(1, (s.life - s.t) / 2);
      const rate = s.t < 1 ? 70 : 22;
      const n = Math.floor(rate * dt + Math.random());
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * s.r * grow * 0.85;
        _v.set(s.pos.x + Math.cos(a) * rr, s.pos.y - 1 + Math.random() * 2.2, s.pos.z + Math.sin(a) * rr);
        ctx.fx.soft.emit(_v, { count: 1, color: [0xd6c2ff, 0xffc4e0, 0xfff0a8, 0xbff3ff, 0xe8dcff], speed: 0.4, up: 0.2, life: [1.6, 2.6], size: [1.6, 2.6], sizeEnd: 1.5, alpha: 0.55 * fade, drag: 1 });
      }
    }
  }

  private updatePads(dt: number, ctx: GameCtx) {
    for (let i = this.pads.length - 1; i >= 0; i--) {
      const pad = this.pads[i];
      pad.t += dt;
      pad.wobbleV += (-pad.wobble * 120 - pad.wobbleV * 5) * dt;
      pad.wobble += pad.wobbleV * dt;
      const appear = Math.min(1, pad.t / 0.25);
      const gone = Math.min(1, (pad.life - pad.t) / 0.6);
      const s = Math.max(0.01, appear * gone);
      pad.mesh.scale.set(s * (1 - pad.wobble * 0.15), s * (1 + pad.wobble * 0.5), s * (1 - pad.wobble * 0.15));
      for (const a of ctx.actors) {
        if (!a.alive) continue;
        const dx = a.motor.pos.x - pad.pos.x, dz = a.motor.pos.z - pad.pos.z;
        const dy = a.motor.pos.y - pad.pos.y;
        const cd = pad.cooldown.get(a.id) ?? 0;
        if (cd > pad.t) continue;
        if (dx * dx + dz * dz < 1.6 * 1.6 && dy > -0.3 && dy < 0.8 && a.motor.vel.y <= 1) {
          pad.cooldown.set(a.id, pad.t + 0.4);
          const hv = Math.hypot(a.motor.vel.x, a.motor.vel.z);
          a.motor.vel.y = 0;
          a.motor.impulse(_v.set(a.motor.vel.x * 0.25, 17, a.motor.vel.z * 0.25));
          void hv;
          a.rig.onJump();
          pad.wobbleV -= 10;
          audio.boing(pad.pos);
          ctx.fx.soft.emit(pad.pos.clone().setY(pad.pos.y + 0.4), { count: 10, color: [0x7ee06a, 0xb6ff9a], speed: [2, 4], spread: 1, up: 2, gravity: 10, life: 0.5, size: [0.1, 0.18] });
          ctx.fx.ring(pad.pos.clone().setY(pad.pos.y + 0.3), 0xb6ff9a, 0.5, 2.5, 0.3);
        }
      }
      if (pad.t > pad.life) {
        this.scene.remove(pad.mesh);
        this.pads.splice(i, 1);
      }
    }
  }

  private updateChickens(dt: number, ctx: GameCtx) {
    for (let i = this.chickens.length - 1; i >= 0; i--) {
      const c = this.chickens[i];
      c.t += dt;
      // run in a (slightly wobbly) straight line, turning away from walls
      const sp = 5;
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      c.vel.x = fx * sp;
      c.vel.z = fz * sp;
      c.vel.y -= 20 * dt;
      c.pos.addScaledVector(c.vel, dt);
      let wall = false;
      ctx.cw.resolveSphere(_v.copy(c.pos).setY(c.pos.y + 0.2), 0.2, ColFlags.BlocksMove, (n) => {
        if (n.y > 0.6) {
          if (c.vel.y < 0) c.vel.y = 0;
        } else wall = true;
      });
      c.pos.copy(_v).setY(_v.y - 0.2);
      if (wall) c.yaw += Math.PI * (0.5 + Math.random() * 0.7);
      c.yaw += Math.sin(c.t * 3) * dt * 0.6;
      c.mesh.position.copy(c.pos);
      c.mesh.position.y += Math.abs(Math.sin(c.t * 18)) * 0.06;
      c.mesh.rotation.set(0, c.yaw, Math.sin(c.t * 18) * 0.15);
      c.legs.forEach((l, k) => (l.rotation.x = Math.sin(c.t * 22 + k * Math.PI) * 0.8));
      c.cluckT -= dt;
      if (c.cluckT <= 0) {
        c.cluckT = rand(0.35, 0.8);
        audio.cluck(c.pos, rand(0.9, 1.3));
        // sounds like a rascal running around (and sometimes like gunfire!)
        ctx.emitSound({ pos: c.pos.clone(), loudness: 26, source: c.owner, kind: 'footstep' });
        if (Math.random() < 0.3) ctx.emitSound({ pos: c.pos.clone(), loudness: 45, source: c.owner, kind: 'impact' });
      }
      if (Math.random() < dt * 8) ctx.fx.soft.emit(c.pos, { count: 1, color: 0xffffff, speed: 1, up: 1, gravity: 3, life: 0.8, size: 0.06, shape: PShape.Confetti, spin: 8 });
      if (c.t > c.life || c.pos.y < -20) {
        this.popChicken(c, ctx);
      }
    }
  }

  private popChicken(c: Chicken, ctx: GameCtx) {
    const i = this.chickens.indexOf(c);
    if (i < 0) return;
    this.chickens.splice(i, 1);
    this.scene.remove(c.mesh);
    audio.cluck(c.pos, 1.8);
    audio.pop(c.pos);
    ctx.fx.soft.emit(c.pos.clone().setY(c.pos.y + 0.2), { count: 24, color: [0xffffff, 0xfff6e6], speed: [2, 5], spread: 1, up: 2, gravity: 2, life: [1, 2], size: [0.08, 0.14], shape: PShape.Confetti, drag: 2, spin: 10 });
  }

  private updateBolts(dt: number, ctx: GameCtx) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.stuck) {
        if (b.t > 5) this.removeBolt(i);
        continue;
      }
      const prev = _v2.copy(b.pos);
      b.vel.y -= b.def.projectile!.gravity * dt;
      const step = b.vel.length() * dt;
      const dir = _n.copy(b.vel).normalize();
      const wh = ctx.cw.raycast(prev, dir, step, ColFlags.BlocksBullets, _hit);
      const maxT = wh ? wh.t : step;
      const ah = raycastActors(ctx, prev, dir, maxT, b.t < 0.1 ? b.owner : null);
      const ct = this.shootProps(prev, dir, ah ? ah.t : maxT, ctx, b.owner, b.damage);
      const proj = b.def.projectile!;
      if (ah && (ct < 0 || ah.t <= ct)) {
        const p = prev.clone().addScaledVector(dir, ah.t);
        const dmg = Math.round(b.damage * (ah.headshot ? b.def.headMult : 1));
        const killed = ah.actor.takeDamage(dmg, b.owner, ah.headshot, dir, ctx, b.def.short);
        ctx.fx.hitSplat(p, ah.headshot);
        if (proj.slow && ah.actor.alive) {
          ah.actor.slow(proj.slow.k, proj.slow.t);
          this.gloopSplat(p, ctx);
          ah.actor.me?.hud.toast('GLOOPED! Slowed down', '#9dff6b');
        } else if (!proj.explode) ctx.fx.sparkBurst(p, PAL.blink, 14);
        if (b.owner.me) {
          b.owner.me.hud.hitmarker(ah.headshot, killed);
          b.owner.me.hud.damageNumber(p.clone().setY(p.y + 0.8), dmg, ah.headshot);
          b.owner.me.sfx.hitmarker(ah.headshot, killed);
        }
        if (proj.explode) this.explode(p, b.owner, ctx, proj.explode.dmg, proj.explode.r, b.def.short);
        this.removeBolt(i);
        continue;
      }
      if (ct >= 0) {
        if (proj.explode) this.explode(prev.clone().addScaledVector(dir, ct), b.owner, ctx, proj.explode.dmg, proj.explode.r, b.def.short);
        this.removeBolt(i);
        continue;
      }
      if (wh && (proj.explode || proj.slow)) {
        // pumpkins burst, gloop splats: neither sticks around
        if (proj.explode) this.explode(wh.point.clone().addScaledVector(wh.normal, 0.2), b.owner, ctx, proj.explode.dmg, proj.explode.r, b.def.short);
        else this.gloopSplat(wh.point, ctx);
        this.removeBolt(i);
        continue;
      }
      if (wh) {
        b.pos.copy(wh.point);
        b.stuck = true;
        b.t = 0;
        ctx.fx.impact(wh.point, wh.normal, wh.collider!.surface);
        ctx.fx.sparkBurst(wh.point, PAL.blink, 8);
        audio.impact(wh.point, wh.collider!.surface);
        ctx.world.onBulletHit(wh.collider!, wh.point, dir);
      } else b.pos.addScaledVector(dir, step);
      b.mesh.position.copy(b.pos);
      if (b.mesh.userData.spin) b.mesh.rotation.x -= dt * 9;
      else b.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, -1), dir);
      const style = proj.style ?? 'bolt';
      if (style === 'bolt') ctx.fx.glow.emit(b.pos, { count: 1, color: [PAL.blink, 0xffffff], speed: 0.2, life: 0.3, size: 0.12, sizeEnd: 0.2 });
      else if (style === 'pumpkin') {
        if (Math.random() < dt * 30) ctx.fx.soft.emit(b.pos, { count: 1, color: [0xffe27a, 0xff9a3c], speed: 0.3, life: 0.3, size: 0.1, sizeEnd: 0.4, alpha: 0.7 });
      } else if (Math.random() < dt * 25) ctx.fx.soft.emit(b.pos, { count: 1, color: [0x9dff6b, 0x6fd64a], speed: 0.4, gravity: 6, life: 0.4, size: 0.08, sizeEnd: 0.2, alpha: 0.9 });
      if (b.t > 4) this.removeBolt(i);
    }
  }

  private removeBolt(i: number) {
    this.scene.remove(this.bolts[i].mesh);
    this.bolts.splice(i, 1);
  }

  private gloopSplat(p: THREE.Vector3, ctx: GameCtx) {
    audio.splat(p);
    ctx.fx.soft.emit(p, { count: 12, color: [0x9dff6b, 0x6fd64a, 0xd8ffc0], speed: [1.5, 4], spread: 1, up: 2, gravity: 12, life: [0.4, 0.8], size: [0.08, 0.16] });
  }

  /* ------------------------------------------------------------------ Bug Jammer */

  private buildJammer(): { mesh: THREE.Object3D; dome: THREE.Mesh } {
    const g = new THREE.Group();
    const dev = buildItemModel('jammer');
    dev.scale.setScalar(1.8);
    g.add(dev);
    const dome = new THREE.Mesh(this.domeGeo, this.domeMat.clone());
    dome.scale.setScalar(0.01);
    // a soft bubble under the grid lines
    const shell = new THREE.Mesh(this.shellGeo, this.shellMat.clone());
    dome.add(shell);
    g.add(dome);
    return { mesh: g, dome };
  }

  placeJammer(p: THREE.Vector3, owner: Actor, ctx: GameCtx) {
    const { mesh, dome } = this.buildJammer();
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.jammers.push({ pos: p.clone(), owner, team: owner.team, t: 0, life: 22, hp: 45, mesh, dome, humT: 0, nid: nextNid++ });
    audio.jam(p);
    ctx.fx.ring(_v.copy(p).setY(p.y + 0.1), 0xff3b3b, 0.3, JAMMER_R, 0.6);
    owner.me?.hud.toast('BUG JAMMER UP: enemy bugs get zapped in the bubble', '#ff6b6b');
  }

  hurtJammer(j: Jammer, dmg: number, by: Actor | null, ctx: GameCtx) {
    j.hp -= dmg;
    ctx.fx.sparkBurst(_v.copy(j.pos).setY(j.pos.y + 0.2), 0xff3b3b, 8);
    audio.impact(j.pos, 'metal');
    by?.me?.hud.hitmarker(false, j.hp <= 0);
    if (j.hp > 0) return;
    const i = this.jammers.indexOf(j);
    if (i < 0) return;
    this.scene.remove(j.mesh);
    this.jammers.splice(i, 1);
    audio.pop(j.pos);
    audio.jam(j.pos);
    ctx.fx.sparkBurst(_v.copy(j.pos).setY(j.pos.y + 0.3), 0xff3b3b, 24);
    ctx.fx.dust(j.pos, 6, 0xd0d0d0);
    by?.me?.hud.toast('BUG JAMMER DESTROYED', '#ff6b6b');
    j.owner.me?.hud.toast('Your Bug Jammer was destroyed!', '#ff6b6b');
  }

  private updateJammers(dt: number, ctx: GameCtx) {
    for (let i = this.jammers.length - 1; i >= 0; i--) {
      const j = this.jammers[i];
      j.t += dt;
      const grow = Math.min(1, j.t / 0.6);
      const fade = Math.min(1, (j.life - j.t) / 0.8);
      j.dome.scale.setScalar(Math.max(0.01, JAMMER_R * grow * (0.3 + 0.7 * fade)));
      j.dome.rotation.y += dt * 0.3;
      setDome(j.dome, (0.07 + Math.sin(j.t * 4) * 0.02) * fade);
      j.humT -= dt;
      if (j.humT <= 0) {
        j.humT = 2.4;
        audio.jamHum(j.pos);
        ctx.fx.ring(_v.copy(j.pos).setY(j.pos.y + 0.05), 0xff3b3b, 0.3, JAMMER_R, 1.2);
      }
      // zap any enemy Blinkbug inside the bubble
      const top = _v2.copy(j.pos).setY(j.pos.y + 0.7);
      for (const a of ctx.actors) {
        if (a.team === j.team || !a.bug.out) continue;
        if (a.bug.pos.distanceTo(j.pos) > JAMMER_R) continue;
        const at = a.bug.pos.clone();
        if (!a.bug.jam()) continue;
        let q = top.clone();
        for (let k = 1; k <= 4; k++) {
          const r = k === 4 ? at : top.clone().lerp(at, k / 4).add(_n.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)));
          ctx.fx.tracer(q, r, 0xff3b3b, 0.06);
          q = r;
        }
        ctx.fx.sparkBurst(at, 0xff3b3b, 16);
        audio.jam(at);
        a.me?.hud.bigToast('JAMMED!', '#ff6b6b');
        a.me?.hud.toast('A Bug Jammer zapped your Blinkbug', '#ff6b6b');
        j.owner.me?.hud.toast(`Jammer zapped ${a.name}'s bug!`, '#ff6b6b');
      }
      if (j.t > j.life) {
        this.scene.remove(j.mesh);
        this.jammers.splice(i, 1);
        ctx.fx.sparkBurst(_v.copy(j.pos).setY(j.pos.y + 0.3), 0xff3b3b, 10);
      }
    }
  }

  /** is this spot inside a Bug Jammer that doesn't belong to this team? */
  jammedAt(p: THREE.Vector3, team: number) {
    for (const j of this.jammers) if (j.team !== team && j.pos.distanceTo(p) <= JAMMER_R) return true;
    return false;
  }

  /* ------------------------------------------------------------------ Snap Trap */

  placeTrap(p: THREE.Vector3, owner: Actor, ctx: GameCtx) {
    const mesh = buildItemModel('snaptrap', false);
    mesh.scale.setScalar(2.2);
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.traps.push({ pos: p.clone(), owner, team: owner.team, t: 0, snapT: -1, mesh, nid: nextNid++ });
    audio.thud(p, 0.3);
    ctx.fx.dust(p, 2);
  }

  private updateTraps(dt: number, ctx: GameCtx) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      tr.t += dt;
      if (tr.snapT >= 0) {
        tr.snapT += dt;
        this.poseTrap(tr.mesh, Math.min(1, tr.snapT / 0.08), tr.snapT);
        if (tr.snapT > 1.4) {
          this.scene.remove(tr.mesh);
          this.traps.splice(i, 1);
        }
        continue;
      }
      if (tr.t > 90) {
        this.scene.remove(tr.mesh);
        this.traps.splice(i, 1);
        continue;
      }
      if (tr.t < 0.8) continue; // arming
      for (const a of ctx.actors) {
        if (!a.alive || a.parked || a.team === tr.team || a.flight !== 'none') continue;
        const dx = a.motor.pos.x - tr.pos.x, dz = a.motor.pos.z - tr.pos.z, dy = a.motor.pos.y - tr.pos.y;
        if (dx * dx + dz * dz > 1.05 * 1.05 || dy < -0.4 || dy > 0.9) continue;
        tr.snapT = 0;
        audio.snap(tr.pos);
        ctx.fx.sparkBurst(_v.copy(tr.pos).setY(tr.pos.y + 0.3), 0xf2c14e, 14);
        ctx.fx.ring(_v.copy(tr.pos).setY(tr.pos.y + 0.1), 0xf2c14e, 0.2, 2, 0.3);
        a.slow(0.35, 2.5);
        a.pingT = 4;
        a.pingedBy = tr.owner;
        a.takeDamage(25, tr.owner, false, _v2.set(0, 1, 0), ctx, 'SNAP TRAP');
        a.me?.hud.bigToast('SNAPPED!', '#f2c14e');
        tr.owner.me?.hud.toast(`SNAP! Caught ${a.name}`, '#f2c14e');
        ctx.emitSound({ pos: tr.pos.clone(), loudness: 40, source: tr.owner, kind: 'impact' });
        break;
      }
    }
  }

  /** jaws: 0 open, 1 shut (with a little rattle after) */
  private poseTrap(mesh: THREE.Object3D, k: number, t: number) {
    const jaws = mesh.children.filter((c) => (c as THREE.Mesh).geometry?.type === 'TorusGeometry');
    const shake = t > 0 && t < 0.4 ? Math.sin(t * 60) * 0.08 * (1 - t / 0.4) : 0;
    if (jaws[0]) jaws[0].rotation.x = -Math.PI / 2 + 0.5 - k * 0.5 + shake;
    if (jaws[1]) jaws[1].rotation.x = -Math.PI / 2 - 0.5 + k * 0.5 - shake;
  }

  /* ------------------------------------------------------------------ Tanglet webs */

  private webMesh() {
    this.webTex ??= webTexture();
    const m = new THREE.Mesh(this.webGeo, new THREE.MeshBasicMaterial({ map: this.webTex, transparent: true, opacity: 0.85, depthWrite: false, color: 0xf4fffb }));
    m.renderOrder = 2;
    return m;
  }

  addWeb(p: THREE.Vector3, owner: Actor, life: number) {
    const mesh = this.webMesh();
    mesh.position.copy(p).setY(p.y - 0.1);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.webs.push({ pos: mesh.position.clone(), owner, team: owner.team, t: 0, life, mesh, nid: nextNid++ });
  }

  private updateWebs(dt: number, ctx: GameCtx) {
    for (let i = this.webs.length - 1; i >= 0; i--) {
      const w = this.webs[i];
      w.t += dt;
      const s = Math.max(0.01, Math.min(1, w.t / 0.35) * Math.min(1, (w.life - w.t) / 0.6));
      w.mesh.scale.setScalar(s);
      w.mesh.rotation.y += dt * 0.2;
      for (const a of ctx.actors) {
        if (!a.alive || a.parked || a.team === w.team) continue;
        const dx = a.motor.pos.x - w.pos.x, dz = a.motor.pos.z - w.pos.z, dy = a.motor.pos.y - w.pos.y;
        if (dx * dx + dz * dz > WEB_R * WEB_R * s * s || dy < -0.8 || dy > 1.4) continue;
        if (a.slowT <= 0.05) a.me?.hud.toast('TANGLED! Get out of the web', '#8fe3d0');
        a.slow(0.5, 0.3);
      }
      if (w.t > w.life) {
        this.scene.remove(w.mesh);
        this.webs.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ LAN mirroring */

  /** host: everything a client needs to draw */
  netState(): NetProp[] {
    const r = (n: number) => Math.round(n * 100) / 100;
    const out: NetProp[] = [];
    for (const t of this.thrown) out.push([t.nid, PK.util, r(t.pos.x), r(t.pos.y), r(t.pos.z), UTIL_LIST.indexOf(t.def.id), r(t.mesh.rotation.x)]);
    for (const p of this.pads) out.push([p.nid, PK.pad, r(p.pos.x), r(p.pos.y), r(p.pos.z), r(p.mesh.scale.x), r(p.mesh.scale.y)]);
    for (const c of this.chickens) out.push([c.nid, PK.chicken, r(c.pos.x), r(c.pos.y), r(c.pos.z), r(c.yaw), 0]);
    for (const b of this.bolts) {
      const st = b.def.projectile?.style ?? 'bolt';
      const d = b.vel;
      out.push([b.nid, st === 'pumpkin' ? PK.pumpkin : st === 'gloop' ? PK.gloop : PK.bolt, r(b.pos.x), r(b.pos.y), r(b.pos.z), r(Math.atan2(-d.x, -d.z)), r(Math.atan2(d.y, Math.hypot(d.x, d.z)))]);
    }
    for (const j of this.jammers) out.push([j.nid, PK.jammer, r(j.pos.x), r(j.pos.y), r(j.pos.z), r(j.dome.scale.x), r((j.dome.material as THREE.MeshBasicMaterial).opacity)]);
    for (const t of this.traps) out.push([t.nid, PK.trap, r(t.pos.x), r(t.pos.y), r(t.pos.z), t.snapT >= 0 ? r(t.snapT) : -1, 0]);
    for (const w of this.webs) out.push([w.nid, PK.web, r(w.pos.x), r(w.pos.y), r(w.pos.z), r(w.mesh.scale.x), r(w.mesh.rotation.y)]);
    return out;
  }

  private netObjs = new Map<number, { kind: number; obj: THREE.Object3D; seen: boolean }>();

  /** client: show the host's objects, interpolated between two snapshots */
  netApply(A: NetProp[] | undefined, B: NetProp[] | undefined, k: number, dt: number) {
    const cur = new Map<number, NetProp>();
    for (const p of A ?? []) cur.set(p[0], p);
    const next = new Map<number, NetProp>();
    for (const p of B ?? []) next.set(p[0], p);
    for (const o of this.netObjs.values()) o.seen = false;
    for (const [id, a] of cur) {
      const b = next.get(id) ?? a;
      let o = this.netObjs.get(id);
      if (!o) {
        o = { kind: a[1], obj: this.netBuild(a), seen: true };
        this.scene.add(o.obj);
        this.netObjs.set(id, o);
      }
      o.seen = true;
      const obj = o.obj;
      obj.position.set(a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k);
      switch (a[1]) {
        case PK.util:
          obj.rotation.x = a[6];
          obj.rotation.z = a[6] * 0.7;
          break;
        case PK.pad:
          obj.scale.set(a[5], a[6], a[5]);
          break;
        case PK.chicken:
          obj.rotation.set(0, a[5], Math.sin(performance.now() * 0.018) * 0.15);
          obj.position.y += Math.abs(Math.sin(performance.now() * 0.018)) * 0.06;
          break;
        case PK.bolt:
        case PK.gloop:
          obj.rotation.set(a[6], a[5], 0, 'YXZ');
          break;
        case PK.pumpkin:
          obj.rotation.x -= dt * 9;
          break;
        case PK.jammer: {
          const dome = obj.userData.dome as THREE.Mesh;
          dome.scale.setScalar(Math.max(0.01, a[5]));
          dome.rotation.y += dt * 0.3;
          setDome(dome, a[6]);
          break;
        }
        case PK.trap:
          this.poseTrap(obj, a[5] < 0 ? 0 : Math.min(1, a[5] / 0.08), Math.max(0, a[5]));
          break;
        case PK.web:
          obj.scale.setScalar(a[5]);
          obj.rotation.y = a[6];
          break;
      }
    }
    for (const [id, o] of this.netObjs) {
      if (o.seen) continue;
      this.scene.remove(o.obj);
      this.netObjs.delete(id);
    }
  }

  private netBuild(p: NetProp): THREE.Object3D {
    switch (p[1]) {
      case PK.util:
        return buildItemModel(UTIL_LIST[p[5]] ?? 'fizzbomb');
      case PK.pad: {
        const m = new THREE.Mesh(this.padGeo, this.padMat);
        m.castShadow = true;
        return m;
      }
      case PK.chicken: {
        const m = buildItemModel('chicken');
        m.scale.setScalar(1.6);
        return m;
      }
      case PK.pumpkin:
        return this.boltMesh('pumpkin');
      case PK.gloop:
        return this.boltMesh('gloop');
      case PK.jammer: {
        const { mesh, dome } = this.buildJammer();
        mesh.userData.dome = dome;
        return mesh;
      }
      case PK.trap: {
        const m = buildItemModel('snaptrap', false);
        m.scale.setScalar(2.2);
        return m;
      }
      case PK.web:
        return this.webMesh();
      default:
        return this.boltMesh('bolt');
    }
  }
}

export { UP };
