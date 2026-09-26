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
    this.thrown.push({ def, owner, pos: from.clone(), vel: vel.clone(), mesh, t: 0, settled: false, settleT: 0, stuck: false, stuckTo: null, stuckOffset: new THREE.Vector3(), beepT: 0, acc: 0, spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)) });
    audio.throwWhoosh(from);
  }

  fireBolt(owner: Actor, def: WeaponDef, damage: number, from: THREE.Vector3, dir: THREE.Vector3) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6), new THREE.MeshStandardMaterial({ color: PAL.woodLight }));
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), new THREE.MeshBasicMaterial({ color: PAL.blink }));
    tip.position.z = -0.32;
    tip.scale.set(0.8, 0.8, 1.8);
    g.add(shaft, tip);
    g.position.copy(from);
    this.scene.add(g);
    this.bolts.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(def.projectile!.speed), owner, def, damage, mesh: g, t: 0, stuck: false });
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

  /** Bullet vs chickens (they can be shot). Returns t or -1 and pops the chicken. */
  shootChickens(o: THREE.Vector3, d: THREE.Vector3, maxT: number, ctx: GameCtx): number {
    let best = -1, bc: Chicken | null = null;
    for (const c of this.chickens) {
      const t = raySphere(o, d, _v.copy(c.pos).setY(c.pos.y + 0.15), 0.25);
      if (t >= 0 && t < maxT && (best < 0 || t < best)) {
        best = t;
        bc = c;
      }
    }
    if (bc) this.popChicken(bc, ctx);
    return best;
  }

  update(dt: number, ctx: GameCtx) {
    this.updateThrown(dt, ctx);
    this.updateSmokes(dt, ctx);
    this.updatePads(dt, ctx);
    this.updateChickens(dt, ctx);
    this.updateBolts(dt, ctx);
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
                if (ah.actor.isLocal) ctx.hud.toast('STUCK! RUN!', '#ff5c8a');
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
        this.pads.push({ pos: mesh.position.clone(), mesh, t: 0, life: 14, wobble: 0, wobbleV: 8, cooldown: new Map() });
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
        this.chickens.push({ pos: p.clone(), vel: new THREE.Vector3(), yaw: Math.atan2(-(th.owner.intent.aimDir.x), -(th.owner.intent.aimDir.z)), mesh, legs, t: 0, life: 8, cluckT: 0, hp: 1, owner: th.owner });
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
      if (a.isLocal) ctx.shake(0.35);
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
      if (owner?.isLocal && a !== owner) {
        ctx.hud.hitmarker(false, killed);
        ctx.hud.damageNumber(c.clone().setY(c.y + 1), dmg, false);
      }
    }
    for (const ch of [...this.chickens]) if (ch.pos.distanceTo(p) < R) this.popChicken(ch, ctx);
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
        if (b.t > 5) {
          this.scene.remove(b.mesh);
          this.bolts.splice(i, 1);
        }
        continue;
      }
      const prev = _v2.copy(b.pos);
      b.vel.y -= b.def.projectile!.gravity * dt;
      const step = b.vel.length() * dt;
      const dir = _n.copy(b.vel).normalize();
      const wh = ctx.cw.raycast(prev, dir, step, ColFlags.BlocksBullets, _hit);
      const maxT = wh ? wh.t : step;
      const ah = raycastActors(ctx, prev, dir, maxT, b.t < 0.1 ? b.owner : null);
      const ct = ctx.throwables.shootChickens(prev, dir, ah ? ah.t : maxT, ctx);
      if (ah && (ct < 0 || ah.t <= ct)) {
        const p = prev.clone().addScaledVector(dir, ah.t);
        const dmg = Math.round(b.damage * (ah.headshot ? b.def.headMult : 1));
        const killed = ah.actor.takeDamage(dmg, b.owner, ah.headshot, dir, ctx, b.def.short);
        ctx.fx.hitSplat(p, ah.headshot);
        ctx.fx.sparkBurst(p, PAL.blink, 14);
        if (b.owner.isLocal) {
          ctx.hud.hitmarker(ah.headshot, killed);
          ctx.hud.damageNumber(p.clone().setY(p.y + 0.8), dmg, ah.headshot);
          audio.hitmarker(ah.headshot, killed);
        }
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
        continue;
      }
      if (ct >= 0) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
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
      b.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, -1), dir);
      ctx.fx.glow.emit(b.pos, { count: 1, color: [PAL.blink, 0xffffff], speed: 0.2, life: 0.3, size: 0.12, sizeEnd: 0.2 });
      if (b.t > 4) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
  }
}

export { UP };
