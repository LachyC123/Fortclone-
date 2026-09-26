// LAN end-to-end: real LAN server, two browsers (host + friend) joining a room through the UI,
// a duos match, and checks that snapshots, input and effects flow both ways.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 8791;
const server = spawn('node', ['server/lan.mjs'], { stdio: 'pipe', env: { ...process.env, PORT: String(PORT) } });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const mk = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(() => localStorage.setItem('rr.settings', JSON.stringify({ quality: 'low', autoQuality: false })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}\n${e.stack}`));
  page.on('dialog', (d) => { errors.push(`[${tag}] dialog: ${d.message()}`); d.dismiss(); });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  return page;
};
const A = await mk('host');
const B = await mk('friend');
const log = [];
// host makes a room
await A.click('.friends');
await A.waitForSelector('.lanentry .create', { timeout: 30000 });
await A.fill('.lanentry .nm', 'Hosty');
await A.click('.lanentry .create');
await A.waitForSelector('.lanroom .code b', { timeout: 30000 });
const code = await A.textContent('.lanroom .code b');
log.push(`room code ${code}`);
// friend joins
await B.click('.friends');
await B.waitForSelector('.lanentry .join', { timeout: 30000 });
await B.fill('.lanentry .nm', 'Bro');
await B.fill('.lanentry .code', code);
await B.click('.lanentry .join');
try {
  await B.waitForSelector('.lanroom .mem:nth-child(2)', { timeout: 30000 });
} catch (e) {
  console.log('JOIN FAILED. server:', serverLog, '\nB flash:', await B.textContent('.lanflash').catch(() => '-'), '\nB html:', (await B.innerHTML('.lan').catch(() => '-')).slice(0, 600), '\nerrors:', errors.join('\n'));
  await B.screenshot({ path: 'tools/out/lan-join.png' });
  process.exit(1);
}
// duos, same team (default: joiner lands on the host's team)
await A.click('.lanroom .modes button[data-n="2"]');
await B.waitForFunction(() => document.querySelector('.lanroom .modes button.on')?.textContent === 'DUOS', null, { timeout: 10000 });
log.push('B sees: ' + (await B.$$eval('.lanroom .mem', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '))));
await A.click('.lanroom .start');
// let the host run the lobby quickly and the friend render
await A.waitForFunction(() => window.__game.net && window.__game.match, null, { timeout: 30000 });
await A.evaluate(() => { window.__game.freeze = true; });
const hostStep = (sec) => A.evaluate((sec) => { const g = window.__game; for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30); }, sec);
for (let i = 0; i < 6; i++) { await hostStep(0.5); await B.waitForTimeout(250); }
log.push('host: ' + (await A.evaluate(() => {
  const g = window.__game;
  const remote = [...g.net.remote.values()][0];
  return `actors=${g.actors.length} phase=${g.match.phase} remote=${remote.actor.name} team=${remote.actor.team} myTeam=${g.player.team} teamSize=${g.match.teamSize}`;
})));
log.push('friend: ' + (await B.evaluate(() => {
  const g = window.__game;
  const n = g.net;
  return `role=${n?.role} actors=${g.actors.length} me=${n?.me?.name} myTeam=${n?.me?.team} visible=${g.actors.filter((a) => a.rig.root.visible).length} phase=${n?.m?.ph} snaps=${n ? 'yes' : 'no'} pickups=${g.loot.pickups.length}`;
})));
// the friend walks forward: their input must move their rascal on the host
const before = await A.evaluate(() => [...window.__game.net.remote.values()][0].actor.motor.pos.toArray());
await B.bringToFront();
await B.keyboard.down('KeyW');
for (let i = 0; i < 6; i++) { await B.waitForTimeout(250); await hostStep(0.25); }
await B.keyboard.up('KeyW');
const after = await A.evaluate(() => [...window.__game.net.remote.values()][0].actor.motor.pos.toArray());
log.push(`friend moved on host: ${Math.hypot(after[0] - before[0], after[2] - before[2]).toFixed(2)}m`);
const mine = await B.evaluate(() => { const n = window.__game.net; return n.me.motor.pos.toArray().map((v) => v.toFixed(1)).join(','); });
log.push(`friend's own view of self: ${mine} host has ${after.map((v) => v.toFixed(1)).join(',')}`);
// the host shoots near the friend: friend should receive fx/audio events
await A.evaluate(() => { const g = window.__game; g.player.giveWeapon('rattle', 1, 0, true); g.player.ammo.light = 100; });
const fxBefore = await B.evaluate(() => window.__game.fx.glow.active + window.__game.fx.soft.active);
await A.evaluate(() => { window.__game.input.s.fire = true; });
for (let i = 0; i < 4; i++) { await hostStep(0.1); await B.waitForTimeout(200); }
await A.evaluate(() => { window.__game.input.s.fire = false; });
await B.waitForTimeout(400);
const fxAfter = await B.evaluate(() => window.__game.fx.glow.active + window.__game.fx.soft.active);
log.push(`friend particles while host fires: ${fxBefore} -> ${fxAfter}`);
log.push('friend event stats: ' + (await B.evaluate(() => JSON.stringify(window.__game.net.stats))));
log.push('host fired: ' + (await A.evaluate(() => { const w = window.__game.player.weapon; return w ? w.mag : 'no weapon'; })));
// through to the barge and live
for (let i = 0; i < 40; i++) {
  await hostStep(0.5);
  const ph = await A.evaluate(() => window.__game.match.phase);
  if (ph === 'barge') break;
}
await B.waitForTimeout(600);
log.push('friend on barge: ' + (await B.evaluate(() => { const n = window.__game.net; return `phase=${n.m?.ph} myFlight=${n.me.flight} bargeVisible=${window.__game.matchCtl.barge.group.visible}`; })));
// the friend fires a gun the host hands them
await A.evaluate(() => { const r = [...window.__game.net.remote.values()][0].actor; r.giveWeapon('rattle', 2, 0, true); r.ammo.light = 200; });
for (let i = 0; i < 40; i++) {
  await hostStep(0.5);
  if ((await A.evaluate(() => window.__game.match.phase)) === 'live') break;
}
for (let i = 0; i < 60; i++) {
  if ((await A.evaluate(() => [...window.__game.net.remote.values()][0].actor.flight)) === 'none') break;
  await hostStep(0.5);
  await B.waitForTimeout(100);
}
await B.waitForTimeout(500);
const magBefore = await A.evaluate(() => [...window.__game.net.remote.values()][0].actor.weapon?.mag ?? -1);
await B.evaluate(() => { window.__game.input.s.fire = true; });
for (let i = 0; i < 5; i++) { await B.waitForTimeout(200); await hostStep(0.2); }
await B.evaluate(() => { window.__game.input.s.fire = false; });
const magAfter = await A.evaluate(() => [...window.__game.net.remote.values()][0].actor.weapon?.mag ?? -1);
log.push('host view of friend input: ' + (await A.evaluate(() => { const r = [...window.__game.net.remote.values()][0]; return JSON.stringify({ f: r.ctl?.last?.f, alive: r.actor.alive, flight: r.actor.flight, w: r.actor.weapon?.def.id, slot: r.actor.slot, phase: window.__game.match.phase }); })));
log.push('friend intent: ' + (await B.evaluate(() => { window.__game.input.s.fire = true; const me = window.__game.net.me; window.__game.pc.update(me, window.__game, 0.016); const f = me.intent.fire; window.__game.input.s.fire = false; return JSON.stringify({ f, flight: me.flight, alive: me.alive }); })));
await B.waitForTimeout(400);
log.push(`friend fired on host: mag ${magBefore} -> ${magAfter}; friend sees own gun: ${await B.evaluate(() => { const w = window.__game.net.me.weapon; return w ? w.def.id + ' mag ' + w.mag : 'none'; })}`);
// gadgets and perks show up on the friend's screen
await A.evaluate(() => {
  const g = window.__game;
  const r = [...g.net.remote.values()][0].actor;
  const enemy = g.actors.find((a) => a.team !== r.team && a.alive);
  g.throwables.addWeb(r.motor.pos.clone().add(new r.motor.pos.constructor(2, 0.14, 0)), g.player, 20);
  g.throwables.placeJammer(r.motor.pos.clone().add(new r.motor.pos.constructor(-3, 0, 0)), enemy, g);
  r.addPerk('springy');
});
for (let i = 0; i < 4; i++) { await hostStep(0.2); await B.waitForTimeout(250); }
log.push('friend sees gadgets: ' + (await B.evaluate(() => { const g = window.__game; return `props=${g.throwables['netObjs'].size} perks=${g.net.me.perks.join(',')} jumpMul=${g.net.me.motor.jumpMul} badges=${document.querySelector('.healthbox .perks')?.children.length}`; })));
// knocked & revived across the network
await A.evaluate(() => {
  const g = window.__game;
  const r = [...g.net.remote.values()][0].actor;
  const enemy = g.actors.find((a) => a.team !== r.team && a.alive);
  const V = r.motor.pos.constructor;
  r.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST');
});
for (let i = 0; i < 3; i++) { await hostStep(0.2); await B.waitForTimeout(250); }
log.push('friend knocked: ' + (await B.evaluate(() => { const n = window.__game.net; return `downed=${n.me.downed} banner=${document.querySelector('.knockban')?.classList.contains('show')} toastSeen=${[...document.querySelectorAll('.bigtoast')].map((e) => e.textContent).join('/')}`; })));
await A.evaluate(() => { const g = window.__game; const r = [...g.net.remote.values()][0].actor; r.revive(g, g.player); });
for (let i = 0; i < 3; i++) { await hostStep(0.2); await B.waitForTimeout(250); }
log.push('host friend after revive: ' + (await A.evaluate(() => { const r = [...window.__game.net.remote.values()][0].actor; return `downed=${r.downed} hp=${r.hp} alive=${r.alive}`; })));
log.push('friend revived: ' + (await B.evaluate(() => { const n = window.__game.net; return `downed=${n.me.downed} hp=${n.me.hp} banner=${document.querySelector('.knockban')?.classList.contains('show')}`; })));
// wipe the friend's team: they should get their result + summary
await A.evaluate(() => {
  const g = window.__game;
  const r = [...g.net.remote.values()][0].actor;
  const enemy = g.actors.find((a) => a.team !== r.team && a.alive);
  const V = r.motor.pos.constructor;
  for (const a of g.actors) if (a.team === r.team) { a.reviveUsed = true; a.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST'); }
  for (const a of g.actors) if (a.team === r.team && a.downed) a.takeDamage(500, enemy, false, new V(1, 0, 0), g, 'TEST');
});
for (let i = 0; i < 12; i++) { await hostStep(0.5); await B.waitForTimeout(400); }
log.push('host team state: ' + (await A.evaluate(() => { const g = window.__game; const r = [...g.net.remote.values()][0]; return JSON.stringify({ res: r.result, ph: g.match.phase, team: g.actors.filter((a) => a.team === r.actor.team).map((a) => [a.name, a.alive, a.downed, !!a.bugout, a.out, a.parked]), sparks: g.match.sparks.length }); })));
log.push('friend net result: ' + (await B.evaluate(() => JSON.stringify(window.__game.net.result))));
await B.waitForFunction(() => !document.querySelector('.summary')?.classList.contains('hidden'), null, { timeout: 60000 }).catch(() => {});
log.push('friend result: ' + (await B.evaluate(() => `summary=${!document.querySelector('.summary')?.classList.contains('hidden')} text=${document.querySelector('.summary .place')?.textContent}`)));
await B.screenshot({ path: 'tools/out/lan-friend.png', timeout: 120000 });
// PLAY AGAIN from the host takes everyone into a fresh match
await A.evaluate(() => window.__game.matchCtl.ui.onPlayAgain?.());
let replay = '';
for (let i = 0; i < 20 && !replay.startsWith('ok'); i++) {
  await hostStep(0.3);
  await B.waitForTimeout(400);
  replay = await B.evaluate(() => { const n = window.__game.net; const hid = document.querySelector('.summary')?.classList.contains('hidden'); return `${hid && n?.m?.ph === 'lobby' && n.me?.alive ? 'ok' : 'no'} summaryHidden=${hid} ph=${n?.m?.ph} meAlive=${n?.me?.alive} result=${JSON.stringify(n?.result)}`; });
}
log.push('play again (friend): ' + replay);
log.push('after replay host: ' + (await A.evaluate(() => `phase=${window.__game.match.phase} actors=${window.__game.actors.length} remote=${window.__game.net.remote.size} hostName=${window.__game.player.name}`)));
await A.screenshot({ path: 'tools/out/lan-host.png', timeout: 120000 });
console.log(log.join('\n'));
console.log('SERVER:', serverLog.trim().split('\n').slice(-6).join('\n'));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
