import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Bake a multi-material hierarchy into ONE vertex-coloured mesh (1 draw call). Used for static
 * display models such as floor loot, where we never animate sub-parts.
 */
export function mergeToVertexColored(root: THREE.Object3D, skip?: (m: THREE.Mesh) => boolean): THREE.Mesh {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  let emissive = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (skip && skip(m))) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mat) || (mat as THREE.Material).blending === THREE.AdditiveBlending) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    // keep existing vertex colours (already-merged parts) tinted by the material colour
    const existing = (mat as THREE.MeshStandardMaterial).vertexColors ? (g.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'color' && existing)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const c = mat.color ?? new THREE.Color(1, 1, 1);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const er = existing ? existing.getX(i) : 1, eg = existing ? existing.getY(i) : 1, eb = existing ? existing.getZ(i) : 1;
      col[i * 3] = c.r * er;
      col[i * 3 + 1] = c.g * eg;
      col[i * 3 + 2] = c.b * eb;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (mat.metalness > 0.3) emissive = true;
    parts.push(g);
  });
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  const key = emissive ? 'metal' : 'plain';
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: emissive ? 0.25 : 0 });
    cache.set(key, mat);
  }
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Merge a node's direct static child meshes into one vertex-coloured mesh (keeps groups, so any
 * animation on the node itself still works). Meshes flagged userData.keep are left alone.
 */
export function mergeChildren(node: THREE.Object3D, material: THREE.Material, filter?: (m: THREE.Mesh) => boolean): THREE.Mesh | null {
  const meshes = node.children.filter((c) => {
    const m = c as THREE.Mesh;
    return (
      m.isMesh &&
      !(m as THREE.SkinnedMesh).isSkinnedMesh &&
      !m.userData.keep &&
      !Array.isArray(m.material) &&
      (m.material as THREE.Material).blending !== THREE.AdditiveBlending &&
      !(m.material as THREE.Material).transparent &&
      (!filter || filter(m))
    );
  }) as THREE.Mesh[];
  if (meshes.length < 2) return null;
  const parts: THREE.BufferGeometry[] = [];
  let cast = false;
  for (const m of meshes) {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m.matrix);
    const mm = m.material as THREE.MeshStandardMaterial;
    const c = (mm.color ?? new THREE.Color(1, 1, 1)).clone();
    if (mm.emissive && mm.emissiveIntensity > 0 && mm.emissive.getHex() !== 0) c.lerp(mm.emissive, 0.4).multiplyScalar(1.25);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
    cast = cast || m.castShadow;
    node.remove(m);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = cast;
  node.add(mesh);
  return mesh;
}

const sharedFlat = new Map<string, THREE.MeshStandardMaterial>();
export function flatMaterial(key = 'default', rough = 0.6) {
  let m = sharedFlat.get(key);
  if (!m) sharedFlat.set(key, (m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough })));
  return m;
}
