import { describe, expect, it } from 'vitest';
import { WORKSPACES } from '../workspaces';
import { removeTile, sameLayout, tilesIn } from './layout';
import { canUndoLayout, createLayoutStore, isUnsaved, LAYOUTS_KEY } from './layoutStore';

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
    const current = store.getState().layouts.storyboard.current;
    expect(sameLayout(current, WORKSPACES[0].defaultLayout())).toBe(true);

    store.getState().change('storyboard', removeTile(current, 'player'));
    const reopened = createLayoutStore(storage);
    expect(tilesIn(reopened.getState().layouts.storyboard.current)).not.toContain('player');
  });

  it('show unsaved changes until saved, and reset to the saved layout', () => {
    const store = createLayoutStore(memory());
    const current = store.getState().layouts.storyboard.current;
    store.getState().change('storyboard', removeTile(current, 'player'));
    expect(isUnsaved(store.getState().layouts.storyboard)).toBe(true);
    store.getState().save('storyboard');
    expect(isUnsaved(store.getState().layouts.storyboard)).toBe(false);

    store.getState().change('storyboard', removeTile(store.getState().layouts.storyboard.current, 'scenes'));
    store.getState().resetToSaved('storyboard');
    expect(tilesIn(store.getState().layouts.storyboard.current)).toContain('scenes');
  });

  it('undo one change at a time, only in the workspace asked', () => {
    const store = createLayoutStore(memory());
    const start = store.getState().layouts.storyboard.current;
    const other = store.getState().layouts.production.current;
    store.getState().change('storyboard', removeTile(start, 'player'));
    store.getState().change('production', removeTile(other, tilesIn(other)[0] ?? ''));
    expect(canUndoLayout(store.getState().past, 'storyboard')).toBe(true);

    expect(store.getState().undo('storyboard')).toBe(true);
    expect(store.getState().layouts.storyboard.current).toBe(start);
    expect(store.getState().layouts.production.current).not.toBe(other);
    expect(store.getState().undo('storyboard')).toBe(false);
    expect(canUndoLayout(store.getState().past, 'storyboard')).toBe(false);
  });

  it('fall back to the defaults for a corrupt entry or a tile this app does not know', () => {
    const unknownTile = JSON.stringify({
      storyboard: { current: { root: { kind: 'stack', id: 'x', tiles: ['hologram'], active: 'hologram' }, maximized: null } },
    });
    for (const raw of ['{oops', unknownTile]) {
      const store = createLayoutStore(memory(raw));
      expect(sameLayout(store.getState().layouts.storyboard.current, WORKSPACES[0].defaultLayout())).toBe(true);
    }
  });
});
