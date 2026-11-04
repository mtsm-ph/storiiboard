import type { SbdRecord } from '../../core/model/record';
import { board, type BoardScene } from '../storyboard/board';

// What an export covers (1.24, CLAUDE.md: per scene or whole project): the scenes in board order, live records only,
// so the Trash never goes out with an export.

export type ExportScope = { kind: 'project' } | { kind: 'scene'; sceneId: string };

export function scenesIn(records: Readonly<Record<string, SbdRecord>>, projectId: string, scope: ExportScope): BoardScene[] {
  const scenes = board(records, projectId);
  return scope.kind === 'project' ? scenes : scenes.filter((scene) => scene.record.id === scope.sceneId);
}
