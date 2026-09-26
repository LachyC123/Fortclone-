import * as THREE from 'three';
import { Kit } from './Kit';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { noise2, Rng, smoothstep } from '../core/math';
import { shade } from './BuildingKit';

import { ISLAND_R, STREAM_X, islandRadius, ground, heightAt, HF_HALF, HF_N, HF_STEP, ROADS, HeightfieldCollider, LAGOON_POS, POI_BY_ID } from './Heightmap';

/**
 * The floating island ground: a vertex-coloured heightfield mesh (hills, ridges, the manor
 * plateau, a stream valley and a sandy cove) with painted roads, over a craggy rock underside.
 */

export { ISLAND_R, STREAM_X, islandRadius };

export function groundHeight(x: number, z: number) {
  return ground(x, z);
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function buildTerrain(k: Kit, paths: [number, number][][]) {
  const n = HF_N;
  const size = HF_HALF;
  const g = new THREE.PlaneGeometry(size * 2, size * 2, n - 1, n - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const lin = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
  const grassA = lin(PAL.grass), grassB = lin(PAL.grassLight), grassC = lin(PAL.grassDark);
  const dirt = lin(0xc9a878), sand = lin(0xe6d3a3), pebble = lin(0xa89c8a), edge = lin(0xb8d98a);
  const rockC = lin(0xa89a88), highGrass = lin(0x9fd06a), mossy = lin(0x86b85a);
  const allPaths = [...paths, ...ROADS];
  const cove = POI_BY_ID.cove;
  for (let idx = 0; idx < pos.count; idx++) {
    const i = idx % n, j = Math.floor(idx / n);
    let x = -size + i * HF_STEP, z = -size + j * HF_STEP;
    const ang = Math.atan2(z, x);
    const R = islandRadius(ang);
    const r = Math.hypot(x, z);
    let y = heightAt(i, j);
    if (r > R) {
      // tuck vertices past the rim under the lip
      x = (x / r) * R;
      z = (z / r) * R;
      y = Math.min(ground(x * 0.99, z * 0.99), 0) - 0.4;
    }
    pos.setXYZ(idx, x, y, z);
    // colour: layered noise grass, slope rock, altitude tint, painted paths, beach & banks
    const nA = noise2(x * 0.08, z * 0.08), nB = noise2(x * 0.3 + 10, z * 0.3);
    c.copy(grassA).lerp(grassB, smoothstep(0.45, 0.8, nA)).lerp(grassC, smoothstep(0.55, 0.85, 1 - nA) * 0.6);
    c.multiplyScalar(0.94 + nB * 0.12);
    if (y > 3) c.lerp(highGrass, smoothstep(3, 9, y) * 0.45);
    // slope from neighbouring samples
    const e = 1;
    const sx = heightAt(Math.min(n - 1, i + 1), j) - heightAt(Math.max(0, i - 1), j);
    const sz = heightAt(i, Math.min(n - 1, j + 1)) - heightAt(i, Math.max(0, j - 1));
    const slope = r > R - 2 ? 0 : Math.hypot(sx, sz) / (2 * e);
    if (slope > 0.5) c.lerp(slope > 0.85 ? rockC : mossy, smoothstep(0.5, 1.0, slope) * 0.6);
    let pd = 99;
    for (const p of allPaths) for (let s2 = 0; s2 < p.length - 1; s2++) pd = Math.min(pd, distToSeg(x, z, p[s2][0], p[s2][1], p[s2 + 1][0], p[s2 + 1][1]));
    const pathW = 1.3 + noise2(x * 0.5, z * 0.5) * 0.6;
    if (pd < pathW + 0.6) c.lerp(dirt, smoothstep(pathW + 0.6, pathW - 0.2, pd) * 0.92);
    const sd = Math.abs(x - STREAM_X);
    if (sd < 2.6 && z > -48 && z < 80) c.lerp(sd < 1.2 ? pebble : sand, smoothstep(2.6, 1.6, sd));
    // Crash Cove beach
    const bd = Math.hypot(x - cove.x, (z - cove.z) * 0.8);
    if (bd < 22 || Math.hypot(x - LAGOON_POS.x, z - LAGOON_POS.z) < LAGOON_POS.r + 6) c.lerp(sand, Math.max(smoothstep(22, 14, bd), smoothstep(LAGOON_POS.r + 6, LAGOON_POS.r + 2, Math.hypot(x - LAGOON_POS.x, z - LAGOON_POS.z))) * 0.9);
    if (r > R - 1.2) c.lerp(edge, 0.5);
    colors[idx * 3] = c.r;
    colors[idx * 3 + 1] = c.g;
    colors[idx * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  g.dispose();
  k.nocast.add(ng, null);

  // ---- collision: the heightfield itself
  const cw = k.cw;
  cw.add(new HeightfieldCollider());

  // ---- invisible boundary ring at the cliff edge (blocks rascals and bugs, not bullets)
  const segs = 128;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const r0 = islandRadius(a0) + 0.4, r1 = islandRadius(a1) + 0.4;
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const L = Math.hypot(x1 - x0, z1 - z0) + 0.6;
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    const o = cw.box((x0 + x1) / 2, 14, (z0 + z1) / 2, L, 36, 1.0, 'stone', yaw, 0, 0, ColFlags.BlocksMove | ColFlags.BlocksBug);
    o.tag = 'boundary';
  }

  // ---- craggy underside
  const rng = new Rng(9);
  const radial = 128, rings = 12;
  const ug = new THREE.CylinderGeometry(1, 1, 1, radial, rings, true);
  const up = ug.getAttribute('position') as THREE.BufferAttribute;
  const uc = new Float32Array(up.count * 3);
  const strata = [0x7cc35a, 0x8a5a3b, 0xb07a4f, 0xd9774f, 0xc9a878, 0x9c9384, 0x8a7a6a, 0x6e6258, 0x5e5450, 0x4e4648, 0x3e3840];
  for (let i = 0; i < up.count; i++) {
    const vx = up.getX(i), vy = up.getY(i), vz = up.getZ(i);
    const ang = Math.atan2(vz, vx);
    const t = 0.5 - vy; // 0 top .. 1 bottom
    const R = islandRadius(ang);
    const taper = Math.pow(1 - t, 0.75);
    const jag = t > 0.02 ? (noise2(ang * 4, t * 6) - 0.5) * 12 * t + (noise2(ang * 11, t * 13) - 0.5) * 4 : 0;
    const rr = Math.max(1.5, R * taper + jag);
    const yy = t < 0.02 ? -0.4 : -t * 70 - (noise2(ang * 5, 3) * 10 * t);
    up.setXYZ(i, Math.cos(ang) * rr, yy, Math.sin(ang) * rr);
    const band = Math.min(strata.length - 1, Math.floor(t * 10 + noise2(ang * 3, t * 4) * 1.5));
    c.setHex(t < 0.02 ? PAL.grassDark : shade(strata[band], 0.9 + rng.next() * 0.15)).convertSRGBToLinear();
    uc[i * 3] = c.r;
    uc[i * 3 + 1] = c.g;
    uc[i * 3 + 2] = c.b;
  }
  ug.setAttribute('color', new THREE.BufferAttribute(uc, 3));
  ug.deleteAttribute('uv');
  const ugn = ug.toNonIndexed();
  ugn.computeVertexNormals();
  ug.dispose();
  k.nocast.add(ugn, null);
  // lip of rocks around the edge + dangling roots
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2 + rng.range(-0.015, 0.015);
    const R = islandRadius(a) - 0.3;
    k.ico(Math.cos(a) * R, -0.5 + rng.range(-0.3, 0.2), Math.sin(a) * R, rng.range(0.6, 1.3), shade(PAL.stone, rng.range(0.75, 1)), { detail: 0, sy: 0.6, yaw: rng.range(0, 6), batch: 'nocast' });
    if (i % 3 === 0) {
      const rl = rng.range(2, 6);
      k.cyl(Math.cos(a) * (R - 1), -1 - rl / 2, Math.sin(a) * (R - 1), 0.04, 0.12, rl, PAL.brown, { batch: 'foliage', wind: 0.6, segs: 4, roll: rng.range(-0.2, 0.2) });
    }
  }
}

/** Little floating rocks around the island (pure scenery that sells the "sky island"). */
export function buildSkyRocks(k: Kit) {
  const rng = new Rng(21);
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(128, 200);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = rng.range(-18, 14);
    const s = rng.range(1.5, 5);
    k.ico(x, y, z, s, shade(0x8a7a6a, rng.range(0.8, 1.1)), { detail: 1, sy: 0.9, batch: 'nocast' });
    k.cone(x, y - s * 1.4, z, s * 0.9, s * 2.2, shade(0x6e6258, 1), { segs: 7, pitch: Math.PI, batch: 'nocast' });
    k.cyl(x, y + s * 0.62, z, s * 0.95, s * 0.95, 0.3, PAL.grass, { segs: 10, batch: 'nocast' });
    if (s > 3) {
      k.cyl(x, y + s + 1, z, 0.15, 0.25, 2, PAL.brown, { batch: 'foliage', wind: 0.05 });
      k.ico(x, y + s + 2.4, z, 1.2, PAL.leaf, { batch: 'foliage', wind: 0.6 });
    }
  }
}
