import { invoke } from '@tauri-apps/api/core';
import { localizeError, t, tn } from '../core/i18n';
import { cleanText } from '../core/model/suggestion';
import { bringInManyChanges, everBroughtIn, type BroughtIn } from '../core/ops/suggestions';
import { readChangeFile, refusalWords, type ChangeFile, type ChangeFileRefusal } from '../core/storage/changeFile';
import type { Project } from '../core/storage/project';
import { ask } from './ask';
import { isTauriApp } from './fileAccess';
import { showInfo, showNotice } from './notice';
import { projectStore } from './projectStore';

// Change files in (7.1, docs/SBD_FORMAT.md "Change files"): Import changes…, a `.sbdchanges` dropped on the window, and
// the project's `<Project> Suggestions/` folder, brought in when the project opens and found (never brought in) when
// the window comes back to the front. Every file is untrusted: its bytes go through the one reader
// (src/core/storage/changeFile.ts) and its suggestions in as one op group made inside the store's queue, so no edit
// lands between reading the records and writing. In the desktop app Rust reads only what the dialog or the drop gave it,
// once, and finds the folder and the project's id beside and inside the open project itself (src-tauri/src/changes.rs):
// the page never names a path or an id for it. Every word from a file is shown as text.

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
  /** Nothing added because every suggestion's id is another item's (never one brought in before). */
  | { kind: 'taken'; broughtIn: BroughtIn }
  /** A change file with `suggestions: []`. */
  | { kind: 'empty' }
  | { kind: 'refused'; refusal: ChangeFileRefusal }
  /** Not written: no project, the project switched meanwhile, or the write refused (the store said why). */
  | { kind: 'not_written' };

/** One file's outcome from what bringing it in found. */
const outcomeOf = (file: ChangeFile, broughtIn: BroughtIn): BringInOutcome =>
  file.suggestions.length === 0
    ? { kind: 'empty' }
    : broughtIn.added > 0
      ? { kind: 'added', broughtIn }
      : broughtIn.already === 0 && broughtIn.taken > 0
        ? { kind: 'taken', broughtIn }
        : { kind: 'already', broughtIn };

/**
 * Brings files already read into the open project as one op group in the store's queue, built from the records as its
 * turn comes; null when nothing was written (the project switched, or the write refused). Only into the project it was
 * asked for.
 */
async function bringInRead(opened: Project, files: readonly ChangeFile[], skip?: ReadonlySet<string>): Promise<BroughtIn[] | null> {
  const found: { value: BroughtIn[] | null } = { value: null };
  const written = await projectStore.getState().applyWith((records) => {
    // A project switched to while the file was read: nothing goes into it.
    if (projectStore.getState().project !== opened) return { changes: [] };
    const many = bringInManyChanges(records, opened.projectId, files, skip);
    found.value = many.each;
    return { changes: many.changes };
  });
  return written ? found.value : null;
}

/**
 * Brings a file's bytes into the open project: read and checked first, then one op group in the store's queue. By hand
 * (Import changes…, a drop), so a file whose bring-in was undone comes in again: the person chose it.
 */
export async function bringInBytes(opened: Project, bytes: Uint8Array): Promise<BringInOutcome> {
  const read = readChangeFile(bytes, opened.projectId);
  if (!read.ok) return { kind: 'refused', refusal: read.refusal };
  const broughtIn = (await bringInRead(opened, [read.file]))?.[0];
  return broughtIn === undefined ? { kind: 'not_written' } : outcomeOf(read.file, broughtIn);
}

/** The status line for one file's outcome; `file` names it (the folder's files), as text. Null when there's nothing to say. */
export function outcomeWords(outcome: BringInOutcome, file?: string): string | null {
  const named = (message: string) => (file === undefined ? message : t('changes.inFile', { file: cleanText(file, 120), message }));
  if (outcome.kind === 'not_written') return null;
  if (outcome.kind === 'refused') return named(refusalWords(outcome.refusal));
  if (outcome.kind === 'empty') return named(t('changes.empty'));
  if (outcome.kind === 'taken') return named(tn('changes.allTaken', outcome.broughtIn.taken));
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

// The folder (desktop app only). A pass brings the folder's new files in as one op group, so one undo takes the whole
// pass back: when the project opens, and each time the person presses Bring in. Coming back to the window only finds
// what's new and says so, with Bring in, so a return to the app never touches ⌘Z or ⌘⇧Z (7.1 round 2).

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
  /** Every change file of at most 5 MB among the entries looked at, by name. */
  files: Listed[];
  tooLarge: string[];
  /** The walk stopped at 10,000 entries: files past them aren't listed. */
  capped: boolean;
  renameFrom: string | null;
}

