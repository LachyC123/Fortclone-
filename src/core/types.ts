import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';
import type { FX } from '../fx/FX';
import type { Actor } from '../entities/Actor';
import type { World } from '../world/World';
import type { LootSystem } from '../loot/Loot';
import type { NavGrid } from '../world/NavGrid';
import type { Throwables } from '../combat/Throwables';
import type { SkyBarge } from '../world/SkyBarge';
import type { Audio } from '../audio/Audio';

/**
 * Everything an actor can "want" in a frame. Player input and bot brains both produce this —
 * it's also exactly what would be sent over the network for multiplayer later.
 */
export interface Intent {
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  aimOrigin: THREE.Vector3;
  aimDir: THREE.Vector3;
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  interact: boolean;
  throwAim: boolean;
  throwRelease: boolean;
  blink: boolean;
  slot: number;
  /** hold to aim a utility, release to throw */
  utilAim: boolean;
  utilRelease: boolean;
  /** start using the healing item */
  heal: boolean;
  /** drop the held weapon */
  drop: boolean;
  /** hold to pick a knocked-down teammate back up */
  revive: boolean;
  /** interact is being held (reviving, rebuilding at a nest) */
  hold: boolean;
}

export function makeIntent(): Intent {
  return {
    moveX: 0,
    moveZ: 0,
    aimYaw: 0,
    aimPitch: 0,
    aimOrigin: new THREE.Vector3(),
    aimDir: new THREE.Vector3(0, 0, -1),
    sprint: false,
    jump: false,
    crouch: false,
    fire: false,
    ads: false,
    reload: false,
    interact: false,
    throwAim: false,
    throwRelease: false,
    blink: false,
    slot: -1,
    revive: false,
    hold: false,
    utilAim: false,
    utilRelease: false,
    heal: false,
    drop: false,
  };
}

export interface SoundEvent {
  pos: THREE.Vector3;
  loudness: number; // audible radius in metres
  source: Actor | null;
  kind: 'gunshot' | 'footstep' | 'blink' | 'impact' | 'bell';
  time: number;
}

export interface HudEvents {
  hitmarker(headshot: boolean, kill: boolean): void;
  damageNumber(pos: THREE.Vector3, amount: number, headshot: boolean): void;
  damageFrom(dirWorld: THREE.Vector3): void;
  killfeed(killer: string, victim: string, weapon: string, localInvolved: boolean, knocked?: boolean): void;
  toast(text: string, color?: string): void;
  slotPulse(slot: number): void;
  playerEliminated(by: string): void;
  playerElimination(victim: string, callout?: string): void;
  bigToast(text: string, color?: string): void;
  /** you got knocked out: white flash, colour drains for a beat */
  koFlash(): void;
  /** standing in the Gloom: purple flash */
  gloomHit(): void;
}

/**
 * A human's personal feedback channel: their HUD, UI sounds and camera juice. The local player's
 * goes straight to this device; on a LAN host, a remote player's is queued and sent to them.
 * Bots have none.
 */
export interface Personal {
  hud: HudEvents;
  sfx: Audio;
  shake(amount: number): void;
  hitStop(dur: number, scale?: number): void;
  slowMo(scale: number, dur: number): void;
}

export interface GameCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cw: CollisionWorld;
  fx: FX;
  /** messages everyone sees (kill feed, match announcements) */
  announce: HudEvents;
  world: World;
  loot: LootSystem;
  nav: NavGrid;
  actors: Actor[];
  hud: HudEvents;
  time: number;
  emitSound(e: Omit<SoundEvent, 'time'>): void;
  sounds: SoundEvent[];
  shake(amount: number): void;
  /** freeze-frame for impact (dur in real seconds, scale = sim speed meanwhile) */
  hitStop(dur: number, scale?: number): void;
  /** dramatic slow motion that eases back to full speed */
  slowMo(scale: number, dur: number): void;
  localActor: Actor | null;
  throwables: Throwables;
  /** line of sight that also respects smoke clouds */
  sightClear(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** null in the free-play playground */
  match: MatchHooks | null;
}

export type MatchPhase = 'lobby' | 'barge' | 'live' | 'end';

export interface SparkInfo {
  owner: Actor;
  pos: THREE.Vector3;
  carrier: Actor | null;
  /** 0..1 rebuilding at a nest */
  rebuildK: number;
}

export interface MatchHooks {
  phase: MatchPhase;
  barge: SkyBarge;
  canDrop: boolean;
  allowBugout(a: Actor): boolean;
  onOut(a: Actor, by: Actor | null, weapon: string): void;
  onRevive(a: Actor): void;
  /** squads: 1 = solo */
  teamSize: number;
  /** squads: would this rascal be knocked down (a teammate is still standing) instead of eliminated? */
  canGoDown(a: Actor): boolean;
  onDowned(a: Actor, by: Actor | null): void;
  /** dropped Blinkbug sparks (squads) */
  sparks: SparkInfo[];
  sparkNear(a: Actor): SparkInfo | null;
  trySparkPickup(a: Actor): SparkInfo | null;
  nestFor(a: Actor): { pos: THREE.Vector3; used: boolean } | null;
  /** where a bot wants to land */
  dropTargetFor(a: Actor): THREE.Vector3;
  /** safe zone info for bots */
  safeCenter: THREE.Vector2;
  safeRadius: number;
  gloomOutside(p: THREE.Vector3): boolean;
  /** pacing director: how far bots will pick fights from, and how keen they are to go hunting */
  engageRange: number;
  hunt: number;
  /** a Loot Balloon landing spot everyone is converging on */
  hotspot: THREE.Vector3 | null;
  /** pacing: scales bot-vs-bot damage only (never damage to or from the player) */
  botDamageMul: number;
  /** 0..1 how fight-hungry the match wants bots to be right now */
  aggro: number;
}
