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

## Play with friends (LAN)

Short version to share: [LAN-QUICKSTART.md](LAN-QUICKSTART.md).

Everyone on the **same Wi-Fi**. One computer runs the room server; phones, tablets and computers just open a web page.

1. On one computer (with Node 18+), in this folder: `npm install` once, then **`npm run lan`**.
2. It prints an address like `http://192.168.1.20:8787`. Open that address on **every** device that wants to play,
   including the computer running it (you can also use `http://localhost:8787` there).
3. One player taps **WITH FRIENDS → MAKE A ROOM** and reads out the 4-letter code. Everyone else taps
   **WITH FRIENDS**, types the code and taps **JOIN**.
4. The host picks **SOLO / DUOS / TRIOS / SQUADS**. Same team number = teammates; different numbers = rivals
   (e.g. you and your brother on TEAM 1 and TEAM 2, each with bot teammates). Bots fill the island up to 24.
5. The host taps **START MATCH**. After the match the host can **PLAY AGAIN** for everyone.

In squads a knocked teammate can be picked back up (hold **F** / the revive button for 4s). Anyone who's fully
out drops a **spark** that a teammate can carry to a Rift Nest to rebuild them. In solos your Blinkbug bugout works
as usual. The host's device runs the match, so the fastest device should host. If the page can't find the
server, check everyone is on the same Wi-Fi and the computer's firewall allows port 8787 (`PORT=9000 npm run lan`
to use another port).

## Trophy Road

Every match moves your trophies: placing in the top half wins some, the bottom quarter loses a few, and
eliminations add a couple. There are seven arenas (Puddle Pals, Pebble Park, Crate Canyon, Blink Bay,
Gloom Gardens, Rift Royale, Legends' Lagoon). You can't lose trophies in the first one, and you never drop
below an arena you've reached. The **Trophy Road** (the banner on the home screen) has 22 milestones:
cocoons, titles to wear and new arenas. On AUTO difficulty your arena sets how sharp the bots are; in a
LAN room the bots play at the **average** of everyone's trophies.

## Saving

Progress (bugs, trophies, titles, settings, training done) is saved in the browser. On the claude.ai page
it's also mirrored to your own private save, so it comes back even if the browser forgets.

## Training (first play)

The first time you press **PLAY** you get a short training lap on Launch Isle before your first match. It's a
tick-list: walk, look, jump, slide, grab a gun, knock over three targets, reload. Then you find a glowing
cocoon on an old stump, it **hatches into your first Blinkbug** and you give it a name. After that: throw it,
blink to it, blink up onto a rock that's too tall to climb, throw a Fizz Bomb and drink a Fizzle Juice.
**SKIP** is always there (on desktop press **Esc** and pick *Skip training*). Replay it any time from
**TRAINING** on the home screen.

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
| Tanglet | Rare | spins a sticky web where it lands: enemies in it move at half speed | throws shorter, shorter window |
| Snatchet | Epic | swap with the enemy beside your bug | much longer nap |
| Pewpew | Epic | lands and becomes a tiny turret: 3 damage twice a second at the nearest enemy it can see | longer nap, the pews give it away |
| Glimmerwing | Epic | flies far and flat | longer nap, barely bounces |
| Nimbus | Mythic | marks rascals near the landed bug | glows, longer nap |

Duplicates level a bug up (cosmetic). Collection is saved in the browser (`localStorage`).

## Bot teammates

Bots on your team (and bots on each other's teams) look after their squad:
- **Revives**: straight away when it's quiet. Under fire they fight first, or smoke you with a Fizz Bomb,
  and pick you up once you're covered or the shooter is reloading (sooner if you're bleeding out).
- **Sharing**: if you've got nothing to shoot with they throw you their spare gun and some bullets. They
  also throw ammo for the gun in your hands when you're running dry, and a heal when you're hurt with none.
  If you're a way off they walk over ("COMING WITH SUPPLIES!"). Anything thrown to you is left for you.
- **Call-outs**: enemies they see are marked on your minimap, with a toast like "Socks: enemy NORTH, 17m".
- **Manners**: they leave guns, perks and heals lying next to you for you to take, and they say thanks
  when you pick them up.

## Weird weapons, gadgets and perks

- **Zapcoil** (auto): every hit arcs on to the nearest other enemy within 7m for 60% damage.
- **Boomkin** (3 pumpkins): lobbed pumpkins burst on impact (splash, 58 at the centre). The crosshair
  accounts for the arc, so aim at what you want to hit.
- **Gloop Gun** (semi): sticky blobs slow whoever they hit to 55% speed for 1.6s.
- **Bug Jammer** (gadget): a red bubble (8m, 22s). Enemy Blinkbugs that fly into it are zapped straight
  home with a long nap, so no blinking in. Enemies can shoot it (45 HP) or blow it up.
- **Snap Trap** (gadget): sits on the ground and arms after a moment. The first enemy to step on it takes
  25, is slowed hard for 2.5s and gets marked.
- **Perks** are badges on the floor and in crates. You can carry two (a third swaps out the oldest), and they
  drop when you're eliminated:
  **Springy Socks** (jump higher), **Speedy Fingers** (reload faster), **Bug Snacks** (bug naps less),
  **Thick Wool** (12% less damage), **Quiet Paws** (quiet footsteps), **Vampire Teeth** (heal 20 when you knock or eliminate someone).

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
node tools/tierprobe.mjs [low medium high]    # per-quality boot time, triangles and draw calls
node tools/squadtest.mjs                      # duos: knock, revive, sparks, nest rebuild, team wipe
node tools/lantest.mjs                        # LAN: two browsers, room, join, move, fire, knock/revive, results, replay
node tools/contenttest.mjs [--shots]          # new weapons, Bug Jammer, Snap Trap, Pewpew, Tanglet, perks
node tools/tutorialtest.mjs [--mobile]        # first-play training: every step, hatch + naming, SKIP
node tools/squadai.mjs                        # bot teammates: throw you a gun/ammo/heal, call out enemies, revive under fire
node tools/botdiag.mjs                        # unarmed bots after landing: do they go somewhere (no dithering)?
node tools/botidle.mjs [--team=2]             # armed enemies standing near each other not fighting; low-hp bots & heals
node tools/juiceshots.mjs                     # screenshots: combo damage numbers, streak announcer, explosion
node tools/trophytest.mjs [--mobile]          # trophy banner, road screen & claiming, trophies from a won match
node tools/savetest.mjs                       # saves survive a wiped browser via a (fake) claude.ai cloud store
node tools/landmarkshots.mjs [--only=pond]    # drone shots of the in-between landmarks
node tools/shots.mjs --only=portrait,lineup   # or --mobile
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.
