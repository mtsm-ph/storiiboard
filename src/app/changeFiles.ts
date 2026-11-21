import { invoke } from '@tauri-apps/api/core';
import { t, tn } from '../core/i18n';
import { cleanText } from '../core/model/suggestion';
import { bringInChanges, type BroughtIn } from '../core/ops/suggestions';
import { readChangeFile, refusalWords, type ChangeFileRefusal } from '../core/storage/changeFile';
import type { Project } from '../core/storage/project';
import { ask } from './ask';
import { isTauriApp } from './fileAccess';
import { showInfo, showNotice } from './notice';
import { projectStore } from './projectStore';

// Change files in (7.1, docs/SBD_FORMAT.md "Change files"): Import changes…, a `.sbdchanges` dropped on the window, and
// the project's `<Project> Suggestions/` folder, brought in when the project opens and when the window comes back to
// the front. Every file is untrusted: its bytes go through the one reader (src/core/storage/changeFile.ts) and its
// suggestions in as one op group made inside the store's queue, so no edit lands between reading the records and
// writing. In the desktop app Rust reads only what the dialog or the drop gave it, and finds the folder beside the open
// project itself (src-tauri/src/changes.rs): the page never names a path for it. Every word from a file is shown as text.

/** A change file to bring in: its name as the person sees it, and its bytes, read once when asked. */
export interface ChangeFileSource {
  name: string;
  bytes(): Promise<Uint8Array>;
}

/** Whether a file's name is a change file's: what a drop routes here rather than to the pictures. */
export const isChangeFileName = (name: string): boolean => /\.sbdchanges$/i.test(name);

const baseName = (path: string): string => path.split(/[/\\]/).pop() ?? path;

/** A file Rust was given by the dialog or a drop, read through Rust. */
export function changeFileAtPath(path: string): ChangeFileSource {
  return { name: baseName(path), bytes: async () => new Uint8Array(await invoke<ArrayBuffer>('changes_read', { path })) };
}

/** A file from a file input or the browser build's drop. */
export function changeFileFromFile(file: File): ChangeFileSource {
  return { name: file.name, bytes: async () => new Uint8Array(await file.arrayBuffer()) };
}

