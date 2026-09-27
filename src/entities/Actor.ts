import * as THREE from 'three';
import { CharacterMotor, MOTOR, MotorInput } from '../physics/Motor';
import { RascalRig, RascalLook, EmoteKind } from './RascalRig';
import { Blinkbug, BugOwner, BUG } from './Blinkbug';
import { Intent, makeIntent, GameCtx, Personal } from '../core/types';
import { WeaponInstance, buildWeaponView, AmmoType, WEAPONS, AMMO_INFO } from '../combat/Weapons';
import { HEALS, UTILS, HealId, UtilId, ItemStack, buildItemModel } from '../combat/Items';
import { throwVelocity } from '../combat/Throwables';
import { RARITY } from '../render/Palette';
import { fireWeapon } from '../combat/Combat';
import { angleDelta, clamp, damp, dampAngle, yawFromDir } from '../core/math';
import { audio } from '../audio/Audio';
import { PAL, RarityIndex } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { PShape } from '../fx/Particles';
import { BugSpecies, SPECIES_BY_ID, randomBugName } from '../progression/Bugs';
import { islandRadius, groundHeight } from '../world/Terrain';
import { detail } from '../render/Detail';
import { PerkId, PERKS, MAX_PERKS } from '../combat/Perks';
import { buildRelicModel } from '../loot/Loot';

export interface Controller {
  update(actor: Actor, ctx: GameCtx, dt: number): void;
  /** squads: a teammate just got shot by `attacker` */
  teamAlert?(me: Actor, attacker: Actor, victim: Actor, ctx: GameCtx): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

let nextActorId = 1;

/** one rascal as the LAN host sends it (see net/Host.ts) */
export interface NetActorState {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  pitch: number;
  /** bit flags: 1 alive, 2 downed, 4 bugout, 8 crouch, 16 slide, 32 sprint, 64 grounded, 128 ads,
   * 256 mantle, 512 healing, 1024 stealth, 2048 out, 4096 body visible, bits 13-14 flight */
  f: number;
  hp: number;
  dh: number;
  rk: number;
  w: string;
  em: string;
  /** relics carried */
  rc?: number;
  bs: number;
  bx: number; by: number; bz: number;
  bt?: number;
  bh?: number;
}

/** seconds of holding interact to pick a teammate up */
export const REVIVE_TIME = 4;

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
  /** personal feedback (HUD / UI sounds / camera) for human players; null for bots */
  me: Personal | null = null;
  /** test/debug: removed from play (no AI, no respawn) */
  parked = false;

  // --- match state
  flight: 'none' | 'barge' | 'dive' | 'glide' = 'none';
  bargeSpot = 0;
  private glider: THREE.Group | null = null;
  private gliderK = 0;
  /** eliminated but piloting their Blinkbug toward a Rift Nest */
  bugout: { t: number; hp: number; vel: THREE.Vector3; grace: number } | null = null;
  reviveUsed = false;
  /** KO tumble: the rascal is launched spinning before popping into confetti */
  koT = 0;
  private koVel = new THREE.Vector3();
  private koPos = new THREE.Vector3();
  private koSpin = new THREE.Vector3();
  private koStarT = 0;
  private koFloor = 0;
  lastHitDir = new THREE.Vector3();
  /** squad: same number = same side (solo: everyone has their own) */
  team = 0;
  /** knocked down: crawling, can't fight, bleeding out until a teammate picks you up */
  downed = false;
  downHp = 0;
  downBy: Actor | null = null;
  private downWeapon = '';
  /** 0..1 how far through being revived */
  reviveK = 0;
  /** the teammate this rascal is currently reviving */
  reviving: Actor | null = null;
  /** fully out of the match */
  out = false;
  placement = 0;
  distance = 0;
  bestRarity = -1;
  weaponDamage: Record<string, number> = {};

  hp = 100;
  maxHp = 100;
  alive = true;
  bodyYaw = 0;
  ads = false;

  weapons: (WeaponInstance | null)[] = [null, null, null];
  activeSlot = 0;
  ammo: Record<AmmoType, number> = { light: 0, medium: 0, heavy: 0, shells: 0, bolts: 0 };
  util: ItemStack<UtilId> | null = null;
  healItem: ItemStack<HealId> | null = null;
  /** >=0 while eating/drinking */
  healT = -1;
  boostT = 0;
  utilAiming = false;
  fusions = 0;
  /** perk badges pinned on this match (oldest first) */
  perks: PerkId[] = [];
  /** Rift Relics carried (not sent home yet) */
  relics: string[] = [];
  /** seconds spent at a Rift Nest sending relics home */
  bankT = 0;
  private relicMark: THREE.Object3D | null = null;
  /** gloop / webs / snap traps: move slower for a while */
  slowT = 0;
  slowK = 1;
  private turretT = 0;
  private lastBugState = 'docked';

  // stats
  kills = 0;
  revives = 0;
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

  /** your Blinkbug's own name */
  bugName: string;
  /** a speech bubble over their head */
  speech: { text: string; color: string; t: number; dur: number } | null = null;
  private sayCd = 0;
  /** emote in progress (cancelled by moving, shooting or getting hit) */
  emote: EmoteKind | null = null;
  private emoteT = 0;
  /** match stats for callouts */
  lastBlinkAt = -99;
  streak = 0;
  lastKillAt = -99;
  /** Wisp: shimmering out of sight after a blink */
  stealthT = 0;
  /** Nimbus: seconds this rascal stays marked, and for whom */
  pingT = 0;
  pingedBy: Actor | null = null;
  private pingTick = 0;

  constructor(public name: string, look: RascalLook, public ctx: GameCtx, species: BugSpecies = SPECIES_BY_ID.zippit, bugName = randomBugName()) {
    this.motor = new CharacterMotor(ctx.cw);
    this.rig = new RascalRig(look);
    this.bug = new Blinkbug(ctx.cw, ctx.fx, this, species);
    this.bugName = bugName;
    this.team = this.id;
    ctx.scene.add(this.rig.root, this.bug.root);
  }

  /** Swap in a different Blinkbug (equipped from the collection before a match). */
  setSpecies(species: BugSpecies, name: string, level = 1) {
    this.bugName = name;
    if (this.bug.species.id !== species.id) {
      this.ctx.scene.remove(this.bug.root);
      this.bug = new Blinkbug(this.ctx.cw, this.ctx.fx, this, species);
      this.ctx.scene.add(this.bug.root);
      this.bug.root.position.copy(this.motor.pos);
    }
    this.bug.setLevel(level);
  }

