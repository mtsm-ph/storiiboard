// The page's queue for map tiles (4.9). OpenStreetMap's tile policy asks for the tiles being viewed and nothing ahead,
// so a tile no longer in view must never be asked for: while a person zooms or pans, requests queued for views already
// left are dropped before they go out, and the newest view is served first. At most `limit` are out at once (Rust holds
// to 2 as well; this keeps the rest here, where they can still be taken back).

/** What a dropped tile's promise is rejected with: not an error to show, just a view that moved on. */
export class TileDropped extends Error {
  constructor() {
    super('tile no longer in view');
  }
}

interface Pending<T> {
  key: string;
  z: number;
  x: number;
  y: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface TileQueue<T> {
  /** Says which tiles are in view now; queued tiles outside it are dropped. Call before `get` for the view's tiles. */
  want: (tiles: readonly { z: number; x: number; y: number }[]) => void;
  /** The tile, queued if it isn't held. A tile held is not asked for again. */
  get: (z: number, x: number, y: number) => Promise<T>;
  /** Forgets what is held (a new tile server). Tiles in the queue are dropped. */
  forget: () => void;
  /** For tests: how many are out and how many wait. */
  stats: () => { outstanding: number; waiting: number };
}

interface Held<T> {
  value: Promise<T>;
  failedAt: number | null;
}

export function createTileQueue<T>(load: (z: number, x: number, y: number) => Promise<T>, limit: number, memory: number, retryAfter: number): TileQueue<T> {
  const held = new Map<string, Held<T>>();
  const queue: Pending<T>[] = [];
  let wanted = new Set<string>();
  let outstanding = 0;
  const keyOf = (z: number, x: number, y: number) => `${String(z)}/${String(x)}/${String(y)}`;

  const dropUnwanted = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      if (entry && !wanted.has(entry.key)) {
        queue.splice(i, 1);
        held.delete(entry.key);
        entry.reject(new TileDropped());
      }
    }
  };

  const pump = () => {
    dropUnwanted();
    while (outstanding < limit) {
      // The newest asked for goes first: it belongs to the view on screen now.
      const next = queue.pop();
      if (!next) return;
      outstanding++;
      load(next.z, next.x, next.y)
        .then(next.resolve, next.reject)
        .finally(() => {
          outstanding--;
          pump();
        });
    }
  };

  return {
    want(tiles) {
      wanted = new Set(tiles.map((tile) => keyOf(tile.z, tile.x, tile.y)));
      dropUnwanted();
    },
    get(z, x, y) {
      const key = keyOf(z, x, y);
      const known = held.get(key);
      if (known && (known.failedAt === null || Date.now() - known.failedAt < retryAfter)) {
        // Used again: it moves to the newest end.
        held.delete(key);
        held.set(key, known);
        return known.value;
      }
      const entry: Held<T> = {
        value: new Promise<T>((resolve, reject) => {
          queue.push({ key, z, x, y, resolve, reject });
        }),
        failedAt: null,
      };
      entry.value.catch((error: unknown) => {
        if (!(error instanceof TileDropped)) entry.failedAt = Date.now();
      });
      held.set(key, entry);
      while (held.size > memory) {
        const oldest = held.keys().next();
        if (oldest.done) break;
        held.delete(oldest.value);
      }
      pump();
      return entry.value;
    },
    forget() {
      held.clear();
      wanted = new Set();
      dropUnwanted();
    },
    stats: () => ({ outstanding, waiting: queue.length }),
  };
}
