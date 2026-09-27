import * as THREE from 'three';
import { Kit } from './Kit';
import type { World } from './World';
import * as P from './Props';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { Rng } from '../core/math';
import { makeSign } from './Signs';
import { shade } from './BuildingKit';

/**
 * Launch Isle: the little floating waiting-room island. Rascals mill about here before the Sky
 * Barge docks; it's in sight of the main island so the destination is always on show.
 */
export function buildLaunchIsle(k: Kit, world: World) {
  const c = world.lobby.center;
  const R = world.lobby.radius;
  const rng = new Rng(99);
  k.push(c.x, c.y, c.z, 0);
  // grassy top + craggy underside
  k.cyl(0, -0.3, 0, R, R - 0.5, 0.6, PAL.grass, { segs: 36, batch: 'nocast' });
  k.cyl(0, -0.62, 0, R - 0.4, R - 0.2, 0.08, PAL.grassDark, { segs: 36, batch: 'nocast' });
  k.cone(0, -9, 0, R - 0.5, 17, 0x8a7a6a, { segs: 16, pitch: Math.PI, batch: 'nocast' });
  k.cone(0, -3, 0, R - 0.3, 5, 0xb07a4f, { segs: 16, pitch: Math.PI, batch: 'nocast' });
  // two squares big enough that their overlap covers the whole disc (the boundary ring keeps
  // everyone off the corners), so nothing thrown near the edge drops through the island
  k.collider(0, -0.5, 0, R * 2 + 1, 1, R * 2 + 1, 'grass');
  k.collider(0, -0.5, 0, R * 2 + 1, 1, R * 2 + 1, 'grass', { yaw: Math.PI / 4 });
  // boundary ring (no falling off while you wait)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.collider(Math.cos(a) * (R + 0.3), 14, Math.sin(a) * (R + 0.3), 4.6, 30, 0.6, 'stone', { yaw: -a + Math.PI / 2, flags: ColFlags.BlocksMove | ColFlags.BlocksBug });
  }
  // cobble plaza
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 6;
    k.box(Math.cos(a) * r, 0.02, Math.sin(a) * r, rng.range(0.8, 1.2), 0.05, rng.range(0.8, 1.2), shade(PAL.cobble, rng.range(0.9, 1.05)), { batch: 'nocast', ao: 0, yaw: rng.range(0, 1) });
  }
  // pier out to where the Sky Barge moors
  for (let i = 0; i < 9; i++) k.box(R - 2 + i * 0.9, 0.1, 0, 0.85, 0.12, 2.2, i % 2 ? PAL.wood : PAL.woodLight, { col: 'wood' });
  for (const s of [-1.1, 1.1]) for (let i = 0; i < 4; i++) k.box(R - 1.5 + i * 2.4, -0.6, s, 0.18, 1.6, 0.18, PAL.brownDark);
  // set dressing
  const trees: [number, number][] = [[-9, -6], [-11, 3], [-5, 10], [6, -11], [-2, -12], [9, 8]];
  for (const [x, z] of trees) P.tree(k, x, z, rng.range(0.8, 1.1), 0, rng.chance(0.3) ? 'blossom' : 'round');
  P.bench(k, -4, 5, 0.4);
  P.bench(k, 3, -6, Math.PI - 0.3);
  P.lampPost(k, 5, 4, Math.PI);
  P.lampPost(k, -6, -4, 0);
  P.crate(k, 7.5, 0, -3, 0.9, 0.3);
  P.crate(k, 8.2, 0, -2.2, 0.6, 0.8, PAL.mustard);
  P.barrel(k, 8.5, 0, 2.5, PAL.teal);
  P.hayBale(k, -8, -1, 0.5);
  P.hayBale(k, -9.2, -0.2, 1.3, 0.8);
  P.flowerPatch(k, 0, 8, 10, 2);
  P.flowerPatch(k, -3, -8, 8, 2);
  P.mushroom(k, -10, 8, 2.2, PAL.lavender);
  P.mushroom(k, -12, 6.5, 1.3, PAL.terracotta);
  P.bunting(k, -6, 5.6, -4, 5, 5.6, 4, 0.8);
  // a little ticket booth
  k.push(-2, 0, 11.5, Math.PI);
  k.box(0, 1.0, 0, 2.2, 2.0, 1.4, PAL.terracotta, { r: 0.05, col: 'wood' });
  k.box(0, 1.25, 0.71, 1.4, 0.7, 0.04, 0x2d2433, { ao: 0 });
  k.prism(0, 2.0, 0, 2.6, 0.9, 1.8, PAL.mustard, { yaw: 0 });
  k.pop();
  k.pop();
  const sign = makeSign('LAUNCH ISLE', { w: 2.6, h: 0.8, sub: 'the Sky Barge is on its way!', bg: '#fff1d8' });
  sign.position.set(c.x + R - 3, c.y + 2.4, c.z - 2.2);
  sign.rotation.y = -Math.PI / 2;
  world.group.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 0.15), new THREE.MeshStandardMaterial({ color: PAL.brownDark }));
  post.position.set(c.x + R - 3, c.y + 1, c.z - 2.2);
  world.group.add(post);
  for (let i = 0; i < 3; i++) world.addFlyer('butterfly', new THREE.Vector3(c.x + rng.range(-8, 8), c.y + 0.4, c.z + rng.range(-8, 8)), rng.range(1.5, 3), rng.range(0.5, 1.2));
}
