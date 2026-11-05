import { useEffect } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { useProjectRole } from '../../app/settings/projectRole';
import { ROLE_DEPARTMENTS } from '../../core/model/departmentStatus';
import { useSelection } from './selection';

/**
 * Opening a frame long enough to look at it marks it Seen by this person's department (polish 6b): the one their
 * role on the project stands for (the DP: Camera; Director and DP: Direction and Camera). Arrowing past a frame
 * doesn't count. No role, or one with no department, marks nothing.
 */
export const SEEN_AFTER_MS = 600;

export function useMarkSeen(): void {
  const shotId = useSelection((s) => s.shotId);
  const projectId = useProject((s) => s.project?.projectId);
  // The file too: a version copy has the same ids, and a mark waiting for one mustn't land in the other.
  const path = useProject((s) => s.project?.file.path);
  const role = useProjectRole(projectId);
  // Only whether it's a live frame: an edit to it mustn't restart the wait.
  const live = useProject((s) => {
    const record = shotId ? s.records[shotId] : undefined;
    return record?.type === 'shot' && record.trashedAt === null;
  });
  useEffect(() => {
    if (!shotId || !live || !role) return;
    const departments = ROLE_DEPARTMENTS[role];
    if (departments.length === 0) return;
    const timer = setTimeout(() => {
      void projectStore.getState().markSeen(shotId, departments);
    }, SEEN_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shotId, live, role, path]);
}

/** Renders nothing: it only marks frames Seen. */
export function MarkSeen(): null {
  useMarkSeen();
  return null;
}
