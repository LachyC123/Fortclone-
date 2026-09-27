// Screenshots of the juice: combo damage numbers + hit FX mid-burst, a streak kill with the
// announcer banner and edge flash, and an explosion.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const server = spawn('npx', ['vite', 'preview', '--port', '4185', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
await page.addInitScript(() => localStorage.setItem('rr.settings', JSON.stringify({ quality: 'medium', autoQuality: false })));
await page.goto('http://localhost:4185/');
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
await page.evaluate(() => {
  const g = window.__game; g.play(); g.input.s.touchActive = true;
  const V = g.player.motor.pos.constructor;
  window.__setup = () => {
    const p = g.player;
    const bots = g.actors.slice(1);
    for (const b of bots) { b.controller = null; b.parked = true; b.alive = false; b.rig.root.visible = false; b.bug.root.visible = false; b.motor.teleport(new V(0, -500, 0)); }
    p.motor.teleport(new V(-2, 0.05, 10)); p.hp = 100;
    p.weapons = [null, null, null]; p.giveWeapon('rattle', 3, 0, true); p.ammo.light = 500;
    return bots;
  };
  window.__aim = (tgt) => { const cam = g.camRig.cam.position; const d = tgt.clone().sub(cam).normalize(); g.camRig.yaw = Math.atan2(-d.x, -d.z); g.camRig.pitch = Math.asin(d.y); };
});
// 1) spraying a bot: stacking damage number + hit sparkles
await page.evaluate(() => {
  const g = window.__game; const V = g.player.motor.pos.constructor;
  const bots = window.__setup(); const a = bots[0];
  a.parked = false; a.alive = true; a.hp = 100; a.rig.root.visible = true; a.maxHp = 400; a.hp = 400; a.motor.teleport(new V(-1, 0.05, 2));
  for (let i = 0; i < 40; i++) { window.__aim(a.motor.pos.clone().setY(a.motor.pos.y + 1.0)); g.input.s.fire = true; g.debugStep(1); }
  window.__a = a;
});
await page.waitForTimeout(150);
await page.screenshot({ path: 'tools/out/juice-combo.png' });
await page.evaluate(() => { const g = window.__game; g.input.s.fire = false; window.__a.maxHp = 100; g.debugStep(60); });
// 2) three kills in a row -> TRIPLE TROUBLE announcer
await page.evaluate(() => {
  const g = window.__game; const V = g.player.motor.pos.constructor;
  const bots = window.__setup();
  for (let k = 0; k < 3; k++) {
    const a = bots[k];
    a.parked = false; a.alive = true; a.hp = 100; a.rig.root.visible = true; a.motor.teleport(new V(-3 + k * 2, 0.05, 3));
    for (let i = 0; i < 240 && a.alive; i++) { window.__aim(a.motor.pos.clone().setY(a.motor.pos.y + 1.0)); g.input.s.fire = true; g.debugStep(1); }
    g.input.s.fire = false; g.debugStep(10);
  }
  g.debugStep(8);
});
// the sim above runs slower than real time headless: replay the kill moment for the picture
await page.evaluate(() => { const h = window.__game.hud; h.playerElimination('Wobbles', 'TRIPLE TROUBLE!'); h.hitmarker(true, true); });
// the software renderer starves CSS animations headless: seek them to their 'on screen' moment
await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 420; }));
await page.waitForTimeout(350);
console.log('dom:', await page.evaluate(() => [...document.querySelectorAll('.announcer, .bigtoast, .xppops .xp, .killflash')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return `${e.className}:${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op=${cs.opacity} vis=${cs.visibility} disp=${cs.display} anim=${cs.animationName} parentHidden=${e.parentElement?.className}`; }).join('\n')));
await page.screenshot({ path: 'tools/out/juice-streak.png' });
console.log('streak:', await page.evaluate(() => { const e = document.querySelector('.announcer'); return `announcer='${e?.textContent}' class=${e?.className} streak=${window.__game.player.streak} kills=${window.__game.player.kills} xp=${[...document.querySelectorAll('.xppops .xp')].map((x) => x.textContent).join('/')} toasts=${[...document.querySelectorAll('.bigtoast')].map((x) => x.textContent).join('/')}`; }));
// 3) an explosion
await page.evaluate(() => {
  const g = window.__game; const V = g.player.motor.pos.constructor;
  window.__setup(); g.camRig.yaw = 0; g.camRig.pitch = -0.1;
  g.throwables.explode(new V(-2, 0.3, 3), null, g, 10, 4, 'TEST'); g.debugStep(3);
});
await page.waitForTimeout(120);
await page.screenshot({ path: 'tools/out/juice-boom.png' });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
