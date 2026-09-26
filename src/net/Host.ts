import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor, Controller, NetActorState } from '../entities/Actor';
import type { GameCtx, HudEvents, Personal } from '../core/types';
import type { Audio } from '../audio/Audio';
import { audio } from '../audio/Audio';
import { LOOKS } from '../entities/RascalRig';
import { interactContext } from '../player/Interact';
import { Link, Msg } from './Link';
import { enc, tap } from './Codec';

export interface RoomMember {
  id: number;
  name: string;
  team: number;
  host: boolean;
}

const FX_METHODS = ['muzzle', 'impact', 'hitSplat', 'dust', 'landBurst', 'blinkBurst', 'bugTrail', 'pickupSparkle', 'healPuff', 'elimination', 'explosion', 'fuseBurst', 'sparkBurst', 'tracer', 'ring', 'decal', 'chunk', 'smear', 'casing', 'leaves', 'koStars', 'confettiCannon', 'bolt', 'lightFlash'];
const AUDIO_SKIP = new Set(['constructor', 'unlock', 'setVolume', 'setListener', 'setWind', 'out', 'throttle', 'tone', 'noise', 'startAmbience', 'uiTap']);
const FLIGHTS = { none: 0, barge: 1, dive: 2, glide: 3 } as const;
const BUGSTATES = { docked: 0, flying: 1, landed: 2, returning: 3, piloted: 4 } as const;

/** A remote player's intent, fed from their input packets. Edge inputs are kept until used. */
class RemoteController implements Controller {
  last: Msg | null = null;
  private edges = { j: false, c: false, r: false, i: false, tr: false, b: false, ur: false, he: false, d: false };
  private slot = -1;

  receive(m: Msg) {
    this.last = m;
    for (const k of Object.keys(this.edges) as (keyof RemoteController['edges'])[]) if (m[k]) this.edges[k] = true;
    if (typeof m.sl === 'number' && m.sl >= 0) this.slot = m.sl;
  }

  update(a: Actor, ctx: GameCtx) {
    const m = this.last;
    const it = a.intent;
    if (!m) return;
    it.moveX = (m.mx as number) || 0;
    it.moveZ = (m.mz as number) || 0;
    it.aimYaw = (m.ay as number) || 0;
    it.aimPitch = (m.ap as number) || 0;
    const o = m.o as number[], d = m.dd as number[];
    if (o) it.aimOrigin.set(o[0], o[1], o[2]);
    if (d) it.aimDir.set(d[0], d[1], d[2]).normalize();
    it.sprint = !!m.sp;
    it.fire = !!m.f;
    it.ads = !!m.ad;
    it.throwAim = !!m.ta;
    it.utilAim = !!m.ua;
    const e = this.edges;
    it.jump = e.j;
    it.crouch = e.c;
    it.reload = e.r;
    it.throwRelease = e.tr;
    it.blink = e.b;
    it.utilRelease = e.ur;
    it.heal = e.he;
    it.drop = e.d;
    it.slot = this.slot;
    interactContext(a, ctx, e.i, !!m.h, true);
    for (const k of Object.keys(e) as (keyof RemoteController['edges'])[]) e[k] = false;
    this.slot = -1;
  }
}

/** Queues a remote player's personal HUD / sound / camera events to send to them. */
function personalSink(q: unknown[][]): Personal {
  const rec = (kind: string) =>
    new Proxy({}, { get: (_t, name) => (...args: unknown[]) => q.push([kind, String(name), enc(args)]) });
  return {
    hud: rec('h') as HudEvents,
    sfx: rec('s') as Audio,
    shake: (n) => q.push(['c', 'shake', n]),
    hitStop: (d, s) => q.push(['c', 'hitStop', d, s ?? 0.05]),
    slowMo: (s, d) => q.push(['c', 'slowMo', s, d]),
  };
}

/**
 * The LAN host: this browser runs the real match (bots, loot, the Gloom). Remote players become
 * actors driven by their input packets; 20 times a second everyone gets a snapshot of every rascal
 * plus the effects, sounds and loot changes since the last one, and each player gets their own
 * inventory and personal HUD events.
 */
export class HostSession {
  readonly role = 'host';
  remote = new Map<number, { actor: Actor; ctl: RemoteController; q: unknown[][]; member: RoomMember; result: boolean }>();
  private events: unknown[][] = [];
  private mute = 0;
  private snapT = 0;
  private privT = 0;
  private knownCrates = new Set<number>();
  private seenKO = new Set<Actor>();

