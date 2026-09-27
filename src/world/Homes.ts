import * as THREE from 'three';
import { Kit } from './Kit';
import type { World } from './World';
import { DoorSpec, WallStyle, Opening, wall, floor, stairs, gableRoof, shade } from './BuildingKit';
import * as P from './Props';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { Rng } from '../core/math';
import { makeSign } from './Signs';
import { worldMaterial } from '../render/Materials';
import { Batcher } from '../render/GeoKit';
import { highGround, loot, crate } from './pois/common';

/**
 * More kinds of building for the bigger island (Milestone 6.5): narrow terraced townhouses, log
 * cabins, little sheds, a barn and a multi-storey tower that becomes a windmill, a clock tower or
 * a fire lookout. Every one is enterable, has loot, stairs where it has floors, real window holes
 * and furniture drawn in the interior batch (only rendered up close).
 */

export interface BuildOpts {
  x: number;
  z: number;
  yaw: number;
  seed: number;
  name?: string;
  /** ground level; defaults to the highest ground under the footprint */
  y?: number;
}

const FLOOR_H = 2.9;

let spinMat: THREE.Material | null = null;
/** A merged, vertex-coloured mesh for things that move (sails, wheels, hands): one draw call each. */
export function spinMesh(fill: (b: Batcher) => void) {
  spinMat ??= worldMaterial();
  const b = new Batcher();
  fill(b);
  const m = b.build(spinMat, true, false)!;
  m.matrixAutoUpdate = true;
  return m;
}

/** local -> world helper for a building's frame */
function frame(x: number, y: number, z: number, yaw: number) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
}

function zoneFor(world: World, name: string, x: number, z: number, r: number, y0: number, y1: number) {
  world.addZone(name, x - r, z - r, x + r, z + r, y0, y1, true);
}

/** Straight flight + stairwell hole + guard rail, along the back (side = -1) or front (+1) wall. */
function flight(k: Kit, hw: number, hd: number, y0: number, rise: number, side: 1 | -1, color: number) {
  const run = 3.5;
  const z = side * (hd - 0.75);
  stairs(k, -hw + 0.4, y0, z, 0, 1.1, rise, run, color, PAL.brownDark);
  return { hole: (side < 0 ? [-hw + 0.3, -hd + 0.15, -hw + 0.4 + run + 0.05, -hd + 1.35] : [-hw + 0.3, hd - 1.35, -hw + 0.4 + run + 0.05, hd - 0.15]) as [number, number, number, number], run, z };
}

function railAlongHole(k: Kit, hw: number, hd: number, y: number, side: 1 | -1, run: number) {
  const z = side * (hd - 1.42);
  k.collider(-hw + 0.4 + run / 2, y + 0.45, z, run, 0.9, 0.1, 'wood', { flags: ColFlags.BlocksMove });
  k.box(-hw + 0.4 + run / 2, y + 0.9, z, run, 0.07, 0.07, PAL.brownDark);
}

/* ------------------------------------------------------------------ townhouse */

export interface TownhouseOpts extends BuildOpts {
  w?: number;
  d?: number;
  floors?: 2 | 3;
  wallColor: number;
  roof: number;
  trim?: number;
  /** false for terraced houses with neighbours on both sides */
  sideWindows?: boolean;
  shopfront?: boolean;
}

