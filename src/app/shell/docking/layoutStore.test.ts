import { describe, expect, it } from 'vitest';
import { departmentWorkspaceId, WORKSPACES, workspaceById } from '../workspaces';
import { loadSettings } from '../../../core/storage/settings';
import { removeTile, sameLayout, split, stack, tilesIn, type Layout } from './layout';
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

describe('a tile added to a built-in default since a layout was saved (6.0: Setups)', () => {
  // Every key kept, so the offered flag in the settings survives a restart as the layouts do.
  function machine(layouts: unknown) {
    const values = new Map([[LAYOUTS_KEY, JSON.stringify(layouts)]]);
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, next: string) => void values.set(key, next) };
  }
  // The Setup section's default before 6.0: the placeholders only.
  const before = () => ({
    root: split('row', [split('column', [stack(['layers']), stack(['library'])]), split('column', [stack(['plan']), stack(['frames'])]), stack(['selection'])]),
    maximized: null,
  });

  it('is put into a saved layout that lacks it, once, above Layers as the default has it', () => {
    const storage = machine({ setup: { current: before(), saved: before() } });
    const layouts = layoutsOf(createLayoutStore(storage).getState().layouts, 'setup');
    expect(tilesIn(layouts.saved)).toEqual(['setups', 'layers', 'library', 'plan', 'frames', 'selection']);
    expect(tilesIn(layouts.current)).toEqual(tilesIn(layouts.saved));
    expect(isUnsaved(layouts)).toBe(false);
    // Asked again, it is not added a second time.
    expect(tilesIn(layoutsOf(createLayoutStore(storage).getState().layouts, 'setup').current).filter((t) => t === 'setups')).toHaveLength(1);
  });

  it('stays closed once the person closes it, across restarts', () => {
    const storage = machine({ setup: { current: before(), saved: before() } });
    const store = createLayoutStore(storage);
    store.getState().change('setup', removeTile(layoutsOf(store.getState().layouts, 'setup').current, 'setups'));
    store.getState().save('setup');
    const reopened = layoutsOf(createLayoutStore(storage).getState().layouts, 'setup');
    expect(tilesIn(reopened.current)).not.toContain('setups');
    expect(tilesIn(reopened.saved)).not.toContain('setups');
  });

  it('stays closed when closed from the default on a computer that never saved the Setup layout', () => {
    const storage = machine({});
    const store = createLayoutStore(storage);
    store.getState().change('setup', removeTile(layoutsOf(store.getState().layouts, 'setup').current, 'setups'));
    expect(tilesIn(layoutsOf(createLayoutStore(storage).getState().layouts, 'setup').current)).not.toContain('setups');
  });

  it('leaves a saved layout that has it, and other workspaces, as they were', () => {
    const has = { root: split('row', [stack(['plan', 'setups']), stack(['layers'])]), maximized: null };
    const storyboard = { root: split('row', [stack(['scenes']), stack(['board'])]), maximized: null };
    const storage = machine({ setup: { current: has, saved: has }, storyboard: { current: storyboard, saved: storyboard } });
    const layouts = createLayoutStore(storage).getState().layouts;
    expect(sameLayout(layoutsOf(layouts, 'setup').current, has)).toBe(true);
    expect(layoutsOf(layouts, 'setup').current.root).toEqual(has.root);
    expect(layoutsOf(layouts, 'storyboard').current.root).toEqual(storyboard.root);
    for (const workspace of WORKSPACES.filter((w) => w.id !== 'setup' && w.id !== 'storyboard')) {
      expect(sameLayout(layoutsOf(layouts, workspace.id).current, workspace.defaultLayout())).toBe(true);
    }
  });

  it('is placed as opening it would be when the saved layout has no Layers tile', () => {
    const plain = { root: split('row', [stack(['plan']), stack(['selection'])]), maximized: null };
    const layouts = layoutsOf(createLayoutStore(machine({ setup: { current: plain, saved: plain } })).getState().layouts, 'setup');
    expect(tilesIn(layouts.current)).toEqual(['plan', 'selection', 'setups']);
  });

  // The left column of a Setup layout, as [tile, share] pairs.
  function leftColumn(layout: Layout): [string, number][] {
    const root = layout.root;
    if (root.kind !== 'split') throw new Error('Expected a split root.');
    const column = root.children[0];
    if (column?.kind !== 'split') throw new Error('Expected a left column.');
    return column.children.map((child, i) => [child.kind === 'stack' ? (child.tiles[0] ?? '') : 'split', column.sizes[i] ?? 0]);
  }
  // The Setup section's default before 6.0 exactly, as people saved it.
  const oldDefault = (): Layout => ({
    root: split(
      'row',
      [
        split('column', [stack(['layers']), stack(['library'])], [120, 688]),
        split('column', [stack(['plan']), stack(['frames'])], [658, 150]),
        stack(['selection']),
      ],
      [248, 824, 336],
    ),
    maximized: null,
  });

  it('gets about half its column from the old default saved as it was, the new default outright', () => {
    const layouts = layoutsOf(createLayoutStore(machine({ setup: { current: oldDefault(), saved: oldDefault() } })).getState().layouts, 'setup');
    expect(sameLayout(layouts.saved, workspaceById('setup').defaultLayout())).toBe(true);
    expect(sameLayout(layouts.current, workspaceById('setup').defaultLayout())).toBe(true);
    const column = Object.fromEntries(leftColumn(layouts.current));
    // The new default's own column (400, 120, 288), not the old ratio between Layers and Library.
    expect(column.setups).toBeGreaterThanOrEqual(0.3);
    expect((column.layers ?? 0) / (column.library ?? 1)).toBeCloseTo(120 / 288, 5);
  });

  it('gets its share from the old default changed only in its other columns, Layers and Library keeping their ratio', () => {
    const changed = oldDefault();
    if (changed.root.kind === 'split') changed.root.sizes = [0.25, 0.5, 0.25];
    const layouts = layoutsOf(createLayoutStore(machine({ setup: { current: changed, saved: changed } })).getState().layouts, 'setup');
    const column = Object.fromEntries(leftColumn(layouts.saved));
    expect(column.setups).toBeGreaterThanOrEqual(0.3);
    expect((column.layers ?? 0) / (column.library ?? 1)).toBeCloseTo(120 / 688, 5);
  });

  it('gets its share of the column from a customised layout, the others keeping their ratio', () => {
    const custom = oldDefault();
    if (custom.root.kind === 'split') custom.root.sizes = [0.3, 0.5, 0.2];
    const column = custom.root.kind === 'split' ? custom.root.children[0] : undefined;
    if (column?.kind === 'split') column.sizes = [0.4, 0.6];
    const layouts = layoutsOf(createLayoutStore(machine({ setup: { current: custom, saved: custom } })).getState().layouts, 'setup');
    const shares = Object.fromEntries(leftColumn(layouts.saved));
    expect(Object.keys(shares)).toEqual(['setups', 'layers', 'library']);
    expect(shares.setups).toBeCloseTo(0.5, 5);
    expect((shares.layers ?? 0) / (shares.library ?? 1)).toBeCloseTo(0.4 / 0.6, 5);
    expect(leftColumn(layouts.current)).toEqual(leftColumn(layouts.saved));
  });

  it('keeps a stack the person left maximized', () => {
    const custom = before();
    const plan = custom.root.children[1];
    const planStack = plan?.kind === 'split' ? plan.children[0] : undefined;
    const maximized = planStack?.id ?? '';
    const saved = { ...custom, maximized };
    const layouts = layoutsOf(createLayoutStore(machine({ setup: { current: saved, saved } })).getState().layouts, 'setup');
    expect(tilesIn(layouts.current)).toContain('setups');
    expect(layouts.current.maximized).toBe(maximized);
    expect(layouts.saved.maximized).toBe(maximized);
  });

  it('is offered again when the layouts could not be written', () => {
    const values = new Map([[LAYOUTS_KEY, JSON.stringify({ setup: { current: before(), saved: before() } })]]);
    let full = true;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, next: string) => {
        if (key === LAYOUTS_KEY && full) throw new Error('QuotaExceededError');
        values.set(key, next);
      },
    };
    expect(tilesIn(layoutsOf(createLayoutStore(storage).getState().layouts, 'setup').current)).toContain('setups');
    expect(loadSettings(storage).tilesOffered).not.toContain('setup:setups');
    // Room again: the next start adds it and marks it.
    full = false;
    expect(tilesIn(layoutsOf(createLayoutStore(storage).getState().layouts, 'setup').current)).toContain('setups');
    expect(loadSettings(storage).tilesOffered).toContain('setup:setups');
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
