import * as THREE from 'three';
import type { Actor, Controller } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { Input } from '../core/Input';
import { CameraRig } from '../camera/CameraRig';
import { Blinkbug, BUG, simulateBug } from '../entities/Blinkbug';
import { PAL } from '../render/Palette';
import { angleDelta, clamp, dirFromYawPitch } from '../core/math';
import { ColFlags } from '../physics/Collision';
import type { Pickup, Crate } from '../loot/Loot';
import { UTILS, ITEM_COLOR } from '../combat/Items';
import { simulateThrow, throwVelocity, THROW } from '../combat/Throwables';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vel = new THREE.Vector3();

export interface PlayerSettings {
  aimAssist: boolean;
  autoFire: boolean;
}

/**
 * Turns input into an Intent for the local rascal, owns the camera, the throw-arc preview,
 * contextual interactions and (gentle, touch-only) aim assistance.
 */
export class PlayerController implements Controller {
  private arcDots: THREE.InstancedMesh;
  private arcRing: THREE.Mesh;
  contextPickup: Pickup | null = null;
  contextCrate: Crate | null = null;
  settings: PlayerSettings = { aimAssist: true, autoFire: false };
  autoFireActive = false;
  private autoFireT = 0;

  constructor(private input: Input, public cam: CameraRig, scene: THREE.Scene) {
    const dg = new THREE.SphereGeometry(0.085, 8, 6);
    const dm = new THREE.MeshBasicMaterial({ color: 0xc8ffff, transparent: true, opacity: 0.95, depthTest: false });
    this.arcDots = new THREE.InstancedMesh(dg, dm, 40);
    this.arcDots.count = 0;
    this.arcDots.frustumCulled = false;
    this.arcDots.renderOrder = 30;
    this.arcRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 28), new THREE.MeshBasicMaterial({ color: PAL.blink, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    this.arcRing.renderOrder = 31;
    this.arcRing.visible = false;
    scene.add(this.arcDots, this.arcRing);
  }

  update(a: Actor, ctx: GameCtx, dt: number) {
    const s = this.input.s;
    const it = a.intent;
    const cam = this.cam;

    // look (+ touch aim friction when an enemy is under the crosshair)
    let lookScale = 1;
    const target = this.settings.aimAssist && s.touchActive ? this.findAssistTarget(a, ctx) : null;
    if (target && target.angle < 0.05) lookScale = 0.6;
    cam.addLook(s.lookDX * lookScale, s.lookDY * lookScale);
    // gentle magnetism while shooting/aiming on touch
    if (target && (s.fire || s.ads || this.autoFireActive)) {
      const k = Math.min(1, dt * 3.2) * (1 - target.angle / 0.09);
      cam.yaw += angleDelta(cam.yaw, target.yaw) * k * 0.45;
      cam.pitch += (target.pitch - cam.pitch) * k * 0.45;
    }

    // movement relative to camera yaw
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    it.moveX = fx * s.moveY + rx * s.moveX;
    it.moveZ = fz * s.moveY + rz * s.moveX;
    const ml = Math.hypot(it.moveX, it.moveZ);
    if (ml > 1) {
      it.moveX /= ml;
      it.moveZ /= ml;
    }
    // mobile: pushing the stick to the rim sprints
    it.sprint = s.sprint || (s.touchActive && Math.hypot(s.moveX, s.moveY) > 0.92 && s.moveY > 0.3);
    it.jump = s.jumpPressed;
    it.crouch = s.crouchPressed;
    it.reload = s.reloadPressed;
    it.ads = s.ads;
    it.slot = s.slotPressed;
    it.blink = s.blinkPressed;
    it.throwAim = s.throwHeld;
    it.throwRelease = s.throwReleased;
    it.utilAim = s.utilHeld;
    it.utilRelease = s.utilReleased;
    it.heal = s.healPressed;
    it.drop = s.dropPressed;

    // auto-fire (optional): shoot when the crosshair rests on an enemy
    this.autoFireActive = false;
    if (this.settings.autoFire && a.armed) {
      const t2 = target ?? this.findAssistTarget(a, ctx);
      if (t2 && t2.angle < 0.035 && t2.visible) {
        this.autoFireT = 0.15;
      }
      this.autoFireT -= dt;
      this.autoFireActive = this.autoFireT > 0;
    }
    it.fire = s.fire || this.autoFireActive;

    // aim ray from the camera
    cam.aimRay(it.aimOrigin, it.aimDir);
    // push the origin up to the player's plane so point-blank walls behind us don't eat shots
    const toPlayer = _v.subVectors(a.motor.pos, it.aimOrigin).dot(it.aimDir);
    if (toPlayer > 0) it.aimOrigin.addScaledVector(it.aimDir, toPlayer);
    it.aimYaw = cam.yaw;
    it.aimPitch = cam.pitch;

    // contextual interaction: floor loot first, then Rascal Crates
    this.contextPickup = ctx.loot.bestFor(a);
    this.contextCrate = this.contextPickup ? null : ctx.loot.crateFor(a);
    if (s.interactPressed) {
      if (this.contextPickup) ctx.loot.collect(a, this.contextPickup, ctx);
      else if (this.contextCrate) ctx.loot.openCrate(this.contextCrate, a);
    }

    this.updateArc(a, ctx);
  }

  /** Throw preview: simulate the exact bug physics and draw dots + a landing ring. */
  private updateArc(a: Actor, ctx: GameCtx) {
    const dotMat = this.arcDots.material as THREE.MeshBasicMaterial;
    const ringMat = this.arcRing.material as THREE.MeshBasicMaterial;
    if (a.utilAiming && a.util) {
      // utility arc: same idea, the item's own physics
      const def = UTILS[a.util.id];
      const pos = _p.copy(a.eyePos(_v)).setY(a.motor.pos.y + 1.2);
      const vel = throwVelocity(def, a.intent.aimDir, _vel);
      vel.x += a.motor.vel.x * 0.5;
      vel.z += a.motor.vel.z * 0.5;
      const m = new THREE.Matrix4();
      let n = 0;
      let lastN: THREE.Vector3 | null = null;
      for (let i = 0; i < 360 && n < 40; i++) {
        const r = simulateThrow(ctx, def, pos, vel, THROW.step, (nn) => (lastN = nn.clone()));
        if (i % 5 === 0 && i > 8) {
          const sc = 1 - (n / 40) * 0.4 + Math.sin(performance.now() * 0.01 - n * 0.6) * 0.18;
          m.makeScale(sc, sc, sc).setPosition(pos);
          this.arcDots.setMatrixAt(n++, m);
        }
        if (r.settled || ((def.sticky || def.id === 'gust') && r.hit)) break;
      }
      this.arcDots.count = n;
      this.arcDots.instanceMatrix.needsUpdate = true;
      dotMat.color.setHex(0xffffff).lerp(new THREE.Color(ITEM_COLOR[def.id]), 0.6);
      ringMat.color.setHex(ITEM_COLOR[def.id]);
      this.arcRing.visible = true;
      this.arcRing.position.copy(pos);
      const nrm = lastN ?? _v2.set(0, 1, 0);
      this.arcRing.quaternion.setFromUnitVectors(_v.set(0, 0, 1), nrm);
      const big = def.id === 'fizzbomb' ? 5.5 : def.id === 'gust' ? 6 : def.id === 'stickypop' ? 4.5 : 1.5;
      this.arcRing.scale.setScalar(big * (1 + Math.sin(performance.now() * 0.012) * 0.05) * 1.8);
      return;
    }
    dotMat.color.setHex(0xc8ffff);
    if (!a.throwAiming) {
      this.arcDots.count = 0;
      this.arcRing.visible = false;
      return;
    }
    const pos = _p.copy(a.eyePos(_v)).setY(a.motor.pos.y + 1.1);
    const vel = Blinkbug.throwVelocity(a.intent.aimDir, _vel, a.bug.stats.throwSpeed);
    vel.x += a.motor.vel.x * 0.5;
    vel.z += a.motor.vel.z * 0.5;
    const m = new THREE.Matrix4();
    let n = 0;
    let settled = false;
    const dt = BUG.step;
    let lastN: THREE.Vector3 | null = null;
    for (let i = 0; i < 360 && n < 40; i++) {
      settled = simulateBug(ctx.cw, pos, vel, dt, (nn) => (lastN = nn.clone()), a.bug.stats);
      if (i % 5 === 0 && i > 8) {
        const s = 1 - (n / 40) * 0.4 + Math.sin(performance.now() * 0.01 - n * 0.6) * 0.18;
        m.makeScale(s, s, s).setPosition(pos);
        this.arcDots.setMatrixAt(n++, m);
      }
      if (settled) break;
    }
    this.arcDots.count = n;
    this.arcDots.instanceMatrix.needsUpdate = true;
    this.arcRing.visible = true;
    this.arcRing.position.copy(pos);
    const nrm = lastN ?? _v2.set(0, 1, 0);
    this.arcRing.quaternion.setFromUnitVectors(_v.set(0, 0, 1), nrm);
    this.arcRing.position.addScaledVector(nrm, -BUG.radius + 0.03);
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.12;
    this.arcRing.scale.setScalar(pulse);
    // warn (red) when the spot has no room to stand
    const fits = !a.motor.bodyOverlaps(_v.copy(pos).setY(pos.y - BUG.radius), 1.55, 0.05) || !a.motor.bodyOverlaps(_v.setY(pos.y), 1.55, 0.05);
    (this.arcRing.material as THREE.MeshBasicMaterial).color.setHex(fits ? PAL.blink : 0xff7a7a);
  }

  private findAssistTarget(a: Actor, ctx: GameCtx): { yaw: number; pitch: number; angle: number; visible: boolean } | null {
    let best: { yaw: number; pitch: number; angle: number; visible: boolean } | null = null;
    const camPos = this.cam.cam.position;
    const fwd = dirFromYawPitch(this.cam.yaw, this.cam.pitch, _v2);
    for (const o of ctx.actors) {
      if (o === a || !o.alive) continue;
      const tp = _v.copy(o.motor.pos).setY(o.motor.pos.y + o.motor.height * 0.62);
      const d = tp.distanceTo(camPos);
      if (d > 60) continue;
      const dir = tp.clone().sub(camPos).normalize();
      const ang = Math.acos(clamp(dir.dot(fwd), -1, 1));
      if (ang > 0.09) continue;
      if (!ctx.cw.lineClear(camPos, tp, ColFlags.BlocksBullets) || ctx.throwables.smokeBlocks(camPos, tp)) continue;
      if (!best || ang < best.angle) best = { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y), angle: ang, visible: true };
    }
    return best;
  }
}
