import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { ground, islandRadius, roadDist, POIS } from '../Heightmap';
import { shade } from '../BuildingKit';
import { buildCottage, CottageSpec } from '../Cottages';
import { DoorSpec } from '../BuildingKit';

export { ground };

/** Run a builder with the origin on the ground at (x, z). */
export function on(k: Kit, x: number, z: number, fn: () => void, yaw = 0, dy = 0) {
  k.push(x, ground(x, z) + dy, z, yaw);
  fn();
  k.pop();
}

/** Lowest ground under a footprint (so floors/stilts never float on slopes). */
export function lowGround(x: number, z: number, hw: number, hd = hw) {
  return Math.min(ground(x - hw, z - hd), ground(x + hw, z - hd), ground(x - hw, z + hd), ground(x + hw, z + hd), ground(x, z));
}
export function highGround(x: number, z: number, hw: number, hd = hw) {
  return Math.max(ground(x - hw, z - hd), ground(x + hw, z - hd), ground(x - hw, z + hd), ground(x + hw, z + hd), ground(x, z));
}

export function loot(world: World, x: number, y: number, z: number, kind: 'weapon' | 'any' = 'any') {
  world.lootSpots.push({ pos: new THREE.Vector3(x, y, z), kind: kind === 'weapon' ? 'weapon' : 'ammo', rarity: 0 });
}
/** loot on the ground at (x, z) */
export function lootG(world: World, x: number, z: number, kind: 'weapon' | 'any' = 'any') {
  loot(world, x, ground(x, z) + 0.05, z, kind);
}
export function crate(world: World, x: number, y: number, z: number, yaw = 0) {
  world.crateSpots.push({ pos: new THREE.Vector3(x, y, z), yaw });
}
export function crateG(world: World, x: number, z: number, yaw = 0) {
  crate(world, x, ground(x, z) + 0.02, z, yaw);
}

/** Cottage placed on the ground (level foundation), with its loot. */
export function cottage(k: Kit, world: World, doors: DoorSpec[], c: CottageSpec) {
  const r = Math.max(c.w, c.d) / 2;
  c.y = highGround(c.x, c.z, r * 0.8) + 0.02;
  buildCottage(k, world, doors, c);
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [c.x + lx * cs + lz * sn, c.y! + ly, c.z - lx * sn + lz * cs];
  loot(world, ...at(0.6, 0.05, 0.4), 'weapon');
  loot(world, ...at(-1.2, 0.05, -0.6));
  if (c.floors === 2) loot(world, ...at(0.4, 3.05, 0.6), 'weapon');
}

/** True if (x, z) is near any place, a road, or the island rim (keep scatter out). */
export function busy(x: number, z: number, roadPad = 3.5, poiPad = 0) {
  const r = Math.hypot(x, z);
  if (r > islandRadius(Math.atan2(z, x)) - 4) return true;
  if (roadDist(x, z) < roadPad) return true;
  for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r + poiPad) return true;
  return false;
}

/** A chunky cluster of boulders: hard cover that blocks bullets and sight. */
export function outcrop(k: Kit, rng: Rng, x: number, z: number, s = 1) {
  const base = lowGround(x, z, 2 * s) - 0.3;
  const n = 3 + Math.floor(rng.next() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(0.8, 2.2) * s;
    const rs = (i === 0 ? rng.range(1.4, 2.0) : rng.range(0.7, 1.3)) * s;
    k.ico(x + Math.cos(a) * d, base + rs * 0.55, z + Math.sin(a) * d, rs, shade(rng.pick([PAL.stone, PAL.stoneDark, 0xb0a594]), rng.range(0.85, 1.05)), { detail: 0, sy: rng.range(0.7, 1.1), sx: rng.range(0.9, 1.3), yaw: rng.range(0, 6), col: 'stone' });
  }
  // moss & tufts
  for (let i = 0; i < 3; i++) k.ico(x + rng.range(-1.5, 1.5) * s, base + 0.4, z + rng.range(-1.5, 1.5) * s, 0.35 * s, PAL.leafDark, { batch: 'foliage', wind: 0.2, detail: 0, sy: 0.5 });
}

/** A copse of trees (canopies block sight, trunks block bullets). */
export function woods(k: Kit, rng: Rng, x: number, z: number, r: number, n: number, kinds: ('round' | 'tall' | 'blossom')[] = ['round', 'tall']) {
  let placed = 0;
  for (let i = 0; i < n * 4 && placed < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r;
    const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
    if (busy(tx, tz, 3)) continue;
    placed++;
    P.tree(k, tx, tz, rng.range(0.9, 1.45), ground(tx, tz) - 0.1, rng.pick(kinds));
    if (rng.chance(0.45)) on(k, tx + rng.range(-2, 2), tz + rng.range(-2, 2), () => P.bush(k, 0, 0, rng.range(0.7, 1.2), PAL.leaf, rng.chance(0.3)));
  }
}