  /** Rebuild the rascal with a new look (a new hat, between matches). */
  setLook(look: RascalLook) {
    const old = this.rig;
    if (old.look.hat === look.hat && old.look.hatColor === look.hatColor) return;
    this.rig = new RascalRig(look);
    this.rig.root.position.copy(old.root.position);
    this.rig.root.rotation.copy(old.root.rotation);
    this.rig.root.visible = old.root.visible;
    this.ctx.scene.remove(old.root);
    this.ctx.scene.add(this.rig.root);
    const w = this.weapon;
    this.rig.setWeapon(w ? buildWeaponView(w.def, w.rarity) : null);
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

  hasPerk(id: PerkId) {
    return this.perks.includes(id);
  }
  /** pin a perk; returns the one it pushed off (if you already had two) */
  addPerk(id: PerkId): PerkId | null {
    if (this.hasPerk(id)) return null;
    let dropped: PerkId | null = null;
    if (this.perks.length >= MAX_PERKS) dropped = this.perks.shift()!;
    this.perks.push(id);
    this.applyPerks();
    if (this.me) {
      this.me.sfx.perk();
      this.me.hud.bigToast(`${PERKS[id].name.toUpperCase()}!`, PERKS[id].css);
      this.me.hud.toast(PERKS[id].blurb, PERKS[id].css);
    }
    return dropped;
  }
  applyPerks() {
    this.motor.jumpMul = this.hasPerk('springy') ? 1.3 : 1;
  }
  /** Blinkbug nap multiplier (Bug Snacks) */
  get bugCdMul() {
    return this.hasPerk('bugsnacks') ? 0.65 : 1;
  }
  /** slow this rascal down: k = speed multiplier, for t seconds (the strongest slow wins) */
  slow(k: number, t: number) {
    if (this.slowT <= 0 || k <= this.slowK) this.slowK = k;
    this.slowT = Math.max(this.slowT, t);
  }
  private get moveMul() {
    return (this.downed ? 0.5 : this.healT >= 0 ? 0.5 : this.ads ? 0.62 : this.weapon?.reloading ? 0.85 : 1) * (this.slowT > 0 ? this.slowK : 1);
  }

  spawn(p: THREE.Vector3, yaw: number) {
    this.motor.teleport(p);
    this.bodyYaw = yaw;
    this.prevYaw = yaw;
    this.intent.aimYaw = yaw;
    this.hp = this.maxHp;
    this.alive = true;
    this.slowT = 0;
    this.perks = [];
    this.applyPerks();
    this.relics = [];
    this.bankT = 0;
    this.rig.root.visible = true;
    this.rig.root.scale.setScalar(1);
    this.rig.root.rotation.set(0, yaw, 0);
    this.koT = 0;
    this.downed = false;
    this.downHp = 0;
    this.reviveK = 0;
    this.reviving = null;
    this.bug.reset();
    this.bug.root.position.copy(p);
    this.eliminatedAt = -1;
    this.lastDamagedBy = null;
    this.out = false;
    this.bugout = null;
    this.flight = 'none';
    this.stealthT = 0;
    this.pingT = 0;
    this.rig.setGhost(1);
    this.hideGlider();
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

  /**
   * Offer a weapon to the inventory. Same gun + same rarity FUSES into the next rarity.
   * Returns what happened so loot/HUD can celebrate it.
   */
  offerWeapon(defId: string, rarity: RarityIndex, mag: number): { action: 'fused' | 'added' | 'swapped'; slot: number; dropped: WeaponInstance | null } {
    const fuseSlot = this.weapons.findIndex((w) => w && w.def.id === defId && w.rarity === rarity && rarity < 4);
    if (fuseSlot >= 0) {
      const w = this.weapons[fuseSlot]!;
      w.rarity = (rarity + 1) as RarityIndex;
      w.mag = w.def.mag;
      this.fusions++;
      this.equip(fuseSlot, true);
      return { action: 'fused', slot: fuseSlot, dropped: null };
    }
    let slot = this.weapons.findIndex((w) => !w);
    let dropped: WeaponInstance | null = null;
    let action: 'added' | 'swapped' = 'added';
    if (slot < 0) {
      slot = this.activeSlot;
      dropped = this.weapons[slot];
      action = 'swapped';
    }
    this.giveWeapon(defId, rarity, slot, true);
    this.weapons[slot]!.mag = Math.min(mag, WEAPONS[defId].mag);
    return { action, slot, dropped };
  }

  /** What would picking this up do? (for the HUD comparison card) */
  previewOffer(defId: string, rarity: RarityIndex): 'fuse' | 'add' | 'swap' {
    if (this.weapons.some((w) => w && w.def.id === defId && w.rarity === rarity && rarity < 4)) return 'fuse';
    return this.weapons.some((w) => !w) ? 'add' : 'swap';
  }

  addItem(kind: 'heal' | 'util', id: string, count: number): number {
    if (kind === 'heal') {
      const def = HEALS[id as HealId];
      if (!this.healItem || this.healItem.count === 0) this.healItem = { id: def.id, count: 0 };
      if (this.healItem.id !== def.id) return count;
      const take = Math.min(count, def.maxStack - this.healItem.count);
      this.healItem.count += take;
      return count - take;
    }
    const def = UTILS[id as UtilId];
    if (!this.util || this.util.count === 0) this.util = { id: def.id, count: 0 };
    if (this.util.id !== def.id) return count;
    const take = Math.min(count, def.maxStack - this.util.count);
    this.util.count += take;
    return count - take;
  }

  addAmmo(t: AmmoType, n: number) {
    const before = this.ammo[t];
    this.ammo[t] = Math.min(AMMO_INFO[t].max, this.ammo[t] + n);
    return this.ammo[t] - before;
  }

  equip(slot: number, silent = false) {
    if (slot < 0 || slot > 2) return;
    const cur = this.weapon;
    if (cur) {
      cur.reloadT = -1;
      cur.burstLeft = 0;
    }
    this.healT = -1;
    this.activeSlot = slot;
    const w = this.weapon;
    this.rig.setWeapon(w ? buildWeaponView(w.def, w.rarity) : null);
    if (w && !silent) this.me?.sfx.equip();
  }

  /* ----------------------------------------------------------------- damage */
  takeDamage(amount: number, from: Actor | null, headshot: boolean, dir: THREE.Vector3, ctx: GameCtx, weaponName: string): boolean {
    if (!this.alive) {
      if (this.bugout) return this.damageBug(amount, from, ctx, weaponName);
      return false;
    }
    // Launch Isle is a no-hurt zone: shoot all you like, nobody gets bonked
    if (ctx.match?.phase === 'lobby') {
      this.rig.onHit(0, 1);
      return false;
    }
    // no friendly fire between teammates
    if (from && from !== this && from.team === this.team) return false;
    if (from && !from.me && !this.me && ctx.match) amount *= ctx.match.botDamageMul;
    if (this.hasPerk('thickwool')) amount = Math.max(1, Math.round(amount * 0.88));
    if (this.downed) {
      // finishing off a knocked rascal
      this.downHp -= amount;
      this.lastDamagedBy = from;
      this.lastDamageTime = ctx.time;
      if (from) from.damageDealt += amount;
      this.rig.onHit(0, 1);
      if (this.me) {
        this.me.sfx.hurt();
        this.me.shake(0.25);
      } else audio.hurt(this.motor.pos);
      this.onDamaged(from, ctx);
      if (this.downHp <= 0) {
        this.downed = false;
        this.eliminate(from ?? this.downBy, ctx, weaponName);
        from?.onKnockedSomeone();
        return true;
      }
      return false;
    }
    if (from) from.weaponDamage[weaponName] = (from.weaponDamage[weaponName] ?? 0) + amount;
    this.hp -= amount;
    this.lastDamagedBy = from;
    this.lastDamageTime = ctx.time;
    this.lastHitDir.copy(dir);
    this.emote = null;
    if (from) from.damageDealt += amount;
    // hit reaction direction in local space
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    const lx = dir.x * c - dir.z * s;
    const lz = dir.x * s + dir.z * c;
    this.rig.onHit(lx, lz);
    if (this.me) {
      this.me.hud.damageFrom(_v.copy(dir).negate());
      this.me.shake(headshot ? 0.45 : 0.28);
      this.me.sfx.hurt();
    } else audio.hurt(this.motor.pos);
    this.onDamaged(from, ctx);
    this.alertTeam(from, ctx);
    if (this.hp <= 0) {
      this.hp = 0;
      if (ctx.match?.canGoDown(this)) this.goDown(from, ctx, weaponName);
      else this.eliminate(from, ctx, weaponName);
      from?.onKnockedSomeone();
      return true;
    }
    return false;
  }

  /** Vampire Teeth: a knock or elimination tops you up */
  onKnockedSomeone() {
    if (!this.alive || this.downed || !this.hasPerk('vampteeth')) return;
    const before = this.hp;
    this.heal(20);
    if (this.hp > before) this.me?.hud.toast(`+${Math.round(this.hp - before)} VAMPIRE TEETH`, PERKS.vampteeth.css);
  }

  /* ----------------------------------------------------------------- knocked down (squads) */
  private goDown(by: Actor | null, ctx: GameCtx, weaponName: string) {
    this.downed = true;
    this.downHp = 100;
    this.downBy = by;
    this.downWeapon = weaponName;
    this.reviveK = 0;
    this.reviving = null;
    this.emote = null;
    this.healT = -1;
    this.throwAiming = false;
    this.utilAiming = false;
    this.ads = false;
    const p = _v.copy(this.motor.pos).setY(this.motor.pos.y + 1.2);
    ctx.fx.koStars(p);
    ctx.fx.hitSplat(p, true);
    audio.koWhoosh(p);
    ctx.announce.killfeed(by ? by.name : 'THE GLOOM', this.name, weaponName, this.isLocal || !!by?.isLocal, true);
    by?.me?.hud.playerElimination(this.name, 'KNOCKED!');
    by?.me?.hitStop(0.06, 0.05);
    if (this.me) {
      this.me.hud.koFlash();
      this.me.hud.bigToast('KNOCKED! CRAWL TO COVER', '#ff8a8a');
      this.me.shake(0.4);
    } else this.say('HELP!', '#ff8a8a', 1.6, true);
    ctx.match?.onDowned(this, by);
  }

  /** back on your feet with a little health */
  revive(ctx: GameCtx, by: Actor | null) {
    this.downed = false;
    this.downHp = 0;
    this.reviveK = 0;
    this.hp = 30;
    this.downBy = null;
    const p = _v.copy(this.motor.pos).setY(this.motor.pos.y + 1);
    ctx.fx.blinkBurst(this.motor.pos, true);
    ctx.fx.healPuff(p);
    audio.fuse();
    if (by) {
      by.revives++;
      if (!by.me) by.say('UP YOU GET!', '#9dff8a', 1.4, true);
    }
    this.me?.hud.bigToast('BACK ON YOUR FEET!', '#9dff8a');
    if (!this.me && by && by !== this) this.say(['THANKS!', 'ty!!', 'phew! thx', 'owe you one'][Math.floor(Math.random() * 4)], '#9dff8a', 1.6, true);
    by?.me?.hud.toast(`You picked up ${this.name}`, '#9dff8a');
  }

  /** bleed-out, crawl limits, and being picked up */
  private updateDowned(dt: number, ctx: GameCtx) {
    const it = this.intent;
    // no fighting while down: just crawl
    it.fire = it.ads = it.jump = it.sprint = it.reload = it.blink = false;
    it.throwAim = it.throwRelease = it.utilAim = it.utilRelease = it.heal = it.drop = it.revive = false;
    it.crouch = false;
    it.slot = -1;
    this.motor.crouching = true;
    const helped = this.reviveK > 0 && ctx.time - this.reviveTouch < 0.15;
    if (!helped) {
      this.reviveK = Math.max(0, this.reviveK - dt * 0.6);
      this.downHp -= dt * (100 / 36); // ~36s to bleed out
    }
    if (Math.random() < dt * 2) ctx.fx.koStars(_v.copy(this.motor.pos).setY(this.motor.pos.y + 1.1));
    if (this.downHp <= 0) {
      this.downed = false;
      this.eliminate(this.downBy, ctx, this.downWeapon || 'BLEEDING');
    }
  }
  private reviveTouch = -99;

  /** reviver side: hold interact next to a knocked teammate */
  private updateReviving(dt: number, ctx: GameCtx) {
    const it = this.intent;
    const t = this.reviving;
    if (!it.revive || !t || !t.downed || !t.alive || t.team !== this.team || t.motor.pos.distanceTo(this.motor.pos) > 2.4) {
      this.reviving = null;
      return;
    }
    // you have to stand still and put the gun down to help
    it.moveX = it.moveZ = 0;
    it.fire = it.ads = it.sprint = false;
    t.reviveK += dt / REVIVE_TIME;
    t.reviveTouch = ctx.time;
    if (Math.random() < dt * 10) ctx.fx.healPuff(_v.copy(t.motor.pos).setY(t.motor.pos.y + 0.6));
    if (t.reviveK >= 1) {
      t.revive(ctx, this);
      this.reviving = null;
    }
  }

  /** Pop a speech bubble ("!", "HA!") — rate-limited unless forced. */
  say(text: string, color = '#2b2238', dur = 1.4, force = false) {
    const now = this.ctx.time;
    if (!force && now < this.sayCd) return;
    this.speech = { text, color, t: now, dur };
    this.sayCd = now + dur + 1.2;
  }

  startEmote(kind: EmoteKind, dur = 2.6) {
    if (!this.alive || this.flight !== 'none') return;
    this.emote = kind;
    this.emoteT = dur;
    this.intent.fire = false;
  }

  /** remove from the scene for good (lobby shrinking back to the playground crew) */
  dispose(ctx: GameCtx) {
    ctx.scene.remove(this.rig.root, this.bug.root);
    if (this.relicMark) ctx.scene.remove(this.relicMark);
    this.alive = false;
    this.parked = true;
  }

  /** hook for controllers (bots react to being shot) */
  onDamaged(_from: Actor | null, _ctx: GameCtx) {}

  /** squads: shout to the team about who is shooting us */
  private alertTeam(from: Actor | null, ctx: GameCtx) {
    if (!from || from.team === this.team || !ctx.match || ctx.match.teamSize <= 1) return;
    for (const o of ctx.actors) if (o !== this && o.team === this.team && o.alive && !o.downed) o.controller?.teamAlert?.(o, from, this, ctx);
  }

  eliminate(by: Actor | null, ctx: GameCtx, weaponName: string) {
    this.alive = false;
    this.downed = false;
    this.reviving = null;
    this.eliminatedAt = ctx.time;
    let callout = '';
    if (by && by !== this) {
      by.kills++;
      by.streak = ctx.time - by.lastKillAt < 12 ? by.streak + 1 : 1;
      by.lastKillAt = ctx.time;
      const dist = by.motor.pos.distanceTo(this.motor.pos);
      if (by.streak >= 5) callout = 'UNSTOPPABLE!';
      else if (by.streak === 4) callout = 'RAMPAGE!';
      else if (by.streak === 3) callout = 'TRIPLE TROUBLE!';
      else if (by.streak === 2) callout = 'DOUBLE BONK!';
      else if (ctx.time - by.lastBlinkAt < 1.6) callout = 'BLINK BONK!';
      else if (dist > 45) callout = `LONG SHOT! ${Math.round(dist)}m`;
      else if (by.kills === 5) callout = 'FIVE BONKS!';
      else if (by.kills === 3) callout = 'ON A ROLL!';
      else if (this.hp <= 0 && by.hp < 20) callout = 'CLUTCH!';
      // a big streak gets a beat of slow motion to savour it
      if (by.streak >= 3) by.me?.slowMo(0.35, 0.5);
      if (!by.me) {
        // bots gloat a little
        by.say(['HA!', 'GG', 'YES!', 'BONK!', 'EZ'][Math.floor(Math.random() * 5)], '#f2c14e', 1.5, true);
      }
    }
    const p = _v.copy(this.motor.pos).setY(this.motor.pos.y + 0.9);
    by?.me?.shake(0.5);
    if (by !== this) this.me?.shake(0.5);
    by?.me?.hitStop(0.09, 0.03);
    if (this.me && weaponName !== 'THE SKY') {
      this.me.slowMo(0.3, 1.1);
      this.me.sfx.koSting();
      this.me.hud.koFlash();
    }
    if (weaponName === 'THE SKY' || !this.rig.root.visible) this.koPoof(ctx, !!by?.isLocal);
    else {
      // cartoon KO: launched spinning away from the hit, stars round the head, then POOF
      this.koT = 0.62;
      this.koPos.copy(this.motor.pos);
      this.koFloor = this.motor.pos.y;
      _v2.copy(this.lastHitDir).setY(0);
      if (_v2.lengthSq() < 1e-4) _v2.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _v2.normalize();
      this.koVel.set(_v2.x * 4.5, 7.5, _v2.z * 4.5);
      this.koSpin.set(_v2.z * 12, (Math.random() - 0.5) * 10, -_v2.x * 12);
      this.koStarT = 0;
      ctx.fx.hitSplat(p, true);
      ctx.fx.ring(p, 0xffffff, 0.2, 2.2, 0.25, undefined, true);
      audio.koWhoosh(p);
      this.koKiller = !!by?.isLocal;
    }
    ctx.loot.dropInventory(this);
    this.healT = -1;
    this.rig.setHeld(null);
    this.hideGlider();
    this.flight = 'none';
    ctx.announce.killfeed(by ? by.name : 'THE GLOOM', this.name, weaponName, this.isLocal || !!by?.isLocal);
    by?.me?.hud.playerElimination(this.name, callout);
    // second chance: the Blinkbug carries your spark to a Rift Nest
    if (ctx.match && weaponName !== 'THE SKY' && ctx.match.allowBugout(this)) {
      this.startBugout(p, ctx);
      return;
    }
    this.bug.vanish();
    this.goOut(by, ctx, weaponName);
  }

  private koKiller = false;
  private koQuiet = false;

  /* ----------------------------------------------------------------- LAN client puppets */

  /** client: the host says this rascal was knocked out — play the tumble (its FX arrive from the host) */
  netKO(dirX: number, dirZ: number) {
    this.koT = 0.62;
    this.koQuiet = true;
    this.koPos.copy(this.motor.pos);
    this.koFloor = this.motor.pos.y;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.koVel.set((dirX / l) * 4.5, 7.5, (dirZ / l) * 4.5);
    this.koSpin.set((dirZ / l) * 12, (Math.random() - 0.5) * 10, (-dirX / l) * 12);
  }

  /** client: run the KO tumble only */
  netTick(dt: number, ctx: GameCtx) {
    if (this.koT > 0) this.updateKO(dt, ctx);
  }

  /**
   * client: move your own rascal from local input straight away (the host still decides where
   * you really are; `netApply` nudges you back toward it).
   */
  predict(dt: number, ctx: GameCtx) {
    const it = this.intent;
    const m = this.motor;
    if (this.flight !== 'none' || !this.alive || this.bugout || this.koT > 0) return false;
    if (this.downed) {
      it.jump = it.sprint = false;
      it.crouch = false;
      m.crouching = true;
    }
    const moveLen = Math.hypot(it.moveX, it.moveZ);
    const combatFacing = this.armed || it.fire || this.ads || it.throwAim || it.utilAim;
    let targetYaw = this.bodyYaw;
    if (combatFacing) targetYaw = it.aimYaw;
    else if (moveLen > 0.1) targetYaw = yawFromDir(it.moveX, it.moveZ);
    if (m.sliding && m.horizontalSpeed() > 0.5) targetYaw = yawFromDir(m.vel.x, m.vel.z);
    this.bodyYaw = dampAngle(this.bodyYaw, targetYaw, combatFacing ? 22 : 12, dt);
    this.turnRate = damp(this.turnRate, angleDelta(this.prevYaw, this.bodyYaw) / Math.max(dt, 1e-4), 10, dt);
    this.prevYaw = this.bodyYaw;
    if (it.fire && this.armed) this.sprintBlock = 0.35;
    this.sprintBlock -= dt;
    m.update(dt, {
      wishX: it.moveX,
      wishZ: it.moveZ,
      sprint: it.sprint && !this.ads && this.sprintBlock <= 0 && !it.throwAim,
      jump: it.jump,
      crouch: it.crouch,
      speedMul: this.moveMul,
    });
    if (m.events.jumped) this.rig.onJump();
    if (m.events.landed > 3) {
      this.rig.onLand(m.events.landed);
      this.onLanded?.(m.events.landed);
    }
    return true;
  }

  private netWeaponKey = '';
  /** client: pose from the host's state (predicted = your own rascal while it's moving under your control) */
  netApply(s: NetActorState, dt: number, time: number, predicted: boolean) {
    const m = this.motor;
    const f = s.f;
    const wasAlive = this.alive;
    this.alive = !!(f & 1);
    this.downed = !!(f & 2);
    const bug = !!(f & 4);
    this.out = !!(f & 2048);
    // other rascals' relics: we only need how many (for the gem over their head)
    if (!this.isLocal) {
      const n = s.rc ?? 0;
      if (n !== this.relics.length) this.relics = new Array(n).fill('shard');
    }
    this.hp = s.hp;
    this.downHp = s.dh;
    this.reviveK = s.rk;
    const flights = ['none', 'barge', 'dive', 'glide'] as const;
    this.flight = flights[(f >> 13) & 3];
    if (!predicted) {
      m.pos.set(s.x, s.y, s.z);
      m.vel.set(s.vx, s.vy, s.vz);
      this.bodyYaw = s.yaw;
      m.crouching = !!(f & 8);
      m.sliding = !!(f & 16);
      m.sprinting = !!(f & 32);
      m.grounded = !!(f & 64);
      this.turnRate = damp(this.turnRate, angleDelta(this.prevYaw, this.bodyYaw) / Math.max(dt, 1e-4), 10, dt);
      this.prevYaw = this.bodyYaw;
    } else {
      // gently pull the prediction toward the truth; snap if we've really diverged
      const err = Math.hypot(s.x - m.pos.x, s.y - m.pos.y, s.z - m.pos.z);
      if (err > 3.5) m.teleport(new THREE.Vector3(s.x, s.y, s.z));
      else if (err > 0.25) {
        const k = Math.min(1, dt * (err > 1.2 ? 8 : 3));
        m.pos.x += (s.x - m.pos.x) * k;
        m.pos.y += (s.y - m.pos.y) * k * 0.5;
        m.pos.z += (s.z - m.pos.z) * k;
      }
    }
    this.intent.aimPitch = s.pitch;
    this.ads = !!(f & 128);
    this.healT = f & 512 ? Math.max(0, this.healT) : -1;
    this.emote = (s.em || null) as EmoteKind | null;
    this.stealthT = f & 1024 ? 1 : 0;
    this.rig.setGhost(f & 1024 ? (this.isLocal ? 0.45 : 0.15) : 1);
    // held weapon
    if (s.w !== this.netWeaponKey) {
      this.netWeaponKey = s.w;
      if (!this.isLocal) {
        const [id, r] = s.w.split(':');
        this.weapons = [id && WEAPONS[id] ? new WeaponInstance(WEAPONS[id], Number(r) as RarityIndex) : null, null, null];
        this.activeSlot = 0;
        const w = this.weapons[0];
        this.rig.setWeapon(w ? buildWeaponView(w.def, w.rarity) : null);
      }
    }
    // glider
    if (this.flight === 'glide') {
      if (!this.glider) this.glider = buildGlider(this.rig.look.scarf, this.rig.look.accent);
      if (!this.glider.parent) this.rig.root.add(this.glider);
      this.glider.visible = true;
      this.glider.scale.setScalar(1);
    } else this.hideGlider();
    // body visibility: gone while a bug, after the KO poof, or out
    if (this.koT <= 0) this.rig.root.visible = !!(f & 4096) && !bug && this.alive;
    if (wasAlive && !this.alive && !bug && this.koT <= 0) this.rig.root.visible = false;
    // the Blinkbug
    const states = ['docked', 'flying', 'landed', 'returning', 'piloted'] as const;
    this.bugout = bug ? { t: s.bt ?? 0, hp: s.bh ?? 30, vel: new THREE.Vector3(), grace: 0 } : null;
    this.bug.netApply(states[s.bs] ?? 'docked', s.bx, s.by, s.bz, dt, this.alive || bug);
    if (bug) m.pos.set(s.bx, s.by - 0.9, s.bz);
    if (this.alive && this.koT <= 0) this.syncRig(dt, time);
  }

  private updateKO(dt: number, ctx: GameCtx) {
    this.koT -= dt;
    const r = this.rig.root;
    this.koVel.y -= 22 * dt;
    this.koPos.addScaledVector(this.koVel, dt);
    if (this.koPos.y < this.koFloor && this.koVel.y < 0) {
      this.koPos.y = this.koFloor;
      this.koVel.y *= -0.45;
      this.koVel.x *= 0.6;
      this.koVel.z *= 0.6;
    }
    r.position.copy(this.koPos);
    r.rotation.x += this.koSpin.x * dt;
    r.rotation.y += this.koSpin.y * dt;
    r.rotation.z += this.koSpin.z * dt;
    // squash-and-stretch wobble, then a quick inflate right before the pop
    const k = this.koT;
    const sc = k < 0.12 ? 1 + (0.12 - k) * 3 : 1 + Math.sin(k * 30) * 0.06;
    r.scale.set(sc, sc * (k < 0.12 ? 0.9 : 1), sc);
    this.koStarT -= dt;
    if (this.koStarT <= 0 && !this.koQuiet) {
      this.koStarT = 0.09;
      ctx.fx.koStars(_v.copy(this.koPos).setY(this.koPos.y + 1.4));
    }
    if (this.koT <= 0) {
      this.koT = 0;
      this.motor.pos.x = this.koPos.x;
      this.motor.pos.z = this.koPos.z;
      if (this.koQuiet) this.rig.root.visible = false;
      else this.koPoof(ctx, this.koKiller);
      this.koQuiet = false;
      r.rotation.set(0, this.bodyYaw, 0);
      r.scale.setScalar(1);
    }
  }

  private koPoof(ctx: GameCtx, localKill: boolean) {
    const src = this.koT > 0 || this.koPos.lengthSq() === 0 ? this.motor.pos : this.rig.root.position;
    const p = _v.copy(src).setY(src.y + 0.9);
    const L = this.rig.look;
    ctx.fx.elimination(p, [L.outfit, L.accent, L.scarf, L.pack]);
    audio.elimination(p, localKill);
    // backpack & hat pop off
    ctx.fx.chunk(_v2.copy(p).setY(p.y + 0.3), new THREE.Vector3((Math.random() - 0.5) * 3, 8, (Math.random() - 0.5) * 3), L.pack, 0.4, 2.4);
    ctx.fx.chunk(_v2.copy(p).setY(p.y + 0.8), new THREE.Vector3((Math.random() - 0.5) * 3, 10, (Math.random() - 0.5) * 3), L.hatColor, 0.3, 2.4);
    this.rig.root.visible = false;
  }

  /** where this rascal's spark gave out (the bug if it was flying, else the body) */
  outPos = new THREE.Vector3();

  private goOut(by: Actor | null, ctx: GameCtx, weaponName: string) {
    this.outPos.copy(this.bugout ? this.bug.pos : this.motor.pos);
    this.out = true;
    this.bugout = null;
    if (ctx.match) ctx.match.onOut(this, by, weaponName);
    else this.me?.hud.playerEliminated(by ? by.name : 'the island');
  }

  /* ----------------------------------------------------------------- bug-revive */
  private startBugout(from: THREE.Vector3, ctx: GameCtx) {
    this.reviveUsed = true;
    // a short invulnerable burst so the bug gets a fair head start
    this.bugout = { t: 22, hp: 30, vel: new THREE.Vector3(0, 7, 0), grace: 2.4 };
    this.bug.startPilot(from);
    ctx.fx.blinkBurst(from, false);
    audio.chirp(from, 0.7, 0.6);
    if (this.me) {
      this.me.hud.bigToast('BUGOUT! FLY TO A RIFT NEST', '#6ff7ff');
      this.me.sfx.blink(from, true);
    }
  }

  private damageBug(amount: number, from: Actor | null, ctx: GameCtx, weaponName: string): boolean {
    const b = this.bugout!;
    if (b.grace > 0) {
      // bullets fizzle off the shimmering spark
      ctx.fx.ring(this.bug.pos.clone(), 0x9ffcff, 0.1, 0.6, 0.2, undefined, true);
      audio.chirp(this.bug.pos, 2.2, 0.2);
      return false;
    }
    b.hp -= amount;
    ctx.fx.sparkBurst(this.bug.pos, PAL.blink, 10);
    audio.chirp(this.bug.pos, 1.8, 0.5);
    if (b.hp > 0) return false;
    // swatted!
    ctx.fx.elimination(this.bug.pos.clone(), [PAL.blink, 0xffffff]);
    this.bug.vanish();
    ctx.announce.killfeed(from ? from.name : 'THE GLOOM', `${this.name}'s Blinkbug`, weaponName, this.isLocal || !!from?.isLocal);
    this.goOut(from, ctx, weaponName);
    return true;
  }

  private updateBugout(dt: number, ctx: GameCtx) {
    const b = this.bugout!;
    b.t -= dt;
    if (b.grace > 0) {
      b.grace -= dt;
      if (Math.random() < dt * 30) ctx.fx.glow.emit(this.bug.pos, { count: 1, color: [0xffffff, 0x9ffcff], speed: [0.5, 2], spread: 1, life: 0.35, size: 0.12, shape: PShape.Sparkle });
    }
    this.controller?.update(this, ctx, dt);
    const it = this.intent;
    const bug = this.bug;
    const wl = Math.min(1, Math.hypot(it.moveX, it.moveZ));
    const speed = 9.5;
    b.vel.x += (it.moveX * speed - b.vel.x) * Math.min(1, dt * 5);
    b.vel.z += (it.moveZ * speed - b.vel.z) * Math.min(1, dt * 5);
    // hover ~1.8m above whatever is below; jump gives a little hop
    const down = this.ctx.cw.raycast(_v.copy(bug.pos), _v2.set(0, -1, 0), 30, ColFlags.BlocksMove);
    const groundY = down ? down.point.y : bug.pos.y - 30;
    const targetY = groundY + 1.8 + (it.sprint ? 1.5 : 0);
    b.vel.y += ((targetY - bug.pos.y) * 4 - b.vel.y) * Math.min(1, dt * 4);
    if (it.jump) b.vel.y += 6;
    bug.pos.addScaledVector(b.vel, dt);
    ctx.cw.resolveSphere(bug.pos, 0.2, ColFlags.BlocksBug);
    if (wl > 0.1) this.bodyYaw = yawFromDir(b.vel.x, b.vel.z);
    // keep the motor under the bug so cameras & bot aim follow it
    this.motor.pos.set(bug.pos.x, bug.pos.y - 0.9, bug.pos.z);
    if (Math.random() < dt * 25) ctx.fx.bugTrail(bug.pos);
    if (this.isLocal && b.t < 5 && Math.random() < dt * 10) ctx.fx.sparkBurst(bug.pos, 0xff9a9a, 2);
    // reached a Rift Nest?
    for (const n of ctx.world.nests) {
      if (n.used) continue;
      if (Math.hypot(n.pos.x - bug.pos.x, n.pos.z - bug.pos.z) < 2.4 && Math.abs(n.pos.y + 1 - bug.pos.y) < 3) {
        this.rebuildAt(n, ctx);
        return;
      }
    }
    // out in the Gloom, the spark fades faster
    if (ctx.match?.gloomOutside(bug.pos)) b.t -= dt * 2;
    if (b.t <= 0 || bug.pos.y < -20) {
      ctx.fx.sparkBurst(bug.pos, 0x9f7bff, 20);
      audio.pop(bug.pos);
      this.bug.vanish();
      ctx.announce.killfeed('THE GLOOM', `${this.name}'s spark`, 'TIME', this.isLocal);
      this.goOut(null, ctx, 'TIME');
    }
    bug.update(dt);
  }

  /** rebuilt at a Rift Nest: by your own Blinkbug, or by a teammate carrying your spark */
  rebuildAt(n: { pos: THREE.Vector3; used: boolean; fx: THREE.Object3D }, ctx: GameCtx) {
    n.used = true;
    n.fx.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (!m || !m.color) return;
      if (o.userData.baseColor === undefined) o.userData.baseColor = m.color.getHex();
      m.color.setHex(0x6b6478);
    });
    this.bugout = null;
    this.alive = true;
    this.out = false;
    this.placement = 0;
    const p = n.pos.clone().setY(n.pos.y + 0.1);
    this.spawn(p, this.bodyYaw);
    this.hp = 40;
    this.weapons = [null, null, null];
    this.giveWeapon('poppistol', 0, 0, true);
    this.ammo.light = Math.max(this.ammo.light, 24);
    this.bug.cooldown = 8;
    this.bug.cooldownMax = 8;
    ctx.fx.blinkBurst(p, true);
    ctx.fx.ring(p.clone().setY(p.y + 0.2), 0x9ffcff, 0.3, 5, 0.6);
    audio.blink(p, this.isLocal);
    audio.fuse();
    ctx.announce.killfeed(this.name, 'a Rift Nest', 'REBUILT', this.isLocal);
    if (this.me) {
      this.me.hud.bigToast('BACK IN THE FIGHT!', '#9ffcff');
      this.me.shake(0.3);
    }
    ctx.match?.onRevive(this);
  }

