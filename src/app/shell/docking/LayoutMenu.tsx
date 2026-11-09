import { useEffect, type MouseEvent } from 'react';
import { commandShortcut, Menu, MenuGroup, MenuItem } from '../../../ui/Menu';
import { departmentOf, inModalDialog, sectionId, TILES, type Workspace } from '../workspaces';
import { closeDepartmentWorkspace } from '../workspaceStore';
import { TILE_CONTENT } from '../tileContent';
import { openTile, tilesIn, toggleMaximize, type Layout } from './layout';
import { lastUsedStack } from './Dock';
import { isMac } from '../undoShortcuts';
import { sidebarShortcut } from '../sidebar/sidebarToggle';
import { toggleSidebar, useSidebarHidden } from '../sidebar/sidebarStore';
import { canUndoLayout, isUnsaved, layoutStore, useLayouts } from './layoutStore';
import { t } from '../../../core/i18n';

// The workspace's layout commands (DESIGN.md, State 05), in labelled groups (polish A): this workspace's layout, the
// view (the sidebar, a tile maximized), any built tile to open here, and Undo layout change in a group of its own at the
// bottom. Undo lives here rather than on ⌘Z, which belongs to the project's edits alone.

export function LayoutMenu({ workspace }: { workspace: Workspace }) {
  const layouts = useLayouts((s) => s.layouts[workspace.id]);
  const undoable = useLayouts((s) => canUndoLayout(s.past, workspace.id));
  const unsaved = isUnsaved(layouts);
  const department = departmentOf(workspace.id);
  const sidebarHidden = useSidebarHidden();
  const mac = isMac();
  // Only tiles whose tools are built (Kevin's menu rules, Nov 5: what isn't built is hidden, not greyed out). A phase's
  // placeholder tile stays where a default layout puts it, and Reset to default layout brings a closed one back.
  const missing = Object.keys(TILES).filter((tile) => tile in TILE_CONTENT && !tilesIn(layouts.current).includes(tile));
  const change = (next: Layout) => {
    layoutStore.getState().change(workspace.id, next);
  };
  const save = () => {
    layoutStore.getState().save(workspace.id);
  };

  useEffect(() => {
    // ⌘⇧S (Ctrl+Shift+S) saves the current layout, from anywhere in the app.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's' && !inModalDialog(event.target)) {
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
      label={<>{t('layoutMenu.layout')}{unsaved && <span className="sr-only">{' '}{t('layoutMenu.unsavedChanges')}</span>}</>}
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
        const maximizedNow = layouts.current.maximized;
        const lastStack = lastUsedStack(workspace.id, layouts.current);
        const maximizeTarget = maximizedNow ?? lastStack?.id ?? null;
        const lastTitle = lastStack ? (TILES[lastStack.active]?.title ?? lastStack.active) : null;
        return (
          <>
            <MenuGroup label={t('layoutMenu.groupWorkspace', { name: workspace.label })}>
              <MenuItem disabled={!unsaved} onClick={run(save)} shortcut={commandShortcut('S', { shift: true, mac })}>
                {t('layoutMenu.save')}
              </MenuItem>
              <MenuItem disabled={!unsaved} onClick={run(() => { change(layouts.saved); })}>
                {t('layoutMenu.resetToSavedLayout')}
              </MenuItem>
              <MenuItem onClick={run(() => { change(workspace.defaultLayout()); })}>{t('layoutMenu.resetToDefaultLayout')}</MenuItem>
              {department !== null && (
                // A department's workspace (3.6a) leaves the sidebar; its layout stays for the next time it's opened.
                <MenuItem
                  onClick={() => {
                    close();
                    closeDepartmentWorkspace(department);
                    // The Storyboard takes its place: focus goes to its section, not back to a menu that's gone.
                    requestAnimationFrame(() => document.getElementById(sectionId('storyboard'))?.focus());
                  }}
                >
                  {t('layoutMenu.removeFromSidebar')}
                </MenuItem>
              )}
            </MenuGroup>
            <MenuGroup label={t('layoutMenu.groupView')}>
              <MenuItem
                onClick={run(() => {
                  toggleSidebar(false);
                })}
                shortcut={sidebarShortcut(mac)}
              >
                {sidebarHidden ? t('layoutMenu.showSidebar') : t('layoutMenu.hideSidebar')}
              </MenuItem>
              <MenuItem
                disabled={maximizeTarget === null}
                onClick={run(() => {
                  if (maximizeTarget) change(toggleMaximize(layouts.current, maximizeTarget));
                })}
                // ` acts on the tile holding focus, not on this item: shown as a hint, not as its own key.
                hint="`"
              >
                {/* Named, so it's plain which tile it acts on; before any tile is used, a plain Maximize tile, off. */}
                {maximizedNow ? t('layoutMenu.restoreTile') : lastTitle ? t('layoutMenu.maximizeNamed', { title: lastTitle }) : t('layoutMenu.maximizeTile')}
              </MenuItem>
            </MenuGroup>
            <MenuGroup label={t('layoutMenu.openTile')}>
              {missing.length === 0 ? (
                <p className="sb-label px-3 pb-3 text-text-muted">{t('layoutMenu.everyTileIsOpen')}</p>
              ) : (
                missing.map((tile) => (
                  <MenuItem key={tile} data-tile={tile} onClick={onOpenTile}>
                    {TILES[tile]?.title}
                  </MenuItem>
                ))
              )}
            </MenuGroup>
            {/* What undoes goes last, in a group of its own (Kevin, Nov 5). */}
            <MenuGroup>
              <MenuItem
                disabled={!undoable}
                onClick={run(() => {
                  layoutStore.getState().undo(workspace.id);
                })}
              >
                {t('layoutMenu.undoLayoutChange')}
              </MenuItem>
            </MenuGroup>
          </>
        );
      }}
    </Menu>
  );
}
