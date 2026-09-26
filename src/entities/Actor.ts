import * as THREE from 'three';
import { CharacterMotor, MOTOR, MotorInput } from '../physics/Motor';
import { RascalRig, RascalLook } from './RascalRig';
import { Blinkbug, BugOwner, BUG } from './Blinkbug';
import { Intent, makeIntent, GameCtx } from '../core/types';
import { WeaponInstance, buildWeaponView, AmmoType, WEAPONS } from '../combat/Weapons';
import { fireWeapon } from '../combat/Combat';
import { angleDelta, clamp, damp, dampAngle, yawFromDir } from '../core/math';
import { audio } from '../audio/Audio';
import { PAL, RarityIndex } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { PShape } from '../fx/Particles';

export interface Controller {
  update(actor: Actor, ctx: GameCtx, dt: number): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

let nextActorId = 1;

/**
 * A Rascal in the match. Player and bots share this class; only the Controller differs.
 */
export class Actor implements BugOwner {
  readonly id = nextActorId++;
  motor: CharacterMotor;
  rig: RascalRig;
  bug: Blinkbug;
  intent: Intent = makeIntent();
  controller: Controller | null = null;
  isLocal = false;

  hp = 100;
  maxHp = 100;
  alive = true;
  bodyYaw = 0;
  ads = false;

  weapons: (WeaponInstance | null)[] = [null, null, null];
  activeSlot = 0;
  ammo: Record<AmmoType, number> = { light: 0, medium: 0, heavy: 0, shells: 0, bolts: 0 };

  // stats
  kills = 0;
  damageDealt = 0;
  blinks = 0;
  lastDamagedBy: Actor | null = null;
  lastDamageTime = -99;
  eliminatedAt = -1;

  private prevYaw = 0;
  private turnRate = 0;
  private stepDist = 0;
  private fireHeld = false;
  private sprintBlock = 0;
  throwAiming = false;
  private swapT = 0;
  /** camera-facing events for the local player */
  onRecoil: ((pitch: number, yaw: number, kick: number) => void) | null = null;
  onBlinked: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null;
  onLanded: ((impact: number) => void) | null = null;

  constructor(public name: string, look: RascalLook, public ctx: GameCtx, bugTint = PAL.blink) {
    this.motor = new CharacterMotor(ctx.cw);
    this.rig = new RascalRig(look);
    this.bug = new Blinkbug(ctx.cw, ctx.fx, this, bugTint);
    ctx.scene.add(this.rig.root, this.bug.root);
  }

  /* ----------------------------------------------------------------- BugOwner */
  dockWorld(out: THREE.Vector3) {
    return this.rig.bugDock.getWorldPosition(out);
  }
  facingYaw() {
    return this.bodyYaw;
  }

  /* ----------------------------------------------------------------- queries */
  get weapon() {
    return this.weapons[this.activeSlot];
  }
  get armed() {
    return !!this.weapon;
  }
  get headRadius() {
    return 0.28;
  }
  get bodyRadius() {
    return 0.3;
  }
  headCenter(out: THREE.Vector3) {
    const h = this.motor.height;
    return out.set(this.motor.pos.x, this.motor.pos.y + h - 0.22, this.motor.pos.z);
  }
  bodySegment(a: THREE.Vector3, b: THREE.Vector3) {
    const h = this.motor.height;
    a.set(this.motor.pos.x, this.motor.pos.y + 0.3, this.motor.pos.z);
    b.set(this.motor.pos.x, this.motor.pos.y + Math.max(0.35, h - 0.55), this.motor.pos.z);
  }
  eyePos(out: THREE.Vector3) {
    return out.set(this.motor.pos.x, this.motor.pos.y + this.motor.height - 0.2, this.motor.pos.z);
  }
  muzzleWorld(out: THREE.Vector3) {
    const w = this.rig.weapon;
    if (w) return w.muzzle.getWorldPosition(out);
    return this.eyePos(out);
  }
  get pos() {
    return this.motor.pos;
  }

