import * as THREE from 'three';
import { Kit } from './Kit';
import type { World } from './World';
import { DoorSpec, WallStyle, wall, floor, stairs, gableRoof, shade } from './BuildingKit';
import * as P from './Props';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { buildTerrain, buildSkyRocks, islandRadius, STREAM_X } from './Terrain';
import { makeSign } from './Signs';
import { Rng } from '../core/math';
import { toyMaterial } from '../render/Materials';

/**
 * MILESTONE 1 — "The Combat Playground": one polished corner of Buttonbury on a floating island.
 *
 *  - Pickle House: 2 floors + secret attic, balcony, stairs, real doors & windows (Blinkbug routes)
 *  - Crumb & Co. bakery: enterable shop with counter and oven
 *  - Old Tock clock tower: a blink-only balcony with a bell you can ring by shooting it
 *  - Town square with well, market stalls, cover; meadow, windmill, shed, stream + bridge,
 *    waterfalls pouring off the island edge.
 */

const rng = new Rng(1337);

const HOUSE: WallStyle = { outer: PAL.cream, inner: 0xe9d3a8, trim: PAL.brown, surface: 'wood', beams: PAL.brownDark, plinth: PAL.stoneDark };
const HOUSE_UP: WallStyle = { outer: PAL.cream, inner: 0xcfe3e8, trim: PAL.brown, surface: 'wood', beams: PAL.brownDark };
const PARTITION: WallStyle = { outer: 0xe9d3a8, inner: 0xe9d3a8, trim: PAL.brown, surface: 'wood', thickness: 0.2 };
const PARTITION_UP: WallStyle = { outer: 0xcfe3e8, inner: 0xf2d7e0, trim: PAL.brown, surface: 'wood', thickness: 0.2 };
const BAKERY: WallStyle = { outer: 0xf7d0bd, inner: 0xfff1d8, trim: 0xffffff, surface: 'stone', plinth: PAL.terracottaDark };

export function buildVillageBlock(k: Kit, world: World, doors: DoorSpec[]) {
  const paths: [number, number][][] = [
    [[0, 36], [0, 12]],
    [[-10.5, -12.5], [-8, -10], [0, -8]],
    [[9, -12.5], [8, -10], [0, -8]],
    [[-13, 0], [-22, 0], [STREAM_X - 6, 0], [-40, 2]],
    [[13, 2], [17, 4]],
    [[-6, 12], [-14, 18], [-17, 25]],
    [[-13, 5], [-17, 10]],
    [[13, 6], [26, 10], [36, 12]],
    [[0, -10], [0, -30], [4, -40]],
  ];
  buildTerrain(k, paths);
  buildSkyRocks(k);
  buildSquare(k, world);
  buildHouse(k, world, doors, -12, -17);
  buildBakery(k, world, doors, 11, -16.5);
  buildTower(k, world, 20, 4);
  buildShed(k, world, -19, 10);
  buildWindmill(k, world, -18, 28);
  buildStream(k, world);
  buildFarm(k, world);
  buildNature(k, world);

  world.playerSpawns.push({ pos: new THREE.Vector3(0, 0.05, 27), yaw: 0 });
  world.botSpawns.push(new THREE.Vector3(9, 0.05, -28), new THREE.Vector3(33, 0.05, 0), new THREE.Vector3(-37, 0.05, 6), new THREE.Vector3(-4, 0.05, -30));

  // loot: floor spots roll from the loot tables; secret spots hold Rascal Crates
  const L = (x: number, y: number, z: number, kind: 'weapon' | 'any' = 'any') => world.lootSpots.push({ pos: new THREE.Vector3(x, y, z), kind: kind === 'weapon' ? 'weapon' : 'ammo', rarity: 0 });
  const C = (x: number, y: number, z: number, yaw = 0) => world.crateSpots.push({ pos: new THREE.Vector3(x, y, z), yaw });
  L(0, 0.05, 22.5, 'weapon'); // right in front of spawn: something to shoot within seconds
  L(2.2, 0.05, 21.5);
  L(-1.8, 0.05, 20.5);
  L(-14.5, 0.05, -15.5, 'weapon'); // house living room
  L(-9, 0.05, -18.5); // kitchen
  L(-14.5, 3.25, -14.8); // bedroom
  L(-10.5, 3.25, -18.8, 'weapon'); // landing
  L(11, 0.05, -15.2, 'weapon'); // bakery floor
  L(8.5, 0.05, -14.5);
  L(-19, 0.05, 10.8); // shed
  L(5, 0.05, 6.5); // market
  L(-5, 0.05, 6.5, 'weapon');
  L(30, 0.05, 12, 'weapon'); // farm
  L(-30.5, 0.05, 3); // bridge
  L(-17, 0.05, 24, 'weapon'); // windmill
  L(14, 0.05, 0);
  L(-11, 0.05, 1);
  C(-13, 6.12, -17, 0); // secret attic (get in through the gable window)
  C(20, 7.02, 1.9, 0); // Old Tock balcony (blink only)
  C(-35.2, 0.02, -12, 0.4); // blinkbug nest in the grove
  C(9, 0.02, -18.6, 0); // bakery back
  C(-18.5, 0.02, 9.3, Math.PI / 2); // toolshed
  C(31, 0.02, 1, 0.3); // farm
  C(-2, 0.02, -6.2, 0.2); // town square

  world.addZone('Pickle House', -17, -21, -7, -13, -1, 9, true);
  world.addZone('Crumb & Co.', 7, -20, 15, -13, -1, 6, true);
  world.addZone('Toolshed', -21, 8.3, -17, 11.7, -1, 3, true);
}

/* ================================================================== SQUARE */

