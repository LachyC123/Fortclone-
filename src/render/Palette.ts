import * as THREE from 'three';

/** The Rift Rascals colour language. Environment is warm & soft; combat FX are saturated. */
export const PAL = {
  cream: 0xf4e7c8,
  creamDark: 0xe2cfa4,
  grass: 0x7cc35a,
  grassDark: 0x5aa347,
  grassLight: 0xa6d86a,
  turquoise: 0x3fc6c0,
  teal: 0x2a9d8f,
  terracotta: 0xd9774f,
  terracottaDark: 0xb85c3b,
  softBlue: 0x7fb7e6,
  lavender: 0xb49be0,
  mustard: 0xf2c14e,
  brown: 0x8a5a3b,
  brownDark: 0x5e3b27,
  wood: 0xb07a4f,
  woodLight: 0xd3a26f,
  stone: 0xc9c0b0,
  stoneDark: 0x9c9384,
  cobble: 0xbfb2a0,
  roofRed: 0xc9573f,
  roofBlue: 0x4f7fb8,
  roofTeal: 0x3a9a8a,
  roofPurple: 0x8a6bb8,
  white: 0xffffff,
  ink: 0x2b2238,
  pink: 0xf28fad,
  leaf: 0x6cbf4f,
  leafDark: 0x3f8f3d,
  water: 0x4fc3d9,
  metal: 0x8f99a6,
  sky: 0x8fd3ff,
  skyHorizon: 0xffe9c4,
  blink: 0x6ff7ff,
  blinkDeep: 0x5b4bff,
  gloom: 0x6b2fb3,
};

export const RARITY = [
  { id: 'common', name: 'Common', color: 0xe8e8e8, css: '#e8e8e8' },
  { id: 'uncommon', name: 'Uncommon', color: 0x5fe067, css: '#5fe067' },
  { id: 'rare', name: 'Rare', color: 0x49a8ff, css: '#49a8ff' },
  { id: 'epic', name: 'Epic', color: 0xc160ff, css: '#c160ff' },
  { id: 'mythic', name: 'Mythic', color: 0xffa726, css: '#ffa726' },
] as const;
export type RarityIndex = 0 | 1 | 2 | 3 | 4;

export const col = (hex: number) => new THREE.Color(hex);

/** Slightly vary a colour (hue/lightness jitter) so repeated props don't look copy-pasted. */
export function jitter(hex: number, amount: number, r: () => number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h + (r() - 0.5) * amount * 0.15, THREE.MathUtils.clamp(hsl.s + (r() - 0.5) * amount * 0.3, 0, 1), THREE.MathUtils.clamp(hsl.l + (r() - 0.5) * amount * 0.25, 0, 1));
  return c.getHex();
}