/** The Open dialog for a change file; null when it's cancelled. */
export async function chooseChangeFile(): Promise<ChangeFileSource | null> {
  if (isTauriApp) {
    const [path] = await invoke<string[]>('changes_choose', { title: t('dialogs.importChanges'), kind: t('dialogs.changesFilter') });
    return path ? changeFileAtPath(path) : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sbdchanges';
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file ? changeFileFromFile(file) : null);
    };
    input.addEventListener('change', () => {
      done(input.files?.[0] ?? null);
    });
    input.addEventListener('cancel', () => {
      done(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** What bringing one file in did. */
export type BringInOutcome =
  | { kind: 'added'; broughtIn: BroughtIn }
  | { kind: 'already'; broughtIn: BroughtIn }
  | { kind: 'refused'; refusal: ChangeFileRefusal }
  /** Not written: no project, the project switched meanwhile, or the write refused (the store said why). */
  | { kind: 'not_written' };

/**
 * Brings a file's bytes into the open project: read and checked first, then one op group in the store's queue, built
 * from the records as its turn comes. Only into the project it was asked for.
 */
export async function bringInBytes(opened: Project, bytes: Uint8Array): Promise<BringInOutcome> {
  const read = readChangeFile(bytes, opened.projectId);
  if (!read.ok) return { kind: 'refused', refusal: read.refusal };
  const found: { value: BroughtIn | null } = { value: null };
  const written = await projectStore.getState().applyWith((records) => {
    // A project switched to while the file was read: nothing goes into it.
    if (projectStore.getState().project !== opened) return { changes: [] };
    found.value = bringInChanges(records, opened.projectId, read.file);
    return { changes: found.value.changes };
  });
  const broughtIn = found.value;
  if (!written || broughtIn === null) return { kind: 'not_written' };
  return broughtIn.added > 0 ? { kind: 'added', broughtIn } : { kind: 'already', broughtIn };
}

/** The status line for one file's outcome; `file` names it (the folder's files), as text. Null when there's nothing to say. */
export function outcomeWords(outcome: BringInOutcome, file?: string): string | null {
  const named = (message: string) => (file === undefined ? message : t('changes.inFile', { file: cleanText(file, 120), message }));
  if (outcome.kind === 'not_written') return null;
  if (outcome.kind === 'refused') return named(refusalWords(outcome.refusal));
  const { added, taken, authorName } = outcome.broughtIn;
  const said =
    outcome.kind === 'already'
      ? t('changes.already')
      : authorName === null
        ? tn('changes.broughtIn', added)
        : tn('changes.broughtInFrom', added, { name: authorName });
  return named(taken > 0 ? `${said} ${tn('changes.taken', taken)}` : said);
}

/** Brings one file in by hand (Import changes…, a drop) and says what happened on the status line. */
export async function bringInSource(source: ChangeFileSource): Promise<void> {
  const opened = projectStore.getState().project;
  if (!opened) return;
  try {
    const outcome = await bringInBytes(opened, await source.bytes());
    const words = outcomeWords(outcome);
    if (words === null) return;
    if (outcome.kind === 'refused') showNotice(words);
    else showInfo(words, { step: outcome.kind === 'added' });
  } catch (error) {
    showNotice(error);
  }
}

/** Import changes…: the Open dialog, then the file brought in. */
export async function importChanges(): Promise<void> {
  if (!projectStore.getState().project) return;
  try {
    const source = await chooseChangeFile();
    if (source) await bringInSource(source);
  } catch (error) {
    showNotice(error);
  }
}

/** Change files dropped together: each brought in, one after another. */
export async function bringInDropped(sources: readonly ChangeFileSource[]): Promise<void> {
  for (const source of sources) await bringInSource(source);
}

// The folder (desktop app only).

interface Listed {
  name: string;
  bytes: number;
  modified: number;
}

/** changes.rs's Listing. */
interface FolderListing {
  folder: string;
  state: 'none' | 'read' | 'other_project' | 'link';
  otherProjectName: string | null;
  files: Listed[];
  tooLarge: string[];
  more: number;
  renameFrom: string | null;
}

/** Per open project: the folder's files read already (by name, size and time), and whether the rename was offered. */
const readAlready = new WeakMap<Project, Set<string>>();
const renameOffered = new WeakSet<Project>();
/** Per open project: the folder's lines said already, so a focus doesn't say the same one again. */
const said = new WeakMap<Project, Set<string>>();
/** The bring-in running now: a focus while it runs doesn't start another. */
let running: Promise<void> | null = null;

function sayOnce(opened: Project, words: string, warning: boolean): void {
  const lines = said.get(opened) ?? new Set<string>();
  said.set(opened, lines);
  if (lines.has(words)) return;
  lines.add(words);
  if (warning) showNotice(words);
  else showInfo(words, { step: true });
}

async function readFolder(opened: Project, handle: number): Promise<void> {
  const listing = await invoke<FolderListing>('changes_folder', { handle, projectId: opened.projectId });
  if (projectStore.getState().project !== opened) return;
  const folder = cleanText(listing.folder, 200);
  if (listing.state === 'none' && listing.renameFrom !== null && !renameOffered.has(opened)) {
    renameOffered.add(opened);
    const from = listing.renameFrom;
    const answer = await ask({
      title: t('changes.rename.title'),
      text: t('changes.rename.text', { from: cleanText(from, 200), project: opened.name, to: folder }),
      choices: [
        { id: 'not_now', label: t('changes.rename.notNow') },
        { id: 'rename', label: t('changes.rename.rename'), variant: 'primary' },
      ],
      cancel: 'not_now',
    });
    if (answer !== 'rename' || projectStore.getState().project !== opened) return;
    await invoke('changes_folder_rename', { handle, projectId: opened.projectId, from });
    showInfo(t('changes.rename.done', { to: folder }));
    await readFolder(opened, handle);
    return;
  }
  if (listing.state === 'other_project') {
    const name = cleanText(listing.otherProjectName ?? '', 100);
    sayOnce(opened, name === '' ? t('changes.folderOtherProject', { folder }) : t('changes.folderOtherProjectNamed', { folder, name }), true);
    return;
  }
  if (listing.state === 'link') {
    sayOnce(opened, t('changes.folderLink', { folder }), true);
    return;
  }
  if (listing.state !== 'read') return;
  for (const name of listing.tooLarge) sayOnce(opened, t('changes.folderTooLarge', { file: cleanText(name, 120), folder }), true);
  if (listing.more > 0) sayOnce(opened, t('changes.folderMore', { folder }), true);
  const done = readAlready.get(opened) ?? new Set<string>();
  readAlready.set(opened, done);
  let added = 0;
  let files = 0;
  let last: { outcome: BringInOutcome; name: string } | null = null;
  for (const file of listing.files) {
    const key = `${file.name}\u0000${String(file.bytes)}\u0000${String(file.modified)}`;
    if (done.has(key)) continue;
    if (projectStore.getState().project !== opened) return;
    let outcome: BringInOutcome;
    try {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('changes_folder_read', { handle, projectId: opened.projectId, name: file.name }));
      outcome = await bringInBytes(opened, bytes);
    } catch (error) {
      showNotice(error);
      continue;
    }
    if (outcome.kind === 'not_written') continue;
    done.add(key);
    if (outcome.kind === 'refused') {
      const words = outcomeWords(outcome, file.name);
      if (words !== null) sayOnce(opened, words, true);
    } else if (outcome.kind === 'added') {
      added += outcome.broughtIn.added;
      files += 1;
      last = { outcome, name: file.name };
    }
    // A file already brought in says nothing: the folder is read on every return to the window.
  }
  if (files === 1 && last) {
    const words = outcomeWords(last.outcome);
    if (words !== null) showInfo(words, { step: true });
  } else if (files > 1) {
    showInfo(tn('changes.broughtInFiles', added, { files }), { step: true });
  }
}

/**
 * Brings the open project's suggestions folder in (desktop app only): when the project opens and when the window
 * comes back to the front. One at a time; a failure says so and leaves the folder as it is.
 */
export function bringInFolder(): Promise<void> {
  const opened = projectStore.getState().project;
  const handle = opened?.file.nativeHandle;
  if (!isTauriApp || !opened || handle === undefined || running) return running ?? Promise.resolve();
  running = readFolder(opened, handle)
    .catch((error: unknown) => {
      sayOnce(opened, error instanceof Error ? error.message : String(error), true);
    })
    .finally(() => {
      running = null;
    });
  return running;
}
