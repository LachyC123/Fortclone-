import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, WallStyle, wall, floor, stairs, gableRoof, shade } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { makeSign } from '../Signs';
import { loot, crate, woods, dressing } from './common';

const WAREHOUSE: WallStyle = { outer: 0xd9a066, inner: 0xf0d2a8, trim: PAL.brownDark, surface: 'wood', beams: PAL.brownDark, plinth: PAL.stoneDark };
const SHOP: WallStyle = { outer: 0xf3e3c3, inner: 0xfff1d8, trim: PAL.teal, surface: 'wood', plinth: PAL.stoneDark };

/**
 * TUMBLE MARKET — a stacked, cluttered bazaar on a raised plaza. Aisles of stalls give broken
 * sightlines, tottering crate towers are climbable cover, and two big warehouses have lofts.
 */
export function buildTumbleMarket(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(808);
  const C = POI_BY_ID.market;
  const X = C.x, Z = C.z, Y = C.h;
  k.push(X, Y, Z, 0);

  // --- plaza cobbles + raised edge kerb
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 17;
    k.box(Math.cos(a) * r, 0.02, Math.sin(a) * r, rng.range(0.8, 1.3), 0.06, rng.range(0.8, 1.3), shade(PAL.cobble, rng.range(0.88, 1.06)), { batch: 'nocast', ao: 0, yaw: rng.range(0, 1.5) });
  }

  // --- the Tumble Fountain in the middle (cover + landmark)
  k.cyl(0, 0.35, 0, 3.2, 3.4, 0.7, PAL.stone, { col: 'stone', segs: 18 });
  k.cyl(0, 0.62, 0, 2.8, 2.8, 0.06, PAL.water, { segs: 18 });
  k.cyl(0, 1.5, 0, 0.5, 0.7, 2.2, PAL.stoneDark, { col: 'stone', segs: 10 });
  k.cyl(0, 2.7, 0, 1.3, 0.9, 0.3, PAL.stone, { segs: 14 });
  k.sphere(0, 3.3, 0, 0.6, PAL.mustard, { sy: 0.8 });
  world.addSmoke(new THREE.Vector3(X, Y + 3.2, Z)); // spray
  loot(world, X + 4.7, Y + 0.08, Z, 'weapon');

  // --- stall aisles (north/south rows, gaps for running lanes)
  const goods = [[0xff6b4a, PAL.mustard, 0x9bd65a], [PAL.pink, PAL.lavender, 0xffffff], [0xf28a2e, 0x9bd65a, PAL.softBlue], [PAL.terracotta, PAL.mustard, 0x7fd06a]];
  const awnings = [PAL.terracotta, PAL.teal, PAL.pink, PAL.softBlue, PAL.mustard, PAL.lavender];
  let si = 0;
  for (const row of [-9, -5, 5, 9]) {
    for (const col of [-12, -8.5, 8.5, 12]) {
      if (rng.chance(0.15)) continue;
      P.marketStall(k, col, row, row < 0 ? 0 : Math.PI, awnings[si % awnings.length], goods[si % goods.length]);
      if (rng.chance(0.35)) loot(world, X + col, Y + 0.08, Z + (row === -9 ? -7 : row === -5 ? -3.8 : row === 5 ? 3.8 : 7));
      si++;
    }
  }
  // --- tottering crate towers (climb them, blink onto them, hide behind them)
  const towers: [number, number, number][] = [
    [-5, -13, 4], [6, -13, 3], [-15, 1, 5], [15, -2, 3], [-3, 12, 3], [4, 14, 4],
  ];
  towers.forEach(([tx, tz, n], ti) => {
    let y = 0;
    for (let i = 0; i < n; i++) {
      const s = 1.35 - i * 0.12;
      P.crate(k, tx + rng.range(-0.15, 0.15), y, tz + rng.range(-0.15, 0.15), s, rng.range(-0.3, 0.3), i % 2 ? PAL.mustard : PAL.woodLight);
      y += s;
    }
    if (ti === 0 || ti === 2) crate(world, X + tx, Y + y + 0.02, Z + tz, rng.range(0, 3));
    else if (ti === 5) loot(world, X + tx, Y + y + 0.05, Z + tz, 'weapon');
    for (let b = 0; b < 3; b++) P.barrel(k, tx + rng.range(-1.6, 1.6), 0, tz + rng.range(1.2, 2), rng.pick([PAL.wood, PAL.teal, PAL.terracotta]));
  });
  for (let i = 0; i < 10; i++) world.addKickable(X + rng.range(-14, 14), Y, Z + rng.range(-14, 14), rng.pick(['box', 'bucket', 'bottle'] as const));
  // bunting over the aisles
  P.bunting(k, -16, 4.5, -7, 16, 4.5, -7, 1);
  P.bunting(k, -16, 4.5, 7, 16, 4.5, 7, 1);
  P.bunting(k, -7, 5, -16, -7, 5, 16, 1.1);
  P.bunting(k, 7, 5, -16, 7, 5, 16, 1.1);

  // --- two warehouses (west and east) with lofts
  const hall = (hx: number, hz: number, yaw: number, name: string, seed: number) => {
    const W = 11, D = 8, H1 = 3.4, H2 = 2.6;
    const hw = W / 2, hd = D / 2;
    k.push(hx, 0, hz, yaw);
    k.box(0, -0.9, 0, W + 0.2, 1.8, D + 0.2, PAL.stoneDark, { col: 'stone' });
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, 0xa87248, 'wood');
    wall(k, -hw, hd, hw, hd, 0, H1, WAREHOUSE, [{ at: W / 2, w: 3, h: 2.8, kind: 'arch' }, { at: 1.7, w: 1.1, h: 1, sill: 1.3 }, { at: W - 1.7, w: 1.1, h: 1, sill: 1.3 }]);
    wall(k, hw, hd, hw, -hd, 0, H1, WAREHOUSE, [{ at: D / 2, w: 1.2, h: 2.3, kind: 'door' }], 1, doors);
    wall(k, hw, -hd, -hw, -hd, 0, H1, WAREHOUSE, [{ at: 2.5, w: 1.2, h: 1, sill: 1.3 }, { at: W - 2.5, w: 1.2, h: 1, sill: 1.3 }]);
    wall(k, -hw, -hd, -hw, hd, 0, H1, WAREHOUSE, [{ at: D / 2, w: 1.2, h: 2.3, kind: 'door' }], 1, doors);
    // loft over the back half, stairs up the side
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, -0.3, H1, 0.22, 0xb58052, 'wood', [-hw + 0.3, -hd + 0.15, -hw + 4.1, -hd + 1.5]);
    stairs(k, -hw + 0.4, 0, -hd + 0.85, 0, 1.2, H1, 3.6, 0xa87248, PAL.brownDark);
    k.box(0, H1 + 0.55, -0.3, W - 0.4, 0.08, 0.08, PAL.brownDark);
    k.collider(0.4, H1 + 0.5, -0.3, W - 1.4, 1.0, 0.1, 'wood', { flags: 1 });
    wall(k, -hw, hd, hw, hd, H1, H2, WAREHOUSE, [{ at: W / 2, w: 1.6, h: 1.2, sill: 0.7 }]);
    wall(k, hw, hd, hw, -hd, H1, H2, WAREHOUSE, [{ at: D / 2, w: 1.1, h: 1, sill: 0.8 }]);
    wall(k, hw, -hd, -hw, -hd, H1, H2, WAREHOUSE, [{ at: W / 2, w: 1.1, h: 1, sill: 0.8 }]);
    wall(k, -hw, -hd, -hw, hd, H1, H2, WAREHOUSE, [{ at: D / 2, w: 1.1, h: 1, sill: 0.8 }]);
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H1 + H2, 0.22, 0x9a6a44, 'wood', undefined, shade(0xd9a066, 1.05));
    gableRoof(k, 0, H1 + H2, 0, 0, W + 0.4, D + 0.4, 2.4, seed % 2 ? PAL.roofRed : PAL.roofBlue, { overhang: 0.5, gableColor: 0xd9a066, gableWindow: true, trim: PAL.brownDark });
    // sacks and crates inside (cover)
    for (const [cx, cz] of [[-hw + 1.2, hd - 1.2], [-hw + 2.4, hd - 1], [hw - 1.2, 0.8], [hw - 1.3, 2.2], [3.8, hd - 1]]) P.crate(k, cx, 0.05, cz, rng.range(0.7, 1), rng.range(0, 1));
    for (const [cx, cz] of [[-0.5, -3], [4.2, -3.2], [hw - 1, -1.2]]) P.crate(k, cx, H1 + 0.1, cz, 0.8, rng.range(0, 1), PAL.mustard);
    k.pop();
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const at = (lx: number, ly: number, lz: number): [number, number, number] => [X + hx + lx * cs + lz * sn, Y + ly, Z + hz - lx * sn + lz * cs];
    loot(world, ...at(1, 0.1, 1.5), 'weapon');
    loot(world, ...at(-2, 0.1, 2.2));
    loot(world, ...at(2.5, H1 + 0.3, -2), 'weapon');
    crate(world, ...at(-3.5, H1 + H2 + 0.25, 0), 0); // attic (gable window)
    const R = Math.max(hw, hd);
    world.addZone(name, X + hx - R, Z + hz - R, X + hx + R, Z + hz + R, Y - 1, Y + H1 + H2 + 3, true);
  };
  hall(-11, 13, 0, 'Grain Hall', 1);
  hall(12, 12, Math.PI / 2, 'Bits & Bobs Depot', 2);

  // --- a little clock-arch gate facing Buttonbury (south-east) with the sign
  k.push(10, 0, -16, -0.6);
  for (const s of [-2.2, 2.2]) k.box(s, 2, 0, 0.8, 4, 0.8, PAL.stone, { col: 'stone', r: 0.1 });
  k.box(0, 4.3, 0, 5.4, 0.6, 1, PAL.stoneDark, { col: 'stone' });
  k.cyl(0, 5.1, 0, 0.7, 0.7, 0.2, 0xfff6e6, { pitch: Math.PI / 2, segs: 16 });
  k.pop();
  const sign = makeSign('TUMBLE MARKET', { w: 3.4, h: 0.8, sub: 'everything must go (eventually)', bg: '#fff1d8' });
  const [sx, sy, sz] = k.w(10, 3.4, -16);
  sign.position.set(sx, sy, sz + 0.1);
  sign.rotation.y = -0.6 + Math.PI;
  world.group.add(sign);

  // --- low market walls around the rim (waist-high cover, gaps at the roads)
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 0.72) / 16) * Math.PI * 2;
    if (i === 13 || i === 5 || i === 9) continue; // openings
    P.stoneWall(k, Math.cos(a0) * 18.5, Math.sin(a0) * 18.5, Math.cos(a1) * 18.5, Math.sin(a1) * 18.5, 0.9);
  }
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    P.lampPost(k, Math.cos(a) * 16, Math.sin(a) * 16, -a);
  }
  k.pop();
  buildNest(k, world, X - 4, Z - 15.5, Y);

  crate(world, X - 1, Y + 0.02, Z + 5.5, 0.2);
  woods(k, rng, X - 20, Z - 14, 8, 10);
  woods(k, rng, X + 24, Z - 6, 7, 8);
  dressing(k, rng, X, Z, C.r + 10, 200);
}
