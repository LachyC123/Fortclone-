import * as THREE from 'three';

/**
 * Turning recorded calls into JSON and back: vectors become {v:[x,y,z]}, numbers are rounded to
 * keep packets small, functions and three.js objects other than vectors are dropped.
 */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function enc(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v === undefined ? { u: 1 } : null;
  if (typeof v === 'number') return r3(v);
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof THREE.Vector3) return { v: [r3(v.x), r3(v.y), r3(v.z)] };
  if (Array.isArray(v)) return v.map((x) => enc(x, depth + 1));
  if (typeof v === 'object' && depth < 3) {
    if ((v as { isObject3D?: boolean }).isObject3D) return null;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x !== 'function') o[k] = enc(x, depth + 1);
    return o;
  }
  return null;
}

export function dec(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dec);
  const o = v as Record<string, unknown>;
  if (o.u === 1 && Object.keys(o).length === 1) return undefined;
  if (Array.isArray(o.v) && Object.keys(o).length === 1) {
    const a = o.v as number[];
    return new THREE.Vector3(a[0], a[1], a[2]);
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = dec(x);
  return out;
}

/** Wrap every method listed so each call is also recorded (unless muted). Returns the originals. */
export function tap(obj: Record<string, unknown>, names: string[], rec: (name: string, args: unknown[]) => void, muted: () => boolean) {
  const originals: Record<string, (...a: unknown[]) => unknown> = {};
  for (const n of names) {
    const f = obj[n];
    if (typeof f !== 'function') continue;
    const orig = (f as (...a: unknown[]) => unknown).bind(obj);
    originals[n] = orig;
    obj[n] = (...args: unknown[]) => {
      if (!muted()) rec(n, args);
      return orig(...args);
    };
  }
  return originals;
}
