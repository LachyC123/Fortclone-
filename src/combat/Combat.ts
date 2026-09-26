import * as THREE from 'three';
import { ColFlags, RayHit, raySphere, rayCapsule } from '../physics/Collision';
import type { Actor } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { DEG, clamp, inverseLerp, lerp } from '../core/math';
import { RARITY_SPREAD } from './Weapons';
import { audio } from '../audio/Audio';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hit: RayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const _hit2: RayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const _head = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export interface ActorHit {
  actor: Actor;
  t: number;
  headshot: boolean;
}

/** Ray against every living actor's hitboxes (head sphere + body capsule). */
export function raycastActors(ctx: GameCtx, o: THREE.Vector3, d: THREE.Vector3, maxT: number, ignore: Actor | null): ActorHit | null {
  let best: ActorHit | null = null;
  for (const a of ctx.actors) {
    if (a === ignore) continue;
    if (!a.alive) {
      // a fleeing Blinkbug (bug-revive) can be swatted
      if (a.bugout) {
        const tb = raySphere(o, d, a.bug.pos, 0.38);
        if (tb >= 0 && tb < maxT && (!best || tb < best.t)) best = { actor: a, t: tb, headshot: false };
      }
      continue;
    }
    // cheap reject: distance from ray to actor centre
    _to.subVectors(a.motor.pos, o);
    const along = _to.dot(d);
    if (along < -1 || along > maxT + 1) continue;
    const perp2 = _to.lengthSq() - along * along;
    if (perp2 > 4) continue;
    a.headCenter(_head);
    const th = raySphere(o, d, _head, a.headRadius);
    a.bodySegment(_a, _b);
    const tb = rayCapsule(o, d, _a, _b, a.bodyRadius);
    let t = -1, head = false;
    if (th >= 0 && (tb < 0 || th <= tb + 0.05)) {
      t = th;
      head = true;
    } else if (tb >= 0) t = tb;
    if (t >= 0 && t < maxT && (!best || t < best.t)) best = { actor: a, t, headshot: head };
  }
  return best;
}

/**
 * Fire one trigger pull (may be multiple pellets). Uses the shooter's aim ray (camera for the
 * player) to find what's under the crosshair, then re-traces from the muzzle so you can't shoot
 * through a wall your camera happens to peek past.
 */
