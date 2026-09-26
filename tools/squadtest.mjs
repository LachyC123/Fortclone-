// Squads: team setup, teammates landing with you, knock + bot revive, spark carry + rebuild, team wipe.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4196;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
  g.startMatch(4);
  g.freeze = true;
  const m = g.match;
  const p = g.player;
  const mates = () => g.actors.filter((a) => a !== p && a.team === p.team);
  log.push(`teams: size=${m.teamSize} teamsLeft=${m.teamsLeft()} myTeam=${[p, ...mates()].map((a) => a.name).join(',')}`);
  // barge: jump when the window opens, steer nowhere
  let n = 0;
  while (m.phase !== 'barge' && n++ < 5000) step(0.1);
  while (!m.canDrop && n++ < 5000) step(0.1);
  step(1.5);
  g.input.s.jumpPressed = true;
  step(0.1);
  step(18);
  const d = mates().map((a) => a.motor.pos.distanceTo(p.motor.pos).toFixed(0));
  log.push(`landed: phase=${m.phase} player flight=${p.flight} mates' distance from you: ${d.join(', ')}m (flights ${mates().map((a) => a.flight).join(',')})`);
  // make it quiet: park all enemies far away so the test measures squad behaviour
  const L = g.world.lobby.center;
  for (const a of g.actors) if (a.team !== p.team && a.alive) { a.controller = null; a.intent.moveX = a.intent.moveZ = 0; a.intent.fire = false; a.motor.teleport(new V(L.x + (Math.random() - 0.5) * 10, L.y + 1, L.z + (Math.random() - 0.5) * 10)); }
  const enemy = g.actors.find((a) => a.team !== p.team);
  // --- knock the player: a teammate should come and pick you up
  const pos = p.motor.pos.clone();
  for (const a of mates()) a.motor.teleport(pos.clone().add(new V(12 + a.id % 3, 0.5, 3)));
  step(0.5);
  p.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST');
  log.push(`knocked: downed=${p.downed} alive=${p.alive} hp=${p.hp} downHp=${p.downHp}`);
  let t = 0;
  while (p.downed && t < 25) { step(0.25); t += 0.25; }
  log.push(`revived by bot: ${!p.downed && p.alive ? 'YES' : 'NO'} after ${t.toFixed(1)}s hp=${p.hp} revives=${mates().map((a) => a.revives).join(',')}`);
  // --- a teammate goes fully out (no bugout): spark drops, you carry it to a nest and rebuild them
  const mate = mates()[0];
  // keep the other bots out of it so YOU carry the spark
  for (const a of mates()) if (a !== mate) { a.parked = true; a.alive = false; a.motor.teleport(new V(0, -500, 0)); }
  mate.reviveUsed = true;
  mate.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST');
  log.push(`mate knocked: ${mate.downed}`);
  mate.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST');
  step(0.2);
  const sp = m.sparks.find((s) => s.owner === mate);
  log.push(`mate out=${mate.out} spark=${!!sp} bugout=${!!mate.bugout} matePos=${mate.motor.pos.toArray().map((v) => v.toFixed(1))} outPos=${mate.outPos.toArray().map((v) => v.toFixed(1))} phase=${m.phase}`);
  if (sp) {
    p.motor.teleport(sp.pos.clone().setY(sp.pos.y - 0.9));
    step(0.1);
    g.input.s.interactPressed = true;
    step(0.1);
    log.push(`spark at ${sp.pos.toArray().map((v) => v.toFixed(1))} player ${p.motor.pos.toArray().map((v) => v.toFixed(1))} ctx=${JSON.stringify(g.pc.contextSquad)}`);
    log.push(`picked up: carrier=${sp.carrier === p ? 'YOU' : sp.carrier?.name ?? '-'}`);
    const nest = g.world.nests.find((q) => !q.used);
    p.motor.teleport(nest.pos.clone().setY(nest.pos.y + 0.2).add(new V(1.5, 0, 0)));
    step(0.2);
    g.input.s.interactHeld = true;
    step(3.6);
    g.input.s.interactHeld = false;
    log.push(`rebuilt: mate alive=${mate.alive} out=${mate.out} hp=${mate.hp} nestUsed=${nest.used} sparks=${m.sparks.length}`);
  }
  // --- team wipe: knock everyone left -> all out, match over for you
  for (const a of mates()) if (a.parked) { a.parked = false; a.alive = true; a.spawn(p.motor.pos.clone().add(new V(3, 0.5, 0)), 0); }
  step(0.2);
  const team = [p, ...mates()].filter((a) => a.alive);
  for (const a of team) { a.reviveUsed = true; a.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST'); }
  step(0.5);
  log.push(`sparks: ${m.sparks.map((s) => `${s.owner.name} carrier=${s.carrier?.name ?? '-'} t=${s.t.toFixed(1)} mates!out=${m.teammates(s.owner).filter((o) => !o.out).map((o) => o.name + (o.parked ? '(P)' : '')).join('/')}`).join(' | ')} phase=${m.phase}`);
  log.push(`wipe: ${team.map((a) => `${a.name}:${a.out ? 'out' : a.downed ? 'down' : 'up'}`).join(' ')} sparks=${m.sparks.length} endT>0=${m.endT > 0} placement=${p.placement}`);
  return log.join('\n');
});
console.log(out);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill(); process.exit(0);
