import { Kit } from '../Kit';
import type { World } from '../World';
import * as P from '../Props';
import { PAL } from '../../render/Palette';
import { Rng } from '../../core/math';
import { shade } from '../BuildingKit';
import { signPost } from '../Homes';
import { islandRadius, STREAM_X, STREAM_Z0, STREAM_Z1, LAGOON_POS, ROADS, POIS } from '../Heightmap';
import { ground, busy, lowGround, highGround, loot, lootG, crate, groundLine, reserved } from './common';

/**
 * The in-between: small named landmarks tucked into the gaps between places — camps, ruins,
 * a balloon wreck, a frog pond, orchards, a lumber camp, standing stones, picnic spots, scout
 * posts and pumpkin patches. Each has cover, loot (some a crate) and a name that pops up as you
 * arrive, so crossing the island is a string of little places rather than empty grass.
 * Roads get signposts and lamps. Runs after everything else so it only uses land that's free.
 */
type Kind = 'camp' | 'ruins' | 'balloon' | 'pond' | 'orchard' | 'lumber' | 'stones' | 'picnic' | 'scout' | 'pumpkins';

const NAMES: Record<Kind, string[]> = {
  camp: ['Rascal Camp', 'Sleepy Hollow Camp', 'Marshmallow Camp'],
  ruins: ['Old Ruins', 'Crumbly Keep', 'Forgotten Arch'],
  balloon: ['Balloon Wreck', 'Bumpy Landing'],
  pond: ['Frog Pond', 'Lily Pond'],
  orchard: ['Apple Orchard', 'Plum Orchard'],
  lumber: ['Lumber Camp', 'Splinter Yard'],
  stones: ['Standing Stones', 'Humming Stones'],
  picnic: ['Picnic Hill', 'Sunny Meadow'],
  scout: ['Scout Post', 'Owl Lookout'],
  pumpkins: ['Pumpkin Patch', 'Squash Corner'],
};
/** how much flat, clear room each needs (radius) */
const SIZE: Record<Kind, number> = { camp: 6, ruins: 6.5, balloon: 6, pond: 7, orchard: 7.5, lumber: 6, stones: 6, picnic: 4.5, scout: 4.5, pumpkins: 6.5 };
/** how much the ground may rise across the site: water, soil rows and blankets need it flat */
const SLOPE: Record<Kind, number> = { camp: 1.7, ruins: 2.0, balloon: 1.7, pond: 1.7, orchard: 1.8, lumber: 1.6, stones: 2.0, picnic: 1.6, scout: 1.8, pumpkins: 1.8 };

interface Site {
  kind: Kind;
  name: string;
  x: number;
  z: number;
  yaw: number;
}
let plan: Site[] = [];

/** fixed features of the Wilds (farm fields, barns, Lookout Hill) that don't check reservations */
const FIXED: [number, number, number][] = [
  [-64, 38, 12], [38, -84, 9], [-56, 70, 9], [76, -38, 10],
  [-80, 26, 8], [17, -80, 8], [44, 38, 17],
];

/**
 * Pick the landmark sites first (terrain only), and reserve them so the woods, outcrops and
 * homesteads planted afterwards grow round them rather than through them.
 */
export function planLandmarks() {
  const rng = new Rng(9090);
  plan = [];
  const ok = (x: number, z: number, r: number, kind: Kind) => {
    if (busy(x, z, r + 3, r + 4)) return false;
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - r - 6) return false;
    if (Math.abs(x - STREAM_X) < r + 7 && z > STREAM_Z0 - 6 && z < STREAM_Z1 + 6) return false;
    if (Math.hypot(x - LAGOON_POS.x, z - LAGOON_POS.z) < LAGOON_POS.r + r + 6) return false;
    if (highGround(x, z, r) - lowGround(x, z, r) > SLOPE[kind]) return false;
    if (highGround(x, z, r * 0.5) - lowGround(x, z, r * 0.5) > SLOPE[kind] * 0.7) return false;
    if (FIXED.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < fr + r + 2)) return false;
    return !plan.some((p) => Math.hypot(p.x - x, p.z - z) < 18);
  };
  const order: Kind[] = ['ruins', 'balloon', 'pond', 'orchard', 'stones', 'pumpkins', 'camp', 'lumber', 'scout', 'picnic'];
  const used: Record<string, number> = {};
  for (let round = 0; round < 2; round++) {
    for (const kind of order) {
      const r = SIZE[kind];
      for (let tries = 0; tries < 1500; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.range(0.1, 1)) * (islandRadius(a) - 10);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!ok(x, z, r, kind)) continue;
        const i = used[kind] ?? 0;
        used[kind] = i + 1;
        plan.push({ kind, name: NAMES[kind][i % NAMES[kind].length], x, z, yaw: rng.range(0, Math.PI * 2) });
        reserved.push([x, z, r + 3]);
        break;
      }
    }
  }
  return plan.length;
}

