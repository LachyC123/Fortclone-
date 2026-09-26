import * as THREE from 'three';
import type { NetProp } from '../combat/Throwables';
import type { PerkId } from '../combat/Perks';
import type { Game } from '../core/Game';
import { Actor, NetActorState } from '../entities/Actor';
import type { SparkInfo } from '../core/types';
import { LOOKS, EmoteKind } from '../entities/RascalRig';
import { WeaponInstance, WEAPONS, buildWeaponView, AmmoType } from '../combat/Weapons';
import { audio } from '../audio/Audio';
import { RarityIndex } from '../render/Palette';
import { groundHeight } from '../world/Terrain';
import { Link, Msg } from './Link';
import { dec } from './Codec';
import type { LootKind } from '../loot/Loot';
import type { HealId, UtilId } from '../combat/Items';

interface Snap {
  tm: number;
  a: Map<number, NetActorState>;
  w: NetProp[];
  ev: unknown[][];
  fired: boolean;
}

type MatchNet = {
  ph: 'lobby' | 'barge' | 'live' | 'end';
  lt: number;
  jn: number;
  ts: number;
  rem: number;
  tl: number;
  b: number[] | null;
  cd: boolean;
  lc: boolean;
  bk: number;
  gl: [string, number, number, number, number, number, number, number, string, number];
  ne: string;
  sp: [number, { v: number[] }, number, number][];
  hot: { v: number[] }[];
  bal: number[][];
};

const DELAY = 0.1;
const _v = new THREE.Vector3();

/**
 * A LAN client: this device builds the same island but doesn't run the match. Every rascal is a
 * puppet posed from the host's snapshots (100ms behind, smoothly interpolated), effects and
 * sounds are replayed when they happened, and your own rascal moves the instant you press a key
 * (the host's word is final; small differences are eased away).
 */
export class ClientSession {
  readonly role = 'client';
  private byId = new Map<number, Actor>();
  me: Actor | null = null;
  private snaps: Snap[] = [];
  private hostClock = 0;
  private recvAt = 0;
  m: MatchNet | null = null;
  private lastPhase = '';
  private sparkVis = new Map<number, THREE.Group>();
  private hotBeams: THREE.Mesh[] = [];
  sparks: SparkInfo[] = [];
  private edges = { j: false, c: false, r: false, i: false, tr: false, b: false, ur: false, he: false, d: false };
  private slot = -1;
  private emote: EmoteKind | null = null;
  private result: { won: boolean; place: number; by?: string } | null = null;
  private resultT = -1;
  private lastCallSaid = false;
  teamSize = 1;

  constructor(public game: Game, public link: Link, public myId: number) {
    link.on('R', (m) => this.onRoster(m));
    link.on('S', (m) => this.onSnap(m));
    link.on('P', (m) => this.onPrivate(m));
  }

  /** a fresh match: forget the old puppets and wait for the host's roster */
  begin() {
    const g = this.game;
    this.snaps = [];
    this.byId.clear();
    this.result = null;
    this.resultT = -1;
    this.lastPhase = '';
    this.lastCallSaid = false;
    for (const s of this.sparkVis.values()) g.scene.remove(s);
    this.sparkVis.clear();
    this.clearHot();
    g.enterNetClient();
  }

  private onRoster(m: Msg) {
    const g = this.game;
    this.teamSize = (m.ts as number) || 1;
    g.matchCtl.teamSize = this.teamSize;
    const list = m.a as { id: number; n: string; l: number; sp: string; bn: string; tm: number; h: number }[];
    g.clearActorsForNet();
    this.byId.clear();
    for (const d of list) {
      const a = new Actor(d.n, LOOKS[Math.max(0, d.l)] ?? LOOKS[1], g, g.speciesById(d.sp), d.bn);
      a.team = d.tm;
      a.controller = null;
      if (d.h === this.myId) {
        this.me = a;
        g.adoptLocalPlayer(a);
      }
      g.actors.push(a);
      this.byId.set(d.id, a);
    }
    // tell the host which bug you brought
    const own = g.collection.bugs.find((b) => b.species === g.collection.equipped);
    if (own) this.link.send({ t: 'hello', sp: own.species, bn: own.name });
  }

  private onSnap(m: Msg) {
    const tm = m.tm as number;
    const a = new Map<number, NetActorState>();
    for (const s of m.a as NetActorState[]) a.set(s.id, s);
    this.snaps.push({ tm, a, w: (m.w as NetProp[]) ?? [], ev: (m.ev as unknown[][]) ?? [], fired: false });
    if (this.snaps.length > 30) this.snaps.splice(0, this.snaps.length - 30);
    this.m = m.m as MatchNet;
    // keep a smooth estimate of the host's clock
    const now = performance.now() / 1000;
    if (!this.recvAt || Math.abs(tm - this.hostNow()) > 0.5) this.hostClock = tm;
    else this.hostClock += (tm - this.hostNow()) * 0.1;
    this.recvAt = now;
  }

