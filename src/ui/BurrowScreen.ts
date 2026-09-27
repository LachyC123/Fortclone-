import type { Game } from '../core/Game';
import { audio } from '../audio/Audio';
import { RARITY, RarityIndex } from '../render/Palette';
import { ICONS } from './icons';
import { BurrowScene } from '../burrow/BurrowScene';
import {
  BUILDINGS,
  BUILDING_BY_ID,
  BuildingId,
  DECOR,
  INCUBATORS,
  MUSEUM_SHELVES,
  RESTOCK_COST,
  addRelic,
  bazaarOffers,
  bazaarRestockIn,
  bonus,
  collectPump,
  cozyChance,
  displayed,
  fmtTime,
  gymCap,
  hatchMs,
  hatsOwned,
  incLeft,
  incubate,
  pumpCap,
  pumpRate,
  pumpTick,
  restock,
  rush,
  rushCost,
  saveBurrow,
  takeHatched,
  train,
  trainInfo,
  upgrade,
  upgradeInfo,
} from '../progression/Burrow';
import { BONUS_TEXT, RELICS, RELIC_BY_ID, RELIC_SETS, RelicBonus, relicSvg } from '../progression/Relics';
import { SPECIES_BY_ID, saveCollection } from '../progression/Bugs';
import type { CollectionScreen } from './Collection';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const G = (n: number) => `<span class="gm">${ICONS.glimmer}${n.toLocaleString()}</span>`;

const HAT_LIST: { id: string; name: string; set: string }[] = RELIC_SETS.map((s) => ({ id: s.hat, name: s.hatName, set: s.name }));

/**
 * THE BURROW screen: the 3D island (BurrowScene) plus everything you tap — building panels,
 * floating status labels, the glimmer counter.
 */
export class BurrowScreen {
  el = h('div', 'burrowui hidden');
  scene: BurrowScene;
  onClose: (() => void) | null = null;
  private top = h('div', 'btop');
  private labels = h('div', 'blabels');
  private chips = h('div', 'bchips');
  private panel = h('div', 'bpanel panel hidden');
  private labelEls = new Map<BuildingId, HTMLElement>();
  private sel: BuildingId | null = null;
  private liveT = 0;
  private panelKey = '';
  private shownGlimmer = -1;

