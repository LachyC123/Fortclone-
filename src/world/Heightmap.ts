import * as THREE from 'three';
import { OBB, ColFlags } from '../physics/Collision';
import { noise2, smoothstep } from '../core/math';

/**
 * The island's shape: a heightfield with rolling hills, ridges and a raised manor plateau, with
 * flat "pads" under each place so buildings sit level. Paths cut passes through the hills.
 * One function feeds the render mesh, the collision heightfield and every prop placement,
 * so what you see is exactly what you stand on, shoot through and hide behind.
 */

export const ISLAND_R = 100;
export const STREAM_X = -28;
/** stream runs from a spring in the north of Buttonbury down into Crash Cove */
export const STREAM_Z0 = -44;
export const STREAM_Z1 = 81;

/**
 * Peninsulas (angle in radians = atan2(z, x), extra radius, angular width). Each one carries a place
 * of its own out past the original round island, so there's always somewhere else to go.
 */
const LOBES: [number, number, number][] = [
  [(223 * Math.PI) / 180, 33, 0.34], // Puddleby Farm (north-west)
  [(282 * Math.PI) / 180, 35, 0.34], // Tickerton (north)
  [(343 * Math.PI) / 180, 33, 0.34], // Snoozy Pines (north-east)
  [(58 * Math.PI) / 180, 34, 0.34], // Saltwhistle Wharf (south-east)
  [(150 * Math.PI) / 180, 35, 0.34], // Rumpus Fair (south-west)
];
/** furthest the land reaches from the centre (bounds for the heightfield, nav grid and minimap) */
export const ISLAND_MAX = 140;

export function islandRadius(angle: number) {
  let r = ISLAND_R + Math.sin(angle * 3 + 1.3) * 4 + Math.sin(angle * 7 + 0.4) * 2.2 + Math.sin(angle * 13) * 0.9;
  for (const [a, ext, w] of LOBES) {
    let d = angle - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const k = d / w;
    if (k * k < 9) r += ext * Math.exp(-k * k) * (1 + Math.sin(angle * 17 + a) * 0.04);
  }
  return r;
}

/** point on a lobe's centre line at distance r from the island centre */
function lobePoint(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
}
const [PUD_X, PUD_Z] = lobePoint(223, 108);
const [TIC_X, TIC_Z] = lobePoint(282, 108);
const [SNZ_X, SNZ_Z] = lobePoint(343, 107);
const [SAL_X, SAL_Z] = lobePoint(58, 106);
const [FAIR_X, FAIR_Z] = lobePoint(150, 108);

export interface POI {
  id: string;
  name: string;
  x: number;
  z: number;
  /** flat pad radius (level ground for buildings) */
  pad: number;
  /** blend distance from pad to natural ground */
  blend: number;
  /** pad height */
  h: number;
  /** extent used for the zone label and minimap */
  r: number;
}

export const POIS: POI[] = [
  { id: 'buttonbury', name: 'Buttonbury', x: 0, z: 0, pad: 46, blend: 12, h: 0, r: 44 },
  { id: 'wobblewood', name: 'Wobblewood', x: -70, z: -18, pad: 0, blend: 0, h: 0, r: 24 },
  { id: 'market', name: 'Tumble Market', x: -22, z: -74, pad: 19, blend: 10, h: 1.2, r: 22 },
  { id: 'manor', name: 'Crooked Manor', x: 50, z: -58, pad: 15, blend: 13, h: 7.5, r: 19 },
  { id: 'rattleworks', name: 'Rattleworks', x: 72, z: 20, pad: 21, blend: 10, h: 0.6, r: 23 },
  { id: 'cove', name: 'Crash Cove', x: -20, z: 78, pad: 13, blend: 10, h: -0.2, r: 20 },
  { id: 'puddleby', name: 'Puddleby Farm', x: PUD_X, z: PUD_Z, pad: 17, blend: 9, h: 0.8, r: 20 },
  { id: 'tickerton', name: 'Tickerton', x: TIC_X, z: TIC_Z, pad: 18, blend: 8, h: 1.0, r: 20 },
  { id: 'pines', name: 'Snoozy Pines', x: SNZ_X, z: SNZ_Z, pad: 0, blend: 0, h: 0, r: 19 },
  { id: 'wharf', name: 'Saltwhistle Wharf', x: SAL_X, z: SAL_Z, pad: 17, blend: 8, h: 0.4, r: 19 },
  { id: 'fair', name: 'Rumpus Fair', x: FAIR_X, z: FAIR_Z, pad: 18, blend: 8, h: 0.5, r: 20 },
];
export const POI_BY_ID: Record<string, POI> = Object.fromEntries(POIS.map((p) => [p.id, p]));