/** Narrow two/three-storey town house. Door and big windows at the front, stairs up the back. */
export function townhouse(k: Kit, world: World, doors: DoorSpec[], o: TownhouseOpts) {
  const rng = new Rng(o.seed);
  const W = o.w ?? 5.4, D = o.d ?? 6.6, F = o.floors ?? 2;
  const hw = W / 2, hd = D / 2;
  const Y = o.y ?? highGround(o.x, o.z, Math.max(hw, hd) * 0.9) + 0.02;
  const trim = o.trim ?? PAL.cream;
  const style: WallStyle = { outer: o.wallColor, inner: shade(o.wallColor, 1.1), trim, surface: 'wood', plinth: PAL.stoneDark, beams: rng.chance(0.3) ? PAL.brownDark : undefined };
  const at = frame(o.x, Y, o.z, o.yaw);
  k.push(o.x, Y, o.z, o.yaw);
  k.box(0, -0.9, 0, W + 0.2, 1.8, D + 0.2, PAL.stoneDark, { col: 'stone' });
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, rng.pick([0xc08a5a, 0xa87248, 0xd8c8b0]), 'wood');
  const win = (a: number, big = false): Opening => ({ at: a, w: big ? 1.3 : 0.95, h: big ? 1.3 : 1.1, sill: big ? 0.8 : 1.0, shutters: rng.chance(0.5) ? rng.pick([PAL.teal, PAL.softBlue, PAL.terracotta, PAL.lavender]) : undefined, flowers: rng.chance(0.45) });
  const doorAt = W * 0.7;
  for (let f = 0; f < F; f++) {
    const y0 = f * FLOOR_H;
    const front: Opening[] = f === 0 ? [{ at: doorAt, w: 1.2, h: 2.3, kind: 'door' }, o.shopfront ? { at: W * 0.28, w: 2.0, h: 1.5, sill: 0.6 } : win(W * 0.28, true)] : [win(W * 0.28), win(W * 0.72)];
    wall(k, -hw, hd, hw, hd, y0, FLOOR_H, style, front, 1, f === 0 ? doors : undefined);
    wall(k, hw, hd, hw, -hd, y0, FLOOR_H, style, o.sideWindows ? [win(D / 2)] : []);
    wall(k, hw, -hd, -hw, -hd, y0, FLOOR_H, style, f === 0 ? [{ at: W - 1.0, w: 1.0, h: 2.2, kind: 'door' }] : [win(W * 0.72)], 1, f === 0 ? doors : undefined);
    wall(k, -hw, -hd, -hw, hd, y0, FLOOR_H, style, o.sideWindows ? [win(D * 0.6)] : []);
  }
  // stairs: back wall on the ground floor, front wall between 2nd and 3rd
  const f1 = flight(k, hw, hd, 0, FLOOR_H, -1, 0xa87248);
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, FLOOR_H, 0.22, 0xb58052, 'wood', F === 3 ? f1.hole : f1.hole, shade(o.wallColor, 1.05));
  railAlongHole(k, hw, hd, FLOOR_H, -1, f1.run);
  if (F === 3) {
    const f2 = flight(k, hw, hd, FLOOR_H, FLOOR_H, 1, 0xa87248);
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, FLOOR_H * 2, 0.22, 0xb58052, 'wood', f2.hole, shade(o.wallColor, 1.05));
    railAlongHole(k, hw, hd, FLOOR_H * 2, 1, f2.run);
  }
  const top = F * FLOOR_H;
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, top + 0.22, 0.22, 0x9a6a44, 'wood', undefined, shade(o.wallColor, 1.05));
  gableRoof(k, 0, top + 0.22, 0, 0, W + 0.3, D + 0.4, 1.9, o.roof, { overhang: 0.35, gableColor: o.wallColor, trim });
  k.box(hw - 0.9, top + 2.2, -0.9, 0.6, 2.0, 0.6, PAL.terracottaDark, { col: 'stone' });

  // furniture
  k.beginInterior();
  if (o.shopfront) {
    P.counter(k, -0.3, 0.05, 0.4, 0, 2.4, PAL.cream, PAL.woodLight);
    for (let i = 0; i < 3; i++) P.crate(k, hw - 0.7, 0.05 + i * 0.6, hd - 1.8, 0.6, rng.range(0, 1), rng.pick([PAL.mustard, PAL.pink, PAL.woodLight]));
  } else {
    P.sofa(k, 0.9, 0.05, 1.0, Math.PI, rng.pick([PAL.teal, PAL.lavender, PAL.terracotta]));
    P.rug(k, 0.6, 0.05, 0.2, 2.2, 1.4, rng.pick([PAL.mustard, PAL.pink, PAL.softBlue]));
  }
  P.lamp(k, hw - 0.4, 0.05, 1.8, rng.pick([PAL.mustard, PAL.pink]));
  P.picture(k, 1.2, 1.8, -hd + 0.17, 0, 0.7, 0.5, rng.pick([PAL.softBlue, PAL.pink, PAL.mustard]));
  k.push(0, FLOOR_H, 0);
  P.bed(k, hw - 0.9, 0, 1.3, 0, rng.pick([PAL.lavender, PAL.softBlue, PAL.pink]));
  P.wardrobe(k, -hw + 0.55, 0, 1.4, Math.PI / 2, rng.pick([PAL.teal, PAL.mustard]));
  k.pop();
  if (F === 3) {
    k.push(0, FLOOR_H * 2, 0);
    P.bookshelf(k, hw - 0.35, 0, -0.9, -Math.PI / 2, 1.2, 1.9);
    P.table(k, 0.4, 0, -1.2, 0, 1.2, 0.8);
    P.crate(k, -hw + 0.8, 0, 0.9, 0.7, 0.3);
    k.endInterior();
    k.pop();
  } else k.endInterior();
  k.pop();

  loot(world, ...at(-0.5, 0.08, 0.6), 'weapon');
  loot(world, ...at(0.6, FLOOR_H + 0.08, -0.4), rng.chance(0.6) ? 'weapon' : 'any');
  if (F === 3) loot(world, ...at(0.8, FLOOR_H * 2 + 0.08, 0.8));
  if (o.name) zoneFor(world, o.name, o.x, o.z, Math.max(hw, hd), Y - 1, Y + top + 2.5);
  return { y: Y, top };
}

