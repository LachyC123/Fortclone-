import { RarityIndex } from '../render/Palette';

/**
 * Blinkbug species. Each is a *sidegrade*: a distinct trick paid for with a trade-off, so a
 * Mythic bug is rarer and flashier but never simply stronger. Rarity is about collecting and
 * showing off; skill still decides fights.
 */
export type BugAbility = 'none' | 'sticky' | 'hop' | 'mend' | 'boom' | 'wisp' | 'snatch' | 'glide' | 'ping' | 'turret' | 'web';

export interface BugStats {
  throwSpeed: number;
  gravity: number;
  restitution: number;
  window: number;
  cooldown: number;
  sticky: boolean;
}

export interface BugSpecies {
  id: string;
  name: string;
  rarity: RarityIndex;
  ability: BugAbility;
  /** what it does, in one breath */
  trick: string;
  /** what it costs */
  catch: string;
  /** a line of personality for the collection card */
  flavour: string;
  tint: number;
  belly: number;
  wing: number;
  /** model extras */
  look: {
    horns?: boolean;
    pincers?: boolean;
    crown?: boolean;
    leaf?: boolean;
    springs?: boolean;
    suckers?: boolean;
    longWings?: boolean;
    ghost?: boolean;
    /** Pewpew: helmet + blaster */
    turret?: boolean;
    /** Tanglet: silk ball and extra legs */
    spinner?: boolean;
    scale?: number;
  };
  stats: Partial<BugStats>;
}

export const BASE_BUG_STATS: BugStats = {
  throwSpeed: 19,
  gravity: 16,
  restitution: 0.42,
  window: 6,
  cooldown: 8,
  sticky: false,
};

