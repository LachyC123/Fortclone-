// ASCII density map of the island: # buildings (indoor zones), o solid cover, . open land, ~ sea.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4192;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`http://localhost:${PORT}/?timing`);
page.on('console', (m) => console.log(m.text()));
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game;
  const S = 5.5, N = 52;
  const rows = [];
  let indoor = 0, cover = 0, open = 0;
  const names = new Set();
  for (let j = 0; j < N; j++) {
    let row = '';
    for (let i = 0; i < N; i++) {
      const x = -143 + i * S + S / 2, z = -143 + j * S + S / 2;
      const zs = g.world.zones.filter((q) => q.indoor && x >= q.min.x && x <= q.max.x && z >= q.min.z && z <= q.max.z);
      const list = g.cw.query(x - S / 2, -5, z - S / 2, x + S / 2, 40, z + S / 2, 1).filter((o) => o.constructor.name !== 'HeightfieldCollider' && (o.max.y - o.min.y) > 1 && (o.max.x - o.min.x) < 60);
      const land = g.world.zoneAt ? true : true;
      if (zs.length) { row += '#'; indoor++; zs.forEach((q) => names.add(q.name)); }
      else if (list.length) { row += 'o'; cover++; }
      else {
        // sea?
        const R = Math.hypot(x, z);
        const V = g.player.motor.pos.constructor; const hgt = g.cw.colliders.find((c) => c.tag === 'ground'); const sea = hgt.raycast(new V(x, 60, z), new V(0, -1, 0), 200) < 0; if (sea) row += ' '; else { row += '.'; open++; }
      }
    }
    rows.push(row);
  }
  return rows.join('\n') + `\nindoor cells=${indoor} cover=${cover} open=${open}\nbuildings(named)=${names.size}\ncolliders=${g.cw.colliders.length} lootSpots=${g.world.lootSpots.length} crates=${g.world.crateSpots.length}`;
});
console.log(r);
await browser.close(); server.kill(); process.exit(0);
