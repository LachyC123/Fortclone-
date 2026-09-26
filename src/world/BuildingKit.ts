import { Kit } from './Kit';
import { ColFlags, Surface } from '../physics/Collision';
import { PAL } from '../render/Palette';

/**
 * Modular architecture. Walls are generated around openings, so doors and windows are REAL holes
 * in the collision — the Blinkbug can fly through any window you can see through.
 */

export interface Opening {
  /** distance along the wall (from its start) to the opening centre */
  at: number;
  w: number;
  h: number;
  /** bottom of the opening above the wall base */
  sill?: number;
  kind?: 'door' | 'window' | 'arch';
  shutters?: number; // shutter colour
  flowers?: boolean;
}

export interface WallStyle {
  outer: number;
  inner: number;
  trim: number;
  surface: Surface;
  thickness?: number;
  beams?: number; // timber frame colour
  plinth?: number;
}

export interface DoorSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  /** wall normal side the door swings toward */
  color: number;
}

export function wall(k: Kit, x1: number, z1: number, x2: number, z2: number, y0: number, height: number, style: WallStyle, openings: Opening[] = [], outSign = 1, doors?: DoorSpec[]) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
  const yaw = Math.atan2(-uz, ux);
  const t = style.thickness ?? 0.3;
  k.push((x1 + x2) / 2, y0, (z1 + z2) / 2, yaw);

  const rects: [number, number, number, number][] = []; // u0,u1,v0,v1 (u from -L/2)
  const ops = [...openings].sort((a, b) => a.at - b.at);
  let cursor = 0;
  for (const o of ops) {
    const a = o.at - o.w / 2, b = o.at + o.w / 2;
    const sill = o.kind === 'door' || o.kind === 'arch' ? 0 : o.sill ?? 1.0;
    if (a > cursor + 0.01) rects.push([cursor, a, 0, height]);
    if (sill > 0.01) rects.push([a, b, 0, sill]);
    if (sill + o.h < height - 0.01) rects.push([a, b, sill + o.h, height]);
    cursor = b;
  }
  if (cursor < L - 0.01) rects.push([cursor, L, 0, height]);

  for (const [u0, u1, v0, v1] of rects) {
    const cx = (u0 + u1) / 2 - L / 2, cy = (v0 + v1) / 2, w = u1 - u0, h = v1 - v0;
    // two visual skins: exterior plaster + interior wallpaper
    k.box(cx, cy, (outSign * t) / 4, w, h, t / 2, style.outer, { ao: 0.12 });
    k.box(cx, cy, (-outSign * t) / 4, w, h, t / 2, style.inner, { ao: 0.18 });
    k.collider(cx, cy, 0, w, h, t, style.surface);
  }

  // plinth + timber frame
  const oz = outSign * (t / 2 + 0.03);
  if (style.plinth !== undefined && y0 < 0.5) {
    for (const [u0, u1, v0] of rects) {
      if (v0 > 0.01) continue;
      k.box((u0 + u1) / 2 - L / 2, 0.22, oz, u1 - u0, 0.44, 0.08, style.plinth, { ao: 0.3 });
    }
  }
  if (style.beams !== undefined) {
    const bc = style.beams;
    k.box(-L / 2 + 0.1, height / 2, oz, 0.2, height, 0.1, bc, { ao: 0.1 });
    k.box(L / 2 - 0.1, height / 2, oz, 0.2, height, 0.1, bc, { ao: 0.1 });
    k.box(0, height - 0.1, oz, L, 0.2, 0.1, bc, { ao: 0 });
    // diagonal braces in solid stretches wider than 2.2m (storybook half-timbering)
    for (const [u0, u1, v0, v1] of rects) {
      if (u1 - u0 > 2.2 && v1 - v0 > height - 0.05) {
        const cx = (u0 + u1) / 2 - L / 2;
        const span = Math.min(1.4, (u1 - u0) / 2 - 0.3);
        const hh = height * 0.45;
        const len = Math.hypot(span, hh);
        const ang = Math.atan2(hh, span);
        k.box(cx - span / 2, height * 0.55, oz, len, 0.14, 0.08, bc, { roll: ang, ao: 0 });
        k.box(cx + span / 2, height * 0.55, oz, len, 0.14, 0.08, bc, { roll: -ang, ao: 0 });
      }
    }
  }

  // opening trims / shutters / flower boxes
  for (const o of ops) {
    const cx = o.at - L / 2;
    const isDoor = o.kind === 'door' || o.kind === 'arch';
    const sill = isDoor ? 0 : o.sill ?? 1.0;
    const tr = style.trim;
    const d = t + 0.1;
    k.box(cx, sill + o.h + 0.07, 0, o.w + 0.3, 0.14, d, tr, { ao: 0 });
    k.box(cx - o.w / 2 - 0.07, sill + o.h / 2, 0, 0.14, o.h, d, tr, { ao: 0 });
    k.box(cx + o.w / 2 + 0.07, sill + o.h / 2, 0, 0.14, o.h, d, tr, { ao: 0 });
    if (!isDoor) {
      k.box(cx, sill - 0.05, outSign * 0.06, o.w + 0.34, 0.1, d + 0.12, tr, { ao: 0, col: 'wood', flags: ColFlags.BlocksMove });
      if (o.shutters !== undefined) {
        const sw = o.w / 2;
        for (const side of [-1, 1]) {
          k.box(cx + side * (o.w / 2 + 0.15 + sw / 2), sill + o.h / 2, outSign * (t / 2 + 0.06), sw, o.h * 0.98, 0.06, o.shutters, { ao: 0.05, yaw: side * outSign * 0.25 });
          // slats
          for (let i = 1; i < 4; i++) {
            k.box(cx + side * (o.w / 2 + 0.15 + sw / 2), sill + (o.h * i) / 4, outSign * (t / 2 + 0.1), sw * 0.8, 0.04, 0.02, shade(o.shutters, 0.8), { ao: 0, yaw: side * outSign * 0.25 });
          }
        }
      }
      if (o.flowers) {
        const fz = outSign * (t / 2 + 0.22);
        k.box(cx, sill - 0.22, fz, o.w + 0.1, 0.28, 0.34, PAL.terracotta, { r: 0.04, ao: 0.2 });
        const cols = [PAL.pink, PAL.mustard, 0xffffff, PAL.lavender, 0xff7a6b];
        for (let i = 0; i < 5; i++) {
          const fx = cx - o.w / 2 + 0.12 + (i * (o.w - 0.14)) / 4;
          k.ico(fx, sill - 0.02, fz, 0.13, PAL.leafDark, { batch: 'foliage', wind: 0.4, detail: 0 });
          k.ico(fx + 0.04, sill + 0.08, fz + 0.03, 0.07, cols[(i + Math.round(cx * 3)) % cols.length], { batch: 'foliage', wind: 0.6, detail: 0 });
        }
      }
    } else if (doors && o.kind === 'door') {
      const [wx, wy, wz] = k.w(cx - o.w / 2, 0, 0);
      doors.push({ x: wx, y: wy, z: wz, yaw: k.worldYaw(), w: o.w, h: o.h, color: style.trim });
    }
  }
  k.pop();
}

