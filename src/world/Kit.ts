import * as THREE from 'three';
import { Batcher, ShapeOpts, boxGeo } from '../render/GeoKit';
import { CollisionWorld, ColFlags, OBB, Surface } from '../physics/Collision';
import { detail } from '../render/Detail';

export interface PartOpts {
  /** corner radius for rounded boxes */
  r?: number;
  /** collider surface; null = visual only */
  col?: Surface | null;
  flags?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** which batch: world solids or wind-swayed foliage */
  batch?: 'solid' | 'foliage' | 'nocast' | 'glow' | 'detail';
  ao?: number;
  top?: number;
  noise?: number;
  wind?: number;
  segs?: number;
}

/** fewer segments on round props in lite mode (never below 3, never above the cap) */
const lite = (segs: number, cap: number) => (detail.lite ? Math.max(3, Math.min(segs, segs >= 14 ? cap + 4 : cap)) : segs);

/**
 * Level-building toolkit with a transform stack (translation + yaw). Every visual part can
 * optionally emit an exact collider so art and collision never drift apart.
 */
export class Kit {
  private stack: { x: number; y: number; z: number; yaw: number }[] = [];
  ox = 0;
  oy = 0;
  oz = 0;
  oyaw = 0;

  /** small ground clutter (grass, flowers): no shadows, hidden at distance */
  detail: Batcher | null = null;
  /** furniture & fittings inside buildings: only drawn when you're close */
  interior: Batcher | null = null;
  /** small solid props outdoors (crates, posts, bottles, chairs): drawn at mid range */
  small: Batcher | null = null;
  private insideDepth = 0;

  /** everything solid drawn between beginInterior/endInterior goes to the interior batch */
  beginInterior() {
    this.insideDepth++;
  }
  endInterior() {
    this.insideDepth = Math.max(0, this.insideDepth - 1);
  }

  constructor(public solid: Batcher, public foliage: Batcher, public nocast: Batcher, public glow: Batcher, public cw: CollisionWorld) {}

  push(x: number, y: number, z: number, yaw = 0) {
    this.stack.push({ x: this.ox, y: this.oy, z: this.oz, yaw: this.oyaw });
    const [wx, wy, wz] = this.w(x, y, z);
    this.ox = wx;
    this.oy = wy;
    this.oz = wz;
    this.oyaw += yaw;
    return this;
  }

  pop() {
    const s = this.stack.pop()!;
    this.ox = s.x;
    this.oy = s.y;
    this.oz = s.z;
    this.oyaw = s.yaw;
    return this;
  }

  /** local -> world */
  w(lx: number, ly: number, lz: number): [number, number, number] {
    const c = Math.cos(this.oyaw), s = Math.sin(this.oyaw);
    return [this.ox + lx * c + lz * s, this.oy + ly, this.oz - lx * s + lz * c];
  }

  /** size = the part's biggest dimension; small solid parts get their own mid-range batch */
  private batch(o: PartOpts, size = 99) {
    if (size < 0.6 && o.batch === 'foliage' && this.detail) return this.detail;
    if (size < 1.1 && this.small && this.insideDepth === 0 && (o.batch === undefined || o.batch === 'solid')) return this.small;
    if (this.insideDepth > 0 && this.interior && (o.batch === undefined || o.batch === 'solid' || o.batch === 'nocast')) return this.interior;
    return o.batch === 'foliage' ? this.foliage : o.batch === 'detail' ? (this.detail ?? this.foliage) : o.batch === 'nocast' ? this.nocast : o.batch === 'glow' ? this.glow : this.solid;
  }

