import { describe, expect, it } from 'vitest';
import { departmentWorkspaceId, WORKSPACES, workspaceById } from '../workspaces';
import { removeTile, sameLayout, split, stack, tilesIn } from './layout';
import { canUndoLayout, createLayoutStore, isUnsaved, LAYOUTS_KEY, layoutsOf, usable } from './layoutStore';

function memory(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => (key === LAYOUTS_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === LAYOUTS_KEY) value = next;
    },
  };
}

describe('saved layouts', () => {
  it('start from the defaults, then remember changes across restarts', () => {
    const storage = memory();
    const store = createLayoutStore(storage);
    const current = layoutsOf(store.getState().layouts, 'storyboard').current;
    expect(sameLayout(current, WORKSPACES[0].defaultLayout())).toBe(true);

    store.getState().change('storyboard', removeTile(current, 'player'));
    const reopened = createLayoutStore(storage);
    expect(tilesIn(layoutsOf(reopened.getState().layouts, 'storyboard').current)).not.toContain('player');
  });

  it('show unsaved changes until saved, and reset to the saved layout', () => {
    const store = createLayoutStore(memory());
    const current = layoutsOf(store.getState().layouts, 'storyboard').current;
    store.getState().change('storyboard', removeTile(current, 'player'));
    expect(isUnsaved(layoutsOf(store.getState().layouts, 'storyboard'))).toBe(true);
    store.getState().save('storyboard');
    expect(isUnsaved(layoutsOf(store.getState().layouts, 'storyboard'))).toBe(false);

    store.getState().change('storyboard', removeTile(layoutsOf(store.getState().layouts, 'storyboard').current, 'scenes'));
    store.getState().resetToSaved('storyboard');
    expect(tilesIn(layoutsOf(store.getState().layouts, 'storyboard').current)).toContain('scenes');
  });

  it('undo one change at a time, only in the workspace asked', () => {
    const store = createLayoutStore(memory());
    const start = layoutsOf(store.getState().layouts, 'storyboard').current;
    const other = layoutsOf(store.getState().layouts, 'production').current;
    store.getState().change('storyboard', removeTile(start, 'player'));
    store.getState().change('production', removeTile(other, tilesIn(other)[0] ?? ''));
    expect(canUndoLayout(store.getState().past, 'storyboard')).toBe(true);

    expect(store.getState().undo('storyboard')).toBe(true);
    expect(layoutsOf(store.getState().layouts, 'storyboard').current).toBe(start);
    expect(layoutsOf(store.getState().layouts, 'production').current).not.toBe(other);
    expect(store.getState().undo('storyboard')).toBe(false);
    expect(canUndoLayout(store.getState().past, 'storyboard')).toBe(false);
  });

  it('fall back to the defaults for a corrupt entry or a tile this app does not know', () => {
    const unknownTile = JSON.stringify({
      storyboard: { current: { root: { kind: 'stack', id: 'x', tiles: ['hologram'], active: 'hologram' }, maximized: null } },
    });
    for (const raw of ['{oops', unknownTile]) {
      const store = createLayoutStore(memory(raw));
      expect(sameLayout(layoutsOf(store.getState().layouts, 'storyboard').current, WORKSPACES[0].defaultLayout())).toBe(true);
    }
  });
});

describe('a saved layout holding tiles this version no longer has', () => {
  it('keeps everything else where it was (polish B: the Settings tiles became the Settings window)', () => {
    const before = { root: split('row', [stack(['scenes', 'backups']), stack(['board']), stack(['theme'])]), maximized: null };
    const values = new Map([[LAYOUTS_KEY, JSON.stringify({ storyboard: { current: before, saved: before } })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, next: string) => void values.set(key, next) };
    const layouts = layoutsOf(createLayoutStore(storage).getState().layouts, 'storyboard');
    expect(tilesIn(layouts.current)).toEqual(['scenes', 'board']);
    expect(tilesIn(layouts.saved)).toEqual(['scenes', 'board']);
  });

  it('falls back to the default when none of its tiles is left', () => {
    expect(usable({ root: stack(['backups', 'storage']), maximized: null })).toBeNull();
    expect(usable('not a layout')).toBeNull();
  });

});

describe('department workspaces (3.6a)', () => {
  it('each keep a layout of their own, their default for one saved before they existed', () => {
    // Saved by a version with the sections alone.
    const storage = memory(JSON.stringify({ storyboard: { current: WORKSPACES[0].defaultLayout(), saved: WORKSPACES[0].defaultLayout() } }));
    const store = createLayoutStore(storage);
    const camera = departmentWorkspaceId('camera');
    expect(sameLayout(layoutsOf(store.getState().layouts, camera).current, workspaceById(camera).defaultLayout())).toBe(true);

    // Changed, it's remembered across a restart, undone on its own, and reset to its own default.
    store.getState().change(camera, removeTile(layoutsOf(store.getState().layouts, camera).current, 'scenes'));
    store.getState().change('storyboard', removeTile(layoutsOf(store.getState().layouts, 'storyboard').current, 'player'));
    expect(tilesIn(layoutsOf(createLayoutStore(storage).getState().layouts, camera).current)).toEqual(['department', 'inspector']);
    expect(store.getState().undo(camera)).toBe(true);
    expect(tilesIn(layoutsOf(store.getState().layouts, camera).current)).toEqual(['scenes', 'department', 'inspector']);
    expect(tilesIn(layoutsOf(store.getState().layouts, 'storyboard').current)).not.toContain('player');
    store.getState().change(camera, removeTile(layoutsOf(store.getState().layouts, camera).current, 'inspector'));
    store.getState().resetToDefault(camera);
    expect(tilesIn(layoutsOf(store.getState().layouts, camera).current)).toEqual(['scenes', 'department', 'inspector']);
  });
});
