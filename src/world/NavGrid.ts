import * as THREE from 'three';
import { CollisionWorld, ColFlags } from '../physics/Collision';

/**
 * Ground-level navigation grid (1 cell = 0.75m). Baked once from the collision world: a cell is
 * walkable if a standing rascal fits there. A* + string-pulling gives natural-looking paths.
 * Upper floors/rooftops are reached by bots through the Blinkbug (and stairs later via links).
 */
export class NavGrid {
  readonly cell = 0.75;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oz: number;
  walk: Uint8Array;
  groundY: Float32Array;
  /** extra cost near walls so bots don't hug corners */
  cost: Uint8Array;

  constructor(private cw: CollisionWorld, halfSize: number) {
    this.w = Math.ceil((halfSize * 2) / this.cell);
    this.h = this.w;
    this.ox = -halfSize;
    this.oz = -halfSize;
    this.walk = new Uint8Array(this.w * this.h);
    this.groundY = new Float32Array(this.w * this.h);
    this.cost = new Uint8Array(this.w * this.h);
  }

  bake() {
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const idx = j * this.w + i;
        const x = this.ox + (i + 0.5) * this.cell, z = this.oz + (j + 0.5) * this.cell;
        o.set(x, 1.3, z);
        const hit = this.cw.raycast(o, down, 3, ColFlags.BlocksMove);
        if (!hit || hit.normal.y < 0.7 || hit.point.y > 0.6) continue;
        const gy = hit.point.y;
        let ok = true;
        for (const hy of [0.45, 0.95, 1.3]) {
          p.set(x, gy + hy, z);
          if (this.cw.sphereOverlaps(p, 0.34, ColFlags.BlocksMove)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          this.walk[idx] = 1;
          this.groundY[idx] = gy;
        }
      }
    // wall proximity cost
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const idx = j * this.w + i;
        if (!this.walk[idx]) continue;
        let near = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (!this.isWalk(i + di, j + dj)) near++;
        this.cost[idx] = near > 0 ? 3 : 0;
      }
  }

  isWalk(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 1;
  }
  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.ox) / this.cell), Math.floor((z - this.oz) / this.cell)];
  }
  cellCenter(i: number, j: number, out = new THREE.Vector3()) {
    return out.set(this.ox + (i + 0.5) * this.cell, this.groundY[j * this.w + i] ?? 0, this.oz + (j + 0.5) * this.cell);
  }

  nearestWalkable(x: number, z: number): [number, number] | null {
    const [ci, cj] = this.toCell(x, z);
    if (this.isWalk(ci, cj)) return [ci, cj];
    for (let r = 1; r < 8; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (this.isWalk(ci + di, cj + dj)) return [ci + di, cj + dj];
        }
    return null;
  }

  randomWalkable(rand: () => number, cx = 0, cz = 0, radius = 40): THREE.Vector3 | null {
    for (let k = 0; k < 60; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
      const c = this.nearestWalkable(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      if (c) return this.cellCenter(c[0], c[1]);
    }
    return null;
  }

  /** Straight-line walkability test across the grid (for path smoothing). */
  clearLine(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const [i, j] = this.toCell(ax + dx * t, az + dz * t);
      if (!this.isWalk(i, j) || this.cost[j * this.w + i] > 0) return false;
    }
    return true;
  }

  private open = new Int32Array(0);
  private g = new Float32Array(0);
  private parent = new Int32Array(0);
  private closedStamp = new Int32Array(0);
  private stamp = 0;

  /** A* (8-connected, octile heuristic). Returns smoothed world waypoints or null. */
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxNodes = 4000): THREE.Vector3[] | null {
    const s = this.nearestWalkable(from.x, from.z);
    const e = this.nearestWalkable(to.x, to.z);
    if (!s || !e) return null;
    const N = this.w * this.h;
    if (this.g.length !== N) {
      this.g = new Float32Array(N);
      this.parent = new Int32Array(N);
      this.closedStamp = new Int32Array(N);
      this.open = new Int32Array(N);
    }
    const st = ++this.stamp * 2;
    const start = s[1] * this.w + s[0], goal = e[1] * this.w + e[0];
    // binary heap on f
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
    const ex = e[0], ez = e[1];
    const hfn = (i: number, j: number) => {
      const dx = Math.abs(i - ex), dz = Math.abs(j - ez);
      return dx + dz + (1.414 - 2) * Math.min(dx, dz);
    };
    this.g[start] = 0;
    this.closedStamp[start] = st; // "seen"
    this.parent[start] = -1;
    push(start, hfn(s[0], s[1]));
    let expanded = 0;
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closedStamp[cur] === st + 1) continue;
      this.closedStamp[cur] = st + 1;
      if (++expanded > maxNodes) break;
      const ci = cur % this.w, cj = (cur / this.w) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.isWalk(ni, nj)) continue;
          if (di && dj && (!this.isWalk(ci + di, cj) || !this.isWalk(ci, cj + dj))) continue; // no corner cutting
          const n = nj * this.w + ni;
          if (this.closedStamp[n] === st + 1) continue;
          const ng = this.g[cur] + (di && dj ? 1.414 : 1) + this.cost[n] * 0.35;
          if (this.closedStamp[n] !== st || ng < this.g[n]) {
            this.closedStamp[n] = st;
            this.g[n] = ng;
            this.parent[n] = cur;
            push(n, ng + hfn(ni, nj));
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) {
      cells.push(c);
      if (c === start) break;
    }
    cells.reverse();
    const pts = cells.map((c) => this.cellCenter(c % this.w, (c / this.w) | 0));
    // string pulling
    const out: THREE.Vector3[] = [];
    let anchor = new THREE.Vector3(from.x, 0, from.z);
    let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = pts.length - 1; m > k + 1; m--) {
        if (this.clearLine(anchor.x, anchor.z, pts[m].x, pts[m].z)) {
          far = m;
          break;
        }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    const [ti, tj] = this.toCell(to.x, to.z);
    if (this.isWalk(ti, tj)) out[out.length - 1] = new THREE.Vector3(to.x, out[out.length - 1].y, to.z);
    return out;
  }
}
