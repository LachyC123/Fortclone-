import { RarityIndex } from '../render/Palette';

/**
 * Trophy Road: trophies go up (or a little down) every match; milestones along the road hold
 * rewards you claim — cocoons, titles and new arenas. Your arena sets how sharp the bots are
 * (on AUTO difficulty); on LAN the room plays at the arena of everyone's average.
 */

export interface Arena {
  at: number;
  name: string;
  color: string;
  /** bot skill 0..1 in this arena (AUTO difficulty) */
  skill: number;
}

export const ARENAS: Arena[] = [
  { at: 0, name: 'Puddle Pals', color: '#7fb7e6', skill: 0.2 },
  { at: 150, name: 'Pebble Park', color: '#9dff8a', skill: 0.3 },
  { at: 350, name: 'Crate Canyon', color: '#f2c14e', skill: 0.4 },
  { at: 600, name: 'Blink Bay', color: '#6ff7ff', skill: 0.5 },
  { at: 900, name: 'Gloom Gardens', color: '#b49be0', skill: 0.6 },
  { at: 1300, name: 'Rift Royale', color: '#ff6bb5', skill: 0.7 },
  { at: 1800, name: "Legends' Lagoon", color: '#ffa726', skill: 0.8 },
];

export type Reward = { at: number } & ({ kind: 'cocoon'; rarity: RarityIndex } | { kind: 'title'; title: string } | { kind: 'arena'; arena: number; rarity: RarityIndex });

export const ROAD: Reward[] = [
  { at: 25, kind: 'cocoon', rarity: 0 },
  { at: 60, kind: 'cocoon', rarity: 1 },
  { at: 100, kind: 'title', title: 'Pebble Flinger' },
  { at: 150, kind: 'arena', arena: 1, rarity: 2 },
  { at: 200, kind: 'cocoon', rarity: 1 },
  { at: 275, kind: 'cocoon', rarity: 2 },
  { at: 350, kind: 'arena', arena: 2, rarity: 3 },
  { at: 425, kind: 'cocoon', rarity: 2 },
  { at: 500, kind: 'title', title: 'Crate Goblin' },
  { at: 600, kind: 'arena', arena: 3, rarity: 3 },
  { at: 700, kind: 'cocoon', rarity: 2 },
  { at: 800, kind: 'cocoon', rarity: 3 },
  { at: 900, kind: 'arena', arena: 4, rarity: 4 },
  { at: 1000, kind: 'title', title: 'Gloom Dodger' },
  { at: 1100, kind: 'cocoon', rarity: 3 },
  { at: 1200, kind: 'cocoon', rarity: 3 },
  { at: 1300, kind: 'arena', arena: 5, rarity: 4 },
  { at: 1450, kind: 'cocoon', rarity: 3 },
  { at: 1600, kind: 'title', title: 'Blink Wizard' },
  { at: 1700, kind: 'cocoon', rarity: 4 },
  { at: 1800, kind: 'arena', arena: 6, rarity: 4 },
  { at: 2000, kind: 'title', title: 'Rift Legend' },
];

export interface TrophyState {
  trophies: number;
  best: number;
  /** indexes into ROAD already claimed */
  claimed: number[];
  /** equipped title ('' = none) */
  title: string;
}

const KEY = 'rr.trophies';

export function loadTrophies(): TrophyState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { trophies: 0, best: 0, claimed: [], title: '', ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { trophies: 0, best: 0, claimed: [], title: '' };
}

export function saveTrophies(t: TrophyState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export function arenaIndex(trophies: number) {
  let i = 0;
  for (let k = 0; k < ARENAS.length; k++) if (trophies >= ARENAS[k].at) i = k;
  return i;
}
export const arenaFor = (trophies: number) => ARENAS[arenaIndex(trophies)];

/** rewards you've reached but not claimed yet */
export function unclaimed(t: TrophyState) {
  return ROAD.map((r, i) => ({ r, i })).filter(({ r, i }) => t.best >= r.at && !t.claimed.includes(i));
}

/**
 * Trophies for one match from a 24-rascal-scaled placement (so solo and squads feel the same).
 * Top half gains, the bottom quarter loses a little; eliminations add a few.
 */
export function trophyDelta(place24: number, kills: number, trophies: number) {
  const table = [0, 40, 32, 28, 22, 22, 15, 15, 15, 8, 8, 8, 8, 2, 2, 2, 2, -6, -6, -6, -6, -12, -12, -12, -12];
  let d = table[Math.max(1, Math.min(24, place24))] + Math.min(16, kills * 2);
  // the first arena is a safe place to learn: no losses there
  if (arenaIndex(trophies) === 0) d = Math.max(0, d);
  return d;
}

/** apply a match result: never drop below the gate of an arena you've reached */
export function applyMatch(t: TrophyState, delta: number) {
  const before = t.trophies;
  const floor = ARENAS[arenaIndex(t.best)].at;
  t.trophies = Math.max(floor, t.trophies + delta);
  const gained = t.trophies - before;
  const oldArena = arenaIndex(t.best);
  t.best = Math.max(t.best, t.trophies);
  saveTrophies(t);
  return { gained, before, after: t.trophies, newArena: arenaIndex(t.best) > oldArena ? arenaIndex(t.best) : -1 };
}