export function shade(hex: number, f: number) {
  const r = Math.min(255, ((hex >> 16) & 255) * f), g = Math.min(255, ((hex >> 8) & 255) * f), b = Math.min(255, (hex & 255) * f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Floor slab with an optional rectangular hole (stairwell). Coordinates are kit-local. */
export function floor(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, th: number, color: number, surface: Surface, hole?: [number, number, number, number], under?: number) {
  const rects: [number, number, number, number][] = [];
  if (!hole) rects.push([x0, z0, x1, z1]);
  else {
    const [hx0, hz0, hx1, hz1] = hole;
    if (hz0 > z0) rects.push([x0, z0, x1, hz0]);
    if (hz1 < z1) rects.push([x0, hz1, x1, z1]);
    if (hx0 > x0) rects.push([x0, hz0, hx0, hz1]);
    if (hx1 < x1) rects.push([hx1, hz0, x1, hz1]);
  }
  for (const [a, b, c, d] of rects) {
    k.box((a + c) / 2, y - th / 2 + 0.03, (b + d) / 2, c - a, 0.06, d - b, color, { ao: 0, noise: 0.05 });
    k.box((a + c) / 2, y - th / 2 - 0.03, (b + d) / 2, c - a, th - 0.06, d - b, under ?? shade(color, 0.85), { ao: 0 });
    k.collider((a + c) / 2, y - th / 2, (b + d) / 2, c - a, th, d - b, surface);
  }
}

/** Straight staircase rising along local +x from (lx, ly, lz). Visual steps + smooth ramp collider. */
export function stairs(k: Kit, lx: number, ly: number, lz: number, yaw: number, width: number, rise: number, run: number, color: number, railColor?: number) {
  const steps = Math.max(3, Math.round(rise / 0.2));
  const rh = rise / steps, rs = run / steps;
  k.push(lx, ly, lz, yaw);
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * rh;
    k.box((i + 0.5) * rs, h / 2, 0, rs + 0.01, h, width, i % 2 ? color : shade(color, 0.93), { ao: 0.1 });
    k.box((i + 0.1) * rs, h - 0.02, 0, rs * 0.2, 0.05, width + 0.02, shade(color, 0.75), { ao: 0 });
    if (i > 1) k.collider((i + 0.5) * rs, (i * rh - 0.4) / 2, 0, rs, Math.max(0.05, i * rh - 0.4), width, 'wood');
  }
  const a = Math.atan2(rise, run);
  const L = Math.hypot(rise, run) + 0.3;
  const th = 0.2;
  k.collider(run / 2 + Math.sin(a) * th * 0.5, rise / 2 + rh * 0.5 - Math.cos(a) * th * 0.5, 0, L, th, width, 'wood', { roll: a });
  if (railColor !== undefined) {
    const rl = Math.hypot(rise, run);
    k.box(run / 2, rise / 2 + 1.0, width / 2 - 0.05, rl, 0.08, 0.08, railColor, { roll: a, ao: 0 });
    for (let i = 1; i < steps; i += 3) k.box((i + 0.5) * rs, (i + 1) * rh + 0.5, width / 2 - 0.05, 0.06, 1.0, 0.06, railColor, { ao: 0 });
  }
  k.pop();
}

/**
 * Gable roof with ridge along local X. Walkable slopes (real colliders) so rooftops are playable
 * and the Blinkbug can land on them.
 */
export function gableRoof(k: Kit, cx: number, baseY: number, cz: number, yaw: number, width: number, depth: number, rise: number, color: number, opts: { overhang?: number; gableColor?: number; gableWindow?: boolean; trim?: number; wallT?: number } = {}) {
  const over = opts.overhang ?? 0.5;
  const th = 0.28;
  const half = depth / 2;
  const a = Math.atan2(rise, half);
  const run = half + over;
  const len = run / Math.cos(a);
  const W = width + over * 2;
  k.push(cx, baseY, cz, yaw);
  for (const side of [1, -1]) {
    // surface line from ridge (0, rise) to eave (side*run, rise - run*tan a)
    const mz = (side * run) / 2;
    const my = rise - (run * Math.tan(a)) / 2;
    const ny = Math.cos(a), nz = side * Math.sin(a);
    k.box(0, my - ny * th * 0.5, mz - nz * th * 0.5, W, th, len, color, { pitch: side * a, ao: 0.05, top: 0.1, col: 'wood' });
    // shingle rows for texture/silhouette
    const rows = Math.floor(len / 0.55);
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      k.box(0, rise - f * run * Math.tan(a) + 0.03, side * f * run, W + 0.02, 0.07, 0.12, shade(color, 0.86), { pitch: side * a, ao: 0 });
    }
    // fascia board at the eave
    k.box(0, rise - run * Math.tan(a) - 0.12, side * run, W + 0.05, 0.22, 0.12, opts.trim ?? PAL.cream, { ao: 0 });
  }
  // ridge cap
  k.cyl(0, rise + 0.06, 0, 0.16, 0.16, W + 0.1, shade(color, 0.8), { roll: Math.PI / 2, segs: 8 });
  // gable ends
  const gc = opts.gableColor ?? PAL.cream;
  const t = opts.wallT ?? 0.3;
  for (const s of [1, -1]) {
    k.push((s * width) / 2 - (s * t) / 2, 0, 0, Math.PI / 2);
    if (opts.gableWindow && s === 1) {
      // triangle split around a small round-ish window so bugs can sneak into the attic
      const ww = 0.9, wy0 = 0.5, wh = 0.8;
      const layers = 5;
      for (let i = 0; i < layers; i++) {
        const y0 = (i * rise) / layers, y1 = ((i + 1) * rise) / layers;
        const halfW = half * (1 - y0 / rise);
        const inWin = y1 > wy0 && y0 < wy0 + wh;
        if (inWin) {
          k.collider(-(halfW + ww / 2) / 2, (y0 + y1) / 2, 0, halfW - ww / 2, y1 - y0, t, 'wood');
          k.collider((halfW + ww / 2) / 2, (y0 + y1) / 2, 0, halfW - ww / 2, y1 - y0, t, 'wood');
        } else k.collider(0, (y0 + y1) / 2, 0, halfW * 2, y1 - y0, t, 'wood');
      }
      k.prism(0, 0, 0, depth, rise, t, gc, { ao: 0 });
      // the "hole" is faked visually with a dark inset + frame: collision has the real gap
      k.box(0, wy0 + wh / 2, 0, ww, wh, t + 0.02, 0x2d2433, { ao: 0, batch: 'nocast' });
      k.box(0, wy0 + wh + 0.05, 0, ww + 0.2, 0.1, t + 0.1, opts.trim ?? PAL.brown, { ao: 0 });
      k.box(0, wy0 - 0.05, 0, ww + 0.2, 0.1, t + 0.14, opts.trim ?? PAL.brown, { ao: 0 });
    } else {
      k.prism(0, 0, 0, depth, rise, t, gc, { ao: 0 });
      const layers = 5;
      for (let i = 0; i < layers; i++) {
        const y0 = (i * rise) / layers, y1 = ((i + 1) * rise) / layers;
        const halfW = half * (1 - y0 / rise);
        k.collider(0, (y0 + y1) / 2, 0, halfW * 2, y1 - y0, t, 'wood');
      }
    }
    k.pop();
  }
  k.pop();
}
