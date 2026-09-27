// Screenshots of the in-between landmarks (camps, ruins, balloon wreck, pond...) from a drone's view.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const server = spawn('npx', ['vite', 'preview', '--port', '4194', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript(() => localStorage.setItem('rr.settings', JSON.stringify({ quality: 'high', autoQuality: false })));
await page.goto('http://localhost:4194/');
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const list = await page.evaluate(() => { const g = window.__game; g.play(); document.querySelectorAll('.overlay, .hud, .touch').forEach((e) => (e.style.display = 'none')); return g.world.landmarks; });
for (const lm of list) {
  if (only && !lm.name.toLowerCase().includes(only)) continue;
  await page.evaluate((lm) => {
    const g = window.__game; const V = g.player.motor.pos.constructor;
    const gy = g.cw.raycast(new V(lm.x, 60, lm.z), new V(0, -1, 0), 100, 1)?.point.y ?? 0;
    g.player.motor.teleport(new V(lm.x + 30, gy + 40, lm.z + 30));
    g.freeze = true;
    g.debugCam = { pos: new V(lm.x + 8, gy + 13, lm.z + 8), target: new V(lm.x, gy + 0.5, lm.z) };
    g.r.followShadows(new V(lm.x, gy, lm.z));
    g.world.update(0.016, g.actors, g.debugCam.pos);
  }, lm);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `tools/out/lm-${lm.name.toLowerCase().replace(/[^a-z]+/g, '-')}.png` });
  console.log('shot', lm.name);
}
await browser.close();
server.kill();
process.exit(0);
