import { closeSync, constants, copyFileSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanText } from '../../src/core/model/suggestion';
import { MAX_CHANGE_FILE_BYTES } from '../../src/core/storage/changeFile';
import { WRITING_NAME } from './changeFile';
import { projectStem } from './project';

// The server's one write (7.6, Phase 7 decision 3; docs/SBD_FORMAT.md "Where change files come from", docs/MCP.md "The
// one write"): one new change file into the project's own `<Project> Suggestions/` folder beside it, and nothing else
// anywhere. Never the .sbd, never another folder, never a file it didn't just create, never over an existing file.
//
// - The folder is found as 7.1 finds it (src-tauri/src/changes.rs): `<stem> Suggestions` beside the .sbd, `<stem>` the
//   file's name less `.sbd` as Rust's `file_stem` gives it, a real folder (not a link or a junction) whose real parent
//   is the project's own folder. When there is none, a renamed project's folder (a real `<anything> Suggestions` beside
//   it whose marker names this project, with no `<anything>.sbd` beside it) is the project's: written into, never a
//   second one made. With neither, the folder is made with its marker and nothing else. A folder whose marker names
//   another project is refused in words.
// - The file is written whole as a temporary file in the folder, a name 7.1's listing skips (it lists only names ending
//   in `.sbdchanges`), opened only if it doesn't exist (O_EXCL), flushed, then put in place under its own name by a
//   hard link, which fails if anything of that name is there, and the temporary name taken away. A volume with no hard
//   links (exFAT, FAT, some network shares) gets a copy that fails if anything of the name is there (COPYFILE_EXCL),
//   never a rename, which would replace one (round 2). A write that fails takes its temporary file away.
// - Round 2: the folder is the one checked. Once the temporary file is open, its real folder must be the real folder
//   found, with the same device and inode (round 3: on Windows too, where NTFS gives a volume serial and a file index),
//   and again just before the link; anything else is refused.
// - Round 2: before writing, the server takes away its own leftovers from a crash: temporary files of exactly its own
//   name's shape (WRITING_NAME) over an hour old. Nothing else in the folder is ever removed.
// - Round 2: a folder whose change files waiting to be brought in, with the new one, would be more than 1,000 files or
//   50 MB is refused in words, so the folder never grows past what the app reads in one pass. Round 3: files the
//   project already brought in don't count (checkRoom).
// - Round 2: a folder made in this call is taken away again, with the marker this call wrote, when the file can't be
//   written: only that folder, and only once it is empty.

export const MARKER_NAME = 'storiiboard-folder.json';
export const MARKER_FORMAT = 'storiiboard.suggestions-folder';
const FOLDER_SUFFIX = ' Suggestions';
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_ENTRIES = 10_000;
/** The app reads at most this many files, and this many bytes, in one pass (src/app/changeFiles.ts). */
export const MAX_FOLDER_FILES = 1000;
export const MAX_FOLDER_BYTES = 50 * 1024 * 1024;
/** A temporary file this old is a crash's leftover: no write takes an hour. */
export const LEFTOVER_AGE_MS = 60 * 60 * 1000;

/** The write refused, in words for the assistant. */
export class FolderRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderRefused';
  }
}

type Marker = { kind: 'none' } | { kind: 'ours' } | { kind: 'other'; name: string };

const missing = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
const codeOf = (error: unknown): string => (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '');

