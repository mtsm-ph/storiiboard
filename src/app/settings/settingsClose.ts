import { t } from '../../core/i18n';
import { ask } from '../ask';
import { applyDrafts, discardDrafts, hasDrafts } from './drafts';
import { closeSettings, remountSettings } from './settingsStore';

// Closing Settings with changes waiting (Kevin, Nov 17): its close button, Escape, or the engine closing it, asks
// whether to apply them or discard them, or to keep editing. With nothing waiting it closes at once, as before. Apply
// with a setting that didn't apply stays open, as Keep editing does.

export type CloseAnswer = 'apply' | 'discard' | 'keep';

type Asker = typeof ask;

/**
 * Asks, when anything waits for Apply, and does what was answered. `shown` says whether the window is still on screen:
 * Keep editing after the engine closed its dialog by itself draws it again. Resolves to what was done.
 */
export async function requestCloseSettings(shown: () => boolean = () => true, asker: Asker = ask): Promise<CloseAnswer | 'closed'> {
  if (!hasDrafts()) {
    closeSettings();
    return 'closed';
  }
  const answer = await asker({
    title: t('settings.closeAsk.title'),
    text: t('settings.closeAsk.text'),
    choices: [
      { id: 'keep', label: t('settings.keepEditing') },
      { id: 'discard', label: t('settings.discardChanges'), variant: 'warning' },
      { id: 'apply', label: t('settings.applyChanges'), variant: 'primary' },
    ],
    cancel: 'keep',
  });
  if (answer === 'apply') {
    // A setting that didn't apply keeps the window open with it still waiting (the notice says why), never lost.
    if (await applyDrafts()) {
      closeSettings();
      return 'apply';
    }
    if (!shown()) remountSettings();
    return 'keep';
  }
  if (answer === 'discard') {
    discardDrafts();
    closeSettings();
    return 'discard';
  }
  if (!shown()) remountSettings();
  return 'keep';
}
