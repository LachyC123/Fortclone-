import * as THREE from 'three';
import type { Actor, Controller } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { angleDelta, clamp, DEG, dirFromYawPitch, rand, wrapAngle, yawFromDir } from '../core/math';
import { ColFlags } from '../physics/Collision';
import { BUG, simulateBug, Blinkbug } from '../entities/Blinkbug';
import type { Pickup } from '../loot/Loot';
import type { AmmoType } from '../combat/Weapons';

export type Archetype = 'aggressive' | 'cautious' | 'goblin' | 'rooftop' | 'chaotic' | 'sniper';

export interface BotProfile {
  archetype: Archetype;
  reaction: [number, number];
  aimError: number; // degrees, initial error on acquire
  residual: number; // degrees, steady-state jitter
  tracking: number; // error decay rate (1/s)
  turnSpeed: number; // rad/s
  preferredRange: number;
  aggression: number; // 0..1
  blinkiness: number; // 0..1 chance to use Blinkbug tactically
  retreatHp: number;
  burst: [number, number];
  pause: [number, number];
}

export const PROFILES: Record<Archetype, BotProfile> = {
  aggressive: { archetype: 'aggressive', reaction: [0.28, 0.45], aimError: 7, residual: 1.6, tracking: 2.4, turnSpeed: 6, preferredRange: 7, aggression: 0.9, blinkiness: 0.8, retreatHp: 20, burst: [0.5, 1.1], pause: [0.15, 0.35] },
  cautious: { archetype: 'cautious', reaction: [0.35, 0.6], aimError: 6, residual: 1.3, tracking: 2.2, turnSpeed: 5, preferredRange: 16, aggression: 0.35, blinkiness: 0.6, retreatHp: 55, burst: [0.35, 0.7], pause: [0.3, 0.6] },
  goblin: { archetype: 'goblin', reaction: [0.4, 0.7], aimError: 9, residual: 2.0, tracking: 1.8, turnSpeed: 5, preferredRange: 12, aggression: 0.5, blinkiness: 0.4, retreatHp: 40, burst: [0.4, 0.9], pause: [0.25, 0.5] },
  rooftop: { archetype: 'rooftop', reaction: [0.3, 0.5], aimError: 6, residual: 1.4, tracking: 2.4, turnSpeed: 5.5, preferredRange: 18, aggression: 0.5, blinkiness: 0.9, retreatHp: 35, burst: [0.4, 0.8], pause: [0.2, 0.45] },
  chaotic: { archetype: 'chaotic', reaction: [0.25, 0.6], aimError: 10, residual: 2.4, tracking: 1.6, turnSpeed: 7, preferredRange: 9, aggression: 0.8, blinkiness: 1.0, retreatHp: 15, burst: [0.6, 1.4], pause: [0.1, 0.3] },
  sniper: { archetype: 'sniper', reaction: [0.35, 0.55], aimError: 5, residual: 0.9, tracking: 2.8, turnSpeed: 4.5, preferredRange: 28, aggression: 0.3, blinkiness: 0.5, retreatHp: 45, burst: [0.25, 0.5], pause: [0.4, 0.8] },
};

type BotState = 'wander' | 'loot' | 'investigate' | 'engage' | 'chase' | 'retreat';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * Bot brain: perception (vision cone + line of sight + hearing + memory), a small state machine
 * with personality-driven parameters, path following over the nav grid, and a humanised aim
 * model (reaction time, initial error that settles while tracking, bursts, misses).
 * Thinking runs at 4–8Hz (slower when far from the player); steering runs every frame.
 */
export class BotController implements Controller {
  state: BotState = 'wander';
  target: Actor | null = null;
  private awareness = new Map<number, number>();
  private lastSeenPos = new THREE.Vector3();
  private lastSeenT = -99;
  private targetVisible = false;
  private heardPos = new THREE.Vector3();
  private heardT = -99;
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private goal = new THREE.Vector3();
  private hasGoal = false;
  private thinkT = Math.random() * 0.2;
  private aimYaw = 0;
  private aimPitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private reactT = 0;
  private burstT = 0;
  private pauseT = 0;
  private strafe = 1;
  private strafeT = 0;
  private stuckT = 0;
  private lastProgressPos = new THREE.Vector3();
  private idleT = 0;
  private lookAroundT = 0;
  private lookYaw = 0;
  private crouchWant = false;
  private blinkPlanT = -1;
  private lootTarget: Pickup | null = null;
  private goalTimeout = 0;
  private jumpCd = 0;
  private headshotBias: number;