function buildSquare(k: Kit, world: World) {
  // cobbles
  const x0 = -13, x1 = 13, z0 = -10, z1 = 10;
  for (let x = x0; x < x1; x += 1.3)
    for (let z = z0; z < z1; z += 1.1) {
      const w = Math.min(1.25, x1 - x), d = Math.min(1.05, z1 - z);
      if (w < 0.3 || d < 0.3) continue;
      const c = shade(rng.pick([PAL.cobble, 0xc9bca8, 0xb5a893, 0xd2c6b2]), rng.range(0.94, 1.05));
      k.box(x + w / 2, 0.02, z + d / 2 + ((Math.round(x / 1.3) % 2) * 0.4), w - 0.08, 0.06, d - 0.08, c, { batch: 'nocast', ao: 0 });
    }
  k.collider(0, -0.04, 0, x1 - x0, 0.1, z1 - z0 + 0.8, 'stone');
  // curb
  for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x0, z1 + 0.4, x1, z1 + 0.4], [x0, z0, x0, z1 + 0.4], [x1, z0, x1, z1 + 0.4]]) {
    const L = Math.hypot(bx - ax, bz - az);
    k.box((ax + bx) / 2, 0.06, (az + bz) / 2, Math.abs(bx - ax) + 0.3 || 0.3, 0.14, Math.abs(bz - az) + 0.3 || 0.3, PAL.stoneDark, { batch: 'nocast', ao: 0 });
    void L;
  }

  P.well(k, 0, 0);
  // statue of the island's founder, Pip Rascalton, with her Blinkbug
  k.push(-7, 0, -5.5, 0.4);
  k.box(0, 0.5, 0, 1.6, 1.0, 1.6, PAL.stone, { r: 0.08, col: 'stone' });
  k.box(0, 1.05, 0, 1.3, 0.12, 1.3, PAL.stoneDark, { r: 0.04 });
  const bronze = 0x6fa89a;
  k.sphere(0, 1.55, 0, 0.35, bronze, { sy: 0.9, col: 'metal' });
  k.sphere(0, 2.2, 0, 0.36, bronze);
  k.box(0, 1.55, 0.32, 0.5, 0.55, 0.3, bronze, { r: 0.1 });
  k.cyl(-0.4, 2.1, 0, 0.07, 0.07, 0.5, bronze, { roll: 2.2 });
  k.sphere(-0.62, 2.55, 0, 0.15, 0x7ff0ff, { batch: 'glow' }); // her bug, still glowing
  k.pop();
  const plaque = makeSign('PIP RASCALTON', { w: 1.2, h: 0.4, sub: 'first to blink', bg: '#e8d9a8' });
  plaque.position.set(-7 + Math.sin(0.4) * 0.81, 0.55, -5.5 + Math.cos(0.4) * 0.81);
  plaque.rotation.y = 0.4;
  world.group.add(plaque);

  // market stalls with produce
  P.marketStall(k, -6.5, 5.5, 0.1, PAL.terracotta, [0xff6b4a, 0x9bd65a, PAL.mustard]);
  P.marketStall(k, 6.5, 5.5, -0.1, PAL.teal, [0xb49be0, 0xff9ad5, 0xffb347]);
  const s1 = makeSign('FRESH-ISH FRUIT', { w: 1.8, h: 0.4, bg: '#fff6e6' });
  s1.position.set(-6.5, 1.35, 6.15);
  world.group.add(s1);
  const s2 = makeSign('ODD JAMS', { w: 1.4, h: 0.4, bg: '#fff6e6' });
  s2.position.set(6.5, 1.35, 6.15);
  world.group.add(s2);

  // cover clusters
  P.crate(k, 9.5, 0, -4, 1, 0.2);
  P.crate(k, 10.3, 0, -3.1, 0.7, -0.3, PAL.mustard);
  P.crate(k, 9.6, 0.9, -3.9, 0.6, 0.5, PAL.softBlue);
  P.barrel(k, -10, 0, 3);
  P.barrel(k, -10.8, 0, 3.9, PAL.terracotta);
  P.crate(k, -11, 0, -7, 1.1, 0.1);
  P.barrel(k, 3.5, 0, -7.5, PAL.teal);
  P.cart(k, 5, -2.5, 0.7);
  P.bench(k, -3.5, 7.8, 0);
  P.bench(k, 3.5, 7.8, 0);
  for (const [x, z] of [[-12.5, -9.5], [12.5, -9.5], [-12.5, 9.8], [12.5, 9.8]]) P.lampPost(k, x, z, x < 0 ? 0 : Math.PI);
  // planters (low cover)
  for (const [x, z, yaw] of [[-4, -8.8, 0], [4, -8.8, 0], [-12, 0, Math.PI / 2]] as [number, number, number][]) {
    k.push(x, 0, z, yaw);
    k.box(0, 0.35, 0, 2.6, 0.7, 0.8, PAL.terracotta, { r: 0.08, col: 'stone' });
    k.box(0, 0.72, 0, 2.4, 0.08, 0.6, 0x6b4a3a, { ao: 0 });
    P.flowerPatch(k, 0, 0, 0, 0);
    for (let i = 0; i < 6; i++) k.ico(-1 + i * 0.4, 0.85, rng.range(-0.15, 0.15), 0.18, rng.pick([PAL.pink, PAL.mustard, 0xffffff, PAL.lavender]), { batch: 'foliage', wind: 0.6, detail: 0 });
    k.pop();
  }
  // kickables
  world.addKickable(8.2, 0, 5.2, 'pumpkin');
  world.addKickable(8.8, 0, 4.6, 'pumpkin');
  world.addKickable(-8.6, 0, 4.9, 'bucket');
  world.addKickable(-2.2, 0, 1.8, 'bucket');
  world.addKickable(-11.2, 1.0, -7.2, 'bottle');
  world.addKickable(-10.9, 1.0, -6.9, 'bottle');
  world.addKickable(4.6, 1.2, 5.3, 'bottle');
  world.addKickable(1.5, 0, 9, 'box');
  world.addKickable(2.1, 0, 9.4, 'box');

  // bunting across the north side of the square
  P.bunting(k, -7.2, 5.4, -12.8, 6.8, 3.3, -12.8, 0.9);
  P.bunting(k, -12.5, 3.3, -9.5, -12.5, 3.3, 9.8, 1.2);
  P.bunting(k, 12.5, 3.3, -9.5, 17.8, 5, 1.8, 0.8);
}

/* ================================================================== PICKLE HOUSE */

