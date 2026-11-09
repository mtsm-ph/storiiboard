import { afterEach, describe, expect, it } from 'vitest';
import { closeDepartmentWorkspace, openDepartmentWorkspace, showWorkspace, workspaceStore } from './workspaceStore';

// Department workspaces in the sidebar (3.6a): opened from a frame's row, listed once each, taken off again.

afterEach(() => {
  workspaceStore.setState({ active: 'storyboard', departments: [] });
});

describe('department workspaces in the sidebar', () => {
  it('open on screen, listed once each in the call sheet’s order, however often and in whatever order they’re opened', () => {
    openDepartmentWorkspace('sound');
    openDepartmentWorkspace('camera');
    openDepartmentWorkspace('sound');
    expect(workspaceStore.getState()).toMatchObject({ active: 'department-sound', departments: ['camera', 'sound'] });
  });

  it('leave the sidebar, the Storyboard taking the place of the one on screen', () => {
    openDepartmentWorkspace('camera');
    openDepartmentWorkspace('art');
    closeDepartmentWorkspace('art');
    expect(workspaceStore.getState()).toMatchObject({ active: 'storyboard', departments: ['camera'] });
    // Another one on screen stays there.
    showWorkspace('production');
    closeDepartmentWorkspace('camera');
    expect(workspaceStore.getState()).toMatchObject({ active: 'production', departments: [] });
  });
});
