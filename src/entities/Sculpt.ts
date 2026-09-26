import * as THREE from 'three';

/**
 * Procedural "sculpting" helpers for characters. Instead of stacking primitives we build
 * continuous organic surfaces: lathed profiles (bean-shaped bodies, boots), deformed spheres
 * (heads with cheeks) and skinned tubes that bend smoothly at elbows / knees / waist.
 */

export type Profile = [number, number][]; // [radius, y]

const _c = new THREE.Color();

/** Smooth a coarse profile with Catmull-Rom so silhouettes read as soft, sculpted curves. */
export function smoothProfile(p: Profile, samples = 28): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(p.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(samples);
}

export function lathe(p: Profile, segs = 22, samples = 28, scaleZ = 1): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(smoothProfile(p, samples), segs);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  g.computeVertexNormals();
  return g;
}

/** Colour vertices by height using bands; `soft` blends across band edges. */
export function bandColors(g: THREE.BufferGeometry, bands: { from: number; color: number }[], axis: 'y' | 'd' = 'y', soft = 0.012, dFn?: (v: THREE.Vector3) => number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  const lin = sorted.map((b) => new THREE.Color(b.color).convertSRGBToLinear());
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = dFn ? dFn(v) : axis === 'y' ? v.y : -v.y;
    let idx = 0;
    for (let b = 0; b < sorted.length; b++) if (k >= sorted[b].from) idx = b;
    _c.copy(lin[idx]);
    // soft blend with previous band near the edge
    if (idx > 0 && k - sorted[idx].from < soft) _c.lerp(lin[idx - 1], 0.5 * (1 - (k - sorted[idx].from) / soft));
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function solidColor(g: THREE.BufferGeometry, hex: number) {
  return bandColors(g, [{ from: -1e9, color: hex }]);
}

export function deform(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A limb (or torso) as ONE skinned tube hanging down -Y from the root bone. `joint` is the
 * distance to the second bone; vertices blend between bones across `blend`, so the surface
 * bends like soft vinyl instead of breaking at a hinge.
 * radius(d) gives the radius at depth d, colorAt(d) the vertex colour.
 */
export function skinnedTube(o: {
  length: number;
  joint: number;
  blend: number;
  radius: (d: number) => number;
  colorAt: (d: number) => number;
  radial?: number;
  rings?: number;
  flatten?: number; // z scale
  capTop?: boolean;
  capBottom?: boolean;
}): THREE.BufferGeometry {
  const radial = o.radial ?? 14;
  const rings = o.rings ?? 22;
  const pos: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const skinI: number[] = [];
  const skinW: number[] = [];
  const colCache = new Map<number, THREE.Color>();
  const lin = (hex: number) => {
    let c = colCache.get(hex);
    if (!c) colCache.set(hex, (c = new THREE.Color(hex).convertSRGBToLinear()));
    return c;
  };
  const push = (x: number, y: number, z: number, d: number) => {
    pos.push(x, y, z);
    const c = lin(o.colorAt(d));
    col.push(c.r, c.g, c.b);
    const w = smooth(o.joint - o.blend, o.joint + o.blend, d);
    skinI.push(0, 1, 0, 0);
    skinW.push(1 - w, w, 0, 0);
  };
  const fz = o.flatten ?? 1;
  // ring vertices (ring 0 = top). Extra rings densely placed around the joint.
  const ds: number[] = [];
  for (let r = 0; r <= rings; r++) ds.push((r / rings) * o.length);
  for (let r = 0; r <= rings; r++) {
    const d = ds[r];
    const rad = o.radius(d);
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      push(Math.cos(a) * rad, -d, Math.sin(a) * rad * fz, d);
    }
  }
  const row = radial + 1;
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < radial; s++) {
      const a = r * row + s, b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const cap = (d: number, dir: 1 | -1) => {
    const rad = o.radius(d);
    const centerDome = rad * 0.6;
    const c0 = pos.length / 3;
    push(0, -d + dir * centerDome, 0, d);
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      push(Math.cos(a) * rad * 0.7, -d + dir * centerDome * 0.7, Math.sin(a) * rad * 0.7 * fz, d);
    }
    const ringStart = dir === 1 ? 0 : rings * row;
    for (let s = 0; s < radial; s++) {
      const inner = c0 + 1 + s, outer = ringStart + s;
      if (dir === 1) {
        idx.push(c0, inner + 1, inner);
        idx.push(inner, inner + 1, outer + 1, inner, outer + 1, outer);
      } else {
        idx.push(c0, inner, inner + 1);
        idx.push(inner, outer, outer + 1, inner, outer + 1, inner + 1);
      }
    }
  };
  if (o.capTop !== false) cap(0, 1);
  if (o.capBottom !== false) cap(o.length, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tube along a curve (scarf wraps, straps). */
export function curveTube(points: THREE.Vector3[], radius: number, radial = 8, segs = 24, flatten = 1) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  if (flatten !== 1) {
    // flatten into a ribbon-ish strap along the local normal by squashing toward the curve
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = Math.floor(i / (radial + 1)) / segs;
      curve.getPointAt(Math.min(1, t), p);
      const off = v.clone().sub(p);
      const n = p.clone().setY(0).normalize();
      const along = off.dot(n);
      v.copy(p).add(off.addScaledVector(n, -along * (1 - flatten)));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Make a skinned mesh driven by two existing hierarchy nodes (our animation groups). */
export function bindTwoBone(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, at: THREE.Vector3, boneA: THREE.Object3D, boneB: THREE.Object3D) {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.position.copy(at);
  parent.add(mesh);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  // bones are plain Object3Ds in our rig; Skeleton only needs their world matrices
  return { mesh, bones: [boneA, boneB] };
}

export function finalizeBinds(root: THREE.Object3D, binds: { mesh: THREE.SkinnedMesh; bones: THREE.Object3D[] }[]) {
  root.updateMatrixWorld(true);
  for (const b of binds) {
    const sk = new THREE.Skeleton(b.bones as THREE.Bone[]);
    b.mesh.bind(sk, b.mesh.matrixWorld);
  }
}