export const SPECIES: BugSpecies[] = [
  {
    id: 'zippit',
    name: 'Zippit',
    rarity: 0,
    ability: 'none',
    trick: 'The classic. Throw it, blink to it. Reliable as toast.',
    catch: 'No catch — it just does the thing.',
    flavour: 'Loves shiny things, bouncing and you (in that order).',
    tint: 0x6ff7ff,
    belly: 0xe8ffff,
    wing: 0xe6ffff,
    look: {},
    stats: {},
  },
  {
    id: 'stickle',
    name: 'Stickle',
    rarity: 0,
    ability: 'sticky',
    trick: 'Sticks to the first thing it hits — walls, roofs, trees. Blink onto ledges nobody else can reach.',
    catch: 'Blink window is 1.5s shorter.',
    flavour: 'Has never once let go of anything. Including grudges.',
    tint: 0x9dff6b,
    belly: 0xf1ffd8,
    wing: 0xe8ffd0,
    look: { suckers: true },
    stats: { sticky: true, window: 4.5 },
  },
  {
    id: 'hopper',
    name: 'Hopper',
    rarity: 1,
    ability: 'hop',
    trick: 'You arrive with a big springy BOING straight up — perfect for rooftops and dodging.',
    catch: 'Throws a bit shorter.',
    flavour: 'Has springs for legs. Nobody asked how.',
    tint: 0xffd36b,
    belly: 0xfff3cf,
    wing: 0xfff6dd,
    look: { springs: true },
    stats: { throwSpeed: 17 },
  },
  {
    id: 'mender',
    name: 'Mender',
    rarity: 1,
    ability: 'mend',
    trick: 'Every blink patches you up for 12 health.',
    catch: 'Naps 2s longer between blinks.',
    flavour: 'Carries a tiny leaf. It is very proud of the leaf.',
    tint: 0x7ee06a,
    belly: 0xfff1f6,
    wing: 0xe2ffe0,
    look: { leaf: true },
    stats: { cooldown: 10 },
  },
  {
    id: 'boomble',
    name: 'Boomble',
    rarity: 2,
    ability: 'boom',
    trick: 'Arrive with a shockwave that shoves nearby rascals away (and stings a little).',
    catch: 'Naps 2.5s longer between blinks.',
    flavour: 'Hums constantly. Explodes emotionally.',
    tint: 0xff8a5b,
    belly: 0xffe6c8,
    wing: 0xffe8d8,
    look: { horns: true, scale: 1.1 },
    stats: { cooldown: 10.5 },
  },
  {
    id: 'wisp',
    name: 'Wisp',
    rarity: 2,
    ability: 'wisp',
    trick: 'After a blink you shimmer out of sight for 2 seconds — rascals lose track of you.',
    catch: 'Blink window is 1s shorter.',
    flavour: 'Might be a ghost. Might just be shy.',
    tint: 0xc7a8ff,
    belly: 0xf6f0ff,
    wing: 0xf0e8ff,
    look: { ghost: true, longWings: true },
    stats: { window: 5 },
  },
  {
    id: 'tanglet',
    name: 'Tanglet',
    rarity: 2,
    ability: 'web',
    trick: 'Wherever it lands it spins a sticky web. Enemies caught in it move at half speed.',
    catch: 'Throws a bit shorter, and the blink window is 1s shorter.',
    flavour: 'Knits constantly. Nobody knows what for. Nobody dares ask.',
    tint: 0x8fe3d0,
    belly: 0xf2fffb,
    wing: 0xe8fff8,
    look: { spinner: true },
    stats: { throwSpeed: 17, window: 5 },
  },
  {
    id: 'snatchet',
    name: 'Snatchet',
    rarity: 3,
    ability: 'snatch',
    trick: 'Land it next to an enemy and your blink swaps YOU with THEM. Yank them out of cover (or into the Gloom).',
    catch: 'Naps 4s longer between blinks.',
    flavour: 'Tiny pincers. Enormous audacity.',
    tint: 0xff6bb5,
    belly: 0xffe0f0,
    wing: 0xffe6f4,
    look: { pincers: true },
    stats: { cooldown: 12 },
  },
  {
    id: 'pewpew',
    name: 'Pewpew',
    rarity: 3,
    ability: 'turret',
    trick: 'Where it lands it plants its feet and turns into a tiny turret: pew-pews the nearest enemy (3 damage a shot, twice a second) until you blink or its time runs out.',
    catch: 'Naps 3s longer, and every pew gives away where it is.',
    flavour: 'Wears a tiny helmet. Takes guard duty VERY seriously.',
    tint: 0xff5a4a,
    belly: 0xffe4dc,
    wing: 0xffece6,
    look: { turret: true },
    stats: { cooldown: 11 },
  },
  {
    id: 'glimmerwing',
    name: 'Glimmerwing',
    rarity: 3,
    ability: 'glide',
    trick: 'Flies way further and flatter, barely bouncing. Cross-map blinks!',
    catch: 'Naps 1.5s longer and lands where it lands — no bank shots.',
    flavour: 'Born in a sunbeam. Refuses to be born anywhere else.',
    tint: 0x49c8ff,
    belly: 0xe6f8ff,
    wing: 0xfff6c0,
    look: { longWings: true, scale: 0.95 },
    stats: { throwSpeed: 24, gravity: 10, restitution: 0.18, cooldown: 9.5 },
  },
  {
    id: 'nimbus',
    name: 'Nimbus',
    rarity: 4,
    ability: 'ping',
    trick: 'While it sits on the ground it senses rascals nearby and marks them for you.',
    catch: 'Glows like a lighthouse — easy for enemies to spot. Naps 1s longer.',
    flavour: 'Wears a crown. Earned it? Unclear.',
    tint: 0xffe27a,
    belly: 0xfffbe8,
    wing: 0xfffae0,
    look: { crown: true, scale: 1.05 },
    stats: { cooldown: 9 },
  },
];

export const SPECIES_BY_ID: Record<string, BugSpecies> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/** Bots bring a random bug, commons more often than mythics. */
const SPECIES_WEIGHT = [40, 28, 18, 10, 4];
export function randomSpecies() {
  const total = SPECIES.reduce((s, sp) => s + SPECIES_WEIGHT[sp.rarity], 0);
  let r = Math.random() * total;
  for (const sp of SPECIES) if ((r -= SPECIES_WEIGHT[sp.rarity]) <= 0) return sp;
  return SPECIES[0];
}

/**
 * Trained bugs (Bug Gym) get a little sharper per level: shorter naps, a longer blink window
 * and a faster throw. Level 8 is roughly a sixth quicker — noticeable, never a different bug.
 */
export function statsFor(sp: BugSpecies, level = 1): BugStats {
  const s = { ...BASE_BUG_STATS, ...sp.stats };
  const k = Math.max(0, Math.min(7, level - 1));
  s.cooldown *= 1 - 0.025 * k;
  s.window += 0.2 * k;
  s.throwSpeed *= 1 + 0.015 * k;
  return s;
}

