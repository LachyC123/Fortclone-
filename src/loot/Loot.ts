import * as THREE from 'three';
import { RARITY, RarityIndex, PAL } from '../render/Palette';
import { WEAPONS, WEAPON_IDS, buildWeaponView, AmmoType, AMMO_INFO } from '../combat/Weapons';
import { HEALS, UTILS, HealId, UtilId, buildItemModel, ITEM_COLOR } from '../combat/Items';
import type { Actor } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import { CollisionWorld, ColFlags, OBB } from '../physics/Collision';
import { PShape } from '../fx/Particles';
import { audio } from '../audio/Audio';
import { toyMaterial } from '../render/Materials';
import { mergeToVertexColored } from '../render/Merge';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { G, detail } from '../render/Detail';
import { PERKS, PERK_IDS, PerkId, buildPerkModel, MAX_PERKS } from '../combat/Perks';
import { RELIC_BY_ID, SET_BY_ID } from '../progression/Relics';

/** how many Rift Relics a rascal can carry at once */
export const MAX_RELICS = 3;

/** A Rift Relic on the ground: a glowing gem in its set's colour, circled by a gold ring. */
export function buildRelicModel(id: string): THREE.Object3D {
  const def = RELIC_BY_ID[id];
  const color = def ? SET_BY_ID[def.set].color : 0x6ff7ff;
  const g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.2, flatShading: true }));
  gem.scale.set(1, 1.45, 1);
  gem.position.y = 0.32;
  const ring = new THREE.Mesh(G.torus(0.3, 0.022, 6, 28), new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.3, metalness: 0.6 }));
  ring.position.y = 0.32;
  ring.rotation.x = Math.PI / 2 - 0.35;
  ring.name = 'ring';
  g.add(gem, ring);
  return g;
}

export type LootKind = 'weapon' | 'ammo' | 'heal' | 'util' | 'perk' | 'relic';

export interface Pickup {
  id: number;
  kind: LootKind;
  defId: string; // weapon id, ammo type, heal id, util id or perk id
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
  collectT: number;
  collector: Actor | null;
  lockUntil: number;
  mag: number;
  /** thrown to a teammate: others leave it alone until giftUntil (game time) */
  giftFor?: Actor | null;
  giftUntil?: number;
}

