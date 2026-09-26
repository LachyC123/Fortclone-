import * as THREE from 'three';
import { RARITY, RarityIndex, PAL } from '../render/Palette';
import { WEAPONS, buildWeaponView, AmmoType } from '../combat/Weapons';
import type { Actor } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { CollisionWorld, ColFlags } from '../physics/Collision';
import { PShape } from '../fx/Particles';
import { audio } from '../audio/Audio';
import { toyMaterial } from '../render/Materials';
import { mergeToVertexColored } from '../render/Merge';

export type LootKind = 'weapon' | 'ammo';

export interface Pickup {
  id: number;
  kind: LootKind;
  defId: string; // weapon id or ammo type
  rarity: RarityIndex;
  amount: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  settled: boolean;
  root: THREE.Group;
  model: THREE.Object3D;
  glow: THREE.Mesh;
  beam: THREE.Mesh;
  t: number;
  /** being collected: flies to the collector */
  collectT: number;
  collector: Actor | null;
  /** ignore pickup attempts until (prevents instantly re-grabbing a dropped gun) */
  lockUntil: number;
  mag: number;
}

let nextPickupId = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const beamTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

/**
 * World loot. Items float, bob and spin above a rarity-coloured light pool that tints the
 * ground (a cheap additive decal instead of real lights), and pull sparkles toward them.
 */
export class LootSystem {
  pickups: Pickup[] = [];
  private hum = 0;

  constructor(private scene: THREE.Scene, private cw: CollisionWorld) {}

