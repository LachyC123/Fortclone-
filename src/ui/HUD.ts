import * as THREE from 'three';
import { HudEvents, SparkInfo } from '../core/types';
import { ICONS } from './icons';
import { PERKS, PerkId, perkSvg } from '../combat/Perks';
import { RARITY } from '../render/Palette';
import type { Actor } from '../entities/Actor';
import type { Pickup, Crate } from '../loot/Loot';
import { WEAPONS, weaponStats } from '../combat/Weapons';
import { HEALS, UTILS, HealId, UtilId, ITEM_COLOR } from '../combat/Items';
import { BUG } from '../entities/Blinkbug';
import type { World } from '../world/World';
import { ISLAND_R } from '../world/Terrain';
import { ground, groundNormal, islandRadius, roadDist, POIS, STREAM_X, LAGOON_POS, ISLAND_MAX } from '../world/Heightmap';

const MAP_PX = 640;
const MAP_HALF = ISLAND_MAX + 4;
const MAP_S = MAP_PX / (MAP_HALF * 2);
import { clamp } from '../core/math';
import { audio } from '../audio/Audio';

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
  /** combo: hits on the same spot stack into one growing number */
  total: number;
  pop: number;
  head: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * DOM HUD styled like chunky hand-made toy packaging. Everything animates: hitmarkers pop,
 * slots bounce on pickup, the health bar has a "ghost" drain, damage numbers arc upward.
 */
/* per-frame DOM writes only when the value actually changes (phones hate needless layout work) */
type El = HTMLElement | SVGElement;
const domCache = new WeakMap<El, Record<string, string>>();
function cached(el: El, key: string, v: string) {
  let c = domCache.get(el);
  if (!c) domCache.set(el, (c = {}));
  if (c[key] === v) return false;
  c[key] = v;
  return true;
}
function setText(el: El, v: string) {
  if (cached(el, '#t', v)) el.textContent = v;
}
function setHtml(el: El, v: string) {
  if (cached(el, '#h', v)) el.innerHTML = v;
}
function setStyle(el: El, prop: string, v: string) {
  if (cached(el, prop, v)) (el.style as unknown as Record<string, string>)[prop] = v;
}

