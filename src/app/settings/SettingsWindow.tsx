import { useId, useRef, type ComponentType } from 'react';
import { useStore } from 'zustand';
import { labels, t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { InAppWindow } from '../../ui/InAppWindow';
import { roveFocus } from '../../ui/roving';
import { useScrollLane } from '../../ui/scrollLane';
import { OnlineServicesTab } from '../preferences/OnlineServicesTab';
import { AppTile } from '../preferences/AppTile';
import { AssistantTab } from '../preferences/AssistantTab';
import { BackupsPanel } from '../project/BackupsPanel';
import { ProjectHome } from '../project/ProjectHome';
import { StorageTile } from '../project/StorageTile';
import { ThemeTile } from '../theme/ThemeTile';
import { PresetsTab, SavePresetButton } from '../presets/PresetsTab';
import { ProfileTab } from './profile';
import { openSettings, SETTINGS_TABS, settingsStore, type SettingsTab } from './settingsStore';
import { applyDrafts, discardDrafts, useHasDrafts } from './drafts';
import { requestCloseSettings } from './settingsClose';
import { NoticeBar } from '../NoticeBar';

// Settings in a window of the app's own (polish B), not a workspace of tiles: the project's settings and the person's
// in one place, a tab each, opened from the sidebar's gear or with ⌘, (Ctrl+,), and from the profile button at its
// Profile tab. It remembers the tab last open this session. Which tab is open lives in settingsStore.ts, so a tab's
// content can open Settings at another tab without importing this window; it's re-exported here as before.
// A change to this computer's settings waits for Apply changes (Kevin, Nov 17: drafts.ts), and closing with one waiting
// asks (settingsClose.ts). The project's own fields stay edits through ops, saved at once and undone with ⌘Z.

export { closeSettings, openSettings, SETTINGS_TABS, settingsStore, type SettingsTab } from './settingsStore';

const TAB_LABEL: Readonly<Record<SettingsTab, string>> = labels({
  project: 'settings.tab.project',
  app: 'settings.tab.app',
  theme: 'settings.tab.theme',
  backups: 'settings.tab.backups',
  storage: 'settings.tab.storage',
  online: 'settings.tab.online',
  assistant: 'settings.tab.assistant',
  profile: 'settings.tab.profile',
  presets: 'settings.tab.presets',
});

const TAB_CONTENT: Readonly<Record<SettingsTab, ComponentType>> = {
  project: ProjectHome,
  app: AppTile,
  theme: ThemeTile,
  backups: BackupsPanel,
  storage: StorageTile,
  online: OnlineServicesTab,
  assistant: AssistantTab,
  profile: ProfileTab,
  presets: PresetsTab,
};

/** ⌘, on a Mac, Ctrl+, elsewhere: where every app keeps its settings. */
export function isSettingsShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && !event.shiftKey && !event.altKey && !event.repeat && event.key === ',';
}

/** A title-bar button: small enough for the 26 px bar, dashed and muted while there is nothing for it to do. */
const HEADER_BUTTON =
  'sb-label inline-flex h-[22px] shrink-0 items-center border px-2 focus-visible:-outline-offset-2 disabled:border-dashed disabled:border-text-muted disabled:bg-transparent disabled:text-text-muted';

/**
 * Apply changes and Discard changes (Kevin, Nov 17), beside Save preset…: what is changed in Settings waits for one of
 * them, and they act only while something waits. Disabled otherwise, so they are no stop for Tab with nothing to do.
 */
function DraftButtons({ panelId }: { panelId: string }) {
  const waiting = useHasDrafts();
  // The button pressed goes disabled with nothing left waiting: focus moves to the tab's panel rather than the page.
  const settle = () => {
    document.getElementById(panelId)?.focus();
  };
  return (
    <>
      <button
        type="button"
        disabled={!waiting}
        data-settings-discard=""
        className={cx(HEADER_BUTTON, 'border-text text-text hover:bg-surface-raised')}
        onClick={() => {
          discardDrafts();
          settle();
        }}
      >
        {t('settings.discardChanges')}
      </button>
      <button
        type="button"
        disabled={!waiting}
        data-settings-apply=""
        // On the accent fill the ring is accent-contrast (DESIGN.md), and Dark edges it in the accent, as Button primary.
        className={cx(
          HEADER_BUTTON,
          'border-text bg-accent font-bold text-accent-contrast focus-visible:outline-accent-contrast dark:enabled:border-accent',
        )}
        onClick={() => {
          // Focus moves once all is written: a setting that didn't apply keeps the button active, and focus on it.
          void applyDrafts().then((all) => {
            if (all) settle();
          });
        }}
      >
        {t('settings.applyChanges')}
      </button>
      <SavePresetButton />
    </>
  );
}

export function SettingsHost() {
  const { open, tab, mount } = useStore(settingsStore);
  const baseId = useId();
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useScrollLane(panel);
  if (!open) return null;
  const Content = TAB_CONTENT[tab];
  const tabId = (id: SettingsTab) => `${baseId}-tab-${id}`;
  // Still on screen: Chromium closes a modal dialog by itself on a second Escape, and Keep editing then draws it again.
  const shown = () => body.current?.closest('dialog')?.open === true;
  return (
    <InAppWindow
      key={mount}
      title={t('settings.title')}
      onClose={() => {
        void requestCloseSettings(shown).then((answer) => {
          // Back to editing: focus goes to the tab's panel, since what had it was left as the window began to close.
          if (answer === 'keep') {
            requestAnimationFrame(() => {
              document.getElementById(`${baseId}-panel`)?.focus();
            });
          }
        });
      }}
      width={920}
      height={680}
      projectUndo
      actions={<DraftButtons panelId={`${baseId}-panel`} />}
    >
      {/* Above the tabs, out of the scrolling panel: a notice from the foot of a long panel never scrolls away. */}
      <NoticeBar />
      <div ref={body} className="flex min-h-0 flex-1">
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
        <div ref={panel} id={`${baseId}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={tabId(tab)} className="min-h-0 min-w-0 flex-1 overflow-auto focus-visible:-outline-offset-2">
          <Content />
        </div>
      </div>
    </InAppWindow>
  );
}
