import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { floor, gableRoof, stairs, shade } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { ground, on, lowGround, highGround, loot, lootG, crate, crateG, ropeBridge, stilt, busy, dressing } from './common';

/**
 * WOBBLEWOOD — a deep, bouncy forest. Giant mushrooms you can stand on (and blink between),
 * treehouses joined by rope bridges, a hollow log tunnel and a glowing fairy ring. Thick canopy
 * means short sightlines: great for ambushes, terrible for snipers.
 */
export function buildWobblewood(k: Kit, world: World) {
  const rng = new Rng(707);
  const C = POI_BY_ID.wobblewood;
  const X = C.x, Z = C.z;

  // --- treehouses (platform at ~5m) + rope bridges between them. Each deck has a gap in the
  // middle of every side; the hut sits in the (-x,-z) corner so every gap stays clear.
  type Side = 'px' | 'nx' | 'pz' | 'nz';
  const houses: { x: number; z: number; stairs: Side; roof: number }[] = [
    { x: X - 7, z: Z - 6, stairs: 'nz', roof: PAL.roofRed },
    { x: X + 7, z: Z - 6, stairs: 'nz', roof: PAL.roofTeal },
    { x: X + 7, z: Z + 8, stairs: 'px', roof: PAL.roofPurple },
  ];
  const tops: THREE.Vector3[] = [];
  const HW = 2.6;
  houses.forEach((h, i) => {
    const hx = h.x, hz = h.z;
    const top = highGround(hx, hz, HW) + 4.8;
    tops.push(new THREE.Vector3(hx, top, hz));
    const g = ground(hx + 1.2, hz + 1.2) - 0.3;
    k.cyl(hx + 1.2, g + (top + 4 - g) / 2, hz + 1.2, 0.5, 0.75, top + 4 - g, PAL.brown, { col: 'wood', segs: 9 });
    k.ico(hx + 1.2, top + 4.6, hz + 1.2, 2.6, shade(PAL.leafDark, 1.1), { batch: 'foliage', wind: 0.5, detail: 1, sy: 0.8 });
    for (const [sx, sz] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) stilt(k, hx + sx, hz + sz, top);
    k.push(hx, top, hz, 0);
    floor(k, -HW, -HW, HW, HW, 0, 0.25, PAL.woodLight, 'wood');
    // rails on each side with a 1.8m gap in the middle
    for (const [ax, az, bx, bz] of [[-HW, -HW, HW, -HW], [HW, -HW, HW, HW], [HW, HW, -HW, HW], [-HW, HW, -HW, -HW]] as [number, number, number, number][]) {
      const L = Math.hypot(bx - ax, bz - az), yw = Math.atan2(-(bz - az), bx - ax);
      k.push((ax + bx) / 2, 0, (az + bz) / 2, yw);
      const seg = L / 2 - 0.9;
      for (const sg of [-1, 1]) {
        k.box(sg * (0.9 + seg / 2), 0.55, 0, seg, 0.1, 0.1, PAL.brownDark, { col: 'wood' });
        k.box(sg * (0.9 + seg / 2), 1.0, 0, seg, 0.1, 0.1, PAL.brownDark);
        k.collider(sg * (0.9 + seg / 2), 0.55, 0, seg, 1.1, 0.12, 'wood', { flags: 1 });
        for (let q = 0; q < 3; q++) k.box(sg * (0.9 + (q + 0.5) * (seg / 3)), 0.55, 0, 0.08, 1.1, 0.08, PAL.brownDark);
      }
      k.pop();
    }
    // corner hut
    k.box(-0.7, 1.3, -1.65, 0.14, 2.6, 1.9, shade(PAL.wood, 0.9), { col: 'wood' });
    k.box(-1.65, 1.3, -0.7, 1.9, 2.6, 0.14, shade(PAL.wood, 0.95), { col: 'wood' });
    k.box(-2.55, 1.3, -1.65, 0.14, 2.6, 1.9, shade(PAL.wood, 0.9), { col: 'wood' });
    k.box(-1.65, 1.3, -2.55, 1.9, 2.6, 0.14, shade(PAL.wood, 0.9), { col: 'wood' });
    gableRoof(k, -1.6, 2.6, -1.6, 0, 2.4, 2.4, 1.1, h.roof, { overhang: 0.3 });
    P.lamp(k, 2.0, 0.12, 2.0, PAL.mustard);
    // stairs from the ground up to the chosen gap (run along the side's outward normal)
    const out = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] }[h.stairs];
    let rise = 5, run = 5;
    for (let it = 0; it < 3; it++) {
      const sxw = hx + out[0] * (HW + run), szw = hz + out[1] * (HW + run);
      rise = top - ground(sxw, szw) + 0.05;
      run = rise * 1.05;
    }
    // stairs() climbs along its local +x: point it back toward the deck
    const yawIn = Math.atan2(out[1], -out[0]);
    stairs(k, out[0] * (HW + run), -rise, out[1] * (HW + run), yawIn, 1.3, rise, run, PAL.woodLight, PAL.brownDark);
    k.pop();
    loot(world, hx + 1.2, top + 0.2, hz - 1.2, i === 1 ? 'weapon' : 'any');
    loot(world, hx - 1.6, top + 0.2, hz - 1.6, 'weapon');
  });
  ropeBridge(k, tops[0].x + HW - 0.2, tops[0].y + 0.1, tops[0].z, tops[1].x - HW + 0.2, tops[1].y + 0.1, tops[1].z, 1.5);
  ropeBridge(k, tops[1].x, tops[1].y + 0.1, tops[1].z + HW - 0.2, tops[2].x, tops[2].y + 0.1, tops[2].z - HW + 0.2, 1.5);

  // --- giant mushrooms: caps are solid platforms (blink perches), stems are cover
  const shrooms: [number, number, number, number][] = [
    [X - 14, Z + 6, 6.5, PAL.terracotta],
    [X - 9, Z + 16, 4.5, PAL.lavender],
    [X + 14, Z + 10, 5.5, PAL.mustard],
    [X + 16, Z - 12, 3.8, PAL.pink],
    [X - 16, Z - 14, 5, PAL.lavender],
    [X + 4, Z - 16, 3.2, PAL.terracotta],
  ];
  shrooms.forEach(([mx, mz, h, cap], i) => {
    const g = lowGround(mx, mz, 0.8) - 0.2;
    const top = g + h;
    const cr = h * 0.55 + 1;
    k.cyl(mx, g + h / 2, mz, 0.45 + h * 0.06, 0.7 + h * 0.08, h, 0xfff1d8, { col: 'wood', segs: 10 });
    k.sphere(mx, top, mz, cr, cap, { sy: 0.42, segs: 14, col: null });
    k.cyl(mx, top - cr * 0.1, mz, cr * 0.96, cr * 0.9, 0.2, 0xfff1d8, { segs: 14 });
    k.collider(mx, top + cr * 0.12, mz, cr * 1.3, 0.35, cr * 1.3, 'cloth');
    k.collider(mx, top + cr * 0.12, mz, cr * 1.3, 0.35, cr * 1.3, 'cloth', { yaw: Math.PI / 4 });
    for (let s = 0; s < 6; s++) {
      const a = s * 1.1 + i;
      k.sphere(mx + Math.cos(a) * cr * 0.55, top + cr * 0.32, mz + Math.sin(a) * cr * 0.55, 0.22 + (s % 2) * 0.1, 0xffffff, { sy: 0.5 });
    }
    if (i < 3) crate(world, mx, top + cr * 0.12 + 0.2, mz, rng.range(0, 3));
    else if (i < 5) loot(world, mx + 0.6, top + cr * 0.12 + 0.25, mz, 'weapon');
  });

  // --- hollow log tunnel you can run through (and fight in)
  on(k, X - 4, Z - 20, () => {
    const L = 9, R = 1.35;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.box(0, 1.2 + Math.sin(a) * R, Math.cos(a) * R, L, 0.35, 0.95, shade(PAL.brown, 0.9 + (i % 3) * 0.06), { roll: 0, pitch: a + Math.PI / 2, col: 'wood' });
    }
    k.cyl(-L / 2, 1.2, 0, R + 0.1, R + 0.1, 0.3, PAL.woodLight, { roll: Math.PI / 2, segs: 12 });
    k.cyl(L / 2, 1.2, 0, R + 0.1, R + 0.1, 0.3, PAL.woodLight, { roll: Math.PI / 2, segs: 12 });
    k.collider(0, 0.02, 0, L, 0.3, 1.8, 'wood');
    for (let i = 0; i < 4; i++) P.mushroom(k, -3 + i * 2, 2.5, 0.7, PAL.terracotta);
  }, 0.5, -0.2);
  lootG(world, X - 4, Z - 20, 'weapon');

  // --- fairy ring clearing with glowing toadstools (and the Rift Nest)
  const fx = X - 1, fz = Z + 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, rx = fx + Math.cos(a) * 7, rz = fz + Math.sin(a) * 7;
    on(k, rx, rz, () => {
      k.cyl(0, 0.25, 0, 0.07, 0.09, 0.5, 0xfff1d8, { segs: 6 });
      k.sphere(0, 0.52, 0, 0.26, 0x9ffcff, { sy: 0.5, batch: 'glow' });
    });
  }
  buildNest(k, world, X - 8, Z + 9, ground(X - 8, Z + 9));

  // --- the wood itself: dense trees, bushes, logs and big rocks
  let placed = 0;
  for (let i = 0; i < 500 && placed < 70; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (C.r + 6);
    const tx = X + Math.cos(a) * d, tz = Z + Math.sin(a) * d;
    if (busy(tx, tz, 2.5, -100)) continue;
    if (houses.some((h) => Math.hypot(tx - h.x, tz - h.z) < 5.5 + (h.stairs === 'px' ? 3 : 0)) || (tx > X - 9 && tx < X + 9 && tz > Z - 14 && tz < Z + 12 && Math.abs(tx - (X + 7)) < 2)) continue;
    if (shrooms.some(([mx, mz, h]) => Math.hypot(tx - mx, tz - mz) < h * 0.55 + 2)) continue;
    if (Math.hypot(tx - fx, tz - fz) < 8.5 || Math.hypot(tx - (X - 8), tz - (Z + 9)) < 4 || Math.abs(tz - (Z - 6)) < 2 && Math.abs(tx - X) < 6 || (Math.abs(tx - (X - 4)) < 6 && Math.abs(tz - (Z - 20)) < 3)) continue;
    placed++;
    P.tree(k, tx, tz, rng.range(1.1, 1.7), ground(tx, tz) - 0.1, rng.chance(0.6) ? 'tall' : 'round');
    if (rng.chance(0.5)) on(k, tx + rng.range(-2, 2), tz + rng.range(-2, 2), () => P.bush(k, 0, 0, rng.range(0.9, 1.4), PAL.leafDark, rng.chance(0.2)));
    if (rng.chance(0.25)) on(k, tx + rng.range(-3, 3), tz + rng.range(-3, 3), () => P.mushroom(k, 0, 0, rng.range(0.8, 1.8), rng.pick([PAL.terracotta, PAL.lavender, PAL.mustard])));
  }
  // fallen logs (low cover)
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(6, C.r);
    const lx = X + Math.cos(a) * d, lz = Z + Math.sin(a) * d;
    if (busy(lx, lz, 2.5, -100)) continue;
    on(k, lx, lz, () => {
      k.cyl(0, 0.45, 0, 0.45, 0.5, 4.5, shade(PAL.brown, rng.range(0.85, 1.05)), { roll: Math.PI / 2, col: 'wood', segs: 8 });
      k.sphere(1.6, 0.9, 0, 0.3, PAL.leaf, { batch: 'foliage', wind: 0.2 });
    }, rng.range(0, 3));
  }
  lootG(world, X + 12, Z + 18);
  lootG(world, X - 18, Z - 2, 'weapon');
  lootG(world, X + 18, Z - 2);
  crateG(world, X - 1, Z + 1, 0.3); // centre of the fairy ring
  dressing(k, rng, X, Z, C.r + 4, 260);
  for (let i = 0; i < 8; i++) world.addFlyer('butterfly', new THREE.Vector3(X + rng.range(-15, 15), ground(X, Z) + 0.5, Z + rng.range(-15, 15)), rng.range(1.5, 4), rng.range(0.5, 2));
  void busy;
}
