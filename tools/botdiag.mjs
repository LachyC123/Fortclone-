// Bot behaviour diagnostics: land a solo match, watch unarmed bots that end up near enemies,
// and log what they're doing (state, target, loot goal, how much they actually go anywhere).
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4197;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const g = window.__game;
  const log = [];
  const V = g.player.motor.pos.constructor;
  const step = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30); };
  g.startMatch(1);
  g.freeze = true;
  const m = g.match;
  const p = g.player;
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  // the player stays on the barge out of the way
  p.parked = true; p.alive = false;
  step(40);
  // experiment: strip every bot's guns so we see the unarmed behaviour
  const bots = g.actors.filter((a) => a !== p && a.alive && !a.parked && a.flight === 'none');
  for (const b of bots) { b.weapons = [null, null, null]; b.equip(0, true); }
  // remove all guns from the floor near them so they must hunt for loot
  const pairs = [];
  for (const a of bots) for (const b of bots) if (a.id < b.id && a.motor.pos.distanceTo(b.motor.pos) < 12) pairs.push([a, b]);
  log.push(`bots landed=${bots.length} close pairs=${pairs.length}`);
  const watch = [...new Set(pairs.flat())].slice(0, 6);
  const start = watch.map((a) => a.motor.pos.clone());
  const path = watch.map(() => 0);
  const last = watch.map((a) => a.motor.pos.clone());
  const states = watch.map(() => ({}));
  const flips = watch.map(() => 0); const prev = watch.map((a) => a.controller.state);
  for (let t = 0; t < 12; t += 0.25) {
    step(0.25);
    watch.forEach((a, i) => {
      path[i] += a.motor.pos.distanceTo(last[i]); last[i].copy(a.motor.pos);
      const br = a.controller; const k = `${br.state}${br.target ? '+T' : ''}${br.targetVisible ? 'V' : ''}${br.lootTarget ? '+L' : ''}${br.crateTarget ? '+C' : ''}`;
      states[i][k] = (states[i][k] || 0) + 1;
      if (br.state !== prev[i]) { flips[i]++; prev[i] = br.state; }
    });
  }
  watch.forEach((a, i) => {
    log.push(`${a.name.padEnd(14)} armed=${a.armed} walked=${path[i].toFixed(1)}m net=${a.motor.pos.distanceTo(start[i]).toFixed(1)}m hp=${Math.round(a.hp)} switches=${flips[i]}/12s states=${JSON.stringify(states[i])}`);
  });
  return log;
});
console.log(out.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
