import { cx } from '../../ui/cx';
import { SMark } from '../../ui/logo/SMark';
import { projectStateOf } from '../../core/model/project';
import { ComingItem, Menu, menuItemClass } from '../../ui/Menu';
import { setProjectState } from '../projects/actions';
import { useProject } from '../projectStore';
import { LayoutMenu } from './docking/LayoutMenu';
import type { Workspace } from './workspaces';

interface TopBarProps {
  projectName: string | null;
  workspace: Workspace;
}

// The top bar keeps paper-coloured outlines in dark mode (rule-top): with the sidebar it is the "guiding board".
// Workspaces moved to the sidebar in D3; the bar keeps the S mark, the project name and the menus.
export function TopBar({ projectName, workspace }: TopBarProps) {
  const state = useProject((s) => (s.project ? projectStateOf(s.records[s.project.projectId]?.props) : null));
  return (
    <header className="flex h-topbar shrink-0 items-center border-b border-border-top">
      <h1 className="sr-only">Storiiboard</h1>
      <div className="flex h-full items-center border-r border-border-top px-4">
        <SMark size={24} decorative />
      </div>
      <span
        className={cx(
          'sb-label flex h-full items-center border-r border-border-top px-4',
          projectName === null && 'text-text-muted',
        )}
      >
        {projectName ?? 'No project open'}
      </span>
      <div className="ml-auto flex h-full">
        <LayoutMenu workspace={workspace} />
        {/* The project menu (DESIGN.md, Navigation). Each command shows its phase until it's built. */}
        <Menu
          align="right"
          label="Project"
          buttonClassName="sb-label flex h-full items-center border-l border-border-top px-4 focus-visible:-outline-offset-4"
        >
          {(close) => (
            <>
              <ComingItem label="History" phase="Phase 1" />
              <ComingItem label="Watermark Settings" phase="Phase 1" />
              <ComingItem label="Export Project" phase="Phase 1" />
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
                {state === 'archived' ? 'Unarchive Project' : 'Archive Project'}
              </button>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
