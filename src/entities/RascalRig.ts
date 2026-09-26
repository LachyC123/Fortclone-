import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PAL } from '../render/Palette';
import { clamp, damp, lerp, TAU } from '../core/math';
import { WeaponView } from '../combat/Weapons';
import { skinnedTube, bindTwoBone, finalizeBinds, deform, lathe, curveTube } from './Sculpt';
import { mergeToVertexColored } from '../render/Merge';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../render/Detail';

export type HatKind = 'beanie' | 'aviator' | 'pot' | 'hood' | 'leaf';

export interface RascalLook {
  skin: number;
  outfit: number;
  accent: number;
  pants: number;
  boots: number;
  pack: number;
  packAccent: number;
  scarf: number;
  hat: HatKind;
  hatColor: number;
  goggles: number;
  hair?: number;
}

export const LOOKS: RascalLook[] = [
  { skin: 0xffd3b0, outfit: PAL.terracotta, accent: PAL.mustard, pants: 0x4a5a8a, boots: PAL.brownDark, pack: 0xc9a06a, packAccent: PAL.brown, scarf: PAL.turquoise, hat: 'aviator', hatColor: 0x8a5a3b, goggles: 0x9fe8ff },
  { skin: 0xc68a5e, outfit: PAL.teal, accent: PAL.cream, pants: 0x6b4a3a, boots: 0x3b2a22, pack: PAL.mustard, packAccent: PAL.terracotta, scarf: PAL.pink, hat: 'beanie', hatColor: PAL.mustard, goggles: 0xffb86b },
  { skin: 0xf3c2a0, outfit: PAL.lavender, accent: PAL.pink, pants: 0x3a4a5a, boots: 0x2b2238, pack: 0x7fb7e6, packAccent: 0x3a5a8a, scarf: PAL.mustard, hat: 'pot', hatColor: 0x9aa4b0, goggles: 0xb6ff9a },
  { skin: 0x8d5a3c, outfit: 0x7cc35a, accent: PAL.cream, pants: 0x5e3b27, boots: 0x3b2a22, pack: 0xd9774f, packAccent: 0x8a5a3b, scarf: PAL.lavender, hat: 'leaf', hatColor: 0x5aa347, goggles: 0xfff08a },
  { skin: 0xffe0c8, outfit: 0xf2c14e, accent: PAL.teal, pants: 0x2f3a4a, boots: 0x6b3a2a, pack: 0x3fc6c0, packAccent: 0x2a7a70, scarf: PAL.terracotta, hat: 'hood', hatColor: 0xf28fad, goggles: 0x9fe8ff },
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);

function mat(hex: number, rough = 0.62, emissive = 0x000000) {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0, emissive });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
        gl_FragColor.rgb += pow(rim, 3.0) * vec3(1.0, 0.95, 0.85) * 0.3;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'toy-rim-v1';
  return m;
}

