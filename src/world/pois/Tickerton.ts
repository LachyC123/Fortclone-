import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, shade } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { townhouse, tower, shed, signPost } from '../Homes';
import { ground, crateG, lootG, placeFrame } from './common';

const FRONTS = [0xf4e7c8, 0xf2b5a0, 0xa8d0c8, 0xf2d58a, 0xc8b8e0, 0xe8c8a8, 0xb8d8a0, 0xf0c0c8];
const ROOFS = [PAL.roofBlue, PAL.roofRed, PAL.roofTeal, PAL.roofPurple, 0x6a5a4a];
const NAMES = ['No. 1 Tick Lane', 'No. 2 Tick Lane', 'No. 3 Tick Lane', 'No. 4 Tick Lane', 'No. 5 Tock Row', 'No. 6 Tock Row', 'No. 7 Tock Row', 'The Pie Shop', 'Tock Row Books', 'Gearwright & Son'];

/**
 * TICKERTON — the densest place on the island, out on the north peninsula. Two terraces of tall,
 * skinny townhouses face each other across a cobbled high street that ends at a clock tower.
 * Three floors, back doors onto the alleys, windows everywhere: close-quarters chaos.
 */
export function buildTickerton(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(9090);
  const C = POI_BY_ID.tickerton;
  const F = placeFrame(C.x, C.z);
  const at = F.p;
  let n = 0;

  // cobbled high street
  for (let i = 0; i < 150; i++) {
    const lx = rng.range(-3, 3), lz = rng.range(-12, 16);
    const [x, z] = at(lx, lz);
    k.box(x, ground(x, z) + 0.03, z, rng.range(0.7, 1.1), 0.06, rng.range(0.7, 1.1), shade(PAL.cobble, rng.range(0.88, 1.06)), { batch: 'nocast', ao: 0, yaw: rng.range(0, 1.5) });
  }

  // west terrace faces east (+x), east terrace faces west; an alley splits the east side
  const row = (side: 1 | -1, zs: number[]) => {
    for (const lz of zs) {
      const [x, z] = at(side * -6.5, lz);
      const floors = rng.chance(0.55) ? 3 : 2;
      const shop = n % 3 === 1;
      townhouse(k, world, doors, {
        name: NAMES[n % NAMES.length], x, z, yaw: F.yaw + (side * Math.PI) / 2, seed: 900 + n, w: 5.4, d: 6.6,
        floors, wallColor: FRONTS[n % FRONTS.length], roof: ROOFS[n % ROOFS.length], sideWindows: false, shopfront: shop,
      });
      n++;
    }
  };
  row(1, [-9, -3.6, 1.8, 7.2]);
  row(-1, [-9, -3.6, 7.2]);
  // the end-of-terrace houses get side windows (a corner to peek from)
  {
    const [x, z] = at(6.5, 12.6);
    townhouse(k, world, doors, { name: 'Corner House', x, z, yaw: F.yaw - Math.PI / 2, seed: 990, floors: 3, wallColor: 0xf2d58a, roof: PAL.roofTeal, sideWindows: true });
  }

  // the clock tower closes the street
  {
    const [x, z] = at(0, -16);
    tower(k, world, doors, { name: 'Tickerton Clock', x, z, yaw: F.yaw, seed: 991, levels: 4, top: 'clock', wallColor: 0xd8c8a8, roof: PAL.roofBlue, size: 5.4 });
  }

  // back alleys: sheds, bins, crates, washing lines
  for (const [lx, lz, name] of [[-13, -6, 'Coal Store'], [13, -8, 'Bike Shed'], [13, 5, 'Allotment Shed']] as [number, number, string][]) {
    const [x, z] = at(lx, lz);
    shed(k, world, doors, { name, x, z, yaw: F.yaw + (lx < 0 ? Math.PI / 2 : -Math.PI / 2), seed: 700 + Math.round(lz * 10), w: 3.4, d: 3 });
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const [x, z] = at(side * rng.range(10.5, 12), rng.range(-12, 12));
    const y = ground(x, z);
    if (rng.chance(0.5)) P.barrel(k, x, y, z, rng.pick([PAL.teal, 0x6a7a8a, PAL.terracotta]));
    else P.crate(k, x, y, z, rng.range(0.8, 1.1), rng.range(0, 1));
  }
  for (const side of [-1, 1]) {
    const [ax, az] = at(side * 11, -12), [bx, bz] = at(side * 11, -2);
    k.push(0, ground(ax, az), 0);
    P.washingLine(k, ax, az, bx, bz);
    k.pop();
  }

  // street furniture: lamp posts, benches, a fountain where the road comes in
  for (const lz of [-11, -4, 3, 10]) {
    for (const side of [-1, 1]) {
      const [x, z] = at(side * 2.7, lz);
      k.push(0, ground(x, z), 0);
      P.lampPost(k, x, z, F.yaw);
      k.pop();
    }
  }
  {
    const [x, z] = at(0, 14);
    const y = ground(x, z);
    k.cyl(x, y + 0.35, z, 2.2, 2.4, 0.7, PAL.stone, { col: 'stone', segs: 16 });
    k.cyl(x, y + 0.62, z, 1.9, 1.9, 0.06, PAL.water, { segs: 16 });
    k.cyl(x, y + 1.3, z, 0.35, 0.5, 1.6, PAL.stoneDark, { col: 'stone', segs: 10 });
    k.sphere(x, y + 2.3, z, 0.45, PAL.mustard);
    world.addSmoke(new THREE.Vector3(x, y + 2.4, z));
  }
  for (const [lx, lz] of [[-2.2, -7], [2.2, 5]] as [number, number][]) {
    const [x, z] = at(lx, lz);
    k.push(0, ground(x, z), 0);
    P.bench(k, x, z, F.yaw + (lx < 0 ? Math.PI / 2 : -Math.PI / 2));
    k.pop();
  }
  // bunting across the street
  for (const lz of [-6, 4]) {
    const [ax, az] = at(-3.2, lz), [bx, bz] = at(3.2, lz);
    P.bunting(k, ax, ground(ax, az) + 5.2, az, bx, ground(bx, bz) + 5.2, bz, 0.6);
  }
  for (let i = 0; i < 6; i++) {
    const [x, z] = at(rng.range(-2.5, 2.5), rng.range(-12, 12));
    world.addKickable(x, ground(x, z), z, rng.pick(['box', 'bottle', 'bucket'] as const));
  }

  // loot on the street and crates in the alleys
  for (const [lx, lz, kind] of [[0, -2, 'weapon'], [0, 9, 'any'], [-11, 4, 'weapon'], [11, -2, 'any'], [11, 10, 'weapon']] as [number, number, 'weapon' | 'any'][]) {
    const [x, z] = at(lx, lz);
    lootG(world, x, z, kind);
  }
  {
    const [x, z] = at(-11.5, -11);
    crateG(world, x, z, F.yaw);
    const [x2, z2] = at(11.5, 12);
    crateG(world, x2, z2, F.yaw);
  }
  {
    const [x, z] = at(-12, 12);
    buildNest(k, world, x, z, ground(x, z));
  }
  {
    const [x, z] = at(4.5, 17.5);
    signPost(k, world, x, ground(x, z), z, 'TICKERTON', F.yaw, 'mind the time');
  }
}
