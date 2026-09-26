# Rift Rascals

**Drop. Blink. Grab. Run.** A mobile-first, stylised battle royale about tiny chaotic adventurers on a floating island — and their Blinkbugs.

> Current state: **Milestone 3 — Vertical-slice battle royale.** PLAY drops you into a full match:
> wait on **Launch Isle** with 23 bots → ride the **Sky Barge** → jump, skydive, glide → loot and fight while
> **THE GLOOM** closes in → last rascal standing. Knocked out? Your Blinkbug carries your spark to a
> **Rift Nest** (once per match). Plus the **Blinkbug collection**: hatch cocoons, name your bugs, equip one.
> PRACTICE keeps the respawning combat playground from Milestones 1–2.
>
> **Milestone 4 — the island.** It's now ~200m across with rolling hills, ridges and six places:
> **Buttonbury** (the village), **Wobblewood** (giant mushrooms, treehouses, rope bridges), **Tumble Market**
> (stall aisles, crate towers, warehouses), **Crooked Manor** (a leaning mansion on the big hill, hedge maze),
> **Rattleworks** (workshop halls, turning gears, silo, containers) and **Crash Cove** (beach, crashed sky-ship,
> lighthouse, lagoon waterfall) — plus Lookout Hill, farms, barns, boulder outcrops and copses in between.

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
| Emote (dance / wave / laugh / flex) | B (cycles) | :) button |
| Pause / settings | Esc | ❚❚ |

> **Milestone 5 — personality & pacing.** Bots aim like people (they track where you *were*, so strafing
> and direction changes work), come in Rookie / Regular / Ace skill mixes that adapt to how you're doing
> (or pick Easy/Normal/Hard in Settings), and a pacing director keeps matches to ~6–7 minutes. Rascals
> react with speech bubbles and emotes, you get kill-streak callouts, and mid-match **Loot Balloons**
> float down with epic loot.

> **Milestone 6 — juice.** Hit-stop and an FOV punch when you bonk someone, knocked-out rascals get launched
> spinning with cartoon stars before popping into confetti, brass casings tinkle out of every gun, shot
> canopies shed leaves, water splashes, flocks of birds peck about the island and burst into the air when
> someone runs past or fires (a handy tell!), Gloom lightning bolts with rolling thunder, ammo/kill/alive
> counters pop, a slow-mo KO sting when you go down, and a proper victory lap: slow-mo, fanfare, confetti
> cannons, an orbiting camera and a dance. Bots caught in a third-party now make one decision (turn and
> fight, or break out of the crossfire sideways while shooting back) instead of spinning, and a freshly
> knocked-out Blinkbug gets a 2.4s shimmering head start.

> **The bigger island.** Five peninsulas push out from the coast, each with a new place: **Puddleby Farm**
> (climbable windmill, barn, silo, duck pond), **Tickerton** (two terraces of three-storey townhouses and a
> clock tower — the densest spot on the map), **Snoozy Pines** (log cabins, a lodge and a fire lookout in a
> dark pine wood), **Saltwhistle Wharf** (fisher cottages, boathouse, harbour lookout, a crane over the drop)
> and **Rumpus Fair** (a big top you fight inside, Ferris wheel, carousel, haunted house). Twenty lone
> homesteads, cabins, huts and ruined towers fill the land between: 75 named enterable buildings (was 20),
> 225 loot spots (was 99), 40 crates (was 29).
> Every match the barge route decides which peninsulas are in reach, and two **Hot Drops** (orange beams,
> flame markers on the map) get a rich crate and rare guns.

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
node tools/balance.mjs --br=4                 # bots-only matches: remaining-over-time curve & match length
node tools/balance.mjs --duel                 # each bot skill vs a strafing player: accuracy, DPS, TTK
node tools/m5shots.mjs                        # emotes, bubbles, Loot Balloon screenshots
node tools/m6shots.mjs                        # KO tumble, birds, casings, victory lap screenshots
node tools/thirdparty.mjs                     # third-partying a bot fight (no spinning) + Blinkbug escape
node tools/placeshots.mjs [--only=tickerton]   # the peninsula places from the air and the ground
node tools/densitymap.mjs                     # ASCII map of buildings / cover / open ground + counts
node tools/shots.mjs --only=portrait,lineup   # or --mobile
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.
