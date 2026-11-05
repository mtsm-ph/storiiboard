import { cx } from '../../ui/cx';
import { SMark } from '../../ui/logo/SMark';
import { HistoryGlyph } from '../../ui/glyphs';
import { projectStateOf } from '../../core/model/project';
import { Menu, menuItemClass } from '../../ui/Menu';
import { setProjectState } from '../projects/actions';
import { useProject } from '../projectStore';
import { openTile } from './docking/layout';
import { layoutStore } from './docking/layoutStore';
import { LayoutMenu } from './docking/LayoutMenu';
import { openExportDialog } from '../../features/export/exportStore';
import type { Workspace } from './workspaces';
import { t } from '../../core/i18n';

interface TopBarProps {
  projectName: string | null;
  workspace: Workspace;
}

// The top bar keeps paper-coloured outlines in dark mode (rule-top): with the sidebar it is the "guiding board".
/** History is a tile (1.22): it opens in the workspace on screen, beside what's there, or comes to the front. */
function openHistory(workspace: Workspace) {
  const { layouts, change } = layoutStore.getState();
  change(workspace.id, openTile(layouts[workspace.id].current, 'history'));
}

// Workspaces moved to the sidebar in D3; the bar keeps the S mark, the project name, History (polish 3) and the menus.
export function TopBar({ projectName, workspace }: TopBarProps) {
  const state = useProject((s) => (s.project ? projectStateOf(s.records[s.project.projectId]?.props) : null));
  const open = useProject((s) => s.project !== null);
  return (
    <header className="flex h-topbar shrink-0 items-center border-b border-border-top">
      <h1 className="sr-only">{t('topBar.storiiboard')}</h1>
      <div className="flex h-full items-center border-r border-border-top px-4">
        <SMark size={24} decorative />
      </div>
      <span
        className={cx(
          'sb-label flex h-full items-center border-r border-border-top px-4',
          projectName === null && 'text-text-muted',
        )}
      >
        {projectName ?? t('project.noneOpen')}
      </span>
      {/* Beside the name it's the history of (polish 3): the same tile as the project menu's History. */}
      <button
        type="button"
        disabled={!open}
        onClick={() => {
          openHistory(workspace);
        }}
        className="sb-label flex h-full items-center gap-1.5 border-r border-border-top px-4 enabled:hover:bg-surface-raised disabled:text-text-muted focus-visible:-outline-offset-4"
      >
        <HistoryGlyph />
        {t('topBar.history')}
      </button>
      <div className="ml-auto flex h-full">
        <LayoutMenu workspace={workspace} />
        {/* The project menu (DESIGN.md, Navigation). Each command shows its phase until it's built. */}
        <Menu
          align="right"
          label={t('topBar.project')}
          buttonClassName="sb-label flex h-full items-center border-l border-border-top px-4 focus-visible:-outline-offset-4"
        >
          {(close) => (
            <>
              {/* The same tile as the History button beside the project name. */}
              <button
                type="button"
                className={menuItemClass}
                disabled={!open}
                onClick={() => {
                  close();
                  openHistory(workspace);
                }}
              >
                {t('topBar.history')}
              </button>
              <button
                type="button"
                className={menuItemClass}
                disabled={!open}
                onClick={() => {
                  close();
                  openExportDialog('watermark');
                }}
              >
                {t('topBar.watermarkSettings')}
              </button>
              <button
                type="button"
                className={menuItemClass}
                disabled={!open}
                onClick={() => {
                  close();
                  openExportDialog('export');
                }}
              >
                {t('topBar.exportProject')}
              </button>
              {/* A project's state, never the Trash: archiving moves it from Recent to Archived and off the switcher. */}
              <button
                type="button"
                className={menuItemClass}
                disabled={state === null}
                onClick={() => {
                  close();
                  void setProjectState(state === 'archived' ? 'active' : 'archived');
                }}
              >
                {state === 'archived' ? t('topBar.unarchiveProject') : t('topBar.archiveProject')}
              </button>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