/* ------------------------------------------------------------------ cabin */

export interface CabinOpts extends BuildOpts {
  w?: number;
  d?: number;
  /** a loft upstairs under the roof */
  loft?: boolean;
  roof?: number;
}

const LOG: WallStyle = { outer: 0x9a6440, inner: 0xd9b48a, trim: 0x5e3b27, surface: 'wood', plinth: 0x7a6a5a };

/** Log cabin with a front porch. Optional sleeping loft reached by a ladder-steep stair. */
export function cabin(k: Kit, world: World, doors: DoorSpec[], o: CabinOpts) {
  const rng = new Rng(o.seed);
  const W = o.w ?? 6.2, D = o.d ?? 5.2, H = 2.9;
  const hw = W / 2, hd = D / 2;
  const Y = o.y ?? highGround(o.x, o.z, Math.max(hw, hd) + 0.6) + 0.02;
  const at = frame(o.x, Y, o.z, o.yaw);
  k.push(o.x, Y, o.z, o.yaw);
  k.box(0, -0.9, 0.6, W + 0.2, 1.8, D + 1.4, 0x7a6a5a, { col: 'stone' });
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, 0xa87248, 'wood');
  const win = (a: number): Opening => ({ at: a, w: 1.0, h: 0.9, sill: 1.1, shutters: rng.chance(0.6) ? 0x3f8f3d : undefined });
  wall(k, -hw, hd, hw, hd, 0, H, LOG, [{ at: W * 0.36, w: 1.15, h: 2.2, kind: 'door' }, win(W * 0.75)], 1, doors);
  wall(k, hw, hd, hw, -hd, 0, H, LOG, [win(D / 2)]);
  wall(k, hw, -hd, -hw, -hd, 0, H, LOG, [win(W * 0.5)]);
  wall(k, -hw, -hd, -hw, hd, 0, H, LOG, [win(D / 2)]);
  // log courses on the outside (cheap: a few long rounded strips per wall)
  for (let i = 1; i < 6; i++) {
    const y = (i / 6) * H;
    const c = shade(LOG.outer, i % 2 ? 0.86 : 1.06);
    k.box(0, y, hd + 0.17, W + 0.3, 0.12, 0.08, c, { ao: 0 });
    k.box(0, y, -hd - 0.17, W + 0.3, 0.12, 0.08, c, { ao: 0 });
    k.box(hw + 0.17, y, 0, 0.08, 0.12, D + 0.3, c, { ao: 0 });
    k.box(-hw - 0.17, y, 0, 0.08, 0.12, D + 0.3, c, { ao: 0 });
  }
  // corner log ends
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) k.box(x, H / 2, z, 0.42, H, 0.42, 0x7a4a2e, { col: 'wood' });
  // porch
  k.box(0, 0.12, hd + 1.0, W, 0.24, 1.8, 0xb07a4f, { col: 'wood' });
  for (const x of [-hw + 0.2, hw - 0.2]) k.cyl(x, 1.35, hd + 1.75, 0.1, 0.12, 2.5, 0x7a4a2e, { col: 'wood', segs: 6 });
  k.box(0, 2.62, hd + 1.1, W + 0.4, 0.14, 2.1, o.roof ?? 0x6a4a3a, { pitch: -0.12, col: 'wood' });
  const hasLoft = o.loft ?? false;
  if (hasLoft) {
    const f1 = flight(k, hw, hd, 0, H, -1, 0xa87248);
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H, 0.22, 0xb58052, 'wood', f1.hole);
    railAlongHole(k, hw, hd, H, -1, f1.run);
    // loft walls are the gable space: a low knee wall with windows at the ends
    wall(k, hw, hd, hw, -hd, H, 1.0, LOG, []);
    wall(k, -hw, -hd, -hw, hd, H, 1.0, LOG, []);
    wall(k, -hw, hd, hw, hd, H, 1.0, LOG, []);
    wall(k, hw, -hd, -hw, -hd, H, 1.0, LOG, []);
    gableRoof(k, 0, H + 1.0, 0, 0, W + 0.4, D + 0.4, 2.3, o.roof ?? 0x6a4a3a, { overhang: 0.5, gableColor: LOG.outer, trim: 0x5e3b27, gableWindow: true });
  } else {
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H + 0.22, 0.22, 0x9a6a44, 'wood');
    gableRoof(k, 0, H + 0.22, 0, 0, W + 0.4, D + 0.4, 2.1, o.roof ?? 0x6a4a3a, { overhang: 0.5, gableColor: LOG.outer, trim: 0x5e3b27 });
  }
  // stone chimney up the side
  k.box(hw + 0.45, (H + 3.2) / 2, -0.6, 0.8, H + 3.2, 0.9, 0x9c9384, { col: 'stone' });
  const [cx, , cz] = k.w(hw + 0.45, 0, -0.6);
  world.addSmoke(new THREE.Vector3(cx, Y + H + 3.4, cz));
  k.beginInterior();
  P.fireplace(k, hw - 0.4, 0.05, -0.6, -Math.PI / 2);
  P.bed(k, -hw + 0.9, 0.05, 0.5, 0, rng.pick([0xc9573f, 0x3f8f3d, PAL.mustard]));
  P.table(k, 0.4, 0.05, -1.2, 0, 1.2, 0.8);
  P.chair(k, 0.4, 0.05, -0.55, Math.PI);
  P.rug(k, 0.3, 0.05, 0.6, 1.8, 1.2, 0xc9573f);
  if (hasLoft) {
    k.push(0, H, 0);
    P.bed(k, hw - 0.9, 0, 0.6, 0, 0x3f8f3d);
    P.crate(k, -hw + 0.8, 0, 1.2, 0.6, 0.5);
    k.pop();
  }
  k.endInterior();
  k.pop();
  loot(world, ...at(-0.6, 0.08, -0.2), 'weapon');
  if (hasLoft) loot(world, ...at(0.3, H + 0.08, 0.6));
  if (rng.chance(0.5)) loot(world, ...at(1.6, 0.32, hd + 1.0));
  if (o.name) zoneFor(world, o.name, o.x, o.z, Math.max(hw, hd) + 0.3, Y - 1, Y + H + 3.5);
  return { y: Y };
}

