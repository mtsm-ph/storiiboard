import { join } from '@tauri-apps/api/path';
import { message, open, save } from '@tauri-apps/plugin-dialog';
import type { LockHolder } from '../../core/storage/driver';
import { fileStem } from '../../core/storage/paths';
import { localDateTime } from '../format';
import type { LockedChoice } from '../openFiles';
import { projectsFolderForNew } from './synced';

// The native Save and Open dialogs (tauri-plugin-dialog), filtered to projects. Desktop only. Each returns null when
// the person cancels.

const PROJECT_FILTER = [{ name: 'Storiiboard Project', extensions: ['sbd'] }];

/** "x" and "x.sbd" both mean x.sbd: Windows adds the extension, and a Mac only adds it if the name has none. */
export function withSbdExtension(path: string): string {
  return /\.sbd$/i.test(path) ? path : `${path}.sbd`;
}

/** Name and folder for a new project, in one dialog. It starts in Documents, or locally when Documents is synced. */
export async function pickNewProjectPath(): Promise<string | null> {
  const path = await save({
    title: 'New Project',
    defaultPath: await join(await projectsFolderForNew(), 'Untitled.sbd'),
    filters: PROJECT_FILTER,
  });
  return path === null ? null : withSbdExtension(path);
}

export async function pickProjectToOpen(title = 'Open Project'): Promise<string | null> {
  const path = await open({ title, multiple: false, directory: false, filters: PROJECT_FILTER });
  return typeof path === 'string' ? path : null;
}

/** Open backup… starts nowhere in particular: backups sit in a Backups folder next to each project. */
export function pickBackupToOpen(): Promise<string | null> {
  return pickProjectToOpen('Open Backup');
}

const OPEN_A_COPY = 'Open a Copy';
const OPEN_ANYWAY = 'Open Anyway';

/**
 * The warning before opening a project another computer has open. Open a copy is the safe choice and comes first:
 * a sync service can't merge two computers' edits to one file, so one set ends up in a conflicted copy.
 */
export async function askWhenLocked(holder: LockHolder, path: string): Promise<LockedChoice> {
  const result = await message(
    `“${fileStem(path)}” has been open on ${holder.computer} since ${localDateTime(new Date(holder.openedAt))}.\n\n` +
      'Editing it on two computers at once can split the work into two conflicting files. Open a copy to work ' +
      'separately, or open it anyway if it’s closed on the other computer.',
    {
      title: 'Open on another computer',
      kind: 'warning',
      buttons: { yes: OPEN_A_COPY, no: OPEN_ANYWAY, cancel: 'Cancel' },
    },
  );
  // Custom buttons report either their label or the role they replace, depending on the platform.
  if (result === OPEN_A_COPY || result === 'Yes') return 'copy';
  if (result === OPEN_ANYWAY || result === 'No') return 'anyway';
  return 'cancel';
}
