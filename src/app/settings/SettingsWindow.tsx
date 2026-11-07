import { useId, type ComponentType } from 'react';
import { useStore } from 'zustand';
import { labels, t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { InAppWindow } from '../../ui/InAppWindow';
import { roveFocus } from '../../ui/roving';
import { AppTile } from '../preferences/AppTile';
import { BackupsPanel } from '../project/BackupsPanel';
import { ProjectHome } from '../project/ProjectHome';
import { StorageTile } from '../project/StorageTile';
import { ThemeTile } from '../theme/ThemeTile';
import { ProfileTab } from './profile';
import { NoticeBar } from '../NoticeBar';

// Settings in a window of the app's own (polish B), not a workspace of tiles: the project's settings and the person's
// in one place, a tab each, opened from the sidebar's gear or with ⌘, (Ctrl+,), and from the profile button at its
// Profile tab. It remembers the tab last open this session.

import { closeSettings, openSettings, SETTINGS_TABS, settingsStore, type SettingsTab } from './settingsStore';
export { SETTINGS_TABS, type SettingsTab } from './settingsStore';

const TAB_LABEL: Readonly<Record<SettingsTab, string>> = labels({
  project: 'settings.tab.project',
  app: 'settings.tab.app',
  theme: 'settings.tab.theme',
  backups: 'settings.tab.backups',
  storage: 'settings.tab.storage',
  profile: 'settings.tab.profile',
});

const TAB_CONTENT: Readonly<Record<SettingsTab, ComponentType>> = {
  project: ProjectHome,
  app: AppTile,
  theme: ThemeTile,
  backups: BackupsPanel,
  storage: StorageTile,
  profile: ProfileTab,
};

// The store lives in settingsStore.ts, so a tab's content can open Settings at another tab without importing this.
export { closeSettings, openSettings, settingsStore } from './settingsStore';

/** ⌘, on a Mac, Ctrl+, elsewhere: where every app keeps its settings. */
export function isSettingsShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && !event.shiftKey && !event.altKey && !event.repeat && event.key === ',';
}

export function SettingsHost() {
  const { open, tab } = useStore(settingsStore);
  const baseId = useId();
  if (!open) return null;
  const Content = TAB_CONTENT[tab];
  const tabId = (id: SettingsTab) => `${baseId}-tab-${id}`;
  return (
    <InAppWindow title={t('settings.title')} onClose={closeSettings} width={920} height={680} projectUndo>
      {/* Above the tabs, out of the scrolling panel: a notice from the foot of a long panel never scrolls away. */}
      <NoticeBar />
      <div className="flex min-h-0 flex-1">
        {/* Tabs down the side, as a settings window has them; arrows move through them, Tab goes on to the content. */}
        <div role="tablist" aria-orientation="vertical" aria-label={t('settings.sections')} className="flex w-44 shrink-0 flex-col border-r border-border">
          {SETTINGS_TABS.map((id, i) => {
            const selected = id === tab;
            return (
              <button
                key={id}
                id={tabId(id)}
                type="button"
                role="tab"
                data-settings-tab={id}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  openSettings(id);
                }}
                onKeyDown={(event) => {
                  const next = roveFocus(event, i, SETTINGS_TABS.length, '[role="tab"]');
                  const nextTab = next === null ? undefined : SETTINGS_TABS[next];
                  if (nextTab) openSettings(nextTab);
                }}
                className={cx(
                  'sb-label border-b border-border px-3 py-2.5 text-left focus-visible:-outline-offset-4',
                  // As a tile's open tab: oatmeal and bold, and ink text, since muted never sits on oatmeal.
                  selected ? 'bg-surface-raised font-bold text-text' : 'text-text-muted hover:text-text',
                )}
              >
                {TAB_LABEL[id]}
              </button>
            );
          })}
        </div>
        {/* Focusable itself, so its text is reached with Tab even when it has no control (Project, with none open):
            the WAI-ARIA tabs pattern's own advice for a panel. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div id={`${baseId}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={tabId(tab)} className="min-h-0 min-w-0 flex-1 overflow-auto focus-visible:-outline-offset-2">
          <Content />
        </div>
      </div>
    </InAppWindow>
  );
}
