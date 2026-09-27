import * as THREE from 'three';
import { toyMaterial } from '../render/Materials';
import { PAL, RARITY, RarityIndex } from '../render/Palette';

/**
 * Procedural models for the Burrow: every building has a look per level (it grows parts as you
 * upgrade), plus empty plots, decor and the floating island itself. Pure geometry, no assets.
 */

export type Parts = { root: THREE.Group; anim: ((t: number, dt: number) => void)[]; trees?: THREE.Group[] };

const glassMat = new THREE.MeshStandardMaterial({ color: 0xe8fbff, roughness: 0.05, metalness: 0.1, emissive: 0x9fe8ff, emissiveIntensity: 0.12, transparent: true, opacity: 0.42, depthWrite: false });

function mk(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const T = (c: number, rough = 0.7, o: { metal?: number; emissive?: number; ei?: number } = {}) => toyMaterial(c, { rough, metal: o.metal, emissive: o.emissive, emissiveIntensity: o.ei });
const glow = (c: number, ei = 1.2) => toyMaterial(c, { rough: 0.4, emissive: c, emissiveIntensity: ei });
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, w = 18, h = 12) => new THREE.SphereGeometry(r, w, h);

/* ------------------------------------------------------------------ the island */

export function buildIsland(): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  // grassy top, gently domed
  const topGeo = new THREE.CylinderGeometry(11.5, 11, 1, 48, 3);
  const pos = topGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.12;
    if (y > 0) pos.setY(i, y + (1 - (r / 11.5) ** 2) * 0.35 + n);
    // a wobbly outline, like it was scooped out of a bigger island
    const a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 5) * 0.035 + Math.sin(a * 9 + 1) * 0.02;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  topGeo.computeVertexNormals();
  const top = mk(root, topGeo, T(PAL.grass, 0.95), 0, -0.5, 0);
  top.castShadow = false;
  // a lip of darker grass and a dirt band
  mk(root, cyl(11.6, 11.2, 0.5, 48), T(PAL.grassDark, 0.95), 0, -1.1, 0).castShadow = false;
  mk(root, cyl(11.2, 9.5, 1.6, 40), T(0x9a6a45, 0.95), 0, -2.1, 0);
  // rocky underside: stacked cones
  mk(root, new THREE.ConeGeometry(9.6, 8, 14, 3), T(0x8a7a6a, 0.95), 0, -6.9, 0, Math.PI, 0.3, 0);
  mk(root, new THREE.ConeGeometry(5, 5, 10, 2), T(0x7a6a5a, 0.95), 2.5, -9.5, -1.5, Math.PI, 0, 0);
  mk(root, new THREE.ConeGeometry(3.4, 4, 9, 2), T(0x9a8a7a, 0.95), -3.5, -8.5, 2.5, Math.PI, 0, 0);
  // dangling roots
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.sin(i) * 0.3;
    const r = 8.5 + Math.sin(i * 3) * 1.2;
    const len = 1.5 + ((i * 37) % 10) / 4;
    mk(root, cyl(0.06, 0.02, len, 5), T(0x5e3b27), Math.cos(a) * r, -3 - len / 2, Math.sin(a) * r, 0, 0, Math.sin(i) * 0.2);
  }
  // a little waterfall spilling off the east edge from a pond
  const pond = mk(root, cyl(1.6, 1.6, 0.08, 24), toyMaterial(PAL.water, { rough: 0.15, emissive: 0x2a7fa0, emissiveIntensity: 0.3 }), 9.2, 0.02, -2.2);
  pond.castShadow = false;
  const fallMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x4fc3d9, emissiveIntensity: 0.4, transparent: true, opacity: 0.75 });
  const fall = mk(root, box(1.1, 7, 0.25), fallMat, 11.3, -3.5, -2.2);
  fall.castShadow = false;
  anim.push((t) => (fallMat.emissiveIntensity = 0.35 + Math.sin(t * 6) * 0.1));
  for (let i = 0; i < 6; i++) {
    const r = mk(root, sph(0.3 + (i % 3) * 0.1, 8, 6), T(PAL.stone, 0.9), 9.2 + Math.cos(i) * 1.75, 0.1, -2.2 + Math.sin(i) * 1.75);
    r.scale.y = 0.6;
  }
  // stepping-stone paths from the middle out to the plots
  const stone = T(PAL.cobble, 0.9);
  const path = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.9));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const s = mk(root, cyl(0.34, 0.38, 0.12, 9), stone, x0 + (x1 - x0) * k + Math.sin(i * 2.1) * 0.12, 0.02, z0 + (z1 - z0) * k + Math.cos(i * 1.7) * 0.12, 0, i, 0);
      s.castShadow = false;
    }
  };
  path(0, -2.2, 0, 4.8);
  path(0, 0.8, -5.2, -0.6);
  path(0, 0.8, 4.2, -1.3);
  path(4.6, -0.5, 6.2, 1.6);
  path(4.4, 0.8, 4.2, 3.9);
  path(-1, 1.6, -4.2, 3.9);
  path(-1.6, -3.6, -6.2, -4.8);
  // tufts, pebbles and trees round the rim
  const tuft = T(PAL.grassLight, 0.95);
  for (let i = 0; i < 70; i++) {
    const a = i * 2.39996, r = 2 + ((i * 53) % 90) / 10;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const c = mk(root, new THREE.ConeGeometry(0.1, 0.35, 5), tuft, x, 0.15, z, 0, 0, 0.2 * Math.sin(i));
    c.castShadow = false;
  }
  const trees: [number, number, number][] = [[-10.2, 0.2, 0.85], [-3.2, -10.1, 0.8], [7.4, -7.6, 0.95], [10.2, 4.8, 0.8], [-8.4, 7.4, 0.8], [3.9, 10.2, 0.75], [-10.6, -3.6, 0.7], [-2.6, 10.4, 0.7]];
  const treeGroups: THREE.Group[] = [];
  for (const [x, z, s] of trees) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    g.userData.s = s;
    treeGroups.push(g);
    root.add(g);
    mk(g, cyl(0.18, 0.28, 1.6, 8), T(PAL.brown), 0, 0.8, 0);
    const leaf = T(PAL.leaf, 0.9);
    mk(g, sph(1.1, 12, 9), leaf, 0, 2.2, 0);
    mk(g, sph(0.8, 10, 8), leaf, 0.5, 2.9, 0.2);
    mk(g, sph(0.7, 10, 8), T(PAL.leafDark, 0.9), -0.5, 2.6, -0.3);
    anim.push((t) => (g.rotation.z = Math.sin(t * 0.9 + x) * 0.03));
  }
  return { root, anim, trees: treeGroups };
}

