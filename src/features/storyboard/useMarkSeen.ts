import { useEffect } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { useMyPart } from '../../app/settings/projectRole';
import { useSelection } from './selection';

/**
 * Opening a frame long enough to look at it marks it Seen by this person's departments (polish 6b): the ones they
 * have in Cast and crew once they've picked themselves there (3.5c), else the ones their role on the project stands
 * for (the DP: Camera; Director and DP: Direction and Camera). Arrowing past a frame doesn't count. No department
 * marks nothing.
 */
export const SEEN_AFTER_MS = 600;

export function useMarkSeen(): void {
  const shotId = useSelection((s) => s.shotId);
  const projectId = useProject((s) => s.project?.projectId);
  // The file too: a version copy has the same ids, and a mark waiting for one mustn't land in the other.
  const path = useProject((s) => s.project?.file.path);
  const { departments } = useMyPart(projectId);
  // As text, so a new array with the same departments (any edit to the person) doesn't restart the wait.
  const seenBy = departments.join(',');
  // Only whether it's a live frame: an edit to it mustn't restart the wait.
  const live = useProject((s) => {
    const record = shotId ? s.records[shotId] : undefined;
    return record?.type === 'shot' && record.trashedAt === null;
  });
  useEffect(() => {
    if (!shotId || !live || seenBy === '') return;
    const marked = seenBy.split(',') as typeof departments;
    const timer = setTimeout(() => {
      void projectStore.getState().markSeen(shotId, marked);
    }, SEEN_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shotId, live, seenBy, path]);
}

/** Renders nothing: it only marks frames Seen. */
export function MarkSeen(): null {
  useMarkSeen();
  return null;
}
