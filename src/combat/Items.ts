import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { PAL, RarityIndex } from '../render/Palette';
import { mergeToVertexColored } from '../render/Merge';

export type HealId = 'jamjar' | 'fizzle' | 'biscuit';
export type UtilId = 'fizzbomb' | 'bouncejam' | 'chicken' | 'gust' | 'stickypop';

export interface HealDef {
  id: HealId;
  name: string;
  amount: number;
  useTime: number;
  maxStack: number;
  rarity: RarityIndex;
  /** seconds of speed boost after eating */
  boost?: number;
  weight: number;
  blurb: string;
}

export interface UtilDef {
  id: UtilId;
  name: string;
  maxStack: number;
  rarity: RarityIndex;
  /** throw speed & physics */
  speed: number;
  bounce: number;
  sticky: boolean;
  fuse: number;
  weight: number;
  blurb: string;
}

export const HEALS: Record<HealId, HealDef> = {
  jamjar: { id: 'jamjar', name: 'Jam Jar', amount: 50, useTime: 3.0, maxStack: 3, rarity: 1, weight: 10, blurb: 'Slow, sticky, strong.' },
  fizzle: { id: 'fizzle', name: 'Fizzle Juice', amount: 25, useTime: 1.1, maxStack: 6, rarity: 0, weight: 12, blurb: 'Quick bubbly top-up.' },
  biscuit: { id: 'biscuit', name: 'Golden Biscuit', amount: 75, useTime: 1.8, maxStack: 2, rarity: 3, boost: 6, weight: 3, blurb: 'Heals lots. Zoomies.' },
};

export const UTILS: Record<UtilId, UtilDef> = {
  fizzbomb: { id: 'fizzbomb', name: 'Fizz Bomb', maxStack: 3, rarity: 1, speed: 17, bounce: 0.35, sticky: false, fuse: 1.0, weight: 9, blurb: 'Pop! Rainbow smoke.' },
  bouncejam: { id: 'bouncejam', name: 'Bounce Jam', maxStack: 3, rarity: 1, speed: 15, bounce: 0.1, sticky: false, fuse: 0.2, weight: 8, blurb: 'Boing pad.' },
  chicken: { id: 'chicken', name: 'Pocket Chicken', maxStack: 2, rarity: 2, speed: 13, bounce: 0.3, sticky: false, fuse: 0.3, weight: 6, blurb: 'Loud. Distracting.' },
  gust: { id: 'gust', name: 'Gust Bottle', maxStack: 3, rarity: 2, speed: 18, bounce: 0.0, sticky: false, fuse: 0.0, weight: 7, blurb: 'Whoosh. Everyone away.' },
  stickypop: { id: 'stickypop', name: 'Sticky Pop', maxStack: 4, rarity: 2, speed: 19, bounce: 0.0, sticky: true, fuse: 1.6, weight: 8, blurb: 'Sticks. Beeps. Pops.' },
};

export interface ItemStack<T extends string> {
  id: T;
  count: number;
}

