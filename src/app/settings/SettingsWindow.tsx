import { useId, type ComponentType } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
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

// Settings in a window of the app's own (polish B), not a workspace of tiles: the project's settings and the person's
// in one place, a tab each, opened from the sidebar's gear or with ⌘, (Ctrl+,), and from the profile button at its
// Profile tab. It remembers the tab last open this session.

export const SETTINGS_TABS = ['project', 'app', 'theme', 'backups', 'storage', 'profile'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

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

interface SettingsState {
  open: boolean;
  tab: SettingsTab;
}

export const settingsStore = createStore<SettingsState>()(() => ({ open: false, tab: 'project' }));

/** Opens Settings, at a given tab or the one last open. */
export function openSettings(tab?: SettingsTab): void {
  settingsStore.setState((s) => ({ open: true, tab: tab ?? s.tab }));
}

export function closeSettings(): void {
  settingsStore.setState({ open: false });
}

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
      <div className="flex min-h-0 flex-1">
        {/* Tabs down the side, as a settings window has them; arrows move through them, Tab goes on to the content. */}
        <div role="tablist" aria-orientation="vertical" aria-label={t('settings.title')} className="flex w-44 shrink-0 flex-col border-r border-border">
          {SETTINGS_TABS.map((id, i) => {
            const selected = id === tab;
            return (
              <button
                key={id}
                id={tabId(id)}
                type="button"
                role="tab"
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
        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={tabId(tab)} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Content />
        </div>
      </div>
    </InAppWindow>
  );
}
