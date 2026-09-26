import * as THREE from 'three';
import type { Actor, Controller } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { angleDelta, clamp, DEG, dirFromYawPitch, noise1, rand, wrapAngle, yawFromDir } from '../core/math';
import { ColFlags } from '../physics/Collision';
import { BUG, simulateBug, Blinkbug } from '../entities/Blinkbug';
import type { Pickup, Crate } from '../loot/Loot';
import { UTILS } from '../combat/Items';
import { WEAPONS } from '../combat/Weapons';
import { simulateThrow, throwVelocity, THROW } from '../combat/Throwables';
import type { AmmoType } from '../combat/Weapons';
import { POIS } from '../world/Heightmap';

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

type BotState = 'wander' | 'loot' | 'investigate' | 'engage' | 'chase' | 'retreat' | 'help';

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
  private crateTarget: Crate | null = null;
  private utilCd = 2;
  private lingerT = 0;
  private goalTimeout = 0;
  private jumpCd = 0;
  private headshotBias: number;
  /** 0 = Rookie .. 1 = Ace. Drives aim, reactions and trigger discipline (archetype drives style). */
  skill = 0.5;
  private lag = 0.2;
  private lead = 0.7;
  private noiseDeg = 2;
  private reactRange: [number, number] = [0.35, 0.6];
  private initErr = 8;
  private trackRate = 2.2;
  private turn = 5.5;
  private hist = new Float32Array(48 * 4);
  private histN = 0;
  private histHead = 0;
  private histFor: Actor | null = null;
  private aimHead = false;
  private phase1 = Math.random() * 10;
  private phase2 = Math.random() * 10;

  constructor(public profile: BotProfile, private rng: () => number = Math.random) {
    this.headshotBias = profile.residual < 1.5 ? 0.35 : 0.15;
    this.setSkill(0.5);
  }

  /** Aim/reaction model from skill; archetype nudges it (snipers steadier, chaotic twitchier). */
  setSkill(s: number) {
    this.skill = clamp(s, 0, 1);
    const a = this.profile.archetype;
    const steady = a === 'sniper' ? 0.8 : a === 'chaotic' ? 1.2 : a === 'aggressive' ? 1.05 : 1;
    this.lag = (0.2 - 0.1 * this.skill) * (a === 'chaotic' ? 1.1 : 1);
    this.lead = 0.5 + 0.4 * this.skill;
    this.noiseDeg = (4.2 - 2.0 * this.skill) * steady;
    const r0 = 0.5 - 0.25 * this.skill;
    this.reactRange = [r0, r0 + 0.3 - 0.1 * this.skill];
    this.initErr = (12 - 6 * this.skill) * steady;
    this.trackRate = 1.2 + 1.8 * this.skill;
    this.headshotBias = 0.06 + 0.22 * this.skill + (a === 'sniper' ? 0.08 : 0);
    this.turn = 3.5 + 3 * this.skill;
  }

  /** where the target was `lag` seconds ago, plus a (skill-limited) lead from its old velocity */
  private perceivedPos(t: Actor, time: number, out: THREE.Vector3) {
    if (this.histFor !== t) {
      this.histFor = t;
      this.histN = 0;
    }
    const H = this.hist, cap = H.length / 4;
    const w = this.histHead * 4;
    H[w] = t.motor.pos.x;
    H[w + 1] = t.motor.pos.y;
    H[w + 2] = t.motor.pos.z;
    H[w + 3] = time;
    this.histHead = (this.histHead + 1) % cap;
    this.histN = Math.min(cap, this.histN + 1);
    const want = time - this.lag;
    // walk back to the newest sample older than `want`
    let idx = -1, prev = -1;
    for (let k = 1; k <= this.histN; k++) {
      const i = (this.histHead - k + cap) % cap;
      if (H[i * 4 + 3] <= want) {
        idx = i;
        break;
      }
      prev = i;
    }
    if (idx < 0) idx = (this.histHead - this.histN + cap) % cap;
    out.set(H[idx * 4], H[idx * 4 + 1], H[idx * 4 + 2]);
    if (prev >= 0) {
      const dtS = Math.max(1e-3, H[prev * 4 + 3] - H[idx * 4 + 3]);
      const vx = (H[prev * 4] - H[idx * 4]) / dtS, vz = (H[prev * 4 + 2] - H[idx * 4 + 2]) / dtS;
      out.x += vx * this.lag * this.lead;
      out.z += vz * this.lag * this.lead;
    }
    return out;
  }

  /** Called by Actor when damaged */
  onDamaged(me: Actor, from: Actor | null, ctx: GameCtx) {
    if (!from || from === me) return;
    if (me.hp < 30 && me.hp > 0) me.say(this.rng() < 0.5 ? 'EEK!' : 'OW!', '#ff8a8a', 1.2);
    this.awareness.set(from.id, 1.5);
    this.ignoreUntil.delete(from.id);
    // threat bookkeeping: who is actually hurting us right now?
    const th = (this.threat.get(from.id) ?? 0) + 1;
    this.threat.set(from.id, th);
    const cur = this.target;
    if (cur && cur !== from && cur.alive) {
      // shot by a third party mid-fight: make ONE decision and stick to it for a moment
      this.thirdPartyT = ctx.time;
      if (ctx.time > this.switchCd) {
        const curThreat = this.threat.get(cur.id) ?? 0;
        // hysteresis: only swap when the newcomer is clearly the bigger problem (or it's a fresh
        // ambush while we're hurt) — otherwise two shooters make us ping-pong between them
        const fresh = th < 1.5;
        if (!this.targetVisible || th > curThreat * 1.35 + 0.3 || (fresh && me.hp < 55)) {
          this.target = from;
          this.switchCd = ctx.time + 2.6;
          this.reactT = rand(0.2, 0.35);
        }
      }
    } else if (!cur || cur === from || !cur.alive) {
      this.target = from;
      if (this.state !== 'engage') this.reactT = rand(0.15, 0.3);
    }
    if (this.target === from) {
      this.lastSeenPos.copy(from.motor.pos);
      this.lastSeenT = ctx.time;
      // snap attention toward the shooter instead of sweeping around
      this.lookYaw = yawFromDir(from.motor.pos.x - me.motor.pos.x, from.motor.pos.z - me.motor.pos.z);
      this.lookAroundT = 0;
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
    it.utilRelease = false;
    it.utilAim = false;
    it.heal = false;
    it.drop = false;
    this.utilCd -= dt;
    this.lingerT -= dt;
    const wasBlink = it.blink;
    it.blink = false;
    if (wasBlink && me.bug.canBlink) it.blink = true;

    this.jumpCd -= dt;
    this.repathCd -= dt;
    if (this.matchMode(me, ctx, dt)) return;
    if (this.pendingPlan && this.hasGoal && ctx.nav.canPlan()) this.setGoal(me, ctx, this.goal, true);
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

  /* ------------------------------------------------------------------ match phases */

  private lobbyGoal = new THREE.Vector3();
  private lobbyT = 0;
  private dropDist = Infinity;
  private dropDelay = -1;
  private zoneSprint = false;
  private repathCd = 0;
  private threat = new Map<number, number>();
  private switchCd = 0;
  private thirdPartyT = -99;
  private fleeDecideT = 0;
  private wantFlee = false;
  private ignoreUntil = new Map<number, number>();
  private dryT = 0;
  private escapeT = 0;
  private stuckCount = 0;
  private escapeA = 0;
  /** loot we tried and failed to path to (blink-only perches) -> retry after this time */
  private unreachable = new Map<object, number>();
  private pendingPlan = false;

  /** Lobby, Sky Barge, skydive and bugout: simple purpose-built steering. True if handled. */
  private matchMode(me: Actor, ctx: GameCtx, dt: number): boolean {
    const m = ctx.match;
    if (!m) return false;
    const it = me.intent;
    const setMove = (x: number, z: number, max = 1) => {
      const l = Math.hypot(x, z);
      const k = l > 0.01 ? Math.min(max, l) / l : 0;
      it.moveX = x * k;
      it.moveZ = z * k;
      if (l > 0.3) {
        this.aimYaw = yawFromDir(x, z);
        it.aimYaw = this.aimYaw;
      }
      it.aimPitch = 0;
      it.fire = false;
      it.ads = false;
    };
    if (me.bugout) {
      // race for the nearest Rift Nest, weaving a little
      let best: THREE.Vector3 | null = null, bd = Infinity;
      for (const n of ctx.world.nests) {
        if (n.used) continue;
        const d = n.pos.distanceTo(me.bug.pos);
        if (d < bd) {
          bd = d;
          best = n.pos;
        }
      }
      if (best) {
        const wx = Math.sin(ctx.time * 3 + me.id) * 0.35;
        const dx = best.x - me.bug.pos.x, dz = best.z - me.bug.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        setMove(dx / l - (dz / l) * wx, dz / l + (dx / l) * wx);
        it.sprint = bd > 6;
      } else setMove(0, 0);
      return true;
    }
    if (me.flight === 'barge') {
      setMove(0, 0);
      const tgt = m.dropTargetFor(me);
      const d = Math.hypot(tgt.x - m.barge.pos.x, tgt.z - m.barge.pos.z);
      // squads with you in them: wait for you to jump, then leap right after
      const lead = m.teamSize > 1 ? ctx.actors.find((o) => !!o.me && !o.parked && o.team === me.team) : null;
      if (lead) {
        if (m.canDrop && lead.flight !== 'barge' && this.dropDelay < 0) this.dropDelay = rand(0.15, 0.7);
      } else if (m.canDrop && this.dropDelay < 0 && (d > this.dropDist + 0.05 || d < 16)) this.dropDelay = rand(0, 1.2);
      this.dropDist = d;
      if (this.dropDelay >= 0) {
        this.dropDelay -= dt;
        if (this.dropDelay < 0) it.jump = true;
      }
      return true;
    }
    this.dropDist = Infinity;
    if (me.flight === 'dive' || me.flight === 'glide') {
      const tgt = m.dropTargetFor(me);
      const dx = tgt.x - me.motor.pos.x, dz = tgt.z - me.motor.pos.z;
      const d = Math.hypot(dx, dz);
      setMove(dx, dz, d < 3 ? d / 3 : 1);
      this.state = 'loot';
      this.hasGoal = false;
      this.path = [];
      return true;
    }
    if (m.phase === 'lobby') {
      // mill about Launch Isle: amble, pause, hop, show off a blink now and then
      const L = ctx.world.lobby;
      this.lobbyT -= dt;
      if (this.lobbyT <= 0) {
        this.lobbyT = rand(1.5, 4);
        const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * (L.radius - 3);
        this.lobbyGoal.set(L.center.x + Math.cos(a) * r, L.center.y, L.center.z + Math.sin(a) * r);
        if (this.rng() < 0.3) this.lobbyGoal.copy(me.motor.pos);
        if (this.rng() < 0.15 && me.bug.ready) {
          _v.copy(me.motor.pos).add(_v2.set(rand(-8, 8), 0, rand(-8, 8)));
          if (this.throwAt(me, ctx, _v)) this.blinkPlanT = rand(0.6, 1.2);
        }
      }
      const dx = this.lobbyGoal.x - me.motor.pos.x, dz = this.lobbyGoal.z - me.motor.pos.z;
      const d = Math.hypot(dx, dz);
      if (!me.emote && this.rng() < dt * 0.06) {
        me.startEmote((['wave', 'dance', 'flex', 'laugh'] as const)[Math.floor(this.rng() * 4)], 2.4);
        if (this.rng() < 0.5) me.say(['hi!', 'yo!', 'GL', ':)', 'hehe'][Math.floor(this.rng() * 5)], '#2a9d8f', 1.6, true);
      }
      if (me.emote) setMove(0, 0);
      else setMove(d > 0.8 ? dx : 0, d > 0.8 ? dz : 0, 0.6);
      it.sprint = false;
      if (this.rng() < dt * 0.3 && this.jumpCd <= 0) {
        it.jump = true;
        this.jumpCd = 2;
      }
      if (this.blinkPlanT >= 0) {
        this.blinkPlanT -= dt;
        if (this.blinkPlanT < 0 && me.bug.canBlink) it.blink = true;
      }
      this.target = null;
      return true;
    }
    return false;
  }

  /** Stay ahead of the Gloom: true if we're heading for safety this tick. */
  private zoneRun(me: Actor, ctx: GameCtx): boolean {
    const m = ctx.match;
    if (!m || m.phase !== 'live' || m.safeRadius > 120) return false;
    const c = m.safeCenter;
    const d = Math.hypot(me.motor.pos.x - c.x, me.motor.pos.z - c.y);
    const inGloom = m.gloomOutside(me.motor.pos);
    // cautious rascals rotate early; everyone runs once the Gloom is on top of them
    const margin = this.profile.archetype === 'cautious' || this.profile.archetype === 'sniper' ? 0.7 : 0.9;
    if (d < m.safeRadius * margin && !inGloom) return false;
    if (this.state === 'engage' && !inGloom && me.hp > 50) return false;
    if (!this.hasGoal || this.goalTimeout <= 0 || Math.hypot(this.goal.x - c.x, this.goal.z - c.y) > m.safeRadius * 0.8) {
      const r = Math.max(1, m.safeRadius * 0.5);
      const p = ctx.nav.randomWalkable(this.rng, c.x, c.y, r) ?? _v.set(c.x, 0, c.y);
      this.setGoal(me, ctx, p, true);
      this.goalTimeout = 8;
    }
    if (inGloom && me.bug.ready && this.rng() < 0.05) {
      // blink toward safety
      _v.set(c.x - me.motor.pos.x, 0, c.y - me.motor.pos.z).normalize();
      if (this.throwAt(me, ctx, _v2.copy(me.motor.pos).addScaledVector(_v, 16))) this.blinkPlanT = rand(0.7, 1.1);
    }
    return true;
  }

  /* ------------------------------------------------------------------ perception + decisions */

  private think(me: Actor, ctx: GameCtx, tick: number) {
    this.zoneSprint = false;
    const eye = me.eyePos(_eye);
    const facing = me.intent.aimYaw;
    this.targetVisible = false;
    let bestNew: Actor | null = null;
    let bestD = Infinity;
    for (const o of ctx.actors) {
      if (o === me || o.parked || (!o.alive && !o.bugout)) continue;
      if (o.team === me.team) continue;
      // knocked rascals aren't worth chasing across the map (the pushy ones still finish them off)
      if (o.downed && o !== this.target && o.motor.pos.distanceTo(me.motor.pos) > (this.profile.aggression > 0.7 ? 25 : 12)) continue;
      // a freshly spawned Blinkbug is shimmering (can't be hit) and often goes unnoticed
      if (o.bugout && (o.bugout.grace > 0 || (this.ignoreUntil.get(o.id) ?? 0) > ctx.time)) continue;
      const tp = o.bugout ? _v.copy(o.bug.pos) : _v.copy(o.motor.pos).setY(o.motor.pos.y + o.motor.height * 0.7);
      const d = tp.distanceTo(eye);
      if (d > 70) continue;
      // Nimbus: my bug sensed them — go have a look
      if (o.pingT > 0 && o.pingedBy === me && !this.targetVisible) {
        this.heardPos.copy(o.motor.pos);
        this.heardT = ctx.time;
      }
      // Wisp: shimmering rascals are nearly invisible unless right on top of you
      if (o.stealthT > 0 && d > 4) {
        this.awareness.set(o.id, Math.max(0, (this.awareness.get(o.id) ?? 0) - tick));
        if (o === this.target) this.lastSeenT = Math.min(this.lastSeenT, ctx.time - 2);
        continue;
      }
      const yawTo = yawFromDir(tp.x - eye.x, tp.z - eye.z);
      const hurtMe = me.lastDamagedBy === o && ctx.time - me.lastDamageTime < 2.5;
      const inCone = Math.abs(angleDelta(facing, yawTo)) < 80 * DEG || d < 5 || hurtMe;
      let aw = this.awareness.get(o.id) ?? 0;
      const range = ctx.match ? ctx.match.engageRange * (this.profile.aggression > 0.7 ? 1.25 : this.profile.aggression < 0.4 ? 0.8 : 1) : 999;
      if (inCone && ctx.sightClear(eye, tp)) {
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
          } else if (d < bestD && (d <= range || o.lastDamagedBy === me) && (this.ignoreUntil.get(o.id) ?? 0) < ctx.time) {
            // pacing + personality: a calm bot sometimes lets a passer-by go (unless they're shooting at it)
            const attacked = me.lastDamagedBy === o && ctx.time - me.lastDamageTime < 4;
            const keen = ctx.match ? Math.min(1, ctx.match.aggro * 1.3 + (this.profile.aggression - 0.5) * 0.4 + (d < 8 ? 0.35 : 0)) : 1;
            if (!attacked && o !== this.target && this.rng() > keen) this.ignoreUntil.set(o.id, ctx.time + 10);
            else {
              bestNew = o;
              bestD = d;
            }
          }
        }
      } else aw = Math.max(0, aw - tick * 0.5);
      this.awareness.set(o.id, aw);
    }
    // switch target if current one is lost and someone else is visible (or much closer)
    if (bestNew && ctx.time > this.switchCd && (!this.target || !this.target.alive || (!this.targetVisible && ctx.time - this.lastSeenT > 1.5) || bestD < 6)) {
      if (this.target && this.target !== bestNew) this.switchCd = ctx.time + 1.2;
      if (this.target !== bestNew) {
        if (!this.target) me.say(this.rng() < 0.8 ? '!' : '!!', '#ff6b6b', 1.1);
        this.target = bestNew;
        this.reactT = rand(this.reactRange[0], this.reactRange[1]);
        this.errYaw = (this.rng() - 0.5) * 2 * this.initErr * DEG;
        this.errPitch = (this.rng() - 0.5) * this.initErr * DEG;
      }
      this.targetVisible = true;
      this.lastSeenPos.copy(bestNew.motor.pos);
      this.lastSeenT = ctx.time;
    }
    // pacing: let go of far-off fights when the match wants calm (unless they're hurting us)
    if (this.target && ctx.match) {
      const td = this.target.motor.pos.distanceTo(me.motor.pos);
      if (td > ctx.match.engageRange * 1.5 && ctx.time - me.lastDamageTime > 3) {
        this.target = null;
        this.targetVisible = false;
      }
    }
    // decay threat
    for (const [k, v] of this.threat) {
      const nv = v * Math.exp(-tick / 3);
      if (nv < 0.05) this.threat.delete(k);
      else this.threat.set(k, nv);
    }
    // our target just became a fleeing Blinkbug: most rascals don't clock it straight away
    if (this.target && this.target.bugout && this.target.bugout.grace > 0) {
      if (this.rng() < 0.6) this.ignoreUntil.set(this.target.id, ctx.time + rand(5, 9));
      this.target = null;
      this.targetVisible = false;
    }
    if (this.target && !this.target.alive && !this.target.bugout) {
      this.target = null;
      this.targetVisible = false;
      this.idleT = rand(0.6, 1.4); // little victory pause
    }

    // hearing
    for (const s of ctx.sounds) {
      if (s.source === me || ctx.time - s.time > 0.6) continue;
      const d = s.pos.distanceTo(me.motor.pos);
      if (d > s.loudness) continue;
      // pacing: a calm match means we don't go chasing every distant pop
      if (ctx.match && d > ctx.match.engageRange * 1.3 && !(s.kind === 'impact' && d < 5)) continue;
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

    // ---- weapon choice: the right tool for the range (and something with bullets in it)
    this.chooseWeapon(me, ctx);

    // ---- heal up when nobody is shooting at us
    if (me.healItem && me.healT < 0 && me.hp < 72 && !this.targetVisible && ctx.time - me.lastDamageTime > 1.6) me.intent.heal = true;

    // ---- squads: knocked crawling, reviving, sparks, sticking with the leader
    if (this.squadThink(me, ctx)) return;

    // ---- choose state
    const w = me.weapon;
    const ammoType = w?.def.ammo as AmmoType | undefined;
    const lowAmmo = w ? w.mag + me.ammo[ammoType!] < w.def.mag * 0.5 : true;
    const hasTarget = !!this.target && ctx.time - this.lastSeenT < 8;
    let next: BotState = this.state;
    let canShoot = me.weapons.some((x) => x && (x.mag > 0 || me.ammo[x.def.ammo] > 0));
    // quiet scavenging (bots only): nobody stays helpless for long, so late circles still fight
    if (ctx.match && ctx.match.phase === 'live' && !canShoot && ctx.time - me.lastDamageTime > 10) {
      this.dryT += tick;
      const gun = me.weapons.find((x) => x);
      if (gun && this.dryT > 10) {
        me.addAmmo(gun.def.ammo, gun.def.mag);
        this.dryT = 0;
        canShoot = true;
      } else if (!gun && this.dryT > 40) {
        me.giveWeapon('poppistol', 0, 0, true);
        me.addAmmo('light', 24);
        this.dryT = 0;
        canShoot = true;
      }
    } else this.dryT = 0;
    if (!me.armed || !canShoot) next = hasTarget && this.targetVisible && me.hp < this.profile.retreatHp ? 'retreat' : 'loot';
    else if (hasTarget && this.targetVisible) {
      // fight-or-flight is decided every couple of seconds, not every tick (no dithering)
      if (ctx.time > this.fleeDecideT) {
        this.fleeDecideT = ctx.time + 2;
        const pinched = ctx.time - this.thirdPartyT < 3 && me.hp < 60; // caught between two shooters
        this.wantFlee = (me.hp < this.profile.retreatHp && this.rng() < 0.6) || (pinched && this.rng() < 0.7);
        if (pinched && this.wantFlee && me.bug.ready && this.rng() < this.profile.blinkiness) this.planEscapeBlink(me, ctx);
      }
      next = this.wantFlee ? 'retreat' : 'engage';
    }
    else if (hasTarget) next = me.hp < this.profile.retreatHp ? 'retreat' : 'chase';
    else if (lowAmmo || (this.profile.archetype === 'goblin' && this.rng() < 0.3)) next = 'loot';
    else if (ctx.time - this.heardT < 6) next = 'investigate';
    else if (this.state === 'loot' && !this.lootTarget && !this.crateTarget && me.armed && this.lingerT <= 0) next = 'wander';
    else if (this.state !== 'wander' && this.state !== 'loot') next = 'wander';
    // opportunism: never walk past an unopened crate when nobody is shooting
    if (next !== 'engage' && next !== 'retreat' && !this.crateTarget && me.armed) {
      for (const c of ctx.loot.crates) {
        if (c.opened || c.openT >= 0 || c.pos.y > 4) continue;
        if (c.pos.distanceTo(me.motor.pos) < 8) {
          this.crateTarget = c;
          this.lootTarget = null;
          next = 'loot';
          break;
        }
      }
    }
    if (next !== this.state) {
      if (next === 'investigate') me.say('?', '#49a8ff', 1.2);
      else if (next === 'loot' && !canShoot && hasTarget) me.say('...', '#8a7a9a', 1.4);
      this.state = next;
      this.hasGoal = false;
      this.path = [];
    }
    // a little victory dance when the coast is clear
    if (ctx.time - me.lastKillAt < 2.5 && ctx.time - me.lastKillAt > 0.8 && !this.targetVisible && !me.emote && me.healT < 0 && this.rng() < (this.profile.archetype === 'chaotic' || this.profile.archetype === 'aggressive' ? 0.25 : 0.1)) {
      me.startEmote((['dance', 'laugh', 'flex'] as const)[Math.floor(this.rng() * 3)], 2.2);
      me.lastKillAt = -99;
    }
    if ((this.state === 'wander' || this.state === 'loot' || this.state === 'investigate' || this.state === 'chase' || this.state === 'engage' || this.state === 'retreat') && this.zoneRun(me, ctx)) {
      if (this.state !== 'engage') {
        this.state = 'wander';
        this.zoneSprint = true;
        this.goalTimeout -= tick;
        return;
      }
    }

    switch (this.state) {
      case 'loot': {
        const valid = (this.lootTarget && ctx.loot.pickups.includes(this.lootTarget) && this.lootTarget.collectT < 0) || (this.crateTarget && !this.crateTarget.opened && this.crateTarget.openT < 0);
        if (!valid) {
          const pick = this.pickLoot(me, ctx);
          this.lootTarget = pick.pickup;
          this.crateTarget = pick.crate;
        }
        const goalPos = this.lootTarget?.pos ?? this.crateTarget?.pos;
        if (goalPos) {
          this.setGoal(me, ctx, goalPos);
          const d = goalPos.distanceTo(me.motor.pos);
          if (d < (this.crateTarget ? 2.0 : 1.6)) {
            if (this.lootTarget) ctx.loot.collect(me, this.lootTarget, ctx);
            else if (this.crateTarget) {
              ctx.loot.openCrate(this.crateTarget, me);
              this.idleT = 0.9; // wait for the goodies to land
              this.lingerT = 2.5;
            }
            this.lootTarget = null;
            this.crateTarget = null;
            this.hasGoal = false;
            this.idleT = Math.max(this.idleT, rand(0.2, 0.6));
          }
        } else if (!this.hasGoal) this.wanderGoal(me, ctx);
        break;
      }
      case 'help':
        break;
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
          // away from everyone who's been hurting us, weighted by threat; caught in a crossfire
          // (shooters on opposite sides) → break out sideways instead of running into one of them
          _v.subVectors(me.motor.pos, this.target.motor.pos).setY(0).normalize();
          if (this.threat.size > 1) {
            _v.set(0, 0, 0);
            let n = 0;
            for (const o of ctx.actors) {
              const w = this.threat.get(o.id);
              if (!w || !o.alive || o === me) continue;
              _v3.subVectors(me.motor.pos, o.motor.pos).setY(0).normalize();
              _v.addScaledVector(_v3, w);
              n += w;
            }
            if (n > 0 && _v.length() < n * 0.45) {
              // opposite sides: pick the side of the line between them we're already leaning to (stable per bot)
              _v3.subVectors(me.motor.pos, this.target.motor.pos).setY(0).normalize();
              const side = me.id % 2 ? 1 : -1;
              _v.set(-_v3.z * side, 0, _v3.x * side);
            }
            if (_v.lengthSq() < 1e-6) _v.subVectors(me.motor.pos, this.target.motor.pos).setY(0);
            _v.normalize();
          }
          _v2.copy(me.motor.pos).addScaledVector(_v, 14);
          if (!this.hasGoal || this.goalTimeout <= 0) this.setGoal(me, ctx, _v2, true);
          if (me.bug.ready && this.rng() < this.profile.blinkiness * 0.4) this.planEscapeBlink(me, ctx);
        }
        // pop smoke to cover the escape
        if (me.util?.id === 'fizzbomb' && this.utilCd <= 0 && this.target) {
          _v.subVectors(this.target.motor.pos, me.motor.pos).setY(0).normalize();
          if (this.throwUtilAt(me, ctx, _v2.copy(me.motor.pos).addScaledVector(_v, 3))) this.utilCd = 6;
        }
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
          // curiosity: crates and shiny loot pull rascals off their route
          const curious = this.profile.archetype === 'goblin' ? 0.9 : 0.55;
          if (this.rng() < curious) {
            const pick = this.pickLoot(me, ctx);
            const at = pick.pickup?.pos ?? pick.crate?.pos;
            if (at && at.distanceTo(me.motor.pos) < 30) {
              this.lootTarget = pick.pickup;
              this.crateTarget = pick.crate;
              this.state = 'loot';
              this.hasGoal = false;
              break;
            }
          }
          // hunting (pacing director): go and find someone
          const hunt = ctx.match?.hunt ?? 0;
          const canFight = me.weapons.some((x) => x && (x.mag > 0 || me.ammo[x.def.ammo] > 0));
          // a Loot Balloon is coming down nearby: go get it (and everyone else will too)
          const hs = ctx.match?.hotspot;
          if (hs && canFight && hs.distanceTo(me.motor.pos) < 85 && this.rng() < 0.55) {
            this.heardPos.set(hs.x + rand(-3, 3), hs.y, hs.z + rand(-3, 3));
            this.heardT = ctx.time;
            this.state = 'investigate';
            this.hasGoal = false;
            break;
          }
          if (hunt > 0 && canFight && this.rng() < hunt) {
            let prey: Actor | null = null, pd = 95;
            for (const o of ctx.actors) {
              if (o === me || !o.alive || o.parked || o.flight !== 'none' || o.team === me.team) continue;
              const dd = o.motor.pos.distanceTo(me.motor.pos);
              if (dd < pd) {
                pd = dd;
                prey = o;
              }
            }
            if (prey) {
              this.heardPos.set(prey.motor.pos.x + rand(-7, 7), prey.motor.pos.y, prey.motor.pos.z + rand(-7, 7));
              this.heardT = ctx.time;
              this.state = 'investigate';
              this.hasGoal = false;
              break;
            }
          }
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
    // utilities
    if (me.util && this.utilCd <= 0 && me.healT < 0) {
      const u = me.util.id;
      const chaos = this.profile.archetype === 'chaotic' ? 2.5 : 1;
      if (u === 'stickypop' && d > 5 && d < 22 && this.rng() < 0.1 * chaos) {
        if (this.throwUtilAt(me, ctx, t.motor.pos)) this.utilCd = rand(3, 6);
      } else if (u === 'gust' && d < 5.5) {
        if (this.throwUtilAt(me, ctx, t.motor.pos)) this.utilCd = 4;
      } else if (u === 'fizzbomb' && me.hp < 55 && this.rng() < 0.3) {
        _v.subVectors(t.motor.pos, me.motor.pos).setY(0).normalize();
        if (this.throwUtilAt(me, ctx, _v2.copy(me.motor.pos).addScaledVector(_v, 3))) this.utilCd = 6;
      } else if (u === 'chicken' && this.rng() < 0.05 * chaos) {
        const side = this.rng() < 0.5 ? -1 : 1;
        _v.subVectors(t.motor.pos, me.motor.pos).setY(0).normalize();
        if (this.throwUtilAt(me, ctx, _v2.copy(me.motor.pos).add(_v3.set(-_v.z * side * 8, 0, _v.x * side * 8)))) this.utilCd = 5;
      } else if (u === 'bouncejam' && this.rng() < 0.03 * chaos) {
        if (this.throwUtilAt(me, ctx, _v2.copy(me.motor.pos).add(_v3.set(me.motor.vel.x * 0.4, 0, me.motor.vel.z * 0.4)))) this.utilCd = 6;
      }
    }
    // Blinkbug flank: throw to the target's side, blink shortly after
    if (me.bug.ready && this.blinkPlanT < 0 && d < 26 && d > 5 && this.rng() < this.profile.blinkiness * 0.08) {
      const side = this.rng() < 0.5 ? -1 : 1;
      _v.subVectors(t.motor.pos, me.motor.pos).setY(0).normalize();
      const perp = _v2.set(-_v.z * side, 0, _v.x * side);
      const aimPt = _v3.copy(t.motor.pos).addScaledVector(perp, rand(4, 7)).addScaledVector(_v, rand(-2, 3));
      if (this.throwAt(me, ctx, aimPt)) this.blinkPlanT = rand(0.5, 1.2);
    }
  }

  private chooseWeapon(me: Actor, ctx: GameCtx) {
    if (me.healT >= 0) return;
    const d = this.target && this.targetVisible ? this.target.motor.pos.distanceTo(me.motor.pos) : 20;
    let best = -1, bestScore = -Infinity;
    me.weapons.forEach((w, i) => {
      if (!w) return;
      if (w.mag === 0 && me.ammo[w.def.ammo] === 0) return;
      const [lo, hi] = w.def.botRange;
      const fit = d < lo ? -(lo - d) : d > hi ? -(d - hi) * 0.6 : 5;
      const score = fit + w.rarity * 1.5 + (w.mag > 0 ? 1 : 0) + (i === me.activeSlot ? 1.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && best !== me.activeSlot) me.intent.slot = best;
    void ctx;
  }

  /** Solve a lob toward a point with the item's real physics, then throw it. */
  private throwUtilAt(me: Actor, ctx: GameCtx, pt: THREE.Vector3): boolean {
    if (!me.util || me.util.count <= 0) return false;
    const def = UTILS[me.util.id];
    const yaw = yawFromDir(pt.x - me.motor.pos.x, pt.z - me.motor.pos.z);
    const start = new THREE.Vector3(me.motor.pos.x, me.motor.pos.y + 1.2, me.motor.pos.z);
    let bestPitch = 0, bestErr = Infinity;
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let p = -0.5; p <= 0.9; p += 0.14) {
      pos.copy(start);
      throwVelocity(def, dirFromYawPitch(yaw, p, dir), vel);
      for (let i = 0; i < 200; i++) {
        const r = simulateThrow(ctx, def, pos, vel, THROW.step * 2);
        if (r.settled || ((def.sticky || def.id === 'gust') && r.hit)) break;
      }
      const err = Math.hypot(pos.x - pt.x, pos.z - pt.z) + Math.abs(pos.y - pt.y) * 0.5;
      if (err < bestErr) {
        bestErr = err;
        bestPitch = p;
      }
    }
    if (bestErr > 6) return false;
    dirFromYawPitch(yaw, bestPitch, me.intent.aimDir);
    me.intent.aimYaw = yaw;
    me.intent.utilRelease = true;
    return true;
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
      Blinkbug.throwVelocity(dirFromYawPitch(yaw, p, dir), vel, me.bug.stats.throwSpeed);
      for (let i = 0; i < 240; i++) if (simulateBug(ctx.cw, pos, vel, BUG.step * 2, undefined, me.bug.stats)) break;
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

  private pickLoot(me: Actor, ctx: GameCtx): { pickup: Pickup | null; crate: Crate | null } {
    let best: Pickup | null = null, bestCrate: Crate | null = null, bestScore = -Infinity;
    const goblin = this.profile.archetype === 'goblin';
    // a gun with no bullets (and none in the bag) is worth nothing
    const loaded = (x: { mag: number; def: { ammo: AmmoType } }) => x.mag > 0 || me.ammo[x.def.ammo] > 0;
    const worst = me.weapons.some((x) => !x) ? -1 : Math.min(...me.weapons.map((x) => (loaded(x!) ? x!.score : -50)));
    const dry = !me.weapons.some((x) => x && loaded(x));
    const reach = dry ? 70 : 45;
    for (const p of ctx.loot.pickups) {
      if (p.collectT >= 0 || !p.settled) continue;
      if ((this.unreachable.get(p) ?? -1) > ctx.time) continue;
      const d = p.pos.distanceTo(me.motor.pos);
      if (d > reach) continue;
      let v = -99;
      if (p.kind === 'weapon') {
        const act = me.previewOffer(p.defId, p.rarity);
        const sc = p.rarity * 10 + (WEAPONS[p.defId]?.weight ?? 5);
        if (!me.armed) v = 40;
        else if (act === 'fuse') v = 26 + p.rarity * 4;
        else if (act === 'add') v = 18 + p.rarity * 3;
        else if (sc > worst + 4) v = Math.min(40, 8 + (sc - worst) * 0.5);
        // an empty gun we have no bullets for is barely worth the walk
        if (p.mag <= 0 && me.ammo[WEAPONS[p.defId].ammo] <= 0) {
          const t = WEAPONS[p.defId].ammo;
          const ammoNear = ctx.loot.pickups.some((q) => q.kind === 'ammo' && q.defId === t && q.pos.distanceToSquared(p.pos) < 12 * 12);
          if (!ammoNear) v *= 0.3;
        }
        if (goblin && v > 0) v += 8;
      } else if (p.kind === 'ammo') {
        const gun = me.weapons.find((w) => w && w.def.ammo === p.defId);
        const needs = !!gun && me.ammo[p.defId as AmmoType] < 40;
        v = needs ? (gun!.mag + me.ammo[p.defId as AmmoType] === 0 ? (dry ? 36 : 22) : 12) : -99;
      } else if (p.kind === 'heal') {
        v = !me.healItem || (me.healItem.id === p.defId && me.healItem.count < 3) ? (me.hp < 80 ? 14 : 7) : -99;
      } else if (p.kind === 'util') {
        v = !me.util || me.util.id === p.defId ? (this.profile.archetype === 'chaotic' ? 14 : 6) : -99;
      }
      const score = v - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
        bestCrate = null;
      }
    }
    for (const c of ctx.loot.crates) {
      if (c.opened || c.openT >= 0) continue;
      if ((this.unreachable.get(c) ?? -1) > ctx.time) continue;
      const d = c.pos.distanceTo(me.motor.pos);
      if (d > (c.rich ? 90 : 45)) continue;
      const score = (goblin ? 34 : 20) + (c.rich ? 25 : 0) - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestCrate = c;
        best = null;
      }
    }
    return bestScore > -5 ? { pickup: best, crate: bestCrate } : { pickup: null, crate: null };
  }

  /* ------------------------------------------------------------------ squads */

  /** the teammate I follow: a human teammate if there is one, else the lowest-numbered bot */
  private leader(me: Actor, ctx: GameCtx): Actor | null {
    const m = ctx.match;
    if (!m || m.teamSize <= 1) return null;
    let best: Actor | null = null;
    for (const o of ctx.actors) {
      if (o.team !== me.team || !o.alive || o.downed || o.parked) continue;
      if (!best || (!!o.me && !best.me) || (!!o.me === !!best.me && o.id < best.id)) best = o;
    }
    return best === me ? null : best;
  }

  /** a teammate got shot: turn towards the shooter and join in */
  teamAlert(me: Actor, attacker: Actor, victim: Actor, ctx: GameCtx) {
    if (attacker.motor.pos.distanceTo(me.motor.pos) > 80) return;
    this.awareness.set(attacker.id, Math.max(this.awareness.get(attacker.id) ?? 0, 0.9));
    this.ignoreUntil.delete(attacker.id);
    if (!this.targetVisible) {
      this.heardPos.copy(attacker.motor.pos);
      this.heardT = ctx.time;
      this.lookYaw = yawFromDir(attacker.motor.pos.x - me.motor.pos.x, attacker.motor.pos.z - me.motor.pos.z);
      this.lookAroundT = 0;
    }
    if (victim.me && this.rng() < 0.15) me.say('ON IT!', '#ffd36b', 1.2);
  }

  /** returns true when a squad duty took over this tick */
  private squadThink(me: Actor, ctx: GameCtx): boolean {
    const m = ctx.match;
    if (!m || m.teamSize <= 1 || m.phase !== 'live') return false;
    const threatNear = this.targetVisible && !!this.target && this.target.motor.pos.distanceTo(me.motor.pos) < 22;
    // knocked: crawl towards the nearest teammate, or at least away from whoever did it
    if (me.downed) {
      let mate: Actor | null = null, md = 1e9;
      for (const o of ctx.actors) {
        if (o === me || o.team !== me.team || !o.alive || o.downed) continue;
        const d = o.motor.pos.distanceTo(me.motor.pos);
        if (d < md) {
          md = d;
          mate = o;
        }
      }
      this.state = 'help';
      if (mate && md > 1.5) this.setGoal(me, ctx, mate.motor.pos);
      else if (this.target) {
        _v.subVectors(me.motor.pos, this.target.motor.pos).setY(0).normalize();
        this.setGoal(me, ctx, _v2.copy(me.motor.pos).addScaledVector(_v, 6));
      } else this.hasGoal = false;
      return true;
    }
    me.intent.revive = false;
    if (threatNear) {
      me.reviving = null;
      return false;
    }
    // pick up a knocked teammate
    let down: Actor | null = null, dd = 45;
    for (const o of ctx.actors) {
      if (o === me || o.team !== me.team || !o.downed || !o.alive) continue;
      const d = o.motor.pos.distanceTo(me.motor.pos);
      if (d < dd) {
        dd = d;
        down = o;
      }
    }
    if (down) {
      this.state = 'help';
      if (dd < 1.8) {
        this.hasGoal = false;
        this.path = [];
        me.reviving = down;
        me.intent.revive = true;
        if (down.reviveK < 0.05) me.say('HOLD ON!', '#9dff8a', 1.4);
      } else this.setGoal(me, ctx, down.motor.pos);
      return true;
    }
    me.reviving = null;
    // carry a spark to a nest
    const carrying = m.sparks.find((sp) => sp.carrier === me);
    if (carrying) {
      let best: { pos: THREE.Vector3 } | null = null, bd = 1e9;
      for (const n of ctx.world.nests) {
        if (n.used) continue;
        const d = n.pos.distanceTo(me.motor.pos);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (best) {
        this.state = 'help';
        if (bd > 1.5) this.setGoal(me, ctx, best.pos);
        else this.hasGoal = false;
        return true;
      }
      return false;
    }
    // grab a teammate's spark off the ground
    let spark: { pos: THREE.Vector3 } | null = null, sd = 70;
    for (const sp of m.sparks) {
      if (sp.carrier || sp.owner.team !== me.team) continue;
      const d = sp.pos.distanceTo(me.motor.pos);
      if (d < sd) {
        sd = d;
        spark = sp;
      }
    }
    if (spark) {
      this.state = 'help';
      if (sd < 2) m.trySparkPickup(me);
      else this.setGoal(me, ctx, _v.copy(spark.pos).setY(spark.pos.y - 0.9));
      return true;
    }
    // drifted too far from the leader: catch up (fights and looting nearby are fine)
    const lead = this.leader(me, ctx);
    if (lead && !this.targetVisible) {
      const d = lead.motor.pos.distanceTo(me.motor.pos);
      if (d > 26) {
        this.state = 'help';
        const a = me.id * 2.4;
        this.setGoal(me, ctx, _v.copy(lead.motor.pos).add(_v2.set(Math.cos(a) * 4, 0, Math.sin(a) * 4)));
        return true;
      }
    }
    if (this.state === 'help') this.state = 'wander';
    return false;
  }

  private wanderGoal(me: Actor, ctx: GameCtx) {
    const arch = this.profile.archetype;
    let c = me.motor.pos;
    let r = arch === 'sniper' ? 30 : 18;
    // bias toward interesting places: a nearby named place, sometimes a far one
    if (this.rng() < 0.5) {
      const near = POIS.slice().sort((a, b) => Math.hypot(a.x - me.motor.pos.x, a.z - me.motor.pos.z) - Math.hypot(b.x - me.motor.pos.x, b.z - me.motor.pos.z));
      const p = this.rng() < 0.75 ? near[this.rng() < 0.6 ? 0 : 1] : near[Math.floor(this.rng() * near.length)];
      c = _v.set(p.x + rand(-p.r, p.r) * 0.6, 0, p.z + rand(-p.r, p.r) * 0.6);
    }
    const m = ctx.match;
    if (m && m.phase === 'live' && m.safeRadius < 120) {
      c = _v.set(m.safeCenter.x, 0, m.safeCenter.y);
      r = Math.max(2, Math.min(r, m.safeRadius * 0.7));
    }
    // squads: followers wander around their leader instead
    const lead = this.leader(me, ctx);
    if (lead) {
      c = _v.copy(lead.motor.pos);
      r = 7;
    }
    const p = ctx.nav.randomWalkable(this.rng, c.x, c.z, r);
    if (p) this.setGoal(me, ctx, p);
    this.goalTimeout = rand(8, 16);
  }

  private setGoal(me: Actor, ctx: GameCtx, p: THREE.Vector3, force = false) {
    if (!force && this.hasGoal && this.goal.distanceTo(p) < 2 && this.path.length) return;
    this.goal.copy(p);
    this.hasGoal = true;
    this.goalTimeout = Math.max(this.goalTimeout, 6);
    if (!ctx.nav.canPlan()) {
      // over this frame's planning budget: keep walking the old path (or straight) and retry soon
      if (!this.path.length) {
        this.path = [p.clone()];
        this.pathIdx = 0;
      }
      this.repathCd = 0;
      this.pendingPlan = true;
      return;
    }
    this.pendingPlan = false;
    const path = ctx.nav.findPath(me.motor.pos, p);
    if (!path && ctx.nav.lastFail === 'start' && me.motor.grounded) {
      this.escapeT = 1.6;
      this.escapeA = this.rng() * Math.PI * 2;
    }
    this.path = path ?? [p.clone()];
    this.pathIdx = 0;
    // loot that pathing can't reach (or only gets under): forget it for a while
    const tgt = this.lootTarget ?? this.crateTarget;
    if (tgt && tgt.pos.distanceToSquared(p) < 0.01) {
      const end = path?.[path.length - 1];
      const nearEnough = end && Math.hypot(end.x - p.x, end.z - p.z) < 1.8 && Math.abs(end.y - p.y) < 1.2;
      // only blame the loot if the loot is the problem (not us standing somewhere odd)
      const bad = !path ? ctx.nav.lastFail === 'goal' : !nearEnough && (!ctx.nav.lastPartial || me.motor.pos.distanceTo(p) < 30);
      if (bad) {
        this.unreachable.set(tgt, ctx.time + 12);
        this.lootTarget = null;
        this.crateTarget = null;
        this.hasGoal = false;
        this.path = [];
      }
    }
  }

  /* ------------------------------------------------------------------ steering */

  private steer(me: Actor, ctx: GameCtx, dt: number) {
    const it = me.intent;
    if (me.emote) {
      it.moveX = it.moveZ = 0;
      it.sprint = false;
      return;
    }
    let mx = 0, mz = 0;
    if (this.idleT > 0) {
      this.idleT -= dt;
    } else if (this.escapeT > 0) {
      // stranded off the nav grid (a roof, a crate stack): hop in one direction until we drop off
      this.escapeT -= dt;
      mx = Math.cos(this.escapeA);
      mz = Math.sin(this.escapeA);
      if (me.motor.grounded && this.jumpCd <= 0) {
        it.jump = true;
        this.jumpCd = 0.7;
      }
    } else if (this.hasGoal && (!this.path.length || this.pathIdx >= this.path.length) && Math.hypot(this.goal.x - me.motor.pos.x, this.goal.z - me.motor.pos.z) > 2) {
      // no usable path (e.g. just landed somewhere odd): head straight for it; stuck logic hops
      const dx = this.goal.x - me.motor.pos.x, dz = this.goal.z - me.motor.pos.z;
      const d = Math.hypot(dx, dz);
      mx = dx / d;
      mz = dz / d;
    } else if (this.path.length && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      let dx = wp.x - me.motor.pos.x, dz = wp.z - me.motor.pos.z;
      let d = Math.hypot(dx, dz);
      // a waypoint below us (hopping off a roof or ledge): keep walking the way we were going
      if (d < 0.7 && wp.y < me.motor.pos.y - 1.2 && me.motor.grounded) {
        const prev = this.pathIdx > 0 ? this.path[this.pathIdx - 1] : null;
        const hx = prev ? wp.x - prev.x : dx, hz = prev ? wp.z - prev.z : dz;
        const hl = Math.hypot(hx, hz) || 1;
        dx = (hx / hl) * 2;
        dz = (hz / hl) * 2;
        d = 2;
      }
      if (d < 0.7) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          this.path = [];
          // a partial path (long trip): keep going toward the real goal
          if (this.hasGoal && Math.hypot(this.goal.x - me.motor.pos.x, this.goal.z - me.motor.pos.z) > 2.5 && this.repathCd <= 0) {
            this.repathCd = 0.4;
            this.setGoal(me, ctx, this.goal, true);
          } else if (this.state === 'wander') this.idleT = rand(0.2, 1.2);
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
      if (!ctx.nav.isWalkAt(_v2.x, me.motor.pos.y, _v2.z)) this.strafe *= -1;
    }
    it.moveX = mx;
    it.moveZ = mz;
    it.sprint = (this.zoneSprint || this.state === 'chase' || this.state === 'retreat' || this.state === 'help' || this.state === 'loot' || (this.state === 'investigate' && this.profile.aggression > 0.6)) && Math.hypot(mx, mz) > 0.5;
    const wantCrouch = this.state === 'engage' && this.crouchWant;
    if (wantCrouch !== me.motor.crouching && me.motor.grounded && !me.motor.sliding) it.crouch = true;
    // aggressive bots slide into fights
    if (this.state === 'chase' && me.motor.sprinting && this.profile.aggression > 0.7 && this.rng() < dt * 0.6) it.crouch = true;

    // stuck detection -> jump / repath
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      const moved = Math.hypot(me.motor.pos.x - this.lastProgressPos.x, me.motor.pos.z - this.lastProgressPos.z);
      if (Math.hypot(mx, mz) > 0.3 && moved < 0.35) {
        // wedged somewhere for a while: pick a direction and bail out
        if (++this.stuckCount >= 4) {
          this.stuckCount = 0;
          this.escapeT = 1.4;
          this.escapeA = this.rng() * Math.PI * 2;
          // whatever we were trying to reach here isn't reachable this way
          const tgt = this.lootTarget ?? this.crateTarget;
          if (tgt && tgt.pos.distanceTo(me.motor.pos) < 8) {
            this.unreachable.set(tgt, ctx.time + 15);
            this.lootTarget = null;
            this.crateTarget = null;
            this.hasGoal = false;
            this.path = [];
          }
        } else if (this.jumpCd <= 0) {
          it.jump = true;
          this.jumpCd = 0.8;
        } else if (this.hasGoal) {
          this.setGoal(me, ctx, this.goal, true);
          this.strafe *= -1;
        }
      } else if (moved > 1) this.stuckCount = 0;
      this.lastProgressPos.copy(me.motor.pos);
      this.stuckT = 0;
    }
  }

  /* ------------------------------------------------------------------ aim */

  private aim(me: Actor, ctx: GameCtx, dt: number) {
    const it = me.intent;
    const eye = me.eyePos(_eye);
    let desiredYaw = this.aimYaw, desiredPitch = 0;
    // a close retreat is a fighting retreat: keep eyes (and gun) on the threat while backing off,
    // rather than whipping round to face the run direction and back again
    const fightingRetreat = this.state === 'retreat' && !!this.target && this.targetVisible && me.armed && this.target.motor.pos.distanceTo(me.motor.pos) < 16;
    const engaged = (this.state === 'engage' || fightingRetreat) && this.target && this.targetVisible;
    if (engaged) {
      const t = this.target!;
      // human-ish tracking: aim where they were a moment ago (+ an imperfect lead), with a
      // wandering hand that shakes more when the target moves fast
      const tp = t.bugout ? _v.copy(t.bug.pos) : this.perceivedPos(t, ctx.time, _v);
      if (!t.bugout) tp.y += this.aimHead ? t.motor.height - 0.22 : t.motor.height * 0.55;
      desiredYaw = yawFromDir(tp.x - eye.x, tp.z - eye.z);
      desiredPitch = Math.atan2(tp.y - eye.y, Math.hypot(tp.x - eye.x, tp.z - eye.z));
      const lateral = Math.abs(t.motor.vel.x * Math.cos(desiredYaw) - t.motor.vel.z * Math.sin(desiredYaw));
      const k = Math.exp(-this.trackRate * dt);
      this.errYaw *= k;
      this.errPitch *= k;
      const dist = Math.hypot(tp.x - eye.x, tp.z - eye.z);
      const shake = this.noiseDeg * DEG * (0.55 + Math.min(1.2, lateral * 0.14)) * (me.motor.horizontalSpeed() > 2 ? 1.25 : 1) * (0.6 + dist / 20);
      const nt = ctx.time;
      desiredYaw += this.errYaw + (noise1(nt * 2.2 + this.phase1 * 7) * 0.65 + noise1(nt * 5.3 + this.phase2 * 7) * 0.35) * 2 * shake;
      desiredPitch += this.errPitch + (noise1(nt * 2.6 + this.phase2 * 11) * 0.65 + noise1(nt * 6.1 + this.phase1 * 11) * 0.35) * 1.2 * shake;
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
    const maxTurn = this.turn * dt * (engaged ? 1 : 0.7);
    const dy = clamp(angleDelta(this.aimYaw, desiredYaw), -maxTurn, maxTurn);
    this.aimYaw = wrapAngle(this.aimYaw + dy);
    this.aimPitch += clamp(desiredPitch - this.aimPitch, -maxTurn, maxTurn);

    if (!it.throwRelease && !it.utilRelease) {
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
      // don't waste ammo far outside the gun's useful range (close in instead)
      const inRange = d <= me.weapon.def.botRange[1] * 1.3 + 4;
      if (this.reactT <= 0 && onTarget && inRange) {
        if (this.burstT > 0) {
          this.burstT -= dt;
          it.fire = true;
          if (this.burstT <= 0) this.pauseT = rand(this.profile.pause[0], this.profile.pause[1]) * (d > 25 ? 1.8 : 1) * (1.3 - this.skill * 0.5);
        } else if (this.pauseT > 0) this.pauseT -= dt;
        else {
          this.burstT = rand(this.profile.burst[0], this.profile.burst[1]);
          this.aimHead = this.rng() < this.headshotBias;
        }
      }
    }
  }
}
