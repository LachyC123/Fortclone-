// Bug Collection: home -> MY BUGS -> hatch -> equip, plus each species' trick in the playground.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4175;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const mobile = process.argv.includes('--mobile');
const sfx = mobile ? '-m' : '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.addInitScript(() => localStorage.clear());
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/b-home${sfx}.png` });
await page.click('.bugsbtn', { force: true });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/b-bugs${sfx}.png` });
// the cocoon button takes you to the Burrow's first incubator: pop it in, rush it, hatch it
await page.click('.cocoons.has', { force: true });
await page.waitForSelector('.burrowui:not(.hidden) .bpanel [data-act=incubate]');
await page.click('.bpanel [data-act=incubate]', { force: true });
await page.waitForTimeout(300);
await page.click('.bpanel [data-act=rush]', { force: true });
await page.waitForSelector('.bpanel [data-act=hatch]', { timeout: 10000 });
await page.click('.bpanel [data-act=hatch]', { force: true });
await page.waitForSelector('.hatch .cocoon');
for (let i = 0; i < 3; i++) { await page.click('.hatch .cocoon', { force: true }); await page.waitForTimeout(250); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/b-hatch${sfx}.png` });
const eq = await page.$('.hatch .eq');
await (eq ?? (await page.$('.hatch .ok'))).click({ force: true });
await page.waitForTimeout(500);
await page.click('.btop .back', { force: true });
await page.waitForTimeout(300);
await page.click('.bugsbtn', { force: true });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/b-bugs2${sfx}.png` });
const log = [];
if (!mobile) {
  // abilities, in the playground
  await page.click('.bugsmenu .close', { force: true });
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.startPlayground();
    const s = g.input.s;
    s.touchActive = true;
    const step = (sec) => g.debugStep(Math.round(sec * 60));
    const V = g.player.motor.pos.constructor;
    const p = g.player;
    const log = [];
    const bots = g.actors.slice(1);
    for (const b of bots) { b.controller = null; b.parked = true; }
    const own = (id) => { if (!g.collection.bugs.some((b) => b.species === id)) g.collection.bugs.push({ species: id, name: 'Test ' + id, copies: 1 }); g.equipBug(id); };
    const reset = () => { p.spawn(new V(0, 0.05, 20), Math.PI); p.bug.cooldown = 0; g.camRig.yaw = Math.PI; g.camRig.pitch = -0.1; step(0.3); };
    const throwBlink = (pitch = -0.1, wait = 0.8) => { g.camRig.pitch = pitch; s.throwHeld = true; step(0.2); s.throwHeld = false; s.throwReleased = true; step(wait); s.blinkPressed = true; step(0.05); };
    // Zippit baseline
    own('zippit'); reset(); const z0 = p.motor.pos.clone(); throwBlink(); log.push(`zippit blink dist=${p.motor.pos.distanceTo(z0).toFixed(1)} blinks=${p.blinks}`);
    // Hopper: goes up
    own('hopper'); reset(); throwBlink(); step(0.15); log.push(`hopper vy after blink=${p.motor.vel.y.toFixed(1)} y=${p.motor.pos.y.toFixed(2)}`);
    // Mender: heals
    own('mender'); reset(); p.hp = 50; throwBlink(); log.push(`mender hp 50 -> ${p.hp}`);
    // Boomble: knock a bot
    own('boomble'); reset(); const b = bots[0]; b.spawn(new V(0, 0.05, 20), 0); b.parked = false; b.controller = null;
    b.motor.teleport(new V(0.8, 0.05, 32.5)); throwBlink(-0.05, 0.9); const bd = b.motor.pos.clone(); step(0.3);
    log.push(`boomble: bot hp=${b.hp} moved=${b.motor.pos.distanceTo(bd).toFixed(2)} me->bot=${p.motor.pos.distanceTo(b.motor.pos).toFixed(1)}`);
    // Snatchet: swap with bot near the bug
    own('snatchet'); reset(); b.spawn(new V(0.8, 0.05, 32.5), 0); b.controller = null; step(0.1); const myFrom = p.motor.pos.clone();
    throwBlink(-0.05, 0.9); log.push(`snatchet: me at ${p.motor.pos.toArray().map((v) => v.toFixed(1))} bot at ${b.motor.pos.toArray().map((v) => v.toFixed(1))} (was me ${myFrom.toArray().map((v) => v.toFixed(1))})`);
    // Wisp
    own('wisp'); reset(); throwBlink(); log.push(`wisp stealthT=${p.stealthT.toFixed(2)}`);
    // Stickle: throw at a wall
    own('stickle'); reset(); g.camRig.yaw = Math.PI / 2; throwBlink(0.15, 1.0); log.push(`stickle: bug state=${p.bug.state} stuck=${p.bug.stuckN ? p.bug.stuckN.toArray().map((v) => v.toFixed(2)) : 'none'} pos=${p.motor.pos.toArray().map((v) => v.toFixed(1))}`);
    // Glimmerwing range
    own('glimmerwing'); reset(); const g0 = p.motor.pos.clone(); throwBlink(0.1, 1.4); log.push(`glimmerwing blink dist=${p.motor.pos.distanceTo(g0).toFixed(1)}`);
    // Nimbus ping
    own('nimbus'); reset(); b.spawn(new V(4, 0.05, 36), 0); b.controller = null; g.camRig.pitch = -0.1; s.throwHeld = true; step(0.2); s.throwHeld = false; s.throwReleased = true; step(1.5);
    log.push(`nimbus: bug=${p.bug.state} bot pingT=${b.pingT.toFixed(2)} pingedByMe=${b.pingedBy === p}`);
    return log;
  });
  log.push(...r);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/b-play${sfx}.png` });
}
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
