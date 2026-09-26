import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { PAL, RarityIndex, RARITY } from '../render/Palette';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeToVertexColored } from '../render/Merge';
import { G } from '../render/Detail';

export type AmmoType = 'light' | 'medium' | 'heavy' | 'shells' | 'bolts';
export type SoundProfile = 'pop' | 'rifle' | 'heavy' | 'smg' | 'shotgun' | 'needle' | 'bow' | 'pepper' | 'zap' | 'lob' | 'gloop';

export const AMMO_INFO: Record<AmmoType, { name: string; color: number; css: string; pickup: number; max: number }> = {
  light: { name: 'Pebbles', color: 0x7fb7e6, css: '#7fb7e6', pickup: 48, max: 240 },
  medium: { name: 'Bottlecaps', color: 0xf2c14e, css: '#f2c14e', pickup: 42, max: 240 },
  heavy: { name: 'Bolts', color: 0xd9774f, css: '#d9774f', pickup: 14, max: 60 },
  shells: { name: 'Corks', color: 0xf28fad, css: '#f28fad', pickup: 14, max: 60 },
  bolts: { name: 'Sparks', color: 0x6ff7ff, css: '#6ff7ff', pickup: 10, max: 40 },
};

export interface WeaponDef {
  id: string;
  name: string;
  short: string;
  mode: 'auto' | 'semi' | 'burst';
  rpm: number;
  /** burst: shots per trigger pull, fired at burstRpm */
  burst?: number;
  burstRpm?: number;
  damage: number;
  headMult: number;
  mag: number;
  reload: number;
  ammo: AmmoType;
  pellets: number;
  spreadHip: number; // degrees
  spreadAds: number;
  spreadMove: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  minDamageMul: number;
  recoilPitch: number;
  recoilYaw: number;
  camKick: number;
  adsFov: number;
  tracer: number;
  sound: SoundProfile;
  hold: 'rifle' | 'pistol';
  /** physical projectile instead of hitscan */
  projectile?: {
    speed: number;
    gravity: number;
    /** what flies: a bolt, a pumpkin that bursts, or a blob of gloop */
    style?: 'bolt' | 'pumpkin' | 'gloop';
    /** bursts on impact: damage at the centre and radius */
    explode?: { dmg: number; r: number };
    /** gloops whoever it hits: speed multiplier and seconds */
    slow?: { k: number; t: number };
  };
  /** electricity: a hit arcs on to the nearest other rascal nearby */
  chain?: { range: number; mul: number };
  /** pushes targets (and the shooter, a bit) */
  knockback?: number;
  /** preferred engagement range for bots */
  botRange: [number, number];
  /** base loot weight */
  weight: number;
  blurb: string;
}

/** Rarity scales damage & handling a little — never enough that a grey gun is useless. */
export const RARITY_DAMAGE = [1, 1.06, 1.12, 1.18, 1.26];
export const RARITY_RELOAD = [1, 0.95, 0.9, 0.85, 0.78];
export const RARITY_SPREAD = [1, 0.95, 0.9, 0.85, 0.8];

const W = (d: Omit<WeaponDef, 'pellets' | 'bloomMax' | 'bloomRecover' | 'minDamageMul'> & Partial<Pick<WeaponDef, 'pellets' | 'bloomMax' | 'bloomRecover' | 'minDamageMul'>>): WeaponDef => ({
  pellets: 1,
  bloomMax: 3,
  bloomRecover: 7,
  minDamageMul: 0.65,
  ...d,
});

