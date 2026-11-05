import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { approverRoles, type Approval, type ProjectRole } from '../../core/model/departmentStatus';
import { loadSettings, MAX_PROJECT_ROLES, saveSettings } from '../../core/storage/settings';
import { editAuthor, NO_AUTHOR, profileStore, useProfile } from './profileStore';

// "Your role on this project" (polish 6, Settings → Project): the person's role on one project, in place of their
// profile's usual role there. It says what they can approve on a shot, and (polish 6b) which department opening a
// shot marks Seen. Kept on this computer by project id, like the profile, until Phase 3 brings people and roles.

export const projectRoleStore = createStore<Readonly<Record<string, ProjectRole>>>()(() => loadSettings().projectRoles);

/** Sets this person's role on a project, or null to go back to their usual role there. */
export function setProjectRole(projectId: string, role: ProjectRole | null): void {
  const others = Object.entries(projectRoleStore.getState()).filter(([id]) => id !== projectId);
  // The newest last, so the oldest falls off first once there are too many.
  const next = Object.fromEntries((role ? [...others, [projectId, role] as const] : others).slice(-MAX_PROJECT_ROLES));
  projectRoleStore.setState(next, true);
  saveSettings({ projectRoles: next });
}

/** The role set for this project, or null when the usual one applies. */
export function useProjectRoleSet(projectId: string | undefined): ProjectRole | null {
  return useStore(projectRoleStore, (roles) => (projectId ? (roles[projectId] ?? null) : null));
}

/** The person's role on a project: its own, else their usual one, else none. */
export function useProjectRole(projectId: string | undefined): ProjectRole | null {
  const set = useProjectRoleSet(projectId);
  const usual = useProfile().role;
  return set ?? usual;
}

/** The role on a project, read outside React (an edit, a check). */
export function projectRoleOf(projectId: string): ProjectRole | null {
  return projectRoleStore.getState()[projectId] ?? profileStore.getState().role;
}

/** A new approval by this person, or null when their role on the project doesn't approve. */
export function approvalNow(role: ProjectRole | null, now = new Date()): Approval | null {
  const roles = approverRoles(role);
  // Signed as edits are (initials only when the person chose that), since an approval goes into the file's History too.
  const signed = editAuthor(profileStore.getState());
  return roles.length === 0 ? null : { name: signed === NO_AUTHOR ? '' : signed, roles, at: now.toISOString() };
}