export interface LootRoll {
  kind: LootKind;
  defId: string;
  rarity: RarityIndex;
  amount: number;
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

/* ------------------------------------------------------------------ loot tables */

const FLOOR_RARITY = [46, 28, 16, 8, 2];
const CRATE_RARITY = [0, 38, 34, 20, 8];

function weighted<T>(items: T[], weight: (t: T) => number, r = Math.random()): T {
  const total = items.reduce((a, t) => a + weight(t), 0);
  let x = r * total;
  for (const t of items) {
    x -= weight(t);
    if (x <= 0) return t;
  }
  return items[items.length - 1];
}

export function rollRarity(table = FLOOR_RARITY): RarityIndex {
  return weighted([0, 1, 2, 3, 4], (i) => table[i]) as RarityIndex;
}

export function rollWeapon(table = FLOOR_RARITY): LootRoll {
  const id = weighted(WEAPON_IDS, (w) => WEAPONS[w].weight);
  return { kind: 'weapon', defId: id, rarity: rollRarity(table), amount: 1 };
}

export function ammoFor(weaponId: string, mult = 1): LootRoll {
  const t = WEAPONS[weaponId].ammo;
  return { kind: 'ammo', defId: t, rarity: 0, amount: Math.round(AMMO_INFO[t].pickup * mult) };
}

export function rollConsumable(): LootRoll {
  if (Math.random() < 0.55) {
    const h = weighted(Object.values(HEALS), (d) => d.weight);
    return { kind: 'heal', defId: h.id, rarity: h.rarity, amount: h.id === 'fizzle' ? 2 : 1 };
  }
  const u = weighted(Object.values(UTILS), (d) => d.weight);
  return { kind: 'util', defId: u.id, rarity: u.rarity, amount: u.id === 'stickypop' || u.id === 'fizzbomb' ? 2 : 1 };
}

export function rollPerk(): LootRoll {
  const id = weighted(PERK_IDS, (k) => PERKS[k].weight);
  return { kind: 'perk', defId: id, rarity: PERKS[id].rarity, amount: 1 };
}

/** What a floor loot spot produces. */
export function rollFloor(): LootRoll[] {
  const r = Math.random();
  const ammo = (mult = 1): LootRoll => {
    const t = weighted(Object.keys(AMMO_INFO) as AmmoType[], (a) => (a === 'medium' || a === 'light' ? 3 : 1));
    return { kind: 'ammo', defId: t, rarity: 0, amount: Math.round(AMMO_INFO[t].pickup * mult) };
  };
  if (r < 0.55) {
    const w = rollWeapon();
    return [w, ammoFor(w.defId, 2)];
  }
  if (r < 0.8) return Math.random() < 0.5 ? [rollConsumable(), ammo()] : [rollConsumable()];
  if (r < 0.86) return [rollPerk()];
  return [ammo(1.5), ammo()];
}

/** Rascal Crate contents: a better gun, its ammo, and a consumable. */
export function rollCrate(rich = false): LootRoll[] {
  if (rich) {
    const a = rollWeapon([0, 0, 0, 70, 30]);
    const b = rollWeapon([0, 0, 40, 45, 15]);
    return [a, ammoFor(a.defId, 2), b, ammoFor(b.defId, 2), rollConsumable(), rollPerk()];
  }
  const w = rollWeapon(CRATE_RARITY);
  const extra = Math.random();
  return [w, ammoFor(w.defId, 1.5), rollConsumable(), extra < 0.2 ? rollPerk() : extra < 0.6 ? rollConsumable() : ammoFor(rollWeapon().defId)];
}

/* ------------------------------------------------------------------ crates */

export interface Crate {
  root: THREE.Group;
  lid: THREE.Group;
  lock: THREE.Object3D;
  lights: THREE.Mesh[];
  pos: THREE.Vector3;
  yaw: number;
  opened: boolean;
  openT: number;
  opener: Actor | null;
  collider: OBB;
  lidV: number;
  lidA: number;
  glow: THREE.Mesh;
  t: number;
  /** Loot Balloon crate: guaranteed epic/mythic */
  rich?: boolean;
  /** a Rift Relic tucked inside (supply balloons) */
  relic?: string;
  /** stable id (LAN: host and clients agree on it) */
  id: number;
  /** LAN client: open it for show only — the host sends the loot that pops out */
  netOnly?: boolean;
}
let nextCrateId = 1;

const crateMats = {
  body: toyMaterial(0x6a4a8a, { rough: 0.6 }),
  band: toyMaterial(0xd9a441, { rough: 0.3, metal: 0.6 }),
  plate: toyMaterial(0x9aa4b0, { rough: 0.35, metal: 0.6 }),
  lock: toyMaterial(0xf2c14e, { rough: 0.25, metal: 0.7 }),
  inner: new THREE.MeshBasicMaterial({ color: 0xfff0a8 }),
};

function buildCrate(): { root: THREE.Group; lid: THREE.Group; lock: THREE.Object3D; lights: THREE.Mesh[] } {
  const root = new THREE.Group();
  const base = new THREE.Group();
  const rb = (w: number, h: number, d: number, r: number) => G.rbox(w, h, d, 3, r);
  const add = (p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    p.add(mesh);
    return mesh;
  };
  // chunky body with metal corner plates, gold bands and stickers
  add(base, rb(1.3, 0.7, 0.85, 0.1), crateMats.body, 0, 0.35, 0);
  add(base, rb(1.34, 0.12, 0.89, 0.04), crateMats.band, 0, 0.08, 0);
  add(base, rb(1.34, 0.1, 0.89, 0.04), crateMats.band, 0, 0.62, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(base, rb(0.18, 0.72, 0.18, 0.05), crateMats.plate, sx * 0.6, 0.36, sz * 0.38);
  const stickers = [PAL.pink, PAL.mustard, PAL.turquoise, 0xffffff, PAL.terracotta];
  const stickerGeo = new THREE.CircleGeometry(0.1, 12);
  const sk = [
    [0.3, 0.35, 0.431, 0],
    [-0.35, 0.28, 0.431, 0],
    [0.656, 0.35, 0.1, Math.PI / 2],
    [-0.656, 0.4, -0.15, -Math.PI / 2],
    [0.1, 0.33, -0.431, Math.PI],
  ];
  sk.forEach(([x, y, z, ry], i) => {
    const m = add(base, stickerGeo, toyMaterial(stickers[i % stickers.length], { rough: 0.8 }), x, y, z, 0, ry);
    m.scale.set(1 + (i % 2) * 0.4, 1, 1);
    m.rotation.z = i * 0.7;
  });
  // a little star sticker
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.05 : 0.12;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  add(base, new THREE.ShapeGeometry(star), toyMaterial(PAL.mustard), -0.05, 0.42, 0.432);
  const merged = mergeToVertexColored(base);
  root.add(merged);

  // lid on a hinge at the back
  const lid = new THREE.Group();
  lid.position.set(0, 0.7, -0.43);
  const lidInner = new THREE.Group();
  add(lidInner, rb(1.34, 0.26, 0.9, 0.1), crateMats.body, 0, 0.1, 0.43);
  add(lidInner, rb(1.38, 0.08, 0.94, 0.03), crateMats.band, 0, 0.0, 0.43);
  add(lidInner, rb(0.3, 0.1, 0.94, 0.04), crateMats.band, 0, 0.2, 0.43);
  lid.add(mergeToVertexColored(lidInner));
  root.add(lid);
  // padlock (shakes before opening)
  const lock = new THREE.Group();
  add(lock, rb(0.2, 0.18, 0.08, 0.04), crateMats.lock, 0, 0, 0);
  add(lock, G.torus(0.065, 0.02, 6, 12, Math.PI), crateMats.plate, 0, 0.09, 0);
  lock.position.set(0, 0.62, 0.47);
  root.add(lock);
  // blinking lights
  const lights: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(G.sphere(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: [0xff5c8a, 0x6ff7ff, 0xfff27a, 0x7ee06a][i] }));
    l.position.set(-0.45 + i * 0.3, 0.2, 0.44);
    root.add(l);
    lights.push(l);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { root, lid, lock, lights };
}

/**
 * World loot + Rascal Crates. Items float, bob and spin above a rarity-coloured light pool,
 * pull sparkles toward them, fly into your pack when collected, and FUSE when you already
 * carry the same gun at the same rarity.
 */
export class LootSystem {
  pickups: Pickup[] = [];
  crates: Crate[] = [];
  private hum = 0;

