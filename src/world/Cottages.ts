import * as THREE from 'three';
import { Kit } from './Kit';
import type { World } from './World';
import { DoorSpec, WallStyle, wall, floor, stairs, gableRoof, shade } from './BuildingKit';
import * as P from './Props';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { Rng } from '../core/math';
import { makeSign } from './Signs';

export interface CottageSpec {
  name: string;
  sub: string;
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  floors: 1 | 2;
  wall: number;
  roof: number;
  shutters: number;
  seed: number;
  /** ground level (defaults to 0) */
  y?: number;
}

/**
 * A generator for enterable cottages. Every one gets a real door, windows the Blinkbug can
 * fly through, furniture, and (for two-storey ones) stairs and an upstairs room.
 */
export function buildCottage(k: Kit, world: World, doors: DoorSpec[], c: CottageSpec) {
  const rng = new Rng(c.seed);
  const H1 = 3.0, H2 = 2.8;
  const hw = c.w / 2, hd = c.d / 2;
  const style: WallStyle = { outer: c.wall, inner: shade(c.wall, 1.08), trim: PAL.brown, surface: 'wood', beams: rng.chance(0.5) ? PAL.brownDark : undefined, plinth: PAL.stoneDark };
  const inner: WallStyle = { outer: 0xefe0c4, inner: 0xefe0c4, trim: PAL.brown, surface: 'wood', thickness: 0.2 };
  const Y = c.y ?? 0;
  k.push(c.x, Y, c.z, c.yaw);
  // foundation skirt so houses on uneven ground never float
  k.box(0, -0.9, 0, c.w + 0.2, 1.8, c.d + 0.2, PAL.stoneDark, { col: 'stone' });
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, rng.pick([0xc08a5a, 0xa87248, 0xd8c8b0]), 'wood');
  const doorAt = c.w * rng.range(0.35, 0.65);
  const win = (at: number, big = false) => ({ at, w: big ? 1.3 : 1.0, h: big ? 1.2 : 1.0, sill: 1.0, shutters: rng.chance(0.7) ? c.shutters : undefined, flowers: rng.chance(0.5) });
  const front = [{ at: doorAt, w: 1.25, h: 2.3, kind: 'door' as const }];
  if (doorAt > 2.2) front.push(win(doorAt - 1.9, true) as never);
  if (c.w - doorAt > 2.2) front.push(win(doorAt + 1.9) as never);
  wall(k, -hw, hd, hw, hd, 0, H1, style, front, 1, doors);
  wall(k, hw, hd, hw, -hd, 0, H1, style, [win(c.d / 2)]);
  wall(k, hw, -hd, -hw, -hd, 0, H1, style, [{ at: c.w * 0.2, w: 1.1, h: 2.2, kind: 'door' }, win(c.w * 0.72)], 1, doors);
  wall(k, -hw, -hd, -hw, hd, 0, H1, style, [win(c.d / 2, true)]);
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) k.box(x, (H1 + (c.floors === 2 ? H2 : 0)) / 2, z, 0.38, H1 + (c.floors === 2 ? H2 : 0), 0.38, PAL.brownDark, { col: 'wood' });

  // ground floor furniture (kept to the edges so there's room to fight inside)
  k.beginInterior();
  P.rug(k, 0, 0.05, 0, c.w * 0.45, c.d * 0.4, rng.pick([PAL.terracotta, PAL.teal, PAL.lavender, PAL.mustard]));
  P.table(k, -hw + 1.4, 0.05, hd - 1.4, 0, 1.2, 0.8, rng.pick([PAL.wood, PAL.woodLight]));
  P.chair(k, -hw + 1.4, 0.05, hd - 0.7, Math.PI);
  P.chair(k, -hw + 0.7, 0.05, hd - 1.4, Math.PI / 2);
  if (rng.chance(0.6)) P.bookshelf(k, hw - 0.35, 0.05, 0.2, -Math.PI / 2, 1.2, 1.9);
  else P.stove(k, hw - 0.6, 0.05, 0.4, -Math.PI / 2);
  P.plant(k, hw - 0.5, 0.05, hd - 0.5, rng.range(0.8, 1.2));
  P.lamp(k, -hw + 0.5, 0.05, 0.2, rng.pick([PAL.mustard, PAL.pink, PAL.softBlue]));
  P.crate(k, hw - 0.8, 0.05, -hd + 0.8, 0.7, rng.range(0, 1));
  P.picture(k, 0, 1.9, -hd + 0.17, 0, 0.7, 0.5, rng.pick([PAL.softBlue, PAL.pink, PAL.mustard]));
  k.endInterior();

  if (c.floors === 2) {
    // stairs along the back wall, upstairs bedroom
    const run = 3.6;
    stairs(k, -hw + 0.4, 0, -hd + 0.75, 0, 1.1, H1, run, 0xa87248, PAL.brownDark);
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H1, 0.24, 0xb58052, 'wood', [-hw + 0.3, -hd + 0.15, -hw + 0.4 + run + 0.05, -hd + 1.35], shade(c.wall, 1.05));
    k.collider(-hw + 0.4 + run / 2, H1 + 0.45, -hd + 1.42, run, 0.9, 0.1, 'wood', { flags: ColFlags.BlocksMove });
    k.box(-hw + 0.4 + run / 2, H1 + 0.9, -hd + 1.42, run, 0.07, 0.07, PAL.brownDark);
    wall(k, -hw, hd, hw, hd, H1, H2, style, [win(c.w * 0.3), win(c.w * 0.72)]);
    wall(k, hw, hd, hw, -hd, H1, H2, style, [win(c.d / 2)]);
    wall(k, hw, -hd, -hw, -hd, H1, H2, style, [win(c.w * 0.5)]);
    wall(k, -hw, -hd, -hw, hd, H1, H2, style, [win(c.d * 0.6)]);
    k.push(0, H1, 0);
    k.beginInterior();
    P.bed(k, hw - 1.0, 0, hd - 1.4, 0, rng.pick([PAL.lavender, PAL.softBlue, PAL.pink]));
    P.wardrobe(k, -hw + 0.7, 0, hd - 0.6, Math.PI / 2, rng.pick([PAL.teal, PAL.lavender, PAL.mustard]));
    P.rug(k, 0, 0.02, 0.4, 2.2, 1.6, rng.pick([PAL.terracotta, PAL.teal]));
    P.crate(k, hw - 0.7, 0, -hd + 0.8, 0.6, 0.4, PAL.pink);
    k.endInterior();
    k.pop();
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H1 + H2, 0.24, 0x9a6a44, 'wood', undefined, shade(c.wall, 1.05));
    gableRoof(k, 0, H1 + H2, 0, 0, c.w + 0.4, c.d + 0.4, 2.2, c.roof, { overhang: 0.5, gableColor: c.wall, trim: PAL.brown });
    world.addZone(c.name, c.x - Math.max(hw, hd), c.z - Math.max(hw, hd), c.x + Math.max(hw, hd), c.z + Math.max(hw, hd), Y - 1, Y + H1 + H2 + 2, true);
  } else {
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H1 + 0.24, 0.24, 0x9a6a44, 'wood', undefined, shade(c.wall, 1.05));
    gableRoof(k, 0, H1 + 0.24, 0, 0, c.w + 0.4, c.d + 0.4, 2.0, c.roof, { overhang: 0.5, gableColor: c.wall, trim: PAL.brown });
    world.addZone(c.name, c.x - Math.max(hw, hd), c.z - Math.max(hw, hd), c.x + Math.max(hw, hd), c.z + Math.max(hw, hd), Y - 1, Y + H1 + 2, true);
  }
  const chimH = (c.floors === 2 ? H1 + H2 : H1) + 2.6;
  k.box(hw - 1.2, chimH - 1.2, -0.8, 0.7, 2.6, 0.7, PAL.terracottaDark, { col: 'stone' });
  const [sx, , sz] = k.w(hw - 1.2, 0, -0.8);
  world.addSmoke(new THREE.Vector3(sx, chimH + 0.3, sz));

  // front garden
  P.flowerPatch(k, -hw * 0.6, hd + 1.4, 6, 0.9);
  P.fence(k, hw * 0.2 + 0.8, hd + 2.2, hw + 0.3, hd + 2.2, rng.pick([PAL.cream, 0xffffff, PAL.softBlue]));
  if (rng.chance(0.5)) P.barrel(k, hw + 0.8, 0, hd - 0.6, rng.pick([PAL.wood, PAL.teal, PAL.terracotta]));
  k.pop();

  const sign = makeSign(c.name.toUpperCase(), { w: 1.9, h: 0.5, sub: c.sub, bg: '#fff6e6' });
  const [x, , z] = k.w(0, 0, 0);
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const lx = doorAt - hw - 1.4, lz = hd + 0.2;
  sign.position.set(c.x + lx * cs + lz * sn, Y + 2.55, c.z - lx * sn + lz * cs);
  sign.rotation.y = c.yaw;
  world.group.add(sign);
  void x;
  void z;
}