  constructor(private game: Game, private collection: CollectionScreen) {
    this.scene = new BurrowScene(game);
    this.scene.onSelect = (id) => {
      this.sel = id;
      if (id) audio.uiTap();
      this.renderPanel();
      this.renderChips();
    };
    this.el.append(this.labels, this.top, this.panel, this.chips);
    document.body.appendChild(this.el);
    for (const b of BUILDINGS) {
      const l = h('button', 'blabel');
      l.addEventListener('click', () => this.scene.select(b.id));
      this.labels.appendChild(l);
      this.labelEls.set(b.id, l);
    }
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  open(focus: BuildingId | null = null) {
    this.el.classList.remove('hidden');
    this.game.hud.root.classList.add('hidden');
    this.scene.open();
    this.renderTop();
    this.renderChips();
    this.scene.select(focus);
    this.renderPanel();
  }

  close() {
    audio.uiTap();
    this.el.classList.add('hidden');
    this.scene.close();
    this.onClose?.();
  }

  /** anything changed: save, rebuild the island bits, redraw */
  private after() {
    saveBurrow(this.game.burrow);
    this.scene.sync();
    this.renderTop();
    this.renderChips();
    this.renderPanel();
  }

  /* ------------------------------------------------------------------ top bar + chips */

  private renderTop() {
    const b = this.game.burrow;
    this.top.innerHTML = `<button class="btn secondary back">${ICONS.home}<span>HOME</span></button>
      <div class="bt"><b class="big">MY BURROW</b><small>Hall LV ${b.lv.hall} · ${Object.keys(b.relics).length}/${RELICS.length} relics</small></div>
      <div class="glim big">${ICONS.glimmer}<b>${Math.floor(b.glimmer).toLocaleString()}</b></div>`;
    this.top.querySelector('.back')!.addEventListener('click', () => this.close());
    this.shownGlimmer = Math.floor(b.glimmer);
  }

  /** things waiting for you at a building */
  private attention(id: BuildingId): string {
    const b = this.game.burrow;
    const now = Date.now();
    const L = b.lv[id];
    if (id.startsWith('inc') && L) {
      const i = INCUBATORS.indexOf(id);
      if (b.inc[i] && incLeft(b, i, now) <= 0) return 'READY';
      if (!b.inc[i] && this.game.collection.cocoons.length) return '+';
    }
    if (id === 'pump' && pumpTick(b, now) >= pumpCap(b) * 0.5) return '!';
    if (upgradeInfo(b, id).ok) return 'UP';
    return '';
  }

  private renderChips() {
    const b = this.game.burrow;
    this.chips.innerHTML = BUILDINGS.map((d) => {
      const L = b.lv[d.id];
      const locked = !L && b.lv.hall < d.hall;
      const a = this.attention(d.id);
      const name = d.id.startsWith('inc') ? `Incubator ${d.id.slice(3)}` : d.name;
      return `<button class="bchip ${this.sel === d.id ? 'on' : ''} ${locked ? 'locked' : ''}" data-id="${d.id}"><span class="n">${name}</span><small>${locked ? 'locked' : L ? `LV ${L}` : 'build'}</small>${a ? `<i class="dot ${a === 'READY' ? 'ready' : ''}">${a === 'UP' ? '▲' : a === 'READY' ? '!' : a}</i>` : ''}</button>`;
    }).join('');
    this.chips.querySelectorAll<HTMLButtonElement>('.bchip').forEach((c) => c.addEventListener('click', () => this.scene.select(c.dataset.id as BuildingId)));
  }

  /* ------------------------------------------------------------------ floating labels */

  private labelText(id: BuildingId): { t: string; cls: string } {
    const b = this.game.burrow;
    const d = BUILDING_BY_ID[id];
    const L = b.lv[id];
    const now = Date.now();
    if (!L) return b.lv.hall < d.hall ? { t: `LOCKED · Hall ${d.hall}`, cls: 'locked' } : { t: `BUILD ${G(upgradeInfo(b, id).cost)}`, cls: 'build' };
    if (id === 'pump') {
      const s = Math.floor(pumpTick(b, now));
      return { t: `${G(s)}${s >= pumpCap(b) ? ' FULL!' : ''}`, cls: s >= pumpCap(b) * 0.5 ? 'hot' : '' };
    }
    if (id.startsWith('inc')) {
      const i = INCUBATORS.indexOf(id);
      const s = b.inc[i];
      if (!s) return { t: this.game.collection.cocoons.length ? 'EMPTY · tap to fill' : 'EMPTY', cls: 'dim' };
      const left = incLeft(b, i, now);
      return left <= 0 ? { t: 'READY TO HATCH!', cls: 'ready' } : { t: fmtTime(left), cls: '' };
    }
    if (id === 'museum') return { t: `${displayed(b).length}/${MUSEUM_SHELVES[L]} on display`, cls: '' };
    if (id === 'bazaar') return { t: `restock ${fmtTime(bazaarRestockIn(now))}`, cls: '' };
    const up = upgradeInfo(b, id).ok;
    return { t: `${d.name} · LV ${L}${up ? ' ▲' : ''}`, cls: up ? 'up' : '' };
  }

  /** per frame while open */
  tick(dt: number) {
    if (!this.isOpen) return;
    this.scene.render(dt);
    const pt = { x: 0, y: 0 };
    for (const [id, el] of this.labelEls) {
      const at = this.scene.labelAt(id, pt);
      el.style.display = at ? '' : 'none';
      if (at) el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
    }
    this.liveT -= dt;
    if (this.liveT > 0) return;
    this.liveT = 0.25;
    for (const [id, el] of this.labelEls) {
      const l = this.labelText(id);
      const cls = `blabel ${l.cls} ${this.sel === id ? 'sel' : ''}`;
      if (el.className !== cls) el.className = cls;
      if (el.innerHTML !== l.t) el.innerHTML = l.t;
    }
    if (Math.floor(this.game.burrow.glimmer) !== this.shownGlimmer) this.renderTop();
    // live panel bits (timers, pump stock); a state flip re-renders the lot
    if (this.sel && this.panelKey !== this.stateKey(this.sel)) {
      this.renderPanel();
      this.renderChips();
    }
    this.liveBits();
  }

  private stateKey(id: BuildingId) {
    const b = this.game.burrow;
    const now = Date.now();
    if (id.startsWith('inc')) {
      const i = INCUBATORS.indexOf(id);
      const s = b.inc[i];
      return `${b.lv[id]}|${s ? (incLeft(b, i, now) <= 0 ? 'ready' : 'busy') : 'empty'}|${this.game.collection.cocoons.length}|${upgradeInfo(b, id).ok}`;
    }
    return `${b.lv[id]}|${upgradeInfo(b, id).ok}|${Math.floor(b.glimmer)}`;
  }

  private liveBits() {
    const b = this.game.burrow;
    const now = Date.now();
    const p = this.panel;
    const ps = p.querySelector('.pumpstock');
    if (ps) {
      const s = pumpTick(b, now);
      ps.innerHTML = `${G(Math.floor(s))} / ${pumpCap(b)}`;
      (p.querySelector('.pumpbar i') as HTMLElement).style.width = `${(s / Math.max(1, pumpCap(b))) * 100}%`;
    }
    const it = p.querySelector<HTMLElement>('.inctime');
    if (it && this.sel?.startsWith('inc')) {
      const i = INCUBATORS.indexOf(this.sel);
      const s = b.inc[i];
      if (s) {
        const left = incLeft(b, i, now);
        it.textContent = fmtTime(left);
        (p.querySelector('.incbar i') as HTMLElement).style.width = `${(1 - left / s.dur) * 100}%`;
        const rc = p.querySelector('.rush small');
        if (rc) rc.innerHTML = G(rushCost(left));
      }
    }
    const rs = p.querySelector('.restockin');
    if (rs) rs.textContent = fmtTime(bazaarRestockIn(now));
  }

  /* ------------------------------------------------------------------ building panels */

  private renderPanel() {
    const id = this.sel;
    this.panel.classList.toggle('hidden', !id);
    if (!id) {
      this.panelKey = '';
      return;
    }
    this.panelKey = this.stateKey(id);
    const b = this.game.burrow;
    const d = BUILDING_BY_ID[id];
    const L = b.lv[id];
    const name = id.startsWith('inc') ? `Incubator ${id.slice(3)}` : d.name;
    let body = '';
    if (!L) body = this.buildBody(id);
    else if (id === 'hall') body = this.hallBody();
    else if (id === 'pump') body = this.pumpBody();
    else if (id.startsWith('inc')) body = this.incBody(INCUBATORS.indexOf(id));
    else if (id === 'gym') body = this.gymBody();
    else if (id === 'museum') body = this.museumBody();
    else if (id === 'bazaar') body = this.bazaarBody();
    this.panel.innerHTML = `<div class="phead"><div><b class="big">${name}</b>${L ? `<span class="lvl">LV ${L}/${d.max}</span>` : ''}</div><button class="x" aria-label="Close">✕</button></div>
      <p class="blurb">${d.blurb}</p>
      <div class="pbody">${body}</div>
      ${L ? this.upgradeRow(id) : ''}`;
    this.panel.querySelector('.x')!.addEventListener('click', () => this.scene.select(null));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.act(btn.dataset.act!, btn.dataset.arg ?? '', btn);
      }),
    );
    this.liveBits();
  }

  private buildBody(id: BuildingId) {
    const b = this.game.burrow;
    const d = BUILDING_BY_ID[id];
    if (b.lv.hall < d.hall) return `<div class="lockmsg">Upgrade your <b>Burrow Hall</b> to LV ${d.hall} to build this.</div>`;
    const u = upgradeInfo(b, id);
    return `<button class="btn buildbtn" data-act="upgrade" ${u.ok ? '' : 'disabled'}>BUILD IT <small>${G(u.cost)}</small></button>${u.ok ? '' : `<small class="why">${u.reason}</small>`}`;
  }

  /** what the next level gives you */
  private nextPerk(id: BuildingId) {
    const b = this.game.burrow;
    const L = b.lv[id];
    if (id === 'hall') {
      const unl = BUILDINGS.filter((x) => x.hall === L + 1).map((x) => (x.id.startsWith('inc') ? `Incubator ${x.id.slice(3)}` : x.name));
      return `${unl.length ? `Unlocks <b>${unl.join(', ')}</b> · ` : ''}everything can grow to LV ${L + 1}`;
    }
    if (id === 'pump') {
      const rate = [0, 80, 140, 220, 330, 480][L + 1] ?? 0;
      return `Pumps <b>${Math.round(rate * (1 + bonus(b, 'pump') / 100))}/hour</b> (now ${pumpRate(b)}), bigger tank`;
    }
    if (id.startsWith('inc')) return 'Hatches <b>10% faster</b> and <b>+4%</b> cozy chance';
    if (id === 'gym') return `Bugs can train up to <b>LV ${Math.min(8, L + 4)}</b>`;
    if (id === 'museum') return `<b>${MUSEUM_SHELVES[L + 1]} shelves</b> for relics (now ${MUSEUM_SHELVES[L]})`;
    if (id === 'bazaar') return L === 1 ? '<b>+1 offer</b> and a <b>relic</b> for sale' : '<b>+1 offer</b> and better stock';
    return '';
  }

  private upgradeRow(id: BuildingId) {
    const u = upgradeInfo(this.game.burrow, id);
    if (u.maxed) return '<div class="uprow maxed"><b class="big">MAX LEVEL</b></div>';
    return `<div class="uprow"><div class="perk">${this.nextPerk(id)}</div><button class="btn upbtn" data-act="upgrade" ${u.ok ? '' : 'disabled'}>UPGRADE <small>${G(u.cost)}</small></button>${u.ok ? '' : `<small class="why">${u.reason}</small>`}</div>`;
  }

  private hallBody() {
    const b = this.game.burrow;
    const owned = hatsOwned(b) as string[];
    const hats = [`<button class="hat ${!b.hat ? 'on' : ''}" data-act="hat" data-arg=""><b>Classic</b><small>${!b.hat ? 'WEARING' : 'wear'}</small></button>`]
      .concat(
        HAT_LIST.map((x) => {
          const has = owned.includes(x.id);
          return `<button class="hat ${b.hat === x.id ? 'on' : ''} ${has ? '' : 'lockedhat'}" ${has ? `data-act="hat" data-arg="${x.id}"` : 'disabled'}><b>${x.name}</b><small>${has ? (b.hat === x.id ? 'WEARING' : 'wear') : `finish ${x.set}`}</small></button>`;
        }),
      )
      .join('');
    const decor = DECOR.map((d) => {
      const has = b.decor.includes(d.id);
      return `<button class="deco ${has ? 'owned' : ''}" ${has ? 'disabled' : `data-act="decor" data-arg="${d.id}"`} ${!has && b.glimmer < d.price ? 'data-poor="1"' : ''}><b>${d.name}</b><small>${has ? 'placed ✓' : G(d.price)}</small></button>`;
    }).join('');
    return `<div class="sec"><h4>HATS <small>finish a relic set to unlock one</small></h4><div class="hats">${hats}</div></div>
      <div class="sec"><h4>DECOR <small>just for looks — it's your place!</small></h4><div class="decos">${decor}</div></div>`;
  }

  private pumpBody() {
    const b = this.game.burrow;
    const s = pumpTick(b);
    return `<div class="pumpinfo"><div class="pumpstock big">${G(Math.floor(s))} / ${pumpCap(b)}</div><div class="pumpbar"><i></i></div>
      <small>${pumpRate(b)} glimmer an hour${bonus(b, 'pump') ? ` (relics +${bonus(b, 'pump')}%)` : ''} · the tank holds 3 hours</small></div>
      <button class="btn collect" data-act="collect" ${s >= 1 ? '' : 'disabled'}>COLLECT</button>`;
  }

  private incBody(slot: number) {
    const b = this.game.burrow;
    const s = b.inc[slot];
    const coz = Math.round(cozyChance(b, slot) * 100);
    const info = `<small class="incinfo">Cozy chance <b>${coz}%</b> — a cozy cocoon hatches one rarity higher. Every match you play knocks 4 minutes off.</small>`;
    if (!s) {
      const counts = [0, 0, 0, 0, 0];
      for (const c of this.game.collection.cocoons) counts[c.rarity]++;
      if (!counts.some((n) => n)) return `<div class="lockmsg">No cocoons yet — you get one for every match you play!</div>${info}`;
      const opts = counts
        .map((n, r) => (n ? `<button class="cocpick" data-act="incubate" data-arg="${r}" style="--rc:${RARITY[r].css}"><span class="coc"></span><b>${RARITY[r].name}</b><small>×${n} · ${fmtTime(hatchMs(b, slot, r as RarityIndex))}</small></button>` : ''))
        .join('');
      return `<h4>PICK A COCOON TO INCUBATE</h4><div class="cocpicks">${opts}</div>${info}`;
    }
    const left = incLeft(b, slot);
    if (left <= 0) return `<div class="incready" style="--rc:${RARITY[s.r].css}"><span class="coc big"></span><b class="big">${RARITY[s.r].name.toUpperCase()} COCOON IS READY!</b></div><button class="btn hatchbtn" data-act="hatch">HATCH IT!</button>${info}`;
    return `<div class="incbusy" style="--rc:${RARITY[s.r].css}"><span class="coc"></span><div><b>${RARITY[s.r].name} cocoon</b><div class="incbar"><i></i></div><span class="inctime big">${fmtTime(left)}</span></div></div>
      <button class="btn secondary rush" data-act="rush">HATCH NOW <small>${G(rushCost(left))}</small></button>${info}`;
  }

  private gymBody() {
    const b = this.game.burrow;
    const c = this.game.collection;
    const rows = [...c.bugs]
      .sort((x, y) => (y.level ?? 1) - (x.level ?? 1))
      .map((o) => {
        const sp = SPECIES_BY_ID[o.species];
        const t = trainInfo(b, o);
        return `<div class="gymrow" style="--rc:${RARITY[sp.rarity].css}"><span class="ic">${ICONS.bug}</span><span class="nm"><b>${o.name}</b><small>${sp.name} · LV ${o.level ?? 1} · copies ${o.spare ?? 0}/${t.maxed ? '—' : t.need}</small></span>
          ${t.maxed ? '<em>MAX</em>' : `<button class="btn small" data-act="train" data-arg="${o.species}" ${t.ok ? '' : 'disabled'} title="${t.reason}">LV ${t.level + 1} <small>${G(t.cost)}</small></button>`}</div>`;
      })
      .join('');
    return `<div class="gymcap">Bugs can train up to <b>LV ${gymCap(b)}</b>. Each level: shorter naps, longer blink window, faster throw.</div><div class="gymrows">${rows}</div>`;
  }

  private museumBody() {
    const b = this.game.burrow;
    const shown = displayed(b);
    const bonusLines = (Object.keys(BONUS_TEXT) as RelicBonus[])
      .map((k) => (bonus(b, k) ? `<span>${BONUS_TEXT[k](bonus(b, k))}</span>` : ''))
      .filter(Boolean)
      .join('');
    const sets = RELIC_SETS.map((s) => {
      const rel = RELICS.filter((r) => r.set === s.id);
      const done = b.sets.includes(s.id);
      const slots = rel
        .map((r) => {
          const n = b.relics[r.id] ?? 0;
          return `<span class="rslot ${n ? 'has' : ''} ${n && !shown.includes(r) ? 'stored' : ''}" title="${n ? `${r.name}: ${BONUS_TEXT[r.bonus](r.amount)}` : '???'}">${n ? relicSvg(r.id, 26) : '?'}<small>${n ? r.name : RARITY[r.rarity].name}</small></span>`;
        })
        .join('');
      return `<div class="rset ${done ? 'done' : ''}" style="--sc:${s.css}"><div class="rsh"><b>${s.name}</b><small>${done ? `✓ ${s.hatName} unlocked` : `Finish for the ${s.hatName} + ${s.prize} glimmer`}</small></div><div class="rslots">${slots}</div></div>`;
    }).join('');
    return `<div class="mus"><div class="shelf">${shown.length}/${MUSEUM_SHELVES[b.lv.museum]} shelves used${Object.keys(b.relics).length > shown.length ? ' · the rest are in storage (upgrade for more shelves)' : ''}</div>
      <div class="bonuses">${bonusLines || '<span>Find Rift Relics in matches and carry them to a Rift Nest!</span>'}</div>${sets}</div>`;
  }

  private bazaarBody() {
    const b = this.game.burrow;
    const offers = bazaarOffers(b);
    const cards = offers
      .map((o, i) => {
        if (o.kind === 'cocoon')
          return `<button class="offer ${o.sold ? 'sold' : ''}" style="--rc:${RARITY[o.r].css}" ${o.sold ? 'disabled' : `data-act="buy" data-arg="${i}"`}><span class="coc"></span><b>${RARITY[o.r].name} cocoon</b><small>${o.sold ? 'SOLD' : G(o.price)}</small></button>`;
        const r = RELIC_BY_ID[o.id];
        return `<button class="offer relic ${o.sold ? 'sold' : ''}" style="--rc:${RARITY[r.rarity].css}" ${o.sold ? 'disabled' : `data-act="buy" data-arg="${i}"`}>${relicSvg(r.id, 34)}<b>${r.name}</b><small>${o.sold ? 'SOLD' : `${G(o.price)}${b.relics[r.id] ? ' · have it' : ' · NEW'}`}</small></button>`;
      })
      .join('');
    return `<div class="offers">${cards}</div><div class="restock">Restocks in <b class="restockin"></b> <button class="btn secondary small" data-act="restock" ${b.glimmer >= RESTOCK_COST ? '' : 'disabled'}>RESTOCK NOW <small>${G(RESTOCK_COST)}</small></button></div>`;
  }

  /* ------------------------------------------------------------------ actions */

  private flyGlimmer(from: HTMLElement, n: number) {
    // a little burst of gems from the button to the counter
    const a = from.getBoundingClientRect();
    const t = this.top.querySelector('.glim')!.getBoundingClientRect();
    for (let i = 0; i < Math.min(12, 3 + Math.floor(n / 20)); i++) {
      const g = h('i', 'glimfly', ICONS.glimmer);
      g.style.left = `${a.left + a.width / 2}px`;
      g.style.top = `${a.top + a.height / 2}px`;
      g.style.setProperty('--dx', `${t.left + 20 - (a.left + a.width / 2)}px`);
      g.style.setProperty('--dy', `${t.top + 10 - (a.top + a.height / 2)}px`);
      g.style.animationDelay = `${i * 0.04}s`;
      document.body.appendChild(g);
      setTimeout(() => g.remove(), 1000 + i * 40);
    }
  }

  private act(act: string, arg: string, btn: HTMLElement) {
    const g = this.game;
    const b = g.burrow;
    const id = this.sel!;
    switch (act) {
      case 'upgrade':
        if (upgrade(b, id)) {
          audio.fanfare();
          g.hud.toast(`${BUILDING_BY_ID[id].name} → LV ${b.lv[id]}!`, '#ffe27a');
        }
        break;
      case 'collect': {
        const n = collectPump(b);
        if (n > 0) {
          audio.fuse();
          this.flyGlimmer(btn, n);
        }
        break;
      }
      case 'incubate': {
        const r = Number(arg) as RarityIndex;
        const slot = INCUBATORS.indexOf(id);
        const k = g.collection.cocoons.findIndex((c) => c.rarity === r);
        if (k >= 0 && incubate(b, slot, r)) {
          g.collection.cocoons.splice(k, 1);
          saveCollection(g.collection);
          audio.pop(g.camera.position);
        }
        break;
      }
      case 'rush':
        if (rush(b, INCUBATORS.indexOf(id))) audio.fuse();
        break;
      case 'hatch': {
        const res = takeHatched(b, INCUBATORS.indexOf(id));
        if (res) {
          this.after();
          this.collection.ceremony(res.r, this.el, { cozy: res.cozy, onDone: () => this.after() });
          return;
        }
        break;
      }
      case 'train': {
        const o = g.collection.bugs.find((x) => x.species === arg);
        if (o && train(b, o)) {
          saveCollection(g.collection);
          if (g.collection.equipped === o.species) g.equipBug(o.species);
          audio.fuse();
          g.hud.toast(`${o.name} is now LV ${o.level}!`, '#9dff8a');
        }
        break;
      }
      case 'buy': {
        const o = bazaarOffers(b)[Number(arg)];
        if (!o || o.sold || b.glimmer < o.price) break;
        b.glimmer -= o.price;
        o.sold = true;
        if (o.kind === 'cocoon') {
          g.collection.cocoons.push({ rarity: o.r });
          saveCollection(g.collection);
        } else {
          const res = addRelic(b, o.id);
          if (res.set) g.hud.bigToast(`${res.set.name.toUpperCase()} COMPLETE!`, res.set.css);
        }
        audio.fanfare();
        break;
      }
      case 'restock':
        if (restock(b)) audio.uiTap();
        break;
      case 'decor': {
        const d = DECOR.find((x) => x.id === arg);
        if (d && !b.decor.includes(d.id) && b.glimmer >= d.price) {
          b.glimmer -= d.price;
          b.decor.push(d.id);
          audio.fanfare();
        }
        break;
      }
      case 'hat':
        g.wearHat(arg);
        audio.uiTap();
        break;
    }
    this.after();
  }

  /** for the home screen: how many things are waiting for you */
  static todo(g: Game) {
    const b = g.burrow;
    const now = Date.now();
    let n = 0;
    INCUBATORS.forEach((id, i) => {
      if (!b.lv[id]) return;
      if (b.inc[i] && incLeft(b, i, now) <= 0) n++;
      else if (!b.inc[i] && g.collection.cocoons.length) n++;
    });
    if (pumpTick(b, now) >= pumpCap(b) * 0.5) n++;
    return n;
  }
}
