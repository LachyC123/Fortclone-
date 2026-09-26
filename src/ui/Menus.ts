import type { Game } from '../core/Game';
import { QUALITY_PRESETS, type Quality } from '../render/Renderer';
import { audio } from '../audio/Audio';
import { ICONS } from './icons';
import { CollectionScreen } from './Collection';
import { SPECIES_BY_ID } from '../progression/Bugs';
import { RARITY } from '../render/Palette';

export interface Settings {
  quality: Quality;
  autoQuality: boolean;
  sensitivity: number;
  fov: number;
  volume: number;
  aimAssist: boolean;
  autoFire: boolean;
  showFps: boolean;
  /** 'auto' adapts to how you've been doing */
  botDifficulty: 'auto' | 'easy' | 'normal' | 'hard';
}

const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

export function loadSettings(): Settings {
  const def: Settings = { quality: isMobile() ? 'medium' : 'high', autoQuality: true, sensitivity: 1, fov: 72, volume: 0.8, aimAssist: true, autoFire: false, showFps: false, botDifficulty: 'auto' };
  try {
    const raw = localStorage.getItem('rr.settings');
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return def;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('rr.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Title screen, pause/settings and elimination overlays. */
export class Menus {
  private title = h('div', 'overlay');
  private pauseEl = h('div', 'overlay hidden');
  private elimEl = h('div', 'overlay hidden');
  collection!: CollectionScreen;

  constructor(private game: Game) {
    this.title.innerHTML = `<div class="title home">
      <div class="logo">RIFT<span>RASCALS</span></div>
      <div class="tagline">DROP. BLINK. GRAB. RUN.</div>
      <div class="profile big"></div>
      <div class="modepick"><button data-n="1">SOLO</button><button data-n="2">DUOS</button><button data-n="3">TRIOS</button><button data-n="4">SQUADS</button></div>
      <div class="modehint"></div>
      <button class="btn play">PLAY</button>
      <button class="mybug"></button>
      <div class="homebtns">
        <button class="btn secondary bugsbtn">MY BUGS<span class="badge"></span></button>
        <button class="btn secondary practice">PRACTICE</button>
        <button class="btn secondary howto">HOW TO PLAY</button>
      </div>
      <div class="hint hidden">
      <kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim down sights<br>
      <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump/climb/<b>drop from the Sky Barge</b> · <kbd>C</kbd> crouch/slide · <kbd>R</kbd> reload · <kbd>F</kbd> pick up<br>
      <kbd>Q</kbd> hold to aim, release to throw your Blinkbug · <kbd>E</kbd> BLINK (swap places!)<br>
      <kbd>G</kbd> hold/release to throw a utility · <kbd>H</kbd> heal · <kbd>X</kbd> drop gun · <kbd>1-3</kbd> weapons · <kbd>Esc</kbd> pause<br>
      Grab the <b>same gun at the same rarity</b> to <b>FUSE</b> it into a better one!<br>
      Knocked out? Your <b>Blinkbug</b> carries your spark to a <b>Rift Nest</b> — once per match. Stay out of <b>THE GLOOM</b>.<br>
      <b>Duos / Trios / Squads:</b> at 0 HP you're <b>knocked down</b> — a teammate holds <kbd>F</kbd> to pick you up. Fully out? Your spark drops: a teammate grabs it and rebuilds you at a <b>Rift Nest</b>.</div></div>`;
    // solo / duos / trios / squads (your teammates are bots until you play with friends)
    const hints = ['', 'Every rascal for themselves', 'You + 1 bot teammate · 12 teams', 'You + 2 bot teammates · 8 teams', 'You + 3 bot teammates · 6 teams'];
    const setMode = (n: number) => {
      this.game.teamSize = n;
      try {
        localStorage.setItem('rr.mode', String(n));
      } catch {
        /* ignore */
      }
      this.title.querySelectorAll<HTMLButtonElement>('.modepick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === n));
      (this.title.querySelector('.modehint') as HTMLElement).textContent = hints[n];
    };
    let saved = 1;
    try {
      saved = Number(localStorage.getItem('rr.mode')) || 1;
    } catch {
      /* ignore */
    }
    setMode(Math.min(4, Math.max(1, saved)));
    this.title.querySelector('.modepick')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      audio.uiTap();
      setMode(Number(b.dataset.n));
    });
    this.title.querySelector('.play')!.addEventListener('click', () => {
      audio.unlock();
      audio.uiTap();
      this.game.startMatch();
    });
    this.title.querySelector('.practice')!.addEventListener('click', () => {
      audio.unlock();
      audio.uiTap();
      this.game.startPlayground();
    });
    this.collection = new CollectionScreen(this.game);
    this.collection.onClose = () => {
      this.refreshProfile();
      this.title.classList.remove('hidden');
    };
    const openBugs = () => {
      audio.unlock();
      audio.uiTap();
      this.title.classList.add('hidden');
      this.collection.open();
    };
    this.title.querySelector('.bugsbtn')!.addEventListener('click', openBugs);
    this.title.querySelector('.mybug')!.addEventListener('click', openBugs);
    this.title.querySelector('.howto')!.addEventListener('click', () => {
      audio.uiTap();
      this.title.querySelector('.hint')!.classList.toggle('hidden');
    });
    this.refreshProfile();

    this.buildPause();
    this.elimEl.innerHTML = `<div class="elim"><div class="t">ELIMINATED!</div><div class="by"></div><div style="margin-top:18px"><button class="btn">RESPAWN</button></div></div>`;
    this.elimEl.querySelector('.btn')!.addEventListener('click', () => {
      audio.uiTap();
      this.game.respawnPlayer();
    });
    document.body.append(this.title, this.pauseEl, this.elimEl);
  }

  private buildPause() {
    const s = this.game.settings;
    this.pauseEl.innerHTML = `<div class="menu panel">
      <div class="menuhead"><h2>PAUSED</h2><button class="btn resume">RESUME</button></div>
      <div class="rows"><div class="row"><span>Graphics</span><div class="seg" data-k="quality"><button data-v="low">LOW</button><button data-v="medium">MED</button><button data-v="high">HIGH</button></div></div>
      <div class="row qnote hidden"><small>Model &amp; world detail change after a reload.</small></div>
      <div class="row"><span>Auto-adjust graphics</span><div class="seg" data-k="autoQuality"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Look sensitivity</span><input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity"></div>
      <div class="row"><span>Field of view</span><input type="range" min="60" max="90" step="1" data-k="fov"></div>
      <div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-k="volume"></div>
      <div class="row"><span>Aim assist (touch)</span><div class="seg" data-k="aimAssist"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Auto-fire</span><div class="seg" data-k="autoFire"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Bot difficulty</span><div class="seg" data-k="botDifficulty"><button data-v="auto">AUTO</button><button data-v="easy">EASY</button><button data-v="normal">MED</button><button data-v="hard">HARD</button></div></div>
      <div class="row"><span>Show FPS</span><div class="seg" data-k="showFps"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div></div>
    </div>`;
    const sync = () => {
      this.pauseEl.querySelectorAll<HTMLDivElement>('.seg').forEach((seg) => {
        const k = seg.dataset.k as keyof Settings;
        seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', String(s[k]) === b.dataset.v));
      });
      this.pauseEl.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) => (i.value = String(s[i.dataset.k as keyof Settings])));
    };
    this.pauseEl.querySelectorAll<HTMLDivElement>('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        const k = seg.dataset.k as keyof Settings;
        const v = b.dataset.v!;
        (s as unknown as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : v;
        audio.uiTap();
        this.game.applySettings();
        const note = this.pauseEl.querySelector('.qnote');
        const bq = this.game.bootQuality;
        note?.classList.toggle('hidden', QUALITY_PRESETS[s.quality].model === QUALITY_PRESETS[bq].model);
        sync();
      });
    });
    this.pauseEl.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) =>
      i.addEventListener('input', () => {
        (s as unknown as Record<string, unknown>)[i.dataset.k!] = parseFloat(i.value);
        this.game.applySettings();
      }),
    );
    this.pauseEl.querySelector('.resume')!.addEventListener('click', () => {
      audio.uiTap();
      this.game.play();
    });
    sync();
  }

  refreshProfile() {
    let p = { level: 1, wins: 0, matches: 0 };
    try {
      p = { ...p, ...JSON.parse(localStorage.getItem('rr.profile') || '{}') };
    } catch {
      /* ignore */
    }
    (this.title.querySelector('.profile') as HTMLElement).innerHTML = `<span>LV ${p.level}</span><span>${ICONS.skull} ${p.wins} wins</span>`;
    const c = this.game.collection;
    const own = c.bugs.find((b) => b.species === c.equipped)!;
    const sp = SPECIES_BY_ID[own.species];
    const mb = this.title.querySelector('.mybug') as HTMLElement;
    mb.style.setProperty('--tint', `#${sp.tint.toString(16).padStart(6, '0')}`);
    mb.style.setProperty('--rc', RARITY[sp.rarity].css);
    mb.innerHTML = `<span class="ic">${ICONS.bug}</span><span>with <b>${own.name}</b> the ${sp.name}</span>`;
    const badge = this.title.querySelector('.bugsbtn .badge') as HTMLElement;
    badge.textContent = c.cocoons.length ? String(c.cocoons.length) : '';
    badge.style.display = c.cocoons.length ? '' : 'none';
  }

  showTitle() {
    this.hideAll();
    this.refreshProfile();
    this.title.classList.remove('hidden');
  }

  hideAll() {
    this.title.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.elimEl.classList.add('hidden');
  }

  showPause() {
    this.pauseEl.classList.remove('hidden');
  }

  showEliminated(by: string) {
    (this.elimEl.querySelector('.by') as HTMLDivElement).textContent = `by ${by} — respawning…`;
    this.elimEl.classList.remove('hidden');
    document.exitPointerLock?.();
  }
}
