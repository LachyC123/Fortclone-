import * as THREE from 'three';

/**
 * Lightweight, deterministic collision for a stylised arcade game.
 *
 * Everything static in the world is an oriented box (OBB). Characters are stacks of spheres,
 * the Blinkbug is a sphere, bullets are rays. Sphere-vs-OBB and ray-vs-OBB are exact and cheap,
 * and a uniform XZ grid keeps queries local. This is far more predictable than a general
 * physics engine for character movement, and it runs happily on phones.
 */

export type Surface = 'grass' | 'stone' | 'wood' | 'metal' | 'water' | 'cloth' | 'dirt';

export const ColFlags = {
  None: 0,
  BlocksMove: 1,
  BlocksBullets: 2,
  BlocksBug: 4,
  BlocksSight: 8,
  Solid: 15,
  /** glass-less windows, railings: stop movement but let bullets/bugs through */
  MoveOnly: 1,
} as const;

let nextId = 1;

export class OBB {
  readonly id = nextId++;
  center = new THREE.Vector3();
  half = new THREE.Vector3(0.5, 0.5, 0.5);
  ax = new THREE.Vector3(1, 0, 0);
  ay = new THREE.Vector3(0, 1, 0);
  az = new THREE.Vector3(0, 0, 1);
  min = new THREE.Vector3();
  max = new THREE.Vector3();
  surface: Surface = 'stone';
  flags: number = ColFlags.Solid;
  enabled = true;
  /** used to dedupe grid queries */
  stamp = 0;
  /** optional gameplay tag (e.g. 'door', 'window-glass', 'prop') */
  tag = '';
  userData: unknown = null;