export const WEAPONS: Record<string, WeaponDef> = {
  poppistol: W({
    id: 'poppistol', name: 'Poppistol', short: 'POPPISTOL', mode: 'semi', rpm: 400, damage: 21, headMult: 1.8, mag: 12, reload: 1.25, ammo: 'light',
    spreadHip: 1.5, spreadAds: 0.45, spreadMove: 1.0, bloomPerShot: 0.5, range: 100, falloffStart: 20, falloffEnd: 55, recoilPitch: 1.1, recoilYaw: 0.4, camKick: 0.12,
    adsFov: 56, tracer: 0xfff0a0, sound: 'pop', hold: 'pistol', botRange: [0, 30], weight: 10, blurb: 'Reliable. Goes pop.',
  }),
  rattle: W({
    id: 'rattle', name: 'Rattle SMG', short: 'RATTLE', mode: 'auto', rpm: 780, damage: 10, headMult: 1.5, mag: 32, reload: 1.7, ammo: 'light',
    spreadHip: 3.4, spreadAds: 1.8, spreadMove: 0.8, bloomPerShot: 0.35, bloomMax: 3.5, bloomRecover: 9, range: 70, falloffStart: 10, falloffEnd: 32, minDamageMul: 0.5,
    recoilPitch: 0.45, recoilYaw: 0.55, camKick: 0.08, adsFov: 60, tracer: 0xffe6a0, sound: 'smg', hold: 'rifle', botRange: [0, 16], weight: 8, blurb: 'Brrrrattle.',
  }),
  broomstick: W({
    id: 'broomstick', name: 'Broomstick', short: 'BROOMSTICK', mode: 'semi', rpm: 68, damage: 10, headMult: 1.4, mag: 5, reload: 2.3, ammo: 'shells', pellets: 9,
    spreadHip: 5.8, spreadAds: 4.3, spreadMove: 0.6, bloomPerShot: 0, range: 40, falloffStart: 5, falloffEnd: 18, minDamageMul: 0.25,
    recoilPitch: 4.5, recoilYaw: 1.2, camKick: 0.55, adsFov: 62, tracer: 0xffd27a, sound: 'shotgun', hold: 'rifle', knockback: 2.5, botRange: [0, 9], weight: 8, blurb: 'Sweeps the room.',
  }),
  tincan: W({
    id: 'tincan', name: 'Tin Can Rifle', short: 'TIN CAN', mode: 'auto', rpm: 360, damage: 16, headMult: 1.6, mag: 26, reload: 1.9, ammo: 'medium',
    spreadHip: 2.4, spreadAds: 0.55, spreadMove: 1.6, bloomPerShot: 0.45, bloomMax: 3.2, range: 140, falloffStart: 30, falloffEnd: 80,
    recoilPitch: 0.75, recoilYaw: 0.35, camKick: 0.14, adsFov: 48, tracer: 0xffd27a, sound: 'rifle', hold: 'rifle', botRange: [5, 40], weight: 10, blurb: 'Soup, but deadly.',
  }),
  needler: W({
    id: 'needler', name: 'Needler', short: 'NEEDLER', mode: 'semi', rpm: 130, damage: 36, headMult: 2.0, mag: 8, reload: 2.2, ammo: 'heavy',
    spreadHip: 2.8, spreadAds: 0.08, spreadMove: 2.5, bloomPerShot: 1.2, bloomRecover: 5, range: 200, falloffStart: 60, falloffEnd: 150, minDamageMul: 0.8,
    recoilPitch: 2.4, recoilYaw: 0.3, camKick: 0.2, adsFov: 30, tracer: 0xff9ad5, sound: 'needle', hold: 'rifle', botRange: [15, 80], weight: 6, blurb: 'Knits holes at range.',
  }),
  thumper: W({
    id: 'thumper', name: 'Thumper', short: 'THUMPER', mode: 'semi', rpm: 48, damage: 58, headMult: 1.3, mag: 1, reload: 1.5, ammo: 'heavy',
    spreadHip: 1.2, spreadAds: 0.5, spreadMove: 1.2, bloomPerShot: 0, range: 70, falloffStart: 15, falloffEnd: 45, minDamageMul: 0.5,
    recoilPitch: 7, recoilYaw: 1.5, camKick: 0.8, adsFov: 58, tracer: 0xffb36b, sound: 'heavy', hold: 'rifle', knockback: 11, botRange: [0, 20], weight: 5, blurb: 'THUMP. Bye.',
  }),
  sparkbow: W({
    id: 'sparkbow', name: 'Sparkbow', short: 'SPARKBOW', mode: 'semi', rpm: 75, damage: 52, headMult: 1.9, mag: 1, reload: 0.85, ammo: 'bolts',
    spreadHip: 1.0, spreadAds: 0.0, spreadMove: 1.0, bloomPerShot: 0, range: 160, falloffStart: 999, falloffEnd: 1000, minDamageMul: 1,
    recoilPitch: 1.6, recoilYaw: 0.2, camKick: 0.18, adsFov: 40, tracer: 0x6ff7ff, sound: 'bow', hold: 'rifle', projectile: { speed: 68, gravity: 9 }, botRange: [10, 50], weight: 5, blurb: 'Lead your target.',
  }),
  pepperbox: W({
    id: 'pepperbox', name: 'Pepperbox', short: 'PEPPERBOX', mode: 'burst', burst: 3, burstRpm: 720, rpm: 150, damage: 14, headMult: 1.6, mag: 18, reload: 1.8, ammo: 'light',
    spreadHip: 1.9, spreadAds: 0.7, spreadMove: 1.1, bloomPerShot: 0.3, range: 90, falloffStart: 18, falloffEnd: 45,
    recoilPitch: 0.9, recoilYaw: 0.6, camKick: 0.12, adsFov: 54, tracer: 0xffc4e0, sound: 'pepper', hold: 'pistol', botRange: [0, 25], weight: 7, blurb: 'Six barrels, no plan.',
  }),
  zapcoil: W({
    id: 'zapcoil', name: 'Zapcoil', short: 'ZAPCOIL', mode: 'auto', rpm: 560, damage: 9, headMult: 1.3, mag: 30, reload: 2.0, ammo: 'medium',
    spreadHip: 2.4, spreadAds: 1.1, spreadMove: 0.8, bloomPerShot: 0.25, bloomMax: 2.5, range: 48, falloffStart: 12, falloffEnd: 30, minDamageMul: 0.55,
    recoilPitch: 0.35, recoilYaw: 0.3, camKick: 0.06, adsFov: 60, tracer: 0x8ff7ff, sound: 'zap', hold: 'rifle', chain: { range: 7, mul: 0.6 },
    botRange: [0, 20], weight: 5, blurb: 'Hits one. Zaps the next.',
  }),
  boomkin: W({
    id: 'boomkin', name: 'Boomkin', short: 'BOOMKIN', mode: 'semi', rpm: 75, damage: 18, headMult: 1, mag: 3, reload: 2.6, ammo: 'heavy',
    spreadHip: 1.6, spreadAds: 0.6, spreadMove: 1.2, bloomPerShot: 0, range: 120, falloffStart: 999, falloffEnd: 1000, minDamageMul: 1,
    recoilPitch: 4, recoilYaw: 0.8, camKick: 0.45, adsFov: 56, tracer: 0xff9a3c, sound: 'lob', hold: 'rifle',
    projectile: { speed: 30, gravity: 16, style: 'pumpkin', explode: { dmg: 58, r: 3.8 } }, botRange: [8, 34], weight: 3, blurb: 'Lobs grumpy pumpkins.',
  }),
  gloopgun: W({
    id: 'gloopgun', name: 'Gloop Gun', short: 'GLOOP', mode: 'semi', rpm: 250, damage: 17, headMult: 1.5, mag: 10, reload: 1.9, ammo: 'light',
    spreadHip: 1.5, spreadAds: 0.35, spreadMove: 1.0, bloomPerShot: 0.4, range: 90, falloffStart: 999, falloffEnd: 1000, minDamageMul: 1,
    recoilPitch: 1.2, recoilYaw: 0.4, camKick: 0.12, adsFov: 54, tracer: 0x9dff6b, sound: 'gloop', hold: 'pistol',
    projectile: { speed: 46, gravity: 11, style: 'gloop', slow: { k: 0.55, t: 1.6 } }, botRange: [0, 28], weight: 5, blurb: 'Sticky blobs. Slows rascals.',
  }),
};

