import { useEffect, type MouseEvent } from 'react';
import { Menu, menuItemClass } from '../../../ui/Menu';
import { TILES, type Workspace } from '../workspaces';
import { openTile, tilesIn, type Layout } from './layout';
import { canUndoLayout, isUnsaved, layoutStore, useLayouts } from './layoutStore';

// The workspace's layout commands (DESIGN.md, State 05): save, reset, undo, and open any tile in this workspace.
// Undo lives here rather than on ⌘Z, which belongs to the project's edits alone.

export function LayoutMenu({ workspace }: { workspace: Workspace }) {
  const layouts = useLayouts((s) => s.layouts[workspace.id]);
  const undoable = useLayouts((s) => canUndoLayout(s.past, workspace.id));
  const unsaved = isUnsaved(layouts);
  const missing = Object.keys(TILES).filter((tile) => !tilesIn(layouts.current).includes(tile));
  const change = (next: Layout) => {
    layoutStore.getState().change(workspace.id, next);
  };
  const save = () => {
    layoutStore.getState().save(workspace.id);
  };

  useEffect(() => {
    // ⌘⇧S (Ctrl+Shift+S) saves the current layout, from anywhere in the app.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        layoutStore.getState().save(workspace.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspace.id]);

  return (
    <Menu
      align="right"
      label={<>Layout{unsaved && <span className="sr-only"> (unsaved changes)</span>}</>}
      buttonClassName="sb-label flex h-full items-center border-l border-border-top px-4 focus-visible:-outline-offset-4"
    >
      {(close) => {
        /** Runs a command, then closes the menu with focus back on its button. */
        const run = (action: () => void) => () => {
          action();
          close();
        };
        const onOpenTile = (event: MouseEvent<HTMLButtonElement>) => {
          const tile = event.currentTarget.dataset.tile;
          if (tile) run(() => { change(openTile(layoutStore.getState().layouts[workspace.id].current, tile)); })();
        };
        return (
          <>
            <button type="button" className={menuItemClass} disabled={!unsaved} onClick={run(save)} aria-keyshortcuts="Meta+Shift+S Control+Shift+S">
              Update “{workspace.label}”
            </button>
            <button type="button" className={menuItemClass} disabled={!unsaved} onClick={run(() => { change(layouts.saved); })}>
              Reset to saved layout
            </button>
            <button type="button" className={menuItemClass} onClick={run(() => { change(workspace.defaultLayout()); })}>
              Reset to default layout
            </button>
            <button
              type="button"
              className={menuItemClass}
              disabled={!undoable}
              onClick={run(() => {
                layoutStore.getState().undo(workspace.id);
              })}
            >
              Undo layout change
            </button>
            <p className="sb-label px-3 pt-3 pb-1 text-text-muted">Open tile</p>
            {missing.length === 0 ? (
              <p className="sb-label px-3 pb-3 text-text-muted">Every tile is open.</p>
            ) : (
              missing.map((tile) => (
                <button key={tile} type="button" className={menuItemClass} data-tile={tile} onClick={onOpenTile}>
                  {TILES[tile]?.title}
                </button>
              ))
            )}
          </>
        );
      }}
    </Menu>
  );
}