/* ------------------------------------------------------------------ empty plots */

export function buildPlot(locked: boolean): Parts {
  const root = new THREE.Group();
  const soil = mk(root, cyl(1.5, 1.6, 0.12, 20), T(0xa87852, 0.95), 0, 0.03, 0);
  soil.castShadow = false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mk(root, box(0.12, 0.35, 0.12), T(PAL.woodLight), Math.cos(a) * 1.55, 0.18, Math.sin(a) * 1.55);
  }
  // a signpost with a + or a padlock
  mk(root, box(0.1, 1.1, 0.1), T(PAL.wood), 0, 0.55, 0);
  mk(root, box(0.8, 0.5, 0.08), T(PAL.cream), 0, 1.05, 0.05);
  const sym = locked ? T(0x9aa4b0, 0.4, { metal: 0.4 }) : T(PAL.grass);
  if (locked) {
    mk(root, box(0.26, 0.2, 0.06), sym, 0, 1.0, 0.1);
    mk(root, new THREE.TorusGeometry(0.09, 0.03, 6, 12, Math.PI), sym, 0, 1.1, 0.1);
  } else {
    mk(root, box(0.36, 0.1, 0.06), sym, 0, 1.05, 0.1);
    mk(root, box(0.1, 0.36, 0.06), sym, 0, 1.05, 0.1);
  }
  const anim: Parts['anim'] = [];
  return { root, anim };
}

/* ------------------------------------------------------------------ buildings */

