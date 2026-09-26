/**
 * Unified input: keyboard + mouse (pointer lock) and touch. The touch layer (ui/Touch.ts) writes
 * into the same state object, so the PlayerController doesn't care where input came from.
 */
export interface InputState {
  moveX: number; // -1..1 (right +)
  moveY: number; // -1..1 (forward +)
  lookDX: number; // accumulated radians-ish this frame
  lookDY: number;
  sprint: boolean;
  fire: boolean;
  ads: boolean;
  jumpPressed: boolean;
  crouchPressed: boolean;
  reloadPressed: boolean;
  interactPressed: boolean;
  /** interact is being held (reviving a teammate) */
  interactHeld: boolean;
  throwHeld: boolean;
  throwReleased: boolean;
  blinkPressed: boolean;
  slotPressed: number;
  pausePressed: boolean;
  touchActive: boolean;
  utilHeld: boolean;
  utilReleased: boolean;
  healPressed: boolean;
  emotePressed: boolean;
  dropPressed: boolean;
}

export class Input {
  s: InputState = {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    sprint: false,
    fire: false,
    ads: false,
    jumpPressed: false,
    crouchPressed: false,
    reloadPressed: false,
    interactPressed: false,
    interactHeld: false,
    throwHeld: false,
    throwReleased: false,
    blinkPressed: false,
    slotPressed: -1,
    pausePressed: false,
    touchActive: false,
    utilHeld: false,
    utilReleased: false,
    healPressed: false,
    emotePressed: false,
    dropPressed: false,
  };
  private keys = new Set<string>();
  locked = false;
  mouseSens = 0.0022;
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.s.fire = false;
      this.s.ads = false;
      if (this.s.throwHeld) {
        this.s.throwHeld = false;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.s.touchActive || !this.enabled) return;
      if (!this.locked) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.s.fire = true;
      if (e.button === 2) this.s.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.s.fire = false;
      if (e.button === 2) this.s.ads = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.s.fire = false;
        this.s.ads = false;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.s.lookDX += e.movementX * this.mouseSens;
      this.s.lookDY += e.movementY * this.mouseSens;
    });
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.repeat) return;
    const k = e.code;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!this.enabled) return;
    if (!down && k === 'KeyF') this.s.interactHeld = false;
    if (down) {
      switch (k) {
        case 'Space':
          this.s.jumpPressed = true;
          break;
        case 'KeyC':
        case 'ControlLeft':
          this.s.crouchPressed = true;
          break;
        case 'KeyR':
          this.s.reloadPressed = true;
          break;
        case 'KeyF':
          this.s.interactPressed = true;
          this.s.interactHeld = true;
          break;
        case 'KeyE':
          this.s.blinkPressed = true;
          break;
        case 'KeyQ':
          this.s.throwHeld = true;
          break;
        case 'Digit1':
          this.s.slotPressed = 0;
          break;
        case 'Digit2':
          this.s.slotPressed = 1;
          break;
        case 'Digit3':
          this.s.slotPressed = 2;
          break;
        case 'KeyG':
          this.s.utilHeld = true;
          break;
        case 'KeyH':
          this.s.healPressed = true;
          break;
        case 'KeyB':
          this.s.emotePressed = true;
          break;
        case 'KeyX':
          this.s.dropPressed = true;
          break;
        case 'Escape':
        case 'KeyP':
          this.s.pausePressed = true;
          break;
      }
    } else if (k === 'KeyQ' && this.s.throwHeld) {
      this.s.throwHeld = false;
      this.s.throwReleased = true;
    } else if (k === 'KeyG' && this.s.utilHeld) {
      this.s.utilHeld = false;
      this.s.utilReleased = true;
    }
  }

  /** Called once per frame before controllers read input. */
  poll() {
    if (!this.s.touchActive) {
      const kx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const ky = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const l = Math.hypot(kx, ky) || 1;
      this.s.moveX = kx / l;
      this.s.moveY = ky / l;
      this.s.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    }
  }

  /** Clear one-shot flags at the end of the frame. */
  endFrame() {
    const s = this.s;
    s.lookDX = 0;
    s.lookDY = 0;
    s.jumpPressed = false;
    s.crouchPressed = false;
    s.reloadPressed = false;
    s.interactPressed = false;
    s.throwReleased = false;
    s.utilReleased = false;
    s.healPressed = false;
    s.emotePressed = false;
    s.dropPressed = false;
    s.blinkPressed = false;
    s.slotPressed = -1;
    s.pausePressed = false;
  }
}
