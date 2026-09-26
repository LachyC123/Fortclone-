// Every rascal must land ON the island, whatever the route and whether they jump early, late or never.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4178;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const lines = [];
for (let run = 0; run < 6; run++) {
  const r = await page.evaluate((run) => {
    const g = window.__game;
    g.startMatch();
    g.input.s.touchActive = true;
    const m = g.match, p = g.player;
    let jumpedAt = -1, t = 0;
    while (m.phase === 'lobby') g.debugStep(1, 1 / 30);
    const early = run % 2 === 0;
    // early runs: jump the instant it's allowed; late runs: never jump (auto-drop)
    while (g.actors.some((a) => a.flight !== 'none') && t < 60) {
      if (early && m.canDrop && p.flight === 'barge') { g.input.s.jumpPressed = true; jumpedAt = m.barge.progress; }
      g.debugStep(1, 1 / 30); t += 1 / 30;
    }
    g.debugStep(30, 1 / 30);
    const R = (a) => 46 + Math.sin(a * 3 + 1.3) * 2.2 + Math.sin(a * 7 + 0.4) * 1.2 + Math.sin(a * 13) * 0.5;
    const outside = g.actors.filter((a) => { const d = Math.hypot(a.motor.pos.x, a.motor.pos.z); return a.alive && d > R(Math.atan2(a.motor.pos.z, a.motor.pos.x)) - 0.5; });
    const pd = Math.hypot(p.motor.pos.x, p.motor.pos.z);
    const maxD = Math.max(...g.actors.map((a) => Math.hypot(a.motor.pos.x, a.motor.pos.z)));
    const sky = g.actors.filter((a) => a.out).length;
    const stuck = g.actors.filter((a) => a.flight !== 'none').map((a) => `${a.name}:${a.flight} alive=${a.alive} out=${a.out} parked=${a.parked} bug=${!!a.bugout} pos=${a.motor.pos.toArray().map((v) => v.toFixed(1))}`).join('; ');
    const res = `stuck[${stuck}] run ${run} ${early ? 'EARLY' : 'NEVER'} jump@${jumpedAt.toFixed(2)} enter=${m.enterAt.toFixed(2)} exit=${m.exitAt.toFixed(2)} player d=${pd.toFixed(1)} y=${p.motor.pos.y.toFixed(1)} alive=${p.alive} | outside=${outside.length} out=${sky} maxD=${maxD.toFixed(1)} t=${t.toFixed(1)}s`;
    g.goHome();
    return res;
  }, run);
  lines.push(r);
  console.log(r);
}
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
