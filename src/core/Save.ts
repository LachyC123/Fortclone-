/**
 * Everything the game keeps between visits lives in `localStorage` under `rr.*` keys (settings,
 * bugs, training done, profile, trophies...). That isn't always enough: inside a claude.ai page
 * the browser's storage can come back empty next visit. So:
 *
 *  - reads and writes keep working even when storage throws (an in-memory copy backs them), and
 *  - when the page runs on claude.ai with the `db` + `user` capabilities, the `rr.*` keys are
 *    mirrored to the player's own private document (`data/users/<id>/save`) and pulled back on
 *    the next visit. Everywhere else (npm run dev / LAN) it's plain localStorage.
 */

const PREFIX = 'rr.';
const STAMP = 'rr.savedAt';
const mem = new Map<string, string>();
let pushTimer = 0;
let pushing = false;
let dirty = false;
let ref: { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> } | null = null;
let lastPushed = '';

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** install the storage safety net and change tracking (call once, before anything reads a save) */
export function installSave() {
  const proto = Storage.prototype;
  const rawGet = proto.getItem;
  const rawSet = proto.setItem;
  const rawRemove = proto.removeItem;
  const isLocal = (s: Storage) => s === ls();
  proto.getItem = function (this: Storage, k: string) {
    let v: string | null = null;
    try {
      v = rawGet.call(this, k);
    } catch {
      /* storage blocked */
    }
    if (v === null && isLocal(this) && mem.has(k)) v = mem.get(k)!;
    return v;
  };
  proto.setItem = function (this: Storage, k: string, v: string) {
    const local = isLocal(this);
    if (local) mem.set(k, String(v));
    try {
      rawSet.call(this, k, v);
    } catch {
      if (!local) throw new Error('storage unavailable');
    }
    if (local && k.startsWith(PREFIX) && k !== STAMP) changed();
  };
  proto.removeItem = function (this: Storage, k: string) {
    if (isLocal(this)) mem.delete(k);
    try {
      rawRemove.call(this, k);
    } catch {
      /* ignore */
    }
    if (isLocal(this) && k.startsWith(PREFIX)) changed();
  };
}

function allKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  const s = ls();
  const keys = new Set<string>(mem.keys());
  try {
    if (s) for (let i = 0; i < s.length; i++) keys.add(s.key(i)!);
  } catch {
    /* ignore */
  }
  for (const k of keys) {
    if (!k.startsWith(PREFIX) || k === STAMP) continue;
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

function changed() {
  localStorage.setItem(STAMP, String(Date.now()));
  dirty = true;
  if (!ref) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(push, 1500);
}

async function push() {
  if (!ref || pushing || !dirty) return;
  const keys = allKeys();
  // field names can't carry dots in every store: rr.bugs -> rr_bugs
  const body: Record<string, unknown> = { savedAt: Number(localStorage.getItem(STAMP) || Date.now()) };
  for (const [k, v] of Object.entries(keys)) body[k.replace(/\./g, '_')] = v;
  const sig = JSON.stringify(keys);
  if (sig === lastPushed) {
    dirty = false;
    return;
  }
  pushing = true;
  dirty = false;
  try {
    await ref.set(body);
    lastPushed = sig;
  } catch {
    dirty = true; // try again on the next change
  } finally {
    pushing = false;
  }
}

type CloudWindow = Window & { claude?: { use(name: string): Promise<unknown> } };

/**
 * Connect to the player's cloud save (claude.ai only). Resolves true when a newer save was
 * pulled into storage — the caller should reload its state from storage then.
 */
export async function connectCloudSave(): Promise<boolean> {
  const c = (window as CloudWindow).claude;
  if (!c?.use) return false;
  try {
    const [db, user] = (await Promise.all([c.use('db'), c.use('user')])) as [
      { doc(p: string): typeof ref } | null,
      { id(): Promise<string | null> } | null,
    ];
    if (!db || !user) return false;
    const uid = await user.id();
    if (!uid) return false;
    const r = db.doc(`data/users/${uid}/save`)!;
    let pulled = false;
    const snap = await r.get();
    if (snap.exists) {
      const d = snap.data() ?? {};
      const cloudAt = Number(d.savedAt ?? 0);
      const localAt = Number(localStorage.getItem(STAMP) || 0);
      if (cloudAt > localAt) {
        for (const [k, v] of Object.entries(d)) {
          if (!k.startsWith('rr_') || typeof v !== 'string') continue;
          const key = 'rr.' + k.slice(3);
          mem.set(key, v);
          try {
            window.localStorage.setItem(key, v);
          } catch {
            /* the in-memory copy has it */
          }
        }
        mem.set(STAMP, String(cloudAt));
        try {
          window.localStorage.setItem(STAMP, String(cloudAt));
        } catch {
          /* ignore */
        }
        lastPushed = JSON.stringify(allKeys());
        dirty = false;
        pulled = true;
      }
    }
    ref = r;
    // anything saved before we connected (or a local save newer than the cloud) goes up now
    if (!pulled && Object.keys(allKeys()).length) {
      dirty = true;
      void push();
    }
    // don't lose the last change when the tab closes
    window.addEventListener('pagehide', () => void push());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void push();
    });
    return pulled;
  } catch {
    return false;
  }
}