  private shape(color: number, o: PartOpts): ShapeOpts {
    const s: ShapeOpts = { color, ao: o.ao, topLight: o.top, noise: o.noise };
    if (o.batch === 'glow') {
      s.ao = 0;
      s.topLight = 0;
      s.noise = 0;
    }
    if (o.batch === 'foliage' || o.batch === 'detail') s.wind = o.wind ?? 0;
    return s;
  }

  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, o: PartOpts = {}): OBB | null {
    const [x, y, z] = this.w(lx, ly, lz);
    const yaw = this.oyaw + (o.yaw ?? 0);
    this.batch(o, Math.max(sx, sy, sz)).add(boxGeo(sx, sy, sz, detail.lite ? 0 : o.r ?? 0, o.segs ?? 1), this.shape(color, o), x, y, z, o.pitch ?? 0, yaw, o.roll ?? 0);
    if (o.col) {
      const c = this.cw.box(x, y, z, sx, sy, sz, o.col, yaw, o.pitch ?? 0, o.roll ?? 0, o.flags ?? ColFlags.Solid);
      return c;
    }
    return null;
  }

  /** Collider only (invisible), e.g. ramps under visual stairs. */
  collider(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, surface: Surface, o: PartOpts = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    return this.cw.box(x, y, z, sx, sy, sz, surface, this.oyaw + (o.yaw ?? 0), o.pitch ?? 0, o.roll ?? 0, o.flags ?? ColFlags.Solid);
  }

  cyl(lx: number, ly: number, lz: number, rTop: number, rBot: number, h: number, color: number, o: PartOpts = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    const yaw = this.oyaw + (o.yaw ?? 0);
    this.batch(o, Math.max(rTop * 2, rBot * 2, h)).add(new THREE.CylinderGeometry(rTop, rBot, h, lite(o.segs ?? 10, 6)), this.shape(color, o), x, y, z, o.pitch ?? 0, yaw, o.roll ?? 0);
    if (o.col) {
      const r = Math.max(rTop, rBot);
      // cylinders collide as their inscribed-ish box (0.85r) which feels right for posts/barrels
      if (o.pitch || o.roll) this.cw.box(x, y, z, r * 1.8, h, r * 1.8, o.col, yaw, o.pitch ?? 0, o.roll ?? 0, o.flags ?? ColFlags.Solid);
      else {
        this.cw.box(x, y, z, r * 1.75, h, r * 1.75, o.col, yaw + Math.PI / 4, 0, 0, o.flags ?? ColFlags.Solid);
        this.cw.box(x, y, z, r * 1.75, h, r * 1.75, o.col, yaw, 0, 0, o.flags ?? ColFlags.Solid);
      }
    }
  }

  sphere(lx: number, ly: number, lz: number, r: number, color: number, o: PartOpts & { sx?: number; sy?: number; sz?: number } = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
    const sg = lite(o.segs ?? 10, 7);
    this.batch(o, 2 * r * Math.max(sx, sy, sz)).add(new THREE.SphereGeometry(r, sg, Math.max(5, Math.round(sg * 0.75))), this.shape(color, o), x, y, z, 0, this.oyaw + (o.yaw ?? 0), 0, sx, sy, sz);
    if (o.col) this.cw.box(x, y, z, r * 1.6 * sx, r * 1.6 * sy, r * 1.6 * sz, o.col, this.oyaw, 0, 0, o.flags ?? ColFlags.Solid);
  }

  ico(lx: number, ly: number, lz: number, r: number, color: number, o: PartOpts & { sx?: number; sy?: number; sz?: number; detail?: number } = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    this.batch(o, 2 * r * Math.max(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)).add(new THREE.IcosahedronGeometry(r, detail.lite ? 0 : o.detail ?? 1), this.shape(color, o), x, y, z, o.pitch ?? 0, this.oyaw + (o.yaw ?? 0), 0, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    if (o.col) this.cw.box(x, y, z, r * 1.5 * (o.sx ?? 1), r * 1.5 * (o.sy ?? 1), r * 1.5 * (o.sz ?? 1), o.col, this.oyaw, 0, 0, o.flags ?? ColFlags.Solid);
  }

  cone(lx: number, ly: number, lz: number, r: number, h: number, color: number, o: PartOpts = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    this.batch(o, Math.max(2 * r, h)).add(new THREE.ConeGeometry(r, h, lite(o.segs ?? 8, 6)), this.shape(color, o), x, y, z, o.pitch ?? 0, this.oyaw + (o.yaw ?? 0), o.roll ?? 0);
  }

  torus(lx: number, ly: number, lz: number, r: number, tube: number, color: number, o: PartOpts = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    this.batch(o, 2 * r).add(new THREE.TorusGeometry(r, tube, detail.lite ? 4 : 6, detail.lite ? 10 : 16), this.shape(color, o), x, y, z, o.pitch ?? 0, this.oyaw + (o.yaw ?? 0), o.roll ?? 0);
  }

  /** Triangular prism (gable ends, wedges). Width along local X, apex at +height, depth along Z. */
  prism(lx: number, ly: number, lz: number, width: number, height: number, depth: number, color: number, o: PartOpts = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, height);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    this.batch(o).add(g, this.shape(color, o), x, y, z, o.pitch ?? 0, this.oyaw + (o.yaw ?? 0), 0);
  }

  /** Arbitrary custom geometry already in local space */
  geo(g: THREE.BufferGeometry, lx: number, ly: number, lz: number, color: number, o: PartOpts & { sx?: number; sy?: number; sz?: number } = {}) {
    const [x, y, z] = this.w(lx, ly, lz);
    this.batch(o).add(g, this.shape(color, o), x, y, z, o.pitch ?? 0, this.oyaw + (o.yaw ?? 0), o.roll ?? 0, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  }

  worldYaw(localYaw = 0) {
    return this.oyaw + localYaw;
  }
}