/** The folder's marker, read as 7.1 reads it: a regular file of at most 64 KB; anything else reads as none. */
function readMarker(folder: string, projectId: string): Marker {
  const path = join(folder, MARKER_NAME);
  let fd: number;
  try {
    if (!lstatSync(path).isFile()) return { kind: 'none' };
    fd = openSync(path, 'r');
  } catch {
    return { kind: 'none' };
  }
  let text: string;
  try {
    if (!fstatSync(fd).isFile()) return { kind: 'none' };
    const buffer = Buffer.alloc(MAX_MARKER_BYTES + 1);
    let read = 0;
    for (;;) {
      const n = readSync(fd, buffer, read, buffer.length - read, read);
      if (n === 0) break;
      read += n;
      if (read > MAX_MARKER_BYTES) return { kind: 'none' };
    }
    text = buffer.subarray(0, read).toString('utf8');
  } catch {
    return { kind: 'none' };
  } finally {
    closeSync(fd);
  }
  let marker: unknown;
  try {
    marker = JSON.parse(text);
  } catch {
    return { kind: 'none' };
  }
  if (typeof marker !== 'object' || marker === null || !('format' in marker) || marker.format !== MARKER_FORMAT || !('project_id' in marker) || typeof marker.project_id !== 'string') return { kind: 'none' };
  if (marker.project_id === projectId) return { kind: 'ours' };
  const name = 'project_name' in marker && typeof marker.project_name === 'string' ? cleanText(marker.project_name, 100) : '';
  return { kind: 'other', name };
}

/** The folder's real path when it is a real folder (not a link or a junction) whose real parent is `besideReal`. */
function realFolder(folder: string, besideReal: string): string | null {
  const stat = lstatSync(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
  const real = realpathSync.native(folder);
  return dirname(real) === besideReal ? real : null;
}

/** Whether `<name minus " Suggestions">.sbd` is beside it: that project's folder, never this one's to take. */
function namedForAProject(beside: string, folder: string): boolean {
  const stem = folder.slice(0, -FOLDER_SUFFIX.length);
  try {
    lstatSync(join(beside, `${stem}.sbd`));
    return true;
  } catch (error) {
    // Anything there, or a name that can't be looked at, counts: the folder stays another's.
    return !missing(error);
  }
}

/** A renamed project's folder beside it, as 7.1 offers to rename it: the first by name. */
function renamedFolder(beside: string, besideReal: string, own: string, projectId: string): { name: string; real: string } | null {
  const names = readdirSync(beside, { withFileTypes: true })
    .slice(0, MAX_ENTRIES)
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== own && entry.name.endsWith(FOLDER_SUFFIX))
    .map((entry) => entry.name)
    .filter((name) => !namedForAProject(beside, name))
    .sort();
  for (const name of names) {
    try {
      const real = realFolder(join(beside, name), besideReal);
      if (real && readMarker(real, projectId).kind === 'ours') return { name, real };
    } catch {
      // A folder that can't be looked at isn't this project's.
    }
  }
  return null;
}

/** A folder as it was checked: its real path, and its device and inode, to know it again (round 2). */
export interface CheckedFolder {
  path: string;
  dev: bigint;
  ino: bigint;
}

/** The folder at `real` as it is now, to be known again. */
function checked(real: string): CheckedFolder {
  const stat = lstatSync(real, { bigint: true });
  return { path: real, dev: stat.dev, ino: stat.ino };
}

export interface SuggestionsFolder extends CheckedFolder {
  /** Its name beside the project. */
  name: string;
  /** Made by this write, with its marker. */
  made: boolean;
  /** A renamed project's folder: Storiiboard asks to rename it before it brings its files in. */
  renamed: boolean;
  /** The marker this write made (in a folder it made), to take away again should the file fail; null for none. */
  marker: { dev: bigint; ino: bigint } | null;
}

const SWAPPED = 'The Suggestions folder changed while the file was being written: nothing was written.';

/**
 * Whether `path`, a file the server just made in the folder, is in it still: its real folder is the folder's real path
 * and the same device and inode as when it was checked (round 3: on Windows too). A path that can't be looked at isn't.
 */
function inFolder(folder: CheckedFolder, path: string): boolean {
  try {
    const real = realpathSync.native(path);
    if (dirname(real) !== folder.path) return false;
    const now = lstatSync(dirname(real), { bigint: true });
    if (now.isSymbolicLink() || !now.isDirectory()) return false;
    return now.dev === folder.dev && now.ino === folder.ino;
  } catch {
    return false;
  }
}