/** the Burrow Hall: a big hollow stump with a mushroom roof. Grows a chimney, balcony, flag, lanterns. */
export function buildHall(L: number): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  const h = 2.2 + L * 0.35;
  const bark = T(0x8a5a3b, 0.9);
  mk(root, cyl(1.55, 1.85, h, 22), bark, 0, h / 2, 0);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    mk(root, box(0.16, h * 0.9, 0.14), T(0x6e4530, 0.95), Math.cos(a) * 1.68, h * 0.45, Math.sin(a) * 1.68, 0, -a, 0);
  }
  // roots at the base
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    mk(root, new THREE.CapsuleGeometry(0.22, 0.7, 3, 6), bark, Math.cos(a) * 1.9, 0.18, Math.sin(a) * 1.9, Math.PI / 2, 0, -a + Math.PI / 2).rotation.set(0.3, -a, Math.PI / 2);
  }
  // round door + knob + step
  mk(root, cyl(0.62, 0.62, 0.12, 20), T(0x5e3b27), 0, 0.72, 1.72, Math.PI / 2, 0, 0);
  mk(root, box(0.03, 1.1, 0.02), T(0x4a2e1f), 0, 0.72, 1.8);
  mk(root, sph(0.07, 8, 6), T(0xffc83d, 0.3, { metal: 0.6 }), 0.35, 0.7, 1.82);
  mk(root, cyl(0.7, 0.8, 0.12, 16), T(PAL.stone, 0.9), 0, 0.06, 2.0);
  // glowing round windows
  const win = glow(0xffd98a, 0.9);
  const wins = [[-1.0, h * 0.62, 1.3], [1.05, h * 0.55, 1.28]];
  if (L >= 3) wins.push([-0.6, h * 0.85, 1.48], [0.9, h * 0.86, 1.36]);
  for (const [x, y, z] of wins) {
    mk(root, cyl(0.26, 0.26, 0.1, 14), win, x, y, z, Math.PI / 2, Math.atan2(x, z), 0).rotation.set(Math.PI / 2, 0, -Math.atan2(x, z));
    mk(root, new THREE.TorusGeometry(0.28, 0.05, 6, 16), T(PAL.woodLight), x, y, z + 0.02, 0, Math.atan2(x, z), 0);
  }
  // mushroom roof with dots
  const capR = 2.2 + L * 0.12;
  const cap = mk(root, new THREE.SphereGeometry(capR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), T(0xd94a3a, 0.55), 0, h - 0.05, 0);
  cap.scale.y = 0.62;
  mk(root, cyl(capR, capR * 0.9, 0.18, 24), T(0xf4e7c8, 0.8), 0, h - 0.05, 0);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, rr = capR * (0.35 + (i % 3) * 0.2);
    const y = h - 0.05 + Math.sqrt(Math.max(0, capR * capR - rr * rr)) * 0.62;
    const d = mk(root, sph(0.2 + (i % 2) * 0.08, 10, 8), T(0xffffff, 0.8), Math.cos(a) * rr, y - 0.05, Math.sin(a) * rr);
    d.scale.y = 0.45;
  }
  if (L >= 2) {
    // stone chimney with puffs of smoke
    mk(root, cyl(0.25, 0.3, 1.1, 10), T(PAL.stoneDark, 0.9), 1.1, h + 0.8, -0.6);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const p = mk(root, sph(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }), 1.1, h + 1.5, -0.6);
      p.castShadow = false;
      puffs.push(p);
    }
    anim.push((t) =>
      puffs.forEach((p, i) => {
        const k = (t * 0.35 + i / 4) % 1;
        p.position.set(1.1 + Math.sin(k * 6 + i) * 0.2, h + 1.4 + k * 2, -0.6 - k * 0.5);
        p.scale.setScalar(0.6 + k * 1.2);
        (p.material as THREE.MeshStandardMaterial).opacity = 0.7 * (1 - k);
      }),
    );
  }
  if (L >= 3) {
    // a balcony ring with railings
    mk(root, new THREE.TorusGeometry(1.95, 0.12, 6, 28), T(PAL.woodLight), 0, h * 0.72, 0, Math.PI / 2, 0, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mk(root, box(0.06, 0.4, 0.06), T(PAL.wood), Math.cos(a) * 2.0, h * 0.72 + 0.22, Math.sin(a) * 2.0);
    }
    mk(root, new THREE.TorusGeometry(2.0, 0.04, 6, 28), T(PAL.wood), 0, h * 0.72 + 0.42, 0, Math.PI / 2, 0, 0);
  }
  if (L >= 4) {
    // flag on top
    const top = h - 0.05 + capR * 0.62;
    mk(root, cyl(0.04, 0.04, 1.6, 6), T(0xdddddd, 0.3, { metal: 0.5 }), 0, top + 0.75, 0);
    const flag = mk(root, box(0.8, 0.5, 0.03), T(0x6ff7ff, 0.7), 0.42, top + 1.3, 0);
    anim.push((t) => {
      flag.rotation.y = Math.sin(t * 3) * 0.25;
      flag.scale.x = 1 + Math.sin(t * 5) * 0.05;
    });
  }
  if (L >= 5) {
    // gold trim and hanging lanterns
    mk(root, new THREE.TorusGeometry(capR, 0.07, 6, 32), T(0xffc83d, 0.3, { metal: 0.6 }), 0, h + 0.05, 0, Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const l = mk(root, sph(0.13, 10, 8), glow(0xffb84d, 1.6), Math.cos(a) * capR * 0.95, h - 0.45, Math.sin(a) * capR * 0.95);
      anim.push((t) => (l.position.y = h - 0.45 + Math.sin(t * 2 + i) * 0.04));
    }
  }
  return { root, anim };
}