/* ------------------------------------------------------------------ shed */

export interface ShedOpts extends BuildOpts {
  w?: number;
  d?: number;
  color?: number;
  roof?: number;
}

/** One-room shed / hut / coop. Small, quick to clear, often a gun inside. */
export function shed(k: Kit, world: World, doors: DoorSpec[], o: ShedOpts) {
  const rng = new Rng(o.seed);
  const W = o.w ?? 3.6, D = o.d ?? 3.2, H = 2.6;
  const hw = W / 2, hd = D / 2;
  const Y = o.y ?? highGround(o.x, o.z, Math.max(hw, hd)) + 0.02;
  const col = o.color ?? rng.pick([0x8fb8a8, 0xc9a06a, 0xb86a5a, 0x9aa8c8]);
  const st: WallStyle = { outer: col, inner: shade(col, 1.1), trim: PAL.cream, surface: 'wood', plinth: PAL.stoneDark, thickness: 0.2 };
  const at = frame(o.x, Y, o.z, o.yaw);
  k.push(o.x, Y, o.z, o.yaw);
  k.box(0, -0.7, 0, W + 0.1, 1.4, D + 0.1, PAL.stoneDark, { col: 'stone' });
  floor(k, -hw + 0.1, -hd + 0.1, hw - 0.1, hd - 0.1, 0.04, 0.08, 0xa87248, 'wood');
  wall(k, -hw, hd, hw, hd, 0, H, st, [{ at: W * 0.5, w: 1.1, h: 2.1, kind: 'door' }], 1, doors);
  wall(k, hw, hd, hw, -hd, 0, H, st, [{ at: D / 2, w: 0.8, h: 0.7, sill: 1.2 }]);
  wall(k, hw, -hd, -hw, -hd, 0, H, st, []);
  wall(k, -hw, -hd, -hw, hd, 0, H, st, [{ at: D / 2, w: 0.8, h: 0.7, sill: 1.2 }]);
  floor(k, -hw + 0.1, -hd + 0.1, hw - 0.1, hd - 0.1, H + 0.15, 0.15, 0x9a6a44, 'wood');
  gableRoof(k, 0, H + 0.15, 0, 0, W + 0.2, D + 0.2, 1.2, o.roof ?? rng.pick([PAL.roofRed, PAL.roofBlue, 0x6a5a4a]), { overhang: 0.3, gableColor: col, trim: PAL.cream, wallT: 0.2 });
  k.beginInterior();
  P.crate(k, hw - 0.6, 0.05, -hd + 0.6, 0.7, 0.2);
  P.barrel(k, -hw + 0.55, 0.05, -hd + 0.55, rng.pick([PAL.wood, PAL.teal]));
  k.endInterior();
  k.pop();
  loot(world, ...at(0, 0.08, -0.2), rng.chance(0.7) ? 'weapon' : 'any');
  if (o.name) zoneFor(world, o.name, o.x, o.z, Math.max(hw, hd), Y - 1, Y + H + 1.5);
  return { y: Y };
}