/** build the planned landmarks (after everything else) plus the road signs and lamps */
export function buildLandmarks(k: Kit, world: World) {
  const rng = new Rng(9191);
  for (const s of plan) {
    const r = SIZE[s.kind];
    BUILD[s.kind](k, world, rng, s.x, s.z, s.yaw);
    world.addZone(s.name, s.x - r - 2, s.z - r - 2, s.x + r + 2, s.z + r + 2, -5, 40, false);
    world.landmarks.push({ name: s.name, x: s.x, z: s.z });
  }
  roadside(k, world, rng);
  return plan.length;
}

/* ------------------------------------------------------------------ helpers */

/**
 * Local frame at (x, z) facing yaw, standing on the site's average ground. `h(lx, lz)` gives the
 * ground height at a local spot (relative to the frame) so low pieces can hug a gentle slope.
 */
function frame(k: Kit, x: number, z: number, yaw: number, r: number, fn: (w: (lx: number, lz: number) => [number, number], h: (lx: number, lz: number) => number) => void) {
  const y = (ground(x, z) * 2 + lowGround(x, z, r * 0.6) + highGround(x, z, r * 0.6)) / 4 - 0.05;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const w = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const h = (lx: number, lz: number) => ground(...w(lx, lz)) - y;
  k.push(x, y, z, yaw);
  fn(w, h);
  k.pop();
  return y;
}

function campfire(k: Kit, lx: number, lz: number) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.ico(lx + Math.cos(a) * 0.55, 0.12, lz + Math.sin(a) * 0.55, 0.18, PAL.stoneDark, { detail: 0 });
  }
  k.cyl(lx, 0.12, lz, 0.07, 0.07, 0.9, PAL.brownDark, { pitch: Math.PI / 2, yaw: 0.5 });
  k.cyl(lx, 0.15, lz, 0.07, 0.07, 0.9, PAL.wood, { pitch: Math.PI / 2, yaw: -0.8 });
  // the flames glow in the dark
  k.cone(lx, 0.45, lz, 0.28, 0.6, 0xffb347, { batch: 'glow' });
  k.cone(lx + 0.05, 0.4, lz - 0.04, 0.16, 0.45, 0xfff27a, { batch: 'glow' });
}

function tent(k: Kit, lx: number, lz: number, yaw: number, color: number) {
  k.push(lx, 0, lz, yaw);
  k.prism(0, 0, 0, 2.4, 1.6, 2.8, color, { col: null });
  k.box(0, 0.03, 0, 2.5, 0.06, 2.9, shade(color, 0.7));
  k.prism(0, 0, -1.42, 0.8, 0.9, 0.05, shade(color, 0.55));
  k.collider(0, 0.8, 0, 2.2, 1.6, 2.7, 'cloth');
  k.pop();
}

/* ------------------------------------------------------------------ the landmarks */