export class HUD implements HudEvents {
  root = h('div', 'hud hidden');
  private crosshair = h('div', 'crosshair');
  private hitmarkerEl = h('div', 'hitmarker');
  private dmgdir = h('div', 'dmgdir');
  private health = h('div', 'healthbox panel');
  private perksEl = h('div', 'perks');
  private perkSig = '';
  private hpFill!: HTMLDivElement;
  private hpGhost!: HTMLDivElement;
  private hpNum!: HTMLDivElement;
  private slotsEl = h('div', 'slots');
  private slotEls: HTMLDivElement[] = [];
  private ammoEl = h('div', 'ammo big');
  private reloadBar = h('div', 'reloadbar', '<i></i>');
  private promptEl = h('div', 'prompt panel');
  private lootCard = h('div', 'lootcard panel');
  private lootCardKey = '';
  private utilSlot!: HTMLDivElement;
  private healSlot!: HTMLDivElement;
  private itemSig = '';
  onItemTap: ((kind: 'util' | 'heal', down: boolean) => void) | null = null;
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
  private killFlashEl = h('div', 'killflash');
  private announcerEl = h('div', 'announcer big');
  private xpEl = h('div', 'xppops big');
  private speedLines = h('div', 'speedlines');
  private fpsEl = h('div', 'fps');
  private scope = h('div', 'scope', '<i class="h"></i><i class="v"></i><b></b>');
  private dmgNums: DmgNum[] = [];
  private lastHp = 100;
  private lastMag = -1;
  private lastMagSig = '';
  private lastKills = 0;
  private lastAlive = -1;
  private koEl = h('div', 'koflash');
  private lastZone = '';
  private zoneT = 0;
  private slotSig = '';
  private bugNameKey = '';
  showFps = false;
  onPlayerEliminated: ((by: string) => void) | null = null;
  /** the Gloom, when a match is running (drawn on the minimap) */
  gloom: { center: THREE.Vector2; radius: number; nextC: THREE.Vector2; nextR: number } | null = null;
  private gloomFlash = h('div', 'gloomflash');
  private emoteBtn = h('div', 'emotebtn panel big', ':)');
  private emotePick = h('div', 'emotepick');
  onEmote: ((k: 'dance' | 'wave' | 'laugh' | 'flex') => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {
    const r = this.root;
    this.crosshair.innerHTML = '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i>';
    this.health.innerHTML = `<div class="heart">${ICONS.heart}</div><div class="bar"><div class="ghost"></div><div class="fill"></div><div class="num big">100</div></div>`;
    this.hpFill = this.health.querySelector('.fill')!;
    this.hpGhost = this.health.querySelector('.ghost')!;
    this.hpNum = this.health.querySelector('.num')!;
    this.health.appendChild(this.perksEl);
    for (let i = 0; i < 3; i++) {
      const s = h('div', 'slot empty', `<span class="key big">${i + 1}</span>${ICONS.tincan}<div class="rar"></div>`) as HTMLDivElement;
      this.slotEls.push(s);
      this.slotsEl.appendChild(s);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onSlotTap?.(i);
      });
    }
    this.utilSlot = h('div', 'slot item empty', `<span class="key big">G</span><span class="ic">${ICONS.utility}</span><span class="cnt big"></span>`) as HTMLDivElement;
    this.healSlot = h('div', 'slot item empty', `<span class="key big">H</span><span class="ic">${ICONS.heal}</span><span class="cnt big"></span>`) as HTMLDivElement;
    this.slotEls.push(this.utilSlot, this.healSlot);
    this.slotsEl.append(this.utilSlot, this.healSlot);
    this.utilSlot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onItemTap?.('util', true);
    });
    this.utilSlot.addEventListener('pointerup', () => this.onItemTap?.('util', false));
    this.healSlot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onItemTap?.('heal', true);
    });
    this.root.appendChild(this.lootCard);
    const top = h('div', 'topbar');
    this.aliveEl.innerHTML = `${ICONS.people}<span>2</span>`;
    this.elimsEl.innerHTML = `${ICONS.skull}<span>0</span>`;
    top.append(this.aliveEl, this.elimsEl);
    this.minimap.appendChild(this.mapCanvas);
    this.mapCanvas.width = this.mapCanvas.height = 160;
    this.bugWidget.innerHTML = `<div class="ic"><svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.15)" stroke-width="6" fill="none"/><circle class="arc" cx="32" cy="32" r="28" stroke="#6ff7ff" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="176" stroke-dashoffset="0"/></svg><span class="b">${ICONS.bug.replace('<svg', '<svg class="b"')}</span></div><div class="txt"><div class="nm"></div><div class="st big">READY</div><div class="keys"><kbd>Q</kbd> hold+release to throw · <kbd>E</kbd> blink</div></div>`;
    this.locator.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" stroke="rgba(43,34,56,0.5)" stroke-width="5" fill="rgba(43,34,56,0.35)"/><circle class="arc" cx="22" cy="22" r="19" stroke="#6ff7ff" stroke-width="5" fill="none" stroke-dasharray="119.4" stroke-linecap="round"/></svg><div class="ic">${ICONS.bug}</div>`;
    r.append(this.koEl, this.tagLayer, this.teamEl, this.minimap, this.zoneLabel, top, this.killfeedEl, this.crosshair, this.hitmarkerEl, this.dmgdir, this.reloadBar, this.promptEl, this.toastsEl, this.health, this.ammoEl, this.slotsEl, this.bugWidget, this.locator);
    this.emotePick.innerHTML = [['dance', 'DANCE'], ['wave', 'WAVE'], ['laugh', 'LOL'], ['flex', 'FLEX']].map(([k, l]) => `<button class="big" data-k="${k}">${l}</button>`).join('');
    this.emoteBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.emotePick.classList.toggle('open');
    });
    this.emotePick.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.onEmote?.(b.dataset.k as 'dance');
      this.emotePick.classList.remove('open');
    });
    r.append(this.emoteBtn, this.emotePick);
    document.body.append(this.gloomFlash, this.scope, this.vignette, this.speedLines, this.blinkFlash, this.killFlashEl, r, this.fpsEl);
    r.append(this.announcerEl, this.xpEl);
  }

  onSlotTap: ((i: number) => void) | null = null;

  setMapBase(world: World) {
    // pre-render the island map once: hill-shaded terrain, water, roads, buildings
    const N = MAP_PX;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    const d = img.data;
    const n = new THREE.Vector3();
    const Lx = -0.55, Ly = 0.7, Lz = -0.45;
    for (let py = 0; py < N; py++)
      for (let px = 0; px < N; px++) {
        const x = (px + 0.5) / MAP_S - MAP_HALF, z = (py + 0.5) / MAP_S - MAP_HALF;
        const o = (py * N + px) * 4;
        const r = Math.hypot(x, z), R = islandRadius(Math.atan2(z, x));
        let cr: number, cg: number, cb: number;
        if (r > R) {
          cr = 169; cg = 216; cb = 240;
        } else {
          const h = ground(x, z);
          groundNormal(x, z, n);
          const shadeK = Math.max(0.55, Math.min(1.25, 0.72 + (n.x * Lx + n.y * Ly + n.z * Lz) * 0.55));
          const hk = Math.max(0, Math.min(1, h / 10));
          cr = 124 + hk * 40;
          cg = 195 + hk * 18;
          cb = 90 + hk * 30;
          const rd = roadDist(x, z);
          if (rd < 1.8) {
            cr = 214; cg = 188; cb = 140;
          }
          if (h < -0.25 && (Math.abs(x - STREAM_X) < 1.6 || Math.hypot(x - LAGOON_POS.x, z - LAGOON_POS.z) < LAGOON_POS.r)) {
            cr = 79; cg = 195; cb = 217;
          }
          if (r > R - 1.2) {
            cr *= 0.8; cg *= 0.8; cb *= 0.8;
          }
          cr *= shadeK; cg *= shadeK; cb *= shadeK;
        }
        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    const tx = (x: number) => (x + MAP_HALF) * MAP_S, tz = (z: number) => (z + MAP_HALF) * MAP_S;
    g.fillStyle = '#cfc2ac';
    g.fillRect(tx(-13), tz(-10), 26 * MAP_S, 20 * MAP_S);
    for (const z of world.zones) {
      if (!z.indoor) continue;
      g.fillStyle = '#e8b890';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.fillRect(tx(z.min.x), tz(z.min.z), (z.max.x - z.min.x) * MAP_S, (z.max.z - z.min.z) * MAP_S);
      g.strokeRect(tx(z.min.x), tz(z.min.z), (z.max.x - z.min.x) * MAP_S, (z.max.z - z.min.z) * MAP_S);
    }
    for (const nst of world.nests) {
      g.fillStyle = '#9ffcff';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(tx(nst.pos.x), tz(nst.pos.z), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    this.mapBase = c;
  }

  /* --------------------------------------------------------------------- HudEvents */

  hitmarker(headshot: boolean, kill: boolean) {
    const e = this.hitmarkerEl;
    e.className = 'hitmarker';
    void e.offsetWidth;
    e.className = `hitmarker show${headshot ? ' head' : ''}${kill ? ' kill' : ''}`;
    if (kill && headshot) this.xpPop('+25 HEADSHOT', '#f2c14e');
  }

  damageNumber(pos: THREE.Vector3, amount: number, headshot: boolean) {
    // keep hitting the same rascal and the number keeps climbing (and growing)
    let d = this.dmgNums.find((n) => n.active && n.t < 0.6 && n.pos.distanceToSquared(pos) < 1.8 * 1.8);
    if (d) {
      d.total += amount;
      d.t = Math.min(d.t, 0.14);
      d.pos.copy(pos);
      d.pop = 1;
      d.head = d.head || headshot;
    } else {
      d = this.dmgNums.find((n) => !n.active);
      if (!d) {
        if (this.dmgNums.length > 24) d = this.dmgNums[0];
        else {
          const el = h('div', 'dmgnum') as HTMLDivElement;
          this.root.appendChild(el);
          d = { el, pos: new THREE.Vector3(), t: 0, vx: 0, active: false, total: 0, pop: 0, head: false };
          this.dmgNums.push(d);
        }
      }
      d.active = true;
      d.t = 0;
      d.total = amount;
      d.pop = 0;
      d.head = headshot;
      d.pos.copy(pos);
      d.vx = (Math.random() - 0.5) * 60;
    }
    setText(d.el, String(Math.round(d.total)));
    const tier = d.total >= 100 ? ' huge' : d.total >= 50 ? ' big' : '';
    d.el.className = `dmgnum${d.head ? ' head' : ''}${tier}`;
    setStyle(d.el, 'display', 'block');
  }

  /** a golden flash round the screen edge: you got one */
  killFlash() {
    this.bump(this.killFlashEl, 'on');
  }

  /** the big shouty streak banner: DOUBLE BONK!, TRIPLE TROUBLE! ... */
  announce(text: string, tier = 1) {
    const e = this.announcerEl;
    e.textContent = text;
    e.dataset.tier = String(Math.min(3, tier));
    this.bump(e, 'on');
    audio.streak(tier);
  }

  /** a little "+100 ELIMINATION" rising under the crosshair */
  xpPop(text: string, color = '#9dff8a') {
    const e = h('div', 'xp', text);
    e.style.color = color;
    this.xpEl.appendChild(e);
    while (this.xpEl.children.length > 4) this.xpEl.firstElementChild!.remove();
    setTimeout(() => e.remove(), 1500);
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

  killfeed(killer: string, victim: string, weapon: string, local: boolean, knocked = false) {
    const verbs = ['bonked', 'blasted', 'popped', 'sent packing', 'confetti\'d', 'tickled out'];
    const verb = killer === 'THE SKY' || weapon === 'THE SKY' ? '' : verbs[Math.floor(Math.random() * verbs.length)];
    const e = h('div', `kf${local ? ' local' : ''}`);
    const pos = (n: string) => (n === 'You' ? 'Your' : `${n}'s`);
    if (weapon === 'THE SKY') e.innerHTML = `<b>${victim}</b> fell off the island`;
    else if (weapon === 'TIME') e.innerHTML = `<b>${pos(victim.replace(/'s spark$/, ''))}</b> spark fizzled out`;
    else if (weapon === 'REBUILT') e.innerHTML = `<b>${killer}</b> was <span class="w">REBUILT</span> at a Rift Nest!`;
    else if (weapon === 'THE GLOOM') e.innerHTML = `<b>${victim}</b> was swallowed by <span class="w gloom">THE GLOOM</span>`;
    else if (knocked) e.innerHTML = `<b>${killer}</b> knocked down <b>${victim}</b> <span class="w">${weapon}</span>`;
    else e.innerHTML = `<b>${killer}</b> ${verb} <b>${victim.replace(/^You's /, 'Your ')}</b> with <span class="w">${weapon}</span>`;
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

  koFlash() {
    this.koEl.classList.remove('on');
    void this.koEl.offsetWidth;
    this.koEl.classList.add('on');
    document.body.classList.add('ko');
    setTimeout(() => document.body.classList.remove('ko'), 1400);
  }

  private bump(el: HTMLElement, cls = 'bump') {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  gloomHit() {
    this.gloomFlash.classList.remove('on');
    void this.gloomFlash.offsetWidth;
    this.gloomFlash.classList.add('on');
  }

  playerElimination(victim: string, callout = '') {
    const knock = callout === 'KNOCKED!';
    this.bigToast(`${victim.toUpperCase()} ${knock ? 'KNOCKED!' : 'ELIMINATED!'}`, knock ? '#ffb36b' : '#ff8a8a');
    this.killFlash();
    this.xpPop(knock ? '+50 KNOCK' : '+100 ELIMINATION', knock ? '#ffb36b' : '#9dff8a');
    if (callout && !knock) {
      const tier = /TRIPLE|UNSTOPPABLE|RAMPAGE|FIVE/.test(callout) ? 3 : /DOUBLE|ROLL|CLUTCH/.test(callout) ? 2 : 1;
      this.announce(callout, tier);
      this.xpPop('+50 STYLE', '#ff9ad5');
    }
  }

  blink() {
    const f = this.blinkFlash;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /* --------------------------------------------------------------------- per frame */

  update(dt: number, p: Actor, others: Actor[], pickup: Pickup | null, spreadDeg: number, fps: number, touch: boolean, world: World, crate: Crate | null = null) {
    this.updateSquad(p, others);
    // health
    const hp = Math.max(0, p.hp);
    const k = hp / p.maxHp;
    setStyle(this.hpFill, 'transform', `scaleX(${k})`);
    setStyle(this.hpGhost, 'transform', `scaleX(${k})`);
    setText(this.hpNum, String(Math.ceil(hp)));
    this.health.classList.toggle('low', k < 0.35);
    setStyle(this.vignette, 'opacity', String(k < 0.35 ? 0.5 + Math.sin(performance.now() / 180) * 0.2 : 0));
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
        setStyle((s.querySelector('.rar') as HTMLDivElement), 'background', w ? RARITY[w.rarity].css : 'transparent');
        const icon = w ? (ICONS as Record<string, string>)[w.def.id] ?? ICONS.tincan : ICONS.tincan;
        const old = s.querySelector('svg');
        if (old) old.outerHTML = icon;
        s.style.setProperty('--rc', w ? RARITY[w.rarity].css : 'transparent');
        s.classList.toggle('rarity', !!w);
      });
    }
    // item slots (utility / healing) with stack counts
    const isig = `${p.util?.id ?? ''}${p.util?.count ?? 0}|${p.healItem?.id ?? ''}${p.healItem?.count ?? 0}`;
    if (isig !== this.itemSig) {
      this.itemSig = isig;
      for (const [el, st, fallback] of [
        [this.utilSlot, p.util, ICONS.utility],
        [this.healSlot, p.healItem, ICONS.heal],
      ] as [HTMLDivElement, { id: string; count: number } | null, string][]) {
        el.classList.toggle('empty', !st);
        setHtml((el.querySelector('.ic') as HTMLElement), st ? (ICONS as Record<string, string>)[st.id] : fallback);
        setText((el.querySelector('.cnt') as HTMLElement), st && st.count > 1 ? `x${st.count}` : '');
        el.style.setProperty('--rc', st ? '#' + ITEM_COLOR[st.id as HealId].toString(16).padStart(6, '0') : 'transparent');
      }
    }
    // perk badges above the health bar
    const psig = p.perks.join();
    if (psig !== this.perkSig) {
      this.perkSig = psig;
      this.perksEl.innerHTML = p.perks.map((id) => `<span class="perk" style="--pc:${PERKS[id].css}" title="${PERKS[id].name}: ${PERKS[id].blurb}">${perkSvg(id)}</span>`).join('');
      const last = this.perksEl.lastElementChild;
      last?.classList.add('fresh');
    }
    this.utilSlot.classList.toggle('aiming', p.utilAiming);
    this.healSlot.classList.toggle('using', p.healT >= 0);
    const w = p.weapon;
    if (w) {
      const reserve = p.ammo[w.def.ammo];
      setHtml(this.ammoEl, `${w.mag}<small> / ${reserve}</small>`);
      this.ammoEl.classList.toggle('empty', w.mag === 0);
      this.ammoEl.classList.toggle('low', w.mag > 0 && w.mag <= Math.ceil(w.def.mag * 0.25));
      // a little kick on every shot, a bigger pop when a reload lands
      const sig = w.def.id + p.activeSlot;
      if (sig === this.lastMagSig) {
        if (w.mag < this.lastMag) this.bump(this.ammoEl, 'kick');
        else if (w.mag > this.lastMag) this.bump(this.ammoEl, 'bump');
      }
      this.lastMagSig = sig;
      this.lastMag = w.mag;
      setStyle(this.ammoEl, 'display', 'block');
    } else setStyle(this.ammoEl, 'display', 'none');
    const bar = this.reloadBar.firstElementChild as HTMLElement;
    if (p.healT >= 0 && p.healItem) {
      setStyle(this.reloadBar, 'opacity', '1');
      this.reloadBar.classList.add('heal');
      setStyle(bar, 'transform', `scaleX(${clamp(p.healT / HEALS[p.healItem.id].useTime, 0, 1)})`);
    } else if (w && w.reloading) {
      setStyle(this.reloadBar, 'opacity', '1');
      this.reloadBar.classList.remove('heal');
      setStyle(bar, 'transform', `scaleX(${clamp(w.reloadT / w.reloadTime, 0, 1)})`);
    } else setStyle(this.reloadBar, 'opacity', '0');

    // spyglass scope for precision weapons
    const scoped = !!(w && p.ads && w.def.adsFov <= 40);
    this.scope.classList.toggle('on', scoped);
    setStyle(this.crosshair, 'visibility', scoped ? 'hidden' : 'visible');

    // crosshair spread + enemy tint
    const gap = 6 + spreadDeg * 5;
    const ch = this.crosshair.children as HTMLCollectionOf<HTMLElement>;
    ch[0].style.top = `${-gap - 9}px`;
    ch[1].style.top = `${gap}px`;
    ch[2].style.left = `${-gap - 9}px`;
    ch[3].style.left = `${gap}px`;
    this.crosshair.classList.toggle('unarmed', !w);
    setStyle(this.crosshair, 'opacity', p.throwAiming ? '0.3' : '1');

    // context prompt + loot comparison card
    this.updatePrompt(p, pickup, crate);

    // bug widget (desktop)
    const bug = p.bug;
    const st = this.bugWidget.querySelector('.st') as HTMLDivElement;
    const nameKey = `${p.bugName}|${bug.species.id}`;
    if (nameKey !== this.bugNameKey) {
      this.bugNameKey = nameKey;
      setText((this.bugWidget.querySelector('.nm') as HTMLElement), `${p.bugName} · ${bug.species.name}`);
      setStyle((this.bugWidget.querySelector('.ic') as HTMLElement), 'color', `#${bug.tint.toString(16).padStart(6, '0')}`);
      (this.bugWidget.querySelector('.arc') as SVGCircleElement).dataset.tint = `#${bug.tint.toString(16).padStart(6, '0')}`;
    }
    const arc = this.bugWidget.querySelector('.arc') as SVGCircleElement;
    if (bug.canBlink) {
      setText(st, `BLINK! ${bug.window.toFixed(1)}s`);
      setStyle(st, 'color', '#5b4bff');
      setStyle(arc, 'strokeDashoffset', String(176 * (1 - bug.window / bug.stats.window)));
      setStyle(arc, 'stroke', '#6ff7ff');
    } else if (bug.ready) {
      setText(st, p.throwAiming ? 'AIMING…' : 'READY');
      setStyle(st, 'color', '#2a9d8f');
      setStyle(arc, 'strokeDashoffset', '0');
      setStyle(arc, 'stroke', '#6ff7ff');
    } else {
      setText(st, bug.state === 'returning' ? 'COMING HOME' : `NAPPING ${bug.cooldown.toFixed(1)}s`);
      setStyle(st, 'color', '#8a7a9a');
      setStyle(arc, 'strokeDashoffset', String(176 * (bug.cooldown / Math.max(0.01, bug.cooldownMax))));
      setStyle(arc, 'stroke', '#b49be0');
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
      setStyle(this.locator, 'display', 'block');
      setStyle(this.locator, 'transform', `translate(${sx}px, ${sy - (onScreen ? 34 : 0)}px)`);
      setStyle((this.locator.querySelector('.arc') as SVGCircleElement), 'strokeDashoffset', String(119.4 * (1 - bug.window / bug.stats.window)));
      this.locator.classList.toggle('urgent', bug.window < 1.5);
    } else setStyle(this.locator, 'display', 'none');

    // speed lines when sprinting/sliding fast
    const hs = p.motor.horizontalSpeed();
    setStyle(this.speedLines, 'opacity', String(clamp((hs - 7.2) / 5, 0, 0.6)));

    // damage numbers
    const W = window.innerWidth, H = window.innerHeight;
    for (const d of this.dmgNums) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t > 1.0) {
        d.active = false;
        setStyle(d.el, 'display', 'none');
        continue;
      }
      _v.copy(d.pos).project(this.camera);
      if (_v.z > 1) {
        setStyle(d.el, 'display', 'none');
        continue;
      }
      setStyle(d.el, 'display', 'block');
      const sx = (_v.x * 0.5 + 0.5) * W + d.vx * d.t;
      const sy = (-_v.y * 0.5 + 0.5) * H - 40 * d.t + 60 * d.t * d.t;
      d.pop = Math.max(0, d.pop - dt * 6);
      const sc = (d.t < 0.12 ? 0.6 + (d.t / 0.12) * 0.8 : Math.max(1, 1.4 - (d.t - 0.12) * 2)) + d.pop * 0.5;
      setStyle(d.el, 'transform', `translate(-50%, -50%) translate(${sx}px, ${sy}px) scale(${sc})`);
      setStyle(d.el, 'opacity', String(d.t > 0.6 ? 1 - (d.t - 0.6) / 0.3 : 1));
    }

    // counters
    const alive = others.filter((a) => !a.out && !a.parked).length;
    setText((this.aliveEl.lastElementChild as HTMLElement), String(alive));
    setText((this.elimsEl.lastElementChild as HTMLElement), String(p.kills));
    if (p.kills > this.lastKills) this.bump(this.elimsEl, 'bump');
    if (this.lastAlive >= 0 && alive < this.lastAlive) this.bump(this.aliveEl, 'tick');
    this.lastKills = p.kills;
    this.lastAlive = alive;

    // zone label
    const z = world.zoneAt(p.motor.pos);
    const zn = z ? z.name : '';
    if (zn !== this.lastZone) {
      this.lastZone = zn;
      if (zn) {
        setText(this.zoneLabel, zn);
        this.zoneT = 3;
      }
    }
    this.zoneT -= dt;
    setStyle(this.zoneLabel, 'opacity', this.zoneT > 0 ? '1' : '0');

    this.drawMinimap(p, others);
    setStyle(this.fpsEl, 'display', this.showFps ? 'block' : 'none');
    if (this.showFps) setText(this.fpsEl, `${fps.toFixed(0)} fps`);
    setStyle(this.bugWidget, 'display', touch ? 'none' : 'flex');
  }

  /** squads info (null in solo / playground) */
  squad: { sparks: SparkInfo[] } | null = null;
  private teamEl = h('div', 'teampanel');
  private teamSig = '';
  private tagEls = new Map<Actor | SparkInfo, HTMLDivElement>();
  private tagLayer = h('div', 'tags');

  /** the team list under the minimap + floating name tags on teammates, knocked mates and sparks */
  private updateSquad(p: Actor, others: Actor[]) {
    const sq = this.squad;
    this.teamEl.style.display = sq ? '' : 'none';
    this.tagLayer.style.display = sq ? '' : 'none';
    if (!sq) return;
    const mates = others.filter((o) => o.team === p.team && !o.parked).sort((a, b) => (a === p ? -1 : b === p ? 1 : a.id - b.id));
    const sig = mates.map((o) => o.id).join(',');
    if (sig !== this.teamSig) {
      this.teamSig = sig;
      this.teamEl.innerHTML = mates.map((o) => `<div class="mate${o === p ? ' me' : ''}" data-id="${o.id}"><span class="nm">${o === p ? 'YOU' : o.name}</span><span class="st"></span><div class="hb"><i></i></div></div>`).join('');
    }
    for (const o of mates) {
      const row = this.teamEl.querySelector(`[data-id="${o.id}"]`) as HTMLElement | null;
      if (!row) continue;
      const spark = sq.sparks.find((s) => s.owner === o);
      const state = o.out ? (spark ? (spark.carrier ? 'CARRIED' : 'SPARK') : 'OUT') : o.bugout ? 'BUGOUT' : o.downed ? 'KNOCKED' : '';
      setText(row.querySelector('.st') as HTMLElement, state);
      row.className = `mate${o === p ? ' me' : ''}${state ? ' ' + state.toLowerCase() : ''}`;
      const k = o.downed ? o.downHp / 100 : o.alive ? o.hp / o.maxHp : 0;
      setStyle(row.querySelector('i') as HTMLElement, 'transform', `scaleX(${Math.max(0, Math.min(1, k)).toFixed(3)})`);
    }
    // floating tags
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const live = new Set<Actor | SparkInfo>();
    const tag = (key: Actor | SparkInfo, pos: THREE.Vector3, html: string, cls: string) => {
      _v.copy(pos).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return;
      live.add(key);
      let el = this.tagEls.get(key);
      if (!el) {
        el = h('div', 'tag') as HTMLDivElement;
        this.tagLayer.appendChild(el);
        this.tagEls.set(key, el);
      }
      el.className = `tag ${cls}`;
      setHtml(el, html);
      setStyle(el, 'transform', `translate(${((_v.x * 0.5 + 0.5) * W).toFixed(0)}px, ${((-_v.y * 0.5 + 0.5) * H).toFixed(0)}px)`);
    };
    for (const o of mates) {
      if (o === p || o.out) continue;
      const pos = o.bugout ? o.bug.pos : o.motor.pos;
      const d = pos.distanceTo(p.motor.pos);
      const at = _v2.copy(pos).setY(pos.y + (o.bugout ? 0.6 : o.downed ? 1.2 : 2.35));
      if (o.downed) tag(o, at, `<b>${o.name}</b><small>KNOCKED · ${Math.round(d)}m</small>`, 'down');
      else tag(o, at, `<b>${o.name}</b>${d > 12 ? `<small>${Math.round(d)}m</small>` : ''}`, o.bugout ? 'bug' : 'mate');
    }
    for (const s of sq.sparks) {
      if (s.owner.team !== p.team || s.carrier === p) continue;
      tag(s, _v2.copy(s.pos).setY(s.pos.y + 0.8), `<b>${s.owner.name}'S SPARK</b><small>${Math.round(s.pos.distanceTo(p.motor.pos))}m</small>`, 'spark');
    }
    for (const [k, el] of this.tagEls) {
      if (live.has(k)) continue;
      el.remove();
      this.tagEls.delete(k);
    }
  }

  /** squads prompt set by the game each frame (revive / spark / rebuild) */
  squadPrompt: { kind: 'revive' | 'spark' | 'rebuild'; name: string; k: number } | null = null;

  private updatePrompt(p: Actor, pickup: Pickup | null, crate: Crate | null) {
    const rs = (r: number) => `color:${RARITY[r].css};-webkit-text-stroke:1px #2b2238`;
    let html = '';
    let cardKey = '';
    const sq = this.squadPrompt;
    if (sq) {
      const pct = sq.k > 0 ? ` <b class="pct">${Math.round(sq.k * 100)}%</b>` : '';
      const col = 'color:#9ffcff;-webkit-text-stroke:1px #2b2238';
      if (sq.kind === 'revive') html = `<span class="k">HOLD F</span><span>REVIVE</span><span class="rar big" style="color:#9dff8a;-webkit-text-stroke:1px #2b2238">${sq.name.toUpperCase()}</span>${pct}`;
      else if (sq.kind === 'spark') html = `<span class="k">F</span><span>GRAB</span><span class="rar big" style="${col}">${sq.name.toUpperCase()}'S SPARK</span>`;
      else html = `<span class="k">HOLD F</span><span>REBUILD</span><span class="rar big" style="${col}">${sq.name.toUpperCase()}</span>${pct}`;
    } else if (pickup && pickup.kind === 'weapon') {
      const def = WEAPONS[pickup.defId];
      const act = p.previewOffer(pickup.defId, pickup.rarity);
      const verb = act === 'fuse' ? 'FUSE' : act === 'swap' ? 'SWAP' : 'PICK UP';
      html = `<span class="k">F</span><span>${verb}</span><span class="rar big" style="${rs(pickup.rarity)}">${RARITY[pickup.rarity].name.toUpperCase()} ${def.name.toUpperCase()}</span>`;
      cardKey = `${pickup.id}|${p.weapons.map((w) => (w ? w.def.id + w.rarity : '-')).join()}|${p.activeSlot}`;
      if (cardKey !== this.lootCardKey) this.buildLootCard(p, pickup, act);
    } else if (pickup && pickup.kind === 'perk') {
      const pd = PERKS[pickup.defId as PerkId];
      html = `<span class="k">F</span><span>SWAP FOR</span><span class="rar big" style="color:${pd.css};-webkit-text-stroke:1px #2b2238">${pd.name.toUpperCase()}</span>`;
    } else if (pickup) {
      const isHeal = pickup.kind === 'heal';
      const name = isHeal ? HEALS[pickup.defId as HealId].name : UTILS[pickup.defId as UtilId].name;
      html = `<span class="k">F</span><span>SWAP FOR</span><span class="rar big" style="${rs(pickup.rarity)}">${name.toUpperCase()}${pickup.amount > 1 ? ' x' + pickup.amount : ''}</span>`;
    } else if (crate) {
      html = `<span class="k">F</span><span>OPEN</span><span class="rar big" style="color:#f2c14e;-webkit-text-stroke:1px #2b2238">RASCAL CRATE</span>`;
    }
    if (html) {
      if (this.promptEl.dataset.h !== html) {
        this.promptEl.innerHTML = html;
        this.promptEl.dataset.h = html;
      }
      this.promptEl.classList.add('show');
    } else this.promptEl.classList.remove('show');
    if (!cardKey) {
      this.lootCardKey = '';
      this.lootCard.classList.remove('show');
    }
  }

  /** The "what am I looking at" card: stats with green/red arrows vs the gun in your hands. */
  private buildLootCard(p: Actor, pickup: Pickup, act: 'fuse' | 'add' | 'swap') {
    this.lootCardKey = `${pickup.id}|${p.weapons.map((w) => (w ? w.def.id + w.rarity : '-')).join()}|${p.activeSlot}`;
    const def = WEAPONS[pickup.defId];
    const cand = weaponStats(def, pickup.rarity);
    // compare against the same gun if carried, else the one in hand
    const same = p.weapons.find((w) => w && w.def.id === def.id) ?? null;
    const cur = same ?? p.weapon;
    const base = cur ? weaponStats(cur.def, cur.rarity) : null;
    const rows: [string, keyof typeof cand][] = [
      ['DAMAGE', 'damage'],
      ['FIRE POWER', 'rate'],
      ['RANGE', 'range'],
      ['MAGAZINE', 'mag'],
      ['HANDLING', 'handling'],
    ];
    const rc = RARITY[pickup.rarity].css;
    let badge = '';
    if (act === 'fuse') {
      const next = RARITY[Math.min(4, pickup.rarity + 1)];
      badge = `<div class="fuse" style="--nc:${next.css}"><span>FUSE</span>→ <b class="big" style="color:${next.css}">${next.name.toUpperCase()}</b><em>2 of the same!</em></div>`;
    } else if (act === 'swap' && p.weapon) badge = `<div class="swapnote">Swaps your ${RARITY[p.weapon.rarity].name.toLowerCase()} ${p.weapon.def.name}</div>`;
    const statRows = rows
      .map(([label, key]) => {
        const v = cand[key];
        let arrow = '';
        if (base) {
          const d = v - base[key];
          if (d > 0.03) arrow = '<i class="up">▲</i>';
          else if (d < -0.03) arrow = '<i class="dn">▼</i>';
          else arrow = '<i class="eq">=</i>';
        }
        const ghost = base ? `<b class="ghost" style="width:${Math.round(base[key] * 100)}%"></b>` : '';
        return `<div class="st"><span>${label}</span><div class="sb">${ghost}<b class="fill" style="width:${Math.round(v * 100)}%;background:${rc}"></b></div>${arrow}</div>`;
      })
      .join('');
    this.lootCard.style.setProperty('--rc', rc);
    this.lootCard.innerHTML = `<div class="hd"><span class="ic">${(ICONS as Record<string, string>)[def.id]}</span><div><div class="rn big" style="color:${rc}">${RARITY[pickup.rarity].name.toUpperCase()}</div><div class="nm big">${def.name}</div></div></div><div class="bl">${def.blurb}${cur ? ` <em>vs your ${cur.def.name}</em>` : ''}</div>${statRows}${badge}`;
    this.lootCard.classList.remove('show');
    void this.lootCard.offsetWidth;
    this.lootCard.classList.add('show');
  }

  /** Loot Balloon landing spots (minimap stars) */
  balloons: THREE.Vector3[] = [];
  /** this match's hot drops (flame markers) */
  hotDrops: THREE.Vector3[] = [];
  /** Sky Barge route for the overview map (set by the match while it flies) */
  route: { sx: number; sz: number; ex: number; ez: number; bx: number; bz: number } | null = null;

  private drawMinimap(p: Actor, others: Actor[]) {
    const c = this.mapCanvas;
    const g = c.getContext('2d')!;
    // overview (north-up, whole island) while riding the barge or skydiving; otherwise a
    // rotating close-up centred on you
    const overview = p.flight === 'barge' || p.flight === 'dive' || !!p.bugout;
    const ppm = overview ? 150 / (MAP_HALF * 2) : MAP_S * 0.66;
    const cx = overview ? 0 : p.motor.pos.x, cz = overview ? 0 : p.motor.pos.z;
    const U = (x: number) => (x - cx) * ppm, V = (z: number) => (z - cz) * ppm;
    const yaw = overview ? 0 : Math.atan2(-this.camera.getWorldDirection(_v).x, -_v.z);
    g.save();
    g.clearRect(0, 0, 160, 160);
    g.fillStyle = '#a9d8f0';
    g.fillRect(0, 0, 160, 160);
    g.translate(80, 80);
    g.rotate(yaw);
    if (this.mapBase) g.drawImage(this.mapBase, U(-MAP_HALF), V(-MAP_HALF), MAP_HALF * 2 * ppm, MAP_HALF * 2 * ppm);
    if (this.gloom) {
      const G = this.gloom;
      g.fillStyle = 'rgba(110, 40, 180, 0.45)';
      g.beginPath();
      g.rect(-400, -400, 800, 800);
      g.arc(U(G.center.x), V(G.center.y), Math.max(0.5, G.radius) * ppm, 0, Math.PI * 2, true);
      g.fill('evenodd');
      g.strokeStyle = '#e8a0ff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(U(G.center.x), V(G.center.y), Math.max(0.5, G.radius) * ppm, 0, Math.PI * 2);
      g.stroke();
      if (G.nextR < G.radius - 0.5) {
        g.strokeStyle = '#ffffff';
        g.setLineDash([6, 5]);
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(U(G.nextC.x), V(G.nextC.y), Math.max(0.5, G.nextR) * ppm, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    if (overview && this.route && p.flight === 'barge') {
      const r = this.route;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.setLineDash([4, 4]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(U(r.sx), V(r.sz));
      g.lineTo(U(r.ex), V(r.ez));
      g.stroke();
      g.setLineDash([]);
    }
    for (const h of this.hotDrops) {
      const u = U(h.x), v = V(h.z);
      const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
      g.save();
      g.translate(u, v);
      g.rotate(-yaw);
      g.scale(pulse, pulse);
      g.fillStyle = '#ff8a3d';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      // a little flame
      g.beginPath();
      g.moveTo(0, -9);
      g.quadraticCurveTo(7, -1, 5, 4);
      g.quadraticCurveTo(3, 8, 0, 8);
      g.quadraticCurveTo(-3, 8, -5, 4);
      g.quadraticCurveTo(-7, -1, 0, -9);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffe07a';
      g.beginPath();
      g.arc(0, 3.5, 2.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (const b of this.balloons) {
      const u = U(b.x), v = V(b.z);
      g.save();
      g.translate(u, v);
      g.rotate(-yaw);
      g.fillStyle = '#ffd36b';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 3.5 : 8;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
    if (p.bug.out) {
      g.fillStyle = '#6ff7ff';
      g.strokeStyle = '#2b2238';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(U(p.bug.pos.x), V(p.bug.pos.z), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // squads: teammates always show (triangle in team colour), sparks as cyan diamonds
    if (this.squad) {
      for (const o of others) {
        if (o === p || o.team !== p.team || o.parked || o.out) continue;
        const pos = o.bugout ? o.bug.pos : o.motor.pos;
        const u = U(pos.x), v = V(pos.z);
        g.save();
        g.translate(u, v);
        g.fillStyle = o.downed ? '#ff6b6b' : o.bugout ? '#6ff7ff' : '#9dff8a';
        g.strokeStyle = '#2b2238';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
      for (const sp of this.squad.sparks) {
        if (sp.owner.team !== p.team || sp.carrier) continue;
        g.save();
        g.translate(U(sp.pos.x), V(sp.pos.z));
        g.rotate(Math.PI / 4);
        g.fillStyle = '#9ffcff';
        g.strokeStyle = '#2b2238';
        g.lineWidth = 2;
        g.fillRect(-4, -4, 8, 8);
        g.strokeRect(-4, -4, 8, 8);
        g.restore();
      }
    }
    for (const o of others) {
      if (!o.alive || o === p || (this.squad && o.team === p.team)) continue;
      // pings: your own (Nimbus, Snap Traps) and enemies your teammates called out
      if (o.pingT > 0 && o.pingedBy && (o.pingedBy === p || o.pingedBy.team === p.team)) {
        g.fillStyle = '#ffe27a';
        g.strokeStyle = '#2b2238';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(U(o.motor.pos.x), V(o.motor.pos.z), 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        continue;
      }
      if (o.stealthT > 0 || overview) continue;
      // enemies only if recently shooting & close (sound-based "radar")
      if (o.weapon && o.weapon.cooldown > -1.2 && o.motor.pos.distanceTo(p.motor.pos) < 40) {
        g.fillStyle = '#ff6b6b';
        g.beginPath();
        g.arc(U(o.motor.pos.x), V(o.motor.pos.z), 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    // place names (kept upright)
    g.font = overview ? '700 9px Fredoka, sans-serif' : '700 10px Fredoka, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = '#2b2238';
    g.fillStyle = '#fff8e8';
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const poi of POIS) {
      const u = U(poi.x), v = V(poi.z);
      const rx = u * cy - v * sy, ry = u * sy + v * cy;
      if (Math.hypot(rx, ry) > 66) continue;
      if (!overview && Math.hypot(rx, ry) < 14) continue;
      g.strokeText(poi.name, 80 + rx, 80 + ry);
      g.fillText(poi.name, 80 + rx, 80 + ry);
    }
    // you
    g.fillStyle = '#fff8e8';
    g.strokeStyle = '#2b2238';
    g.lineWidth = 2.5;
    let ax = 80, ay = 80, ang = 0;
    if (overview) {
      const pp = p.bugout ? p.bug.pos : p.motor.pos;
      ax = 80 + U(pp.x);
      ay = 80 + V(pp.z);
      const f = this.camera.getWorldDirection(_v);
      ang = Math.atan2(f.x, -f.z);
    }
    g.save();
    g.translate(ax, ay);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(8, 8);
    g.lineTo(0, 4);
    g.lineTo(-8, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
