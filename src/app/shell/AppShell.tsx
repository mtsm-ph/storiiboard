import { useEffect, useState } from 'react';
import { StatusBar } from './StatusBar';
import { TileArea } from './TileArea';
import { TopBar } from './TopBar';
import { WORKSPACE_PANEL_ID, WORKSPACES, workspaceForShortcut, workspaceTabId, type WorkspaceId } from './workspaces';

export function AppShell() {
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>('storyboard');
  const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = workspaceForShortcut(event);
      if (!target) return;
      event.preventDefault();
      if (target.id === workspaceId) return;
      // The old workspace's tiles unmount on a switch: focus inside them would drop to <body>, and focus on the
      // old tab would be left behind. Either way it moves to the new tab, where a click would have put it.
      const focused = document.activeElement;
      const followToTab =
        focused !== null &&
        (document.getElementById(WORKSPACE_PANEL_ID)?.contains(focused) === true ||
          WORKSPACES.some((w) => workspaceTabId(w.id) === focused.id));
      setWorkspaceId(target.id);
      if (followToTab) document.getElementById(workspaceTabId(target.id))?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspaceId]);

  return (
    <div className="sb-grain flex h-full flex-col text-ink">
      <TopBar projectName={null} workspaces={WORKSPACES} activeId={workspace.id} onSelect={setWorkspaceId} />
      <main className="flex min-h-0 flex-1 flex-col">
        {/* Keyed by workspace so each one opens with its own default layout, nothing maximized. */}
        <TileArea key={workspace.id} workspace={workspace} />
      </main>
      <StatusBar workspace={workspace} />
    </div>
  );
}
