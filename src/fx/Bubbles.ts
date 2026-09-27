import * as THREE from 'three';
import type { Actor } from '../entities/Actor';

/**
 * Little comic speech bubbles over rascals' heads ("!", "?", "HA!", "EEK!"). Sprites with cached
 * canvas textures; only drawn for rascals near the camera so they stay cheap and readable.
 */
export class Bubbles {
  private cache = new Map<string, THREE.SpriteMaterial>();
  private sprites = new Map<Actor, THREE.Sprite>();

  constructor(private scene: THREE.Scene) {}

  private material(text: string, color: string) {
    const key = text + color;
    let m = this.cache.get(key);
    if (m) return m;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g = c.getContext('2d')!;
    // bubble with a tail
    g.fillStyle = '#fff8e8';
    g.strokeStyle = '#2b2238';
    g.lineWidth = 10;
    g.beginPath();
    g.roundRect(14, 12, 228, 104, 44);
    g.moveTo(110, 114);
    g.lineTo(128, 150);
    g.lineTo(150, 114);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff8e8';
    g.fillRect(104, 104, 52, 14);
    g.font = `${text.length > 3 ? 56 : 72}px "Lilita One", "Fredoka", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#2b2238';
    g.strokeText(text, 128, 66);
    g.fillStyle = color;
    g.fillText(text, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, transparent: true });
    this.cache.set(key, m);
    return m;
  }

  update(actors: Actor[], cam: THREE.Camera, time: number) {
    for (const a of actors) {
      const sp = a.speech;
      let s = this.sprites.get(a);
      const show = !!sp && a.alive && time - sp.t < sp.dur && a.motor.pos.distanceToSquared(cam.position) < 45 * 45 && !a.isLocal;
      if (!show) {
        if (s) s.visible = false;
        continue;
      }
      if (!s) {
        s = new THREE.Sprite();
        s.renderOrder = 40;
        this.scene.add(s);
        this.sprites.set(a, s);
      }
      s.material = this.material(sp!.text, sp!.color);
      const age = time - sp!.t;
      const pop = age < 0.12 ? age / 0.12 * 1.25 : age < 0.22 ? 1.25 - ((age - 0.12) / 0.1) * 0.25 : 1;
      const fade = sp!.dur - age < 0.25 ? (sp!.dur - age) / 0.25 : 1;
      const sc = 0.95 * pop * fade;
      s.scale.set(sc * 1.6, sc, 1);
      s.position.set(a.motor.pos.x, a.motor.pos.y + a.motor.height + 0.75 + Math.sin(age * 5) * 0.03, a.motor.pos.z);
      s.visible = true;
    }
  }
}
