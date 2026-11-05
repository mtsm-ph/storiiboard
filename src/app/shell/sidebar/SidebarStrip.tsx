import { t } from '../../../core/i18n';
import { IconButton } from '../../../ui/Button';
import { SidebarGlyph } from '../../../ui/glyphs';
import { isMac } from '../undoShortcuts';
import { SHOW_SIDEBAR_ID, sidebarShortcut } from './sidebarToggle';

/**
 * What's left of the sidebar while it's hidden (polish 2): a thin strip at the window's left edge, so showing it again
 * is one click away, at the bottom where Hide sidebar was. It keeps the paper outline of the guiding board.
 */
export function SidebarStrip({ onShow }: { onShow: () => void }) {
  const shortcut = sidebarShortcut(isMac());
  return (
    <aside data-sidebar="" aria-label={t('sidebar.foldedStrip')} className="flex w-sidebar-strip shrink-0 flex-col justify-end border-r border-border-top">
      <div className="flex h-9 items-center justify-center border-t border-border-top">
        <IconButton
          id={SHOW_SIDEBAR_ID}
          size="sm"
          label={t('sidebar.show', { keys: shortcut.label })}
          aria-keyshortcuts={shortcut.aria}
          onClick={onShow}
        >
          <SidebarGlyph shown={false} />
        </IconButton>
      </div>
    </aside>
  );
}
