# Rift Rascals

**Drop. Blink. Grab. Run.** A mobile-first, stylised battle royale about tiny chaotic adventurers on a floating island — and their Blinkbugs.

> Current state: **Milestone 3 — Vertical-slice battle royale.** PLAY drops you into a full match:
> wait on **Launch Isle** with 23 bots → ride the **Sky Barge** → jump, skydive, glide → loot and fight while
> **THE GLOOM** closes in → last rascal standing. Knocked out? Your Blinkbug carries your spark to a
> **Rift Nest** (once per match). Plus the **Blinkbug collection**: hatch cocoons, name your bugs, equip one.
> PRACTICE keeps the respawning combat playground from Milestones 1–2.

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
| Jump / climb / **drop from the Sky Barge** | Space (auto-climbs ledges) | ↑ |
| Crouch / slide | C (while sprinting = slide) | ↓ |
| Reload / pick up / open crate | R / F | ⟳ / hand button (appears in context) |
| Throw utility | hold **G**, release | hold the utility button, release |
| Heal | H | heal button |
| Drop held gun / switch | X / 1-3 | tap a weapon slot |
| **Throw Blinkbug** | hold **Q** to aim the arc, release to throw | hold the cyan bug button, release |
| **Blink (swap places)** | **E** | purple blink button |
| Pause / settings | Esc | ❚❚ |

## A match

1. **Launch Isle** (~14s): rascals pop in; shoot and blink all you like, nobody can get hurt.
2. **Sky Barge**: a balloon-lifted ship crosses the island. JUMP once the prompt turns yellow; everyone is
   tipped off at the end of the route. Skydive (steer with move), the glider opens by itself near the ground.
3. **THE GLOOM**: five phases shrink a purple storm (dashed white circle on the minimap = where it's going).
   Standing in it hurts, more each phase.
4. **Bugout**: when you're knocked out (not in the last phases) you pilot your Blinkbug for 22s. Reach a
   glowing **Rift Nest** to be rebuilt with 40 HP and a pistol. Enemies can swat the bug. One use per match.
5. **Summary**: placement, stats, XP, and a **cocoon** (better placement = rarer cocoon). PLAY AGAIN is one tap.

## Blinkbugs (MY BUGS)

Every Blinkbug species has its own look, a **trick** and a **catch**, so rarer bugs are different rather than
stronger. Hatch cocoons from matches, rename your bugs, equip one before you PLAY. Bots bring random ones.

| Bug | Rarity | Trick | Catch |
| --- | --- | --- | --- |
| Zippit | Common | the classic blink | — |
| Stickle | Common | sticks to the first surface it hits | shorter blink window |
| Hopper | Uncommon | springy BOING upward on arrival | throws shorter |
| Mender | Uncommon | each blink heals 12 | longer nap |
| Boomble | Rare | arrival shockwave shoves & stings | longer nap |
| Wisp | Rare | 2s shimmer: bots lose you | shorter window |
| Snatchet | Epic | swap with the enemy beside your bug | much longer nap |
| Glimmerwing | Epic | flies far and flat | longer nap, barely bounces |
| Nimbus | Mythic | marks rascals near the landed bug | glows, longer nap |

Duplicates level a bug up (cosmetic). Collection is saved in the browser (`localStorage`).

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
node tools/matchtest.mjs                      # a whole match: lobby, barge, drop, Gloom, summary
node tools/bugtest.mjs [--mobile]             # MY BUGS screen, hatching, every species' trick
node tools/matchperf.mjs                      # draw calls / triangles per match phase
node tools/shots.mjs --only=portrait,lineup   # or --mobile
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.
