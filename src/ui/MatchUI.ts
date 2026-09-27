import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { ICONS } from './icons';
import { xpForLevel } from '../core/Match';
import { relicSvg } from '../progression/Relics';
import { RARITY, RarityIndex } from '../render/Palette';

export interface MatchSummary {
  difficulty: string;
  cocoon: string;
  cocoonColor: string;
  bugName: string;
  blinksLine: number;
  won: boolean;
  placement: number;
  of: number;
  /** placement counts teams (squads) */
  teams?: boolean;
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
  trophyGain: number;
  trophiesBefore: number;
  trophies: number;
  arenaName: string;
  arenaColor: string;
  arenaAt: number;
  nextArenaAt: number;
  newArena: string;
  rewardsWaiting: number;
  glimmerParts: [string, number][];
  glimmer: number;
  glimmerBefore: number;
  relics: { id: string; name: string; rarity: number; fresh: boolean; glimmer: number; set: string }[];
  /** relics you were still carrying when you went down (dropped for someone else) */
  lostRelics: number;
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
  gloomEl = h('div', 'gloompill panel big');
  private jumpEl = h('div', 'jumpprompt big');
  private routeEl = h('div', 'route', '<i></i><b></b>');
  private bugEl = h('div', 'bugout panel');
  private nestArrow = h('div', 'nestarrow', '<div class="a">▲</div><div class="d big"></div>');
  private elimEl = h('div', 'mbanner elimb big');
  private wipeEl = h('div', 'cloudwipe');
  private summaryEl = h('div', 'overlay summary hidden');
  private gloomTint = h('div', 'gloomtint');
  private knockEl = h('div', 'knockban', '<div class="t big">KNOCKED DOWN</div><div class="s">Crawl to cover — a teammate can pick you up</div><div class="bar"><i></i></div>');
  private specEl = h('div', 'specban');
  private relicEl = h('div', 'relicpill panel');
  private relicKey = '';
  private lastSec = -1;
  onPlayAgain: (() => void) | null = null;
  onHome: (() => void) | null = null;
  /** LAN client: only the host can restart, so 'play again' becomes a waiting note */
  netClient = false;
  netRoom = false;

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
    this.root.append(this.relicEl, this.knockEl, this.specEl, this.gloomTint, this.banner, this.sub, this.gloomEl, this.routeEl, this.jumpEl, this.bugEl, this.nestArrow, this.elimEl);
    document.body.append(this.root, this.wipeEl, this.summaryEl);
    this.hideAllBits();
  }

  private hideAllBits() {
    for (const e of [this.banner, this.sub, this.gloomEl, this.jumpEl, this.routeEl, this.bugEl, this.nestArrow, this.elimEl, this.relicEl]) e.classList.remove('show');
  }

  /** Rift Relics you're carrying: gems, how far the nearest nest is, and the send-home bar */
  relicPouch(ids: string[], nestDist: number, bankK: number) {
    const on = ids.length > 0;
    this.relicEl.classList.toggle('show', on);
    if (!on) {
      this.relicKey = '';
      return;
    }
    const key = `${ids.join(',')}|${bankK > 0 ? 'b' : Math.round(nestDist / 5)}`;
    if (key !== this.relicKey) {
      this.relicKey = key;
      const gems = ids.map((id) => relicSvg(id, 22)).join('');
      const txt = bankK > 0 ? '<b>SENDING HOME…</b>' : `Take ${ids.length > 1 ? 'them' : 'it'} to a <b>Rift Nest</b>${nestDist < 999 ? ` · ${Math.round(nestDist)}m` : ''}`;
      this.relicEl.innerHTML = `<span class="gems">${gems}</span><span class="tx">${txt}</span><i class="bar"><b></b></i>`;
    }
    this.relicEl.classList.toggle('banking', bankK > 0);
    (this.relicEl.querySelector('.bar b') as HTMLElement).style.transform = `scaleX(${Math.min(1, bankK)})`;
  }

  /** squads: you're down (bleed bar filled by knockedBleed) */
  knocked(on: boolean) {
    this.knockEl.classList.toggle('show', on);
  }
  knockedBleed(k: number, reviveK: number) {
    const bar = this.knockEl.querySelector('i') as HTMLElement;
    bar.style.transform = `scaleX(${Math.max(0, k)})`;
    this.knockEl.classList.toggle('reviving', reviveK > 0);
    (this.knockEl.querySelector('.s') as HTMLElement).textContent = reviveK > 0 ? `Getting picked up… ${Math.round(reviveK * 100)}%` : 'Crawl to cover — a teammate can pick you up';
  }

  /** squads: out, but your team can still bring you back */
  spectating(name: string, on: boolean) {
    this.specEl.classList.toggle('show', on);
    if (on) this.specEl.innerHTML = `<b class="big">YOU'RE OUT${name ? ` · WATCHING ${name.toUpperCase()}` : ''}</b><small>Your spark dropped — a teammate can carry it to a Rift Nest to rebuild you</small>`;
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
    this.gloomEl.style.display = v ? '' : 'none';
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
    const rows: [string, string][] = [
      ['Eliminations', String(s.kills)],
      ['Damage', s.damage.toLocaleString()],
      ['Survived', fmt(s.time)],
      ['Best weapon', s.bestWeapon],
    ];
    const more = `Blinks ${s.blinks} · Fusions ${s.fusions} · Distance ${s.distance}m · Best find ${s.bestRarity}`;
    const breakdown = (parts: [string, number][]) => parts.filter(([, v]) => v > 0).map(([k, v]) => `${k} +${v}`).join(' · ');
    const arenaPct = Math.max(0, Math.min(100, ((s.trophiesBefore - s.arenaAt) / Math.max(1, s.nextArenaAt - s.arenaAt)) * 100));
    const notes = [
      s.newArena ? `<span class="note arena big">NEW ARENA: ${s.newArena.toUpperCase()}!</span>` : '',
      s.rewardsWaiting ? `<span class="note">${ICONS.trophy}${s.rewardsWaiting} Trophy Road reward${s.rewardsWaiting > 1 ? 's' : ''} to claim</span>` : '',
      s.lostRelics ? `<span class="note bad">Dropped ${s.lostRelics} relic${s.lostRelics > 1 ? 's' : ''} — bank them at a Rift Nest next time</span>` : '',
    ].join('');
    this.summaryEl.innerHTML = `<div class="sumcard panel">
      <div class="sumhead"><div class="place big ${s.won ? 'win' : ''}">${s.won ? 'VICTORY!' : `#${s.placement}`}</div>
        <div class="sub">${s.won ? `Last ${s.teams ? 'squad' : 'rascal'} standing` : `of ${s.of}${s.teams ? ' teams' : ' rascals'}`}</div></div>
      <div class="stats" title="${more}">${rows.map(([k, v]) => `<div class="st"><span>${k}</span><b class="big">${v}</b></div>`).join('')}</div>
      <div class="rewards">
        <div class="rw trophyrow" style="--ac:${s.arenaColor}"><span class="lbl">TROPHIES</span><div class="val"><span class="tr big">${ICONS.trophy}<b class="n">${s.trophiesBefore}</b></span><span class="gain big ${s.trophyGain < 0 ? 'neg' : ''}">${s.trophyGain >= 0 ? '+' : ''}${s.trophyGain}</span></div><div class="abar"><div class="fill" style="width:${arenaPct}%"></div><span>${s.arenaName}</span></div></div>
        <div class="rw glimrow" title="${breakdown(s.glimmerParts)}"><span class="lbl">GLIMMER</span><div class="val"><span class="gl big">${ICONS.glimmer}<b class="n">${s.glimmerBefore}</b></span><span class="gain big">+${s.glimmer}</span></div><small>Spend it in your Burrow</small></div>
        <div class="rw xp" title="${breakdown(s.xpParts)}"><span class="lbl">LEVEL</span><div class="val"><span class="lv big">LV <span class="n">${s.startLevel}</span></span><span class="gain big">+${s.xp.toLocaleString()} XP</span></div><div class="xpbar"><div class="fill"></div></div></div>
        <div class="rw cocoonwin" style="--rc:${s.cocoonColor}"><span class="lbl">NEW COCOON</span><div class="val"><span class="coc"></span><b class="big">${s.cocoon}</b></div><small>Hatch it in your Burrow</small></div>
      </div>
      ${s.relics.length ? `<div class="relicwin">${s.relics.map((r, i) => `<div class="rw" style="--rc:${RARITY[r.rarity as RarityIndex].css};animation-delay:${0.8 + i * 0.25}s">${relicSvg(r.id, 26)}<span><b class="big">${r.name}</b><small>${r.fresh ? 'NEW — on display in your museum' : `Duplicate · +${r.glimmer} glimmer`}</small>${r.set ? `<em class="big">${r.set}</em>` : ''}</span></div>`).join('')}</div>` : ''}
      ${notes ? `<div class="notes">${notes}</div>` : ''}
      <div class="btns">${this.netClient ? '<div class="wait">The host can start the next match</div>' : '<button class="btn again">PLAY AGAIN</button>'}<button class="btn secondary home">${this.netClient || this.netRoom ? 'LEAVE ROOM' : 'HOME'}</button></div>
      <div class="diff">Bots: ${s.difficulty}</div>
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
    // count the trophies up (or down) and slide the arena bar
    const tn = this.summaryEl.querySelector('.trophyrow .n') as HTMLElement;
    const tf = this.summaryEl.querySelector('.trophyrow .abar .fill') as HTMLElement;
    let shown = s.trophiesBefore;
    const tstep = () => {
      if (shown === s.trophies || this.summaryEl.classList.contains('hidden')) return;
      shown += Math.sign(s.trophies - shown);
      tn.textContent = String(shown);
      tf.style.width = `${Math.max(0, Math.min(100, ((shown - s.arenaAt) / Math.max(1, s.nextArenaAt - s.arenaAt)) * 100))}%`;
      if (shown % 3 === 0) audio.uiTap();
      setTimeout(tstep, 45);
    };
    setTimeout(tstep, 500);
    if (s.newArena) setTimeout(() => audio.fanfare(), 900);
    // glimmer counts up too
    const gn = this.summaryEl.querySelector('.glimrow .n') as HTMLElement;
    let gshown = s.glimmerBefore;
    const gTarget = s.glimmerBefore + s.glimmer;
    const gstep = () => {
      if (gshown >= gTarget || this.summaryEl.classList.contains('hidden')) return;
      gshown = Math.min(gTarget, gshown + Math.max(1, Math.ceil(s.glimmer / 30)));
      gn.textContent = String(gshown);
      setTimeout(gstep, 40);
    };
    setTimeout(gstep, 650);
    if (s.relics.length) setTimeout(() => audio.fanfare(), 1100);
    this.summaryEl.querySelector('.again')?.addEventListener('click', () => {
      audio.uiTap();
      this.onPlayAgain?.();
    });
    this.summaryEl.querySelector('.home')!.addEventListener('click', () => {
      audio.uiTap();
      this.onHome?.();
    });
  }
}
