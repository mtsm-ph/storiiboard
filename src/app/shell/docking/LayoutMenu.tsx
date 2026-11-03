import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { TILES, type Workspace } from '../workspaces';
import { openTile, tilesIn } from './layout';
import { canUndoLayout, isUnsaved, layoutStore, useLayouts } from './layoutStore';

// The workspace's layout commands (DESIGN.md, State 05): save, reset, undo, and open any tile in this workspace.
// Undo lives here rather than on ⌘Z, which belongs to the project's edits alone.

export function LayoutMenu({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layouts = useLayouts((s) => s.layouts[workspace.id]);
  const undoable = useLayouts((s) => canUndoLayout(s.past, workspace.id));
  const change = (next: Parameters<typeof openTile>[0]) => {
    layoutStore.getState().change(workspace.id, next);
  };
  const unsaved = isUnsaved(layouts);
  const missing = Object.keys(TILES).filter((tile) => !tilesIn(layouts.current).includes(tile));

  const save = () => {
    layoutStore.getState().save(workspace.id);
  };

  useEffect(() => {
    // ⌘⇧S (Ctrl+Shift+S) saves the current layout, from anywhere in the app.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(panelId)} button`)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelId]);

  /** Runs a command, closes the menu and puts focus back on its button. Called only from click handlers. */
  const finish = (action: () => void) => {
    action();
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onOpenTile = (event: MouseEvent<HTMLButtonElement>) => {
    const tile = event.currentTarget.dataset.tile;
    if (!tile) return;
    finish(() => {
      change(openTile(layoutStore.getState().layouts[workspace.id].current, tile));
    });
  };

  const item = 'sb-label block w-full border-b border-rule px-3 py-2 text-left hover:bg-oatmeal disabled:text-muted';

  return (
    <div ref={rootRef} className="relative flex h-full">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="sb-label flex h-full items-center border-r border-rule-top px-4 focus-visible:-outline-offset-4"
      >
        Layout{unsaved && <span className="sr-only"> (unsaved changes)</span>}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute top-full left-0 z-50 w-64 border border-rule-top bg-panel"
        >
          <button type="button" className={item} disabled={!unsaved} onClick={() => {
              finish(save);
            }} aria-keyshortcuts="Meta+Shift+S Control+Shift+S">
            Update “{workspace.label}”
          </button>
          <button
            type="button"
            className={item}
            disabled={!unsaved}
            onClick={() => {
              finish(() => {
                change(layouts.saved);
              });
            }}
          >
            Reset to saved layout
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              finish(() => {
                change(workspace.defaultLayout());
              });
            }}
          >
            Reset to default layout
          </button>
          <button
            type="button"
            className={item}
            disabled={!undoable}
            onClick={() => {
              finish(() => {
                layoutStore.getState().undo(workspace.id);
              });
            }}
          >
            Undo layout change
          </button>
          <p className="sb-label px-3 pt-3 pb-1 text-muted">Open tile</p>
          {missing.length === 0 ? (
            <p className="sb-label px-3 pb-3 text-muted">Every tile is open.</p>
          ) : (
            missing.map((tile) => (
              <button
                key={tile}
                type="button"
                className={item}
                data-tile={tile}
                onClick={onOpenTile}
              >
                {TILES[tile]?.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
