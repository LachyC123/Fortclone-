import * as THREE from 'three';
import { CollisionWorld, ColFlags } from '../physics/Collision';

const LAYERS = 4;
const STEP = 0.55; // max height change between neighbouring cells (stairs ~0.4 per 0.5m cell)

/**
 * Layered navigation grid (0.75m cells, up to 3 walkable floors per cell). Baked once from the
 * collision world by casting down through every floor; a node is walkable if a standing rascal
 * fits. Stairs and ramps connect floors automatically because adjacent cells differ by less than
 * a step. A* + layer-aware string-pulling gives natural paths up to bedrooms and balconies.
 */
export class NavGrid {
  readonly cell = 0.5;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oz: number;
  /** per node (cell * LAYERS + layer) */
  walk: Uint8Array;
  groundY: Float32Array;
  cost: Uint8Array;

  constructor(private cw: CollisionWorld, halfSize: number) {
    this.w = Math.ceil((halfSize * 2) / this.cell);
    this.h = this.w;
    this.ox = -halfSize;
    this.oz = -halfSize;
    const n = this.w * this.h * LAYERS;
    this.walk = new Uint8Array(n);
    this.groundY = new Float32Array(n);
    this.cost = new Uint8Array(n);
  }

  bake() {
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = this.ox + (i + 0.5) * this.cell, z = this.oz + (j + 0.5) * this.cell;
        let y = 16;
        let layer = 0;
        for (let guard = 0; guard < 8 && layer < LAYERS && y > -3; guard++) {
          o.set(x, y, z);
          const hit = this.cw.raycast(o, down, y + 3, ColFlags.BlocksMove);
          if (!hit) break;
          if (hit.t < 0.001) {
            y -= 0.3; // started inside a slab: step through it
            continue;
          }
          const gy = hit.point.y;
          y = gy - 0.35;
          if (hit.normal.y < 0.7) continue;
          let ok = true;
          for (const hy of [0.45, 0.95, 1.3]) {
            p.set(x, gy + hy, z);
            if (this.cw.sphereOverlaps(p, 0.3, ColFlags.BlocksMove)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const node = (j * this.w + i) * LAYERS + layer;
          this.walk[node] = 1;
          this.groundY[node] = gy;
          layer++;
        }
      }
    // wall proximity cost (per layer, by height)
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++)
        for (let l = 0; l < LAYERS; l++) {
          const node = (j * this.w + i) * LAYERS + l;
          if (!this.walk[node]) continue;
          const y = this.groundY[node];
          let near = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && this.layerNear(i + di, j + dj, y, STEP) < 0) near++;
          this.cost[node] = near > 0 ? 3 : 0;
        }
  }

  /** layer index in cell (i,j) whose floor is within tol of y, or -1 */
  layerNear(i: number, j: number, y: number, tol = STEP): number {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    const base = (j * this.w + i) * LAYERS;
    let best = -1, bd = tol;
    for (let l = 0; l < LAYERS; l++) {
      if (!this.walk[base + l]) continue;
      const d = Math.abs(this.groundY[base + l] - y);
      if (d <= bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  /** any walkable layer in cell */
  isWalk(i: number, j: number) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    const base = (j * this.w + i) * LAYERS;
    for (let l = 0; l < LAYERS; l++) if (this.walk[base + l] === 1) return true;
    return false;
  }

  /** walkable at this world position & height? */
  isWalkAt(x: number, y: number, z: number) {
    const [i, j] = this.toCell(x, z);
    return this.layerNear(i, j, y, 1.0) >= 0;
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.ox) / this.cell), Math.floor((z - this.oz) / this.cell)];
  }

  nodeCenter(node: number, out = new THREE.Vector3()) {
    const c = Math.floor(node / LAYERS);
    const i = c % this.w, j = Math.floor(c / this.w);
    return out.set(this.ox + (i + 0.5) * this.cell, this.groundY[node], this.oz + (j + 0.5) * this.cell);
  }

  /** Nearest walkable node to a world position (prefers the floor you're on). */
  nearestNode(x: number, y: number, z: number): number {
    const [ci, cj] = this.toCell(x, z);
    for (let r = 0; r < 8; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (r > 0 && Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const l = this.layerNear(ci + di, cj + dj, y, 1.6);
          if (l >= 0) return ((cj + dj) * this.w + (ci + di)) * LAYERS + l;
        }
    return -1;
  }

  randomWalkable(rand: () => number, cx = 0, cz = 0, radius = 40, groundOnly = true): THREE.Vector3 | null {
    for (let k = 0; k < 60; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
      const n = this.nearestNode(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      if (n < 0) continue;
      if (groundOnly && this.groundY[n] > 0.6) continue;
      return this.nodeCenter(n);
    }
    return null;
  }

  /** Straight walk test that follows floors between two points (for string pulling). */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    let y = ay;
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const [i, j] = this.toCell(ax + dx * t, az + dz * t);
      const l = this.layerNear(i, j, y, STEP * 0.8);
      if (l < 0) return false;
      const node = (j * this.w + i) * LAYERS + l;
      if (this.cost[node] > 0) return false;
      y = this.groundY[node];
    }
    return Math.abs(y - by) < STEP;
  }

  private g = new Float32Array(0);
  private parent = new Int32Array(0);
  private stampArr = new Int32Array(0);
  private stamp = 0;

  /** A* over layered nodes. Returns smoothed world waypoints or null. */
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxNodes = 5000): THREE.Vector3[] | null {
    const start = this.nearestNode(from.x, from.y, from.z);
    const goal = this.nearestNode(to.x, to.y, to.z);
    if (start < 0 || goal < 0) return null;
    const N = this.w * this.h * LAYERS;
    if (this.g.length !== N) {
      this.g = new Float32Array(N);
      this.parent = new Int32Array(N);
      this.stampArr = new Int32Array(N);
    }
    const st = (this.stamp += 2);
    const heap: number[] = [];
    const f = new Map<number, number>();
    const push = (n: number, fv: number) => {
      f.set(n, fv);
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f.get(heap[p])! <= fv) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = n;
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        const fv = f.get(last)!;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i, mv = fv;
          if (l < heap.length && f.get(heap[l])! < mv) {
            m = l;
            mv = f.get(heap[l])!;
          }
          if (r < heap.length && f.get(heap[r])! < mv) m = r;
          if (m === i) break;
          heap[i] = heap[m];
          i = m;
        }
        heap[i] = last;
      }
      return top;
    };
    const gc = Math.floor(goal / LAYERS);
    const ex = gc % this.w, ez = Math.floor(gc / this.w), ey = this.groundY[goal];
    const hfn = (i: number, j: number, y: number) => {
      const dx = Math.abs(i - ex), dz = Math.abs(j - ez);
      return dx + dz + (1.414 - 2) * Math.min(dx, dz) + Math.abs(y - ey) * 0.8;
    };
    this.g[start] = 0;
    this.stampArr[start] = st;
    this.parent[start] = -1;
    {
      const c = Math.floor(start / LAYERS);
      push(start, hfn(c % this.w, Math.floor(c / this.w), this.groundY[start]));
    }
    let expanded = 0;
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.stampArr[cur] === st + 1) continue;
      this.stampArr[cur] = st + 1;
      if (++expanded > maxNodes) break;
      const cc = Math.floor(cur / LAYERS);
      const ci = cc % this.w, cj = Math.floor(cc / this.w);
      const cy = this.groundY[cur];
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const l = this.layerNear(ci + di, cj + dj, cy);
          if (l < 0) continue;
          if (di && dj && (this.layerNear(ci + di, cj, cy) < 0 || this.layerNear(ci, cj + dj, cy) < 0)) continue;
          const n = ((cj + dj) * this.w + (ci + di)) * LAYERS + l;
          if (this.stampArr[n] === st + 1) continue;
          const ng = this.g[cur] + (di && dj ? 1.414 : 1) + this.cost[n] * 0.35 + Math.abs(this.groundY[n] - cy) * 0.5;
          if (this.stampArr[n] !== st || ng < this.g[n]) {
            this.stampArr[n] = st;
            this.g[n] = ng;
            this.parent[n] = cur;
            push(n, ng + hfn(ci + di, cj + dj, this.groundY[n]));
          }
        }
    }
    if (!found) return null;
    const nodes: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) {
      nodes.push(c);
      if (c === start) break;
    }
    nodes.reverse();
    const pts = nodes.map((n) => this.nodeCenter(n));
    const out: THREE.Vector3[] = [];
    let anchor = new THREE.Vector3(from.x, this.groundY[start], from.z);
    let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = pts.length - 1; m > k + 1; m--) {
        if (this.clearLine(anchor.x, anchor.y, anchor.z, pts[m].x, pts[m].y, pts[m].z)) {
          far = m;
          break;
        }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    if (to.distanceTo(out[out.length - 1]) < 1.2) out[out.length - 1] = new THREE.Vector3(to.x, out[out.length - 1].y, to.z);
    return out;
  }
}
