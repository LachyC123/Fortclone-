import { Kit } from './Kit';
import type { World } from './World';
import { DoorSpec } from './BuildingKit';
import { POIS } from './Heightmap';
import { buildWobblewood } from './pois/Wobblewood';
import { buildTumbleMarket } from './pois/TumbleMarket';
import { buildCrookedManor } from './pois/CrookedManor';
import { buildRattleworks } from './pois/Rattleworks';
import { buildCrashCove } from './pois/CrashCove';
import { buildWilds } from './pois/Wilds';
import { buildPuddleby } from './pois/Puddleby';
import { buildTickerton } from './pois/Tickerton';
import { buildSnoozyPines } from './pois/SnoozyPines';
import { buildSaltwhistle } from './pois/Saltwhistle';
import { buildRumpusFair } from './pois/RumpusFair';
import { buildHomesteads } from './pois/Homesteads';

/**
 * MILESTONE 4 — the whole island around Buttonbury: five more places plus the wild land between
 * them. Outdoor place zones are added last so buildings (added by their builders) win lookups.
 */
export function buildIsland(k: Kit, world: World, doors: DoorSpec[]) {
  buildWobblewood(k, world);
  buildTumbleMarket(k, world, doors);
  buildCrookedManor(k, world, doors);
  buildRattleworks(k, world, doors);
  buildCrashCove(k, world, doors);
  // the peninsulas (bigger island)
  buildPuddleby(k, world, doors);
  buildTickerton(k, world, doors);
  buildSnoozyPines(k, world, doors);
  buildSaltwhistle(k, world, doors);
  buildRumpusFair(k, world, doors);
  buildWilds(k, world, doors);
  // lone homesteads go last so they can see everything else and keep clear of it
  buildHomesteads(k, world, doors);
  for (const p of POIS) world.addZone(p.name, p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r, -10, 40, false);
}
