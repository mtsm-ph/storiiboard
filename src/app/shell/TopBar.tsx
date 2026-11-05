import { cx } from '../../ui/cx';
import { SMark } from '../../ui/logo/SMark';
import { HistoryGlyph } from '../../ui/glyphs';
import { projectStateOf } from '../../core/model/project';
import { commandShortcut, Menu, MenuGroup, MenuItem } from '../../ui/Menu';
import { openSettings } from '../settings/SettingsWindow';
import { isMac } from './undoShortcuts';
import { setProjectState } from '../projects/actions';
import { useProject } from '../projectStore';
import { LayoutMenu } from './docking/LayoutMenu';
import { openExportDialog } from '../../features/export/exportStore';
import type { Workspace } from './workspaces';
import { t } from '../../core/i18n';

interface TopBarProps {
  projectName: string | null;
  workspace: Workspace;
  /** History, from the button or the project menu: the shell opens the tile and leaves the Projects screen for it. */
  onOpenHistory: () => void;
}

// The top bar keeps paper-coloured outlines in dark mode (rule-top): with the sidebar it is the "guiding board".
// Workspaces moved to the sidebar in D3; the bar keeps the S mark, the project name, History (polish 3) and the menus.
export function TopBar({ projectName, workspace, onOpenHistory }: TopBarProps) {
  const state = useProject((s) => (s.project ? projectStateOf(s.records[s.project.projectId]?.props) : null));
  const open = useProject((s) => s.project !== null);
  const mac = isMac();
  return (
    <header className="flex h-topbar shrink-0 items-center border-b border-border-top">
      <h1 className="sr-only">{t('topBar.storiiboard')}</h1>
      <div className="flex h-full items-center border-r border-border-top px-4">
        <SMark size={24} decorative />
      </div>
      <span
        className={cx(
          'sb-label flex h-full max-w-[40ch] min-w-0 items-center border-r border-border-top px-4',
          projectName === null && 'text-text-muted',
        )}
      >
        {/* A name cut short shows in full as its tooltip. */}
        <span className="truncate" title={projectName ?? undefined}>
          {projectName ?? t('project.noneOpen')}
        </span>
      </span>
      {/* History (polish 3) beside the name of the project it's the history of: the project menu's History tile. */}
      <button
        type="button"
        disabled={!open}
        onClick={onOpenHistory}
        className="sb-label flex h-full shrink-0 items-center gap-1.5 border-r border-border-top px-4 enabled:hover:bg-surface-raised disabled:text-text-muted focus-visible:-outline-offset-4"
      >
        <HistoryGlyph />
        {t('topBar.history')}
      </button>
      <div className="ml-auto flex h-full">
        <LayoutMenu workspace={workspace} />
        {/* The project menu (DESIGN.md, Menus): in groups, what isn't built yet left out. */}
        <Menu
          align="right"
          label={t('topBar.project')}
          buttonClassName="sb-label flex h-full items-center border-l border-border-top px-4 focus-visible:-outline-offset-4"
        >
          {(close) => (
            <>
              <MenuGroup label={t('topBar.groupProject')}>
                {/* The same tile as the History button beside the project name. */}
                <MenuItem
                  disabled={!open}
                  shortcut={commandShortcut('H', { shift: true, mac })}
                  onClick={() => {
                    close();
                    onOpenHistory();
                  }}
                >
                  {t('topBar.history')}
                </MenuItem>
                <MenuItem
                  shortcut={commandShortcut(',', { mac })}
                  onClick={() => {
                    close();
                    openSettings();
                  }}
                >
                  {t('topBar.settings')}
                </MenuItem>
              </MenuGroup>
              <MenuGroup label={t('topBar.groupExport')}>
                <MenuItem
                  disabled={!open}
                  shortcut={commandShortcut('E', { mac })}
                  onClick={() => {
                    close();
                    openExportDialog('export');
                  }}
                >
                  {t('topBar.exportProject')}
                </MenuItem>
                <MenuItem
                  disabled={!open}
                  onClick={() => {
                    close();
                    openExportDialog('watermark');
                  }}
                >
                  {t('topBar.watermarkSettingsDots')}
                </MenuItem>
              </MenuGroup>
              {/* A project's state, never the Trash: archiving moves it from Recent to Archived and off the switcher. */}
              <MenuGroup>
                <MenuItem
                  disabled={state === null}
                  onClick={() => {
                    close();
                    void setProjectState(state === 'archived' ? 'active' : 'archived');
                  }}
                >
                  {state === 'archived' ? t('topBar.unarchiveProject') : t('topBar.archiveProject')}
                </MenuItem>
              </MenuGroup>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
