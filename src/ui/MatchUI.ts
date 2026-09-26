import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { ICONS } from './icons';
import { xpForLevel } from '../core/Match';

export interface MatchSummary {
  difficulty: string;
  cocoon: string;
  cocoonColor: string;
  bugName: string;
  blinksLine: number;
  won: boolean;
  placement: number;
  of: number;
  kills: number;
  damage: number;
  bestWeapon: string;
  distance: number;
  blinks: number;
  bestRarity: string;
  bestRarityColor: string;
  fusions: number;
  time: number;
  xpParts: [string, number][];
  xp: number;
  startLevel: number;
  startXp: number;
  endLevel: number;
  endXp: number;
}

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmt = (t: number) => {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const _v = new THREE.Vector3();

/** Everything on screen that belongs to the match flow rather than to moment-to-moment combat. */
export class MatchUI {
  root = h('div', 'matchui');
  private banner = h('div', 'mbanner big');
  private sub = h('div', 'msub');
  private gloomEl = h('div', 'gloompill panel big');
  private jumpEl = h('div', 'jumpprompt big');
  private routeEl = h('div', 'route', '<i></i><b></b>');
  private bugEl = h('div', 'bugout panel');
  private nestArrow = h('div', 'nestarrow', '<div class="a">▲</div><div class="d big"></div>');
  private elimEl = h('div', 'mbanner elimb big');
  private wipeEl = h('div', 'cloudwipe');
  private summaryEl = h('div', 'overlay summary hidden');
  private gloomTint = h('div', 'gloomtint');
  private lastSec = -1;
  onPlayAgain: (() => void) | null = null;
  onHome: (() => void) | null = null;

  constructor() {
    this.gloomEl.innerHTML = `<span class="ic">${ICONS.skull}</span><span class="l"></span><span class="t"></span>`;
    this.bugEl.innerHTML = `<div class="ttl big">BUGOUT!</div><div class="bar"><div class="fill"></div></div><div class="row"><span class="tm big"></span><span class="hint">Fly to a <b>Rift Nest</b> · don't get swatted!</span></div>`;
    for (let i = 0; i < 14; i++) {
      const c = h('i');
      c.style.left = `${(i / 13) * 110 - 5}%`;
      c.style.top = `${20 + ((i * 37) % 60)}%`;
      c.style.animationDelay = `${(i % 5) * 0.04}s`;
      this.wipeEl.appendChild(c);
    }
    this.root.append(this.gloomTint, this.banner, this.sub, this.gloomEl, this.routeEl, this.jumpEl, this.bugEl, this.nestArrow, this.elimEl);
    document.body.append(this.root, this.wipeEl, this.summaryEl);
    this.hideAllBits();
  }

  private hideAllBits() {
    for (const e of [this.banner, this.sub, this.gloomEl, this.jumpEl, this.routeEl, this.bugEl, this.nestArrow, this.elimEl]) e.classList.remove('show');
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  lobby(t: number, joined: number, of: number) {
    this.banner.classList.add('show');
    this.sub.classList.add('show');
    const s = Math.ceil(t);
    this.banner.textContent = s > 0 ? `SKY BARGE IN ${s}` : 'ALL ABOARD!';
    this.sub.innerHTML = `<b>${joined}</b>/${of} rascals on Launch Isle · warm up those blinks!`;
    if (s !== this.lastSec && s <= 3 && s > 0) {
      audio.uiTap();
      this.banner.classList.remove('tick');
      void this.banner.offsetWidth;
      this.banner.classList.add('tick');
    }
    this.lastSec = s;
  }

  wipe() {
    this.wipeEl.classList.remove('go');
    void this.wipeEl.offsetWidth;
    this.wipeEl.classList.add('go');
  }

  barge() {
    this.hideAllBits();
    this.routeEl.classList.add('show');
    this.gloomEl.classList.add('show');
  }

  /** k: 0..1 through the jump window (0 before the island, 1 = everyone gets tipped off) */
  bargeStatus(k: number, onBarge: boolean, canDrop: boolean, lastCall = false) {
    (this.routeEl.firstElementChild as HTMLElement).style.width = `${Math.min(100, k * 100)}%`;
    this.routeEl.classList.toggle('last', lastCall);
    this.routeEl.classList.toggle('show', onBarge);
    this.jumpEl.classList.toggle('show', onBarge);
    this.jumpEl.classList.toggle('ready', canDrop);
    const touch = document.body.classList.contains('touch-on');
    this.jumpEl.innerHTML = canDrop ? `${lastCall ? 'LAST CALL — ' : ''}JUMP! <kbd>${touch ? 'tap ⤒' : 'SPACE'}</kbd>` : 'NEARLY THERE… HOLD ON!';
  }

  live() {
    this.routeEl.classList.remove('show');
    this.jumpEl.classList.remove('show');
  }

  gloomTimer(label: string, t: number, moving: boolean) {
    this.gloomEl.classList.add('show');
    this.gloomEl.classList.toggle('moving', moving);
    (this.gloomEl.querySelector('.l') as HTMLElement).textContent = label;
    (this.gloomEl.querySelector('.t') as HTMLElement).textContent = t > 0 ? fmt(t) : '';
  }

  /** purple fog over the screen while standing in the Gloom (0..1) */
  gloomAmount(k: number) {
    this.gloomTint.style.opacity = String(k);
  }

  bugout(t: number, hpK: number, nest: THREE.Vector3 | null, dist: number, cam: THREE.Camera) {
    const on = t >= 0;
    this.bugEl.classList.toggle('show', on);
    this.nestArrow.classList.toggle('show', on && !!nest);
    if (!on) return;
    (this.bugEl.querySelector('.fill') as HTMLElement).style.width = `${Math.max(0, hpK) * 100}%`;
    const tm = this.bugEl.querySelector('.tm') as HTMLElement;
    tm.textContent = `${Math.max(0, t).toFixed(1)}s`;
    tm.classList.toggle('low', t < 6);
    if (nest) {
      // arrow on an ellipse around the screen centre, pointing at the nest
      _v.copy(nest).setY(nest.y + 1.5).project(cam);
      let x = _v.x, y = _v.y;
      if (_v.z > 1) {
        x = -x;
        y = -y;
      }
      const onScreen = _v.z < 1 && Math.abs(x) < 0.85 && Math.abs(y) < 0.8;
      const ang = Math.atan2(-y, x);
      const W = window.innerWidth, H = window.innerHeight;
      let px: number, py: number;
      if (onScreen) {
        px = (x * 0.5 + 0.5) * W;
        py = (-y * 0.5 + 0.5) * H;
      } else {
        px = W / 2 + Math.cos(ang) * W * 0.38;
        py = H / 2 + Math.sin(ang) * H * 0.36;
      }
      this.nestArrow.style.transform = `translate(${px}px, ${py}px)`;
      (this.nestArrow.firstElementChild as HTMLElement).style.transform = onScreen ? 'rotate(180deg)' : `rotate(${ang + Math.PI / 2}rad)`;
      (this.nestArrow.lastElementChild as HTMLElement).textContent = `${Math.round(dist)}m`;
    }
  }

  eliminated(by: string, placement: number) {
    this.hideAllBits();
    this.elimEl.innerHTML = `<div class="t">OUT!</div><div class="s">#${placement} · bonked by ${by}</div>`;
    this.elimEl.classList.add('show');
  }

  victory() {
    this.hideAllBits();
    this.elimEl.innerHTML = `<div class="t win">VICTORY!</div><div class="s">#1 RASCAL · the island is yours</div>`;
    this.elimEl.classList.add('show');
  }

  hideSummary() {
    this.summaryEl.classList.add('hidden');
    this.hideAllBits();
    this.gloomAmount(0);
  }

  showSummary(s: MatchSummary) {
    this.hideAllBits();
    document.exitPointerLock?.();
    const rows: [string, string, string?][] = [
      ['Eliminations', String(s.kills)],
      ['Damage dealt', String(s.damage)],
      ['Best weapon', s.bestWeapon],
      ['Best rarity found', s.bestRarity, s.bestRarityColor],
      ['Blinks', String(s.blinks)],
      ['Fusions', String(s.fusions)],
      ['Distance', `${s.distance}m`],
      ['Survived', fmt(s.time)],
    ];
    const lines = s.xpParts.filter(([, v]) => v > 0).map(([k, v], i) => `<div class="xpl" style="animation-delay:${0.5 + i * 0.12}s"><span>${k}</span><b>+${v}</b></div>`).join('');
    this.summaryEl.innerHTML = `<div class="sumcard panel">
      <div class="place big ${s.won ? 'win' : ''}">${s.won ? 'VICTORY ROYALE-ISH!' : `#${s.placement}`}<small> of ${s.of}</small></div>
      <div class="stats">${rows.map(([k, v, c]) => `<div class="st"><span>${k}</span><b class="big" ${c ? `style="color:${c}"` : ''}>${v}</b></div>`).join('')}</div>
      <div class="xp"><div class="lv big">LV <span class="n">${s.startLevel}</span></div><div class="xpbar"><div class="fill"></div></div><div class="gain big">+${s.xp} XP</div></div>
      <div class="xplines">${lines}</div>
      <div class="diff">Bots: <b>${s.difficulty}</b> · change in Settings</div>
      <div class="cocoonwin" style="--rc:${s.cocoonColor}"><span class="coc"></span><span><b class="big">+1 ${s.cocoon.toUpperCase()} COCOON</b><br><small>${s.bugName} can't wait to meet a new friend · hatch it in MY BUGS</small></span></div>
      <div class="btns"><button class="btn again">PLAY AGAIN</button><button class="btn secondary home">HOME</button></div>
    </div>`;
    this.summaryEl.classList.remove('hidden');
    const fill = this.summaryEl.querySelector('.xpbar .fill') as HTMLElement;
    const lvEl = this.summaryEl.querySelector('.lv .n') as HTMLElement;
    fill.style.width = `${(s.startXp / xpForLevel(s.startLevel)) * 100}%`;
    // animate the XP bar, looping through level-ups
    let lvl = s.startLevel, xp = s.startXp, remaining = s.xp;
    const step = () => {
      if (remaining <= 0 || this.summaryEl.classList.contains('hidden')) return;
      const need = xpForLevel(lvl);
      const add = Math.min(remaining, need - xp, Math.max(8, need / 40));
      xp += add;
      remaining -= add;
      if (xp >= need) {
        xp = 0;
        lvl++;
        lvEl.textContent = String(lvl);
        lvEl.parentElement!.classList.remove('up');
        void lvEl.offsetWidth;
        lvEl.parentElement!.classList.add('up');
        audio.fuse();
      }
      fill.style.width = `${(xp / xpForLevel(lvl)) * 100}%`;
      requestAnimationFrame(step);
    };
    setTimeout(step, 700);
    this.summaryEl.querySelector('.again')!.addEventListener('click', () => {
      audio.uiTap();
      this.onPlayAgain?.();
    });
    this.summaryEl.querySelector('.home')!.addEventListener('click', () => {
      audio.uiTap();
      this.onHome?.();
    });
  }
}
