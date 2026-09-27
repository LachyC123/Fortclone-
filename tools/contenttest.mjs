// Content pass: new weapons (Zapcoil chain, Boomkin splash, Gloop slow), Bug Jammer, Snap Trap,
// Pewpew turret bug, Tanglet web, and perks. Runs in the playground, deterministic steps.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4179/');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
const shots = process.argv.includes('--shots');
const out = await page.evaluate((shots) => {
  const g = window.__game; g.play();
  const s = g.input.s; s.touchActive = true;
  const step = (sec) => g.debugStep(Math.max(1, Math.round(sec * 60)));
  const V = g.player.motor.pos.constructor;
  const p = g.player; const log = [];
  const bots = g.actors.slice(1);
  for (const b of bots) { b.controller = null; b.parked = true; b.alive = false; b.rig.root.visible = false; b.bug.root.visible = false; b.motor.teleport(new V(0, -500, 0)); }
  const A = bots[0], B = bots[1];
  const wake = (b, x, z) => { b.parked = false; b.alive = true; b.hp = 100; b.slowT = 0; b.rig.root.visible = true; b.bug.root.visible = true; b.motor.teleport(new V(x, 0.05, z)); b.motor.vel.set(0, 0, 0); };
  const aim = (tgt) => {
    const cam = g.camRig.cam.position; const d = tgt.clone().sub(cam).normalize();
    g.camRig.yaw = Math.atan2(-d.x, -d.z); g.camRig.pitch = Math.asin(d.y);
  };
  p.motor.teleport(new V(-2, 0.05, 10)); g.camRig.yaw = 0; step(0.3);

  // ---- Zapcoil: shoot A, the zap should arc to B standing next to it
  p.weapons = [null, null, null]; p.giveWeapon('zapcoil', 2, 0, true); p.ammo = { light: 200, medium: 200, heavy: 60, shells: 60, bolts: 40 };
  wake(A, -2, -2); wake(B, 1.5, -3.5); step(0.1);
  for (let i = 0; i < 40; i++) { aim(A.motor.pos.clone().setY(A.motor.pos.y + 0.95)); s.fire = true; step(1 / 60); }
  s.fire = false; step(0.2);
  log.push(`zapcoil: A hp=${A.hp} B hp=${B.hp} (B only hurt by the chain)`);

  // ---- Boomkin: splash damage on a bot we aim at
  wake(A, -2, -2); B.parked = true; B.alive = false; B.motor.teleport(new V(0, -500, 0));
  p.weapons = [null, null, null]; p.giveWeapon('boomkin', 2, 0, true); step(0.2);
  aim(A.motor.pos.clone().setY(A.motor.pos.y + 0.5)); s.fire = true; step(1 / 60); s.fire = false;
  const bolts = g.throwables.bolts.length;
  step(1.2);
  log.push(`boomkin: pumpkin in flight=${bolts} A hp=${A.hp} alive=${A.alive}`);

  // ---- Gloop Gun: hit + slow
  wake(A, -2, -2);
  p.weapons = [null, null, null]; p.giveWeapon('gloopgun', 1, 0, true); step(0.2);
  aim(A.motor.pos.clone().setY(A.motor.pos.y + 0.95)); s.fire = true; step(1 / 60); s.fire = false; step(0.4);
  log.push(`gloop: A hp=${A.hp} slowT=${A.slowT.toFixed(2)} slowK=${A.slowK}`);

  // ---- Bug Jammer: the player drops one, an enemy bug flying into it gets zapped
  wake(A, 6, 2);
  p.util = null; p.addItem('util', 'jammer', 1); g.camRig.yaw = 0; g.camRig.pitch = -0.3;
  s.utilHeld = true; step(0.2); s.utilHeld = false; s.utilReleased = true; step(1.2);
  const j = g.throwables.jammers[0];
  log.push(`jammer placed=${!!j} at ${j ? j.pos.toArray().map((v) => v.toFixed(1)) : '-'}`);
  if (j) {
    A.bug.cooldown = 0; A.bug.state = 'docked';
    const from = A.motor.pos.clone().setY(A.motor.pos.y + 1.2);
    const vel = j.pos.clone().sub(from).setY(0).normalize().multiplyScalar(9).setY(3);
    A.bug.throw(from, vel);
    let jammedAt = -1;
    for (let i = 0; i < 90; i++) { step(1 / 60); A.bug.update(1 / 60); if (A.bug.state === 'returning' && jammedAt < 0) jammedAt = i; }
    log.push(`jammer: enemy bug state=${A.bug.state} cooldown=${A.bug.cooldown.toFixed(1)} zappedAfter=${jammedAt}f`);
    // an enemy can shoot it down
    const hp0 = j.hp;
    g.throwables.shootProps(A.motor.pos.clone().setY(1), j.pos.clone().setY(j.pos.y + 0.15).sub(A.motor.pos.clone().setY(1)).normalize(), 50, g, A, 50);
    log.push(`jammer shot by enemy: hp ${hp0} -> ${j.hp}, still up=${g.throwables.jammers.includes(j)}`);
  }
  if (shots) window.__shot = 'jammer';

  // ---- Snap Trap
  p.util = null; p.addItem('util', 'snaptrap', 1); p.motor.teleport(new V(-2, 0.05, 10)); g.camRig.yaw = 0; g.camRig.pitch = -0.4; step(0.2);
  s.utilHeld = true; step(0.2); s.utilHeld = false; s.utilReleased = true; step(1.5);
  const tr = g.throwables.traps[0];
  log.push(`trap placed=${!!tr}`);
  if (tr) {
    wake(A, tr.pos.x + 3, tr.pos.z); step(1.0);
    A.motor.teleport(tr.pos.clone().setY(tr.pos.y + 0.05)); step(0.2);
    log.push(`trap: A hp=${A.hp} slowT=${A.slowT.toFixed(2)} pinged=${A.pingT > 0} snapped=${tr.snapT >= 0}`);
  }

  // ---- Pewpew turret bug: land it near an enemy, it pews them
  p.setSpecies(g.speciesById ? g.speciesById('pewpew') : null, 'Sgt Pew');
  log.push(`species=${p.bug.species.id}`);
  wake(A, 4, -4);
  p.motor.teleport(new V(-2, 0.05, 6)); step(0.2);
  p.bug.cooldown = 0; p.bug.state = 'docked';
  p.bug.throw(p.motor.pos.clone().setY(1.2), new V(1.5, 3, -4));
  step(1.2);
  // stand the enemy somewhere the turret can see
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [3, 3], [-3, 3], [0, -4]]) {
    const t = p.bug.pos.clone().add(new V(dx, 0, dz)).setY(0.05);
    if (g.cw.lineClear(p.bug.pos.clone().setY(p.bug.pos.y + 0.45), t.clone().setY(1.05), 2)) { A.motor.teleport(t); break; }
  }
  const hpT = A.hp;
  step(3);
  log.push(`pewpew: bug state=${p.bug.state} at ${p.bug.pos.toArray().map((v) => v.toFixed(1))} A at ${A.motor.pos.toArray().map((v) => v.toFixed(1))} alive=${A.alive} parked=${A.parked} flight=${A.flight} team ${A.team}/${p.team} faceYaw=${p.bug.faceYaw} A hp ${hpT} -> ${A.hp}`);
  { const f = p.bug.pos.clone().setY(p.bug.pos.y + 0.12); const t = A.motor.pos.clone().setY(A.motor.pos.y + 1);
    const hit = g.cw.raycast(f, t.clone().sub(f).normalize(), f.distanceTo(t), 2, { t: 0, point: new V(), normal: new V(), collider: null }); log.push(`pewpew blocker=${hit ? hit.point.toArray().map((v) => v.toFixed(1)) + " " + hit.collider.surface : "none"} LOS=${g.cw.lineClear(f, t, 2)} smoke=${g.throwables.smokeBlocks(f, t)} lastState=${p.lastBugState} turretT=${p.turretT}`); }
  step(3);

  // ---- Tanglet web
  p.setSpecies(g.speciesById('tanglet'), 'Knitty');
  p.bug.cooldown = 0; p.bug.state = 'docked';
  wake(A, 0, 1);
  p.bug.throw(p.motor.pos.clone().setY(1.2), new V(0.7, 2, -2.5));
  step(1.5);
  const web = g.throwables.webs[0];
  log.push(`web spun=${!!web}${web ? ' at ' + web.pos.toArray().map((v) => v.toFixed(1)) : ''}`);
  if (web) {
    A.motor.teleport(web.pos.clone().setY(web.pos.y + 0.15)); step(0.2);
    log.push(`web: A slowT=${A.slowT.toFixed(2)} slowK=${A.slowK}`);
  }

  // ---- perks
  p.perks = []; p.applyPerks();
  const pk1 = g.loot.spawn('perk', 'springy', 2, 1, p.motor.pos.clone());
  g.loot.collect(p, pk1, g);
  const pk2 = g.loot.spawn('perk', 'quickhands', 2, 1, p.motor.pos.clone());
  g.loot.collect(p, pk2, g);
  log.push(`perks: ${p.perks.join(',')} jumpMul=${p.motor.jumpMul}`);
  const auto3 = g.loot.autoFor(p, g.loot.spawn('perk', 'thickwool', 3, 1, new V(40, 0.1, 40)));
  const n0 = g.loot.pickups.filter((q) => q.kind === 'perk').length;
  const pk3 = g.loot.spawn('perk', 'thickwool', 3, 1, p.motor.pos.clone());
  g.loot.collect(p, pk3, g); step(0.1);
  log.push(`third perk auto=${auto3} -> perks=${p.perks.join(',')} jumpMul=${p.motor.jumpMul} dropped=${g.loot.pickups.filter((q) => q.kind === 'perk').length - n0 + 1}`);
  // thick wool
  wake(A, 4, 0); p.hp = 100;
  p.takeDamage(50, A, false, new V(0, 0, 1), g, 'TEST');
  log.push(`thick wool: 50 dmg -> hp ${p.hp}`);
  // reload speed with Speedy Fingers
  p.weapons = [null, null, null]; p.giveWeapon('tincan', 0, 0, true); p.weapon.mag = 0; p.ammo.medium = 100;
  s.reloadPressed = true; let rt = 0;
  for (let i = 0; i < 200; i++) { step(1 / 60); rt++; if (!p.weapon.reloading && i > 2) break; }
  log.push(`reload with Speedy Fingers: ${(rt / 60).toFixed(2)}s (base ${p.weapon.def.reload}s)`);
  const hud = document.querySelector('.healthbox .perks');
  log.push(`hud perk badges: ${hud ? hud.children.length : 'none'}`);
  // all new loot models build
  for (const [k, id] of [['weapon', 'zapcoil'], ['weapon', 'boomkin'], ['weapon', 'gloopgun'], ['util', 'jammer'], ['util', 'snaptrap'], ['perk', 'vampteeth']]) g.loot.spawn(k, id, 2, 1, new V(10, 0.1, 10));
  // LAN mirroring round trip: netState -> netApply builds meshes
  const st = g.throwables.netState();
  log.push(`netState props: ${st.length} kinds=${[...new Set(st.map((x) => x[1]))].join(',')}`);
  if (shots) {
    // a showcase: gadgets in front of the player, new loot on the floor
    for (const b of bots) { b.parked = true; b.alive = false; b.rig.root.visible = false; b.bug.root.visible = false; b.motor.teleport(new V(0, -500, 0)); }
    g.throwables.clear();
    for (const pk of [...g.loot.pickups]) g.loot.remove(pk);
    p.motor.teleport(new V(-2, 0.05, 10)); p.weapons = [null, null, null]; p.giveWeapon('boomkin', 3, 0, true);
    g.throwables.placeJammer(new V(-3, p.motor.pos.y, 2), A, g);
    g.throwables.placeTrap(new V(-1, 0.02, 5.5), p, g);
    g.throwables.addWeb(new V(1.5, p.motor.pos.y + 0.14, 5), p, 30);
    const ids = [['weapon', 'zapcoil', 3], ['weapon', 'boomkin', 4], ['weapon', 'gloopgun', 2], ['util', 'jammer', 3], ['util', 'snaptrap', 1], ['perk', 'springy', 2], ['perk', 'vampteeth', 3], ['perk', 'bugsnacks', 3]];
    ids.forEach(([k, id, r], i) => g.loot.spawn(k, id, r, 1, new V(-4.5 + i * 1.3, 0.05, 6.5 - (i % 2) * 1.2)));
    p.perks = []; p.addPerk('quietpaws'); p.addPerk('thickwool');
    p.setSpecies(g.speciesById('pewpew'), 'Sgt Pew');
    g.camRig.yaw = 0; g.camRig.pitch = -0.28;
    step(1.5);
  }
  return log;
}, shots);
console.log(out.join('\n'));
if (shots) await page.screenshot({ path: 'tools/out/content.png' });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