function buildHouse(k: Kit, world: World, doors: DoorSpec[], cx: number, cz: number) {
  k.push(cx, 0, cz, 0);
  const H1 = 3.2, H2 = 2.9;
  // ---------------- ground floor
  floor(k, -4.85, -3.85, 4.85, 3.85, 0.04, 0.08, 0xc08a5a, 'wood');
  wall(k, -5, 4, 5, 4, 0, H1, HOUSE, [
    { at: 2.5, w: 1.4, h: 1.2, sill: 0.9, shutters: PAL.teal, flowers: true },
    { at: 6.5, w: 1.3, h: 2.3, kind: 'door' },
    { at: 9, w: 1.0, h: 1.2, sill: 0.9, shutters: PAL.teal },
  ], 1, doors);
  wall(k, 5, 4, 5, -4, 0, H1, HOUSE, [{ at: 4, w: 1.2, h: 1.1, sill: 1.0, shutters: PAL.teal, flowers: true }]);
  wall(k, 5, -4, -5, -4, 0, H1, HOUSE, [{ at: 2, w: 1.2, h: 2.3, kind: 'door' }, { at: 6.2, w: 1.0, h: 1.0, sill: 1.2 }], 1, doors);
  wall(k, -5, -4, -5, 4, 0, H1, HOUSE, [{ at: 2.2, w: 1.1, h: 1.1, sill: 1.0, shutters: PAL.teal }, { at: 6, w: 1.4, h: 1.2, sill: 0.9, shutters: PAL.teal, flowers: true }]);
  // corner posts
  for (const [x, z] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) k.box(x, (H1 + H2) / 2, z, 0.42, H1 + H2, 0.42, PAL.brownDark, { col: 'wood' });
  // partition living | kitchen with an arch
  wall(k, 0, -3.85, 0, 3.85, 0, H1, PARTITION, [{ at: 5.2, w: 1.5, h: 2.4, kind: 'arch' }, { at: 1.8, w: 1.1, h: 2.3, kind: 'arch' }]);
  // stairs along the north wall, rising east
  stairs(k, -4.6, 0, -3.25, 0, 1.15, H1, 4.0, 0xa87248, PAL.brownDark);

  // living room (west)
  P.rug(k, -2.6, 0.05, 0.9, 3.0, 2.2, PAL.terracotta);
  P.sofa(k, -2.4, 0.05, 2.9, Math.PI, PAL.teal);
  P.fireplace(k, -4.55, 0.05, 0.6, Math.PI / 2);
  world.addSmoke(new THREE.Vector3(cx - 3.6, 8.6, cz - 1.5));
  P.lamp(k, -4.2, 0.05, 3.3, PAL.mustard);
  P.plant(k, -0.6, 0.05, 3.4, 1.2);
  P.bookshelf(k, -0.35, 0.05, -1.2, -Math.PI / 2, 1.4, 2.0);
  P.picture(k, -4.83, 1.9, -1.9, Math.PI / 2, 0.7, 0.55, PAL.softBlue);
  P.table(k, -2.4, 0.05, 0.9, 0, 0.9, 0.6, PAL.woodLight);
  // kitchen (east)
  P.counter(k, 4.5, 0.05, -1.5, -Math.PI / 2, 2.6);
  P.sink(k, 4.5, 0.05, 0.9, -Math.PI / 2);
  P.stove(k, 4.4, 0.05, 2.6, -Math.PI / 2);
  P.table(k, 2.2, 0.05, 1.0, 0, 1.6, 0.9);
  P.chair(k, 2.2, 0.05, 1.9, Math.PI);
  P.chair(k, 2.2, 0.05, 0.1, 0);
  P.chair(k, 1.1, 0.05, 1.0, Math.PI / 2);
  k.sphere(2.0, 0.92, 1.0, 0.16, 0xd9a55a, { sy: 0.6 }); // pie
  k.cyl(2.6, 0.92, 0.9, 0.1, 0.08, 0.16, PAL.softBlue); // jug
  P.crate(k, 1.0, 0.05, -3.2, 0.7, 0.2);
  P.barrel(k, 2.0, 0.05, -3.3, PAL.wood);
  // hanging pans (tiny detail)
  for (let i = 0; i < 3; i++) k.cyl(4.7, 2.1, -2.2 + i * 0.35, 0.14, 0.12, 0.05, 0x3b3f4a, { roll: Math.PI / 2 });

  // ---------------- upper floor
  floor(k, -4.85, -3.85, 4.85, 3.85, H1, 0.26, 0xb58052, 'wood', [-4.65, -3.85, -0.5, -2.6], 0xe9d3a8);
  // railing around the stairwell
  k.box(-2.55, H1 + 0.5, -2.62, 4.2, 0.08, 0.08, PAL.brownDark, { col: 'wood', flags: ColFlags.BlocksMove });
  for (let i = 0; i < 6; i++) k.box(-4.5 + i * 0.8, H1 + 0.25, -2.62, 0.06, 0.5, 0.06, PAL.brownDark);
  k.collider(-2.55, H1 + 0.45, -2.62, 4.2, 0.9, 0.12, 'wood', { flags: ColFlags.BlocksMove });
  const y2 = H1;
  wall(k, -5, 4, 5, 4, y2, H2, HOUSE_UP, [
    { at: 2.5, w: 1.2, h: 1.1, sill: 0.9, shutters: PAL.mustard, flowers: true },
    { at: 6.5, w: 1.2, h: 2.2, kind: 'arch' },
    { at: 9, w: 0.9, h: 1.0, sill: 1.0 },
  ]);
  wall(k, 5, 4, 5, -4, y2, H2, HOUSE_UP, [{ at: 2.5, w: 1.1, h: 1.0, sill: 1.0, shutters: PAL.mustard }, { at: 6.2, w: 0.8, h: 0.8, sill: 1.3 }]);
  wall(k, 5, -4, -5, -4, y2, H2, HOUSE_UP, [{ at: 3, w: 1.1, h: 1.1, sill: 1.0 }, { at: 7.4, w: 1.1, h: 1.1, sill: 1.0, shutters: PAL.mustard }]);
  wall(k, -5, -4, -5, 4, y2, H2, HOUSE_UP, [{ at: 2.5, w: 1.1, h: 1.1, sill: 1.0, shutters: PAL.mustard }, { at: 6, w: 1.2, h: 1.1, sill: 0.9, shutters: PAL.mustard, flowers: true }]);
  // bathroom (NE)
  wall(k, 1.5, -3.85, 1.5, -0.5, y2, H2, PARTITION_UP, [{ at: 2.2, w: 0.9, h: 2.1, kind: 'arch' }]);
  wall(k, 1.5, -0.5, 4.85, -0.5, y2, H2, PARTITION_UP, []);
  k.push(0, y2, 0);
  P.bathtub(k, 3.8, 0, -2.9, 0);
  k.box(2.1, 0.3, -3.5, 0.45, 0.6, 0.5, 0xffffff, { r: 0.12, col: 'stone' }); // loo
  k.box(2.1, 0.75, -3.72, 0.45, 0.5, 0.15, 0xffffff, { r: 0.06 });
  P.plant(k, 4.5, 0, -0.9, 0.8, PAL.softBlue);
  // bedroom
  P.bed(k, -3.9, 0, 1.6, Math.PI / 2, PAL.lavender);
  P.wardrobe(k, -1.2, 0, -2.2, 0, PAL.lavender);
  P.rug(k, -2.0, 0.02, 1.5, 2.6, 2.0, PAL.teal);
  P.lamp(k, -4.4, 0, -1.4, PAL.pink);
  P.table(k, 3.8, 0, 2.9, 0, 1.2, 0.6, PAL.woodLight); // desk
  P.chair(k, 3.8, 0, 2.2, 0);
  k.box(3.6, 0.88, 3.0, 0.4, 0.05, 0.3, 0xffffff, { ao: 0 }); // letters
  P.picture(k, 0.5, 1.7, 3.83, Math.PI, 0.9, 0.6, PAL.pink);
  P.crate(k, 0.6, 0, 3.2, 0.6, 0.3, PAL.pink);
  k.pop();

  // balcony (south, upper floor)
  k.push(1.5, y2, 5.05);
  k.box(0, -0.12, 0, 3.4, 0.24, 1.9, 0xa87248, { col: 'wood', r: 0.03 });
  for (const sx of [-1.55, 1.55]) {
    k.box(sx, -1.6, 0.8, 0.2, 3.2, 0.2, PAL.brownDark, { col: 'wood' });
  }
  k.box(0, 0.95, 0.9, 3.4, 0.08, 0.1, PAL.brownDark);
  k.box(-1.66, 0.95, 0, 0.1, 0.08, 1.9, PAL.brownDark);
  k.box(1.66, 0.95, 0, 0.1, 0.08, 1.9, PAL.brownDark);
  for (let i = 0; i < 9; i++) k.box(-1.6 + i * 0.4, 0.47, 0.9, 0.06, 0.9, 0.06, PAL.brownDark);
  k.collider(0, 0.5, 0.9, 3.4, 1.0, 0.12, 'wood', { flags: ColFlags.BlocksMove });
  k.collider(-1.66, 0.5, 0, 0.12, 1.0, 1.9, 'wood', { flags: ColFlags.BlocksMove });
  k.collider(1.66, 0.5, 0, 0.12, 1.0, 1.9, 'wood', { flags: ColFlags.BlocksMove });
  P.plant(k, -1.2, 0, 0.5, 0.9);
  P.plant(k, 1.2, 0, 0.5, 0.7, PAL.teal);
  k.pop();

  // attic floor + roof + chimney
  floor(k, -4.85, -3.85, 4.85, 3.85, H1 + H2, 0.25, 0x9a6a44, 'wood', undefined, 0xf2d7e0);
  gableRoof(k, 0, H1 + H2, 0, 0, 10.4, 8.4, 2.6, PAL.roofRed, { overhang: 0.55, gableColor: PAL.cream, gableWindow: true, trim: PAL.brown });
  k.box(-3.6, H1 + H2 + 1.6, -1.5, 0.9, 3.6, 0.9, PAL.terracottaDark, { col: 'stone' });
  k.box(-3.6, H1 + H2 + 3.45, -1.5, 1.05, 0.2, 1.05, PAL.stoneDark);
  // attic secret: a sleeping-bag nest
  k.push(0, H1 + H2, 0);
  k.box(-1.5, 0.12, 0, 1.6, 0.2, 0.9, PAL.softBlue, { r: 0.08 });
  P.crate(k, 1.5, 0, 0.5, 0.6, 0.4);
  k.sphere(3.2, 0.3, 0, 0.3, PAL.pink, { sy: 0.7 });
  k.pop();

  k.pop();

  const sign = makeSign('THE PICKLE HOUSE', { w: 2.2, h: 0.55, sub: 'no pickles inside', bg: '#dff0c8' });
  sign.position.set(cx + 1.5 - 1.6, 2.7, cz + 4.23);
  world.group.add(sign);
  // doormat & mailbox
  k.box(cx + 1.5, 0.02, cz + 4.9, 1.2, 0.04, 0.7, PAL.mustard, { batch: 'nocast', ao: 0 });
  k.box(cx + 4, 0.55, cz + 5.6, 0.08, 1.1, 0.08, PAL.brownDark, { col: 'wood', flags: ColFlags.BlocksMove });
  k.box(cx + 4, 1.2, cz + 5.6, 0.35, 0.3, 0.5, PAL.softBlue, { r: 0.12 });
  P.washingLine(k, cx - 7.5, cz + 7, cx - 7.5, cz + 1);
  P.flowerPatch(k, cx - 3, cz + 5.2, 10, 1.6);
  P.hedge(k, cx - 5.5, cz + 6, cx - 1, cz + 6, 1.0);
}