  spawn(p: THREE.Vector3, yaw: number) {
    this.motor.teleport(p);
    this.bodyYaw = yaw;
    this.prevYaw = yaw;
    this.intent.aimYaw = yaw;
    this.hp = this.maxHp;
    this.alive = true;
    this.rig.root.visible = true;
    this.rig.root.scale.setScalar(1);
    this.bug.reset();
    this.bug.root.position.copy(p);
    this.eliminatedAt = -1;
    this.lastDamagedBy = null;
    this.syncRig(0, 0);
  }

  /* ----------------------------------------------------------------- inventory */
  giveWeapon(defId: string, rarity: RarityIndex, slot?: number, silent = false): number {
    const def = WEAPONS[defId];
    let s = slot ?? this.weapons.findIndex((w) => !w);
    if (s < 0) s = this.activeSlot;
    this.weapons[s] = new WeaponInstance(def, rarity);
    this.equip(s, silent);
    return s;
  }

  equip(slot: number, silent = false) {
    if (slot < 0 || slot > 2) return;
    const cur = this.weapon;
    if (cur) cur.reloadT = -1;
    this.activeSlot = slot;
    const w = this.weapon;
    this.rig.setWeapon(w ? buildWeaponView(w.def, w.rarity) : null);
    if (w && !silent && this.isLocal) audio.equip();
  }

  /* ----------------------------------------------------------------- damage */
  takeDamage(amount: number, from: Actor | null, headshot: boolean, dir: THREE.Vector3, ctx: GameCtx, weaponName: string): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.lastDamagedBy = from;
    this.lastDamageTime = ctx.time;
    if (from) from.damageDealt += amount;
    // hit reaction direction in local space
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    const lx = dir.x * c - dir.z * s;
    const lz = dir.x * s + dir.z * c;
    this.rig.onHit(lx, lz);
    if (this.isLocal) {
      ctx.hud.damageFrom(_v.copy(dir).negate());
      ctx.shake(headshot ? 0.45 : 0.28);
      audio.hurt();
    } else audio.hurt(this.motor.pos);
    this.onDamaged(from, ctx);
    if (this.hp <= 0) {
      this.hp = 0;
      this.eliminate(from, ctx, weaponName);
      return true;
    }
    return false;
  }

  /** hook for controllers (bots react to being shot) */
  onDamaged(_from: Actor | null, _ctx: GameCtx) {}

  eliminate(by: Actor | null, ctx: GameCtx, weaponName: string) {
    this.alive = false;
    this.eliminatedAt = ctx.time;
    if (by && by !== this) by.kills++;
    const p = _v.copy(this.motor.pos).setY(this.motor.pos.y + 0.9);
    const L = this.rig.look;
    ctx.fx.elimination(p, [L.outfit, L.accent, L.scarf, L.pack]);
    audio.elimination(p, !!by?.isLocal);
    ctx.shake(by?.isLocal || this.isLocal ? 0.5 : 0);
    // backpack & hat pop off
    ctx.fx.chunk(_v2.copy(p).setY(p.y + 0.3), new THREE.Vector3((Math.random() - 0.5) * 3, 8, (Math.random() - 0.5) * 3), L.pack, 0.4, 2.4);
    ctx.fx.chunk(_v2.copy(p).setY(p.y + 0.8), new THREE.Vector3((Math.random() - 0.5) * 3, 10, (Math.random() - 0.5) * 3), L.hatColor, 0.3, 2.4);
    this.rig.root.visible = false;
    this.bug.vanish();
    ctx.loot.dropInventory(this);
    ctx.hud.killfeed(by ? by.name : 'THE GLOOM', this.name, weaponName, this.isLocal || !!by?.isLocal);
    if (this.isLocal) ctx.hud.playerEliminated(by ? by.name : 'the island');
    else if (by?.isLocal) ctx.hud.playerElimination(this.name);
  }

  onFired(pitch: number, yaw: number, kick: number) {
    this.rig.onFire(kick);
    this.onRecoil?.(pitch, yaw, kick);
  }