  private hostNow() {
    return this.hostClock + (performance.now() / 1000 - this.recvAt);
  }

  private onPrivate(m: Msg) {
    const g = this.game;
    const me = this.me;
    if (me && m.me) this.applyPrivate(me, m.me as Record<string, unknown>);
    for (const e of (m.q as unknown[][]) ?? []) {
      const [kind, name] = e as [string, string];
      if (kind === 'h') (g.hud as unknown as Record<string, (...a: unknown[]) => void>)[name]?.(...(dec(e[2]) as unknown[]));
      else if (kind === 's') (audio as unknown as Record<string, (...a: unknown[]) => void>)[name]?.(...(dec(e[2]) as unknown[]));
      else if (kind === 'c') {
        if (name === 'shake') g.shake(e[2] as number);
        else if (name === 'hitStop') g.hitStop(e[2] as number, e[3] as number);
        else if (name === 'slowMo') g.slowMo(e[2] as number, e[3] as number);
        else if (name === 'recoil') {
          g.camRig.kick(e[2] as number, e[3] as number);
          g.camRig.shake((e[4] as number) * 0.35);
          me?.rig.onFire(e[4] as number);
        } else if (name === 'blink') {
          g.camRig.blink();
          g.hud.blink();
        } else if (name === 'land') g.camRig.land(e[2] as number);
      }
    }
    if (m.res && !this.result) {
      this.result = m.res as { won: boolean; place: number; by?: string };
      const ui = g.matchCtl.ui;
      if (this.result.won) {
        ui.victory();
        g.slowMo(0.3, 1.3);
        audio.fanfare();
        g.camRig.cinematic = true;
        if (me) g.fx.elimination(me.motor.pos.clone().setY(me.motor.pos.y + 2), [0xffd36b, 0xff9ad5, 0x6ff7ff]);
        this.resultT = 5.2;
      } else {
        ui.spectating('', false);
        ui.eliminated(this.result.by ?? 'the island', this.result.place);
        this.resultT = 2.8;
      }
    }
  }

  private applyPrivate(me: Actor, p: Record<string, unknown>) {
    const ws = p.w as ([string, number, number, number, number, number, number] | null)[];
    const prevKey = me.weapon ? `${me.weapon.def.id}:${me.weapon.rarity}` : '';
    me.weapons = ws.map((w) => {
      if (!w || !WEAPONS[w[0]]) return null;
      const inst = new WeaponInstance(WEAPONS[w[0]], w[1] as RarityIndex);
      inst.mag = w[2];
      inst.reloadT = w[3] ? w[4] : -1;
      inst.bloom = w[6];
      return inst;
    });
    me.activeSlot = p.sl as number;
    const key = me.weapon ? `${me.weapon.def.id}:${me.weapon.rarity}` : '';
    if (key !== prevKey) me.rig.setWeapon(me.weapon ? buildWeaponView(me.weapon.def, me.weapon.rarity) : null);
    Object.assign(me.ammo, p.am as Record<AmmoType, number>);
    const ut = p.ut as [UtilId, number] | null, he = p.he as [HealId, number] | null;
    me.util = ut ? { id: ut[0], count: ut[1] } : null;
    me.healItem = he ? { id: he[0], count: he[1] } : null;
    me.healT = p.ht as number;
    me.perks = (p.pk as PerkId[]) ?? [];
    me.applyPerks();
    const sw = p.sw as [number, number] | undefined;
    if (sw) [me.slowT, me.slowK] = sw;
    const b = p.bug as number[];
    me.bug.cooldown = b[0];
    me.bug.cooldownMax = b[1];
    me.bug.window = b[2];
    const st = p.st as number[];
    [me.kills, me.damageDealt, me.blinks, me.distance, me.fusions, me.bestRarity, me.revives, me.placement] = st;
    me.weaponDamage = p.wd as Record<string, number>;
  }

