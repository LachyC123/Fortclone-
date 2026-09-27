// The Burrow: home button, the 3D island, building panels (pump, incubators, gym, museum,
// bazaar, decor, hats) and the Rift Relic loop in a real match (grab -> nest -> summary -> museum).
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const mobile = process.argv.includes('--mobile');
const portrait = process.argv.includes('--portrait');
fs.mkdirSync('tools/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vp = portrait ? { width: 390, height: 844 } : mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 };
const ctx = await browser.newContext(mobile || portrait ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
await ctx.addInitScript(() => {
  if (localStorage.getItem('rr.seeded')) return;
  localStorage.setItem('rr.seeded', '1');
  localStorage.setItem('rr.settings', JSON.stringify({ quality: 'low', autoQuality: false }));
  localStorage.setItem('rr.trained', '1');
  localStorage.setItem('rr.bugs', JSON.stringify({
    bugs: [
      { species: 'zippit', name: 'Sir Zipkins', copies: 4, level: 1, spare: 3 },
      { species: 'hopper', name: 'Boingo', copies: 2, level: 1, spare: 1 },
      { species: 'boomble', name: 'Kaboomsworth', copies: 1, level: 1, spare: 0 },
    ],
    equipped: 'zippit', cocoons: [{ rarity: 0 }, { rarity: 1 }, { rarity: 2 }], seen: ['zippit', 'hopper', 'boomble'],
  }));
  localStorage.setItem('rr.burrow', JSON.stringify({ glimmer: 6000, pump: { stock: 150, t: Date.now() }, relics: { spork: 1, jamjar: 1, napkin: 1, teapot: 1, doubloon: 1 }, sets: ['picnic'] }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:4191/');
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
const sfx = portrait ? '-p' : mobile ? '-m' : '';
const log = [];
const settle = async (ms = 600) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* looping */ } }));
};
const shot = async (name) => page.screenshot({ path: `tools/out/burrow-${name}${sfx}.png` });
const G = () => page.evaluate(() => Math.floor(window.__game.burrow.glimmer));
const select = async (id) => {
  await page.evaluate((id) => { const sc = window.__game.menus.burrow.scene; sc.select(id); sc.settleCamera(); }, id);
  await settle(500);
};
const act = async (sel) => {
  const el = await page.$(`.bpanel ${sel}`);
  if (!el) throw new Error('no button ' + sel + ' in ' + (await page.textContent('.bpanel')));
  await el.click({ force: true });
  await page.waitForTimeout(250);
};

await settle(800);
log.push('home: ' + (await page.textContent('.burrowbtn')).replace(/\s+/g, ' '));
await shot('home');
await page.click('.burrowbtn', { force: true });
await page.waitForSelector('.burrowui:not(.hidden)');
await settle(1500);
await shot('island');
log.push('chips: ' + (await page.$$eval('.bchip', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '))));

// pump
await select('pump');
const g0 = await G();
await act('[data-act=collect]');
log.push(`pump collect: ${g0} -> ${await G()}`);
await shot('pump');

// hall upgrades up to 4 so everything unlocks
await select('hall');
for (let i = 0; i < 3; i++) await act('.upbtn');
log.push(`hall LV ${await page.evaluate(() => window.__game.burrow.lv.hall)} glimmer ${await G()}`);
await settle(700);
await shot('hall');
// buy two decor + wear the party hat
await act('[data-act=decor][data-arg=flowers]');
await act('[data-act=decor][data-arg=lanterns]');
await act('[data-act=hat][data-arg=party]');
await page.evaluate(() => { const sc = window.__game.menus.burrow.scene; sc.select(null); sc['focusGoal'].set(1.3, 1.2, -2.2); sc['distGoal'] = 7; sc['yawGoal'] = 0.3; sc.settleCamera(); sc['poofs'].forEach((q) => sc.scene.remove(q.m)); sc['poofs'].length = 0; });
await settle(900);
await shot('hat');
await select('hall');
log.push(`decor ${await page.evaluate(() => JSON.stringify(window.__game.burrow.decor))} hat=${await page.evaluate(() => window.__game.burrow.hat + '/' + window.__game.player.rig.look.hat)}`);

// build the rest
for (const id of ['gym', 'inc2', 'museum', 'bazaar', 'inc3']) {
  await select(id);
  await act('.buildbtn');
}
log.push('levels ' + (await page.evaluate(() => JSON.stringify(window.__game.burrow.lv))) + ` glimmer ${await G()}`);

// incubator: pick a cocoon, rush it, hatch it
await select('inc1');
await shot('inc-empty');
const coc0 = await page.evaluate(() => window.__game.collection.cocoons.length);
await act('[data-act=incubate]');
await settle(400);
log.push(`incubating: ${await page.evaluate(() => JSON.stringify(window.__game.burrow.inc[0]))} cocoons ${coc0} -> ${await page.evaluate(() => window.__game.collection.cocoons.length)} label="${(await page.textContent('.bpanel .inctime'))}"`);
await shot('inc-busy');
await act('[data-act=rush]');
await settle(700);
await act('[data-act=hatch]');
await page.waitForSelector('.burrowui .hatch .cocoon');
const bugs0 = await page.evaluate(() => window.__game.collection.bugs.reduce((s, b) => s + b.copies, 0));
for (let i = 0; i < 3; i++) { await page.click('.burrowui .hatch .cocoon', { force: true }); await page.waitForTimeout(150); }
await settle(900);
await shot('hatch');
log.push(`hatched: ${(await page.textContent('.burrowui .hatch .sn')).trim()} copies ${bugs0} -> ${await page.evaluate(() => window.__game.collection.bugs.reduce((s, b) => s + b.copies, 0))}`);
await page.click('.burrowui .hatch .ok', { force: true });
await settle(300);
// fill inc2 too so the island shows a cocoon
await select('inc2');
await act('[data-act=incubate]');

// gym: train Sir Zipkins
await select('gym');
await act('[data-act=train][data-arg=zippit]');
log.push(`train: zippit LV ${await page.evaluate(() => window.__game.collection.bugs[0].level)} spare ${await page.evaluate(() => window.__game.collection.bugs[0].spare)} player bug stats cd=${await page.evaluate(() => window.__game.player.bug.stats.cooldown.toFixed(2))}`);
await shot('gym');

// bazaar: buy the first thing
await select('bazaar');
const c1 = await page.evaluate(() => window.__game.collection.cocoons.length);
await act('[data-act=buy]');
log.push(`bazaar buy: cocoons ${c1} -> ${await page.evaluate(() => window.__game.collection.cocoons.length)} offers=${await page.$$eval('.offer', (o) => o.length)}`);
await shot('bazaar');

// museum
await select('museum');
log.push('museum: ' + (await page.textContent('.bpanel .bonuses')).replace(/\s+/g, ' '));
await shot('museum');
await select(null);
await page.evaluate(() => window.__game.menus.burrow.scene['distGoal'] = 30);
await settle(1500);
await shot('island-built');

// back home
await page.click('.btop .back', { force: true });
await settle(400);
log.push('home again: ' + (await page.textContent('.burrowbtn')).replace(/\s+/g, ' '));

// ---- relics in a real match: grab one, send it home at a nest, see it on the summary
const res = await page.evaluate(() => {
  const g = window.__game; g.startMatch(1); g.freeze = true;
  const m = g.match;
  const step = (s) => { for (let i = 0; i < Math.round(s * 30); i++) g.debugStep(1, 1 / 30); };
  const relicsOnMap = g.loot.pickups.filter((p) => p.kind === 'relic').length;
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  g.input.s.jumpPressed = true; step(0.1);
  const p = g.player;
  for (let i = 0; i < 60 && p.flight !== 'none'; i++) step(0.5);
  step(0.5);
  const nest = g.world.nests[0];
  // put a relic right under the player's feet (they land in a random spot)
  const pos = p.motor.pos.clone();
  g.loot.spawn('relic', 'orb', 3, 1, pos.clone().setY(pos.y + 0.3));
  step(1);
  const carried = [...p.relics];
  // off to the nest
  p.motor.teleport(nest.pos.clone().setY(nest.pos.y + 0.2));
  step(2.5);
  const banked = [...m.banked];
  // someone else gets eliminated carrying one: it should spill out
  const bot = g.actors.find((a) => a !== p && a.alive);
  bot.relics.push('spork');
  bot.hp = 1; bot.takeDamage(999, p, false, p.motor.pos.clone().set(1, 0, 0), g, 'TEST');
  bot.bugout = null; bot.out = true; bot.alive = false;
  const spilled = g.loot.pickups.filter((q) => q.kind === 'relic' && q.defId === 'spork').length;
  for (const a of g.actors) if (a !== p && a.alive) { a.hp = 1; a.takeDamage(999, p, false, p.motor.pos.clone().set(1, 0, 0), g, 'TEST'); a.bugout = null; a.out = true; a.alive = false; }
  for (let i = 0; i < 40 && document.querySelector('.summary')?.classList.contains('hidden'); i++) step(0.5);
  return { flight: p.flight, alive: p.alive, left: g.actors.filter((a) => a.alive && a !== p).length, phase: m.phase, relicsOnMap, carried, banked, spilled, orb: g.burrow.relics.orb ?? 0, glimmer: Math.floor(g.burrow.glimmer), won: m.won, hat: p.rig.look.hat, incLeft: g.burrow.inc[1] ? Math.round((g.burrow.inc[1].end - Date.now()) / 1000) : -1 };
});
log.push(`relic match: ${JSON.stringify(res)}`);
await page.evaluate(() => { window.__game.freeze = false; document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 2000; }); });
await page.waitForTimeout(300);
log.push('summary: ' + ((await page.$eval('.summary .glimrow', (e) => e.textContent).catch(() => 'NO SUMMARY')) || '').replace(/\s+/g, ' ') + ' | ' + ((await page.$eval('.summary .relicwin', (e) => e.textContent).catch(() => '')) || '').replace(/\s+/g, ' '));
await page.screenshot({ path: `tools/out/burrow-summary${sfx}.png` });
await page.evaluate(() => document.querySelector('.summary .sumcard')?.scrollTo(0, 99999));
await page.waitForTimeout(100);
await page.screenshot({ path: `tools/out/burrow-summary2${sfx}.png` });

// a hat on the rascal (in the match)
console.log(log.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