  heal(n: number) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /* ----------------------------------------------------------------- update */
  update(dt: number, ctx: GameCtx) {
    if (!this.alive) return;
    this.controller?.update(this, ctx, dt);
    const it = this.intent;
    const m = this.motor;

    // --- weapon slot switching
    if (it.slot >= 0 && it.slot !== this.activeSlot) this.equip(it.slot);

    // --- ADS
    this.ads = it.ads && this.armed && !m.sliding && !this.weapon!.reloading;

    // --- facing: armed/aiming rascals face the aim; unarmed ones face movement
    const moveLen = Math.hypot(it.moveX, it.moveZ);
    const combatFacing = this.armed || it.fire || this.ads || this.throwAiming;
    let targetYaw = this.bodyYaw;
    if (combatFacing) targetYaw = it.aimYaw;
    else if (moveLen > 0.1) targetYaw = yawFromDir(it.moveX, it.moveZ);
    if (m.sliding) {
      const hs = m.horizontalSpeed();
      if (hs > 0.5) targetYaw = yawFromDir(m.vel.x, m.vel.z);
    }
    this.bodyYaw = dampAngle(this.bodyYaw, targetYaw, combatFacing ? 22 : 12, dt);
    this.turnRate = damp(this.turnRate, angleDelta(this.prevYaw, this.bodyYaw) / Math.max(dt, 1e-4), 10, dt);
    this.prevYaw = this.bodyYaw;

    // --- movement
    const firing = it.fire && this.armed;
    if (firing) this.sprintBlock = 0.35;
    this.sprintBlock -= dt;
    const mi: MotorInput = {
      wishX: it.moveX,
      wishZ: it.moveZ,
      sprint: it.sprint && !this.ads && this.sprintBlock <= 0 && !this.throwAiming,
      jump: it.jump,
      crouch: it.crouch,
      speedMul: this.ads ? 0.62 : this.weapon?.reloading ? 0.85 : 1,
    };
    const wasSliding = m.sliding;
    m.update(dt, mi);
    const ev = m.events;
    if (ev.jumped) {
      this.rig.onJump();
      audio.jump(m.pos);
      ctx.fx.dust(m.pos, 3);
    }
    if (ev.landed > 0) {
      const impact = ev.landed;
      this.rig.onLand(impact);
      if (impact > 3) {
        ctx.fx.landBurst(m.pos, impact, m.surface);
        audio.land(m.pos, impact, m.surface);
        this.onLanded?.(impact);
      } else audio.footstep(m.pos, m.surface, 0.6);
    }
    if (ev.slideStarted) {
      audio.slide(m.pos);
      ctx.fx.dust(m.pos, 5);
    }
    if (ev.mantled) {
      audio.mantle(m.pos);
      this.rig.onJump();
    }
    if (m.sliding && Math.random() < dt * 30) ctx.fx.soft.emit(_v.copy(m.pos).setY(m.pos.y + 0.05), { count: 1, color: [0xe8dcc0, 0xffffff], speed: [0.3, 1], spread: 1, up: 0.8, life: [0.3, 0.5], size: [0.14, 0.24], sizeEnd: 2, alpha: 0.4, drag: 3 });
    if (wasSliding && !m.sliding) ctx.fx.dust(m.pos, 2);

    // --- footsteps
    const hs = m.horizontalSpeed();
    if (m.grounded && !m.sliding && hs > 0.8) {
      this.stepDist += hs * dt;
      const strideLen = m.sprinting ? 1.25 : m.crouching ? 0.7 : 1.0;
      if (this.stepDist > strideLen) {
        this.stepDist = 0;
        const loud = m.crouching ? 0.35 : m.sprinting ? 1.1 : 0.75;
        audio.footstep(m.pos, m.surface, loud * (this.isLocal ? 0.7 : 1));
        ctx.emitSound({ pos: m.pos.clone(), loudness: m.crouching ? 5 : m.sprinting ? 22 : 14, source: this, kind: 'footstep' });
        if (m.sprinting || m.surface === 'water') {
          const col = m.surface === 'grass' ? 0xd9e8b0 : m.surface === 'water' ? 0xffffff : 0xe8dcc0;
          ctx.fx.dust(m.pos, m.surface === 'water' ? 3 : 1.5, col);
        }
      }
    }

    // --- weapon handling
    this.updateWeapon(dt, ctx, it);

    // --- blinkbug
    this.updateBug(dt, ctx, it);

    // --- fell off the world
    if (m.pos.y < -25 && this.alive) this.eliminate(null, ctx, 'THE SKY');

    this.syncRig(dt, ctx.time);
  }

