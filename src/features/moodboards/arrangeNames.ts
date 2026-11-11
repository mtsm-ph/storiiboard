import type { SbdRecord } from '../../core/model/record';
import { alignItems, distributeItems, tidyItems } from '../../ui/canvas/arrange';
import type { AlignMode, GeometryChange } from '../../ui/canvas/types';
import { isFrameKind, itemFields } from './items';

// History names the layout commands (5.3) without the log knowing about them: an op group is only its records' before and
// after. A command writes a row for every item it covered, so the step is told by running the commands again on the
// items as they were and comparing with how they ended up. A drag moves every item the same distance, which none of
// the commands does, so the two are never taken for each other.

export type Arranged = 'align' | 'distribute' | 'row' | 'column' | 'grid';

const ALIGN_MODES: readonly AlignMode[] = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
const CLOSE = 0.011;

type Row = { id: string; before: SbdRecord['props']; after: SbdRecord['props'] };

/**
 * The rows a layout command covered itself: those that sat wholly inside a section it moved, and moved by exactly that
 * section's distance, were only carried along, so they are left out (and not counted in the step's words).
 */
export function coveredRows<T extends Row>(rows: readonly T[]): T[] {
  const parsed = rows.map((row) => ({ row, before: itemFields(row.before), after: itemFields(row.after) }));
  const moved = parsed.flatMap(({ row, before, after }) =>
    before && isFrameKind(before.kind) && after && after.width === before.width && after.height === before.height && (after.x !== before.x || after.y !== before.y)
      ? [{ id: row.id, box: before, dx: after.x - before.x, dy: after.y - before.y }]
      : [],
  );
  return parsed
    .filter(({ row, before, after }) => {
      if (!before || !after) return true;
      return !moved.some(
        (m) =>
          m.id !== row.id &&
          before.x >= m.box.x && before.y >= m.box.y && before.x + before.width <= m.box.x + m.box.width && before.y + before.height <= m.box.y + m.box.height &&
          Math.abs(after.x - before.x - m.dx) < CLOSE && Math.abs(after.y - before.y - m.dy) < CLOSE,
      );
    })
    .map((p) => p.row);
}

/** What the items' step was, given each one's props before and after; null when it was none of them. */
export function arrangedAs(rows: readonly { id: string; before: SbdRecord['props']; after: SbdRecord['props'] }[]): Arranged | null {
  if (rows.length < 2) return null;
  const before = rows.flatMap((row) => {
    const fields = itemFields(row.before);
    return fields ? [{ id: row.id, ...fields }] : [];
  });
  const after = new Map(rows.map((row) => [row.id, itemFields(row.after)]));
  if (before.length !== rows.length) return null;
  // Something must have moved: a step that changed no place is not a layout.
  if (before.every((b) => { const a = after.get(b.id); return a && a.x === b.x && a.y === b.y; })) return null;
  const produces = (changes: readonly GeometryChange[]): boolean =>
    changes.length > 0 &&
    before.every((b) => {
      const want = changes.find((c) => c.id === b.id) ?? b;
      const got = after.get(b.id);
      return got !== undefined && got !== null && Math.abs(got.x - want.x) < CLOSE && Math.abs(got.y - want.y) < CLOSE && got.width === b.width && got.height === b.height;
    });
  if (ALIGN_MODES.some((mode) => produces(alignItems(before, mode)))) return 'align';
  if (produces(distributeItems(before, 'horizontal')) || produces(distributeItems(before, 'vertical'))) return 'distribute';
  for (const mode of ['row', 'column', 'grid'] as const) if (produces(tidyItems(before, mode))) return mode;
  return null;
}