  /* ----------------------------------------------------------------- drop / glide */
  private updateFlight(dt: number, ctx: GameCtx) {
    const it = this.intent;
    const m = this.motor;
    const match = ctx.match;
    if (this.flight === 'barge') {
      if (!match) {
        this.flight = 'none';
        return;
      }
      match.barge.riderWorld(this.bargeSpot, m.pos);
      m.vel.copy(match.barge.vel);
      this.bodyYaw = dampAngle(this.bodyYaw, this.isLocal ? it.aimYaw : match.barge.yaw + Math.PI / 2, 6, dt);
      if (it.jump && match.canDrop) this.startDive(ctx);
      return;
    }
    const diving = this.flight === 'dive';
    const maxH = diving ? 20 : 12.5;
    const acc = diving ? 22 : 12;
    const tx = it.moveX * maxH, tz = it.moveZ * maxH;
    const dx = tx - m.vel.x, dz = tz - m.vel.z;
    const dl = Math.hypot(dx, dz), st = acc * dt;
    if (dl <= st) {
      m.vel.x = tx;
      m.vel.z = tz;
    } else {
      m.vel.x += (dx / dl) * st;
      m.vel.z += (dz / dl) * st;
    }
    if (diving) m.vel.y = Math.max(-34, m.vel.y - 26 * dt);
    else m.vel.y += (-4.8 - m.vel.y) * Math.min(1, dt * 3);
    // off the edge of the island? a friendly updraft carries you back over it
    const hd = Math.hypot(m.pos.x, m.pos.z);
    const cliff = islandRadius(Math.atan2(m.pos.z, m.pos.x));
    const edge = cliff - 4;
    if (hd > edge && hd > 1) {
      const ix = -m.pos.x / hd, iz = -m.pos.z / hd;
      let inward = m.vel.x * ix + m.vel.z * iz;
      if (hd > cliff && inward < 0) {
        // past the cliff: no drifting further out, whatever the stick says
        m.vel.x -= ix * inward;
        m.vel.z -= iz * inward;
        inward = 0;
      }
      const want = Math.min(16, 6 + (hd - edge) * 0.8);
      if (inward < want) {
        m.vel.x += ix * (want - inward) * Math.min(1, dt * 4);
        m.vel.z += iz * (want - inward) * Math.min(1, dt * 4);
      }
      // hold altitude until clear of the cliff wall
      if (hd > cliff + 0.5 && m.pos.y < 36) m.vel.y = Math.max(m.vel.y, m.pos.y < 30 ? 3 : 0);
      if (Math.random() < dt * 20) ctx.fx.soft.emit(_v.copy(m.pos).setY(m.pos.y + Math.random() * 2), { count: 1, color: 0xffffff, speed: [4, 8], dir: _v2.set(ix, 0.2, iz), spread: 0.3, life: 0.5, size: 0.2, sizeEnd: 0.6, alpha: 0.5 });
      if (this.me && !this.windToastShown) {
        this.windToastShown = true;
        this.me.hud.toast('Whoosh! The wind blows you back to the island', '#9fe8ff');
      }
    }
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (hs > 1) this.bodyYaw = dampAngle(this.bodyYaw, yawFromDir(m.vel.x, m.vel.z), 5, dt);
    else this.bodyYaw = dampAngle(this.bodyYaw, it.aimYaw, 5, dt);
    // auto-deploy the glider near the ground
    if (diving) {
      const hit = ctx.cw.raycast(_v.copy(m.pos).setY(m.pos.y + 0.5), _v2.set(0, -1, 0), 60, ColFlags.BlocksMove);
      if ((hit && hit.t < 24) || m.pos.y < 20) this.deployGlider(ctx);
      if (Math.random() < dt * 30) ctx.fx.soft.emit(_v.copy(m.pos).setY(m.pos.y + 1.6), { count: 1, color: 0xffffff, speed: 2, dir: _v2.set(0, 1, 0), spread: 0.4, life: 0.4, size: 0.12, sizeEnd: 0.3, alpha: 0.5 });
    }
    if (this.glider) {
      this.gliderK = Math.min(1, this.gliderK + dt * 4);
      const k = this.gliderK;
      const s = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1;
      this.glider.scale.set(s * k, k, s * k);
      this.glider.rotation.z = Math.sin(ctx.time * 3) * 0.06 - (it.moveX * Math.cos(this.bodyYaw) - it.moveZ * Math.sin(this.bodyYaw)) * 0.15;
    }
    if (m.flyStep(dt)) this.land(ctx);
    else if (this.flight === 'glide') {
      // resting on something too steep to count as ground (a boulder, a roof edge): just land
      const moved = Math.hypot(m.pos.x - this.flyPrev.x, m.pos.y - this.flyPrev.y, m.pos.z - this.flyPrev.z);
      this.flyStuckT = moved < dt * 0.8 ? this.flyStuckT + dt : 0;
      if (this.flyStuckT > 0.4) {
        this.flyStuckT = 0;
        this.land(ctx);
      }
    }
    this.flyPrev.copy(m.pos);
    if (m.pos.y < -25) this.eliminate(null, ctx, 'THE SKY');
  }