  constructor(public game: Game, public link: Link, public myId: number) {
    this.install();
    link.on('in', (m) => this.remoteBy(m.from as number)?.ctl.receive(m));
    link.on('hello', (m) => {
      const r = this.remoteBy(m.from as number);
      if (r && typeof m.sp === 'string') r.actor.setSpecies(game.speciesById(m.sp as string), String(m.bn || 'Buzz'));
    });
    link.on('left', (m) => {
      const r = this.remoteBy(m.id as number);
      if (!r) return;
      // they dropped out: a bot takes over so their team isn't left a player short
      game.botify(r.actor);
      this.remote.delete(m.id as number);
      game.hud.toast(`${r.member.name} left — a bot takes over`, '#ffd36b');
    });
  }

  private remoteBy(id: number) {
    return this.remote.get(id);
  }

  /** set up remote rascals for everyone in the room and start the match */
  start(members: RoomMember[], teamSize: number) {
    const g = this.game;
    for (const r of this.remote.values()) g.removeActor(r.actor);
    this.remote.clear();
    this.seenKO.clear();
    this.knownCrates.clear();
    const me = members.find((m) => m.id === this.myId);
    // in a room everyone goes by the name they typed
    if (me) g.player.name = me.name.slice(0, 16) || 'Host';
    for (const m of members) {
      if (m.id === this.myId) continue;
      const q: unknown[][] = [];
      const ctl = new RemoteController();
      const a = g.createRemote(m.name, ctl);
      a.me = personalSink(q);
      a.onRecoil = (p, y, k) => q.push(['c', 'recoil', p, y, k]);
      a.onBlinked = () => q.push(['c', 'blink']);
      a.onLanded = (i) => q.push(['c', 'land', i]);
      this.remote.set(m.id, { actor: a, ctl, q, member: m, result: false });
    }
    // squads: friends who picked the same team number play together, bots fill the gaps
    g.matchCtl.teamPlan = (actors) => {
      if (teamSize <= 1) return;
      const byRoomTeam = new Map<number, Actor[]>();
      const add = (a: Actor, t: number) => {
        let l = byRoomTeam.get(t);
        if (!l) byRoomTeam.set(t, (l = []));
        l.push(a);
      };
      add(g.player, me?.team ?? 0);
      for (const r of this.remote.values()) add(r.actor, r.member.team);
      const bots = actors.filter((a) => !a.me);
      let next = 0;
      for (const list of byRoomTeam.values()) {
        for (let i = 0; i < list.length; i += teamSize) {
          const t = next++;
          const chunk = list.slice(i, i + teamSize);
          for (const a of chunk) a.team = t;
          for (let k = chunk.length; k < teamSize && bots.length; k++) bots.shift()!.team = t;
        }
      }
      for (let i = 0; i < bots.length; i++) bots[i].team = next + Math.floor(i / teamSize);
    };
    g.startMatch(teamSize);
    this.sendRoster();
    this.link.send({ t: 'go' });
  }

  /** who everyone is, so clients can build matching rascals */
  sendRoster() {
    const g = this.game;
    const humans = new Map<Actor, number>();
    humans.set(g.player, this.myId);
    for (const [id, r] of this.remote) humans.set(r.actor, id);
    this.link.send({
      t: 'R',
      ts: g.matchCtl.teamSize,
      a: g.actors.map((a) => ({ id: a.id, n: a.name, l: LOOKS.indexOf(a.rig.look), sp: a.bug.species.id, bn: a.bugName, tm: a.team, h: humans.get(a) ?? 0 })),
    });
  }

  /* ------------------------------------------------------------------ recording */
  private rec(e: unknown[]) {
    if (this.mute === 0) this.events.push(e);
  }