const BUILD: Record<Kind, (k: Kit, world: World, rng: Rng, x: number, z: number, yaw: number) => void> = {
  camp(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 6, (w) => {
      campfire(k, 0, 0);
      const cols = [PAL.terracotta, PAL.teal, PAL.mustard, PAL.lavender];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        tent(k, Math.cos(a) * 4, Math.sin(a) * 4, -a - Math.PI / 2, cols[i % cols.length]);
      }
      // log seats round the fire
      for (const a of [1.5, 3.6, 5.6]) k.cyl(Math.cos(a) * 1.8, 0.25, Math.sin(a) * 1.8, 0.25, 0.25, 1.6, PAL.wood, { pitch: Math.PI / 2, yaw: -a, col: 'wood' });
      P.crate(k, 2.6, 0, -2.4, 0.8, 0.3);
      P.barrel(k, -2.8, 0, 2.2, PAL.teal);
      const [lx, lz] = w(0, 2.2);
      lootG(world, lx, lz, 'weapon');
      const [mx, mz] = w(-2, -2);
      lootG(world, mx, mz);
      void rng;
    });
  },

  ruins(k, world, rng, x, z, yaw) {
    const y = frame(k, x, z, yaw, 6.5, (w) => {
      const stone = [PAL.stone, 0xb0a594, 0x9c9384];
      // an L of broken walls and a lone arch: good cover, holes to peek through
      const walls: [number, number, number, number, number][] = [[-5, -4, 1, -4, 2.6], [2.5, -4, 5, -4, 1.4], [-5, -4, -5, 1, 2.2], [-5, 3, -5, 5, 1.1], [5, 1, 5, 5, 2.4]];
      for (const [ax, az, bx, bz, hh] of walls) {
        const L = Math.hypot(bx - ax, bz - az);
        const segs = Math.max(1, Math.round(L / 1.2));
        for (let i = 0; i < segs; i++) {
          const t = (i + 0.5) / segs;
          const h = hh * (0.55 + rng.next() * 0.45);
          k.box(ax + (bx - ax) * t, h / 2, az + (bz - az) * t, bx !== ax ? L / segs + 0.05 : 0.7, h, bz !== az ? L / segs + 0.05 : 0.7, shade(rng.pick(stone), rng.range(0.9, 1.05)), { col: 'stone' });
        }
      }
      // the arch
      for (const s of [-1, 1]) k.box(s * 1.1, 1.4, 2, 0.6, 2.8, 0.6, 0xb0a594, { col: 'stone' });
      k.box(0, 3.0, 2, 2.8, 0.5, 0.7, 0x9c9384, { col: 'stone' });
      // fallen pillars and rubble
      k.cyl(1.5, 0.35, -1, 0.35, 0.35, 3, PAL.stone, { pitch: Math.PI / 2, yaw: 0.7, col: 'stone' });
      k.cyl(-2, 0.9, 3.5, 0.35, 0.38, 1.8, PAL.stone, { col: 'stone' });
      for (let i = 0; i < 8; i++) k.ico(rng.range(-4.5, 4.5), 0.15, rng.range(-3.5, 3.5), rng.range(0.15, 0.35), PAL.stoneDark, { detail: 0 });
      const [lx, lz] = w(-3.5, -2.5);
      lootG(world, lx, lz, 'weapon');
      const [mx, mz] = w(3.5, 3);
      lootG(world, mx, mz);
    });
    // a crate under the arch
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    crate(world, x + 0 * cs + 3.2 * sn, y + 0.02, z - 0 * sn + 3.2 * cs, yaw);
  },

  balloon(k, world, rng, x, z, yaw) {
    const y = frame(k, x, z, yaw, 6, (w) => {
      // the basket, tipped over
      k.push(0, 0.6, 0, 0);
      k.box(0, 0, 0, 1.8, 1.2, 1.8, 0xb07a4f, { col: 'wood', roll: 0.35, r: 0.08 });
      k.box(0, 0.62, 0, 1.9, 0.14, 1.9, PAL.brownDark, { roll: 0.35 });
      k.pop();
      // the canopy, deflated and draped over the grass in stripes
      const stripes = [PAL.pink, PAL.mustard, PAL.turquoise, 0xffffff];
      for (let i = 0; i < 6; i++) k.sphere(-3.2 + i * 0.25, 0.35 + Math.sin(i) * 0.15, -0.5 + i * 0.35, 1.6 - i * 0.12, stripes[i % 4], { sy: 0.28, sx: 1.4, sz: 1.1, segs: 12 });
      k.collider(-2.4, 0.5, 0.4, 4, 1, 3.2, 'cloth');
      // ropes and sandbags
      for (let i = 0; i < 4; i++) k.cyl(-1.2 + i * 0.3, 0.1, 1 + i * 0.4, 0.02, 0.02, 2.4, PAL.brownDark, { pitch: Math.PI / 2, yaw: 0.4 + i * 0.3 });
      for (let i = 0; i < 5; i++) k.sphere(rng.range(-1, 3), 0.18, rng.range(-2.5, 2.5), 0.25, 0xc9b28a, { sy: 0.7 });
      P.crate(k, 2.2, 0, 1.6, 0.8, 0.5, PAL.mustard);
      P.crate(k, 2.6, 0, 0.8, 0.6, -0.3);
      const [lx, lz] = w(1.6, -1.8);
      lootG(world, lx, lz, 'weapon');
    });
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    crate(world, x + 3.4 * cs - 1.5 * sn, y + 0.02, z - 3.4 * sn - 1.5 * cs, yaw + 0.3);
  },

  pond(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 7, (w, h) => {
      // a stone-edged pond: the water sits level with the highest bank, the rim steps down to the
      // grass on the low side, so it looks built into the slope rather than buried by it
      let top = -Infinity;
      for (let i = 0; i < 16; i++) top = Math.max(top, h(Math.cos((i / 16) * Math.PI * 2) * 4.6, Math.sin((i / 16) * Math.PI * 2) * 4.6));
      top = Math.max(top, h(0, 0)) + 0.25;
      const low = top - 0.2;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const rx = Math.cos(a) * 4.9, rz = Math.sin(a) * 4.9;
        const gy = h(rx, rz) - 0.2;
        const hh = top + 0.15 - gy;
        k.box(rx, gy + hh / 2, rz, 1.25, hh, 0.55, shade(PAL.stone, 0.9 + (i % 3) * 0.05), { yaw: -a + Math.PI / 2, col: 'stone', r: 0.08 });
      }
      k.cyl(0, low - 0.2, 0, 4.7, 4.7, 0.4, 0x7a6a4a, { batch: 'nocast', segs: 24 });
      k.cyl(0, low + 0.02, 0, 4.7, 4.7, 0.05, 0x5fb8d8, { batch: 'nocast', segs: 24 });
      for (let i = 0; i < 9; i++) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(1.5, 4);
        k.cyl(Math.cos(a) * d, low + 0.06, Math.sin(a) * d, 0.35, 0.35, 0.02, 0x5aa347, { batch: 'nocast', segs: 8 });
      }
      // reeds all round the edge
      for (let i = 0; i < 26; i++) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(4.6, 5.6);
        const rx = Math.cos(a) * d, rz = Math.sin(a) * d;
        k.cone(rx, Math.max(low, h(rx, rz)) + 0.55, rz, 0.06, rng.range(0.9, 1.4), rng.pick([0x6fa84a, 0x8fbf5a]), { batch: 'foliage', wind: 1, segs: 3 });
      }
      // a little jetty out from the rim, and a rowboat on the water
      for (let i = 0; i < 5; i++) k.box(1.6 + i * 0.6, top + 0.12, 0, 0.55, 0.1, 1.4, i % 2 ? PAL.wood : PAL.woodLight, { col: 'wood' });
      for (const sz of [-0.65, 0.65]) k.cyl(1.9, low - 0.1, sz, 0.07, 0.07, 0.6, PAL.brownDark);
      k.box(-1.5, low + 0.18, 1.6, 2.4, 0.4, 1.0, PAL.terracotta, { r: 0.15, yaw: 0.6 });
      k.box(-1.5, low + 0.31, 1.6, 2.0, 0.1, 0.7, PAL.woodLight, { yaw: 0.6 });
      // the water itself: shallow, you wade through it (the floor collides just under the surface)
      k.collider(0, low - 0.15, 0, 7, 0.3, 7, 'water');
      const [lx, lz] = w(3.4, 0);
      loot(world, lx, ground(x, z) - h(0, 0) + top + 0.25, lz, 'weapon');
      const [mx, mz] = w(-5.8, -2);
      lootG(world, mx, mz);
    });
  },

  orchard(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 7.5, (w) => {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const tx = -4.5 + i * 4.5 + rng.range(-0.4, 0.4), tz = -4.5 + j * 4.5 + rng.range(-0.4, 0.4);
          if (i === 1 && j === 1) continue;
          P.tree(k, tx, tz, rng.range(0.75, 0.9), 0, rng.chance(0.4) ? 'blossom' : 'round');
          const fruit = yaw > 3 ? 0x8a4ab0 : 0xe8423c;
          for (let f = 0; f < 5; f++) k.sphere(tx + rng.range(-1, 1), rng.range(2.2, 3), tz + rng.range(-1, 1), 0.13, fruit);
        }
      // a cart of fruit and a ladder in the middle
      P.cart(k, 0, 0, 0.4);
      k.box(0.9, 1.1, -0.8, 0.5, 2.2, 0.08, PAL.woodLight, { roll: 0.25 });
      P.crate(k, -0.8, 0, 1.1, 0.6, 0.2, 0xe8423c);
    });
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const W = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    // low fence round it with a gap
    const c = [W(-7, -7), W(7, -7), W(7, 7), W(-7, 7)];
    for (let i = 0; i < 4; i++) {
      if (i === 2) continue;
      groundLine(k, 'fence', c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], 3);
    }
    const [lx, lz] = W(1.5, 1.5);
    lootG(world, lx, lz, 'weapon');
    const [mx, mz] = W(-3, 3);
    lootG(world, mx, mz);
  },

  lumber(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 6, (w) => {
      // log piles: pyramids of logs, chest-high cover
      for (const [px, pz, py] of [[-2.5, -1.5, 0], [2.8, 1.5, 0.2]]) {
        for (let row = 0; row < 3; row++)
          for (let i = 0; i < 3 - row; i++) k.cyl(px + (i - (2 - row) / 2) * 0.62, 0.3 + row * 0.52, pz, 0.3, 0.3, 3.2, shade(PAL.wood, rng.range(0.85, 1.05)), { pitch: Math.PI / 2, yaw: py });
        k.collider(px, 0.8, pz, 2, 1.6, 3.2, 'wood', { yaw: py });
      }
      // plank stacks and a sawhorse
      for (let i = 0; i < 5; i++) k.box(0, 0.08 + i * 0.12, 3.2, 3, 0.1, 0.5 + (i % 2) * 0.1, PAL.woodLight, { col: i === 4 ? 'wood' : null });
      k.collider(0, 0.35, 3.2, 3, 0.7, 0.6, 'wood');
      k.box(-0.5, 0.7, -3.4, 1.8, 0.14, 0.22, PAL.wood);
      for (const s of [-1, 1]) for (const t of [-1, 1]) k.box(-0.5 + s * 0.7, 0.35, -3.4 + t * 0.2, 0.08, 0.75, 0.08, PAL.brownDark, { roll: s * 0.2 });
      // stumps with an axe
      for (let i = 0; i < 4; i++) k.cyl(rng.range(-5, 5), 0.25, rng.range(-5, -3.8), 0.4, 0.45, 0.5, PAL.wood, { col: 'wood' });
      k.box(4.2, 0.9, -2.6, 0.08, 0.9, 0.08, PAL.brownDark, { roll: 0.3 });
      k.box(4.35, 1.3, -2.6, 0.3, 0.2, 0.05, 0x9aa4b0);
      const [lx, lz] = w(0, 0);
      lootG(world, lx, lz, 'weapon');
      const [mx, mz] = w(-4, 2.5);
      lootG(world, mx, mz);
    });
  },

  stones(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 6, (w) => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (i === 5) {
          // one has fallen over
          k.box(Math.cos(a) * 4.6, 0.4, Math.sin(a) * 4.6, 2.6, 0.8, 1.1, 0x9c9384, { yaw: -a, col: 'stone', r: 0.1 });
          continue;
        }
        const h = rng.range(2.4, 3.4);
        k.box(Math.cos(a) * 4.4, h / 2, Math.sin(a) * 4.4, 1.1, h, 0.7, shade(0xa89c8c, rng.range(0.9, 1.05)), { yaw: -a + Math.PI / 2, col: 'stone', r: 0.12 });
      }
      // a mossy altar with a faint glowing rune
      k.box(0, 0.45, 0, 1.8, 0.9, 1.2, 0x8a7f72, { col: 'stone', r: 0.08 });
      k.box(0, 0.92, 0, 0.9, 0.03, 0.5, 0x9ffcff, { batch: 'glow' });
      for (let i = 0; i < 6; i++) k.ico(rng.range(-3, 3), 0.1, rng.range(-3, 3), 0.25, PAL.leafDark, { detail: 0, sy: 0.4, batch: 'foliage' });
      const [lx, lz] = w(0, 0);
      loot(world, lx, ground(lx, lz) + 1.0, lz, 'weapon');
      const [mx, mz] = w(2.5, -2.5);
      lootG(world, mx, mz);
    });
  },

  picnic(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 4.5, (w, h) => {
      // checked blanket
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const bx = -0.9 + i * 0.6, bz = -0.9 + j * 0.6;
          k.box(bx, h(bx, bz) + 0.03, bz, 0.6, 0.03, 0.6, (i + j) % 2 ? 0xe8423c : 0xffffff, { batch: 'nocast' });
        }
      // basket, plates, a big umbrella
      k.box(0.6, 0.2, 0.3, 0.6, 0.35, 0.4, 0xc9a26a, { r: 0.05 });
      k.torus(0.6, 0.45, 0.3, 0.25, 0.03, 0xb07a4f, { pitch: Math.PI / 2 });
      for (let i = 0; i < 3; i++) k.cyl(-0.6 + i * 0.4, 0.05, -0.5, 0.15, 0.15, 0.03, 0xffffff);
      k.cyl(-1.6, 1.2, 1.2, 0.04, 0.04, 2.4, 0xffffff, { col: 'wood' });
      k.cone(-1.6, 2.35, 1.2, 1.6, 0.6, PAL.teal, { segs: 8 });
      P.bench(k, 2.6, -1.4, 0.3);
      const [lx, lz] = w(-0.3, 0.3);
      lootG(world, lx, lz);
    });
    // wildflowers all round
    for (let i = 0; i < 4; i++) {
      const fx = x + rng.range(-4, 4), fz = z + rng.range(-4, 4);
      k.push(0, ground(fx, fz), 0);
      P.flowerPatch(k, fx, fz, 6, 1);
      k.pop();
    }
  },

  scout(k, world, rng, x, z, yaw) {
    const H = 2.2;
    const y = frame(k, x, z, yaw, 4.5, () => {
      // a wooden deck on legs, reached by a ramp: a little height to peek over the fields
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(sx * 1.6, H / 2, sz * 1.6, 0.14, 0.16, H, PAL.brownDark, { col: 'wood', segs: 6 });
      k.box(0, H, 0, 3.8, 0.2, 3.8, PAL.woodLight, { col: 'wood' });
      // railings with a gap for the ramp
      k.box(0, H + 0.55, -1.85, 3.8, 0.1, 0.1, PAL.wood, { col: 'wood' });
      k.box(-1.85, H + 0.55, 0, 0.1, 0.1, 3.8, PAL.wood, { col: 'wood' });
      k.box(1.85, H + 0.55, 0, 0.1, 0.1, 3.8, PAL.wood, { col: 'wood' });
      k.box(-1.2, H + 0.55, 1.85, 1.4, 0.1, 0.1, PAL.wood, { col: 'wood' });
      for (const [px, pz] of [[-1.85, -1.85], [1.85, -1.85], [-1.85, 1.85], [1.85, 1.85]]) k.box(px, H + 0.3, pz, 0.12, 0.6, 0.12, PAL.brownDark);
      // ramp (visual planks + a sloped collider)
      const L = Math.hypot(4.2, H);
      const pitch = Math.atan2(H, 4.2);
      k.box(0.9, H / 2, 1.9 + 2.1, 1.2, 0.12, L, PAL.wood, { pitch: -pitch, col: 'wood' });
      // a flag
      k.cyl(-1.6, H + 1.4, -1.6, 0.04, 0.04, 2.8, PAL.brownDark);
      k.box(-1.15, H + 2.5, -1.6, 0.9, 0.5, 0.04, rng.pick([PAL.pink, PAL.mustard, PAL.turquoise]));
      P.crate(k, 1, H + 0.1, -1, 0.7, 0.2);
    });
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    loot(world, x - 0.5 * cs - 0.5 * sn, y + H + 0.15, z + 0.5 * sn - 0.5 * cs, 'weapon');
    lootG(world, x + 2.5 * cs, z - 2.5 * sn);
  },

  pumpkins(k, world, rng, x, z, yaw) {
    frame(k, x, z, yaw, 6.5, (w, h) => {
      // rows of pumpkins in dug-over soil (short soil strips so they hug the slope)
      for (let row = 0; row < 4; row++) {
        const rz = -4.5 + row * 3;
        for (let sgm = 0; sgm < 5; sgm++) {
          const sx = -4 + sgm * 2;
          k.box(sx, h(sx, rz) + 0.03, rz, 2.05, 0.08, 1.4, 0x8a6a4a, { batch: 'nocast' });
        }
        for (let i = 0; i < 6; i++) {
          const s = rng.range(0.28, 0.5);
          const px = -4.2 + i * 1.7 + rng.range(-0.3, 0.3), pz = rz + rng.range(-0.3, 0.3);
          const gy = h(px, pz);
          k.sphere(px, gy + s * 0.8, pz, s, rng.chance(0.15) ? 0xfff1d8 : 0xff8a2a, { sy: 0.8, segs: 10, col: s > 0.45 ? 'dirt' : null });
          k.cyl(px, gy + s * 1.5, pz, 0.03, 0.04, 0.2, 0x4f8a3a);
        }
      }
      // a scarecrow keeping watch
      k.push(0.8, h(0.8, 0), 0, 0);
      k.box(0, 1.1, 0, 0.12, 2.2, 0.12, PAL.brownDark, { col: 'wood' });
      k.box(0, 1.6, 0, 1.6, 0.1, 0.1, PAL.brownDark);
      k.box(0, 1.4, 0, 0.6, 0.7, 0.3, 0x5a78b0);
      k.sphere(0, 2.1, 0, 0.26, 0xe6c46a);
      k.cone(0, 2.45, 0, 0.36, 0.4, 0x6a5a4a, { segs: 8 });
      k.pop();
      P.cart(k, 5.5, 2, 1.2);
      P.hayBale(k, -5.5, 1.5, 0.3);
      const [lx, lz] = w(4.5, -1.5);
      lootG(world, lx, lz, 'weapon');
      const [mx, mz] = w(-4, 3);
      lootG(world, mx, mz);
    });
  },
};

