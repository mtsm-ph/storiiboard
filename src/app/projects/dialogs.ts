import { documentDir, join } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';

// The native Save and Open dialogs (tauri-plugin-dialog), filtered to projects. Desktop only. Each returns null when
// the person cancels.

const PROJECT_FILTER = [{ name: 'Storiiboard Project', extensions: ['sbd'] }];

/** "x" and "x.sbd" both mean x.sbd: Windows adds the extension, and a Mac only adds it if the name has none. */
export function withSbdExtension(path: string): string {
  return /\.sbd$/i.test(path) ? path : `${path}.sbd`;
}

/** Name and folder for a new project, in one dialog. It starts in Documents. */
export async function pickNewProjectPath(): Promise<string | null> {
  const path = await save({
    title: 'New Project',
    defaultPath: await join(await documentDir(), 'Untitled.sbd'),
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