function rbox(w: number, h: number, d: number, r: number) {
  return G.rbox(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}
function capsule(r: number, len: number) {
  const g = G.capsule(r, len, 4, 10);
  g.translate(0, -len / 2 - r * 0.3, 0);
  return g;
}

export interface AnimInput {
  dt: number;
  time: number;
  speed: number; // horizontal m/s
  vy: number;
  grounded: boolean;
  sliding: boolean;
  crouching: boolean;
  sprinting: boolean;
  mantling: boolean;
  aimPitch: number;
  turnRate: number; // rad/s of body yaw
  localVelX: number; // strafe (right +)
  localVelZ: number; // forward +
  armed: boolean;
  ads: boolean;
  reloadK: number; // -1 none, else 0..1
  healing: boolean;
  diving?: boolean;
  gliding?: boolean;
  onBarge?: boolean;
  /** an emote in progress */
  emote?: EmoteKind | null;
}

export type EmoteKind = 'dance' | 'wave' | 'laugh' | 'flex';

/**
 * Procedurally animated "toy" character. No skeleton assets: a hierarchy of chunky rounded parts
 * animated with springs, sine gaits and two-bone IK. This gives us full control over squash &
 * stretch and secondary motion, and costs next to nothing.
 */
export class RascalRig {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  kneeL = new THREE.Group();
  kneeR = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  elbowL = new THREE.Group();
  elbowR = new THREE.Group();
  handL = new THREE.Object3D();
  handR = new THREE.Object3D();
  pack = new THREE.Group();
  bugDock = new THREE.Object3D();
  weaponMount = new THREE.Group();
  scarfTail1 = new THREE.Group();
  scarfTail2 = new THREE.Group();
  hat = new THREE.Group();
  eyeL!: THREE.Object3D;
  eyeR!: THREE.Object3D;
  browL!: THREE.Object3D;
  browR!: THREE.Object3D;
  mouth!: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  materials: THREE.MeshStandardMaterial[] = [];
  private gogMat: THREE.MeshStandardMaterial | null = null;
  weapon: WeaponView | null = null;

  // animation state
  private phase = 0;
  private squash = 0;
  private squashV = 0;
  private lean = 0;
  private roll = 0;
  private packSwingX = 0;
  private packSwingXV = 0;
  private packSwingZ = 0;
  private packSwingZV = 0;
  private scarfA = 0;
  private scarfAV = 0;
  private hatA = 0;
  private hatAV = 0;
  private prevSpeed = 0;
  private blinkT = 2;
  private lookT = 0;
  private lookYaw = 0;
  private lookTarget = 0;
  private recoil = 0;
  private recoilV = 0;
  private hitT = 0;
  private hitDirX = 0;
  private hitDirZ = 0;
  private flashT = 0;
  private throwT = -1;
  private crouchK = 0;
  private slideK = 0;
  private airK = 0;
  private equipT = 0;
  private stretchOverride = 0;
  private idleT = 0;
  private headYaw = 0;
  expression: 'normal' | 'hurt' | 'wide' | 'happy' = 'normal';
  private exprT = 0;

  constructor(public look: RascalLook) {
    this.bodyMat = mat(0xffffff, 0.65);
    this.bodyMat.vertexColors = true;
    this.materials.push(this.bodyMat);
    this.build();
  }

  private m(hex: number, rough = 0.62) {
    const mm = mat(hex, rough);
    this.materials.push(mm);
    return mm;
  }

  private build() {
    const L = this.look;
    const hairCol = L.hair ?? shadeHex(L.skin < 0xa00000 ? 0x2b1d18 : 0x6b3a22, 1);
    const pantsCuff = shadeHex(L.pants, 1.25);
    const body = this.bodyMat;
    const skin = this.m(L.skin, 0.55);
    const outfit = this.m(L.outfit);
    const accent = this.m(L.accent);
    const boots = this.m(L.boots, 0.7);
    const pack = this.m(L.pack, 0.75);
    const packA = this.m(L.packAccent, 0.75);
    const scarf = this.m(L.scarf, 0.85);
    const ink = this.m(0x1d1726, 0.3);
    const white = this.m(0xffffff, 0.25);
    const sclera = this.m(0xfffdf6, 0.3);
    const blush = this.m(0xff9a9a, 0.9);
    const hatM = this.m(L.hatColor, 0.7);
    const hairM = this.m(hairCol, 0.8);
    const glove = this.m(0xf4e7c8, 0.8);
    const gog = this.m(L.goggles, 0.15);
    gog.emissive.setHex(L.goggles);
    gog.emissiveIntensity = 0.25;
    this.gogMat = gog;
    const metal = this.m(0xb8c0c8, 0.35);
    metal.metalness = 0.4;

    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, mm: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(g, mm);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const binds: { mesh: THREE.SkinnedMesh; bones: THREE.Object3D[] }[] = [];

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.56;
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);

    // ---------------- one-piece body: neck -> chest -> waist -> hips, skinned to torso+hips
    const bodyR = curveFn([[0, 0.07], [0.05, 0.1], [0.11, 0.19], [0.19, 0.235], [0.31, 0.24], [0.43, 0.215], [0.5, 0.228], [0.6, 0.232], [0.69, 0.2], [0.75, 0.13], [0.78, 0.04]]);
    const bodyGeo = skinnedTube({
      length: 0.78,
      joint: 0.48,
      blend: 0.14,
      radius: bodyR,
      flatten: 0.8,
      radial: 22,
      rings: 30,
      colorAt: (d) => (d < 0.07 ? L.skin : d < 0.455 ? L.outfit : d < 0.515 ? PAL.brown : L.pants),
    });
    binds.push(bindTwoBone(bodyGeo, body, this.hips, new THREE.Vector3(0, 0.62, 0), this.torso, this.hips));
    // shirt hem & collar details that ride on the torso
    add(this.torso, softSphere(0.13, 0.95, 0.75, 0.35), accent, 0, 0.24, -0.17, 0.12); // chest patch
    add(this.torso, softSphere(0.035, 1, 1, 0.6), accent, 0, 0.33, -0.19); // buttons
    add(this.torso, softSphere(0.035, 1, 1, 0.6), accent, 0, 0.19, -0.2);
    add(this.hips, softSphere(0.075, 1, 0.9, 0.7), this.m(PAL.brownDark, 0.7), 0.17, 0.06, -0.14, 0, 0.4); // pouch
    add(this.hips, softSphere(0.05, 1, 0.85, 0.45), metal, 0, 0.09, -0.185); // buckle

    // ---------------- legs: skinned tubes, baggy trousers with rolled cuffs, socks
    for (const [leg, knee, sx] of [
      [this.legL, this.kneeL, -1],
      [this.legR, this.kneeR, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      leg.position.set(sx * 0.11, -0.06, 0);
      this.hips.add(leg);
      knee.position.set(0, -0.25, 0);
      leg.add(knee);
      const lg = skinnedTube({
        length: 0.43,
        joint: 0.25,
        blend: 0.07,
        radius: curveFn([[0, 0.1], [0.12, 0.098], [0.24, 0.088], [0.31, 0.098], [0.345, 0.104], [0.37, 0.1], [0.385, 0.062], [0.43, 0.058]]),
        colorAt: (d) => (d < 0.335 ? L.pants : d < 0.38 ? pantsCuff : L.accent),
      });
      binds.push(bindTwoBone(lg, body, this.hips, leg.position, leg, knee));
      // sculpted boot: bulbous toe, flat sole, fold-over cuff
      const boot = deform(G.sphere(0.1, 20, 14), (v) => {
        v.z *= v.z < 0 ? 1.55 : 1.05;
        v.x *= 0.95 + (v.z < 0 ? -v.z * 0.6 : 0);
        v.y *= 0.8;
        if (v.y < -0.045) v.y = -0.045 - (v.y + 0.045) * 0.15;
        if (v.z < -0.05) v.y += (-v.z - 0.05) * 0.25; // upturned toe
      });
      add(knee, boot, boots, 0, -0.215, -0.04);
      add(knee, deform(G.cylinder(0.1, 0.1, 0.03, 20), (v) => (v.z *= v.z < 0 ? 1.55 : 1.05)), ink, 0, -0.265, -0.04);
      add(knee, G.torus(0.068, 0.028, 8, 18), this.m(shadeHex(L.boots, 1.35), 0.8), 0, -0.155, 0, Math.PI / 2);
    }

    // ---------------- arms: skinned sleeves -> cuffs -> forearms, with mitten hands
    for (const [arm, elbow, hand, sx] of [
      [this.armL, this.elbowL, this.handL, -1],
      [this.armR, this.elbowR, this.handR, 1],
    ] as [THREE.Group, THREE.Group, THREE.Object3D, number][]) {
      arm.position.set(sx * 0.255, 0.34, 0);
      this.torso.add(arm);
      elbow.position.set(0, -0.2, 0);
      arm.add(elbow);
      hand.position.set(0, -0.2, 0);
      elbow.add(hand);
      const ag = skinnedTube({
        length: 0.37,
        joint: 0.2,
        blend: 0.06,
        radius: curveFn([[0, 0.09], [0.06, 0.084], [0.17, 0.07], [0.22, 0.072], [0.245, 0.084], [0.27, 0.086], [0.285, 0.056], [0.37, 0.05]]),
        colorAt: (d) => (d < 0.235 ? L.outfit : d < 0.28 ? L.accent : L.skin),
      });
      binds.push(bindTwoBone(ag, body, this.torso, arm.position, arm, elbow));
      // mitten with a thumb
      const mit = deform(G.sphere(0.075, 16, 12), (v) => {
        v.y *= 1.2;
        v.z *= 0.85;
        if (v.y < 0) v.x *= 1 + -v.y * 1.2;
      });
      add(hand, mit, glove, 0, -0.035, 0);
      add(hand, G.capsule(0.028, 0.045, 4, 8), glove, -sx * 0.055, -0.01, -0.035, 0.5, 0, -sx * 0.7);
    }

    // ---------------- scarf: soft wrap with a knot and two fluttering tails
    const wrap = deform(G.torus(0.155, 0.06, 10, 28), (v) => {
      v.z += Math.sin(Math.atan2(v.y, v.x) * 3) * 0.008;
    });
    add(this.torso, wrap, scarf, 0, 0.47, 0.01, Math.PI / 2 - 0.12);
    add(this.torso, softSphere(0.06, 1.2, 0.9, 0.9), scarf, 0.09, 0.44, 0.13);
    this.scarfTail1.position.set(0.1, 0.43, 0.15);
    this.torso.add(this.scarfTail1);
    add(this.scarfTail1, taperedRibbon(0.1, 0.2, 0.035), scarf, 0, -0.1, 0);
    this.scarfTail2.position.set(0, -0.19, 0);
    this.scarfTail1.add(this.scarfTail2);
    add(this.scarfTail2, taperedRibbon(0.09, 0.17, 0.03), scarf, 0, -0.085, 0);
    add(this.scarfTail2, taperedRibbon(0.09, 0.03, 0.034), this.m(0xffffff, 0.8), 0, -0.165, 0);

    // ---------------- backpack: pillowy, strapped over the shoulders
    this.pack.position.set(0, 0.22, 0.2);
    this.torso.add(this.pack);
    const puff = (w: number, h: number, d: number, r: number, amt: number) =>
      deform(G.rbox(w, h, d, 4, r), (v) => {
        const k = 1 - Math.max(Math.abs(v.x) / (w / 2), Math.abs(v.y) / (h / 2), Math.abs(v.z) / (d / 2));
        const f = 1 + amt * Math.sqrt(Math.max(0, k));
        v.x *= f;
        v.z *= 1 + amt * 1.4 * Math.sqrt(Math.max(0, k));
      });
    add(this.pack, puff(0.44, 0.5, 0.24, 0.1, 0.08), pack, 0, 0.02, 0.1);
    add(this.pack, puff(0.3, 0.19, 0.08, 0.05, 0.12), packA, 0, -0.08, 0.25); // front pocket
    add(this.pack, puff(0.36, 0.14, 0.22, 0.06, 0.06), packA, 0, 0.24, 0.1, -0.12); // flap
    add(this.pack, softSphere(0.03, 1, 1.4, 0.6), metal, 0, 0.17, 0.215); // clasp
    add(this.pack, G.capsule(0.075, 0.4, 6, 12), this.m(PAL.terracottaDark, 0.85), 0, -0.26, 0.12, 0, 0, Math.PI / 2); // bedroll
    for (const bx of [-0.12, 0.12]) add(this.pack, G.torus(0.078, 0.012, 6, 14), packA, bx, -0.26, 0.12, 0, Math.PI / 2);
    add(this.pack, G.capsule(0.035, 0.1, 4, 8), this.m(0x9fdcf0, 0.25), 0.25, 0.04, 0.1); // bottle
    add(this.pack, softSphere(0.04, 1, 1, 1), this.m(PAL.pink, 0.6), -0.25, 0.14, 0.15); // charm
    for (const bx of [-1, 1]) {
      const strap = curveTube([new THREE.Vector3(bx * 0.12, 0.12, -0.19), new THREE.Vector3(bx * 0.14, 0.32, -0.2), new THREE.Vector3(bx * 0.15, 0.47, -0.06), new THREE.Vector3(bx * 0.14, 0.46, 0.14), new THREE.Vector3(bx * 0.12, 0.38, 0.22)], 0.022, 6, 16);
      add(this.torso, strap, packA);
    }
    this.bugDock.position.set(-0.2, 0.34, 0.12);
    this.pack.add(this.bugDock);

    // ---------------- head: soft egg with chubby cheeks
    this.head.position.y = 0.47;
    this.torso.add(this.head);
    const headGeo = deform(G.sphere(0.27, 36, 28), (v) => {
      v.y *= 0.93;
      const low = Math.max(0, Math.min(1, (0.05 - v.y) / 0.25));
      v.x *= 1 + 0.09 * low; // cheeks
      if (v.z < 0) v.z *= 1 + 0.06 * low;
      if (v.z > 0) v.z *= 0.95; // flatter back of head
    });
    add(this.head, headGeo, skin, 0, 0.2, 0);
    // eyes: glossy ovals that blink / widen / squint
    const mkEye = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.225, -0.232);
      g.rotation.y = -x * 1.6;
      this.head.add(g);
      const w = add(g, G.sphere(0.052, 16, 12), sclera);
      w.scale.set(0.85, 1.12, 0.5);
      const pu = add(g, G.sphere(0.036, 14, 10), ink, 0, -0.004, -0.018);
      pu.scale.set(0.85, 1.12, 0.55);
      add(g, G.sphere(0.011, 8, 6), white, 0.012, 0.018, -0.04);
      add(g, G.sphere(0.006, 6, 4), white, -0.01, -0.016, -0.038);
      return g;
    };
    this.eyeL = mkEye(-0.092);
    this.eyeR = mkEye(0.092);
    // brows (move with expression)
    const mkBrow = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.3, -0.238);
      g.rotation.y = -x * 1.5;
      this.head.add(g);
      add(g, curveTube([new THREE.Vector3(-0.035, -0.006, 0), new THREE.Vector3(0, 0.006, -0.006), new THREE.Vector3(0.035, -0.004, 0)], 0.011, 6, 8), hairM);
      return g;
    };
    this.browL = mkBrow(-0.095);
    this.browR = mkBrow(0.095);
    add(this.head, softSphere(0.05, 1, 0.55, 0.35), blush, -0.165, 0.14, -0.2, 0, 0.55);
    add(this.head, softSphere(0.05, 1, 0.55, 0.35), blush, 0.165, 0.14, -0.2, 0, -0.55);
    add(this.head, softSphere(0.038, 1.1, 0.9, 0.8), this.m(shadeHex(L.skin, 0.93), 0.5), 0, 0.165, -0.262); // button nose
    this.mouth = add(this.head, G.torus(0.036, 0.011, 6, 14, Math.PI), ink, 0, 0.1, -0.252, 0.15, 0, Math.PI);
    add(this.head, softSphere(0.055, 0.55, 1, 0.8), skin, -0.268, 0.19, 0.01); // ears
    add(this.head, softSphere(0.055, 0.55, 1, 0.8), skin, 0.268, 0.19, 0.01);
    // hair tufts peeking out under the hat
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) / 2;
      const tuft = deform(G.cone(0.045, 0.12, 8), (v) => {
        v.z += (v.y + 0.06) * (v.y + 0.06) * 2.2; // curl
      });
      add(this.head, tuft, hairM, t * 0.12, 0.34 - Math.abs(t) * 0.03, -0.215 + Math.abs(t) * 0.04, Math.PI - 0.5, t * 0.3, t * 0.4);
    }
    for (const sx of [-1, 1]) add(this.head, deform(G.cone(0.05, 0.16, 8), (v) => (v.x += (v.y + 0.08) ** 2 * sx * -2)), hairM, sx * 0.235, 0.2, -0.06, Math.PI, 0, sx * 0.25);

    // ---------------- hats
    this.hat.position.set(0, 0.24, 0.02);
    this.hat.rotation.x = 0.32; // tipped back so the eyes and brows always read
    this.head.add(this.hat);
    switch (L.hat) {
      case 'beanie': {
        add(this.hat, lathe([[0.001, 0.33], [0.12, 0.31], [0.24, 0.22], [0.29, 0.1], [0.3, 0.04]], 28), hatM, 0, 0, 0.01);
        add(this.hat, G.torus(0.29, 0.05, 10, 28), this.m(shadeHex(L.hatColor, 0.82), 0.85), 0, 0.05, 0.01, Math.PI / 2);
        add(this.hat, deform(G.ico(0.085, 2), (v) => v.multiplyScalar(1 + Math.sin(v.x * 90) * 0.06)), this.m(0xffffff, 0.95), 0, 0.37, 0.02);
        break;
      }
      case 'aviator': {
        add(this.hat, lathe([[0.001, 0.31], [0.14, 0.29], [0.25, 0.2], [0.3, 0.08], [0.305, 0.0]], 28), hatM, 0, 0, 0.02);
        for (const sx of [-1, 1]) add(this.hat, deform(G.sphere(0.1, 14, 10), (v) => ((v.x *= 0.45), (v.y *= 1.35))), hatM, sx * 0.285, -0.12, 0.06, -0.3, 0, sx * 0.2);
        add(this.hat, G.torus(0.3, 0.03, 6, 30), this.m(0xf4e7c8, 0.9), 0, 0.0, 0.02, Math.PI / 2); // fleece rim
        break;
      }
      case 'pot': {
        add(this.hat, lathe([[0.001, 0.26], [0.24, 0.255], [0.27, 0.2], [0.29, 0.06], [0.35, 0.05], [0.35, 0.03], [0.28, 0.03]], 26), hatM, 0, 0, 0);
        add(this.hat, G.capsule(0.025, 0.2, 4, 8), this.m(0x6b7380, 0.4), 0.42, 0.1, 0, 0, 0, Math.PI / 2 + 0.2);
        add(this.hat, softSphere(0.028, 1, 1, 1), metal, 0, 0.27, 0);
        break;
      }
      case 'hood': {
        add(this.hat, lathe([[0.001, 0.34], [0.16, 0.31], [0.28, 0.2], [0.315, 0.05], [0.3, -0.12]], 28, 28, 1.05), hatM, 0, -0.01, 0.04);
        for (const sx of [-1, 1]) add(this.hat, deform(G.cone(0.09, 0.18, 12), (v) => (v.z *= 0.55)), hatM, sx * 0.17, 0.3, 0.03, 0, 0, -sx * 0.45);
        for (const sx of [-1, 1]) add(this.hat, deform(G.cone(0.05, 0.1, 10), (v) => (v.z *= 0.4)), this.m(0xffc2d6, 0.8), sx * 0.165, 0.29, 0.005, 0, 0, -sx * 0.45);
        break;
      }
      case 'leaf': {
        add(this.hat, lathe([[0.001, 0.3], [0.2, 0.26], [0.29, 0.12], [0.3, 0.05]], 26), this.m(PAL.brown, 0.75), 0, 0, 0.01);
        const leaf = add(this.hat, deform(G.sphere(0.16, 14, 8), (v) => ((v.x *= 0.45), (v.y *= 0.1), (v.z *= 1.4), (v.y += v.z * v.z * 2))), hatM, 0.06, 0.34, 0.05, 0.3, 0, -0.4);
        leaf.castShadow = true;
        add(this.hat, G.capsule(0.014, 0.1, 3, 6), this.m(PAL.brownDark, 0.7), 0, 0.33, 0);
        break;
      }
    }
    if (L.hat !== 'pot') {
      const gy = L.hat === 'hood' ? 0.1 : 0.1;
      add(this.hat, G.torus(0.298, 0.022, 6, 30), this.m(0x3b2a22, 0.8), 0, gy - 0.02, 0.01, Math.PI / 2 + 0.3);
      for (const sx of [-1, 1]) {
        add(this.hat, G.torus(0.058, 0.02, 8, 18), metal, sx * 0.09, gy + 0.04, -0.262, -0.55);
        add(this.hat, deform(G.sphere(0.056, 14, 10), (v) => (v.z *= 0.45)), gog, sx * 0.09, gy + 0.04, -0.262, -0.55);
      }
    }

    this.torso.add(this.weaponMount);
    this.weaponMount.position.set(0.1, 0.2, -0.3);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false;
    });
    finalizeBinds(this.root, binds);
    this.mouth.userData.keep = true;
    // far LOD: the whole rascal baked into one mesh at rest pose (1 draw call)
    this.root.updateMatrixWorld(true);
    this.lodMesh = mergeToVertexColored(this.body);
    this.lodMesh.castShadow = false;
    this.lodMesh.visible = false;
    this.root.add(this.lodMesh);
    this.mergeStatic(this.root);
    for (const b of binds) {
      // skinned meshes: generous bounds so they can be frustum culled like everything else
      b.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.3, 0), 1.2);
      b.mesh.frustumCulled = true;
    }
  }

  lodMesh!: THREE.Mesh;
  private flatMat: THREE.MeshStandardMaterial | null = null;
  lod = false;

  private ghost = 1;
  /** Fade the whole rascal (Wisp shimmer). 1 = solid. */
  setGhost(k: number) {
    if (Math.abs(k - this.ghost) < 0.01) return;
    this.ghost = k;
    const solid = k >= 0.999;
    for (const m of this.materials) {
      m.transparent = !solid;
      m.opacity = k;
      m.depthWrite = solid;
    }
  }

  /** Switch between the full animated rig and the single-mesh stand-in. */
  setLod(far: boolean) {
    if (far === this.lod) return;
    this.lod = far;
    this.body.visible = !far;
    this.lodMesh.visible = far;
  }

  setShadows(on: boolean) {
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.noShadow) (o as THREE.Mesh).castShadow = on;
    });
  }

  /**
   * Merge each node's static child meshes into one vertex-coloured mesh. Animation lives on the
   * groups, so nothing visible changes — but a rascal drops from ~45 draw calls to ~20.
   */
  private mergeStatic(node: THREE.Object3D) {
    for (const c of [...node.children]) if (!(c as THREE.Mesh).isMesh) this.mergeStatic(c);
    const meshes = node.children.filter((c) => {
      const m = c as THREE.Mesh;
      return m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !m.userData.keep && m !== this.lodMesh && !Array.isArray(m.material) && (m.material as THREE.Material).blending !== THREE.AdditiveBlending;
    }) as THREE.Mesh[];
    if (meshes.length < 2) return;
    if (!this.flatMat) {
      this.flatMat = mat(0xffffff, 0.62);
      this.flatMat.vertexColors = true;
      this.materials.push(this.flatMat);
    }
    const parts: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.applyMatrix4(m.matrix);
      const mm = m.material as THREE.MeshStandardMaterial;
      const c = mm.color.clone();
      if (mm.emissiveIntensity > 0 && mm.emissive.getHex() !== 0) c.lerp(mm.emissive, 0.3).multiplyScalar(1.3);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
      node.remove(m);
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, this.flatMat);
    mesh.castShadow = true;
    node.add(mesh);
  }

  private held: THREE.Object3D | null = null;
  private healK = 0;
  private diveK = 0;
  private glideK = 0;
  private emoteK = 0;
  private emoteKind: EmoteKind = 'wave';
  /** Put a consumable in the left hand (eating/drinking animation). */
  setHeld(obj: THREE.Object3D | null) {
    if (this.held) this.handL.remove(this.held);
    this.held = obj;
    if (obj) {
      obj.scale.setScalar(0.9);
      obj.position.set(0, -0.08, -0.04);
      obj.rotation.set(Math.PI, 0, 0);
      obj.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.handL.add(obj);
    }
  }

  setWeapon(view: WeaponView | null) {
    if (this.weapon) this.weaponMount.remove(this.weapon.group);
    this.weapon = view;
    if (view) {
      this.weaponMount.add(view.group);
      this.equipT = 1;
    }
  }

  /* ------------------------------------------------------------ triggers */

  onLand(impact: number) {
    this.squashV -= Math.min(9, impact * 0.55);
  }
  onJump() {
    this.squashV += 6;
  }
  onFire(kick: number) {
    this.recoilV += kick * 22;
  }
  onHit(dirX: number, dirZ: number) {
    this.hitT = 1;
    this.hitDirX = dirX;
    this.hitDirZ = dirZ;
    this.flashT = 0.1;
    this.setExpression('hurt', 0.4);
  }
  onThrow() {
    this.throwT = 0;
    this.squashV += 2.5;
  }
  onBlinkArrive() {
    this.stretchOverride = 1;
    this.squashV += 7;
    this.setExpression('wide', 0.6);
  }
  setExpression(e: RascalRig['expression'], dur: number) {
    this.expression = e;
    this.exprT = dur;
  }

  /* ------------------------------------------------------------ update */

  update(a: AnimInput) {
    const dt = a.dt;
    const t = a.time;
    const speed = a.speed;

    // --- state blends
    this.crouchK = damp(this.crouchK, a.crouching ? 1 : 0, 14, dt);
    this.slideK = damp(this.slideK, a.sliding ? 1 : 0, 16, dt);
    this.airK = damp(this.airK, !a.grounded && !a.mantling ? 1 : 0, 12, dt);
    const runK = clamp(speed / 5.3, 0, 1.4) * (1 - this.slideK);

    // --- gait phase advances with distance travelled
    const stride = a.sprinting ? 1.25 : 1.0;
    if (a.grounded && !a.sliding) this.phase += (speed / stride) * Math.PI * dt;
    else if (!a.grounded) this.phase += dt * 3;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    // --- squash & stretch spring
    const accel = (speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = speed;
    this.squashV += (-this.squash * 190 - this.squashV * 13) * dt;
    this.squash += this.squashV * dt;
    if (!a.grounded) this.squash = lerp(this.squash, clamp(a.vy * 0.02, -0.12, 0.12), 1 - Math.exp(-10 * dt));
    this.stretchOverride = Math.max(0, this.stretchOverride - dt * 3);
    const sq = clamp(this.squash, -0.35, 0.35) + this.stretchOverride * 0.25;
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    // --- body bob, lean
    const bob = a.grounded && !a.sliding ? Math.abs(s) * 0.07 * runK - 0.02 * runK : 0;
    const crouchDrop = this.crouchK * 0.2 + this.slideK * 0.3;
    this.hips.position.y = 0.56 + bob - crouchDrop;
    this.hips.position.x = 0;
    const leanTarget = a.sliding ? -0.35 : clamp(a.localVelZ * 0.035 + accel * 0.004, -0.2, 0.3) + (a.sprinting ? 0.08 : 0);
    this.lean = damp(this.lean, leanTarget, 8, dt);
    this.roll = damp(this.roll, clamp(-a.turnRate * 0.06 * clamp(speed / 5, 0, 1) - a.localVelX * 0.02, -0.3, 0.3), 8, dt);
    this.body.rotation.set(0, 0, 0);
    this.hips.rotation.set(-this.lean * 0.5, a.grounded ? s * 0.12 * runK : 0, this.roll);

    // hit reaction
    this.hitT = Math.max(0, this.hitT - dt * 5);
    const hk = this.hitT * this.hitT;

    // torso: aim pitch + counter-rotation of hips + hit jolt + idle breathing
    const breath = Math.sin(t * 2.2) * 0.012 * (1 - runK);
    const aimP = a.armed ? clamp(a.aimPitch, -1.1, 1.1) * 0.55 : clamp(a.aimPitch, -1, 1) * 0.2;
    this.torso.rotation.set(-this.lean * 0.6 + aimP + hk * this.hitDirZ * 0.35 + (a.sliding ? 0.3 : 0), a.grounded ? -s * 0.2 * runK : 0, -hk * this.hitDirX * 0.3);
    this.torso.scale.set(1 + breath, 1 - breath, 1 + breath);

    // --- legs
    const legAmp = 0.85 * Math.min(1, runK);
    // (rotation.x > 0 swings a limb forward; knees bend with negative x)
    // Poses are BLENDED (ground / air / slide) so transitions flow instead of snapping.
    const wSlide = this.slideK, wAir = this.airK * (1 - wSlide), wGround = Math.max(0, 1 - wSlide - wAir);
    const cr = this.crouchK;
    const kick = Math.sin(t * 9) * 0.25;
    const gLx = s * legAmp + cr * 0.9, gRx = -s * legAmp + cr * 0.9;
    // knees bend most as the foot swings through (passing pose), a touch always so legs never lock
    const gKL = -Math.max(0, -c) * 1.35 * legAmp - cr * 1.6 - 0.08 * Math.min(1, runK);
    const gKR = -Math.max(0, c) * 1.35 * legAmp - cr * 1.6 - 0.08 * Math.min(1, runK);
    this.legL.rotation.set(wGround * gLx + wAir * (0.6 + kick) + wSlide * 1.35, 0, -0.03 - wAir * 0.1 - wSlide * 0.08);
    this.legR.rotation.set(wGround * gRx + wAir * (-0.1 - kick) + wSlide * 0.5, 0, 0.03 + wAir * 0.1 + wSlide * 0.14);
    this.kneeL.rotation.set(wGround * gKL + wAir * -1.1 + wSlide * -0.15, 0, 0);
    this.kneeR.rotation.set(wGround * gKR + wAir * -0.7 + wSlide * -1.5, 0, 0);

    // --- head: counter-lean, look around when idle
    this.idleT = speed < 0.3 && !a.armed ? this.idleT + dt : 0;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.5 + Math.random() * 3;
      this.lookTarget = this.idleT > 1.5 ? (Math.random() - 0.5) * 1.6 : 0;
    }
    this.lookYaw = damp(this.lookYaw, this.lookTarget, 4, dt);
    this.headYaw = damp(this.headYaw, clamp(-a.turnRate * 0.08, -0.5, 0.5), 6, dt);
    this.head.rotation.set(-aimP * 0.4 + this.lean * 0.4 + (a.aimPitch * 0.25), this.lookYaw + this.headYaw, -this.roll * 0.5);

    // blinking eyes + expressions
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    this.exprT -= dt;
    if (this.exprT <= 0) this.expression = 'normal';
    let eyeY = this.blinkT < 0 ? 0.15 : 1;
    let eyeX = 1;
    if (this.expression === 'hurt') {
      eyeY = 0.25;
      eyeX = 1.3;
    } else if (this.expression === 'wide') {
      eyeY = 1.35;
      eyeX = 1.3;
    } else if (this.expression === 'happy') eyeY = 0.4;
    this.eyeL.scale.set(eyeX, eyeY, 1);
    this.eyeR.scale.set(eyeX, eyeY, 1);
    // brows & mouth sell the emotion
    const browLift = this.expression === 'wide' ? 0.035 : this.expression === 'hurt' ? -0.012 : 0;
    const browTilt = this.expression === 'hurt' ? 0.35 : this.expression === 'wide' ? -0.15 : a.armed && a.ads ? 0.22 : 0;
    this.browL.position.y = damp(this.browL.position.y, 0.3 + browLift, 18, dt);
    this.browR.position.y = this.browL.position.y;
    this.browL.rotation.z = damp(this.browL.rotation.z, -browTilt, 18, dt);
    this.browR.rotation.z = -this.browL.rotation.z;
    const mouthO = this.expression === 'hurt' || this.expression === 'wide';
    this.mouth.scale.set(mouthO ? 0.7 : 1, mouthO ? -1.3 : 1, 1);

    // --- arms
    this.recoilV += (-this.recoil * 300 - this.recoilV * 22) * dt;
    this.recoil += this.recoilV * dt;
    this.equipT = Math.max(0, this.equipT - dt * 3.5);
    if (this.throwT >= 0) this.throwT += dt / 0.32;
    if (this.throwT > 1) this.throwT = -1;

    if (a.armed && this.weapon) {
      const w = this.weapon.group;
      const reload = a.reloadK;
      const rl = reload >= 0 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
      w.position.set(0, -this.equipT * 0.25 - rl * 0.08, this.recoil * 0.12 + this.equipT * 0.1);
      w.rotation.set(this.recoil * 0.25 + rl * 0.5 - this.equipT * 0.8 + (a.sprinting && !a.ads ? -0.5 : 0), a.sprinting && !a.ads ? 0.5 : 0, rl * 0.6);
      this.weaponMount.position.set(a.ads ? 0.02 : 0.12, 0.2, -0.28);
      // reload: left hand goes to the mag and back
      this.solveArmToWeapon(this.armR, this.elbowR, this.weapon.gripR, 1);
      if (reload >= 0) {
        const k = Math.sin(clamp(reload, 0, 1) * Math.PI);
        _v.copy(this.weapon.gripL).lerp(new THREE.Vector3(0, -0.25, -0.1), k);
        this.solveArmToWeapon(this.armL, this.elbowL, _v, -1);
        this.weapon.mag.position.y = -0.12 - k * 0.15;
        this.weapon.mag.rotation.x = k * 1.2;
      } else if (this.throwT >= 0) {
        this.throwArm(this.armL, this.elbowL, this.throwT, -1);
      } else {
        this.solveArmToWeapon(this.armL, this.elbowL, this.weapon.gripL, -1);
        this.weapon.mag.position.y = -0.12;
        this.weapon.mag.rotation.x = 0;
      }
    } else {
      // natural arm swing, arms flail in the air, flap during slides
      const swing = s * 0.9 * Math.min(1, runK);
      const air = this.airK;
      this.armL.rotation.set(-swing * (1 - air) + air * 2.4 + this.slideK * 1.4, 0, -0.15 - air * 0.4);
      this.armR.rotation.set(swing * (1 - air) + air * 2.2 + this.slideK * 0.8, 0, 0.15 + air * 0.4);
      this.elbowL.rotation.set(0.4 + Math.max(0, -swing) * 0.6, 0, 0);
      this.elbowR.rotation.set(0.4 + Math.max(0, swing) * 0.6, 0, 0);
      if (this.throwT >= 0) this.throwArm(this.armR, this.elbowR, this.throwT, 1);
    }

    // --- eating / drinking: weapon tucked away, item to the mouth with little nibbles
    this.healK = damp(this.healK, a.healing ? 1 : 0, 12, dt);
    if (this.weapon) this.weapon.group.visible = this.healK < 0.5;
    if (this.healK > 0.02) {
      const nib = Math.sin(t * 14) * 0.12;
      const k = this.healK;
      _q.setFromEuler(new THREE.Euler(2.25 + nib, 0, -0.55));
      this.armL.quaternion.slerp(_q, k);
      this.elbowL.rotation.x = this.elbowL.rotation.x * (1 - k) + (1.9 + nib) * k;
      if (a.healing) {
        _q2.setFromEuler(new THREE.Euler(0.3, 0, 0.2));
        this.armR.quaternion.slerp(_q2, k);
        this.elbowR.rotation.x = this.elbowR.rotation.x * (1 - k) + 0.6 * k;
        this.head.rotation.x += 0.12 * k + nib * 0.3;
        if (this.expression === 'normal') this.eyeL.scale.y = this.eyeR.scale.y = 0.35; // blissful squint
      }
    }

    // --- skydive (belly down, limbs starfished) and glider hang
    this.diveK = damp(this.diveK, a.diving ? 1 : 0, 6, dt);
    this.glideK = damp(this.glideK, a.gliding ? 1 : 0, 8, dt);
    this.body.rotation.x = -1.25 * this.diveK - 0.15 * this.glideK;
    if (this.diveK > 0.02) {
      const k = this.diveK, fl = Math.sin(t * 13) * 0.08;
      _q.setFromEuler(new THREE.Euler(0.35 + fl, 0, -1.35));
      this.armL.quaternion.slerp(_q, k);
      _q.setFromEuler(new THREE.Euler(0.35 - fl, 0, 1.35));
      this.armR.quaternion.slerp(_q, k);
      this.legL.rotation.x += (-0.35 - this.legL.rotation.x) * k;
      this.legR.rotation.x += (-0.35 - this.legR.rotation.x) * k;
      this.legL.rotation.z += (-0.35 - this.legL.rotation.z) * k;
      this.legR.rotation.z += (0.35 - this.legR.rotation.z) * k;
      this.head.rotation.x += 0.9 * k; // look ahead while belly-down
      if (this.weapon) this.weapon.group.visible = false;
    }
    if (this.glideK > 0.02) {
      const k = this.glideK;
      _q.setFromEuler(new THREE.Euler(2.95, 0, -0.35));
      this.armL.quaternion.slerp(_q, k);
      _q.setFromEuler(new THREE.Euler(2.95, 0, 0.35));
      this.armR.quaternion.slerp(_q, k);
      this.elbowL.rotation.x *= 1 - k;
      this.elbowR.rotation.x *= 1 - k;
      const dang = Math.sin(t * 4) * 0.25;
      this.legL.rotation.x += (dang - this.legL.rotation.x) * k;
      this.legR.rotation.x += (-dang - this.legR.rotation.x) * k;
      this.kneeL.rotation.x += (-0.5 - this.kneeL.rotation.x) * k;
      this.kneeR.rotation.x += (-0.3 - this.kneeR.rotation.x) * k;
      if (this.weapon) this.weapon.group.visible = false;
    }

    // --- emotes (procedural, layered over whatever the body was doing)
    if (a.emote) this.emoteKind = a.emote;
    this.emoteK = damp(this.emoteK, a.emote ? 1 : 0, 10, dt);
    if (this.emoteK > 0.02) {
      const k = this.emoteK;
      if (this.weapon) this.weapon.group.visible = false;
      const e = this.emoteKind;
      if (e === 'dance') {
        const b = Math.sin(t * 9), b2 = Math.sin(t * 4.5);
        this.hips.position.y += Math.abs(b) * 0.08 * k;
        this.hips.rotation.y += b2 * 0.45 * k;
        _q.setFromEuler(new THREE.Euler(2.6 + b * 0.4, 0, -0.4 - b2 * 0.3));
        this.armL.quaternion.slerp(_q, k);
        _q.setFromEuler(new THREE.Euler(0.6 - b * 0.5, 0, 0.9 + b2 * 0.3));
        this.armR.quaternion.slerp(_q, k);
        this.elbowL.rotation.x += (0.5 + b * 0.3 - this.elbowL.rotation.x) * k;
        this.elbowR.rotation.x += (1.2 - this.elbowR.rotation.x) * k;
        this.legL.rotation.x += (Math.max(0, b) * 0.9 - this.legL.rotation.x) * k;
        this.legR.rotation.x += (Math.max(0, -b) * 0.9 - this.legR.rotation.x) * k;
        this.kneeL.rotation.x += (-Math.max(0, b) * 1.3 - this.kneeL.rotation.x) * k;
        this.kneeR.rotation.x += (-Math.max(0, -b) * 1.3 - this.kneeR.rotation.x) * k;
        this.head.rotation.z += b2 * 0.25 * k;
        this.eyeL.scale.y = this.eyeR.scale.y = 0.45;
      } else if (e === 'wave') {
        const w = Math.sin(t * 11);
        _q.setFromEuler(new THREE.Euler(2.9, 0, 0.55 + w * 0.35));
        this.armR.quaternion.slerp(_q, k);
        this.elbowR.rotation.x += (0.5 + w * 0.3 - this.elbowR.rotation.x) * k;
        this.head.rotation.z += 0.18 * k;
        this.torso.rotation.z += -0.08 * k;
      } else if (e === 'laugh') {
        const h = Math.sin(t * 16);
        this.torso.rotation.x += (-0.25 + h * 0.12) * k;
        this.head.rotation.x += (-0.35 + h * 0.1) * k;
        _q.setFromEuler(new THREE.Euler(0.9, 0, -0.5));
        this.armL.quaternion.slerp(_q, k);
        _q.setFromEuler(new THREE.Euler(0.9, 0, 0.5));
        this.armR.quaternion.slerp(_q, k);
        this.elbowL.rotation.x += (1.7 - this.elbowL.rotation.x) * k;
        this.elbowR.rotation.x += (1.7 - this.elbowR.rotation.x) * k;
        this.hips.position.y += Math.abs(h) * 0.03 * k;
        this.eyeL.scale.y = this.eyeR.scale.y = 0.3;
        this.mouth.scale.set(0.8, -1.4, 1);
      } else {
        const p = Math.sin(t * 6);
        _q.setFromEuler(new THREE.Euler(1.6, 0, -1.3));
        this.armL.quaternion.slerp(_q, k);
        _q.setFromEuler(new THREE.Euler(1.6, 0, 1.3));
        this.armR.quaternion.slerp(_q, k);
        this.elbowL.rotation.x += (2.1 + p * 0.15 - this.elbowL.rotation.x) * k;
        this.elbowR.rotation.x += (2.1 - p * 0.15 - this.elbowR.rotation.x) * k;
        this.torso.scale.x *= 1 + Math.max(0, p) * 0.08 * k;
        this.hips.position.y += -0.05 * k;
        this.eyeL.scale.y = this.eyeR.scale.y = 0.6;
      }
    }

    // --- secondary motion: backpack, scarf, hat
    this.packSwingXV += (-this.packSwingX * 120 - this.packSwingXV * 9 + accel * 0.4 + (a.grounded ? Math.abs(c) * runK * 12 : 0) - this.squashV * 3) * dt;
    this.packSwingX += this.packSwingXV * dt;
    this.packSwingZV += (-this.packSwingZ * 120 - this.packSwingZV * 9 + a.turnRate * 1.5) * dt;
    this.packSwingZ += this.packSwingZV * dt;
    this.pack.rotation.set(clamp(this.packSwingX * 0.05, -0.35, 0.35), 0, clamp(this.packSwingZ * 0.05, -0.3, 0.3));

    const scarfTarget = clamp(speed * 0.18 + (a.vy < 0 ? -a.vy * 0.05 : 0), 0, 1.4);
    this.scarfAV += ((scarfTarget - this.scarfA) * 60 - this.scarfAV * 7) * dt;
    this.scarfA += this.scarfAV * dt;
    const flutter = Math.sin(t * 14 + speed) * 0.12 * clamp(speed / 6, 0, 1);
    this.scarfTail1.rotation.set(this.scarfA + flutter, 0, 0.1 + this.roll);
    this.scarfTail2.rotation.set(this.scarfA * 0.5 + Math.sin(t * 17) * 0.2 * clamp(speed / 6, 0, 1), 0, 0);

    this.hatAV += (-this.hatA * 160 - this.hatAV * 10 - this.squashV * 4) * dt;
    this.hatA += this.hatAV * dt;
    this.hat.scale.set(1 - this.hatA * 0.03, 1 + this.hatA * 0.05, 1 - this.hatA * 0.03);

    // hit flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const f = this.flashT > 0;
      for (const mm of this.materials) {
        if (mm === this.gogMat) continue;
        mm.emissive.setHex(f ? 0xffffff : 0x000000);
        mm.emissiveIntensity = f ? 0.65 : 1;
      }
    }
  }

  /** overhand throw: wind back, then whip forward */
  private throwArm(arm: THREE.Group, elbow: THREE.Group, k: number, side: number) {
    const wind = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
    const fwd = k < 0.35 ? 0 : (k - 0.35) / 0.65;
    arm.rotation.set(-2.6 * wind + 1.6 * fwd, 0, side * (0.3 + wind * 0.3));
    elbow.rotation.set(1.4 * wind + 0.2, 0, 0);
  }

  /** Two-bone IK: place the hand of `arm` on a point in weapon space. */
  private solveArmToWeapon(arm: THREE.Group, elbow: THREE.Group, gripLocal: THREE.Vector3, side: number) {
    const w = this.weapon!.group;
    w.updateMatrix();
    this.weaponMount.updateMatrix();
    // target in torso space
    _v.copy(gripLocal).applyMatrix4(w.matrix).applyMatrix4(this.weaponMount.matrix);
    const a = 0.2, b = 0.2;
    const S = arm.position;
    const v = _v2.subVectors(_v, S);
    let d = v.length();
    d = clamp(d, 0.05, a + b - 0.002);
    v.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const alpha = Math.acos(cosA);
    const cosG = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
    const bend = Math.PI - Math.acos(cosG);
    // pole: elbows point down and outwards
    const pole = _v3.set(side * 0.7, -1, 0.3).normalize();
    const N = new THREE.Vector3().crossVectors(v, pole).normalize();
    const U = v.clone().applyAxisAngle(N, alpha);
    _q.setFromUnitVectors(DOWN, U);
    const X1 = XAXIS.clone().applyQuaternion(_q);
    const tw = Math.atan2(new THREE.Vector3().crossVectors(X1, N).dot(U), X1.dot(N));
    _q2.setFromAxisAngle(U, tw);
    arm.quaternion.copy(_q2.multiply(_q));
    // elbow sign: pick the bend that points the forearm at the target
    const E = S.clone().addScaledVector(U, a);
    const F = new THREE.Vector3().subVectors(_v, E).normalize();
    const f1 = U.clone().applyAxisAngle(N, -bend);
    const f2 = U.clone().applyAxisAngle(N, bend);
    elbow.rotation.set(f1.dot(F) > f2.dot(F) ? -bend : bend, 0, 0);
    // local X is aligned with N after the twist, so rotation about local x == rotation about N
    void _m;
  }

  /** world position of the hand (for thrown objects / pickups) */
  handWorld(side: 1 | -1, out: THREE.Vector3) {
    (side > 0 ? this.handR : this.handL).getWorldPosition(out);
    return out;
  }
}

function shadeHex(hex: number, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

/** Smooth radius curve from [d, r] control points (Catmull-Rom sampled lookup). */
function curveFn(pts: [number, number][]) {
  const curve = new THREE.SplineCurve(pts.map(([d, r]) => new THREE.Vector2(d, r)));
  const samples = curve.getPoints(80);
  return (d: number) => {
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].x >= d) {
        const a = samples[i - 1], b = samples[i];
        const t = (d - a.x) / Math.max(1e-6, b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
    return samples[samples.length - 1].y;
  };
}

function softSphere(r: number, sx: number, sy: number, sz: number) {
  const g = G.sphere(r, 14, 10);
  g.scale(sx, sy, sz);
  return g;
}

/** A tapered, slightly curved cloth ribbon (scarf tails). */
function taperedRibbon(w: number, h: number, d: number) {
  return deform(G.rbox(w, h, d, 3, Math.min(d / 2 - 0.001, 0.015)), (v) => {
    const t = (h / 2 - v.y) / h; // 0 top .. 1 bottom
    v.x *= 1 - t * 0.2;
    v.z += Math.sin(t * Math.PI) * 0.012;
  });
}