/** Glimmer Pump: a stone well pumping crystals into a glass tank. fill() sets how full it looks. */
export function buildPump(L: number): Parts & { setFill(k: number): void } {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  const tr = 0.55 + L * 0.08;
  mk(root, cyl(1.05, 1.15, 0.55, 18), T(PAL.stone, 0.9), 0, 0.28, 0);
  mk(root, new THREE.TorusGeometry(1.08, 0.1, 6, 22), T(PAL.stoneDark, 0.9), 0, 0.56, 0, Math.PI / 2, 0, 0);
  // the tank
  const th = 1.3 + L * 0.2;
  mk(root, cyl(tr, tr, th, 20), glassMat, 0, 0.6 + th / 2, 0).castShadow = false;
  mk(root, cyl(tr + 0.08, tr + 0.08, 0.14, 20), T(0xb8c0c8, 0.3, { metal: 0.6 }), 0, 0.62, 0);
  mk(root, cyl(tr + 0.08, tr + 0.08, 0.14, 20), T(L >= 5 ? 0xffc83d : 0xb8c0c8, 0.3, { metal: 0.6 }), 0, 0.6 + th, 0);
  const crystals = new THREE.Group();
  crystals.position.y = 0.66;
  root.add(crystals);
  const cm = glow(0x6ff7ff, 0.8);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3, r = (i % 3) * tr * 0.25;
    const c = mk(crystals, new THREE.OctahedronGeometry(0.2 + (i % 2) * 0.08, 0), cm, Math.cos(a) * r, 0.25 + (i % 4) * 0.2, Math.sin(a) * r, 0.3 * i, i, 0);
    c.scale.y = 1.6;
  }
  // pump handle that rocks
  mk(root, box(0.16, 1.4, 0.16), T(PAL.wood), 1.25, 0.7, 0);
  const arm = new THREE.Group();
  arm.position.set(1.25, 1.4, 0);
  root.add(arm);
  mk(arm, box(1.4, 0.1, 0.1), T(PAL.woodLight), -0.2, 0, 0);
  mk(arm, sph(0.1, 8, 6), T(0xd94a3a), 0.5, 0, 0);
  anim.push((t) => (arm.rotation.z = Math.sin(t * 2.4) * 0.3));
  if (L >= 3) {
    // windmill that does the pumping
    mk(root, box(0.14, 2.2, 0.14), T(PAL.wood), -1.1, 1.1, -0.4);
    const hub = new THREE.Group();
    hub.position.set(-1.1, 2.25, -0.25);
    root.add(hub);
    for (let i = 0; i < 4; i++) {
      const b = mk(hub, box(0.18, 0.9, 0.04), T(PAL.cream), 0, 0.45, 0);
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / 4) * Math.PI * 2;
      pivot.add(b);
      hub.add(pivot);
    }
    anim.push((_t, dt) => (hub.rotation.z += dt * 2.5));
  }
  if (L >= 4) {
    mk(root, cyl(0.3, 0.3, 0.9, 12), glassMat, 0.4, 0.85, 1.05).castShadow = false;
    mk(root, new THREE.OctahedronGeometry(0.16, 0), cm, 0.4, 0.8, 1.05);
  }
  let fill = 0.3;
  anim.push((t) => {
    crystals.scale.set(1, 0.15 + fill * (th / 1.3) * 0.9, 1);
    crystals.rotation.y = t * 0.4;
    cm.emissiveIntensity = 0.6 + fill * 0.8 + Math.sin(t * 4) * 0.1;
  });
  return { root, anim, setFill: (k: number) => (fill = Math.max(0, Math.min(1, k))) };
}

