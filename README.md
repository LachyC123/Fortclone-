# Rift Rascals

**Drop. Blink. Grab. Run.** A mobile-first, stylised battle royale about tiny chaotic adventurers on a floating island — and their Blinkbugs.

> Current state: **Milestone 2 — Combat Polish** (8 weapons, fusion, crates, healing, utilities, smarter bots) in the Milestone 1 village playground.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (also reachable from a phone on the same Wi-Fi)
npm run build      # production build into dist/
npm run typecheck
```

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move / look | WASD + mouse (click to capture) | left floating stick / drag right side |
| Sprint | Shift | push stick to the rim |
| Fire / aim | LMB / RMB | FIRE (drag to aim while held) / ADS toggle |
| Jump / climb | Space (auto-climbs ledges) | ↑ |
| Crouch / slide | C (while sprinting = slide) | ↓ |
| Reload / pick up / open crate | R / F | ⟳ / hand button (appears in context) |
| Throw utility | hold **G**, release | hold the utility button, release |
| Heal | H | heal button |
| Drop held gun / switch | X / 1-3 | tap a weapon slot |
| **Throw Blinkbug** | hold **Q** to aim the arc, release to throw | hold the cyan bug button, release |
| **Blink (swap places)** | **E** | purple blink button |
| Pause / settings | Esc | ❚❚ |

## Weapon fusion

Pick up the **same gun at the same rarity** as one you carry and the two fuse into one tier higher
(common → uncommon → rare → epic → mythic). The loot card shows a FUSE badge when that will happen.

## Tests

`tools/smoke.mjs` boots the game in headless Chromium and drives it deterministically (walk, pick up,
fire, reload, jump, slide, slide-jump, throw + blink, doors, stairs, ledge climb, bot fight, kill + respawn).
`tools/shots.mjs` renders review screenshots into `tools/out/`.

```bash
npm run build && node tools/smoke.mjs
node tools/m2test.mjs                         # every weapon, fusion, crates, heals, utilities, bot stairs
node tools/tapplay.mjs                        # taps PLAY / pause / resume on an emulated iPhone
node tools/shots.mjs --only=portrait,lineup   # or --mobile
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.
