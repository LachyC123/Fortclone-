// Rift Relics in a match: a relic on the ground (beam), carrying one (HUD pouch), banking at a nest,
// and a bot carrying one (gem over its head).
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const mobile = process.argv.includes('--mobile');
const server = spawn('npx', ['vite', 'preview', '--port', '4193', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('rr.settings', JSON.stringify({ quality: 'medium', autoQuality: false }));
  localStorage.setItem('rr.trained', '1');
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('http://localhost:4193/');
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const sfx = mobile ? '-m' : '';
const out = await page.evaluate(() => {
  const g = window.__game; g.startMatch(1); g.freeze = true;
  const m = g.match;
  const step = (s) => { for (let i = 0; i < Math.round(s * 30); i++) g.debugStep(1, 1 / 30); };
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  g.input.s.jumpPressed = true; step(0.1);
  const p = g.player;
  for (let i = 0; i < 60 && p.flight !== 'none'; i++) step(0.5);
  // stand near a nest, with a relic just ahead
  const nest = g.world.nests[1] ?? g.world.nests[0];
  const at = nest.pos.clone().add({ x: 6, y: 0, z: 6 });
  p.motor.teleport(at.clone().setY(at.y + 1));
  step(0.5);
  for (const a of g.actors) if (a !== p && a.motor.pos.distanceTo(p.motor.pos) < 40) a.motor.teleport(a.motor.pos.clone().setX(a.motor.pos.x + 80));
  g.loot.spawn('relic', 'orb', 3, 1, p.motor.pos.clone().add({ x: -2, y: 0.4, z: -3 }));
  step(1);
  return { nest: nest.pos.toArray(), p: p.motor.pos.toArray() };
});
const cam = async (px, py, pz, tx, ty, tz) => page.evaluate(([a, b, c, d, e, f]) => { const g = window.__game; g.debugCam = { pos: g.player.motor.pos.clone().set(a, b, c), target: g.player.motor.pos.clone().set(d, e, f) }; }, [px, py, pz, tx, ty, tz]);
const P = out.p;
await cam(P[0] + 3, P[1] + 3, P[2] + 5, P[0] - 2, P[1] + 1, P[2] - 3);
await page.waitForTimeout(1500);
await page.screenshot({ path: `tools/out/relic-ground${sfx}.png` });
// walk onto it
const carried = await page.evaluate(() => {
  const g = window.__game; const p = g.player;
  const r = g.loot.pickups.find((q) => q.kind === 'relic' && q.defId === 'orb');
  p.motor.teleport(r.pos.clone());
  for (let i = 0; i < 20; i++) g.debugStep(1, 1 / 30);
  return p.relics.slice();
});
await page.evaluate(() => { window.__game.debugCam = null; window.__game.freeze = false; });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__game.freeze = true; document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }); });
await page.screenshot({ path: `tools/out/relic-carry${sfx}.png` });
// on the nest, half way through sending it home
const bank = await page.evaluate(() => {
  const g = window.__game; const p = g.player;
  const nest = g.world.nests[1] ?? g.world.nests[0];
  p.motor.teleport(nest.pos.clone().setY(nest.pos.y + 0.3));
  for (let i = 0; i < 24; i++) g.debugStep(1, 1 / 30);
  return { bankT: p.bankT, relics: p.relics.length };
});
await page.evaluate(() => { const g = window.__game; const p = g.player; g.debugCam = { pos: p.motor.pos.clone().add({ x: 4, y: 3, z: 5 }), target: p.motor.pos.clone().add({ x: 0, y: 1, z: 0 }) }; });
await page.waitForTimeout(900);
await page.screenshot({ path: `tools/out/relic-bank${sfx}.png` });
// a bot carrying one
const bot = await page.evaluate(() => {
  const g = window.__game; const p = g.player;
  const b = g.actors.find((a) => a !== p && a.alive);
  b.relics.push('shard');
  b.motor.teleport(p.motor.pos.clone().add({ x: 3, y: 0.5, z: -2 }));
  for (let i = 0; i < 20; i++) g.debugStep(1, 1 / 30);
  g.debugCam = { pos: b.motor.pos.clone().add({ x: 3, y: 2.5, z: 4 }), target: b.motor.pos.clone().add({ x: 0, y: 1.4, z: 0 }) };
  return b.name;
});
await page.waitForTimeout(900);
await page.screenshot({ path: `tools/out/relic-bot${sfx}.png` });
console.log(JSON.stringify({ carried, bank, bot, banked: await page.evaluate(() => window.__game.match.banked) }));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
