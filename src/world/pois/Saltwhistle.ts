import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { barn, shed, tower, signPost } from '../Homes';
import { ground, cottage, crateG, lootG, placeFrame, lowGround } from './common';

/**
 * SALTWHISTLE WHARF — a fishing village on the south-east cliffs. A row of whitewashed fisher
 * cottages along the edge, a big blue boathouse, net sheds, boats up on trestles, a harbour
 * master's lookout and a cargo crane swinging over the drop.
 */
export function buildSaltwhistle(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(4747);
  const C = POI_BY_ID.wharf;
  const F = placeFrame(C.x, C.z);
  const at = F.p;

  // fisher cottages along the cliff, facing inland
  const cots: [number, number, 1 | 2, number, number, string][] = [
    [-10, -10, 2, PAL.roofBlue, PAL.softBlue, 'Gull Cottage'],
    [0, -11, 1, PAL.roofTeal, PAL.terracotta, 'Kipper House'],
    [10, -10, 2, PAL.roofRed, PAL.teal, 'Anchor Cottage'],
  ];
  cots.forEach(([lx, lz, fl, roof, sh, name], i) => {
    const [x, z] = at(lx, lz);
    cottage(k, world, doors, { name, sub: 'Saltwhistle', x, z, yaw: F.yaw, w: 7, d: 5.6, floors: fl, wall: i === 1 ? 0xf2e6d0 : 0xffffff, roof, shutters: sh, seed: 470 + i });
  });
  // the boathouse (open at both ends)
  {
    const [x, z] = at(-10, 6);
    barn(k, world, { name: 'Boathouse', x, z, yaw: F.yaw + Math.PI / 2, seed: 480, color: 0x4f7fb8 });
  }
  // net sheds & the smokehouse
  for (const [lx, lz, ly, name, col] of [[5, 3, -Math.PI / 2, 'Net Shed', 0x8fb8a8], [5, 9, -Math.PI / 2, 'Bait Shed', 0xc9a06a], [-2, 13, 0, 'Smokehouse', 0x9a8a7a]] as [number, number, number, string, number][]) {
    const [x, z] = at(lx, lz);
    shed(k, world, doors, { name, x, z, yaw: F.yaw + ly, seed: 490 + Math.round(lz), color: col });
    if (name === 'Smokehouse') world.addSmoke(new THREE.Vector3(x, ground(x, z) + 4.3, z));
  }
  // harbour master's lookout
  {
    const [x, z] = at(13, 4);
    tower(k, world, doors, { name: "Harbour Master's", x, z, yaw: F.yaw - Math.PI / 2, seed: 495, levels: 2, top: 'lookout', wallColor: 0xf4f0e8, roof: PAL.roofRed, size: 5.0 });
  }
  // boats up on trestles: chunky cover in the yard
  for (const [lx, lz, ly, col] of [[-2, 1, 0.3, 0xd9774f], [1, 6, -0.2, 0x4f7fb8], [-5, -3, 1.2, 0xf2c14e]] as [number, number, number, number][]) {
    const [x, z] = at(lx, lz);
    const y = lowGround(x, z, 2) + 0.9;
    const yaw = F.yaw + ly;
    k.push(x, y, z, yaw);
    k.sphere(0, 0, 0, 1, col, { sx: 1.0, sy: 0.55, sz: 2.6, col: 'wood' });
    k.box(0, 0.35, 0, 1.7, 0.12, 4.2, 0xa87248);
    for (const sz of [-1.3, 1.3]) {
      k.box(-0.6, -0.55, sz, 0.14, 0.9, 0.14, PAL.brownDark);
      k.box(0.6, -0.55, sz, 0.14, 0.9, 0.14, PAL.brownDark);
    }
    k.pop();
  }
  // crane on the cliff edge with a crate dangling over the drop
  {
    const [x, z] = at(0, -17);
    const y = ground(x, z);
    k.box(x, y + 3.5, z, 0.6, 7, 0.6, 0x5a6a7a, { col: 'metal' });
    k.push(x, y + 7, z, F.yaw);
    k.box(0, 0, -2.2, 0.4, 0.4, 6, 0x5a6a7a);
    k.box(0, -1.6, -5, 0.03, 3.2, 0.03, PAL.ink, { batch: 'nocast' });
    P.crate(k, 0, -4.3, -5, 1.0, 0.3, PAL.mustard);
    k.pop();
  }
  // lobster pots, barrels, nets (low cover)
  for (let i = 0; i < 14; i++) {
    const [x, z] = at(rng.range(-15, 15), rng.range(-6, 15));
    if (Math.hypot(x - at(-10, 6)[0], z - at(-10, 6)[1]) < 5.5) continue;
    const y = ground(x, z);
    if (rng.chance(0.5)) P.barrel(k, x, y, z, rng.pick([PAL.teal, 0x4f7fb8, PAL.terracotta]));
    else P.crate(k, x, y, z, rng.range(0.6, 0.9), rng.range(0, 1), rng.pick([PAL.woodLight, 0x8fb8a8]));
  }
  for (const side of [-1, 1]) {
    const [ax, az] = at(side * 3, 16), [bx, bz] = at(side * 9, 16);
    k.push(0, ground(ax, az), 0);
    P.washingLine(k, ax, az, bx, bz);
    k.pop();
  }
  for (let i = 0; i < 5; i++) {
    const [x, z] = at(rng.range(-12, 12), rng.range(-5, 14));
    world.addKickable(x, ground(x, z), z, rng.pick(['bucket', 'box', 'bottle'] as const));
  }

  for (const [lx, lz, kind] of [[0, 0, 'weapon'], [-6, 12, 'any'], [9, 14, 'weapon'], [-14, -2, 'any']] as [number, number, 'weapon' | 'any'][]) {
    const [x, z] = at(lx, lz);
    lootG(world, x, z, kind);
  }
  {
    const [x, z] = at(4, -5);
    crateG(world, x, z, F.yaw);
  }
  {
    const [x, z] = at(15, 13);
    buildNest(k, world, x, z, ground(x, z));
  }
  {
    const [x, z] = at(-3.5, 17.5);
    signPost(k, world, x, ground(x, z), z, 'SALTWHISTLE WHARF', F.yaw, 'fresh-ish fish');
  }
}
