import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { PAL, RarityIndex } from '../render/Palette';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type AmmoType = 'light' | 'medium' | 'heavy' | 'shells' | 'bolts';
export type SoundProfile = 'pop' | 'rifle' | 'heavy' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: string;
  name: string;
  short: string;
  mode: 'auto' | 'semi' | 'burst';
  rpm: number;
  damage: number;
  headMult: number;
  mag: number;
  reload: number;
  ammo: AmmoType;
  pellets: number;
  /** spread in degrees (half-angle) */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  minDamageMul: number;
  recoilPitch: number; // degrees per shot
  recoilYaw: number;
  camKick: number;
  adsFov: number;
  tracer: number;
  sound: SoundProfile;
  /** how the rascal holds it */
  hold: 'rifle' | 'pistol';
  /** rarity damage multiplier table applies on top */
  icon: string;
}

/** Rarity scales damage & handling a little — never enough that a grey gun is useless. */
export const RARITY_DAMAGE = [1, 1.06, 1.12, 1.18, 1.25];
export const RARITY_RELOAD = [1, 0.96, 0.92, 0.88, 0.82];

export const WEAPONS: Record<string, WeaponDef> = {
  tincan: {
    id: 'tincan',
    name: 'Tin Can Rifle',
    short: 'TIN CAN',
    mode: 'auto',
    rpm: 360,
    damage: 17,
    headMult: 1.6,
    mag: 26,
    reload: 1.9,
    ammo: 'medium',
    pellets: 1,
    spreadHip: 2.4,
    spreadAds: 0.55,
    spreadMove: 1.6,
    bloomPerShot: 0.45,
    bloomMax: 3.2,
    bloomRecover: 7,
    range: 140,
    falloffStart: 30,
    falloffEnd: 80,
    minDamageMul: 0.65,
    recoilPitch: 0.75,
    recoilYaw: 0.35,
    camKick: 0.14,
    adsFov: 48,
    tracer: 0xffd27a,
    sound: 'rifle',
    hold: 'rifle',
    icon: 'tincan',
  },
};

export class WeaponInstance {
  mag: number;
  bloom = 0;
  cooldown = 0;
  reloadT = -1;
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
}

/* ------------------------------------------------------------------ view models */

function rbox(w: number, h: number, d: number, r: number) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}

export interface WeaponView {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  /** grip points in weapon space for IK */
  gripR: THREE.Vector3;
  gripL: THREE.Vector3;
  mag: THREE.Object3D;
  flash: THREE.Mesh;
}

/**
 * Chunky, hand-made-looking weapons. The Tin Can Rifle: a drum magazine made from a soup tin,
 * copper pipe barrel, taped wooden stock and a bottle-cap sight.
 */
export function buildWeaponView(def: WeaponDef, rarity: RarityIndex): WeaponView {
  const g = new THREE.Group();
  const wood = toyMaterial(PAL.wood, { rough: 0.7 });
  const woodDark = toyMaterial(PAL.brownDark, { rough: 0.7 });
  const tin = toyMaterial(0xc9d2dc, { rough: 0.35, metal: 0.6 });
  const copper = toyMaterial(0xd98b4f, { rough: 0.4, metal: 0.5 });
  const tape = toyMaterial([0xe8e8e8, 0x5fe067, 0x49a8ff, 0xc160ff, 0xffa726][rarity], { rough: 0.5 });
  const label = toyMaterial(PAL.terracotta, { rough: 0.6 });
  const mag = new THREE.Group();

  if (def.id === 'tincan') {
    // receiver
    const body = new THREE.Mesh(rbox(0.12, 0.14, 0.42, 0.04), woodDark);
    body.position.set(0, 0, -0.05);
    g.add(body);
    // stock
    const stock = new THREE.Mesh(rbox(0.1, 0.16, 0.3, 0.05), wood);
    stock.position.set(0, -0.03, 0.27);
    stock.rotation.x = -0.12;
    g.add(stock);
    const tapeBand = new THREE.Mesh(rbox(0.115, 0.17, 0.05, 0.02), tape);
    tapeBand.position.set(0, -0.03, 0.2);
    tapeBand.rotation.x = -0.12;
    g.add(tapeBand);
    // barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), copper);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.48);
    g.add(barrel);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.07, 10), tin);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0, 0.03, -0.74);
    g.add(tip);
    // tin can drum mag
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.11, 14), tin);
    can.rotation.z = Math.PI / 2;
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, 0.06, 14), label);
    lab.rotation.z = Math.PI / 2;
    mag.add(can, lab);
    mag.position.set(0, -0.12, -0.12);
    g.add(mag);
    // sight (bottle cap)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 10), tape);
    cap.position.set(0, 0.09, -0.1);
    g.add(cap);
    // grip
    const grip = new THREE.Mesh(rbox(0.07, 0.14, 0.07, 0.03), wood);
    grip.position.set(0, -0.1, 0.05);
    grip.rotation.x = 0.3;
    g.add(grip);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.8);
  g.add(muzzle);

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.07 : 0.2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const flash = new THREE.Mesh(new THREE.ShapeGeometry(star), flashMat);
  flash.visible = false;
  muzzle.add(flash);
  const flashSide = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5), flashMat);
  flashSide.rotation.x = Math.PI / 2;
  flashSide.position.z = -0.2;
  flash.add(flashSide);
  const flashSide2 = flashSide.clone();
  flashSide2.rotation.y = Math.PI / 2;
  flash.add(flashSide2);

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== flash && o.parent !== flash) o.castShadow = true;
  });

  return { group: g, muzzle, gripR: new THREE.Vector3(0, -0.1, 0.05), gripL: new THREE.Vector3(0, -0.02, -0.4), mag, flash };
}
