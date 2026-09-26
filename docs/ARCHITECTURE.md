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
