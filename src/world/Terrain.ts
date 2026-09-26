import * as THREE from 'three';
import { Kit } from './Kit';
import { PAL } from '../render/Palette';
import { ColFlags } from '../physics/Collision';
import { noise2, Rng, smoothstep } from '../core/math';
import { shade } from './BuildingKit';

/**
 * The floating island ground: a vertex-coloured grass mesh with painted dirt paths, a stream
 * channel, and a craggy rock underside hanging over the clouds.
 */

export const STREAM_X = -28;
export const ISLAND_R = 46;

export function islandRadius(angle: number) {
  return ISLAND_R + Math.sin(angle * 3 + 1.3) * 2.2 + Math.sin(angle * 7 + 0.4) * 1.2 + Math.sin(angle * 13) * 0.5;
}

export function groundHeight(x: number, _z: number) {
  const d = Math.abs(x - STREAM_X);
  if (d < 1) return -0.7;
  if (d < 2) return -0.7 * (2 - d);
  return 0;
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function buildTerrain(k: Kit, paths: [number, number][][]) {
  const size = 50;
  const step = 1;
  const n = Math.round((size * 2) / step) + 1;
  const g = new THREE.PlaneGeometry(size * 2, size * 2, n - 1, n - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grassA = new THREE.Color(PAL.grass).convertSRGBToLinear();
  const grassB = new THREE.Color(PAL.grassLight).convertSRGBToLinear();
  const grassC = new THREE.Color(PAL.grassDark).convertSRGBToLinear();
  const dirt = new THREE.Color(0xc9a878).convertSRGBToLinear();
  const sand = new THREE.Color(0xe6d3a3).convertSRGBToLinear();
  const pebble = new THREE.Color(0xa89c8a).convertSRGBToLinear();
  const edge = new THREE.Color(0xb8d98a).convertSRGBToLinear();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const R = islandRadius(ang);
    const r = Math.hypot(x, z);
    if (r > R) {
      x = (x / r) * R;
      z = (z / r) * R;
    }
    const y = groundHeight(x, z) - (r > R - 0.8 ? (Math.min(r, R) - (R - 0.8)) * 0.3 : 0);
    pos.setXYZ(i, x, y, z);
    // colour: layered noise grass, painted paths, banks
    const nA = noise2(x * 0.08, z * 0.08), nB = noise2(x * 0.3 + 10, z * 0.3);
    c.copy(grassA).lerp(grassB, smoothstep(0.45, 0.8, nA)).lerp(grassC, smoothstep(0.55, 0.85, 1 - nA) * 0.6);
    c.multiplyScalar(0.94 + nB * 0.12);
    let pd = 99;
    for (const p of paths) for (let s = 0; s < p.length - 1; s++) pd = Math.min(pd, distToSeg(x, z, p[s][0], p[s][1], p[s + 1][0], p[s + 1][1]));
    const pathW = 1.3 + noise2(x * 0.5, z * 0.5) * 0.6;
    if (pd < pathW + 0.6) c.lerp(dirt, smoothstep(pathW + 0.6, pathW - 0.2, pd) * 0.92);
    const sd = Math.abs(x - STREAM_X);
    if (sd < 2.6) c.lerp(sd < 1.2 ? pebble : sand, smoothstep(2.6, 1.6, sd));
    if (r > R - 1.2) c.lerp(edge, 0.5);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  g.dispose();
  k.nocast.add(ng, null);

  // ---- colliders: flat ground either side of the stream, sloped banks and a stream bed
  const cw = k.cw;
  const W = STREAM_X;
  cw.box((-60 + (W - 2)) / 2, -1, 0, (W - 2) - -60, 2, 120, 'grass');
  cw.box(((W + 2) + 60) / 2, -1, 0, 60 - (W + 2), 2, 120, 'grass');
  cw.box(W, -1.7, 0, 2.02, 2, 120, 'water');
  const bank = Math.atan2(0.7, 1);
  const bl = Math.hypot(0.7, 1);
  cw.box(W - 1.5 + Math.sin(bank) * 0.25 * 0, -0.35 - 0.25, 0, bl, 0.5, 120, 'grass', 0, 0, -bank);
  cw.box(W + 1.5, -0.35 - 0.25, 0, bl, 0.5, 120, 'grass', 0, 0, bank);

  // ---- invisible boundary ring at the cliff edge (blocks rascals and bugs, not bullets)
  const segs = 64;
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
  const radial = 72, rings = 10;
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
    const jag = t > 0.02 ? (noise2(ang * 4, t * 6) - 0.5) * 6 * t + (noise2(ang * 11, t * 13) - 0.5) * 2.5 : 0;
    const rr = Math.max(1.5, R * taper + jag);
    const yy = t < 0.02 ? -0.4 : -t * 38 - (noise2(ang * 5, 3) * 6 * t);
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
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng.range(-0.03, 0.03);
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
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(62, 120);
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
