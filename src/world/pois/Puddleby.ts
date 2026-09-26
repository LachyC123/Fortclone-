import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { barn, shed, tower, signPost } from '../Homes';
import { ground, cottage, crateG, lootG, groundLine, placeFrame, dressing } from './common';

/**
 * PUDDLEBY FARM — out on the north-west peninsula. A creaky windmill you can climb (sniper's
 * dream, very visible), the farmhouse, a big barn, a coop, a silo and a duck pond, all boxed in
 * by fences and an orchard. Lots of mid-range fights across the yard.
 */
export function buildPuddleby(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(5150);
  const C = POI_BY_ID.puddleby;
  const F = placeFrame(C.x, C.z);
  const at = F.p;

  // farmhouse (two storeys) facing the yard
  {
    const [x, z] = at(-8, -5);
    cottage(k, world, doors, { name: 'Puddleby House', sub: 'Farmhouse', x, z, yaw: F.yaw, w: 8, d: 6, floors: 2, wall: 0xf4e7c8, roof: PAL.roofRed, shutters: PAL.teal, seed: 51 });
  }
  // the windmill: four floors up, sails turning
  {
    const [x, z] = at(9, -9);
    tower(k, world, doors, { name: 'Puddleby Windmill', x, z, yaw: F.yaw, seed: 52, levels: 3, top: 'windmill', wallColor: 0xe8dcc8, roof: 0x8a5a3b, size: 5.4, surface: 'wood' });
  }
  // big barn across the yard, arches facing the pond
  {
    const [x, z] = at(-9, 9);
    barn(k, world, { name: 'Puddleby Barn', x, z, yaw: F.yaw + Math.PI / 2, seed: 53 });
  }
  // chicken coop and tool shed
  {
    const [x, z] = at(9, 6);
    shed(k, world, doors, { name: 'Chicken Coop', x, z, yaw: F.yaw - Math.PI / 2, seed: 54, w: 3.8, d: 3.0, color: 0xf2c14e, roof: PAL.roofRed });
  }
  {
    const [x, z] = at(15, -1);
    shed(k, world, doors, { name: 'Tool Shed', x, z, yaw: F.yaw - Math.PI / 2, seed: 55, color: 0x8fb8a8 });
  }

  // the duck pond (you can wade through it; stones around the edge are cover)
  {
    const [x, z] = at(2, 2);
    const y = ground(x, z);
    world.addWater(x, y + 0.06, z, 6, 4.5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * 3.6 + rng.range(-0.3, 0.3), pz = z + Math.sin(a) * 2.9 + rng.range(-0.3, 0.3);
      P.rock(k, px, ground(px, pz) + 0.1, pz, rng.range(0.35, 0.6), PAL.stone, i % 3 === 0);
    }
    for (let i = 0; i < 3; i++) world.addKickable(x + rng.range(-2, 2), y + 0.1, z + rng.range(-1.5, 1.5), 'bucket');
  }

  // grain silo (hard cover, landmark)
  {
    const [x, z] = at(14, 9);
    const y = ground(x, z) - 0.2;
    k.cyl(x, y + 4.2, z, 1.7, 1.7, 8.4, 0xd8d0c0, { col: 'metal', segs: 14 });
    for (let i = 1; i < 6; i++) k.cyl(x, y + i * 1.5, z, 1.74, 1.74, 0.1, 0xa8a090, { segs: 14 });
    k.cone(x, y + 9.2, z, 1.9, 1.6, PAL.roofRed, { segs: 14 });
  }

  // fences round the yard, gate toward the road
  {
    const pts: [number, number][] = [[-15, -12], [-15, 15], [-3, 15]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = at(...pts[i]);
      const [bx, bz] = at(...pts[i + 1]);
      groundLine(k, 'fence', ax, az, bx, bz, 2.5);
    }
    const [cx1, cz1] = at(3, 15), [cx2, cz2] = at(16, 15);
    groundLine(k, 'fence', cx1, cz1, cx2, cz2, 2.5);
  }

  // orchard behind the farmhouse
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const [x, z] = at(-14 + i * 4 + rng.range(-0.4, 0.4), -14 - j * 3.5);
      P.tree(k, x, z, rng.range(0.8, 1.0), ground(x, z) - 0.1, 'blossom');
    }
  }
  // hay, carts, a trough
  for (const [lx, lz] of [[-2, 11], [0, 12.5], [5, -2], [-2, -12]] as [number, number][]) {
    const [x, z] = at(lx, lz);
    k.push(0, ground(x, z) - 0.05, 0);
    P.hayBale(k, x, z, rng.range(0, 3));
    k.pop();
  }
  {
    const [x, z] = at(4, 12);
    k.push(0, ground(x, z) - 0.05, 0);
    P.cart(k, x, z, F.yaw + 0.6);
    k.pop();
  }
  for (let i = 0; i < 5; i++) {
    const [x, z] = at(rng.range(-12, 12), rng.range(-2, 12));
    world.addKickable(x, ground(x, z), z, rng.chance(0.5) ? 'pumpkin' : 'bucket');
  }

  // loot in the open yard + a couple of crates
  for (const [lx, lz, kind] of [[0, 8, 'weapon'], [-3, -1, 'any'], [12, 2, 'weapon'], [-13, 3, 'any']] as [number, number, 'weapon' | 'any'][]) {
    const [x, z] = at(lx, lz);
    lootG(world, x, z, kind);
  }
  {
    const [x, z] = at(6, 13);
    crateG(world, x, z, rng.range(0, 3));
    const [x2, z2] = at(-12, -9);
    crateG(world, x2, z2, rng.range(0, 3));
  }
  {
    const [x, z] = at(0, -16);
    buildNest(k, world, x, z, ground(x, z));
  }
  {
    const [x, z] = at(1.5, 17);
    signPost(k, world, x, ground(x, z), z, 'PUDDLEBY FARM', F.yaw, 'fresh eggs · no ducking');
  }
  dressing(k, rng, C.x, C.z, 19, 160);
}
