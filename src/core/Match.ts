import * as THREE from 'three';
import type { Game } from './Game';
import type { Actor } from '../entities/Actor';
import { MatchHooks, MatchPhase, SparkInfo } from './types';
import { SkyBarge } from '../world/SkyBarge';
import { Gloom } from '../world/Gloom';
import { rand, pick } from './math';
import { audio } from '../audio/Audio';
import { RARITY, RarityIndex } from '../render/Palette';
import { AmmoType } from '../combat/Weapons';
import { MatchUI, MatchSummary } from '../ui/MatchUI';
import { rollWeapon, ammoFor } from '../loot/Loot';
import type { Crate } from '../loot/Loot';
import { toyMaterial } from '../render/Materials';
import { ISLAND_R, groundHeight, islandRadius } from '../world/Terrain';
import { randomBugName, randomSpecies, cocoonForPlacement, saveCollection } from '../progression/Bugs';
import { POIS, POI_BY_ID, POI } from '../world/Heightmap';

export const MATCH_SIZE = 24;
/** seconds a dropped spark waits on the ground for a teammate */
export const SPARK_TIME = 90;

export interface Spark extends SparkInfo {
  t: number;
  group: THREE.Group;
  beam: THREE.Mesh;
  /** 0..1 progress rebuilding at a nest */
  rebuildK: number;
}
const LOBBY_TIME = 14;