/** Incubator: a warm glass dome on a brass base. setCocoon() shows what's inside. */
export function buildIncubator(L: number): Parts & { setCocoon(r: RarityIndex | -1, ready: boolean): void } {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  const R = 0.85 + L * 0.07;
  mk(root, cyl(R + 0.2, R + 0.35, 0.45, 20), T(PAL.woodLight), 0, 0.22, 0);
  mk(root, new THREE.TorusGeometry(R + 0.12, 0.08, 6, 24), T(0xd9a441, 0.3, { metal: 0.6 }), 0, 0.47, 0, Math.PI / 2, 0, 0);
  // heating coils glow warmer at higher levels
  const coil = glow(0xff8a3d, 0.3 + L * 0.25);
  for (let i = 0; i < Math.min(3, 1 + Math.floor(L / 2)); i++) mk(root, new THREE.TorusGeometry(R * (0.5 + i * 0.18), 0.04, 6, 20), coil, 0, 0.5, 0, Math.PI / 2, 0, 0);
  const nest = mk(root, cyl(R * 0.6, R * 0.5, 0.2, 14), T(0xc9a06a, 0.95), 0, 0.55, 0);
  nest.castShadow = false;
  const dome = mk(root, new THREE.SphereGeometry(R, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat, 0, 0.47, 0);
  dome.castShadow = false;
  mk(root, sph(0.1, 8, 6), T(0xd9a441, 0.3, { metal: 0.6 }), 0, 0.47 + R, 0);
  if (L >= 3) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    mk(root, new THREE.CapsuleGeometry(0.08, 0.3, 3, 6), T(0xd9a441, 0.3, { metal: 0.6 }), Math.cos(a) * (R + 0.3), 0.15, Math.sin(a) * (R + 0.3));
  }
  if (L >= 5) mk(root, new THREE.TorusGeometry(R * 0.7, 0.05, 6, 20), glow(0xffe27a, 1), 0, 0.47 + R * 0.72, 0, Math.PI / 2, 0, 0);
  const cocoonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.2 });
  const cocoon = mk(root, new THREE.CapsuleGeometry(0.26, 0.32, 6, 12), cocoonMat, 0, 0.95, 0);
  const light = new THREE.PointLight(0xffb86b, 0, 4);
  light.position.y = 1;
  root.add(light);
  let has = false, ready = false;
  anim.push((t) => {
    cocoon.visible = has;
    if (!has) return;
    const wob = ready ? Math.sin(t * 14) * 0.25 : Math.sin(t * 2.2) * 0.06;
    cocoon.rotation.z = wob;
    cocoon.position.y = 0.95 + (ready ? Math.abs(Math.sin(t * 5)) * 0.15 : 0);
    cocoonMat.emissiveIntensity = ready ? 0.7 + Math.sin(t * 8) * 0.3 : 0.2 + Math.sin(t * 2) * 0.08;
    light.intensity = ready ? 3 : 1;
  });
  return {
    root,
    anim,
    setCocoon(r, rdy) {
      has = r >= 0;
      ready = rdy;
      if (has) {
        cocoonMat.color.setHex(RARITY[r as RarityIndex].color);
        cocoonMat.emissive.setHex(RARITY[r as RarityIndex].color);
      }
      if (!has) light.intensity = 0;
    },
  };
}