export const WEAPON_IDS = Object.keys(WEAPONS);

export interface WeaponStats {
  damage: number;
  rate: number;
  range: number;
  mag: number;
  handling: number;
}

/** Normalised (0..1) stats for the comparison card. */
export function weaponStats(def: WeaponDef, rarity: RarityIndex): WeaponStats {
  const dmg = (def.projectile?.explode ? def.projectile.explode.dmg : def.damage * (def.chain ? 1 + def.chain.mul * 0.5 : 1)) * def.pellets * RARITY_DAMAGE[rarity] * (def.pellets > 1 ? 0.8 : 1);
  const rps = def.mode === 'burst' ? def.burst! / ((def.burst! - 1) * (60 / def.burstRpm!) + 60 / def.rpm) : def.rpm / 60;
  const dps = dmg * rps;
  return {
    damage: Math.min(1, dmg / 85),
    rate: Math.min(1, dps / 115),
    range: Math.min(1, (def.falloffEnd > 500 ? 150 : def.falloffEnd) / 150),
    mag: Math.min(1, def.mag / 32),
    handling: Math.max(0.05, Math.min(1, 1 - ((def.spreadHip + def.recoilPitch * 0.8) * RARITY_SPREAD[rarity]) / 9)),
  };
}

export class WeaponInstance {
  mag: number;
  bloom = 0;
  cooldown = 0;
  reloadT = -1;
  burstLeft = 0;
  constructor(public def: WeaponDef, public rarity: RarityIndex) {
    this.mag = def.mag;
  }
  get damage() {
    return this.def.damage * RARITY_DAMAGE[this.rarity];
  }
  get reloadTime() {
    return this.def.reload * RARITY_RELOAD[this.rarity];
  }
  get reloading() {
    return this.reloadT >= 0;
  }
  /** a rough "how good is this" score for bots / the UP arrow */
  get score() {
    return this.rarity * 10 + this.def.weight;
  }
}

