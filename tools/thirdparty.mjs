// Third-partying: two bots fight, the player shoots one from behind. Does it react sanely (no spinning)?
// Also: when a bot knocks the player out point-blank, does the Blinkbug get away?
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4189;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  const V = g.player.motor.pos.constructor;
  for (let trial = 0; trial < 4; trial++) {
    g.startPlayground(); g.pause();
    const me = g.player;
    me.parked = true; me.alive = false; me.motor.teleport(new V(0, -500, 0)); me.rig.root.visible = false;
    const [a, b, p] = g.actors.slice(1); // p = scripted third party (plays the role of you)
    // a on the left, b on the right, both armed; the player behind a
    a.spawn(new V(-6, 0.05, 20), 0); b.spawn(new V(6, 0.05, 20), 0);
    for (const x of [a, b]) { x.weapons = [null, null, null]; x.giveWeapon('tincan', 1, 0, true); x.ammo.medium = 300; x.hp = 100; x.controller.target = null; x.controller.state = 'wander'; x.controller.setSkill(0.5); }
    a.bodyYaw = a.intent.aimYaw = a.controller.aimYaw = -Math.PI / 2; b.bodyYaw = b.intent.aimYaw = b.controller.aimYaw = Math.PI / 2;
    p.spawn(new V(-18, 0.05, 20.5), -Math.PI / 2);
    p.weapons = [null, null, null]; p.giveWeapon('tincan', 1, 0, true); p.ammo.medium = 300;
    p.takeDamage = () => false; // god mode for the test
    p.controller = null; p.parked = false;
    // let them start fighting
    for (let i = 0; i < 60; i++) { a.hp = Math.max(a.hp, 80); b.hp = Math.max(b.hp, 80); g.debugStep(1, 1 / 30); }
    // the player opens fire on a's back
    a.controller.target = b; b.controller.target = a;
    let hitsFromP = 0, shots = 0; const td = a.takeDamage.bind(a); a.takeDamage = (...args) => { if (args.some((x) => x === p)) hitsFromP++; return td(...args); };
    let spin = 0, prevYaw = a.controller.aimYaw, faceT = -1, states = new Set(), targetFlips = 0, prevTarget = a.controller.target;
    for (let i = 0; i < 6 * 30; i++) {
      const eye = p.eyePos(new V());
      p.intent.aimDir.copy(a.motor.pos).setY(a.motor.pos.y + 1.0).sub(eye).normalize();
      p.intent.aimOrigin.copy(eye);
      p.intent.aimYaw = Math.atan2(-p.intent.aimDir.x, -p.intent.aimDir.z); p.intent.aimPitch = Math.asin(p.intent.aimDir.y);
      p.intent.fire = i % 6 < 3;
      a.hp = Math.max(a.hp, 30); b.hp = Math.max(b.hp, 30);
      const m0 = p.weapon ? p.weapon.mag : -1; g.debugStep(1, 1 / 30); if (p.weapon && p.weapon.mag < m0) shots++;
      const y = a.controller.aimYaw;
      let d = y - prevYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      spin += Math.abs(d); prevYaw = y;
      states.add(a.controller.state);
      if (a.controller.target !== prevTarget) { targetFlips++; prevTarget = a.controller.target; }
      const toP = Math.atan2(-(p.motor.pos.x - a.motor.pos.x), -(p.motor.pos.z - a.motor.pos.z));
      let fd = y - toP; while (fd > Math.PI) fd -= Math.PI * 2; while (fd < -Math.PI) fd += Math.PI * 2;
      if (faceT < 0 && Math.abs(fd) < 0.35) faceT = i / 30;
      if (trial === 0 && i % 15 === 0) out.push(`   t=${(i / 30).toFixed(1)} st=${a.controller.state} tgt=${a.controller.target === p ? 'P' : a.controller.target === b ? 'B' : '-'} vis=${a.controller.targetVisible} hp=${a.hp.toFixed(0)} thr=${[...a.controller.threat].map(([k, v]) => (k === p.id ? 'P' : 'B') + v.toFixed(1)).join(',')} tp=${(g.time - a.controller.thirdPartyT).toFixed(1)} flee=${a.controller.wantFlee} dmgBy=${a.lastDamagedBy === p ? 'P' : 'B'}`);
    }
    out.push(`trial ${trial}: turned ${(spin / (Math.PI * 2)).toFixed(2)} full turns in 6s, faced player after ${faceT < 0 ? 'never' : faceT.toFixed(2) + 's'}, target flips=${targetFlips}, states=${[...states].join('/')}, hitsP=${hitsFromP}/${shots} wpn=${p.weapon?.def.id} final target=${a.controller.target === p ? 'PLAYER' : a.controller.target === b ? 'bot' : 'none'}`);
    delete p.takeDamage; delete a.takeDamage;
    me.parked = false;
  }
  // --- bugout escape: a bot next to the player knocks them out, in a match context
  g.startMatch(); g.pause();
  const m = g.match;
  while (m.phase !== 'live') g.debugStep(1, 1 / 30);
  const p = g.player;
  const killer = g.actors.find((x) => x !== p && x.alive);
  for (const x of g.actors) if (x !== p && x !== killer) { x.parked = true; x.alive = false; x.motor.teleport(new V(0, -500, 0)); }
  p.spawn(new V(0, 0.05, 20), 0); killer.spawn(new V(0, 0.05, 26), Math.PI);
  killer.weapons = [null, null, null]; killer.giveWeapon('rattle', 2, 0, true); killer.ammo.light = 300;
  killer.controller.setSkill(1);
  p.controller = null;
  let t = 0;
  while (p.alive && t < 15) { killer.controller.target = p; killer.controller.targetVisible = true; killer.controller.state = 'engage'; g.debugStep(1, 1 / 30); t += 1 / 30; }
  const res = [];
  let bugT = 0;
  // bug flies away from the killer
  while (p.bugout && bugT < 10) {
    p.intent.moveX = 0; p.intent.moveZ = -1; p.intent.sprint = true;
    g.debugStep(1, 1 / 30); bugT += 1 / 30;
    if (Math.abs(bugT - 2.4) < 0.02) res.push(`at 2.4s bug hp=${p.bugout ? p.bugout.hp : 'gone'}`);
  }
  out.push(`bugout: player knocked out after ${t.toFixed(1)}s; ${res.join(' ')}; bug ${p.bugout ? 'still flying at 10s' : (p.out ? 'swatted/out' : 'revived')} after ${bugT.toFixed(1)}s`);
  return out;
});
console.log(r.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
