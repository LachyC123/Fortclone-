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
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const c = mat.color ?? new THREE.Color(1, 1, 1);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
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
