import * as THREE from 'three';
import { CollisionWorld, ColFlags, Surface, RayHit } from './Collision';
import { clamp } from '../core/math';

export interface MotorInput {
  /** world-space desired move direction, magnitude 0..1 */
  wishX: number;
  wishZ: number;
  sprint: boolean;
  jump: boolean; // edge
  crouch: boolean; // edge (toggle crouch / start slide)
  speedMul: number; // ADS, healing etc.
}

export interface MotorEvents {
  jumped: boolean;
  landed: number; // impact speed (0 if not landed this frame)
  slideStarted: boolean;
  slideEnded: boolean;
  stepped: boolean;
  mantled: boolean;
}

export const MOTOR = {
  radius: 0.36,
  standHeight: 1.55,
  crouchHeight: 1.05,
  runSpeed: 5.3,
  sprintSpeed: 7.4,
  crouchSpeed: 2.6,
  groundAccel: 60,
  groundDecel: 44,
  overspeedDecel: 16,
  airAccel: 16,
  gravity: 23,
  jumpVel: 7.6,
  terminal: 38,
  coyote: 0.12,
  jumpBuffer: 0.13,
  stepHeight: 0.5,
  slideMinSpeed: 5.4,
  slideBoost: 9.6,
  slideMax: 16,
  slideFriction: 5.2,
  slideEndSpeed: 3.2,
  slideCooldown: 0.75,
  slideJumpBonus: 0.9,
  maxGroundSlope: 0.62, // min normal.y considered ground
};

const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _disp = new THREE.Vector3();
const _hit: RayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Kinematic arcade character controller. Shared by the player and every bot so they obey
 * identical movement rules (important for fairness and for future networking).
 */
export class CharacterMotor {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  surface: Surface = 'grass';
  height = MOTOR.standHeight;
  crouching = false;
  sliding = false;
  sprinting = false;
  airTime = 0;
  /** mantle animation state */
  mantleT = -1;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  private coyoteT = 0;
  private jumpBufT = 0;
  private slideCd = 0;
  private slideGroundLost = 0;
  private jumpedRecently = 0;
  private fallStartY = 0;
  private minVyInAir = 0;
  events: MotorEvents = { jumped: false, landed: 0, slideStarted: false, slideEnded: false, stepped: false, mantled: false };

  constructor(public world: CollisionWorld) {}

