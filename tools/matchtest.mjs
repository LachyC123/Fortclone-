// Plays a full battle royale headlessly: lobby -> Sky Barge -> drop -> Gloom -> end screen.
// The player is made invulnerable-ish by parking them safely so we can watch the bots finish it.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4174;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/m-home.png` });
await page.evaluate(() => { window.__game.startMatch(); window.__game.input.s.touchActive = true; });
const shot = async (name) => { await page.evaluate(() => window.__game.debugStep(1)); await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); };
const run = (sec) => page.evaluate((sec) => {
  const g = window.__game;
  for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30);
  const m = g.match;
  const p = g.player;
  return { phase: m?.phase, remaining: m?.remaining, t: g.time.toFixed(1), prog: m?.barge.progress.toFixed(2), flight: p.flight, pos: p.motor.pos.toArray().map((v) => v.toFixed(1)).join(','), alive: p.alive, out: p.out, bug: !!p.bugout,
    flights: g.actors.reduce((o, a) => ((o[a.flight] = (o[a.flight] || 0) + 1), o), {}), gloom: m ? `${m.gloom.state} ph${m.gloom.phase} r=${m.gloom.radius.toFixed(1)}` : '', bugouts: g.actors.filter((a) => a.bugout).length, kills: g.actors.reduce((s, a) => s + a.kills, 0) };
}, sec);
const log = [];
log.push(JSON.stringify(await run(4)));
await shot('m-lobby');
log.push(JSON.stringify(await run(11)));
await shot('m-barge');
log.push(JSON.stringify(await run(3)));
// player jumps
await page.evaluate(() => { window.__game.input.s.jumpPressed = true; });
log.push(JSON.stringify(await run(1.2)));
await shot('m-dive');
log.push(JSON.stringify(await run(4)));
await shot('m-glide');
for (let i = 0; i < 40; i++) {
  const r = await run(10);
  log.push(JSON.stringify(r));
  if (i === 3) await shot('m-live');
  if (r.phase === 'end') break;
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/m-summary.png` });
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