  constructor(public profile: BotProfile, private rng: () => number = Math.random) {
    this.headshotBias = profile.residual < 1.5 ? 0.35 : 0.15;
  }

  /** Called by Actor when damaged */
  onDamaged(me: Actor, from: Actor | null, ctx: GameCtx) {
    if (!from || from === me) return;
    this.awareness.set(from.id, 1.2);
    if (!this.target || this.target === from || !this.targetVisible) {
      this.target = from;
      this.lastSeenPos.copy(from.motor.pos);
      this.lastSeenT = ctx.time;
      if (this.state !== 'engage') this.reactT = rand(0.15, 0.3);
    }
    // panic-blink when hurt badly
    if (me.hp < this.profile.retreatHp && me.bug.canBlink && this.rng() < 0.7) me.intent.blink = true;
    else if (me.hp < this.profile.retreatHp + 15 && me.bug.ready && this.rng() < this.profile.blinkiness * 0.5) this.planEscapeBlink(me, ctx);
  }

  update(me: Actor, ctx: GameCtx, dt: number) {
    const it = me.intent;
    it.jump = false;
    it.crouch = false;
    it.reload = false;
    it.throwRelease = false;
    it.throwAim = false;
    it.interact = false;
    it.slot = -1;
    const wasBlink = it.blink;
    it.blink = false;
    if (wasBlink && me.bug.canBlink) it.blink = true;

    this.jumpCd -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const local = ctx.localActor;
      const far = local ? local.motor.pos.distanceTo(me.motor.pos) > 35 : false;
      this.thinkT = far ? rand(0.25, 0.35) : rand(0.1, 0.16);
      this.think(me, ctx, far ? 0.3 : 0.13);
    }

    // scheduled blink
    if (this.blinkPlanT >= 0) {
      this.blinkPlanT -= dt;
      if (this.blinkPlanT < 0 && me.bug.canBlink) it.blink = true;
    }