  get radius() {
    return MOTOR.radius;
  }

  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.mantleT = -1;
  }

  /**
   * Free flight integration (skydiving / gliding): no walking rules, same collision.
   * Returns true when we touch walkable ground.
   */
  flyStep(dt: number): boolean {
    this.grounded = false;
    _disp.copy(this.vel).multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(_disp.length() / 0.25));
    _disp.divideScalar(steps);
    for (let s = 0; s < steps; s++) {
      this.pos.add(_disp);
      this.resolve();
      if (this.grounded) break;
    }
    if (!this.grounded && this.vel.y <= 0) this.probeGround(0.05);
    return this.grounded;
  }

  /** External push (explosions, gusts, bounce pads, knockback). */
  impulse(v: THREE.Vector3) {
    this.vel.add(v);
    if (v.y > 0.5) {
      this.grounded = false;
      this.jumpedRecently = 0.2;
      this.coyoteT = 0;
      if (this.sliding) {
        this.sliding = false;
        this.events.slideEnded = true;
      }
    }
    this.mantleT = -1;
  }

  /** Temporary speed multiplier (Golden Biscuit zoomies). */
  speedBoost = 1;
  /** Springy Socks */
  jumpMul = 1;

  horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Does the body (at given feet position/height) overlap the world? */
  bodyOverlaps(p: THREE.Vector3, height = this.height, shrink = 0.02): boolean {
    const r = MOTOR.radius - shrink;
    const cw = this.world;
    _c.set(p.x, p.y + MOTOR.radius, p.z);
    if (cw.sphereOverlaps(_c, r)) return true;
    _c.y = p.y + height - MOTOR.radius;
    if (cw.sphereOverlaps(_c, r)) return true;
    _c.y = p.y + height * 0.5;
    return cw.sphereOverlaps(_c, r);
  }

  update(dt: number, inp: MotorInput) {
    const ev = this.events;
    ev.jumped = false;
    ev.landed = 0;
    ev.slideStarted = false;
    ev.slideEnded = false;
    ev.stepped = false;
    ev.mantled = false;

    // --- mantle is an authored move: position is animated, physics suspended
    if (this.mantleT >= 0) {
      this.mantleT += dt / 0.32;
      const t = Math.min(1, this.mantleT);
      // up first, then forward (feels like hauling yourself over)
      const up = Math.min(1, t * 1.6);
      const fwd = clamp((t - 0.35) / 0.65, 0, 1);
      this.pos.set(
        this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * fwd,
        this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * (1 - (1 - up) * (1 - up)),
        this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * fwd,
      );
      if (t >= 1) {
        this.mantleT = -1;
        this.grounded = true;
        this.vel.set((this.mantleTo.x - this.mantleFrom.x) * 2.5, 0, (this.mantleTo.z - this.mantleFrom.z) * 2.5);
      }
      return;
    }

    this.coyoteT -= dt;
    this.jumpBufT -= dt;
    this.slideCd -= dt;
    this.jumpedRecently -= dt;
    if (inp.jump) this.jumpBufT = MOTOR.jumpBuffer;

    const wishLen = Math.min(1, Math.hypot(inp.wishX, inp.wishZ));
    const hs = this.horizontalSpeed();

    // --- crouch / slide transitions
    if (inp.crouch) {
      if (this.sliding) {
        this.endSlide();
      } else if (this.grounded && hs > MOTOR.slideMinSpeed && this.slideCd <= 0) {
        this.sliding = true;
        this.crouching = false;
        this.slideGroundLost = 0;
        const boost = Math.min(MOTOR.slideMax, Math.max(hs * 1.22, MOTOR.slideBoost));
        this.vel.x *= boost / hs;
        this.vel.z *= boost / hs;
        ev.slideStarted = true;
      } else if (this.grounded) {
        if (this.crouching) this.tryStand();
        else this.crouching = true;
      }
    }
    this.sprinting = !this.sliding && !this.crouching && inp.sprint && wishLen > 0.5;
    if (this.sprinting && this.crouching) this.tryStand();

    const targetH = this.sliding || this.crouching ? MOTOR.crouchHeight : MOTOR.standHeight;
    this.height = targetH;

    // --- horizontal velocity
    if (this.sliding) {
      // friction + gravity along the slope + a little steering
      const n = this.groundNormal;
      const gx = -n.x * n.y * -MOTOR.gravity; // projection of (0,-g,0) onto plane, x/z parts
      const gz = -n.z * n.y * -MOTOR.gravity;
      this.vel.x += gx * dt * 1.4;
      this.vel.z += gz * dt * 1.4;
      const sp = this.horizontalSpeed();
      const nsp = Math.max(0, sp - MOTOR.slideFriction * dt);
      if (sp > 1e-4) {
        this.vel.x *= nsp / sp;
        this.vel.z *= nsp / sp;
      }
      this.vel.x += inp.wishX * 5 * dt;
      this.vel.z += inp.wishZ * 5 * dt;
      const cap = this.horizontalSpeed();
      if (cap > MOTOR.slideMax) {
        this.vel.x *= MOTOR.slideMax / cap;
        this.vel.z *= MOTOR.slideMax / cap;
      }
      if (!this.grounded) this.slideGroundLost += dt;
      else this.slideGroundLost = 0;
      if (cap < MOTOR.slideEndSpeed || this.slideGroundLost > 0.3) this.endSlide();
    } else {
      const maxSpeed = (this.crouching ? MOTOR.crouchSpeed : this.sprinting ? MOTOR.sprintSpeed : MOTOR.runSpeed) * inp.speedMul * this.speedBoost;
      const tx = inp.wishX * maxSpeed, tz = inp.wishZ * maxSpeed;
      let accel: number;
      if (this.grounded) {
        const over = hs > maxSpeed + 0.5 && wishLen > 0.1;
        accel = over ? MOTOR.overspeedDecel : wishLen > 0.05 ? MOTOR.groundAccel : MOTOR.groundDecel;
      } else {
        accel = MOTOR.airAccel;
        // in the air, never accelerate beyond what you had (preserve slide-jump momentum but don't add)
      }
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz);
      const step = accel * dt;
      if (!this.grounded && (wishLen < 0.05 || hs > maxSpeed + 0.5)) {
        // in the air: keep momentum (knockback, bounce pads, slide-jumps) — only gentle steering
        if (wishLen > 0.05) {
          this.vel.x += inp.wishX * 6 * dt;
          this.vel.z += inp.wishZ * 6 * dt;
        }
      } else if (dl <= step) {
        this.vel.x = tx;
        this.vel.z = tz;
      } else {
        this.vel.x += (dx / dl) * step;
        this.vel.z += (dz / dl) * step;
      }
    }

    // --- jumping
    if (this.jumpBufT > 0 && (this.grounded || this.coyoteT > 0)) {
      if (this.crouching && !this.sliding) {
        this.tryStand();
      }
      if (this.sliding) {
        const sp = this.horizontalSpeed();
        const ns = Math.min(10.8, sp + MOTOR.slideJumpBonus);
        if (sp > 1e-3) {
          this.vel.x *= ns / sp;
          this.vel.z *= ns / sp;
        }
        this.endSlide();
        this.slideCd = MOTOR.slideCooldown;
      }
      this.vel.y = MOTOR.jumpVel * this.jumpMul;
      this.grounded = false;
      this.coyoteT = 0;
      this.jumpBufT = 0;
      this.jumpedRecently = 0.2;
      this.fallStartY = this.pos.y;
      ev.jumped = true;
    } else if (this.jumpBufT > 0 && !this.grounded && inp.jump) {
      // airborne jump press near a ledge -> mantle
      this.tryMantle(inp);
    }

    // --- gravity
    const wasGrounded = this.grounded;
    if (!this.grounded) {
      this.vel.y = Math.max(-MOTOR.terminal, this.vel.y - MOTOR.gravity * dt);
      this.airTime += dt;
      this.minVyInAir = Math.min(this.minVyInAir, this.vel.y);
    } else {
      this.airTime = 0;
      this.minVyInAir = 0;
    }

    // --- integrate with substeps
    _disp.copy(this.vel).multiplyScalar(dt);
    if (this.grounded) {
      // walk along the ground plane (ramps & stairs feel natural)
      const n = this.groundNormal;
      const dn = _disp.x * n.x + _disp.z * n.z;
      _disp.y = -dn / Math.max(0.3, n.y);
    }
    const steps = Math.max(1, Math.ceil(_disp.length() / 0.22));
    _disp.divideScalar(steps);
    this.grounded = false;
    let wallHit = false;
    _prev.copy(this.pos);
    for (let s = 0; s < steps; s++) {
      this.pos.add(_disp);
      if (this.resolve()) wallHit = true;
    }

    // --- step up small ledges (curbs, crates, stair lips)
    if (wallHit && wasGrounded) {
      this.tryStepUp(_prev, inp);
    }
    // --- automatic ledge climb when pushing into a wall while airborne
    if (!this.grounded && wallHit && wishLen > 0.3 && this.vel.y > -6 && this.mantleT < 0) {
      this.tryMantle(inp);
    }

    // --- ground probe / snap
    if (!this.grounded && this.vel.y <= 0.01 && this.jumpedRecently <= 0) {
      this.probeGround(wasGrounded ? 0.5 : 0.08);
    }

    if (this.grounded) {
      if (!wasGrounded) {
        const impact = -this.minVyInAir;
        ev.landed = Math.max(0.01, impact);
        this.minVyInAir = 0;
      }
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyoteT = MOTOR.coyote;
    } else if (wasGrounded && this.jumpedRecently <= 0) {
      this.fallStartY = this.pos.y;
    }
  }

  private endSlide() {
    if (!this.sliding) return;
    this.sliding = false;
    this.events.slideEnded = true;
    this.slideCd = Math.max(this.slideCd, 0.25);
    // pop back up if there is room, otherwise stay crouched
    this.crouching = this.bodyOverlaps(this.pos, MOTOR.standHeight);
  }

  private tryStand() {
    if (!this.bodyOverlaps(this.pos, MOTOR.standHeight)) this.crouching = false;
  }

  /** Push the character out of geometry. Returns true if a wall was touched. */
  private resolve(): boolean {
    let wall = false;
    const r = MOTOR.radius;
    const offs = [r, this.height * 0.5, this.height - r];
    for (let i = 0; i < 3; i++) {
      _c.set(this.pos.x, this.pos.y + offs[i], this.pos.z);
      const bx = _c.x, by = _c.y, bz = _c.z;
      this.world.resolveSphere(_c, r, ColFlags.BlocksMove, (n, _d, o) => {
        if (n.y > MOTOR.maxGroundSlope) {
          this.grounded = true;
          this.groundNormal.copy(n);
          this.surface = o.surface;
          if (this.vel.y < 0) this.vel.y = 0;
        } else if (n.y < -0.6) {
          if (this.vel.y > 0) this.vel.y = 0;
        } else {
          wall = true;
          const vn = this.vel.x * n.x + this.vel.y * n.y + this.vel.z * n.z;
          if (vn < 0) {
            this.vel.x -= n.x * vn;
            this.vel.z -= n.z * vn;
            if (n.y > 0.1 && this.vel.y < 0) this.vel.y -= n.y * vn;
          }
        }
      });
      this.pos.x += _c.x - bx;
      this.pos.y += _c.y - by;
      this.pos.z += _c.z - bz;
    }
    return wall;
  }

  private probeGround(maxSnap: number) {
    const r = MOTOR.radius;
    _c.set(this.pos.x, this.pos.y + r, this.pos.z);
    const hit = this.world.raycast(_c, DOWN, r + maxSnap + 0.4, ColFlags.BlocksMove, _hit);
    if (!hit || hit.normal.y < MOTOR.maxGroundSlope) return;
    const restY = hit.point.y + r / hit.normal.y - r;
    if (restY <= this.pos.y + 0.02 && this.pos.y - restY <= maxSnap) {
      this.pos.y = restY;
      this.grounded = true;
      this.groundNormal.copy(hit.normal);
      this.surface = hit.collider!.surface;
    }
  }

  private tryStepUp(from: THREE.Vector3, inp: MotorInput) {
    const wl = Math.hypot(inp.wishX, inp.wishZ);
    if (wl < 0.2) return;
    const dx = (inp.wishX / wl) * 0.28, dz = (inp.wishZ / wl) * 0.28;
    const cand = _n.set(from.x + dx, from.y + MOTOR.stepHeight, from.z + dz);
    if (this.bodyOverlaps(cand)) return;
    _c.set(cand.x, cand.y + 0.05, cand.z);
    const hit = this.world.raycast(_c, DOWN, MOTOR.stepHeight + 0.1, ColFlags.BlocksMove, _hit);
    if (!hit || hit.normal.y < MOTOR.maxGroundSlope) return;
    const y = hit.point.y + 0.01;
    if (y - from.y < 0.08) return; // not actually a step
    const target = new THREE.Vector3(cand.x, y, cand.z);
    if (this.bodyOverlaps(target)) return;
    this.pos.copy(target);
    this.grounded = true;
    this.groundNormal.set(0, 1, 0);
    this.surface = hit.collider!.surface;
    this.events.stepped = true;
  }

  /** Ledge grab: find a surface in front of us between waist and ~2.3m above the feet. */
  tryMantle(inp: MotorInput): boolean {
    if (this.sliding || this.crouching) return false;
    const wl = Math.hypot(inp.wishX, inp.wishZ);
    let fx: number, fz: number;
    if (wl > 0.2) {
      fx = inp.wishX / wl;
      fz = inp.wishZ / wl;
    } else {
      const hs = this.horizontalSpeed();
      if (hs < 0.5) return false;
      fx = this.vel.x / hs;
      fz = this.vel.z / hs;
    }
    const r = MOTOR.radius;
    // must actually be facing a wall
    _c.set(this.pos.x, this.pos.y + 0.7, this.pos.z);
    const wall = this.world.raycast(_c, _n.set(fx, 0, fz), r + 0.5, ColFlags.BlocksMove, _hit);
    if (!wall) return false;
    const reach = r + 0.45;
    for (const h of [2.3, 1.9, 1.5, 1.1]) {
      _c.set(this.pos.x + fx * reach, this.pos.y + h + 0.4, this.pos.z + fz * reach);
      const hit = this.world.raycast(_c, DOWN, 1.2, ColFlags.BlocksMove, _hit);
      if (!hit || hit.normal.y < 0.8) continue;
      const topY = hit.point.y;
      const rise = topY - this.pos.y;
      if (rise < 0.55 || rise > 2.35) continue;
      const dest = new THREE.Vector3(this.pos.x + fx * (reach + 0.1), topY + 0.02, this.pos.z + fz * (reach + 0.1));
      if (this.bodyOverlaps(dest)) continue;
      // clear path straight up from here
      const upPos = new THREE.Vector3(this.pos.x, topY + 0.02, this.pos.z);
      if (this.bodyOverlaps(upPos, MOTOR.standHeight, 0.08)) continue;
      this.mantleFrom.copy(this.pos);
      this.mantleTo.copy(dest);
      this.mantleT = 0;
      this.vel.set(0, 0, 0);
      this.jumpBufT = 0;
      this.events.mantled = true;
      return true;
    }
    return false;
  }
}
