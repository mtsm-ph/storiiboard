import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ProjectFile } from '../core/storage/driver';

// Where History's undo outline settles (item 7, Kevin, Nov 18): the place in the log up to which a run of undos or a
// restore no longer shows its outline and "Bring back what was undone". Kept in memory per open file, never stored: a
// project opened (a switch, a reopen, a reload) starts settled at its newest step, and Ctrl+S settles everything so far.
// Three further steps settle a run too, which History reads from the log itself (undone.ts).

const settled = new WeakMap<ProjectFile, number>();

/** Bumped at every settle, so History draws again. */
const settleStore = createStore<{ version: number }>()(() => ({ version: 0 }));

/** Settles every step in the file so far: none of them shows an outline or the button from here on. */
export async function settleUndone(file: ProjectFile): Promise<void> {
  const [row] = await file.query('SELECT coalesce(max(seq), 0) AS seq FROM op_groups');
  const seq = Number(row?.seq ?? 0);
  const known = settled.get(file);
  if (known !== undefined && known >= seq) return;
  settled.set(file, seq);
  settleStore.setState((s) => ({ version: s.version + 1 }));
}

/** The place in the log up to which runs have settled; 0 for a file never settled. */
export function settledThrough(file: ProjectFile): number {
  return settled.get(file) ?? 0;
}

/** Changes whenever a settle moves, for a component that reads settledThrough. */
export function useUndoSettle(): number {
  return useStore(settleStore, (s) => s.version);
}
