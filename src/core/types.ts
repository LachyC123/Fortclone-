import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';
import type { FX } from '../fx/FX';
import type { Actor } from '../entities/Actor';
import type { World } from '../world/World';
import type { LootSystem } from '../loot/Loot';
import type { NavGrid } from '../world/NavGrid';

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
  killfeed(killer: string, victim: string, weapon: string, localInvolved: boolean): void;
  toast(text: string, color?: string): void;
  slotPulse(slot: number): void;
  playerEliminated(by: string): void;
  playerElimination(victim: string): void;
}

export interface GameCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cw: CollisionWorld;
  fx: FX;
  world: World;
  loot: LootSystem;
  nav: NavGrid;
  actors: Actor[];
  hud: HudEvents;
  time: number;
  emitSound(e: Omit<SoundEvent, 'time'>): void;
  sounds: SoundEvent[];
  shake(amount: number): void;
  localActor: Actor | null;
}
