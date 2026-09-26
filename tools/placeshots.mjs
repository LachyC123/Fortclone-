// Screenshots of the peninsula places (bigger island).
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4193;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.evaluate(() => { const g = window.__game; g.startPlayground(); g.freeze = true; g.hud.root.style.display = 'none'; });
const views = {
  overview: [0, 260, 150, 0, 0, 0],
};
const pois = await page.evaluate(() => {
  const g = window.__game;
  return g.world.zones.filter((z) => !z.indoor).map((z) => ({ name: z.name, x: (z.min.x + z.max.x) / 2, z: (z.min.z + z.max.z) / 2 }));
});
for (const p of pois) {
  if (!['Puddleby Farm', 'Tickerton', 'Snoozy Pines', 'Saltwhistle Wharf', 'Rumpus Fair'].includes(p.name)) continue;
  // camera on the island-centre side, up and back, looking at the place
  const d = Math.hypot(p.x, p.z);
  const ux = -p.x / d, uz = -p.z / d;
  views[p.name.split(' ')[0].toLowerCase()] = [p.x + ux * 34 + uz * 10, 22, p.z + uz * 34 - ux * 10, p.x, 2, p.z];
  views[p.name.split(' ')[0].toLowerCase() + '-ground'] = [p.x + ux * 14 + uz * 4, 2.2, p.z + uz * 14 - ux * 4, p.x - ux * 4, 2.5, p.z - uz * 4];
}
for (const [name, v] of Object.entries(views)) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate((v) => {
    const g = window.__game;
    const V = g.player.motor.pos.constructor;
    g.debugCam = { pos: new V(v[0], v[1], v[2]), target: new V(v[3], v[4], v[5]) };
    g.player.motor.teleport(new V(v[3], 30, v[5]));
    g.world.update(0.3, g.actors, g.debugCam.pos);
    g.r.followShadows(g.debugCam.target);
  }, v);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/pl-${name}.png`, timeout: 180000 });
}
console.log(Object.keys(views).join(' '));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
