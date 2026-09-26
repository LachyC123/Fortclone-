// Milestone 6 visuals: KO tumble, birds scattering, casings & leaves, victory celebration.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4191;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const out = process.env.OUT || 'tools/out';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); };
const log = [];
// 1) KO tumble
log.push(await page.evaluate(() => {
  const g = window.__game;
  g.startPlayground();
  g.freeze = true;
  const V = g.player.motor.pos.constructor;
  const p = g.player;
  p.spawn(new V(0, 0.05, 22), Math.PI);
  const [b1, b2, b3] = g.actors.slice(1);
  for (const [b, x] of [[b1, -30], [b2, 0], [b3, 30]]) { b.controller = null; b.spawn(new V(x, 0.05, 28), 0); }
  g.debugStep(5, 1 / 30);
  b2.takeDamage(500, p, false, new V(0, 0, 1), g, 'TEST');
  g.debugStep(7, 1 / 30);
  g.debugCam = { pos: new V(3.5, 2.2, 24.5), target: new V(0, 1.5, 29) };
  return `ko: rig visible=${b2.rig.root.visible} y=${b2.rig.root.position.y.toFixed(2)} rotX=${b2.rig.root.rotation.x.toFixed(2)}`;
}));
await shot('q-ko');
log.push(await page.evaluate(() => { const g = window.__game; const b2 = g.actors[2]; g.debugStep(14, 1 / 30); return `after poof: visible=${b2.rig.root.visible}`; }));
await shot('q-ko-poof');
// 2) birds: find a flock, look at it, then fire a gun nearby
log.push(await page.evaluate(() => {
  const g = window.__game;
  const V = g.player.motor.pos.constructor;
  const f = g.birds.flocks.find((x) => x.state === 'ground');
  const h = f.home;
  window.__fl = f;
  g.player.spawn(new V(h.x + 40, h.y + 0.1, h.z), 0);
  g.debugStep(3, 1 / 30);
  g.debugCam = { pos: new V(h.x + 2.2, h.y + 1.1, h.z + 2.2), target: new V(h.x, h.y + 0.1, h.z) };
  // debugStep moves nothing for birds unless camera is near: birds use camera position, set it
  g.camera.position.copy(g.debugCam.pos);
  g.birds.update(0.05, g.time, g.camera.position, [], []);
  return `flocks=${g.birds.flocks.length} birds=${g.birds.flocks.reduce((s, x) => s + x.birds.length, 0)} home=${h.x.toFixed(0)},${h.z.toFixed(0)}`;
}));
await shot('q-birds');
log.push(await page.evaluate(() => {
  const g = window.__game;
  const f = window.__fl;
  const h = f.home;
  g.emitSound({ pos: h.clone().setX(h.x + 6), loudness: 70, source: null, kind: 'gunshot' });
  for (let i = 0; i < 12; i++) { g.camera.position.copy(g.debugCam.pos); g.birds.update(1 / 30, g.time + i / 30, g.camera.position, g.actors, g.sounds); g.fx.update(1 / 30, g.camera); }
  g.debugCam.pos.set(h.x + 5, h.y + 1.5, h.z + 5); g.debugCam.target.set(h.x, h.y + 1.5, h.z);
  return `flock state after gunshot: ${f.state}`;
}));
await shot('q-birds-scatter');
// 3) casings and leaves: player fires a tincan at a tree
log.push(await page.evaluate(() => {
  const g = window.__game;
  const V = g.player.motor.pos.constructor;
  const p = g.player;
  p.spawn(new V(0, 0.05, 24), Math.PI);
  p.weapons = [null, null, null]; p.giveWeapon('rattle', 2, 0, true); p.ammo.light = 200;
  p.controller = null;
  let fired = 0;
  for (let i = 0; i < 10; i++) {
    p.intent.aimDir.set(0.25, 0.15, 1).normalize();
    p.intent.aimOrigin.copy(p.eyePos(new V()));
    p.intent.aimYaw = Math.atan2(-p.intent.aimDir.x, -p.intent.aimDir.z);
    p.intent.fire = true;
    const m0 = p.weapon.mag; g.debugStep(1, 1 / 30); if (p.weapon.mag < m0) fired++;
  }
  p.intent.fire = false;
  g.debugCam = { pos: new V(-2.2, 1.9, 22.3), target: new V(0.3, 1.1, 24.5) };
  return `fired ${fired}`;
}));
await shot('q-casings');
// 4) victory celebration
log.push(await page.evaluate(() => {
  const g = window.__game;
  g.debugCam = null;
  g.startMatch();
  const m = g.match;
  let n = 0;
  while (m.phase !== 'live' && n++ < 20000) g.debugStep(1, 1 / 30);
  const p = g.player;
  for (let i = 0; i < 6 * 30 && p.flight !== 'none'; i++) g.debugStep(1, 1 / 30);
  const V = p.motor.pos.constructor;
  for (const a of g.actors) if (a !== p && a.alive) { a.reviveUsed = true; a.takeDamage(999, p, false, new V(1, 0, 0), g, 'TEST'); }
  for (let i = 0; i < 45; i++) g.debugStep(1, 1 / 30);
  return `victory: phase=${m.phase} cinematic=${g.camRig.cinematic} emote=${p.emote} remaining=${m.remaining} alive=${p.alive}`;
}));
await shot('q-victory');
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 20; i++) g.debugStep(1, 1 / 30); });
await shot('q-victory2');
console.log(log.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
