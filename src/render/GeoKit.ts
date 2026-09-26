import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry toolkit. All static world art is built from simple parametric shapes that carry
 * baked vertex colours (with a soft top-light / ambient-occlusion gradient), then merged into
 * a handful of big meshes. Result: a richly coloured world with very few draw calls and no
 * texture memory — ideal for mobile.
 */

export interface ShapeOpts {
  color: number;
  /** bottom darkening for fake ambient occlusion (0..1) */
  ao?: number;
  /** extra top brightening */
  topLight?: number;
  /** per-vertex random colour noise amount */
  noise?: number;
  /** foliage sway weight at the top of the shape (only for the foliage batcher) */
  wind?: number;
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export const geoStats: Record<string, number> = {};
let seed = 1234;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** Paint vertex colours onto a geometry with a vertical gradient. Geometry must be in local space. */
export function paint(g: THREE.BufferGeometry, o: ShapeOpts) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const h = Math.max(1e-4, bb.max.y - bb.min.y);
  const ao = o.ao ?? 0.22;
  const top = o.topLight ?? 0.06;
  const noise = o.noise ?? 0.035;
  _c.setHex(o.color).convertSRGBToLinear();
  const normal = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < n; i++) {
    const y = (pos.getY(i) - bb.min.y) / h;
    let k = 1 - ao * (1 - y) * (1 - y) + top * y;
    if (normal) {
      const ny = normal.getY(i);
      if (ny > 0.5) k += top * 0.8;
    }
    k += (rnd() - 0.5) * noise;
    _c2.copy(_c).multiplyScalar(k);
    colors[i * 3] = _c2.r;
    colors[i * 3 + 1] = _c2.g;
    colors[i * 3 + 2] = _c2.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (o.wind !== undefined) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = (pos.getY(i) - bb.min.y) / h;
      w[i] = o.wind * (0.25 + 0.75 * y);
    }
    g.setAttribute('wind', new THREE.BufferAttribute(w, 1));
  }
  return g;
}

export function transform(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function boxGeo(sx: number, sy: number, sz: number, radius = 0, segs = 2) {
  if (radius > 0) {
    const r = Math.min(radius, sx / 2 - 0.001, sy / 2 - 0.001, sz / 2 - 0.001);
    return new RoundedBoxGeometry(sx, sy, sz, segs, Math.max(0.001, r));
  }
  return new THREE.BoxGeometry(sx, sy, sz);
}

/** Strips index / uv so geometries can be merged uniformly. */
export function normalise(g: THREE.BufferGeometry) {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color' && name !== 'wind') out.deleteAttribute(name);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/**
 * Collects coloured geometry and merges it. Use one batcher per material type (solid, foliage...).
 */
export class Batcher {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, o: ShapeOpts | null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    if (o) paint(g, o);
    const tn = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    geoStats[g.type] = (geoStats[g.type] ?? 0) + tn;
    transform(g, x, y, z, rx, ry, rz, sx, sy, sz);
    this.parts.push(normalise(g));
    return this;
  }

  /** Rounded (or square) box centred at x,y,z */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: ShapeOpts, radius = 0, ry = 0, rx = 0, rz = 0) {
    return this.add(boxGeo(sx, sy, sz, radius), o, x, y, z, rx, ry, rz);
  }

  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, o: ShapeOpts, segs = 10, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, segs), o, x, y, z, rx, ry, rz);
  }

  sphere(x: number, y: number, z: number, r: number, o: ShapeOpts, sx = 1, sy = 1, sz = 1, wSeg = 10, hSeg = 8) {
    return this.add(new THREE.SphereGeometry(r, wSeg, hSeg), o, x, y, z, 0, 0, 0, sx, sy, sz);
  }

  ico(x: number, y: number, z: number, r: number, o: ShapeOpts, detail = 1, sx = 1, sy = 1, sz = 1, ry = 0) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), o, x, y, z, 0, ry, 0, sx, sy, sz);
  }

  cone(x: number, y: number, z: number, r: number, h: number, o: ShapeOpts, segs = 8, ry = 0) {
    return this.add(new THREE.ConeGeometry(r, h, segs), o, x, y, z, 0, ry, 0);
  }

  get count() {
    return this.parts.length;
  }

  build(material: THREE.Material, castShadow = true, receiveShadow = true): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /**
   * Build spatially chunked meshes so the renderer can frustum-cull parts of a big world.
   */
  buildChunked(material: THREE.Material, chunk = 32, castShadow = true, receiveShadow = true): THREE.Mesh[] {
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    for (const g of this.parts) {
      g.computeBoundingBox();
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      const k = `${Math.floor(c.x / chunk)},${Math.floor(c.z / chunk)}`;
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(g);
    }
    const meshes: THREE.Mesh[] = [];
    for (const arr of buckets.values()) {
      const merged = mergeGeometries(arr, false);
      arr.forEach((p) => p.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    this.parts = [];
    return meshes;
  }
}

/** A single coloured mesh (for dynamic objects). */
export function coloredMesh(g: THREE.BufferGeometry, o: ShapeOpts, mat: THREE.Material) {
  paint(g, o);
  return new THREE.Mesh(g, mat);
}
