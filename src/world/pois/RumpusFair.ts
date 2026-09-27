import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, shade } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { townhouse, shed, pavilion, signPost, spinMesh } from '../Homes';
import { ground, crateG, lootG, loot, placeFrame } from './common';

/**
 * RUMPUS FAIR — a travelling funfair parked on the south-west peninsula. A striped big top you
 * can fight inside (bleachers, a ring, a centre pole), a Ferris wheel and a carousel that never
 * stop turning, game booths, bumper cars and a very wobbly haunted house.
 */
export function buildRumpusFair(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(6262);
  const C = POI_BY_ID.fair;
  const F = placeFrame(C.x, C.z);
  const at = F.p;

  bigTop(k, world, ...at(0, -6), F.yaw);

  // Ferris wheel (the stand is solid; the wheel is scenery that turns)
  {
    const [x, z] = at(-11, 8);
    const y = ground(x, z);
    const yaw = F.yaw + Math.PI / 2;
    k.push(x, y, z, yaw);
    for (const s of [-1, 1]) {
      k.box(-1.6, 3.8, s * 1.1, 0.35, 8, 0.35, 0xffffff, { roll: 0.4, col: 'metal' });
      k.box(1.6, 3.8, s * 1.1, 0.35, 8, 0.35, 0xffffff, { roll: -0.4, col: 'metal' });
    }
    k.box(0, 0.25, 0, 5.4, 0.5, 3, PAL.stoneDark, { col: 'stone' });
    k.box(0, 0.8, 1.9, 2, 1.6, 0.8, PAL.pink, { col: 'wood' }); // operator's box
    k.pop();
    const holder = new THREE.Group();
    holder.position.set(x, y + 7.6, z);
    holder.rotation.y = yaw;
    const cols = [PAL.mustard, PAL.pink, PAL.teal, PAL.softBlue, PAL.terracotta, PAL.lavender, 0x9bd65a, 0xff7a6b];
    const wheel = spinMesh((b) => {
      for (const s of [-0.9, 0.9]) b.add(new THREE.TorusGeometry(6, 0.14, 6, 40), { color: 0xffffff, ao: 0 }, 0, 0, s);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.box(0, 0, 0, 0.1, 12, 0.1, { color: 0xffffff, ao: 0 }, 0, 0, 0, a);
        b.box(Math.cos(a) * 6, Math.sin(a) * 6 - 0.6, 0, 1.1, 0.9, 1.4, { color: cols[i] }, 0.12);
      }
      b.cyl(0, 0, 0, 0.6, 0.6, 2.2, { color: PAL.mustard }, 12, Math.PI / 2);
    });
    world.addSpinner(wheel, 'z', 0.18);
    holder.add(wheel);
    world.group.add(holder);
  }

  // carousel: the platform is solid, the horses and canopy go round
  {
    const [x, z] = at(11, 8);
    const y = ground(x, z);
    k.cyl(x, y + 0.2, z, 4, 4.2, 0.4, 0xfff6e6, { col: 'wood', segs: 18 });
    k.cyl(x, y + 2.2, z, 0.6, 0.6, 4, PAL.pink, { col: 'wood', segs: 10 });
    const horseCols = [0xffffff, PAL.softBlue, PAL.pink, PAL.mustard, PAL.lavender, 0x9bd65a];
    const spin = spinMesh((b) => {
      b.cone(0, 4.2, 0, 4.6, 1.8, { color: PAL.terracotta }, 12);
      b.add(new THREE.CylinderGeometry(4.6, 4.6, 0.5, 12, 1, true), { color: PAL.mustard }, 0, 3.1, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const hx = Math.cos(a) * 2.9, hz = Math.sin(a) * 2.9;
        const hy = 0.8 + (i % 2) * 0.3;
        b.cyl(hx, 1.3, hz, 0.05, 0.05, 3.2, { color: PAL.mustard, ao: 0 }, 5);
        b.box(hx, hy, hz, 0.4, 0.6, 1.3, { color: horseCols[i] }, 0.1, -a);
        b.box(hx + Math.sin(-a) * 0.6, hy + 0.4, hz + Math.cos(-a) * 0.6, 0.3, 0.6, 0.35, { color: horseCols[i] }, 0.08, -a);
      }
    });
    spin.position.set(x, y + 0.4, z);
    world.addSpinner(spin, 'y', 0.45);
    lootG(world, ...at(11, 12.8), 'weapon');
  }

  // the haunted house: tall, crooked-looking and dark inside
  {
    const [x, z] = at(12, -9);
    townhouse(k, world, doors, { name: 'Spooky Stack', x, z, yaw: F.yaw - Math.PI / 2, seed: 626, w: 6, d: 7, floors: 3, wallColor: 0x6a5a7a, roof: 0x3a3440, trim: 0xb49be0, sideWindows: true });
  }
  // ticket booth + prize store
  {
    const [x, z] = at(4, 15);
    shed(k, world, doors, { name: 'Ticket Booth', x, z, yaw: F.yaw, seed: 627, w: 3, d: 2.8, color: 0xf28fad, roof: 0xfff6e6 });
    const [x2, z2] = at(-13, -8);
    shed(k, world, doors, { name: 'Prize Store', x: x2, z: z2, yaw: F.yaw + Math.PI / 2, seed: 628, w: 4.2, d: 3.4, color: 0x7fb7e6, roof: PAL.roofRed });
  }
  // bumper cars under a pavilion
  {
    const [x, z] = at(-2, 9);
    const y = ground(x, z);
    k.box(x, y + 0.05, z, 7.6, 0.1, 5.6, 0x5a5a6a, { batch: 'nocast', ao: 0, yaw: F.yaw });
    pavilion(k, x, y, z, F.yaw, 8, 6, 3.2, PAL.roofPurple, 0xfff6e6);
    const cols = [PAL.terracotta, PAL.teal, PAL.mustard, PAL.pink, PAL.softBlue];
    for (let i = 0; i < 5; i++) {
      const bx = x + rng.range(-2.6, 2.6), bz = z + rng.range(-1.8, 1.8);
      const yaw = rng.range(0, 6);
      k.push(bx, y, bz, yaw);
      k.box(0, 0.35, 0, 1.2, 0.5, 1.7, cols[i], { r: 0.2, col: 'metal' });
      k.box(0, 0.7, -0.3, 0.9, 0.4, 0.2, shade(cols[i], 0.8), { r: 0.08 });
      k.cyl(0, 1.7, 0.5, 0.03, 0.03, 1.9, PAL.metal, { segs: 4 });
      k.pop();
    }
    lootG(world, x, z, 'any');
  }
  // game booths along the midway
  const aw = [PAL.terracotta, PAL.teal, PAL.pink, PAL.mustard, PAL.lavender];
  for (let i = 0; i < 5; i++) {
    const lz = -12 + i * 5.5;
    const [x, z] = at(-17, lz);
    k.push(0, ground(x, z), 0);
    P.marketStall(k, x, z, F.yaw + Math.PI / 2, aw[i], [PAL.pink, PAL.mustard, 0xffffff]);
    k.pop();
    if (i % 2 === 0) lootG(world, ...at(-14.5, lz), i === 2 ? 'weapon' : 'any');
  }
  // lamp posts, bunting, balloons stuck in the trees, litter to kick about
  for (const [lx, lz] of [[-6, 15], [6, 3], [-6, 3], [16, 0]] as [number, number][]) {
    const [x, z] = at(lx, lz);
    k.push(0, ground(x, z), 0);
    P.lampPost(k, x, z, F.yaw);
    k.pop();
  }
  {
    const [ax, az] = at(-6, 15), [bx, bz] = at(6, 3);
    P.bunting(k, ax, ground(ax, az) + 3.6, az, bx, ground(bx, bz) + 3.6, bz, 0.9);
    const [cx, cz] = at(-6, 3);
    P.bunting(k, cx, ground(cx, cz) + 3.6, cz, bx, ground(bx, bz) + 3.6, bz, 0.6);
  }
  for (let i = 0; i < 8; i++) {
    const [x, z] = at(rng.range(-15, 15), rng.range(-2, 16));
    world.addKickable(x, ground(x, z), z, rng.pick(['bottle', 'box', 'bucket'] as const));
  }

  for (const [lx, lz, kind] of [[0, 3, 'weapon'], [15, -1, 'any'], [-8, -1, 'weapon']] as [number, number, 'weapon' | 'any'][]) {
    const [x, z] = at(lx, lz);
    lootG(world, x, z, kind);
  }
  {
    const [x, z] = at(16, 13);
    crateG(world, x, z, F.yaw);
  }
  {
    const [x, z] = at(-16, 14);
    buildNest(k, world, x, z, ground(x, z));
  }
  {
    const [x, z] = at(-1.5, 18.5);
    signPost(k, world, x, ground(x, z), z, 'RUMPUS FAIR', F.yaw, 'roll up! roll up!');
  }
}