  /* ------------------------------------------------------------------ input */
  private sendInput() {
    const g = this.game;
    const me = this.me;
    const s = g.input.s;
    if (s.jumpPressed) this.edges.j = true;
    if (s.crouchPressed) this.edges.c = true;
    if (s.reloadPressed) this.edges.r = true;
    if (s.interactPressed) this.edges.i = true;
    if (s.throwReleased) this.edges.tr = true;
    if (s.blinkPressed) this.edges.b = true;
    if (s.utilReleased) this.edges.ur = true;
    if (s.healPressed) this.edges.he = true;
    if (s.dropPressed) this.edges.d = true;
    if (s.slotPressed >= 0) this.slot = s.slotPressed;
    if (!me) return;
    const it = me.intent;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.link.send({
      t: 'in',
      mx: r(it.moveX), mz: r(it.moveZ), ay: r(it.aimYaw), ap: r(it.aimPitch),
      o: [r(it.aimOrigin.x), r(it.aimOrigin.y), r(it.aimOrigin.z)], dd: [r(it.aimDir.x), r(it.aimDir.y), r(it.aimDir.z)],
      sp: it.sprint, f: it.fire, ad: it.ads, ta: it.throwAim, ua: it.utilAim, h: s.interactHeld,
      ...this.edges, sl: this.slot, em: this.emote ?? undefined,
    });
    for (const k of Object.keys(this.edges) as (keyof ClientSession['edges'])[]) this.edges[k] = false;
    this.slot = -1;
    this.emote = null;
  }

  sendEmote(kind: EmoteKind) {
    this.emote = kind;
  }

  /* ------------------------------------------------------------------ per frame */
  frame(dt: number) {
    const g = this.game;
    g.time += dt;
    const me = this.me;
    // your own rascal: input -> camera + intent, then move it locally straight away
    if (me && (me.alive || me.bugout) && !this.result) g.pc.update(me, g, dt);
    this.sendInput();
    const predicted = !!me && me.predict(dt, g);

    // interpolate everyone else DELAY seconds in the past
    const rt = this.hostNow() - DELAY;
    let s0: Snap | null = null, s1: Snap | null = null;
    for (let i = 0; i < this.snaps.length; i++) {
      const s = this.snaps[i];
      if (s.tm <= rt) s0 = s;
      else {
        s1 = s;
        break;
      }
    }
    // replay effects in order as their moment comes
    for (const s of this.snaps) {
      if (s.fired || s.tm > rt + DELAY * 0.5) continue;
      s.fired = true;
      for (const e of s.ev) this.event(e);
    }
    const base = s0 ?? s1;
    if (base) {
      const k = s0 && s1 ? (rt - s0.tm) / Math.max(1e-3, s1.tm - s0.tm) : 0;
      for (const [id, a] of this.byId) {
        const A = s0?.a.get(id), B = s1?.a.get(id);
        const st = A && B ? lerpState(A, B, k) : A ?? B;
        if (!st) {
          a.rig.root.visible = false;
          continue;
        }
        const isMe = a === me;
        // your own rascal uses the newest snapshot as the correction target
        const own = isMe ? this.snaps[this.snaps.length - 1].a.get(id) ?? st : st;
        a.netApply(own, dt, g.time, isMe && predicted);
        a.netTick(dt, g);
      }
      g.throwables.netApply(s0?.w ?? s1?.w, s1?.w, k, dt);
    }
    this.snaps = this.snaps.filter((s) => !s.fired || s.tm > rt - 0.5);
    this.applyMatch(dt);
  }

  /** one recorded event from the host */
  /** how many events of each kind have been replayed (debug / tests) */
  stats: Record<string, number> = {};

