// Milestone 5 visuals: lobby emotes & bubbles, a close-up of reactions, the Loot Balloon.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4188;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (process.env.Q) await page.addInitScript((q) => localStorage.setItem('rr.settings', JSON.stringify({ quality: q, autoQuality: false })), process.env.Q);
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); };
// 1) close-up: a bot reacting + dancing next to you
await page.evaluate(() => {
  const g = window.__game;
  g.startPlayground();
  const V = g.player.motor.pos.constructor;
  const p = g.player;
  p.spawn(new V(0, 0.05, 24), Math.PI);
  const [b1, b2, b3] = g.actors.slice(1);
  for (const [b, x] of [[b1, -1.8], [b2, 0.3], [b3, 2.2]]) { b.controller = null; b.parked = true; b.spawn(new V(x, 0.05, 29), 0); }
  b1.say('!', '#ff6b6b', 30, true); b1.startEmote('wave', 30);
  b2.say('HA!', '#f2c14e', 30, true); b2.startEmote('dance', 30);
  b3.say('EEK!', '#ff8a8a', 30, true); b3.startEmote('flex', 30);
  g.debugStep(20);
  g.debugCam = { pos: new V(0.5, 2.2, 23), target: new V(0.2, 1.2, 29) };
});
await shot('p-reactions');
await page.evaluate(() => { const g = window.__game; g.debugStep(15); });
await shot('p-reactions2');
// 2) lobby life
await page.evaluate(() => {
  const g = window.__game;
  g.debugCam = null;
  g.startMatch();
  g.input.s.touchActive = true;
  for (let i = 0; i < 9 * 30; i++) g.debugStep(1, 1 / 30);
  const L = g.world.lobby.center;
  const V = g.player.motor.pos.constructor;
  g.debugCam = { pos: new V(L.x + 9, L.y + 4, L.z + 9), target: new V(L.x, L.y + 1, L.z) };
});
await shot('p-lobby');
// 3) the Loot Balloon
await page.evaluate(() => {
  const g = window.__game;
  g.debugCam = null;
  const m = g.match;
  while (m.phase !== 'live') g.debugStep(1, 1 / 30);
  for (let i = 0; i < 30; i++) g.debugStep(1, 1 / 30);
  m.spawnBalloon();
  for (let i = 0; i < 12 * 30; i++) g.debugStep(1, 1 / 30);
  const b = m.balloons[0];
  const V = g.player.motor.pos.constructor;
  window.__bl = b;
  g.debugCam = { pos: new V(b.land.x + 18, b.land.y + 16, b.land.z + 18), target: b.group.position.clone() };
});
await shot('p-balloon');
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 14 * 30; i++) g.debugStep(1, 1 / 30);
  const b = window.__bl;
  const V = g.player.motor.pos.constructor;
  g.debugCam = { pos: new V(b.land.x + 7, b.land.y + 5, b.land.z + 7), target: b.land.clone() };
});
await shot('p-balloon-landed');
console.log('ERRORS:', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
