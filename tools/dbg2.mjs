import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4179/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game; g.play(); const log = []; const V = g.player.motor.pos.constructor;
  const p = g.player; p.controller = null; p.motor.teleport(new V(20, 0.05, 30)); p.hp = 1e9; p.maxHp = 1e9; p.alive = false; p.rig.root.visible = false; g.respawnPlayer = () => {};
  const feed = []; const orig = g.hud.killfeed.bind(g.hud); g.hud.killfeed = (k, v, w, l) => { feed.push(`${k}>${v}(${w})`); orig(k, v, w, l); };
  let utils = 0; const ot = g.throwables.throw.bind(g.throwables); g.throwables.throw = (...a) => { utils++; ot(...a); };
  let heals = 0; const t0 = performance.now();
  for (let i = 0; i < 120 * 4; i++) { g.debugStep(15); for (const a of g.actors) if (a.healT >= 0 && a.healT < 0.3) heals++; }
  const ms = performance.now() - t0;
  log.push(`kills: ${feed.length} -> ${feed.join(', ')}`);
  log.push(`utilities thrown: ${utils}  heal frames: ${heals}  crates opened: ${g.loot.crates.filter(c => c.opened).length}/${g.loot.crates.length}  fusions: ${g.actors.reduce((a, b) => a + b.fusions, 0)}`);
  log.push(`bots: ${g.actors.slice(1).map(a => `${a.name}[${a.controller.profile.archetype}] k=${a.kills} ${a.weapons.map(w => w ? w.def.id + w.rarity : '-').join('/')} util=${a.util?.id ?? '-'} heal=${a.healItem?.id ?? '-'}`).join(' | ')}`);
  log.push(`sim cost: ${(ms / (120 * 60)).toFixed(3)} ms/frame (no render)`);
  return log;
});
console.log(out.join('\n'));
await browser.close(); server.kill(); process.exit(0);
