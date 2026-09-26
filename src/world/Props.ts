import { Kit } from './Kit';
import { PAL, jitter } from '../render/Palette';
import { shade } from './BuildingKit';
import { ColFlags } from '../physics/Collision';
import { Rng } from '../core/math';

/**
 * Prop library. Chunky, rounded, slightly-off proportions. Every prop is a function so layouts
 * read like set dressing notes: `table(k, x, 0, z); chair(k, ...)`.
 */

const R = new Rng(77);
const j = (hex: number, a = 0.5) => jitter(hex, a, () => R.next());

export function table(k: Kit, x: number, y: number, z: number, yaw = 0, w = 1.6, d = 0.9, color = PAL.wood) {
  k.push(x, y, z, yaw);
  k.box(0, 0.78, 0, w, 0.1, d, color, { r: 0.04, col: 'wood' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (w / 2 - 0.1), 0.38, sz * (d / 2 - 0.1), 0.1, 0.76, 0.1, shade(color, 0.8), { r: 0.02 });
  k.collider(0, 0.4, 0, w - 0.1, 0.76, d - 0.1, 'wood', { flags: ColFlags.BlocksMove | ColFlags.BlocksBug });
  k.pop();
}

export function chair(k: Kit, x: number, y: number, z: number, yaw = 0, color = PAL.woodLight) {
  k.push(x, y, z, yaw);
  k.box(0, 0.46, 0, 0.46, 0.08, 0.46, color, { r: 0.03, col: 'wood', flags: ColFlags.BlocksMove });
  k.box(0, 0.8, -0.2, 0.46, 0.6, 0.07, color, { r: 0.03 });
  k.box(0, 0.95, -0.2, 0.3, 0.12, 0.08, PAL.terracotta, { r: 0.03 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * 0.19, 0.22, sz * 0.19, 0.06, 0.44, 0.06, shade(color, 0.8));
  k.pop();
}

export function bed(k: Kit, x: number, y: number, z: number, yaw = 0, blanket = PAL.softBlue) {
  k.push(x, y, z, yaw);
  k.box(0, 0.25, 0, 1.3, 0.3, 2.1, PAL.wood, { r: 0.05, col: 'cloth' });
  k.box(0, 0.48, 0.05, 1.22, 0.2, 1.95, 0xf8f1e4, { r: 0.08 });
  k.box(0, 0.6, 0.3, 1.26, 0.1, 1.4, blanket, { r: 0.05 });
  k.box(0, 0.62, -0.72, 0.8, 0.16, 0.36, 0xffffff, { r: 0.08 });
  k.box(0, 0.7, -1.02, 1.36, 1.0, 0.12, PAL.brown, { r: 0.05, col: 'wood' });
  k.box(0, 0.45, 1.02, 1.36, 0.5, 0.1, PAL.brown, { r: 0.05 });
  // patchwork squares
  for (let i = 0; i < 3; i++) k.box(-0.35 + i * 0.35, 0.66, 0.3 + (i % 2) * 0.35, 0.28, 0.02, 0.28, [PAL.mustard, PAL.pink, PAL.lavender][i], { ao: 0 });
  k.pop();
}

export function sofa(k: Kit, x: number, y: number, z: number, yaw = 0, color = PAL.teal) {
  k.push(x, y, z, yaw);
  k.box(0, 0.25, 0, 2.0, 0.4, 0.9, color, { r: 0.12, col: 'cloth' });
  k.box(0, 0.7, -0.35, 2.0, 0.6, 0.25, color, { r: 0.12, col: 'cloth' });
  k.box(-0.95, 0.5, 0, 0.25, 0.45, 0.9, shade(color, 0.9), { r: 0.1 });
  k.box(0.95, 0.5, 0, 0.25, 0.45, 0.9, shade(color, 0.9), { r: 0.1 });
  k.box(-0.45, 0.5, 0.05, 0.85, 0.16, 0.7, shade(color, 1.1), { r: 0.08 });
  k.box(0.45, 0.5, 0.05, 0.85, 0.16, 0.7, shade(color, 1.1), { r: 0.08 });
  k.box(-0.6, 0.72, -0.18, 0.4, 0.35, 0.14, PAL.mustard, { r: 0.07, yaw: 0.2 });
  k.pop();
}

export function bookshelf(k: Kit, x: number, y: number, z: number, yaw = 0, w = 1.4, h = 2.1) {
  k.push(x, y, z, yaw);
  const c = PAL.brown;
  k.box(0, h / 2, -0.02, w, h, 0.05, shade(c, 0.8));
  k.box(-w / 2 + 0.04, h / 2, 0.15, 0.08, h, 0.36, c);
  k.box(w / 2 - 0.04, h / 2, 0.15, 0.08, h, 0.36, c);
  k.collider(0, h / 2, 0.15, w, h, 0.38, 'wood');
  const shelves = Math.round(h / 0.45);
  const bookCols = [PAL.terracotta, PAL.teal, PAL.mustard, PAL.lavender, PAL.softBlue, PAL.pink, PAL.grassDark, PAL.cream];
  for (let i = 0; i <= shelves; i++) {
    const sy = 0.05 + (i * (h - 0.1)) / shelves;
    k.box(0, sy, 0.15, w - 0.1, 0.05, 0.34, c);
    if (i < shelves) {
      let bx = -w / 2 + 0.12;
      while (bx < w / 2 - 0.2) {
        const bw = R.range(0.06, 0.12), bh = R.range(0.22, 0.34);
        if (R.chance(0.12)) {
          bx += 0.14;
          continue;
        }
        const lean = R.chance(0.1) ? 0.25 : 0;
        k.box(bx + bw / 2, sy + 0.03 + bh / 2, 0.16, bw, bh, 0.24, R.pick(bookCols), { ao: 0.05, roll: lean });
        bx += bw + 0.01;
      }
    }
  }
  k.pop();
}

export function counter(k: Kit, x: number, y: number, z: number, yaw = 0, w = 2.4, color = PAL.cream, top = PAL.woodLight) {
  k.push(x, y, z, yaw);
  k.box(0, 0.45, 0, w, 0.9, 0.7, color, { r: 0.03, col: 'wood' });
  k.box(0, 0.93, 0.02, w + 0.06, 0.07, 0.76, top, { r: 0.02 });
  const doors = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + (i + 0.5) * (w / doors);
    k.box(dx, 0.45, 0.36, w / doors - 0.08, 0.7, 0.03, shade(color, 0.93), { ao: 0 });
    k.box(dx + 0.15, 0.62, 0.39, 0.04, 0.12, 0.04, PAL.metal, { ao: 0 });
  }
  k.pop();
}

export function stove(k: Kit, x: number, y: number, z: number, yaw = 0) {
  k.push(x, y, z, yaw);
  k.box(0, 0.5, 0, 0.9, 1.0, 0.75, 0x3b3f4a, { r: 0.06, col: 'metal' });
  k.box(0, 0.4, 0.38, 0.6, 0.4, 0.04, 0x2a2d35, { ao: 0 });
  k.box(0, 0.4, 0.41, 0.4, 0.2, 0.02, 0xff9b54, { ao: 0, batch: 'glow' });
  k.cyl(-0.2, 1.03, -0.1, 0.13, 0.13, 0.06, 0x1f2128);
  k.cyl(0.2, 1.03, 0.1, 0.13, 0.13, 0.06, 0x1f2128);
  // pot
  k.cyl(0.2, 1.17, 0.1, 0.17, 0.15, 0.24, PAL.terracotta, { r: 0.02 });
  k.cyl(0, 1.8, -0.25, 0.1, 0.1, 1.5, 0x3b3f4a);
  k.pop();
}

export function sink(k: Kit, x: number, y: number, z: number, yaw = 0) {
  k.push(x, y, z, yaw);
  counter(k, 0, 0, 0, 0, 1.2, PAL.softBlue, PAL.cream);
  k.box(0, 0.96, 0, 0.6, 0.06, 0.45, 0x9fc9d6, { ao: 0 });
  k.cyl(0, 1.12, -0.28, 0.03, 0.03, 0.3, PAL.metal);
  k.box(0, 1.25, -0.2, 0.05, 0.05, 0.2, PAL.metal);
  k.pop();
}

export function crate(k: Kit, x: number, y: number, z: number, s = 1, yaw = 0, color = PAL.woodLight) {
  k.push(x, y, z, yaw);
  const h = 0.9 * s;
  k.box(0, h / 2, 0, h, h, h, color, { r: 0.04, col: 'wood' });
  const t = 0.07 * s;
  const e = shade(color, 0.72);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box((sx * (h - t)) / 2, h / 2, (sz * (h - t)) / 2, t + 0.02, h + 0.01, t + 0.02, e, { ao: 0 });
  k.box(0, h / 2, h / 2 + 0.005, h * 1.2, 0.08 * s, 0.03, e, { roll: Math.PI / 4, ao: 0 });
  k.box(0, h / 2, -h / 2 - 0.005, h * 1.2, 0.08 * s, 0.03, e, { roll: -Math.PI / 4, ao: 0 });
  k.pop();
}

export function barrel(k: Kit, x: number, y: number, z: number, color = PAL.wood) {
  k.push(x, y, z);
  k.cyl(0, 0.55, 0, 0.42, 0.42, 1.1, color, { col: 'wood', segs: 12 });
  k.cyl(0, 0.55, 0, 0.47, 0.47, 0.5, shade(color, 1.08), { segs: 12 });
  for (const hy of [0.15, 0.95]) k.cyl(0, hy, 0, 0.45, 0.45, 0.08, PAL.metal, { segs: 12 });
  k.cyl(0, 1.11, 0, 0.38, 0.38, 0.02, shade(color, 0.7), { segs: 12 });
  k.pop();
}

export function plant(k: Kit, x: number, y: number, z: number, s = 1, pot = PAL.terracotta) {
  k.push(x, y, z);
  k.cyl(0, 0.18 * s, 0, 0.2 * s, 0.15 * s, 0.36 * s, pot, { segs: 10 });
  k.cyl(0, 0.36 * s, 0, 0.22 * s, 0.22 * s, 0.05 * s, shade(pot, 0.85), { segs: 10 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + R.next();
    k.sphere(Math.cos(a) * 0.12 * s, (0.55 + R.next() * 0.25) * s, Math.sin(a) * 0.12 * s, 0.17 * s, j(PAL.leaf), { batch: 'foliage', wind: 0.35, sy: 1.4, segs: 7 });
  }
  k.pop();
}

export function rug(k: Kit, x: number, y: number, z: number, w: number, d: number, color: number, yaw = 0) {
  k.push(x, y, z, yaw);
  k.box(0, 0.015, 0, w, 0.03, d, color, { r: 0.012, ao: 0 });
  k.box(0, 0.02, 0, w * 0.75, 0.03, d * 0.7, shade(color, 1.18), { r: 0.012, ao: 0 });
  k.box(0, 0.025, 0, w * 0.45, 0.03, d * 0.4, shade(color, 0.85), { r: 0.012, ao: 0 });
  k.pop();
}

export function lamp(k: Kit, x: number, y: number, z: number, shadeCol = PAL.mustard) {
  k.push(x, y, z);
  k.cyl(0, 0.03, 0, 0.2, 0.22, 0.06, PAL.brownDark);
  k.cyl(0, 0.75, 0, 0.03, 0.03, 1.4, PAL.brownDark);
  k.cyl(0, 1.55, 0, 0.18, 0.32, 0.35, shadeCol, { segs: 10 });
  k.sphere(0, 1.44, 0, 0.1, 0xfff1b8, { batch: 'glow' });
  k.pop();
}

export function picture(k: Kit, x: number, y: number, z: number, yaw: number, w = 0.7, h = 0.55, art = PAL.softBlue) {
  k.push(x, y, z, yaw);
  k.box(0, 0, 0, w, h, 0.05, PAL.brown, { ao: 0 });
  k.box(0, 0, 0.02, w - 0.12, h - 0.12, 0.03, art, { ao: 0 });
  k.box(0, -h * 0.12, 0.035, w * 0.5, h * 0.25, 0.02, PAL.grass, { ao: 0 });
  k.sphere(w * 0.18, h * 0.15, 0.04, 0.06, PAL.mustard, { ao: 0 });
  k.pop();
}

export function wardrobe(k: Kit, x: number, y: number, z: number, yaw = 0, color = PAL.lavender) {
  k.push(x, y, z, yaw);
  k.box(0, 1.0, 0, 1.2, 2.0, 0.6, color, { r: 0.05, col: 'wood' });
  k.box(0, 2.05, 0, 1.3, 0.12, 0.66, shade(color, 0.85), { r: 0.03 });
  k.box(-0.3, 1.0, 0.31, 0.54, 1.8, 0.03, shade(color, 1.07), { ao: 0 });
  k.box(0.3, 1.0, 0.31, 0.54, 1.8, 0.03, shade(color, 1.07), { ao: 0 });
  k.sphere(-0.06, 1.05, 0.34, 0.035, PAL.mustard);
  k.sphere(0.06, 1.05, 0.34, 0.035, PAL.mustard);
  k.pop();
}

export function bathtub(k: Kit, x: number, y: number, z: number, yaw = 0) {
  k.push(x, y, z, yaw);
  k.box(0, 0.35, 0, 1.6, 0.6, 0.8, 0xffffff, { r: 0.25, col: 'stone' });
  k.box(0, 0.62, 0, 1.4, 0.06, 0.6, 0x9fdcf0, { r: 0.05, ao: 0 });
  for (let i = 0; i < 4; i++) k.sphere(-0.4 + i * 0.25, 0.68, (i % 2) * 0.12 - 0.06, 0.1, 0xffffff, { ao: 0 });
  k.sphere(0.45, 0.72, 0.05, 0.09, PAL.mustard, { ao: 0 }); // rubber duck
  k.sphere(0.52, 0.8, 0.05, 0.06, PAL.mustard, { ao: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.sphere(sx * 0.6, 0.06, sz * 0.25, 0.07, PAL.mustard);
  k.pop();
}

export function fireplace(k: Kit, x: number, y: number, z: number, yaw = 0) {
  k.push(x, y, z, yaw);
  k.box(0, 0.6, 0, 1.8, 1.2, 0.6, PAL.stone, { r: 0.05, col: 'stone' });
  k.box(0, 0.45, 0.25, 0.9, 0.8, 0.2, 0x2d2433, { ao: 0 });
  k.box(0, 1.25, 0.05, 2.0, 0.12, 0.75, PAL.brown, { r: 0.03 });
  k.sphere(0, 0.25, 0.25, 0.22, 0xff8a3d, { batch: 'glow', sy: 0.6 });
  k.sphere(0, 0.3, 0.25, 0.12, 0xffe08a, { batch: 'glow', sy: 1.2 });
  k.cyl(0.6, 1.4, 0.1, 0.07, 0.09, 0.18, PAL.teal); // mantel knick-knacks
  k.sphere(-0.55, 1.39, 0.1, 0.09, PAL.pink);
  k.pop();
}

/* ------------------------------ OUTDOOR ------------------------------ */

export function tree(k: Kit, x: number, z: number, s = 1, y = 0, kind: 'round' | 'tall' | 'blossom' = 'round') {
  k.push(x, y, z, R.next() * 6);
  const trunkH = 2.2 * s;
  k.cyl(0, trunkH / 2, 0, 0.18 * s, 0.3 * s, trunkH, PAL.brown, { batch: 'foliage', wind: 0.05, col: 'wood', segs: 7 });
  k.cyl(0.25 * s, trunkH * 0.7, 0, 0.06 * s, 0.1 * s, 0.9 * s, PAL.brown, { batch: 'foliage', wind: 0.2, roll: -0.8, segs: 5 });
  const leaf = kind === 'blossom' ? PAL.pink : j(PAL.leaf, 0.6);
  if (kind === 'tall') {
    for (let i = 0; i < 3; i++) k.cone(0, trunkH + (0.5 + i * 0.9) * s, 0, (1.5 - i * 0.35) * s, 1.6 * s, shade(j(PAL.leafDark, 0.5), 1 + i * 0.08), { batch: 'foliage', wind: 0.4 + i * 0.25, segs: 7 });
  } else {
    const blobs = 5;
    k.ico(0, trunkH + 0.9 * s, 0, 1.35 * s, leaf, { batch: 'foliage', wind: 0.6, detail: 1, sy: 0.9 });
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * Math.PI * 2 + R.next();
      const rr = (0.75 + R.next() * 0.3) * s;
      k.ico(Math.cos(a) * rr, trunkH + (0.5 + R.next() * 0.9) * s, Math.sin(a) * rr, (0.75 + R.next() * 0.3) * s, shade(leaf, 0.9 + R.next() * 0.25), { batch: 'foliage', wind: 0.8, detail: 0 });
    }
    if (kind === 'blossom') for (let i = 0; i < 6; i++) k.ico(R.range(-1, 1) * s, trunkH + R.range(0.3, 1.8) * s, R.range(-1, 1) * s, 0.25 * s, 0xffffff, { batch: 'foliage', wind: 0.9, detail: 0 });
  }
  // canopy blocks bullets/bug a little (soft cover) but not movement
  k.collider(0, trunkH + 0.9 * s, 0, 2.2 * s, 1.8 * s, 2.2 * s, 'grass', { flags: ColFlags.BlocksSight });
  k.pop();
}

export function bush(k: Kit, x: number, z: number, s = 1, color = PAL.leaf, flowers = false) {
  k.push(x, 0, z, R.next() * 6);
  const c = j(color, 0.6);
  k.ico(0, 0.45 * s, 0, 0.6 * s, c, { batch: 'foliage', wind: 0.3, detail: 1, sy: 0.8 });
  k.ico(0.45 * s, 0.35 * s, 0.1 * s, 0.42 * s, shade(c, 1.1), { batch: 'foliage', wind: 0.35, detail: 0 });
  k.ico(-0.4 * s, 0.32 * s, -0.15 * s, 0.4 * s, shade(c, 0.92), { batch: 'foliage', wind: 0.35, detail: 0 });
  if (flowers) for (let i = 0; i < 5; i++) k.ico(R.range(-0.5, 0.5) * s, R.range(0.55, 0.85) * s, R.range(-0.4, 0.4) * s, 0.09 * s, R.pick([PAL.pink, 0xffffff, PAL.mustard, PAL.lavender]), { batch: 'foliage', wind: 0.4, detail: 0 });
  k.collider(0, 0.4 * s, 0, 1.3 * s, 0.8 * s, 1.1 * s, 'grass', { flags: ColFlags.BlocksSight });
  k.pop();
}

export function flowerPatch(k: Kit, x: number, z: number, n = 8, spread = 1.2) {
  for (let i = 0; i < n; i++) {
    const fx = x + R.range(-spread, spread), fz = z + R.range(-spread, spread);
    k.cyl(fx, 0.15, fz, 0.015, 0.015, 0.3, PAL.leafDark, { batch: 'detail', wind: 0.5, segs: 3 });
    k.ico(fx, 0.32, fz, 0.08, R.pick([PAL.pink, 0xffffff, PAL.mustard, PAL.lavender, 0xff7a6b, PAL.softBlue]), { batch: 'detail', wind: 0.9, detail: 0 });
  }
}

export function rock(k: Kit, x: number, y: number, z: number, s = 1, color = PAL.stone, collide = true) {
  k.ico(x, y + 0.3 * s, z, 0.8 * s, j(color, 0.4), { detail: 0, sy: 0.7, sx: 1.2, yaw: R.next() * 6, col: collide ? 'stone' : null });
}

export function fence(k: Kit, x1: number, z1: number, x2: number, z2: number, color = PAL.cream) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const yaw = Math.atan2(-(z2 - z1) / L, (x2 - x1) / L);
  k.push((x1 + x2) / 2, 0, (z1 + z2) / 2, yaw);
  const posts = Math.max(2, Math.round(L / 1.2) + 1);
  for (let i = 0; i < posts; i++) {
    const px = -L / 2 + (i * L) / (posts - 1);
    k.box(px, 0.5, 0, 0.14, 1.0, 0.14, color, { r: 0.03 });
    k.cone(px, 1.06, 0, 0.1, 0.14, color, { segs: 4, yaw: Math.PI / 4 });
  }
  k.box(0, 0.35, 0, L, 0.1, 0.06, color, { r: 0.02 });
  k.box(0, 0.75, 0, L, 0.1, 0.06, color, { r: 0.02 });
  k.collider(0, 0.55, 0, L, 1.1, 0.2, 'wood', { flags: ColFlags.BlocksMove });
  k.pop();
}

export function stoneWall(k: Kit, x1: number, z1: number, x2: number, z2: number, h = 1.0, color = PAL.stone) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const yaw = Math.atan2(-(z2 - z1) / L, (x2 - x1) / L);
  k.push((x1 + x2) / 2, 0, (z1 + z2) / 2, yaw);
  k.box(0, h / 2, 0, L, h, 0.6, color, { r: 0.1, col: 'stone' });
  // lumpy stones on top
  const n = Math.round(L / 0.7);
  for (let i = 0; i < n; i++) k.box(-L / 2 + (i + 0.5) * (L / n), h + 0.08, R.range(-0.05, 0.05), L / n - 0.05, 0.2, 0.62, j(shade(color, 0.92), 0.4), { r: 0.08 });
  k.pop();
}

export function hedge(k: Kit, x1: number, z1: number, x2: number, z2: number, h = 1.3) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const yaw = Math.atan2(-(z2 - z1) / L, (x2 - x1) / L);
  k.push((x1 + x2) / 2, 0, (z1 + z2) / 2, yaw);
  k.box(0, h / 2, 0, L, h, 0.9, PAL.leafDark, { r: 0.35, batch: 'foliage', wind: 0.08, col: 'grass' });
  const n = Math.round(L / 0.8);
  for (let i = 0; i < n; i++) k.ico(-L / 2 + (i + 0.5) * (L / n), h - 0.05, R.range(-0.1, 0.1), 0.42, j(PAL.leaf, 0.4), { batch: 'foliage', wind: 0.2, detail: 1, sy: 0.7 });
  k.pop();
}