/** hills: x, z, radius, height — placed between places so they break long sightlines */
const HILLS: [number, number, number, number][] = [
  [44, 38, 17, 9], // Lookout Hill (ruined watchtower on top)
  [58, 50, 11, 5],
  [26, 60, 10, 4],
  [-52, -56, 13, 6.5],
  [-40, -44, 8, 3.5],
  [-60, 40, 14, 6],
  [-46, 58, 9, 4],
  [16, -66, 12, 6],
  [8, -84, 8, 3.5],
  [84, -18, 12, 5],
  [-86, 18, 9, 4],
  [70, 58, 8, 3],
];

/** ridges: two ends, half-width, height — long walls of land with passes where paths cross */
const RIDGES: [number, number, number, number, number, number][] = [
  [52, -30, 56, 2, 8, 6], // between the manor hill and Rattleworks
  [-48, -6, -50, 22, 6, 4.5], // edge of Wobblewood
  [22, 84, 40, 72, 7, 5],
];

/** roads between places; also used to cut passes through hills and ridges */
export const ROADS: [number, number][][] = [
  [[0, -36], [-6, -52], [-18, -60]], // Buttonbury -> Tumble Market
  [[18, -30], [30, -44], [40, -50]], // -> Crooked Manor (climbs the manor hill)
  [[36, 12], [50, 16], [56, 18]], // -> Rattleworks (through the ridge pass)
  [[-42, 2], [-54, -6], [-60, -12]], // -> Wobblewood
  [[-10, 40], [-14, 56], [-18, 66]], // -> Crash Cove
  [[-30, -76], [-50, -60], [-62, -38]], // Market -> Wobblewood
  [[62, -44], [70, -20], [70, 0]], // Manor -> Rattleworks
  [[64, 36], [46, 60], [10, 76], [-6, 78]], // Rattleworks -> Cove along the south
  // out to the peninsulas
  [[-50, -60], [-62, -66], [-70, -70]], // -> Puddleby Farm
  [[-4, -76], [8, -90], [16, -98]], // -> Tickerton
  [[70, -20], [84, -26], [94, -29]], // -> Snoozy Pines
  [[46, 60], [50, 72], [53, 80]], // -> Saltwhistle Wharf
  [[-18, 66], [-38, 62], [-62, 58], [-80, 56]], // -> Rumpus Fair
];

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function roadDist(x: number, z: number) {
  let d = 1e9;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, distToSeg(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return d;
}

const LAGOON = { x: -24, z: 90, r: 9 };
export const LAGOON_POS = LAGOON;

/** The analytic ground height (before the heightfield is sampled). */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const R = islandRadius(Math.atan2(z, x));
  // gentle rolling ground everywhere + a little bump detail
  let h = (noise2(x * 0.03 + 3, z * 0.03 - 7) - 0.5) * 3.2 + (noise2(x * 0.09, z * 0.09) - 0.5) * 0.9;
  let hills = 0;
  for (const [hx, hz, hr, hh] of HILLS) {
    const d = Math.hypot(x - hx, z - hz) / hr;
    if (d < 1.6) hills += hh * Math.exp(-d * d * 1.6) * (0.85 + noise2(x * 0.15, z * 0.15) * 0.3);
  }
  for (const [ax, az, bx, bz, w, hh] of RIDGES) {
    const d = distToSeg(x, z, ax, az, bx, bz) / w;
    if (d < 1.8) hills += hh * Math.exp(-d * d * 1.3) * (0.8 + noise2(x * 0.12 + 5, z * 0.12) * 0.4);
  }
  // roads cut passes through hills and ridges
  const rd = roadDist(x, z);
  const cut = smoothstep(9, 3, rd);
  h = h * (1 - cut * 0.6) + hills * (1 - cut * 0.75);
  // level pads under each place (the manor hill is a pad raised high)
  for (const p of POIS) {
    if (p.pad <= 0) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.pad + p.blend) continue;
    const t = smoothstep(p.pad + p.blend, p.pad, d);
    h = h + (p.h - h) * t;
  }
  // stream valley: flat channel with soft banks, then the lagoon bowl in the cove
  if (z > STREAM_Z0 - 4 && z < STREAM_Z1 + 2) {
    const dx = Math.abs(x - STREAM_X);
    const along = Math.min(z - (STREAM_Z0 - 4), STREAM_Z1 + 2 - z);
    const k = smoothstep(9, 4, dx) * smoothstep(0, 4, along);
    h = h + (0 - h) * k;
    if (dx < 2 && z > STREAM_Z0 && z < STREAM_Z1) h -= 0.7 * (dx < 1 ? 1 : 2 - dx);
  }
  const ld = Math.hypot(x - LAGOON.x, z - LAGOON.z);
  if (ld < LAGOON.r + 5) {
    const k = smoothstep(LAGOON.r + 5, LAGOON.r, ld);
    h = h + (-0.1 - h) * k;
    if (ld < LAGOON.r) h -= 1.1 * smoothstep(LAGOON.r, LAGOON.r - 3, ld);
  }
  // settle toward the cliff edge
  h *= smoothstep(R + 1, R - 10, r);
  if (r > R - 1.5) h -= (r - (R - 1.5)) * 0.35;
  return h;
}

/* ------------------------------------------------------------------ sampled heightfield */

