// One restore or Put back at a time in the History tile (1.22), like the Trash's restore. Each adds a step at the top,
// so every row moves down one: a second click while the first is writing, or just after, would land on the row that
// moved under the pointer and restore a different point. So clicks wait until the rows have been read again for
// records newer than the click, and have then stood still for about a double click. If those rows stop being read
// (the item filter turned off, the item deselected or trashed, a read that failed), nothing would ever open the gate
// again, so it opens then too, and in any case a few seconds after the write.

/** How long the rows must stand still, once read again, before a click on them counts. */
export const SETTLE_MS = 500;
/** The longest a write keeps the gate shut once done, whatever happens to its rows: a backstop, never the rule. */
export const GIVE_UP_MS = 5000;

export type GateView = 'steps' | 'item';

export interface WriteGate {
  /** The store's records numbered in the order the tile sees them, which is the order they were written. */
  versionOf: (records: object) => number;
  /** Takes the one write allowed at a time, or says no while one is in flight or its rows are settling. */
  take: (view: GateView, records: object) => boolean;
  /** The write is done; `changed` false means nothing moved, so the next click counts at once. */
  written: (changed: boolean) => void;
  /** A view's rows were read again, for records of this version. */
  read: (view: GateView, version: number) => void;
  /** A view's rows won't be read again for now (it's off screen, or its read failed): a write waiting on it lets go. */
  gone: (view: GateView) => void;
}

export function createWriteGate(now: () => number = () => performance.now(), settleMs = SETTLE_MS, giveUpMs = GIVE_UP_MS): WriteGate {
  const versions = new WeakMap<object, number>();
  let seen = 0;
  const versionOf = (records: object): number => {
    const known = versions.get(records);
    if (known !== undefined) return known;
    seen += 1;
    versions.set(records, seen);
    return seen;
  };
  /** `writtenAt` is when the write said it was done; `gone` that its view stopped being read meanwhile. */
  let writing: { view: GateView; since: number; writtenAt: number | null; gone: boolean } | null = null;
  let quietUntil = 0;
  const lastRead: Record<GateView, number> = { steps: 0, item: 0 };
  const settle = () => {
    if (writing === null || writing.writtenAt === null) return;
    const giveUp = now() - writing.writtenAt >= giveUpMs;
    if (!writing.gone && !giveUp && lastRead[writing.view] <= writing.since) return;
    writing = null;
    quietUntil = giveUp ? 0 : now() + settleMs;
  };
  return {
    versionOf,
    take: (view, records) => {
      settle();
      if (writing !== null || now() < quietUntil) return false;
      writing = { view, since: versionOf(records), writtenAt: null, gone: false };
      return true;
    },
    written: (changed) => {
      if (!writing) return;
      if (!changed) {
        writing = null;
        return;
      }
      writing.writtenAt = now();
      // Its rows may have been read again, or gone, before the write said it was done.
      settle();
    },
    read: (view, version) => {
      lastRead[view] = Math.max(lastRead[view], version);
      settle();
    },
    gone: (view) => {
      if (writing?.view !== view) return;
      writing.gone = true;
      settle();
    },
  };
}
