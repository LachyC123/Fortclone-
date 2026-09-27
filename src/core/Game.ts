import * as THREE from 'three';
import { Renderer, Quality, QUALITY_PRESETS } from '../render/Renderer';
import { detail } from '../render/Detail';
import { FX } from '../fx/FX';
import { World } from '../world/World';
import { LootSystem, rollWeapon, ammoFor, rollFloor, rollConsumable } from '../loot/Loot';
import { NavGrid } from '../world/NavGrid';
import { Actor, Controller } from '../entities/Actor';
import type { HostSession } from '../net/Host';
import type { ClientSession } from '../net/Client';
import { LOOKS, HAT_COLOR } from '../entities/RascalRig';
import { Input } from './Input';
import { CameraRig } from '../camera/CameraRig';
import { PlayerController } from '../player/PlayerController';
import { BotController, PROFILES, Archetype } from '../ai/BotBrain';
import { HUD } from '../ui/HUD';
import { TouchControls } from '../ui/Touch';
import { GameCtx, SoundEvent, HudEvents } from './types';
import { audio } from '../audio/Audio';
import { Menus, Settings, loadSettings, saveSettings } from '../ui/Menus';
import { BUG } from '../entities/Blinkbug';
import { PAL, RarityIndex } from '../render/Palette';
import { pick, rand } from './math';
import { WEAPONS, AMMO_INFO, AmmoType } from '../combat/Weapons';
import { CollisionWorld, ColFlags } from '../physics/Collision';
import { Throwables } from '../combat/Throwables';
import { Training } from '../tutorial/Training';
import { geoStats } from '../render/GeoKit';
import { loadProfile, Match } from './Match';
import { loadTrophies, TrophyState } from '../progression/Trophies';
import { BurrowState, loadBurrow, saveBurrow } from '../progression/Burrow';
import type { RascalLook, HatKind } from '../entities/RascalRig';
import { Bubbles } from '../fx/Bubbles';
import { Birds } from '../fx/Birds';
import type { EmoteKind } from '../entities/RascalRig';
import { ISLAND_R, ISLAND_MAX, POIS } from '../world/Heightmap';
import { SPECIES_BY_ID, Collection, loadCollection, saveCollection, randomBugName, randomSpecies } from '../progression/Bugs';

const BOT_NAMES = ['MuffinKing', 'CrankyPete', 'PickleWizard', 'Socks', 'BigDave', 'Nibbles', 'Toast McGee', 'Captain Crumb', 'Wobbles', 'Dame Pudding', 'Sir Bonk', 'Lil Gravy', 'Doodlebug', 'Mrs. Kettle', 'Parsnip', 'Grumbo', 'Beans4Brains', 'Noodle', 'Gran Turbo', 'Mr. Wiggles', 'SoggyWaffle', 'Pip', 'Honk', 'Tater Tot', 'Lady Fizz', 'Gloomzilla', 'Crumpet', 'Bop'];

/**
 * Top-level orchestrator. Holds the shared GameCtx, runs the frame loop in a fixed order and
 * owns match/session flow (title -> play -> eliminated -> respawn for the Milestone 1 playground).
 */
export class Game implements GameCtx {
  r: Renderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fx: FX;
  world: World;
  cw: CollisionWorld;
  loot: LootSystem;
  nav: NavGrid;
  actors: Actor[] = [];
  hud: HUD;
  time = 0;
  sounds: SoundEvent[] = [];
  localActor: Actor | null = null;
  throwables: Throwables;
  input: Input;
  camRig: CameraRig;
  player!: Actor;
  pc!: PlayerController;
  touch: TouchControls;
  menus: Menus;
  settings: Settings;
  private lastT = performance.now();
  private running = false;
  private paused = true;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private respawnT = -1;
  private lootTimer = 20;
  private crateCycle = 0;
  private botRespawn = new Map<Actor, number>();
  private autoQualityT = 6;
  private lowFpsTime = 0;
  private titleOrbit = 0;
  bubbles: Bubbles;
  /** everyone's messages (kill feed, match announcements); a LAN host also sends these to clients */
  announce!: HudEvents;
  /** the tier the geometry was built at (detail changes need a reload) */
  bootQuality: Quality;
  birds: Birds;
  private emoteIdx = 0;
  /** the battle royale in progress (null in the playground / on the title screen) */
  match: Match | null = null;
  matchCtl!: Match;
  mode: 'none' | 'playground' | 'match' | 'net' | 'training' = 'none';
  /** first-play training on Launch Isle */
  training: Training | null = null;
  /** your Blinkbug collection (saved locally) */
  collection: Collection = loadCollection();
  /** Trophy Road progress */
  trophies: TrophyState = loadTrophies();
  /** your Burrow: glimmer, buildings, incubators, relics (saved) */
  burrow: BurrowState = loadBurrow();
  /** test hook: fixed camera for visual review */
  debugCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.r = new Renderer(canvas, this.settings.quality);
    // geometry detail is baked at boot from the quality tier (phones get lighter rascals and props)
    const qp = QUALITY_PRESETS[this.settings.quality];
    detail.model = qp.model;
    detail.lite = qp.lite;
    detail.cull = qp.cull;
    this.bootQuality = this.settings.quality;
    this.scene = this.r.scene;
    this.camera = this.r.camera;
    this.world = null as unknown as World;
    this.fx = null as unknown as FX;
    // World needs FX at runtime and FX needs the world's collision: build world first, then bind
    const tw = performance.now();
    this.world = new World(this.scene, null as unknown as FX);
    const tw2 = performance.now();
    this.cw = this.world.cw;
    this.fx = new FX(this.scene, this.cw, QUALITY_PRESETS[this.settings.quality].particles);
    (this.world as unknown as { fx: FX }).fx = this.fx;
    this.loot = new LootSystem(this.scene, this.cw);
    this.throwables = new Throwables(this.scene);
    this.nav = new NavGrid(this.cw, ISLAND_MAX + 3);
    // doors swing open for anyone who approaches, so bake the nav mesh with them open
    for (const d of this.world.doors) d.collider.enabled = false;
    this.nav.bake();
    for (const d of this.world.doors) d.collider.enabled = true;
    if (location.search.includes('timing')) console.log(`[t] world ${(tw2 - tw).toFixed(0)}ms nav ${(performance.now() - tw2).toFixed(0)}ms`);

