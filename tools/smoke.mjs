// Headless smoke test: boots the game, checks for console errors, drives the player through
// movement / shooting / Blinkbug throw + blink via the debug handle, and saves screenshots.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const PORT = 4173;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const mobile = process.argv.includes('--mobile');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-title${mobile ? '-m' : ''}.png` });
const steps = process.argv.includes('--steps');
await page.evaluate(() => { const g = window.__game; g.play(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-spawn${mobile ? '-m' : ''}.png` });
const res = await page.evaluate(() => {
  const g = window.__game;
  const s = g.input.s;
  s.touchActive = true; // scripted stick input (keyboard poll would overwrite it)
  const step = (sec) => g.debugStep(Math.round(sec * 60));
  const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
  const log = [];
  const p = g.player;
  for (const extra of g.actors.slice(2)) { extra.parked = true; extra.controller = null; extra.alive = false; extra.rig.root.visible = false; extra.bug.root.visible = false; extra.motor.teleport(new extra.motor.pos.constructor(0, -500, 0)); }
  const bot = g.actors[1];
  const brain = bot.controller; bot.controller = null; bot.motor.teleport(new p.motor.pos.constructor(40, 0.05, 0));
  // deterministic starter gun for the test
  for (const pk of [...g.loot.pickups]) if (pk.pos.distanceTo(new p.motor.pos.constructor(0, 0, 22)) < 4) g.loot.remove(pk);
  g.loot.spawn('weapon', 'tincan', 0, 1, new p.motor.pos.constructor(0, 0.05, 22.5));
  g.loot.spawn('ammo', 'medium', 0, 30, new p.motor.pos.constructor(2.2, 0.05, 21.5));
  step(0.5);
  log.push(`spawn pos ${f(p.motor.pos)} grounded=${p.motor.grounded}`);
  // walk forward to the rifle (at z=22.5)
  s.moveY = 1; step(0.75); s.moveY = 0; step(0.3);
  log.push(`after walk pos ${f(p.motor.pos)} ctxPickup=${!!g.pc.contextPickup}`);
  s.interactPressed = true; step(0.4);
  log.push(`armed=${p.armed} weapon=${p.weapon?.def.name} mag=${p.weapon?.mag} reserve=${p.ammo.medium}`);
  s.fire = true; step(0.6); s.fire = false; step(0.1);
  log.push(`after 0.6s firing mag=${p.weapon?.mag} (expect ~22)`);
  s.reloadPressed = true; step(0.1); log.push(`reloading=${p.weapon?.reloading}`); step(2.2); log.push(`after reload mag=${p.weapon?.mag} reserve=${p.ammo.medium}`);
  // jump
  s.jumpPressed = true; step(0.15); log.push(`jump y=${p.motor.pos.y.toFixed(2)} vy=${p.motor.vel.y.toFixed(2)}`); step(0.9);
  log.push(`landed grounded=${p.motor.grounded} y=${p.motor.pos.y.toFixed(2)}`);
  // sprint + slide
  s.moveY = 1; s.sprint = true; step(0.7); log.push(`sprint speed=${p.motor.horizontalSpeed().toFixed(2)}`); s.crouchPressed = true; step(0.05);
  log.push(`slide=${p.motor.sliding} speed=${p.motor.horizontalSpeed().toFixed(2)}`); step(0.4);
  s.jumpPressed = true; step(0.05); log.push(`slide-jump speed=${p.motor.horizontalSpeed().toFixed(2)} sliding=${p.motor.sliding}`); step(0.8);
  s.moveY = 0; s.sprint = false; step(0.6);
  log.push(`pos after slide ${f(p.motor.pos)}`);
  // throw blinkbug straight ahead & blink
  g.camRig.pitch = 0.15;
  s.throwHeld = true; step(0.3);
  log.push(`aiming=${p.throwAiming} arcDots=${g.pc.arcDots.count}`);
  s.throwHeld = false; s.throwReleased = true;
  for (let i = 0; i < 6; i++) { step(0.25); log.push(`  t=${((i+1)*0.25).toFixed(2)} bug=${p.bug.state} pos=${f(p.bug.pos)}`); }
  log.push(`bug state=${p.bug.state} pos=${f(p.bug.pos)} canBlink=${p.bug.canBlink} window=${p.bug.window.toFixed(2)}`);
  const before = p.motor.pos.clone();
  s.blinkPressed = true; step(0.05);
  log.push(`BLINK moved=${before.distanceTo(p.motor.pos).toFixed(2)}m to ${f(p.motor.pos)} bug=${p.bug.state} blinks=${p.blinks}`);
  step(1.0);
  log.push(`bug after=${p.bug.state} cooldown=${p.bug.cooldown.toFixed(1)}`);
  // house: teleport near front door and walk in, then up the stairs
  p.motor.teleport(new g.player.motor.pos.constructor(-10.5, 0.05, -11)); g.camRig.yaw = 0; g.camRig.pitch = 0; step(0.3);
  s.moveY = 1; step(1.4); s.moveY = 0; step(0.3);
  log.push(`inside house? pos=${f(p.motor.pos)} zone=${g.world.zoneAt(p.motor.pos)?.name} doorsOpen=${g.world.doors.filter(d=>d.open).length}`);
  // stairs: start at the bottom (-16.4,-20.25) facing +x (yaw -PI/2)
  p.motor.teleport(new p.motor.pos.constructor(-16.2, 0.05, -20.25)); g.camRig.yaw = -Math.PI / 2; step(0.3);
  s.moveY = 1; step(2.2); s.moveY = 0; step(0.3);
  log.push(`after stairs pos=${f(p.motor.pos)} (expect y~3.2)`);
  // mantle onto a crate: crate at (9.5,0,-4) size 0.9 in the square; approach from +z
  p.motor.teleport(new p.motor.pos.constructor(9.5, 0.05, -1.5)); g.camRig.yaw = 0; step(0.3);
  s.moveY = 1; for (let i = 0; i < 8; i++) { step(0.1); log.push(`  climb t=${i} pos=${f(p.motor.pos)} g=${p.motor.grounded} mantle=${p.motor.mantleT.toFixed(2)}`); if (i === 3) s.jumpPressed = true; } s.moveY = 0; step(0.3);
  log.push(`after crate climb pos=${f(p.motor.pos)} (crate top 0.9, stack ~1.4)`);
  bot.controller = brain; bot.motor.teleport(new p.motor.pos.constructor(-8, 0.05, 12));
  log.push(`bot ${bot.name} alive=${bot.alive} state=${bot.controller.state} pos=${f(bot.motor.pos)} hp=${bot.hp}`);
  log.push(`nav walkable cells=${g.nav.walk.reduce((a, b) => a + b, 0)} colliders=${g.cw.colliders.length}`);
  // let the bot hunt the player for 20 simulated seconds
  p.motor.teleport(new p.motor.pos.constructor(0, 0.05, 5)); step(0.2);
  const hp0 = p.hp;
  let seen = 0, fired = 0; const b0 = bot.motor.pos.clone();
  for (let i = 0; i < 20 * 4; i++) { step(0.25); if (bot.controller.state === 'engage') seen++; if (bot.weapon && bot.weapon.cooldown > -0.05) fired++; if (!p.alive) break; }
  log.push(`bot hunt: engageTicks=${seen} firingTicks=${fired} botMoved=${b0.distanceTo(bot.motor.pos).toFixed(1)} playerHp ${hp0}->${p.hp} alive=${p.alive} bot=${bot.controller.state} blinks=${bot.blinks}`);
  // player vs bot: aim at the bot's chest and hold fire
  if (!p.alive) g.respawnPlayer();
  step(1.5);
  p.hp = 100; p.giveWeapon('tincan', 1, 0, true); p.ammo.medium = 200;
  bot.controller = null; bot.hp = 100;
  p.motor.teleport(new p.motor.pos.constructor(0, 0.05, 12)); bot.motor.teleport(new p.motor.pos.constructor(0.4, 0.05, 2)); step(0.2);
  let shots = 0; const drops0 = g.loot.pickups.length;
  for (let i = 0; i < 240 && bot.alive; i++) {
    const cam = g.camRig.cam.position; const tgt = bot.motor.pos.clone(); tgt.y += 0.95;
    const d = tgt.sub(cam).normalize(); g.camRig.yaw = Math.atan2(-d.x, -d.z); g.camRig.pitch = Math.asin(d.y);
    s.fire = true; step(1 / 60); shots++;
  }
  s.fire = false; step(0.5);
  log.push(`player vs bot: botAlive=${bot.alive} frames=${shots} (${(shots / 60).toFixed(2)}s TTK) kills=${p.kills} dmg=${p.damageDealt} lootDrops=${g.loot.pickups.length - drops0}`);
  step(6);
  log.push(`bot respawned alive=${bot.alive} pos=${f(bot.motor.pos)}`);
  bot.controller = brain;
  const info = g.r.renderer.info;
  log.push(`draw calls=${info.render.calls} tris=${info.render.triangles}`);
  return log;
});
console.log(res.join('\n'));
await page.screenshot({ path: `${out}/03-after${mobile ? '-m' : ''}.png` });
// let bot hunt a while
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/04-later${mobile ? '-m' : ''}.png` });
const late = await page.evaluate(() => { const g = window.__game; return g.actors.map((a) => `${a.name} alive=${a.alive} hp=${a.hp.toFixed(0)} state=${a.controller?.state ?? 'player'} pos=${a.motor.pos.toArray().map((v) => v.toFixed(1))}`).join('\n') + `\nfps=${g.fps.toFixed(1)}`; });
console.log(late);
console.log('ERRORS:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
