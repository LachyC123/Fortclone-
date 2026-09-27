import { RarityIndex } from '../render/Palette';

/**
 * RIFT RELICS: odd little treasures the Rift washed up on the island. You find them in matches,
 * carry them (they drop if you go down for good) and send them home at a Rift Nest. At home they
 * sit in your Burrow's museum and each one quietly boosts it; finish a set to unlock a hat.
 */

export type RelicBonus = 'pump' | 'match' | 'incubate' | 'warmth' | 'train' | 'bazaar';

export const BONUS_TEXT: Record<RelicBonus, (n: number) => string> = {
  pump: (n) => `Glimmer Pump +${n}%`,
  match: (n) => `+${n} glimmer every match`,
  incubate: (n) => `Cocoons incubate ${n}% faster`,
  warmth: (n) => `+${n}% cozy-upgrade chance`,
  train: (n) => `Bug training ${n}% cheaper`,
  bazaar: (n) => `Bazaar ${n}% cheaper`,
};

export type HatId = 'party' | 'pirate' | 'wizard' | 'crown' | 'antenna';

export interface RelicSet {
  id: string;
  name: string;
  color: number;
  css: string;
  hat: HatId;
  hatName: string;
  /** glimmer bonus the first time the set is complete */
  prize: number;
}

export interface RelicDef {
  id: string;
  name: string;
  set: string;
  rarity: RarityIndex;
  bonus: RelicBonus;
  amount: number;
  blurb: string;
}

export const RELIC_SETS: RelicSet[] = [
  { id: 'picnic', name: 'Picnic Pals', color: 0xf28fad, css: '#f28fad', hat: 'party', hatName: 'Party Hat', prize: 250 },
  { id: 'pirate', name: 'Pirate Stash', color: 0xf2c14e, css: '#f2c14e', hat: 'pirate', hatName: 'Pirate Hat', prize: 450 },
  { id: 'wizard', name: "Wizard's Attic", color: 0x8f7bff, css: '#8f7bff', hat: 'wizard', hatName: 'Wizard Hat', prize: 700 },
  { id: 'royal', name: 'Royal Vault', color: 0xffc83d, css: '#ffc83d', hat: 'crown', hatName: 'Tiny Crown', prize: 1000 },
  { id: 'rift', name: 'Rift Oddities', color: 0x6ff7ff, css: '#6ff7ff', hat: 'antenna', hatName: 'Bug Antennae', prize: 1500 },
];
export const SET_BY_ID: Record<string, RelicSet> = Object.fromEntries(RELIC_SETS.map((s) => [s.id, s]));

export const RELICS: RelicDef[] = [
  { id: 'spork', name: 'Golden Spork', set: 'picnic', rarity: 0, bonus: 'pump', amount: 5, blurb: 'Half spoon, half fork, all shiny.' },
  { id: 'jamjar', name: 'Jam Jar', set: 'picnic', rarity: 0, bonus: 'match', amount: 3, blurb: 'Still sticky. Probably always will be.' },
  { id: 'napkin', name: 'Checkered Napkin', set: 'picnic', rarity: 0, bonus: 'incubate', amount: 5, blurb: 'Cocoons love a snuggle.' },
  { id: 'teapot', name: 'Tiny Teapot', set: 'picnic', rarity: 1, bonus: 'warmth', amount: 3, blurb: 'Warm to the touch. Nobody knows why.' },
  { id: 'spyglass', name: 'Brass Spyglass', set: 'pirate', rarity: 1, bonus: 'pump', amount: 6, blurb: 'Look through the wrong end for a laugh.' },
  { id: 'doubloon', name: 'Lucky Doubloon', set: 'pirate', rarity: 1, bonus: 'match', amount: 5, blurb: 'Heads you win, tails you also win.' },
  { id: 'hook', name: "Captain's Hook", set: 'pirate', rarity: 2, bonus: 'train', amount: 6, blurb: 'Great for pointing dramatically.' },
  { id: 'parrot', name: 'Wooden Parrot', set: 'pirate', rarity: 2, bonus: 'bazaar', amount: 6, blurb: 'Haggles on your behalf. Squawks the price down.' },
  { id: 'wand', name: 'Wobbly Wand', set: 'wizard', rarity: 2, bonus: 'incubate', amount: 8, blurb: 'Casts one spell: "slightly faster".' },
  { id: 'potion', name: 'Fizzy Potion', set: 'wizard', rarity: 2, bonus: 'warmth', amount: 4, blurb: 'Do not drink. Do smell. Smells like toast.' },
  { id: 'spellbook', name: 'Doodled Spellbook', set: 'wizard', rarity: 3, bonus: 'train', amount: 8, blurb: 'Half the spells are drawings of bugs.' },
  { id: 'orb', name: 'Crystal Orb', set: 'wizard', rarity: 3, bonus: 'pump', amount: 8, blurb: 'Shows the future. The future is glimmer.' },
  { id: 'scepter', name: 'Tiny Scepter', set: 'royal', rarity: 3, bonus: 'match', amount: 8, blurb: 'Rules over one (1) sock drawer.' },
  { id: 'goblet', name: 'Gold Goblet', set: 'royal', rarity: 3, bonus: 'bazaar', amount: 8, blurb: 'Fancy juice only.' },
  { id: 'ring', name: 'Signet Ring', set: 'royal', rarity: 3, bonus: 'incubate', amount: 10, blurb: 'Seals letters, and also cocoons.' },
  { id: 'jeggs', name: 'Jewelled Egg', set: 'royal', rarity: 4, bonus: 'warmth', amount: 6, blurb: 'Is something… inside?' },
  { id: 'shard', name: 'Humming Rift Shard', set: 'rift', rarity: 4, bonus: 'pump', amount: 12, blurb: 'Hums the same three notes forever.' },
  { id: 'fossil', name: 'Blinkbug Fossil', set: 'rift', rarity: 4, bonus: 'train', amount: 12, blurb: 'A great-great-great-grandbug. Blinks in its sleep.' },
  { id: 'compass', name: 'Upside-down Compass', set: 'rift', rarity: 4, bonus: 'match', amount: 12, blurb: 'Always points to the nearest trouble.' },
  { id: 'lantern', name: 'Gloom Lantern', set: 'rift', rarity: 4, bonus: 'incubate', amount: 12, blurb: 'Glows darker when the Gloom is near.' },
];
export const RELIC_BY_ID: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

/** glimmer you get for a relic you already have */
export const RELIC_DUPE_VALUE = [30, 60, 120, 240, 450];

const RELIC_WEIGHT = [40, 30, 18, 9, 4];

/** a relic for a match: mostly common, and a little nudge toward ones you're missing */
export function rollRelic(owned: Record<string, number> = {}, rng: () => number = Math.random): RelicDef {
  const pool = rng() < 0.5 ? RELICS.filter((r) => !owned[r.id]) : RELICS;
  const list = pool.length ? pool : RELICS;
  const total = list.reduce((s, r) => s + RELIC_WEIGHT[r.rarity], 0);
  let x = rng() * total;
  for (const r of list) if ((x -= RELIC_WEIGHT[r.rarity]) <= 0) return r;
  return list[list.length - 1];
}

/** SVG glyph for a relic (a faceted gem in its set colour) */
export function relicSvg(id: string, size = 20) {
  const r = RELIC_BY_ID[id];
  const c = r ? SET_BY_ID[r.set].css : '#6ff7ff';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 2l8 8-8 12-8-12z" fill="${c}" stroke="#2b2238" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 10h16M12 2l-3 8 3 12 3-12z" fill="none" stroke="#2b2238" stroke-width="1" opacity=".55"/></svg>`;
}