/* ================================================================== BAKERY */

function buildBakery(k: Kit, world: World, doors: DoorSpec[], cx: number, cz: number) {
  k.push(cx, 0, cz, 0);
  const H = 3.4;
  floor(k, -3.85, -3.35, 3.85, 3.35, 0.04, 0.08, 0xd8c8b0, 'stone');
  wall(k, -4, 3.5, 4, 3.5, 0, H, BAKERY, [{ at: 2.0, w: 1.3, h: 2.4, kind: 'door' }, { at: 5.5, w: 2.6, h: 1.5, sill: 0.8 }], 1, doors);
  wall(k, 4, 3.5, 4, -3.5, 0, H, BAKERY, [{ at: 3.5, w: 1.2, h: 1.2, sill: 1.0, shutters: 0xffffff, flowers: true }]);
  wall(k, 4, -3.5, -4, -3.5, 0, H, BAKERY, [{ at: 2.0, w: 1.2, h: 2.3, kind: 'door' }, { at: 5.6, w: 1.0, h: 1.0, sill: 1.2 }], 1, doors);
  wall(k, -4, -3.5, -4, 3.5, 0, H, BAKERY, [{ at: 3.5, w: 1.2, h: 1.2, sill: 1.0, shutters: 0xffffff }]);
  for (const [x, z] of [[-4, -3.5], [4, -3.5], [-4, 3.5], [4, 3.5]]) k.box(x, H / 2, z, 0.4, H, 0.4, 0xffffff, { col: 'stone' });
  floor(k, -3.85, -3.35, 3.85, 3.35, H + 0.25, 0.25, 0xd8c8b0, 'wood', undefined, 0xfff1d8);
  gableRoof(k, 0, H + 0.25, 0, 0, 8.4, 7.4, 2.2, PAL.roofBlue, { overhang: 0.5, gableColor: 0xf7d0bd, trim: 0xffffff });
  world.addSmoke(new THREE.Vector3(cx + 2.5, H + 3.9, cz - 2));
  k.box(2.5, H + 2.2, -2, 0.8, 2.6, 0.8, 0xb85c3b, { col: 'stone' });

  // shop interior
  P.counter(k, 0.8, 0.05, 0.4, 0, 4.0, 0xf7d0bd, PAL.woodLight);
  // glass cabinet with pastries
  k.box(0.8, 1.2, 0.4, 3.6, 0.5, 0.6, 0xbfeaf2, { ao: 0, batch: 'nocast' });
  const pastry = [0xd9a55a, 0xe0b070, 0xf28fad, 0xc88a4a];
  for (let i = 0; i < 10; i++) k.sphere(-0.8 + i * 0.35, 1.05, 0.4, 0.1, pastry[i % 4], { sy: 0.6, sx: 1.4 });
  // bread shelves
  for (const sx of [-2.4, 2.4]) {
    k.box(sx, 1.1, -3.1, 2.0, 2.2, 0.4, PAL.brown, { col: 'wood' });
    for (let s = 0; s < 3; s++) for (let i = 0; i < 5; i++) k.sphere(sx - 0.8 + i * 0.4, 0.5 + s * 0.65, -2.95, 0.13, 0xd9a55a, { sx: 1.6, sy: 0.8 });
  }
  // brick oven with glow
  k.push(-3.0, 0.05, 1.5, Math.PI / 2);
  k.box(0, 0.6, 0, 1.6, 1.2, 1.2, 0xb85c3b, { r: 0.1, col: 'stone' });
  k.sphere(0, 1.2, 0, 0.8, 0xc96a48, { sy: 0.8 });
  k.box(0, 0.8, 0.55, 0.6, 0.45, 0.12, 0x2d2433, { ao: 0 });
  k.sphere(0, 0.7, 0.55, 0.2, 0xff8a3d, { batch: 'glow', sy: 0.6 });
  k.pop();
  // flour sacks & rolling pin
  for (let i = 0; i < 3; i++) k.box(3.2, 0.3 + (i === 2 ? 0.5 : 0), -1.2 + (i % 2) * 0.6, 0.5, 0.6, 0.45, 0xf2eee0, { r: 0.18, col: i < 2 ? 'cloth' : null });
  k.cyl(0.8, 1.02, 0.1, 0.05, 0.05, 0.6, PAL.woodLight, { roll: Math.PI / 2 });
  // front awning (cloth, walkable, a good blink perch)
  for (let i = 0; i < 8; i++) k.box(-3.5 + i + 0.5, 2.95, 4.2, 1.0, 0.06, 1.6, i % 2 ? PAL.roofBlue : 0xffffff, { pitch: 0.3, ao: 0, batch: 'foliage', wind: 0.05 });
  k.collider(0, 2.95, 4.2, 8, 0.12, 1.6, 'cloth', { pitch: 0.3 });
  for (const sx of [-3.9, 3.9]) k.box(sx, 1.35, 4.9, 0.1, 2.7, 0.1, PAL.brown, { col: 'wood' });
  // outdoor tables
  P.table(k, -2.5, 0, 6.2, 0.2, 1, 1, 0xffffff);
  P.chair(k, -2.5, 0, 7.0, Math.PI + 0.2, PAL.roofBlue);
  k.pop();

  // hanging swinging sign (reacts to bullets)
  const pivot = new THREE.Group();
  pivot.position.set(cx + 4.4, 3.0, cz + 4.4);
  const sign = makeSign('CRUMB & CO.', { w: 1.5, h: 0.75, sub: 'est. yesterday', bg: '#fff1d8', round: true });
  sign.position.y = -0.55;
  sign.rotation.y = Math.PI / 2;
  pivot.add(sign);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), toyMaterial(PAL.ink));
  bracket.position.set(0, 0.03, -0.35);
  pivot.add(bracket);
  const col = world.cw.box(cx + 4.4, 2.45, cz + 4.4, 0.1, 0.75, 1.5, 'wood', 0, 0, 0, ColFlags.BlocksBullets);
  world.addSwinger(pivot, 'z', 'sign', col);
  const board = makeSign('TODAY: CRUSTY THINGS', { w: 1.2, h: 0.9, bg: '#2b2238', fg: '#f4e7c8', border: '#8a5a3b' });
  board.position.set(cx - 1.5, 0.6, cz + 5.2);
  board.rotation.set(-0.25, 0.3, 0);
  world.group.add(board);
}

