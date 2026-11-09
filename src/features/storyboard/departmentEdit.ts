import { projectStore } from '../../app/projectStore';
import { departmentStatusChange, departmentStatuses, type DepartmentStatuses } from '../../core/model/departmentStatus';

/**
 * A department status edit on a frame (polish 6), from the inspector or a department's workspace (3.6a): worked out
 * from the frame as it is when the edit lands, as custom fields are, so two quick ticks both stay. Null changes nothing.
 */
export function editDepartmentStatus(shotId: string, edit: (now: DepartmentStatuses) => DepartmentStatuses | null): void {
  void projectStore.getState().applyWith((now) => {
    const current = now[shotId];
    const next = current ? edit(departmentStatuses(current.props)) : null;
    return { changes: current && next ? [{ kind: 'update', id: shotId, ...departmentStatusChange(next) }] : [] };
  });
}
