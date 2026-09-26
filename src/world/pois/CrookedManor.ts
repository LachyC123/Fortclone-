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
import { loot, crate, woods, dressing, outcrop } from './common';

const MANOR: WallStyle = { outer: 0x7a6a9a, inner: 0xd8c8e8, trim: 0x3d2f52, surface: 'wood', beams: 0x3d2f52, plinth: 0x5e5468 };
const MANOR_UP: WallStyle = { outer: 0x6a7fa0, inner: 0xe8d8c0, trim: 0x3d2f52, surface: 'wood', beams: 0x3d2f52 };
const TOWER: WallStyle = { outer: 0x8a6a8a, inner: 0xe8d0d8, trim: 0x3d2f52, surface: 'wood' };

/**
 * CROOKED MANOR — a leaning, lopsided mansion on the island's biggest hill. Every floor is a
 * little twisted from the one below. The hill gives it long sightlines over the island, the
 * iron fence lets bullets through but not rascals, and the hedge maze behind it is a knife fight.
 */
export function buildCrookedManor(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(909);
  const C = POI_BY_ID.manor;
  const X = C.x, Z = C.z, Y = C.h;
  k.push(X, Y, Z, 0);

  // ---------------------------------------------------------------- the manor (centre-north)
  const MX = 2, MZ = -3;
  const W = 13, D = 9, H1 = 3.2, H2 = 3.0, H3 = 2.8;
  const hw = W / 2, hd = D / 2;
  k.push(MX, 0, MZ, 0.05);
  k.box(0, -0.9, 0, W + 0.4, 1.9, D + 0.4, 0x5e5468, { col: 'stone' });
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, 0x6a4a3a, 'wood');
  // ground floor: front door + big windows, side doors, back door
  wall(k, -hw, hd, hw, hd, 0, H1, MANOR, [{ at: 2.2, w: 1.3, h: 1.4, sill: 1, shutters: 0x3d2f52 }, { at: W / 2, w: 1.5, h: 2.5, kind: 'door' }, { at: W - 2.2, w: 1.3, h: 1.4, sill: 1, shutters: 0x3d2f52 }], 1, doors);
  wall(k, hw, hd, hw, -hd, 0, H1, MANOR, [{ at: D / 2, w: 1.2, h: 2.3, kind: 'door' }], 1, doors);
  wall(k, hw, -hd, -hw, -hd, 0, H1, MANOR, [{ at: 3, w: 1.1, h: 1.2, sill: 1.1 }, { at: W - 3, w: 1.2, h: 2.3, kind: 'door' }], 1, doors);
  wall(k, -hw, -hd, -hw, hd, 0, H1, MANOR, [{ at: D / 2, w: 1.3, h: 1.4, sill: 1 }]);
  // interior partition (hall | parlour) with an arch
  wall(k, 1, -hd, 1, hd, 0, H1, { ...MANOR, outer: 0xd8c8e8, thickness: 0.2 }, [{ at: D / 2 + 1.2, w: 1.6, h: 2.4, kind: 'arch' }]);
  P.fireplace(k, -hw + 0.5, 0.05, 0, Math.PI / 2);
  P.sofa(k, -3, 0.05, 2, Math.PI, 0x8a3b5a);
  P.bookshelf(k, -2, 0.05, -hd + 0.35, 0, 1.6, 2.2);
  P.table(k, 4, 0.05, 1, 0, 2, 1, 0x5e3b27);
  for (const cx of [3, 5]) P.chair(k, cx, 0.05, 2, Math.PI, 0x5e3b27);
  P.rug(k, -2.5, 0.05, 0.5, 4, 3, 0x8a3b5a);
  // stairs to floor 2
  stairs(k, 1.4, 0, -hd + 0.8, 0, 1.2, H1, 3.8, 0x5e3b27, 0x3d2f52);
  floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, H1, 0.24, 0x6a4a3a, 'wood', [1.3, -hd + 0.15, 5.4, -hd + 1.45], shade(0x7a6a9a, 1.05));
  k.collider(3.35, H1 + 0.5, -hd + 1.5, 4.1, 1.0, 0.1, 'wood', { flags: 1 });
  k.box(3.35, H1 + 0.95, -hd + 1.5, 4.1, 0.07, 0.07, 0x3d2f52);
  k.pop();

  // floor 2: twisted the other way and a little narrower
  const W2 = 12, D2 = 8.4;
  k.push(MX + 0.2, H1, MZ, -0.04);
  const w2 = W2 / 2, d2 = D2 / 2;
  wall(k, -w2, d2, w2, d2, 0, H2, MANOR_UP, [{ at: 2, w: 1.1, h: 1.2, sill: 0.9, shutters: 0x3d2f52 }, { at: W2 / 2, w: 1.4, h: 2.2, kind: 'door' }, { at: W2 - 2, w: 1.1, h: 1.2, sill: 0.9, shutters: 0x3d2f52 }], 1, doors);
  wall(k, w2, d2, w2, -d2, 0, H2, MANOR_UP, [{ at: D2 / 2, w: 1.1, h: 1.2, sill: 0.9 }]);
  wall(k, w2, -d2, -w2, -d2, 0, H2, MANOR_UP, [{ at: 2.5, w: 1.1, h: 1.2, sill: 0.9 }]);
  wall(k, -w2, -d2, -w2, d2, 0, H2, MANOR_UP, [{ at: D2 / 2, w: 1.1, h: 1.2, sill: 0.9 }]);
  // balcony over the front door
  floor(k, -1.8, d2, 1.8, d2 + 1.6, 0, 0.2, 0x6a4a3a, 'wood');
  k.box(0, 0.5, d2 + 1.55, 3.6, 0.1, 0.1, 0x3d2f52);
  k.collider(0, 0.5, d2 + 1.55, 3.6, 1, 0.1, 'wood', { flags: 1 });
  P.bed(k, -3.5, 0, 1.5, Math.PI / 2, 0x8a3b5a);
  P.wardrobe(k, -w2 + 0.6, 0, -2, Math.PI / 2, 0x3d2f52);
  P.rug(k, 0, 0.02, 0, 3, 2.5, 0x5b4bff);
  // stairs to the tower room
  stairs(k, -w2 + 0.5, 0, -d2 + 0.8, 0, 1.1, H3, 3.4, 0x5e3b27, 0x3d2f52);
  k.pop();

  // floor 3: the crooked tower room (west half) + a flat roof terrace (east half)
  k.push(MX + 0.2, H1 + H2, MZ, -0.04);
  floor(k, -w2 + 0.15, -d2 + 0.15, w2 - 0.15, d2 - 0.15, 0, 0.24, 0x6a4a3a, 'wood', [-w2 + 0.4, -d2 + 0.15, -w2 + 3.95, -d2 + 1.35], shade(0x6a7fa0, 1.05));
  k.push(-3, 0, 0, 0.1);
  wall(k, -3, 3, 3, 3, 0, H3, TOWER, [{ at: 3, w: 1.2, h: 2.2, kind: 'arch' }]);
  wall(k, 3, 3, 3, -3, 0, H3, TOWER, [{ at: 3, w: 1, h: 1, sill: 0.9 }]);
  wall(k, 3, -3, -3, -3, 0, H3, TOWER, [{ at: 4.3, w: 1.4, h: 2.2, kind: 'arch' }]);
  wall(k, -3, -3, -3, 3, 0, H3, TOWER, [{ at: 3, w: 1, h: 1, sill: 0.9 }]);
  floor(k, -3, -3, 3, 3, H3, 0.24, 0x5e3b27, 'wood', undefined, 0xe8d0d8);
  // the pointy, lopsided witch-hat roof
  k.cone(0.3, H3 + 2.6, 0.2, 4.6, 5.2, 0x3a9a8a, { segs: 8, col: 'wood', roll: 0.12, pitch: -0.06 });
  k.sphere(0.95, H3 + 5.4, 0.45, 0.25, PAL.mustard, { batch: 'glow' });
  k.pop();
  // roof terrace railings
  for (const [ax, az, bx, bz] of [[0.2, d2 - 0.2, w2 - 0.2, d2 - 0.2], [w2 - 0.2, d2 - 0.2, w2 - 0.2, -d2 + 0.2], [w2 - 0.2, -d2 + 0.2, 0.2, -d2 + 0.2]] as [number, number, number, number][]) {
    const L = Math.hypot(bx - ax, bz - az), yw = Math.atan2(-(bz - az), bx - ax);
    k.push((ax + bx) / 2, 0, (az + bz) / 2, yw);
    k.box(0, 0.5, 0, L, 1.0, 0.14, 0x5e5468, { col: 'stone' });
    k.pop();
  }
  // crooked chimneys
  k.box(w2 - 1.2, 1.6, -d2 + 1, 0.8, 3.2, 0.8, 0x5e5468, { col: 'stone', roll: 0.12 });
  k.box(1.5, 1.2, d2 - 0.9, 0.7, 2.4, 0.7, 0x5e5468, { col: 'stone', roll: -0.1, pitch: 0.08 });
  k.pop();
  const [smx, , smz] = [X + MX + 0.2 + 5.2, 0, Z + MZ - 3.2];
  world.addSmoke(new THREE.Vector3(smx, Y + H1 + H2 + 3.4, smz));
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [X + MX + lx, Y + ly, Z + MZ + lz];
  loot(world, ...at(-3, 0.1, -1), 'weapon');
  loot(world, ...at(4, 0.1, -2));
  loot(world, ...at(-4, 0.1, 3), 'weapon');
  loot(world, ...at(3, H1 + 0.3, 1.5), 'weapon');
  loot(world, ...at(-2, H1 + 0.3, -2));
  loot(world, ...at(0, H1 + 0.3, 5.2));
  loot(world, ...at(4, H1 + H2 + 0.3, 1), 'weapon');
  crate(world, ...at(-3.2, H1 + H2 + 0.3, 0.5), 0.1); // tower room
  crate(world, ...at(-2.6, H1 + H2 + H3 + 0.3, 0), 0); // on the tower roof ledge? (blink only)
  world.addZone('Crooked Manor', X + MX - hw, Z + MZ - hd, X + MX + hw, Z + MZ + hd + 1.8, Y - 1, Y + H1 + H2 + H3 + 2, true);

  // ---------------------------------------------------------------- iron fence with a gate (SW)
  const R = C.pad - 0.8;
  const gateA = Math.atan2(-(-50 - Z), -(40 - X)) ; // unused precise, gate faces the road
  void gateA;
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    // gap toward the road (south-west) and a back gate (north-east) into the maze
    const dx = Math.cos(mid), dz = Math.sin(mid);
    if ((dx < -0.55 && dz > 0.45) || (dx > 0.62 && dz < -0.5 && dx < 0.8)) continue;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    const L = Math.hypot(x1 - x0, z1 - z0), yw = Math.atan2(-(z1 - z0), x1 - x0);
    k.push((x0 + x1) / 2, 0, (z0 + z1) / 2, yw);
    k.box(0, 0.12, 0, L, 0.24, 0.3, 0x5e5468);
    k.box(0, 1.55, 0, L, 0.06, 0.06, 0x2b2238);
    k.box(0, 0.35, 0, L, 0.06, 0.06, 0x2b2238);
    for (let p = 0; p < 5; p++) {
      const px = -L / 2 + (p + 0.5) * (L / 5);
      k.box(px, 0.9, 0, 0.05, 1.8, 0.05, 0x2b2238, { ao: 0 });
      k.cone(px, 1.86, 0, 0.06, 0.16, 0x2b2238, { segs: 4 });
    }
    k.collider(0, 0.9, 0, L, 1.8, 0.15, 'metal', { flags: 1 | 4 });
    k.pop();
  }
  // gate posts with lanterns
  for (const [gx, gz] of [[-R * 0.62, R * 0.78], [-R * 0.82, R * 0.55]]) {
    k.box(gx, 1.2, gz, 0.6, 2.4, 0.6, 0x5e5468, { col: 'stone' });
    k.sphere(gx, 2.6, gz, 0.22, PAL.mustard, { batch: 'glow' });
  }
  const sign = makeSign('CROOKED MANOR', { w: 3.2, h: 0.8, sub: 'no refunds on frights', bg: '#e8d8f0' });
  const [sx, sy, sz] = k.w(-R * 0.72, 3.1, R * 0.67);
  sign.position.set(sx, sy, sz);
  sign.rotation.y = -Math.PI * 0.75 + Math.PI;
  world.group.add(sign);

  // ---------------------------------------------------------------- friendly graveyard (west)
  for (let i = 0; i < 12; i++) {
    const gx = -9 + (i % 4) * 1.8 + rng.range(-0.2, 0.2), gz = -4 + Math.floor(i / 4) * 2.4;
    k.box(gx, 0.45, gz, 0.8, 0.9, 0.22, shade(0x9c9384, rng.range(0.8, 1.05)), { r: 0.12, col: 'stone', yaw: rng.range(-0.2, 0.2), roll: rng.range(-0.15, 0.15) });
  }
  for (let i = 0; i < 8; i++) world.addKickable(X + rng.range(-11, -4), Y, Z + rng.range(-5, 6), 'pumpkin');
  // crooked bare trees
  for (const [tx, tz] of [[-10, 7], [-4, 9], [9, 8], [-11, -8]]) {
    k.push(tx, 0, tz, rng.range(0, 6));
    k.cyl(0, 1.5, 0, 0.18, 0.3, 3, 0x4e3b3a, { col: 'wood', roll: 0.2, segs: 6 });
    for (let b = 0; b < 4; b++) k.cyl(Math.cos(b * 1.6) * 0.5, 2.6 + b * 0.25, Math.sin(b * 1.6) * 0.5, 0.05, 0.1, 1.4, 0x4e3b3a, { roll: 0.9 * (b % 2 ? 1 : -1), yaw: b * 1.6, segs: 4 });
    k.ico(0.4, 3.6, 0, 0.9, 0x8a6bb8, { batch: 'foliage', wind: 0.4, detail: 0 });
    k.pop();
  }
  loot(world, X - 6, Y + 0.08, Z + 1.5, 'weapon');
  buildNest(k, world, X - 7, Z + 8.5, Y);

  // ---------------------------------------------------------------- hedge maze (east, behind the manor)
  const MZX = 8.5, MZZ = 6;
  const hedgeSeg = (x1: number, z1: number, x2: number, z2: number) => P.hedge(k, MZX + x1, MZZ + z1, MZX + x2, MZZ + z2, 1.9);
  hedgeSeg(-4, -3, 4, -3);
  hedgeSeg(4, -3, 4, 5);
  hedgeSeg(-4, 5, 2, 5);
  hedgeSeg(-4, -3, -4, 3);
  hedgeSeg(-2, -1, 2, -1);
  hedgeSeg(2, -1, 2, 3);
  hedgeSeg(-2, 1, -2, 5);
  hedgeSeg(0, 1, 0, 3);
  crate(world, X + MZX + 1, Y + 0.02, Z + MZZ + 2, 0.2);
  k.pop();

  // ---------------------------------------------------------------- the hillside: boulders & spooky woods
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(C.pad + 3, C.pad + 11);
    const ox = X + Math.cos(a) * d, oz = Z + Math.sin(a) * d;
    if (Math.cos(a) < -0.5 && Math.sin(a) > 0.3) continue; // keep the road clear
    outcrop(k, rng, ox, oz, rng.range(0.8, 1.3));
  }
  woods(k, rng, X + 22, Z - 10, 8, 10, ['tall']);
  woods(k, rng, X - 4, Z - 24, 7, 8, ['tall', 'round']);
  dressing(k, rng, X, Z, C.r + 12, 240);
}
