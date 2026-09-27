// UI review sweep: every screen and HUD state on desktop / phone landscape / phone portrait.
// node tools/uishots.mjs [--mobile|--portrait]  -> tools/out/ui-*.png
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const mobile = process.argv.includes('--mobile');
const portrait = process.argv.includes('--portrait');
const PORT = 4194 + (mobile ? 1 : 0) + (portrait ? 2 : 0);
fs.mkdirSync('tools/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vp = portrait ? { width: 390, height: 844 } : mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 };
const ctx = await browser.newContext(mobile || portrait ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
await ctx.addInitScript(() => {
  localStorage.setItem('rr.settings', JSON.stringify({ quality: 'medium', autoQuality: false }));
  localStorage.setItem('rr.trained', '1');
  localStorage.setItem('rr.profile', JSON.stringify({ level: 7, xp: 300, wins: 3, matches: 20, rating: 0.4 }));
  localStorage.setItem('rr.trophies', JSON.stringify({ trophies: 412, best: 412, claimed: [0, 1, 2, 3], title: 'Pebble Flinger' }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(`http://localhost:${PORT}/`);
if (mobile || portrait) await page.evaluate(() => 0);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const sfx = portrait ? '-p' : mobile ? '-m' : '';
const finish = () => page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.pause(); a.currentTime = 3000; } }));
const shot = async (n, wait = 700) => {
  await page.waitForTimeout(wait);
  await finish();
  await page.waitForTimeout(80);
  await page.screenshot({ path: `tools/out/ui-${n}${sfx}.png` });
};
await shot('home', 1200);
// pause/settings
await page.evaluate(() => { const g = window.__game; g.startPlayground(); if (navigator.maxTouchPoints) g.touch.enable(); });
await page.waitForTimeout(500);
await page.evaluate(() => window.__game.pause());
await shot('pause');
await page.evaluate(() => window.__game.goHome());
await page.waitForTimeout(300);
// my bugs
await page.click('.bugsbtn', { force: true });
await shot('bugs', 1200);
await page.click('.bugsmenu .close', { force: true });
// trophy road
await page.click('.trophybtn', { force: true });
await shot('road', 1000);
await page.click('.road .x', { force: true });
// lan
await page.click('.friends', { force: true });
await shot('lan', 800);
await page.evaluate(() => window.__game.menus.lan.close());
await page.waitForTimeout(300);
// match: lobby, barge, landed w/ loadout, low hp, summary
await page.evaluate(() => { const g = window.__game; g.startMatch(2); g.freeze = true; });
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 150; i++) g.debugStep(1, 1 / 30); g.freeze = false; });
await shot('lobby', 900);
await page.evaluate(() => {
  const g = window.__game; g.freeze = true; const m = g.match;
  let n = 0; while (m.phase !== 'barge' && n++ < 3000) g.debugStep(3, 1 / 30);
  while (!m.canDrop && n++ < 5000) g.debugStep(3, 1 / 30);
  g.freeze = false;
});
await shot('barge', 900);
await page.evaluate(() => {
  const g = window.__game; g.freeze = true; const m = g.match; const p = g.player;
  g.input.s.jumpPressed = true; g.debugStep(3, 1 / 30);
  for (let i = 0; i < 80 && p.flight !== 'none'; i++) g.debugStep(15, 1 / 30);
  p.giveWeapon('rattle', 2, 0, true); p.giveWeapon('pepperbox', 3, 1, true); p.ammo.light = 120; p.ammo.shells = 16;
  p.addItem('heal', 'fizzle', 2); p.addItem('util', 'stickypop', 2);
  p.addPerk('springy');
  p.relics.push('orb');
  p.hp = 64;
  for (let i = 0; i < 30; i++) g.debugStep(1, 1 / 30);
  g.hud.toast('RARE RATTLE-GUN', '#49a8ff');
  g.freeze = false;
});
await shot('live', 1200);
await page.evaluate(() => { const g = window.__game; g.player.hp = 18; g.debugStep(2, 1 / 30); });
await shot('lowhp', 600);
await page.evaluate(() => { const g = window.__game; g.hud.bigToast('ELIMINATED CRANKYPETE', '#ff6b6b'); g.hud.killfeed('You', 'CrankyPete', 'rattle', true); g.hud.killfeed('MuffinKing', 'Pip', 'pepperbox', false); });
await shot('feed', 300);
// summary
await page.evaluate(() => {
  const g = window.__game; g.freeze = true; const m = g.match; const p = g.player;
  for (const a of g.actors) if (a.team !== p.team && a.alive) { a.hp = 1; a.takeDamage(999, p, false, p.motor.pos.clone().set(1, 0, 0), g, 'TEST'); a.bugout = null; a.out = true; a.alive = false; }
  for (let i = 0; i < 40 && document.querySelector('.summary')?.classList.contains('hidden'); i++) g.debugStep(15, 1 / 30);
  g.freeze = false;
});
await shot('summary', 1500);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
server.kill();
