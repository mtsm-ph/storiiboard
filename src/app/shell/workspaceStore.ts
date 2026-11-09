import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DEPARTMENTS, type Department } from '../../core/model/department';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { departmentOf, departmentWorkspaceId, type WorkspaceId } from './workspaces';

// Which workspace is on screen, and which department workspaces the sidebar lists (3.6a). The workspace on screen is
// where the person is, never saved; the list is theirs, kept in this computer's settings as their layouts are, so
// every project shows the same ones.

interface WorkspaceState {
  active: WorkspaceId;
  departments: readonly Department[];
}

export const workspaceStore = createStore<WorkspaceState>()(() => ({
  active: 'storyboard',
  departments: loadSettings().departmentWorkspaces,
}));

export function useWorkspaceState<T>(select: (state: WorkspaceState) => T): T {
  return useStore(workspaceStore, select);
}

export function showWorkspace(id: WorkspaceId): void {
  workspaceStore.setState({ active: id });
}

/** Opens a department's workspace, adding it to the sidebar if it isn't there yet. */
export function openDepartmentWorkspace(department: Department): void {
  const listed = workspaceStore.getState().departments;
  if (!listed.includes(department)) {
    // In the call sheet's order, as the settings read them back, whichever was opened first.
    const departments = DEPARTMENTS.filter((d) => d === department || listed.includes(d));
    saveSettings({ departmentWorkspaces: departments });
    workspaceStore.setState({ departments });
  }
  showWorkspace(departmentWorkspaceId(department));
}

/**
 * Takes a department's workspace off the sidebar. Its layout stays, for the next time it's opened. On screen, the
 * Storyboard takes its place, since that's where its frames are.
 */
export function closeDepartmentWorkspace(department: Department): void {
  const listed = workspaceStore.getState().departments;
  const departments = saveSettings({ departmentWorkspaces: listed.filter((d) => d !== department) }).departmentWorkspaces;
  const active = workspaceStore.getState().active;
  workspaceStore.setState({ departments, active: departmentOf(active) === department ? 'storyboard' : active });
}