  static fromBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) {
    const o = new OBB();
    o.set(cx, cy, cz, sx, sy, sz, yaw, pitch, roll);
    return o;
  }

  set(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) {
    this.center.set(cx, cy, cz);
    this.half.set(sx / 2, sy / 2, sz / 2);
    const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e);
    m.extractBasis(this.ax, this.ay, this.az);
    this.computeAabb();
    return this;
  }

  setFromMatrix(center: THREE.Vector3, size: THREE.Vector3, quat: THREE.Quaternion) {
    this.center.copy(center);
    this.half.copy(size).multiplyScalar(0.5);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    m.extractBasis(this.ax, this.ay, this.az);
    this.computeAabb();
    return this;
  }

  computeAabb() {
    const h = this.half;
    const ex = Math.abs(this.ax.x) * h.x + Math.abs(this.ay.x) * h.y + Math.abs(this.az.x) * h.z;
    const ey = Math.abs(this.ax.y) * h.x + Math.abs(this.ay.y) * h.y + Math.abs(this.az.y) * h.z;
    const ez = Math.abs(this.ax.z) * h.x + Math.abs(this.ay.z) * h.y + Math.abs(this.az.z) * h.z;
    this.min.set(this.center.x - ex, this.center.y - ey, this.center.z - ez);
    this.max.set(this.center.x + ex, this.center.y + ey, this.center.z + ez);
  }

  /**
   * Sphere contact. Returns penetration depth (>0) and writes the push-out normal, or returns 0.
   */
  sphereContact(p: THREE.Vector3, r: number, outN: THREE.Vector3): number {
    if (p.x + r < this.min.x || p.x - r > this.max.x || p.y + r < this.min.y || p.y - r > this.max.y || p.z + r < this.min.z || p.z - r > this.max.z) return 0;
    const dx = p.x - this.center.x, dy = p.y - this.center.y, dz = p.z - this.center.z;
    const lx = dx * this.ax.x + dy * this.ax.y + dz * this.ax.z;
    const ly = dx * this.ay.x + dy * this.ay.y + dz * this.ay.z;
    const lz = dx * this.az.x + dy * this.az.y + dz * this.az.z;
    const h = this.half;
    const qx = lx < -h.x ? -h.x : lx > h.x ? h.x : lx;
    const qy = ly < -h.y ? -h.y : ly > h.y ? h.y : ly;
    const qz = lz < -h.z ? -h.z : lz > h.z ? h.z : lz;
    const ddx = lx - qx, ddy = ly - qy, ddz = lz - qz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > 1e-10) {
      if (d2 >= r * r) return 0;
      const d = Math.sqrt(d2);
      const nx = ddx / d, ny = ddy / d, nz = ddz / d;
      outN.set(
        this.ax.x * nx + this.ay.x * ny + this.az.x * nz,
        this.ax.y * nx + this.ay.y * ny + this.az.y * nz,
        this.ax.z * nx + this.ay.z * ny + this.az.z * nz,
      );
      return r - d;
    }
    // centre inside the box: push out along the axis of least penetration
    const px = h.x - Math.abs(lx), py = h.y - Math.abs(ly), pz = h.z - Math.abs(lz);
    if (px <= py && px <= pz) {
      outN.copy(this.ax).multiplyScalar(lx >= 0 ? 1 : -1);
      return px + r;
    } else if (py <= pz) {
      outN.copy(this.ay).multiplyScalar(ly >= 0 ? 1 : -1);
      return py + r;
    }
    outN.copy(this.az).multiplyScalar(lz >= 0 ? 1 : -1);
    return pz + r;
  }

  /** Ray intersection (slab test in local space). Returns distance or -1. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, outN?: THREE.Vector3): number {
    const cx = o.x - this.center.x, cy = o.y - this.center.y, cz = o.z - this.center.z;
    const axes = [this.ax, this.ay, this.az];
    const halves = [this.half.x, this.half.y, this.half.z];
    let tmin = 0, tmax = maxDist, nAxis = -1, nSign = 1;
    for (let i = 0; i < 3; i++) {
      const a = axes[i];
      const e = a.x * cx + a.y * cy + a.z * cz;
      const f = a.x * d.x + a.y * d.y + a.z * d.z;
      const h = halves[i];
      if (Math.abs(f) > 1e-9) {
        let t1 = (-h - e) / f, t2 = (h - e) / f;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1; t1 = t2; t2 = tmp; s = 1;
        }
        if (t1 > tmin) {
          tmin = t1; nAxis = i; nSign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      } else if (-e - h > 0 || -e + h < 0) return -1;
    }
    if (nAxis < 0) {
      // origin inside box
      if (outN) outN.copy(d).negate();
      return 0;
    }
    if (outN) outN.copy(axes[nAxis]).multiplyScalar(nSign);
    return tmin;
  }

  containsPoint(p: THREE.Vector3, pad = 0) {
    const dx = p.x - this.center.x, dy = p.y - this.center.y, dz = p.z - this.center.z;
    return (
      Math.abs(dx * this.ax.x + dy * this.ax.y + dz * this.ax.z) <= this.half.x + pad &&
      Math.abs(dx * this.ay.x + dy * this.ay.y + dz * this.ay.z) <= this.half.y + pad &&
      Math.abs(dx * this.az.x + dy * this.az.y + dz * this.az.z) <= this.half.z + pad
    );
  }
}

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: OBB | null;
}

const CELL = 4;
const key = (ix: number, iz: number) => (ix + 2048) * 4096 + (iz + 2048);

export class CollisionWorld {
  colliders: OBB[] = [];
  private grid = new Map<number, OBB[]>();
  private stamp = 1;
  private _n = new THREE.Vector3();
  private _tmp: OBB[] = [];

  add(o: OBB) {
    this.colliders.push(o);
    const x0 = Math.floor(o.min.x / CELL), x1 = Math.floor(o.max.x / CELL);
    const z0 = Math.floor(o.min.z / CELL), z1 = Math.floor(o.max.z / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(o);
      }
    return o;
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, surface: Surface = 'stone', yaw = 0, pitch = 0, roll = 0, flags: number = ColFlags.Solid) {
    const o = OBB.fromBox(cx, cy, cz, sx, sy, sz, yaw, pitch, roll);
    o.surface = surface;
    o.flags = flags;
    return this.add(o);
  }

  /** Collect colliders whose AABB overlaps the given AABB. Result array is reused — copy if needed. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mask: number = ColFlags.BlocksMove): OBB[] {
    const out = this._tmp;
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (o.stamp === s || !o.enabled || !(o.flags & mask)) continue;
          o.stamp = s;
          if (o.max.x < minX || o.min.x > maxX || o.max.y < minY || o.min.y > maxY || o.max.z < minZ || o.min.z > maxZ) continue;
          out.push(o);
        }
      }
    return out;
  }

  /**
   * Push a sphere out of all overlapping geometry. Returns the number of contacts;
   * `onContact` receives each push normal (world) so callers can clip velocity / detect ground.
   */
  resolveSphere(p: THREE.Vector3, r: number, mask: number, onContact?: (n: THREE.Vector3, depth: number, o: OBB) => void, iterations = 3): number {
    let contacts = 0;
    for (let it = 0; it < iterations; it++) {
      const list = this.query(p.x - r, p.y - r, p.z - r, p.x + r, p.y + r, p.z + r, mask);
      let any = false;
      for (let i = 0; i < list.length; i++) {
        const depth = list[i].sphereContact(p, r, this._n);
        if (depth > 1e-5) {
          p.addScaledVector(this._n, depth);
          contacts++;
          any = true;
          onContact?.(this._n, depth, list[i]);
        }
      }
      if (!any) break;
    }
    return contacts;
  }

  sphereOverlaps(p: THREE.Vector3, r: number, mask: number = ColFlags.BlocksMove): boolean {
    const list = this.query(p.x - r, p.y - r, p.z - r, p.x + r, p.y + r, p.z + r, mask);
    for (let i = 0; i < list.length; i++) if (list[i].sphereContact(p, r, this._n) > 1e-3) return true;
    return false;
  }

  /** Grid-traversing raycast. Returns nearest hit or null. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, mask: number = ColFlags.BlocksBullets, out?: RayHit): RayHit | null {
    const s = ++this.stamp;
    let bestT = maxDist;
    let best: OBB | null = null;
    const n = this._n;
    const bestN = new THREE.Vector3();
    // 2D DDA across grid cells (XZ).
    let ix = Math.floor(o.x / CELL), iz = Math.floor(o.z / CELL);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tDeltaZ = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tMaxX = Math.abs(d.x) > 1e-9 ? ((d.x > 0 ? (ix + 1) * CELL - o.x : o.x - ix * CELL) / Math.abs(d.x)) : Infinity;
    let tMaxZ = Math.abs(d.z) > 1e-9 ? ((d.z > 0 ? (iz + 1) * CELL - o.z : o.z - iz * CELL) / Math.abs(d.z)) : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 512; guard++) {
      const arr = this.grid.get(key(ix, iz));
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c.stamp === s || !c.enabled || !(c.flags & mask)) continue;
          c.stamp = s;
          const t = c.raycast(o, d, bestT, n);
          if (t >= 0 && t < bestT) {
            bestT = t;
            best = c;
            bestN.copy(n);
          }
        }
      }
      // we can stop once the next cell boundary is beyond the best hit
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > bestT || tCell > maxDist) break;
      tCell = tNext;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    if (!best) return null;
    const hit = out ?? { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
    hit.t = bestT;
    hit.point.copy(o).addScaledVector(d, bestT);
    hit.normal.copy(bestN);
    hit.collider = best;
    return hit;
  }

  /** Line of sight test between two points. */
  lineClear(a: THREE.Vector3, b: THREE.Vector3, mask: number = ColFlags.BlocksSight): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    return this.raycast(a, d, len - 0.05, mask) === null;
  }
}

/** Ray vs sphere; returns t or -1. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  if (t < 0) return cc < 0 ? 0 : -1;
  return t;
}

/** Ray vs capsule (segment pa-pb, radius r). Based on Inigo Quilez's formulation. */
export function rayCapsule(ro: THREE.Vector3, rd: THREE.Vector3, pa: THREE.Vector3, pb: THREE.Vector3, r: number): number {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
    // caps
    const ocx = y <= 0 ? oax : ro.x - pb.x;
    const ocy = y <= 0 ? oay : ro.y - pb.y;
    const ocz = y <= 0 ? oaz : ro.z - pb.z;
    b = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) {
      const t2 = -b - Math.sqrt(h);
      if (t2 >= 0) return t2;
    }
  }
  return -1;
}
