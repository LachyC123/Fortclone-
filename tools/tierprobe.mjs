// Per-quality-tier cost: build time, world/rig triangles, draw calls in a live match.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4194;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const tiers = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const q of tiers.length ? tiers : ['low', 'medium', 'high']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const logs = [];
  page.on('console', (m) => { if (m.text().startsWith('[t]')) logs.push(m.text().trim()); });
  await page.addInitScript((q) => localStorage.setItem('rr.settings', JSON.stringify({ quality: q, autoQuality: false })), q);
  await page.goto(`http://localhost:${PORT}/?timing`);
  await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const g = window.__game;
    const tri = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    let rig = 0;
    g.player.rig.root.traverse((o) => { if (o.isMesh) rig += tri(o); });
    let bug = 0;
    g.player.bug.root.traverse((o) => { if (o.isMesh) bug += tri(o); });
    let world = 0;
    g.world.group.traverse((o) => { if (o.isMesh) world += tri(o); });
    g.startMatch();
    g.freeze = true;
    const m = g.match;
    let n = 0;
    while (m.phase !== 'live' && n++ < 20000) g.debugStep(1, 1 / 30);
    for (let i = 0; i < 20 * 30; i++) g.debugStep(1, 1 / 30);
    const info = g.r.renderer.info;
    info.autoReset = false;
    let calls = 0, tris = 0;
    const pos = [[0, 0], [-20, -70], [70, 20], [20, -100]];
    const V = g.player.motor.pos.constructor;
    for (const [x, z] of pos) {
      g.player.motor.teleport(new V(x, 3, z));
      g.debugStep(10, 1 / 30);
      g.world.update(0.3, g.actors, g.camera.position);
      info.reset();
      g.r.render();
      calls += info.render.calls;
      tris += info.render.triangles;
    }
    return { rig: Math.round(rig / 1000) + 'k', bug: Math.round(bug / 1000) + 'k', worldGeo: (world / 1e6).toFixed(2) + 'M', calls: Math.round(calls / pos.length), tris: (tris / pos.length / 1e6).toFixed(2) + 'M' };
  });
  console.log(q.padEnd(6), JSON.stringify(r), logs.filter((l) => l.includes('world')).join(' '));
  await page.close();
}
await browser.close(); server.kill(); process.exit(0);
