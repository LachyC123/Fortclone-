# Rift Rascals — Technical Architecture

## 1. Stack decision

**TypeScript + Three.js + Vite, custom collision, procedural art & audio.**

- Runs on every phone with a browser (and can be wrapped with Capacitor later for store builds).
- Three.js is mature and gives us full control over shaders, instancing and draw-call batching.
- **No physics engine.** A general rigid-body engine (Rapier/Ammo) is the wrong tool for arcade
  character movement and costs wasm size/CPU on phones. All static world geometry is **oriented boxes
  (OBB)**; characters are sphere stacks, the Blinkbug is a sphere, bullets are rays. Those tests are
  exact, cheap and deterministic (deterministic matters for future netcode).
- **Zero external assets.** Every mesh is generated in code, every sound is synthesised with WebAudio.
  That means no pipeline to break, tiny downloads, and instant iteration. (Art can later be replaced by
  GLTF assets without touching gameplay code.)

## 2. Rendering style

Chunky stylised 3D "vinyl toy" look:

- Static world geometry carries **baked vertex colours** (with a fake top-light / ambient-occlusion
  gradient and slight hue jitter) and is merged into spatial chunks → a few dozen draw calls for the
  whole island, no textures.
- `MeshStandardMaterial` + hemisphere sky light + one shadow-casting sun whose shadow frustum follows
  the player (small shadow map, crisp shadows). ACES tone mapping, warm fog, gradient sky dome.
- Foliage, flags, awnings and laundry share a material with a vertex **wind shader** (per-vertex weight).
- Emissive details (lamps, clock faces, oven glow) are merged into an unlit "glow" batch.
- Characters use a toy material with a soft rim light.

## 3. Player / controller architecture

```
Input (keyboard+mouse | Touch) ──► PlayerController ──► Intent ─┐
BotController (brain) ─────────────────────────────────► Intent ─┤
                                                                 ▼
                                                     Actor.update(intent)
                                    ┌───────────────┬───────────┴──────────┬──────────────┐
                               CharacterMotor   Weapon logic         Blinkbug          RascalRig
                               (movement)       (Combat.fireWeapon)  (throw/blink)     (procedural anim)
```

- **`Intent`** (`core/types.ts`) is the single per-frame "what I want" struct: move vector, aim
  yaw/pitch/ray, fire, ADS, jump, crouch, reload, throw aim/release, blink, slot. Players and bots
  produce the same struct → identical rules for everyone, and it is exactly the payload a future
  multiplayer client would send.