/* ------------------------------------------------------------------ roadside dressing */

/** signposts halfway along each road pointing to where it goes, and lamp posts along the way */
function roadside(k: Kit, world: World, rng: Rng) {
  ROADS.forEach((road, ri) => {
    const end = road[road.length - 1];
    const dest = POIS.reduce((best, p) => (Math.hypot(p.x - end[0], p.z - end[1]) < Math.hypot(best.x - end[0], best.z - end[1]) ? p : best), POIS[0]);
    // total length and the halfway point
    const segs: { ax: number; az: number; bx: number; bz: number; L: number }[] = [];
    let total = 0;
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      segs.push({ ax, az, bx, bz, L });
      total += L;
    }
    let walked = 0;
    let lampNext = 10;
    let signDone = false;
    for (const s of segs) {
      const ux = (s.bx - s.ax) / s.L, uz = (s.bz - s.az) / s.L;
      const nx = -uz, nz = ux;
      for (let t = 0; t < s.L; t += 1) {
        const at = walked + t;
        const px = s.ax + ux * t, pz = s.az + uz * t;
        // (the first five roads already have the Wilds' junction signposts)
        if (!signDone && ri >= 5 && at >= total * 0.45) {
          signDone = true;
          const sx = px + nx * 3.4, sz = pz + nz * 3.4;
          if (!POIS.some((p) => Math.hypot(sx - p.x, sz - p.z) < p.r)) {
            const dist = Math.round(Math.hypot(dest.x - sx, dest.z - sz));
            signPost(k, world, sx, ground(sx, sz), sz, `${dest.name.toUpperCase()} →`, Math.atan2(ux, uz) - Math.PI / 2, `${dist}m this way`);
          }
        }
        if (at >= lampNext) {
          lampNext += 22 + rng.range(-3, 3);
          const side = Math.floor(at / 22) % 2 ? 1 : -1;
          const lx = px + nx * 3.2 * side, lz = pz + nz * 3.2 * side;
          if (!POIS.some((p) => Math.hypot(lx - p.x, lz - p.z) < p.r) && Math.hypot(lx, lz) < islandRadius(Math.atan2(lz, lx)) - 4) {
            k.push(0, ground(lx, lz), 0);
            P.lampPost(k, lx, lz, Math.atan2(nx * side, nz * side));
            k.pop();
          }
        }
      }
      walked += s.L;
    }
  });
}
