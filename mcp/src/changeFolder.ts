import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { cleanText } from '../../src/core/model/suggestion';

// The server's one write (7.6, Phase 7 decision 3; docs/SBD_FORMAT.md "Where change files come from", docs/MCP.md "The
// one write"): one new change file into the project's own `<Project> Suggestions/` folder beside it, and nothing else
// anywhere. Never the .sbd, never another folder, never a file it didn't just create, never over an existing file.
//
// - The folder is found as 7.1 finds it (src-tauri/src/changes.rs): `<Project> Suggestions` beside the .sbd, a real
//   folder (not a link or a junction) whose real parent is the project's own folder. When there is none, a renamed
//   project's folder (a real `<anything> Suggestions` beside it whose marker names this project, with no
//   `<anything>.sbd` beside it) is the project's: written into, never a second one made. With neither, the folder is
//   made with its marker and nothing else. A folder whose marker names another project is refused in words.
// - The file is written whole as a temporary file in the folder, a name 7.1's listing skips (it lists only names ending
//   in `.sbdchanges`), opened only if it doesn't exist (O_EXCL), flushed, then put in place under its own name by a
//   hard link, which fails if anything of that name is there, and the temporary name taken away. A volume with no hard
//   links (exFAT, FAT, some network shares) gets a rename after checking nothing of the name is there (Node has no
//   rename that refuses to replace; a file made in the moment between would be replaced). A write that fails takes its
//   temporary file away.

export const MARKER_NAME = 'storiiboard-folder.json';
export const MARKER_FORMAT = 'storiiboard.suggestions-folder';
const FOLDER_SUFFIX = ' Suggestions';
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_ENTRIES = 10_000;

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

export interface SuggestionsFolder {
  /** Its real path. */
  path: string;
  /** Its name beside the project. */
  name: string;
  /** Made by this write, with its marker. */
  made: boolean;
  /** A renamed project's folder: Storiiboard asks to rename it before it brings its files in. */
  renamed: boolean;
}

/** The project's folder for its suggestions: found, or made with its marker; refused when it is another's or a link. */
export function suggestionsFolder(projectPath: string, projectId: string, projectName: string): SuggestionsFolder {
  const beside = dirname(projectPath);
  const besideReal = realpathSync.native(beside);
  const own = `${basename(projectPath).replace(/\.sbd$/i, '')}${FOLDER_SUFFIX}`;
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
    return { path: real, name: own, made: false, renamed: false };
  }
  const renamed = renamedFolder(beside, besideReal, own, projectId);
  if (renamed) return { path: renamed.real, name: renamed.name, made: false, renamed: true };
  try {
    // Not recursive: only this one folder, beside the project, and only when nothing of its name is there.
    mkdirSync(folder);
  } catch {
    throw new FolderRefused(`The folder “${own}” couldn't be made beside the project: nothing was written.`);
  }
  const real = realFolder(folder, besideReal);
  if (!real) throw new FolderRefused(`The folder “${own}” beside the project isn't a folder Storiiboard reads: nothing was written.`);
  writeNew(join(real, MARKER_NAME), new TextEncoder().encode(JSON.stringify({ format: MARKER_FORMAT, project_id: projectId, project_name: projectName })));
  return { path: real, name: own, made: true, renamed: false };
}

/** Writes a file that must not exist yet (O_CREAT | O_EXCL), whole and flushed; a failed write takes it away. */
function writeNew(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, 'wx');
  try {
    let written = 0;
    while (written < bytes.byteLength) written += writeSync(fd, bytes, written, bytes.byteLength - written);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(path);
    throw error;
  }
  closeSync(fd);
}

/** For tests: a step to fail at, to show what a failed write leaves (nothing). */
export interface WriteHooks {
  afterTemp?: () => void;
}

/** A plain file name: no separator, no `.` or `..`, no drive or stream colon, ending in `.sbdchanges`. */
const plainName = (name: string) => name !== '' && !/[/\\:\0]/.test(name) && name !== '.' && name !== '..' && /\.sbdchanges$/.test(name);

/** Puts `bytes` in the folder as `name`, never over anything; refused in words when something of that name is there. */
export function writeChangeFile(folder: string, name: string, bytes: Uint8Array, hooks: WriteHooks = {}): void {
  if (!plainName(name)) throw new FolderRefused('The change file’s name isn’t one it can take: nothing was written.');
  const final = join(folder, name);
  // A name the folder's listing skips: it doesn't end in .sbdchanges.
  const temp = join(folder, `.${name}.${crypto.randomUUID().slice(0, 8)}.writing`);
  try {
    writeNew(temp, bytes);
  } catch (error) {
    throw new FolderRefused(codeOf(error) === 'EEXIST' ? 'A file of that name was already there: nothing was written. Try again.' : 'The change file couldn’t be written: nothing was written.');
  }
  try {
    hooks.afterTemp?.();
    try {
      linkSync(temp, final);
    } catch (error) {
      if (codeOf(error) === 'EEXIST') throw new FolderRefused('A change file of that name is already there: nothing was written. Try again.');
      // No hard links on this volume: a rename, once nothing of the name is there.
      let free = false;
      try {
        lstatSync(final);
      } catch (looked) {
        free = missing(looked);
      }
      if (!free) throw new FolderRefused('A change file of that name is already there: nothing was written. Try again.');
      renameSync(temp, final);
      return;
    }
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Already gone (renamed into place, or never there).
    }
    if (error instanceof FolderRefused) throw error;
    throw new FolderRefused('The change file couldn’t be written: nothing was written.');
  }
  // In place under its own name: the temporary name goes. (Should that fail, the file is written all the same, and the
  // name left is one the folder's listing skips.)
  try {
    unlinkSync(temp);
  } catch {
    // Left as said above.
  }
}
