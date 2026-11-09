import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSettings, MAX_CUSTOM_WORKSPACES, saveSettings } from '../../core/storage/settings';
import { removeTile, sameLayout, tilesIn } from './docking/layout';
import { canUndoLayout, createLayoutStore, layoutsOf, layoutStore, usable } from './docking/layoutStore';
import { workspaceById } from './workspaces';
import {
  canAddCustomWorkspace,
  copyNameOf,
  closeDepartmentWorkspace,
  createCustomWorkspace,
  deleteCustomWorkspace,
  openDepartmentWorkspace,
  renameCustomWorkspace,
  showWorkspace,
  workspaceStore,
} from './workspaceStore';

// Department workspaces in the sidebar (3.6a): opened from a frame's row, listed once each, taken off again. The
// person's own workspaces (3.6d): made from a layout, renamed, deleted, kept in this computer's settings.

// The settings live in the webview's localStorage; the unit tests run without one, so this file gives them a store.
beforeAll(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  workspaceStore.setState({ active: 'storyboard', departments: [] });
  saveSettings({ departmentWorkspaces: [] });
});

describe('department workspaces in the sidebar', () => {
  it('open on screen, listed once each in the call sheet’s order, however often and in whatever order they’re opened', () => {
    openDepartmentWorkspace('sound');
    openDepartmentWorkspace('camera');
    openDepartmentWorkspace('sound');
    expect(workspaceStore.getState()).toMatchObject({ active: 'department-sound', departments: ['camera', 'sound'] });
    // Kept in this computer's settings, as read back on the next start.
    expect(loadSettings().departmentWorkspaces).toEqual(['camera', 'sound']);
  });

  it('leave the sidebar, the Storyboard taking the place of the one on screen', () => {
    openDepartmentWorkspace('camera');
    openDepartmentWorkspace('art');
    closeDepartmentWorkspace('art');
    expect(workspaceStore.getState()).toMatchObject({ active: 'storyboard', departments: ['camera'] });
    expect(loadSettings().departmentWorkspaces).toEqual(['camera']);
    // Another one on screen stays there.
    showWorkspace('production');
    closeDepartmentWorkspace('camera');
    expect(workspaceStore.getState()).toMatchObject({ active: 'production', departments: [] });
    expect(loadSettings().departmentWorkspaces).toEqual([]);
  });
});

describe('your own workspaces (3.6d)', () => {
  afterEach(() => {
    for (const custom of workspaceStore.getState().customs) deleteCustomWorkspace(custom.id);
  });

  it('are made from a layout, named, kept in this computer’s settings with their layout, and found by id', () => {
    const from = layoutsOf(layoutStore.getState().layouts, 'production').current;
    const id = createCustomWorkspace('  Prep day  ', { ...from, maximized: 'anything' });
    expect(id).toMatch(/^custom-/);
    if (!id) return;
    expect(workspaceStore.getState().customs).toMatchObject([{ id, name: 'Prep day' }]);
    expect(loadSettings().customWorkspaces).toMatchObject([{ id, name: 'Prep day' }]);
    // Its own copy of the layout, never maximized, and Reset to default layout brings it back.
    const workspace = workspaceById(id);
    expect(workspace.label).toBe('Prep day');
    expect(sameLayout(workspace.defaultLayout(), { ...from, maximized: null })).toBe(true);
    expect(sameLayout(layoutsOf(layoutStore.getState().layouts, id).current, { ...from, maximized: null })).toBe(true);
    // An empty name makes none.
    expect(createCustomWorkspace('   ', from)).toBeNull();
  });

  it('are renamed, never to nothing, and deleted with their layout, the Storyboard taking the place of the one on screen', () => {
    const id = createCustomWorkspace('Prep day', layoutsOf(layoutStore.getState().layouts, 'storyboard').current);
    if (!id) throw new Error('not made');
    renameCustomWorkspace(id, 'Tech scout');
    renameCustomWorkspace(id, '  ');
    expect(workspaceById(id).label).toBe('Tech scout');
    expect(loadSettings().customWorkspaces[0]?.name).toBe('Tech scout');
    showWorkspace(id);
    deleteCustomWorkspace(id);
    expect(workspaceStore.getState()).toMatchObject({ active: 'storyboard', customs: [] });
    expect(layoutStore.getState().layouts[id]).toBeUndefined();
    expect(loadSettings().customWorkspaces).toEqual([]);
    // Gone, its id reads as the Storyboard.
    expect(workspaceById(id).id).toBe('storyboard');
  });

  it('keep their layouts across a restart, as saved and as left, and drop their undo steps when deleted', () => {
    const id = createCustomWorkspace('Prep day', layoutsOf(layoutStore.getState().layouts, 'storyboard').current);
    if (!id) throw new Error('not made');
    // A store as the app starts one, reading this computer's settings and layouts (the shared one was made before the
    // stand-in storage was).
    const store = createLayoutStore();
    expect(tilesIn(layoutsOf(store.getState().layouts, id).current)).toContain('player');
    store.getState().change(id, removeTile(layoutsOf(store.getState().layouts, id).current, 'player'));
    const reopened = createLayoutStore();
    expect(tilesIn(layoutsOf(reopened.getState().layouts, id).current)).not.toContain('player');
    expect(tilesIn(layoutsOf(reopened.getState().layouts, id).saved)).toContain('player');
    expect(canUndoLayout(store.getState().past, id)).toBe(true);
    store.getState().remove(id);
    expect(canUndoLayout(store.getState().past, id)).toBe(false);
    expect(createLayoutStore().getState().layouts[id]).toBeDefined();
    // Deleted from the settings too, nothing is read for it on the next start.
    deleteCustomWorkspace(id);
    expect(createLayoutStore().getState().layouts[id]).toBeUndefined();
  });

  it('number their tiles as the workspace they were made from, and keep names clean and short', () => {
    const storyboard = layoutsOf(layoutStore.getState().layouts, 'storyboard').current;
    const copy = createCustomWorkspace('Copy', storyboard, workspaceById('storyboard').order);
    const plain = createCustomWorkspace('‮Plain' + 'x'.repeat(80), storyboard);
    if (!copy || !plain) throw new Error('not made');
    expect(workspaceById(copy).order).toEqual(['scenes', 'board', 'inspector', 'player']);
    // Without one, the layout's own order.
    expect(workspaceById(plain).order).toEqual(tilesIn(storyboard));
    expect(workspaceById(plain).label).toBe(`Plain${'x'.repeat(55)}`);
    // A long name's copy keeps " copy" at the end.
    expect(copyNameOf('y'.repeat(58))).toBe(`${'y'.repeat(55)} copy`);
    expect(copyNameOf('Prep')).toBe('Prep copy');
  });

  it('leave out a saved tile this version doesn’t have, even one named like an object’s own (constructor)', () => {
    // The same shape with a tile it has is used as it is.
    expect(usable({ root: { kind: 'stack', id: 's', tiles: ['scenes'], active: 'scenes' }, maximized: null })).not.toBeNull();
    expect(usable({ root: { kind: 'stack', id: 's', tiles: ['constructor'], active: 'constructor' }, maximized: null })).toBeNull();
  });

  it('stop at the most there can be', () => {
    const layout = layoutsOf(layoutStore.getState().layouts, 'team').current;
    for (let i = 0; i < MAX_CUSTOM_WORKSPACES; i++) expect(createCustomWorkspace(`W${String(i)}`, layout)).not.toBeNull();
    expect(canAddCustomWorkspace()).toBe(false);
    expect(createCustomWorkspace('One more', layout)).toBeNull();
  });
});