/* ================================================================== CLOCK TOWER */

function buildTower(k: Kit, world: World, cx: number, cz: number) {
  k.push(cx, 0, cz, 0);
  const stone = 0xd8cbb4;
  k.box(0, 3.5, 0, 4.4, 7.0, 4.4, stone, { r: 0.05, col: 'stone' });
  // stone bands + painted door (sealed — the tower is a Blinkbug puzzle)
  for (const y of [0.3, 3.4, 6.7]) k.box(0, y, 0, 4.6, 0.3, 4.6, PAL.stoneDark, { r: 0.04 });
  k.box(-2.22, 1.2, 0, 0.08, 2.2, 1.2, PAL.brownDark, { r: 0.02 });
  k.box(-2.25, 2.3, 0, 0.08, 0.3, 1.4, PAL.stoneDark);
  // clock faces
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    k.push(Math.sin(a) * 2.24, 5.3, Math.cos(a) * 2.24, a);
    k.cyl(0, 0, 0, 0.85, 0.85, 0.1, PAL.ink, { pitch: Math.PI / 2, segs: 20 });
    k.cyl(0, 0, 0.03, 0.72, 0.72, 0.1, 0xfff6dc, { pitch: Math.PI / 2, segs: 20, batch: 'glow' });
    k.pop();
  }
  // balcony
  k.box(0, 6.85, 0, 5.8, 0.3, 5.8, PAL.stoneDark, { r: 0.04, col: 'stone' });
  for (const [x, z, sx, sz] of [[0, 2.8, 5.8, 0.25], [0, -2.8, 5.8, 0.25], [2.8, 0, 0.25, 5.8], [-2.8, 0, 0.25, 5.8]]) {
    k.box(x, 7.4, z, sx, 0.8, sz, stone, { r: 0.04, col: 'stone' });
  }
  // belfry pillars + roof
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) k.box(x, 8.7, z, 0.6, 3.4, 0.6, stone, { r: 0.05, col: 'stone' });
  k.box(0, 10.5, 0, 3.8, 0.4, 3.8, PAL.stoneDark, { r: 0.04, col: 'stone' });
  k.cone(0, 12.0, 0, 3.0, 2.8, PAL.roofPurple, { segs: 4, yaw: Math.PI / 4 });
  k.sphere(0, 13.5, 0, 0.18, PAL.mustard);
  // tiny blinkbug nest on the balcony (secret)
  k.cyl(-1.9, 7.1, -1.9, 0.45, 0.35, 0.25, PAL.brown, { segs: 10 });
  for (let i = 0; i < 3; i++) k.sphere(-1.9 + (i - 1) * 0.15, 7.3, -1.9 + (i % 2) * 0.1, 0.1, 0x9ffcff, { batch: 'glow', sy: 1.2 });
  k.pop();

  // the bell
  const pivot = new THREE.Group();
  pivot.position.set(cx, 10.2, cz);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 1.1, 16, 1, true), toyMaterial(0xd9a441, { metal: 0.7, rough: 0.3 }));
  (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  bell.position.y = -0.85;
  bell.castShadow = true;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), bell.material);
  top.position.y = -0.3;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), toyMaterial(PAL.ink));
  clapper.position.y = -1.3;
  pivot.add(bell, top, clapper);
  world.bellPos.set(cx, 9.3, cz);
  const col = world.cw.box(cx, 9.35, cz, 1.4, 1.2, 1.4, 'metal', 0, 0, 0, ColFlags.BlocksBullets | ColFlags.BlocksMove);
  world.addSwinger(pivot, 'x', 'bell', col);

  const plaque = makeSign('OLD TOCK', { w: 1.6, h: 0.5, sub: 'ring for luck', bg: '#e8d9a8' });
  plaque.position.set(cx - 2.26, 3.0, cz);
  plaque.rotation.y = -Math.PI / 2;
  world.group.add(plaque);
}

