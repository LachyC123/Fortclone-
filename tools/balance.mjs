// Balance harness.
//   node tools/balance.mjs --br=3      bots-only matches: how many remain over time, how long a match lasts
//   node tools/balance.mjs --duel      each bot skill vs a strafing (invulnerable) player: accuracy & time-to-kill
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 4185;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}`)) || '').split('=')[1];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });

if (process.argv.some((a) => a.startsWith('--br'))) {
  const n = +(arg('br') || 3);
  for (let run = 0; run < n; run++) {
    const r = await page.evaluate(([verbose, team]) => {
      const g = window.__game;
      g.startMatch(team);
      g.pause();
      const m = g.match, p = g.player;
      const step = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) g.debugStep(1, 1 / 30); };
      while (m.phase === 'lobby') step(0.5);
      // the player becomes a ghost: bots ignore them, the match runs on its own
      p.parked = true;
      let t = 0;
      let shots = 0;
      for (const a of g.actors) { const of = a.onFired.bind(a); a.onFired = (x, y, z) => { shots++; of(x, y, z); }; }
      while (m.phase === 'barge') { step(0.5); t += 0.5; }
      const land = t;
      const curve = [];
      let last = -1;
      while ((team > 1 ? m.teamsLeft() > 1 : m.remaining > 1) && t < 720) {
        step(1);
        t += 1;
        const mark = Math.floor((t - land) / 30);
        if (mark !== last) {
          last = mark;
          const st = {};
          for (const a of g.actors) if (a.alive && !a.parked && a.controller?.state) st[a.controller.state[0]] = (st[a.controller.state[0]] || 0) + 1;
          const armed = g.actors.filter((a) => a.alive && !a.parked && a.weapons.some((x) => x && (x.mag > 0 || a.ammo[x.def.ammo] > 0))).length;
          const noGun = g.actors.filter((a) => a.alive && !a.parked && !a.weapons.some((x) => x)).length;
          curve.push(`${Math.round(t - land)}s:${m.remaining} [sh${shots} arm${armed} nogun${noGun} ${Object.entries(st).map(([k, v]) => k + v).join('')}]`);
          shots = 0;
          if (verbose && mark === 5) for (const a of g.actors.filter((a) => a.alive && !a.parked && a.controller?.state).slice(0, 24)) {
            const b = a.controller;
            const guns = a.weapons.map((w) => (w ? `${w.def.id}:${w.mag}/${a.ammo[w.def.ammo]}` : '-')).join(',');
            curve.push(`   ${a.name.padEnd(12)} ${b.state.padEnd(8)} armed=${a.armed} slot=${a.activeSlot} [${guns}] lt=${!!b.lootTarget} ct=${!!b.crateTarget} path=${b.path.length} goal=${b.hasGoal} pos=${a.motor.pos.toArray().map((v) => v.toFixed(0))} unreach=${b.unreachable.size} near=${g.loot.pickups.filter((pk) => pk.kind === 'weapon' && pk.pos.distanceTo(a.motor.pos) < 45).length}w/${g.loot.pickups.filter((pk) => pk.kind === 'ammo' && pk.pos.distanceTo(a.motor.pos) < 45).length}a tgt=${b.lootTarget ? b.lootTarget.kind + ':' + b.lootTarget.pos.distanceTo(a.motor.pos).toFixed(0) + 'm y' + b.lootTarget.pos.y.toFixed(1) : '-'} idle=${b.idleT.toFixed(1)} hunt=${m.hunt.toFixed(2)} er=${m.engageRange.toFixed(0)} target=${b.target ? b.target.name + '@' + b.target.motor.pos.distanceTo(a.motor.pos).toFixed(0) + (b.targetVisible ? 'V' : '') : '-'} heard=${(g.time - b.heardT).toFixed(0)}s hp=${a.hp.toFixed(0)}`);
          }
        }
      }
      const kills = g.actors.map((a) => a.kills).sort((a, b) => b - a).slice(0, 3).join('/');
      const revives = g.actors.reduce((s2, a) => s2 + a.revives, 0);
      const res = `landed ${land.toFixed(0)}s  match ${(t / 60).toFixed(1)}min  left=${m.remaining}${team > 1 ? ` teams=${m.teamsLeft()} revives=${revives} rebuilt=${g.actors.filter((a) => a.alive && a.reviveUsed).length}` : ''}  topKills=${kills}\n    ${curve.join('\n    ')}`;
      g.goHome();
      return res;
    }, [process.argv.includes('--verbose'), +(arg('team') || 1)]);
    console.log(`run ${run}: ${r}`);
  }
}

if (process.argv.includes('--duel')) {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.startPlayground();
    g.pause();
    const V = g.player.motor.pos.constructor;
    const p = g.player;
    const out = [];
    // a quiet sky platform so nothing else interferes
    const Y = 150;
    g.cw.box(0, Y - 0.5, 0, 120, 1, 120, 'stone');
    for (const a of g.actors.slice(2)) { a.parked = true; a.controller = null; a.alive = false; a.rig.root.visible = false; a.motor.teleport(new V(0, -500, 0)); }
    const bot = g.actors[1];
    const brain = bot.controller;
    let dmg = 0, hits = 0, shots = 0, firstKill = -1, t = 0;
    const origTake = p.takeDamage.bind(p);
    p.takeDamage = (amount) => { dmg += amount; hits++; if (firstKill < 0 && dmg >= 100) firstKill = t; return false; };
    const origFired = bot.onFired.bind(bot);
    bot.onFired = (a, b, c) => { shots++; origFired(a, b, c); };
    const tiers = [0, 0.5, 1];
    for (const tier of tiers) {
      for (const [wid, rar] of [['tincan', 1], ['rattle', 1]]) {
        for (const d of [8, 16, 28]) {
         let sd = 0, sh = 0, ss = 0, sk = 0, kn = 0;
         for (let rep = 0; rep < 3; rep++) {
          dmg = 0; hits = 0; shots = 0; firstKill = -1; t = 0;
          if (tier !== null && brain.setSkill) brain.setSkill(tier);
          p.spawn(new V(0, Y, 0), 0);
          bot.spawn(new V(0, Y, -d), 0);
          bot.weapons = [null, null, null];
          bot.giveWeapon(wid, rar, 0, true);
          bot.ammo.light = bot.ammo.medium = 999;
          brain.state = 'wander'; brain.target = null;
          bot.parked = false;
          p.controller = null;
          let dir = 1, flip = 0;
          const T = 16;
          for (let i = 0; i < T * 30; i++) {
            flip -= 1 / 30;
            if (flip <= 0) { dir = -dir; flip = 0.6 + Math.random() * 0.9; }
            p.intent.moveX = dir; p.intent.moveZ = 0; p.intent.sprint = false;
            // keep them roughly in their lane
            if (Math.abs(p.motor.pos.x) > 6) dir = -Math.sign(p.motor.pos.x);
            p.hp = 100;
            g.debugStep(1, 1 / 30);
            t += 1 / 30;
          }
          sd += dmg / T; sh += hits; ss += shots; if (firstKill >= 0) { sk += firstKill; kn++; }
         }
          out.push(`skill ${tier}\t${wid.padEnd(7)} ${String(d).padStart(2)}m  acc=${ss ? ((sh / ss) * 100).toFixed(0) : '-'}%  dps=${(sd / 3).toFixed(1)}  ttk=${kn ? (sk / kn).toFixed(1) + 's' : '-'}(${kn}/3)`);
        }
      }
    }
    return out;
  });
  console.log(r.join('\n'));
}
console.log('ERRORS:', errors.length ? errors.slice(0, 5).join('\n') : 'none');
await browser.close();
server.kill();
process.exit(0);