/** The project's folder for its suggestions: found, or made with its marker; refused when it is another's or a link. */
export function suggestionsFolder(projectPath: string, projectId: string, projectName: string): SuggestionsFolder {
  const stem = projectStem(projectPath);
  if (stem === null) throw new FolderRefused('This server writes only beside a Storiiboard project, a file whose name ends in .sbd: nothing was written.');
  const beside = dirname(projectPath);
  const besideReal = realpathSync.native(beside);
  const own = `${stem}${FOLDER_SUFFIX}`;
  const folder = join(beside, own);
  let exists = true;
  try {
    lstatSync(folder);
  } catch (error) {
    if (!missing(error)) throw new FolderRefused(`The folder “${own}” beside the project can't be looked at.`);
    exists = false;
  }
  if (exists) {
    const real = realFolder(folder, besideReal);
    if (!real) throw new FolderRefused(`“${own}” beside the project isn't a folder Storiiboard reads (a link, a junction or a file): nothing was written.`);
    const marker = readMarker(real, projectId);
    if (marker.kind === 'other') {
      throw new FolderRefused(`The folder “${own}” beside the project is for another project${marker.name === '' ? '' : `, ${marker.name}`}: nothing was written.`);
    }
    return { ...checked(real), name: own, made: false, renamed: false, marker: null };
  }
  const renamed = renamedFolder(beside, besideReal, own, projectId);
  if (renamed) return { ...checked(renamed.real), name: renamed.name, made: false, renamed: true, marker: null };
  try {
    // Not recursive: only this one folder, beside the project, and only when nothing of its name is there.
    mkdirSync(folder);
  } catch {
    throw new FolderRefused(`The folder “${own}” couldn't be made beside the project: nothing was written.`);
  }
  const real = realFolder(folder, besideReal);
  if (!real) throw new FolderRefused(`The folder “${own}” beside the project isn't a folder Storiiboard reads: nothing was written.`);
  const made: SuggestionsFolder = { ...checked(real), name: own, made: true, renamed: false, marker: null };
  try {
    made.marker = writeNew(made, join(real, MARKER_NAME), new TextEncoder().encode(JSON.stringify({ format: MARKER_FORMAT, project_id: projectId, project_name: projectName })));
  } catch (error) {
    takeAwayMade(made);
    throw error instanceof FolderRefused ? error : new FolderRefused(`The folder “${own}” couldn't be given its marker: nothing was written.`);
  }
  return made;
}

/**
 * A folder this call made, taken away again: the marker this call wrote (known by its device and inode), then the
 * folder, which goes only when it is empty. Anything else in it, or a folder this call didn't make, stays.
 */
export function takeAwayMade(folder: SuggestionsFolder): void {
  if (!folder.made) return;
  if (folder.marker !== null) {
    const path = join(folder.path, MARKER_NAME);
    try {
      const now = lstatSync(path, { bigint: true });
      if (now.isFile() && now.dev === folder.marker.dev && now.ino === folder.marker.ino && inFolder(folder, path)) unlinkSync(path);
    } catch {
      // Gone already, or not ours: left.
    }
  }
  try {
    if (sameFolder(folder)) rmdirSync(folder.path);
  } catch {
    // Not empty, or gone: left.
  }
}

/** Whether the folder at its real path is still the one checked: a real folder there, the same device and inode. */
function sameFolder(folder: CheckedFolder): boolean {
  try {
    if (realpathSync.native(folder.path) !== folder.path) return false;
    const now = lstatSync(folder.path, { bigint: true });
    if (now.isSymbolicLink() || !now.isDirectory()) return false;
    return now.dev === folder.dev && now.ino === folder.ino;
  } catch {
    return false;
  }
}

type FileId = { dev: bigint; ino: bigint };

/** Takes away a file this call made, only while the name is still that file (same device and inode). */
function unlinkOwn(path: string, own: FileId | null): void {
  if (own === null) return;
  try {
    const now = lstatSync(path, { bigint: true });
    if (now.isFile() && now.dev === own.dev && now.ino === own.ino) unlinkSync(path);
  } catch {
    // Gone (with its folder, or never there): nothing of it is where the folder was.
  }
}

