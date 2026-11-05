import { join } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ask } from '../ask';
import type { LockHolder } from '../../core/storage/driver';
import { fileStem } from '../../core/storage/paths';
import { fileMode } from '../fileAccess';
import { localDateTime } from '../format';
import type { LockedChoice } from '../openFiles';
import { projectsFolderForNew } from './synced';
import { t } from '../../core/i18n';

// The native Save and Open dialogs (tauri-plugin-dialog), filtered to projects. Desktop only. Each returns null when
// the person cancels.

// A function, so the filter's name follows the app's language.
const projectFilter = () => [{ name: t('dialogs.projectFilter'), extensions: ['sbd'] }];

/** The memory build's stand-in for both dialogs: a project name, kept under /memory. The tests answer it. */
function promptForPath(title: string): Promise<string | null> {
  const name = window.prompt(title)?.trim();
  return Promise.resolve(name ? withSbdExtension(name.startsWith('/') ? name : `/memory/${name}`) : null);
}

/** "x" and "x.sbd" both mean x.sbd: Windows adds the extension, and a Mac only adds it if the name has none. */
export function withSbdExtension(path: string): string {
  return /\.sbd$/i.test(path) ? path : `${path}.sbd`;
}

/** Name and folder for a new project, in one dialog. It starts in Documents, or locally when Documents is synced. */
export async function pickNewProjectPath(): Promise<string | null> {
  if (fileMode === 'memory') return promptForPath(t('dialogs.newProjectName'));
  const path = await save({
    title: t('dialogs.newProject'),
    defaultPath: await join(await projectsFolderForNew(), `${t('dialogs.untitledFile')}.sbd`),
    filters: projectFilter(),
  });
  return path === null ? null : withSbdExtension(path);
}

export async function pickProjectToOpen(title = t('dialogs.openProject')): Promise<string | null> {
  if (fileMode === 'memory') return promptForPath(title);
  const path = await open({ title, multiple: false, directory: false, filters: projectFilter() });
  return typeof path === 'string' ? path : null;
}

/** Open backup… starts nowhere in particular: backups sit in a Backups folder next to each project. */
export function pickBackupToOpen(): Promise<string | null> {
  return pickProjectToOpen(t('dialogs.openBackup'));
}


/**
 * The warning before opening a project another computer has open. Open a copy is the safe choice, the primary one;
 * Open anyway is marked as the risk it is: a sync service can't merge two computers' edits to one file, so one set
 * ends up in a conflicted copy. Cancel comes first, where focus starts.
 */
export async function askWhenLocked(holder: LockHolder, path: string): Promise<LockedChoice> {
  // In a window of the app's own (polish B), never the system's message box.
  const answer = await ask({
    title: t('dialogs.lockedTitle'),
    text: t('dialogs.lockedText', { name: fileStem(path), computer: holder.computer, since: localDateTime(new Date(holder.openedAt)) }),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'anyway', label: t('dialogs.openAnyway'), variant: 'warning' },
      { id: 'copy', label: t('dialogs.openACopy'), variant: 'primary' },
    ],
    cancel: 'cancel',
  });
  return answer === 'copy' || answer === 'anyway' ? answer : 'cancel';
}