/* ------------------------------------------------------------------ barn */

const BARN: WallStyle = { outer: 0xc9573f, inner: 0xe8c0a8, trim: 0xfff6e6, surface: 'wood', beams: 0xfff6e6, plinth: PAL.stoneDark };

/** Big red barn: arches at both ends, a hay loft, hay bales to climb. */
export function barn(k: Kit, world: World, o: BuildOpts & { color?: number }) {
  const rng = new Rng(o.seed);
  const W = 9, D = 6.5, H = 3.8;
  const st = o.color ? { ...BARN, outer: o.color } : BARN;
  const Y = o.y ?? highGround(o.x, o.z, 4.6) + 0.02;
  const at = frame(o.x, Y, o.z, o.yaw);
  k.push(o.x, Y, o.z, o.yaw);
  k.box(0, -1.2, 0, W + 0.3, 2.4, D + 0.3, PAL.stoneDark, { col: 'stone' });
  floor(k, -W / 2 + 0.15, -D / 2 + 0.15, W / 2 - 0.15, D / 2 - 0.15, 0.04, 0.08, 0xa87248, 'wood');
  wall(k, -W / 2, D / 2, W / 2, D / 2, 0, H, st, [{ at: W / 2, w: 3, h: 3, kind: 'arch' }]);
  wall(k, W / 2, D / 2, W / 2, -D / 2, 0, H, st, [{ at: D / 2, w: 1, h: 1, sill: 1.2 }]);
  wall(k, W / 2, -D / 2, -W / 2, -D / 2, 0, H, st, [{ at: W / 2, w: 3, h: 3, kind: 'arch' }]);
  wall(k, -W / 2, -D / 2, -W / 2, D / 2, 0, H, st, [{ at: D / 2, w: 1, h: 1, sill: 1.2 }]);
  floor(k, -W / 2 + 0.15, -D / 2 + 0.15, -0.5, D / 2 - 0.15, 2.7, 0.2, 0xb58052, 'wood');
  for (let i = 0; i < 3; i++) P.hayBale(k, 1 + i * 0.4, 0.6 - i * 0.8, rng.range(0, 1), i * 0.45);
  P.hayBale(k, -3, -1.6, 0.3, 2.9);
  gableRoof(k, 0, H, 0, 0, W + 0.4, D + 0.4, 2.4, PAL.roofRed, { overhang: 0.4, gableColor: st.outer, trim: 0xfff6e6, gableWindow: true });
  k.pop();
  loot(world, ...at(2, 0.1, 1), 'weapon');
  loot(world, ...at(-1.8, 3.0, 1.4));
  if (rng.chance(0.4)) crate(world, ...at(-2.6, 2.95, -1.2), o.yaw);
  if (o.name) zoneFor(world, o.name, o.x, o.z, 5, Y - 1, Y + H + 2.5);
  return { y: Y };
}