/** The big top: a round striped tent you can fight inside. Two doorways, bleachers and a ring. */
function bigTop(k: Kit, world: World, X: number, Z: number, yaw: number) {
  const R = 8, H = 3.6, SEG = 20;
  const Y = ground(X, Z);
  k.push(X, Y, Z, yaw);
  // walls: a ring of panels with doorways front (+z) and back (-z)
  for (let i = 0; i < SEG; i++) {
    const a = ((i + 0.5) / SEG) * Math.PI * 2;
    const dz = Math.sin(a), dx = Math.cos(a);
    const isDoor = Math.abs(dx) < 0.2; // at ±z
    if (isDoor) continue;
    const L = 2 * R * Math.sin(Math.PI / SEG) + 0.1;
    const col = i % 2 ? 0xd9443a : 0xfff6e6;
    k.box(dx * R, H / 2, dz * R, L, H, 0.2, col, { yaw: -a + Math.PI / 2, col: 'cloth', ao: 0.05 });
  }
  // door frames with a scalloped valance
  for (const s of [1, -1]) {
    k.box(0, H - 0.3, s * R, 3.2, 0.6, 0.3, PAL.mustard, { col: 'cloth' });
  }
  // roof: a big cone, a white eave band, and a ceiling collider (two squares, inside the walls)
  k.cone(0, H + 2.6, 0, R + 0.6, 5.2, 0xd9443a, { segs: 20 });
  k.cyl(0, H + 0.1, 0, R + 0.62, R + 0.62, 0.35, 0xfff6e6, { segs: 20 });
  k.collider(0, H + 0.1, 0, R * 1.4, 0.2, R * 1.4, 'cloth');
  k.collider(0, H + 0.1, 0, R * 1.4, 0.2, R * 1.4, 'cloth', { yaw: Math.PI / 4 });
  k.cyl(0, H + 3.5, 0, 0.25, 0.3, H + 7, 0xfff6e6, { col: 'wood', segs: 8 });
  k.cone(0, H + 7.3, 0, 0.6, 1.4, PAL.mustard, { segs: 3, pitch: Math.PI / 2 });
  // inside: the ring and two banks of bleachers
  k.beginInterior();
  k.cyl(0, 0.2, 0, 3.4, 3.4, 0.4, 0xd9443a, { col: 'wood', segs: 20 });
  k.cyl(0, 0.22, 0, 3.0, 3.0, 0.4, 0xe6c46a, { segs: 20 });
  for (const s of [1, -1]) {
    for (let t = 0; t < 3; t++) {
      k.box(s * (4.6 + t * 0.9), 0.3 + t * 0.55, 0, 0.9, 0.6 + t * 1.1, 7 - t * 0.8, t % 2 ? 0x7fb7e6 : 0xf2c14e, { col: 'wood' });
    }
  }
  k.endInterior();
  k.pop();
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const w = (lx: number, ly: number, lz: number): [number, number, number] => [X + lx * cs + lz * sn, Y + ly, Z - lx * sn + lz * cs];
  loot(world, ...w(0, 0.45, 0), 'weapon');
  loot(world, ...w(5.5, 1.5, 1.5));
  loot(world, ...w(-5.5, 1.5, -1.5), 'weapon');
  world.addZone('The Big Top', X - R, Z - R, X + R, Z + R, Y - 1, Y + H + 1, true);
}
