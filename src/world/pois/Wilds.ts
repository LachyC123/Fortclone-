import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, WallStyle, wall, floor, stairs, gableRoof, shade } from '../BuildingKit';
import { buildNest } from '../Cottages';
import { makeSign } from '../Signs';
import { ground, loot, lootG, crate, crateG, busy, outcrop, woods, groundLine, dressing, lowGround, highGround } from './common';

const BARN: WallStyle = { outer: 0xc9573f, inner: 0xe8c0a8, trim: 0xfff6e6, surface: 'wood', beams: 0xfff6e6, plinth: PAL.stoneDark };
const RUIN: WallStyle = { outer: 0xb0a594, inner: 0xc9c0b0, trim: 0x8a7a6a, surface: 'stone' };

/**
 * The land between places: Lookout Hill's ruined watchtower, farm fields boxed in by hedgerows
 * and stone walls, barns, copses and boulder outcrops. Everything here exists to break up the
 * long open views so crossing the island is a game of cover-to-cover hops.
 */
export function buildWilds(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(1212);

  // ---------------------------------------------------------------- Lookout Hill watchtower
  const TX = 44, TZ = 38;
  const tg = highGround(TX, TZ, 3.2) + 0.05;
  const FL = 3.2;
  k.push(TX, tg, TZ, 0.4);
  k.box(0, -0.9, 0, 6.4, 1.8, 6.4, 0x8a7a6a, { col: 'stone' });
  floor(k, -2.8, -2.8, 2.8, 2.8, 0.04, 0.1, 0x9c9384, 'stone');
  // crumbling walls: big holes and a broken top
  wall(k, -3, 3, 3, 3, 0, FL, RUIN, [{ at: 3, w: 1.6, h: 2.4, kind: 'arch' }]);
  wall(k, 3, 3, 3, -3, 0, FL, RUIN, [{ at: 2, w: 1.2, h: 1.4, sill: 1 }]);
  wall(k, 3, -3, -3, -3, 0, FL * 0.7, RUIN, []);
  wall(k, -3, -3, -3, 3, 0, FL, RUIN, [{ at: 4, w: 1.2, h: 1.4, sill: 1 }]);
  stairs(k, -2.6, 0, -1.9, 0, 1.1, FL, 3.4, 0x9c9384);
  floor(k, -3, -3, 3, 3, FL, 0.25, 0x9c9384, 'stone', [-2.9, -2.6, 1.0, -1.2]);
  // battlements
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (i === 3) continue;
    k.box(Math.cos(a) * 2.8, FL + 0.6, Math.sin(a) * 2.8, 1.1, 1.0, 0.5, shade(0xb0a594, 0.9 + (i % 3) * 0.05), { col: 'stone', yaw: -a + Math.PI / 2 });
  }
  k.pop();
  loot(world, TX, tg + 0.15, TZ, 'weapon');
  crate(world, TX + 1, tg + FL + 0.3, TZ + 1, 0.3);
  world.addZone('Lookout Hill', TX - 3.5, TZ - 3.5, TX + 3.5, TZ + 3.5, tg - 1, tg + FL + 3, true);
  world.addZone('Lookout Hill', TX - 16, TZ - 16, TX + 16, TZ + 16, -5, 30, false);
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(6, 12);
    outcrop(k, rng, TX + Math.cos(a) * d, TZ + Math.sin(a) * d, rng.range(0.8, 1.2));
  }
  buildNest(k, world, TX - 9, TZ + 9, ground(TX - 9, TZ + 9));

  // ---------------------------------------------------------------- farm fields
  const field = (cx: number, cz: number, w: number, d: number, edge: 'hedge' | 'wall', crop: number, gapSide: number) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const sides: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    sides.forEach(([ax, az, bx, bz], i) => {
      if (i === gapSide) {
        // leave a gate in the middle
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const ux = (bx - ax) / Math.hypot(bx - ax, bz - az), uz = (bz - az) / Math.hypot(bx - ax, bz - az);
        groundLine(k, edge, ax, az, mx - ux * 1.6, mz - uz * 1.6);
        groundLine(k, edge, mx + ux * 1.6, mz + uz * 1.6, bx, bz);
      } else groundLine(k, edge, ax, az, bx, bz);
    });
    // crop rows (tall corn hides you; low cabbages don't)
    const tall = crop === 0;
    for (let r = 0; r < Math.floor(d / 1.6) - 1; r++) {
      const rz = z0 + 1.6 + r * 1.6;
      for (let c = 0; c < Math.floor(w / 0.9) - 2; c++) {
        const rx = x0 + 1.4 + c * 0.9;
        const y = ground(rx, rz);
        if (tall) {
          k.cyl(rx, y + 0.9, rz, 0.03, 0.05, 1.8, 0x9bd65a, { batch: 'foliage', wind: 0.7, segs: 4 });
          if (c % 2) k.box(rx, y + 1.5, rz, 0.14, 0.3, 0.14, PAL.mustard, { batch: 'foliage', wind: 0.9, r: 0.05 });
        } else k.ico(rx, y + 0.3, rz, 0.3, rng.pick([PAL.leaf, 0x9bd65a]), { batch: 'foliage', wind: 0.3, detail: 0 });
      }
      if (tall) k.collider((x0 + x1) / 2, ground((x0 + x1) / 2, rz) + 0.9, rz, w - 2.5, 1.8, 0.4, 'grass', { flags: 8 });
    }
  };
  field(-64, 38, 18, 12, 'hedge', 0, 1);
  field(38, -84, 12, 10, 'wall', 1, 2);
  field(-56, 70, 12, 10, 'wall', 0, 0);
  field(76, -38, 12, 12, 'hedge', 1, 3);

  // barns
  const barn = (bx: number, bz: number, yaw: number, name: string) => {
    const W = 8, D = 6, H = 3.6;
    const by = highGround(bx, bz, 4.2) + 0.02;
    k.push(bx, by, bz, yaw);
    k.box(0, -1.2, 0, W + 0.3, 2.4, D + 0.3, PAL.stoneDark, { col: 'stone' });
    floor(k, -W / 2 + 0.15, -D / 2 + 0.15, W / 2 - 0.15, D / 2 - 0.15, 0.04, 0.08, 0xa87248, 'wood');
    wall(k, -W / 2, D / 2, W / 2, D / 2, 0, H, BARN, [{ at: W / 2, w: 3, h: 3, kind: 'arch' }]);
    wall(k, W / 2, D / 2, W / 2, -D / 2, 0, H, BARN, [{ at: D / 2, w: 1, h: 1, sill: 1.2 }]);
    wall(k, W / 2, -D / 2, -W / 2, -D / 2, 0, H, BARN, [{ at: W / 2, w: 3, h: 3, kind: 'arch' }]);
    wall(k, -W / 2, -D / 2, -W / 2, D / 2, 0, H, BARN, [{ at: D / 2, w: 1, h: 1, sill: 1.2 }]);
    // hay loft on one side (reach it by stacking hay or blinking)
    floor(k, -W / 2 + 0.15, -D / 2 + 0.15, -0.5, D / 2 - 0.15, 2.6, 0.2, 0xb58052, 'wood');
    for (let i = 0; i < 3; i++) P.hayBale(k, 1 + i * 0.4, 0.6 - i * 0.8, rng.range(0, 1), i * 0.45);
    P.hayBale(k, -3, -1.6, 0.3, 2.8);
    gableRoof(k, 0, H, 0, 0, W + 0.4, D + 0.4, 2.2, PAL.roofRed, { overhang: 0.4, gableColor: 0xc9573f, trim: 0xfff6e6 });
    k.pop();
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const at = (lx: number, ly: number, lz: number): [number, number, number] => [bx + lx * cs + lz * sn, by + ly, bz - lx * sn + lz * cs];
    loot(world, ...at(2, 0.1, 1), 'weapon');
    loot(world, ...at(-1.8, 2.9, 1.4));
    world.addZone(name, bx - 4.5, bz - 4.5, bx + 4.5, bz + 4.5, by - 1, by + H + 2.5, true);
  };
  barn(-80, 26, 0.1, 'Haybarrow Barn');
  barn(17, -80, Math.PI / 2, 'Old Moo Barn');

  // ---------------------------------------------------------------- copses along the ridges and between places
  const copses: [number, number, number, number][] = [
    [30, -44, 7, 9], [58, -22, 8, 10], [-36, -58, 7, 8], [-58, 30, 8, 10], [-44, 58, 6, 7],
    [18, 58, 7, 9], [60, 60, 8, 9], [-84, -46, 6, 7], [2, -60, 6, 6], [86, 2, 6, 7], [-14, 60, 5, 5], [40, 84, 6, 6],
  ];
  for (const [cx, cz, r, n] of copses) woods(k, rng, cx, cz, r, n, rng.chance(0.3) ? ['tall'] : ['round', 'tall', 'round']);

  // ---------------------------------------------------------------- boulder outcrops + ruined walls in open ground
  const spots: THREE.Vector2[] = [];
  for (let i = 0; i < 900 && spots.length < 34; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(46, 94);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (busy(x, z, 4.5, 2)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.y - z) < 11)) continue;
    spots.push(new THREE.Vector2(x, z));
    if (rng.chance(0.7)) outcrop(k, rng, x, z, rng.range(0.9, 1.5));
    else {
      // a broken bit of old wall: L-shaped cover
      const yaw = rng.range(0, Math.PI);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      groundLine(k, 'wall', x - c * 3, z + s * 3, x + c * 2, z - s * 2, 2.5);
      groundLine(k, 'wall', x + c * 2, z - s * 2, x + c * 2 + s * 2.5, z - s * 2 + c * 2.5, 2.5);
    }
    if (rng.chance(0.3)) lootG(world, x + rng.range(-2.5, 2.5), z + rng.range(-2.5, 2.5), rng.chance(0.5) ? 'weapon' : 'any');
    else if (rng.chance(0.08)) crateG(world, x + 2.8, z + 0.5, rng.range(0, 3));
  }
  // hay bales & carts in the farmland (low cover)
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(50, 90);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (busy(x, z, 3, 1)) continue;
    k.push(0, ground(x, z) - 0.05, 0);
    if (rng.chance(0.75)) {
      P.hayBale(k, x, z, rng.range(0, 3));
      if (rng.chance(0.5)) P.hayBale(k, x + 1.2, z + 0.3, rng.range(0, 3));
    } else P.cart(k, x, z, rng.range(0, 6));
    k.pop();
  }

  // ---------------------------------------------------------------- signposts at road junctions
  const post = (x: number, z: number, text: string, yaw: number) => {
    const y = ground(x, z);
    k.box(x, y + 1.2, z, 0.18, 2.4, 0.18, PAL.brownDark, { col: 'wood' });
    const s = makeSign(text, { w: 1.9, h: 0.45, bg: '#fff1d8' });
    s.position.set(x, y + 2.1, z);
    s.rotation.y = yaw;
    world.group.add(s);
  };
  post(-8, -48, '↑ TUMBLE MARKET', Math.PI * 0.9);
  post(26, -38, '↗ CROOKED MANOR', Math.PI * 0.75);
  post(44, 14, '→ RATTLEWORKS', -Math.PI / 2 + 0.2);
  post(-46, 4, '← WOBBLEWOOD', Math.PI / 2 - 0.3);
  post(-12, 50, '↓ CRASH COVE', 0.2);

  // ---------------------------------------------------------------- grass & flowers across the open land
  dressing(k, rng, 0, 0, 96, 1600, true);
  for (let i = 0; i < 6; i++) world.addFlyer('bird', new THREE.Vector3(rng.range(-70, 70), 20, rng.range(-70, 70)), rng.range(20, 40), rng.range(0, 10));
  for (let i = 0; i < 8; i++) {
    const x = rng.range(-80, 80), z = rng.range(-80, 80);
    if (busy(x, z, 2, -10)) continue;
    world.addFlyer('butterfly', new THREE.Vector3(x, ground(x, z) + 0.4, z), rng.range(2, 5), rng.range(0.5, 1.5));
  }
}
