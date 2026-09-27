// First-play training: PLAY on a fresh profile starts it; walk every step (including the cocoon
// hatch + naming cutscene and blinking onto the tall rock); PLAY A MATCH afterwards. Also SKIP.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const mobile = process.argv.includes('--mobile');
const server = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const mk = async () => {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => localStorage.setItem('rr.settings', JSON.stringify({ quality: 'low', autoQuality: false })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto('http://localhost:4181/');
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  return page;
};
const log = []; log.push = (x) => { console.log(x); return 0; };
const page = await mk();
if (mobile) await page.evaluate(() => window.__game.touch.enable());
await page.click('.btn.play', { force: true });
await page.waitForFunction(() => window.__game.mode === 'training', null, { timeout: 20000 });
log.push('PLAY on a fresh profile -> ' + (await page.evaluate(() => window.__game.mode)));
await page.evaluate(() => { window.__game.freeze = false; });
await page.waitForTimeout(1200);
await page.screenshot({ path: `tools/out/tut-intro${mobile ? '-m' : ''}.png` });
const step = (sec) => page.evaluate((sec) => window.__game.debugStep(Math.max(1, Math.round(sec * 60))), sec);
const cur = () => page.evaluate(() => document.querySelector('.tut .now')?.textContent);
await step(3.6);
log.push('after intro: ' + (await cur()));
await page.evaluate(() => { document.exitPointerLock?.(); });

// move
await page.evaluate(() => { const g = window.__game; g.input.enabled = true; });
if (mobile) {
  await page.evaluate(() => { window.__game.input.s.moveY = 1; });
  for (let i = 0; i < 20; i++) { await page.evaluate(() => { window.__game.input.s.moveY = 1; window.__game.debugStep(6); }); }
  await page.evaluate(() => { window.__game.input.s.moveY = 0; });
} else {
  await page.keyboard.down('KeyW'); await step(2); await page.keyboard.up('KeyW');
}
await step(0.4);
log.push('after move: ' + (await cur()));
await page.screenshot({ path: `tools/out/tut-list${mobile ? '-m' : ''}.png` });
// look
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 30; i++) { g.input.s.lookDX = 0.1; g.debugStep(1); } });
await step(0.4);
log.push('after look: ' + (await cur()));
// jump
await page.evaluate(() => { window.__game.input.s.jumpPressed = true; }); await step(0.4);
log.push('after jump: ' + (await cur()));
// slide: run then crouch
await page.evaluate(() => { const g = window.__game; g.camRig.yaw = Math.PI; });
for (let i = 0; i < 8; i++) await page.evaluate(() => { const s = window.__game.input.s; s.touchActive = true; s.moveY = 1; s.sprint = true; window.__game.debugStep(6); });
await page.evaluate(() => { const s = window.__game.input.s; s.crouchPressed = true; window.__game.debugStep(6); s.moveY = 0; s.sprint = false; });
await page.evaluate(() => { window.__game.input.s.touchActive = window.__game.touch.active; });
await step(0.5);
log.push('after slide: ' + (await cur()));
// grab the pistol
await page.evaluate(() => {
  const g = window.__game; const p = g.player; const pk = g.loot.pickups.find((x) => x.defId === 'poppistol' && x.pos.distanceTo(g.training.pedestal) < 3);
  p.motor.teleport(pk.pos.clone().setY(g.world.lobby.center.y + 0.05).add(new pk.pos.constructor(0, 0, 1.3)));
  g.camRig.yaw = 0; g.camRig.pitch = -0.4; g.debugStep(10);
  g.input.s.interactPressed = true; g.debugStep(30);
});
log.push('grab debug: ' + (await page.evaluate(() => { const g = window.__game; const p = g.player; const pk = g.loot.pickups.find((x) => x.defId === 'poppistol' && x.pos.distanceTo(g.training.pedestal) < 3); return `pk=${pk ? pk.pos.toArray().map((v) => v.toFixed(2)) + ' settled=' + pk.settled + ' collect=' + pk.collectT : 'none'} me=${p.motor.pos.toArray().map((v) => v.toFixed(2))} best=${g.loot.bestFor(p)?.defId} ctx=${g.pc.contextPickup?.defId} alive=${p.alive}`; })));
log.push('after grab: ' + (await cur()) + ' weapon=' + (await page.evaluate(() => window.__game.player.weapon?.def.id)));
// shoot the three targets
const hits = await page.evaluate(() => {
  const g = window.__game; const p = g.player; const s = g.input.s;
  const tr = g.training;
  for (const t of tr.targets) {
    for (let i = 0; i < 90 && !t.down; i++) {
      const tgt = t.root.position.clone(); tgt.y += 1.35;
      const cam = g.camRig.cam.position; const d = tgt.sub(cam).normalize();
      g.camRig.yaw = Math.atan2(-d.x, -d.z); g.camRig.pitch = Math.asin(d.y);
      s.fire = i % 10 < 3; g.debugStep(1);
      if (p.weapon.mag === 0) p.weapon.mag = 6;
    }
  }
  s.fire = false; g.debugStep(20);
  return tr.targets.filter((t) => t.down).length;
});
log.push(`targets down: ${hits} -> ${await cur()}`);
await page.screenshot({ path: `tools/out/tut-targets${mobile ? '-m' : ''}.png` });
// reload
await page.evaluate(() => { const g = window.__game; g.player.weapon.mag = 2; g.player.ammo.light = 40; g.input.s.reloadPressed = true; g.debugStep(20); });
log.push('after reload: ' + (await cur()));
// walk to the stump: cutscene
await page.evaluate(() => { const g = window.__game; const tr = g.training; g.player.motor.teleport(tr.stump.clone().add(new tr.stump.constructor(2, 0.05, 0))); g.debugStep(5); });
log.push('cutscene: ' + (await page.evaluate(() => window.__game.training.scene)));
await step(2.7);
await page.waitForTimeout(800);
await page.screenshot({ path: `tools/out/tut-hatch${mobile ? '-m' : ''}.png` });
await step(1.7);
await page.waitForSelector('.tutname .nm', { timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `tools/out/tut-name${mobile ? '-m' : ''}.png` });
await page.fill('.tutname .nm', 'Sir Zappington');
await page.click('.tutname .ok');
await step(1.2);
log.push(`named: ${await page.evaluate(() => { const g = window.__game; return g.player.bugName + ' saved=' + g.collection.bugs.find((b) => b.species === g.collection.equipped).name; })} -> ${await cur()} hatched=${await page.evaluate(() => window.__game.training.hatched)}`);
// throw + blink
await page.evaluate(() => { const g = window.__game; g.camRig.yaw = Math.PI / 2; g.camRig.pitch = 0.1; g.input.s.throwHeld = true; g.debugStep(10); g.input.s.throwHeld = false; g.input.s.throwReleased = true; g.debugStep(30); });
log.push('after throw: ' + (await cur()));
await page.evaluate(() => { const g = window.__game; g.input.s.blinkPressed = true; g.debugStep(30); });
log.push('after blink: ' + (await cur()));
// blink onto the tall rock for real: find a throw that lands on top
const tower = await page.evaluate(() => {
  const g = window.__game; const p = g.player; const tr = g.training; const top = tr.rockTop;
  const V = top.constructor;
  const c = g.world.lobby.center; const bk = new V(top.x - c.x, 0, top.z - c.z).normalize();
  for (let tries = 0; tries < 8; tries++) {
    const pitch = 0.5 + tries * 0.1;
    p.motor.teleport(new V(top.x - bk.x * 8, c.y + 0.05, top.z - bk.z * 8)); p.motor.vel.set(0, 0, 0);
    p.bug.reset(); p.bug.cooldown = 0; g.debugStep(5);
    for (let k = 0; k < 3; k++) { g.camRig.yaw = Math.atan2(-bk.x, -bk.z); g.camRig.pitch = pitch; g.debugStep(1); }
    g.input.s.throwHeld = true; g.debugStep(5); g.input.s.throwHeld = false; g.input.s.throwReleased = true;
    g.debugStep(1);
    if (tries < 2) tr.dbg = (tr.dbg || '') + ` {me ${(p.motor.pos.x - top.x).toFixed(1)},${(p.motor.pos.z - top.z).toFixed(1)} aim ${p.intent.aimDir.toArray().map((v) => v.toFixed(2))} vel ${p.bug.vel.toArray().map((v) => v.toFixed(1))} st ${p.bug.state}}`;
    for (let i = 0; i < 150 && p.bug.state !== 'landed'; i++) g.debugStep(1);
    if (p.bug.state === 'landed' && p.bug.pos.y > top.y - 0.3) {
      g.input.s.blinkPressed = true; g.debugStep(40);
      return `landed on top with pitch ${pitch.toFixed(2)}, player y=${(p.motor.pos.y - g.world.lobby.center.y).toFixed(2)}`;
    }
    tr.dbg = (tr.dbg || '') + ` [${pitch.toFixed(2)}: ${p.bug.state} ${(p.bug.pos.x - top.x).toFixed(1)},${(p.bug.pos.y - top.y).toFixed(1)},${(p.bug.pos.z - top.z).toFixed(1)}]`;
    p.bug.recall(); g.debugStep(60);
  }
  return 'never landed on top' + tr.dbg;
});
log.push(`tower: ${tower} -> ${await cur()}`);
// fizz bomb + heal
await page.evaluate(() => { const g = window.__game; g.camRig.pitch = -0.2; g.input.s.utilHeld = true; g.debugStep(10); g.input.s.utilHeld = false; g.input.s.utilReleased = true; g.debugStep(30); });
log.push('after util: ' + (await cur()));
await page.evaluate(() => { const g = window.__game; g.input.s.healPressed = true; g.debugStep(120); });
log.push('after heal: ' + (await cur()) + ' trained=' + (await page.evaluate(() => localStorage.getItem('rr.trained'))));
await page.waitForTimeout(1500);
await page.screenshot({ path: `tools/out/tut-done${mobile ? '-m' : ''}.png` });
await page.click('.tut .tplay');
await page.waitForTimeout(500);
log.push('PLAY A MATCH -> ' + (await page.evaluate(() => `mode=${window.__game.mode} phase=${window.__game.match?.phase} actors=${window.__game.actors.filter((a) => !a.parked).length} tutGone=${!document.querySelector('.tut')} bugVisible=${window.__game.player.bug.root.visible}`)));

// second fresh profile: SKIP straight into the match
const p2 = await mk();
await p2.click('.btn.play', { force: true });
await p2.waitForFunction(() => window.__game.mode === 'training', null, { timeout: 20000 });
await p2.waitForTimeout(600);
await p2.evaluate(() => { window.__game.input.s.pausePressed = true; });
await p2.waitForSelector('.skiptut:not(.hidden)', { timeout: 10000 });
await p2.click('.skiptut');
await p2.waitForTimeout(400);
log.push('SKIP -> ' + (await p2.evaluate(() => `mode=${window.__game.mode} phase=${window.__game.match?.phase} trained=${localStorage.getItem('rr.trained')} nobug=${document.body.classList.contains('tut-nobug')}`)));
// and the next PLAY goes straight to a match
await p2.evaluate(() => window.__game.goHome());
await p2.click('.btn.play', { force: true });
await p2.waitForTimeout(400);
log.push('next PLAY -> ' + (await p2.evaluate(() => window.__game.mode)));

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
