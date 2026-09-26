import { Input } from '../core/Input';
import { ICONS } from './icons';
import { audio } from '../audio/Audio';

type BtnId = 'fire' | 'jump' | 'crouch' | 'reload' | 'ads' | 'bug' | 'blink' | 'interact' | 'pause' | 'util' | 'heal';

interface Btn {
  id: BtnId;
  el: HTMLDivElement;
  /** position relative to bottom-right corner (px, before scale) */
  r: number;
  b: number;
  /** pointer ids currently holding this button */
  pointer: number | null;
  lookWhileHeld: boolean;
  lastX: number;
  lastY: number;
}

/**
 * Mobile controls: floating left joystick, right-side camera drag, big thumb buttons with press
 * animation + audio tick. FIRE and THROW can be dragged to steer the camera while held.
 */
export class TouchControls {
  root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private btns = new Map<BtnId, Btn>();
  sensitivity = 1;
  active = false;
  onPause: (() => void) | null = null;

  constructor(private input: Input) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);

    const def: [BtnId, string, number, number, string, boolean][] = [
      ['fire', ICONS.fire, 150, 128, 'fire', true],
      ['jump', ICONS.jump, 58, 82, '', false],
      ['crouch', ICONS.crouch, 58, 184, '', false],
      ['reload', ICONS.reload, 150, 238, 'small', false],
      ['ads', ICONS.ads, 250, 74, '', false],
      ['bug', ICONS.throwBug, 262, 178, 'bug', true],
      ['blink', ICONS.blink, 348, 108, 'blink', false],
      ['interact', ICONS.interact, 262, 300, 'interact', false],
      ['util', ICONS.utility, 150, 322, 'small item', true],
      ['heal', ICONS.heal, 58, 282, 'small item', false],
    ];
    for (const [id, icon, r, b, cls, look] of def) {
      const el = document.createElement('div');
      el.className = `tbtn ${cls}`;
      el.innerHTML = icon;
      el.dataset.id = id;
      this.root.appendChild(el);
      this.btns.set(id, { id, el, r, b, pointer: null, lookWhileHeld: look, lastX: 0, lastY: 0 });
    }
    const bug = this.btns.get('bug')!.el;
    const cd = document.createElement('div');
    cd.className = 'cd';
    bug.appendChild(cd);
    const blink = this.btns.get('blink')!.el;
    const cd2 = document.createElement('div');
    cd2.className = 'cd';
    const cdt = document.createElement('div');
    cdt.className = 'cdtext big';
    blink.append(cd2, cdt);

    const pause = document.createElement('div');
    pause.className = 'tbtn small pausebtn';
    pause.innerHTML = ICONS.pause;
    pause.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onPause?.();
    });
    this.root.appendChild(pause);

    document.body.appendChild(this.root);
    this.layout();
    window.addEventListener('resize', () => this.layout());

    const target = window;
    target.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    target.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    target.addEventListener('pointerup', (e) => this.up(e));
    target.addEventListener('pointercancel', (e) => this.up(e));
    // first touch ever switches the game into touch mode
    window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.input.s.touchActive = true;
    this.root.classList.add('on');
    document.body.classList.add('touch-on');
    this.layout();
  }

  private scale() {
    const h = window.innerHeight, w = window.innerWidth;
    return Math.max(0.72, Math.min(1.15, Math.min(h / 430, w / 900)));
  }

  layout() {
    const s = this.scale();
    const W = window.innerWidth, H = window.innerHeight;
    for (const b of this.btns.values()) {
      b.el.style.left = `${W - b.r * s}px`;
      b.el.style.top = `${H - b.b * s}px`;
      b.el.style.transform = b.el.classList.contains('down') ? '' : '';
      b.el.style.scale = String(s);
    }
    if (this.stickPointer === null) this.placeStickRest();
  }

  private placeStickRest() {
    const s = this.scale();
    this.stick.style.left = `${Math.max(90, window.innerWidth * 0.13)}px`;
    this.stick.style.top = `${window.innerHeight - 120 * s}px`;
    this.stick.style.scale = String(s);
    this.knob.style.transform = '';
  }

  private hitBtn(e: PointerEvent): Btn | null {
    const el = (e.target as HTMLElement)?.closest?.('.tbtn') as HTMLDivElement | null;
    if (!el || !el.dataset.id) return null;
    return this.btns.get(el.dataset.id as BtnId) ?? null;
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && !this.active) return;
    if (e.pointerType !== 'mouse') this.enable();
    if (!this.active || !this.input.enabled) return;
    if ((e.target as HTMLElement).closest('.overlay, .menu, .slots')) return;
    const b = this.hitBtn(e);
    if (b) {
      e.preventDefault();
      if (b.el.classList.contains('interact') && !b.el.classList.contains('show')) return;
      b.pointer = e.pointerId;
      b.lastX = e.clientX;
      b.lastY = e.clientY;
      b.el.classList.add('down');
      audio.uiTap();
      navigator.vibrate?.(8);
      this.press(b.id, true);
      return;
    }
    const W = window.innerWidth;
    if (e.clientX < W * 0.42 && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('active');
    } else if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private move(e: PointerEvent) {
    if (!this.active) return;
    if (e.pointerId === this.stickPointer) {
      e.preventDefault();
      const s = this.scale();
      const R = 56 * s;
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      // drag the base along if the thumb goes far (floating stick)
      if (d > R * 1.6) {
        const k = (d - R * 1.6) / d;
        this.stickOrigin.x += dx * k;
        this.stickOrigin.y += dy * k;
        this.stick.style.left = `${this.stickOrigin.x}px`;
        this.stick.style.top = `${this.stickOrigin.y}px`;
        dx = e.clientX - this.stickOrigin.x;
        dy = e.clientY - this.stickOrigin.y;
      }
      const dd = Math.hypot(dx, dy);
      const cl = Math.min(dd, R);
      const nx = dd > 0 ? (dx / dd) * cl : 0, ny = dd > 0 ? (dy / dd) * cl : 0;
      this.knob.style.transform = `translate(${nx / s}px, ${ny / s}px)`;
      // small dead zone, then a slightly eased response curve
      let mx = nx / R, my = -ny / R;
      const m = Math.hypot(mx, my);
      if (m < 0.12) mx = my = 0;
      this.input.s.moveX = mx;
      this.input.s.moveY = my;
      this.stick.classList.toggle('sprint', dd > R * 0.95 && my > 0.3);
      return;
    }
    const sens = 0.0048 * this.sensitivity;
    if (e.pointerId === this.lookPointer) {
      e.preventDefault();
      this.input.s.lookDX += (e.clientX - this.lookLast.x) * sens;
      this.input.s.lookDY += (e.clientY - this.lookLast.y) * sens;
      this.lookLast = { x: e.clientX, y: e.clientY };
      return;
    }
    for (const b of this.btns.values()) {
      if (b.pointer === e.pointerId && b.lookWhileHeld) {
        e.preventDefault();
        this.input.s.lookDX += (e.clientX - b.lastX) * sens * 0.85;
        this.input.s.lookDY += (e.clientY - b.lastY) * sens * 0.85;
        b.lastX = e.clientX;
        b.lastY = e.clientY;
      }
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.input.s.moveX = 0;
      this.input.s.moveY = 0;
      this.stick.classList.remove('active', 'sprint');
      this.placeStickRest();
    }
    if (e.pointerId === this.lookPointer) this.lookPointer = null;
    for (const b of this.btns.values()) {
      if (b.pointer === e.pointerId) {
        b.pointer = null;
        b.el.classList.remove('down');
        this.press(b.id, false);
      }
    }
  }

  private press(id: BtnId, down: boolean) {
    const s = this.input.s;
    switch (id) {
      case 'fire':
        s.fire = down;
        break;
      case 'ads':
        if (down) s.ads = !s.ads; // toggle feels better on touch
        break;
      case 'jump':
        if (down) s.jumpPressed = true;
        break;
      case 'crouch':
        if (down) s.crouchPressed = true;
        break;
      case 'reload':
        if (down) s.reloadPressed = true;
        break;
      case 'interact':
        if (down) s.interactPressed = true;
        break;
      case 'blink':
        if (down) s.blinkPressed = true;
        break;
      case 'util':
        if (down) s.utilHeld = true;
        else if (s.utilHeld) {
          s.utilHeld = false;
          s.utilReleased = true;
        }
        break;
      case 'heal':
        if (down) s.healPressed = true;
        break;
      case 'bug':
        if (down) s.throwHeld = true;
        else if (s.throwHeld) {
          s.throwHeld = false;
          s.throwReleased = true;
        }
        break;
    }
  }

  /** Per-frame visual state for Blinkbug buttons and contextual interact. */
  private itemSig = '';
  updateVisuals(bug: { ready: boolean; canBlink: boolean; cooldown: number; cooldownMax: number; window: number }, windowMax: number, interact: boolean, p?: { util: { id: string; count: number } | null; healItem: { id: string; count: number } | null; healT: number }) {
    if (!this.active) return;
    if (p) {
      const sig = `${p.util?.id}${p.util?.count}|${p.healItem?.id}${p.healItem?.count}`;
      if (sig !== this.itemSig) {
        this.itemSig = sig;
        for (const [id, st, fb] of [
          ['util', p.util, ICONS.utility],
          ['heal', p.healItem, ICONS.heal],
        ] as [BtnId, { id: string; count: number } | null, string][]) {
          const el = this.btns.get(id)!.el;
          el.innerHTML = (st ? (ICONS as Record<string, string>)[st.id] : fb) + (st && st.count > 1 ? `<span class="cdtext">x${st.count}</span>` : '');
          el.classList.toggle('disabled', !st);
        }
      }
      this.btns.get('heal')!.el.classList.toggle('ready', p.healT >= 0);
    }
    const bb = this.btns.get('bug')!.el;
    const bl = this.btns.get('blink')!.el;
    const cdBug = bb.querySelector('.cd') as HTMLDivElement;
    const cdBlink = bl.querySelector('.cd') as HTMLDivElement;
    const cdText = bl.querySelector('.cdtext') as HTMLDivElement;
    const wasReady = !bb.classList.contains('disabled');
    bb.classList.toggle('disabled', !bug.ready);
    if (bug.ready && !wasReady) {
      bb.classList.remove('ready');
      void bb.offsetWidth;
      bb.classList.add('ready');
    }
    if (bug.cooldown > 0) {
      const k = 1 - bug.cooldown / bug.cooldownMax;
      cdBug.style.background = `conic-gradient(rgba(43,34,56,0.55) 0 ${(1 - k) * 360}deg, transparent 0)`;
    } else cdBug.style.background = 'none';
    bl.classList.toggle('disabled', !bug.canBlink);
    if (bug.canBlink) {
      const k = bug.window / windowMax;
      cdBlink.style.background = `conic-gradient(transparent 0 ${(1 - k) * 360}deg, rgba(111,247,255,0.0) 0)`;
      cdBlink.style.boxShadow = `0 0 0 ${3 + Math.sin(performance.now() / 90) * 2}px rgba(111,247,255,0.8)`;
      cdText.textContent = bug.window.toFixed(1);
    } else {
      cdBlink.style.boxShadow = 'none';
      cdBlink.style.background = 'none';
      cdText.textContent = '';
    }
    this.btns.get('interact')!.el.classList.toggle('show', interact);
  }
}
