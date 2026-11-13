import { keyBetween } from '../../core/ops/order';
import type { ReorderMode } from './types';

// Z order is the items' sibling order (docs/SBD_FORMAT.md, Boards): the first is at the back. These work on a list of
// ids from back to front and on the sort keys that keep it.

/**
 * The order after moving the selected ids: one step forward or backward (each past the nearest unselected neighbour,
 * the selected keeping their order among themselves), or to the very front or back.
 */
export function reordered(order: readonly string[], selected: ReadonlySet<string>, mode: ReorderMode): string[] {
  const chosen = order.filter((id) => selected.has(id));
  const others = order.filter((id) => !selected.has(id));
  if (chosen.length === 0) return [...order];
  if (mode === 'front') return [...others, ...chosen];
  if (mode === 'back') return [...chosen, ...others];
  const next = [...order];
  if (mode === 'forward') {
    // From the front down, so a selected item never steps over another selected one.
    for (let i = next.length - 2; i >= 0; i -= 1) {
      const here = next[i];
      const above = next[i + 1];
      if (here !== undefined && above !== undefined && selected.has(here) && !selected.has(above)) {
        next[i] = above;
        next[i + 1] = here;
      }
    }
  } else {
    for (let i = 1; i < next.length; i += 1) {
      const here = next[i];
      const below = next[i - 1];
      if (here !== undefined && below !== undefined && selected.has(here) && !selected.has(below)) {
        next[i] = below;
        next[i - 1] = here;
      }
    }
  }
  return next;
}

/**
 * The new sort keys that give `after` as the order, for the moved ids only: everything else keeps its key, so a reorder
 * of several items writes those items' rows and no others. Empty when the order didn't change.
 */
export function sortKeysFor(
  before: readonly string[],
  after: readonly string[],
  keyOf: ReadonlyMap<string, string>,
  moved: ReadonlySet<string>,
): Map<string, string> {
  const keys = new Map<string, string>();
  if (before.length === after.length && before.every((id, i) => id === after[i])) return keys;
  let previous: string | null = null;
  for (let i = 0; i < after.length; i += 1) {
    const id = after[i];
    if (id === undefined) continue;
    if (!moved.has(id)) {
      previous = keyOf.get(id) ?? previous;
      continue;
    }
    // The next item that stays where its key says.
    let next: string | null = null;
    for (let j = i + 1; j < after.length; j += 1) {
      const other = after[j];
      if (other !== undefined && !moved.has(other)) {
        next = keyOf.get(other) ?? null;
        break;
      }
    }
    // Already between its neighbours: it stays as it is, and writes nothing.
    const own = keyOf.get(id);
    if (own !== undefined && (previous === null || own > previous) && (next === null || own < next)) {
      previous = own;
      continue;
    }
    const key = keyBetween(previous, next);
    keys.set(id, key);
    previous = key;
  }
  return keys;
}
