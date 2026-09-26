import * as THREE from 'three';
import { Renderer, Quality, QUALITY_PRESETS } from '../render/Renderer';
import { FX } from '../fx/FX';
import { World } from '../world/World';
import { LootSystem } from '../loot/Loot';
import { NavGrid } from '../world/NavGrid';
import { Actor } from '../entities/Actor';
import { LOOKS } from '../entities/RascalRig';
import { Input } from './Input';
import { CameraRig } from '../camera/CameraRig';
import { PlayerController } from '../player/PlayerController';
import { BotController, PROFILES, Archetype } from '../ai/BotBrain';
import { HUD } from '../ui/HUD';
import { TouchControls } from '../ui/Touch';
import { GameCtx, SoundEvent } from './types';
import { audio } from '../audio/Audio';
import { Menus, Settings, loadSettings, saveSettings } from '../ui/Menus';
import { BUG } from '../entities/Blinkbug';
import { PAL, RarityIndex } from '../render/Palette';
import { pick, rand } from './math';
import { CollisionWorld } from '../physics/Collision';
import { geoStats } from '../render/GeoKit';

const BOT_NAMES = ['MuffinKing', 'CrankyPete', 'PickleWizard', 'Socks', 'BigDave', 'Nibbles', 'Toast McGee', 'Captain Crumb', 'Wobbles', 'Dame Pudding', 'Sir Bonk', 'Lil Gravy', 'Doodlebug', 'Mrs. Kettle', 'Parsnip', 'Grumbo'];
const BUG_TINTS = [PAL.blink, 0xffa3e0, 0xb6ff9a, 0xffd36b, 0xc7a8ff];

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
  private botRespawn = new Map<Actor, number>();
  private autoQualityT = 6;
  private lowFpsTime = 0;
  private titleOrbit = 0;
  /** test hook: fixed camera for visual review */
  debugCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.r = new Renderer(canvas, this.settings.quality);
    this.scene = this.r.scene;
    this.camera = this.r.camera;
    this.world = null as unknown as World;
    this.fx = null as unknown as FX;
    // World needs FX at runtime and FX needs the world's collision: build world first, then bind
    this.world = new World(this.scene, null as unknown as FX);
    this.cw = this.world.cw;
    this.fx = new FX(this.scene, this.cw, QUALITY_PRESETS[this.settings.quality].particles);
    (this.world as unknown as { fx: FX }).fx = this.fx;
    this.loot = new LootSystem(this.scene, this.cw);
    this.nav = new NavGrid(this.cw, 48);
    this.nav.bake();

    this.input = new Input(canvas);
    this.camRig = new CameraRig(this.camera, this.cw);
    this.hud = new HUD(this.camera);
    this.hud.setMapBase(this.world);
    this.touch = new TouchControls(this.input);
    this.menus = new Menus(this);
    this.applySettings();

    this.createPlayer();
    this.createBot();
    for (const s of this.world.lootSpots) this.loot.spawn(s.kind, s.kind === 'weapon' ? 'tincan' : 'medium', s.rarity, s.kind === 'ammo' ? 30 : 1, s.pos);

    this.hud.onPlayerEliminated = (by) => {
      this.respawnT = 3.5;
      this.menus.showEliminated(by);
    };
    this.hud.onSlotTap = (i) => (this.input.s.slotPressed = i);
    this.touch.onPause = () => this.pause();
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
    const p = new Actor('You', LOOKS[0], this, PAL.blink);
    p.isLocal = true;
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
    const a = new Actor(name, look, this, pick(BUG_TINTS));
    const brain = new BotController(PROFILES[arch]);
    a.controller = brain;
    a.onDamaged = (from, ctx) => brain.onDamaged(a, from, ctx);
    this.actors.push(a);
    this.spawnBot(a);
    return a;
  }

  private spawnBot(a: Actor) {
    const sp = pick(this.world.botSpawns);
    a.spawn(sp.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))), rand(-3, 3));
    a.weapons = [null, null, null];
    a.ammo.medium = 45;
    a.giveWeapon('tincan', (Math.random() < 0.3 ? 1 : 0) as RarityIndex, 0, true);
    if (a.controller instanceof BotController) {
      a.controller.state = 'wander';
      a.controller.target = null;
    }
    // drop in from the sky with a little puff so respawns read clearly
    a.motor.pos.y += 14;
    this.fx.sparkBurst(a.motor.pos, PAL.mustard, 10);
  }

  /* ------------------------------------------------------------------ GameCtx */

  emitSound(e: Omit<SoundEvent, 'time'>) {
    this.sounds.push({ ...e, time: this.time });
  }

  shake(amount: number) {
    if (amount > 0) this.camRig.shake(amount);
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

  play() {
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
    if (!this.loot.pickups.some((pk) => pk.kind === 'weapon' && pk.pos.distanceTo(sp.pos) < 10)) this.loot.spawn('weapon', 'tincan', 0, 1, new THREE.Vector3(0, 0.05, 22.5));
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

    if (this.paused) {
      // attract mode: slow orbit around the square behind the title
      this.titleOrbit += dt * 0.08;
      const r = 30;
      this.camera.position.set(Math.sin(this.titleOrbit) * r, 14 + Math.sin(this.titleOrbit * 0.7) * 2, Math.cos(this.titleOrbit) * r);
      this.camera.lookAt(0, 3, -6);
      this.world.update(dt, this.actors, this.camera.position);
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
    this.simulate(dt);
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

    // --- simulation
    for (const a of this.actors) a.update(dt, this);
    this.loot.update(dt, this);
    this.world.update(dt, this.actors, this.camera.position);

    // camera & listener
    const p = this.player;
    if (p.alive) {
      const w = p.weapon;
      this.camRig.update(dt, p, p.ads && w ? w.def.adsFov : null);
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

    this.fx.update(dt, this.camera);
    this.r.followShadows(p.motor.pos);

    // HUD
    const w = p.weapon;
    const spread = w ? (p.ads ? w.def.spreadAds : w.def.spreadHip) + w.bloom + (p.motor.horizontalSpeed() > 1 ? w.def.spreadMove : 0) : 0;
    this.hud.update(dt, p, this.actors, this.pc.contextPickup, spread, this.fps, this.input.s.touchActive, this.world);
    this.touch.updateVisuals(p.bug, BUG.window, !!this.pc.contextPickup);

    // playground flow: respawns & loot refresh
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawnPlayer();
    }
    for (const a of this.actors) {
      if (a === p || a.alive) continue;
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
        if (!this.loot.pickups.some((pk) => pk.pos.distanceTo(s.pos) < 1.5)) this.loot.spawn(s.kind, s.kind === 'weapon' ? 'tincan' : 'medium', s.rarity, s.kind === 'ammo' ? 30 : 1, s.pos);
      }
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
