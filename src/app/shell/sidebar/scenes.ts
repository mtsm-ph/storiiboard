import type { SbdRecord } from '../../../core/model/record';

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

export { sceneLabel } from '../../../core/model/storyboard';
export { addScene as addSceneChange } from '../../../features/storyboard/board';
