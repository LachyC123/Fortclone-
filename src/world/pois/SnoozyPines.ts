import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec } from '../BuildingKit';
import { POI_BY_ID, islandRadius } from '../Heightmap';
import { buildNest } from '../Cottages';
import { cabin, tower, signPost } from '../Homes';
import { ground, crateG, lootG, placeFrame, lowGround } from './common';

/**
 * SNOOZY PINES — a campsite in a dark pine wood on the north-east peninsula. A two-storey lodge,
 * a ring of log cabins round a campfire, pup tents to hide behind and a rickety fire-lookout
 * tower. Trees everywhere: short sightlines, lots of ambushes.
 */
export function buildSnoozyPines(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(3131);
  const C = POI_BY_ID.pines;
  const F = placeFrame(C.x, C.z);
  const at = F.p;
  const footprints: [number, number, number][] = []; // local x, z, radius (keep trees off)

  {
    const [x, z] = at(0, -7);
    cabin(k, world, doors, { name: 'Snoozy Lodge', x, z, yaw: F.yaw, seed: 31, w: 8.4, d: 6.2, loft: true, roof: 0x3f5f4a });
    footprints.push([0, -6, 7]);
  }
  const cabins: [number, number, number, string][] = [
    [-11, -3, 0.9, 'Cabin No. 1'], [11, -3, -0.9, 'Cabin No. 2'], [-10, 8, 2.2, 'Cabin No. 3'], [10, 9, -2.3, 'Cabin No. 4'],
  ];
  cabins.forEach(([lx, lz, ly, name], i) => {
    const [x, z] = at(lx, lz);
    cabin(k, world, doors, { name, x, z, yaw: F.yaw + ly, seed: 32 + i, loft: i === 1, roof: [0x6a4a3a, 0x3f5f4a, 0x8a3a2a, 0x4a4a6a][i] });
    footprints.push([lx, lz, 5.5]);
  });
  {
    const [x, z] = at(13, -13);
    tower(k, world, doors, { name: 'Fire Lookout', x, z, yaw: F.yaw + 0.3, seed: 36, levels: 3, top: 'lookout', wallColor: 0x9a6440, roof: 0x8a3a2a, size: 5.0, surface: 'wood' });
    footprints.push([13, -13, 4.5]);
  }

  // campfire circle with log benches
  {
    const [x, z] = at(0, 3);
    const y = ground(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      P.rock(k, x + Math.cos(a) * 1.1, y + 0.05, z + Math.sin(a) * 1.1, 0.28, PAL.stoneDark, false);
    }
    k.cyl(x, y + 0.15, z, 0.1, 0.1, 1.2, PAL.brownDark, { roll: Math.PI / 2, segs: 6 });
    k.cyl(x, y + 0.15, z, 0.1, 0.1, 1.2, PAL.brownDark, { roll: Math.PI / 2, yaw: 1.2, segs: 6 });
    k.cone(x, y + 0.5, z, 0.45, 0.8, 0xffa040, { batch: 'glow', segs: 6 });
    world.addSmoke(new THREE.Vector3(x, y + 1, z));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const bx = x + Math.cos(a) * 3.2, bz = z + Math.sin(a) * 3.2;
      k.cyl(bx, lowGround(bx, bz, 1) + 0.3, bz, 0.3, 0.3, 2.4, 0x7a4a2e, { roll: Math.PI / 2, yaw: -a + Math.PI / 2, col: 'wood', segs: 8 });
    }
    footprints.push([0, 3, 4]);
  }
  // pup tents: soft cover you can crouch behind
  const tentCols = [0xf2c14e, 0xd9774f, 0x7fb7e6, 0x9bd65a];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.8;
    const lx = Math.cos(a) * 6.8, lz = 3 + Math.sin(a) * 5.2;
    const [x, z] = at(lx, lz);
    const y = lowGround(x, z, 1.2);
    const yaw = F.yaw - a;
    k.push(x, y, z, yaw);
    k.prism(0, 0, 0, 2.2, 1.4, 2.4, tentCols[i], { ao: 0.1 });
    k.collider(-0.55, 0.6, 0, 0.12, 1.3, 2.4, 'cloth', { roll: 0.66 });
    k.collider(0.55, 0.6, 0, 0.12, 1.3, 2.4, 'cloth', { roll: -0.66 });
    k.box(0, 0.02, 0, 1.8, 0.04, 2.2, 0x6a5a4a, { batch: 'nocast', ao: 0 });
    k.pop();
    footprints.push([lx, lz, 2]);
    if (i % 2 === 0) lootG(world, x, z, 'any');
  }
  // picnic tables and wood piles
  for (const [lx, lz] of [[5, 13], [-4, 14], [-15, 5], [16, 3]] as [number, number][]) {
    const [x, z] = at(lx, lz);
    P.table(k, x, ground(x, z), z, F.yaw + rng.range(-0.5, 0.5), 1.8, 0.9, 0x9a6440);
    footprints.push([lx, lz, 2]);
  }
  for (const [lx, lz] of [[-6, -13], [7, -12]] as [number, number][]) {
    const [x, z] = at(lx, lz);
    const y = ground(x, z);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4 - r; c++) k.cyl(x + (c - (3 - r) / 2) * 0.42, y + 0.22 + r * 0.38, z, 0.2, 0.2, 1.8, rng.chance(0.5) ? 0x9a6440 : 0x7a4a2e, { roll: Math.PI / 2, yaw: F.yaw, segs: 7, col: r === 0 ? 'wood' : undefined });
    footprints.push([lx, lz, 2]);
  }

  {
    const [x, z] = at(15, -2);
    buildNest(k, world, x, z, ground(x, z));
    footprints.push([15, -2, 3]);
  }
  // the pine wood: dense, but never inside a building or on a path
  let placed = 0;
  for (let i = 0; i < 400 && placed < 70; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(4, 27);
    const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
    if (footprints.some(([fx, fz, fr]) => Math.hypot(lx - fx, lz - fz) < fr + 1.2)) continue;
    if (lz > 12 && Math.abs(lx) < 3.5) continue; // the track in
    const [x, z] = at(lx, lz);
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - 3) continue;
    P.tree(k, x, z, rng.range(1.0, 1.6), ground(x, z) - 0.1, 'tall');
    placed++;
    if (rng.chance(0.25)) {
      k.push(0, ground(x + 1, z) , 0);
      P.bush(k, x + 1, z, rng.range(0.6, 1), PAL.leafDark);
      k.pop();
    }
  }
  for (let i = 0; i < 8; i++) {
    const [x, z] = at(rng.range(-16, 16), rng.range(-16, 16));
    k.push(0, ground(x, z), 0);
    P.mushroom(k, x, z, rng.range(0.5, 1.1), rng.pick([PAL.terracotta, PAL.mustard, 0xb49be0]));
    k.pop();
  }

  for (const [lx, lz, kind] of [[0, 9, 'weapon'], [-5, -1, 'weapon'], [15, 11, 'any']] as [number, number, 'weapon' | 'any'][]) {
    const [x, z] = at(lx, lz);
    lootG(world, x, z, kind);
  }
  {
    const [x, z] = at(-14, -12);
    crateG(world, x, z, F.yaw);
  }
  {
    const [x, z] = at(3, 17);
    signPost(k, world, x, ground(x, z), z, 'SNOOZY PINES', F.yaw, 'quiet hours: never');
  }
}
