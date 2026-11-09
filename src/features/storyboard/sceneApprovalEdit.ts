import { projectStore } from '../../app/projectStore';
import type { Approval } from '../../core/model/departmentStatus';
import { approvalBasis, withMySceneApproval } from '../../core/model/sceneApprovals';

/**
 * This person's Approved tick on a scene's department (3.6b), from the inspector or a department's workspace. Worked
 * out from the scene as it is when the edit lands, fingerprint included, so the approval matches what was there when
 * it was given. `approval` is null for a role that approves nothing: then nothing changes.
 */
export function approveSceneDepartment(sceneId: string, department: string, approval: () => Approval | null): void {
  void projectStore.getState().applyWith((now) => {
    const scene = now[sceneId];
    const mine = approval();
    if (scene?.type !== 'scene' || scene.trashedAt !== null || !mine) return { changes: [] };
    const next = withMySceneApproval(scene.props, department, mine, approvalBasis(now, sceneId, department));
    return {
      changes: [next ? { kind: 'update', id: sceneId, set: { department_approvals: next } } : { kind: 'update', id: sceneId, unset: ['department_approvals'] }],
    };
  });
}
