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
import { ISLAND_R } from '../world/Terrain';
import { randomBugName, randomSpecies, cocoonForPlacement, saveCollection } from '../progression/Bugs';

export const MATCH_SIZE = 24;
const LOBBY_TIME = 14;

interface Profile {
  level: number;
  xp: number;
  wins: number;
  matches: number;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem('rr.profile');
    if (raw) return { level: 1, xp: 0, wins: 0, matches: 0, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { level: 1, xp: 0, wins: 0, matches: 0 };
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
  safeCenter = new THREE.Vector2();
  safeRadius = 60;
  private t = 0;
  private dmgTick = 0;
  private endT = -1;
  private won = false;
  private dropTargets = new Map<number, THREE.Vector3>();
  private joined = 0;
  private startTime = 0;
  private spectate: Actor | null = null;
  profile = loadProfile();
  private summaryShown = false;

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
    this.canDrop = false;
    this.spectate = null;
    this.gloom.reset();
    this.barge.active = false;
    this.barge.group.visible = false;
    this.dropTargets.clear();
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
      if (!a.isLocal) a.setSpecies(randomSpecies(), randomBugName());
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
    this.barge.planRoute(ISLAND_R);
    this.barge.update(0);
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
      if (!a.isLocal) this.dropTargets.set(a.id, this.pickDropTarget());
    });
    g.camRig.snapTo(g.player);
    g.camRig.pitch = -0.35;
    this.gloom.start();
    this.startTime = g.time;
    this.ui.barge();
    audio.bell(this.barge.pos);
  }

  private pickDropTarget() {
    const w = this.g.world;
    const pool = [...w.lootSpots.map((s) => s.pos), ...w.crateSpots.filter((c) => c.pos.y < 3).map((c) => c.pos)];
    const p = pick(pool).clone();
    p.x += rand(-4, 4);
    p.z += rand(-4, 4);
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
    this.safeRadius = this.gloom.state === 'idle' ? 60 : this.gloom.nextR;

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
      this.canDrop = this.barge.progress > 0.1;
      const riders = g.actors.filter((a) => a.flight === 'barge');
      if (this.barge.progress > 0.93) for (const a of riders) a.startDive(g);
      this.ui.bargeStatus(this.barge.progress, g.player.flight === 'barge', this.canDrop);
      if (!riders.length) {
        this.phase = 'live';
        this.ui.live();
      }
    }
    if (this.barge.active && this.barge.progress > 1.3) {
      this.barge.active = false;
      this.barge.group.visible = false;
    }

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
