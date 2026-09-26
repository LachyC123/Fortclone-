import * as THREE from 'three';
import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { DoorSpec, WallStyle, wall, floor, stairs, shade } from '../BuildingKit';
import { POI_BY_ID } from '../Heightmap';
import { buildNest } from '../Cottages';
import { makeSign } from '../Signs';
import { toyMaterial } from '../../render/Materials';
import { loot, crate, dressing, woods } from './common';

const SHED: WallStyle = { outer: 0x8fa3b0, inner: 0xc8d3da, trim: 0x4e5a66, surface: 'metal', plinth: 0x5e6670 };
const SHED2: WallStyle = { outer: 0xd9774f, inner: 0xe8c0a8, trim: 0x5e3b27, surface: 'metal', plinth: 0x5e6670 };
const RUST = 0xb85c3b;
const STEEL = 0x8f99a6;
const DARK = 0x4e5a66;

/**
 * RATTLEWORKS — a clanking workshop yard. Two big halls with catwalks, a gear tower that
 * actually turns, a silo you can only reach by blink, shipping containers to duck through, and
 * scrap heaps everywhere. Lots of hard cover at mid range.
 */
export function buildRattleworks(k: Kit, world: World, doors: DoorSpec[]) {
  const rng = new Rng(1010);
  const C = POI_BY_ID.rattleworks;
  const X = C.x, Z = C.z, Y = C.h;
  k.push(X, Y, Z, 0);

  // --- concrete yard + painted lines
  k.box(0, -0.12, 0, 36, 0.3, 32, 0xb8b2a8, { batch: 'nocast', ao: 0 });
  for (let i = 0; i < 6; i++) k.box(-14 + i * 5.6, 0.04, 2, 0.3, 0.02, 3, PAL.mustard, { batch: 'nocast', ao: 0 });

  // --- a big hall with a catwalk mezzanine
  const hall = (hx: number, hz: number, yaw: number, W: number, D: number, H: number, style: WallStyle, name: string) => {
    const hw = W / 2, hd = D / 2;
    k.push(hx, 0, hz, yaw);
    k.box(0, -0.9, 0, W + 0.2, 1.8, D + 0.2, 0x7a7670, { col: 'stone' });
    floor(k, -hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.04, 0.08, 0x9a9a92, 'stone');
    // big roll-up door opening on the front, small doors on the sides, high windows
    wall(k, -hw, hd, hw, hd, 0, H, style, [{ at: W * 0.35, w: 4, h: 3.4, kind: 'arch' }, { at: W * 0.8, w: 1.4, h: 1.2, sill: 3.2 }]);
    wall(k, hw, hd, hw, -hd, 0, H, style, [{ at: D * 0.3, w: 1.2, h: 2.3, kind: 'door' }, { at: D * 0.7, w: 1.4, h: 1.1, sill: 3.4 }], 1, doors);
    wall(k, hw, -hd, -hw, -hd, 0, H, style, [{ at: W * 0.25, w: 1.6, h: 1.1, sill: 3.4 }, { at: W * 0.6, w: 1.2, h: 2.3, kind: 'door' }, { at: W * 0.85, w: 1.6, h: 1.1, sill: 3.4 }], 1, doors);
    wall(k, -hw, -hd, -hw, hd, 0, H, style, [{ at: D * 0.5, w: 1.6, h: 1.1, sill: 3.4 }]);
    // corrugated roof (flat, walkable) with skylight gaps
    for (let i = 0; i < Math.round(W / 1.2); i++) k.box(-hw + 0.6 + i * 1.2, H + 0.1, 0, 1.15, 0.16, D + 0.6, i % 2 ? shade(DARK, 1.1) : DARK, { ao: 0 });
    k.collider(0, H + 0.1, 0, W + 0.2, 0.2, D + 0.6, 'metal');
    // catwalk along the back wall at 3.2m, stairs up at the left
    const cw = 2;
    floor(k, -hw + 0.2, -hd + 0.2, hw - 0.2, -hd + 0.2 + cw, 3.2, 0.14, STEEL, 'metal');
    k.box(0, 3.2 + 0.55, -hd + 0.2 + cw, W - 0.4, 0.06, 0.06, PAL.mustard);
    k.collider(1.4, 3.2 + 0.5, -hd + 0.2 + cw, W - 3.2, 1.0, 0.1, 'metal', { flags: 1 });
    stairs(k, -hw + 0.3, 0, -hd + 0.2 + cw + 0.7, 0, 1.2, 3.2, 3.6, STEEL, PAL.mustard);
    // machines: lathes & workbenches (cover)
    for (let i = 0; i < 4; i++) {
      const mx = -hw + 3 + i * (W - 6) / 3, mz = rng.range(-0.2, 0.6);
      k.box(mx, 0.6, mz, 2.2, 1.2, 1.1, i % 2 ? RUST : STEEL, { col: 'metal', r: 0.08 });
      k.cyl(mx - 0.6, 1.35, mz, 0.3, 0.3, 0.5, DARK, { roll: Math.PI / 2, segs: 10 });
      k.box(mx + 0.5, 1.3, mz, 0.6, 0.3, 0.6, PAL.mustard, { r: 0.05 });
    }
    for (let i = 0; i < 4; i++) P.barrel(k, hw - 1 - i * 0.7, 0.05, hd - 0.8, i % 2 ? RUST : PAL.teal);
    k.pop();
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const at = (lx: number, ly: number, lz: number): [number, number, number] => [X + hx + lx * cs + lz * sn, Y + ly, Z + hz - lx * sn + lz * cs];
    loot(world, ...at(0.3, 0.1, hd - 1.4), 'weapon');
    loot(world, ...at(-hw + 2, 0.1, hd - 1.2));
    loot(world, ...at(hw - 3, 3.35, -hd + 1.2), 'weapon');
    loot(world, ...at(-2, 3.35, -hd + 1.2));
    crate(world, ...at(2, H + 0.25, 0), rng.range(0, 3)); // roof
    const R = Math.max(hw, hd);
    world.addZone(name, X + hx - R, Z + hz - R, X + hx + R, Z + hz + R, Y - 1, Y + H + 2, true);
  };
  hall(-8, -7, 0, 15, 10, 6.2, SHED, 'Big Clank Hall');
  hall(9, 6, -Math.PI / 2, 12, 9, 5.4, SHED2, 'Sprocket Shed');

  // --- gear tower (turning gears, climbable scaffold)
  const GX = 10, GZ = -9;
  for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) k.box(GX + sx, 5, GZ + sz, 0.3, 10, 0.3, DARK, { col: 'metal' });
  for (let lvl = 1; lvl <= 3; lvl++) {
    k.box(GX, lvl * 3, GZ, 3.6, 0.18, 3.6, STEEL, { col: 'metal' });
    for (const s of [-1, 1]) k.box(GX + s * 1.75, lvl * 3 + 0.5, GZ, 0.08, 0.08, 3.6, PAL.mustard);
  }
  // ramps between levels (switchback stairs on the outside)
  stairs(k, GX - 1.2, 0, GZ + 2.5, 0, 1, 3, 3, STEEL, PAL.mustard);
  stairs(k, GX + 1.8, 3, GZ - 2.5, Math.PI, 1, 3, 3, STEEL, PAL.mustard);
  stairs(k, GX - 1.2, 6, GZ + 2.5, 0, 1, 3, 3, STEEL, PAL.mustard);
  k.pop();
  const gearMat = toyMaterial(0xc9a24e, { rough: 0.45 });
  const gearMat2 = toyMaterial(STEEL, { rough: 0.45 });
  const gear = (r: number, mat: THREE.Material) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), mat);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const teeth = Math.round(r * 9);
    for (let i = 0; i < teeth; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 0.3), mat);
      const a = (i / teeth) * Math.PI * 2;
      t.position.set(Math.cos(a) * (r + 0.12), Math.sin(a) * (r + 0.12), 0);
      t.rotation.z = a;
      g.add(t);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.5, 12), toyMaterial(DARK));
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
  };
  const g1 = gear(1.6, gearMat);
  g1.position.set(X + GX, Y + 8.2, Z + GZ + 1.95);
  world.addSpinner(g1, 'z', 0.8);
  const g2 = gear(1.0, gearMat2);
  g2.position.set(X + GX + 2.55, Y + 9.2, Z + GZ + 1.95);
  world.addSpinner(g2, 'z', -1.3);
  k.push(X, Y, Z, 0);
  loot(world, X + GX, Y + 9.2, Z + GZ, 'weapon');
  crate(world, X + GX + 0.8, Y + 6.2, Z + GZ - 0.8, 0.4);

  // --- silo (blink-only top) and a crane
  k.cyl(-15, 4.5, 10, 2.4, 2.4, 9, 0xc8d3da, { col: 'metal', segs: 16 });
  k.cone(-15, 9.6, 10, 2.6, 1.4, RUST, { segs: 16 });
  k.cyl(-15, 9.1, 10, 2.5, 2.5, 0.2, DARK, { segs: 16 });
  k.collider(-15, 9.3, 10, 3.6, 0.4, 3.6, 'metal');
  for (let i = 0; i < 6; i++) k.box(-12.55, 1 + i * 1.4, 10, 0.08, 0.08, 0.6, DARK);
  crate(world, X - 15, Y + 9.55, Z + 10, 0);
  // crane: tower + arm + dangling hook box (another perch)
  k.box(15, 6, 12, 1.2, 12, 1.2, PAL.mustard, { col: 'metal' });
  k.box(11, 12.2, 12, 10, 0.6, 0.8, PAL.mustard, { col: 'metal' });
  k.box(15.5, 12.9, 12, 1.6, 1.2, 1.6, 0x4f7fb8, { col: 'metal' });
  k.box(8, 9.8, 12, 0.05, 4.2, 0.05, PAL.ink);
  k.box(8, 7.4, 12, 1.4, 0.6, 1.4, RUST, { col: 'metal' });
  loot(world, X + 15.5, Y + 13.6, Z + 12, 'weapon');

  // --- shipping containers: open ends so you can run through them
  const container = (cx: number, cz: number, yaw: number, color: number, y = 0) => {
    k.push(cx, y, cz, yaw);
    const L = 6, W = 2.4, H = 2.6;
    k.box(0, H / 2, -W / 2, L, H, 0.1, color, { col: 'metal' });
    k.box(0, H / 2, W / 2, L, H, 0.1, color, { col: 'metal' });
    k.box(0, H, 0, L, 0.1, W, shade(color, 0.9), { col: 'metal' });
    k.box(0, 0.05, 0, L, 0.1, W, DARK, { col: 'metal' });
    for (let i = 0; i < 8; i++) k.box(-L / 2 + 0.4 + i * 0.75, H / 2, -W / 2 - 0.06, 0.12, H - 0.2, 0.04, shade(color, 0.8), { ao: 0 });
    for (let i = 0; i < 8; i++) k.box(-L / 2 + 0.4 + i * 0.75, H / 2, W / 2 + 0.06, 0.12, H - 0.2, 0.04, shade(color, 0.8), { ao: 0 });
    k.pop();
  };
  container(-4, 9, 0.1, 0x3a9a8a);
  container(-4, 12, 0.05, 0xd9774f);
  container(-4, 10.5, 0.08, 0x4f7fb8, 2.7);
  container(2, -14, Math.PI / 2 - 0.1, 0xc9573f);
  container(-10, 14.5, 0, PAL.mustard);
  loot(world, X - 4, Y + 0.15, Z + 9, 'weapon');
  loot(world, X - 4, Y + 2.85, Z + 10.5);
  loot(world, X + 2, Y + 0.15, Z - 14);

  // --- scrap heaps (hard cover), conveyor, pipes
  for (let h = 0; h < 5; h++) {
    const sx = rng.range(-14, 14), sz = rng.range(-2, 3) + (h % 2 ? 14 : -15);
    for (let i = 0; i < 7; i++) {
      const s = rng.range(0.5, 1.2);
      if (rng.chance(0.5)) k.box(sx + rng.range(-1.2, 1.2), s * 0.4, sz + rng.range(-1, 1), s, s * 0.8, s * 1.2, rng.pick([RUST, STEEL, DARK, PAL.mustard]), { yaw: rng.range(0, 3), roll: rng.range(-0.3, 0.3), col: 'metal' });
      else k.cyl(sx + rng.range(-1.2, 1.2), s * 0.3, sz + rng.range(-1, 1), s * 0.3, s * 0.3, s * 1.4, rng.pick([RUST, STEEL]), { roll: Math.PI / 2, yaw: rng.range(0, 3), col: 'metal' });
    }
  }
  // conveyor between the halls
  k.box(-1.5, 1.0, -0.5, 9, 0.25, 1.4, DARK, { col: 'metal' });
  for (let i = 0; i < 11; i++) k.cyl(-5.7 + i * 0.84, 1.15, -0.5, 0.12, 0.12, 1.3, STEEL, { pitch: Math.PI / 2, segs: 6 });
  for (const s of [-5.8, -1.5, 2.8]) k.box(s, 0.45, -0.5, 0.3, 0.9, 1.2, DARK);
  for (let i = 0; i < 4; i++) P.crate(k, -4.5 + i * 2, 1.15, -0.5, 0.6, rng.range(0, 1), PAL.mustard);
  // pipes along the edge
  k.cyl(0, 3.5, -17, 0.4, 0.4, 30, STEEL, { roll: Math.PI / 2, segs: 10 });
  for (let i = 0; i < 6; i++) k.box(-14 + i * 5.6, 1.75, -17, 0.3, 3.5, 0.3, DARK, { col: 'metal' });
  // chain-link fence segments (bullets pass, rascals don't)
  for (const [x1, z1, x2, z2] of [[-18, -16, -18, -4], [-18, 4, -18, 16], [18, -16, 18, -2], [18, 6, 18, 16]] as [number, number, number, number][]) {
    const L = Math.hypot(x2 - x1, z2 - z1), yw = Math.atan2(-(z2 - z1), x2 - x1);
    k.push((x1 + x2) / 2, 0, (z1 + z2) / 2, yw);
    k.box(0, 1.1, 0, L, 2.2, 0.03, 0xc8d3da, { batch: 'nocast', ao: 0 });
    for (let i = 0; i <= Math.round(L / 3); i++) k.box(-L / 2 + i * 3, 1.15, 0, 0.1, 2.3, 0.1, DARK);
    k.collider(0, 1.1, 0, L, 2.2, 0.15, 'metal', { flags: 1 | 4 });
    k.pop();
  }
  k.pop();

  const sign = makeSign('RATTLEWORKS', { w: 3.2, h: 0.8, sub: 'mind the gears', bg: '#e8eef2' });
  sign.position.set(X - 18.2, Y + 3, Z);
  sign.rotation.y = -Math.PI / 2;
  world.group.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), toyMaterial(DARK));
  post.position.set(X - 18.3, Y + 1.5, Z);
  world.group.add(post);

  buildNest(k, world, X + 2, Z + 14, Y);
  crate(world, X + 0.5, Y + 0.02, Z + 3.5, 0.2);
  world.addSmoke(new THREE.Vector3(X - 8, Y + 7, Z - 11));
  woods(k, rng, X + 8, Z + 28, 7, 8);
  dressing(k, rng, X, Z, C.r + 10, 140);
}
