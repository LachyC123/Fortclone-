// Saves survive a wiped browser: a fake claude.ai `db`/`user` store (kept here in node) stands in
// for the cloud. Skip training, wipe localStorage, reload: no tutorial, same bug name, same trophies.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const server = spawn('npx', ['vite', 'preview', '--port', '4187', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const cloud = new Map();
const errors = [];
await ctx.exposeBinding('__cloudGet', (_s, path) => cloud.get(path) ?? null);
await ctx.exposeBinding('__cloudSet', (_s, path, body) => { cloud.set(path, body); return true; });
await ctx.addInitScript(() => {
  const db = { doc: (path) => ({ path, get: async () => { const d = await window.__cloudGet(path); return { exists: !!d, data: () => d ?? undefined }; }, set: async (d) => { await window.__cloudSet(path, d); } }) };
  const user = { id: async () => 'u_test' };
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'user' ? user : null) };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const load = async () => { await page.goto('http://localhost:4187/'); await page.waitForFunction(() => window.__game, null, { timeout: 90000 }); };
await load();
const log = [];
// first visit: PLAY -> training, skip it; rename the bug
await page.click('.btn.play', { force: true });
await page.waitForFunction(() => window.__game.mode === 'training', null, { timeout: 20000 });
const name1 = await page.evaluate(() => { const g = window.__game; g.training.skip(); const own = g.collection.bugs[0]; own.name = 'Cloudy McSave'; g.saveCollection(); return own.name; });
await page.waitForTimeout(2500);
log.push(`cloud doc after first visit: ${[...cloud.keys()].join(',')} fields=${Object.keys(cloud.get('data/users/u_test/save') ?? {}).join(',')}`);
// wipe the browser's storage entirely and come back
await page.evaluate(() => localStorage.clear());
await load();
await page.waitForTimeout(500);
log.push('second visit: ' + (await page.evaluate(() => `trained=${window.__game.trained} bug=${window.__game.collection.bugs[0].name} rr.trained=${localStorage.getItem('rr.trained')}`)));
await page.click('.btn.play', { force: true });
await page.waitForTimeout(600);
log.push('PLAY now -> ' + (await page.evaluate(() => window.__game.mode)));
// storage that throws entirely: the game still boots and plays (saves live in memory + cloud)
await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
await load();
log.push('storage blocked: ' + (await page.evaluate(() => `mode=${window.__game.mode} trained=${window.__game.trained} bug=${window.__game.collection.bugs[0].name}`)));
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
