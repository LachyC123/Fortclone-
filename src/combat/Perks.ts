import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { mergeToVertexColored } from '../render/Merge';
import { RarityIndex } from '../render/Palette';
import { G } from '../render/Detail';

/**
 * Perks: badges you find in the world and pin to your backpack for the rest of the match.
 * Two at a time; picking up a third swaps out the oldest. Each is a small, feelable nudge.
 */
export type PerkId = 'springy' | 'quickhands' | 'bugsnacks' | 'thickwool' | 'quietpaws' | 'vampteeth';

export interface PerkDef {
  id: PerkId;
  name: string;
  blurb: string;
  color: number;
  css: string;
  rarity: RarityIndex;
  weight: number;
}

export const PERKS: Record<PerkId, PerkDef> = {
  springy: { id: 'springy', name: 'Springy Socks', blurb: 'Jump a third higher.', color: 0x7ee06a, css: '#7ee06a', rarity: 2, weight: 10 },
  quickhands: { id: 'quickhands', name: 'Speedy Fingers', blurb: 'Reload 30% faster.', color: 0xffd36b, css: '#ffd36b', rarity: 2, weight: 10 },
  bugsnacks: { id: 'bugsnacks', name: 'Bug Snacks', blurb: 'Your Blinkbug naps 35% less.', color: 0x6ff7ff, css: '#6ff7ff', rarity: 3, weight: 8 },
  thickwool: { id: 'thickwool', name: 'Thick Wool', blurb: 'Take 12% less damage.', color: 0xf28fad, css: '#f28fad', rarity: 3, weight: 7 },
  quietpaws: { id: 'quietpaws', name: 'Quiet Paws', blurb: 'Footsteps barely make a sound.', color: 0xb49be0, css: '#b49be0', rarity: 2, weight: 9 },
  vampteeth: { id: 'vampteeth', name: 'Vampire Teeth', blurb: 'Knock or eliminate someone: heal 20.', color: 0xff5c5c, css: '#ff5c5c', rarity: 3, weight: 6 },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];
export const MAX_PERKS = 2;

/** little glyphs drawn on the badge face and in the HUD */
export const PERK_ICON: Record<PerkId, string> = {
  springy: '<path d="M14 40h20M18 34c0-4 12-4 12-8s-12-4-12-8 12-4 12-8"/>',
  quickhands: '<path d="M26 6l-12 20h10l-4 16 14-22H24z" fill="currentColor"/>',
  bugsnacks: '<ellipse cx="24" cy="28" rx="11" ry="9"/><circle cx="20" cy="27" r="2.5" fill="currentColor"/><circle cx="28" cy="27" r="2.5" fill="currentColor"/><path d="M19 19l-3-6M29 19l3-6"/>',
  thickwool: '<path d="M10 30c0-9 6-16 14-16s14 7 14 16c0 5-4 8-14 8s-14-3-14-8z"/><path d="M16 26c3 2 13 2 16 0"/>',
  quietpaws: '<ellipse cx="24" cy="31" rx="8" ry="7" fill="currentColor"/><circle cx="14" cy="20" r="3.5" fill="currentColor"/><circle cx="21" cy="14" r="3.5" fill="currentColor"/><circle cx="29" cy="14" r="3.5" fill="currentColor"/><circle cx="35" cy="20" r="3.5" fill="currentColor"/>',
  vampteeth: '<path d="M8 16c6 4 26 4 32 0"/><path d="M14 18l3 12 3-11M28 19l3 11 3-12"/>',
};

export function perkSvg(id: PerkId) {
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${PERK_ICON[id]}</svg>`;
}

/** A chunky enamel badge for floor loot. */
export function buildPerkModel(id: PerkId): THREE.Object3D {
  const def = PERKS[id];
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, o?: { metal?: number }) => {
    const m = new THREE.Mesh(geo, toyMaterial(color, { rough: 0.35, metal: o?.metal ?? 0 }));
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  };
  add(G.cylinder(0.17, 0.17, 0.04, 20), 0xd9a441, 0, 0.2, 0, Math.PI / 2, { metal: 0.6 });
  add(G.cylinder(0.14, 0.14, 0.045, 20), def.color, 0, 0.2, 0, Math.PI / 2);
  // a star on each face
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.035 : 0.085;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const sg = new THREE.ShapeGeometry(star);
  const s1 = new THREE.Mesh(sg, toyMaterial(0xfff6e6));
  s1.position.set(0, 0.2, 0.024);
  const s2 = s1.clone();
  s2.position.z = -0.024;
  s2.rotation.y = Math.PI;
  g.add(s1, s2);
  // ribbon tails
  add(new THREE.BoxGeometry(0.06, 0.14, 0.01), def.color, -0.05, 0.04, 0);
  add(new THREE.BoxGeometry(0.06, 0.14, 0.01), def.color, 0.05, 0.04, 0);
  const out = new THREE.Group();
  out.add(mergeToVertexColored(g));
  return out;
}