/* ================================================================== SHED */

function buildShed(k: Kit, world: World, cx: number, cz: number) {
  k.push(cx, 0, cz, 0);
  const st: WallStyle = { outer: PAL.teal, inner: 0xb07a4f, trim: 0xffffff, surface: 'wood', thickness: 0.2 };
  floor(k, -1.9, -1.6, 1.9, 1.6, 0.04, 0.08, PAL.wood, 'wood');
  wall(k, -2, 1.7, 2, 1.7, 0, 2.6, st, [{ at: 2, w: 0.9, h: 0.8, sill: 1.1 }]);
  wall(k, 2, 1.7, 2, -1.7, 0, 2.6, st, [{ at: 1.7, w: 1.4, h: 2.2, kind: 'arch' }]);
  wall(k, 2, -1.7, -2, -1.7, 0, 2.6, st, []);
  wall(k, -2, -1.7, -2, 1.7, 0, 2.6, st, [{ at: 1.7, w: 0.8, h: 0.8, sill: 1.1 }]);
  // single-pitch roof
  k.box(0, 2.95, 0, 4.8, 0.2, 4.2, PAL.roofTeal, { pitch: 0.18, col: 'wood', r: 0.03 });
  k.push(0, 0, 0, 0);
  k.box(-1.5, 1.0, -1.3, 0.9, 0.08, 0.5, PAL.brown);
  k.box(-1.5, 1.6, -1.3, 0.9, 0.08, 0.5, PAL.brown);
  k.cyl(-1.7, 1.25, -1.3, 0.12, 0.1, 0.4, PAL.terracotta); // pot
  k.cyl(0.8, 1.2, -1.55, 0.02, 0.02, 1.6, PAL.brown, { roll: 0.3 }); // rake
  k.pop();
  P.barrel(k, -1.3, 0, 1.0, PAL.teal);
  k.pop();
  const s = makeSign('TOOLS (MAYBE)', { w: 1.4, h: 0.4, bg: '#fff6e6' });
  s.position.set(cx + 2.13, 2.45, cz);
  s.rotation.y = Math.PI / 2;
  world.group.add(s);
  // vegetable patch + scarecrow
  for (let r = 0; r < 4; r++) {
    k.box(cx - 5, 0.1, cz + 4 + r * 1.2, 4, 0.2, 0.7, 0x7a5a3b, { batch: 'nocast', ao: 0 });
    for (let i = 0; i < 6; i++) k.ico(cx - 6.8 + i * 0.7, 0.35, cz + 4 + r * 1.2, 0.25, rng.pick([PAL.leaf, PAL.grassDark, 0x9bd65a]), { batch: 'foliage', wind: 0.5, detail: 0 });
  }
  scarecrow(k, cx - 5, cz + 9.5);
  world.addKickable(cx - 2.5, 0, cz + 3.5, 'pumpkin');
  world.addKickable(cx - 3.1, 0, cz + 4.1, 'pumpkin');
  world.addKickable(cx - 2.2, 0, cz + 4.6, 'pumpkin');
}