- **`CharacterMotor`** (`physics/Motor.ts`): kinematic arcade controller — acceleration/friction,
  sprint, coyote time, jump buffering, ground snapping, slope-projected walking, step-up, automatic
  ledge mantle, crouch, momentum slide (downhill acceleration, slide-jump bonus with cooldown so it
  can't be bunny-hopped).
- **`CameraRig`**: over-shoulder camera with wall pull-in, sprint/slide/ADS FOV, landing dip, recoil
  with partial recovery, small trauma shake, blink whoosh.

## 4. Bot architecture (`ai/BotBrain.ts`)

- **Perception** at 4–8 Hz (slower when far from the player): 160° vision cone + line of sight with an
  *awareness* meter (distance, movement and crouch change how fast you're noticed), hearing of
  gunshots/footsteps/blinks/impacts with position error, damage awareness, memory of last-known position.
- **Decision**: small state machine — `loot / wander / investigate / chase / engage / retreat`.
- **Personality profiles**: aggressive, cautious, loot goblin, rooftop, chaotic, sniper — reaction time,
  aim error, tracking skill, turn speed, preferred range, aggression, Blinkbug usage, retreat HP, burst timing.
- **Humanised aim**: reaction delay on acquire, initial error that settles while tracking, lateral-motion
  penalty, bursts with pauses, occasional head aim.
- **Movement**: A* on a baked nav grid with string-pulling; stuck detection → jump/repath; strafing.
- **Blinkbug tactics**: flank throws (solved by simulating the real bug physics) then blink; panic
  escape throws when hurt.

## 5. Blinkbug technical design (`entities/Blinkbug.ts`)

- States: `docked → flying → landed → returning (→ docked + cooldown)`.
- Physics: 120 Hz fixed-step sphere with gravity, restitution and friction against colliders flagged
  `BlocksBug`. Windows/doors are **real holes** in the colliders, so anything you can see through, the
  bug can fly through.
- `simulateBug()` is shared by gameplay, the **aiming arc preview** and bot throw-solving, so the arc
  never lies.
- Blink: find a free standing spot around the bug (overlap tests + wall-safe offsets, crouch-size
  fallback), swap, keep 40% momentum, bug appears dizzy at your old spot and flies home.
- Feel: squash/stretch spring, wing flaps, googly-eye expressions, sleepy cooldown with "zzz",
  urgency pulse as the window closes, trails, bounce chirps, ghost smear, particle bursts, FOV punch,
  screen flash, a screen-space locator with countdown ring.
- Tuning: throw 19 m/s (+9° lift), window 6 s, cooldown 8 s after a blink / 2.5 s if unused.

## 6. Map / environment strategy

- `world/Kit.ts` — building toolkit with a transform stack; every visual part can emit an exact collider.
- `world/BuildingKit.ts` — walls generated *around* openings (doors, windows with shutters/flower
  boxes, arches), floors with stairwell holes, stairs (visual steps + smooth ramp collider), walkable
  gable roofs with attic windows.
- `world/Props.ts` — furniture & set-dressing library (functions, deterministic seeded variation).
- `world/Terrain.ts` — floating island ground with painted paths, stream channel, craggy underside,
  invisible edge ring, sky rocks.
- `world/VillageBlock.ts` — the authored layout (hand-placed POIs; procedural only for scatter).
- `world/World.ts` — living-world systems: auto doors, windmill, swinging signs, shootable bell,
  kickable props, chimney smoke, waterfalls, birds, butterflies, pollen, clouds, zones (indoor reverb).

## 7. Mobile optimisation

- Merged vertex-coloured chunks (frustum-culled), shared materials, no textures for the world.
- Single draw call per particle pool (CPU-simulated point sprites, procedural shapes in the shader),
  instanced tracers/debris/decals, pooled rings, one permanent flash light (no shader recompiles).
- Loot models are baked into a single vertex-coloured mesh each.
- Quality presets (pixel ratio, shadows, shadow map size, particle budget, draw distance) + automatic
  downgrade when FPS stays low.
- Bot thinking throttled by distance; steering is cheap; nav grid baked once.
- Planned (M3/M7): character LOD (merged impostor rig for distant bots), animation update throttling
  for far actors, texture-free UI already.

## 8. Folder structure

```
src/
  core/      Game loop & orchestration, Input, shared types, math
  physics/   OBB collision world, character motor
  render/    Renderer, palette, geometry toolkit, materials, mesh merging
  world/     Kit, building kit, props, terrain, signs, nav grid, village layout, living world
  entities/  Actor, RascalRig (procedural character), Sculpt helpers, Blinkbug
  combat/    Weapon definitions & view models, hitscan firing
  loot/      Floor loot
  ai/        Bot brain
  fx/        Particles & FX service
  audio/     Procedural audio engine
  ui/        HUD, touch controls, menus, icons
  player/    PlayerController
  camera/    CameraRig
tools/       smoke test + screenshot tools (Playwright)
```

## 9. Characters

`RascalRig` builds each Rascal from **sculpted continuous forms**: a one-piece skinned body (torso and
hips blend through the waist), skinned arm and leg tubes that bend smoothly at elbows and knees
(sleeves, cuffs, baggy trousers, socks as vertex-colour bands), a soft egg-shaped head with cheeks,
oval glossy eyes, brows and a mouth that change with expression, mitten hands with thumbs, bulb-toed
boots, pillowy backpack with straps, a draped scarf, hats tipped back so faces always read.
Animation is fully procedural: gait phase from distance travelled, blended ground/air/slide poses,
two-bone IK for weapon hands, squash & stretch, springs for backpack/scarf/hat, hit flash and
reactions, throw, reload and equip animations.

## 10. Match flow (`core/Match.ts`, `ui/MatchUI.ts`)

`Match` implements `MatchHooks` (in `core/types.ts`), the only thing actors and bots know about the match:
`phase`, the `SkyBarge`, `canDrop`, `allowBugout`, `onOut`, `onRevive`, `dropTargetFor`, `safeCenter/safeRadius`
and `gloomOutside`. `GameCtx.match` is `null` in the playground, so every system degrades to M1/M2 behaviour.

- **lobby** — Launch Isle (`world/LaunchIsle.ts`) sits 175m off the island at y=40. Bots are pre-created and
  "join" with a poof over the first seconds. Damage is disabled; anyone falling off is put back.
- **barge** — `world/SkyBarge.ts` flies a straight line across the island; riders are pinned to deck spots
  (`riderWorld`). `Actor.flight` goes `barge → dive → glide → none` (`Motor.flyStep` handles airborne physics).
  Bots pick a drop target (loot/crate spot) and jump when the barge stops getting closer to it.
- **live** — `world/Gloom.ts` runs five wait/shrink phases (shader wall, ground ring, motes, lightning).
  Damage ticks once per second outside. Bots rotate early (cautious) or late (aggressive) via `zoneRun`, and
  `wanderGoal` samples inside the next circle.
- **bugout** — `Actor.eliminate` asks `allowBugout`; if granted the Blinkbug enters the `piloted` state with a
  timer and 30 HP (`Combat.raycastActors` can hit it). Reaching an unused Rift Nest (`Cottages.buildNest`)
  calls `reviveAt`. Bots can target and shoot bugouts.
- **end** — placement is `remaining + 1` at the moment you go out. XP/level and wins persist in `rr.profile`;
  a cocoon is added to the bug collection.

## 11. Blinkbug species (`progression/Bugs.ts`)

A species is data: `ability`, stat overrides (`throwSpeed`, `gravity`, `restitution`, `window`, `cooldown`,
`sticky`) and look flags. `Blinkbug` takes a species; `simulateBug` and `Blinkbug.throwVelocity` take the
bug's stats so the aiming arc, bots and gameplay agree. Arrival tricks live in `Actor.bugAbility`; ongoing ones
(Wisp shimmer via `RascalRig.setGhost`, Nimbus pings) in `Actor.updateBugTricks`. `ui/Collection.ts` +
`ui/BugPreview.ts` (a tiny separate WebGL turntable) implement MY BUGS and the cocoon hatch.

Crowd LOD: in the lobby and on the barge, non-local rascals swap to their single-mesh LOD beyond ~7m.

## 12. The island (`world/Heightmap.ts`, `world/Island.ts`, `world/pois/*`)

- **One height function** (`terrainHeight`) = rolling noise + hills + ridges, with roads cutting passes,
  level pads under each place (the manor's pad is raised 7.5m), the stream valley and the cove lagoon.
  It is sampled once into a 1m grid; `ground(x, z)` interpolates with the same triangle split as the render
  mesh, so the mesh, collision and prop placement agree exactly.
- **`HeightfieldCollider`** extends `OBB` (one-sided, only solid from above), so the motor, bullets, bot line
  of sight, Blinkbug and nav bake treat the ground like any other collider. Raycasts sphere-trace using a
  slope bound, then bisect.
- Places are builders in `world/pois/`; `pois/common.ts` has ground-aware helpers (`on`, `cottage`, `outcrop`,
  `woods`, `groundLine`, `ropeBridge`, `stilt`, loot/crate helpers). `World.settleLoot` nudges any loot spot
  that ended up inside furniture or rock to the nearest clear spot.
- Sightlines are broken on purpose: hills/ridges between places, copses (canopies block sight), outcrops,
  hedgerows and stone walls, crates and stalls.
- Scale knobs: nav grid half-size `ISLAND_R + 6` (cells outside the rim are skipped), Gloom phases
  (150 → 72 → 44 → 24 → 10 → 0.5), world chunks 40m (solid/foliage) / 56m / 72m, distance culling for
  butterflies, kickables, signs, crates and loot, fog thinned with altitude for the Sky Barge view.

## 13. Bot skill, pacing and personality (Milestone 5)

**Aim model** (`BotBrain.setSkill`, `perceivedPos`, `aim`): bots aim at where the target was `lag` seconds
ago plus a partial lead from its old velocity (`lead`), so direction changes beat them like they beat
people. A smooth random "hand wobble" (`noise1`) scales with skill, distance, target lateral speed and the
bot's own movement; reaction time, first-shot error, tracking rate, turn speed and headshot choice (per
burst) all come from skill. Archetype shifts style (snipers steadier, chaotic twitchier). Bots hold fire
beyond ~1.3× their gun's useful range. Measured with `tools/balance.mjs --duel` against a strafing player:
Rookie ~25–40% hits, Regular ~40–55%, Ace ~50–70%.

**Difficulty**: `Profile.rating` (0..1, saved) moves after each match (wins/top-5 up, early exits down);
each lobby gets ~30% Rookies (rating−0.3), ~52% Regulars (≈rating) and ~18% Aces (rating+0.3).
Settings → Bot difficulty overrides with Easy/Normal/Hard.

**Pacing director** (`Match.direct`): target curve `1 + 22·(1 − t/400)^1.4` rascals left, t = seconds since
landing. Ahead of schedule → smaller `engageRange` (bots ignore far targets and drop far fights); behind →
larger range and `hunt` (bots go find the nearest rascal). The first 90s are loot-first. Landings are spread
over all six places and the wilds; guns and ammo are guaranteed on the ground everywhere. Gloom phases sum
to ~6.7 min. `tools/balance.mjs --br` prints the curve.

**Bot robustness fixes found by the harness**: one-way "hop down" nav links (roofs, ledges, caps), no-path
straight-line fallback and escape hops, waypoint-below handling, unreachable-loot memory keyed to the real
cause, ammo-aware loot values (empty guns worthless unless ammo is next to them; dry bots chase ammo),
empty-gun bots loot instead of posturing, glide never gets stuck on steep rock.

**Personality**: `fx/Bubbles.ts` speech bubbles ("!", "?", "HA!", "EEK!", "...") via `Actor.say`; procedural
emotes in `RascalRig` (`dance`, `wave`, `laugh`, `flex`) via `Actor.startEmote` (cancelled by moving, firing
or damage); bots emote in the lobby and after a clear kill; kill-streak callouts (double/triple, blink kill,
long shot, clutch, first bonk). **Loot Balloons** (`Match.spawnBalloon`) drift into the safe zone at ~1:55
and ~4:05 after landing with a rich crate (epic/mythic), a light beam and a minimap star; bots treat the
landing spot as a `hotspot`.

## 14. Juice and third-party behaviour (Milestone 6)

**Time control** (`Game.hitStop`, `Game.slowMo`): applied to the real-time frame only (never to
`debugStep`, so tests stay deterministic). Kill by you → 90ms freeze-frame at 3% speed plus an FOV punch;
your headshot → 35ms; you knocked out → 1.1s slow-mo easing back; victory → 1.3s slow-mo.

**KO tumble** (`Actor.updateKO`/`koPoof`): on elimination the rig is launched along the hit direction,
spinning with squash-and-stretch and orbiting stars (`FX.koStars`), bounces once and pops into the
confetti burst after 0.62s. Falling off the island skips straight to the poof.

**World reactions**: `FX.casing` (instanced brass/red shells with bounce and a throttled tink for nearby
shooters), `FX.leaves` (bullets that pass through a canopy — found with a `BlocksSight` ray — shake out
leaves), water splash in `FX.landBurst`, `FX.bolt` lightning with distance-delayed `audio.thunder` in the
Gloom. `fx/Birds.ts`: ~14 flocks (one instanced mesh, 72 birds max) peck and hop on open ground; running
within 9m (not crouched), coming within 3.5m, or any gunshot/explosion in earshot sends them up with a
feather puff and wing-flap audio; they settle somewhere else 20s later. Only flocks within 90m animate.

**UI**: ammo counter kicks per shot and pops on reload (low/empty colours), kill and alive pills bump,
`HUD.koFlash` whites out and desaturates the canvas for a beat. Victory lap (`Match` `celebrateT`): fanfare,
confetti cannons every 0.55s around the winner, `CameraRig.cinematic` orbit and an auto dance, then the
summary. (Also fixed: `checkWin` re-armed every frame, which kept postponing the victory summary.)

**Third-party behaviour** (`BotBrain.onDamaged`, fight-or-flight): bots keep a decaying `threat` score per
attacker. Getting shot by someone other than the current target makes one decision, with hysteresis
(switch only if the newcomer's threat clearly exceeds the current target's, or it's a fresh ambush while
hurt) and a 2.6s lock; attention snaps to the shooter instead of sweeping. Every 2s a pinched bot (hit by
a third party recently and under 60hp) decides to flee (~70%); flight runs away from the threat-weighted
sum of attackers, or sideways out of a crossfire, and within 16m it's a fighting retreat (eyes and gun on
the threat). `tools/thirdparty.mjs` measures turns, target flips and reaction.

**Blinkbug escape window**: a knocked-out rascal's bug gets `grace` 2.4s (bullets fizzle with a ring and a
chirp, sparkles) and an upward burst; bots drop a graced bug as a target and ~60% of the time ignore it for
5–9s.