  private windToastShown = false;
  private flyStuckT = 0;
  private flyPrev = new THREE.Vector3();

  startDive(ctx: GameCtx) {
    if (this.flight !== 'barge') return;
    this.windToastShown = false;
    this.flight = 'dive';
    this.motor.vel.set(this.motor.vel.x * 0.35, 2, this.motor.vel.z * 0.35);
    this.motor.grounded = false;
    this.rig.onJump();
    audio.throwWhoosh(this.motor.pos);
    if (this.me) {
      this.me.sfx.jump(this.motor.pos);
      this.me.shake(0.15);
    }
    ctx.fx.dust(this.motor.pos, 4, 0xffffff);
  }

  private deployGlider(ctx: GameCtx) {
    this.flight = 'glide';
    this.gliderK = 0;
    if (!this.glider) this.glider = buildGlider(this.rig.look.scarf, this.rig.look.accent);
    this.rig.root.add(this.glider);
    this.glider.visible = true;
    this.motor.vel.y = Math.max(this.motor.vel.y, -12);
    audio.slide(this.motor.pos);
    audio.pop(this.motor.pos);
    ctx.fx.glow.emit(_v.copy(this.motor.pos).setY(this.motor.pos.y + 2.6), { count: 12, color: [0xffffff, this.rig.look.scarf], speed: [2, 5], spread: 1, life: 0.4, size: 0.14, shape: PShape.Star, drag: 3 });
    this.me?.shake(0.2);
  }

