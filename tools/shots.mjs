// Visual review: renders a set of authored camera shots to tools/out/shot-*.png
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const mobile = process.argv.includes('--mobile');
const page = await browser.newPage(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4175/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
if (mobile) await page.touchscreen.tap(10, 10);
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const shots = {
  // name: [px,py,pz, yaw, pitch, setup]
  portrait: [0, 0.05, 20, 0, 0, 'portrait'],
  arsenal: [0, 0.05, 20, 0, 0, 'arsenal'],
  card: [-2, 0.05, 14, 0, -0.35, 'card'],
  crate: [-2, 0.05, -3.5, Math.PI, -0.2, 'crate'],
  boom: [-2, 0.05, 12, 0, -0.05, 'boom'],
  heal: [0, 0.05, 20, 0, 0, 'heal'],
  held: [0, 0.05, 20, 0, 0, 'held'],
  lineup: [0, 0.05, 20, 0, 0, 'lineup'],
  house: [-10.5, 0.05, -18, 0.6, -0.1, ''],
  upstairs: [-13, 3.25, -15.5, 0.9, -0.12, ''],
  arc: [0, 0.05, 12, 0, 0.25, 'arc'],
  bakery: [11, 0.05, -15, 0.3, -0.1, ''],
  tower: [14, 0.05, 12, 0.6, 0.35, ''],
  combat: [0, 0.05, 8, 0, -0.05, 'combat'],
  edge: [-28, 0.05, 30, Math.PI, -0.25, ''],
};
for (const [name, [x, y, z, yaw, pitch, setup]] of Object.entries(shots)) {
  if (only && !only.split(',').includes(name)) continue;
  await page.evaluate(({ x, y, z, yaw, pitch, setup }) => {
    const g = window.__game;
    if (g.isPaused) g.play();
    const p = g.player; const V = p.motor.pos.constructor;
    const bot = g.actors[1];
    if (!g.__brain) { g.__brain = bot.controller; }
    bot.controller = null; bot.motor.teleport(new V(40, 0.05, 0));
    if (!p.alive) g.respawnPlayer();
    if (!p.armed) { p.giveWeapon('tincan', 2, 0, true); p.ammo.medium = 60; }
    p.hp = 100;
    p.motor.teleport(new V(x, y, z)); p.bodyYaw = yaw; g.camRig.snapTo(p); g.camRig.yaw = yaw; g.camRig.pitch = pitch;
    g.input.s.touchActive = g.input.s.touchActive;
    g.debugCam = null;
    if (setup === 'portrait') { bot.motor.teleport(new V(0, 0.05, 16)); bot.bodyYaw = 0; p.motor.teleport(new V(0.9, 0.05, 16.2)); p.bodyYaw = 0.5; g.debugCam = { pos: new V(0.5, 1.35, 13.6), target: new V(0.45, 0.95, 16) }; }
    if (setup === 'lineup') { const ext = g.__extra ?? (g.__extra = [g.createBot(), g.createBot(), g.createBot()]); ext.forEach((e, i) => { e.controller = null; e.motor.teleport(new V(-2.2 + i * 1.5, 0.05, 15.6)); e.bodyYaw = 0.25 - i * 0.2; }); bot.motor.teleport(new V(2.3, 0.05, 15.6)); bot.bodyYaw = -0.4; p.motor.teleport(new V(-3.6, 0.05, 15.8)); p.bodyYaw = 0.6; g.debugCam = { pos: new V(-0.3, 1.5, 11.2), target: new V(-0.3, 0.8, 15.6) }; }
    if (setup === 'arsenal') {
      const ids = ['poppistol', 'rattle', 'broomstick', 'tincan', 'needler', 'thumper', 'sparkbow', 'pepperbox'];
      ids.forEach((id, i) => g.loot.spawn('weapon', id, i % 5, 1, new V(-5.25 + i * 1.5, 0.05, 16)));
      g.loot.spawn('heal', 'jamjar', 1, 1, new V(-4, 0.05, 14.3)); g.loot.spawn('heal', 'biscuit', 3, 1, new V(-2.8, 0.05, 14.3)); g.loot.spawn('util', 'fizzbomb', 1, 1, new V(-1.6, 0.05, 14.3));
      g.loot.spawn('util', 'chicken', 2, 1, new V(-0.4, 0.05, 14.3)); g.loot.spawn('util', 'stickypop', 2, 1, new V(0.8, 0.05, 14.3)); g.loot.spawn('util', 'gust', 2, 1, new V(2, 0.05, 14.3)); g.loot.spawn('util', 'bouncejam', 1, 1, new V(3.2, 0.05, 14.3)); g.loot.spawn('ammo', 'shells', 0, 10, new V(4.4, 0.05, 14.3));
      p.motor.teleport(new V(12, 0.05, 30));
      g.debugCam = { pos: new V(0, 2.6, 10.8), target: new V(0, 0.4, 15.4) };
    }
    if (setup === 'card') { p.weapons = [null, null, null]; p.giveWeapon('rattle', 1, 0, true); p.giveWeapon('tincan', 0, 1, true); g.loot.spawn('weapon', 'tincan', 0, 1, new V(-2, 0.05, 12.6)); }
    if (setup === 'crate') { const c = g.loot.crates.find((c) => Math.abs(c.pos.x + 2) < 0.1); g.loot.resetCrates(); g.loot.openCrate(c, p); g.debugStep(52); g.debugCam = { pos: new V(0.5, 2.4, -2.2), target: new V(-2, 0.8, -6.2) }; }
    if (setup === 'boom') { bot.motor.teleport(new V(-2, 0.05, 2)); g.throwables.smokes.push({ pos: new V(3, 1.2, 2), r: 5, t: 1.5, life: 10 }); g.debugStep(40); g.throwables.explode(new V(-2, 0.3, 3), null, g, 0, 4.5, 'TEST'); g.debugStep(5); }
    if (setup === 'heal') { p.healItem = null; p.addItem('heal', 'jamjar', 2); p.hp = 40; g.input.s.healPressed = true; g.debugStep(40); p.bodyYaw = Math.PI - 0.5; g.debugCam = { pos: new V(0.3, 1.4, 17.8), target: new V(0, 1.0, 20) }; }
    if (setup === 'held') { const ids = ['poppistol', 'broomstick', 'needler', 'thumper', 'sparkbow']; const ext = g.__extra ?? (g.__extra = [g.createBot(), g.createBot(), g.createBot()]); const all = [bot, ...ext, p]; all.forEach((e, i) => { e.controller = e === p ? e.controller : null; e.weapons = [null, null, null]; e.giveWeapon(ids[i], 2, 0, true); e.motor.teleport(new V(-3 + i * 1.5, 0.05, 15.6)); e.bodyYaw = Math.PI * 0.85 + i * 0.1; }); g.debugCam = { pos: new V(0, 1.5, 11.5), target: new V(0, 0.9, 15.6) }; }
    if (setup === 'face') { g.camRig.yaw = yaw; p.bodyYaw = 0; bot.motor.teleport(new V(0.8, 0.05, 16.5)); bot.bodyYaw = 0.3; }
    if (setup === 'combat') { bot.motor.teleport(new V(1.5, 0.05, -3)); bot.bodyYaw = Math.PI; }
    g.debugStep(30);
    if (setup === 'arc') g.input.s.throwHeld = true;
    if (setup === 'combat') { g.input.s.fire = true; }
    g.debugStep(setup === 'combat' ? 14 : 4);
    g.input.s.fire = false;
  }, { x, y, z, yaw, pitch, setup });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `tools/out/shot-${name}${mobile ? '-m' : ''}.png` });
  await page.evaluate(() => { const g = window.__game; g.input.s.throwHeld = false; });
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.kill(); process.exit(0);