  private event(e: unknown[]) {
    const g = this.game;
    const t = e[0] as string;
    const key = t === 'f' || t === 'a' || t === 'n' ? `${t}:${e[1]}` : t;
    this.stats[key] = (this.stats[key] ?? 0) + 1;
    try {
      switch (t) {
        case 'f':
          (g.fx as unknown as Record<string, (...a: unknown[]) => void>)[e[1] as string](...(dec(e[2]) as unknown[]));
          break;
        case 'p':
          (e[1] ? g.fx.glow : g.fx.soft).emit(...(dec(e[2]) as [THREE.Vector3, object]));
          break;
        case 'a': {
          const args = dec(e[2]) as unknown[];
          if (e[1] === 'gunshot' || e[1] === 'blink') args[2] = false;
          (audio as unknown as Record<string, (...a: unknown[]) => void>)[e[1] as string]?.(...args);
          break;
        }
        case 'n': {
          const args = dec(e[2]) as unknown[];
          const my = this.me?.name;
          if (e[1] === 'killfeed') {
            args[0] = args[0] === my ? 'You' : args[0];
            args[3] = args[0] === 'You' || args[1] === my;
            if (args[1] === my) args[1] = 'You';
          }
          (g.hud as unknown as Record<string, (...a: unknown[]) => void>)[e[1] as string](...args);
          break;
        }
        case 'L+': {
          const [, id, kind, defId, rarity, amount, pos, vel, mag] = e as [string, number, LootKind, string, RarityIndex, number, unknown, unknown, number];
          const v = dec(vel) as THREE.Vector3;
          g.loot.spawn(kind, defId, rarity, amount, dec(pos) as THREE.Vector3, v && v.lengthSq() > 0 ? v : undefined, mag, id);
          break;
        }
        case 'Lc': {
          const p = g.loot.pickups.find((x) => x.id === e[1]);
          const a = this.byId.get(e[2] as number);
          if (p && a && p.collectT < 0) {
            p.collectT = 0;
            p.collector = a;
          }
          break;
        }
        case 'L-': {
          const p = g.loot.pickups.find((x) => x.id === e[1]);
          if (p) g.loot.remove(p);
          break;
        }
        case 'C': {
          const c = g.loot.crates.find((x) => x.id === e[1]);
          const opener = this.byId.get(e[2] as number);
          if (c && opener) {
            c.netOnly = true;
            g.loot.openCrate(c, opener);
          }
          break;
        }
        case 'C+': {
          const c = g.loot.placeCrate(dec(e[2]) as THREE.Vector3, e[3] as number, e[1] as number);
          c.rich = !!e[4];
          c.netOnly = true;
          break;
        }
        case 'C-': {
          const c = g.loot.crates.find((x) => x.id === e[1]);
          if (c) g.loot.removeCrate(c);
          break;
        }
        case 'CR':
          g.loot.resetCrates();
          for (const c of g.loot.crates) c.netOnly = true;
          break;
        case 's':
          g.emitSound({ pos: dec(e[1]) as THREE.Vector3, loudness: e[2] as number, source: null, kind: e[3] as 'gunshot' });
          break;
        case 'y':
          this.byId.get(e[1] as number)?.say(e[2] as string, e[3] as string, e[4] as number, true);
          break;
        case 'k': {
          const a = this.byId.get(e[1] as number);
          if (a) a.netKO(e[2] as number, e[3] as number);
          break;
        }
      }
    } catch {
      /* a malformed or unknown event: skip it */
    }
  }