/* ------------------------------------------------------------------ tower */

export interface TowerOpts extends BuildOpts {
  levels: number;
  top: 'battlements' | 'windmill' | 'clock' | 'lookout';
  wallColor: number;
  roof?: number;
  size?: number;
  surface?: 'stone' | 'wood';
}

/**
 * A square tower with a straight flight per level (alternating walls), windows on every side and
 * one of several tops. A great sniper nest — which is exactly why it's loud, lit and easy to spot.
 */
export function tower(k: Kit, world: World, doors: DoorSpec[], o: TowerOpts) {
  const rng = new Rng(o.seed);
  const S = o.size ?? 5.4;
  const hs = S / 2;
  const LH = 3.1;
  const Y = o.y ?? highGround(o.x, o.z, hs + 0.3) + 0.02;
  const surf = o.surface ?? 'stone';
  const st: WallStyle = { outer: o.wallColor, inner: shade(o.wallColor, 1.08), trim: surf === 'stone' ? 0x8a7a6a : PAL.brownDark, surface: surf, plinth: PAL.stoneDark };
  const at = frame(o.x, Y, o.z, o.yaw);
  k.push(o.x, Y, o.z, o.yaw);
  k.box(0, -1.0, 0, S + 0.3, 2.0, S + 0.3, PAL.stoneDark, { col: 'stone' });
  floor(k, -hs + 0.15, -hs + 0.15, hs - 0.15, hs - 0.15, 0.04, 0.08, surf === 'stone' ? 0x9c9384 : 0xa87248, surf);
  const win = (a: number): Opening => ({ at: a, w: 1.0, h: 1.2, sill: 1.0 });
  const enclosedTop = o.top === 'windmill' || o.top === 'clock';
  const n = o.levels;
  for (let l = 0; l < n; l++) {
    const y0 = l * LH;
    wall(k, -hs, hs, hs, hs, y0, LH, st, l === 0 ? [{ at: S * 0.72, w: 1.15, h: 2.3, kind: 'door' }] : [win(S * 0.72)], 1, l === 0 ? doors : undefined);
    wall(k, hs, hs, hs, -hs, y0, LH, st, [win(S / 2)]);
    wall(k, hs, -hs, -hs, -hs, y0, LH, st, [win(S * 0.72)]);
    wall(k, -hs, -hs, -hs, hs, y0, LH, st, [win(S / 2)]);
    const side: 1 | -1 = l % 2 === 0 ? -1 : 1;
    const f = flight(k, hs, hs, y0, LH, side, surf === 'stone' ? 0x9c9384 : 0xa87248);
    floor(k, -hs + 0.15, -hs + 0.15, hs - 0.15, hs - 0.15, y0 + LH, 0.22, surf === 'stone' ? 0x9c9384 : 0xb58052, surf, f.hole);
    railAlongHole(k, hs, hs, y0 + LH, side, f.run);
  }
  const topY = n * LH;
  if (o.top === 'battlements' || o.top === 'lookout') {
    // open roof platform with a parapet (and a little hat of a roof for the lookout)
    for (const [x1, z1, x2, z2] of [[-hs, hs, hs, hs], [hs, hs, hs, -hs], [hs, -hs, -hs, -hs], [-hs, -hs, -hs, hs]] as [number, number, number, number][]) {
      wall(k, x1, z1, x2, z2, topY, 1.0, st, []);
    }
    if (o.top === 'battlements') {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.box(Math.cos(a) * hs * 0.95, topY + 1.35, Math.sin(a) * hs * 0.95, 0.8, 0.7, 0.8, shade(o.wallColor, 0.92), { col: surf });
      }
    } else {
      for (const [x, z] of [[-hs + 0.2, -hs + 0.2], [hs - 0.2, -hs + 0.2], [-hs + 0.2, hs - 0.2], [hs - 0.2, hs - 0.2]]) k.cyl(x, topY + 1.6, z, 0.1, 0.1, 3.2, PAL.brownDark, { segs: 6, col: 'wood' });
      k.cone(0, topY + 3.9, 0, S * 0.85, 1.6, o.roof ?? PAL.roofRed, { segs: 4, yaw: Math.PI / 4 });
      k.collider(0, topY + 3.3, 0, S, 0.2, S, 'wood');
    }
  } else {
    // enclosed top room with a pointy roof
    wall(k, -hs, hs, hs, hs, topY, LH, st, [win(S / 2)]);
    wall(k, hs, hs, hs, -hs, topY, LH, st, [win(S / 2)]);
    wall(k, hs, -hs, -hs, -hs, topY, LH, st, [win(S / 2)]);
    wall(k, -hs, -hs, -hs, hs, topY, LH, st, [win(S / 2)]);
    floor(k, -hs + 0.15, -hs + 0.15, hs - 0.15, hs - 0.15, topY + LH + 0.22, 0.22, 0x9a6a44, 'wood');
    k.cone(0, topY + LH + 0.22 + 1.9, 0, S * 0.82, 3.8, o.roof ?? PAL.roofBlue, { segs: 4, yaw: Math.PI / 4 });
    k.sphere(0, topY + LH + 4.2, 0, 0.25, PAL.mustard);
  }
  k.pop();

  const topFloorY = o.top === 'windmill' || o.top === 'clock' ? topY : topY;
  // loot all the way up: something on every other floor, the best at the top
  for (let l = 1; l <= n; l += 2) loot(world, ...at(0.6, l * LH + 0.08, 0.2), l === n ? 'weapon' : 'any');
  loot(world, ...at(0.8, 0.08, 0.4), 'weapon');
  if (rng.chance(0.6)) crate(world, ...at(hs - 1.0, topFloorY + 0.25, -hs + 1.0), o.yaw);

  // dynamic tops
  const TH = topY + (enclosedTop ? LH : 0);
  if (o.top === 'windmill') {
    // one merged mesh for all four sails so the whole thing is a single draw call
    const [fx, , fz] = at(0, 0, hs + 0.5);
    const holder = new THREE.Group();
    holder.position.set(fx, Y + TH - 0.4, fz);
    holder.rotation.y = o.yaw;
    const sails = spinMesh((b) => {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        // spar along the arm, sail offset to one side of it
        b.box(-s * 3.1, c * 3.1, 0, 0.2, 6.2, 0.12, { color: PAL.brownDark }, 0, 0, 0, a);
        b.box(-s * 3.8 + c * 0.72, c * 3.8 + s * 0.72, 0.06, 1.3, 4.6, 0.05, { color: 0xfff6e6, ao: 0 }, 0, 0, 0, a);
      }
      b.cyl(0, 0, 0, 0.4, 0.4, 0.6, { color: PAL.brownDark }, 10, Math.PI / 2);
    });
    world.addSpinner(sails, 'z', 0.5);
    holder.add(sails);
    world.group.add(holder);
  } else if (o.top === 'clock') {
    // faces are static scenery; only the minute hands move (one small mesh per face)
    for (let s = 0; s < 4; s++) {
      const ly = (s * Math.PI) / 2;
      const off = hs + 0.2;
      const lx = Math.sin(ly) * off, lz = Math.cos(ly) * off;
      k.push(o.x, Y, o.z, o.yaw);
      k.push(lx, topY + LH * 0.55, lz, ly);
      k.cyl(0, 0, 0, 1.25, 1.25, 0.12, 0xfff6e6, { pitch: Math.PI / 2, segs: 24 });
      k.torus(0, 0, 0.02, 1.28, 0.1, PAL.mustard);
      for (let h = 0; h < 12; h++) {
        const a = (h / 12) * Math.PI * 2;
        k.box(Math.sin(a) * 1.02, Math.cos(a) * 1.02, 0.08, 0.08, h % 3 ? 0.14 : 0.26, 0.03, PAL.ink, { ao: 0, roll: -a });
      }
      k.box(0.18, 0.28, 0.1, 0.12, 0.7, 0.04, PAL.ink, { ao: 0, roll: -0.6 });
      k.pop();
      k.pop();
      const yaw = o.yaw + ly;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const holder = new THREE.Group();
      holder.position.set(o.x + off * sn, Y + topY + LH * 0.55, o.z + off * cs);
      holder.rotation.y = yaw;
      const minute = spinMesh((b) => b.box(0, 0.5, 0.13, 0.08, 1.05, 0.04, { color: PAL.ink, ao: 0 }));
      minute.castShadow = false;
      minute.rotation.z = rng.range(0, 6);
      world.addSpinner(minute, 'z', -0.35);
      holder.add(minute);
      world.group.add(holder);
    }
  }
  if (o.name) zoneFor(world, o.name, o.x, o.z, hs + 0.2, Y - 1, Y + TH + 4);
  return { y: Y, top: TH };
}