/* ------------------------------------------------------------------ view models */

function rbox(w: number, h: number, d: number, r: number) {
  return G.rbox(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}

export interface WeaponView {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  gripR: THREE.Vector3;
  gripL: THREE.Vector3;
  mag: THREE.Object3D;
  flash: THREE.Mesh;
  /** rotating barrel cluster (Pepperbox) */
  spinner?: THREE.Object3D;
  /** loaded projectile shown on the weapon (Sparkbow) */
  loaded?: THREE.Object3D;
}

type Part = [THREE.BufferGeometry, THREE.Material, number, number, number, number?, number?, number?];

/**
 * Chunky, hand-made-looking weapons. Static parts merge into one mesh; only moving bits
 * (magazine, spinner, loaded bolt, muzzle flash) stay separate.
 */
export function buildWeaponView(def: WeaponDef, rarity: RarityIndex): WeaponView {
  const g = new THREE.Group();
  const stat = new THREE.Group();
  const mag = new THREE.Group();
  const m = {
    wood: toyMaterial(PAL.wood, { rough: 0.7 }),
    woodL: toyMaterial(PAL.woodLight, { rough: 0.7 }),
    woodD: toyMaterial(PAL.brownDark, { rough: 0.7 }),
    tin: toyMaterial(0xc9d2dc, { rough: 0.35, metal: 0.6 }),
    iron: toyMaterial(0x5a6270, { rough: 0.4, metal: 0.6 }),
    brass: toyMaterial(0xd9a441, { rough: 0.3, metal: 0.7 }),
    copper: toyMaterial(0xd98b4f, { rough: 0.4, metal: 0.5 }),
    tape: toyMaterial([0xe8e8e8, 0x5fe067, 0x49a8ff, 0xc160ff, 0xffa726][rarity], { rough: 0.5 }),
    red: toyMaterial(PAL.terracotta, { rough: 0.6 }),
    teal: toyMaterial(PAL.teal, { rough: 0.55 }),
    mustard: toyMaterial(PAL.mustard, { rough: 0.55 }),
    pink: toyMaterial(PAL.pink, { rough: 0.7 }),
    straw: toyMaterial(0xe6c46a, { rough: 0.9 }),
    ink: toyMaterial(PAL.ink, { rough: 0.5 }),
  };
  const P = (parent: THREE.Object3D, parts: Part[]) => {
    for (const [geo, mat, x, y, z, rx = 0, ry = 0, rz = 0] of parts) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
    }
  };
  const cyl = (rt: number, rb: number, h: number, s = 12) => G.cylinder(rt, rb, h, s);
  const HALF = Math.PI / 2;
  let muzzleZ = -0.8, muzzleY = 0.03;
  let gripR = new THREE.Vector3(0, -0.1, 0.05), gripL = new THREE.Vector3(0, -0.02, -0.4);
  let spinner: THREE.Object3D | undefined;
  let loaded: THREE.Object3D | undefined;

  switch (def.id) {
    case 'tincan':
      P(stat, [
        [rbox(0.12, 0.14, 0.42, 0.04), m.woodD, 0, 0, -0.05],
        [rbox(0.1, 0.16, 0.3, 0.05), m.wood, 0, -0.03, 0.27, -0.12],
        [rbox(0.115, 0.17, 0.05, 0.02), m.tape, 0, -0.03, 0.2, -0.12],
        [cyl(0.03, 0.03, 0.5, 10), m.copper, 0, 0.03, -0.48, HALF],
        [cyl(0.045, 0.04, 0.07, 10), m.tin, 0, 0.03, -0.74, HALF],
        [cyl(0.03, 0.035, 0.02, 10), m.tape, 0, 0.09, -0.1],
        [rbox(0.07, 0.14, 0.07, 0.03), m.wood, 0, -0.1, 0.05, 0.3],
      ]);
      P(mag, [
        [cyl(0.09, 0.09, 0.11, 14), m.tin, 0, 0, 0, 0, 0, HALF],
        [cyl(0.093, 0.093, 0.06, 14), m.red, 0, 0, 0, 0, 0, HALF],
      ]);
      mag.position.set(0, -0.12, -0.12);
      break;
    case 'poppistol':
      P(stat, [
        [rbox(0.09, 0.12, 0.3, 0.04), m.teal, 0, 0.02, -0.1],
        [rbox(0.08, 0.17, 0.09, 0.035), m.woodL, 0, -0.1, 0.03, 0.25],
        [rbox(0.085, 0.03, 0.1, 0.012), m.tape, 0, -0.06, 0.02, 0.25],
        [cyl(0.03, 0.032, 0.16, 12), m.tin, 0, 0.04, -0.3, HALF],
        [cyl(0.042, 0.042, 0.04, 12), m.red, 0, 0.04, -0.38, HALF],
        [rbox(0.03, 0.05, 0.04, 0.012), m.ink, 0, 0.1, 0.03, -0.3],
        [G.torus(0.035, 0.009, 6, 12), m.ink, 0, -0.04, -0.07, 0, HALF],
      ]);
      P(mag, [[rbox(0.06, 0.08, 0.06, 0.02), m.tin, 0, 0, 0]]);
      mag.position.set(0, -0.17, 0.05);
      muzzleZ = -0.42;
      muzzleY = 0.04;
      gripR = new THREE.Vector3(0, -0.12, 0.03);
      gripL = new THREE.Vector3(-0.04, -0.15, 0.0);
      break;
    case 'rattle':
      P(stat, [
        [rbox(0.12, 0.13, 0.36, 0.05), m.mustard, 0, 0, -0.08],
        [rbox(0.08, 0.15, 0.08, 0.03), m.woodD, 0, -0.11, 0.05, 0.25],
        [rbox(0.08, 0.12, 0.08, 0.03), m.woodD, 0, -0.1, -0.2, -0.1],
        [cyl(0.035, 0.035, 0.2, 10), m.iron, 0, 0.02, -0.34, HALF],
        [cyl(0.048, 0.048, 0.12, 10), m.tin, 0, 0.02, -0.36, HALF], // cooling sleeve
        [rbox(0.04, 0.04, 0.2, 0.015), m.ink, 0, 0.08, 0.2], // wire stock
        [rbox(0.1, 0.1, 0.03, 0.015), m.ink, 0, 0.03, 0.3],
        [rbox(0.125, 0.03, 0.1, 0.012), m.tape, 0, 0.0, 0.02],
      ]);
      // a baby-rattle drum on the side (that's the name)
      P(mag, [
        [G.sphere(0.075, 14, 10), m.pink, 0, 0, 0],
        [G.torus(0.076, 0.012, 6, 16), m.mustard, 0, 0, 0, HALF],
      ]);
      mag.position.set(0.08, -0.02, -0.08);
      muzzleZ = -0.48;
      muzzleY = 0.02;
      gripL = new THREE.Vector3(0, -0.12, -0.2);
      break;
    case 'broomstick':
      P(stat, [
        [cyl(0.03, 0.035, 0.75, 10), m.woodL, 0, 0.0, -0.05, HALF], // broom handle
        [cyl(0.075, 0.1, 0.22, 12), m.straw, 0, -0.02, 0.35, HALF], // bristles as stock
        [cyl(0.08, 0.08, 0.04, 12), m.red, 0, -0.02, 0.24, HALF],
        [cyl(0.034, 0.034, 0.34, 10), m.brass, -0.036, 0.03, -0.36, HALF], // double barrels
        [cyl(0.034, 0.034, 0.34, 10), m.brass, 0.036, 0.03, -0.36, HALF],
        [rbox(0.13, 0.07, 0.06, 0.02), m.iron, 0, 0.03, -0.53],
        [rbox(0.1, 0.1, 0.16, 0.03), m.woodD, 0, -0.03, -0.12],
        [rbox(0.105, 0.03, 0.17, 0.01), m.tape, 0, -0.03, -0.12],
        [rbox(0.07, 0.14, 0.07, 0.03), m.woodD, 0, -0.1, 0.06, 0.3],
      ]);
      P(mag, [[rbox(0.07, 0.05, 0.12, 0.02), m.pink, 0, 0, 0]]); // cork pouch
      mag.position.set(0.07, -0.02, -0.1);
      muzzleZ = -0.56;
      gripL = new THREE.Vector3(0, -0.04, -0.34);
      break;
    case 'needler':
      P(stat, [
        [rbox(0.09, 0.11, 0.5, 0.04), m.woodD, 0, 0, -0.05],
        [rbox(0.08, 0.15, 0.24, 0.05), m.wood, 0, -0.03, 0.3, -0.1],
        [cyl(0.012, 0.018, 0.6, 8), m.tin, 0, 0.02, -0.6, HALF], // knitting needle
        [G.sphere(0.02, 8, 6), m.pink, 0, 0.02, -0.3],
        [cyl(0.035, 0.035, 0.26, 12), m.brass, 0, 0.12, -0.07, HALF], // spyglass scope
        [cyl(0.045, 0.04, 0.05, 12), m.brass, 0, 0.12, -0.21, HALF],
        [cyl(0.02, 0.02, 0.05, 6), m.iron, 0, 0.07, -0.07],
        [rbox(0.07, 0.14, 0.07, 0.03), m.wood, 0, -0.1, 0.07, 0.3],
        [rbox(0.095, 0.03, 0.06, 0.012), m.tape, 0, 0.0, 0.18],
      ]);
      P(mag, [[G.sphere(0.06, 12, 10), m.pink, 0, 0, 0]]); // yarn ball
      mag.position.set(0, -0.1, -0.15);
      muzzleZ = -0.92;
      muzzleY = 0.02;
      gripL = new THREE.Vector3(0, -0.04, -0.34);
      break;
    case 'thumper': {
      const bell = G.cylinder(0.14, 0.06, 0.22, 16, 1, true);
      P(stat, [
        [rbox(0.14, 0.15, 0.36, 0.05), m.wood, 0, 0, -0.02],
        [cyl(0.065, 0.07, 0.4, 14), m.iron, 0, 0.03, -0.36, HALF],
        [bell, m.brass, 0, 0.03, -0.63, -HALF],
        [cyl(0.075, 0.075, 0.04, 14), m.brass, 0, 0.03, -0.24, HALF],
        [cyl(0.075, 0.075, 0.04, 14), m.brass, 0, 0.03, -0.44, HALF],
        [rbox(0.1, 0.17, 0.28, 0.05), m.woodD, 0, -0.05, 0.28, -0.15],
        [rbox(0.08, 0.15, 0.08, 0.03), m.woodD, 0, -0.12, 0.06, 0.3],
        [rbox(0.145, 0.03, 0.2, 0.012), m.tape, 0, 0.0, -0.02],
      ]);
      (bell as THREE.BufferGeometry).computeVertexNormals();
      (stat.children[2] as THREE.Mesh).material = toyMaterial(0xd9a441, { rough: 0.3, metal: 0.7 });
      ((stat.children[2] as THREE.Mesh).material as THREE.Material).side = THREE.DoubleSide;
      P(mag, [[G.sphere(0.055, 10, 8), m.iron, 0, 0, 0]]);
      mag.position.set(0, 0.12, 0.02);
      muzzleZ = -0.76;
      gripL = new THREE.Vector3(0, -0.06, -0.34);
      break;
    }
    case 'sparkbow':
      P(stat, [
        [rbox(0.08, 0.1, 0.62, 0.035), m.wood, 0, 0, -0.1],
        [rbox(0.08, 0.15, 0.22, 0.05), m.woodD, 0, -0.03, 0.28, -0.12],
        [rbox(0.5, 0.035, 0.05, 0.015), m.woodL, -0.14, 0.02, -0.36, 0, 0.35], // limbs swept back
        [rbox(0.5, 0.035, 0.05, 0.015), m.woodL, 0.14, 0.02, -0.36, 0, -0.35],
        [rbox(0.08, 0.14, 0.07, 0.03), m.woodD, 0, -0.1, 0.06, 0.3],
        [rbox(0.085, 0.03, 0.1, 0.012), m.tape, 0, 0.0, 0.12],
        [cyl(0.004, 0.004, 0.48, 4), m.ink, -0.2, 0.02, -0.2, 0, 0, HALF - 0.55], // string
        [cyl(0.004, 0.004, 0.48, 4), m.ink, 0.2, 0.02, -0.2, 0, 0, -HALF + 0.55],
      ]);
      {
        const bolt = new THREE.Group();
        const shaft = new THREE.Mesh(cyl(0.012, 0.012, 0.5, 6), m.woodL);
        shaft.rotation.x = HALF;
        const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshBasicMaterial({ color: PAL.blink }));
        tip.position.z = -0.27;
        tip.scale.set(0.8, 0.8, 1.8);
        bolt.add(shaft, tip);
        bolt.position.set(0, 0.07, -0.25);
        g.add(bolt);
        loaded = bolt;
      }
      mag.position.set(0, -0.1, 0);
      muzzleZ = -0.55;
      muzzleY = 0.07;
      gripL = new THREE.Vector3(0, -0.04, -0.3);
      break;
    case 'pepperbox': {
      P(stat, [
        [rbox(0.09, 0.12, 0.18, 0.04), m.red, 0, 0.02, -0.04],
        [rbox(0.08, 0.17, 0.09, 0.035), m.woodL, 0, -0.1, 0.05, 0.3],
        [rbox(0.085, 0.03, 0.1, 0.012), m.tape, 0, -0.06, 0.04, 0.3],
        [G.torus(0.035, 0.009, 6, 12), m.ink, 0, -0.04, -0.04, 0, HALF],
        [cyl(0.02, 0.02, 0.06, 8), m.brass, 0, 0.03, -0.14, HALF],
      ]);
      const sp = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = new THREE.Mesh(cyl(0.02, 0.02, 0.22, 8), m.brass);
        b.rotation.x = HALF;
        b.position.set(Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0);
        sp.add(b);
      }
      const hub = new THREE.Mesh(cyl(0.035, 0.035, 0.23, 10), m.iron);
      hub.rotation.x = HALF;
      sp.add(hub);
      sp.position.set(0, 0.03, -0.27);
      g.add(sp);
      spinner = sp;
      P(mag, [[rbox(0.05, 0.05, 0.05, 0.02), m.tin, 0, 0, 0]]);
      mag.position.set(0, -0.16, 0.06);
      muzzleZ = -0.39;
      gripR = new THREE.Vector3(0, -0.12, 0.05);
      gripL = new THREE.Vector3(-0.04, -0.15, 0.02);
      break;
    }
    case 'zapcoil': {
      P(stat, [
        [rbox(0.12, 0.13, 0.34, 0.05), m.teal, 0, 0, -0.04],
        [rbox(0.08, 0.15, 0.08, 0.03), m.woodD, 0, -0.11, 0.07, 0.25],
        [rbox(0.1, 0.14, 0.22, 0.05), m.wood, 0, -0.02, 0.26, -0.1],
        [cyl(0.02, 0.02, 0.34, 8), m.iron, 0, 0.03, -0.36, HALF],
        [rbox(0.125, 0.03, 0.1, 0.012), m.tape, 0, 0.0, 0.06],
      ]);
      // copper coils wound round the barrel, and a glowing ball at the tip
      for (let i = 0; i < 5; i++) P(stat, [[G.torus(0.045, 0.012, 6, 12), m.copper, 0, 0.03, -0.24 - i * 0.05]]);
      const ball = new THREE.Mesh(G.sphere(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0x8ff7ff }));
      ball.position.set(0, 0.03, -0.56);
      g.add(ball);
      P(mag, [
        [cyl(0.05, 0.05, 0.12, 12), m.tin, 0, 0, 0],
        [cyl(0.052, 0.052, 0.04, 12), m.mustard, 0, 0.03, 0],
      ]);
      mag.position.set(0, -0.12, -0.14);
      muzzleZ = -0.6;
      muzzleY = 0.03;
      gripL = new THREE.Vector3(0, -0.1, -0.2);
      break;
    }
    case 'boomkin': {
      P(stat, [
        [cyl(0.09, 0.09, 0.5, 14), m.teal, 0, 0.04, -0.2, HALF],
        [cyl(0.1, 0.1, 0.05, 14), m.brass, 0, 0.04, -0.45, HALF],
        [cyl(0.1, 0.1, 0.05, 14), m.brass, 0, 0.04, 0.04, HALF],
        [rbox(0.08, 0.16, 0.08, 0.03), m.woodD, 0, -0.1, 0.02, 0.3],
        [rbox(0.08, 0.13, 0.08, 0.03), m.woodD, 0, -0.08, -0.26, -0.1],
        [rbox(0.1, 0.14, 0.2, 0.05), m.wood, 0, -0.02, 0.2, -0.12],
        [rbox(0.03, 0.08, 0.03, 0.01), m.ink, 0, 0.16, -0.3], // sight post
        [rbox(0.105, 0.03, 0.12, 0.012), m.tape, 0, 0.13, -0.1],
      ]);
      // a pumpkin peeking out of the barrel
      const pk = new THREE.Group();
      const body = new THREE.Mesh(G.sphere(0.075, 12, 8), toyMaterial(0xff8a2a, { rough: 0.55 }));
      body.scale.set(1, 0.85, 1);
      const stalk = new THREE.Mesh(cyl(0.012, 0.016, 0.04, 6), toyMaterial(0x4f8a3a));
      stalk.position.y = 0.07;
      pk.add(body, stalk);
      pk.position.set(0, 0.04, -0.46);
      g.add(pk);
      loaded = pk;
      P(mag, [[G.sphere(0.05, 10, 8), toyMaterial(0xff8a2a, { rough: 0.55 }), 0, 0, 0]]);
      mag.position.set(0.1, -0.02, -0.02);
      muzzleZ = -0.5;
      muzzleY = 0.04;
      gripL = new THREE.Vector3(0, -0.1, -0.26);
      break;
    }
    case 'gloopgun': {
      P(stat, [
        [rbox(0.09, 0.12, 0.26, 0.04), m.pink, 0, 0.02, -0.06],
        [rbox(0.08, 0.17, 0.09, 0.035), m.woodL, 0, -0.1, 0.04, 0.25],
        [rbox(0.085, 0.03, 0.1, 0.012), m.tape, 0, -0.06, 0.03, 0.25],
        [cyl(0.03, 0.05, 0.14, 12), m.tin, 0, 0.03, -0.26, HALF],
        [G.torus(0.035, 0.009, 6, 12), m.ink, 0, -0.04, -0.05, 0, HALF],
      ]);
      // a jar of green gloop on top (the magazine)
      const jarMat = new THREE.MeshStandardMaterial({ color: 0x9dff6b, emissive: 0x3a8a20, emissiveIntensity: 0.4, roughness: 0.2, transparent: true, opacity: 0.85 });
      P(mag, [
        [cyl(0.05, 0.05, 0.1, 12), jarMat, 0, 0, 0],
        [cyl(0.053, 0.053, 0.025, 12), m.red, 0, 0.06, 0],
      ]);
      mag.position.set(0, 0.12, -0.06);
      muzzleZ = -0.34;
      muzzleY = 0.03;
      gripR = new THREE.Vector3(0, -0.12, 0.03);
      gripL = new THREE.Vector3(-0.04, -0.15, 0.0);
      break;
    }
  }

  // mythic weapons get gilded trim
  if (rarity === 4) {
    P(stat, [[G.torus(0.075, 0.012, 6, 16), m.brass, 0, 0.0, -0.02, 0, 0, 0]]);
  }
  const merged = mergeToVertexColored(stat);
  merged.castShadow = true;
  g.add(merged);
  g.add(mag);
  mag.traverse((o) => ((o as THREE.Mesh).castShadow = true));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, muzzleY, muzzleZ);
  g.add(muzzle);
  const flash = makeFlash(def.id === 'broomstick' || def.id === 'thumper' || def.id === 'boomkin' ? 1.6 : def.id === 'sparkbow' || def.id === 'gloopgun' ? 0.6 : 1, def.tracer);
  muzzle.add(flash);
  void RARITY;
  return { group: g, muzzle, gripR, gripL, mag, flash, spinner, loaded };
}

const flashGeo = (() => {
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.07 : 0.2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(star);
})();

function makeFlash(scale: number, color: number) {
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.visible = false;
  flash.scale.setScalar(scale);
  flash.userData.base = scale;
  const side = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5), flashMat);
  side.rotation.x = Math.PI / 2;
  side.position.z = -0.2;
  flash.add(side);
  const side2 = side.clone();
  side2.rotation.y = Math.PI / 2;
  flash.add(side2);
  return flash;
}