interface Profile {
  level: number;
  xp: number;
  wins: number;
  matches: number;
  /** hidden difficulty rating 0..1: nudged up when you do well, down when you struggle */
  rating: number;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem('rr.profile');
    if (raw) return { level: 1, xp: 0, wins: 0, matches: 0, rating: 0.35, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { level: 1, xp: 0, wins: 0, matches: 0, rating: 0.35 };
}
function saveProfile(p: Profile) {
  try {
    localStorage.setItem('rr.profile', JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export const xpForLevel = (lvl: number) => 800 + lvl * 200;

/**
 * One battle royale match: Launch Isle lobby -> Sky Barge -> drop -> the Gloom closes -> last
 * rascal standing. Implements the hooks actors and bots use to take part.
 */
export class Match implements MatchHooks {
  phase: MatchPhase = 'lobby';
  barge: SkyBarge;
  gloom: Gloom;
  ui: MatchUI;
  canDrop = false;
  /** route progress where the barge is over the island: jump window [enterAt, exitAt] */
  private enterAt = 0.2;
  private exitAt = 0.8;
  private lastCallSaid = false;
  safeCenter = new THREE.Vector2();
  safeRadius = 60;
  engageRange = 70;
  hunt = 0;
  hotspot: THREE.Vector3 | null = null;
  botDamageMul = 1;
  aggro = 0.5;
  private balloons: { group: THREE.Group; beam: THREE.Mesh; land: THREE.Vector3; t: number; crate: Crate | null; gone: number }[] = [];
  private balloonTimes = [115, 245];
  private directorT = 0;
  private landedAt = -1;
  private t = 0;
  private dmgTick = 0;
  private endT = -1;
  private celebrateT = 0;
  private cannonT = 0;
  private won = false;
  private dropTargets = new Map<number, THREE.Vector3>();
  private dropSeed = 0;
  private joined = 0;
  private startTime = 0;
  private spectate: Actor | null = null;
  profile = loadProfile();
  summaryShown = false;
  private firstOut = false;

  constructor(private g: Game) {
    this.barge = new SkyBarge(g.scene);
    this.gloom = new Gloom(g.scene, g.fx);
    this.ui = new MatchUI();
    this.ui.onPlayAgain = () => this.g.startMatch();
    this.ui.onHome = () => this.g.goHome();
  }

  get remaining() {
    return this.g.actors.filter((a) => !a.out && !a.parked).length;
  }

  /* ------------------------------------------------------------------ squads */

  /** 1 = solo, 2 duos, 3 trios, 4 squads */
  teamSize = 1;
  /** LAN host: put friends on the teams they picked (runs after the default assignment) */
  teamPlan: ((actors: Actor[]) => void) | null = null;

  /* --- small read-outs the LAN host sends to clients */
  lobbyLeft() {
    return this.phase === 'lobby' ? Math.max(0, LOBBY_TIME - this.t) : 0;
  }
  joinedCount() {
    return this.joined;
  }
  bargeK() {
    const pr = this.barge.progress;
    return pr < this.enterAt ? 0 : (pr - this.enterAt) / Math.max(0.01, this.exitAt - this.enterAt);
  }
  lastCallNow() {
    return this.phase === 'barge' && this.barge.progress > this.exitAt - (this.exitAt - this.enterAt) * 0.2;
  }
  balloonMarks() {
    return this.balloons.filter((b) => !b.crate || !b.crate.opened).map((b) => [Math.round(b.group.position.x), Math.round(b.group.position.y), Math.round(b.group.position.z), Math.round(b.land.x), Math.round(b.land.y), Math.round(b.land.z)]);
  }
  /** a dropped Blinkbug spark a teammate can carry to a Rift Nest to rebuild its owner */
  sparks: Spark[] = [];

  /** teams with anyone still in the match (standing, knocked, bugging out or waiting on a spark) */
  teamsLeft() {
    const t = new Set<number>();
    for (const a of this.g.actors) if (!a.out && !a.parked) t.add(a.team);
    return t.size;
  }

  teammates(a: Actor) {
    return this.g.actors.filter((o) => o !== a && o.team === a.team && !o.parked);
  }

  /** standing = alive, on their feet (not knocked, not a bug) */
  private standing(team: number) {
    return this.g.actors.some((o) => o.team === team && o.alive && !o.downed && !o.parked);
  }

  canGoDown(a: Actor) {
    if (this.teamSize <= 1 || this.phase !== 'live') return false;
    return this.g.actors.some((o) => o !== a && o.team === a.team && o.alive && !o.downed && !o.parked);
  }

  onDowned(a: Actor, _by: Actor | null) {
    if (a.isLocal) this.ui.knocked(true);
  }

  /** the rules that tie a squad together, every frame */
  private updateSquads(dt: number) {
    if (this.teamSize <= 1) return;
    const g = this.g;
    // nobody left standing (and nobody mid bug-escape to come back) = the knocked are finished
    const teams = new Set(g.actors.filter((a) => a.downed).map((a) => a.team));
    for (const team of teams) {
      if (this.standing(team)) continue;
      if (g.actors.some((o) => o.team === team && o.bugout)) continue;
      for (const o of g.actors) if (o.team === team && o.downed) {
        o.downHp = 0;
        o.downed = false;
        o.eliminate(o.downBy, g, 'TEAM WIPE');
      }
    }
    this.updateSparks(dt);
  }

  /* --- sparks */
  private dropSpark(owner: Actor, at: THREE.Vector3) {
    const g = this.g;
    // only if a teammate could still come for it
    if (!this.teammates(owner).some((o) => !o.out)) return;
    const y = groundHeight(at.x, at.z);
    const pos = new THREE.Vector3(at.x, Math.max(y, at.y - 3) + 0.9, at.z);
    if (y < -20) return;
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0x9ffcff }));
    core.scale.set(1, 1.5, 1);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshBasicMaterial({ color: 0x6ff7ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x6ff7ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 15;
    group.add(core, halo, beam);
    group.position.copy(pos);
    g.scene.add(group);
    this.sparks.push({ owner, pos, carrier: null, t: SPARK_TIME, group, beam, rebuildK: 0 });
    g.fx.blinkBurst(pos, false);
    for (const o of g.actors) {
      if (!o.me || o.team !== owner.team) continue;
      if (o === owner) o.me.hud.bigToast('YOUR SPARK DROPPED — HANG ON!', '#9ffcff');
      else o.me.hud.toast(`${owner.name}'s spark dropped — grab it and take it to a Rift Nest!`, '#9ffcff');
    }
  }

  private removeSpark(s: Spark) {
    this.g.scene.remove(s.group);
    this.sparks = this.sparks.filter((x) => x !== s);
  }

  clearSparks() {
    for (const s of [...this.sparks]) this.removeSpark(s);
  }

  /** a teammate standing on a spark picks it up (players press interact; bots just grab it) */
  trySparkPickup(a: Actor) {
    for (const s of this.sparks) {
      if (s.carrier || s.owner.team !== a.team || s.owner === a) continue;
      if (s.pos.distanceTo(a.motor.pos.clone().setY(a.motor.pos.y + 0.9)) > 2.2) continue;
      s.carrier = a;
      audio.pickup(3);
      this.g.fx.pickupSparkle(s.pos, 0x9ffcff);
      a.me?.hud.bigToast(`GOT ${s.owner.name.toUpperCase()}'S SPARK! FIND A RIFT NEST`, '#9ffcff');
      s.owner.me?.hud.toast(`${a.name} has your spark!`, '#9ffcff');
      return s;
    }
    return null;
  }

  /** the spark this rascal could pick up right now (for prompts) */
  sparkNear(a: Actor) {
    return this.sparks.find((s) => !s.carrier && s.owner.team === a.team && s.owner !== a && s.pos.distanceTo(a.motor.pos.clone().setY(a.motor.pos.y + 0.9)) < 2.2) ?? null;
  }

  /** a carried spark next to an unused Rift Nest */
  nestFor(a: Actor) {
    if (!this.sparks.some((s) => s.carrier === a)) return null;
    return this.g.world.nests.find((n) => !n.used && Math.hypot(n.pos.x - a.motor.pos.x, n.pos.z - a.motor.pos.z) < 3.2 && Math.abs(n.pos.y - a.motor.pos.y) < 2.5) ?? null;
  }

  private updateSparks(dt: number) {
    const g = this.g;
    for (const s of [...this.sparks]) {
      const c = s.carrier;
      if (c && (!c.alive || c.downed || c.out)) {
        // the carrier went down: it spills back onto the ground
        s.carrier = null;
        s.pos.copy(c.motor.pos).setY(groundHeight(c.motor.pos.x, c.motor.pos.z) + 0.9);
        s.rebuildK = 0;
      }
      if (s.carrier) {
        s.pos.copy(s.carrier.motor.pos).setY(s.carrier.motor.pos.y + 2.3 + Math.sin(this.t * 3) * 0.1);
        s.beam.visible = false;
        // rebuilding: stand at an unused nest holding interact (bots do it automatically)
        const n = this.nestFor(s.carrier);
        const holding = s.carrier.me ? s.carrier.intent.hold : true;
        if (n && holding) {
          s.rebuildK += dt / 3;
          if (Math.random() < dt * 14) g.fx.bugTrail(n.pos.clone().setY(n.pos.y + 1 + Math.random()));
          if (s.rebuildK >= 1) {
            const owner = s.owner;
            this.removeSpark(s);
            owner.rebuildAt(n, g);
            s.carrier.me?.hud.toast(`You rebuilt ${owner.name}!`, '#9ffcff');
            continue;
          }
        } else s.rebuildK = Math.max(0, s.rebuildK - dt);
      } else {
        s.t -= dt;
        s.beam.visible = true;
        if (s.t <= 0 || !this.teammates(s.owner).some((o) => !o.out)) {
          g.fx.sparkBurst(s.pos, 0x9f7bff, 16);
          this.removeSpark(s);
          this.teamCheck(s.owner.team);
          continue;
        }
      }
      s.group.position.copy(s.pos);
      s.group.rotation.y += dt * 2;
      s.group.position.y += Math.sin(this.t * 2.5 + s.owner.id) * 0.12;
    }
  }

  /** when a team runs out of everything, place them and (if it's yours) end your match */
  private teamCheck(team: number) {
    const g = this.g;
    const members = g.actors.filter((a) => a.team === team && !a.parked);
    if (members.some((a) => !a.out)) return;
    if (this.sparks.some((s) => s.owner.team === team)) return;
    const place = this.teamsLeft() + 1;
    for (const a of members) if (!a.placement || a.placement > place) a.placement = place;
    if (team === g.player.team && !this.won) {
      this.endT = 2.8;
      this.ui.eliminated(this.lastKiller ?? 'the island', place);
    }
    this.checkWin();
  }
  private lastKiller: string | null = null;

  /* ------------------------------------------------------------------ lobby */

  startLobby() {
    const g = this.g;
    this.phase = 'lobby';
    this.t = 0;
    this.endT = -1;
    this.celebrateT = 0;
    this.g.camRig.cinematic = false;
    this.won = false;
    this.summaryShown = false;
    this.firstOut = false;
    this.canDrop = false;
    this.spectate = null;
    this.gloom.reset();
    this.barge.active = false;
    this.barge.group.visible = false;
    this.dropTargets.clear();
    this.clearBalloons();
    this.clearSparks();
    this.lastKiller = null;
    this.ui.knocked(false);
    this.ui.spectating('', false);
    this.ui.hideSummary();
    g.resetWorldForMatch();
    g.throwables.clear();
    // make sure we have a full lobby of rascals
    while (g.actors.length < MATCH_SIZE) g.createBot();
    const L = g.world.lobby;
    this.joined = 1;
    g.actors.forEach((a, i) => {
      a.parked = i > 0 && !a.me; // bots "join" over the first few seconds (people are there already)
      a.out = false;
      a.reviveUsed = false;
      a.kills = 0;
      a.revives = 0;
      a.damageDealt = 0;
      a.blinks = 0;
      a.distance = 0;
      a.fusions = 0;
      a.bestRarity = -1;
      a.weaponDamage = {};
      a.placement = 0;
      if (!a.me) {
        a.setSpecies(randomSpecies(), randomBugName());
        // skill mix around your rating: some rookies, mostly regulars, a few aces
        const br = a.controller as { setSkill?: (s: number) => void } | null;
        const d = this.g.settings.botDifficulty;
        const r = d === 'easy' ? 0.15 : d === 'normal' ? 0.4 : d === 'hard' ? 0.72 : this.profile.rating;
        const roll = Math.random();
        const s = roll < 0.3 ? r - 0.3 + Math.random() * 0.1 : roll < 0.82 ? r - 0.08 + Math.random() * 0.16 : r + 0.3 + Math.random() * 0.1;
        br?.setSkill?.(s);
      }
      a.weapons = [null, null, null];
      a.equip(0, true);
      for (const t of Object.keys(a.ammo) as AmmoType[]) a.ammo[t] = 0;
      a.util = null;
      a.healItem = null;
      const ang = Math.random() * Math.PI * 2, r = i === 0 ? 2 : rand(3, L.radius - 3);
      a.spawn(new THREE.Vector3(L.center.x + Math.cos(ang) * r, L.center.y + 0.05, L.center.z + Math.sin(ang) * r), rand(0, 6));
      if (a.parked) {
        a.rig.root.visible = false;
        a.bug.root.visible = false;
        a.alive = false;
      }
      // squads: you and the next (size - 1) rascals are a team, and so on down the list
      a.team = this.teamSize > 1 ? Math.floor(i / this.teamSize) : a.id;
    });
    this.teamPlan?.(g.actors);
    const p = g.player;
    p.spawn(new THREE.Vector3(L.center.x, L.center.y + 0.05, L.center.z + 3), 0);
    g.camRig.snapTo(p);
    g.camRig.yaw = Math.PI * 0.85;
    g.camRig.pitch = -0.2;
    this.ui.lobby(LOBBY_TIME, 1, MATCH_SIZE);
    audio.uiTap();
  }

  /* ------------------------------------------------------------------ barge */

  private startBarge() {
    const g = this.g;
    this.phase = 'barge';
    this.t = 0;
    this.ui.wipe();
    this.dropSeed = Math.floor(Math.random() * 8);
    this.barge.planRoute(ISLAND_R);
    this.barge.update(0);
    // work out when the barge is actually above the island so nobody drops into the sea
    const S = this.barge.start, E = this.barge.end;
    let enter = -1, exit = -1;
    for (let t = 0; t <= 1; t += 0.005) {
      const d = Math.hypot(S.x + (E.x - S.x) * t, S.z + (E.z - S.z) * t);
      if (enter < 0 && d < ISLAND_R + 4) enter = t;
      if (enter >= 0 && d < ISLAND_R - 8) exit = t;
    }
    g.hud.route = { sx: S.x, sz: S.z, ex: E.x, ez: E.z, bx: 0, bz: 0 };
    this.enterAt = enter < 0 ? 0.3 : enter;
    this.exitAt = exit < 0 ? 0.7 : exit;
    this.lastCallSaid = false;
    this.clearHotDrops();
    this.pickHotDrops();
    const spots = [...Array(this.barge.spots.length).keys()].sort(() => Math.random() - 0.5);
    this.dropOrder = [];
    const teamTarget = new Map<number, THREE.Vector3>();
    const teamSlot = new Map<number, number>();
    g.actors.forEach((a, i) => {
      if (a.parked) return;
      a.flight = 'barge';
      a.bargeSpot = spots[i % spots.length];
      a.alive = true;
      a.rig.root.visible = true;
      this.barge.riderWorld(a.bargeSpot, a.motor.pos);
      a.motor.vel.set(0, 0, 0);
      // each bot picks a landing spot: loot, crates, buildings
      if (!a.me) {
        if (this.teamSize > 1) {
          // a squad lands together: one spot per team, members fanned out a few metres apart
          let t = teamTarget.get(a.team);
          if (!t) teamTarget.set(a.team, (t = this.pickDropTarget(this.dropArea(a.team))));
          const k = teamSlot.get(a.team) ?? 0;
          teamSlot.set(a.team, k + 1);
          const ang = k * 2.1;
          this.dropTargets.set(a.id, t.clone().add(new THREE.Vector3(Math.cos(ang) * 3.5 * Math.min(1, k), 0, Math.sin(ang) * 3.5 * Math.min(1, k))));
        } else this.dropTargets.set(a.id, this.pickDropTarget(this.dropArea(i)));
      }
    });
    g.camRig.snapTo(g.player);
    g.camRig.pitch = -0.35;
    this.gloom.start();
    this.startTime = g.time;
    this.ui.barge();
    audio.bell(this.barge.pos);
  }

  /** Spread the lobby over the island: a few more in Buttonbury, some in the wilds, the rest shared out. */
  /** every place gets a couple of rascals (big Buttonbury a few more), plus some wild landings */
  private dropOrder: (string | null)[] = [];
  private _follow = new THREE.Vector3();
  private dropArea(i: number): POI | null {
    if (i === 0 || !this.dropOrder.length) {
      this.dropOrder = [...POIS.map((p) => p.id), 'buttonbury', null, null].sort(() => Math.random() - 0.5);
    }
    // a few rascals always fancy the hot drops
    if (this.hotDrops.length && Math.random() < 0.28) return this.hotDrops[i % this.hotDrops.length].poi;
    const id = this.dropOrder[(i + this.dropSeed) % this.dropOrder.length];
    if (!id) return null;
    // only places a rascal can actually glide to from this match's barge route
    const reach = (p: POI) => this.routeDist(p.x, p.z) < 72;
    const want = POI_BY_ID[id];
    if (reach(want)) return want;
    const ok = POIS.filter(reach);
    return ok.length ? ok[(i * 7 + this.dropSeed) % ok.length] : null;
  }

  /** horizontal distance from a point to the Sky Barge's straight route */
  private routeDist(x: number, z: number) {
    const S = this.barge.start, E = this.barge.end;
    const dx = E.x - S.x, dz = E.z - S.z;
    const t = Math.max(0, Math.min(1, ((x - S.x) * dx + (z - S.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (S.x + dx * t), z - (S.z + dz * t));
  }

  private pickDropTarget(area: POI | null = null) {
    const w = this.g.world;
    // land on the ground near loot (not on roofs, lofts or perches)
    const low = (p: THREE.Vector3) => p.y < groundHeight(p.x, p.z) + 1.2;
    let pool = [...w.lootSpots.map((s) => s.pos), ...w.crateSpots.map((c) => c.pos)].filter((p) => low(p) && Math.hypot(p.x, p.z) < islandRadius(Math.atan2(p.z, p.x)) - 7);
    const inArea = area ? pool.filter((p) => Math.hypot(p.x - area.x, p.z - area.z) < area.r + 6) : pool.filter((p) => !POIS.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < q.r));
    if (inArea.length) pool = inArea;
    const p = pick(pool).clone();
    // land outside under open sky near the loot (never on a roof above it)
    const up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
    for (let r = 2; r <= 12; r += 2)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + r;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const y = groundHeight(x, z);
        if (this.g.cw.raycast(o.set(x, y + 0.4, z), up, 45, 1)) continue;
        if (this.g.cw.sphereOverlaps(o.set(x, y + 0.9, z), 0.5, 1)) continue;
        return new THREE.Vector3(x, y, z);
      }
    return p;
  }

  dropTargetFor(a: Actor) {
    // bot teammates follow their human down, fanned out around wherever they're heading
    const p = this.teamSize > 1 && !a.me ? this.g.actors.find((o) => o.me && o.team === a.team && !o.parked) : undefined;
    if (p && p.flight !== 'barge') {
      const ang = a.id * 2.1;
      const ahead = p.flight === 'none' ? 0 : 6;
      return this._follow.set(p.motor.pos.x + p.motor.vel.x * 0.1 * ahead + Math.cos(ang) * 4, p.motor.pos.y, p.motor.pos.z + p.motor.vel.z * 0.1 * ahead + Math.sin(ang) * 4);
    }
    let t = this.dropTargets.get(a.id);
    if (!t) this.dropTargets.set(a.id, (t = this.pickDropTarget()));
    return t;
  }

  /* ------------------------------------------------------------------ hooks */

  allowBugout(a: Actor) {
    if (this.phase !== 'live' && this.phase !== 'barge') return false;
    if (a.reviveUsed || this.gloom.phase >= 4) return false;
    if (!this.g.world.nests.some((n) => !n.used)) return false;
    return a.me ? true : Math.random() < 0.6;
  }

  gloomOutside(p: THREE.Vector3) {
    return this.gloom.state !== 'idle' && this.gloom.outside(p);
  }

  onOut(a: Actor, by: Actor | null, weapon: string) {
    a.placement = this.teamSize > 1 ? 0 : this.remaining + 1;
    if (!this.firstOut && by && by !== a) {
      this.firstOut = true;
      this.g.announce.toast(`${by.name.toUpperCase()} GOT FIRST BONK!`, '#ffd36b');
    }
    const killer = by ? by.name : weapon === 'THE GLOOM' ? 'THE GLOOM' : 'the island';
    if (this.teamSize > 1) {
      // squads: the spark drops where the bug gave out, for a teammate to carry to a nest
      this.dropSpark(a, a.outPos);
      if (a.isLocal) {
        this.lastKiller = killer;
        this.spectate = this.teammates(a).find((o) => o.alive) ?? (by && by.alive ? by : null);
        this.ui.knocked(false);
        this.ui.spectating(this.spectate ? this.spectate.name : '', true);
      }
      this.teamCheck(a.team);
    } else {
      if (a.isLocal) {
        this.spectate = by && by.alive ? by : null;
        this.endT = 2.8;
        this.ui.eliminated(killer, a.placement);
      }
      this.checkWin();
    }
    void weapon;
  }

  onRevive(a: Actor) {
    if (a.isLocal) {
      this.ui.knocked(false);
      this.ui.spectating('', false);
      this.spectate = null;
    }
  }

  private checkWin() {
    if (this.won || (this.phase !== 'live' && this.phase !== 'barge')) return;
    const p = this.g.player;
    const mine = this.g.actors.some((a) => a.team === p.team && !a.out && !a.parked);
    if (mine && this.teamsLeft() <= 1) {
      this.won = true;
      for (const a of this.g.actors) if (a.team === p.team) a.placement = 1;
      p.placement = 1;
      // victory lap: slow-mo on the final bonk, fanfare, confetti cannons, the camera swings round
      // and our rascal busts a move before the summary
      this.endT = 5.2;
      this.celebrateT = 5.2;
      this.cannonT = 0.5;
      this.ui.victory();
      this.g.slowMo(0.3, 1.3);
      audio.fanfare();
      this.g.fx.elimination(p.motor.pos.clone().setY(p.motor.pos.y + 2), [0xffd36b, 0xff9ad5, 0x6ff7ff]);
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number) {
    if (this.phase === 'live') this.updateSquads(dt);
    const g = this.g;
    this.t += dt;
    this.barge.update(dt);
    this.gloom.update(dt, g.camera.position);
    this.safeCenter.copy(this.gloom.nextC);
    this.safeRadius = this.gloom.state === 'idle' ? 999 : this.gloom.nextR;

    if (this.phase === 'lobby') {
      // nobody falls off Launch Isle for good: pop them back on the plaza
      const L = g.world.lobby;
      for (const a of g.actors) {
        if (a.alive && a.motor.pos.y < L.center.y - 8) {
          a.spawn(new THREE.Vector3(L.center.x + rand(-4, 4), L.center.y + 3, L.center.z + rand(-4, 4)), a.bodyYaw);
          g.fx.sparkBurst(a.motor.pos, 0x6ff7ff, 10);
        }
      }
      // bots trickle in with a poof
      const want = Math.min(MATCH_SIZE, 1 + Math.floor((this.t / 3.2) * MATCH_SIZE));
      while (this.joined < want) {
        const a = g.actors[this.joined++];
        if (!a) break;
        a.parked = false;
        a.alive = true;
        a.rig.root.visible = true;
        a.bug.root.visible = true;
        g.fx.sparkBurst(a.motor.pos.clone().setY(a.motor.pos.y + 1), 0xffd36b, 8);
        audio.pop(a.motor.pos);
      }
      this.ui.lobby(Math.max(0, LOBBY_TIME - this.t), this.joined, MATCH_SIZE);
      if (this.t >= LOBBY_TIME) this.startBarge();
      return;
    }

    if (this.phase === 'barge') {
      const pr = this.barge.progress;
      this.canDrop = pr > this.enterAt;
      const riders = g.actors.filter((a) => a.flight === 'barge');
      const lastCall = pr > this.exitAt - (this.exitAt - this.enterAt) * 0.2;
      if (lastCall && !this.lastCallSaid && g.player.flight === 'barge') {
        this.lastCallSaid = true;
        g.hud.bigToast('LAST CALL! JUMP!', '#ff9a5b');
        audio.bell(this.barge.pos);
      }
      // everyone still aboard gets tipped off while there's island below
      if (pr > this.exitAt) for (const a of riders) a.startDive(g);
      const k = pr < this.enterAt ? 0 : (pr - this.enterAt) / Math.max(0.01, this.exitAt - this.enterAt);
      this.ui.bargeStatus(k, g.player.flight === 'barge', this.canDrop, lastCall);
      if (!riders.length) {
        this.phase = 'live';
        this.ui.live();
      }
    }
    if (this.barge.active && this.barge.progress > 1.3) {
      this.barge.active = false;
      this.barge.group.visible = false;
    }

    this.direct(dt);
    this.updateBalloons(dt);

    if (this.phase === 'live' || this.phase === 'barge') {
      // the Gloom hurts
      this.dmgTick -= dt;
      if (this.dmgTick <= 0) {
        this.dmgTick = 1;
        for (const a of g.actors) {
          if (!a.alive || a.parked || a.flight !== 'none') continue;
          if (this.gloom.outside(a.motor.pos)) {
            a.takeDamage(this.gloom.dps, null, false, new THREE.Vector3(0, 0, 1), g, 'THE GLOOM');
            a.me?.hud.gloomHit();
          }
        }
      }
      const tm = this.gloom.timer();
      this.ui.gloomTimer(tm.label, tm.t, this.gloom.state === 'shrinking');
      if (this.phase === 'live') this.checkWin();
    }

    // bug-revive guidance for the player
    const p = g.player;
    if (p.bugout) {
      let best: THREE.Vector3 | null = null, bd = Infinity;
      for (const n of g.world.nests) {
        if (n.used) continue;
        const d = n.pos.distanceTo(p.bug.pos);
        if (d < bd) {
          bd = d;
          best = n.pos;
        }
      }
      this.ui.bugout(p.bugout.t, p.bugout.hp / 30, best, bd, g.camera);
    } else this.ui.bugout(-1, 0, null, 0, g.camera);

    // victory celebration
    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      const p = g.player;
      g.camRig.cinematic = this.celebrateT < 4.2 && this.celebrateT > 0;
      if (this.celebrateT < 4.3 && p.alive && !p.emote && Math.hypot(p.intent.moveX, p.intent.moveZ) < 0.2) p.startEmote('dance', 3.5);
      this.cannonT -= dt;
      if (this.cannonT <= 0 && this.celebrateT > 0.8) {
        this.cannonT = 0.55;
        const a = Math.random() * Math.PI * 2;
        const at = p.motor.pos.clone().add(new THREE.Vector3(Math.cos(a) * 5, 0.3, Math.sin(a) * 5));
        const dir = new THREE.Vector3(-Math.cos(a) * 0.35, 1, -Math.sin(a) * 0.35).normalize();
        g.fx.confettiCannon(at, dir);
        audio.cannon(at);
      }
      if (this.celebrateT <= 0) g.camRig.cinematic = false;
    }

    // end of match
    if (this.summaryShown && this.phase !== 'end' && this.teamsLeft() <= 1) this.phase = 'end';
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0 && !this.summaryShown) this.showSummary();
    }
  }

  /**
   * Pacing director. Keeps a match on a ~6.5 minute arc: if rascals are dropping faster than the
   * target curve, bots get choosier about fights; if it's dragging, they go looking for trouble.
   */
  private direct(dt: number) {
    if (this.phase !== 'live') {
      this.engageRange = 70;
      this.hunt = 0;
      this.botDamageMul = 1;
      this.aggro = 0.5;
      this.landedAt = -1;
      return;
    }
    if (this.landedAt < 0) this.landedAt = this.t;
    this.directorT -= dt;
    if (this.directorT > 0) return;
    this.directorT = 2;
    const L = this.t - this.landedAt;
    const target = 1 + 22 * Math.pow(Math.max(0, 1 - L / 400), 1.4);
    const diff = this.remaining - target; // + = behind schedule (too many left)
    const aggro = Math.max(0.05, Math.min(1, 0.45 + diff * 0.14));
    // the first minute on the ground is for looting: only close-quarters scraps
    const early = L < 90 ? 0.25 + (L / 90) * 0.75 : 1;
    this.engageRange = (12 + aggro * 50) * early;
    this.aggro = aggro * (L < 90 ? 0.6 + (L / 90) * 0.4 : 1);
    this.hunt = L < 75 ? 0 : Math.max(0, (aggro - 0.45) * 1.4);
    // bots scrapping with each other drag on a bit when we're ahead of schedule (room for third parties)
    this.botDamageMul = Math.max(0.35, Math.min(1, 0.3 + aggro * 0.9)) * (L < 90 ? 0.75 : 1);
  }

  difficultyLabel() {
    const d = this.g.settings.botDifficulty;
    if (d !== 'auto') return d.toUpperCase();
    const r = this.profile.rating;
    return `AUTO · ${r < 0.25 ? 'CHILL' : r < 0.45 ? 'NORMAL' : r < 0.65 ? 'SPICY' : 'WILD'}`;
  }

  /* ------------------------------------------------------------------ Loot Balloons */

  /* ------------------------------------------------------------------ hot drops */

  /** Two places per match (reachable from the barge route) get a rich crate, extra rare guns and a beam. */
  hotDrops: { poi: POI; pos: THREE.Vector3; beam: THREE.Mesh; crate: Crate }[] = [];
  private lastHot: string[] = [];

  private pickHotDrops() {
    const g = this.g;
    const reachable = POIS.filter((p) => this.routeDist(p.x, p.z) < 72);
    const fresh = reachable.filter((p) => !this.lastHot.includes(p.id));
    const pool = (fresh.length >= 2 ? fresh : reachable).sort(() => Math.random() - 0.5).slice(0, 2);
    for (const poi of pool) {
      const pos = this.pickDropTarget(poi);
      const crate = g.loot.placeCrate(pos.clone(), Math.random() * 6);
      crate.rich = true;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        const at = pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.4, 0.1, Math.sin(a) * 2.4));
        const w = rollWeapon();
        w.rarity = pick([2, 2, 3, 3, 4]) as RarityIndex;
        g.loot.spawnRolls([w, ammoFor(w.defId, 2)], at);
      }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.position.set(pos.x, pos.y + 45, pos.z);
      g.scene.add(beam);
      this.hotDrops.push({ poi, pos, beam, crate });
    }
    this.lastHot = pool.map((p) => p.id);
    g.hud.hotDrops = this.hotDrops.map((h) => h.pos);
    if (pool.length) {
      g.announce.bigToast('HOT DROPS!', '#ff8a3d');
      g.announce.toast(`Rare loot at ${pool.map((p) => p.name).join(' & ')} — marked on your map`, '#ffb36b');
    }
  }

  clearHotDrops() {
    for (const h of this.hotDrops) {
      this.g.scene.remove(h.beam);
      this.g.loot.removeCrate(h.crate);
    }
    this.hotDrops = [];
    this.g.hud.hotDrops = [];
  }

  clearBalloons() {
    this.clearHotDrops();
    this.clearSparks();
    for (const b of this.balloons) {
      this.g.scene.remove(b.group, b.beam);
      if (b.crate) this.g.loot.removeCrate(b.crate);
    }
    this.balloons = [];
    this.balloonTimes = [115, 245];
    this.hotspot = null;
    this.g.hud.balloons = [];
  }

  private spawnBalloon() {
    const g = this.g;
    const c = this.safeCenter;
    const r = Math.min(this.safeRadius * 0.55, 30);
    const up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
    let land: THREE.Vector3 | null = null;
    for (let i = 0; i < 30 && !land; i++) {
      const p = g.nav.randomWalkable(Math.random, c.x, c.y, Math.max(4, r));
      if (!p) continue;
      if (g.cw.raycast(o.set(p.x, p.y + 0.5, p.z), up, 70, 1)) continue;
      land = p;
    }
    if (!land) return;
    const group = new THREE.Group();
    const stripes = [0xffd36b, 0xff6b9a, 0x6ff7ff, 0xffd36b, 0xc160ff, 0xff6b9a];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 16, (i / 6) * Math.PI * 2, Math.PI / 3), toyMaterial(stripes[i]));
      seg.scale.set(1, 1.15, 1);
      seg.position.y = 7;
      group.add(seg);
    }
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 1, 10), toyMaterial(0xb07a4f));
    basket.position.y = 0.5;
    group.add(basket);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.85), toyMaterial(0xc160ff));
    box.position.y = 1.2;
    group.add(box);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.6, 4), toyMaterial(0x5e3b27));
      rope.position.set(Math.cos(a) * 1.4, 3.2, Math.sin(a) * 1.4);
      rope.rotation.z = Math.cos(a) * -0.2;
      rope.rotation.x = Math.sin(a) * 0.2;
      group.add(rope);
    }
    group.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    group.position.set(land.x, land.y + 75, land.z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 80, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(land.x, land.y + 40, land.z);
    g.scene.add(group, beam);
    this.balloons.push({ group, beam, land, t: 0, crate: null, gone: -1 });
    this.hotspot = land.clone();
    g.hud.balloons = this.balloons.map((b) => b.land);
    g.announce.bigToast('LOOT BALLOON!', '#ffd36b');
    g.announce.toast('Epic loot is drifting down — it\'s on your map!', '#ffd36b');
    audio.bell(land);
  }

  private updateBalloons(dt: number) {
    if (this.phase === 'live' && this.landedAt >= 0 && this.balloonTimes.length && this.t - this.landedAt >= this.balloonTimes[0]) {
      // a balloon is a fight magnet: hold it back while the match is already running hot
      const L = this.t - this.landedAt;
      const target = 1 + 22 * Math.pow(Math.max(0, 1 - L / 400), 1.4);
      if (this.remaining >= target - 1.5 || L > this.balloonTimes[0] + 60) {
        this.balloonTimes.shift();
        if (this.remaining >= 4) this.spawnBalloon();
      } else this.balloonTimes[0] += 20;
    }
    const DESCENT = 24;
    for (const b of this.balloons) {
      b.t += dt;
      if (!b.crate) {
        const k = Math.min(1, b.t / DESCENT);
        const e = 1 - (1 - k) * (1 - k);
        b.group.position.set(b.land.x + Math.sin(b.t * 0.7) * 2 * (1 - k), b.land.y + 75 * (1 - e), b.land.z + Math.cos(b.t * 0.5) * 2 * (1 - k));
        b.group.rotation.z = Math.sin(b.t * 1.3) * 0.08 * (1 - k);
        if (k >= 1) {
          // touchdown: the crate stays, the balloon floats off
          b.crate = this.g.loot.placeCrate(b.land.clone(), Math.random() * 6);
          b.crate.rich = true;
          b.group.children.slice(6, 8).forEach((m) => (m.visible = false));
          this.g.fx.sparkBurst(b.land.clone().setY(b.land.y + 1), 0xffd36b, 30);
          this.g.fx.ring(b.land.clone().setY(b.land.y + 0.2), 0xffd36b, 0.3, 6, 0.6);
          audio.crateOpen(b.land);
          b.gone = 0;
        }
      } else if (b.gone >= 0) {
        b.gone += dt;
        b.group.position.y += dt * (3 + b.gone * 2);
        if (b.gone > 8) {
          this.g.scene.remove(b.group);
          b.gone = -2;
        }
      }
      (b.beam.material as THREE.MeshBasicMaterial).opacity = b.crate?.opened ? Math.max(0, (b.beam.material as THREE.MeshBasicMaterial).opacity - dt * 0.2) : 0.18 + Math.sin(b.t * 3) * 0.05;
    }
    // the hotspot lasts until someone cracks the crate open
    const live = this.balloons.find((b) => !b.crate || !b.crate.opened);
    this.hotspot = live ? live.land : null;
    this.g.hud.balloons = this.balloons.filter((b) => !b.crate || !b.crate.opened).map((b) => b.land);
  }

  /** after elimination, watch whoever got you */
  spectateTarget(): Actor | null {
    if (this.spectate && this.spectate.alive) return this.spectate;
    // squads: keep watching your team while anyone on it is still going
    if (this.teamSize > 1) {
      const mate = this.teammates(this.g.player).find((o) => o.alive);
      if (mate) {
        this.spectate = mate;
        this.ui.spectating(mate.name, this.g.player.out && !this.summaryShown && this.endT < 0);
        return mate;
      }
    }
    const alive = this.g.actors.filter((a) => a.alive && !a.parked);
    return alive.length ? alive[0] : null;
  }

  /** LAN client: forget the last match's result flags */
  resetForNet() {
    this.summaryShown = false;
    this.won = false;
    this.endT = -1;
    this.celebrateT = 0;
    this.phase = 'lobby';
  }

  /** LAN client: the host says how it went; show the same summary (XP and cocoons land on this device) */
  showSummaryNet(won: boolean, place: number) {
    if (this.summaryShown) return;
    this.won = won;
    this.g.player.placement = won ? 1 : place;
    this.showSummary();
  }

  private showSummary() {
    this.summaryShown = true;
    // the island keeps going behind your summary until the match is really over
    // (other squads, and on LAN other humans, may still be playing)
    if (this.won || this.teamsLeft() <= 1) this.phase = 'end';
    const p = this.g.player;
    const best = Object.entries(p.weaponDamage).sort((a, b) => b[1] - a[1])[0];
    const teams = this.teamSize > 1 ? Math.ceil(MATCH_SIZE / this.teamSize) : MATCH_SIZE;
    const place = this.won ? 1 : p.placement || (this.teamSize > 1 ? this.teamsLeft() : this.remaining);
    // placement scaled onto a 24-rascal field so XP, rating and cocoons feel the same in every mode
    const place24 = Math.max(1, Math.round(((place - 1) / Math.max(1, teams - 1)) * (MATCH_SIZE - 1)) + 1);
    const xpParts: [string, number][] = [
      ['Placement', Math.round((MATCH_SIZE - place24 + 1) * 22)],
      ['Revives', p.revives * 40],
      ['Eliminations', p.kills * 60],
      ['Damage', Math.round(p.damageDealt * 0.4)],
      ['Blinks', p.blinks * 10],
      ['Fusions', p.fusions * 30],
    ];
    if (this.won) xpParts.push(['Victory!', 400]);
    const xp = xpParts.reduce((a, b) => a + b[1], 0);
    const prof = this.profile;
    const startLevel = prof.level, startXp = prof.xp;
    prof.xp += xp;
    prof.matches++;
    if (this.won) prof.wins++;
    // adaptive difficulty: gentle steps, never far from the middle
    const survived = this.g.time - this.startTime;
    let dr = 0;
    if (this.won) dr += 0.07;
    else if (place24 <= 5) dr += 0.03;
    else if (place24 >= 16 && p.kills === 0) dr -= 0.05;
    if (!this.won && survived < 100) dr -= 0.03;
    dr += Math.min(0.03, p.kills * 0.006);
    prof.rating = Math.max(0.1, Math.min(0.85, prof.rating + dr));
    while (prof.xp >= xpForLevel(prof.level)) {
      prof.xp -= xpForLevel(prof.level);
      prof.level++;
    }
    saveProfile(prof);
    // every match hatches progress: a cocoon, better the higher you placed
    const cocoon = cocoonForPlacement(place24, MATCH_SIZE, p.kills);
    this.g.collection.cocoons.push({ rarity: cocoon });
    saveCollection(this.g.collection);
    const summary: MatchSummary = {
      difficulty: this.difficultyLabel(),
      cocoon: RARITY[cocoon].name,
      cocoonColor: RARITY[cocoon].css,
      bugName: p.bugName,
      blinksLine: p.blinks,
      won: this.won,
      placement: place,
      of: teams,
      teams: this.teamSize > 1,
      kills: p.kills,
      damage: Math.round(p.damageDealt),
      bestWeapon: best ? best[0] : '—',
      distance: Math.round(p.distance),
      blinks: p.blinks,
      bestRarity: p.bestRarity >= 0 ? RARITY[p.bestRarity].name : '—',
      bestRarityColor: p.bestRarity >= 0 ? RARITY[p.bestRarity].css : '#aaa',
      fusions: p.fusions,
      time: Math.round(this.g.time - this.startTime),
      xpParts,
      xp,
      startLevel,
      startXp,
      endLevel: prof.level,
      endXp: prof.xp,
    };
    this.ui.showSummary(summary);
  }
}