    this.bubbles = new Bubbles(this.scene);
    this.birds = new Birds(this.scene, this.cw, this.fx);
    this.birds.reset();
    this.fx.onCasingLand = (p) => audio.casing(p);
    this.input = new Input(canvas);
    this.camRig = new CameraRig(this.camera, this.cw);
    this.hud = new HUD(this.camera);
    this.announce = this.hud;
    this.hud.setMapBase(this.world);
    this.touch = new TouchControls(this.input);
    this.menus = new Menus(this);
    this.applySettings();

    this.createPlayer();
    // playground: a few rascals so fights break out without you
    this.createBot('aggressive');
    this.createBot('cautious');
    this.createBot('chaotic');
    for (const s of this.world.lootSpots) this.spawnLootSpot(s);
    for (const c of this.world.crateSpots) this.loot.placeCrate(c.pos, c.yaw);
    this.matchCtl = new Match(this);
    this.matchCtl.ui.setVisible(false);

    this.hud.onPlayerEliminated = (by) => {
      this.respawnT = 3.5;
      this.menus.showEliminated(by);
    };
    this.hud.onSlotTap = (i) => (this.input.s.slotPressed = i);
    this.hud.onItemTap = (kind, down) => {
      if (kind === 'heal') {
        if (down) this.input.s.healPressed = true;
      } else if (down) this.input.s.utilHeld = true;
      else if (this.input.s.utilHeld) {
        this.input.s.utilHeld = false;
        this.input.s.utilReleased = true;
      }
    };
    this.touch.onPause = () => this.pause();
    this.hud.onEmote = (k) => this.playerEmote(k);
    window.addEventListener('resize', () => this.fx.onResize(window.innerHeight * this.r.renderer.getPixelRatio(), this.camera.fov));
    this.fx.onResize(window.innerHeight * this.r.renderer.getPixelRatio(), this.camera.fov);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.paused) this.pause();
    });
    (window as unknown as { __game: Game }).__game = this;
    (window as unknown as { __geo: unknown }).__geo = geoStats;
  }

  /* ------------------------------------------------------------------ setup */

  private createPlayer() {
    const own = this.collection.bugs.find((b) => b.species === this.collection.equipped)!;
    const p = new Actor('You', this.playerLook(), this, SPECIES_BY_ID[own.species], own.name);
    p.bug.setLevel(own.level ?? 1);
    p.isLocal = true;
    p.me = {
      hud: this.hud,
      sfx: audio,
      shake: (n) => this.shake(n),
      hitStop: (d, s) => this.hitStop(d, s),
      slowMo: (s, d) => this.slowMo(s, d),
    };
    this.pc = new PlayerController(this.input, this.camRig, this.scene);
    p.controller = this.pc;
    p.onRecoil = (pitch, yaw, kick) => {
      this.camRig.kick(pitch, yaw);
      this.camRig.shake(kick * 0.35);
    };
    p.onBlinked = () => {
      this.camRig.blink();
      this.hud.blink();
      this.camRig.shake(0.15);
    };
    p.onLanded = (impact) => {
      this.camRig.land(impact);
      if (impact > 14) this.camRig.shake(0.2);
    };
    this.player = p;
    this.localActor = p;
    this.actors.push(p);
    const sp = this.world.playerSpawns[0];
    p.spawn(sp.pos, sp.yaw);
    p.ammo.medium = 30;
    this.camRig.snapTo(p);
    this.camRig.yaw = sp.yaw;
  }

  createBot(archetype?: Archetype) {
    const arch = archetype ?? pick(['aggressive', 'cautious', 'goblin', 'chaotic'] as Archetype[]);
    const used = new Set(this.actors.map((a) => a.name));
    const name = BOT_NAMES.find((n) => !used.has(n) && Math.random() < 0.4) ?? BOT_NAMES.find((n) => !used.has(n)) ?? 'Rascal';
    const look = LOOKS[1 + Math.floor(Math.random() * (LOOKS.length - 1))];
    const a = new Actor(name, look, this, randomSpecies(), randomBugName());
    const brain = new BotController(PROFILES[arch]);
    a.controller = brain;
    a.onDamaged = (from, ctx) => brain.onDamaged(a, from, ctx);
    this.actors.push(a);
    this.spawnBot(a);
    return a;
  }

  /* ------------------------------------------------------------------ LAN */

  /** a LAN session: this device hosts the match, or is a client of someone else's */
  net: HostSession | ClientSession | null = null;

  /** LAN client: the match runs on the host — clear the local world state and just present */
  enterNetClient() {
    this.mode = 'net';
    this.match = null;
    this.matchCtl.ui.setVisible(true);
    this.matchCtl.ui.hideSummary();
    this.matchCtl.ui.knocked(false);
    this.matchCtl.ui.spectating('', false);
    this.matchCtl.gloom.reset();
    this.matchCtl.clearBalloons();
    this.matchCtl.resetForNet();
    this.pc.remote = true;
    for (const p of [...this.loot.pickups]) this.loot.remove(p);
    this.loot.resetCrates();
    for (const c of this.loot.crates) c.netOnly = true;
    this.respawnT = -1;
    this.play();
  }

  /** LAN client: drop every local rascal (the host's roster replaces them) */
  clearActorsForNet() {
    for (const a of this.actors) a.dispose(this);
    this.actors.length = 0;
  }

  /** LAN client: this puppet is you */
  adoptLocalPlayer(a: Actor) {
    a.isLocal = true;
    a.me = { hud: this.hud, sfx: audio, shake: (n) => this.shake(n), hitStop: (d, s) => this.hitStop(d, s), slowMo: (s, d) => this.slowMo(s, d) };
    this.player = a;
    this.localActor = a;
    this.camRig.snapTo(a);
  }

  /** a LAN client's frame: input -> host, snapshots -> puppets, then the usual presentation */
  private clientFrame(dt: number) {
    const net = this.net as ClientSession;
    net.frame(dt);
    this.loot.update(dt, this);
    this.world.update(dt, this.actors, this.camera.position);
    if (this.input.s.emotePressed) {
      const kinds: EmoteKind[] = ['dance', 'wave', 'laugh', 'flex'];
      this.playerEmote(kinds[this.emoteIdx++ % kinds.length]);
    }
    this.bubbles.update(this.actors, this.camera, this.time);
    this.birds.update(dt, this.time, this.camera.position, this.actors, this.sounds);
    const p = this.player;
    const spec = p.out ? net.spectate() : null;
    if (p.alive || p.bugout) {
      const w = p.weapon;
      this.camRig.update(dt, p, p.alive && p.ads && w ? w.def.adsFov : null);
    } else if (spec) {
      this.camRig.yaw += dt * 0.25;
      this.camRig.update(dt, spec, null);
    } else {
      this.camera.position.y += dt * 1.5;
      this.camera.lookAt(p.motor.pos);
    }
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.indoor = this.world.zoneAt(p.motor.pos)?.indoor ? 1 : 0;
    audio.setListener(this.camera.position, _right);
    audio.setWind(Math.max(0, (p.motor.horizontalSpeed() - 7) / 8) + (p.flight === 'dive' ? 1 : 0));
    const fog = this.scene.fog as THREE.Fog;
    const fk = Math.min(1, Math.max(0, (this.camera.position.y - 18) / 40));
    const dd = Math.min(230, this.world.drawDist * 1.05);
    fog.near = dd * 0.26 + fk * 150;
    fog.far = dd + fk * 260;
    this.fx.update(dt, this.camera);
    this.r.followShadows(p.motor.pos);
    const w = p.weapon;
    const spread = w ? (p.ads ? w.def.spreadAds : w.def.spreadHip) + w.bloom + (p.motor.horizontalSpeed() > 1 ? w.def.spreadMove : 0) : 0;
    this.hud.squadPrompt = p.alive ? this.pc.contextSquad : null;
    this.hud.squad = net.teamSize > 1 && net.m?.ph !== 'lobby' ? { sparks: net.sparks } : null;
    this.hud.update(dt, p, this.actors, p.alive ? this.pc.contextPickup : null, spread, this.fps, this.input.s.touchActive, this.world, p.alive ? this.pc.contextCrate : null);
    this.touch.updateVisuals(p.bug, p.bug.stats.window, !!(this.pc.contextPickup || this.pc.contextCrate || this.pc.contextSquad), p);
    this.hud.root.classList.toggle('flying', p.flight !== 'none' || !!p.bugout);
    this.hud.root.classList.toggle('lobby', net.m?.ph === 'lobby');
    this.hud.root.classList.toggle('ended', this.matchCtl.summaryShown);
    if (this.sounds.length) this.sounds = this.sounds.filter((s) => this.time - s.time < 1);
  }

  /** leave any LAN session (back to single player) */
  leaveNet() {
    const n = this.net;
    this.net = null;
    n?.close();
    this.pc.remote = false;
    this.matchCtl.teamPlan = null;
  }

  speciesById(id: string) {
    return SPECIES_BY_ID[id] ?? SPECIES_BY_ID.zippit;
  }

  /** LAN host: a rascal for a friend on another device, driven by their input packets */
  createRemote(name: string, ctl: Controller) {
    const look = LOOKS[1 + Math.floor(Math.random() * (LOOKS.length - 1))];
    const a = new Actor(name.slice(0, 16) || 'Rascal', look, this, randomSpecies(), randomBugName());
    a.controller = ctl;
    // right after the host so they're active in the lobby straight away; a bot makes room
    this.actors.splice(1, 0, a);
    const MAX = 24;
    while (this.actors.length > MAX) {
      const bot = [...this.actors].reverse().find((x) => !x.me && x !== this.player && !(x.controller && !(x.controller instanceof BotController)));
      if (!bot) break;
      this.removeActor(bot);
    }
    return a;
  }

  removeActor(a: Actor) {
    a.dispose(this);
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
  }

  /** a friend dropped out mid-match: a bot takes over their rascal */
  botify(a: Actor) {
    a.me = null;
    a.onRecoil = a.onBlinked = a.onLanded = null;
    const brain = new BotController(PROFILES.cautious);
    a.controller = brain;
    a.onDamaged = (from, ctx) => brain.onDamaged(a, from, ctx);
  }

  private spawnBot(a: Actor) {
    const sp = pick(this.world.botSpawns);
    a.spawn(sp.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))), rand(-3, 3));
    a.weapons = [null, null, null];
    for (const t of Object.keys(a.ammo) as AmmoType[]) a.ammo[t] = 0;
    a.util = null;
    a.healItem = null;
    // playground bots arrive with a random kit so every fight feels different
    const w = rollWeapon();
    a.giveWeapon(w.defId, w.rarity, 0, true);
    a.addAmmo(WEAPONS[w.defId].ammo, AMMO_INFO[WEAPONS[w.defId].ammo].pickup * 3);
    if (Math.random() < 0.6) a.addItem('heal', Math.random() < 0.7 ? 'fizzle' : 'jamjar', 2);
    if (Math.random() < 0.6) a.addItem('util', pick(['fizzbomb', 'stickypop', 'chicken', 'gust', 'bouncejam']), 2);
    if (a.controller instanceof BotController) {
      a.controller.state = 'wander';
      a.controller.target = null;
    }
    // drop in from the sky with a little puff so respawns read clearly
    a.motor.pos.y += 14;
    this.fx.sparkBurst(a.motor.pos, PAL.mustard, 10);
  }

  private spawnLootSpot(s: { pos: THREE.Vector3; kind: 'weapon' | 'ammo' }) {
    // on the big island guns are the thing everyone needs first: plenty of floor spots roll one
    const gun = s.kind === 'weapon' || Math.random() < 0.6;
    const rolls = gun ? (() => {
      const w = rollWeapon();
      return [w, ammoFor(w.defId, 2)];
    })() : rollFloor();
    this.loot.spawnRolls(rolls, s.pos);
  }

  /* ------------------------------------------------------------------ GameCtx */

  emitSound(e: Omit<SoundEvent, 'time'>) {
    this.sounds.push({ ...e, time: this.time });
  }

  sightClear(a: THREE.Vector3, b: THREE.Vector3) {
    return this.cw.lineClear(a, b, ColFlags.BlocksSight) && !this.throwables.smokeBlocks(a, b);
  }

  shake(amount: number) {
    if (amount > 0) this.camRig.shake(amount);
  }

  /** test hook: stop the real-time loop simulating (debugStep still works) */
  freeze = false;

  // ---- time control (juice): applied to the real-time frame only, never to debugStep
  private stopT = 0;
  private stopScale = 0.05;
  private slowT = 0;
  private slowDur = 1;
  private slowScale = 1;
  hitStop(dur: number, scale = 0.05) {
    this.camRig.punch(dur * 45);
    if (dur > this.stopT) {
      this.stopT = dur;
      this.stopScale = scale;
    }
  }
  slowMo(scale: number, dur: number) {
    this.slowScale = scale;
    this.slowT = dur;
    this.slowDur = dur;
  }
  private timeScale(realDt: number) {
    let k = 1;
    if (this.slowT > 0) {
      this.slowT -= realDt;
      // hold, then ease back to full speed over the last 40%
      const u = Math.max(0, this.slowT) / this.slowDur;
      k = u > 0.4 ? this.slowScale : this.slowScale + (1 - this.slowScale) * (1 - u / 0.4);
    }
    if (this.stopT > 0) {
      this.stopT -= realDt;
      k = Math.min(k, this.stopScale);
    }
    return k;
  }

  /* ------------------------------------------------------------------ flow */

  start() {
    this.running = true;
    this.lastT = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  playerEmote(kind: EmoteKind) {
    if (this.net?.role === 'client') (this.net as ClientSession).sendEmote(kind);
    const p = this.player;
    if (!p.alive || p.flight !== 'none') return;
    p.startEmote(kind, 3);
    audio.uiTap();
  }

  /** Equip a bug from the collection on your rascal. */
  equipBug(speciesId: string) {
    const own = this.collection.bugs.find((b) => b.species === speciesId);
    if (!own) return;
    this.collection.equipped = speciesId;
    saveCollection(this.collection);
    this.player.setSpecies(SPECIES_BY_ID[own.species], own.name, own.level ?? 1);
  }

  /** GameCtx: someone scooped up a Rift Relic */
  onRelic(a: Actor, id: string) {
    if (this.match) this.matchCtl.onRelic(a, id);
  }

  /** your rascal's look: the classic outfit, plus any hat you've unlocked with a relic set */
  playerLook(): RascalLook {
    const hat = this.burrow.hat as HatKind;
    return hat ? { ...LOOKS[0], hat, hatColor: HAT_COLOR[hat] ?? LOOKS[0].hatColor } : LOOKS[0];
  }

  /** put on a different hat (between matches) */
  wearHat(hat: string) {
    this.burrow.hat = hat;
    saveBurrow(this.burrow);
    if (this.mode === 'none') this.player.setLook(this.playerLook());
  }

  saveCollection() {
    saveCollection(this.collection);
    const own = this.collection.bugs.find((b) => b.species === this.collection.equipped);
    if (own) this.player.bugName = own.name;
  }

  /** Title screen PLAY: into Launch Isle for a real match. */
  /** team size for the next match (1 solo, 2 duos, 3 trios, 4 squads) */
  teamSize = 1;

  /** roomTrophies: LAN rooms play at the arena of everyone's average trophies */
  startMatch(teamSize = this.teamSize, roomTrophies: number | null = null) {
    if (this.mode === 'training') this.leaveTraining();
    this.matchCtl.roomTrophies = roomTrophies;
    this.teamSize = teamSize;
    this.mode = 'match';
    this.match = this.matchCtl;
    this.matchCtl.teamSize = teamSize;
    this.matchCtl.ui.setVisible(true);
    this.respawnT = -1;
    this.botRespawn.clear();
    this.matchCtl.startLobby();
    this.play();
  }

  /** Practice: the respawning combat playground from Milestones 1–2. */
  startPlayground() {
    if (this.mode === 'match') this.leaveMatch();
    if (this.mode === 'training') this.leaveTraining();
    this.mode = 'playground';
    this.play();
  }

  private leaveMatch() {
    this.match = null;
    this.matchCtl.ui.setVisible(false);
    this.matchCtl.ui.hideSummary();
    this.matchCtl.gloom.reset();
    this.matchCtl.clearBalloons();
    this.matchCtl.barge.active = false;
    this.matchCtl.barge.group.visible = false;
    // back to a small playground crew
    while (this.actors.length > 4) {
      const a = this.actors.pop()!;
      a.dispose(this);
    }
    this.resetWorldForMatch();
    for (const a of this.actors) {
      a.parked = false;
      a.flight = 'none';
      if (a !== this.player) this.spawnBot(a);
    }
    this.respawnPlayer();
  }

  /** has this player done (or skipped) the training yet? (anyone who has played a match has) */
  get trained() {
    try {
      if (localStorage.getItem('rr.trained') === '1') return true;
      const prof = JSON.parse(localStorage.getItem('rr.profile') || '{}') as { matches?: number };
      return (prof.matches ?? 0) > 0 || this.collection.bugs.length > 1;
    } catch {
      return true;
    }
  }

  /** a newer save arrived (cloud save on claude.ai): pick everything up again from storage */
  reloadSave() {
    this.collection = loadCollection();
    this.settings = loadSettings();
    this.applySettings();
    this.matchCtl.profile = loadProfile();
    this.trophies = loadTrophies();
    this.burrow = loadBurrow();
    const own = this.collection.bugs.find((b) => b.species === this.collection.equipped);
    if (own && this.mode === 'none') {
      this.player.setSpecies(SPECIES_BY_ID[own.species], own.name, own.level ?? 1);
      this.player.setLook(this.playerLook());
    }
    this.menus.refreshProfile();
  }

  /** Training on Launch Isle: everyone else steps aside, then a tick-list of the controls. */
  startTraining() {
    if (this.mode === 'match') this.leaveMatch();
    if (this.training) this.leaveTraining();
    this.mode = 'training';
    for (const a of this.actors) {
      if (a === this.player) continue;
      a.parked = true;
      a.alive = false;
      a.rig.root.visible = false;
      a.bug.root.visible = false;
      a.motor.teleport(new THREE.Vector3(0, -500, 0));
    }
    const c = this.world.lobby.center;
    const p = this.player;
    p.spawn(new THREE.Vector3(c.x, c.y + 0.05, c.z + 5), 0);
    p.weapons = [null, null, null];
    p.equip(0, true);
    for (const t of Object.keys(p.ammo) as AmmoType[]) p.ammo[t] = 0;
    p.util = null;
    p.healItem = null;
    for (const pk of [...this.loot.pickups]) if (pk.pos.distanceTo(c) < 30) this.loot.remove(pk);
    this.throwables.clear();
    this.camRig.snapTo(p);
    this.camRig.yaw = 0;
    this.camRig.pitch = -0.12;
    this.training = new Training(this, (then) => {
      if (then === 'play') this.startMatch();
      else this.goHome();
    });
    this.play();
  }

  private leaveTraining() {
    this.training?.dispose();
    this.training = null;
    this.mode = 'none';
    for (const pk of [...this.loot.pickups]) if (pk.pos.distanceTo(this.world.lobby.center) < 30) this.loot.remove(pk);
    this.throwables.clear();
    for (const a of this.actors) {
      if (a === this.player) continue;
      a.parked = false;
      a.flight = 'none';
      this.spawnBot(a);
    }
    this.respawnPlayer();
  }

  goHome() {
    if (this.mode === 'match') this.leaveMatch();
    if (this.mode === 'training') this.leaveTraining();
    this.mode = 'none';
    this.paused = true;
    this.input.enabled = false;
    document.exitPointerLock?.();
    this.hud.root.classList.add('hidden');
    this.menus.showTitle();
  }

  /** Fresh loot, closed crates and recharged Rift Nests. */
  resetWorldForMatch() {
    this.birds.reset();
    for (const p of [...this.loot.pickups]) this.loot.remove(p);
    for (const s of this.world.lootSpots) this.spawnLootSpot(s);
    // every place (and the wild land between them) gets guns on the ground and spare ammo,
    // so wherever you land there's something to fight with
    const drop = (x: number, z: number, r: number, gun: boolean) => {
      const p = this.nav.randomWalkable(Math.random, x, z, r);
      if (!p) return;
      p.y += 0.05;
      if (gun) {
        const w = rollWeapon();
        this.loot.spawnRolls([w, ammoFor(w.defId, 2)], p);
      } else this.loot.spawnRolls([ammoFor(pick(['tincan', 'rattle', 'poppistol', 'needler', 'broomstick'])), ammoFor(pick(['tincan', 'rattle', 'pepperbox']))], p);
    };
    // snacks & gadgets: every place has a few, so a fight can be patched up after
    const treat = (x: number, z: number, r: number) => {
      const p = this.nav.randomWalkable(Math.random, x, z, r);
      if (p) this.loot.spawnRolls([rollConsumable()], p.setY(p.y + 0.05));
    };
    for (const poi of POIS) {
      for (let i = 0; i < 10; i++) drop(poi.x, poi.z, poi.r, i < 5);
      for (let i = 0; i < 4; i++) treat(poi.x, poi.z, poi.r);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = 45 + Math.random() * 45;
      drop(Math.cos(a) * d, Math.sin(a) * d, 8, i < 14);
      if (i % 2 === 0) treat(Math.cos(a) * d, Math.sin(a) * d, 8);
    }
    this.loot.resetCrates();
    for (const n of this.world.nests) {
      n.used = false;
      n.fx.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m && m.color && o.userData.baseColor !== undefined) m.color.setHex(o.userData.baseColor);
      });
    }
  }

  play() {
    if (this.mode === 'none') this.mode = 'playground';
    audio.unlock();
    this.paused = false;
    this.menus.hideAll();
    this.input.enabled = true;
    if (!this.input.s.touchActive) this.r.renderer.domElement.requestPointerLock?.();
    this.hud.root.classList.remove('hidden');
    this.lastT = performance.now();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.input.enabled = false;
    this.input.s.fire = false;
    this.input.s.throwHeld = false;
    document.exitPointerLock?.();
    this.menus.showPause();
  }

  get isPaused() {
    return this.paused;
  }

  applySettings() {
    const s = this.settings;
    if (this.r.quality !== s.quality) this.r.applyQuality(s.quality);
    this.fx?.setParticleLimit(QUALITY_PRESETS[s.quality].particles);
    if (this.world) {
      this.world.drawDist = QUALITY_PRESETS[s.quality].drawDist;
      this.world.smallDist = QUALITY_PRESETS[s.quality].smallDist;
      this.world.setPropShadows(s.quality === 'high');
    }
    this.camRig.sensitivity = s.sensitivity;
    this.touch.sensitivity = s.sensitivity;
    this.camRig.baseFov = s.fov;
    audio.setVolume(s.volume);
    this.hud.showFps = s.showFps;
    if (this.pc) {
      this.pc.settings.aimAssist = s.aimAssist;
      this.pc.settings.autoFire = s.autoFire;
    }
    saveSettings(s);
  }

  respawnPlayer() {
    const p = this.player;
    const sp = this.world.playerSpawns[0];
    p.spawn(sp.pos.clone().setY(sp.pos.y + 12), sp.yaw);
    p.weapons = [null, null, null];
    p.equip(0, true);
    p.ammo.medium = 30;
    this.camRig.snapTo(p);
    this.camRig.yaw = sp.yaw;
    this.camRig.pitch = -0.15;
    this.menus.hideAll();
    this.respawnT = -1;
    // make sure there's a gun to grab near spawn
    if (!this.loot.pickups.some((pk) => pk.kind === 'weapon' && pk.pos.distanceTo(sp.pos) < 10)) this.spawnLootSpot(this.world.lootSpots[0]);
  }

  /* ------------------------------------------------------------------ frame */

  private frame() {
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    // fps meter
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.autoQuality();
    }
    dt = Math.min(dt, 1 / 25);

    if (this.freeze) {
      // test hook: hold the simulation still and just draw (screenshots of transient FX)
      if (this.debugCam) {
        this.camera.position.copy(this.debugCam.pos);
        this.camera.lookAt(this.debugCam.target);
      }
      this.r.render();
      return;
    }

    if (this.paused && this.menus.burrow?.isOpen) {
      // your Burrow has its own little world
      this.menus.burrow.tick(dt);
      this.input.endFrame();
      return;
    }
    if (this.paused) {
      // attract mode: slow orbit around the square behind the title
      this.titleOrbit += dt * 0.08;
      const r = 30;
      this.camera.position.set(Math.sin(this.titleOrbit) * r, 14 + Math.sin(this.titleOrbit * 0.7) * 2, Math.cos(this.titleOrbit) * r);
      this.camera.lookAt(0, 3, -6);
      this.world.update(dt, this.actors, this.camera.position);
      this.birds.update(dt, performance.now() / 1000, this.camera.position, [], []);
      this.fx.update(dt, this.camera);
      for (const a of this.actors) if (a.alive) a.bug.update(0);
      this.r.followShadows(new THREE.Vector3(0, 0, -4));
      this.r.render();
      this.input.endFrame();
      return;
    }

    this.input.poll();
    if (this.input.s.pausePressed) {
      this.pause();
      this.input.endFrame();
      return;
    }
    if (this.net?.role === 'client') this.clientFrame(dt * this.timeScale(dt));
    else this.simulate(dt * this.timeScale(dt));
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.lookAt(this.debugCam.target);
    }
    this.r.render();
    this.input.endFrame();
  }

  /** Test hook: advance the simulation deterministically (no rendering) — used by the smoke test. */
  debugStep(frames: number, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) {
      this.input.poll();
      this.simulate(dt);
      this.input.endFrame();
    }
  }

  private simulate(dt: number) {
    this.time += dt;
    this.nav.budget = 3;

    // --- simulation
    for (const a of this.actors) a.update(dt, this);
    this.loot.update(dt, this);
    this.throwables.update(dt, this);
    this.world.update(dt, this.actors, this.camera.position);

    this.match?.update(dt);
    if (this.input.s.emotePressed) {
      const kinds: EmoteKind[] = ['dance', 'wave', 'laugh', 'flex'];
      this.playerEmote(kinds[this.emoteIdx++ % kinds.length]);
    }
    this.bubbles.update(this.actors, this.camera, this.time);
    this.birds.update(dt, this.time, this.camera.position, this.actors, this.sounds);

    // camera & listener
    const p = this.player;
    const spec = this.match && p.out ? this.match.spectateTarget() : null;
    if (p.alive || p.bugout) {
      const w = p.weapon;
      this.camRig.update(dt, p, p.alive && p.ads && w ? w.def.adsFov : null);
    } else if (spec && !this.match!.summaryShown) {
      // watch whoever is still fighting (usually the rascal who got you)
      this.camRig.yaw += dt * 0.25;
      this.camRig.update(dt, spec, null);
    } else {
      // slow drift up while eliminated
      this.camera.position.y += dt * 1.5;
      this.camera.lookAt(p.motor.pos);
    }
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const zone = this.world.zoneAt(p.motor.pos);
    audio.indoor = zone?.indoor ? 1 : 0;
    audio.setListener(this.camera.position, _right);
    audio.setWind(Math.max(0, (p.motor.horizontalSpeed() - 7) / 8) + (p.motor.airTime > 0.5 ? Math.min(1, -p.motor.vel.y / 30) : 0));

    // thin the haze with altitude so the whole island reads from the Sky Barge
    const fog = this.scene.fog as THREE.Fog;
    const fk = Math.min(1, Math.max(0, (this.camera.position.y - 18) / 40));
    // lower tiers draw less far, so the haze closes in to match (and hides the cut-off)
    const dd = Math.min(230, this.world.drawDist * 1.05);
    fog.near = dd * 0.26 + fk * 150;
    fog.far = dd + fk * 260;
    this.fx.update(dt, this.camera);
    this.r.followShadows(p.motor.pos);

    // HUD
    const w = p.weapon;
    const spread = w ? (p.ads ? w.def.spreadAds : w.def.spreadHip) + w.bloom + (p.motor.horizontalSpeed() > 1 ? w.def.spreadMove : 0) : 0;
    this.hud.squadPrompt = p.alive ? this.pc.contextSquad : null;
    this.hud.squad = this.match && this.match.teamSize > 1 && this.match.phase !== 'lobby' ? { sparks: this.match.sparks } : null;
    this.hud.update(dt, p, this.actors, p.alive ? this.pc.contextPickup : null, spread, this.fps, this.input.s.touchActive, this.world, p.alive ? this.pc.contextCrate : null);
    this.touch.updateVisuals(p.bug, p.bug.stats.window, !!(this.pc.contextPickup || this.pc.contextCrate || this.pc.contextSquad), p);
    if (this.match && p.downed) this.match.ui.knockedBleed(p.downHp / 100, p.reviveK);

    if (this.match) {
      const gl = this.match.gloom;
      const who = spec ?? p;
      const inGloom = gl.state !== 'idle' && who.flight === 'none' ? gl.edgeness(who.bugout ? who.bug.pos : who.motor.pos) : 0;
      this.match.ui.gloomAmount(Math.min(1, inGloom * 0.8));
      this.hud.gloom = this.match.gloom.state !== 'idle' ? this.match.gloom : null;
      this.hud.root.classList.toggle('flying', p.flight !== 'none' || !!p.bugout);
      this.hud.root.classList.toggle('lobby', this.match.phase === 'lobby');
      this.hud.root.classList.toggle('ended', this.match.summaryShown);
    } else {
      this.hud.gloom = null;
      this.hud.root.classList.remove('flying', 'lobby', 'ended');
    }
    if (this.sounds.length) this.sounds = this.sounds.filter((s) => this.time - s.time < 1);
    if (this.net?.role === 'host') this.net.tick(dt);
    if (this.mode === 'match') return;
    if (this.mode === 'training') {
      this.training?.update(dt);
      return;
    }

    // playground flow: respawns & loot refresh
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawnPlayer();
    }
    for (const a of this.actors) {
      if (a === p || a.alive || a.parked) continue;
      const t = (this.botRespawn.get(a) ?? 5) - dt;
      if (t <= 0) {
        this.botRespawn.delete(a);
        this.spawnBot(a);
      } else this.botRespawn.set(a, t);
    }
    this.lootTimer -= dt;
    if (this.lootTimer <= 0) {
      this.lootTimer = 25;
      for (const s of this.world.lootSpots) {
        if (!this.loot.pickups.some((pk) => pk.pos.distanceTo(s.pos) < 1.5)) this.spawnLootSpot(s);
      }
      // playground only: crates refill every other cycle
      this.crateCycle = (this.crateCycle + 1) % 2;
      if (this.crateCycle === 0) this.loot.resetCrates();
    }
    // forget old sounds
    if (this.sounds.length) this.sounds = this.sounds.filter((s) => this.time - s.time < 1);
  }

  /** Drop quality one notch if we sit well below 30fps for a while. */
  private autoQuality() {
    if (this.paused || !this.settings.autoQuality) return;
    this.autoQualityT -= 0.5;
    if (this.autoQualityT > 0) return;
    if (this.fps < 32) this.lowFpsTime += 0.5;
    else this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.5);
    if (this.lowFpsTime > 3) {
      this.lowFpsTime = 0;
      this.autoQualityT = 6;
      const order: Quality[] = ['high', 'medium', 'low'];
      const i = order.indexOf(this.settings.quality);
      if (i < 2) {
        this.settings.quality = order[i + 1];
        this.applySettings();
        this.hud.toast(`Graphics: ${this.settings.quality.toUpperCase()} (auto)`, '#9fe8ff');
      }
    }
  }
}

const _right = new THREE.Vector3();