export const HF_STEP = 1;
export const HF_HALF = ISLAND_MAX + 2;
export const HF_N = Math.round((HF_HALF * 2) / HF_STEP) + 1;

let heights: Float32Array | null = null;
let maxH = 0;

function buildHeights() {
  heights = new Float32Array(HF_N * HF_N);
  maxH = -1e9;
  for (let j = 0; j < HF_N; j++)
    for (let i = 0; i < HF_N; i++) {
      const x = -HF_HALF + i * HF_STEP, z = -HF_HALF + j * HF_STEP;
      const r = Math.hypot(x, z), R = islandRadius(Math.atan2(z, x));
      const v = r > R + 0.5 ? -60 : terrainHeight(x, z);
      heights[j * HF_N + i] = v;
      if (v > maxH) maxH = v;
    }
}

/** Height of the island surface as the mesh draws it (triangle-exact). -60 off the island. */
export function ground(x: number, z: number): number {
  if (!heights) buildHeights();
  const fx = (x + HF_HALF) / HF_STEP, fz = (z + HF_HALF) / HF_STEP;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= HF_N - 1 || j >= HF_N - 1) return -60;
  const u = fx - i, v = fz - j;
  const H = heights!;
  const h00 = H[j * HF_N + i], h10 = H[j * HF_N + i + 1], h01 = H[(j + 1) * HF_N + i], h11 = H[(j + 1) * HF_N + i + 1];
  // same diagonal split as THREE.PlaneGeometry (a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j): tris abd, bcd)
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

export function groundNormal(x: number, z: number, out: THREE.Vector3) {
  const e = 0.35;
  const hl = ground(x - e, z), hr = ground(x + e, z), hd = ground(x, z - e), hu = ground(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

export function heightAt(i: number, j: number) {
  if (!heights) buildHeights();
  return heights![j * HF_N + i];
}

export function maxGroundHeight() {
  if (!heights) buildHeights();
  return maxH;
}

/* ------------------------------------------------------------------ collider */

const _n = new THREE.Vector3();

/**
 * The ground as a collider. It pretends to be one huge OBB so the collision world, motor,
 * bullets, bots and Blinkbug all treat it like any other surface. One-sided: only solid from above.
 */
export class HeightfieldCollider extends OBB {
  constructor() {
    super();
    const top = maxGroundHeight() + 0.5;
    this.center.set(0, (top - 62) / 2, 0);
    this.half.set(HF_HALF, (top + 62) / 2, HF_HALF);
    this.computeAabb();
    this.surface = 'grass';
    this.flags = ColFlags.Solid;
    this.tag = 'ground';
  }

  override computeAabb() {
    this.min.set(this.center.x - this.half.x, this.center.y - this.half.y, this.center.z - this.half.z);
    this.max.set(this.center.x + this.half.x, this.center.y + this.half.y, this.center.z + this.half.z);
  }

  override sphereContact(p: THREE.Vector3, r: number, outN: THREE.Vector3): number {
    const h = ground(p.x, p.z);
    if (h < -50) return 0;
    if (p.y - h > r * 1.5 + 0.5) return 0;
    groundNormal(p.x, p.z, outN);
    // distance from the sphere centre to the local ground plane
    const dist = (p.y - h) * outN.y;
    if (dist >= r) return 0;
    // deep below the surface (fell through): push straight up
    if (p.y < h - 1.5) {
      outN.set(0, 1, 0);
      return h - p.y + r;
    }
    return r - dist;
  }

  override raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, outN?: THREE.Vector3): number {
    let gap = o.y - ground(o.x, o.z);
    if (gap < 0) return -1; // one-sided
    const hl = Math.hypot(d.x, d.z);
    if (d.y >= 0 && o.y > maxH) return -1;
    let t = 0;
    const slope = 1.25; // steepest ground (rise per metre) — conservative step bound
    for (let i = 0; i < 400 && t < maxDist; i++) {
      const denom = slope * hl + Math.max(0, -d.y);
      const step = denom > 1e-6 ? Math.max(0.12, gap / denom) : maxDist;
      const nt = Math.min(maxDist, t + step);
      const x = o.x + d.x * nt, y = o.y + d.y * nt, z = o.z + d.z * nt;
      if (d.y >= 0 && y > maxH) return -1;
      const g = ground(x, z);
      if (g < -50 && y < -40) return -1;
      const ng = y - g;
      if (ng <= 0 && g > -50) {
        // refine between t and nt
        let a = t, b = nt;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m - ground(o.x + d.x * m, o.z + d.z * m) > 0) a = m;
          else b = m;
        }
        if (outN) groundNormal(o.x + d.x * b, o.z + d.z * b, outN);
        return b;
      }
      gap = ng;
      t = nt;
      if (nt >= maxDist) break;
    }
    return -1;
  }

  override containsPoint(p: THREE.Vector3, pad = 0) {
    return p.y < ground(p.x, p.z) + pad && ground(p.x, p.z) > -50;
  }
}
void _n;
