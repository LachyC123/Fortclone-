import * as THREE from 'three';
import { HudEvents } from '../core/types';
import { ICONS } from './icons';
import { RARITY } from '../render/Palette';
import type { Actor } from '../entities/Actor';
import type { Pickup } from '../loot/Loot';
import { WEAPONS } from '../combat/Weapons';
import { BUG } from '../entities/Blinkbug';
import type { World } from '../world/World';
import { ISLAND_R } from '../world/Terrain';
import { clamp } from '../core/math';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

interface DmgNum {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  vx: number;
  active: boolean;
}

const _v = new THREE.Vector3();

/**
 * DOM HUD styled like chunky hand-made toy packaging. Everything animates: hitmarkers pop,
 * slots bounce on pickup, the health bar has a "ghost" drain, damage numbers arc upward.
 */
export class HUD implements HudEvents {
  root = h('div', 'hud hidden');
  private crosshair = h('div', 'crosshair');
  private hitmarkerEl = h('div', 'hitmarker');
  private dmgdir = h('div', 'dmgdir');
  private health = h('div', 'healthbox panel');
  private hpFill!: HTMLDivElement;
  private hpGhost!: HTMLDivElement;
  private hpNum!: HTMLDivElement;
  private slotsEl = h('div', 'slots');
  private slotEls: HTMLDivElement[] = [];
  private ammoEl = h('div', 'ammo big');
  private reloadBar = h('div', 'reloadbar', '<i></i>');
  private promptEl = h('div', 'prompt panel');
  private toastsEl = h('div', 'toasts big');
  private killfeedEl = h('div', 'killfeed');
  private aliveEl = h('div', 'pill panel alive big');
  private elimsEl = h('div', 'pill panel elims big');
  private minimap = h('div', 'minimap');
  private mapCanvas = h('canvas');
  private mapBase: HTMLCanvasElement | null = null;
  private zoneLabel = h('div', 'zone-label big');
  private bugWidget = h('div', 'bugwidget panel');
  private locator = h('div', 'buglocator');
  private vignette = h('div', 'vignette');
  private blinkFlash = h('div', 'blinkflash');
  private speedLines = h('div', 'speedlines');
  private fpsEl = h('div', 'fps');
  private dmgNums: DmgNum[] = [];
  private lastHp = 100;
  private lastZone = '';
  private zoneT = 0;
  private slotSig = '';
  showFps = false;
  onPlayerEliminated: ((by: string) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {
    const r = this.root;
    this.crosshair.innerHTML = '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i>';
    this.health.innerHTML = `<div class="heart">${ICONS.heart}</div><div class="bar"><div class="ghost"></div><div class="fill"></div><div class="num big">100</div></div>`;
    this.hpFill = this.health.querySelector('.fill')!;
    this.hpGhost = this.health.querySelector('.ghost')!;
    this.hpNum = this.health.querySelector('.num')!;
    for (let i = 0; i < 3; i++) {
      const s = h('div', 'slot empty', `<span class="key big">${i + 1}</span>${ICONS.tincan}<div class="rar"></div>`) as HTMLDivElement;
      this.slotEls.push(s);
      this.slotsEl.appendChild(s);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onSlotTap?.(i);
      });
    }
    this.slotsEl.appendChild(h('div', 'slot small', ICONS.utility));
    this.slotsEl.appendChild(h('div', 'slot small', ICONS.heal));
    const top = h('div', 'topbar');
    this.aliveEl.innerHTML = `${ICONS.people}<span>2</span>`;
    this.elimsEl.innerHTML = `${ICONS.skull}<span>0</span>`;
    top.append(this.aliveEl, this.elimsEl);
    this.minimap.appendChild(this.mapCanvas);
    this.mapCanvas.width = this.mapCanvas.height = 160;
    this.bugWidget.innerHTML = `<div class="ic"><svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.15)" stroke-width="6" fill="none"/><circle class="arc" cx="32" cy="32" r="28" stroke="#6ff7ff" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="176" stroke-dashoffset="0"/></svg><span class="b">${ICONS.bug.replace('<svg', '<svg class="b"')}</span></div><div class="txt"><div class="st big">READY</div><div class="keys"><kbd>Q</kbd> hold+release to throw · <kbd>E</kbd> blink</div></div>`;
    this.locator.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" stroke="rgba(43,34,56,0.5)" stroke-width="5" fill="rgba(43,34,56,0.35)"/><circle class="arc" cx="22" cy="22" r="19" stroke="#6ff7ff" stroke-width="5" fill="none" stroke-dasharray="119.4" stroke-linecap="round"/></svg><div class="ic">${ICONS.bug}</div>`;
    r.append(this.minimap, this.zoneLabel, top, this.killfeedEl, this.crosshair, this.hitmarkerEl, this.dmgdir, this.reloadBar, this.promptEl, this.toastsEl, this.health, this.ammoEl, this.slotsEl, this.bugWidget, this.locator);
    document.body.append(this.vignette, this.speedLines, this.blinkFlash, r, this.fpsEl);
  }

  onSlotTap: ((i: number) => void) | null = null;

  setMapBase(world: World) {
    // pre-render the island map once
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    const g = c.getContext('2d')!;
    const S = 320 / (ISLAND_R * 2 + 8);
    const tx = (x: number) => 160 + x * S, tz = (z: number) => 160 + z * S;
    g.fillStyle = '#a9d8f0';
    g.fillRect(0, 0, 320, 320);
    g.fillStyle = '#7cc35a';
    g.beginPath();
    g.arc(160, 160, ISLAND_R * S, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4fc3d9';
    g.fillRect(tx(-29.5), 0, 3 * S, 320);
    g.fillStyle = '#cfc2ac';
    g.fillRect(tx(-13), tz(-10), 26 * S, 20 * S);
    for (const z of world.zones) {
      g.fillStyle = '#e8b890';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.fillRect(tx(z.min.x), tz(z.min.z), (z.max.x - z.min.x) * S, (z.max.z - z.min.z) * S);
      g.strokeRect(tx(z.min.x), tz(z.min.z), (z.max.x - z.min.x) * S, (z.max.z - z.min.z) * S);
    }
    g.fillStyle = '#b49be0';
    g.fillRect(tx(17.8), tz(1.8), 4.4 * S, 4.4 * S);
    this.mapBase = c;
  }

  /* --------------------------------------------------------------------- HudEvents */

  hitmarker(headshot: boolean, kill: boolean) {
    const e = this.hitmarkerEl;
    e.className = 'hitmarker';
    void e.offsetWidth;
    e.className = `hitmarker show${headshot ? ' head' : ''}${kill ? ' kill' : ''}`;
  }

  damageNumber(pos: THREE.Vector3, amount: number, headshot: boolean) {
    let d = this.dmgNums.find((n) => !n.active);
    if (!d) {
      if (this.dmgNums.length > 24) d = this.dmgNums[0];
      else {
        const el = h('div', 'dmgnum') as HTMLDivElement;
        this.root.appendChild(el);
        d = { el, pos: new THREE.Vector3(), t: 0, vx: 0, active: false };
        this.dmgNums.push(d);
      }
    }
    d.active = true;
    d.t = 0;
    d.pos.copy(pos);
    d.vx = (Math.random() - 0.5) * 60;
    d.el.textContent = String(amount);
    d.el.className = `dmgnum${headshot ? ' head' : ''}`;
    d.el.style.display = 'block';
  }

  damageFrom(dirWorld: THREE.Vector3) {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(_v);
    const a = Math.atan2(dirWorld.x, dirWorld.z) - Math.atan2(fwd.x, fwd.z);
    const i = h('i');
    i.style.transform = `rotate(${-a + Math.PI}rad)`;
    this.dmgdir.appendChild(i);
    setTimeout(() => i.remove(), 1000);
  }

  killfeed(killer: string, victim: string, weapon: string, local: boolean) {
    const verbs = ['bonked', 'blasted', 'popped', 'sent packing', 'confetti\'d', 'tickled out'];
    const verb = killer === 'THE SKY' || weapon === 'THE SKY' ? '' : verbs[Math.floor(Math.random() * verbs.length)];
    const e = h('div', `kf${local ? ' local' : ''}`);
    e.innerHTML = weapon === 'THE SKY' ? `<b>${victim}</b> fell off the island` : `<b>${killer}</b> ${verb} <b>${victim}</b> with <span class="w">${weapon}</span>`;
    this.killfeedEl.prepend(e);
    while (this.killfeedEl.children.length > 5) this.killfeedEl.lastElementChild!.remove();
    setTimeout(() => {
      e.classList.add('out');
      setTimeout(() => e.remove(), 400);
    }, 6000);
  }

  toast(text: string, color = '#fff') {
    const e = h('div', 'toast');
    e.textContent = text;
    e.style.color = color;
    this.toastsEl.appendChild(e);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild!.remove();
    setTimeout(() => e.remove(), 1800);
  }

  bigToast(text: string, color = '#f2c14e') {
    const e = h('div', 'bigtoast big');
    e.textContent = text;
    e.style.color = color;
    this.root.appendChild(e);
    setTimeout(() => e.remove(), 2200);
  }

  slotPulse(slot: number) {
    const s = this.slotEls[slot];
    if (!s) return;
    s.classList.remove('pulse');
    void s.offsetWidth;
    s.classList.add('pulse');
  }

  playerEliminated(by: string) {
    this.onPlayerEliminated?.(by);
  }

  playerElimination(victim: string) {
    this.bigToast(`${victim.toUpperCase()} ELIMINATED!`, '#ff8a8a');
  }

  blink() {
    const f = this.blinkFlash;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /* --------------------------------------------------------------------- per frame */

  update(dt: number, p: Actor, others: Actor[], pickup: Pickup | null, spreadDeg: number, fps: number, touch: boolean, world: World) {
    // health
    const hp = Math.max(0, p.hp);
    const k = hp / p.maxHp;
    this.hpFill.style.transform = `scaleX(${k})`;
    this.hpGhost.style.transform = `scaleX(${k})`;
    this.hpNum.textContent = String(Math.ceil(hp));
    this.health.classList.toggle('low', k < 0.35);
    this.vignette.style.opacity = String(k < 0.35 ? 0.5 + Math.sin(performance.now() / 180) * 0.2 : 0);
    if (hp < this.lastHp) {
      this.health.animate([{ transform: 'translateX(-50%) translateX(-6px)' }, { transform: 'translateX(-50%) translateX(6px)' }, { transform: 'translateX(-50%)' }], { duration: 180 });
    }
    this.lastHp = hp;

    // weapon slots
    const sig = p.weapons.map((w) => (w ? w.def.id + w.rarity : '-')).join(',') + p.activeSlot;
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      p.weapons.forEach((w, i) => {
        const s = this.slotEls[i];
        s.classList.toggle('empty', !w);
        s.classList.toggle('active', i === p.activeSlot && !!w);
        (s.querySelector('.rar') as HTMLDivElement).style.background = w ? RARITY[w.rarity].css : 'transparent';
      });
    }
    const w = p.weapon;
    if (w) {
      const reserve = p.ammo[w.def.ammo];
      this.ammoEl.innerHTML = `${w.mag}<small> / ${reserve}</small>`;
      this.ammoEl.classList.toggle('empty', w.mag === 0);
      this.ammoEl.style.display = 'block';
    } else this.ammoEl.style.display = 'none';
    if (w && w.reloading) {
      this.reloadBar.style.opacity = '1';
      (this.reloadBar.firstElementChild as HTMLElement).style.transform = `scaleX(${clamp(w.reloadT / w.reloadTime, 0, 1)})`;
    } else this.reloadBar.style.opacity = '0';

    // crosshair spread + enemy tint
    const gap = 6 + spreadDeg * 5;
    const ch = this.crosshair.children as HTMLCollectionOf<HTMLElement>;
    ch[0].style.top = `${-gap - 9}px`;
    ch[1].style.top = `${gap}px`;
    ch[2].style.left = `${-gap - 9}px`;
    ch[3].style.left = `${gap}px`;
    this.crosshair.classList.toggle('unarmed', !w);
    this.crosshair.style.opacity = p.throwAiming ? '0.3' : '1';

    // context prompt
    if (pickup) {
      const def = WEAPONS[pickup.defId];
      const cur = p.weapon;
      const better = !cur || pickup.rarity > cur.rarity;
      this.promptEl.innerHTML = `<span class="k">F</span><span>PICK UP</span><span class="rar big" style="color:${RARITY[pickup.rarity].css};-webkit-text-stroke:1px #2b2238">${RARITY[pickup.rarity].name.toUpperCase()} ${def.name.toUpperCase()}</span>${better && cur ? '<span class="up">▲</span>' : ''}`;
      this.promptEl.classList.add('show');
    } else this.promptEl.classList.remove('show');

    // bug widget (desktop)
    const bug = p.bug;
    const st = this.bugWidget.querySelector('.st') as HTMLDivElement;
    const arc = this.bugWidget.querySelector('.arc') as SVGCircleElement;
    if (bug.canBlink) {
      st.textContent = `BLINK! ${bug.window.toFixed(1)}s`;
      st.style.color = '#5b4bff';
      arc.style.strokeDashoffset = String(176 * (1 - bug.window / BUG.window));
      arc.style.stroke = '#6ff7ff';
    } else if (bug.ready) {
      st.textContent = p.throwAiming ? 'AIMING…' : 'READY';
      st.style.color = '#2a9d8f';
      arc.style.strokeDashoffset = '0';
      arc.style.stroke = '#6ff7ff';
    } else {
      st.textContent = bug.state === 'returning' ? 'COMING HOME' : `NAPPING ${bug.cooldown.toFixed(1)}s`;
      st.style.color = '#8a7a9a';
      arc.style.strokeDashoffset = String(176 * (bug.cooldown / Math.max(0.01, bug.cooldownMax)));
      arc.style.stroke = '#b49be0';
    }

    // bug locator (screen-space, clamped to edges)
    if (bug.out) {
      _v.copy(bug.pos).project(this.camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const W = window.innerWidth, H = window.innerHeight;
      let sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * H;
      const onScreen = !behind && sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30;
      if (!onScreen) {
        const cx = W / 2, cy = H / 2;
        const dx = sx - cx, dy = sy - cy;
        const s = Math.min((W / 2 - 40) / Math.abs(dx || 1), (H / 2 - 40) / Math.abs(dy || 1));
        sx = cx + dx * s;
        sy = cy + dy * s;
      }
      this.locator.style.display = 'block';
      this.locator.style.transform = `translate(${sx}px, ${sy - (onScreen ? 34 : 0)}px)`;
      (this.locator.querySelector('.arc') as SVGCircleElement).style.strokeDashoffset = String(119.4 * (1 - bug.window / BUG.window));
      this.locator.classList.toggle('urgent', bug.window < 1.5);
    } else this.locator.style.display = 'none';

    // speed lines when sprinting/sliding fast
    const hs = p.motor.horizontalSpeed();
    this.speedLines.style.opacity = String(clamp((hs - 7.2) / 5, 0, 0.6));

    // damage numbers
    const W = window.innerWidth, H = window.innerHeight;
    for (const d of this.dmgNums) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t > 0.9) {
        d.active = false;
        d.el.style.display = 'none';
        continue;
      }
      _v.copy(d.pos).project(this.camera);
      if (_v.z > 1) {
        d.el.style.display = 'none';
        continue;
      }
      d.el.style.display = 'block';
      const sx = (_v.x * 0.5 + 0.5) * W + d.vx * d.t;
      const sy = (-_v.y * 0.5 + 0.5) * H - 40 * d.t + 60 * d.t * d.t;
      const sc = d.t < 0.12 ? 0.6 + (d.t / 0.12) * 0.8 : Math.max(1, 1.4 - (d.t - 0.12) * 2);
      d.el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px) scale(${sc})`;
      d.el.style.opacity = String(d.t > 0.6 ? 1 - (d.t - 0.6) / 0.3 : 1);
    }

    // counters
    const alive = others.filter((a) => a.alive).length;
    (this.aliveEl.lastElementChild as HTMLElement).textContent = String(alive);
    (this.elimsEl.lastElementChild as HTMLElement).textContent = String(p.kills);

    // zone label
    const z = world.zoneAt(p.motor.pos);
    const zn = z ? z.name : '';
    if (zn !== this.lastZone) {
      this.lastZone = zn;
      if (zn) {
        this.zoneLabel.textContent = zn;
        this.zoneT = 3;
      }
    }
    this.zoneT -= dt;
    this.zoneLabel.style.opacity = this.zoneT > 0 ? '1' : '0';

    this.drawMinimap(p, others);
    this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    if (this.showFps) this.fpsEl.textContent = `${fps.toFixed(0)} fps`;
    this.bugWidget.style.display = touch ? 'none' : 'flex';
  }

  private drawMinimap(p: Actor, others: Actor[]) {
    const c = this.mapCanvas;
    const g = c.getContext('2d')!;
    const S = 320 / (ISLAND_R * 2 + 8);
    const zoom = 2.2;
    g.save();
    g.clearRect(0, 0, 160, 160);
    g.translate(80, 80);
    const yaw = Math.atan2(-this.camera.getWorldDirection(_v).x, -_v.z);
    g.rotate(yaw);
    g.scale(zoom / 2, zoom / 2);
    if (this.mapBase) g.drawImage(this.mapBase, -160 - p.motor.pos.x * S, -160 - p.motor.pos.z * S);
    // bug marker
    if (p.bug.out) {
      g.fillStyle = '#6ff7ff';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.beginPath();
      g.arc((p.bug.pos.x - p.motor.pos.x) * S, (p.bug.pos.z - p.motor.pos.z) * S, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // enemies only if recently shooting & close (sound-based "radar"), not all the time
    for (const o of others) {
      if (!o.alive || o === p) continue;
      if (o.weapon && o.weapon.cooldown > -1.2 && o.motor.pos.distanceTo(p.motor.pos) < 40) {
        g.fillStyle = '#ff6b6b';
        g.beginPath();
        g.arc((o.motor.pos.x - p.motor.pos.x) * S, (o.motor.pos.z - p.motor.pos.z) * S, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    // player arrow (always pointing up since the map rotates)
    g.fillStyle = '#fff8e8';
    g.strokeStyle = '#2b2238';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(80, 70);
    g.lineTo(88, 88);
    g.lineTo(80, 84);
    g.lineTo(72, 88);
    g.closePath();
    g.fill();
    g.stroke();
  }
}