  private buildModel(kind: LootKind, defId: string, rarity: RarityIndex): THREE.Object3D {
    if (kind === 'weapon') {
      const v = buildWeaponView(WEAPONS[defId], rarity);
      v.flash.visible = false;
      const merged = mergeToVertexColored(v.group);
      merged.scale.setScalar(1.35);
      merged.rotation.y = Math.PI / 2;
      const g = new THREE.Group();
      g.add(merged);
      return g;
    }
    // ammo: a chunky little tin with a coloured band
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 12), toyMaterial(0x9aa4b0, { rough: 0.35, metal: 0.5 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.1, 12), toyMaterial(defId === 'medium' ? PAL.mustard : PAL.teal));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), toyMaterial(0x6b7380, { rough: 0.35, metal: 0.5 }));
    lid.position.y = 0.15;
    box.castShadow = true;
    g.add(box, band, lid);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 2, 6), toyMaterial(0xd98b4f, { metal: 0.6, rough: 0.3 }));
      b.position.set(-0.05 + i * 0.05, 0.22, 0);
      g.add(b);
    }
    const out = new THREE.Group();
    out.add(mergeToVertexColored(g));
    return out;
  }

  spawn(kind: LootKind, defId: string, rarity: RarityIndex, amount: number, pos: THREE.Vector3, vel?: THREE.Vector3, mag?: number): Pickup {
    const root = new THREE.Group();
    const model = this.buildModel(kind, defId, rarity);
    root.add(model);
    const color = RARITY[rarity].color;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.scale.setScalar(kind === 'weapon' ? 2.4 + rarity * 0.35 : 1.3);
    root.add(glow);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.2, 2.6, 8, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 + rarity * 0.08, side: THREE.DoubleSide }),
    );
    beam.position.y = 1.3;
    beam.visible = kind === 'weapon' && rarity >= 1;
    root.add(beam);
    root.position.copy(pos);
    this.scene.add(root);
    const p: Pickup = {
      id: nextPickupId++,
      kind,
      defId,
      rarity,
      amount,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new THREE.Vector3(),
      settled: !vel,
      root,
      model,
      glow,
      beam,
      t: Math.random() * 10,
      collectT: -1,
      collector: null,
      lockUntil: 0,
      mag: mag ?? (kind === 'weapon' ? WEAPONS[defId].mag : 0),
    };
    this.pickups.push(p);
    return p;
  }

  remove(p: Pickup) {
    this.scene.remove(p.root);
    p.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /** Burst an eliminated rascal's gear out onto the ground. */
  dropInventory(a: Actor) {
    const base = _v.copy(a.motor.pos).setY(a.motor.pos.y + 1);
    let k = 0;
    const toss = () => {
      const ang = (k++ / 5) * Math.PI * 2 + Math.random();
      return new THREE.Vector3(Math.cos(ang) * 3.2, 6, Math.sin(ang) * 3.2);
    };
    for (let i = 0; i < a.weapons.length; i++) {
      const w = a.weapons[i];
      if (!w) continue;
      const p = this.spawn('weapon', w.def.id, w.rarity, 1, base, toss(), w.mag);
      p.lockUntil = performance.now() + 400;
      a.weapons[i] = null;
    }
    for (const t of Object.keys(a.ammo) as AmmoType[]) {
      if (a.ammo[t] > 0) {
        this.spawn('ammo', t, 0, a.ammo[t], base, toss());
        a.ammo[t] = 0;
      }
    }
    a.rig.setWeapon(null);
  }

  /** Nearest weapon pickup the actor is facing & close to (for the contextual prompt). */
  bestFor(a: Actor, maxDist = 2.4): Pickup | null {
    let best: Pickup | null = null, bestScore = Infinity;
    const eye = a.eyePos(_v2);
    for (const p of this.pickups) {
      if (p.kind !== 'weapon' || p.collectT >= 0 || p.lockUntil > performance.now()) continue;
      const d = p.pos.distanceTo(a.motor.pos);
      if (d > maxDist) continue;
      // prefer what you're looking at
      _v.subVectors(p.pos, eye).normalize();
      const facing = _v.dot(a.intent.aimDir);
      const score = d - facing * 1.2;
      if (score < bestScore && this.cw.lineClear(eye, _v.copy(p.pos).setY(p.pos.y + 0.3), ColFlags.BlocksMove)) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  }

  /** Swap/equip a weapon pickup. */
  collect(a: Actor, p: Pickup, ctx: GameCtx) {
    if (p.collectT >= 0) return;
    if (p.kind === 'weapon') {
      let slot = a.weapons.findIndex((w) => !w);
      if (slot < 0) {
        // full: swap with the held weapon, dropping it where we stand
        slot = a.activeSlot;
        const old = a.weapons[slot]!;
        const d = this.spawn('weapon', old.def.id, old.rarity, 1, _v.copy(a.motor.pos).setY(a.motor.pos.y + 1), new THREE.Vector3(Math.sin(a.bodyYaw) * -2, 4, Math.cos(a.bodyYaw) * -2), old.mag);
        d.lockUntil = performance.now() + 800;
      }
      a.giveWeapon(p.defId, p.rarity, slot);
      a.weapons[slot]!.mag = p.mag;
      if (a.isLocal) {
        audio.pickup(p.rarity);
        ctx.hud.slotPulse(slot);
        ctx.hud.toast(`${RARITY[p.rarity].name.toUpperCase()} ${WEAPONS[p.defId].name.toUpperCase()}`, RARITY[p.rarity].css);
      }
    }
    p.collectT = 0;
    p.collector = a;
    ctx.fx.pickupSparkle(_v.copy(p.pos).setY(p.pos.y + 0.4), RARITY[p.rarity].color);
  }

  update(dt: number, ctx: GameCtx) {
    const local = ctx.localActor;
    let nearestCrateHum = Infinity;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      // collecting: snap toward the collector, shrink, sparkle trail
      if (p.collectT >= 0) {
        p.collectT += dt / 0.2;
        const c = p.collector!;
        const target = _v.copy(c.motor.pos).setY(c.motor.pos.y + 1.0);
        p.root.position.lerp(target, Math.min(1, p.collectT * 1.4));
        p.root.scale.setScalar(Math.max(0.01, 1 - p.collectT));
        ctx.fx.glow.emit(p.root.position, { count: 1, color: RARITY[p.rarity].color, speed: 0.3, life: 0.2, size: 0.12, shape: PShape.Sparkle });
        if (p.collectT >= 1) this.remove(p);
        continue;
      }
      // dropped items arc out and settle
      if (!p.settled) {
        p.vel.y -= 20 * dt;
        p.pos.addScaledVector(p.vel, dt);
        let landed = false;
        this.cw.resolveSphere(p.pos, 0.25, ColFlags.BlocksMove, (n) => {
          const vn = p.vel.dot(n);
          if (vn < 0) p.vel.addScaledVector(n, -vn * 1.35);
          p.vel.multiplyScalar(0.6);
          if (n.y > 0.6) landed = true;
        });
        if (landed && p.vel.lengthSq() < 1.2) {
          p.settled = true;
          p.pos.y += 0.15;
          ctx.fx.dust(p.pos, 3);
          audio.thud(p.pos, 0.25);
        }
        if (p.pos.y < -30) {
          this.remove(p);
          continue;
        }
      }
      const bob = p.settled ? Math.sin(p.t * 2.2) * 0.08 + 0.35 : 0;
      p.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      p.model.position.y = bob;
      p.model.rotation.y = p.t * 1.1;
      p.model.rotation.z = Math.sin(p.t * 1.3) * 0.12;
      p.glow.position.y = 0.03 - (p.settled ? 0.14 : 0);
      const pulse = 0.85 + Math.sin(p.t * 3) * 0.15;
      (p.glow.material as THREE.MeshBasicMaterial).opacity = 0.65 * pulse;
      p.beam.scale.set(1, 0.9 + Math.sin(p.t * 2) * 0.1, 1);

      if (!local || !local.alive) continue;
      const d = p.pos.distanceTo(local.motor.pos);
      // proximity: sparkles drift toward the item
      if (d < 7 && Math.random() < dt * (p.kind === 'weapon' ? 10 : 4)) {
        const a = Math.random() * Math.PI * 2;
        const src = _v.set(p.pos.x + Math.cos(a) * 1.2, p.pos.y + 0.2 + Math.random() * 0.8, p.pos.z + Math.sin(a) * 1.2);
        ctx.fx.glow.emit(src, { count: 1, color: [RARITY[p.rarity].color, 0xffffff], speed: 0.2, life: [0.5, 0.8], size: [0.05, 0.09], shape: PShape.Sparkle, attract: p.pos.clone().setY(p.pos.y + 0.4), drag: 4 });
      }
      if (p.kind === 'weapon' && p.rarity >= 2) nearestCrateHum = Math.min(nearestCrateHum, d);
      // ammo is auto-collected
      if (p.kind === 'ammo' && d < 1.4 && p.settled) {
        local.ammo[p.defId as AmmoType] += p.amount;
        audio.ammoPickup();
        ctx.hud.toast(`+${p.amount} AMMO`, '#f2c14e');
        p.collectT = 0;
        p.collector = local;
      }
    }
    // rare loot hums faintly so you can hear it before you see it
    this.hum -= dt;
    if (nearestCrateHum < 10 && this.hum <= 0) {
      this.hum = 1.2;
      const p = this.pickups.find((pp) => pp.kind === 'weapon' && pp.rarity >= 2 && pp.pos.distanceTo(local!.motor.pos) < 10);
      if (p) audio.crateHum(p.pos);
    }
  }
}
