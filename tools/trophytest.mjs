// Trophy Road: home banner, the road screen (claim a reward), trophies from a real match summary.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const mobile = process.argv.includes('--mobile');
const server = spawn('npx', ['vite', 'preview', '--port', '4189', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('rr.settings', JSON.stringify({ quality: 'low', autoQuality: false }));
  localStorage.setItem('rr.trained', '1');
  if (!localStorage.getItem('rr.trophies')) localStorage.setItem('rr.trophies', JSON.stringify({ trophies: 318, best: 318, claimed: [0, 1], title: '' }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('http://localhost:4189/');
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const sfx = mobile ? '-m' : '';
const log = [];
await page.waitForTimeout(500);
log.push('home banner: ' + (await page.textContent('.trophybtn')).replace(/\s+/g, ' '));
await page.screenshot({ path: `tools/out/trophy-home${sfx}.png` });
await page.click('.trophybtn', { force: true });
await page.waitForSelector('.road:not(.hidden) .node');
await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* looping */ } }));
await page.waitForTimeout(1200);
await page.screenshot({ path: `tools/out/trophy-road${sfx}.png` });
const ready = await page.$$eval('.road .claim', (b) => b.length);
const coc0 = await page.evaluate(() => window.__game.collection.cocoons.length);
await page.click('.road .claim', { force: true });
await page.waitForTimeout(300);
log.push(`claimable=${ready} after claim: claimable=${await page.$$eval('.road .claim', (b) => b.length)} cocoons ${coc0} -> ${await page.evaluate(() => window.__game.collection.cocoons.length)} title=${await page.evaluate(() => window.__game.trophies.title)}`);
// claim everything reached
while (await page.$('.road .claim')) { await page.click('.road .claim', { force: true }); await page.waitForTimeout(100); }
log.push(`claimed: ${await page.evaluate(() => JSON.stringify(window.__game.trophies.claimed))} title=${await page.evaluate(() => window.__game.trophies.title)}`);
await page.click('.road .x', { force: true });
await page.waitForTimeout(200);
log.push('home profile: ' + (await page.textContent('.home .profile')).replace(/\s+/g, ' '));
// a real match: win it and see the trophies on the summary
const res = await page.evaluate(() => {
  const g = window.__game; g.startMatch(1); g.freeze = true;
  const m = g.match;
  const step = (s) => { for (let i = 0; i < Math.round(s * 30); i++) g.debugStep(1, 1 / 30); };
  const skill = m.botSkillBase();
  const before = g.trophies.trophies;
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  g.input.s.jumpPressed = true; step(0.1); step(15);
  // everyone else out: you win
  for (const a of g.actors) if (a !== g.player && a.alive) { a.hp = 1; a.takeDamage(999, g.player, false, g.player.motor.pos.clone().set(1, 0, 0), g, 'TEST'); a.bugout = null; a.out = true; a.alive = false; }
  for (let i = 0; i < 40 && document.querySelector('.summary')?.classList.contains('hidden'); i++) step(0.5);
  return { phase: m.phase, won: m.won, teamsLeft: m.teamsLeft(), before, after: g.trophies.trophies, skill: skill.toFixed(2), diff: m.difficultyLabel(), summary: !document.querySelector('.summary')?.classList.contains('hidden') };
});
log.push(`match: phase=${res.phase} won=${res.won} teamsLeft=${res.teamsLeft} skill=${res.skill} label=${res.diff} trophies ${res.before} -> ${res.after} summary=${res.summary}`);
await page.evaluate(() => { window.__game.freeze = false; document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 1500; }); });
await page.waitForTimeout(3000);
log.push('summary row: ' + (await page.textContent('.summary .trophyrow').catch(() => '-')).replace(/\s+/g, ' ') + ' | ' + (await page.textContent('.summary .newarena').catch(() => 'no new arena')));
await page.screenshot({ path: `tools/out/trophy-summary${sfx}.png` });
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
