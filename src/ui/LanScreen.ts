import type { Game } from '../core/Game';
import { audio } from '../audio/Audio';
import { Link, Msg } from '../net/Link';
import { HostSession, RoomMember } from '../net/Host';
import { ClientSession } from '../net/Client';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TEAM_COLORS = ['#f2c14e', '#6ff7ff', '#f28fad', '#9dff8a', '#b49be0', '#ff9a5b', '#7fb7e6', '#ffffff', '#d9774f', '#3fc6c0', '#ffd36b', '#c160ff'];
const MODES = ['', 'SOLO', 'DUOS', 'TRIOS', 'SQUADS'];

/**
 * PLAY WITH FRIENDS: make or join a room on the LAN server, pick teams, and go. Everyone who
 * picks the same team number plays together; empty places are filled with bots.
 */
export class LanScreen {
  root = h('div', 'overlay lan hidden');
  private link: Link | null = null;
  private you = 0;
  private lobby: { code: string; teamSize: number; members: RoomMember[] } | null = null;
  onClose: (() => void) | null = null;

  constructor(private game: Game) {
    document.body.appendChild(this.root);
  }

  private name() {
    try {
      return localStorage.getItem('rr.name') || '';
    } catch {
      return '';
    }
  }
  private saveName(n: string) {
    try {
      localStorage.setItem('rr.name', n);
    } catch {
      /* ignore */
    }
  }

  async open() {
    this.root.classList.remove('hidden');
    this.render('<div class="lanmsg big">Looking for the LAN server…</div>');
    if (!this.link) {
      const link = new Link();
      try {
        await link.connect();
      } catch {
        this.renderNoServer();
        return;
      }
      this.link = link;
      link.on('lobby', (m) => this.onLobby(m));
      link.on('error', (m) => this.flash(String(m.msg)));
      link.on('start', (m) => this.onStart(m));
      link.on('closed', (m) => this.onGone(String(m.msg || 'The room closed.')));
      link.onClose = () => this.onGone('Lost connection to the LAN server.');
    }
    if (this.lobby) this.renderRoom();
    else this.renderEntry();
  }

