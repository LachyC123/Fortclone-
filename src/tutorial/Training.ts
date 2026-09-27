import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Blinkbug, BugOwner, BUG } from '../entities/Blinkbug';
import { audio } from '../audio/Audio';
import { PShape } from '../fx/Particles';
import { ColFlags, OBB } from '../physics/Collision';
import { randomBugName, SPECIES_BY_ID } from '../progression/Bugs';
import { RARITY, PAL } from '../render/Palette';
import { toyMaterial } from '../render/Materials';

type StepId = 'move' | 'look' | 'jump' | 'slide' | 'grab' | 'shoot' | 'reload' | 'cocoon' | 'throw' | 'blink' | 'tower' | 'util' | 'heal';

interface Step {
  id: StepId;
  title: string;
  keys: string;
  touch: string;
  /** touch button to pulse */
  btn?: string;
}

const STEPS: Step[] = [
  { id: 'move', title: 'Walk around', keys: '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>', touch: 'Left thumb: drag anywhere to walk' },
  { id: 'look', title: 'Look around', keys: 'Move the <kbd>mouse</kbd>', touch: 'Right thumb: drag to look' },
  { id: 'jump', title: 'Jump', keys: '<kbd>Space</kbd>', touch: 'Tap JUMP', btn: 'jump' },
  { id: 'slide', title: 'Run, then slide', keys: 'Hold <kbd>Shift</kbd> to run, tap <kbd>C</kbd> to slide', touch: 'Push the stick all the way, then tap CROUCH', btn: 'crouch' },
  { id: 'grab', title: 'Grab the Poppistol', keys: 'Walk up to it and press <kbd>F</kbd>', touch: 'Walk up to it and tap GRAB', btn: 'interact' },
  { id: 'shoot', title: 'Knock over the 3 targets', keys: '<kbd>Left click</kbd> fires · hold <kbd>Right click</kbd> to aim', touch: 'Tap FIRE (drag it to steer your aim)', btn: 'fire' },
  { id: 'reload', title: 'Reload', keys: '<kbd>R</kbd>', touch: 'Tap RELOAD', btn: 'reload' },
  { id: 'cocoon', title: 'Something is glowing by the old stump…', keys: 'Go and have a look!', touch: 'Go and have a look!' },
  { id: 'throw', title: 'Throw your Blinkbug', keys: 'Hold <kbd>Q</kbd> to aim, let go to throw', touch: 'Hold the BUG button to aim, let go to throw', btn: 'bug' },
  { id: 'blink', title: 'BLINK: swap places with it', keys: 'Press <kbd>E</kbd> while it is out', touch: 'Tap BLINK while it is out', btn: 'blink' },
  { id: 'tower', title: 'Blink up onto the tall rock', keys: 'Too tall to climb! Lob your bug over the mossy top (<kbd>Q</kbd>): it sticks. Then <kbd>E</kbd>', touch: 'Too tall to climb! Lob your bug over the mossy top: it sticks. Then tap BLINK', btn: 'bug' },
  { id: 'util', title: 'Throw a Fizz Bomb', keys: 'Hold <kbd>G</kbd>, let go to throw', touch: 'Hold the ITEM button, let go to throw', btn: 'util' },
  { id: 'heal', title: 'Drink a Fizzle Juice', keys: '<kbd>H</kbd>', touch: 'Tap the HEAL button', btn: 'heal' },
];

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Target {
  root: THREE.Group;
  board: THREE.Group;
  col: OBB;
  down: boolean;
  fallT: number;
}

const _v = new THREE.Vector3();

