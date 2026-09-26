import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const server = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4180/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game; g.play(); const log = []; const V = g.player.motor.pos.constructor;
  const p = g.player; p.controller = null; p.motor.teleport(new V(20, 0.05, 30)); p.hp = 1e9; p.maxHp = 1e9; p.alive = false; p.rig.root.visible = false; g.respawnPlayer = () => {};
  const b = g.actors[1]; for (const a of g.actors.slice(2)) { a.controller = null; a.motor.teleport(new V(-40 + a.id, 0.05, 0)); a.hp = 1e9; a.alive = false; a.rig.root.visible = false; }
  const br = b.controller; g.botRespawn = new Map(); g['botRespawn'].set = () => {};
  const c = g.loot.crates[6]; b.motor.teleport(c.pos.clone().add(new V(5, 0.05, 3)));
  for (let i = 0; i < 24; i++) {
    g.debugStep(15);
    log.push(`t=${(i * 0.25).toFixed(2)} state=${br.state} pos=${b.motor.pos.toArray().map(v => v.toFixed(1))} d=${b.motor.pos.distanceTo(c.pos).toFixed(2)} crate=${br.crateTarget ? 'Y' : '-'} loot=${br.lootTarget?.kind ?? '-'} path=${br.path.length} opened=${c.opened} openT=${c.openT.toFixed(2)}`);
  }
  log.push(`crates opened ${g.loot.crates.filter(c => c.opened).length}`);
  return log;
});
console.log(out.join('\n'));
await browser.close(); server.kill(); process.exit(0);
