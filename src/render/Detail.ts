import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Geometry detail knobs, chosen once at start-up from the quality preset (phones build lighter
 * characters and a lighter world). `G.*` mirror the three.js constructors but scale their segment
 * counts, so model code reads the same at every tier.
 */
export const detail = {
  /** segment multiplier for characters, bugs, weapons and pickups (1 = full) */
  model: 1,
  /** world: plain boxes instead of rounded ones, fewer segments on round props */
  lite: false,
  /** distance multiplier for culling loose objects (pickups, crates, doors, signs, props) */
  cull: 1,
};

const s = (n: number, min: number) => Math.max(min, Math.round(n * detail.model));

export const G = {
  sphere: (r?: number, w = 32, h = 16, phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number) =>
    new THREE.SphereGeometry(r, s(w, 6), s(h, 4), phiStart, phiLength, thetaStart, thetaLength),
  capsule: (r?: number, len?: number, capSeg = 4, radial = 8) => new THREE.CapsuleGeometry(r, len, s(capSeg, 2), s(radial, 5)),
  torus: (r?: number, tube?: number, radial = 12, tubular = 48, arc?: number) => new THREE.TorusGeometry(r, tube, s(radial, 3), s(tubular, 6), arc),
  cylinder: (rt?: number, rb?: number, h?: number, radial = 32, hs = 1, open?: boolean, ts?: number, tl?: number) =>
    new THREE.CylinderGeometry(rt, rb, h, s(radial, 5), hs, open, ts, tl),
  cone: (r?: number, h?: number, radial = 32, hs = 1, open?: boolean, ts?: number, tl?: number) => new THREE.ConeGeometry(r, h, s(radial, 4), hs, open, ts, tl),
  ico: (r?: number, d = 0) => new THREE.IcosahedronGeometry(r, detail.model < 0.75 ? Math.max(0, d - 1) : d),
  rbox: (w?: number, h?: number, d?: number, segs = 2, r?: number) => new RoundedBoxGeometry(w, h, d, s(segs, 1), r),
  lathe: (pts: THREE.Vector2[], segs = 12) => new THREE.LatheGeometry(pts, s(segs, 6)),
  tube: (curve: THREE.Curve<THREE.Vector3>, segs = 64, r = 1, radial = 8, closed = false) => new THREE.TubeGeometry(curve, s(segs, 4), r, s(radial, 4), closed),
};