export function lampPost(k: Kit, x: number, z: number, yaw = 0) {
  k.push(x, 0, z, yaw);
  k.cyl(0, 0.2, 0, 0.22, 0.28, 0.4, PAL.ink, { col: 'metal' });
  k.cyl(0, 1.7, 0, 0.07, 0.09, 3.0, PAL.ink, { col: 'metal' });
  k.box(0.3, 3.1, 0, 0.7, 0.07, 0.07, PAL.ink);
  k.torus(0.1, 2.9, 0, 0.18, 0.03, PAL.ink, { yaw: Math.PI / 2 });
  k.box(0.6, 2.85, 0, 0.36, 0.44, 0.36, 0x33303d, { r: 0.05 });
  k.box(0.6, 2.85, 0, 0.28, 0.34, 0.28, 0xffe4a0, { batch: 'glow' });
  k.cone(0.6, 3.18, 0, 0.3, 0.25, PAL.ink, { segs: 4, yaw: Math.PI / 4 });
  k.pop();
}

export function bench(k: Kit, x: number, z: number, yaw = 0) {
  k.push(x, 0, z, yaw);
  for (let i = 0; i < 3; i++) k.box(0, 0.48, -0.15 + i * 0.16, 1.8, 0.06, 0.13, PAL.woodLight, { r: 0.02 });
  for (let i = 0; i < 2; i++) k.box(0, 0.75 + i * 0.18, -0.3, 1.8, 0.12, 0.05, PAL.woodLight, { r: 0.02, pitch: -0.15 });
  for (const sx of [-0.75, 0.75]) {
    k.box(sx, 0.24, 0, 0.08, 0.48, 0.5, PAL.ink);
    k.box(sx, 0.7, -0.32, 0.08, 0.5, 0.06, PAL.ink);
  }
  k.collider(0, 0.3, 0, 1.8, 0.6, 0.55, 'wood', { flags: ColFlags.BlocksMove });
  k.pop();
}

