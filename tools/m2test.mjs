// Milestone 2 feature test: every weapon fires, fusion, crates, healing, all utilities, bots on stairs.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const server = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4177/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game; g.play();
  const s = g.input.s; s.touchActive = true;
  const step = (sec) => g.debugStep(Math.round(sec * 60));
  const V = g.player.motor.pos.constructor;
  const p = g.player; const log = [];
  const bot = g.actors[1]; const brain = bot.controller; bot.controller = null; bot.motor.teleport(new V(40, 0.05, 0));
  const dummy = () => { bot.hp = 100; bot.alive = true; bot.rig.root.visible = true; bot.motor.teleport(new V(-2, 0.05, -2)); };
  p.motor.teleport(new V(-2, 0.05, 10)); g.camRig.yaw = 0; step(0.3);
  // --- every weapon
  for (const id of ['poppistol', 'rattle', 'broomstick', 'tincan', 'needler', 'thumper', 'sparkbow', 'pepperbox']) {
    p.weapons = [null, null, null]; p.giveWeapon(id, 2, 0, true); p.ammo = { light: 200, medium: 200, heavy: 60, shells: 60, bolts: 40 };
    dummy(); p.hp = 100; step(0.1);
    const dmg0 = p.damageDealt; let frames = 0;
    for (let i = 0; i < 360 && bot.alive; i++) {
      const cam = g.camRig.cam.position; const tgt = bot.motor.pos.clone(); tgt.y += 0.95;
      const d = tgt.sub(cam).normalize(); g.camRig.yaw = Math.atan2(-d.x, -d.z); g.camRig.pitch = Math.asin(d.y);
      s.fire = (i % 8) < 5; step(1 / 60); frames++;
    }
    s.fire = false; step(0.3);
    log.push(`${id.padEnd(10)} dmg=${p.damageDealt - dmg0} killed=${!bot.alive} t=${(frames / 60).toFixed(2)}s mag=${p.weapon?.mag}`);
    bot.alive = true;
  }
  // --- fusion
  p.weapons = [null, null, null]; p.giveWeapon('rattle', 0, 0, true); step(0.1);
  const pk = g.loot.spawn('weapon', 'rattle', 0, 1, new V(0, 0.05, 9)); step(0.5);
  g.loot.collect(p, pk, g); step(0.3);
  log.push(`fusion: rattle rarity now=${p.weapons[0]?.rarity} (expect 1) fusions=${p.fusions} slots=${p.weapons.map(w=>w?w.def.id+w.rarity:'-')}`);
  // --- crate
  const crate = g.loot.crates[3]; for (const pk of [...g.loot.pickups]) if (pk.pos.distanceTo(crate.pos) < 4) g.loot.remove(pk);
  const n0 = g.loot.pickups.length;
  p.motor.teleport(crate.pos.clone().add(new V(0, 0.05, 1.6))); step(0.2);
  log.push(`crate prompt: ${!!g.pc.contextCrate}`);
  s.interactPressed = true; step(0.1); step(1.5);
  log.push(`crate opened=${crate.opened} spawned=${g.loot.pickups.length - n0}`);
  // --- healing
  p.hp = 40; p.healItem = null; p.addItem('heal', 'jamjar', 2); s.healPressed = true; step(0.05);
  log.push(`healing started=${p.healT >= 0}`); step(3.2);
  log.push(`after jam jar hp=${p.hp} count=${p.healItem?.count}`);
  p.hp = 50; p.healItem = null; p.addItem('heal', 'biscuit', 1); s.healPressed = true; step(2.0);
  log.push(`biscuit hp=${p.hp} boost=${p.boostT.toFixed(1)} speedBoost=${p.motor.speedBoost}`);
  // --- utilities
  p.motor.teleport(new V(-2, 0.05, 10)); g.camRig.yaw = 0; g.camRig.pitch = -0.05; step(0.3);
  for (const u of ['fizzbomb', 'bouncejam', 'chicken', 'gust', 'stickypop']) {
    p.util = null; p.addItem('util', u, 1);
    dummy(); bot.motor.teleport(new V(-2, 0.05, 4)); const hp0 = bot.hp; const bp0 = bot.motor.pos.clone();
    s.utilHeld = true; step(0.2); s.utilHeld = false; s.utilReleased = true; step(2.4);
    const th = g.throwables;
    log.push(`${u.padEnd(10)} thrown=${!p.util} smokes=${th.smokes.length} pads=${th.pads.length} chickens=${th.chickens.length} botHp ${hp0}->${bot.hp} botMoved=${bp0.distanceTo(bot.motor.pos).toFixed(1)}`);
  }
  // bounce pad launches
  const pad = g.throwables.pads[0];
  if (pad) { p.motor.teleport(pad.pos.clone().add(new V(0, 0.3, 0))); step(0.05); step(0.1); log.push(`bounce pad: vy=${p.motor.vel.y.toFixed(1)} y=${p.motor.pos.y.toFixed(2)}`); step(2); }
  // --- bot pathing upstairs
  const path = g.nav.findPath(new V(-11, 0, -11), new V(-14.5, 3.25, -15));
  log.push(`nav path ground->bedroom: ${path ? path.length + ' pts, end y=' + path[path.length - 1].y.toFixed(2) : 'NONE'}`);
  bot.controller = brain; bot.hp = 100; bot.alive = true; bot.weapons = [null, null, null]; bot.giveWeapon('tincan', 0, 0, true); bot.ammo.medium = 100; bot.motor.teleport(new V(-10.5, 0.05, -11)); brain.state = 'wander';
  brain.setGoal ? 0 : 0;
  // steer the bot to the bedroom via its private API
  brain['setGoal'](bot, g, new V(-14.5, 3.25, -15), true); brain.state = 'investigate'; brain['heardPos'].set(-14.5, 3.25, -15); brain['heardT'] = g.time;
  p.motor.teleport(new V(30, 0.05, 30));
  for (let i = 0; i < 40; i++) { step(0.25); if (bot.motor.pos.y > 3) break; }
  log.push(`bot upstairs: y=${bot.motor.pos.y.toFixed(2)} pos=${bot.motor.pos.toArray().map(v=>v.toFixed(1))}`);
  const info = g.r.renderer.info; log.push(`calls=${info.render.calls}`);
  return log;
});
console.log(out.join('\n'));
console.log('ERRORS:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
