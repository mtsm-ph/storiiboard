import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { approverRoles, type Approval, type ProjectRole } from '../../core/model/departmentStatus';
import { myPart, type MyPart } from '../../core/model/person';
import { useProject } from '../projectStore';
import { loadSettings, MAX_PROJECT_ROLES, saveSettings } from '../../core/storage/settings';
import { editAuthor, NO_AUTHOR, profileStore, useProfile } from './profileStore';

// "Your role on this project" (polish 6, Settings → Project): the person's role on one project, in place of their
// profile's usual role there. It says what they can approve on a shot, and (polish 6b) which department opening a
// shot marks Seen. Kept on this computer by project id, like the profile.
//
// From 3.5c, picking yourself in the project's Cast and crew takes its place: that person's role and departments
// decide (docs/PHASE3_DECISIONS.md 4). Which person is you is kept on this computer too, never in the file, so a
// project shared with the crew says nothing about who opened it. The role here stays the fallback until you've picked
// yourself, or while the person you picked is in the Trash.

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

export const projectSelfStore = createStore<Readonly<Record<string, string>>>()(() => loadSettings().projectSelves);

/** Picks who you are in a project's Cast and crew, or null to stop being anyone there. */
export function setProjectSelf(projectId: string, personId: string | null): void {
  const others = Object.entries(projectSelfStore.getState()).filter(([id]) => id !== projectId);
  // The newest last, so the oldest falls off first once there are too many.
  const next = Object.fromEntries((personId ? [...others, [projectId, personId] as const] : others).slice(-MAX_PROJECT_ROLES));
  projectSelfStore.setState(next, true);
  saveSettings({ projectSelves: next });
}

/** The person you picked in this project's Cast and crew, by id, live or not; null for none. */
export function useProjectSelf(projectId: string | undefined): string | null {
  return useStore(projectSelfStore, (selves) => (projectId ? (selves[projectId] ?? null) : null));
}

/**
 * Your part on the open project: the person you picked in its Cast and crew (their role for approvals, their
 * departments for Seen), else the role kept on this computer, else your usual one.
 */
export function useMyPart(projectId: string | undefined): MyPart {
  const fallback = useProjectRole(projectId);
  const selfId = useProjectSelf(projectId);
  // Only the picked person's record, so an edit to anyone else doesn't make every reader draw again.
  const person = useProject((s) => (selfId ? s.records[selfId] : undefined));
  return myPart(person && selfId ? { [selfId]: person } : {}, projectId ?? '', selfId, fallback);
}

/** A new approval by this person, or null when their role on the project doesn't approve. */
export function approvalNow(role: ProjectRole | null, now = new Date()): Approval | null {
  const roles = approverRoles(role);
  // Signed as edits are (initials only when the person chose that), since an approval goes into the file's History too.
  const signed = editAuthor(profileStore.getState());
  return roles.length === 0 ? null : { name: signed === NO_AUTHOR ? '' : signed, roles, at: now.toISOString() };
}