  private hideGlider() {
    if (this.glider) this.glider.visible = false;
  }

  private land(ctx: GameCtx) {
    this.flight = 'none';
    this.hideGlider();
    const m = this.motor;
    const impact = Math.max(4, -m.vel.y);
    m.vel.set(m.vel.x * 0.5, 0, m.vel.z * 0.5);
    this.rig.onLand(impact + 6);
    ctx.fx.landBurst(m.pos, 12, m.surface);
    audio.land(m.pos, 12, m.surface);
    if (this.isLocal) this.onLanded?.(12);
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
    if (this.koT > 0) this.updateKO(dt, ctx);
    if (this.bugout) {
      this.updateBugout(dt, ctx);
      return;
    }
    if (!this.alive) return;
    this.controller?.update(this, ctx, dt);
    const it = this.intent;
    if (this.downed) this.updateDowned(dt, ctx);
    else if (this.reviving) this.updateReviving(dt, ctx);
    if (!this.alive) return;
    const m = this.motor;
    if (this.emote) {
      this.emoteT -= dt;
      if (this.emoteT <= 0 || it.fire || it.ads || Math.hypot(it.moveX, it.moveZ) > 0.2 || it.jump || this.healT >= 0) this.emote = null;
    }
    if (this.flight !== 'none') {
      this.updateFlight(dt, ctx);
      this.bug.update(dt);
      this.syncRig(dt, ctx.time);
      return;
    }
    const px = m.pos.x, pz = m.pos.z;

    // --- weapon slot switching
    if (it.slot >= 0 && it.slot !== this.activeSlot) this.equip(it.slot);

    // --- ADS
    this.ads = it.ads && this.armed && !m.sliding && !this.weapon!.reloading;

    // --- facing: armed/aiming rascals face the aim; unarmed ones face movement
    const moveLen = Math.hypot(it.moveX, it.moveZ);
    const combatFacing = this.armed || it.fire || this.ads || this.throwAiming || this.utilAiming;
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
      speedMul: this.moveMul,
    };
    const wasSliding = m.sliding;
    m.update(dt, mi);
    const ev = m.events;
    this.distance += Math.hypot(m.pos.x - px, m.pos.z - pz);
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
        audio.footstep(m.pos, m.surface, loud * (this.isLocal ? 0.7 : this.hasPerk('quietpaws') ? 0.3 : 1));
        ctx.emitSound({ pos: m.pos.clone(), loudness: (m.crouching ? 5 : m.sprinting ? 22 : 14) * (this.hasPerk('quietpaws') ? 0.35 : 1), source: this, kind: 'footstep' });
        if (m.sprinting || m.surface === 'water') {
          const col = m.surface === 'grass' ? 0xd9e8b0 : m.surface === 'water' ? 0xffffff : 0xe8dcc0;
          ctx.fx.dust(m.pos, m.surface === 'water' ? 3 : 1.5, col);
        }
      }
    }

    // --- items (healing / utilities / drop)
    this.updateItems(dt, ctx, it);

    // --- weapon handling
    this.updateWeapon(dt, ctx, it);

    // --- blinkbug
    this.updateBug(dt, ctx, it);

    // --- fell off the world
    if (m.pos.y < -25 && this.alive) this.eliminate(null, ctx, 'THE SKY');
    // safety net: never stranded outside the island (Launch Isle, far out, is its own place)
    const hd = Math.hypot(m.pos.x, m.pos.z);
    if (m.grounded && hd > 1 && hd < 110) {
      const ang = Math.atan2(m.pos.z, m.pos.x);
      const R = islandRadius(ang);
      if (hd > R + 1.5) {
        const p = new THREE.Vector3(Math.cos(ang) * (R - 3), 0, Math.sin(ang) * (R - 3));
        p.y = groundHeight(p.x, p.z) + 2;
        ctx.fx.blinkBurst(m.pos, false);
        m.teleport(p);
        ctx.fx.blinkBurst(p, true);
        this.me?.hud.toast('Back onto the island you go!', '#9fe8ff');
      }
    }

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
      w.reloadT += dt * (this.hasPerk('quickhands') ? 1 / 0.7 : 1);
      const k = w.reloadT / w.reloadTime;
      if (this.me) {
        if (prev < 0.3 && k >= 0.3) this.me.sfx.reload(1);
        if (prev < 0.75 && k >= 0.75) this.me.sfx.reload(2);
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
      this.me?.sfx.reload(0);
      this.fireHeld = it.fire;
      return;
    }
    if (this.motor.mantleT >= 0) return;
    const view = this.rig.weapon;
    if (view?.loaded) view.loaded.visible = w.mag > 0;
    if (view?.spinner) view.spinner.rotation.z = damp(view.spinner.rotation.z, (view.spinner.userData.target as number) ?? 0, 18, dt);

    let trigger = it.fire && (w.def.mode === 'auto' || !this.fireHeld);
    if (w.def.mode === 'burst') {
      if (trigger && w.cooldown <= 0 && w.burstLeft <= 0) w.burstLeft = w.def.burst!;
      trigger = w.burstLeft > 0;
    }
    if (trigger && w.cooldown <= 0) {
      if (w.mag <= 0) {
        w.burstLeft = 0;
        if (!this.fireHeld) this.me?.sfx.dryFire();
      } else {
        this.healT = -1;
        w.mag--;
        if (w.def.mode === 'burst') {
          w.burstLeft--;
          w.cooldown = w.burstLeft > 0 ? 60 / w.def.burstRpm! : 60 / w.def.rpm;
        } else w.cooldown = 60 / w.def.rpm;
        this.sprintBlock = 0.4;
        fireWeapon(this, ctx);
        const f = view?.flash;
        if (f) {
          f.visible = true;
          f.rotation.z = Math.random() * 6;
          f.scale.multiplyScalar(0).addScalar((f.userData.base ?? (f.userData.base = 1)) * (0.8 + Math.random() * 0.5));
          setTimeout(() => (f.visible = false), 45);
        }
        if (view?.spinner) view.spinner.userData.target = ((view.spinner.userData.target as number) ?? 0) + Math.PI / 3;
        if (w.mag === 0 && this.ammo[w.def.ammo] > 0 && w.def.mag <= 1) w.reloadT = 0; // single-shot guns auto-reload
      }
    }
    this.fireHeld = it.fire;
  }

  private updateItems(dt: number, ctx: GameCtx, it: Intent) {
    const m = this.motor;
    // speed boost from biscuits
    this.boostT = Math.max(0, this.boostT - dt);
    if (this.slowT > 0) {
      this.slowT = Math.max(0, this.slowT - dt);
      // dripping gloop
      if (Math.random() < dt * 10) ctx.fx.soft.emit(_v.copy(m.pos).setY(m.pos.y + 0.3 + Math.random() * 1.2), { count: 1, color: [0x9dff6b, 0x6fd64a], speed: 0.3, gravity: 6, life: 0.6, size: 0.1, sizeEnd: 0.5, alpha: 0.8 });
    }
    m.speedBoost = this.boostT > 0 ? 1.2 : 1;
    if (this.boostT > 0 && m.horizontalSpeed() > 3 && Math.random() < dt * 20) ctx.fx.glow.emit(_v.copy(m.pos).setY(m.pos.y + 0.3), { count: 1, color: [0xffd36b, 0xffffff], speed: 0.5, life: 0.4, size: 0.12, shape: PShape.Star });

    // healing: channelled, slows you, cancelled by shooting / throwing
    const hs = this.healItem;
    if (it.heal && this.healT < 0 && hs && hs.count > 0) {
      if (this.hp >= this.maxHp) {
        this.me?.hud.toast('Already full!', '#9dff8a');
      } else {
        this.healT = 0;
        const w = this.weapon;
        if (w) w.reloadT = -1;
        this.rig.setHeld(buildItemModel(hs.id, false));
      }
    }
    if (this.healT >= 0) {
      if (!hs || hs.count <= 0 || it.fire || it.utilRelease || it.throwRelease) {
        this.healT = -1;
        this.rig.setHeld(null);
      } else {
        const def = HEALS[hs.id];
        const prev = this.healT;
        this.healT += dt;
        const kind = hs.id === 'fizzle' ? 'drink' : 'eat';
        if (Math.floor(prev / 0.45) !== Math.floor(this.healT / 0.45)) this.me?.sfx.healUse(kind, false);
        if (Math.random() < dt * 14) ctx.fx.healPuff(_v.copy(m.pos).setY(m.pos.y + 1.2));
        if (this.healT >= def.useTime) {
          this.heal(def.amount);
          hs.count--;
          if (def.boost) this.boostT = def.boost;
          this.healT = -1;
          this.rig.setHeld(null);
          this.rig.setExpression('happy', 0.8);
          ctx.fx.glow.emit(_v.copy(m.pos).setY(m.pos.y + 1), { count: 24, color: [0x9dff8a, 0xffffff, 0xff9ad5], speed: [1, 4], spread: 1, up: 2, life: [0.4, 0.8], size: [0.12, 0.22], shape: PShape.Star, drag: 2 });
          ctx.fx.ring(_v.copy(m.pos).setY(m.pos.y + 0.05), 0x9dff8a, 0.2, 2.2, 0.4);
          if (this.me) {
            this.me.sfx.healUse(kind, true);
            this.me.hud.toast(`+${def.amount} ${def.boost ? '& ZOOMIES!' : 'HEALTH'}`, '#9dff8a');
          }
          if (hs.count <= 0) this.healItem = null;
        }
      }
    }

    // utilities: hold to aim (arc preview), release to throw
    const u = this.util;
    this.utilAiming = !!(it.utilAim && u && u.count > 0);
    if (it.utilRelease && u && u.count > 0) {
      const def = UTILS[u.id];
      const from = this.eyePos(_v2).setY(m.pos.y + 1.2).clone();
      const vel = throwVelocity(def, it.aimDir, _v3);
      vel.x += m.vel.x * 0.5;
      vel.z += m.vel.z * 0.5;
      ctx.throwables.throw(this, u.id, from, vel);
      this.rig.onThrow();
      this.healT = -1;
      u.count--;
      if (u.count <= 0) this.util = null;
    }

    // drop the held weapon
    if (it.drop && this.weapon) {
      const w = this.weapon;
      const p = ctx.loot.spawn('weapon', w.def.id, w.rarity, 1, _v.copy(m.pos).setY(m.pos.y + 1), new THREE.Vector3(-Math.sin(this.bodyYaw) * 3, 4, -Math.cos(this.bodyYaw) * 3), w.mag);
      p.lockUntil = performance.now() + 900;
      this.weapons[this.activeSlot] = null;
      this.equip(this.activeSlot, true);
      this.me?.hud.toast(`Dropped ${w.def.name}`, RARITY[w.rarity].css);
    }
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
      const vel = Blinkbug.throwVelocity(it.aimDir, _v3, bug.stats.throwSpeed);
      vel.x += this.motor.vel.x * 0.5;
      vel.z += this.motor.vel.z * 0.5;
      if (bug.throw(from, vel)) {
        this.rig.onThrow();
        ctx.emitSound({ pos: from.clone(), loudness: 10, source: this, kind: 'blink' });
      }
    }
    if (it.blink) {
      if (bug.canBlink) this.doBlink(ctx);
      else if (bug.state === 'docked' && this.me) {
        this.me.sfx.blinkFail();
        this.me.hud.toast(bug.cooldown > 0 ? 'Blinkbug is napping…' : 'Throw your Blinkbug first!', '#9fe8ff');
      }
    }
    bug.update(dt);
    this.updateBugTricks(dt, ctx);
    this.swapT = Math.max(0, this.swapT - dt);
  }

  /** Find a free standing spot near the bug; returns null if there's no room. */
  findBlinkSpot(out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.bug.pos;
    const m = this.motor;
    const baseY = b.y - BUG.radius - 0.02;
    const cands: [number, number, number][] = [[0, 0, 0], [0, 0.25, 0], [0, 0.5, 0], [0, -0.4, 0]];
    const sn = this.bug.stuckN;
    if (sn && sn.y < 0.65) {
      // stuck to a wall or ceiling: stand just off the surface (below it for ceilings)
      const off = sn.y < -0.5 ? 0 : 0.45;
      cands.unshift([sn.x * off, sn.y < -0.5 ? -1.8 : -0.2, sn.z * off], [sn.x * (off + 0.3), -0.6, sn.z * (off + 0.3)]);
    }
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
      if (this.me) {
        this.me.sfx.blinkFail();
        this.me.hud.toast('No room to blink there!', '#ff9a9a');
      }
      this.bug.recall();
      return;
    }
    const from = this.motor.pos.clone();
    const keepVel = this.motor.vel.clone();
    const ability = this.bug.species.ability;
    // Snatchet: grab the nearest rascal beside the bug and trade places with THEM
    let victim: Actor | null = null;
    if (ability === 'snatch') {
      let bd = 3.4;
      for (const o of ctx.actors) {
        if (o === this || !o.alive || o.parked || o.flight !== 'none') continue;
        const d = o.motor.pos.distanceTo(this.bug.pos);
        if (d < bd) {
          bd = d;
          victim = o;
        }
      }
      if (victim) spot.copy(victim.motor.pos);
    }
    this.motor.teleport(spot);
    // keep a little horizontal momentum so blinking mid-run feels fluid
    this.motor.vel.set(keepVel.x * 0.4, Math.max(0, keepVel.y * 0.2), keepVel.z * 0.4);
    this.bug.swapped(from);
    this.bugAbility(ctx, ability, from, spot, victim);
    this.blinks++;
    this.lastBlinkAt = ctx.time;
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

  /** Species tricks that fire on arrival. */
  private bugAbility(ctx: GameCtx, ability: string, from: THREE.Vector3, spot: THREE.Vector3, victim: Actor | null) {
    const tint = this.bug.tint;
    switch (ability) {
      case 'hop':
        this.motor.vel.y = 11.5;
        this.motor.grounded = false;
        audio.boing(spot);
        ctx.fx.ring(_v.copy(spot).setY(spot.y + 0.1), tint, 0.2, 2.2, 0.35);
        break;
      case 'mend':
        if (this.hp < this.maxHp) {
          this.heal(12);
          ctx.fx.glow.emit(_v.copy(spot).setY(spot.y + 1), { count: 14, color: [0x7ee06a, 0xffffff], speed: [1, 3], up: 2, spread: 1, life: [0.5, 0.9], size: 0.14, shape: PShape.Star });
          this.me?.hud.toast('+12 patched up!', '#7ee06a');
        }
        break;
      case 'boom': {
        ctx.fx.ring(_v.copy(spot).setY(spot.y + 0.3), tint, 0.3, 5, 0.4);
        ctx.fx.dust(spot, 10, 0xffe0c0);
        audio.explosion(spot);
        this.me?.shake(0.35);
        for (const o of ctx.actors) {
          if (o === this || !o.alive || o.parked) continue;
          const d = o.motor.pos.distanceTo(spot);
          if (d > 4.5) continue;
          const k = 1 - d / 4.5;
          _v2.subVectors(o.motor.pos, spot).setY(0).normalize();
          o.motor.impulse(_v2.multiplyScalar(8 + 8 * k).setY(5 + 4 * k));
          o.takeDamage(Math.round(6 + 8 * k), this, false, _v2.clone().normalize(), ctx, `${this.bug.species.name.toUpperCase()}`);
        }
        break;
      }
      case 'wisp':
        this.stealthT = 2;
        break;
      case 'snatch':
        if (victim) {
          victim.motor.teleport(from);
          victim.motor.vel.set(0, 2, 0);
          victim.rig.onHit(0, 1);
          ctx.fx.blinkBurst(from, true);
          ctx.fx.smear(spot, from);
          audio.chirp(from, 0.6, 0.6);
          this.me?.hud.toast(`SNATCHED ${victim.name.toUpperCase()}!`, '#ff6bb5');
          victim.me?.hud.bigToast('SNATCHED!', '#ff6bb5');
        }
        break;
    }
  }

  /** Per-frame species effects: Wisp shimmer, Nimbus sensing, Pewpew turret, Tanglet webs. */
  private updateBugTricks(dt: number, ctx: GameCtx) {
    const bug = this.bug;
    const ab = bug.species.ability;
    if (bug.state === 'landed' && this.lastBugState !== 'landed') {
      if (ab === 'web') {
        ctx.throwables.addWeb(bug.pos, this, bug.window + 2);
        audio.splat(bug.pos);
        ctx.fx.soft.emit(bug.pos, { count: 10, color: [0xffffff, 0xe8fff8], speed: [1, 3], spread: 1, up: 1, gravity: 4, life: [0.4, 0.8], size: [0.06, 0.12], shape: PShape.Sparkle });
      } else if (ab === 'turret') {
        this.turretT = 0.5; // plant its feet first
        ctx.fx.ring(_v.copy(bug.pos).setY(bug.pos.y - 0.1), bug.tint, 0.1, 1.2, 0.3);
        audio.chirp(bug.pos, 0.8, 0.4);
      }
    }
    this.lastBugState = bug.state;
    if (ab === 'turret' && bug.state === 'landed') this.turretTick(dt, ctx);
    else bug.faceYaw = null;
    if (this.stealthT > 0) {
      this.stealthT -= dt;
      const k = this.stealthT > 0 ? (this.stealthT < 0.4 ? 1 - this.stealthT / 0.4 : 0) : 1;
      this.rig.setGhost(this.isLocal ? 0.45 + k * 0.55 : 0.12 + k * 0.88);
      if (Math.random() < dt * 20) ctx.fx.glow.emit(_v.copy(this.motor.pos).setY(this.motor.pos.y + Math.random() * 1.6), { count: 1, color: this.bug.tint, speed: 0.5, up: 1, life: 0.5, size: 0.08, shape: PShape.Sparkle });
    }
    if (this.pingT > 0) this.pingT -= dt;
    if (this.bug.species.ability === 'ping' && this.bug.state === 'landed') {
      this.pingTick -= dt;
      if (this.pingTick <= 0) {
        this.pingTick = 0.5;
        let n = 0;
        for (const o of ctx.actors) {
          if (o === this || !o.alive || o.parked) continue;
          if (o.motor.pos.distanceTo(this.bug.pos) < 14) {
            if (o.pingT <= 0 || o.pingedBy !== this) n++;
            o.pingT = 2.5;
            o.pingedBy = this;
          }
        }
        if (n > 0) {
          ctx.fx.ring(_v.copy(this.bug.pos).setY(this.bug.pos.y - 0.1), this.bug.tint, 0.2, 14, 0.8);
          audio.chirp(this.bug.pos, 1.6, 0.3);
          this.me?.hud.toast(`${this.bugName} senses ${n} rascal${n > 1 ? 's' : ''}!`, '#ffe27a');
        }
      }
    }
  }

  /** Pewpew: a pew at the nearest enemy it can see, a few times a second */
  private turretTick(dt: number, ctx: GameCtx) {
    const bug = this.bug;
    this.turretT -= dt;
    // it stands up tall on its back legs to see over kerbs and clutter
    const from = _v2.copy(bug.pos).setY(bug.pos.y + 0.45);
    let best: Actor | null = null, bd = 15;
    for (const o of ctx.actors) {
      if (o === this || !o.alive || o.parked || o.downed || o.team === this.team || o.flight !== 'none') continue;
      const d = o.motor.pos.distanceTo(bug.pos);
      if (d >= bd) continue;
      _v3.copy(o.motor.pos).setY(o.motor.pos.y + 1);
      if (!ctx.cw.lineClear(from, _v3, ColFlags.BlocksBullets) || ctx.throwables.smokeBlocks(from, _v3)) continue;
      bd = d;
      best = o;
    }
    if (!best) {
      bug.faceYaw = null;
      return;
    }
    bug.faceYaw = Math.atan2(-(best.motor.pos.x - bug.pos.x), -(best.motor.pos.z - bug.pos.z));
    if (this.turretT > 0) return;
    this.turretT = 0.5;
    const to = _v3.copy(best.motor.pos).setY(best.motor.pos.y + 0.9 + (Math.random() - 0.5) * 0.6);
    ctx.fx.tracer(from, to, bug.tint, 0.04);
    ctx.fx.glow.emit(from, { count: 3, color: [bug.tint, 0xffffff], speed: [0.5, 1.5], life: 0.15, size: 0.12, shape: PShape.Sparkle });
    audio.pew(from);
    ctx.emitSound({ pos: from.clone(), loudness: 30, source: this, kind: 'gunshot' });
    const killed = best.takeDamage(3, this, false, _v.subVectors(to, from).normalize(), ctx, bug.species.name.toUpperCase());
    ctx.fx.sparkBurst(to, bug.tint, 4);
    if (this.me) {
      this.me.hud.hitmarker(false, killed);
      this.me.hud.damageNumber(to.clone().setY(to.y + 0.9), 3, false);
    }
  }

  private shadowsOn = true;
  private syncRig(dt: number, time: number) {
    const m = this.motor;
    const r = this.rig;
    r.root.position.copy(m.pos);
    r.root.rotation.y = this.bodyYaw;
    // relic carriers wear a spinning gem over their head: everyone can see who's worth chasing
    const carrying = this.relics.length > 0 && this.alive && !this.isLocal && r.root.visible;
    if (carrying && !this.relicMark) {
      this.relicMark = buildRelicModel(this.relics[0]);
      this.relicMark.scale.setScalar(0.8);
      this.ctx.scene.add(this.relicMark);
    }
    if (this.relicMark) {
      this.relicMark.visible = carrying;
      if (carrying) {
        this.relicMark.position.set(m.pos.x, m.pos.y + 2.05 + Math.sin(time * 3) * 0.08, m.pos.z);
        this.relicMark.rotation.y = time * 2.2;
      }
    }
    // level of detail: far rascals become a single baked mesh and skip animation entirely
    if (!this.isLocal) {
      const d2 = m.pos.distanceToSquared(this.ctx.camera.position);
      // crowds (Launch Isle, the Sky Barge) switch to the cheap stand-in much sooner
      const mt = this.ctx.match;
      const crowd = !!mt && (mt.phase === 'lobby' || this.flight === 'barge');
      const far = (crowd ? (r.lod ? 6 : 7) : r.lod ? 30 : 34) * (0.5 + 0.5 * detail.model);
      r.setLod(d2 > far * far);
      this.bug.setFar(r.lod);
      const sd = (crowd ? 7 : 24) * (detail.model < 1 ? 0.55 : 1);
      const wantShadow = d2 < sd * sd;
      if (wantShadow !== this.shadowsOn) {
        this.shadowsOn = wantShadow;
        r.setShadows(wantShadow);
      }
      if (r.lod) {
        // cheap life at a distance: a little run bob
        const hs = m.horizontalSpeed();
        r.lodMesh.position.y = hs > 1 ? Math.abs(Math.sin(time * 9 + this.id)) * 0.08 : 0;
        r.lodMesh.rotation.x = hs > 1 ? -0.12 : 0;
        return;
      }
    }
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
      healing: this.healT >= 0,
      diving: this.flight === 'dive',
      gliding: this.flight === 'glide',
      onBarge: this.flight === 'barge',
      emote: this.emote,
      downed: this.downed,
    });
    void clamp;
  }
}

/** A little kite-umbrella glider in the rascal's colours. */
function buildGlider(c1: number, c2: number) {
  const g = new THREE.Group();
  const canopyGeo = new THREE.SphereGeometry(1.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  canopyGeo.scale(1.25, 0.55, 0.9);
  const pos = canopyGeo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(c1).convertSRGBToLinear(), b = new THREE.Color(c2).convertSRGBToLinear();
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(((Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (Math.PI * 2)) * 8);
    const c = seg % 2 ? a : b;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  canopy.position.y = 2.5;
  canopy.castShadow = true;
  g.add(canopy);
  const strM = new THREE.MeshBasicMaterial({ color: 0x5e3b27 });
  for (const [x, z] of [[-1.5, 0], [1.5, 0], [0, -1.1], [0, 1.1]]) {
    const from = new THREE.Vector3(0, 1.3, 0), to = new THREE.Vector3(x * 1.15, 2.5, z * 0.8);
    const len = from.distanceTo(to);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 3), strM);
    s.position.copy(from).add(to).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    g.add(s);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.5, roughness: 0.3 }));
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 1.3;
  g.add(bar);
  return g;
}
