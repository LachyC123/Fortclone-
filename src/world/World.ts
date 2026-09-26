import * as THREE from 'three';
import { Batcher } from '../render/GeoKit';
import { CollisionWorld, ColFlags, OBB } from '../physics/Collision';
import { Kit } from './Kit';
import { foliageMaterial, worldMaterial, waterMaterial, shared } from '../render/Materials';
import { DoorSpec } from './BuildingKit';
import { PAL } from '../render/Palette';
import { audio } from '../audio/Audio';
import type { FX } from '../fx/FX';
import type { Actor } from '../entities/Actor';
import { PShape } from '../fx/Particles';
import { rand, Rng } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildVillageBlock } from './VillageBlock';
import { toyMaterial } from '../render/Materials';
import { mergeChildren, flatMaterial } from '../render/Merge';

export interface LootSpot {
  pos: THREE.Vector3;
  kind: 'weapon' | 'ammo';
  rarity: 0 | 1 | 2 | 3 | 4;
  secret?: boolean;
}

export interface Door {
  pivot: THREE.Group;
  collider: OBB;
  angle: number;
  vel: number;
  target: number;
  closeT: number;
  hinge: THREE.Vector3;
  yaw: number;
  w: number;
  open: boolean;
}

interface Swinger {
  obj: THREE.Object3D;
  angle: number;
  vel: number;
  axis: 'x' | 'z';
  tag: string;
  collider: OBB | null;
}

interface Kickable {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  r: number;
  spin: THREE.Vector3;
  color: number;
}

import { buildIsland } from './Island';
import { ISLAND_R, ISLAND_MAX } from './Heightmap';
import { detail } from '../render/Detail';

/** A named region used for indoor reverb, minimap labels and (later) POI logic. */
export interface Zone {
  name: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  indoor: boolean;
}

/**
 * Owns all static geometry, collision and the living world: doors, a windmill, swinging signs,
 * a bell you can ring with bullets, tumbling props, chimney smoke, birds and butterflies.
 */
export class World {
  cw = new CollisionWorld();
  group = new THREE.Group();
  doors: Door[] = [];
  private swingers: Swinger[] = [];
  private kickables: Kickable[] = [];
  private spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
  private smokeSources: THREE.Vector3[] = [];
  private waterfalls: { pos: THREE.Vector3; w: number }[] = [];
  private flyers: { mesh: THREE.Object3D; center: THREE.Vector3; r: number; speed: number; phase: number; h: number; kind: 'bird' | 'butterfly'; wing: THREE.Object3D[] }[] = [];
  private clouds: THREE.InstancedMesh | null = null;
  private cloudData: { x: number; y: number; z: number; s: number; v: number }[] = [];
  zones: Zone[] = [];
  lootSpots: LootSpot[] = [];
  crateSpots: { pos: THREE.Vector3; yaw: number }[] = [];
  nests: { pos: THREE.Vector3; used: boolean; fx: THREE.Object3D }[] = [];
  /** Launch Isle (pre-match lobby) */
  lobby = { center: new THREE.Vector3(0, 40, -205), radius: 16, bargeDock: new THREE.Vector3(20, 42, -205) };
  playerSpawns: { pos: THREE.Vector3; yaw: number }[] = [];
  botSpawns: THREE.Vector3[] = [];
  islandRadius = ISLAND_R;
  mapBounds = ISLAND_MAX + 4;
  signs: THREE.Object3D[] = [];
  private birdTimer = 2;
  private cullT = 0;
  private detailChunks: THREE.Mesh[] = [];
  private interiorChunks: THREE.Mesh[] = [];
  private smallChunks: THREE.Mesh[] = [];
  /** small outdoor props are drawn out to this distance (set from the quality preset) */
  smallDist = 90;

