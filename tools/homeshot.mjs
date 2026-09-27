import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const server = spawn('npx', ['vite', 'preview', '--port', '4192', '--strictPort'], { stdio: 'pipe', cwd: '/home/user/Fortclone-' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, vp] of [['m', { width: 844, height: 390 }], ['p', { width: 390, height: 844 }], ['s', { width: 667, height: 375 }]]) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { localStorage.setItem('rr.settings', JSON.stringify({ quality: 'low', autoQuality: false })); localStorage.setItem('rr.trained', '1'); });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4192/');
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  await page.screenshot({ path: `/home/user/Fortclone-/tools/out/home-${name}.png` });
  await ctx.close();
}
await browser.close();
server.kill();
