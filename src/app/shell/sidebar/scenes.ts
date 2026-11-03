import type { SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';

// The scenes the sidebar lists under Storyboard. Views read records, never copy them (CLAUDE.md), so this works the
// list out from the project store each time.

export interface SceneEntry {
  id: string;
  /** As written on the slate: "4", "4A", "12". */
  number: string;
  name: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The project's scenes in board order, skipping the Trash. */
export function scenesOf(records: Readonly<Record<string, SbdRecord>>, projectId: string): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'scene' && r.parentId === projectId && r.trashedAt === null)
    // Sort keys compare byte by byte (src/core/ops/order.ts), so no locale-aware compare.
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

export function sceneEntries(records: Readonly<Record<string, SbdRecord>>, projectId: string): SceneEntry[] {
  return scenesOf(records, projectId).map((scene) => ({
    id: scene.id,
    number: text(scene.props.number),
    name: text(scene.props.name) || text(scene.props.heading),
  }));
}

/** "SC 04": a plain number gets two digits, as on the boards; a lettered one ("4A") is kept as the slate has it. */
export function sceneLabel(number: string): string {
  return `SC ${/^\d$/.test(number) ? number.padStart(2, '0') : number}`;
}

/** "+ Add Scene": one after the highest scene number, at the end of the board. */
export function addSceneChange(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
): Extract<Change, { kind: 'create' }> & { record: { id: string } } {
  const scenes = scenesOf(records, projectId);
  const highest = Math.max(0, ...scenes.map((s) => Number.parseInt(text(s.props.number), 10)).filter(Number.isFinite));
  return {
    kind: 'create',
    record: {
      // Made here, not by the op, so the sidebar can make the new scene the active one.
      id: crypto.randomUUID(),
      type: 'scene',
      parentId: projectId,
      sortKey: keyBetween(scenes.at(-1)?.sortKey ?? null, null),
      props: { number: String(highest + 1), name: '' },
    },
  };
}
