import type { Game } from '../core/Game';
import type { Quality } from '../render/Renderer';
import { audio } from '../audio/Audio';
import { ICONS } from './icons';

export interface Settings {
  quality: Quality;
  autoQuality: boolean;
  sensitivity: number;
  fov: number;
  volume: number;
  aimAssist: boolean;
  autoFire: boolean;
  showFps: boolean;
}

const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

export function loadSettings(): Settings {
  const def: Settings = { quality: isMobile() ? 'medium' : 'high', autoQuality: true, sensitivity: 1, fov: 72, volume: 0.8, aimAssist: true, autoFire: false, showFps: false };
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

  constructor(private game: Game) {
    this.title.innerHTML = `<div class="title">
      <div class="logo">RIFT<span>RASCALS</span></div>
      <div class="tagline">DROP. BLINK. GRAB. RUN.</div>
      <button class="btn play">PLAY</button>
      <div class="hint">Milestone 1 · Combat Playground<br>
      <kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim down sights<br>
      <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump/climb · <kbd>C</kbd> crouch/slide · <kbd>R</kbd> reload · <kbd>F</kbd> pick up<br>
      <kbd>Q</kbd> hold to aim, release to throw your Blinkbug · <kbd>E</kbd> BLINK (swap places!) · <kbd>Esc</kbd> pause</div></div>`;
    this.title.querySelector('.play')!.addEventListener('click', () => {
      audio.unlock();
      audio.uiTap();
      this.game.play();
    });

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
      <h2>PAUSED</h2>
      <div class="row"><span>Graphics</span><div class="seg" data-k="quality"><button data-v="low">LOW</button><button data-v="medium">MED</button><button data-v="high">HIGH</button></div></div>
      <div class="row"><span>Auto-adjust graphics</span><div class="seg" data-k="autoQuality"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Look sensitivity</span><input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity"></div>
      <div class="row"><span>Field of view</span><input type="range" min="60" max="90" step="1" data-k="fov"></div>
      <div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-k="volume"></div>
      <div class="row"><span>Aim assist (touch)</span><div class="seg" data-k="aimAssist"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Auto-fire</span><div class="seg" data-k="autoFire"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="row"><span>Show FPS</span><div class="seg" data-k="showFps"><button data-v="false">OFF</button><button data-v="true">ON</button></div></div>
      <div class="btns"><button class="btn resume">${'RESUME'}</button></div>
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
    void ICONS;
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
