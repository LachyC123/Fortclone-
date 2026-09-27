import * as THREE from 'three';
import type { SoundProfile } from '../combat/Weapons';
import { Surface } from '../physics/Collision';
import { rand } from '../core/math';

/**
 * Procedural audio. Every sound is synthesised at runtime from oscillators and filtered noise,
 * so the game ships with zero audio files yet every action has distinctive, varied feedback.
 * Sounds are spatialised with a cheap stereo-pan + distance model (far cheaper than HRTF panners).
 */
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  /** 0 = outdoors, 1 = inside a building (adds a room reverb) */
  indoor = 0;
  volume = 0.8;
  private lastPlay = new Map<string, number>();
  private voices = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // small room impulse for interiors
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.sfx.connect(this.reverbSend).connect(this.reverb).connect(this.master);

    this.startAmbience();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3) {
    this.listenerPos.copy(pos);
    this.listenerRight.copy(right);
    if (this.ctx) {
      this.reverbSend.gain.setTargetAtTime(this.indoor * 0.35, this.ctx.currentTime, 0.2);
    }
  }

  setWind(amount: number) {
    if (this.windGain && this.ctx) {
      this.windGain.gain.setTargetAtTime(0.04 + amount * 0.5, this.ctx.currentTime, 0.15);
      this.windFilter!.frequency.setTargetAtTime(350 + amount * 1400, this.ctx.currentTime, 0.2);
    }
  }

  /* ----------------------------------------------------------- plumbing */

  private out(pos?: THREE.Vector3, vol = 1, maxDist = 60): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || this.voices > 48) return null;
    const g = ctx.createGain();
    let gain = vol;
    let pan = 0;
    if (pos) {
      const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > maxDist) return null;
      gain *= 1 / (1 + dist * 0.09) * (1 - dist / maxDist);
      if (dist > 0.5) pan = (dx * this.listenerRight.x + dz * this.listenerRight.z) / dist;
      if (gain < 0.01) return null;
    }
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.75;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    this.voices++;
    setTimeout(() => this.voices--, 1200);
    return g;
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    if ((this.lastPlay.get(key) ?? 0) + ms > now) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dst);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dst: AudioNode, t0: number, dur: number, vol: number, filterType: BiquadFilterType, f0: number, f1: number, q = 1, attack = 0.002) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dst);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.02);
  }

  /* ----------------------------------------------------------- ambience */

  private startAmbience() {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.amb);
    s.start();
    this.windGain = g;
    this.windFilter = f;
    // gentle gusting
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 0.025;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
  }

  bird(pos: THREE.Vector3) {
    const out = this.out(pos, 0.22, 70);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const base = rand(2200, 3600);
    const n = Math.floor(rand(2, 5));
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand(0.08, 0.14);
      this.tone(out, 'sine', base * rand(0.9, 1.1), base * rand(1.2, 1.6), tt, 0.07, 0.3);
    }
  }

  /* ----------------------------------------------------------- movement */

  footstep(pos: THREE.Vector3, surface: Surface, loud = 1) {
    const out = this.out(pos, 0.5 * loud, 35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    switch (surface) {
      case 'wood':
        this.tone(out, 'triangle', rand(150, 190), 90, t, 0.07, 0.45);
        this.noise(out, t, 0.05, 0.25, 'bandpass', 900, 500, 2);
        break;
      case 'metal':
        this.tone(out, 'square', rand(420, 520), 300, t, 0.05, 0.12);
        this.tone(out, 'sine', rand(1400, 1700), 1200, t, 0.12, 0.08);
        this.noise(out, t, 0.04, 0.2, 'highpass', 3000, 2000, 1);
        break;
      case 'stone':
        this.noise(out, t, 0.05, 0.4, 'bandpass', 1800, 900, 1.2);
        this.tone(out, 'sine', 120, 70, t, 0.05, 0.25);
        break;
      case 'water':
        this.noise(out, t, 0.18, 0.4, 'bandpass', 1200, 2600, 3, 0.02);
        this.tone(out, 'sine', rand(500, 700), 1100, t + 0.02, 0.08, 0.1);
        break;
      default: // grass / dirt / cloth
        this.noise(out, t, 0.08, 0.35, 'highpass', 2500, 1400, 0.8, 0.01);
        this.noise(out, t, 0.06, 0.2, 'lowpass', 400, 200, 1);
    }
  }

  jump(pos: THREE.Vector3) {
    const out = this.out(pos, 0.35, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.12, 0.25, 'bandpass', 800, 2000, 1.5, 0.01);
    this.tone(out, 'sine', 260, 420, t, 0.1, 0.12);
  }

  land(pos: THREE.Vector3, impact: number, surface: Surface) {
    const out = this.out(pos, Math.min(1, 0.3 + impact * 0.05), 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 140, 50, t, 0.18, 0.6);
    this.noise(out, t, 0.14, 0.4, 'lowpass', surface === 'wood' ? 900 : 1600, 300, 1);
  }

  slide(pos: THREE.Vector3) {
    const out = this.out(pos, 0.4, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.5, 0.35, 'bandpass', 1400, 500, 0.8, 0.03);
  }

  mantle(pos: THREE.Vector3) {
    const out = this.out(pos, 0.35, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.15, 0.3, 'bandpass', 600, 1200, 1.2, 0.02);
    this.tone(out, 'triangle', 180, 260, t + 0.05, 0.12, 0.15);
  }

  /* ----------------------------------------------------------- weapons */

  gunshot(pos: THREE.Vector3 | undefined, profile: SoundProfile, isLocal: boolean) {
    // your own shots play flat (not panned); the position is still passed so LAN hosts can share it
    const out = this.out(isLocal ? undefined : pos, isLocal ? 0.75 : 0.95, 120);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const p = rand(0.93, 1.07);
    switch (profile) {
      case 'rifle':
        this.tone(out, 'square', 210 * p, 60, t, 0.08, 0.35);
        this.tone(out, 'sine', 95 * p, 40, t, 0.16, 0.8);
        this.noise(out, t, 0.12, 0.8, 'lowpass', 5200, 700, 0.7);
        this.noise(out, t, 0.03, 0.4, 'highpass', 5000, 3000, 1); // metallic "tin" crack
        this.tone(out, 'triangle', 1900 * p, 1300, t, 0.05, 0.12);
        break;
      case 'pop':
        this.tone(out, 'square', 340 * p, 110, t, 0.06, 0.3);
        this.noise(out, t, 0.08, 0.6, 'lowpass', 4200, 800, 0.9);
        this.tone(out, 'sine', 900 * p, 300, t, 0.05, 0.25);
        break;
      case 'heavy':
        // THUMP: deep kick, boomy tail, metallic ring
        this.tone(out, 'sine', 70 * p, 26, t, 0.5, 1);
        this.tone(out, 'square', 140 * p, 40, t, 0.12, 0.4);
        this.noise(out, t, 0.45, 1, 'lowpass', 2600, 150, 0.7);
        this.tone(out, 'triangle', 900 * p, 600, t + 0.02, 0.3, 0.12);
        break;
      case 'shotgun':
        this.tone(out, 'sine', 85 * p, 30, t, 0.35, 1);
        this.noise(out, t, 0.32, 1, 'lowpass', 4500, 250, 0.7);
        this.noise(out, t, 0.06, 0.6, 'highpass', 3000, 1500, 0.8);
        // broom bristle swish
        this.noise(out, t + 0.05, 0.18, 0.25, 'bandpass', 5000, 2500, 2, 0.03);
        break;
      case 'needle':
        this.tone(out, 'sawtooth', 2400 * p, 900, t, 0.08, 0.25);
        this.tone(out, 'sine', 120 * p, 50, t, 0.2, 0.7);
        this.noise(out, t, 0.14, 0.6, 'bandpass', 6000, 2000, 1.5);
        this.tone(out, 'sine', 3200 * p, 3000, t + 0.03, 0.25, 0.1);
        break;
      case 'bow':
        this.tone(out, 'triangle', 220 * p, 90, t, 0.12, 0.5); // string twang
        this.tone(out, 'triangle', 330 * p, 140, t, 0.1, 0.3);
        this.noise(out, t, 0.2, 0.3, 'bandpass', 1500, 4000, 2, 0.02);
        this.tone(out, 'sine', 1800 * p, 3600, t + 0.02, 0.18, 0.15); // spark hum
        break;
      case 'pepper':
        this.tone(out, 'square', 420 * p, 150, t, 0.05, 0.3);
        this.noise(out, t, 0.07, 0.6, 'lowpass', 5000, 900, 0.9);
        this.tone(out, 'sine', 1200 * p, 500, t, 0.04, 0.2);
        break;
      case 'smg':
        this.tone(out, 'square', 300 * p, 120, t, 0.05, 0.25);
        this.noise(out, t, 0.06, 0.6, 'bandpass', 3000, 1000, 0.8);
        break;
      case 'zap':
        // electric crackle: buzzy saw sweep plus fizzing highs
        this.tone(out, 'sawtooth', 1400 * p, 300, t, 0.07, 0.22);
        this.tone(out, 'square', 90 * p, 60, t, 0.06, 0.2);
        this.noise(out, t, 0.07, 0.45, 'highpass', 6000, 3500, 1.2);
        break;
      case 'lob':
        // hollow cannon THOOMP
        this.tone(out, 'sine', 120 * p, 45, t, 0.3, 0.9);
        this.noise(out, t, 0.2, 0.6, 'lowpass', 1400, 200, 1);
        this.tone(out, 'triangle', 420 * p, 260, t + 0.01, 0.08, 0.25);
        break;
      case 'gloop':
        // wet blorp
        this.tone(out, 'sine', 260 * p, 720, t, 0.12, 0.45);
        this.noise(out, t, 0.1, 0.35, 'lowpass', 1400, 400, 3);
        break;
    }
    if (!isLocal && pos) {
      // distant shots get a rumbling tail so you HEAR fights before you see them
      const d = pos.distanceTo(this.listenerPos);
      if (d > 20) this.noise(out, t + 0.03, 0.5, 0.25, 'lowpass', 500, 120, 0.5, 0.05);
    }
  }

  dryFire() {
    const out = this.out(undefined, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'square', 1200, 900, t, 0.03, 0.15);
  }

  reload(stage: 0 | 1 | 2) {
    const out = this.out(undefined, 0.45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    if (stage === 0) {
      this.noise(out, t, 0.08, 0.5, 'bandpass', 2400, 1200, 2);
      this.tone(out, 'triangle', 700, 500, t, 0.06, 0.2);
    } else if (stage === 1) {
      // tin can rattle
      for (let i = 0; i < 4; i++) this.tone(out, 'square', rand(1800, 2600), 1500, t + i * 0.035, 0.03, 0.08);
      this.noise(out, t, 0.12, 0.4, 'highpass', 3000, 2000, 1);
    } else {
      this.tone(out, 'square', 520, 900, t, 0.05, 0.2);
      this.noise(out, t + 0.04, 0.06, 0.5, 'bandpass', 3000, 2000, 2);
      this.tone(out, 'sine', 1400, 1800, t + 0.06, 0.08, 0.15);
    }
  }

  equip() {
    const out = this.out(undefined, 0.45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.06, 0.4, 'bandpass', 1800, 3000, 2);
    this.tone(out, 'triangle', 600, 1100, t + 0.05, 0.08, 0.2);
  }

  impact(pos: THREE.Vector3, surface: Surface) {
    if (!this.throttle('impact', 25)) return;
    const out = this.out(pos, 0.35, 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    if (surface === 'metal') {
      this.tone(out, 'sine', rand(2200, 3200), 1800, t, 0.25, 0.25);
      this.tone(out, 'square', rand(900, 1200), 600, t, 0.05, 0.1);
    } else if (surface === 'wood') {
      this.tone(out, 'triangle', rand(300, 420), 150, t, 0.08, 0.35);
      this.noise(out, t, 0.06, 0.3, 'bandpass', 1400, 600, 1.5);
    } else if (surface === 'water') {
      this.noise(out, t, 0.2, 0.4, 'bandpass', 1500, 3000, 2, 0.01);
    } else {
      this.noise(out, t, 0.07, 0.4, 'bandpass', 2600, 900, 1.2);
    }
  }

  private hitAt = -9;
  private hitCombo = 0;
  hitmarker(headshot: boolean, kill: boolean) {
    const out = this.out(undefined, 0.55);
    if (!out) return;
    const t = this.ctx!.currentTime;
    // a string of hits climbs in pitch: tick, tick, TICK, TICK!
    this.hitCombo = t - this.hitAt < 0.5 ? Math.min(10, this.hitCombo + 1) : 0;
    this.hitAt = t;
    const k = 1 + this.hitCombo * 0.06;
    if (headshot) {
      this.tone(out, 'sine', 2400 * k, 2400 * k, t, 0.18, 0.45);
      this.tone(out, 'sine', 3600 * k, 3600 * k, t + 0.01, 0.14, 0.25);
      this.tone(out, 'triangle', 1200, 1250, t, 0.1, 0.3);
    } else {
      this.tone(out, 'triangle', 1500 * k, 1300 * k, t, 0.05, 0.35);
      this.noise(out, t, 0.03, 0.3, 'highpass', 4000, 3000, 1);
    }
    if (kill) {
      [880, 1175, 1568].forEach((f, i) => this.tone(out, 'triangle', f, f, t + 0.08 + i * 0.07, 0.18, 0.3));
    }
  }

  hurt(pos?: THREE.Vector3) {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 180, 90, t, 0.15, 0.5);
    this.noise(out, t, 0.1, 0.4, 'lowpass', 1200, 300, 1);
  }

  bell(pos: THREE.Vector3) {
    if (!this.throttle('bell', 300)) return;
    const out = this.out(pos, 1, 160);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const f = 220;
    [1, 2.01, 2.76, 4.07, 5.4].forEach((h, i) => this.tone(out, 'sine', f * h, f * h * 0.998, t, 3.5 - i * 0.5, 0.35 / (i + 1), 0.004));
  }

  /* ----------------------------------------------------------- blinkbug */

  chirp(pos: THREE.Vector3, pitch = 1, vol = 0.35) {
    if (!this.throttle('chirp', 60)) return;
    const out = this.out(pos, vol, 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const f = 1800 * pitch * rand(0.95, 1.08);
    this.tone(out, 'sine', f, f * 1.6, t, 0.06, 0.4);
    this.tone(out, 'sine', f * 1.3, f * 2.1, t + 0.07, 0.07, 0.3);
  }

  bugThrow(pos: THREE.Vector3) {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.18, 0.4, 'bandpass', 700, 2600, 1.5, 0.02);
    this.tone(out, 'sine', 1400, 2800, t + 0.02, 0.12, 0.3);
    this.tone(out, 'sine', 2000, 3400, t + 0.1, 0.08, 0.2);
  }

  bugBounce(pos: THREE.Vector3, strength: number) {
    const out = this.out(pos, Math.min(0.6, 0.15 + strength * 0.05), 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 500 + strength * 40, 200, t, 0.08, 0.4);
    this.tone(out, 'sine', 2200 + strength * 60, 3000, t + 0.01, 0.05, 0.2);
  }

  blink(pos: THREE.Vector3, isLocal: boolean) {
    const out = this.out(isLocal ? undefined : pos, isLocal ? 0.8 : 0.9, 70);
    if (!out) return;
    const t = this.ctx!.currentTime;
    // reverse-whoosh -> pop -> sparkle tail
    this.noise(out, t, 0.14, 0.6, 'bandpass', 400, 4200, 2.5, 0.1);
    this.tone(out, 'sine', 180, 1400, t, 0.12, 0.5, 0.08);
    this.tone(out, 'triangle', 1600, 300, t + 0.12, 0.22, 0.5);
    this.tone(out, 'sine', 70, 40, t + 0.12, 0.25, 0.7);
    for (let i = 0; i < 5; i++) this.tone(out, 'sine', rand(2500, 5000), rand(3000, 6000), t + 0.14 + i * 0.03, 0.08, 0.12);
  }

  blinkFail() {
    const out = this.out(undefined, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'square', 300, 180, t, 0.1, 0.2);
    this.tone(out, 'square', 260, 150, t + 0.12, 0.12, 0.2);
  }

  bugReady() {
    const out = this.out(undefined, 0.35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 1320, 1320, t, 0.1, 0.3);
    this.tone(out, 'sine', 1980, 1980, t + 0.09, 0.14, 0.3);
  }

  /* ----------------------------------------------------------- loot / ui */

  pickup(rarity: number) {
    const out = this.out(undefined, 0.5);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const base = [660, 740, 880, 990, 1175][rarity] ?? 660;
    const notes = rarity >= 3 ? [1, 1.25, 1.5, 2] : rarity >= 1 ? [1, 1.25, 1.5] : [1, 1.5];
    notes.forEach((m, i) => this.tone(out, 'triangle', base * m, base * m, t + i * 0.045, 0.16, 0.28));
    this.noise(out, t, 0.08, 0.2, 'highpass', 6000, 4000, 1);
  }

  ammoPickup() {
    const out = this.out(undefined, 0.35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) this.tone(out, 'square', rand(1800, 2400), 1500, t + i * 0.03, 0.03, 0.1);
  }

  uiTap() {
    const out = this.out(undefined, 0.25);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 900, 1100, t, 0.05, 0.3);
  }

  door(pos: THREE.Vector3, open: boolean) {
    const out = this.out(pos, 0.3, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    if (open) {
      this.tone(out, 'sawtooth', rand(250, 320), rand(380, 480), t, 0.25, 0.05, 0.05); // creak
      this.noise(out, t, 0.1, 0.15, 'bandpass', 800, 600, 3);
    } else {
      this.tone(out, 'sine', 110, 60, t, 0.12, 0.5);
      this.noise(out, t, 0.06, 0.3, 'lowpass', 1200, 300, 1);
    }
  }

  crateHum(pos: THREE.Vector3) {
    if (!this.throttle('hum', 900)) return;
    const out = this.out(pos, 0.25, 18);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 330, 330, t, 0.9, 0.2, 0.3);
    this.tone(out, 'sine', 495, 500, t, 0.9, 0.1, 0.3);
    this.tone(out, 'sine', 2600, 2800, t + 0.4, 0.2, 0.05);
  }

  elimination(pos: THREE.Vector3, isLocalKill: boolean) {
    const out = this.out(pos, 1, 90);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 600, 90, t, 0.35, 0.6);
    this.noise(out, t, 0.4, 0.6, 'bandpass', 3000, 400, 1);
    // confetti pops
    for (let i = 0; i < 6; i++) this.tone(out, 'triangle', rand(800, 2400), rand(1500, 3000), t + 0.05 + i * 0.04, 0.06, 0.2);
    if (isLocalKill) this.tone(out, 'triangle', 1568, 2093, t + 0.1, 0.3, 0.3);
  }

  pop(pos: THREE.Vector3) {
    const out = this.out(pos, 0.4, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 900, 200, t, 0.08, 0.5);
    this.noise(out, t, 0.05, 0.3, 'highpass', 3000, 2000, 1);
  }

  /* ----------------------------------------------------------- utilities */

  throwWhoosh(pos: THREE.Vector3) {
    const out = this.out(pos, 0.4, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.2, 0.35, 'bandpass', 600, 2400, 1.5, 0.03);
  }

  stick(pos: THREE.Vector3) {
    const out = this.out(pos, 0.5, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.12, 0.5, 'lowpass', 900, 300, 2, 0.005);
    this.tone(out, 'sine', 300, 120, t, 0.1, 0.4);
  }

  beep(pos: THREE.Vector3, urgency: number) {
    const out = this.out(pos, 0.45, 35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'square', 1500 + urgency * 900, 1500 + urgency * 900, t, 0.05, 0.18);
  }

  fizz(pos: THREE.Vector3) {
    const out = this.out(pos, 0.8, 50);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 600, 120, t, 0.12, 0.5);
    this.noise(out, t, 1.6, 0.5, 'highpass', 4000, 1500, 0.8, 0.05);
    for (let i = 0; i < 8; i++) this.tone(out, 'sine', rand(1200, 3000), rand(2000, 4000), t + 0.1 + i * 0.08, 0.05, 0.12);
  }

  splat(pos: THREE.Vector3) {
    const out = this.out(pos, 0.6, 35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.2, 0.6, 'lowpass', 1200, 200, 2);
    this.tone(out, 'sine', 180, 400, t, 0.2, 0.4);
  }

  boing(pos: THREE.Vector3) {
    const out = this.out(pos, 0.7, 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const o = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.25);
    const lfo = this.ctx!.createOscillator();
    lfo.frequency.value = 22;
    const lg = this.ctx!.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.5);
    lfo.stop(t + 0.5);
  }

  cluck(pos: THREE.Vector3, pitch = 1) {
    const out = this.out(pos, 0.45, 45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const n = Math.random() < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      this.tone(out, 'sawtooth', 700 * pitch, 450 * pitch, t + i * 0.09, 0.07, 0.18);
      this.noise(out, t + i * 0.09, 0.05, 0.2, 'bandpass', 1500, 1000, 3);
    }
  }

  gust(pos: THREE.Vector3) {
    const out = this.out(pos, 1, 60);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.7, 0.9, 'bandpass', 300, 2500, 1, 0.02);
    this.tone(out, 'sine', 90, 40, t, 0.3, 0.6);
    this.tone(out, 'sine', 900, 400, t, 0.1, 0.3); // cork pop
  }

  /** Pewpew turret bug: a tiny blaster */
  pew(pos: THREE.Vector3) {
    const out = this.out(pos, 0.4, 45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'square', rand(1700, 1900), 500, t, 0.07, 0.2);
  }

  /** Bug Jammer zapping a bug out of the air */
  jam(pos: THREE.Vector3) {
    const out = this.out(pos, 0.7, 55);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sawtooth', 220, 80, t, 0.3, 0.35);
    this.tone(out, 'square', 1600, 400, t, 0.12, 0.2);
    this.noise(out, t, 0.25, 0.5, 'bandpass', 4000, 1500, 1.5);
  }

  /** Bug Jammer humming while it works */
  jamHum(pos: THREE.Vector3) {
    const out = this.out(pos, 0.18, 25);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sawtooth', 110, 112, t, 0.5, 0.25);
  }

  /** Snap Trap closing */
  snap(pos: THREE.Vector3) {
    const out = this.out(pos, 0.9, 45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.06, 0.9, 'highpass', 2500, 1500, 1);
    this.tone(out, 'square', 900, 200, t, 0.08, 0.5);
    for (let i = 0; i < 3; i++) this.tone(out, 'triangle', rand(2000, 3200), 1500, t + 0.05 + i * 0.03, 0.04, 0.15);
  }

  /** streak banner sting: bigger streak, bigger chord */
  streak(tier: number) {
    const out = this.out(undefined, 0.6);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const notes = tier >= 3 ? [523, 659, 784, 1047, 1319] : tier === 2 ? [587, 740, 880, 1175] : [659, 880, 1047];
    notes.forEach((f, i) => {
      this.tone(out, 'square', f, f, t + i * 0.06, 0.16, 0.18);
      this.tone(out, 'triangle', f * 2, f * 2, t + i * 0.06, 0.22, 0.12);
    });
    this.noise(out, t, 0.25, 0.25, 'highpass', 6000, 3000, 0.7);
    if (tier >= 3) this.tone(out, 'sine', 110, 55, t, 0.5, 0.6);
  }

  /** a perk badge being pinned on */
  perk() {
    const out = this.out(undefined, 0.5);
    if (!out) return;
    const t = this.ctx!.currentTime;
    [660, 880, 1320].forEach((f, i) => this.tone(out, 'triangle', f, f, t + i * 0.07, 0.12, 0.3));
  }

  explosion(pos: THREE.Vector3) {
    const out = this.out(pos, 1.2, 140);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 90, 25, t, 0.8, 1);
    this.noise(out, t, 0.9, 1, 'lowpass', 3000, 100, 0.6, 0.004);
    this.noise(out, t, 0.15, 0.6, 'highpass', 2500, 1200, 0.8);
    for (let i = 0; i < 5; i++) this.tone(out, 'triangle', rand(700, 2000), rand(1500, 3000), t + 0.08 + i * 0.05, 0.08, 0.15); // confetti pops
  }

  /* ----------------------------------------------------------- healing */

  healUse(kind: 'eat' | 'drink', done: boolean) {
    const out = this.out(undefined, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    if (done) {
      [784, 988, 1175, 1568].forEach((f, i) => this.tone(out, 'sine', f, f, t + i * 0.06, 0.2, 0.25));
      return;
    }
    if (kind === 'drink') {
      this.noise(out, t, 0.12, 0.3, 'bandpass', 700, 400, 4, 0.02);
      this.tone(out, 'sine', 300, 500, t, 0.08, 0.2);
    } else {
      this.noise(out, t, 0.08, 0.45, 'bandpass', 2500, 1200, 1.5); // crunch
      this.noise(out, t + 0.09, 0.06, 0.3, 'bandpass', 2000, 900, 1.5);
    }
  }

  /* ----------------------------------------------------------- crates / fuse */

  crateShake(pos: THREE.Vector3) {
    const out = this.out(pos, 0.6, 35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 4; i++) this.tone(out, 'square', rand(200, 280), 150, t + i * 0.07, 0.05, 0.2);
    this.tone(out, 'sine', 400, 900, t, 0.35, 0.2, 0.2);
  }

  crateOpen(pos: THREE.Vector3) {
    const out = this.out(pos, 1, 60);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 120, 60, t, 0.3, 0.8);
    this.noise(out, t, 0.25, 0.7, 'lowpass', 3000, 400, 0.8);
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(out, 'triangle', f, f, t + 0.1 + i * 0.06, 0.3, 0.25));
    for (let i = 0; i < 6; i++) this.tone(out, 'sine', rand(2500, 5000), rand(3000, 6000), t + 0.3 + i * 0.04, 0.08, 0.1);
  }

  fuse() {
    const out = this.out(undefined, 0.8);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 200, 1600, t, 0.35, 0.4, 0.2);
    this.noise(out, t, 0.35, 0.4, 'bandpass', 500, 5000, 2, 0.3);
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(out, 'triangle', f, f, t + 0.35 + i * 0.07, 0.35, 0.3));
    this.tone(out, 'sine', 80, 40, t + 0.35, 0.4, 0.8);
  }

  thud(pos: THREE.Vector3, vol = 0.4) {
    if (!this.throttle('thud', 70)) return;
    const out = this.out(pos, vol, 30);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'triangle', rand(160, 240), 90, t, 0.1, 0.4);
  }

  /** brass on the floor */
  casing(pos: THREE.Vector3) {
    if (!this.throttle('casing', 45)) return;
    const out = this.out(pos, 0.18, 14);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const f = rand(3800, 5200);
    this.tone(out, 'triangle', f, f * 0.97, t, 0.05, 0.35);
    this.tone(out, 'sine', f * 1.5, f * 1.45, t + 0.06, 0.04, 0.15);
  }

  /** rolling thunder; farther strikes arrive later and duller */
  thunder(pos: THREE.Vector3) {
    if (!this.throttle('thunder', 900) || !this.ctx) return;
    const dist = pos.distanceTo(this.listenerPos);
    const out = this.out(undefined, Math.max(0.12, 0.55 - dist / 400));
    if (!out) return;
    const t = this.ctx.currentTime + Math.min(1.6, dist / 340);
    const bright = Math.max(300, 1400 - dist * 6);
    this.noise(out, t, 0.25, 0.7, 'lowpass', bright * 2, bright, 0.7);
    this.noise(out, t + 0.1, 1.8, 0.8, 'lowpass', bright, 90, 0.9, 0.08);
    this.tone(out, 'sine', 55, 32, t + 0.05, 1.4, 0.5, 0.1);
  }

  /** a flock bursting into the air */
  flap(pos: THREE.Vector3, n = 6) {
    if (!this.throttle('flap', 250)) return;
    const out = this.out(pos, 0.35, 40);
    if (!out) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < n; i++) this.noise(out, t + i * rand(0.03, 0.07), 0.07, 0.35, 'bandpass', rand(900, 1500), rand(500, 800), 1.5);
    this.tone(out, 'sine', rand(2400, 3000), rand(3200, 3800), t + 0.05, 0.08, 0.06);
    this.tone(out, 'sine', rand(2600, 3200), rand(3400, 4000), t + 0.16, 0.07, 0.05);
  }

  /** knocked-out rascal spinning away */
  koWhoosh(pos: THREE.Vector3) {
    const out = this.out(pos, 0.5, 50);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.45, 0.5, 'bandpass', 600, 2400, 2, 0.05);
    this.tone(out, 'triangle', 900, 300, t, 0.4, 0.2);
    // cartoon "boing-ding" stars
    this.tone(out, 'sine', 1760, 1760, t + 0.18, 0.12, 0.15);
    this.tone(out, 'sine', 2217, 2217, t + 0.26, 0.12, 0.12);
    this.tone(out, 'sine', 2637, 2637, t + 0.34, 0.2, 0.1);
  }

  /** victory! a little brass-ish fanfare built from stacked triangles */
  fanfare() {
    const out = this.out(undefined, 0.7);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const notes: [number, number, number][] = [[523, 0, 0.14], [659, 0.14, 0.14], [784, 0.28, 0.14], [1047, 0.42, 0.5], [784, 0.95, 0.12], [1047, 1.08, 0.8]];
    for (const [f, d, len] of notes) {
      this.tone(out, 'triangle', f, f, t + d, len, 0.28, 0.01);
      this.tone(out, 'sawtooth', f / 2, f / 2, t + d, len, 0.05, 0.01);
      this.tone(out, 'sine', f * 2, f * 2, t + d, len * 0.6, 0.06, 0.01);
    }
    this.tone(out, 'sine', 65, 45, t + 0.42, 0.6, 0.6);
    this.noise(out, t + 0.42, 0.5, 0.35, 'highpass', 5000, 8000, 0.7);
  }

  /** confetti cannon */
  cannon(pos?: THREE.Vector3) {
    const out = this.out(pos, 0.55, 60);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, 'sine', 180, 50, t, 0.18, 0.7);
    this.noise(out, t, 0.2, 0.6, 'lowpass', 4000, 600, 0.8);
    for (let i = 0; i < 5; i++) this.tone(out, 'triangle', rand(1800, 3200), rand(2400, 4000), t + 0.08 + i * 0.035, 0.05, 0.12);
  }

  /** knocked out: a sinking "wah-wah" */
  koSting() {
    const out = this.out(undefined, 0.45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    [392, 370, 349, 294].forEach((f, i) => this.tone(out, 'triangle', f, i === 3 ? f * 0.85 : f, t + i * 0.2, i === 3 ? 0.6 : 0.18, 0.22, 0.02));
  }
}

export const audio = new Audio();