function bullseye() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rings = ['#fff6e6', '#e8505b', '#fff6e6', '#e8505b', '#f2c14e'];
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(64, 64, 62 - i * 13, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * First-play training on Launch Isle: a tick-list of the controls, some targets to knock over,
 * then a little cutscene where you find a glowing cocoon, it hatches into your very first
 * Blinkbug and you give it a name. Every step has a SKIP.
 */
export class Training {
  private group = new THREE.Group();
  private colliders: OBB[] = [];
  private targets: Target[] = [];
  private panel = h('div', 'tut');
  private titleCard = h('div', 'tuttitle');
  private nameEl: HTMLDivElement | null = null;
  private marker = new THREE.Group();
  private stepIdx = 0;
  private stepT = 0;
  private done = false;
  private moved = 0;
  private lastPos = new THREE.Vector3();
  private lookAcc = 0;
  private lastYaw = 0;
  private blinks0 = 0;
  private hatched = false;
  private cocoon: THREE.Group;
  private stump: THREE.Vector3;
  private rockTop: THREE.Vector3;
  private pedestal: THREE.Vector3;
  private origHit: Game['world']['onBulletHit'];
  /** cutscenes: 'intro' fly-in, 'hatch' cocoon, null while playing */
  private scene: 'intro' | 'hatch' | 'naming' | 'fly' | null = 'intro';
  private sceneT = 0;
  private baby: Blinkbug | null = null;
  private babyDock = new THREE.Vector3();
  private finishT = -1;
  private hi: HTMLElement | null = null;

  constructor(private g: Game, private onExit: (then: 'play' | 'home') => void) {
    const c = g.world.lobby.center;
    const L = (x: number, y: number, z: number) => new THREE.Vector3(c.x + x, c.y + y, c.z + z);
    this.pedestal = L(0, 0, -1);
    this.stump = L(-7.5, 0, 5.5);
    this.rockTop = L(5, 4.6, 7.5);
    g.scene.add(this.group);

    // weapon pedestal
    this.box(this.pedestal.x, this.pedestal.y + 0.3, this.pedestal.z, 1, 0.6, 1, 0xd8cbb8, 'stone');
    this.box(this.pedestal.x, this.pedestal.y + 0.62, this.pedestal.z, 1.1, 0.06, 1.1, PAL.mustard, 'stone', false);

    // three targets out past the plaza
    const tex = bullseye();
    for (const [x, z] of [[-4, -9.5], [0, -11], [4, -9.5]]) {
      const root = new THREE.Group();
      root.position.copy(L(x, 0, z));
      root.rotation.y = Math.atan2(-x, 11 + z) * 0.6;
      const board = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.3, 8), toyMaterial(PAL.wood));
      post.position.y = 0.65;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24), [toyMaterial(PAL.brownDark), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), toyMaterial(PAL.brownDark)]);
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 1.35;
      board.add(post, disc);
      root.add(board);
      const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.2, 10), toyMaterial(0xe6c46a, { rough: 0.9 }));
      straw.position.y = 0.1;
      root.add(straw);
      this.group.add(root);
      const col = g.cw.box(root.position.x, root.position.y + 1.35, root.position.z, 1.0, 1.0, 0.16, 'wood', root.rotation.y, 0, 0, ColFlags.BlocksBullets | ColFlags.BlocksBug);
      this.colliders.push(col);
      this.targets.push({ root, board, col, down: false, fallT: 0 });
    }
    // bullets that hit a target knock it over
    this.origHit = g.world.onBulletHit.bind(g.world);
    g.world.onBulletHit = (col, p, dir) => {
      const t = this.targets.find((x) => x.col === col);
      if (t && !t.down) this.knock(t);
      else this.origHit(col, p, dir);
    };

    // the old stump and its glowing cocoon
    const stump = new THREE.Group();
    stump.position.copy(this.stump);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.55, 14), toyMaterial(0x8a5a3b, { rough: 0.9 }));
    trunk.position.y = 0.27;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.03, 14), toyMaterial(0xe6c49a, { rough: 0.8 }));
    top.position.y = 0.56;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 4, 20), toyMaterial(0xb08a60));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.58;
    stump.add(trunk, top, ring);
    this.group.add(stump);
    this.box(this.stump.x, this.stump.y + 0.27, this.stump.z, 1.1, 0.55, 1.1, 0x8a5a3b, 'wood', false);
    const species = SPECIES_BY_ID[g.collection.equipped] ?? SPECIES_BY_ID.zippit;
    this.cocoon = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: species.tint, emissiveIntensity: 0.55, roughness: 0.5 }));
    shell.scale.set(1, 1.35, 1);
    this.cocoon.add(shell);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.19 - Math.abs(i - 1) * 0.04, 0.018, 5, 18), new THREE.MeshStandardMaterial({ color: species.tint, emissive: species.tint, emissiveIntensity: 0.8 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = (i - 1) * 0.12;
      this.cocoon.add(band);
    }
    this.cocoon.position.copy(this.stump).setY(this.stump.y + 0.84);
    this.group.add(this.cocoon);

    // a tall rock (too tall to climb) with a crown of boulders on top that catches a lobbed bug
    const H = 4.6;
    const rock = new THREE.Group();
    rock.position.copy(this.rockTop).setY(c.y);
    const back = new THREE.Vector3(this.rockTop.x - c.x, 0, this.rockTop.z - c.z).normalize();
    const stone = toyMaterial(0x9a8f86, { rough: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, H, 8), stone);
    body.rotation.y = Math.PI / 8; // flat faces line up with the colliders
    body.position.y = H / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.4, 0.2, 8), toyMaterial(0x7ee06a, { rough: 0.95 }));
    cap.rotation.y = Math.PI / 8;
    cap.position.y = H + 0.02;
    rock.add(body, cap);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 + (i % 3) * 0.15), stone);
      const a = i * 0.9 + 0.4;
      b.position.set(Math.cos(a) * 2.6, 0.4 + i * 0.6, Math.sin(a) * 2.6);
      rock.add(b);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34 + (i % 3) * 0.06), stone);
      b.position.set(Math.cos(a) * 2.05, H + 0.3, Math.sin(a) * 2.05);
      b.rotation.set(i, i * 2, 0);
      rock.add(b);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), toyMaterial(PAL.brownDark));
    pole.position.set(-back.x * 1.9, H + 1.0, -back.z * 1.9);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshStandardMaterial({ color: PAL.pink, side: THREE.DoubleSide }));
    flag.position.set(-back.x * 1.9 + back.z * 0.36, H + 1.45, -back.z * 1.9 - back.x * 0.36);
    flag.rotation.y = Math.atan2(back.x, back.z) + Math.PI / 2;
    rock.add(pole, flag);
    this.group.add(rock);
    // a taller spire at the back: overshoot and your bug banks off it onto the ledge
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 4.2, 7), stone);
    spire.position.set(back.x * 1.5, H + 2.1, back.z * 1.5);
    const tip = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95), stone);
    tip.position.set(back.x * 1.5, H + 4.2, back.z * 1.5);
    rock.add(spire, tip);
    this.colliders.push(g.cw.box(this.rockTop.x + back.x * 1.5, c.y + H + 2.4, this.rockTop.z + back.z * 1.5, 2.2, 4.8, 2.2, 'stone', Math.atan2(back.x, back.z)));
    const side = 2 * 2.4 * Math.cos(Math.PI / 8);
    for (const yaw of [0, Math.PI / 4]) this.colliders.push(g.cw.box(this.rockTop.x, c.y + H / 2, this.rockTop.z, side, H, side, 'stone', yaw));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.colliders.push(g.cw.box(this.rockTop.x + Math.cos(a) * 2.05, c.y + H + 0.55, this.rockTop.z + Math.sin(a) * 2.05, 1.9, 1.1, 0.3, 'stone', -a + Math.PI / 2, 0, 0, ColFlags.BlocksBug));
    }

    // the "go here" marker
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
    arrow.rotation.x = Math.PI;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 3, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -1.6;
    this.marker.add(arrow, beam);
    this.marker.visible = false;
    this.group.add(this.marker);

    // the first bug is still in its cocoon: no Blinkbug on your back yet
    document.body.classList.add('tut-nobug', 'tut-on');
    document.body.append(this.panel, this.titleCard);
    this.titleCard.innerHTML = `<div class="big">TRAINING</div><small>A quick lap of Launch Isle. Skip whenever you like.</small>`;
    this.render();
    audio.chirp(this.stump, 1.2, 0.2);
  }

  /** a visible box that you can stand on / that blocks bullets */
  private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, surface: 'stone' | 'wood', visible = true) {
    if (visible) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), toyMaterial(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.colliders.push(this.g.cw.box(x, y, z, sx, sy, sz, surface));
  }

  private knock(t: Target) {
    t.down = true;
    t.col.enabled = false;
    const p = _v.copy(t.root.position).setY(t.root.position.y + 1.35);
    audio.bell(p);
    audio.pop(p);
    this.g.fx.sparkBurst(p, 0xffd36b, 16);
    this.g.fx.glow.emit(p, { count: 14, color: [0xffd36b, 0xffffff, 0xe8505b], speed: [2, 5], spread: 1, up: 2, gravity: 8, life: [0.4, 0.8], size: [0.08, 0.14], shape: PShape.Star });
    const left = this.targets.filter((x) => !x.down).length;
    this.g.hud.toast(left ? `${left} to go!` : 'All down! Nice shooting', '#ffd36b');
  }

  private get step(): Step | null {
    return STEPS[this.stepIdx] ?? null;
  }

  private render() {
    const touch = this.g.input.s.touchActive;
    const st = this.step;
    const list = STEPS.map((s, i) => `<li class="${i < this.stepIdx ? 'ok' : i === this.stepIdx ? 'cur' : ''}"><span class="tick">${i < this.stepIdx ? '✓' : i + 1}</span>${s.title}</li>`).join('');
    const cur = this.done
      ? `<div class="now big">TRAINING COMPLETE!</div><div class="how">You're ready for the island. Good luck, rascal.</div><div class="tutbtns"><button class="btn tplay">PLAY A MATCH</button><button class="btn secondary thome">HOME</button></div>`
      : st
        ? `<div class="now big">${st.title}</div><div class="how">${touch ? st.touch : st.keys}</div>`
        : '';
    this.panel.innerHTML = `<div class="hd"><b class="big">TRAINING</b><span class="n">${Math.min(this.stepIdx, STEPS.length)} / ${STEPS.length}</span>${this.done ? '' : `<button class="skip">SKIP</button>${touch ? '' : '<small class="esc"><kbd>Esc</kbd> to skip</small>'}`}</div>${cur}<ol>${list}</ol>`;
    this.panel.querySelector('.skip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.uiTap();
      this.exit('play');
    });
    this.panel.querySelector('.tplay')?.addEventListener('click', () => {
      audio.uiTap();
      this.exit('play');
    });
    this.panel.querySelector('.thome')?.addEventListener('click', () => {
      audio.uiTap();
      this.exit('home');
    });
    // pulse the touch button this step is about
    this.hi?.classList.remove('tut-hi');
    this.hi = st?.btn && !this.done ? document.querySelector<HTMLElement>(`.tbtn[data-id="${st.btn}"]`) : null;
    this.hi?.classList.add('tut-hi');
  }

  /** SKIP (panel button, or the pause menu on desktop where the mouse is captured) */
  skip() {
    this.exit('play');
  }

  private exit(then: 'play' | 'home') {
    try {
      localStorage.setItem('rr.trained', '1');
    } catch {
      /* ignore */
    }
    this.onExit(then);
  }

  /** one step down: a tick, a sound, and set up the next */
  private advance() {
    const p = this.g.player;
    this.stepIdx++;
    this.stepT = 0;
    audio.pickup(2);
    this.panel.classList.remove('pop');
    void this.panel.offsetWidth;
    this.panel.classList.add('pop');
    const st = this.step;
    if (!st) {
      this.finish();
      return;
    }
    if (st.id === 'grab') {
      this.g.loot.spawn('weapon', 'poppistol', 1, 1, this.pedestal.clone().setY(this.pedestal.y + 0.7));
      this.g.loot.spawn('ammo', 'light', 0, 48, this.pedestal.clone().add(new THREE.Vector3(1.4, 0.05, 0.3)));
    }
    if (st.id === 'blink') this.blinks0 = p.blinks;
    if (st.id === 'util') {
      p.util = null;
      p.addItem('util', 'fizzbomb', 1);
    }
    if (st.id === 'heal') {
      p.hp = 50;
      p.healItem = null;
      p.addItem('heal', 'fizzle', 1);
      this.g.hud.toast('Ouch! You look a bit worn out…', '#ff9a9a');
    }
    this.render();
  }

  private finish() {
    this.done = true;
    this.marker.visible = false;
    const p = this.g.player;
    audio.fanfare();
    this.g.hud.bigToast('TRAINING COMPLETE!', '#9dff8a');
    this.g.fx.confettiCannon(p.motor.pos.clone().setY(p.motor.pos.y + 0.5), new THREE.Vector3(0, 1, 0));
    this.finishT = 0;
    p.startEmote('dance', 3);
    try {
      localStorage.setItem('rr.trained', '1');
    } catch {
      /* ignore */
    }
    // free the mouse so the buttons can be clicked
    document.exitPointerLock?.();
    this.render();
  }

  /* ------------------------------------------------------------------ per frame */

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    this.stepT += dt;
    if (!this.hatched) {
      p.bug.root.visible = false;
      p.bug.cooldown = Math.max(p.bug.cooldown, 1);
    }
    // targets topple
    for (const t of this.targets) {
      if (!t.down || t.fallT >= 1) continue;
      t.fallT = Math.min(1, t.fallT + dt * 3.5);
      const k = t.fallT;
      t.board.rotation.x = -Math.PI / 2 * (k * k * (3 - 2 * k)) + Math.sin(k * Math.PI) * 0.15;
    }
    // cocoon idles: bob and glow
    if (!this.hatched && this.scene !== 'hatch') {
      this.cocoon.rotation.z = Math.sin(g.time * 2) * 0.06;
      this.cocoon.position.y = this.stump.y + 0.84 + Math.sin(g.time * 1.6) * 0.03;
      if (Math.random() < dt * 4) g.fx.glow.emit(this.cocoon.position, { count: 1, color: [0xffffff, 0xfff1a8], speed: 0.4, up: 1, spread: 1, life: 0.8, size: 0.08, shape: PShape.Sparkle });
    }
    if (this.scene) {
      this.updateScene(dt);
      return;
    }
    if (this.done) {
      this.finishT += dt;
      return;
    }
    this.updateMarker();
    this.mossCatch();
    const st = this.step;
    if (!st) return;
    const m = p.motor;
    let ok = false;
    switch (st.id) {
      case 'move':
        this.moved += Math.hypot(m.pos.x - this.lastPos.x, m.pos.z - this.lastPos.z);
        ok = this.moved > 5;
        break;
      case 'look':
        this.lookAcc += Math.abs(g.camRig.yaw - this.lastYaw) + 0;
        ok = this.lookAcc > 2;
        break;
      case 'jump':
        ok = !m.grounded && m.vel.y > 2.5;
        break;
      case 'slide':
        ok = m.sliding;
        break;
      case 'grab':
        ok = p.weapons.some((w) => w?.def.id === 'poppistol');
        break;
      case 'shoot':
        ok = this.targets.every((t) => t.down);
        break;
      case 'reload':
        ok = !!p.weapon?.reloading;
        if (p.weapon && p.weapon.mag >= p.weapon.def.mag && this.stepT > 0.5 && this.stepT < 0.6) g.hud.toast('Fire a couple of shots first, then reload', '#fff');
        break;
      case 'cocoon':
        if (m.pos.distanceTo(this.stump) < 2.6) this.startHatch();
        break;
      case 'throw':
        ok = p.bug.state === 'flying' || p.bug.state === 'landed';
        break;
      case 'blink':
        ok = p.blinks > this.blinks0;
        if (p.bug.state === 'docked' && this.stepT > 0.3 && p.bug.cooldown <= 0 && !p.bug.out && this.stepT % 6 < dt) g.hud.toast('Throw it first (Q), then blink!', '#9fe8ff');
        break;
      case 'tower':
        ok = m.grounded && m.pos.y > this.rockTop.y - 0.4 && Math.hypot(m.pos.x - this.rockTop.x, m.pos.z - this.rockTop.z) < 2.6;
        if (ok) g.fx.confettiCannon(m.pos.clone(), new THREE.Vector3(0, 1, 0));
        break;
      case 'util':
        ok = !p.util;
        break;
      case 'heal':
        ok = p.hp >= 74;
        break;
    }
    this.lastPos.copy(m.pos);
    this.lastYaw = g.camRig.yaw;
    if (ok && this.stepT > 0.25) this.advance();
  }

  /**
   * The springy moss on top of the tall rock (and the sticky spire behind it) grab a Blinkbug
   * that sails over, and drop it onto the ledge: in training, a lob is enough.
   */
  private mossCatch() {
    const b = this.g.player.bug;
    if (b.state !== 'flying') return;
    const top = this.rockTop;
    const dx = b.pos.x - top.x, dz = b.pos.z - top.z;
    if (Math.hypot(dx, dz) > 2.5 || b.pos.y < top.y - 0.05 || b.pos.y > top.y + 5.5) return;
    // settle it on the open part of the ledge, in front of the spire
    const c = this.g.world.lobby.center;
    const back = _v.set(top.x - c.x, 0, top.z - c.z).normalize();
    const along = dx * back.x + dz * back.z;
    const k = along > 0.2 ? along - 0.2 : 0;
    b.pos.set(top.x + dx * 0.8 - back.x * k, top.y + BUG.radius + 0.05, top.z + dz * 0.8 - back.z * k);
    b.vel.set(0, 0, 0);
    b.state = 'landed';
    audio.splat(b.pos);
    audio.chirp(b.pos, 1.3, 0.4);
    this.g.fx.ring(b.pos.clone().setY(top.y + 0.05), 0x7ee06a, 0.1, 1.2, 0.4);
    this.g.fx.soft.emit(b.pos, { count: 8, color: [0x7ee06a, 0xb6ff9a], speed: [1, 2.5], spread: 1, up: 2, gravity: 8, life: 0.5, size: [0.08, 0.14] });
  }

  private updateMarker() {
    const st = this.step;
    const at = !st ? null : st.id === 'grab' ? this.pedestal.clone().setY(this.pedestal.y + 2.2) : st.id === 'cocoon' ? this.stump.clone().setY(this.stump.y + 2.2) : st.id === 'tower' ? this.rockTop.clone().setY(this.rockTop.y + 2.2) : null;
    this.marker.visible = !!at;
    if (at) {
      this.marker.position.copy(at).setY(at.y + Math.sin(this.g.time * 4) * 0.15);
      this.marker.rotation.y += 0.04;
    }
  }

  /* ------------------------------------------------------------------ cutscenes */

  private cam(pos: THREE.Vector3, target: THREE.Vector3) {
    this.g.debugCam = { pos, target };
  }

  private updateScene(dt: number) {
    const g = this.g;
    const p = g.player;
    this.sceneT += dt;
    const t = this.sceneT;
    g.input.enabled = false;
    if (this.scene === 'intro') {
      // swoop in over the island to behind your rascal
      const k = Math.min(1, t / 3.2);
      const e = k * k * (3 - 2 * k);
      const c = g.world.lobby.center;
      const a = 1.2 - e * 1.2;
      const r = 26 - e * 21;
      this.cam(new THREE.Vector3(p.motor.pos.x + Math.sin(a) * r, c.y + 14 - e * 11.5, p.motor.pos.z + Math.cos(a) * r), p.motor.pos.clone().setY(p.motor.pos.y + 1.2 + (1 - e) * 2));
      this.titleCard.classList.toggle('show', t > 0.3 && t < 2.8);
      if (t >= 3.2) this.endScene();
      return;
    }
    if (this.scene === 'hatch') {
      const co = this.cocoon.position;
      const a = 0.9 + t * 0.35;
      this.cam(new THREE.Vector3(this.stump.x + Math.sin(a) * 2.6, this.stump.y + 1.5, this.stump.z + Math.cos(a) * 2.6), co.clone());
      // wobble harder and harder, then POP
      const wob = Math.min(1, t / 2.4);
      this.cocoon.rotation.z = Math.sin(t * (10 + wob * 18)) * 0.25 * wob;
      this.cocoon.scale.setScalar(1 + Math.sin(t * 26) * 0.04 * wob);
      if (Math.random() < dt * (6 + wob * 20)) g.fx.glow.emit(co, { count: 1, color: [0xffffff, this.speciesTint()], speed: 1.2, spread: 1, life: 0.5, size: 0.1, shape: PShape.Sparkle });
      for (const at of [0.8, 1.5, 2.0, 2.3]) if (t - dt < at && t >= at) audio.chirp(co, 1 + at * 0.2, 0.4);
      if (t >= 2.6 && this.cocoon.visible) this.hatch();
      if (this.baby) {
        this.baby.update(dt);
        if (t > 3 && t - dt < 3) this.baby.poke();
        if (t > 3.6 && t - dt < 3.6) this.baby.poke();
      }
      if (t >= 4.2) this.showNaming();
      return;
    }
    if (this.scene === 'naming') {
      const co = this.cocoon.position;
      // frame the bug in the top half, above the naming card
      this.cam(new THREE.Vector3(this.stump.x + Math.sin(2.4) * 2.4, this.stump.y + 1.3, this.stump.z + Math.cos(2.4) * 2.4), co.clone().setY(co.y - 0.55));
      this.baby?.update(dt);
      return;
    }
    if (this.scene === 'fly') {
      // the new bug zips over and snuggles into your backpack
      const k = Math.min(1, t / 0.9);
      const e = k * k * (3 - 2 * k);
      const dock = p.dockWorld(new THREE.Vector3());
      this.babyDock.lerpVectors(this.cocoon.position, dock, e).setY(this.babyDock.y + Math.sin(k * Math.PI) * 1.2);
      this.baby?.update(dt);
      if (Math.random() < dt * 30 && this.baby) g.fx.bugTrail(this.baby.root.position);
      const cp = p.motor.pos.clone().add(new THREE.Vector3(Math.sin(g.camRig.yaw) * 3.5, 2, Math.cos(g.camRig.yaw) * 3.5));
      this.cam(cp, p.motor.pos.clone().setY(p.motor.pos.y + 1.2));
      if (k >= 1) {
        if (this.baby) {
          g.scene.remove(this.baby.root);
          this.baby = null;
        }
        this.hatched = true;
        document.body.classList.remove('tut-nobug');
        p.bug.reset();
        p.bug.cooldown = 0;
        p.bug.poke();
        g.fx.sparkBurst(dock, this.speciesTint(), 14);
        this.endScene();
        this.advance();
      }
    }
  }

  private speciesTint() {
    return (SPECIES_BY_ID[this.g.collection.equipped] ?? SPECIES_BY_ID.zippit).tint;
  }

  private endScene() {
    this.scene = null;
    this.sceneT = 0;
    this.g.debugCam = null;
    this.g.input.enabled = true;
    this.g.camRig.snapTo(this.g.player);
    this.titleCard.classList.remove('show');
    this.lastPos.copy(this.g.player.motor.pos);
    this.lastYaw = this.g.camRig.yaw;
  }

  private startHatch() {
    this.scene = 'hatch';
    this.sceneT = 0;
    this.marker.visible = false;
    const p = this.g.player;
    // out of shot for the close-up (the camera circles the stump)
    p.rig.root.visible = false;
    p.motor.vel.set(0, 0, 0);
    // face the stump
    p.bodyYaw = Math.atan2(-(this.stump.x - p.motor.pos.x), -(this.stump.z - p.motor.pos.z));
    this.g.hud.bigToast("IT'S HATCHING!", '#ffd36b');
  }

  private hatch() {
    const g = this.g;
    const co = this.cocoon.position.clone();
    this.cocoon.visible = false;
    audio.pop(co);
    audio.fanfare();
    g.fx.sparkBurst(co, this.speciesTint(), 30);
    g.fx.ring(co.clone().setY(this.stump.y + 0.6), this.speciesTint(), 0.2, 2.5, 0.5);
    g.fx.glow.emit(co, { count: 30, color: [0xffffff, 0xffd36b, this.speciesTint(), 0xff9ad5], speed: [2, 6], spread: 1, up: 3, gravity: 6, life: [0.6, 1.2], size: [0.1, 0.2], shape: PShape.Confetti, spin: 8, drag: 2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fx.chunk(co, new THREE.Vector3(Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3), 0xfff1d8, 0.07, 1.4);
    }
    // your very own Blinkbug, blinking at the world for the first time
    const species = SPECIES_BY_ID[g.collection.equipped] ?? SPECIES_BY_ID.zippit;
    this.babyDock.copy(co).setY(this.stump.y + 0.75);
    const dock = this.babyDock;
    const cam = g.camera;
    const owner: BugOwner = {
      isLocal: true,
      me: null,
      alive: true,
      dockWorld: (out) => out.copy(dock),
      facingYaw: () => Math.atan2(cam.position.x - dock.x, cam.position.z - dock.z) + Math.PI,
    };
    this.baby = new Blinkbug(g.cw, g.fx, owner, species);
    this.baby.root.position.copy(dock);
    this.baby.root.scale.setScalar(1.6);
    g.scene.add(this.baby.root);
    this.baby.poke();
  }

  private showNaming() {
    const g = this.g;
    this.scene = 'naming';
    document.exitPointerLock?.();
    document.body.classList.add('tut-naming');
    const species = SPECIES_BY_ID[g.collection.equipped] ?? SPECIES_BY_ID.zippit;
    const own = g.collection.bugs.find((b) => b.species === species.id);
    const r = RARITY[species.rarity];
    const el = (this.nameEl = h('div', 'overlay tutname') as HTMLDivElement);
    el.innerHTML = `<div class="menu panel">
      <div class="tag big" style="color:${r.css}">${r.name.toUpperCase()} · ${species.name.toUpperCase()}</div>
      <h2 class="big">IT HATCHED!</h2>
      <p class="intro">Your very first <b>Blinkbug</b>. Throw it, then <b>blink</b> to swap places with it.</p>
      <p class="ask">What will you call it?</p>
      <div class="namerow"><input class="nm big" maxlength="18" value="${esc(own?.name ?? randomBugName())}"><button class="btn secondary dice" title="Another name">SHUFFLE</button></div>
      <p class="sp"><b>${species.name}:</b> ${species.trick}</p>
      <button class="btn ok">THAT'S THE ONE!</button>
    </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('.nm') as HTMLInputElement;
    el.querySelector('.dice')!.addEventListener('click', () => {
      audio.uiTap();
      input.value = randomBugName();
      this.baby?.poke();
    });
    const ok = () => {
      audio.uiTap();
      const name = input.value.trim().slice(0, 18) || randomBugName();
      if (own) own.name = name;
      g.saveCollection();
      g.player.bugName = name;
      el.remove();
      this.nameEl = null;
      document.body.classList.remove('tut-naming');
      g.hud.bigToast(`SAY HI TO ${name.toUpperCase()}!`, '#' + species.tint.toString(16).padStart(6, '0'));
      audio.chirp(this.cocoon.position, 1.4, 0.5);
      this.scene = 'fly';
      this.sceneT = 0;
      g.player.rig.root.visible = true;
      if (!g.input.s.touchActive) g.r.renderer.domElement.requestPointerLock?.();
    };
    el.querySelector('.ok')!.addEventListener('click', ok);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
    });
    setTimeout(() => input.select(), 50);
  }

  /** remove everything the training added */
  dispose() {
    const g = this.g;
    g.scene.remove(this.group);
    for (const c of this.colliders) c.enabled = false;
    g.world.onBulletHit = this.origHit;
    if (this.baby) g.scene.remove(this.baby.root);
    this.panel.remove();
    this.titleCard.remove();
    this.nameEl?.remove();
    this.hi?.classList.remove('tut-hi');
    document.body.classList.remove('tut-nobug', 'tut-naming', 'tut-on');
    g.debugCam = null;
    g.input.enabled = true;
    g.player.bug.reset();
    g.player.rig.root.visible = true;
  }
}