function scarecrow(k: Kit, x: number, z: number) {
  k.push(x, 0, z, 0.3);
  k.box(0, 1.1, 0, 0.12, 2.2, 0.12, PAL.brown, { col: 'wood' });
  k.box(0, 1.7, 0, 1.6, 0.1, 0.1, PAL.brown);
  k.box(0, 1.55, 0, 0.6, 0.7, 0.35, PAL.terracotta, { r: 0.1 });
  k.sphere(0, 2.2, 0, 0.3, 0xf2e2b0);
  k.cone(0, 2.55, 0, 0.45, 0.4, 0xc9a06a, { segs: 10 });
  k.box(-0.1, 2.25, -0.27, 0.08, 0.08, 0.02, PAL.ink, { ao: 0 });
  k.box(0.1, 2.25, -0.27, 0.08, 0.08, 0.02, PAL.ink, { ao: 0 });
  for (const s of [-1, 1]) k.box(s * 0.85, 1.6, 0, 0.12, 0.35, 0.12, 0xe6c46a, { batch: 'foliage', wind: 0.8 });
  k.pop();
}

/* ================================================================== WINDMILL */

function buildWindmill(k: Kit, world: World, cx: number, cz: number) {
  // a grassy knoll with a ramp so it can be walked up
  k.push(cx, 0, cz, 0);
  k.cyl(0, 3.5, 0, 1.9, 2.5, 7, 0xf4ecd8, { segs: 12, col: 'stone' });
  for (const y of [2.2, 4.6]) k.box(0, y, -2.25, 0.6, 0.7, 0.1, 0x7fb7e6, { ao: 0 });
  k.box(0, 1.1, -2.42, 1.0, 2.1, 0.12, PAL.brown);
  k.cone(0, 8.3, 0, 2.4, 2.6, PAL.roofRed, { segs: 12 });
  k.pop();
  const hub = new THREE.Group();
  hub.position.set(cx, 6.8, cz - 2.6);
  const wood = toyMaterial(PAL.woodLight);
  const cloth = toyMaterial(0xfff6e6, { rough: 0.9 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), toyMaterial(PAL.brownDark));
  hub.add(cap);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.6, 0.12), wood);
    beam.position.y = 2.3;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.4, 0.04), cloth);
    sail.position.set(0.55, 2.8, 0.03);
    sail.castShadow = true;
    beam.castShadow = true;
    arm.add(beam, sail);
    hub.add(arm);
  }
  world.addSpinner(hub, 'z', 0.6);
  P.hayBale(k, cx + 3.5, cz + 1, 0.3);
  P.hayBale(k, cx + 4.2, cz + 2.4, -0.2);
  P.hayBale(k, cx + 3.8, cz + 1.7, 0.1, 0.8);
  P.fence(k, cx - 6, cz - 5, cx + 6, cz - 5);
  P.flowerPatch(k, cx - 3, cz + 3, 14, 2.5);
}

/* ================================================================== STREAM & BRIDGE */

function buildStream(k: Kit, world: World) {
  const X = STREAM_X;
  const edgeZ = (sign: number) => {
    // find where the island edge crosses the stream
    for (let z = 30; z < 60; z += 0.25) {
      const a = Math.atan2(sign * z, X);
      if (Math.hypot(X, z) > islandRadius(a)) return z - 0.3;
    }
    return 40;
  };
  const zn = edgeZ(-1), zs = edgeZ(1);
  world.addWater(X, -0.32, (zs - zn) / 2, 3.6, zs + zn);
  world.addWaterfall(X, -0.4, -zn, 2.6);
  world.addWaterfall(X, -0.4, zs, 2.6);
  // pebbles & reeds on the banks
  for (let i = 0; i < 40; i++) {
    const z = rng.range(-zn + 2, zs - 2);
    const side = rng.chance(0.5) ? -1 : 1;
    if (Math.abs(z) < 3) continue;
    if (rng.chance(0.5)) P.rock(k, X + side * rng.range(1.6, 2.4), -0.2, z, rng.range(0.25, 0.5), PAL.stone, false);
    else for (let r = 0; r < 4; r++) k.cyl(X + side * rng.range(1.2, 2.2), 0.1, z + rng.range(-0.3, 0.3), 0.02, 0.03, rng.range(0.6, 1.1), rng.pick([PAL.leafDark, 0x9bd65a]), { batch: 'foliage', wind: 1, segs: 3 });
  }
  // arched wooden bridge
  k.push(X, 0, 0, 0);
  const deckY = 0.55;
  const rampA = Math.atan2(deckY, 1.6);
  const rl = Math.hypot(deckY, 1.6);
  k.box(0, deckY - 0.1, 0, 4.4, 0.2, 2.4, PAL.wood, { col: 'wood' });
  k.box(-2.2 - 0.8, deckY / 2 - 0.1, 0, rl, 0.2, 2.4, PAL.wood, { col: 'wood', roll: rampA });
  k.box(2.2 + 0.8, deckY / 2 - 0.1, 0, rl, 0.2, 2.4, PAL.wood, { col: 'wood', roll: -rampA });
  for (let i = 0; i < 10; i++) k.box(-2 + i * 0.44, deckY + 0.01, 0, 0.05, 0.02, 2.4, PAL.brownDark, { ao: 0 });
  for (const s of [-1.15, 1.15]) {
    k.box(0, deckY + 0.9, s, 4.6, 0.1, 0.1, PAL.brownDark, { col: 'wood', flags: ColFlags.BlocksMove });
    k.collider(0, deckY + 0.5, s, 4.6, 1.0, 0.15, 'wood', { flags: ColFlags.BlocksMove });
    for (let i = 0; i < 5; i++) k.box(-2 + i, deckY + 0.45, s, 0.12, 0.9, 0.12, PAL.brownDark);
  }
  k.box(-2, -0.4, 0, 0.3, 1.2, 2.2, PAL.stoneDark, { col: 'stone' });
  k.box(2, -0.4, 0, 0.3, 1.2, 2.2, PAL.stoneDark, { col: 'stone' });
  k.pop();
}

/* ================================================================== FARM (east) */