/** Bug Gym: a sandy ring with hoops to blink through (one hoop per level). */
export function buildGym(L: number): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  mk(root, cyl(1.9, 2.0, 0.12, 26), T(0xf0d9a4, 0.95), 0, 0.06, 0).castShadow = false;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) > 0.95 && Math.cos(a) > 0) continue;
    mk(root, box(0.1, 0.45, 0.1), T(PAL.wood), Math.cos(a) * 1.95, 0.25, Math.sin(a) * 1.95);
  }
  mk(root, new THREE.TorusGeometry(1.95, 0.04, 5, 36), T(PAL.woodLight), 0, 0.42, 0, Math.PI / 2, 0, 0);
  const colors = [0xff6bb5, 0x6ff7ff, 0xf2c14e, 0x9dff8a, 0xb49be0];
  for (let i = 0; i < L; i++) {
    const a = (i / Math.max(1, L)) * Math.PI * 2 + 0.4;
    const r = L === 1 ? 0 : 1.05;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.rotation.y = -a;
    root.add(g);
    mk(g, box(0.07, 1.1, 0.07), T(0xdddddd, 0.3, { metal: 0.4 }), 0, 0.55, 0);
    const hoop = mk(g, new THREE.TorusGeometry(0.38, 0.06, 8, 22), glow(colors[i % 5], 0.5), 0, 1.35, 0);
    anim.push((t) => (hoop.rotation.y = Math.sin(t * 1.5 + i) * 0.4));
  }
  // dumbbell and a little podium
  mk(root, cyl(0.06, 0.06, 0.7, 8), T(0x9aa4b0, 0.3, { metal: 0.5 }), 1.2, 0.2, 1.1, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) mk(root, sph(0.16, 10, 8), T(0x2b2238, 0.6), 1.2 + s * 0.35, 0.2, 1.1);
  if (L >= 3) {
    mk(root, box(0.8, 0.3, 0.6), T(0xffc83d, 0.4, { metal: 0.3 }), -1.25, 0.15, 1.05);
    mk(root, box(0.55, 0.25, 0.45), T(0xdddddd, 0.4, { metal: 0.3 }), -1.25, 0.42, 1.05);
  }
  if (L >= 4) {
    for (const s of [-1, 1]) {
      mk(root, cyl(0.04, 0.04, 1.8, 6), T(0xdddddd, 0.3, { metal: 0.5 }), s * 1.95, 0.9, -0.4);
      const f = mk(root, box(0.5, 0.32, 0.03), T(s > 0 ? 0xff6bb5 : 0x6ff7ff), s * 1.95 + 0.26, 1.6, -0.4);
      anim.push((t) => (f.rotation.y = Math.sin(t * 3 + s) * 0.3));
    }
  }
  return { root, anim };
}

/** Relic Museum: a tiny temple; relics show on pedestals out front. */
export function buildMuseum(L: number, gems: number[]): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  const W = 2.6 + L * 0.3;
  mk(root, box(W + 0.6, 0.2, 2.4), T(PAL.stone, 0.9), 0, 0.1, 0);
  mk(root, box(W + 0.3, 0.2, 2.1), T(0xe2d8c8, 0.9), 0, 0.3, 0);
  mk(root, box(W - 0.2, 1.6, 1.3), T(0xf4ecdc, 0.9), 0, 1.2, -0.25);
  mk(root, box(0.6, 1.0, 0.05), T(0x5e3b27), 0, 0.9, 0.42);
  const cols = L >= 2 ? 6 : 4;
  for (let i = 0; i < cols; i++) {
    const x = -W / 2 + 0.2 + (i / (cols - 1)) * (W - 0.4);
    mk(root, cyl(0.13, 0.15, 1.7, 12), T(0xfffaf0, 0.8), x, 1.25, 0.75);
    mk(root, box(0.36, 0.1, 0.36), T(0xe2d8c8, 0.9), x, 2.13, 0.75);
  }
  mk(root, box(W + 0.3, 0.22, 2.0), T(0xe2d8c8, 0.9), 0, 2.28, 0);
  // triangular pediment
  const tri = new THREE.Shape();
  tri.moveTo(-1.05, 0);
  tri.lineTo(1.05, 0);
  tri.lineTo(0, 0.75);
  tri.closePath();
  const pg = new THREE.ExtrudeGeometry(tri, { depth: W + 0.3, bevelEnabled: false });
  pg.translate(0, 0, -(W + 0.3) / 2);
  mk(root, pg, T(L >= 3 ? 0xffc83d : 0xd94a3a, 0.6, { metal: L >= 3 ? 0.4 : 0 }), 0, 2.39, 0, 0, Math.PI / 2, 0);
  // relic pedestals
  const n = gems.length;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 7), col = i % 7;
    const x = (col - 3) * 0.48, z = 1.45 + row * 0.5;
    mk(root, cyl(0.12, 0.14, 0.35, 8), T(0xe2d8c8, 0.9), x, 0.18, z);
    const g = mk(root, new THREE.OctahedronGeometry(0.12, 0), glow(gems[i], 0.7), x, 0.52, z);
    g.scale.y = 1.4;
    anim.push((t) => {
      g.rotation.y = t * 1.5 + i;
      g.position.y = 0.52 + Math.sin(t * 2 + i) * 0.04;
    });
  }
  return { root, anim };
}

