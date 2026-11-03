import { cx } from '../../ui/cx';
import { SMark } from '../../ui/logo/SMark';
import { roveFocus } from '../../ui/roving';
import { LayoutMenu } from './docking/LayoutMenu';
import { isUnsaved, useLayouts } from './docking/layoutStore';
import { WORKSPACE_PANEL_ID, workspaceTabId, type Workspace, type WorkspaceId } from './workspaces';

interface TopBarProps {
  projectName: string | null;
  workspaces: readonly Workspace[];
  activeId: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
}

// The top bar keeps paper-coloured outlines in dark mode (rule-top): it is the "guiding board" that shows
// which workspace people are in.
export function TopBar({ projectName, workspaces, activeId, onSelect }: TopBarProps) {
  const layouts = useLayouts((s) => s.layouts);
  const activeWorkspace = workspaces.find((w) => w.id === activeId);
  return (
    <header className="flex h-topbar shrink-0 items-center border-b border-rule-top">
      <h1 className="sr-only">Storiiboard</h1>
      <div className="flex h-full items-center border-r border-rule-top px-4">
        <SMark size={24} decorative />
      </div>
      <span
        className={cx(
          'sb-label flex h-full items-center border-r border-rule-top px-4',
          projectName === null && 'text-muted',
        )}
      >
        {projectName ?? 'No project open'}
      </span>
      <div role="tablist" aria-label="Workspaces" className="flex h-full">
        {workspaces.map((workspace, i) => {
          const active = workspace.id === activeId;
          return (
            <button
              key={workspace.id}
              id={workspaceTabId(workspace.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={WORKSPACE_PANEL_ID}
              aria-keyshortcuts={`Alt+${String(i + 1)}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                onSelect(workspace.id);
              }}
              onKeyDown={(event) => {
                const next = roveFocus(event, i, workspaces.length, '[role="tab"]');
                const target = next === null ? undefined : workspaces[next];
                if (target) onSelect(target.id);
              }}
              className={cx(
                'sb-label flex h-full items-center border-r border-rule-top px-4 focus-visible:-outline-offset-4',
                // The active workspace is one of the few places orange appears. Text on it is ink, and so is the
                // focus ring: the dark theme's paper ink is only 2.9:1 on orange.
                active ? 'bg-accent font-bold text-on-accent focus-visible:outline-on-accent' : 'text-ink',
              )}
            >
              {workspace.label}
              {isUnsaved(layouts[workspace.id]) && (
                // The dot marks a layout changed since it was last saved (DESIGN.md, Workspaces).
                <span aria-label="unsaved layout" role="img" className="ml-1.5 inline-block size-1.5 rounded-full bg-current" />
              )}
            </button>
          );
        })}
      </div>
      {activeWorkspace && <LayoutMenu workspace={activeWorkspace} />}
    </header>
  );
}
