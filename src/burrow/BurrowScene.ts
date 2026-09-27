import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Blinkbug, BugOwner } from '../entities/Blinkbug';
import type { FX } from '../fx/FX';
import { SPECIES_BY_ID } from '../progression/Bugs';
import { EmoteKind, RascalRig } from '../entities/RascalRig';
import { BuildingId, BUILDINGS, DECOR, INCUBATORS, displayed, incLeft, pumpCap, pumpTick } from '../progression/Burrow';
import { SET_BY_ID } from '../progression/Relics';
import { Parts, buildBazaar, buildDecor, buildGym, buildHall, buildIncubator, buildIsland, buildMuseum, buildPlot, buildPump } from './BurrowModels';

/** swallows every FX call: burrow bugs sparkle in their own little world */
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => undefined });

export const PLOTS: Record<BuildingId, { x: number; z: number; yaw: number }> = {
  hall: { x: 0, z: -4.6, yaw: 0 },
  pump: { x: -6.2, z: -0.9, yaw: 0.9 },
  inc1: { x: 5.3, z: -1.6, yaw: -0.8 },
  inc2: { x: 7.2, z: 2.2, yaw: -1.2 },
  inc3: { x: 4.6, z: 5.0, yaw: -0.6 },
  gym: { x: -5.2, z: 4.9, yaw: 0.6 },
  museum: { x: -6.6, z: -6.0, yaw: 0.7 },
  bazaar: { x: 0.2, z: 6.4, yaw: Math.PI },
};
const DECOR_AT: Record<string, { x: number; z: number; yaw: number }> = {
  flowers: { x: 2.6, z: -2.2, yaw: 0 },
  lanterns: { x: -1.9, z: 1.5, yaw: 1.3 },
  mushrooms: { x: -9.0, z: 1.8, yaw: 0 },
  flag: { x: 3.0, z: -7.2, yaw: -0.4 },
  hammock: { x: 8.3, z: -4.6, yaw: -0.8 },
  bath: { x: -2.2, z: -1.2, yaw: 0 },
  gnome: { x: 2.2, z: 2.3, yaw: -0.5 },
};

interface PlotView {
  id: BuildingId;
  key: string;
  group: THREE.Group;
  parts: Parts | null;
  pump?: ReturnType<typeof buildPump>;
  inc?: ReturnType<typeof buildIncubator>;
}

interface Flier {
  bug: Blinkbug;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  wait: number;
  speed: number;
}

/**
 * The Burrow diorama: a floating island with your buildings, drawn with the game's renderer
 * while the Burrow screen is open. Drag to spin it, tap a building to select it.
 */