/** Bug Bazaar: a striped market tent with crates and hanging lanterns. */
export function buildBazaar(L: number): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  const R = 1.3 + L * 0.15;
  for (const [x, z] of [[-R, -0.7], [R, -0.7], [-R, 0.8], [R, 0.8]]) mk(root, cyl(0.07, 0.07, 1.8, 8), T(PAL.wood), x, 0.9, z);
  // striped awning: alternating wedges
  const n = 10;
  for (let i = 0; i < n; i++) {
    const w = mk(root, new THREE.ConeGeometry(R * 1.35, 0.9, 1 * 3, 1, true, (i / n) * Math.PI * 2, (Math.PI * 2) / n), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xe8505b, roughness: 0.8, side: THREE.DoubleSide }), 0, 2.2, 0);
    w.scale.z = 0.75;
  }
  mk(root, sph(0.12, 8, 6), T(0xffc83d, 0.3, { metal: 0.5 }), 0, 2.72, 0);
  mk(root, box(R * 2 - 0.2, 0.8, 0.5), T(PAL.woodLight), 0, 0.4, 0.75);
  mk(root, box(R * 2, 0.08, 0.6), T(PAL.wood), 0, 0.82, 0.75);
  // goods on the counter
  const goods = [0xffffff, 0x5fe067, 0x49a8ff, 0xc160ff, 0xffa726];
  for (let i = 0; i < 2 + L; i++) {
    const c = mk(root, new THREE.CapsuleGeometry(0.1, 0.12, 4, 8), glow(goods[i % 5], 0.35), -R + 0.45 + i * ((R * 2 - 0.9) / Math.max(1, 1 + L)), 1.0, 0.75);
    anim.push((t) => (c.rotation.z = Math.sin(t * 2 + i) * 0.15));
  }
  for (let i = 0; i < 1 + L; i++) mk(root, box(0.45, 0.45, 0.45), T(0xb07a4f, 0.9), -R - 0.2 + i * 0.5, 0.23, -0.6, 0, i * 0.4, 0);
  if (L >= 2) for (const s of [-1, 1]) {
    const lan = mk(root, sph(0.1, 8, 6), glow(0xffb84d, 1.4), s * R * 0.9, 1.65, 1.0);
    anim.push((t) => (lan.position.x = s * R * 0.9 + Math.sin(t * 2 + s) * 0.03));
  }
  return { root, anim };
}

/* ------------------------------------------------------------------ decor */

