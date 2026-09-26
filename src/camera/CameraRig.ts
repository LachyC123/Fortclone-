import * as THREE from 'three';
import { CollisionWorld, ColFlags } from '../physics/Collision';
import { clamp, damp, dirFromYawPitch, noise1 } from '../core/math';
import type { Actor } from '../entities/Actor';

const _pivot = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Over-the-shoulder third-person camera. Smooth follow, collision pull-in, sprint/ADS FOV,
 * landing dip, recoil, slide lowering and a whooshing blink transition. Shake is trauma-based
 * and deliberately small.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.12;
  private pivot = new THREE.Vector3();
  private dist = 3.4;
  private shoulder = 0.8;
  private fov = 72;
  private fovPunch = 0;
  private trauma = 0;
  private landDip = 0;
  private landDipV = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private blinkT = 0;
  private followLambda = 40;
  private t = 0;
  baseFov = 72;
  sensitivity = 1;

  constructor(public cam: THREE.PerspectiveCamera, private cw: CollisionWorld) {}

  snapTo(a: Actor) {
    this.pivot.copy(a.motor.pos).setY(a.motor.pos.y + 1.45);
    this.yaw = a.bodyYaw;
  }

  addLook(dx: number, dy: number) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -1.25, 1.1);
  }

  kick(pitchDeg: number, yawDeg: number) {
    const p = (pitchDeg * Math.PI) / 180, y = (yawDeg * Math.PI) / 180;
    this.pitch = clamp(this.pitch + p, -1.25, 1.1);
    this.yaw += y;
    this.recoilPitch += p;
    this.recoilYaw += y;
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  land(impact: number) {
    this.landDipV -= Math.min(4, impact * 0.22);
  }

  blink() {
    this.blinkT = 0.35;
    this.fovPunch += 16;
    this.followLambda = 14;
  }

  aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    origin.copy(this.cam.position);
    this.cam.getWorldDirection(dir);
  }

  update(dt: number, a: Actor, adsFov: number | null) {
    this.t += dt;
    const m = a.motor;
    // recoil recovery: return ~60% of the kick so sprays climb a little but feel controllable
    const rec = 1 - Math.exp(-7 * dt);
    const back = this.recoilPitch * rec * 0.6;
    this.pitch -= back;
    this.recoilPitch -= this.recoilPitch * rec;
    this.recoilYaw -= this.recoilYaw * rec;

    // pivot follows the head, lower while crouching/sliding
    const h = m.sliding ? 0.95 : m.crouching ? 1.1 : 1.45;
    _pivot.set(m.pos.x, m.pos.y + h, m.pos.z);
    this.blinkT = Math.max(0, this.blinkT - dt);
    if (this.blinkT <= 0) this.followLambda = damp(this.followLambda, 40, 3, dt);
    this.pivot.x = damp(this.pivot.x, _pivot.x, this.followLambda, dt);
    this.pivot.z = damp(this.pivot.z, _pivot.z, this.followLambda, dt);
    this.pivot.y = damp(this.pivot.y, _pivot.y, this.blinkT > 0 ? 14 : 18, dt);

    // landing dip spring
    this.landDipV += (-this.landDip * 120 - this.landDipV * 12) * dt;
    this.landDip += this.landDipV * dt;

    const ads = adsFov !== null;
    const targetDist = ads ? 1.7 : m.sprinting ? 3.8 : 3.3;
    const targetShoulder = ads ? 0.72 : 0.8;
    this.dist = damp(this.dist, targetDist, 10, dt);
    this.shoulder = damp(this.shoulder, targetShoulder, 10, dt);

    dirFromYawPitch(this.yaw, this.pitch, _fwd);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // shoulder offset, pulled in if a wall is right beside the head
    const side = this.cw.raycast(this.pivot, _right, this.shoulder + 0.25, ColFlags.BlocksMove);
    const sh = side ? Math.max(0, side.t - 0.25) : this.shoulder;
    const piv = _desired.copy(this.pivot).addScaledVector(_right, sh);
    piv.y += this.landDip * 0.15;
    // collision-safe camera distance (ray from pivot)
    _dir.copy(_fwd).negate();
    const want = this.dist + 0.25;
    const hit = this.cw.raycast(piv, _dir, want, ColFlags.BlocksMove);
    const d = hit ? Math.max(0.35, hit.t - 0.25) : this.dist;
    this.cam.position.copy(piv).addScaledVector(_dir, d);

    // shake (small!)
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const sy = noise1(this.t * 25) * 0.03 * s, sp = noise1(this.t * 25 + 50) * 0.03 * s, sr = noise1(this.t * 25 + 100) * 0.04 * s;
    this.cam.rotation.set(0, 0, 0, 'YXZ');
    this.cam.rotation.y = this.yaw + sy;
    this.cam.rotation.x = this.pitch + sp;
    this.cam.rotation.z = sr - clamp(a.motor.vel.x * _right.x + a.motor.vel.z * _right.z, -8, 8) * 0.002;

    // FOV
    this.fovPunch = damp(this.fovPunch, 0, 6, dt);
    const targetFov = ads ? adsFov! : m.sliding ? this.baseFov + 9 : m.sprinting ? this.baseFov + 6 : this.baseFov;
    this.fov = damp(this.fov, targetFov, ads ? 14 : 7, dt);
    const f = this.fov + this.fovPunch;
    if (Math.abs(this.cam.fov - f) > 0.01) {
      this.cam.fov = f;
      this.cam.updateProjectionMatrix();
    }
  }
}
