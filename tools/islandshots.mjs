// Milestone 4: boots the full island, reports load/bake cost, checks loot placement, and shoots each place.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (m.text().startsWith('[t]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/?timing`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(`boot ${(Date.now() - t0) / 1000}s`);
const info = await page.evaluate(() => {
  const g = window.__game;
  const V = g.player.motor.pos.constructor;
  const bad = [];
  const { cw } = g;
  for (const s of g.world.lootSpots) {
    const p = s.pos;
    const hit = cw.raycast(new V(p.x, p.y + 0.6, p.z), new V(0, -1, 0), 3, 1);
    if (!hit) bad.push(`floating ${p.toArray().map((v) => v.toFixed(1))}`);
    else if (cw.sphereOverlaps(new V(p.x, p.y + 0.5, p.z), 0.25, 1)) bad.push(`inside ${p.toArray().map((v) => v.toFixed(1))}`);
  }
  let walk = 0;
  for (let i = 0; i < g.nav.walk.length; i++) walk += g.nav.walk[i];
  return { loot: g.world.lootSpots.length, crates: g.world.crateSpots.length, nests: g.world.nests.length, colliders: cw.colliders.length, walk, bad };
});
console.log(JSON.stringify({ ...info, bad: info.bad.length }), '\n  ' + info.bad.slice(0, 30).join('\n  '));
const views = {
  overview: [[0, 150, 150], [0, 0, 0]],
  wobble: [[-52, 16, 0], [-70, 2, -18]],
  wobble2: [[-66, 3, -8], [-72, 4, -20]],
  market: [[-6, 14, -58], [-22, 2, -74]],
  manor: [[30, 16, -40], [50, 9, -58]],
  works: [[50, 14, 36], [72, 3, 18]],
  cove: [[-6, 12, 60], [-22, 2, 82]],
  lookout: [[26, 10, 22], [44, 8, 38]],
  ground1: [[20, 1.7, -20], [50, 3, -40]],
  ground2: [[-30, 1.7, 40], [-60, 3, 50]],
};
await page.evaluate(() => { const g = window.__game; g.play(); g.pause(); document.querySelectorAll('.overlay').forEach((e) => e.classList.add('hidden')); });
for (const [name, [pos, tgt]] of Object.entries(views)) {
  if (only.length && !only.includes(name)) continue;
  const stats = await page.evaluate(([pos, tgt]) => {
    const g = window.__game;
    const V = g.player.motor.pos.constructor;
    g.debugCam = { pos: new V(...pos), target: new V(...tgt) };
    g.paused = false;
    g.camera.position.set(...pos);
    g.camera.lookAt(new V(...tgt));
    g.r.followShadows(new V(...tgt));
    g.world.update(0.016, g.actors, g.camera.position);
    g.r.render();
    const i = g.r.renderer.info.render;
    g.paused = true;
    return `calls=${i.calls} tris=${i.triangles}`;
  }, [pos, tgt]);
  await page.evaluate(([pos, tgt]) => { const g = window.__game; const V = g.player.motor.pos.constructor; g.debugCam = { pos: new V(...pos), target: new V(...tgt) }; g.paused = false; }, [pos, tgt]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/i-${name}.png`, timeout: 120000 });
  await page.evaluate(() => { window.__game.paused = true; });
  console.log(name, stats);
}
console.log('ERRORS:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