export function buildDecor(id: string): Parts {
  const root = new THREE.Group();
  const anim: Parts['anim'] = [];
  switch (id) {
    case 'flowers': {
      const cols = [0xff6bb5, 0xffe27a, 0xb49be0, 0xffffff, 0xff8a5b];
      mk(root, cyl(1.0, 1.05, 0.2, 16), T(0x8a5a3b, 0.95), 0, 0.1, 0);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4, r = 0.2 + (i % 4) * 0.2;
        mk(root, cyl(0.02, 0.02, 0.3, 4), T(PAL.leafDark), Math.cos(a) * r, 0.35, Math.sin(a) * r);
        const f = mk(root, sph(0.09, 8, 6), T(cols[i % 5], 0.6), Math.cos(a) * r, 0.52, Math.sin(a) * r);
        anim.push((t) => (f.position.y = 0.52 + Math.sin(t * 2 + i) * 0.02));
      }
      break;
    }
    case 'lanterns': {
      for (const x of [-1.5, 1.5]) mk(root, box(0.1, 2, 0.1), T(PAL.wood), x, 1, 0);
      const cols = [0xffb84d, 0x6ff7ff, 0xff6bb5, 0x9dff8a];
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const b = mk(root, sph(0.08, 8, 6), glow(cols[i % 4], 1.6), -1.5 + k * 3, 1.9 - Math.sin(k * Math.PI) * 0.4, 0);
        anim.push((t) => ((b.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(t * 3 + i) * 0.5));
      }
      break;
    }
    case 'mushrooms': {
      for (const [x, z, s] of [[0, 0, 1], [0.8, 0.4, 0.6], [-0.6, 0.5, 0.45]] as const) {
        mk(root, cyl(0.12 * s, 0.18 * s, 1.1 * s, 10), T(0xfff4e0), x, 0.55 * s, z);
        const cap = mk(root, new THREE.SphereGeometry(0.55 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), T(0xb45cff, 0.5, { emissive: 0x6b2fb3, ei: 0.3 }), x, 1.05 * s, z);
        cap.scale.y = 0.6;
      }
      break;
    }
    case 'flag': {
      mk(root, cyl(0.05, 0.06, 3, 8), T(0xdddddd, 0.3, { metal: 0.5 }), 0, 1.5, 0);
      mk(root, sph(0.09, 8, 6), T(0xffc83d, 0.3, { metal: 0.6 }), 0, 3.02, 0);
      const f = mk(root, box(1.1, 0.7, 0.03), T(0x6ff7ff, 0.7), 0.58, 2.55, 0);
      mk(root, sph(0.18, 10, 8), T(0xffffff, 0.6), 0.58, 2.55, 0.03).scale.z = 0.2;
      anim.push((t) => {
        f.rotation.y = Math.sin(t * 2.8) * 0.3;
      });
      break;
    }
    case 'hammock': {
      for (const x of [-1.2, 1.2]) mk(root, box(0.12, 1.4, 0.12), T(PAL.wood), x, 0.7, 0);
      const cloth = mk(root, new THREE.CylinderGeometry(0.45, 0.45, 2.3, 16, 1, true, Math.PI * 0.5, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3fc6c0, roughness: 0.8, side: THREE.DoubleSide }), 0, 1.05, 0, 0, 0, Math.PI / 2);
      anim.push((t) => (cloth.rotation.x = Math.sin(t * 1.2) * 0.12));
      break;
    }
    case 'bath': {
      mk(root, cyl(0.9, 0.7, 0.5, 20), T(PAL.stone, 0.9), 0, 0.25, 0);
      const w = mk(root, cyl(0.78, 0.78, 0.06, 20), toyMaterial(PAL.water, { rough: 0.15, emissive: 0x2a7fa0, emissiveIntensity: 0.3 }), 0, 0.47, 0);
      w.castShadow = false;
      mk(root, cyl(0.1, 0.14, 0.6, 8), T(PAL.stone, 0.9), 0, 0.75, 0);
      mk(root, sph(0.18, 12, 10), T(0x6ff7ff, 0.4, { emissive: 0x6ff7ff, ei: 0.3 }), 0, 1.15, 0);
      for (const s of [-1, 1]) mk(root, sph(0.05, 6, 6), T(0x2b2238), s * 0.07, 1.2, 0.15);
      break;
    }
    case 'gnome': {
      mk(root, cyl(0.25, 0.32, 0.5, 12), T(0x3fa0ff, 0.7), 0, 0.25, 0);
      mk(root, sph(0.2, 12, 10), T(0xffd3b0), 0, 0.62, 0);
      mk(root, new THREE.ConeGeometry(0.2, 0.5, 12), T(0xd94a3a), 0, 0.95, 0);
      mk(root, new THREE.ConeGeometry(0.15, 0.3, 10), T(0xffffff), 0, 0.5, 0.12, Math.PI, 0, 0);
      break;
    }
  }
  return { root, anim };
}