  /* ------------------------------------------------------------------ match visuals & UI */
  private applyMatch(dt: number) {
    const g = this.game;
    const m = this.m;
    const mc = g.matchCtl;
    const ui = mc.ui;
    const me = this.me;
    if (!m) return;
    // barge
    const b = mc.barge;
    if (m.b) {
      b.active = true;
      b.group.visible = true;
      const [x, y, z, yaw, vx, vz, pr, sx, sz, ex, ez] = m.b;
      if (b.pos.distanceToSquared(_v.set(x, y, z)) > 4) b.pos.set(x, y, z);
      b.yaw = yaw;
      b.vel.set(vx, 0, vz);
      b.progress = pr;
      b.start.set(sx, y, sz);
      b.end.set(ex, y, ez);
      g.hud.route = { sx, sz, ex, ez, bx: 0, bz: 0 };
    } else {
      b.active = false;
      b.group.visible = false;
    }
    b.update(dt);
    // gloom
    const gl = mc.gloom;
    gl.netMode = true;
    const [st, ph, cx, cz, r, nx, nz, nr, label, tt] = m.gl;
    if (st !== 'idle' && gl.state === 'idle') gl.start();
    gl.state = st as typeof gl.state;
    gl.phase = ph;
    gl.center.set(cx, cz);
    gl.radius = r;
    gl.nextC.set(nx, nz);
    gl.nextR = nr;
    if (st === 'idle') gl.reset();
    gl.update(dt, g.camera.position);
    g.hud.gloom = st !== 'idle' ? gl : null;
    // nests
    g.world.nests.forEach((n, i) => {
      const used = m.ne[i] === '1';
      if (used === n.used) return;
      n.used = used;
      n.fx.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (!mm || !mm.color) return;
        if (o.userData.baseColor === undefined) o.userData.baseColor = mm.color.getHex();
        mm.color.setHex(used ? 0x6b6478 : o.userData.baseColor);
      });
    });
    // sparks
    const live = new Set<number>();
    this.sparks = [];
    for (const [owner, pos, carrier, k] of m.sp) {
      const o = this.byId.get(owner);
      if (!o) continue;
      live.add(owner);
      const p = new THREE.Vector3(pos.v[0], pos.v[1], pos.v[2]);
      this.sparks.push({ owner: o, pos: p, carrier: this.byId.get(carrier) ?? null, rebuildK: k });
      let vis = this.sparkVis.get(owner);
      if (!vis) {
        vis = new THREE.Group();
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0x9ffcff }));
        core.scale.set(1, 1.5, 1);
        vis.add(core);
        g.scene.add(vis);
        this.sparkVis.set(owner, vis);
      }
      vis.position.copy(p);
      vis.rotation.y += dt * 2;
    }
    for (const [id, vis] of this.sparkVis) {
      if (live.has(id)) continue;
      g.scene.remove(vis);
      this.sparkVis.delete(id);
    }
    // hot drops & balloons (markers + beams)
    if (m.hot.length !== this.hotBeams.length) {
      this.clearHot();
      for (const h of m.hot) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.set(h.v[0], h.v[1] + 45, h.v[2]);
        g.scene.add(beam);
        this.hotBeams.push(beam);
      }
    }
    g.hud.hotDrops = m.hot.map((h) => new THREE.Vector3(h.v[0], h.v[1], h.v[2]));
    g.hud.balloons = m.bal.map((x) => new THREE.Vector3(x[3], x[4], x[5]));

    // --- your UI
    if (m.ph !== this.lastPhase) {
      if (m.ph === 'barge') {
        ui.wipe();
        ui.barge();
        if (me) {
          g.camRig.snapTo(me);
          g.camRig.pitch = -0.35;
        }
      }
      if (m.ph === 'live') ui.live();
      this.lastPhase = m.ph;
    }
    if (m.ph === 'lobby') ui.lobby(m.lt, m.jn, 24);
    if (m.ph === 'barge') {
      ui.bargeStatus(m.bk, me?.flight === 'barge', m.cd, m.lc);
      if (m.lc && !this.lastCallSaid && me?.flight === 'barge') {
        this.lastCallSaid = true;
        g.hud.bigToast('LAST CALL! JUMP!', '#ff9a5b');
      }
    }
    if (m.ph === 'live' || m.ph === 'barge') ui.gloomTimer(label, tt, st === 'shrinking');
    if (me) {
      ui.gloomAmount(st !== 'idle' && me.flight === 'none' ? Math.min(1, gl.edgeness(me.bugout ? me.bug.pos : me.motor.pos) * 0.8) : 0);
      ui.knocked(me.downed);
      if (me.downed) ui.knockedBleed(me.downHp / 100, me.reviveK);
      if (me.bugout) {
        let best: THREE.Vector3 | null = null, bd = Infinity;
        for (const n of g.world.nests) {
          if (n.used) continue;
          const d = n.pos.distanceTo(me.bug.pos);
          if (d < bd) {
            bd = d;
            best = n.pos;
          }
        }
        ui.bugout(me.bugout.t, me.bugout.hp / 30, best, bd, g.camera);
      } else ui.bugout(-1, 0, null, 0, g.camera);
      if (me.out && !this.result && this.teamSize > 1) ui.spectating(this.spectate()?.name ?? '', true);
      else if (!me.out) ui.spectating('', false);
    }
    // end-of-match: celebrate or watch, then the summary
    if (this.resultT > 0) {
      this.resultT -= dt;
      if (this.result?.won && me && me.alive && !me.emote && this.resultT < 4.3) me.emote = 'dance';
      if (this.resultT <= 0) {
        g.camRig.cinematic = false;
        mc.showSummaryNet(!!this.result?.won, this.result?.place ?? 0);
      }
    }
  }

  /** who to watch when you're out: a teammate still in, else anyone */
  spectate(): Actor | null {
    const me = this.me;
    if (!me) return null;
    const alive = [...this.byId.values()].filter((a) => a.alive && a !== me);
    return alive.find((a) => a.team === me.team) ?? alive[0] ?? null;
  }

  private clearHot() {
    for (const b of this.hotBeams) this.game.scene.remove(b);
    this.hotBeams = [];
  }

  close() {
    this.link.close();
  }
}

/** blend two snapshots of the same rascal (positions & angles; flags from the newer one) */
function lerpState(a: NetActorState, b: NetActorState, k: number): NetActorState {
  const t = Math.max(0, Math.min(1, k));
  const l = (x: number, y: number) => x + (y - x) * t;
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  // teleports (blinks, respawns) don't slide across the map
  const jump = Math.hypot(b.x - a.x, b.z - a.z) > 6;
  return {
    ...b,
    x: jump ? b.x : l(a.x, b.x), y: jump ? b.y : l(a.y, b.y), z: jump ? b.z : l(a.z, b.z),
    vx: l(a.vx, b.vx), vy: l(a.vy, b.vy), vz: l(a.vz, b.vz),
    yaw: a.yaw + dy * t, pitch: l(a.pitch, b.pitch),
    bx: l(a.bx, b.bx), by: l(a.by, b.by), bz: l(a.bz, b.bz),
  };
}

void groundHeight;
