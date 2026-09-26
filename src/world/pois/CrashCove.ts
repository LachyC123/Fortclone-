import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, WallStyle, wall, floor, stairs, gableRoof, shade } from '../BuildingKit';
import { POI_BY_ID, LAGOON_POS, islandRadius } from '../Heightmap';
import { buildNest } from '../Cottages';
import { makeSign } from '../Signs';
import { ground, on, loot, lootG, crate, crateG, stilt, outcrop, dressing, lowGround, highGround } from './common';

const LIGHT: WallStyle = { outer: 0xfff6e6, inner: 0xf2e6d0, trim: 0xc9573f, surface: 'stone', plinth: PAL.stoneDark };
const HUT: WallStyle = { outer: 0x7fb7e6, inner: 0xdcecf5, trim: 0xfff6e6, surface: 'wood' };

/**
 * CRASH COVE — a sandy bay where an old sky-ship came down. Climb into the tilted wreck, snipe
 * from the lighthouse, fight across the pier, or duck behind the deflated balloon. The lagoon
 * pours right off the island edge.
 */
export function buildCrashCove(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(1111);
  const C = POI_BY_ID.cove;
  const X = C.x, Z = C.z;
  const L = LAGOON_POS;

  // --- lagoon water + waterfall where it spills off the edge
  world.addWater(L.x, -0.28, L.z - 1, 16, 15);
  const ang = Math.atan2(L.z, L.x);
  const R = islandRadius(ang);
  world.addWaterfall(Math.cos(ang) * (R - 0.2), -0.4, Math.sin(ang) * (R - 0.2), 7);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rx = L.x + Math.cos(a) * (L.r + 0.6), rz = L.z + Math.sin(a) * (L.r + 0.6);
    if (Math.hypot(rx, rz) > islandRadius(Math.atan2(rz, rx)) - 2) continue;
    P.rock(k, rx, ground(rx, rz) - 0.3, rz, rng.range(0.5, 0.9), 0xcfc2ac);
  }

  // --- the pier out into the lagoon
  const pz0 = L.z - L.r - 2, pz1 = L.z + 3;
  for (let z = pz0; z < pz1; z += 0.55) k.box(L.x, 0.32, z, 2.2, 0.12, 0.5, rng.chance(0.5) ? PAL.wood : PAL.woodLight, { ao: 0 });
  k.collider(L.x, 0.3, (pz0 + pz1) / 2, 2.2, 0.16, pz1 - pz0, 'wood');
  for (let z = pz0; z < pz1; z += 2.2) for (const s of [-1, 1]) k.cyl(L.x + s * 1.05, -0.4, z, 0.1, 0.12, 1.6, PAL.brownDark, { segs: 6 });
  k.box(L.x, 0.25, pz1 + 1.2, 4.5, 0.12, 2.4, PAL.woodLight, { col: 'wood' });
  // rowboat tied to the pier (cover on the water)
  k.push(L.x + 2.3, -0.1, L.z, 0.2);
  k.box(0, 0.2, 0, 3, 0.5, 1.2, PAL.terracotta, { r: 0.2, col: 'wood' });
  k.box(0, 0.42, 0, 2.6, 0.08, 0.9, PAL.woodLight);
  k.pop();
  loot(world, L.x, 0.45, pz1 + 1.2, 'weapon');

  // --- the crashed sky-ship (tilted hull you can climb inside)
  const SX = X + 13, SZ = Z + 2;
  const sg = lowGround(SX, SZ, 5, 3);
  k.push(SX, sg - 0.3, SZ, -0.5);
  const roll = 0.16;
  // hull sides
  k.box(0, 1.5, -1.9, 12, 3, 0.25, 0x8a5a3b, { col: 'wood', roll });
  k.box(-2, 1.5, 1.9, 8, 3, 0.25, 0x8a5a3b, { col: 'wood', roll }); // a gap at the bow end on this side = entrance
  k.box(0, 0.05, 0, 12, 0.3, 3.8, 0x5e3b27, { col: 'wood', roll });
  k.box(-6, 1.5, 0, 0.25, 3, 3.8, 0x8a5a3b, { col: 'wood', roll });
  // deck (half broken) — a roof you can stand on
  k.box(-2.5, 3.05, 0, 7, 0.2, 4, PAL.woodLight, { col: 'wood', roll });
  for (let i = 0; i < 6; i++) k.box(-2.5 - 3 + i * 1.2, 3.17, 0, 0.05, 0.02, 4, PAL.brownDark, { roll, ao: 0 });
  // bow stuck in the sand, stripes, portholes
  k.prism(6.4, 0, 0, 3.8, 1.6, 3, 0x8a5a3b, { yaw: -Math.PI / 2, pitch: 0 });
  k.box(0, 2.3, -2.03, 12, 0.3, 0.02, PAL.mustard, { roll, ao: 0 });
  for (let i = 0; i < 4; i++) k.cyl(-4 + i * 2.2, 1.7, -2.05, 0.28, 0.28, 0.08, 0xbff3ff, { pitch: Math.PI / 2, segs: 10 });
  // broken mast + torn sail
  k.cyl(-1.5, 5.5, 0, 0.18, 0.22, 5, PAL.brown, { roll: 0.5, col: 'wood' });
  k.box(-0.3, 5.2, 0.1, 0.05, 2.4, 2.6, 0xfff6e6, { roll: 0.5, batch: 'foliage', wind: 0.8 });
  // spinning propeller on the stern (still going, somehow)
  k.pop();
  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.06), new THREE.MeshStandardMaterial({ color: 0xc9a24e }));
    b.position.y = 0.8;
    const pv = new THREE.Group();
    pv.rotation.x = (i / 3) * Math.PI * 2;
    pv.add(b);
    prop.add(pv);
  }
  const cs = Math.cos(-0.5), sn = Math.sin(-0.5);
  prop.position.set(SX + -6.3 * cs, sg + 1.5, SZ - -6.3 * sn);
  prop.rotation.y = -0.5;
  world.addSpinner(prop, 'x', 1.2);
  const shipAt = (lx: number, ly: number, lz: number): [number, number, number] => [SX + lx * cs + lz * sn, sg + ly, SZ - lx * sn + lz * cs];
  loot(world, ...shipAt(-3, 0.5, 0), 'weapon');
  loot(world, ...shipAt(1, 0.45, 0.5));
  crate(world, ...shipAt(-4, 3.35, 0), 0.3);
  world.addZone('The Wreck', SX - 6.5, SZ - 6.5, SX + 6.5, SZ + 6.5, sg - 1, sg + 4, true);
  // the deflated balloon draped over the dunes (big soft cover)
  on(k, X + 10, Z - 11, () => {
    k.sphere(0, 0.2, 0, 4.2, 0xf28fad, { sy: 0.38, sx: 1.3, segs: 14, col: 'cloth' });
    for (let i = 0; i < 6; i++) k.box(Math.cos(i) * 3, 0.6, Math.sin(i) * 2, 0.8, 0.12, 4.6, i % 2 ? 0xfff6e6 : 0xf28fad, { yaw: i * 0.5, pitch: 0.2, batch: 'foliage', wind: 0.2 });
  });

  // --- lighthouse on the rocky western point (tallest perch on the island)
  const LX = X - 20, LZ = Z + 4;
  const lg = highGround(LX, LZ, 2.6) + 0.05;
  const FL = 3.4;
  outcrop(k, rng, LX + 6, LZ + 5.5, 1.1);
  outcrop(k, rng, LX - 6, LZ + 4, 0.9);
  k.push(LX, lg, LZ, 0.2);
  k.box(0, -0.9, 0, 5, 1.8, 5, PAL.stoneDark, { col: 'stone' });
  for (let f = 0; f < 3; f++) {
    const y0 = f * FL;
    const st = f % 2 ? LIGHT : { ...LIGHT, outer: 0xc9573f };
    wall(k, -2.2, 2.2, 2.2, 2.2, y0, FL, st, f === 0 ? [{ at: 2.2, w: 1.2, h: 2.3, kind: 'door' }] : [{ at: 2.2, w: 0.9, h: 1, sill: 1.2 }], 1, doors);
    wall(k, 2.2, 2.2, 2.2, -2.2, y0, FL, st, [{ at: 2.2, w: 0.9, h: 1, sill: 1.2 }]);
    wall(k, 2.2, -2.2, -2.2, -2.2, y0, FL, st, f === 1 ? [{ at: 2.2, w: 0.9, h: 1, sill: 1.2 }] : []);
    wall(k, -2.2, -2.2, -2.2, 2.2, y0, FL, st, [{ at: 2.2, w: 0.9, h: 1, sill: 1.2 }]);
    // stairs along alternating walls up to the next floor
    const alt = f % 2 === 0;
    stairs(k, alt ? -1.95 : 1.95, y0, alt ? -1.45 : 1.45, alt ? 0 : Math.PI, 0.9, FL, 3.4, 0xd3a26f, PAL.brownDark);
    floor(k, -2.05, -2.05, 2.05, 2.05, y0 + FL, 0.2, 0xb58052, 'wood', alt ? [-2.05, -2.05, 1.6, -0.9] : [-1.6, 0.9, 2.05, 2.05]);
  }
  const TOP = 3 * FL;
  // lamp room + balcony
  floor(k, -3.2, -3.2, 3.2, 3.2, TOP, 0.22, PAL.stoneDark, 'stone', [-1.6, 0.9, 2.05, 2.05]);
  for (const [ax, az, bx, bz] of [[-3.2, -3.2, 3.2, -3.2], [3.2, -3.2, 3.2, 3.2], [3.2, 3.2, -3.2, 3.2], [-3.2, 3.2, -3.2, -3.2]] as [number, number, number, number][]) {
    const Ls = Math.hypot(bx - ax, bz - az), yw = Math.atan2(-(bz - az), bx - ax);
    k.push((ax + bx) / 2, TOP, (az + bz) / 2, yw);
    k.box(0, 0.55, 0, Ls, 0.08, 0.08, 0xc9573f);
    for (let p = 0; p < 6; p++) k.box(-Ls / 2 + (p + 0.5) * (Ls / 6), 0.3, 0, 0.06, 0.6, 0.06, 0xc9573f);
    k.collider(0, 0.5, 0, Ls, 1.0, 0.1, 'metal', { flags: 1 });
    k.pop();
  }
  k.cyl(0, TOP + 1.2, 0, 1.4, 1.4, 2.2, 0xbff3ff, { segs: 10 });
  k.cone(0, TOP + 3.0, 0, 1.9, 1.4, 0xc9573f, { segs: 10 });
  k.sphere(0, TOP + 1.2, 0, 0.7, 0xfff2a0, { batch: 'glow' });
  k.collider(0, TOP + 1.2, 0, 2.2, 2.2, 2.2, 'stone', { flags: 1 | 2 | 4 });
  k.pop();
  // rotating light beam
  const beam = new THREE.Group();
  const bm = new THREE.Mesh(new THREE.ConeGeometry(1.6, 18, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  bm.rotation.z = Math.PI / 2;
  bm.position.x = 9;
  beam.add(bm);
  beam.position.set(LX, lg + TOP + 1.2, LZ);
  world.addSpinner(beam, 'y', 0.6);
  const lhAt = (lx: number, ly: number, lz: number): [number, number, number] => {
    const c2 = Math.cos(0.2), s2 = Math.sin(0.2);
    return [LX + lx * c2 + lz * s2, lg + ly, LZ - lx * s2 + lz * c2];
  };
  loot(world, ...lhAt(1, 0.1, 1), 'weapon');
  loot(world, ...lhAt(-1, FL + 0.3, 1));
  loot(world, ...lhAt(1, 2 * FL + 0.3, -1), 'weapon');
  crate(world, ...lhAt(2.6, TOP + 0.3, -2.6), 0.2);
  world.addZone('Lighthouse', LX - 3.3, LZ - 3.3, LX + 3.3, LZ + 3.3, lg - 1, lg + TOP + 4, true);

  // --- fishing huts on stilts
  const hut = (hx: number, hz: number, yaw: number) => {
    const top = lowGround(hx, hz, 2) + 2.2;
    for (const [sx, sz] of [[-1.8, -1.6], [1.8, -1.6], [-1.8, 1.6], [1.8, 1.6]]) stilt(k, hx + sx, hz + sz, top, 0.14);
    k.push(hx, top, hz, yaw);
    floor(k, -2.2, -2.2, 2.2, 2.2, 0, 0.2, PAL.woodLight, 'wood');
    wall(k, -1.8, 1.4, 1.8, 1.4, 0, 2.4, HUT, [{ at: 1.8, w: 1.1, h: 2.1, kind: 'door' }], 1, doors);
    wall(k, 1.8, 1.4, 1.8, -1.8, 0, 2.4, HUT, [{ at: 1.6, w: 0.9, h: 0.9, sill: 1 }]);
    wall(k, 1.8, -1.8, -1.8, -1.8, 0, 2.4, HUT, [{ at: 1.8, w: 0.9, h: 0.9, sill: 1 }]);
    wall(k, -1.8, -1.8, -1.8, 1.4, 0, 2.4, HUT, []);
    gableRoof(k, 0, 2.4, -0.2, 0, 3.8, 3.4, 1.2, PAL.roofRed, { overhang: 0.3 });
    const rise = top - ground(hx, hz) + 0.1;
    stairs(k, -0.5, -rise, 2.2 + rise, -Math.PI / 2, 1, rise, rise, PAL.woodLight);
    k.pop();
    loot(world, hx, top + 0.2, hz - 0.3, 'weapon');
    world.addZone('Fishing Hut', hx - 2.2, hz - 2.2, hx + 2.2, hz + 2.2, top - 0.5, top + 3.5, true);
  };
  hut(X + 1, Z - 7, 0.1);
  hut(X + 3, Z + 12, Math.PI - 0.2);

  // --- beach life: palms, umbrellas, towels, sandcastles, driftwood (low cover everywhere)
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(6, 20);
    const px = X + Math.cos(a) * d, pz = Z + Math.sin(a) * d;
    if (Math.hypot(px - L.x, pz - L.z) < L.r + 1.5 || Math.hypot(px - SX, pz - SZ) < 7 || Math.hypot(px - LX, pz - LZ) < 5) continue;
    if (Math.hypot(px, pz) > islandRadius(Math.atan2(pz, px)) - 3) continue;
    on(k, px, pz, () => {
      const h = rng.range(4, 6);
      const lean = rng.range(-0.25, 0.25);
      for (let s = 0; s < 6; s++) k.cyl(Math.sin(lean) * s * h / 6, (s + 0.5) * h / 6, 0, 0.16, 0.19, h / 6 + 0.05, shade(0xb07a4f, s % 2 ? 1 : 0.9), { segs: 6, roll: -lean, batch: 'foliage', wind: 0.05 * s, col: s === 0 ? 'wood' : null });
      for (let f = 0; f < 6; f++) k.box(Math.sin(lean) * h + Math.cos(f) * 1.1, h + 0.1, Math.sin(f) * 1.1, 2.4, 0.06, 0.6, shade(PAL.leaf, 0.9 + (f % 3) * 0.08), { yaw: -f, roll: 0.35, batch: 'foliage', wind: 0.9 });
      k.collider(Math.sin(lean) * h, h, 0, 3, 0.8, 3, 'grass', { flags: 8 });
    }, rng.range(0, 6));
  }
  const umbrella = (ux: number, uz: number, c: number) => on(k, ux, uz, () => {
    k.cyl(0, 1.1, 0, 0.04, 0.04, 2.2, 0xffffff, { segs: 4 });
    k.cone(0, 2.3, 0, 1.3, 0.5, c, { segs: 8, batch: 'foliage', wind: 0.1 });
    k.box(0.9, 0.03, 0.6, 1.8, 0.03, 0.8, c === PAL.teal ? PAL.mustard : PAL.teal, { ao: 0 });
  });
  umbrella(X - 2, Z + 2, PAL.pink);
  umbrella(X + 3, Z - 2, PAL.teal);
  umbrella(X - 8, Z + 6, PAL.mustard);
  for (const [cx, cz] of [[X + 1, Z + 5], [X - 6, Z - 2]]) on(k, cx, cz, () => {
    k.box(0, 0.3, 0, 1.4, 0.6, 1.4, 0xe6d3a3, { col: 'dirt' });
    for (const [tx, tz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) k.cyl(tx, 0.8, tz, 0.22, 0.26, 0.5, 0xe6d3a3, { segs: 6 });
    k.cone(0, 1.05, 0, 0.12, 0.3, PAL.terracotta, { segs: 3 });
  });
  for (let i = 0; i < 5; i++) on(k, X + rng.range(-14, 14), Z + rng.range(-12, 12), () => k.cyl(0, 0.25, 0, 0.22, 0.28, rng.range(2.5, 4), 0xc9b79a, { roll: Math.PI / 2, col: 'wood', segs: 6 }), rng.range(0, 3));
  for (let i = 0; i < 6; i++) on(k, X + rng.range(-12, 12), Z + rng.range(-12, 12), () => P.crate(k, 0, 0, 0, rng.range(0.7, 1.1), rng.range(0, 1), rng.pick([PAL.woodLight, PAL.mustard])), 0, -0.1);
  lootG(world, X - 3, Z - 3, 'weapon');
  lootG(world, X + 6, Z + 6);
  lootG(world, X - 12, Z + 12);
  crateG(world, X + 11, Z - 16.5, 0.4); // behind the balloon

  const sign = makeSign('CRASH COVE', { w: 3, h: 0.8, sub: 'swimming at own risk', bg: '#e6f6ff' });
  const sgx = X + 2, sgz = Z - 17;
  sign.position.set(sgx, ground(sgx, sgz) + 2.4, sgz);
  sign.rotation.y = Math.PI + 0.3;
  world.group.add(sign);
  buildNest(k, world, X - 4, Z - 14, ground(X - 4, Z - 14));
  dressing(k, rng, X, Z - 14, 12, 120);
  for (let i = 0; i < 4; i++) world.addFlyer('bird', new THREE.Vector3(X + rng.range(-10, 10), 16, Z + rng.range(-10, 10)), rng.range(10, 20), rng.range(0, 6));
}