export function hayBale(k: Kit, x: number, z: number, yaw = 0, y = 0) {
  k.push(x, y, z, yaw);
  k.box(0, 0.4, 0, 1.3, 0.8, 0.8, 0xe6c46a, { r: 0.12, col: 'grass' });
  k.box(-0.35, 0.4, 0, 0.06, 0.82, 0.82, 0xb8903a, { r: 0.02, ao: 0 });
  k.box(0.35, 0.4, 0, 0.06, 0.82, 0.82, 0xb8903a, { r: 0.02, ao: 0 });
  k.pop();
}

export function well(k: Kit, x: number, z: number) {
  k.push(x, 0, z);
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    k.box(Math.cos(a) * 1.1, 0.45, Math.sin(a) * 1.1, 0.72, 0.9, 0.35, j(PAL.stone, 0.5), { r: 0.08, yaw: -a + Math.PI / 2 });
  }
  k.collider(0, 0.45, 0, 2.5, 0.9, 2.5, 'stone');
  k.cyl(0, 0.75, 0, 0.9, 0.9, 0.05, PAL.water, { segs: 14 });
  for (const s of [-1, 1]) k.box(s * 1.05, 1.5, 0, 0.16, 2.0, 0.16, PAL.wood, { col: 'wood' });
  k.cyl(0, 2.3, 0, 0.1, 0.1, 2.3, PAL.brown, { roll: Math.PI / 2 });
  k.prism(0, 2.45, 0, 2.8, 0.9, 1.4, PAL.roofRed, { yaw: Math.PI / 2 });
  k.box(0, 1.75, 0, 0.3, 0.35, 0.3, PAL.wood, { r: 0.04 });
  k.pop();
}

