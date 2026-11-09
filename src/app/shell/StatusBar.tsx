import { version } from '../../../package.json';
import { openTile } from './docking/layout';
import { layoutsOf, layoutStore } from './docking/layoutStore';
import { TILES } from './workspaces';
import { unreadCount, useNotifications } from '../../features/notifications/notificationsStore';
import { useProject } from '../projectStore';
import { tn } from '../../core/i18n';
import { ThemeSwitch } from '../../ui/theme/ThemeSwitch';
import type { Workspace } from './workspaces';
import { t } from '../../core/i18n';

export function StatusBar({ workspace }: { workspace: Workspace }) {
  const open = useProject((s) => s.project !== null);
  const unread = useNotifications(unreadCount);
  /** Notifications (3.10), in front in this workspace, focus inside it, as History opens from the top bar. */
  const openNotifications = () => {
    const { layouts, change } = layoutStore.getState();
    change(workspace.id, openTile(layoutsOf(layouts, workspace.id).current, 'notifications'));
    requestAnimationFrame(() => {
      const tile = document.querySelector(`section[aria-label="${CSS.escape(TILES.notifications?.title ?? '')}"]`);
      tile?.querySelector<HTMLElement>('[data-scroll-root] :is(button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])')?.focus();
    });
  };
  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-[18px] border-t border-border px-3">
      <span className="sb-label">
        <span aria-hidden="true">■ </span>
        {t('statusBar.workspace', { name: workspace.label })}
      </span>
      <div className="ml-auto flex items-center gap-[18px]">
        {open && unread > 0 && (
          // The unread count (3.10): what others changed since you last read, shown while there is some. Opens
          // Notifications; its name starts with what it shows.
          <button
            type="button"
            data-unread-count=""
            aria-label={tn('statusBar.unreadOpen', unread)}
            onClick={openNotifications}
            className="sb-label font-mono hover:underline focus-visible:outline-offset-2"
          >
            {tn('statusBar.unread', unread)}
          </button>
        )}
        <ThemeSwitch />
        {/* Mono like every technical value, but not uppercased: a version reads "v0.1.0". */}
        <span className="font-mono text-[10px] tracking-[0.08em] text-text-muted">{t('statusBar.version', { version })}</span>
      </div>
    </footer>
  );
}
