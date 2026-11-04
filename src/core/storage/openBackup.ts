import { backupFileName, migrationBackupName } from './backups';
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
 * `besideFolder` says where the project is, for backups kept in a folder on this computer (a synced project's).
 */
export function backupCopyPath(backupPath: string, attempt = 1, besideFolder?: string): string {
  const separator = backupPath[lastSeparator(backupPath)] ?? '/';
  let folder = besideFolder ?? folderOf(backupPath);
  if (besideFolder === undefined && /(^|[/\\])Backups$/.test(folder)) folder = folderOf(folder);
  const suffix = attempt > 1 ? ` (from backup ${String(attempt)})` : ' (from backup)';
  return `${folder}${separator}${fileStem(backupPath)}${suffix}.sbd`;
}

const MAX_COPIES = 50;

/** Puts a file at the first free path `pathFor` gives, with `put`, which refuses a path that's taken; returns it. */
async function putAtFree(pathFor: (attempt: number) => string, put: (dest: string) => Promise<void>): Promise<string> {
  for (let attempt = 1; attempt <= MAX_COPIES; attempt += 1) {
    const dest = pathFor(attempt);
    try {
      await put(dest);
      return dest;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'A file already exists at that path.')) throw error;
    }
  }
  throw new Error('There are many copies of this project here already; move some of them first.');
}

/** Copies `source` to the first free path `pathFor` gives, and returns it. */
function copyToFree(source: string, driver: SqlDriver, pathFor: (attempt: number) => string): Promise<string> {
  return putAtFree(pathFor, (dest) => driver.copy(source, dest));
}

/** Copies a backup next to its project and returns the copy's path, for the caller to open. */
export function copyBackup(source: string, driver: SqlDriver, besideFolder?: string): Promise<string> {
  return copyToFree(source, driver, (attempt) => backupCopyPath(source, attempt, besideFolder));
}

/** The folder a file is in. */
export function folderOfPath(path: string): string {
  return folderOf(path);
}

/** A file in a folder, with the folder's own separator. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder}${separator}${name}`;
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

/** A name in a folder is at most 255 bytes of UTF-8 on APFS and ext4, and 255 UTF-16 units on NTFS. */
const MAX_NAME = 255;
/**
 * SQLite on Windows opens a path of at most 259 characters (MAX_PATH, less its terminator), and a project's journal
 * sits at the same path with `-journal` added, so that must fit too. Macs and Linux take far longer paths.
 */
const MAX_WINDOWS_PATH = 259;

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');

const nameFits = (name: string) => new TextEncoder().encode(name).length <= MAX_NAME && name.length <= MAX_NAME;

/** Whether a project file at `path`, its journal and its lock file all have names and paths the disk can hold. */
function fits(path: string): boolean {
  const name = path.slice(lastSeparator(path) + 1);
  if (![`${name}-journal`, `.${name}.lock`].every(nameFits)) return false;
  return !isWindowsPath(path) || `${path}-journal`.length <= MAX_WINDOWS_PATH;
}

/** Any time: the stamp in a backup's name is always the same length. */
const ANY_TIME = new Date(2026, 10, 4, 9, 0);
/** A two-digit schema, so a copy made now can still be upgraded for years. */
const LATER_SCHEMA = 99;

/**
 * Whether the backups a project at `path` will need can be written too, as SQLite writes them, each under its name
 * with `.partial` added until it's complete (src-tauri/src/backup.rs): its scheduled backups in `Backups/` beside it,
 * and the copy made before a schema upgrade, beside it, without which the upgrade refuses to run and the project
 * won't open. A synced project's backups go to a folder on this computer instead, whose path isn't known here; their
 * names are the same, so the name check covers them.
 */
function backupsFit(path: string): boolean {
  const folder = folderOf(path);
  const separator = path[lastSeparator(path)] ?? '/';
  const name = path.slice(lastSeparator(path) + 1);
  const scheduled = `${backupFileName(fileStem(path), ANY_TIME)}.partial`;
  const migration = `${migrationBackupName(name, LATER_SCHEMA, ANY_TIME)}.partial`;
  if (![scheduled, migration].every(nameFits)) return false;
  if (!isWindowsPath(path)) return true;
  const paths = [`${folder}${separator}Backups${separator}${scheduled}`, `${folder}${separator}${migration}`];
  return paths.every((p) => p.length <= MAX_WINDOWS_PATH);
}

/**
 * Open version's copy (1.23): beside the project, named after the version, `Bey County (Board sent to client).sbd`
 * (then `(Board sent to client 2)`), and the draft it's made and restored in first, `.Bey County (Board sent to
 * client) 0a1b2c3d.sbd`, hidden on a Mac. A version's name can be 80 characters, which in Japanese or Chinese is about
 * 240 bytes, so a name that would make a file name or a path too long for the disk or SQLite is shortened to fit: the
 * copy's own, and those of the backups it will need, scheduled and before an upgrade.
 */
export function versionCopyPaths(source: string, versionName: string, draftId: string): { draft: string; path: (attempt: number) => string } {
  const folder = folderOf(source);
  const separator = source[lastSeparator(source)] ?? '/';
  const stem = fileStem(source);
  // What a file name can't hold on Windows or a Mac.
  // eslint-disable-next-line no-control-regex
  const cleaned = versionName.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'version';
  // Shortened a whole character at a time, so an emoji or an accented letter is never cut in half.
  const characters = Array.from(new Intl.Segmenter().segment(cleaned), (part) => part.segment);
  for (let length = characters.length; length > 0; length -= 1) {
    const label = characters.slice(0, length).join('').trimEnd();
    const paths = {
      draft: `${folder}${separator}.${stem} (${label}) ${draftId}.sbd`,
      path: (attempt: number) => copyPath(source, label, attempt),
    };
    // The draft is never backed up or upgraded: it's renamed or deleted in the same Open version.
    if (fits(paths.draft) && fits(paths.path(MAX_COPIES)) && backupsFit(paths.path(MAX_COPIES))) return paths;
  }
  throw new Error('This project’s folder path is too long to put a copy beside it. Move the project to a folder with a shorter path, then open the version again.');
}

/** Gives a draft copy (ProjectFile.saveCopy) the first free name `pathFor` gives, and returns it. */
export function keepCopyAtFree(draft: string, driver: SqlDriver, pathFor: (attempt: number) => string): Promise<string> {
  return putAtFree(pathFor, (dest) => driver.keepCopy(draft, dest));
}
