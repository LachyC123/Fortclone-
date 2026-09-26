// Draw-call / LOD check: spawns N bots near and far and reports render stats.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const server = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4181/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const r = await page.evaluate(async () => {
  const g = window.__game; g.play(); const V = g.player.motor.pos.constructor; const log = [];
  const measure = async (label) => { g.debugStep(2); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const i = g.r.renderer.info.render; log.push(`${label}: calls=${i.calls} tris=${i.triangles}`); };
  for (const a of g.actors.slice(1)) { a.controller = null; a.parked = true; a.motor.teleport(new V(0, -500, 0)); }
  g.player.motor.teleport(new V(0, 0.05, 20)); g.camRig.yaw = 0; g.camRig.pitch = -0.05;
  await measure('player only');
  const bots = []; for (let i = 0; i < 20; i++) { const b = g.createBot(); b.controller = null; b.parked = true; bots.push(b); }
  bots.forEach((b, i) => b.motor.teleport(new V(-6 + (i % 5) * 3, 0.05, 12 - Math.floor(i / 5) * 3)));
  await measure('20 bots near (8-17m)');
  bots.forEach((b, i) => b.motor.teleport(new V(-12 + (i % 5) * 6, 0.05, -20 - Math.floor(i / 5) * 5)));
  await measure('20 bots far (40-55m)');
  return log;
});
console.log(r.join('\n'));
await page.screenshot({ path: 'tools/out/perf-far.png' });
await browser.close(); server.kill(); process.exit(0);
