import { RarityIndex } from '../render/Palette';
import type { OwnedBug } from './Bugs';
import { RELICS, RELIC_BY_ID, RELIC_DUPE_VALUE, RELIC_SETS, RelicBonus, RelicSet, rollRelic } from './Relics';

/**
 * THE BURROW: your own little floating island. Glimmer (earned in matches and pumped at home)
 * builds and upgrades it:
 *
 *  - Burrow Hall   the heart; its level caps everything else
 *  - Glimmer Pump  makes glimmer while you're away (collect it before the tank fills)
 *  - Incubators    cocoons hatch here over time; bigger ones are faster and cozier
 *                  (a cozy cocoon can hatch one rarity higher)
 *  - Bug Gym       level your bugs up with duplicates + glimmer
 *  - Relic Museum  shows off Rift Relics; relics on display boost the Burrow
 *  - Bazaar        a stall that sells cocoons (and the odd relic), restocked every few hours
 *  - Decor         just for looks. It's your place!
 */

export type BuildingId = 'hall' | 'pump' | 'inc1' | 'inc2' | 'inc3' | 'gym' | 'museum' | 'bazaar';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  blurb: string;
  max: number;
  /** Burrow Hall level needed to build it at all */
  hall: number;
  /** cost scale */
  base: number;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'hall', name: 'Burrow Hall', blurb: 'Home sweet stump. Upgrade it to unlock new buildings and higher levels.', max: 5, hall: 0, base: 150 },
  { id: 'pump', name: 'Glimmer Pump', blurb: 'Pumps glimmer out of the ground while you play (or sleep). Collect before the tank fills up!', max: 5, hall: 1, base: 60 },
  { id: 'inc1', name: 'Incubator', blurb: 'Pop a cocoon in to hatch it. Higher levels hatch faster and keep cocoons cozier.', max: 5, hall: 1, base: 50 },
  { id: 'gym', name: 'Bug Gym', blurb: 'Train your bugs with duplicates + glimmer. Each gym level raises how far they can grow.', max: 5, hall: 1, base: 80 },
  { id: 'inc2', name: 'Incubator', blurb: 'A second incubator — two cocoons at once.', max: 5, hall: 2, base: 50 },
  { id: 'museum', name: 'Relic Museum', blurb: 'Rift Relics on display boost your Burrow. Upgrades add more display shelves.', max: 3, hall: 2, base: 100 },
  { id: 'bazaar', name: 'Bug Bazaar', blurb: 'A stall that sells cocoons and the odd relic. Restocks every 3 hours.', max: 3, hall: 3, base: 90 },
  { id: 'inc3', name: 'Incubator', blurb: 'Three incubators. A proper nursery.', max: 5, hall: 4, base: 50 },
];
export const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingId, BuildingDef>;
export const INCUBATORS: BuildingId[] = ['inc1', 'inc2', 'inc3'];

export interface DecorDef {
  id: string;
  name: string;
  price: number;
}
export const DECOR: DecorDef[] = [
  { id: 'flowers', name: 'Flower Beds', price: 40 },
  { id: 'lanterns', name: 'String Lights', price: 70 },
  { id: 'mushrooms', name: 'Giant Mushrooms', price: 90 },
  { id: 'flag', name: 'Burrow Flag', price: 110 },
  { id: 'hammock', name: 'Hammock', price: 140 },
  { id: 'bath', name: 'Bug Bath', price: 180 },
  { id: 'gnome', name: 'Garden Gnome', price: 240 },
];

export interface IncSlot {
  r: RarityIndex;
  /** ms timestamp it's ready */
  end: number;
  /** full duration (ms), for the progress ring */
  dur: number;
}

export type Offer = { kind: 'cocoon'; r: RarityIndex; price: number; sold: boolean } | { kind: 'relic'; id: string; price: number; sold: boolean };

export interface BurrowState {
  glimmer: number;
  lv: Record<BuildingId, number>;
  pump: { stock: number; t: number };
  inc: (IncSlot | null)[];
  /** relic id -> copies found */
  relics: Record<string, number>;
  /** sets completed (prize paid, hat unlocked) */
  sets: string[];
  /** equipped hat ('' = your usual) */
  hat: string;
  decor: string[];
  bazaar: { slot: number; offers: Offer[] };
  /** lifetime glimmer earned */
  earned: number;
}