/**
 * Writes a file that must not exist yet (O_CREAT | O_EXCL) in the checked folder, whole and flushed; a failed write
 * takes it away. Refused once open if the file isn't in that folder. Its device and inode, to know it again.
 */
function writeNew(folder: CheckedFolder, path: string, bytes: Uint8Array): FileId {
  const fd = openSync(path, 'wx');
  let made: FileId | null = null;
  try {
    const stat = fstatSync(fd, { bigint: true });
    made = { dev: stat.dev, ino: stat.ino };
    if (!inFolder(folder, path)) throw new FolderRefused(SWAPPED);
    let written = 0;
    while (written < bytes.byteLength) written += writeSync(fd, bytes, written, bytes.byteLength - written);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkOwn(path, made);
    throw error;
  }
  closeSync(fd);
  return made;
}

/** For tests: a step to fail at, to show what a failed write leaves (nothing). */
export interface WriteHooks {
  afterTemp?: () => void;
}

/** A plain file name: no separator, no `.` or `..`, no drive or stream colon, ending in `.sbdchanges`. */
const plainName = (name: string) => name !== '' && !/[/\\:\0]/.test(name) && name !== '.' && name !== '..' && /\.sbdchanges$/.test(name);

/** A folder by its path: checked now. */
const folderOf = (folder: string | CheckedFolder): CheckedFolder => (typeof folder === 'string' ? checked(realpathSync.native(folder)) : folder);

/**
 * The server's own leftovers in the folder, taken away: regular files whose names are exactly its temporary names'
 * shape (WRITING_NAME) and that are over an hour old, from a write a crash cut short. Nothing else is ever removed.
 */
export function removeLeftovers(folder: string | CheckedFolder, now = Date.now()): void {
  const known = folderOf(folder);
  let names: string[];
  try {
    names = readdirSync(known.path).slice(0, MAX_ENTRIES);
  } catch {
    return;
  }
  for (const name of names) {
    if (!WRITING_NAME.test(name)) continue;
    const path = join(known.path, name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink() && now - stat.mtimeMs > LEFTOVER_AGE_MS && inFolder(known, path)) unlinkSync(path);
    } catch {
      // Gone, or can't be looked at: left.
    }
  }
}

/** A name the server wrote (changeFileName): its last 8 hex are the first 8 of the file's id. */
const SERVER_NAME = /^\d{4}-\d\d-\d\d \d\d-\d\d-\d\dZ [\p{L}\p{N} ._-]{1,40} ([0-9a-f]{8})\.sbdchanges$/u;

/** A change file's own `id`, from its bytes; null when it has none. */
function fileId(bytes: Buffer): string | null {
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && 'id' in parsed && typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}

