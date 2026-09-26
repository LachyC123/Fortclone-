import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const PORT = 4187;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; g.startMatch(); g.pause();
  const m = g.match; const step = (s) => { for (let i = 0; i < Math.round(s * 30); i++) g.debugStep(1, 1 / 30); };
  while (m.phase === 'lobby') step(0.5);
  g.player.parked = true;
  while (m.phase === 'barge') step(0.5);
  step(50);
  const out = [];
  const bots = g.actors.filter((a) => a.alive && !a.parked && !a.armed && a.controller?.state).slice(0, 3);
  out.push(`unarmed after 20s: ${g.actors.filter((a) => a.alive && !a.parked && !a.armed).length}/${m.remaining}`);
  for (let k = 0; k < 20; k++) {
    for (const a of bots) {
      const b = a.controller;
      const lt = b.lootTarget, ct = b.crateTarget;
      const tp = lt?.pos ?? ct?.pos;
      out.push(`${k * 2}s ${a.name.padEnd(10)} ${b.state.padEnd(8)} esc=${b.escapeT.toFixed(1)} stc=${b.stuckCount} zone=${b.zoneSprint} tgtPath=${b.path.slice(b.pathIdx, b.pathIdx + 2).map((v) => v.toArray().map((x) => x.toFixed(0)).join(',')).join(' ')} gl=${b.goal.toArray().map((x) => x.toFixed(0))} armed=${a.armed} pos=${a.motor.pos.toArray().map((v) => v.toFixed(1))} tgt=${lt ? lt.kind : ct ? 'crate' : '-'} d=${tp ? tp.distanceTo(a.motor.pos).toFixed(1) : '-'} tp=${tp ? tp.toArray().map((v) => v.toFixed(1)) : ''} path=${b.pathIdx}/${b.path.length} goal=${b.hasGoal} idle=${b.idleT.toFixed(1)} mv=${a.intent.moveX.toFixed(1)},${a.intent.moveZ.toFixed(1)} spd=${a.motor.horizontalSpeed().toFixed(1)} pend=${b.pendingPlan} unr=${b.unreachable.size}`);
    }
    step(2);
  }
  return out;
});
console.log(r.join('\n'));
await browser.close(); server.kill(); process.exit(0);
