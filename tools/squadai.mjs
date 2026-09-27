// Squad bot smarts: a bot teammate throws you a gun / ammo / a heal when you need one, calls out
// enemies (marked on your map), and picks you up when you're knocked — smoking the shooter if needed.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4198;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const g = window.__game;
  const log = [];
  const V = g.player.motor.pos.constructor;
  const step = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30); };
  g.startMatch(2);
  g.freeze = true;
  const m = g.match;
  const p = g.player;
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  step(1.5);
  g.input.s.jumpPressed = true;
  step(0.1);
  step(20);
  const mate = g.actors.find((a) => a !== p && a.team === p.team);
  // everyone else steps aside
  const others = g.actors.filter((a) => a.team !== p.team);
  const L = g.world.lobby.center;
  // (one enemy stays in the match, frozen far away, so the match doesn't end)
  for (const a of others.slice(1)) { a.parked = true; a.alive = false; a.rig.root.visible = false; a.motor.teleport(new V(L.x, L.y + 1, L.z)); }
  { const e0 = others[0]; if (!e0.alive) { e0.bugout = null; e0.out = false; e0.spawn(new V(L.x, L.y + 1, L.z), 0); } e0.parked = false; e0.flight = 'none'; e0.brain0 = e0.controller; e0.controller = null; e0.motor.teleport(new V(L.x, L.y + 1, L.z)); }
  // an open patch of ground
  const spot = g.nav.randomWalkable(Math.random, m.safeCenter.x, m.safeCenter.y, 6) ?? p.motor.pos.clone();
  const put = (a, dx, dz) => { a.motor.teleport(new V(spot.x + dx, spot.y + 0.1, spot.z + dz)); a.motor.vel.set(0, 0, 0); };
  log.push(`mate before: alive=${mate.alive} out=${mate.out} downed=${mate.downed} flight=${mate.flight} player alive=${p.alive} flight=${p.flight}`);
  for (const a of [p, mate]) if (!a.alive || a.out || a.bugout) { a.bugout = null; a.out = false; a.spawn(spot.clone(), 0); }
  mate.parked = false; mate.flight = 'none'; p.flight = 'none';
  put(p, 0, 0); put(mate, 5, 0);
  const pickupsFor = (who) => g.loot.pickups.filter((q) => q.giftFor === who);
  // --- 1) you have no gun: mate throws you its spare
  p.weapons = [null, null, null]; p.equip(0, true);
  mate.weapons = [null, null, null]; mate.giveWeapon('tincan', 2, 0, true); mate.giveWeapon('rattle', 1, 1, true); mate.ammo.medium = 90; mate.ammo.light = 90; mate.equip(0, true);
  let t = 0;
  while (!pickupsFor(p).some((q) => q.kind === 'weapon') && t < 8) { step(0.25); t += 0.25; }
  const gun = pickupsFor(p).find((q) => q.kind === 'weapon');
  step(1.5);
  log.push(`gun gift: ${gun ? `${gun.defId} after ${t.toFixed(1)}s, landed ${gun.pos.distanceTo(p.motor.pos).toFixed(1)}m from you, mate kept ${mate.weapons.filter(Boolean).map((w) => w.def.id)}` : 'NONE'} ammo gift=${pickupsFor(p).some((q) => q.kind === 'ammo')}`);
  // pick it up and the mate doesn't take it back
  if (gun) g.loot.collect(p, gun, g);
  step(0.5);
  for (const q of pickupsFor(p)) if (q.kind === 'ammo') g.loot.collect(p, q, g);
  log.push(`mate: state=${mate.controller.state} alive=${mate.alive} tv=${mate.controller.targetVisible}`);
  log.push(`you now carry: ${p.weapons.filter(Boolean).map((w) => w.def.id)} ammo light=${p.ammo.light}`);
  // --- 2) low on ammo for your gun
  p.weapons = [null, null, null]; p.giveWeapon('tincan', 1, 0, true); p.weapon.mag = 4; p.ammo.medium = 0; mate.ammo.medium = 120;
  put(mate, 22, 6); // a way off: it has to walk over
  t = 0;
  while (!pickupsFor(p).some((q) => q.kind === 'ammo' && q.defId === 'medium') && t < 15) { step(0.25); t += 0.25; }
  const am = pickupsFor(p).find((q) => q.kind === 'ammo' && q.defId === 'medium');
  log.push(`ammo gift: ${am ? `${am.amount} after ${t.toFixed(1)}s (mate left with ${mate.ammo.medium})` : 'NONE'}`);
  // --- 3) hurt, no heals
  p.hp = 40; p.healItem = null; mate.healItem = { id: 'fizzle', count: 3 };
  t = 0;
  while (!pickupsFor(p).some((q) => q.kind === 'heal') && t < 8) { step(0.25); t += 0.25; }
  log.push(`heal gift: ${pickupsFor(p).some((q) => q.kind === 'heal') ? `after ${t.toFixed(1)}s, mate has ${mate.healItem?.count ?? 0} left` : 'NONE'}`);
  const toasts = [...document.querySelectorAll('.toasts > *')].map((e) => e.textContent).slice(-4);
  log.push(`your toasts: ${toasts.join(' | ')}`);
  // --- 4) an enemy walks into view: callout + map marker
  const e = others[0];
  e.parked = false; e.alive = true; e.hp = 100; e.rig.root.visible = true; e.weapons = [null, null, null]; e.giveWeapon('tincan', 0, 0, true); e.ammo.medium = 200;
  const ebrain = e.brain0; e.controller = null; e.intent.moveX = e.intent.moveZ = 0;
  { const y = mate.intent.aimYaw; const at = g.nav.randomWalkable(Math.random, mate.motor.pos.x - Math.sin(y) * 16, mate.motor.pos.z - Math.cos(y) * 16, 2); e.motor.teleport(at ? at.setY(at.y + 0.1) : new V(mate.motor.pos.x - Math.sin(y) * 16, mate.motor.pos.y + 0.1, mate.motor.pos.z - Math.cos(y) * 16)); } e.pingT = 0; e.pingedBy = null;
  t = 0;
  while (!(e.pingT > 0 && e.pingedBy === mate) && t < 6) { step(0.25); t += 0.25; }
  { const br = mate.controller; const eye = mate.eyePos(new V()); const tp = e.motor.pos.clone().setY(e.motor.pos.y + 1.2); log.push(`callout debug: d=${eye.distanceTo(tp).toFixed(1)} los=${g.sightClear(eye, tp)} aw=${br.awareness.get(e.id)} spotted=${br.spotted.get(e.id)} state=${br.state} aimYaw=${mate.intent.aimYaw.toFixed(2)} yawTo=${Math.atan2(-(tp.x - eye.x), -(tp.z - eye.z)).toFixed(2)} team e=${e.team} p=${p.team} e.alive=${e.alive}`); }
  log.push(`callout: marked=${e.pingT > 0 && e.pingedBy?.team === p.team} after ${t.toFixed(1)}s, toast="${[...document.querySelectorAll('.toasts > *')].map((x) => x.textContent).find((x) => x.includes('enemy')) ?? '-'}"`);
  // --- 5) you're knocked in the open with that enemy shooting: mate fights / smokes, then picks you up
  e.controller = ebrain; ebrain.target = p;
  mate.util = { id: 'fizzbomb', count: 2 };
  p.weapons = [null, null, null];
  log.push(`before knock: phase=${m.phase} you alive=${p.alive} downed=${p.downed} hp=${p.hp} mate alive=${mate.alive} downed=${mate.downed} parked=${mate.parked}`);
  p.takeDamage(500, e, false, new V(1, 0, 0), g, 'TEST');
  log.push(`after knock: alive=${p.alive} downed=${p.downed}`);
  const fz0 = g.throwables.smokes.length;
  t = 0;
  let smoked = false, fought = 0;
  while (p.downed && t < 30) { step(0.25); t += 0.25; if (g.throwables.smokes.length > fz0 || g.throwables.thrown.some((x) => x.def.id === 'fizzbomb')) smoked = true; if (mate.controller.state === 'engage') fought++; }
  log.push(`revive under fire: ${!p.downed && p.alive ? 'UP' : p.alive ? 'still down' : 'eliminated'} after ${t.toFixed(1)}s, mate smoked=${smoked} fought=${(fought / 4).toFixed(1)}s enemy hp=${Math.round(e.hp)} alive=${e.alive}`);
  return log;
});
console.log(out.join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
