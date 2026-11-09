import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { openDepartmentWorkspace } from '../../app/shell/workspaceStore';
import type { Department } from '../../core/model/department';

/**
 * A department's workspace from its row on a frame (3.6a): the workspace comes up with the same frame picked, and
 * focus lands on the department's view, so the keyboard carries on from where the row was.
 */
export function openDepartment(department: Department): void {
  openDepartmentWorkspace(department);
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-department-view]')?.focus();
  });
}

/**
 * The department a Department tile shows outside a department's own workspace (opened from the Layout menu into
 * another one): picked in the tile, for this session. Null until picked: the tile then shows your own department.
 */
const pickedStore = createStore<{ department: Department | null }>()(() => ({ department: null }));

export function usePickedDepartment(): Department | null {
  return useStore(pickedStore, (s) => s.department);
}

export function pickDepartment(department: Department): void {
  pickedStore.setState({ department });
}
