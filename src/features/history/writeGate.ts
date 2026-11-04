// One restore or Put back at a time in the History tile (1.22), like the Trash's restore. Each adds a step at the top,
// so every row moves down one: a second click while the first is writing, or just after, would land on the row that
// moved under the pointer and restore a different point. So clicks wait until the rows have been read again for
// records newer than the click, and have then stood still for about a double click.

/** How long the rows must stand still, once read again, before a click on them counts. */
export const SETTLE_MS = 500;

export type GateView = 'steps' | 'frame';

export interface WriteGate {
  /** The store's records numbered in the order the tile sees them, which is the order they were written. */
  versionOf: (records: object) => number;
  /** Takes the one write allowed at a time, or says no while one is in flight or its rows are settling. */
  take: (view: GateView, records: object) => boolean;
  /** The write is done; `changed` false means nothing moved, so the next click counts at once. */
  written: (changed: boolean) => void;
  /** A view's rows were read again, for records of this version. */
  read: (view: GateView, version: number) => void;
}

export function createWriteGate(now: () => number = () => performance.now(), settleMs = SETTLE_MS): WriteGate {
  const versions = new WeakMap<object, number>();
  let seen = 0;
  const versionOf = (records: object): number => {
    const known = versions.get(records);
    if (known !== undefined) return known;
    seen += 1;
    versions.set(records, seen);
    return seen;
  };
  let writing: { view: GateView; since: number; written: boolean } | null = null;
  let quietUntil = 0;
  const lastRead: Record<GateView, number> = { steps: 0, frame: 0 };
  const settle = () => {
    if (!writing?.written || lastRead[writing.view] <= writing.since) return;
    writing = null;
    quietUntil = now() + settleMs;
  };
  return {
    versionOf,
    take: (view, records) => {
      if (writing !== null || now() < quietUntil) return false;
      writing = { view, since: versionOf(records), written: false };
      return true;
    },
    written: (changed) => {
      if (!writing) return;
      if (!changed) {
        writing = null;
        return;
      }
      writing.written = true;
      // Its rows may have been read again before the write said it was done.
      settle();
    },
    read: (view, version) => {
      lastRead[view] = Math.max(lastRead[view], version);
      settle();
    },
  };
}