  /** small props and furniture only cast shadows on the top tier (saves a shadow draw each) */
  setPropShadows(on: boolean) {
    for (const m of this.smallChunks) m.castShadow = on;
    for (const m of this.interiorChunks) m.castShadow = on;
  }
  private bigChunks: THREE.Mesh[] = [];
  /** chunks further than this (plus their radius) are skipped; set from the quality preset */
  drawDist = 400;
  private t = 0;
  bellPos = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private fx: FX) {
    const solid = new Batcher();
    const foliage = new Batcher();
    const nocast = new Batcher();
    const glow = new Batcher();
    const detail = new Batcher();
    const interior = new Batcher();
    const small = new Batcher();
    const k = new Kit(solid, foliage, nocast, glow, this.cw);
    k.detail = detail;
    k.interior = interior;
    k.small = small;
    const doorSpecs: DoorSpec[] = [];

    const T = location.search.includes('timing');
    let t0 = performance.now();
    const lap = (label: string) => {
      if (!T) return;
      const t = performance.now();
      console.log(`[t]   ${label} ${(t - t0).toFixed(0)}ms`);
      t0 = t;
    };
    buildVillageBlock(k, this, doorSpecs);
    lap('village+terrain');
    buildIsland(k, this, doorSpecs);
    lap('island');

    const wm = worldMaterial();
    const fm = foliageMaterial();
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    // big island: larger chunks keep the draw-call count sane when you can see everything
    for (const m of [...solid.buildChunked(wm, 40), ...foliage.buildChunked(fm, 40)]) {
      m.geometry.computeBoundingSphere();
      this.bigChunks.push(m);
      this.group.add(m);
    }
    for (const m of nocast.buildChunked(wm, 56, false, true)) this.group.add(m);
    for (const m of detail.buildChunked(fm, 20, false, true)) {
      m.geometry.computeBoundingSphere();
      this.detailChunks.push(m);
      this.group.add(m);
    }
    for (const m of glow.buildChunked(gm, 72, false, false)) this.group.add(m);
    for (const m of small.buildChunked(wm, 28, true, true)) {
      m.geometry.computeBoundingSphere();
      this.smallChunks.push(m);
      this.group.add(m);
    }
    for (const m of interior.buildChunked(wm, 18, true, true)) {
      m.geometry.computeBoundingSphere();
      this.interiorChunks.push(m);
      this.group.add(m);
    }
    lap('merge');
    for (const d of doorSpecs) this.makeDoor(d);
    this.signs = this.group.children.filter((c) => c.userData.sign);
    lap('doors');
    this.settleLoot();
    lap('settleLoot');
    this.scene.add(this.group);
    this.makeClouds();
  }

  /** Nudge any loot spot that ended up inside furniture/rock (or floating) to the nearest clear spot. */
  private settleLoot() {
    const up = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), q = new THREE.Vector3();
    const ok = (p: THREE.Vector3) => {
      const hit = this.cw.raycast(up.set(p.x, p.y + 0.8, p.z), down, 2.2, ColFlags.BlocksMove);
      if (!hit) return false;
      p.y = hit.point.y + 0.05;
      return !this.cw.sphereOverlaps(q.set(p.x, p.y + 0.5, p.z), 0.28, ColFlags.BlocksMove);
    };
    this.lootSpots = this.lootSpots.filter((s) => {
      const t = s.pos.clone();
      if (ok(t)) {
        s.pos.copy(t);
        return true;
      }
      for (let r = 0.5; r <= 3; r += 0.5)
        for (let a = 0; a < 8; a++) {
          t.set(s.pos.x + Math.cos((a / 8) * Math.PI * 2) * r, s.pos.y, s.pos.z + Math.sin((a / 8) * Math.PI * 2) * r);
          if (ok(t)) {
            s.pos.copy(t);
            return true;
          }
        }
      return false;
    });
  }

  /* ------------------------------------------------------------ builders called by the layout */

  addWater(x: number, y: number, z: number, w: number, d: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), waterMaterial());
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.group.add(m);
    // water collider: doesn't block movement, just changes footstep surface
    const c = this.cw.box(x, y - 0.3, z, w, 0.6, d, 'water', 0, 0, 0, ColFlags.BlocksBullets);
    c.tag = 'water';
  }

  addWaterfall(x: number, y: number, z: number, w: number) {
    this.waterfalls.push({ pos: new THREE.Vector3(x, y, z), w });
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 14),
      new THREE.MeshBasicMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.set(x, y - 7, z);
    m.userData.fall = true;
    this.group.add(m);
    return m;
  }

  addSpinner(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', speed: number) {
    this.group.add(obj);
    this.spinners.push({ obj, axis, speed });
  }

  addSwinger(obj: THREE.Object3D, axis: 'x' | 'z', tag: string, collider: OBB | null) {
    this.group.add(obj);
    this.swingers.push({ obj, angle: 0, vel: 0, axis, tag, collider });
    if (collider) collider.userData = this.swingers[this.swingers.length - 1];
  }

  addSmoke(p: THREE.Vector3) {
    this.smokeSources.push(p.clone());
  }

  addKickable(x: number, y: number, z: number, kind: 'pumpkin' | 'bucket' | 'box' | 'bottle') {
    let geo: THREE.BufferGeometry;
    let color: number;
    let r: number;
    switch (kind) {
      case 'pumpkin':
        geo = new THREE.SphereGeometry(0.32, 12, 8);
        geo.scale(1.15, 0.85, 1.15);
        color = 0xf28a2e;
        r = 0.3;
        break;
      case 'bucket':
        geo = new THREE.CylinderGeometry(0.22, 0.17, 0.36, 10);
        color = 0x7fb7e6;
        r = 0.22;
        break;
      case 'bottle':
        geo = new THREE.CylinderGeometry(0.06, 0.09, 0.32, 8);
        color = 0x5fe067;
        r = 0.1;
        break;
      default:
        geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        color = PAL.woodLight;
        r = 0.22;
    }
    const mesh = new THREE.Mesh(geo, toyMaterial(color, { rough: kind === 'bottle' ? 0.2 : 0.6 }));
    mesh.castShadow = true;
    mesh.position.set(x, y + r, z);
    this.group.add(mesh);
    this.kickables.push({ mesh, pos: mesh.position.clone(), vel: new THREE.Vector3(), r, spin: new THREE.Vector3(), color });
  }

  addFlyer(kind: 'bird' | 'butterfly', center: THREE.Vector3, r: number, h: number) {
    const g = new THREE.Group();
    const wings: THREE.Object3D[] = [];
    if (kind === 'butterfly') {
      const col = [PAL.pink, PAL.mustard, PAL.lavender, 0xffffff, PAL.softBlue][Math.floor(Math.random() * 5)];
      const wm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.09, 6), wm);
        w.geometry.translate(s * 0.09, 0, 0);
        g.add(w);
        wings.push(w);
      }
    } else {
      const bm = toyMaterial(0x3b3345);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), bm);
      body.scale.set(0.8, 0.8, 1.6);
      g.add(body);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.14), bm);
        w.geometry.translate(s * 0.2, 0, 0);
        g.add(w);
        wings.push(w);
      }
    }
    this.group.add(g);
    this.flyers.push({ mesh: g, center: center.clone(), r, speed: kind === 'bird' ? rand(0.3, 0.5) : rand(0.4, 0.9), phase: rand(0, 6.28), h, kind, wing: wings });
  }

  addZone(name: string, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, indoor: boolean) {
    this.zones.push({ name, min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), indoor });
  }

  zoneAt(p: THREE.Vector3): Zone | null {
    for (const z of this.zones) if (p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z) return z;
    return null;
  }

  private makeDoor(d: DoorSpec) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.y, d.z);
    pivot.rotation.y = d.yaw;
    const mat = toyMaterial(d.color === PAL.cream ? PAL.teal : d.color, { rough: 0.7 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(d.w - 0.04, d.h - 0.04, 0.09), mat);
    panel.position.set(d.w / 2, d.h / 2, 0);
    panel.castShadow = true;
    pivot.add(panel);
    const plankMat = toyMaterial(0x000000, { rough: 0.8 });
    for (let i = 1; i < 3; i++) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.02, d.h - 0.2, 0.1), plankMat);
      pl.position.set((d.w * i) / 3, d.h / 2, 0);
      pivot.add(pl);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toyMaterial(PAL.mustard, { metal: 0.5, rough: 0.3 }));
    knob.position.set(d.w - 0.15, 1.0, 0.07);
    const knob2 = knob.clone();
    knob2.position.z = -0.07;
    pivot.add(knob, knob2);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    win.position.set(d.w / 2, d.h * 0.75, 0.05);
    const win2 = win.clone();
    win2.position.z = -0.05;
    win2.rotation.y = Math.PI;
    pivot.add(win, win2);
    mergeChildren(pivot, flatMaterial('door', 0.7));
    this.group.add(pivot);
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const cx = d.x + (d.w / 2) * c, cz = d.z - (d.w / 2) * s;
    const col = this.cw.box(cx, d.y + d.h / 2, cz, d.w, d.h, 0.12, 'wood', d.yaw);
    col.tag = 'door';
    this.doors.push({ pivot, collider: col, angle: 0, vel: 0, target: 0, closeT: 0, hinge: new THREE.Vector3(d.x, d.y, d.z), yaw: d.yaw, w: d.w, open: false });
  }

  private makeClouds() {
    // each cloud = a cluster of soft puffs merged into one geometry, instanced around the island
    const puffs: THREE.BufferGeometry[] = [];
    const cr = new Rng(5);
    for (let i = 0; i < 7; i++) {
      const s = i === 0 ? 1 : cr.range(0.45, 0.8);
      const p = new THREE.IcosahedronGeometry(s, 2);
      p.translate(i === 0 ? 0 : cr.range(-1.2, 1.2), i === 0 ? 0 : cr.range(-0.1, 0.35), i === 0 ? 0 : cr.range(-0.5, 0.5));
      puffs.push(p);
    }
    const g = mergeGeometries(puffs, false)!;
    g.scale(1, 0.7, 1);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffe8f0, emissiveIntensity: 0.55 });
    const n = 40;
    this.clouds = new THREE.InstancedMesh(g, m, n);
    this.clouds.castShadow = false;
    this.clouds.receiveShadow = false;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(70, 240);
      const low = Math.random() < 0.55;
      this.cloudData.push({ x: Math.cos(a) * r, y: low ? rand(-45, -15) : rand(25, 70), z: Math.sin(a) * r, s: rand(5, 14), v: rand(0.4, 1.2) });
    }
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
  }

  /* ------------------------------------------------------------ interactions */

  /** Bullets make the world react: bells ring, signs swing, doors rattle, props tumble. */
  onBulletHit(c: OBB, p: THREE.Vector3, dir: THREE.Vector3) {
    const sw = c.userData as Swinger | null;
    if (sw && (sw as Swinger).obj) {
      sw.vel += (sw.axis === 'x' ? dir.z : -dir.x) * (sw.tag === 'bell' ? 2.5 : 4);
      if (sw.tag === 'bell') {
        audio.bell(this.bellPos);
        this.fx.ring(this.bellPos, 0xfff0a0, 0.5, 6, 0.8, undefined, true);
      }
    }
    if (c.tag === 'door') {
      const d = this.doors.find((dd) => dd.collider === c);
      if (d) d.vel += 3;
    }
    for (const kk of this.kickables) {
      if (kk.pos.distanceToSquared(p) < (kk.r + 0.2) ** 2) {
        kk.vel.addScaledVector(dir, 5).y += 3;
        kk.spin.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
        audio.pop(kk.pos);
      }
    }
  }

  /** Radial shove for explosions and gusts: props tumble away. */
  pushProps(p: THREE.Vector3, R: number, force: number) {
    for (const kk of this.kickables) {
      const d = kk.pos.clone().sub(p);
      const dist = d.length();
      if (dist > R) continue;
      d.normalize();
      const k = 1 - dist / R;
      kk.vel.addScaledVector(d, force * k).y += force * 0.6 * k;
      kk.spin.set(rand(-14, 14), rand(-14, 14), rand(-14, 14));
    }
    for (const d of this.doors) if (d.hinge.distanceTo(p) < R) d.vel -= 6;
    for (const s of this.swingers) if (s.obj.position.distanceTo(p) < R + 2) s.vel += (Math.random() - 0.5) * 4;
  }

  /** Direct hit on a kickable prop (bullets test these separately; cheap sphere check). */
  kickableRay(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    let best = -1;
    for (const kk of this.kickables) {
      const ox = o.x - kk.pos.x, oy = o.y - kk.pos.y, oz = o.z - kk.pos.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - kk.r * kk.r;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < maxT && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  update(dt: number, actors: Actor[], camPos: THREE.Vector3) {
    this.t += dt;
    shared.time.value = this.t;

    // distance culling for the small separate meshes (a few per frame is plenty)
    this.cullT -= dt;
    if (this.cullT <= 0) {
      this.cullT = 0.25;
      const far = (o: THREE.Object3D, d: number) => (o.visible = o.position.distanceToSquared(camPos) < d * d);
      const cf = detail.cull;
      for (const f of this.flyers) if (f.kind === 'butterfly') far(f.mesh, 45 * cf);
      for (const kk of this.kickables) far(kk.mesh, 55 * cf);
      for (const s of this.signs) far(s, 85 * cf);
      // swinging doors and Rift Nest sparkles are separate meshes: only draw the nearby ones
      const dd = 62 * cf;
      for (const d of this.doors) d.pivot.visible = d.hinge.distanceToSquared(camPos) < dd * dd;
      for (const n of this.nests) far(n.fx, 130);
      for (const m of this.detailChunks) m.visible = m.geometry.boundingSphere!.center.distanceToSquared(camPos) < 62 * 62;
      for (const m of this.smallChunks) {
        const bs = m.geometry.boundingSphere!;
        const d = Math.min(this.drawDist, this.smallDist) + bs.radius;
        m.visible = bs.center.distanceToSquared(camPos) < d * d;
      }
      for (const m of this.interiorChunks) {
        const bs = m.geometry.boundingSphere!;
        const d = Math.min(this.drawDist, 46) + bs.radius;
        m.visible = bs.center.distanceToSquared(camPos) < d * d;
      }
      for (const m of this.bigChunks) {
        const bs = m.geometry.boundingSphere!;
        const d = this.drawDist + bs.radius;
        m.visible = bs.center.distanceToSquared(camPos) < d * d;
      }
    }

    // doors auto-open for anyone approaching, close when clear
    for (const d of this.doors) {
      let near = false;
      for (const a of actors) {
        if (!a.alive) continue;
        const dx = a.motor.pos.x - (d.hinge.x + Math.cos(d.yaw) * d.w * 0.5), dz = a.motor.pos.z - (d.hinge.z - Math.sin(d.yaw) * d.w * 0.5);
        if (dx * dx + dz * dz < 2.2 * 2.2 && Math.abs(a.motor.pos.y - d.hinge.y) < 2) {
          near = true;
          break;
        }
      }
      if (near) {
        d.closeT = 1.6;
        if (!d.open) {
          d.open = true;
          d.target = -1.75;
          audio.door(d.hinge, true);
        }
      } else if (d.open) {
        d.closeT -= dt;
        if (d.closeT <= 0) {
          d.open = false;
          d.target = 0;
        }
      }
      const prev = d.angle;
      d.vel += ((d.target - d.angle) * 60 - d.vel * 9) * dt;
      d.angle += d.vel * dt;
      if (!d.open && prev < -0.05 && d.angle >= -0.05 && d.vel > 1) audio.door(d.hinge, false);
      d.pivot.rotation.y = d.yaw + d.angle;
      d.collider.enabled = d.angle > -0.35;
    }

    for (const s of this.spinners) s.obj.rotation[s.axis] += s.speed * dt;

    for (const s of this.swingers) {
      s.vel += (-s.angle * (s.tag === 'bell' ? 18 : 30) - s.vel * (s.tag === 'bell' ? 0.6 : 2)) * dt;
      s.angle += s.vel * dt;
      // gentle idle breeze
      const breeze = Math.sin(this.t * 1.3 + s.obj.position.x) * 0.03;
      if (s.axis === 'x') s.obj.rotation.x = s.angle + breeze;
      else s.obj.rotation.z = s.angle + breeze;
    }

    // kickable props get bumped by rascals
    const _n = new THREE.Vector3();
    for (const kk of this.kickables) {
      for (const a of actors) {
        if (!a.alive) continue;
        const dx = kk.pos.x - a.motor.pos.x, dz = kk.pos.z - a.motor.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < kk.r + 0.4 && kk.pos.y < a.motor.pos.y + 1.2) {
          const sp = a.motor.horizontalSpeed();
          const push = 1.5 + sp * 0.9;
          kk.vel.x += (dx / (dist || 1)) * push;
          kk.vel.z += (dz / (dist || 1)) * push;
          kk.vel.y += 1.5 + sp * 0.2;
          kk.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
          audio.thud(kk.pos, 0.3);
        }
      }
      if (kk.vel.lengthSq() > 0.001 || kk.pos.y > kk.r + 0.01) {
        kk.vel.y -= 20 * dt;
        kk.pos.addScaledVector(kk.vel, dt);
        let ground = false;
        this.cw.resolveSphere(kk.pos, kk.r, ColFlags.BlocksMove, (n) => {
          _n.copy(n);
          const vn = kk.vel.dot(n);
          if (vn < 0) kk.vel.addScaledVector(n, -vn * 1.35);
          if (n.y > 0.6) ground = true;
        }, 2);
        if (ground) {
          kk.vel.x *= Math.exp(-4 * dt);
          kk.vel.z *= Math.exp(-4 * dt);
          kk.spin.multiplyScalar(Math.exp(-5 * dt));
          if (Math.abs(kk.vel.y) < 0.5) kk.vel.y = 0;
        }
        if (kk.pos.y < -20) kk.vel.set(0, 0, 0);
        kk.mesh.position.copy(kk.pos);
        kk.mesh.rotation.x += kk.spin.x * dt;
        kk.mesh.rotation.y += kk.spin.y * dt;
        kk.mesh.rotation.z += kk.spin.z * dt;
      }
    }

    // chimney smoke
    for (const s of this.smokeSources) {
      if (Math.random() < dt * 5) this.fx.soft.emit(s, { count: 1, color: [0xf2eee8, 0xe0dad2], speed: [0.2, 0.5], spread: 0.3, dir: new THREE.Vector3(0.3, 1, 0.1), up: 1.2, life: [2.5, 4], size: [0.4, 0.7], sizeEnd: 4, alpha: 0.5, drag: 0.4, jitter: 0.15 });
    }
    // waterfalls
    for (const w of this.waterfalls) {
      if (camPos.distanceToSquared(w.pos) > 90 * 90) continue;
      if (Math.random() < dt * 20) this.fx.soft.emit(new THREE.Vector3(w.pos.x + rand(-w.w / 2, w.w / 2), w.pos.y, w.pos.z), { count: 1, color: [0xffffff, 0xbff3ff], speed: [0.5, 1.5], spread: 0.5, dir: new THREE.Vector3(0, -1, 0), gravity: 10, life: [1, 1.6], size: [0.3, 0.6], sizeEnd: 2.5, alpha: 0.6, drag: 0.3 });
    }
    this.group.children.forEach((c) => {
      if (c.userData.fall) {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = 0.45 + Math.sin(this.t * 7 + c.position.x) * 0.08;
      }
    });

    // birds & butterflies
    for (const f of this.flyers) {
      f.phase += f.speed * dt;
      const x = f.center.x + Math.cos(f.phase) * f.r;
      const z = f.center.z + Math.sin(f.phase * (f.kind === 'butterfly' ? 1.7 : 1)) * f.r;
      const y = f.center.y + f.h + Math.sin(f.phase * 3) * (f.kind === 'butterfly' ? 0.4 : 1.5);
      const dx = x - f.mesh.position.x, dz = z - f.mesh.position.z;
      f.mesh.position.set(x, y, z);
      f.mesh.rotation.y = Math.atan2(dx, dz);
      const flap = Math.sin(this.t * (f.kind === 'butterfly' ? 22 : 10) + f.phase * 10);
      f.wing[0].rotation.z = flap * (f.kind === 'butterfly' ? 1.1 : 0.6);
      f.wing[1].rotation.z = -flap * (f.kind === 'butterfly' ? 1.1 : 0.6);
    }
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(2.5, 7);
      const b = this.flyers.filter((f) => f.kind === 'bird');
      if (b.length) audio.bird(b[Math.floor(Math.random() * b.length)].mesh.position);
      else audio.bird(new THREE.Vector3(camPos.x + rand(-30, 30), 8, camPos.z + rand(-30, 30)));
    }

    // floating pollen around the camera for constant gentle motion
    if (Math.random() < dt * 7) {
      this.fx.glow.emit(new THREE.Vector3(camPos.x + rand(-14, 14), camPos.y + rand(-2, 5), camPos.z + rand(-14, 14)), { count: 1, color: [0xfff6c8, 0xffffff, 0xd8ffb0], speed: 0.25, life: [3, 5], size: [0.04, 0.07], alpha: 0.8, drag: 0.1, shape: PShape.Soft });
    }

    // drifting clouds
    if (this.clouds) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      for (let i = 0; i < this.cloudData.length; i++) {
        const c = this.cloudData[i];
        c.x += c.v * dt;
        if (c.x > 260) c.x = -260;
        m.compose(p.set(c.x, c.y, c.z), q, s.set(c.s * 1.3, c.s * 0.8, c.s));
        this.clouds.setMatrixAt(i, m);
      }
      this.clouds.instanceMatrix.needsUpdate = true;
    }
  }
}
