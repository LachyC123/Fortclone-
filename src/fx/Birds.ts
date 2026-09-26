import * as THREE from 'three';
import { CollisionWorld, ColFlags, RayHit } from '../physics/Collision';
import { ground } from '../world/Heightmap';
import { rand } from '../core/math';
import { audio } from '../audio/Audio';
import type { FX } from './FX';
import type { Actor } from '../entities/Actor';
import type { SoundEvent } from '../core/types';
import { PShape } from './Particles';

interface Bird {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  phase: number;
  hopT: number;
  hopY: number;
}

interface Flock {
  home: THREE.Vector3;
  birds: Bird[];
  state: 'ground' | 'fly' | 'gone';
  t: number;
  color: THREE.Color;
}

const MAX_BIRDS = 72;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit: RayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const COLORS = [0xf4f0e8, 0x5a4a6a, 0xd97a4a, 0x6aa0d8, 0x3a3440];

/**
 * Little flocks pecking about in the open. Run past or fire a gun nearby and they explode into
 * the air in a flurry of feathers — pretty, and a readable tell that someone is close.
 */
export class Birds {
  private mesh: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  private checkT = 0;

  constructor(scene: THREE.Scene, private cw: CollisionWorld, private fx: FX) {
    // a chunky paper-plane bird: body wedge plus two wings (flapped by squashing the instance)
    const g = new THREE.BufferGeometry();
    const v = [
      // body
      0, 0.05, -0.16, -0.04, 0, 0.1, 0.04, 0, 0.1,
      0, 0.05, -0.16, 0.04, 0, 0.1, 0, -0.03, 0.02,
      0, 0.05, -0.16, 0, -0.03, 0.02, -0.04, 0, 0.1,
      // wings (tips raised; y is flipped per frame to flap)
      -0.02, 0.02, -0.04, -0.24, 0.1, 0.04, -0.02, 0.02, 0.06,
      0.02, 0.02, -0.04, 0.02, 0.02, 0.06, 0.24, 0.1, 0.04,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), MAX_BIRDS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  /** Scatter fresh flocks over open ground (called once per match / playground). */
  reset(n = 14) {
    this.flocks = [];
    let guard = 0;
    while (this.flocks.length < n && guard++ < 400) {
      const home = this.findSpot();
      if (!home) continue;
      const count = 4 + Math.floor(Math.random() * 2);
      if (this.flocks.reduce((s, f) => s + f.birds.length, 0) + count > MAX_BIRDS) break;
      const f: Flock = { home, birds: [], state: 'ground', t: 0, color: new THREE.Color(COLORS[this.flocks.length % COLORS.length]) };
      for (let i = 0; i < count; i++) f.birds.push(this.makeBird(home));
      this.flocks.push(f);
    }
  }

  private makeBird(home: THREE.Vector3): Bird {
    const a = Math.random() * Math.PI * 2, r = rand(0.3, 1.6);
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    return { pos: new THREE.Vector3(x, ground(x, z), z), vel: new THREE.Vector3(), yaw: rand(0, 6.28), phase: rand(0, 6.28), hopT: rand(0.5, 3), hopY: 0 };
  }

  /** open, dry, reachable-from-the-sky ground */
  private findSpot(): THREE.Vector3 | null {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 88;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gy = ground(x, z);
    if (gy < 0.6) return null;
    const hit = this.cw.raycast(_p.set(x, gy + 25, z), _d.set(0, -1, 0), 40, ColFlags.BlocksMove | ColFlags.BlocksSight, _hit);
    if (!hit || Math.abs(hit.point.y - gy) > 0.25) return null;
    return new THREE.Vector3(x, gy, z);
  }

  private takeOff(f: Flock, from: THREE.Vector3 | null) {
    f.state = 'fly';
    f.t = 0;
    for (const b of f.birds) {
      _d.set(rand(-1, 1), 0, rand(-1, 1));
      if (from) _d.add(_p.subVectors(b.pos, from).setY(0).normalize().multiplyScalar(1.5));
      _d.setY(0).normalize();
      b.vel.set(_d.x * rand(4, 6), rand(5, 8), _d.z * rand(4, 6));
      b.yaw = Math.atan2(-b.vel.x, -b.vel.z);
    }
    this.fx.soft.emit(_p.copy(f.home).setY(f.home.y + 0.3), { count: 10, color: [0xffffff, f.color.getHex(), 0xf0e8e0], speed: [1, 3], spread: 1, up: 1.5, gravity: 1.2, drag: 2.5, life: [1.2, 2], size: [0.07, 0.12], sizeEnd: 0.8, shape: PShape.Confetti, spin: 6, jitter: 0.8 });
    audio.flap(f.home, f.birds.length + 2);
  }

  update(dt: number, time: number, cam: THREE.Vector3, actors: Actor[], sounds: SoundEvent[]) {
    // scare checks are cheap but don't need to run every frame
    this.checkT -= dt;
    const check = this.checkT <= 0;
    if (check) this.checkT = 0.15;
    let n = 0;
    for (const f of this.flocks) {
      const near = f.home.distanceToSquared(cam) < 90 * 90;
      if (f.state === 'ground' && check) {
        let scare: THREE.Vector3 | null = null;
        for (const a of actors) {
          if (!a.alive || a.parked || a.flight !== 'none') continue;
          const d2 = a.motor.pos.distanceToSquared(f.home);
          const hs = a.motor.horizontalSpeed();
          if (d2 < 3.5 * 3.5 || (d2 < 9 * 9 && hs > 3 && !a.motor.crouching)) {
            scare = a.motor.pos;
            break;
          }
        }
        if (!scare) {
          for (const s of sounds) {
            if (time - s.time > 0.3 || s.kind === 'footstep' || s.kind === 'impact') continue;
            if (s.pos.distanceToSquared(f.home) < Math.min(32, s.loudness) ** 2) {
              scare = s.pos;
              break;
            }
          }
        }
        if (scare) this.takeOff(f, scare);
      }
      if (f.state === 'gone') {
        // settle somewhere new a while later
        f.t += dt;
        if (f.t > 20) {
          const spot = this.findSpot();
          if (spot && spot.distanceToSquared(cam) > 25 * 25) {
            f.home = spot;
            f.birds.forEach((b, i) => (f.birds[i] = this.makeBird(spot)));
            f.state = 'ground';
          }
        }
        continue;
      }
      if (f.state === 'fly') {
        f.t += dt;
        if (f.t > 7) {
          f.state = 'gone';
          f.t = 0;
          continue;
        }
      }
      if (!near) continue;
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        let flap = 1;
        if (f.state === 'fly') {
          // climb away, curving gently, flapping hard
          b.vel.y = Math.max(b.vel.y - 2 * dt, 2.5);
          b.vel.x += Math.sin(time * 1.3 + b.phase) * 2 * dt;
          b.vel.z += Math.cos(time * 1.1 + b.phase) * 2 * dt;
          b.pos.addScaledVector(b.vel, dt);
          b.yaw = Math.atan2(-b.vel.x, -b.vel.z);
          flap = Math.sin(time * 28 + b.phase);
        } else {
          // pecking and the odd hop
          b.hopT -= dt;
          if (b.hopT <= 0) {
            b.hopT = rand(0.8, 3.5);
            b.hopY = 0.12;
            b.yaw += rand(-1.2, 1.2);
            const step = rand(0.1, 0.35);
            const nx = b.pos.x - Math.sin(b.yaw) * step, nz = b.pos.z - Math.cos(b.yaw) * step;
            if ((nx - f.home.x) ** 2 + (nz - f.home.z) ** 2 < 4) {
              b.pos.x = nx;
              b.pos.z = nz;
            }
          }
          b.hopY = Math.max(0, b.hopY - dt * 0.9);
          b.pos.y = ground(b.pos.x, b.pos.z) + 0.04 + b.hopY;
          flap = 0.25;
        }
        const peck = f.state === 'ground' ? Math.max(0, Math.sin(time * 5 + b.phase * 3)) ** 8 * 0.6 : 0;
        _e.set(peck - (f.state === 'fly' ? 0.25 : 0), b.yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(b.pos, _q, _s.set(1, flap, 1));
        this.mesh.setMatrixAt(n, _m);
        this.mesh.setColorAt(n, f.color);
        n++;
      }
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
