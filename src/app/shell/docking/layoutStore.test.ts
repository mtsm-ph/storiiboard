import { describe, expect, it } from 'vitest';
import { WORKSPACES } from '../workspaces';
import { removeTile, sameLayout, split, stack, stackOf, tilesIn } from './layout';
import { canUndoLayout, createLayoutStore, INTRODUCED_KEY, isUnsaved, LAYOUTS_KEY, NEW_TILES } from './layoutStore';

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

describe('tiles added after a layout was saved', () => {
  function store(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, next: string) => {
        values.set(key, next);
      },
    };
  }
  // Settings as people saved it before the App tile (polish 1): project | theme | backups + storage.
  const before = { root: split('row', [stack(['project']), stack(['theme']), stack(['backups', 'storage'])]), maximized: null };

  it('join a saved layout once, as a tab beside the tile named, without opening it', () => {
    const storage = store({ [LAYOUTS_KEY]: JSON.stringify({ settings: { current: before, saved: before } }) });
    const settings = createLayoutStore(storage).getState().layouts.settings;
    for (const layout of [settings.current, settings.saved]) {
      expect(stackOf(layout, 'app')?.tiles).toEqual(['project', 'app']);
      expect(stackOf(layout, 'app')?.active).toBe('project');
    }
    // Adding it is no change of the person's: no unsaved dot.
    expect(isUnsaved(settings)).toBe(false);
  });

  it('stay in the saved layout on the next launch, with nothing moved meanwhile', () => {
    const storage = store({ [LAYOUTS_KEY]: JSON.stringify({ settings: { current: before, saved: before } }) });
    createLayoutStore(storage);
    const next = createLayoutStore(storage).getState().layouts.settings;
    expect(stackOf(next.current, 'app')?.tiles).toEqual(['project', 'app']);
    expect(stackOf(next.saved, 'app')?.tiles).toEqual(['project', 'app']);
  });

  it('stay closed once closed: they join only once', () => {
    const storage = store({ [LAYOUTS_KEY]: JSON.stringify({ settings: { current: before, saved: before } }) });
    const first = createLayoutStore(storage);
    first.getState().change('settings', removeTile(first.getState().layouts.settings.current, 'app'));
    first.getState().save('settings');
    expect(tilesIn(createLayoutStore(storage).getState().layouts.settings.current)).not.toContain('app');
    expect(JSON.parse(storage.values.get(INTRODUCED_KEY) ?? '[]')).toEqual(NEW_TILES.map((n) => `${n.workspace}:${n.tile}`));
  });

  it('are in a fresh default layout already', () => {
    const settings = createLayoutStore(store()).getState().layouts.settings;
    expect(tilesIn(settings.current).filter((tile) => tile === 'app')).toHaveLength(1);
  });
});