  private close() {
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  private render(inner: string) {
    this.root.innerHTML = `<div class="menu panel lanpanel"><div class="menuhead"><h2>PLAY WITH FRIENDS</h2><button class="btn secondary x">BACK</button></div>${inner}<div class="lanflash"></div></div>`;
    this.root.querySelector('.x')!.addEventListener('click', () => {
      audio.uiTap();
      if (this.lobby) {
        // leaving a room: simplest clean slate is a fresh page
        location.reload();
        return;
      }
      this.close();
    });
  }

  private flash(t: string) {
    const e = this.root.querySelector('.lanflash') as HTMLElement | null;
    if (!e) return;
    e.textContent = t;
    e.classList.remove('on');
    void e.offsetWidth;
    e.classList.add('on');
  }

  private renderNoServer() {
    this.render(`<div class="lanhelp">
      <p><b>No LAN server found.</b> Playing with friends needs one computer on your Wi-Fi to run the Rift Rascals LAN server:</p>
      <ol><li>On that computer, in the game folder, run <code>npm run lan</code></li>
      <li>It prints an address like <code>http://192.168.1.20:8787</code></li>
      <li>Open that address on <b>every</b> phone / tablet / computer that wants to play (all on the same Wi-Fi)</li>
      <li>Come back here: one of you makes a room, everyone else joins with the code</li></ol>
      <button class="btn retry">TRY AGAIN</button></div>`);
    this.root.querySelector('.retry')!.addEventListener('click', () => {
      audio.uiTap();
      this.open();
    });
  }

  private renderEntry() {
    this.render(`<div class="lanentry">
      <label>Your name <input class="nm" maxlength="14" placeholder="Rascal" value="${esc(this.name())}"></label>
      <button class="btn create">MAKE A ROOM</button>
      <div class="or">or join a friend's room</div>
      <div class="joinrow"><input class="code" maxlength="4" placeholder="CODE" autocapitalize="characters"><button class="btn secondary join">JOIN</button></div>
    </div>`);
    const nm = this.root.querySelector('.nm') as HTMLInputElement;
    const code = this.root.querySelector('.code') as HTMLInputElement;
    const getName = () => {
      const n = nm.value.trim().slice(0, 14) || 'Rascal';
      this.saveName(n);
      return n;
    };
    this.root.querySelector('.create')!.addEventListener('click', () => {
      audio.unlock();
      audio.uiTap();
      this.link?.send({ t: 'create', name: getName() });
    });
    const join = () => {
      audio.unlock();
      audio.uiTap();
      const c = code.value.trim().toUpperCase();
      if (c.length !== 4) {
        this.flash('Room codes are 4 letters');
        return;
      }
      this.link?.send({ t: 'join', code: c, name: getName() });
    };
    this.root.querySelector('.join')!.addEventListener('click', join);
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
  }

  private onLobby(m: Msg) {
    this.you = m.you as number;
    this.lobby = { code: m.code as string, teamSize: m.teamSize as number, members: m.members as RoomMember[] };
    if (!this.root.classList.contains('hidden')) this.renderRoom();
  }

  private renderRoom() {
    const L = this.lobby!;
    const me = L.members.find((x) => x.id === this.you);
    const isHost = !!me?.host;
    const size = L.teamSize;
    const teamsUsed = new Map<number, number>();
    for (const x of L.members) teamsUsed.set(x.team, (teamsUsed.get(x.team) ?? 0) + 1);
    const rows = L.members
      .map((x) => {
        const col = TEAM_COLORS[x.team % TEAM_COLORS.length];
        const team = size > 1 ? `<span class="team" style="--tc:${col}">${x.id === this.you ? '<button class="tprev">◀</button>' : ''}TEAM ${x.team + 1}${x.id === this.you ? '<button class="tnext">▶</button>' : ''}</span>` : '';
        return `<div class="mem${x.id === this.you ? ' me' : ''}"><span class="nm">${esc(x.name)}${x.host ? ' <small>HOST</small>' : ''}${x.id === this.you ? ' <small>YOU</small>' : ''}</span>${team}</div>`;
      })
      .join('');
    const humans = L.members.length;
    const bots = 24 - humans;
    this.render(`<div class="lanroom">
      <div class="code big">ROOM <b>${L.code}</b></div>
      <div class="hint">Friends on this Wi-Fi: open <b>${esc(location.host)}</b> and join with the code.</div>
      <div class="modes">${[1, 2, 3, 4].map((n) => `<button data-n="${n}" class="${n === size ? 'on' : ''}" ${isHost ? '' : 'disabled'}>${MODES[n]}</button>`).join('')}</div>
      <div class="members">${rows}</div>
      <div class="hint">${size > 1 ? `Same team number = teammates (up to ${size}). Want to play <b>against</b> each other? Pick different teams. ` : 'Solo: everyone for themselves. '}${bots} bots fill the rest of the island.</div>
      ${isHost ? '<button class="btn start">START MATCH</button>' : '<div class="wait big">Waiting for the host to start…</div>'}
    </div>`);
    this.root.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) =>
      b.addEventListener('click', () => {
        audio.uiTap();
        this.link?.send({ t: 'mode', teamSize: Number(b.dataset.n) });
      }),
    );
    const setTeam = (d: number) => {
      audio.uiTap();
      const cur = me?.team ?? 0;
      let t = cur;
      // step to the next team with room (or an empty one)
      for (let i = 0; i < 12; i++) {
        t = (t + d + 12) % 12;
        if ((teamsUsed.get(t) ?? 0) < size) break;
      }
      this.link?.send({ t: 'team', team: t });
    };
    this.root.querySelector('.tprev')?.addEventListener('click', () => setTeam(-1));
    this.root.querySelector('.tnext')?.addEventListener('click', () => setTeam(1));
    this.root.querySelector('.start')?.addEventListener('click', () => {
      audio.unlock();
      audio.uiTap();
      this.link?.send({ t: 'start' });
    });
  }

  /** the host pressed START: host runs the match here, clients follow it */
  private onStart(m: Msg) {
    audio.unlock();
    const g = this.game;
    const members = m.members as RoomMember[];
    const me = members.find((x) => x.id === (m.you as number));
    this.root.classList.add('hidden');
    g.menus.hideAll();
    const link = this.link!;
    if (me?.host) {
      let host = g.net as HostSession | null;
      if (!host || host.role !== 'host') {
        host = new HostSession(g, link, me.id);
        g.net = host;
      }
      host.start(members, m.teamSize as number);
    } else {
      let cl = g.net as ClientSession | null;
      if (!cl || cl.role !== 'client') {
        cl = new ClientSession(g, link, m.you as number);
        g.net = cl;
      }
      cl.begin();
    }
    // the summary's buttons mean something different in a room
    const ui = g.matchCtl.ui;
    ui.onPlayAgain = me?.host ? () => link.send({ t: 'start' }) : null;
    ui.onHome = () => location.reload();
    ui.netClient = !me?.host;
    ui.netRoom = true;
  }

  private onGone(msg: string) {
    this.lobby = null;
    alert(msg);
    location.reload();
  }
}