  private updateWeapon(dt: number, ctx: GameCtx, it: Intent) {
    const w = this.weapon;
    if (!w) return;
    w.cooldown -= dt;
    w.bloom = Math.max(0, w.bloom - w.def.bloomRecover * dt * (it.fire ? 0.35 : 1));

    // reload
    if (w.reloading) {
      const prev = w.reloadT / w.reloadTime;
      w.reloadT += dt;
      const k = w.reloadT / w.reloadTime;
      if (this.isLocal) {
        if (prev < 0.3 && k >= 0.3) audio.reload(1);
        if (prev < 0.75 && k >= 0.75) audio.reload(2);
      }
      if (k >= 1) {
        const need = w.def.mag - w.mag;
        const take = Math.min(need, this.ammo[w.def.ammo]);
        w.mag += take;
        this.ammo[w.def.ammo] -= take;
        w.reloadT = -1;
      }
      this.fireHeld = it.fire;
      return;
    }
    const wantReload = (it.reload || (w.mag === 0 && it.fire)) && w.mag < w.def.mag && this.ammo[w.def.ammo] > 0;
    if (wantReload && !this.motor.sliding) {
      w.reloadT = 0;
      if (this.isLocal) audio.reload(0);
      this.fireHeld = it.fire;
      return;
    }
    if (this.motor.mantleT >= 0) return;

    const trigger = it.fire && (w.def.mode === 'auto' || !this.fireHeld);
    if (trigger && w.cooldown <= 0) {
      if (w.mag <= 0) {
        if (!this.fireHeld && this.isLocal) audio.dryFire();
      } else {
        w.mag--;
        w.cooldown = 60 / w.def.rpm;
        this.sprintBlock = 0.4;
        fireWeapon(this, ctx);
        const f = this.rig.weapon?.flash;
        if (f) {
          f.visible = true;
          f.rotation.z = Math.random() * 6;
          f.scale.setScalar(0.8 + Math.random() * 0.5);
          setTimeout(() => (f.visible = false), 45);
        }
      }
    }
    this.fireHeld = it.fire;
  }

  private updateBug(dt: number, ctx: GameCtx, it: Intent) {
    const bug = this.bug;
    this.throwAiming = it.throwAim && bug.ready;
    bug.excited = this.throwAiming;
    if (it.throwRelease && bug.ready) {
      const from = this.dockWorld(_v).clone();
      // launch from just in front of the chest so it never starts inside a wall behind us
      const chest = this.eyePos(_v2).setY(this.motor.pos.y + 1.1);
      if (!ctx.cw.sphereOverlaps(chest, BUG.radius, ColFlags.BlocksBug)) from.copy(chest);
      const vel = Blinkbug.throwVelocity(it.aimDir, _v3);
      vel.x += this.motor.vel.x * 0.5;
      vel.z += this.motor.vel.z * 0.5;
      if (bug.throw(from, vel)) {
        this.rig.onThrow();
        ctx.emitSound({ pos: from.clone(), loudness: 10, source: this, kind: 'blink' });
      }
    }
    if (it.blink) {
      if (bug.canBlink) this.doBlink(ctx);
      else if (bug.state === 'docked' && this.isLocal) {
        audio.blinkFail();
        ctx.hud.toast(bug.cooldown > 0 ? 'Blinkbug is napping…' : 'Throw your Blinkbug first!', '#9fe8ff');
      }
    }
    bug.update(dt);
    this.swapT = Math.max(0, this.swapT - dt);
  }