const KEY = 'rr.burrow';
const HOUR = 3600_000;
const MIN = 60_000;

export function freshBurrow(now = Date.now()): BurrowState {
  return {
    glimmer: 150,
    lv: { hall: 1, pump: 1, inc1: 1, inc2: 0, inc3: 0, gym: 0, museum: 0, bazaar: 0 },
    pump: { stock: 30, t: now },
    inc: [null, null, null],
    relics: {},
    sets: [],
    hat: '',
    decor: [],
    bazaar: { slot: -1, offers: [] },
    earned: 0,
  };
}

export function loadBurrow(): BurrowState {
  const def = freshBurrow();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw) as Partial<BurrowState>;
      return {
        ...def,
        ...b,
        lv: { ...def.lv, ...(b.lv ?? {}) },
        pump: { ...def.pump, ...(b.pump ?? {}) },
        inc: [0, 1, 2].map((i) => b.inc?.[i] ?? null),
        relics: { ...(b.relics ?? {}) },
        bazaar: b.bazaar ?? def.bazaar,
      };
    }
  } catch {
    /* ignore */
  }
  return def;
}

export function saveBurrow(b: BurrowState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ relic bonuses */

export const MUSEUM_SHELVES = [0, 8, 14, 20];

/** relics on display: the museum shows the rarest first, up to its shelf count */
export function displayed(b: BurrowState) {
  const own = RELICS.filter((r) => b.relics[r.id]).sort((a, c) => c.rarity - a.rarity);
  return own.slice(0, MUSEUM_SHELVES[b.lv.museum] ?? 0);
}

export function bonus(b: BurrowState, kind: RelicBonus) {
  let n = 0;
  for (const r of displayed(b)) if (r.bonus === kind) n += r.amount;
  return n;
}

/* ------------------------------------------------------------------ building + upgrading */

/** glimmer to reach level `to` */
export function costFor(id: BuildingId, to: number) {
  const d = BUILDING_BY_ID[id];
  const k = id === 'hall' ? to - 1 : to;
  return Math.round((d.base * Math.pow(Math.max(1, k), 1.7) * (to === 1 ? 1.5 : 1)) / 5) * 5;
}

export function upgradeInfo(b: BurrowState, id: BuildingId): { ok: boolean; cost: number; reason: string; maxed: boolean } {
  const d = BUILDING_BY_ID[id];
  const cur = b.lv[id];
  if (cur >= d.max) return { ok: false, cost: 0, reason: 'Max level!', maxed: true };
  const to = cur + 1;
  const cost = costFor(id, to);
  if (id !== 'hall') {
    const need = Math.max(d.hall, to);
    if (b.lv.hall < need) return { ok: false, cost, reason: `Needs Burrow Hall LV ${need}`, maxed: false };
  }
  if (b.glimmer < cost) return { ok: false, cost, reason: `Need ${cost - b.glimmer} more glimmer`, maxed: false };
  return { ok: true, cost, reason: '', maxed: false };
}

export function upgrade(b: BurrowState, id: BuildingId) {
  const u = upgradeInfo(b, id);
  if (!u.ok) return false;
  b.glimmer -= u.cost;
  b.lv[id]++;
  saveBurrow(b);
  return true;
}

/* ------------------------------------------------------------------ glimmer pump */

const PUMP_RATE = [0, 80, 140, 220, 330, 480];
/** hours of output the tank holds */
const PUMP_HOURS = 3;

export function pumpRate(b: BurrowState) {
  return Math.round(PUMP_RATE[b.lv.pump] * (1 + bonus(b, 'pump') / 100));
}
export function pumpCap(b: BurrowState) {
  return Math.round(pumpRate(b) * PUMP_HOURS);
}
/** bring the tank up to date */
export function pumpTick(b: BurrowState, now = Date.now()) {
  const dt = Math.max(0, now - b.pump.t);
  b.pump.stock = Math.min(pumpCap(b), b.pump.stock + (pumpRate(b) * dt) / HOUR);
  b.pump.t = now;
  return b.pump.stock;
}
export function collectPump(b: BurrowState, now = Date.now()) {
  const n = Math.floor(pumpTick(b, now));
  if (n <= 0) return 0;
  b.pump.stock -= n;
  earn(b, n);
  return n;
}

export function earn(b: BurrowState, n: number) {
  b.glimmer += n;
  b.earned += Math.max(0, n);
  saveBurrow(b);
}

/* ------------------------------------------------------------------ incubators */

/** base hatch minutes per cocoon rarity */
const HATCH_MIN = [1, 3, 8, 20, 45];

export function incLevel(b: BurrowState, slot: number) {
  return b.lv[INCUBATORS[slot]];
}
export function hatchMs(b: BurrowState, slot: number, r: RarityIndex) {
  const L = Math.max(1, incLevel(b, slot));
  return HATCH_MIN[r] * MIN * (1 - 0.1 * (L - 1)) * (1 - bonus(b, 'incubate') / 100);
}
/** chance a cocoon comes out one rarity higher */
export function cozyChance(b: BurrowState, slot: number) {
  return Math.min(0.5, 0.04 * Math.max(1, incLevel(b, slot)) + bonus(b, 'warmth') / 100);
}
export function incubate(b: BurrowState, slot: number, r: RarityIndex, now = Date.now()) {
  if (!incLevel(b, slot) || b.inc[slot]) return false;
  const dur = hatchMs(b, slot, r);
  b.inc[slot] = { r, end: now + dur, dur };
  saveBurrow(b);
  return true;
}
export function incLeft(b: BurrowState, slot: number, now = Date.now()) {
  const s = b.inc[slot];
  return s ? Math.max(0, s.end - now) : 0;
}
export function rushCost(ms: number) {
  return Math.max(5, Math.ceil((ms / MIN) * 4));
}
export function rush(b: BurrowState, slot: number, now = Date.now()) {
  const s = b.inc[slot];
  if (!s) return false;
  const c = rushCost(incLeft(b, slot, now));
  if (b.glimmer < c) return false;
  b.glimmer -= c;
  s.end = now;
  saveBurrow(b);
  return true;
}
/** take a ready cocoon out: its final rarity (maybe cozied up a tier) */
export function takeHatched(b: BurrowState, slot: number, rng: () => number = Math.random, now = Date.now()): { r: RarityIndex; cozy: boolean } | null {
  const s = b.inc[slot];
  if (!s || s.end > now) return null;
  let r = s.r as number;
  const cozy = r < 4 && rng() < cozyChance(b, slot);
  if (cozy) r++;
  b.inc[slot] = null;
  saveBurrow(b);
  return { r: r as RarityIndex, cozy };
}
/** playing a match keeps the incubators warm: knocks a few minutes off every cocoon */
export function warmIncubators(b: BurrowState, minutes = 4) {
  for (const s of b.inc) if (s) s.end -= minutes * MIN;
  saveBurrow(b);
}

/* ------------------------------------------------------------------ match rewards */

export function matchGlimmer(b: BurrowState, place24: number, kills: number, won: boolean): [string, number][] {
  const parts: [string, number][] = [
    ['Showing up', 20],
    ['Placement', Math.max(0, (25 - place24) * 3)],
    ['Eliminations', kills * 6],
  ];
  if (won) parts.push(['Victory!', 60]);
  const rb = bonus(b, 'match');
  if (rb) parts.push(['Relic bonus', rb]);
  return parts.filter((p) => p[1] > 0);
}

/** a relic reached home: new ones join the museum, repeats turn into glimmer, sets pay out */
export function addRelic(b: BurrowState, id: string): { fresh: boolean; glimmer: number; set: RelicSet | null } {
  const def = RELIC_BY_ID[id];
  if (!def) return { fresh: false, glimmer: 0, set: null };
  const fresh = !b.relics[id];
  b.relics[id] = (b.relics[id] ?? 0) + 1;
  let g = 0;
  if (!fresh) g += RELIC_DUPE_VALUE[def.rarity];
  let set: RelicSet | null = null;
  const s = RELIC_SETS.find((x) => x.id === def.set)!;
  if (fresh && !b.sets.includes(s.id) && RELICS.filter((r) => r.set === s.id).every((r) => b.relics[r.id])) {
    b.sets.push(s.id);
    g += s.prize;
    set = s;
  }
  if (g) b.earned += g;
  b.glimmer += g;
  saveBurrow(b);
  return { fresh, glimmer: g, set };
}

export function hatsOwned(b: BurrowState) {
  return RELIC_SETS.filter((s) => b.sets.includes(s.id)).map((s) => s.hat);
}

/* ------------------------------------------------------------------ bazaar */

const BAZAAR_SLOT = 3 * HOUR;
const COCOON_PRICE = [40, 90, 180, 400, 900];
const RELIC_PRICE = [120, 200, 350, 600, 1000];

export function bazaarPrice(b: BurrowState, p: number) {
  return Math.round((p * (1 - bonus(b, 'bazaar') / 100)) / 5) * 5;
}

function rollOffers(b: BurrowState, rng: () => number): Offer[] {
  const L = Math.max(1, b.lv.bazaar);
  const out: Offer[] = [];
  const n = 2 + L;
  for (let i = 0; i < n; i++) {
    // better stock at bigger stalls
    const x = rng();
    const r = (x < 0.4 ? 0 : x < 0.7 ? 1 : x < 0.88 ? 2 : x < 0.97 ? 3 : 4) as RarityIndex;
    const tier = Math.min(4, r + (i === n - 1 && L >= 3 ? 1 : 0)) as RarityIndex;
    out.push({ kind: 'cocoon', r: tier, price: bazaarPrice(b, COCOON_PRICE[tier]), sold: false });
  }
  if (L >= 2) {
    const rel = rollRelic(b.relics, rng);
    out.push({ kind: 'relic', id: rel.id, price: bazaarPrice(b, RELIC_PRICE[rel.rarity]), sold: false });
  }
  return out;
}

/** current stock (restocks itself every 3 hours) */
export function bazaarOffers(b: BurrowState, now = Date.now(), rng: () => number = Math.random) {
  const slot = Math.floor(now / BAZAAR_SLOT);
  if (b.bazaar.slot !== slot || !b.bazaar.offers.length) {
    b.bazaar = { slot, offers: rollOffers(b, rng) };
    saveBurrow(b);
  }
  return b.bazaar.offers;
}
export function bazaarRestockIn(now = Date.now()) {
  return BAZAAR_SLOT - (now % BAZAAR_SLOT);
}
export const RESTOCK_COST = 25;
export function restock(b: BurrowState, rng: () => number = Math.random) {
  if (b.glimmer < RESTOCK_COST) return false;
  b.glimmer -= RESTOCK_COST;
  b.bazaar.offers = rollOffers(b, rng);
  saveBurrow(b);
  return true;
}

/* ------------------------------------------------------------------ bug training */

/** duplicate copies needed to go from level L to L+1 */
export const TRAIN_COPIES = [0, 1, 2, 3, 4, 5, 6, 8];
export const MAX_BUG_LEVEL = 8;
export function trainCost(b: BurrowState, level: number) {
  return Math.round(((30 * level * level + 30) * (1 - bonus(b, 'train') / 100)) / 5) * 5;
}
/** can this bug level up right now? (and what it'd take) */
export function trainInfo(b: BurrowState, o: OwnedBug) {
  const L = o.level ?? 1;
  const need = TRAIN_COPIES[L] ?? 99;
  const cost = trainCost(b, L);
  const cap = gymCap(b);
  let reason = '';
  if (L >= MAX_BUG_LEVEL) reason = 'Max level!';
  else if (!b.lv.gym) reason = 'Build a Bug Gym in your Burrow';
  else if (L >= cap) reason = `Upgrade the Bug Gym to go past LV ${cap}`;
  else if ((o.spare ?? 0) < need) reason = `Hatch ${need - (o.spare ?? 0)} more ${need - (o.spare ?? 0) > 1 ? 'copies' : 'copy'}`;
  else if (b.glimmer < cost) reason = `Need ${cost - b.glimmer} more glimmer`;
  return { ok: !reason, reason, need, cost, level: L, maxed: L >= MAX_BUG_LEVEL };
}

export function train(b: BurrowState, o: OwnedBug) {
  const t = trainInfo(b, o);
  if (!t.ok) return false;
  b.glimmer -= t.cost;
  o.spare = (o.spare ?? 0) - t.need;
  o.level = t.level + 1;
  saveBurrow(b);
  return true;
}

/** how high the gym lets bugs go */
export function gymCap(b: BurrowState) {
  return b.lv.gym ? Math.min(MAX_BUG_LEVEL, b.lv.gym + 3) : 1;
}

/** short readable time: 1h 20m / 4m 05s / 12s */
export function fmtTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