  constructor(private scene: THREE.Scene, private cw: CollisionWorld) {}

  private buildModel(kind: LootKind, defId: string, rarity: RarityIndex): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'weapon') {
      const v = buildWeaponView(WEAPONS[defId], rarity);
      v.flash.visible = false;
      const merged = mergeToVertexColored(v.group);
      merged.scale.setScalar(1.35);
      merged.rotation.y = Math.PI / 2;
      g.add(merged);
      return g;
    }
    if (kind === 'ammo') {
      const t = defId as AmmoType;
      const tin = new THREE.Group();
      const box = new THREE.Mesh(G.cylinder(0.16, 0.16, 0.26, 12), toyMaterial(0x9aa4b0, { rough: 0.35, metal: 0.5 }));
      const band = new THREE.Mesh(G.cylinder(0.165, 0.165, 0.1, 12), toyMaterial(AMMO_INFO[t].color));
      const lid = new THREE.Mesh(G.cylinder(0.13, 0.13, 0.04, 12), toyMaterial(0x6b7380, { rough: 0.35, metal: 0.5 }));
      lid.position.y = 0.15;
      tin.add(box, band, lid);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(G.capsule(0.025, 0.08, 2, 6), toyMaterial(AMMO_INFO[t].color, { metal: 0.4, rough: 0.3 }));
        b.position.set(-0.05 + i * 0.05, 0.22, 0);
        tin.add(b);
      }
      g.add(mergeToVertexColored(tin));
      return g;
    }
    if (kind === 'relic') {
      const m = buildRelicModel(defId);
      m.scale.setScalar(1.6);
      g.add(m);
      return g;
    }
    if (kind === 'perk') {
      const m = buildPerkModel(defId as PerkId);
      m.scale.setScalar(1.5);
      g.add(m);
      return g;
    }
    const m = buildItemModel(defId as HealId | UtilId);
    m.scale.setScalar(1.6);
    g.add(m);
    return g;
  }

  colorOf(p: { kind: LootKind; defId: string; rarity: RarityIndex }) {
    if (p.kind === 'ammo') return AMMO_INFO[p.defId as AmmoType].color;
    if (p.kind === 'perk') return PERKS[p.defId as PerkId].color;
    if (p.kind === 'relic') return SET_BY_ID[RELIC_BY_ID[p.defId]?.set]?.color ?? 0x6ff7ff;
    return RARITY[p.rarity].color;
  }

  spawn(kind: LootKind, defId: string, rarity: RarityIndex, amount: number, pos: THREE.Vector3, vel?: THREE.Vector3, mag?: number, id?: number): Pickup {
    const root = new THREE.Group();
    const model = this.buildModel(kind, defId, rarity);
    root.add(model);
    model.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    const color = this.colorOf({ kind, defId, rarity });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    glow.rotation.x = -Math.PI / 2;
    glow.scale.setScalar(kind === 'weapon' ? 2.4 + rarity * 0.35 : kind === 'relic' ? 2.6 : 1.4);
    root.add(glow);
    // relics get a tall beacon you can spot from across the island
    const bh = kind === 'relic' ? 14 : 2.6 + rarity * 0.5;
    const beam = new THREE.Mesh(
      G.cylinder(kind === 'relic' ? 0.12 : 0.06, kind === 'relic' ? 0.3 : 0.16, bh, 8, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: kind === 'relic' ? 0.5 : 0.18 + rarity * 0.07, side: THREE.DoubleSide }),
    );
    beam.position.y = bh / 2;
    beam.visible = kind === 'relic' || (kind === 'weapon' && rarity >= 1) || (kind !== 'ammo' && rarity >= 2);
    root.add(beam);
    root.position.copy(pos);
    this.scene.add(root);
    const p: Pickup = {
      id: id ?? nextPickupId++, kind, defId, rarity, amount, pos: pos.clone(), vel: vel ? vel.clone() : new THREE.Vector3(), settled: !vel, root, model, glow, beam,
      t: Math.random() * 10, collectT: -1, collector: null, lockUntil: 0, mag: mag ?? (kind === 'weapon' ? WEAPONS[defId].mag : 0),
    };
    this.pickups.push(p);
    return p;
  }

  spawnRolls(rolls: LootRoll[], pos: THREE.Vector3, burst = false) {
    rolls.forEach((r, i) => {
      const a = (i / rolls.length) * Math.PI * 2 + Math.random() * 0.5;
      const vel = burst ? new THREE.Vector3(Math.cos(a) * 2.6, 7 + Math.random() * 2, Math.sin(a) * 2.6) : undefined;
      const p = this.spawn(r.kind, r.defId, r.rarity, r.amount, burst ? pos : pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.6 * i, 0, Math.sin(a) * 0.6 * i)), vel);
      if (burst) p.lockUntil = performance.now() + 450;
    });
  }

  remove(p: Pickup) {
    this.scene.remove(p.root);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /** Burst an eliminated rascal's gear out onto the ground. */
  dropInventory(a: Actor) {
    const base = _v.copy(a.motor.pos).setY(a.motor.pos.y + 1).clone();
    let k = 0;
    const toss = () => {
      const ang = (k++ / 6) * Math.PI * 2 + Math.random();
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
    if (a.healItem && a.healItem.count > 0) this.spawn('heal', a.healItem.id, HEALS[a.healItem.id].rarity, a.healItem.count, base, toss());
    if (a.util && a.util.count > 0) this.spawn('util', a.util.id, UTILS[a.util.id].rarity, a.util.count, base, toss());
    for (const id of a.perks) this.spawn('perk', id, PERKS[id].rarity, 1, base, toss());
    a.perks = [];
    // relics you hadn't sent home yet spill out for someone else to grab
    for (const id of a.relics) {
      const p = this.spawn('relic', id, RELIC_BY_ID[id]?.rarity ?? 0, 1, base, toss());
      p.lockUntil = performance.now() + 600;
    }
    a.relics = [];
    a.applyPerks();
    a.healItem = null;
    a.util = null;
    a.rig.setWeapon(null);
  }

  /** Would this pickup be taken automatically (no button press)? */
  autoFor(a: Actor, p: Pickup) {
    if (p.kind === 'ammo') return true;
    if (p.kind === 'heal') return !a.healItem || (a.healItem.id === p.defId && a.healItem.count < HEALS[p.defId as HealId].maxStack);
    if (p.kind === 'util') return !a.util || (a.util.id === p.defId && a.util.count < UTILS[p.defId as UtilId].maxStack);
    if (p.kind === 'perk') return !a.hasPerk(p.defId as PerkId) && a.perks.length < MAX_PERKS;
    // relics are picked up by the match (it knows who's allowed to carry what)
    return false;
  }

  /** can this rascal scoop up this relic right now? */
  canCarryRelic(a: Actor, p: Pickup) {
    return p.kind === 'relic' && a.alive && !a.downed && !a.bugout && a.flight === 'none' && a.relics.length < MAX_RELICS && p.settled && p.collectT < 0 && p.lockUntil < performance.now();
  }

  /** Best interactable pickup in front of the actor (for the contextual prompt). */
  bestFor(a: Actor, maxDist = 2.4): Pickup | null {
    let best: Pickup | null = null, bestScore = Infinity;
    const eye = a.eyePos(_v2);
    for (const p of this.pickups) {
      if (p.collectT >= 0 || p.lockUntil > performance.now() || !p.settled) continue;
      if (p.kind === 'ammo' || p.kind === 'relic' || (p.kind !== 'weapon' && this.autoFor(a, p))) continue;
      if (p.kind === 'perk' && a.hasPerk(p.defId as PerkId)) continue;
      const d = p.pos.distanceTo(a.motor.pos);
      if (d > maxDist || Math.abs(p.pos.y - a.motor.pos.y) > 1.6) continue;
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

  /** Take a pickup: weapons equip / swap / FUSE, items stack, ammo tops up. */
  collect(a: Actor, p: Pickup, ctx: GameCtx) {
    if (p.collectT >= 0) return;
    const at = _v.copy(p.pos).setY(p.pos.y + 0.4).clone();
    if (p.kind === 'weapon') {
      const res = a.offerWeapon(p.defId, p.rarity, p.mag);
      const w = a.weapons[res.slot]!;
      if (res.dropped) {
        const d = this.spawn('weapon', res.dropped.def.id, res.dropped.rarity, 1, _v.copy(a.motor.pos).setY(a.motor.pos.y + 1), new THREE.Vector3(Math.sin(a.bodyYaw) * -2, 4, Math.cos(a.bodyYaw) * -2), res.dropped.mag);
        d.lockUntil = performance.now() + 800;
      }
      if (res.action === 'fused') {
        const c = RARITY[w.rarity].color;
        ctx.fx.fuseBurst(_v.copy(a.motor.pos).setY(a.motor.pos.y + 1.1), c);
        a.rig.setExpression('wide', 0.8);
        if (a.me) {
          a.me.sfx.fuse();
          a.me.hud.xpPop('+30 FUSION', RARITY[w.rarity].css);
          a.me.hud.bigToast(`FUSED! ${RARITY[w.rarity].name.toUpperCase()} ${w.def.name.toUpperCase()}`, RARITY[w.rarity].css);
          a.me.shake(0.25);
        }
      } else if (a.me) {
        a.me.sfx.pickup(p.rarity);
        a.me.hud.toast(`${RARITY[p.rarity].name.toUpperCase()} ${WEAPONS[p.defId].name.toUpperCase()}`, RARITY[p.rarity].css);
        // epic and mythic finds get a moment
        if (p.rarity >= 3) {
          ctx.fx.fuseBurst(_v.copy(a.motor.pos).setY(a.motor.pos.y + 1.1), RARITY[p.rarity].color);
          a.me.hud.bigToast(`${RARITY[p.rarity].name.toUpperCase()}!`, RARITY[p.rarity].css);
          a.me.shake(0.2);
          a.rig.setExpression('wide', 0.8);
        }
      }
      if (a.me) {
        a.me.hud.slotPulse(res.slot);
        a.me.sfx.equip();
      }
      p.amount = 0;
    } else if (p.kind === 'perk') {
      if (a.hasPerk(p.defId as PerkId)) return;
      const dropped = a.addPerk(p.defId as PerkId);
      if (dropped) {
        const d = this.spawn('perk', dropped, PERKS[dropped].rarity, 1, _v.copy(a.motor.pos).setY(a.motor.pos.y + 1), new THREE.Vector3(Math.sin(a.bodyYaw) * -2, 4, Math.cos(a.bodyYaw) * -2));
        d.lockUntil = performance.now() + 900;
      }
      p.amount = 0;
    } else if (p.kind === 'relic') {
      if (a.relics.length >= MAX_RELICS) return;
      a.relics.push(p.defId);
      ctx.fx.fuseBurst(_v2.copy(p.pos).setY(p.pos.y + 0.6), this.colorOf(p));
      ctx.onRelic?.(a, p.defId);
      p.amount = 0;
    } else if (p.kind === 'ammo') {
      const got = a.addAmmo(p.defId as AmmoType, p.amount);
      p.amount -= got;
      if (a.me && got > 0) {
        a.me.sfx.ammoPickup();
        a.me.hud.toast(`+${got} ${AMMO_INFO[p.defId as AmmoType].name.toUpperCase()}`, AMMO_INFO[p.defId as AmmoType].css);
      }
      if (got === 0) return;
    } else {
      const kind = p.kind === 'heal' ? 'heal' : 'util';
      const cur = kind === 'heal' ? a.healItem : a.util;
      // different item in the slot: drop it and take this one
      if (cur && cur.id !== p.defId && cur.count > 0) {
        const def = kind === 'heal' ? HEALS[cur.id as HealId] : UTILS[cur.id as UtilId];
        const d = this.spawn(p.kind, cur.id, def.rarity, cur.count, _v.copy(a.motor.pos).setY(a.motor.pos.y + 1), new THREE.Vector3(Math.sin(a.bodyYaw) * -2, 4, Math.cos(a.bodyYaw) * -2));
        d.lockUntil = performance.now() + 900;
        if (kind === 'heal') a.healItem = null;
        else a.util = null;
      }
      const left = a.addItem(kind, p.defId, p.amount);
      if (left === p.amount) return;
      p.amount = left;
      if (a.me) {
        a.me.sfx.pickup(p.rarity);
        const name = kind === 'heal' ? HEALS[p.defId as HealId].name : UTILS[p.defId as UtilId].name;
        a.me.hud.toast(name.toUpperCase(), RARITY[p.rarity].css);
        a.me.hud.slotPulse(kind === 'heal' ? 4 : 3);
      }
    }
    if (p.amount > 0) return; // partially taken; leave the rest on the floor
    p.collectT = 0;
    p.collector = a;
    ctx.fx.pickupSparkle(at, this.colorOf(p));
  }

  /* ------------------------------------------------------------------ crates */

  placeCrate(pos: THREE.Vector3, yaw: number, id?: number): Crate {
    const { root, lid, lock, lights } = buildCrate();
    root.position.copy(pos);
    root.rotation.y = yaw;
    this.scene.add(root);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffd36b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.x, pos.y + 0.03, pos.z);
    this.scene.add(glow);
    const collider = this.cw.box(pos.x, pos.y + 0.45, pos.z, 1.3, 0.9, 0.85, 'wood', yaw, 0, 0, ColFlags.BlocksMove | ColFlags.BlocksBullets | ColFlags.BlocksBug);
    const crate: Crate = { id: id ?? nextCrateId++, root, lid, lock, lights, pos: pos.clone(), yaw, opened: false, openT: -1, opener: null, collider, lidV: 0, lidA: 0, glow, t: Math.random() * 5 };
    this.crates.push(crate);
    return crate;
  }

  /** remove a crate completely (event crates between matches) */
  removeCrate(c: Crate) {
    this.scene.remove(c.root, c.glow);
    c.collider.enabled = false;
    const i = this.crates.indexOf(c);
    if (i >= 0) this.crates.splice(i, 1);
  }

  crateFor(a: Actor, maxDist = 2.3): Crate | null {
    let best: Crate | null = null, bd = maxDist;
    for (const c of this.crates) {
      if (c.opened || c.openT >= 0) continue;
      const d = c.pos.distanceTo(a.motor.pos);
      if (d < bd && Math.abs(c.pos.y - a.motor.pos.y) < 1.5) {
        best = c;
        bd = d;
      }
    }
    return best;
  }

  openCrate(c: Crate, a: Actor) {
    if (c.opened || c.openT >= 0) return;
    c.openT = 0;
    c.opener = a;
    audio.crateShake(c.pos);
  }

  resetCrates() {
    for (const c of this.crates) {
      c.opened = false;
      c.openT = -1;
      c.lidA = 0;
      c.lidV = 0;
      c.lid.rotation.x = 0;
      c.lock.visible = true;
      c.glow.visible = true;
    }
  }

  private updateCrates(dt: number, ctx: GameCtx) {
    const local = ctx.localActor;
    const cam = ctx.camera.position;
    for (const c of this.crates) {
      c.t += dt;
      c.root.visible = c.pos.distanceToSquared(cam) < (75 * detail.cull) ** 2;
      if (!c.root.visible) continue;
      // blinking lights & idle hum
      c.lights.forEach((l, i) => {
        const on = c.opened ? 0.2 : 0.55 + Math.sin(c.t * 6 + i * 2) * 0.2;
        (l.material as THREE.MeshBasicMaterial).color.setHSL((c.t * 0.3 + i * 0.25) % 1, 0.9, on);
      });
      if (!c.opened) {
        (c.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(c.t * 3) * 0.15;
        if (local && local.alive && c.openT < 0 && c.pos.distanceTo(local.motor.pos) < 12) {
          this.hum -= dt;
          if (this.hum <= 0) {
            this.hum = 1.4;
            audio.crateHum(c.pos);
          }
          if (Math.random() < dt * 6) ctx.fx.glow.emit(_v.set(c.pos.x + (Math.random() - 0.5) * 1.4, c.pos.y + 0.9, c.pos.z + (Math.random() - 0.5) * 0.9), { count: 1, color: [0xffd36b, 0xffffff], speed: 0.3, up: 0.8, life: 0.8, size: 0.08, shape: PShape.Sparkle });
        }
      }
      // opening sequence: lock rattles (anticipation) -> lid bursts -> loot jumps out
      if (c.openT >= 0 && !c.opened) {
        c.openT += dt;
        const k = c.openT / 0.55;
        c.lock.rotation.z = Math.sin(c.openT * 60) * 0.35 * k;
        c.root.scale.set(1 + Math.sin(c.openT * 50) * 0.03 * k, 1 - k * 0.08, 1 + Math.sin(c.openT * 50) * 0.03 * k);
        if (k >= 1) {
          c.opened = true;
          c.root.scale.setScalar(1);
          c.lock.visible = false;
          c.lidV = -16;
          c.glow.visible = false;
          const top = _v.copy(c.pos).setY(c.pos.y + 1).clone();
          audio.crateOpen(c.pos);
          ctx.fx.glow.emit(top, { count: 56, color: [0xffd36b, 0xffffff, PAL.pink, PAL.turquoise], speed: [4, 10], spread: 0.6, dir: new THREE.Vector3(0, 1, 0), life: [0.5, 1.1], size: [0.14, 0.3], shape: PShape.Star, drag: 2, spin: 10 });
          ctx.fx.glow.emit(top, { count: 2, color: 0xfff6c0, speed: 0, life: 0.2, size: 3.2, sizeEnd: 1.2, alpha: 0.8 });
          ctx.fx.soft.emit(top, { count: 50, color: [PAL.mustard, PAL.pink, PAL.turquoise, 0xffffff], speed: [3, 9], spread: 1, up: 5, gravity: 9, life: [1.2, 2.2], size: [0.09, 0.14], shape: PShape.Confetti, spin: 14 });
          ctx.fx.ring(c.pos.clone().setY(c.pos.y + 0.1), 0xffd36b, 0.3, 4.2, 0.5);
          ctx.fx.ring(top, 0xffffff, 0.2, 2.4, 0.35, undefined, true);
          ctx.fx.lightFlash(top, 0xffd36b, 14, 0.45);
          c.opener?.me?.shake(0.3);
          c.opener?.me?.hud.xpPop('+10 CRATE', '#f2c14e');
          if (!c.netOnly) {
            const rolls = rollCrate(!!c.rich);
            if (c.relic) rolls.push({ kind: 'relic', defId: c.relic, rarity: RELIC_BY_ID[c.relic]?.rarity ?? 0, amount: 1 });
            this.spawnRolls(rolls, top, true);
          }
          ctx.emitSound({ pos: c.pos.clone(), loudness: 20, source: c.opener, kind: 'impact' });
        }
      }
      if (c.opened) {
        c.lidV += (-(c.lidA + 1.9) * 90 - c.lidV * 7) * dt;
        c.lidA += c.lidV * dt;
        c.lid.rotation.x = c.lidA;
      }
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number, ctx: GameCtx) {
    this.updateCrates(dt, ctx);
    const local = ctx.localActor;
    let nearestRare = Infinity;
    let rareP: Pickup | null = null;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      if (p.collectT >= 0) {
        p.collectT += dt / 0.2;
        const c = p.collector!;
        const target = _v.copy(c.motor.pos).setY(c.motor.pos.y + 1.0);
        p.root.position.lerp(target, Math.min(1, p.collectT * 1.4));
        p.root.scale.setScalar(Math.max(0.01, 1 - p.collectT));
        ctx.fx.glow.emit(p.root.position, { count: 1, color: this.colorOf(p), speed: 0.3, life: 0.2, size: 0.12, shape: PShape.Sparkle });
        if (p.collectT >= 1) this.remove(p);
        continue;
      }
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
      // distance cull (glow + beam + model are 3 draw calls per item)
      const camD = p.pos.distanceToSquared(ctx.camera.position);
      p.root.visible = camD < (p.kind === 'relic' ? 160 : 60 * detail.cull) ** 2;
      p.glow.visible = camD < (30 * detail.cull) ** 2;
      if (!p.root.visible) continue;
      p.beam.visible = camD > 3 * 3 && (p.kind === 'relic' || (p.kind === 'weapon' && p.rarity >= 1) || (p.kind !== 'ammo' && p.rarity >= 2));
      const bob = p.settled ? Math.sin(p.t * 2.2) * 0.08 + 0.35 : 0;
      p.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      p.model.position.y = bob;
      p.model.rotation.y = p.t * 1.1;
      p.model.rotation.z = Math.sin(p.t * 1.3) * 0.12;
      p.glow.position.y = 0.03 - (p.settled ? 0.14 : 0);
      (p.glow.material as THREE.MeshBasicMaterial).opacity = 0.65 * (0.85 + Math.sin(p.t * 3) * 0.15);
      p.beam.scale.set(1, 0.9 + Math.sin(p.t * 2) * 0.1, 1);
      if (p.rarity === 4 && Math.random() < dt * 8) ctx.fx.glow.emit(_v.copy(p.pos).setY(p.pos.y + 0.4 + Math.random()), { count: 1, color: [0xffd36b, 0xffffff], speed: 0.3, up: 0.6, life: 0.7, size: 0.1, shape: PShape.Star });

      if (!local || !local.alive) continue;
      const d = p.pos.distanceTo(local.motor.pos);
      if (d < 7 && Math.random() < dt * (p.kind === 'weapon' ? 10 : 4)) {
        const a = Math.random() * Math.PI * 2;
        const src = _v.set(p.pos.x + Math.cos(a) * 1.2, p.pos.y + 0.2 + Math.random() * 0.8, p.pos.z + Math.sin(a) * 1.2);
        ctx.fx.glow.emit(src, { count: 1, color: [this.colorOf(p), 0xffffff], speed: 0.2, life: [0.5, 0.8], size: [0.05, 0.09], shape: PShape.Sparkle, attract: p.pos.clone().setY(p.pos.y + 0.4), drag: 4 });
      }
      if (p.kind === 'weapon' && p.rarity >= 2 && d < nearestRare) {
        nearestRare = d;
        rareP = p;
      }
      // auto-collect ammo & stackable consumables
      if (d < 1.4 && p.settled && p.lockUntil < performance.now() && this.autoFor(local, p)) this.collect(local, p, ctx);
    }
    this.hum -= dt;
    if (rareP && nearestRare < 10 && this.hum <= 0) {
      this.hum = 1.2;
      audio.crateHum(rareP.pos);
    }
  }

  /** Default loot model colour for UI chips. */
  static itemColor(kind: LootKind, id: string) {
    if (kind === 'heal' || kind === 'util') return ITEM_COLOR[id as HealId | UtilId];
    if (kind === 'perk') return PERKS[id as PerkId].color;
    return 0xffffff;
  }
}
