import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { PAL } from '../render/Palette';
import { mergeToVertexColored } from '../render/Merge';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const _v = new THREE.Vector3();

/**
 * The Sky Barge: a patched-together wooden airship under a quilted balloon. Everyone rides it
 * over the island and jumps when they like. Forward is local +X.
 */
export class SkyBarge {
  group = new THREE.Group();
  private hull = new THREE.Group();
  private balloon: THREE.Object3D;
  private props: THREE.Object3D[] = [];
  private flags: THREE.Object3D[] = [];
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  start = new THREE.Vector3();
  end = new THREE.Vector3();
  speed = 17;
  progress = 0;
  active = false;
  private t = 0;
  /** rider spots on deck (local space) */
  spots: THREE.Vector3[] = [];
  horn = false;

  constructor(scene: THREE.Scene) {
    const wood = toyMaterial(PAL.wood, { rough: 0.8 });
    const woodL = toyMaterial(PAL.woodLight, { rough: 0.8 });
    const woodD = toyMaterial(PAL.brownDark, { rough: 0.8 });
    const brass = toyMaterial(0xd9a441, { rough: 0.3, metal: 0.6 });
    const add = (p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      p.add(mesh);
      return mesh;
    };
    const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r);

    // hull: a fat boat with a keel, painted stripe and portholes
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-7, 0);
    hullShape.quadraticCurveTo(-7.4, -1.6, -5, -2.2);
    hullShape.lineTo(5, -2.2);
    hullShape.quadraticCurveTo(8.2, -1.8, 8.4, 0.6);
    hullShape.lineTo(-7, 0.6);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 5, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 3 });
    hullGeo.translate(0, 0, -2.5);
    add(this.hull, hullGeo, wood, 0, 0, 0);
    add(this.hull, rb(15.4, 0.35, 5.3, 0.12), toyMaterial(PAL.terracotta, { rough: 0.7 }), 0.5, -0.5, 0);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      add(this.hull, new THREE.TorusGeometry(0.28, 0.07, 6, 14), brass, -4.5 + i * 2.3, -1.1, s * 2.82, 0, 0, 0);
      add(this.hull, new THREE.CircleGeometry(0.24, 12), toyMaterial(0x9fdcf0, { rough: 0.1 }), -4.5 + i * 2.3, -1.1, s * 2.84, 0, s > 0 ? 0 : Math.PI, 0);
    }
    // deck planks
    for (let i = 0; i < 12; i++) add(this.hull, rb(14.6, 0.14, 0.42, 0.04), i % 2 ? woodL : wood, 0.3, 0.72, -2.3 + i * 0.42);
    // railings
    for (const s of [-1, 1]) {
      add(this.hull, rb(14.8, 0.12, 0.12, 0.04), woodD, 0.3, 1.8, s * 2.55);
      for (let i = 0; i < 9; i++) add(this.hull, new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), woodD, -6.5 + i * 1.75, 1.25, s * 2.55);
    }
    // captain's cabin at the stern
    add(this.hull, rb(2.6, 2.2, 3.6, 0.15), toyMaterial(PAL.cream, { rough: 0.7 }), -5.4, 1.9, 0);
    add(this.hull, new THREE.ConeGeometry(2.6, 1.2, 4), toyMaterial(PAL.roofRed, { rough: 0.7 }), -5.4, 3.6, 0, 0, Math.PI / 4, 0);
    add(this.hull, rb(0.9, 0.9, 0.08, 0.05), toyMaterial(0x9fdcf0, { rough: 0.1 }), -4.08, 2.1, 0, 0, Math.PI / 2, 0);
    // cargo
    const crateM = toyMaterial(PAL.woodLight, { rough: 0.8 });
    for (const [x, z, s] of [[4.5, 1.6, 0.9], [5.3, 1.5, 0.6], [4.6, -1.7, 0.8], [-2.6, 1.8, 0.7]]) add(this.hull, rb(s, s, s, 0.06), crateM, x, 0.8 + s / 2, z, 0, x, 0);
    add(this.hull, new THREE.CylinderGeometry(0.4, 0.4, 0.9, 12), toyMaterial(PAL.teal), 3.6, 1.25, -2.0);
    // Blinkbug figurehead on the bow
    add(this.hull, new THREE.SphereGeometry(0.55, 16, 12), toyMaterial(PAL.blink, { emissive: PAL.blink, emissiveIntensity: 0.4 } as never), 8.6, 0.9, 0);
    add(this.hull, new THREE.SphereGeometry(0.2, 10, 8), toyMaterial(0xffffff), 9.0, 1.05, 0.2);
    add(this.hull, new THREE.SphereGeometry(0.2, 10, 8), toyMaterial(0xffffff), 9.0, 1.05, -0.2);
    add(this.hull, new THREE.SphereGeometry(0.1, 8, 6), toyMaterial(PAL.ink), 9.16, 1.05, 0.2);
    add(this.hull, new THREE.SphereGeometry(0.1, 8, 6), toyMaterial(PAL.ink), 9.16, 1.05, -0.2);
    // mast + rigging
    add(this.hull, new THREE.CylinderGeometry(0.16, 0.2, 7, 8), woodD, 0.5, 4.2, 0);
    const merged = mergeToVertexColored(this.hull);
    merged.castShadow = true;
    this.hull.clear();
    this.hull.add(merged);
    this.group.add(this.hull);

    // quilted balloon: patches of colour on a squashed sphere
    const bal = new THREE.Group();
    const bg = new THREE.SphereGeometry(4.2, 28, 18);
    bg.scale(2.1, 1, 1);
    const colors = [PAL.mustard, PAL.terracotta, PAL.teal, PAL.cream, PAL.pink, PAL.lavender];
    const pos = bg.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = Math.floor((Math.atan2(z, y) + Math.PI) / (Math.PI / 4));
      const w = Math.floor((x + 9) / 3);
      c.setHex(colors[(u + w * 2) % colors.length]).convertSRGBToLinear();
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const balloon = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: false }));
    balloon.castShadow = true;
    bal.add(balloon);
    // stitched bands
    for (let i = -2; i <= 2; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(4.18 * Math.sqrt(1 - (i * 0.3) ** 2), 0.06, 6, 36), toyMaterial(PAL.brownDark));
      band.position.x = i * 2.6;
      band.rotation.y = Math.PI / 2;
      bal.add(band);
    }
    bal.position.set(0.5, 10.8, 0);
    this.group.add(bal);
    this.balloon = bal;
    // ropes from balloon to deck
    const ropeM = new THREE.MeshBasicMaterial({ color: 0x5e3b27 });
    for (const [x, z] of [[-5, 2.4], [-5, -2.4], [5.5, 2.4], [5.5, -2.4], [0.5, 2.5], [0.5, -2.5]]) {
      const a = new THREE.Vector3(x, 1.8, z), b = new THREE.Vector3(x * 0.8 + 0.1, 7.2, z * 0.55);
      const len = a.distanceTo(b);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 4), ropeM);
      r.position.copy(a).add(b).multiplyScalar(0.5);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.group.add(r);
    }
    // propellers
    for (const s of [-1, 1]) {
      const hub = new THREE.Group();
      hub.position.set(-7.6, 1.2, s * 2.2);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new RoundedBoxGeometry(0.12, 1.5, 0.35, 2, 0.05), toyMaterial(PAL.mustard));
        blade.position.y = 0.75;
        const arm = new THREE.Group();
        arm.rotation.x = (i / 3) * Math.PI * 2;
        arm.add(blade);
        hub.add(arm);
      }
      hub.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), brass));
      this.group.add(hub);
      this.props.push(hub);
    }
    // lanterns and pennants
    for (const [x, z] of [[7, 2.4], [7, -2.4], [-3, 2.4], [-3, -2.4]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
      l.position.set(x, 2.2, z);
      this.group.add(l);
    }
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), toyMaterial(i ? PAL.teal : PAL.pink));
      (f.material as THREE.Material).side = THREE.DoubleSide;
      f.geometry.translate(-0.8, 0, 0);
      f.position.set(0.5, 7.4 - i * 0.9, 0);
      this.group.add(f);
      this.flags.push(f);
    }
    // rider spots: a grid across the deck
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) this.spots.push(new THREE.Vector3(-3.2 + i * 1.3, 0.82, -1.6 + j * 1.6));
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Plan a straight route across the island passing near (not exactly through) the middle. */
  planRoute(islandR: number) {
    const a = Math.random() * Math.PI * 2;
    const off = (Math.random() - 0.5) * islandR * 0.6;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(off);
    const alt = 58;
    this.start.copy(dir).multiplyScalar(-islandR - 35).add(side).setY(alt);
    this.end.copy(dir).multiplyScalar(islandR + 35).add(side).setY(alt);
    this.pos.copy(this.start);
    this.yaw = Math.atan2(-dir.z, dir.x);
    this.vel.copy(dir).multiplyScalar(this.speed);
    this.progress = 0;
    this.active = true;
    this.group.visible = true;
  }

  get routeLength() {
    return this.start.distanceTo(this.end);
  }

  riderWorld(i: number, out: THREE.Vector3) {
    const s = this.spots[i % this.spots.length];
    return out.copy(s).applyMatrix4(this.group.matrixWorld);
  }

  update(dt: number) {
    this.t += dt;
    if (this.active) {
      this.pos.addScaledVector(this.vel, dt);
      this.progress = this.pos.distanceTo(this.start) / this.routeLength;
    }
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.t * 0.9) * 0.35;
    this.group.rotation.set(Math.sin(this.t * 0.7) * 0.03, this.yaw, Math.sin(this.t * 0.5) * 0.025);
    this.balloon.rotation.x = Math.sin(this.t * 0.8) * 0.02;
    for (const p of this.props) p.rotation.x += dt * 14;
    this.flags.forEach((f, i) => (f.rotation.y = Math.PI + Math.sin(this.t * 6 + i) * 0.25));
    this.group.updateMatrixWorld(true);
    void _v;
  }
}