/** A Rift Nest: where a fleeing Blinkbug can rebuild its rascal (once per match). */
export function buildNest(k: Kit, world: World, x: number, z: number, y = 0) {
  k.push(x, y, z, 0);
  k.cyl(0, 0.2, 0, 2.3, 2.5, 0.4, PAL.stoneDark, { col: 'stone', segs: 16 });
  k.cyl(0, 0.42, 0, 2.0, 2.0, 0.06, 0x5b4bff, { segs: 16, batch: 'glow' });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    // curling stone horns around the rim
    k.push(Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1, -a);
    k.cone(0, 1.2, 0, 0.35, 2.4, 0x8a7a9a, { segs: 6, roll: 0.35 });
    k.sphere(0.4, 2.35, 0, 0.12, 0x9ffcff, { batch: 'glow' });
    k.pop();
  }
  k.collider(0, 0.2, 0, 4.4, 0.4, 4.4, 'stone');
  k.pop();
  // floating crystal + spinning rings (animated)
  const g = new THREE.Group();
  g.position.set(x, y + 1.8, z);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0x9ffcff }));
  crystal.scale.set(1, 1.6, 1);
  g.add(crystal);
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0 + i * 0.35, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: i ? 0x5b4bff : 0x6ff7ff, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2 + i * 0.5;
    g.add(ring);
  }
  world.addSpinner(g, 'y', 1.2);
  world.nests.push({ pos: new THREE.Vector3(x, y + 0.45, z), used: false, fx: g });
}
