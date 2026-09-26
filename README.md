# Rift Rascals

**Drop. Blink. Grab. Run.** A mobile-first, stylised battle royale about tiny chaotic adventurers on a floating island — and their Blinkbugs.

> Current state: **Milestone 1 — The Combat Playground** (one polished village block, player vs a bot, full Blinkbug mechanic).

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
| Reload / pick up | R / F | ⟳ / hand button (appears in context) |
| **Throw Blinkbug** | hold **Q** to aim the arc, release to throw | hold the cyan bug button, release |
| **Blink (swap places)** | **E** | purple blink button |
| Pause / settings | Esc | ❚❚ |

## Tests

`tools/smoke.mjs` boots the game in headless Chromium and drives it deterministically (walk, pick up,
fire, reload, jump, slide, slide-jump, throw + blink, doors, stairs, ledge climb, bot fight, kill + respawn).
`tools/shots.mjs` renders review screenshots into `tools/out/`.

```bash
npm run build && node tools/smoke.mjs
node tools/shots.mjs --only=portrait,lineup   # or --mobile
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.
