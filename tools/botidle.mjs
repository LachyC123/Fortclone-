// Armed enemy bots close together: how long do they stand around not fighting?
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4199;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const teamSize = Number(process.argv.find((a) => a.startsWith('--team='))?.slice(7) ?? 1);
const out = await page.evaluate((teamSize) => {
  const g = window.__game;
  const log = [];
  const step = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30); };
  g.startMatch(teamSize);
  g.freeze = true;
  const m = g.match;
  const p = g.player;
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  p.parked = true; p.alive = false;
  step(45);
  const kinds = {}; for (const q of g.loot.pickups) kinds[q.kind] = (kinds[q.kind] || 0) + 1; log.push('pickups on the island: ' + JSON.stringify(kinds) + ' crates=' + g.loot.crates.filter((c) => !c.opened).length);
  const bots = () => g.actors.filter((a) => a !== p && a.alive && !a.parked && a.flight === 'none');
  for (const b of bots()) if (!b.armed) { b.giveWeapon('tincan', 1, 0, true); b.ammo.medium = 90; }
  const idle = new Map(); // pair key -> seconds both not fighting while close & visible
  const samples = {};
  let pairSeconds = 0, idleSeconds = 0;
  const heal = { lowNoHeal: 0, lowWithHeal: 0, healing: 0, lowCalmNoHeal: 0, seeking: 0 };
  for (let t = 0; t < 40; t += 0.25) {
    step(0.25);
    const bs = bots();
    for (const a of bs) {
      if (a.hp < 60) { if (a.healT >= 0) heal.healing++; else if (a.healItem) heal.lowWithHeal++; else { heal.lowNoHeal++; if (g.time - a.lastDamageTime > 3) { heal.lowCalmNoHeal++; if (a.controller.lootTarget?.kind === 'heal') heal.seeking++; } } }
    }
    for (const a of bs) for (const b of bs) {
      if (a.id >= b.id || a.team === b.team) continue;
      const d = a.motor.pos.distanceTo(b.motor.pos);
      if (d > 12) continue;
      const ea = a.eyePos(a.motor.pos.clone()), eb = b.eyePos(b.motor.pos.clone());
      if (!g.sightClear(ea, eb)) continue;
      pairSeconds += 0.25;
      const fa = ['engage', 'retreat', 'chase'].includes(a.controller.state) && a.controller.target === b;
      const fb = ['engage', 'retreat', 'chase'].includes(b.controller.state) && b.controller.target === a;
      if (!fa && !fb) {
        idleSeconds += 0.25;
        const k = `${a.controller.state}${a.controller.target ? (a.controller.target === b ? '>B' : '>X') : ''}${a.controller.targetVisible ? 'V' : ''} aw${(a.controller.awareness.get(b.id) ?? 0).toFixed(1)} ign${(a.controller.ignoreUntil.get(b.id) ?? 0) > g.time ? 1 : 0} | ${b.controller.state}${b.controller.target ? (b.controller.target === a ? '>A' : '>X') : ''} aw${(b.controller.awareness.get(a.id) ?? 0).toFixed(1)} ign${(b.controller.ignoreUntil.get(a.id) ?? 0) > g.time ? 1 : 0} d${Math.round(d)}`;
        samples[k] = (samples[k] || 0) + 1;
      }
    }
  }
  log.push(`close+visible enemy pair-seconds=${pairSeconds.toFixed(1)} of which neither fighting=${idleSeconds.toFixed(1)} (${((idleSeconds / Math.max(1, pairSeconds)) * 100).toFixed(0)}%)`);
  log.push(`low-hp bot samples: ${JSON.stringify(heal)}`);
  for (const [k, v] of Object.entries(samples).sort((a, b) => b[1] - a[1]).slice(0, 12)) log.push(`  ${v}x  ${k}`);
  return log;
}, teamSize);
console.log(out.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