/* ------------------------------------------------------------------ bits & bobs */

/** A sign on a post, facing yaw. */
export function signPost(k: Kit, world: World, x: number, y: number, z: number, text: string, yaw: number, sub?: string) {
  k.box(x, y + 1.2, z, 0.18, 2.4, 0.18, PAL.brownDark, { col: 'wood' });
  const s = makeSign(text, { w: 2.2, h: 0.5, sub, bg: '#fff1d8' });
  s.position.set(x, y + 2.15, z);
  s.rotation.y = yaw;
  world.group.add(s);
}

/** An open-sided pavilion on posts (market hall, bandstand, bumper-car roof). */
export function pavilion(k: Kit, x: number, y: number, z: number, yaw: number, w: number, d: number, h: number, roof: number, post = PAL.cream) {
  k.push(x, y, z, yaw);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(sx * (w / 2 - 0.2), h / 2, sz * (d / 2 - 0.2), 0.14, 0.16, h, post, { col: 'wood', segs: 8 });
  if (w > 7) for (const sz of [-1, 1]) k.cyl(0, h / 2, sz * (d / 2 - 0.2), 0.14, 0.16, h, post, { col: 'wood', segs: 8 });
  gableRoof(k, 0, h, 0, 0, w, d, 1.4, roof, { overhang: 0.4, gableColor: post, trim: post, wallT: 0.1 });
  k.pop();
}
