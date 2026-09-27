import type { Game } from '../core/Game';
import { audio } from '../audio/Audio';
import { RARITY } from '../render/Palette';
import { SPECIES, SPECIES_BY_ID, BugSpecies, bugLevel, hatch, saveCollection } from '../progression/Bugs';
import { RarityIndex } from '../render/Palette';
import { trainInfo, train } from '../progression/Burrow';
import { BugPreview } from './BugPreview';
import { ICONS } from './icons';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * MY BUGS: every Blinkbug you've hatched, a turntable preview, naming, equipping — and the
 * cocoon hatchery. Rarity is flair; every species is a different trick, not a stronger one.
 */
export class CollectionScreen {
  el = h('div', 'overlay bugs hidden');
  private preview: BugPreview;
  private selected: string;
  onClose: (() => void) | null = null;

  constructor(private game: Game) {
    this.preview = new BugPreview(game.cw);
    this.selected = game.collection.equipped;
    document.body.appendChild(this.el);
  }

  open() {
    this.selected = this.game.collection.equipped;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
    this.preview.stop();
    this.onClose?.();
  }

  private render() {
    const c = this.game.collection;
    const sp = SPECIES_BY_ID[this.selected];
    const own = c.bugs.find((b) => b.species === sp.id);
    const r = RARITY[sp.rarity];
    const cards = SPECIES.map((s) => {
      const o = c.bugs.find((b) => b.species === s.id);
      const cls = `bcard${o ? '' : ' locked'}${s.id === this.selected ? ' sel' : ''}${s.id === c.equipped ? ' eq' : ''}`;
      return `<button class="${cls}" data-id="${s.id}" style="--rc:${RARITY[s.rarity].css};--tint:${hex(s.tint)}">
        <span class="ic">${ICONS.bug}</span><span class="n big">${o ? s.name : '???'}</span>${o ? `<span class="lv">LV ${bugLevel(o)}</span>` : ''}${s.id === c.equipped ? '<span class="eqb big">EQUIPPED</span>' : ''}</button>`;
    }).join('');
    const cocoons = c.cocoons.length;
    this.el.innerHTML = `<div class="bugsmenu panel">
      <div class="bhead"><h2 class="big">MY BUGS</h2><span class="count">${c.bugs.length}/${SPECIES.length} found</span><button class="btn secondary close">BACK</button></div>
      <div class="bbody">
        <div class="bdetail" style="--rc:${r.css};--tint:${hex(sp.tint)}">
          <div class="stage"></div>
          ${own
            ? `<input class="bname big" maxlength="18" value="${own.name.replace(/"/g, '')}" aria-label="Bug name">`
            : `<div class="bname big locked">???</div>`}
          <div class="bsp"><span class="rar big">${r.name.toUpperCase()}</span> ${sp.name}${own ? ` · LV ${bugLevel(own)}` : ''}</div>
          <div class="trick"><b>Trick:</b> ${own ? sp.trick : 'Hatch one to find out!'}</div>
          ${own ? `<div class="catch"><b>Catch:</b> ${sp.catch}</div><div class="flav">“${sp.flavour}”</div>` : ''}
          ${own ? this.trainRow(own) : ''}
          ${own ? (c.equipped === sp.id ? '<button class="btn equip on" disabled>EQUIPPED</button>' : '<button class="btn equip">EQUIP</button>') : ''}
        </div>
        <div class="bright">
          <button class="cocoons ${cocoons ? 'has' : ''}" ${cocoons ? '' : 'disabled'}>
            <span class="coc" style="--rc:${cocoons ? RARITY[c.cocoons[0].rarity].css : '#aaa'}"></span>
            <span class="t big">${cocoons ? `COCOONS <small>(${cocoons})</small>` : 'NO COCOONS'}</span>
            <span class="s">${cocoons ? 'Hatch them in your Burrow\'s incubators ›' : 'Earn them by playing matches!'}</span>
          </button>
          <div class="bgrid">${cards}</div>
        </div>
      </div></div>`;
    const stage = this.el.querySelector('.stage')!;
    stage.appendChild(this.preview.canvas);
    if (own) this.preview.show(sp);
    else this.showLocked(sp);
    this.el.querySelector('.close')!.addEventListener('click', () => {
      audio.uiTap();
      this.close();
    });
    this.el.querySelectorAll<HTMLButtonElement>('.bcard').forEach((b) =>
      b.addEventListener('click', () => {
        audio.uiTap();
        this.selected = b.dataset.id!;
        this.render();
      }),
    );
    this.el.querySelector('.equip:not([disabled])')?.addEventListener('click', () => {
      audio.fuse();
      this.game.equipBug(sp.id);
      this.preview.poke();
      this.render();
    });
    const input = this.el.querySelector<HTMLInputElement>('input.bname');
    if (input && own) {
      const commit = () => {
        const v = input.value.trim().slice(0, 18);
        if (v && v !== own.name) {
          own.name = v;
          this.game.saveCollection();
          this.preview.poke();
        } else input.value = own.name;
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
    }
    this.el.querySelector('.cocoons.has')?.addEventListener('click', () => {
      audio.uiTap();
      this.onIncubate?.();
    });
    this.el.querySelector('.train')?.addEventListener('click', () => {
      if (own && train(this.game.burrow, own)) {
        saveCollection(c);
        if (c.equipped === own.species) this.game.equipBug(own.species);
        audio.fuse();
        this.preview.poke();
        this.render();
      }
    });
  }

  /** Bug Gym training: spare copies + glimmer -> a level (a touch sharper) */
  private trainRow(own: import('../progression/Bugs').OwnedBug) {
    const t = trainInfo(this.game.burrow, own);
    if (t.maxed) return '<div class="trainrow maxed"><b class="big">LV 8 · MAXED OUT!</b></div>';
    const pct = Math.min(100, ((own.spare ?? 0) / t.need) * 100);
    return `<div class="trainrow"><div class="copies"><span>Copies ${own.spare ?? 0}/${t.need}</span><i><b style="width:${pct}%"></b></i></div>
      <button class="btn train ${t.ok ? '' : 'off'}" ${t.ok ? '' : 'disabled'}>TRAIN TO LV ${t.level + 1}<small>${ICONS.glimmer} ${t.cost}</small></button>
      ${t.ok ? '' : `<small class="why">${t.reason}</small>`}</div>`;
  }

  private showLocked(sp: BugSpecies) {
    // a silhouette: same shape, inky colours
    this.preview.show({ ...sp, tint: 0x3a3048, belly: 0x2b2238, wing: 0x55486a });
  }

  /** MY BUGS' old hatch button now sends you to the Burrow's incubators */
  onIncubate: (() => void) | null = null;

  /**
   * The cocoon ceremony: wobble, wobble, CRACK, reveal. Used by the Burrow's incubators (and
   * the collection). `cozy` = an incubator nudged it up a rarity on the way.
   */
  ceremony(rarity: RarityIndex, host: HTMLElement, opts: { cozy?: boolean; onDone?: () => void } = {}) {
    const c = this.game.collection;
    const coc = { rarity };
    const res = hatch(c, coc.rarity);
    saveCollection(c);
    const r = RARITY[res.species.rarity];
    const ov = h('div', 'hatch', `${opts.cozy ? `<div class="cozy big">SO COZY! It grew into ${/^[AEIOU]/i.test(RARITY[rarity].name) ? 'an' : 'a'} ${RARITY[rarity].name.toUpperCase()} cocoon!</div>` : ''}<div class="cocoon big" style="--rc:${RARITY[coc.rarity].css}"><span>TAP!</span></div><div class="reveal"></div>`);
    host.appendChild(ov);
    const cocoon = ov.querySelector('.cocoon') as HTMLElement;
    const reveal = ov.querySelector('.reveal') as HTMLElement;
    let taps = 0;
    audio.crateShake(this.game.camera.position);
    cocoon.addEventListener('click', () => {
      taps++;
      cocoon.classList.remove('wob');
      void cocoon.offsetWidth;
      cocoon.classList.add('wob');
      audio.crateShake(this.game.camera.position);
      cocoon.style.setProperty('--crack', String(taps / 3));
      if (taps < 3) return;
      // CRACK!
      audio.crateOpen(this.game.camera.position);
      audio.fuse();
      cocoon.classList.add('burst');
      ov.style.setProperty('--rc', r.css);
      ov.classList.add('open');
      reveal.innerHTML = `<div class="stage2"></div><div class="rn big" style="color:${r.css}">${r.name.toUpperCase()}</div>
        <div class="sn big">${res.fresh ? 'NEW BUG!' : 'ANOTHER ONE!'} ${res.species.name}</div>
        <div class="nm">${res.fresh ? `Say hi to <b>${res.owned.name}</b>` : `<b>${res.owned.name}</b> got a training buddy · ${res.owned.spare ?? 0} spare for the Bug Gym`}</div>
        <div class="tr">${res.species.trick}</div>
        <div class="btns"><button class="btn ok">NICE!</button>${res.fresh ? '<button class="btn secondary eq">EQUIP</button>' : ''}</div>`;
      reveal.querySelector('.stage2')!.appendChild(this.preview.canvas);
      this.preview.show(res.species);
      setTimeout(() => this.preview.poke(), 350);
      const done = (equip: boolean) => {
        audio.uiTap();
        if (equip) this.game.equipBug(res.species.id);
        this.selected = res.species.id;
        ov.remove();
        this.render();
        opts.onDone?.();
      };
      reveal.querySelector('.ok')!.addEventListener('click', () => done(false));
      reveal.querySelector('.eq')?.addEventListener('click', () => done(true));
    });
  }
}
