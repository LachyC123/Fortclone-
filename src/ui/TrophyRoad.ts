import type { Game } from '../core/Game';
import { audio } from '../audio/Audio';
import { RARITY } from '../render/Palette';
import { saveCollection } from '../progression/Bugs';
import { ARENAS, ROAD, Reward, arenaFor, saveTrophies, unclaimed } from '../progression/Trophies';
import { ICONS } from './icons';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** the next milestone at or above these trophies */
export function nextReward(trophies: number) {
  return ROAD.find((r) => r.at > trophies) ?? null;
}

/**
 * TROPHY ROAD: a climbing track of milestones — cocoons, titles and arenas. Reached rewards glow
 * until you claim them; claimed titles can be worn on your profile.
 */
export class TrophyRoadScreen {
  el = h('div', 'overlay road hidden');
  onClose: (() => void) | null = null;

  constructor(private game: Game) {
    document.body.appendChild(this.el);
  }

  open() {
    this.el.classList.remove('hidden');
    this.render(true);
  }

  close() {
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  private label(r: Reward) {
    if (r.kind === 'cocoon') return { icon: `<span class="coc" style="--rc:${RARITY[r.rarity].css}"></span>`, text: `${RARITY[r.rarity].name} cocoon`, col: RARITY[r.rarity].css };
    if (r.kind === 'title') return { icon: `<span class="tt">“ ”</span>`, text: `Title: ${r.title}`, col: '#ff9ad5' };
    const a = ARENAS[r.arena];
    return { icon: `<span class="coc" style="--rc:${RARITY[r.rarity].css}"></span>`, text: `${a.name} + ${RARITY[r.rarity].name} cocoon`, col: a.color };
  }

  private render(scroll = false) {
    const t = this.game.trophies;
    const arena = arenaFor(t.trophies);
    // the road reads bottom (start) to top, like climbing
    const rows: string[] = [];
    let arenaI = ARENAS.length - 1;
    for (let i = ROAD.length - 1; i >= 0; i--) {
      const r = ROAD[i];
      // arena banners sit above the first milestone of that arena
      while (arenaI > 0 && ARENAS[arenaI].at > r.at) {
        rows.push(this.arenaRow(arenaI, t.best));
        arenaI--;
      }
      const reached = t.best >= r.at;
      const claimed = t.claimed.includes(i);
      const l = this.label(r);
      const isTitle = r.kind === 'title';
      const worn = isTitle && claimed && t.title === r.title;
      const state = claimed ? (isTitle ? `<button class="wear${worn ? ' on' : ''}" data-i="${i}">${worn ? 'WORN' : 'WEAR'}</button>` : '<span class="ok">✓</span>') : reached ? `<button class="claim" data-i="${i}">CLAIM</button>` : '<span class="lock">🔒</span>';
      rows.push(`<div class="node ${reached ? 'reached' : ''} ${claimed ? 'claimed' : ''} ${reached && !claimed ? 'ready' : ''}" data-at="${r.at}">
        <span class="at big">${r.at}</span><span class="dot"></span>
        <div class="card" style="--c:${l.col}">${l.icon}<span class="txt">${l.text}</span>${state}</div></div>`);
    }
    while (arenaI >= 0) {
      rows.push(this.arenaRow(arenaI, t.best));
      arenaI--;
    }
    const waiting = unclaimed(t).length;
    this.el.innerHTML = `<div class="menu panel roadpanel">
      <div class="menuhead"><h2>TROPHY ROAD</h2><button class="btn secondary x">BACK</button></div>
      <div class="roadtop" style="--ac:${arena.color}"><span class="tr big">${ICONS.trophy}${t.trophies}</span><span class="an big">${arena.name}</span><span class="best">best ${t.best}${waiting ? ` · <b>${waiting} to claim</b>` : ''}</span></div>
      <div class="track"><div class="trackin"><div class="line"><div class="fill"></div><div class="you big">YOU ${t.trophies}</div></div>${rows.join('')}</div></div>
      <div class="roadhint">Win and place high for trophies · the bottom of the field loses a few · you never drop out of an arena you've reached · on AUTO, your arena sets how sharp the bots are</div>
    </div>`;
    this.el.querySelector('.x')!.addEventListener('click', () => {
      audio.uiTap();
      this.close();
    });
    this.el.querySelectorAll<HTMLButtonElement>('.claim').forEach((b) => b.addEventListener('click', () => this.claim(Number(b.dataset.i), b)));
    this.el.querySelectorAll<HTMLButtonElement>('.wear').forEach((b) =>
      b.addEventListener('click', () => {
        audio.uiTap();
        const r = ROAD[Number(b.dataset.i)];
        if (r.kind !== 'title') return;
        t.title = t.title === r.title ? '' : r.title;
        saveTrophies(t);
        this.render();
      }),
    );
    requestAnimationFrame(() => this.layoutFill());
    if (scroll) {
      // bring you (the next milestone above your trophies) into view
      const nodes = [...this.el.querySelectorAll<HTMLElement>('.node')];
      const target = nodes.find((n) => n.classList.contains('ready')) ?? nodes.reverse().find((n) => Number(n.dataset.at) > t.trophies) ?? nodes[0];
      requestAnimationFrame(() => target?.scrollIntoView({ block: 'center' }));
    }
  }

  /** fill the track from the bottom up to where your trophies sit between two milestones */
  private layoutFill() {
    const inner = this.el.querySelector('.trackin') as HTMLElement | null;
    if (!inner) return;
    const t = this.game.trophies.trophies;
    // milestone dots, bottom (lowest) first; positions within the scrolled content
    const pts = [...inner.querySelectorAll<HTMLElement>('.node')]
      .map((n) => ({ at: Number(n.dataset.at), y: n.offsetTop + n.offsetHeight / 2 }))
      .sort((a, b) => a.at - b.at);
    const bottom = inner.offsetHeight;
    let y = bottom;
    if (pts.length) {
      if (t >= pts[pts.length - 1].at) y = pts[pts.length - 1].y;
      else {
        let prev = { at: 0, y: bottom };
        for (const p of pts) {
          if (t < p.at) {
            y = prev.y + (p.y - prev.y) * ((t - prev.at) / Math.max(1, p.at - prev.at));
            break;
          }
          prev = p;
        }
      }
    }
    (inner.querySelector('.line .fill') as HTMLElement).style.top = `${y}px`;
    (inner.querySelector('.line .you') as HTMLElement).style.top = `${y}px`;
  }

  private arenaRow(i: number, best: number) {
    const a = ARENAS[i];
    const open = best >= a.at;
    return `<div class="arenarow ${open ? 'open' : ''}" style="--ac:${a.color}"><span class="big">${a.name.toUpperCase()}</span><small>${a.at}+ trophies · bots ${Math.round(a.skill * 100)}% sharp${open ? '' : ' · locked'}</small></div>`;
  }

  private claim(i: number, btn: HTMLElement) {
    const g = this.game;
    const t = g.trophies;
    const r = ROAD[i];
    if (!r || t.claimed.includes(i) || t.best < r.at) return;
    t.claimed.push(i);
    if (r.kind === 'cocoon' || r.kind === 'arena') {
      g.collection.cocoons.push({ rarity: r.rarity });
      saveCollection(g.collection);
    }
    if (r.kind === 'title' && !t.title) t.title = r.title;
    saveTrophies(t);
    audio.fanfare();
    // a little burst right where you tapped
    const rect = btn.getBoundingClientRect();
    for (let k = 0; k < 18; k++) {
      const c = h('i', 'roadconf');
      c.style.left = `${rect.left + rect.width / 2}px`;
      c.style.top = `${rect.top + rect.height / 2}px`;
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--dy', `${-60 - Math.random() * 140}px`);
      c.style.background = ['#f2c14e', '#ff9ad5', '#6ff7ff', '#9dff8a', '#fff'][k % 5];
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 900);
    }
    this.render();
  }
}
