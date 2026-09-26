import * as THREE from 'three';
import type { Game } from './Game';
import type { Actor } from '../entities/Actor';
import { MatchHooks, MatchPhase } from './types';
import { SkyBarge } from '../world/SkyBarge';
import { Gloom } from '../world/Gloom';
import { rand, pick } from './math';
import { audio } from '../audio/Audio';
import { RARITY } from '../render/Palette';
import { AmmoType } from '../combat/Weapons';
import { MatchUI, MatchSummary } from '../ui/MatchUI';
import type { Crate } from '../loot/Loot';
import { toyMaterial } from '../render/Materials';
import { ISLAND_R, groundHeight } from '../world/Terrain';
import { randomBugName, randomSpecies, cocoonForPlacement, saveCollection } from '../progression/Bugs';
import { POIS, POI_BY_ID, POI } from '../world/Heightmap';

export const MATCH_SIZE = 24;
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
  private won = false;
  private dropTargets = new Map<number, THREE.Vector3>();
  private dropSeed = 0;
  private joined = 0;
  private startTime = 0;
  private spectate: Actor | null = null;
  profile = loadProfile();
  private summaryShown = false;
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

  /* ------------------------------------------------------------------ lobby */

  startLobby() {
    const g = this.g;
    this.phase = 'lobby';
    this.t = 0;
    this.endT = -1;
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
    this.ui.hideSummary();
    g.resetWorldForMatch();
    // make sure we have a full lobby of rascals
    while (g.actors.length < MATCH_SIZE) g.createBot();
    const L = g.world.lobby;
    this.joined = 1;
    g.actors.forEach((a, i) => {
      a.parked = i > 0; // bots "join" over the first few seconds
      a.out = false;
      a.reviveUsed = false;
      a.kills = 0;
      a.damageDealt = 0;
      a.blinks = 0;
      a.distance = 0;
      a.fusions = 0;
      a.bestRarity = -1;
      a.weaponDamage = {};
      a.placement = 0;
      if (!a.isLocal) {
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
    });
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
    const spots = [...Array(this.barge.spots.length).keys()].sort(() => Math.random() - 0.5);
    g.actors.forEach((a, i) => {
      if (a.parked) return;
      a.flight = 'barge';
      a.bargeSpot = spots[i % spots.length];
      a.alive = true;
      a.rig.root.visible = true;
      this.barge.riderWorld(a.bargeSpot, a.motor.pos);
      a.motor.vel.set(0, 0, 0);
      // each bot picks a landing spot: loot, crates, buildings
      if (!a.isLocal) this.dropTargets.set(a.id, this.pickDropTarget(this.dropArea(i)));
    });
    g.camRig.snapTo(g.player);
    g.camRig.pitch = -0.35;
    this.gloom.start();
    this.startTime = g.time;
    this.ui.barge();
    audio.bell(this.barge.pos);
  }

  /** Spread the lobby over the island: a few more in Buttonbury, some in the wilds, the rest shared out. */
  private dropArea(i: number): POI | null {
    const order: (string | null)[] = ['buttonbury', 'wobblewood', 'market', 'manor', 'rattleworks', 'cove', 'buttonbury', null];
    const id = order[(i + this.dropSeed) % order.length];
    return id ? POI_BY_ID[id] : null;
  }

  private pickDropTarget(area: POI | null = null) {
    const w = this.g.world;
    // land on the ground near loot (not on roofs, lofts or perches)
    const low = (p: THREE.Vector3) => p.y < groundHeight(p.x, p.z) + 1.2;
    let pool = [...w.lootSpots.map((s) => s.pos), ...w.crateSpots.map((c) => c.pos)].filter((p) => low(p) && Math.hypot(p.x, p.z) < ISLAND_R - 7);
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
    let t = this.dropTargets.get(a.id);
    if (!t) this.dropTargets.set(a.id, (t = this.pickDropTarget()));
    return t;
  }

  /* ------------------------------------------------------------------ hooks */

  allowBugout(a: Actor) {
    if (this.phase !== 'live' && this.phase !== 'barge') return false;
    if (a.reviveUsed || this.gloom.phase >= 4) return false;
    if (!this.g.world.nests.some((n) => !n.used)) return false;
    return a.isLocal ? true : Math.random() < 0.6;
  }

  gloomOutside(p: THREE.Vector3) {
    return this.gloom.state !== 'idle' && this.gloom.outside(p);
  }

  onOut(a: Actor, by: Actor | null, weapon: string) {
    a.placement = this.remaining + 1;
    if (!this.firstOut && by && by !== a) {
      this.firstOut = true;
      this.g.hud.toast(`${by.isLocal ? 'YOU' : by.name.toUpperCase()} GOT FIRST BONK!`, '#ffd36b');
    }
    if (a.isLocal) {
      this.spectate = by && by.alive ? by : null;
      this.endT = 2.8;
      this.ui.eliminated(by ? by.name : weapon === 'THE GLOOM' ? 'THE GLOOM' : 'the island', a.placement);
    }
    this.checkWin();
    void weapon;
  }

  onRevive(_a: Actor) {}

  private checkWin() {
    if (this.phase !== 'live' && this.phase !== 'barge') return;
    const p = this.g.player;
    if (!p.out && this.remaining <= 1) {
      this.won = true;
      p.placement = 1;
      this.endT = 1.2;
      this.ui.victory();
      audio.fuse();
      this.g.fx.elimination(p.motor.pos.clone().setY(p.motor.pos.y + 2), [0xffd36b, 0xff9ad5, 0x6ff7ff]);
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number) {
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
            if (a.isLocal) g.hud.gloomHit();
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

    // end of match
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

  clearBalloons() {
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
    g.hud.bigToast('LOOT BALLOON!', '#ffd36b');
    g.hud.toast('Epic loot is drifting down — it\'s on your map!', '#ffd36b');
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
    const alive = this.g.actors.filter((a) => a.alive && !a.parked);
    return alive.length ? alive[0] : null;
  }

  private showSummary() {
    this.summaryShown = true;
    this.phase = 'end';
    const p = this.g.player;
    const best = Object.entries(p.weaponDamage).sort((a, b) => b[1] - a[1])[0];
    const place = this.won ? 1 : p.placement || this.remaining;
    const xpParts: [string, number][] = [
      ['Placement', Math.round((MATCH_SIZE - place + 1) * 22)],
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
    else if (place <= 5) dr += 0.03;
    else if (place >= 16 && p.kills === 0) dr -= 0.05;
    if (!this.won && survived < 100) dr -= 0.03;
    dr += Math.min(0.03, p.kills * 0.006);
    prof.rating = Math.max(0.1, Math.min(0.85, prof.rating + dr));
    while (prof.xp >= xpForLevel(prof.level)) {
      prof.xp -= xpForLevel(prof.level);
      prof.level++;
    }
    saveProfile(prof);
    // every match hatches progress: a cocoon, better the higher you placed
    const cocoon = cocoonForPlacement(place, MATCH_SIZE, p.kills);
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
      of: MATCH_SIZE,
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