export function marketStall(k: Kit, x: number, z: number, yaw: number, awning: number, goods: number[]) {
  k.push(x, 0, z, yaw);
  k.box(0, 0.5, 0, 2.6, 1.0, 1.0, PAL.wood, { r: 0.04, col: 'wood' });
  k.box(0, 1.03, 0, 2.7, 0.07, 1.1, PAL.woodLight, { r: 0.02 });
  for (const sx of [-1.25, 1.25]) {
    k.box(sx, 1.4, -0.45, 0.1, 2.8, 0.1, PAL.brown, { col: 'wood' });
    k.box(sx, 1.2, 0.45, 0.1, 2.4, 0.1, PAL.brown, { col: 'wood' });
  }
  // striped awning (cloth — solid enough to land a bug on)
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    k.box(-1.35 + (i + 0.5) * (2.7 / stripes), 2.62, 0.0, 2.7 / stripes, 0.06, 1.6, i % 2 ? awning : 0xfff6e6, { pitch: 0.28, ao: 0, batch: 'foliage', wind: 0.08 });
  }
  k.collider(0, 2.62, 0, 2.7, 0.1, 1.6, 'cloth', { pitch: 0.28 });
  // scalloped edge
  for (let i = 0; i < 7; i++) k.sphere(-1.2 + i * 0.4, 2.36, 0.78, 0.13, i % 2 ? awning : 0xfff6e6, { sy: 0.6, ao: 0, batch: 'foliage', wind: 0.35 });
  // produce piles
  for (let i = 0; i < 6; i++) {
    const gx = -1.0 + i * 0.4;
    const gc = goods[i % goods.length];
    for (let n = 0; n < 4; n++) k.sphere(gx + R.range(-0.1, 0.1), 1.14 + (n > 2 ? 0.12 : 0), R.range(-0.3, 0.3), 0.1, gc, { ao: 0.05 });
  }
  crate(k, 1.7, 0, 0.2, 0.55, 0.3);
  crate(k, 1.75, 0.5, 0.25, 0.45, -0.2, PAL.mustard);
  k.pop();
}