  private install() {
    const g = this.game;
    const muted = () => this.mute > 0;
    tap(g.fx as unknown as Record<string, unknown>, FX_METHODS, (n, a) => this.events.push(['f', n, enc(a)]), muted);
    tap(g.fx.soft as unknown as Record<string, unknown>, ['emit'], (_n, a) => this.events.push(['p', 0, enc(a)]), muted);
    tap(g.fx.glow as unknown as Record<string, unknown>, ['emit'], (_n, a) => this.events.push(['p', 1, enc(a)]), muted);
    // world-space sounds (first argument is a position); personal ones go through each player's channel
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(audio)).filter((n) => !AUDIO_SKIP.has(n));
    const orig = tap(audio as unknown as Record<string, unknown>, names, (n, a) => {
      if (a[0] instanceof THREE.Vector3) this.events.push(['a', n, enc(a)]);
    }, muted);
    // the host's own UI sounds must not be broadcast: give them the untapped originals
    const raw = Object.create(audio) as Record<string, unknown>;
    for (const [n, f] of Object.entries(orig)) raw[n] = f;
    if (g.player.me) g.player.me.sfx = raw as unknown as Audio;
    // announcements go to everyone
    const hud = g.hud;
    g.announce = {
      ...(hud as unknown as HudEvents),
      killfeed: (...a: Parameters<HudEvents['killfeed']>) => {
        hud.killfeed(...a);
        this.rec(['n', 'killfeed', enc(a)]);
      },
      toast: (...a: Parameters<HudEvents['toast']>) => {
        hud.toast(...a);
        this.rec(['n', 'toast', enc(a)]);
      },
      bigToast: (...a: Parameters<HudEvents['bigToast']>) => {
        hud.bigToast(...a);
        this.rec(['n', 'bigToast', enc(a)]);
      },
    } as HudEvents;
    // loot & crates
    const loot = g.loot;
    const spawn = loot.spawn.bind(loot);
    loot.spawn = (...a: Parameters<typeof loot.spawn>) => {
      const p = spawn(...a);
      this.events.push(['L+', p.id, p.kind, p.defId, p.rarity, p.amount, enc(p.pos), enc(p.vel), p.mag]);
      return p;
    };
    const remove = loot.remove.bind(loot);
    loot.remove = (p) => {
      this.events.push(['L-', p.id]);
      remove(p);
    };
    const collect = loot.collect.bind(loot);
    loot.collect = (a, p, ctx) => {
      const r = collect(a, p, ctx);
      if (p.collectT >= 0) this.events.push(['Lc', p.id, a.id]);
      return r;
    };
    const open = loot.openCrate.bind(loot);
    loot.openCrate = (c, a) => {
      const was = c.openT >= 0 || c.opened;
      open(c, a);
      if (!was) this.events.push(['C', c.id, a.id]);
    };
    const reset = loot.resetCrates.bind(loot);
    loot.resetCrates = () => {
      reset();
      this.events.push(['CR']);
    };
    const rmc = loot.removeCrate.bind(loot);
    loot.removeCrate = (c) => {
      this.events.push(['C-', c.id]);
      this.knownCrates.delete(c.id);
      rmc(c);
    };
    for (const c of loot.crates) this.knownCrates.add(c.id);
    // sounds bots hear (and birds scatter from)
    const emit = g.emitSound.bind(g);
    g.emitSound = (e) => {
      emit(e);
      if (e.kind !== 'footstep') this.rec(['s', enc(e.pos), e.loudness, e.kind]);
    };
    // local-only visuals are made on each device itself: don't broadcast them
    const quiet = (o: Record<string, unknown>, n: string) => {
      const f = (o[n] as (...a: unknown[]) => unknown).bind(o);
      o[n] = (...a: unknown[]) => {
        this.mute++;
        try {
          return f(...a);
        } finally {
          this.mute--;
        }
      };
    };
    quiet(g.world as unknown as Record<string, unknown>, 'update');
    quiet(g.birds as unknown as Record<string, unknown>, 'update');
    quiet(g.matchCtl.gloom as unknown as Record<string, unknown>, 'update');
    quiet(g.loot as unknown as Record<string, unknown>, 'update');
  }

  /* ------------------------------------------------------------------ per frame */
  tick(dt: number) {
    const g = this.game;
    // speech bubbles and KO tumbles are replayed on clients
    for (const a of g.actors) {
      if (a.speech && a.speech.t === g.time) this.rec(['y', a.id, a.speech.text, a.speech.color, a.speech.dur]);
      if (a.koT > 0 && !this.seenKO.has(a)) {
        this.seenKO.add(a);
        this.rec(['k', a.id, a.lastHitDir.x, a.lastHitDir.z]);
      } else if (a.koT <= 0) this.seenKO.delete(a);
    }
    for (const c of g.loot.crates) {
      if (this.knownCrates.has(c.id)) continue;
      this.knownCrates.add(c.id);
      this.rec(['C+', c.id, enc(c.pos), c.yaw, !!c.rich]);
    }
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 1 / 20;
    this.link.send({ t: 'S', tm: g.time, m: this.matchState(), a: g.actors.filter((a) => !a.parked).map((a) => this.actorState(a)), ev: this.events });
    this.events = [];
    this.privT -= 1 / 20;
    const priv = this.privT <= 0;
    if (priv) this.privT = 0.1;
    for (const [id, r] of this.remote) {
      if (!priv && !r.q.length) continue;
      this.link.send({ t: 'P', to: id, me: priv ? this.privateState(r.actor) : undefined, q: r.q.splice(0) });
      if (!r.result) this.checkResult(id, r);
    }
  }

  /** tell a remote player when they've won, or their team is out */
  private checkResult(id: number, r: { actor: Actor; result: boolean }) {
    const m = this.game.matchCtl;
    const a = r.actor;
    const teamIn = this.game.actors.some((o) => o.team === a.team && !o.out && !o.parked);
    const teamsLeft = m.teamsLeft();
    if (m.phase === 'live' && teamIn && teamsLeft <= 1) {
      r.result = true;
      this.link.send({ t: 'P', to: id, res: { won: true, place: 1 } });
    } else if ((m.phase === 'live' || m.phase === 'end') && !teamIn && !m.sparks.some((s) => s.owner.team === a.team)) {
      r.result = true;
      this.link.send({ t: 'P', to: id, res: { won: false, place: a.placement || teamsLeft + 1, by: a.lastDamagedBy?.name ?? 'the island' } });
    }
  }

  private actorState(a: Actor): NetActorState {
    const m = a.motor;
    let f = 0;
    if (a.alive) f |= 1;
    if (a.downed) f |= 2;
    if (a.bugout) f |= 4;
    if (m.crouching) f |= 8;
    if (m.sliding) f |= 16;
    if (m.sprinting) f |= 32;
    if (m.grounded) f |= 64;
    if (a.ads) f |= 128;
    if (a.healT >= 0) f |= 512;
    if (a.stealthT > 0) f |= 1024;
    if (a.out) f |= 2048;
    if (a.rig.root.visible) f |= 4096;
    f |= FLIGHTS[a.flight] << 13;
    const w = a.weapon;
    const b = a.bug;
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      id: a.id, x: r(m.pos.x), y: r(m.pos.y), z: r(m.pos.z), vx: r(m.vel.x), vy: r(m.vel.y), vz: r(m.vel.z),
      yaw: r(a.bodyYaw), pitch: r(a.intent.aimPitch), f, hp: Math.round(a.hp), dh: Math.round(a.downHp), rk: r(a.reviveK),
      w: w ? `${w.def.id}:${w.rarity}` : '', em: a.emote ?? '', bs: BUGSTATES[b.state], bx: r(b.pos.x), by: r(b.pos.y), bz: r(b.pos.z),
      bt: a.bugout ? r(a.bugout.t) : undefined, bh: a.bugout ? Math.round(a.bugout.hp) : undefined,
    };
  }

  private matchState() {
    const g = this.game;
    const m = g.matchCtl;
    const gl = m.gloom;
    const tm = gl.timer();
    const b = m.barge;
    return {
      ph: m.phase, lt: m.lobbyLeft(), jn: m.joinedCount(), ts: m.teamSize, rem: m.remaining, tl: m.teamsLeft(),
      b: b.active ? [b.pos.x, b.pos.y, b.pos.z, b.yaw, b.vel.x, b.vel.z, b.progress, b.start.x, b.start.z, b.end.x, b.end.z] : null,
      cd: m.canDrop, lc: m.lastCallNow(), bk: m.bargeK(),
      gl: [gl.state, gl.phase, gl.center.x, gl.center.y, gl.radius, gl.nextC.x, gl.nextC.y, gl.nextR, tm.label, Math.round(tm.t)],
      ne: g.world.nests.map((n) => (n.used ? 1 : 0)).join(''),
      sp: m.sparks.map((s) => [s.owner.id, enc(s.pos), s.carrier ? s.carrier.id : 0, Math.round(s.rebuildK * 100) / 100]),
      hot: m.hotDrops.map((h) => enc(h.pos)),
      bal: m.balloonMarks(),
    };
  }

  private privateState(a: Actor) {
    const b = a.bug;
    return {
      w: a.weapons.map((w) => (w ? [w.def.id, w.rarity, w.mag, w.reloading ? 1 : 0, Math.round(w.reloadT * 100) / 100, Math.round(w.reloadTime * 100) / 100, Math.round(w.bloom * 100) / 100] : null)),
      sl: a.activeSlot,
      am: a.ammo,
      ut: a.util ? [a.util.id, a.util.count] : null,
      he: a.healItem ? [a.healItem.id, a.healItem.count] : null,
      ht: Math.round(a.healT * 100) / 100,
      bug: [Math.round(b.cooldown * 10) / 10, Math.round(b.cooldownMax * 10) / 10, Math.round(b.window * 10) / 10],
      st: [a.kills, Math.round(a.damageDealt), a.blinks, Math.round(a.distance), a.fusions, a.bestRarity, a.revives, a.placement],
      wd: a.weaponDamage,
    };
  }

  close() {
    this.link.close();
  }
}
