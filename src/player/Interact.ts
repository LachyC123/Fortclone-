import type { Actor } from '../entities/Actor';
import type { GameCtx } from '../core/types';
import type { Pickup, Crate } from '../loot/Loot';

export type SquadContext = { kind: 'revive' | 'spark' | 'rebuild'; name: string; k: number } | null;

/**
 * What "interact" means for this rascal right now — reviving a teammate, grabbing a spark,
 * rebuilding at a nest, picking up loot or opening a crate — and (when `act`) doing it.
 * Shared by the local player, remote LAN players on the host, and LAN clients (prompts only).
 */
export function interactContext(a: Actor, ctx: GameCtx, pressed: boolean, held: boolean, act: boolean) {
  let squad: SquadContext = null;
  const it = a.intent;
  it.revive = false;
  it.hold = held;
  const m = ctx.match;
  if (m && m.teamSize > 1 && !a.downed) {
    const mate = ctx.actors.find((o) => o !== a && o.team === a.team && o.downed && o.alive && o.motor.pos.distanceTo(a.motor.pos) < 2.2);
    if (mate) {
      squad = { kind: 'revive', name: mate.name, k: mate.reviveK };
      it.revive = held;
      if (act) a.reviving = held ? mate : null;
    } else {
      const sp = m.sparkNear(a);
      if (sp) {
        squad = { kind: 'spark', name: sp.owner.name, k: 0 };
        if (pressed && act) m.trySparkPickup(a);
      } else if (m.nestFor(a)) {
        const mine = m.sparks.find((x) => x.carrier === a);
        if (mine) squad = { kind: 'rebuild', name: mine.owner.name, k: mine.rebuildK };
      }
    }
  }
  const pickup: Pickup | null = squad || a.downed ? null : ctx.loot.bestFor(a);
  const crate: Crate | null = pickup || squad || a.downed ? null : ctx.loot.crateFor(a);
  if (act && pressed && !squad) {
    if (pickup) ctx.loot.collect(a, pickup, ctx);
    else if (crate) ctx.loot.openCrate(crate, a);
  }
  return { squad, pickup, crate };
}