export function fireWeapon(shooter: Actor, ctx: GameCtx) {
  const w = shooter.weapon!;
  const def = w.def;
  const moving = shooter.motor.horizontalSpeed() > 1 || !shooter.motor.grounded;
  const base = shooter.ads ? def.spreadAds : def.spreadHip;
  const spreadDeg = base + (moving ? def.spreadMove * (shooter.ads ? 0.4 : 1) : 0) + w.bloom + (shooter.motor.crouching ? -0.3 : 0);
  const spread = Math.max(0, spreadDeg) * DEG * RARITY_SPREAD[w.rarity];
  shooter.muzzleWorld(_muzzle);

  const aimO = shooter.intent.aimOrigin;
  const aimD = shooter.intent.aimDir;
  _right.crossVectors(aimD, _up.set(0, 1, 0)).normalize();
  _up.crossVectors(_right, aimD).normalize();

  // ---- projectile weapons (Sparkbow): aim through the crosshair, then launch a real bolt
  if (def.projectile) {
    _dir.copy(aimD);
    if (spread > 0) {
      const r = Math.sqrt(Math.random()) * Math.tan(spread);
      const a = Math.random() * Math.PI * 2;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    const wh = ctx.cw.raycast(aimO, _dir, def.range, ColFlags.BlocksBullets, _hit);
    const target = _to.copy(aimO).addScaledVector(_dir, wh ? wh.t : def.range);
    const bd = _b.subVectors(target, _muzzle).normalize();
    // compensate a touch for gravity so the crosshair is honest at mid range
    bd.y += Math.min(0.08, (def.projectile.gravity * (wh ? wh.t : 60)) / (2 * def.projectile.speed * def.projectile.speed));
    bd.normalize();
    ctx.throwables.fireBolt(shooter, def, w.damage, _muzzle.clone(), bd);
    w.bloom = clamp(w.bloom + def.bloomPerShot, 0, def.bloomMax);
    shooter.onFired(def.recoilPitch, def.recoilYaw * (Math.random() - 0.5) * 2, def.camKick);
    ctx.fx.muzzle(_muzzle, aimD, def.tracer, false);
    audio.gunshot(shooter.isLocal ? undefined : _muzzle, def.sound, shooter.isLocal);
    ctx.emitSound({ pos: _muzzle.clone(), loudness: 35, source: shooter, kind: 'gunshot' });
    return;
  }

  let anyHit = false, anyHead = false, anyKill = false, totalDmg = 0;
  let lastVictim: Actor | null = null;

  for (let p = 0; p < def.pellets; p++) {
    // uniform disc sample, biased to centre (feels fair)
    const r = Math.sqrt(Math.random()) * Math.tan(spread) * (def.pellets > 1 ? 1 : 0.85);
    const a = Math.random() * Math.PI * 2;
    _dir.copy(aimD).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

    // 1) what's under the crosshair?
    const wh = ctx.cw.raycast(aimO, _dir, def.range, ColFlags.BlocksBullets, _hit);
    const worldT = wh ? wh.t : def.range;
    let ah = raycastActors(ctx, aimO, _dir, worldT, shooter);
    const chT = ctx.throwables.shootChickens(aimO, _dir, ah ? ah.t : worldT, ctx);
    if (chT >= 0) ah = null;
    const endT = ah ? ah.t : chT >= 0 ? chT : worldT;
    const target = _to.copy(aimO).addScaledVector(_dir, endT);

    // 2) re-trace from the muzzle toward that point
    const md = _b.subVectors(target, _muzzle);
    const mlen = md.length();
    md.divideScalar(Math.max(1e-4, mlen));
    const block = ctx.cw.raycast(_muzzle, md, Math.max(0, mlen - 0.1), ColFlags.BlocksBullets, _hit2);
    let hitPoint: THREE.Vector3;
    if (block) {
      hitPoint = block.point;
      ctx.fx.impact(block.point, block.normal, block.collider!.surface);
      audio.impact(block.point, block.collider!.surface);
      ctx.world.onBulletHit(block.collider!, block.point, md);
      ctx.emitSound({ pos: block.point.clone(), loudness: 12, source: shooter, kind: 'impact' });
    } else if (ah) {
      hitPoint = target;
      const dist = mlen;
      const fall = lerp(1, def.minDamageMul, inverseLerp(def.falloffStart, def.falloffEnd, dist));
      let dmg = w.damage * fall * (ah.headshot ? def.headMult : 1);
      dmg = Math.round(dmg);
      const killed = ah.actor.takeDamage(dmg, shooter, ah.headshot, md, ctx, def.short);
      if (def.knockback) {
        const kb = (def.knockback / def.pellets) * fall;
        ah.actor.motor.impulse(_a.copy(md).setY(0).normalize().multiplyScalar(kb).setY(kb * 0.35));
      }
      ctx.fx.hitSplat(target, ah.headshot);
      anyHit = true;
      anyHead = anyHead || ah.headshot;
      anyKill = anyKill || killed;
      totalDmg += dmg;
      lastVictim = ah.actor;
    } else if (wh) {
      hitPoint = wh.point;
      ctx.fx.impact(wh.point, wh.normal, wh.collider!.surface);
      audio.impact(wh.point, wh.collider!.surface);
      ctx.world.onBulletHit(wh.collider!, wh.point, _dir);
      ctx.emitSound({ pos: wh.point.clone(), loudness: 12, source: shooter, kind: 'impact' });
    } else {
      hitPoint = target;
    }
    ctx.fx.tracer(_muzzle, hitPoint, def.tracer, shooter.isLocal ? 0.035 : 0.05);
  }

  if (anyHit && lastVictim) {
    if (shooter.isLocal) {
      ctx.hud.hitmarker(anyHead, anyKill);
      ctx.hud.damageNumber(lastVictim.headCenter(new THREE.Vector3()).setY(lastVictim.motor.pos.y + 1.9), totalDmg, anyHead);
      audio.hitmarker(anyHead, anyKill);
    }
  }

  // bloom & recoil
  w.bloom = clamp(w.bloom + def.bloomPerShot, 0, def.bloomMax);
  shooter.onFired(def.recoilPitch * (shooter.ads ? 0.6 : 1), def.recoilYaw * (Math.random() - 0.5) * 2, def.camKick);
  ctx.fx.muzzle(_muzzle, aimD, def.tracer, def.pellets > 1 || !!def.knockback);
  // big guns shove you back a little too
  if (def.knockback && def.knockback > 5 && !shooter.motor.grounded) shooter.motor.impulse(_a.copy(aimD).multiplyScalar(-def.knockback * 0.4));
  audio.gunshot(shooter.isLocal ? undefined : _muzzle, def.sound, shooter.isLocal);
  ctx.emitSound({ pos: _muzzle.clone(), loudness: 70, source: shooter, kind: 'gunshot' });
}