/** A change file's bytes, read whole only within the app's own bound for one file; null when it can't be read. */
function fileBytes(path: string, size: number): Buffer | null {
  if (size > MAX_CHANGE_FILE_BYTES) return null;
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(MAX_CHANGE_FILE_BYTES + 1);
    let read = 0;
    for (;;) {
      const n = readSync(fd, buffer, read, buffer.length - read, read);
      if (n === 0) break;
      read += n;
      if (read > MAX_CHANGE_FILE_BYTES) return null;
    }
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The folder as the room check needs it: checked, and its name beside the project for the words. */
export interface RoomFolder extends CheckedFolder {
  name: string;
}

/**
 * Refused in words when the change files waiting in the folder, with the one about to be written (`adding` bytes),
 * would be more files or more bytes than the app reads in a pass (round 3). Only files not yet brought in count: a file
 * is known as brought in by the 8 hex of a name the server wrote, or else by its own `id` (read within the app's bound
 * for one file, and at most the folder's byte budget read in all), against the ids the project's log names
 * (`broughtIn`). A file that can't be read counts as waiting.
 *
 * Round 6: a waiting file of a name the server wrote is read too (within the same budget) and counted by `atReserve`
 * (propose.ts' waitingAtReserve: each `before` value at its reserve), so its count holds what was sent then, never the
 * stored values; any other file, or one past the budget, counts at its real size.
 */
export function checkRoom(folder: RoomFolder, broughtIn: ReadonlySet<string>, adding: number, atReserve: (bytes: Uint8Array) => number = (b) => b.byteLength): void {
  const prefixes = new Set([...broughtIn].map((id) => id.slice(0, 8).toLowerCase()));
  let files = 1;
  let bytes = adding;
  let readBytes = 0;
  const full = () => files > MAX_FOLDER_FILES || bytes > MAX_FOLDER_BYTES;
  for (const name of readdirSync(folder.path)) {
    if (!/\.sbdchanges$/i.test(name)) continue;
    const path = join(folder.path, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) continue;
      const hex = SERVER_NAME.exec(name)?.[1];
      if (hex !== undefined && prefixes.has(hex)) continue;
      let counted = stat.size;
      if (readBytes + stat.size <= MAX_FOLDER_BYTES) {
        readBytes += stat.size;
        const content = fileBytes(path, stat.size);
        if (hex === undefined) {
          const id = content === null ? null : fileId(content);
          if (id !== null && broughtIn.has(id)) continue;
        } else if (content !== null) counted = Math.max(stat.size, atReserve(content));
      }
      files += 1;
      bytes += counted;
    } catch {
      // Gone meanwhile: not counted.
    }
    if (full()) break;
  }
  if (full()) {
    throw new FolderRefused(
      `${files > MAX_FOLDER_FILES ? '1,000 change files' : '50 MB of change files'} are waiting in ${folder.name}: bring them in (Bring in, in the status line) or move some out of the folder.`,
    );
  }
}

/** Puts `bytes` in the folder as `name`, never over anything; refused in words when something of that name is there. */
export function writeChangeFile(folder: string | CheckedFolder, name: string, bytes: Uint8Array, hooks: WriteHooks = {}): void {
  if (!plainName(name)) throw new FolderRefused('The change file’s name isn’t one it can take: nothing was written.');
  let known: CheckedFolder;
  try {
    known = folderOf(folder);
  } catch {
    throw new FolderRefused('The change file couldn’t be written: nothing was written.');
  }
  const final = join(known.path, name);
  // A name the folder's listing skips: it doesn't end in .sbdchanges.
  const temp = join(known.path, `.${name}.${crypto.randomUUID().slice(0, 8)}.writing`);
  let own: FileId;
  try {
    own = writeNew(known, temp, bytes);
  } catch (error) {
    if (error instanceof FolderRefused) throw error;
    throw new FolderRefused(codeOf(error) === 'EEXIST' ? 'A file of that name was already there: nothing was written. Try again.' : 'The change file couldn’t be written: nothing was written.');
  }
  try {
    hooks.afterTemp?.();
    // The folder checked again, just before the file goes in under its name.
    if (!inFolder(known, temp)) throw new FolderRefused(SWAPPED);
    try {
      linkSync(temp, final);
    } catch (error) {
      if (codeOf(error) === 'EEXIST') throw new FolderRefused('A change file of that name is already there: nothing was written. Try again.');
      // No hard links on this volume: a copy that fails if anything of the name is there, never a rename.
      try {
        copyFileSync(temp, final, constants.COPYFILE_EXCL);
      } catch (copied) {
        throw new FolderRefused(codeOf(copied) === 'EEXIST' ? 'A change file of that name is already there: nothing was written. Try again.' : 'The change file couldn’t be written: nothing was written.');
      }
    }
  } catch (error) {
    unlinkOwn(temp, own);
    if (error instanceof FolderRefused) throw error;
    throw new FolderRefused('The change file couldn’t be written: nothing was written.');
  }
  // In place under its own name: the temporary name goes. (Should that fail, the file is written all the same, and the
  // name left is one the folder's listing skips, taken away as a leftover by a later write.)
  unlinkOwn(temp, own);
}