export class BurrowScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  active = false;
  private t = 0;
  private yaw = 0.35;
  private yawV = 0;
  private dist = 30;
  private distGoal = 30;
  private focus = new THREE.Vector3(0, 0.5, 0);
  private focusGoal = new THREE.Vector3(0, 0.5, 0);
  private plots = new Map<BuildingId, PlotView>();
  private decor = new Map<string, Parts>();
  private island: Parts;
  private fliers: Flier[] = [];
  private flierKey = '';
  private ray = new THREE.Raycaster();
  selected: BuildingId | null = null;
  onSelect: ((id: BuildingId | null) => void) | null = null;
  private selRing: THREE.Mesh;
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private sun: THREE.DirectionalLight;
  private bgTex: THREE.Texture;
  private clouds: THREE.Group[] = [];
  private rascal: RascalRig | null = null;
  private rascalKey = '';
  private emote: EmoteKind | null = null;
  private emoteT = 0;
  private nextEmote = 2;
  private offX = 0;
  private yawGoal: number | null = null;
  private offY = 0;

  constructor(private g: Game) {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x7a6aa0, 1.5));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.position.set(12, 22, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -15;
    sc.right = sc.top = 15;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0xb9a8ff, 0.6);
    rim.position.set(-15, 8, -12);
    this.scene.add(rim);
    // soft sky gradient
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const x = c.getContext('2d')!;
    const grad = x.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#7fc4ff');
    grad.addColorStop(0.55, '#bfe3ff');
    grad.addColorStop(0.8, '#ffe9c4');
    grad.addColorStop(1, '#ffd0b0');
    x.fillStyle = grad;
    x.fillRect(0, 0, 4, 256);
    this.bgTex = new THREE.CanvasTexture(c);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTex;
    this.island = buildIsland();
    this.scene.add(this.island.root);
    // puffy clouds drifting below
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 });
    for (let i = 0; i < 8; i++) {
      const cl = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.4 + (k % 2) * 0.8, 12, 8), cm);
        s.position.set(k * 1.6 - 2.4, Math.sin(k * 2) * 0.4, (k % 2) * 0.8);
        cl.add(s);
      }
      const a = (i / 8) * Math.PI * 2;
      cl.position.set(Math.cos(a) * (18 + (i % 3) * 5), -8 - (i % 4) * 3, Math.sin(a) * (18 + (i % 3) * 5));
      cl.scale.setScalar(0.8 + (i % 3) * 0.4);
      this.clouds.push(cl);
      this.scene.add(cl);
    }
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.08, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }));
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.hookInput();
  }

  /* ------------------------------------------------------------------ input */

  private hookInput() {
    const canvas = this.g.r.renderer.domElement;
    const down = (x: number) => {
      this.dragging = true;
      this.dragMoved = 0;
      this.lastX = x;
    };
    const move = (x: number) => {
      if (!this.dragging) return;
      const dx = x - this.lastX;
      this.lastX = x;
      this.dragMoved += Math.abs(dx);
      this.yaw -= dx * 0.008;
      this.yawV = -dx * 0.5;
    };
    const up = (x: number, y: number) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.dragMoved < 8) this.pick(x, y);
    };
    canvas.addEventListener('pointerdown', (e) => this.active && down(e.clientX));
    window.addEventListener('pointermove', (e) => this.active && move(e.clientX));
    window.addEventListener('pointerup', (e) => this.active && up(e.clientX, e.clientY));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.distGoal = Math.max(12, Math.min(40, this.distGoal + e.deltaY * 0.02));
      },
      { passive: true },
    );
  }

  private pick(cx: number, cy: number) {
    const canvas = this.g.r.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([...this.plots.values()].map((p) => p.group), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.plot) o = o.parent;
      if (o) {
        this.select(o.userData.plot as BuildingId);
        return;
      }
    }
    this.select(null);
  }

  select(id: BuildingId | null) {
    this.selected = id;
    if (id) {
      // look at the building's front door
      const p = PLOTS[id];
      this.focusGoal.set(p.x, id === 'hall' ? 1.6 : 0.8, p.z);
      this.distGoal = id === 'hall' ? 19 : 15;
      this.yawGoal = p.yaw;
    } else {
      this.focusGoal.set(0, 0.5, 0);
      this.distGoal = 30;
      this.yawGoal = null;
    }
    this.onSelect?.(id);
  }

  /* ------------------------------------------------------------------ building the island */

  /** rebuild anything whose level / contents changed */
  sync() {
    const b = this.g.burrow;
    for (const def of BUILDINGS) {
      const L = b.lv[def.id];
      const locked = L === 0 && (def.id === 'hall' ? false : b.lv.hall < def.hall);
      const gems = def.id === 'museum' ? displayed(b).map((r) => SET_BY_ID[r.set].color) : [];
      const key = `${L}|${locked}|${gems.join(',')}`;
      let v = this.plots.get(def.id);
      if (v && v.key === key) continue;
      if (v) {
        this.scene.remove(v.group);
        // a little construction poof when something is built or upgraded
        if (v.key.split('|')[0] !== String(L)) this.poof(PLOTS[def.id].x, PLOTS[def.id].z);
      }
      const group = new THREE.Group();
      const at = PLOTS[def.id];
      group.position.set(at.x, 0, at.z);
      group.rotation.y = at.yaw;
      group.userData.plot = def.id;
      v = { id: def.id, key, group, parts: null };
      let parts: Parts;
      if (L === 0) parts = buildPlot(locked);
      else if (def.id === 'hall') parts = buildHall(L);
      else if (def.id === 'pump') parts = v.pump = buildPump(L);
      else if (def.id.startsWith('inc')) parts = v.inc = buildIncubator(L);
      else if (def.id === 'gym') parts = buildGym(L);
      else if (def.id === 'museum') parts = buildMuseum(L, gems);
      else parts = buildBazaar(L);
      v.parts = parts;
      group.add(parts.root);
      this.scene.add(group);
      this.plots.set(def.id, v);
    }
    for (const d of DECOR) {
      const has = b.decor.includes(d.id);
      if (has && !this.decor.has(d.id)) {
        const p = buildDecor(d.id);
        const at = DECOR_AT[d.id];
        p.root.position.set(at.x, 0, at.z);
        p.root.rotation.y = at.yaw;
        this.scene.add(p.root);
        this.decor.set(d.id, p);
        this.poof(at.x, at.z);
      }
    }
    this.syncFliers();
    this.syncRascal();
  }

  /** you, hanging out by your front door (wearing whatever hat you picked) */
  private syncRascal() {
    const look = this.g.playerLook();
    const key = `${look.hat}|${look.hatColor}`;
    if (key === this.rascalKey) return;
    const first = !this.rascalKey;
    this.rascalKey = key;
    if (this.rascal) this.scene.remove(this.rascal.root);
    this.rascal = new RascalRig(look);
    this.rascal.root.position.set(1.3, 0.02, -2.2);
    this.rascal.root.rotation.y = Math.PI + 0.35;
    this.rascal.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.scene.add(this.rascal.root);
    if (!first) {
      // new hat: show it off
      this.emote = 'flex';
      this.emoteT = 2.4;
      this.poof(1.3, -2.2);
    }
  }

  private poofs: { m: THREE.Mesh; t: number }[] = [];
  private poof(x: number, z: number) {
    if (!this.active) return;
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xffffff : 0xffe27a, transparent: true, opacity: 0.9 }));
      const a = (i / 10) * Math.PI * 2;
      m.position.set(x + Math.cos(a) * 1.2, 0.5 + (i % 3) * 0.6, z + Math.sin(a) * 1.2);
      m.userData.v = new THREE.Vector3(Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2);
      this.scene.add(m);
      this.poofs.push({ m, t: 0 });
    }
  }

  /** your bugs live here: up to eight of them flit about between the buildings */
  private syncFliers() {
    const c = this.g.collection;
    const list = [c.equipped, ...c.bugs.map((b) => b.species).filter((s) => s !== c.equipped)].slice(0, 8);
    const key = list.join(',');
    if (key === this.flierKey) return;
    this.flierKey = key;
    for (const f of this.fliers) this.scene.remove(f.bug.root);
    this.fliers = [];
    list.forEach((id, i) => {
      const sp = SPECIES_BY_ID[id];
      if (!sp) return;
      const pos = new THREE.Vector3(Math.cos(i * 1.7) * 4, 1.5, Math.sin(i * 1.7) * 4);
      const f: Flier = { bug: null as unknown as Blinkbug, pos, target: pos.clone(), yaw: 0, wait: i * 0.4, speed: 1.6 + (i % 3) * 0.5 };
      const owner: BugOwner = { isLocal: false, me: null, alive: true, dockWorld: (out) => out.copy(f.pos), facingYaw: () => f.yaw };
      f.bug = new Blinkbug(this.g.cw, noop as FX, owner, sp);
      f.bug.root.scale.setScalar(i === 0 ? 2.2 : 1.8);
      this.scene.add(f.bug.root);
      this.fliers.push(f);
    });
  }

  /* ------------------------------------------------------------------ per frame */

  /** test hook: finish any camera glide right now */
  settleCamera() {
    if (this.yawGoal !== null) this.yaw = this.yawGoal;
    this.focus.copy(this.focusGoal);
    this.dist = this.distGoal;
    const c = this.g.r.renderer.domElement;
    const portrait = c.clientHeight > c.clientWidth;
    this.offX = this.selected && !portrait ? Math.min(220, c.clientWidth * 0.18) : 0;
    this.offY = this.selected && portrait ? c.clientHeight * 0.2 : 0;
  }

  open() {
    this.active = true;
    this.sync();
    // say hi when you come home
    this.emote = 'wave';
    this.emoteT = 2.2;
  }
  close() {
    this.active = false;
    this.select(null);
  }

  /** where a building's floating label should sit (screen px), or null if behind the camera */
  labelAt(id: BuildingId, out: { x: number; y: number }) {
    const p = PLOTS[id];
    const L = this.g.burrow.lv[id];
    const h = id === 'hall' ? 6.4 : id === 'museum' ? 3.8 : L ? 3.1 : 2;
    const v = new THREE.Vector3(p.x, h, p.z).project(this.camera);
    if (v.z > 1) return null;
    const c = this.g.r.renderer.domElement;
    out.x = (v.x * 0.5 + 0.5) * c.clientWidth;
    out.y = (-v.y * 0.5 + 0.5) * c.clientHeight;
    return out;
  }

  render(dt: number) {
    const r = this.g.r.renderer;
    this.t += dt;
    const b = this.g.burrow;
    const now = Date.now();
    // live bits: pump fill, what's in each incubator
    const pump = this.plots.get('pump')?.pump;
    if (pump) pump.setFill(pumpTick(b, now) / Math.max(1, pumpCap(b)));
    INCUBATORS.forEach((id, i) => {
      const inc = this.plots.get(id)?.inc;
      const s = b.inc[i];
      inc?.setCocoon(s ? s.r : -1, !!s && incLeft(b, i, now) <= 0);
    });
    for (const v of this.plots.values()) for (const a of v.parts?.anim ?? []) a(this.t, dt);
    for (const d of this.decor.values()) for (const a of d.anim) a(this.t, dt);
    for (const a of this.island.anim) a(this.t, dt);
    for (let i = this.poofs.length - 1; i >= 0; i--) {
      const p = this.poofs[i];
      p.t += dt;
      p.m.position.addScaledVector(p.m.userData.v as THREE.Vector3, dt);
      p.m.scale.setScalar(1 + p.t * 2);
      (p.m.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.9 - p.t * 1.5);
      if (p.t > 0.6) {
        this.scene.remove(p.m);
        this.poofs.splice(i, 1);
      }
    }
    for (const [i, c] of this.clouds.entries()) c.position.x += Math.sin(this.t * 0.05 + i) * dt * 0.3;
    // bugs wander between spots, pause, hop on
    for (const f of this.fliers) {
      f.wait -= dt;
      const d = f.target.distanceTo(f.pos);
      if (d < 0.1 && f.wait <= 0) {
        const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 7;
        f.target.set(Math.cos(a) * rr, 0.9 + Math.random() * 2.2, Math.sin(a) * rr);
        f.wait = 0.5 + Math.random() * 2.5;
      } else if (d >= 0.1) {
        const step = Math.min(d, f.speed * dt);
        const dir = f.target.clone().sub(f.pos).normalize();
        f.pos.addScaledVector(dir, step);
        f.yaw = Math.atan2(dir.x, dir.z);
      }
      f.bug.update(dt);
      f.bug.root.position.copy(f.pos).setY(f.pos.y + Math.sin(this.t * 3 + f.speed) * 0.08);
      f.bug.root.rotation.y = f.yaw;
      f.bug.excited = false;
    }
    // your rascal: idles, waves, dances now and then
    if (this.rascal) {
      if (this.emoteT > 0) this.emoteT -= dt;
      else {
        this.emote = null;
        this.nextEmote -= dt;
        if (this.nextEmote <= 0) {
          this.emote = (['wave', 'dance', 'laugh', 'wave'] as EmoteKind[])[Math.floor(Math.random() * 4)];
          this.emoteT = 2.5;
          this.nextEmote = 5 + Math.random() * 6;
        }
      }
      this.rascal.update({ dt, time: this.t, speed: 0, vy: 0, grounded: true, sliding: false, crouching: false, sprinting: false, mantling: false, aimPitch: 0, turnRate: 0, localVelX: 0, localVelZ: 0, armed: false, ads: false, reloadK: -1, healing: false, emote: this.emote });
    }
    // selection ring
    if (this.selected) {
      const p = PLOTS[this.selected];
      this.selRing.visible = true;
      this.selRing.position.set(p.x, 0.12, p.z);
      const s = this.selected === 'hall' ? 1.25 : this.selected === 'museum' ? 1.3 : 1;
      this.selRing.scale.setScalar(s * (1 + Math.sin(this.t * 4) * 0.04));
    } else this.selRing.visible = false;
    // camera: gentle drift, momentum after a drag, glide to the selection
    if (this.dragging) this.yawGoal = null;
    if (this.yawGoal !== null) {
      const d = Math.atan2(Math.sin(this.yawGoal - this.yaw), Math.cos(this.yawGoal - this.yaw));
      this.yaw += d * Math.min(1, dt * 3);
    } else if (!this.dragging) {
      this.yaw += this.yawV * dt * 0.02;
      this.yawV *= Math.pow(0.05, dt);
      if (!this.selected) this.yaw += dt * 0.04;
    }
    this.dist += (this.distGoal - this.dist) * Math.min(1, dt * 3);
    this.focus.lerp(this.focusGoal, Math.min(1, dt * 3));
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    const portrait = h > w;
    // with a building open, slide the view so it sits beside the panel, not under it
    const wantX = this.selected && !portrait ? Math.min(220, w * 0.18) : 0;
    const wantY = this.selected && portrait ? h * 0.2 : 0;
    this.offX += (wantX - this.offX) * Math.min(1, dt * 4);
    this.offY += (wantY - this.offY) * Math.min(1, dt * 4);
    if (w && h) {
      if (Math.abs(this.offX) + Math.abs(this.offY) > 0.5) this.camera.setViewOffset(w, h, this.offX, this.offY, w, h);
      else this.camera.clearViewOffset();
    }
    // trees between the camera and what you're looking at shrink out of the way
    for (const tr of this.island.trees ?? []) {
      const tp = tr.position;
      const cx = this.camera.position.x, cz = this.camera.position.z;
      const fx = this.focus.x - cx, fz = this.focus.z - cz;
      const len2 = fx * fx + fz * fz;
      const k = Math.max(0, Math.min(1, ((tp.x - cx) * fx + (tp.z - cz) * fz) / Math.max(0.01, len2)));
      const dx = cx + fx * k - tp.x, dz = cz + fz * k - tp.z;
      const block = this.selected && k > 0.2 && k < 0.95 && dx * dx + dz * dz < 12;
      const want = (tr.userData.s as number) * (block ? 0.15 : 1);
      const cur = tr.scale.x;
      tr.scale.setScalar(cur + (want - cur) * Math.min(1, dt * 5));
    }
    const dd = this.dist * (portrait ? 1.45 : 1);
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * dd, this.focus.y + dd * 0.62, this.focus.z + Math.cos(this.yaw) * dd);
    this.camera.lookAt(this.focus.x, this.focus.y - (portrait ? 1.5 : 0.5), this.focus.z);
    if (w && h && Math.abs(this.camera.aspect - w / h) > 0.001) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    r.render(this.scene, this.camera);
  }
}
