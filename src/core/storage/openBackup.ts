import type { SqlDriver } from './driver';
import { fileStem } from './paths';

// Open backup (CLAUDE.md, The .sbd project file): a backup opens as a separate project and never replaces the
// original. The person works on a copy, not on the backup itself, which pruning may delete later.

const lastSeparator = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));

/** `/Films/Backups/Bey County 2026-11-02 14-05.sbd` → `/Films/Backups`. */
function folderOf(path: string): string {
  return path.slice(0, Math.max(lastSeparator(path), 0));
}

/**
 * Where the copy goes: beside the project the backup came from (out of its Backups folder), named after the
 * backup, `Bey County 2026-11-02 14-05 (from backup).sbd`. A second copy of the same backup gets a number.
 */
export function backupCopyPath(backupPath: string, attempt = 1): string {
  const separator = backupPath[lastSeparator(backupPath)] ?? '/';
  let folder = folderOf(backupPath);
  if (/(^|[/\\])Backups$/.test(folder)) folder = folderOf(folder);
  const suffix = attempt > 1 ? ` (from backup ${String(attempt)})` : ' (from backup)';
  return `${folder}${separator}${fileStem(backupPath)}${suffix}.sbd`;
}

/** The Backups folder next to a project. */
export function backupsFolder(projectPath: string): string {
  const separator = projectPath[lastSeparator(projectPath)] ?? '/';
  return `${folderOf(projectPath)}${separator}Backups`;
}

/** A scheduled backup's full path, from the project's path and the backup's file name. */
export function backupPath(projectPath: string, backupName: string): string {
  const separator = projectPath[lastSeparator(projectPath)] ?? '/';
  return `${backupsFolder(projectPath)}${separator}${backupName}`;
}

const MAX_COPIES = 50;

/** Copies `source` to the first free path `pathFor` gives, and returns it. */
async function copyToFree(source: string, driver: SqlDriver, pathFor: (attempt: number) => string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_COPIES; attempt += 1) {
    const dest = pathFor(attempt);
    try {
      await driver.copy(source, dest);
      return dest;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'A file already exists at that path.')) throw error;
    }
  }
  throw new Error('There are many copies of this project here already; move some of them first.');
}

/** Copies a backup next to its project and returns the copy's path, for the caller to open. */
export function copyBackup(source: string, driver: SqlDriver): Promise<string> {
  return copyToFree(source, driver, (attempt) => backupCopyPath(source, attempt));
}

/** `/Films/Bey County.sbd` → `/Films/Bey County (copy).sbd`, then `(copy 2)`. */
export function copyPath(source: string, label: string, attempt = 1): string {
  const suffix = attempt > 1 ? ` (${label} ${String(attempt)})` : ` (${label})`;
  return `${folderOf(source)}${source[lastSeparator(source)] ?? '/'}${fileStem(source)}${suffix}.sbd`;
}

/** Copies a project beside itself, for Open a copy when another computer has it open. */
export function copyBeside(source: string, label: string, driver: SqlDriver): Promise<string> {
  return copyToFree(source, driver, (attempt) => copyPath(source, label, attempt));
}