function mk(parts: [THREE.BufferGeometry, number, number, number, number, number?, number?, number?, { metal?: number; emissive?: number }?][]) {
  const g = new THREE.Group();
  for (const [geo, color, x, y, z, rx = 0, ry = 0, rz = 0, o] of parts) {
    const m = new THREE.Mesh(geo, toyMaterial(color, { rough: 0.5, metal: o?.metal ?? 0 }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
  }
  return g;
}

const cyl = (rt: number, rb: number, h: number, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r: number, sx = 1, sy = 1, sz = 1) => {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  return g;
};

/** Small chunky models for items (used for floor loot, hands and thrown objects). */
export function buildItemModel(id: HealId | UtilId, merged = true): THREE.Object3D {
  let g: THREE.Group;
  switch (id) {
    case 'jamjar':
      g = mk([
        [cyl(0.11, 0.1, 0.18), 0xc2185b, 0, 0.09, 0],
        [cyl(0.115, 0.115, 0.05), 0xfff1d8, 0, 0.2, 0],
        [cyl(0.12, 0.12, 0.02), 0xd94a6b, 0, 0.23, 0],
        [new THREE.BoxGeometry(0.16, 0.08, 0.01), 0xfff6e6, 0, 0.1, 0.105],
      ]);
      break;
    case 'fizzle':
      g = mk([
        [cyl(0.06, 0.07, 0.2), 0x5fe0d0, 0, 0.1, 0],
        [cyl(0.03, 0.05, 0.07), 0x5fe0d0, 0, 0.23, 0],
        [cyl(0.032, 0.032, 0.03), PAL.terracotta, 0, 0.28, 0],
        [cyl(0.071, 0.071, 0.07), 0xfff6e6, 0, 0.09, 0],
        [sph(0.015), 0xffffff, 0.03, 0.15, 0.05],
      ]);
      break;
    case 'biscuit':
      g = mk([
        [cyl(0.12, 0.12, 0.05, 16), 0xf2b134, 0, 0.03, 0, 0, 0, 0, { metal: 0.3 }],
        [sph(0.018), 0x8a5a3b, 0.05, 0.06, 0.02],
        [sph(0.018), 0x8a5a3b, -0.04, 0.06, -0.03],
        [sph(0.018), 0x8a5a3b, 0.0, 0.06, 0.06],
      ]);
      break;
    case 'fizzbomb':
      g = mk([
        [sph(0.11), 0xb49be0, 0, 0.11, 0],
        [cyl(0.03, 0.04, 0.06), 0xfff6e6, 0, 0.23, 0],
        [sph(0.03), PAL.pink, 0.05, 0.14, 0.08],
        [sph(0.03), PAL.mustard, -0.07, 0.1, 0.06],
        [sph(0.03), PAL.turquoise, 0.02, 0.06, -0.09],
      ]);
      break;
    case 'bouncejam':
      g = mk([
        [cyl(0.1, 0.1, 0.14), 0x7ee06a, 0, 0.07, 0],
        [sph(0.1, 1, 0.5, 1), 0x5fe067, 0, 0.15, 0],
        [cyl(0.105, 0.105, 0.03), 0xfff6e6, 0, 0.02, 0],
      ]);
      break;
    case 'chicken':
      g = mk([
        [sph(0.1, 1, 0.9, 1.25), 0xffffff, 0, 0.12, 0],
        [sph(0.06), 0xffffff, 0, 0.23, -0.09],
        [new THREE.ConeGeometry(0.02, 0.05, 6), PAL.mustard, 0, 0.22, -0.16, -Math.PI / 2],
        [sph(0.025, 1, 1.4, 0.6), 0xe53935, 0, 0.3, -0.09],
        [cyl(0.012, 0.012, 0.08), PAL.mustard, 0.04, 0.03, 0],
        [cyl(0.012, 0.012, 0.08), PAL.mustard, -0.04, 0.03, 0],
        [cyl(0.02, 0.02, 0.06), 0x9aa4b0, 0.1, 0.13, 0.03, 0, 0, Math.PI / 2, { metal: 0.6 }], // wind-up key
      ]);
      break;
    case 'gust':
      g = mk([
        [cyl(0.07, 0.08, 0.2), 0xbfeaf2, 0, 0.1, 0],
        [cyl(0.035, 0.06, 0.06), 0xbfeaf2, 0, 0.23, 0],
        [cyl(0.037, 0.037, 0.04), 0x8a5a3b, 0, 0.28, 0],
        [new THREE.TorusGeometry(0.04, 0.012, 6, 12), 0xffffff, 0, 0.1, 0],
      ]);
      break;
    case 'stickypop':
      g = mk([
        [sph(0.09), 0xff5c8a, 0, 0.09, 0],
        [cyl(0.02, 0.02, 0.07), 0x5a6270, 0, 0.2, 0, 0, 0, 0, { metal: 0.6 }],
        [sph(0.025), 0xff2020, 0, 0.24, 0],
      ]);
      break;
    default:
      g = mk([[sph(0.1), 0xffffff, 0, 0.1, 0]]);
  }
  if (!merged) return g;
  const out = new THREE.Group();
  out.add(mergeToVertexColored(g));
  return out;
}

export const ITEM_COLOR: Record<HealId | UtilId, number> = {
  jamjar: 0xc2185b,
  fizzle: 0x5fe0d0,
  biscuit: 0xf2b134,
  fizzbomb: 0xb49be0,
  bouncejam: 0x7ee06a,
  chicken: 0xffffff,
  gust: 0xbfeaf2,
  stickypop: 0xff5c8a,
};