/** At most this many files are read in one pass; the rest wait for Bring in. */
export const MAX_PASS_FILES = 200;
/** At most this many bytes of change files are read in one pass. */
export const MAX_PASS_BYTES = 10 * 1024 * 1024;
/** At most this many suggestions come in in one pass (one op group). */
export const MAX_PASS_SUGGESTIONS = 2000;

/** What one open project's folder has done this session. */
interface FolderState {
  /** The files read already, by name, size and time: one rewritten with the same size inside a coarse time waits for the next open. */
  read: Set<string>;
  /** The lines said already, so a later pass or a focus doesn't say the same one again. */
  said: Set<string>;
  /** Whether the open pass ran: a project's first request, whatever asked, is its pass. */
  opened: boolean;
  renameOffered: boolean;
  /** The waiting files a focus last said, so it says nothing new until they change. */
  lastWaiting: string;
}

const states = new WeakMap<Project, FolderState>();

function stateOf(opened: Project): FolderState {
  const known = states.get(opened);
  if (known) return known;
  const made: FolderState = { read: new Set(), said: new Set(), opened: false, renameOffered: false, lastWaiting: '' };
  states.set(opened, made);
  return made;
}

const keyOf = (file: Listed): string => `${file.name}\u0000${String(file.bytes)}\u0000${String(file.modified)}`;

function sayOnce(state: FolderState, words: string, warning: boolean): void {
  if (state.said.has(words)) return;
  state.said.add(words);
  if (warning) showNotice(words);
  else showInfo(words);
}

/** What a request asks: the open pass, a pass (Bring in), or only finding what's new (the window back in front). */
type FolderAsk = 'open' | 'pass' | 'find';

/** The run now, one at a time; what was asked meanwhile runs after it, for whichever project is open then. */
let running: Promise<void> | null = null;
let again: FolderAsk | null = null;

const stronger = (a: FolderAsk | null, b: FolderAsk): FolderAsk => (a === 'pass' || b === 'pass' ? 'pass' : a === 'open' || b === 'open' ? 'open' : 'find');