export function bunting(k: Kit, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, sag = 0.8) {
  const n = Math.max(4, Math.round(Math.hypot(x2 - x1, z2 - z1) / 0.55));
  const cols = [PAL.terracotta, PAL.mustard, PAL.teal, PAL.pink, PAL.softBlue, PAL.lavender];
  const yaw = Math.atan2(-(z2 - z1), x2 - x1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
    const y = y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * sag;
    if (i < n) {
      k.push(x, y, z, yaw);
      k.prism(0.25, -0.35, 0, 0.36, 0.34, 0.02, cols[i % cols.length], { batch: 'foliage', wind: 0.9, pitch: Math.PI, ao: 0 });
      k.pop();
    }
    k.cyl(x, y, z, 0.012, 0.012, 0.6, PAL.ink, { batch: 'foliage', wind: 0.3, roll: Math.PI / 2, yaw, segs: 3 });
  }
}

export function washingLine(k: Kit, x1: number, z1: number, x2: number, z2: number) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const yaw = Math.atan2(-(z2 - z1) / L, (x2 - x1) / L);
  k.push((x1 + x2) / 2, 0, (z1 + z2) / 2, yaw);
  for (const s of [-1, 1]) k.box((s * L) / 2, 1.1, 0, 0.1, 2.2, 0.1, PAL.wood, { col: 'wood' });
  k.box(0, 2.1, 0, L, 0.02, 0.02, PAL.ink, { batch: 'nocast' });
  const items = [PAL.pink, PAL.softBlue, 0xffffff, PAL.mustard, PAL.teal];
  for (let i = 0; i < 5; i++) {
    const px = -L / 2 + 0.6 + (i * (L - 1.2)) / 4;
    const w = R.range(0.4, 0.7), h = R.range(0.4, 0.7);
    k.box(px, 2.08 - h / 2, 0, w, h, 0.03, items[i], { batch: 'foliage', wind: 1.4, ao: 0 });
  }
  k.pop();
}