  /** Find a free standing spot near the bug; returns null if there's no room. */
  findBlinkSpot(out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.bug.pos;
    const m = this.motor;
    const baseY = b.y - BUG.radius - 0.02;
    const cands: [number, number, number][] = [[0, 0, 0], [0, 0.25, 0], [0, 0.5, 0], [0, -0.4, 0]];
    for (let r = 0.35; r <= 0.75; r += 0.4) for (let k = 0; k < 8; k++) cands.push([Math.cos((k / 8) * Math.PI * 2) * r, 0.1, Math.sin((k / 8) * Math.PI * 2) * r]);
    for (const [dx, dy, dz] of cands) {
      out.set(b.x + dx, baseY + dy, b.z + dz);
      if (m.bodyOverlaps(out, MOTOR.standHeight, 0.03)) continue;
      // don't pop through a wall to reach an offset spot
      if ((dx || dz) && !m.world.lineClear(_v2.set(b.x, b.y, b.z), _v3.set(out.x, out.y + 0.5, out.z), ColFlags.BlocksMove)) continue;
      return out;
    }
    // crouch-size fallback (tight attic spaces)
    out.set(b.x, baseY, b.z);
    if (!m.bodyOverlaps(out, MOTOR.crouchHeight, 0.03)) {
      m.crouching = true;
      return out;
    }
    return null;
  }

  private doBlink(ctx: GameCtx) {
    const spot = this.findBlinkSpot(new THREE.Vector3());
    if (!spot) {
      if (this.isLocal) {
        audio.blinkFail();
        ctx.hud.toast('No room to blink there!', '#ff9a9a');
      }
      this.bug.recall();
      return;
    }
    const from = this.motor.pos.clone();
    const keepVel = this.motor.vel.clone();
    this.motor.teleport(spot);
    // keep a little horizontal momentum so blinking mid-run feels fluid
    this.motor.vel.set(keepVel.x * 0.4, Math.max(0, keepVel.y * 0.2), keepVel.z * 0.4);
    this.bug.swapped(from);
    this.blinks++;
    this.rig.onBlinkArrive();
    this.swapT = 0.3;
    ctx.fx.smear(from, spot);
    ctx.fx.blinkBurst(from, false);
    ctx.fx.blinkBurst(spot, true);
    ctx.fx.glow.emit(_v.copy(spot).setY(spot.y + 1), { count: 10, color: [0xffffff, PAL.blink], speed: [5, 9], spread: 1, life: 0.25, size: 0.12, shape: PShape.Sparkle, drag: 6 });
    audio.blink(spot, this.isLocal);
    if (!this.isLocal) audio.blink(from, false);
    ctx.emitSound({ pos: spot.clone(), loudness: 25, source: this, kind: 'blink' });
    ctx.emitSound({ pos: from.clone(), loudness: 20, source: this, kind: 'blink' });
    this.onBlinked?.(from, spot);
  }

  private syncRig(dt: number, time: number) {
    const m = this.motor;
    const r = this.rig;
    r.root.position.copy(m.pos);
    r.root.rotation.y = this.bodyYaw;
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    // local velocity (forward = -z)
    const lx = m.vel.x * c - m.vel.z * s;
    const lz = m.vel.x * s + m.vel.z * c;
    const w = this.weapon;
    r.update({
      dt,
      time,
      speed: m.horizontalSpeed(),
      vy: m.vel.y,
      grounded: m.grounded,
      sliding: m.sliding,
      crouching: m.crouching,
      sprinting: m.sprinting,
      mantling: m.mantleT >= 0,
      aimPitch: this.intent.aimPitch,
      turnRate: this.turnRate,
      localVelX: lx,
      localVelZ: -lz,
      armed: this.armed,
      ads: this.ads,
      reloadK: w && w.reloading ? w.reloadT / w.reloadTime : -1,
      healing: false,
    });
    void clamp;
  }
}