function buildFarm(k: Kit, world: World) {
  for (let r = 0; r < 6; r++) {
    k.box(32, 0.08, 14 + r * 1.4, 8, 0.16, 0.8, 0x7a5a3b, { batch: 'nocast', ao: 0 });
    for (let i = 0; i < 10; i++) {
      const x = 28.4 + i * 0.8;
      if (r % 2) {
        k.cyl(x, 0.6, 14 + r * 1.4, 0.03, 0.04, 1.1, 0x9bd65a, { batch: 'foliage', wind: 0.7, segs: 4 });
        k.box(x, 1.2, 14 + r * 1.4, 0.12, 0.25, 0.12, PAL.mustard, { batch: 'foliage', wind: 0.9, r: 0.05 });
      } else k.ico(x, 0.35, 14 + r * 1.4, 0.3, rng.pick([PAL.leaf, 0x9bd65a]), { batch: 'foliage', wind: 0.4, detail: 0 });
    }
  }
  P.fence(k, 27, 12.5, 37, 12.5);
  P.fence(k, 27, 22.5, 37, 22.5);
  P.fence(k, 37, 12.5, 37, 22.5);
  P.cart(k, 30, 6, -0.4);
  P.hayBale(k, 26, 2, 0.4);
  P.hayBale(k, 27, 3.2, -0.3);
  P.crate(k, 34, 0, 3, 1, 0.3);
  P.crate(k, 35, 0, 4, 0.8, -0.2, PAL.mustard);
  P.barrel(k, 33.5, 0, 4.5);
  scarecrow(k, 32, 18);
  // water tower (another blink perch)
  k.push(36, 0, -6, 0);
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) k.box(x, 2.5, z, 0.25, 5, 0.25, PAL.brownDark, { col: 'wood' });
  k.box(0, 5.1, 0, 3.2, 0.25, 3.2, PAL.wood, { col: 'wood' });
  k.cyl(0, 6.3, 0, 1.3, 1.4, 2.2, 0x7fb7e6, { col: 'metal', segs: 14 });
  k.cone(0, 7.8, 0, 1.6, 0.9, PAL.roofBlue, { segs: 14 });
  k.box(1.6, 2.5, 0, 0.1, 5, 0.1, PAL.brownDark, { roll: 0.05 }); // ladder rails (decor)
  k.pop();
}

/* ================================================================== NATURE */

function buildNature(k: Kit, world: World) {
  const avoid = (x: number, z: number) =>
    (x > -18 && x < 16 && z > -22 && z < 12) || // square & buildings
    (x > 16 && x < 25 && z > -1 && z < 9) || // tower
    Math.abs(x - STREAM_X) < 3.5 || // stream
    (x > -4 && x < 4 && z > 12 && z < 40) || // spawn path
    (x > 26 && x < 38 && z > 11 && z < 24) || // farm
    (x > -22 && x < -14 && z > 23 && z < 33) || // windmill
    Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - 3;
  let placed = 0;
  for (let i = 0; i < 400 && placed < 58; i++) {
    const x = rng.range(-44, 44), z = rng.range(-44, 44);
    if (avoid(x, z)) continue;
    placed++;
    const kind = x < STREAM_X ? (rng.chance(0.5) ? 'tall' : 'round') : rng.chance(0.18) ? 'blossom' : rng.chance(0.25) ? 'tall' : 'round';
    P.tree(k, x, z, rng.range(0.85, 1.35), 0, kind);
    if (rng.chance(0.5)) P.bush(k, x + rng.range(-2.5, 2.5), z + rng.range(-2.5, 2.5), rng.range(0.7, 1.1), PAL.leaf, rng.chance(0.4));
  }
  for (let i = 0, n = 0; i < 300 && n < 40; i++) {
    const x = rng.range(-44, 44), z = rng.range(-44, 44);
    if (avoid(x, z)) continue;
    n++;
    if (rng.chance(0.4)) P.rock(k, x, 0, z, rng.range(0.4, 1.1));
    else if (rng.chance(0.5)) P.flowerPatch(k, x, z, 6, 1);
    else P.bush(k, x, z, rng.range(0.6, 1), PAL.leaf, rng.chance(0.5));
  }
  // grass tufts everywhere (no collision)
  for (let i = 0, n = 0; i < 1400 && n < 650; i++) {
    const x = rng.range(-44, 44), z = rng.range(-44, 44);
    if ((x > -13.5 && x < 13.5 && z > -10.5 && z < 10.8) || Math.abs(x - STREAM_X) < 1.4) continue;
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - 1) continue;
    n++;
    const c = rng.pick([PAL.grass, PAL.grassLight, PAL.grassDark]);
    for (let b = 0; b < 3; b++) k.cone(x + rng.range(-0.15, 0.15), 0.18, z + rng.range(-0.15, 0.15), 0.06, rng.range(0.3, 0.5), c, { batch: 'foliage', wind: 1, segs: 3, yaw: rng.range(0, 6) });
  }
  // west grove: giant mushrooms (a taste of Wobblewood) + the Blinkbug nest secret
  for (let i = 0; i < 9; i++) {
    const x = rng.range(-43, -33), z = rng.range(-25, 25);
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - 3) continue;
    P.mushroom(k, x, z, rng.range(0.8, 2.6), rng.pick([PAL.terracotta, PAL.lavender, PAL.mustard]));
  }
  k.push(-37, 0, -12, 0);
  k.cyl(0, 0.5, 0, 1.1, 1.3, 1.0, PAL.brown, { col: 'wood', segs: 12 });
  k.cyl(0, 1.0, 0, 0.9, 0.9, 0.05, 0x5e3b27, { segs: 12 });
  for (let i = 0; i < 5; i++) k.sphere(Math.cos(i * 1.3) * 0.4, 1.12, Math.sin(i * 1.3) * 0.4, 0.14, 0x9ffcff, { batch: 'glow', sy: 1.25 });
  k.pop();
  // life
  for (let i = 0; i < 7; i++) world.addFlyer('butterfly', new THREE.Vector3(rng.range(-30, 30), 0.4, rng.range(-30, 30)), rng.range(2, 5), rng.range(0.5, 1.5));
  for (let i = 0; i < 5; i++) world.addFlyer('bird', new THREE.Vector3(rng.range(-20, 20), 14, rng.range(-20, 20)), rng.range(15, 30), rng.range(0, 8));
}
