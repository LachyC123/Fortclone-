import * as THREE from 'three';
import { Blinkbug, BugOwner } from '../entities/Blinkbug';
import type { CollisionWorld } from '../physics/Collision';
import type { FX } from '../fx/FX';
import { BugSpecies } from '../progression/Bugs';

/** swallows every FX call: preview bugs sparkle in their own little world */
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => undefined });

/**
 * A tiny turntable that renders one Blinkbug into its own canvas — used by the collection and
 * the cocoon hatch. Only renders while attached to a visible element.
 */
export class BugPreview {
  canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  private bug: Blinkbug | null = null;
  private pedestal: THREE.Mesh;
  private owner: BugOwner;
  private yaw = 0;
  private dragging = false;
  private lastX = 0;
  private spin = 0.6;
  private running = false;
  private last = 0;
  private hovering = 0;

  constructor(private cw: CollisionWorld) {
    this.canvas.className = 'bugpreview';
    this.cam.position.set(0, 0.32, 1.75);
    this.cam.lookAt(0, 0.0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a8a, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 1.5);
    this.scene.add(key);
    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0xfff1d8, roughness: 0.6 }));
    this.pedestal.position.y = -0.27;
    this.scene.add(this.pedestal);
    const owner: BugOwner = {
      isLocal: false,
      me: null,
      alive: true,
      dockWorld: (out) => out.set(0, this.hovering, 0),
      facingYaw: () => this.yaw,
    };
    this.owner = owner;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.bug?.poke();
      e.stopPropagation();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
      this.spin = 0;
    });
    window.addEventListener('pointerup', () => {
      if (this.dragging) this.spin = 0.6;
      this.dragging = false;
    });
  }

  show(species: BugSpecies) {
    if (this.bug) this.scene.remove(this.bug.root);
    this.bug = new Blinkbug(this.cw, noop as FX, this.owner, species);
    this.bug.root.scale.setScalar(1.5);
    this.scene.add(this.bug.root);
    this.bug.poke();
    this.start();
  }

  poke() {
    this.bug?.poke();
  }

  stop() {
    this.running = false;
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running || !this.canvas.isConnected) {
        this.running = false;
        return;
      }
      requestAnimationFrame(loop);
      this.render();
    };
    requestAnimationFrame(loop);
  }

  private render() {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    }
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.yaw += this.spin * dt;
    this.hovering = Math.sin(now / 600) * 0.02;
    if (this.bug) {
      this.bug.update(dt);
      this.bug.root.rotation.y = this.yaw;
      this.bug.excited = false;
    }
    this.pedestal.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.cam);
  }
}