function request(ask: FolderAsk): Promise<void> {
  if (!isTauriApp) return Promise.resolve();
  if (running) {
    again = stronger(again, ask);
    return running;
  }
  running = (async () => {
    let next: FolderAsk | null = ask;
    while (next !== null) {
      again = null;
      const opened = projectStore.getState().project;
      if (opened) {
        try {
          await runFolder(opened, next);
        } catch (error) {
          sayOnce(stateOf(opened), error instanceof Error ? error.message : String(error), true);
        }
      }
      next = again;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** The open project's folder, as a project opens: its open pass, once per open. */
export const bringInFolder = (): Promise<void> => request('open');
/** The window came back to the front: what's new is found and said, never brought in. */
export const findInFolder = (): Promise<void> => request('find');
/** Bring in, pressed: one more pass, one more op group. */
export const bringInWaiting = (): Promise<void> => request('pass');

/** The waiting line with its Bring in button. */
function waitingAction() {
  return {
    label: t('changes.bringIn'),
    run: () => {
      void bringInWaiting();
    },
  };
}

async function runFolder(opened: Project, ask: FolderAsk): Promise<void> {
  const handle = opened.file.nativeHandle;
  if (handle === undefined) return;
  const state = stateOf(opened);
  let mode: 'pass' | 'find';
  if (!state.opened) {
    state.opened = true;
    mode = 'pass';
  } else if (ask === 'open') return;
  else mode = ask;
  const listing = await listFolder(opened, state, handle);
  if (listing === null || projectStore.getState().project !== opened) return;
  const folder = cleanText(listing.folder, 200);
  const waiting = listing.files.filter((file) => !state.read.has(keyOf(file)));
  if (mode === 'find') {
    const keys = waiting.map(keyOf).join('\u0001');
    if (waiting.length > 0 && keys !== state.lastWaiting) showInfo(tn('changes.waiting', waiting.length, { folder }), { action: waitingAction() });
    state.lastWaiting = keys;
    return;
  }
  state.lastWaiting = '';
  await pass(opened, state, handle, folder, waiting);
}

/** The listing, with the rename offered once per open and the folder's own lines said; null when there's nothing to read. */
async function listFolder(opened: Project, state: FolderState, handle: number): Promise<FolderListing | null> {
  const listing = await invoke<FolderListing>('changes_folder', { handle });
  if (projectStore.getState().project !== opened) return null;
  const folder = cleanText(listing.folder, 200);
  if (listing.state === 'none' && listing.renameFrom !== null && !state.renameOffered) {
    state.renameOffered = true;
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
    if (answer !== 'rename' || projectStore.getState().project !== opened) return null;
    await invoke('changes_folder_rename', { handle, from });
    showInfo(t('changes.rename.done', { to: folder }));
    return listFolder(opened, state, handle);
  }
  if (listing.state === 'other_project') {
    const name = cleanText(listing.otherProjectName ?? '', 100);
    sayOnce(state, name === '' ? t('changes.folderOtherProject', { folder }) : t('changes.folderOtherProjectNamed', { folder, name }), true);
    return null;
  }
  if (listing.state === 'link') {
    sayOnce(state, t('changes.folderLink', { folder }), true);
    return null;
  }
  if (listing.state !== 'read') return null;
  for (const name of listing.tooLarge) sayOnce(state, t('changes.folderTooLarge', { file: cleanText(name, 120), folder }), true);
  if (listing.capped) sayOnce(state, t('changes.folderCapped', { folder }), true);
  return listing;
}

/**
 * One pass: the waiting files read in name order, at most 200 files, 10 MB and 2,000 suggestions, then brought in as one
 * op group. A file or a suggestion the log ever brought in, undone ones included, is skipped, so an undone pass stays
 * undone. What's left waits, with a line and Bring in.
 */
async function pass(opened: Project, state: FolderState, handle: number, folder: string, waiting: readonly Listed[]): Promise<void> {
  const ever = await everBroughtIn(opened.file);
  const taken: { name: string; key: string; file: ChangeFile }[] = [];
  /** Read and done with: refused, or brought in before. Marked read at once, as nothing of them is written. */
  const settled: string[] = [];
  let bytes = 0;
  let suggestions = 0;
  let reads = 0;
  for (const listed of waiting) {
    if (reads >= MAX_PASS_FILES || bytes + listed.bytes > MAX_PASS_BYTES) break;
    if (projectStore.getState().project !== opened) return;
    const key = keyOf(listed);
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(await invoke<ArrayBuffer>('changes_folder_read', { handle, name: listed.name }));
    } catch (error) {
      // Said with its name, and not read again until the file changes or the project opens again.
      sayOnce(state, t('changes.inFile', { file: cleanText(listed.name, 120), message: localizeError(error instanceof Error ? error.message : String(error)) }), true);
      state.read.add(key);
      continue;
    }
    reads += 1;
    // By the larger of the listed size and what was read: a file that grew after the listing counts as it is now.
    bytes += Math.max(listed.bytes, raw.byteLength);
    const read = readChangeFile(raw, opened.projectId);
    if (!read.ok) {
      const words = outcomeWords({ kind: 'refused', refusal: read.refusal }, listed.name);
      if (words !== null) sayOnce(state, words, true);
      settled.push(key);
      continue;
    }
    if (ever.files.has(read.file.id)) {
      settled.push(key);
      continue;
    }
    const fresh = read.file.suggestions.filter((suggestion) => !ever.suggestions.has(suggestion.id)).length;
    // A file that would take the pass past 2,000 waits for the next; one alone always fits (a file holds at most 2,000).
    if (taken.length > 0 && suggestions + fresh > MAX_PASS_SUGGESTIONS) break;
    suggestions += fresh;
    taken.push({ name: listed.name, key, file: read.file });
  }
  for (const key of settled) state.read.add(key);
  if (projectStore.getState().project !== opened) return;
  const results = taken.length === 0 ? [] : await bringInRead(opened, taken.map((entry) => entry.file), ever.suggestions);
  // Not written (the project switched, or the write refused and the store said why): they wait for the next pass.
  if (results === null) return;
  let added = 0;
  let files = 0;
  let last: BringInOutcome | null = null;
  for (const [i, entry] of taken.entries()) {
    state.read.add(entry.key);
    const broughtIn = results[i];
    if (!broughtIn) continue;
    const outcome = outcomeOf(entry.file, broughtIn);
    if (outcome.kind === 'added') {
      added += broughtIn.added;
      files += 1;
      last = outcome;
    } else if (outcome.kind === 'taken' || outcome.kind === 'empty') {
      const words = outcomeWords(outcome, entry.name);
      if (words !== null) sayOnce(state, words, false);
    }
    // A file already brought in says nothing: the folder is read at every open.
  }
  const left = waiting.filter((file) => !state.read.has(keyOf(file))).length;
  const brought = files === 1 && last ? outcomeWords(last) : files > 1 ? tn('changes.broughtInFiles', added, { files }) : null;
  const wait = left > 0 ? tn('changes.waiting', left, { folder }) : null;
  if (wait !== null) showInfo(brought === null ? wait : `${brought} ${wait}`, { step: brought !== null, action: waitingAction() });
  else if (brought !== null) showInfo(brought, { step: true });
}