    this.steer(me, ctx, dt);
    this.aim(me, ctx, dt);
  }

  /* ------------------------------------------------------------------ perception + decisions */

  private think(me: Actor, ctx: GameCtx, tick: number) {
    const eye = me.eyePos(_eye);
    const facing = me.intent.aimYaw;
    this.targetVisible = false;
    let bestNew: Actor | null = null;
    let bestD = Infinity;
    for (const o of ctx.actors) {
      if (o === me || !o.alive) continue;
      const tp = _v.copy(o.motor.pos).setY(o.motor.pos.y + o.motor.height * 0.7);
      const d = tp.distanceTo(eye);
      if (d > 70) continue;
      const yawTo = yawFromDir(tp.x - eye.x, tp.z - eye.z);
      const inCone = Math.abs(angleDelta(facing, yawTo)) < 80 * DEG || d < 5;
      let aw = this.awareness.get(o.id) ?? 0;
      if (inCone && ctx.cw.lineClear(eye, tp, ColFlags.BlocksSight)) {
        // awareness builds faster when close, moving, or shooting; crouching hides you a bit
        const moving = o.motor.horizontalSpeed() > 3 ? 1.4 : 1;
        const crouch = o.motor.crouching ? 0.6 : 1;
        const rate = (d < 10 ? 6 : d < 25 ? 3.2 : 1.6) * moving * crouch;
        aw = Math.min(1.5, aw + rate * tick);
        if (aw >= 1) {
          if (o === this.target) {
            this.targetVisible = true;
            this.lastSeenPos.copy(o.motor.pos);
            this.lastSeenT = ctx.time;
          } else if (d < bestD) {
            bestNew = o;
            bestD = d;
          }
        }
      } else aw = Math.max(0, aw - tick * 0.5);
      this.awareness.set(o.id, aw);
    }
    // switch target if current one is lost and someone else is visible (or much closer)
    if (bestNew && (!this.target || !this.target.alive || (!this.targetVisible && ctx.time - this.lastSeenT > 1.5) || bestD < 6)) {
      if (this.target !== bestNew) {
        this.target = bestNew;
        this.reactT = rand(this.profile.reaction[0], this.profile.reaction[1]);
        this.errYaw = (this.rng() - 0.5) * 2 * this.profile.aimError * DEG;
        this.errPitch = (this.rng() - 0.5) * this.profile.aimError * DEG;
      }
      this.targetVisible = true;
      this.lastSeenPos.copy(bestNew.motor.pos);
      this.lastSeenT = ctx.time;
    }
    if (this.target && !this.target.alive) {
      this.target = null;
      this.targetVisible = false;
      this.idleT = rand(0.6, 1.4); // little victory pause
    }

    // hearing
    for (const s of ctx.sounds) {
      if (s.source === me || ctx.time - s.time > 0.6) continue;
      const d = s.pos.distanceTo(me.motor.pos);
      if (d > s.loudness) continue;
      if (s.kind === 'gunshot' || s.kind === 'blink' || (s.kind === 'footstep' && d < s.loudness * 0.7) || s.kind === 'impact') {
        // imprecise estimate, better when closer
        const err = d * 0.15;
        this.heardPos.set(s.pos.x + rand(-err, err), s.pos.y, s.pos.z + rand(-err, err));
        this.heardT = ctx.time;
        if (s.kind === 'impact' && s.source && s.source !== me && s.pos.distanceTo(me.motor.pos) < 4) {
          // someone is shooting at me
          this.awareness.set(s.source.id, Math.max(this.awareness.get(s.source.id) ?? 0, 0.8));
          if (!this.targetVisible) this.lookYaw = yawFromDir(s.source.motor.pos.x - me.motor.pos.x, s.source.motor.pos.z - me.motor.pos.z);
        }
      }
    }

    // ---- choose state
    const w = me.weapon;
    const ammoType = w?.def.ammo as AmmoType | undefined;
    const lowAmmo = w ? w.mag + me.ammo[ammoType!] < w.def.mag * 0.5 : true;
    const hasTarget = !!this.target && ctx.time - this.lastSeenT < 8;
    let next: BotState = this.state;
    if (!me.armed) next = 'loot';
    else if (hasTarget && this.targetVisible) next = me.hp < this.profile.retreatHp && this.rng() < 0.6 ? 'retreat' : 'engage';
    else if (hasTarget) next = me.hp < this.profile.retreatHp ? 'retreat' : 'chase';
    else if (lowAmmo || (this.profile.archetype === 'goblin' && this.rng() < 0.3)) next = 'loot';
    else if (ctx.time - this.heardT < 6) next = 'investigate';
    else if (this.state !== 'wander' && this.state !== 'loot') next = 'wander';
    if (next !== this.state) {
      this.state = next;
      this.hasGoal = false;
      this.path = [];
    }

    switch (this.state) {
      case 'loot': {
        if (!this.lootTarget || !ctx.loot.pickups.includes(this.lootTarget) || this.lootTarget.collectT >= 0) this.lootTarget = this.pickLoot(me, ctx);
        if (this.lootTarget) {
          this.setGoal(me, ctx, this.lootTarget.pos);
          const d = this.lootTarget.pos.distanceTo(me.motor.pos);
          if (d < 1.6) {
            const p = this.lootTarget;
            if (p.kind === 'weapon') {
              // only swap if it's better (goblins can't resist though)
              const cur = me.weapon;
              if (!cur || p.rarity > cur.rarity || this.profile.archetype === 'goblin' || me.weapons.some((x) => !x)) ctx.loot.collect(me, p, ctx);
            } else {
              me.ammo[p.defId as AmmoType] += p.amount;
              p.collectT = 0;
              p.collector = me;
            }
            this.lootTarget = null;
            this.hasGoal = false;
            this.idleT = rand(0.2, 0.6);
          }
        } else if (!this.hasGoal) this.wanderGoal(me, ctx);
        break;
      }
      case 'engage':
        this.engageThink(me, ctx);
        break;
      case 'chase':
        this.setGoal(me, ctx, this.lastSeenPos);
        if (me.motor.pos.distanceTo(this.lastSeenPos) < 2) {
          this.lookAroundT = 1.5;
          this.lastSeenT = -99;
        }
        break;
      case 'retreat': {
        // run away from the threat, preferably blink out
        if (this.target) {
          _v.subVectors(me.motor.pos, this.target.motor.pos).setY(0).normalize();
          _v2.copy(me.motor.pos).addScaledVector(_v, 14);
          if (!this.hasGoal || this.goalTimeout <= 0) this.setGoal(me, ctx, _v2, true);
          if (me.bug.ready && this.rng() < this.profile.blinkiness * 0.4) this.planEscapeBlink(me, ctx);
        }
        // heal isn't in M1 — cautious bots regen a little while hiding (placeholder for Jam Jars)
        if (!this.targetVisible) me.heal(tick * 4);
        break;
      }
      case 'investigate':
        this.setGoal(me, ctx, this.heardPos);
        if (me.motor.pos.distanceTo(this.heardPos) < 2.5) {
          this.heardT = -99;
          this.lookAroundT = 2;
        }
        break;
      case 'wander':
        if (!this.hasGoal || me.motor.pos.distanceTo(this.goal) < 1.5 || this.goalTimeout <= 0) {
          if (this.rng() < 0.3) this.idleT = rand(0.5, 2); // hesitate / look around
          this.wanderGoal(me, ctx);
        }
        break;
    }
    this.goalTimeout -= tick;
  }

  private engageThink(me: Actor, ctx: GameCtx) {
    const t = this.target!;
    const d = t.motor.pos.distanceTo(me.motor.pos);
    const pr = this.profile.preferredRange;
    // strafe decisions
    this.strafeT -= 0.13;
    if (this.strafeT <= 0) {
      this.strafeT = rand(0.5, 1.4);
      this.strafe = this.rng() < 0.5 ? -1 : 1;
      this.crouchWant = this.profile.archetype !== 'aggressive' && this.rng() < 0.2;
      if (this.rng() < 0.12 * this.profile.aggression && this.jumpCd <= 0) {
        me.intent.jump = true;
        this.jumpCd = 1.5;
      }
    }
    // range keeping: approach or back off
    if (d > pr * 1.4) this.setGoal(me, ctx, t.motor.pos);
    else if (d < pr * 0.5 && this.profile.archetype !== 'aggressive') {
      _v.subVectors(me.motor.pos, t.motor.pos).setY(0).normalize();
      this.setGoal(me, ctx, _v2.copy(me.motor.pos).addScaledVector(_v, 5), true);
    } else {
      this.hasGoal = false;
      this.path = [];
    }
    // reload when empty (backpedal behaviour happens naturally from range keeping)
    const w = me.weapon;
    if (w && w.mag === 0 && !w.reloading) me.intent.reload = true;
    // Blinkbug flank: throw to the target's side, blink shortly after
    if (me.bug.ready && this.blinkPlanT < 0 && d < 26 && d > 5 && this.rng() < this.profile.blinkiness * 0.08) {
      const side = this.rng() < 0.5 ? -1 : 1;
      _v.subVectors(t.motor.pos, me.motor.pos).setY(0).normalize();
      const perp = _v2.set(-_v.z * side, 0, _v.x * side);
      const aimPt = _v3.copy(t.motor.pos).addScaledVector(perp, rand(4, 7)).addScaledVector(_v, rand(-2, 3));
      if (this.throwAt(me, ctx, aimPt)) this.blinkPlanT = rand(0.5, 1.2);
    }
  }

  private planEscapeBlink(me: Actor, ctx: GameCtx) {
    if (!me.bug.ready || this.blinkPlanT >= 0) return;
    const threat = this.target ? this.target.motor.pos : this.lastSeenPos;
    _v.subVectors(me.motor.pos, threat).setY(0).normalize();
    const ang = rand(-0.7, 0.7);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dir = _v2.set(_v.x * c - _v.z * s, 0, _v.x * s + _v.z * c);
    const aimPt = _v3.copy(me.motor.pos).addScaledVector(dir, rand(12, 20));
    if (this.throwAt(me, ctx, aimPt)) this.blinkPlanT = rand(0.35, 0.8);
  }

  /** Solve a throw pitch toward a world point by simulating the bug (coarse search). */
  private throwAt(me: Actor, ctx: GameCtx, pt: THREE.Vector3): boolean {
    const yaw = yawFromDir(pt.x - me.motor.pos.x, pt.z - me.motor.pos.z);
    const start = new THREE.Vector3(me.motor.pos.x, me.motor.pos.y + 1.1, me.motor.pos.z);
    let bestPitch = 0, bestErr = Infinity;
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let p = -0.3; p <= 0.9; p += 0.15) {
      pos.copy(start);
      Blinkbug.throwVelocity(dirFromYawPitch(yaw, p, dir), vel);
      for (let i = 0; i < 240; i++) if (simulateBug(ctx.cw, pos, vel, BUG.step * 2)) break;
      const err = Math.hypot(pos.x - pt.x, pos.z - pt.z) + Math.abs(pos.y - pt.y) * 0.5;
      if (err < bestErr) {
        bestErr = err;
        bestPitch = p;
      }
    }
    if (bestErr > 8) return false;
    dirFromYawPitch(yaw, bestPitch, me.intent.aimDir);
    me.intent.aimYaw = yaw;
    me.intent.throwRelease = true;
    return true;
  }

  private pickLoot(me: Actor, ctx: GameCtx): Pickup | null {
    let best: Pickup | null = null, bestScore = -Infinity;
    const w = me.weapon;
    for (const p of ctx.loot.pickups) {
      if (p.collectT >= 0 || !p.settled) continue;
      if (p.pos.y > 1.2) continue; // bots don't know how to reach upper floors via stairs yet
      const d = p.pos.distanceTo(me.motor.pos);
      if (d > 45) continue;
      let v = 0;
      if (p.kind === 'weapon') v = !w ? 30 : p.rarity > w.rarity ? 10 + p.rarity * 4 : this.profile.archetype === 'goblin' ? 4 : -50;
      else v = w ? 8 : 1;
      const score = v - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore > -20 ? best : null;
  }

  private wanderGoal(me: Actor, ctx: GameCtx) {
    const arch = this.profile.archetype;
    let c = me.motor.pos;
    // bias toward interesting places: the square & buildings
    if (this.rng() < 0.5) c = _v.set(rand(-12, 12), 0, rand(-14, 8));
    const p = ctx.nav.randomWalkable(this.rng, c.x, c.z, arch === 'sniper' ? 30 : 18);
    if (p) this.setGoal(me, ctx, p);
    this.goalTimeout = rand(8, 16);
  }

  private setGoal(me: Actor, ctx: GameCtx, p: THREE.Vector3, force = false) {
    if (!force && this.hasGoal && this.goal.distanceTo(p) < 2 && this.path.length) return;
    this.goal.copy(p);
    this.hasGoal = true;
    this.goalTimeout = Math.max(this.goalTimeout, 6);
    const path = ctx.nav.findPath(me.motor.pos, p);
    this.path = path ?? [p.clone()];
    this.pathIdx = 0;
  }

  /* ------------------------------------------------------------------ steering */

  private steer(me: Actor, ctx: GameCtx, dt: number) {
    const it = me.intent;
    let mx = 0, mz = 0;
    if (this.idleT > 0) {
      this.idleT -= dt;
    } else if (this.path.length && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const dx = wp.x - me.motor.pos.x, dz = wp.z - me.motor.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          this.path = [];
          if (this.state === 'wander') this.idleT = rand(0.2, 1.2);
        }
      } else {
        mx = dx / d;
        mz = dz / d;
      }
    }
    // combat strafing layered on top
    if (this.state === 'engage' && this.target) {
      _v.subVectors(this.target.motor.pos, me.motor.pos).setY(0).normalize();
      const sx = -_v.z * this.strafe, sz = _v.x * this.strafe;
      mx = mx * 0.7 + sx * 0.8;
      mz = mz * 0.7 + sz * 0.8;
      const l = Math.hypot(mx, mz);
      if (l > 1) {
        mx /= l;
        mz /= l;
      }
      // don't strafe off ledges/into walls forever
      _v2.set(me.motor.pos.x + sx * 1.2, 0, me.motor.pos.z + sz * 1.2);
      const [ci, cj] = ctx.nav.toCell(_v2.x, _v2.z);
      if (!ctx.nav.isWalk(ci, cj)) this.strafe *= -1;
    }
    it.moveX = mx;
    it.moveZ = mz;
    it.sprint = (this.state === 'chase' || this.state === 'retreat' || this.state === 'loot' || (this.state === 'investigate' && this.profile.aggression > 0.6)) && Math.hypot(mx, mz) > 0.5;
    const wantCrouch = this.state === 'engage' && this.crouchWant;
    if (wantCrouch !== me.motor.crouching && me.motor.grounded && !me.motor.sliding) it.crouch = true;
    // aggressive bots slide into fights
    if (this.state === 'chase' && me.motor.sprinting && this.profile.aggression > 0.7 && this.rng() < dt * 0.6) it.crouch = true;

    // stuck detection -> jump / repath
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      const moved = me.motor.pos.distanceTo(this.lastProgressPos);
      if (Math.hypot(mx, mz) > 0.3 && moved < 0.35) {
        if (this.jumpCd <= 0) {
          it.jump = true;
          this.jumpCd = 0.8;
        } else if (this.hasGoal) {
          this.setGoal(me, ctx, this.goal, true);
          this.strafe *= -1;
        }
      }
      this.lastProgressPos.copy(me.motor.pos);
      this.stuckT = 0;
    }
  }

  /* ------------------------------------------------------------------ aim */

  private aim(me: Actor, ctx: GameCtx, dt: number) {
    const it = me.intent;
    const eye = me.eyePos(_eye);
    let desiredYaw = this.aimYaw, desiredPitch = 0;
    const engaged = this.state === 'engage' && this.target && this.targetVisible;
    if (engaged) {
      const t = this.target!;
      const head = this.rng() < this.headshotBias;
      const tp = _v.copy(t.motor.pos).setY(t.motor.pos.y + (head ? t.motor.height - 0.22 : t.motor.height * 0.55));
      desiredYaw = yawFromDir(tp.x - eye.x, tp.z - eye.z);
      desiredPitch = Math.atan2(tp.y - eye.y, Math.hypot(tp.x - eye.x, tp.z - eye.z));
      // error settles while tracking; fast lateral movement makes it harder
      const lateral = Math.abs(t.motor.vel.x * Math.cos(desiredYaw) - t.motor.vel.z * Math.sin(desiredYaw));
      const k = Math.exp(-this.profile.tracking * dt);
      const res = this.profile.residual * DEG * (1 + lateral * 0.12);
      this.errYaw = this.errYaw * k + (this.rng() - 0.5) * res * 0.6;
      this.errPitch = this.errPitch * k + (this.rng() - 0.5) * res * 0.4;
      desiredYaw += this.errYaw;
      desiredPitch += this.errPitch;
    } else if (this.lookAroundT > 0) {
      this.lookAroundT -= dt;
      desiredYaw = this.lookYaw + Math.sin(ctx.time * 1.5) * 1.2;
    } else if (Math.hypot(it.moveX, it.moveZ) > 0.2) {
      desiredYaw = yawFromDir(it.moveX, it.moveZ);
      this.lookYaw = desiredYaw;
    } else {
      desiredYaw = this.lookYaw + Math.sin(ctx.time * 0.7 + me.id) * 0.6;
    }
    // turn-rate limited aim
    const maxTurn = this.profile.turnSpeed * dt * (engaged ? 1 : 0.7);
    const dy = clamp(angleDelta(this.aimYaw, desiredYaw), -maxTurn, maxTurn);
    this.aimYaw = wrapAngle(this.aimYaw + dy);
    this.aimPitch += clamp(desiredPitch - this.aimPitch, -maxTurn, maxTurn);

    if (!it.throwRelease) {
      it.aimYaw = this.aimYaw;
      it.aimPitch = this.aimPitch;
      dirFromYawPitch(this.aimYaw, this.aimPitch, it.aimDir);
    }
    it.aimOrigin.copy(eye);

    // trigger discipline: bursts, only once reaction time has passed and roughly on target
    it.fire = false;
    it.ads = false;
    if (engaged && me.weapon && !me.weapon.reloading) {
      this.reactT -= dt;
      const onTarget = Math.abs(angleDelta(this.aimYaw, desiredYaw)) < 6 * DEG;
      const d = this.target!.motor.pos.distanceTo(me.motor.pos);
      it.ads = d > 14 && this.profile.archetype !== 'aggressive';
      if (this.reactT <= 0 && onTarget) {
        if (this.burstT > 0) {
          this.burstT -= dt;
          it.fire = true;
          if (this.burstT <= 0) this.pauseT = rand(this.profile.pause[0], this.profile.pause[1]) * (d > 25 ? 1.8 : 1);
        } else if (this.pauseT > 0) this.pauseT -= dt;
        else this.burstT = rand(this.profile.burst[0], this.profile.burst[1]);
      }
    }
  }
}