export function mushroom(k: Kit, x: number, z: number, s = 1, cap = PAL.terracotta) {
  k.push(x, 0, z);
  k.cyl(0, 0.3 * s, 0, 0.12 * s, 0.16 * s, 0.6 * s, PAL.cream, { segs: 8 });
  k.sphere(0, 0.62 * s, 0, 0.38 * s, cap, { sy: 0.55, segs: 12 });
  for (let i = 0; i < 4; i++) k.sphere(Math.cos(i * 1.7) * 0.22 * s, 0.75 * s, Math.sin(i * 1.7) * 0.2 * s, 0.05 * s, 0xffffff, { ao: 0 });
  k.pop();
}

export function cart(k: Kit, x: number, z: number, yaw: number) {
  k.push(x, 0, z, yaw);
  k.box(0, 0.9, 0, 2.2, 0.5, 1.3, PAL.wood, { r: 0.05, col: 'wood' });
  k.box(0, 1.22, 0, 2.3, 0.14, 1.4, PAL.brown, { r: 0.03 });
  for (const s of [-1, 1]) {
    k.cyl(0, 0.55, s * 0.72, 0.55, 0.55, 0.12, PAL.brown, { pitch: Math.PI / 2, segs: 12 });
    k.cyl(0, 0.55, s * 0.72, 0.15, 0.15, 0.16, PAL.metal, { pitch: Math.PI / 2, segs: 8 });
  }
  k.box(1.7, 0.8, 0.35, 1.4, 0.08, 0.08, PAL.brown, { roll: 0.2 });
  k.box(1.7, 0.8, -0.35, 1.4, 0.08, 0.08, PAL.brown, { roll: 0.2 });
  for (let i = 0; i < 6; i++) k.sphere(R.range(-0.8, 0.8), 1.3, R.range(-0.4, 0.4), 0.2, R.pick([0xff6b4a, PAL.mustard, 0x9bd65a]), { ao: 0.05 });
  k.pop();
}
