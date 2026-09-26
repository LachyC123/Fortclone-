import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec } from '../BuildingKit';
import { ColFlags } from '../../physics/Collision';
import { islandRadius, STREAM_X, STREAM_Z0, STREAM_Z1, LAGOON_POS } from '../Heightmap';
import { cabin, shed, tower } from '../Homes';
import { ground, cottage, busy, lowGround, highGround, groundLine, lootG } from './common';

const NAMES = [
  'Bramble Cottage', 'Hollyhock House', 'Thistledown', 'Old Mill Cabin', 'Dewdrop Cottage', 'Nettlebed',
  'Foxglove Farm', 'Crumpet Cottage', 'Hunter’s Rest', 'Woolly Nook', 'Pebble Cottage', 'Toadstool Lodge',
  'Mossy Cabin', 'Buttercup House', 'Hedgepig Hut', 'Owl’s Perch', 'Clover Cottage', 'Wobbly Ruin', 'Gorse Hut', 'Puddle End',
];
const WALLS = [0xf4e7c8, 0xf2d0b0, 0xd8e8d0, 0xf0d8e0, 0xe8e0c8, 0xc8d8e8];
const ROOFS = [PAL.roofRed, PAL.roofBlue, PAL.roofTeal, PAL.roofPurple, 0x6a5a4a];

/**
 * Lone farmsteads, cabins, huts and the odd ruined tower dotted over the open land between the
 * named places, so every stretch of the island has somewhere to loot and somewhere to hide.
 * Spots are chosen on fairly flat, clear ground away from roads, places and the stream.
 */
export function buildHomesteads(k: Kit, world: World, doors: DoorSpec[], count = 22) {
  const rng = new Rng(2468);
  const placed: [number, number][] = [];
  const clear = (x: number, z: number, r: number) => {
    if (busy(x, z, r + 3.5, r + 3)) return false;
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - r - 5) return false;
    if (Math.abs(x - STREAM_X) < r + 7 && z > STREAM_Z0 - 6 && z < STREAM_Z1 + 6) return false;
    if (Math.hypot(x - LAGOON_POS.x, z - LAGOON_POS.z) < LAGOON_POS.r + r + 6) return false;
    if (highGround(x, z, r) - lowGround(x, z, r) > 1.6) return false;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 17)) return false;
    // nothing solid already there (outcrops, walls, trees, other buildings)
    const gy = ground(x, z);
    const hits = k.cw.query(x - r - 1.5, gy + 0.3, z - r - 1.5, x + r + 1.5, gy + 6, z + r + 1.5, ColFlags.BlocksMove);
    return !hits.some((o) => o.tag !== 'ground' && o.tag !== 'boundary');
  };
  let n = 0;
  for (let tries = 0; tries < 4000 && n < count; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.range(0.12, 1)) * (islandRadius(a) - 8);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const kind = rng.next();
    const r = kind < 0.45 ? 5 : kind < 0.7 ? 4.5 : kind < 0.93 ? 3 : 3.5;
    if (!clear(x, z, r)) continue;
    placed.push([x, z]);
    // face roughly toward the island centre, with a little wonk
    const yaw = Math.atan2(-x, -z) + rng.range(-0.6, 0.6);
    const name = NAMES[n % NAMES.length];
    if (kind < 0.45) {
      cottage(k, world, doors, { name, sub: 'Homestead', x, z, yaw, w: rng.pick([6.5, 7, 7.5]), d: rng.pick([5.2, 5.6, 6]), floors: rng.chance(0.4) ? 2 : 1, wall: rng.pick(WALLS), roof: rng.pick(ROOFS), shutters: rng.pick([PAL.teal, PAL.softBlue, PAL.terracotta, PAL.lavender]), seed: 2400 + n });
      yard(k, world, rng, x, z, yaw, 5.5);
    } else if (kind < 0.7) {
      cabin(k, world, doors, { name, x, z, yaw, seed: 2500 + n, loft: rng.chance(0.4) });
      yard(k, world, rng, x, z, yaw, 5);
    } else if (kind < 0.93) {
      shed(k, world, doors, { name, x, z, yaw, seed: 2600 + n });
      // huts come in pairs sometimes (a workshop and a store)
      const ox = x + Math.cos(yaw) * 5, oz = z - Math.sin(yaw) * 5;
      if (rng.chance(0.5) && clear(ox, oz, 2.5)) shed(k, world, doors, { x: ox, z: oz, yaw: yaw + Math.PI / 2, seed: 2650 + n });
    } else {
      tower(k, world, doors, { name, x, z, yaw, seed: 2700 + n, levels: 2, top: 'battlements', wallColor: 0xb0a594, size: 5.2 });
    }
    n++;
  }
  return n;
}

/** A bit of garden: fence, woodpile or veg patch, a barrel, maybe loot outside. */
function yard(k: Kit, world: World, rng: Rng, x: number, z: number, yaw: number, r: number) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const w = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  if (rng.chance(0.6)) {
    const [ax, az] = w(-r, r + 2.5), [bx, bz] = w(-1.5, r + 2.5);
    groundLine(k, 'fence', ax, az, bx, bz, 2.5);
  }
  if (rng.chance(0.5)) {
    const [px, pz] = w(r + 1.5, -1);
    k.push(0, ground(px, pz), 0);
    P.barrel(k, px, 0, pz, rng.pick([PAL.wood, PAL.teal, PAL.terracotta]));
    k.pop();
  }
  if (rng.chance(0.5)) {
    const [hx, hz] = w(-r - 1.5, 0);
    k.push(0, ground(hx, hz) - 0.05, 0);
    P.hayBale(k, hx, hz, yaw);
    k.pop();
  }
  if (rng.chance(0.4)) {
    const [lx, lz] = w(r + 1.2, r + 1);
    lootG(world, lx, lz, 'any');
  }
}