/** Hedge / stone wall / fence that follows the ground in short segments. */
export function groundLine(k: Kit, kind: 'hedge' | 'wall' | 'fence', x1: number, z1: number, x2: number, z2: number, seg = 3) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(L / seg));
  for (let i = 0; i < n; i++) {
    const ax = x1 + ((x2 - x1) * i) / n, az = z1 + ((z2 - z1) * i) / n;
    const bx = x1 + ((x2 - x1) * (i + 1)) / n, bz = z1 + ((z2 - z1) * (i + 1)) / n;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const y = Math.min(ground(ax, az), ground(bx, bz), ground(mx, mz)) - 0.05;
    k.push(0, y, 0);
    const ext = 0.12; // overlap segments slightly so there are no gaps
    const ux = (bx - ax) / (L / n), uz = (bz - az) / (L / n);
    if (kind === 'hedge') P.hedge(k, ax - ux * ext, az - uz * ext, bx + ux * ext, bz + uz * ext, 1.6);
    else if (kind === 'wall') P.stoneWall(k, ax - ux * ext, az - uz * ext, bx + ux * ext, bz + uz * ext, 1.1);
    else P.fence(k, ax, az, bx, bz);
    k.pop();
  }
}

/** Grass tufts, flowers and pebbles over an area (no collision). */
export function dressing(k: Kit, rng: Rng, x: number, z: number, r: number, n: number, skipPlaces = false) {
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r;
    const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
    if (Math.hypot(tx, tz) > islandRadius(Math.atan2(tz, tx)) - 2 || roadDist(tx, tz) < 1.8) continue;
    if (skipPlaces && POIS.some((p) => Math.hypot(tx - p.x, tz - p.z) < p.r - 2)) continue;
    const y = ground(tx, tz);
    if (rng.chance(0.12)) {
      k.push(0, y, 0);
      P.flowerPatch(k, tx, tz, 5, 0.9);
      k.pop();
      continue;
    }
    const c = rng.pick([PAL.grass, PAL.grassLight, PAL.grassDark]);
    for (let b = 0; b < 3; b++) k.cone(tx + rng.range(-0.15, 0.15), y + 0.16, tz + rng.range(-0.15, 0.15), 0.06, rng.range(0.3, 0.5), c, { batch: 'detail', wind: 1, segs: 3, yaw: rng.range(0, 6) });
  }
}

/** Plank rope-bridge between two points (walkable, with rails). */
export function ropeBridge(k: Kit, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, w = 1.4) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const yaw = Math.atan2(-(z2 - z1), x2 - x1);
  const n = Math.round(L / 0.5);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const sag = Math.sin(t * Math.PI) * Math.min(0.6, L * 0.03);
    const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t, y = y1 + (y2 - y1) * t - sag;
    k.push(x, y, z, yaw);
    k.box(0, 0, 0, L / n - 0.06, 0.08, w, i % 2 ? PAL.wood : PAL.woodLight, { ao: 0 });
    k.pop();
  }
  // walkable collider as a few straight pieces
  const pieces = 4;
  for (let i = 0; i < pieces; i++) {
    const t0 = i / pieces, t1 = (i + 1) / pieces;
    const s0 = Math.sin(t0 * Math.PI) * Math.min(0.6, L * 0.03), s1 = Math.sin(t1 * Math.PI) * Math.min(0.6, L * 0.03);
    const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0, ay = y1 + (y2 - y1) * t0 - s0;
    const bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1, by = y1 + (y2 - y1) * t1 - s1;
    const pl = Math.hypot(bx - ax, bz - az);
    const pitch = Math.atan2(by - ay, pl);
    k.cw.box((ax + bx) / 2, (ay + by) / 2 - 0.05, (az + bz) / 2, Math.hypot(pl, by - ay) + 0.05, 0.12, w, 'wood', yaw, 0, pitch);
  }
  // rope rails
  for (const s of [-1, 1]) {
    const ox = -Math.sin(yaw) * 0, oz = 0;
    void ox;
    void oz;
    k.push((x1 + x2) / 2, (y1 + y2) / 2 + 0.9, (z1 + z2) / 2, yaw);
    k.box(0, -Math.min(0.6, L * 0.03) * 0.6, (s * w) / 2, L, 0.05, 0.05, PAL.brownDark, { ao: 0 });
    k.collider(0, -0.4, (s * w) / 2, L, 1.0, 0.1, 'wood', { flags: 1 });
    k.pop();
  }
}

/** Stilts from the ground up to a platform height at (x, z) in world space. */
export function stilt(k: Kit, x: number, z: number, top: number, r = 0.18, color = PAL.brownDark) {
  const g = ground(x, z) - 0.3;
  const h = top - g;
  k.cyl(x, g + h / 2, z, r, r * 1.2, h, color, { col: 'wood', segs: 6 });
}

/** A plain box room/hall with wall() openings — returns nothing; zones set by caller. */
export const rng0 = new Rng(4242);

/**
 * A place's own frame: local +z points back toward the island centre (where its road comes in),
 * so layouts read the same whichever peninsula they sit on.
 */
export function placeFrame(X: number, Z: number) {
  const yaw = Math.atan2(-X, -Z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    yaw,
    /** local (x, z) -> world (x, z) */
    p: (lx: number, lz: number): [number, number] => [X + lx * c + lz * s, Z - lx * s + lz * c],
  };
}