/* ------------------------------------------------------------------ names */

const FIRST = ['Sir', 'Lil', 'Captain', 'Professor', 'Auntie', 'Big', 'Tiny', 'Duke', 'Madame', 'Old', 'Baby', 'Count'];
const CORE = ['Zip', 'Bop', 'Wig', 'Flick', 'Nib', 'Pip', 'Glim', 'Boing', 'Snap', 'Doodle', 'Fizz', 'Blip', 'Spud', 'Tootle', 'Crumb', 'Wobble'];
const TAIL = ['sworth', 'ington', 'kins', 'bottom', 'let', 'ster', 'o', 'zle', 'wick', 'bean', 'muffin', 'sprout'];

export function randomBugName(rng: () => number = Math.random): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const core = pick(CORE) + pick(TAIL);
  return rng() < 0.45 ? `${pick(FIRST)} ${core}` : core;
}

/* ------------------------------------------------------------------ collection (saved) */

export interface OwnedBug {
  species: string;
  name: string;
  /** every copy ever hatched (including the first) */
  copies: number;
  /** trained level (Bug Gym), 1..8 */
  level?: number;
  /** unspent duplicates, used up by training */
  spare?: number;
}

export interface Collection {
  bugs: OwnedBug[];
  equipped: string;
  cocoons: { rarity: RarityIndex }[];
  seen: string[];
}

const KEY = 'rr.bugs';

export function loadCollection(): Collection {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Collection;
      if (c.bugs?.length) {
        c.cocoons ??= [];
        c.seen ??= c.bugs.map((b) => b.species);
        if (!c.bugs.some((b) => b.species === c.equipped)) c.equipped = c.bugs[0].species;
        // older saves levelled by copies (every 3): keep that level, the rest become spares
        for (const b of c.bugs) {
          if (b.level === undefined) {
            b.level = Math.min(8, 1 + Math.floor((b.copies - 1) / 3));
            b.spare = Math.max(0, b.copies - 1 - (b.level - 1) * 3);
          }
          b.spare ??= 0;
        }
        return c;
      }
    }
  } catch {
    /* ignore */
  }
  // everybody starts with a Zippit of their very own, and one cocoon to crack open
  return { bugs: [{ species: 'zippit', name: randomBugName(), copies: 1, level: 1, spare: 0 }], equipped: 'zippit', cocoons: [{ rarity: 1 }], seen: ['zippit'] };
}

export function saveCollection(c: Collection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function bugLevel(b: OwnedBug) {
  return b.level ?? 1 + Math.floor((b.copies - 1) / 3);
}

/** Cocoon of a given rarity: mostly that tier, a real chance to jump one higher. */
export function hatch(c: Collection, cocoonRarity: RarityIndex, rng: () => number = Math.random): { species: BugSpecies; fresh: boolean; owned: OwnedBug } {
  let tier = cocoonRarity as number;
  const r = rng();
  if (r < 0.18 && tier < 4) tier++;
  if (r < 0.03 && tier < 4) tier++;
  if (r > 0.75 && tier > 0) tier--;
  let pool = SPECIES.filter((s) => s.rarity === tier);
  if (!pool.length) pool = SPECIES;
  // favour species you don't have yet
  const missing = pool.filter((s) => !c.bugs.some((b) => b.species === s.id));
  const pickFrom = missing.length && rng() < 0.7 ? missing : pool;
  const species = pickFrom[Math.floor(rng() * pickFrom.length)];
  let owned = c.bugs.find((b) => b.species === species.id);
  const fresh = !owned;
  if (owned) {
    owned.copies++;
    owned.spare = (owned.spare ?? 0) + 1;
  } else {
    owned = { species: species.id, name: randomBugName(rng), copies: 1, level: 1, spare: 0 };
    c.bugs.push(owned);
  }
  if (!c.seen.includes(species.id)) c.seen.push(species.id);
  return { species, fresh, owned };
}

/** End-of-match cocoon reward: better placement, better cocoon. */
export function cocoonForPlacement(place: number, of: number, kills: number): RarityIndex {
  const k = 1 - (place - 1) / Math.max(1, of - 1);
  let r = k > 0.95 ? 3 : k > 0.75 ? 2 : k > 0.4 ? 1 : 0;
  if (kills >= 5 && r < 4) r++;
  return r as RarityIndex;
}
