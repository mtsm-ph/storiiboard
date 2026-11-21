import { invoke } from '@tauri-apps/api/core';
import { t, tn } from '../core/i18n';
import { cleanText } from '../core/model/suggestion';
import { bringInManyChanges, everBroughtIn, type BroughtIn } from '../core/ops/suggestions';
import { readChangeFile, refusalWords, type ChangeFile, type ChangeFileRefusal } from '../core/storage/changeFile';
import type { Project } from '../core/storage/project';
import { ask } from './ask';
import { isTauriApp } from './fileAccess';
import { clearNotice, noticeStore, showInfo, showNotice, type NoticeAction } from './notice';
import { projectStore } from './projectStore';
import { openSuggestions } from '../features/suggestions/suggestionsFocus';

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
  if (!written || found.value === null) return null;
  noteBroughtIn(opened, files, found.value);
  return found.value;
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

/**
 * Review, beside the line that says suggestions came in (7.2): the Suggestions tile on that import, for the project it
 * came into only; pressed after a switch, it takes its line away.
 */
function reviewAction(opened: Project, changeFileId: string): NoticeAction {
  return {
    label: t('changes.review'),
    run: () => {
      if (projectStore.getState().project !== opened) clearNotice();
      else openSuggestions(changeFileId, opened.projectId);
    },
  };
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
    else if (outcome.kind === 'added') {
      // The import's change file, as the records it made name it.
      const made = outcome.broughtIn.changes[0];
      const fileId = made?.kind === 'create' ? made.record.props?.change_file_id : undefined;
      showInfo(words, { step: true, action: typeof fileId === 'string' ? reviewAction(opened, fileId) : null });
    } else showInfo(words);
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

// Two budgets a pass (7.1 round 3): what it reads to find what's new, and what it brings in. A file brought in before
// costs only the read budget, so a folder of 205 files already in and one new one brings the new one in at open.

/** At most this many files are read in one pass to find what's new, a failed read counted. */
export const MAX_READ_FILES = 1000;
/** At most this many bytes of change files are read in one pass, by the larger of the listed and the read size. */
export const MAX_READ_BYTES = 50 * 1024 * 1024;
/** At most this many new files come in in one pass; the rest wait for Bring in. */
export const MAX_PASS_FILES = 200;
/** At most this many bytes of new change files come in in one pass. */
export const MAX_PASS_BYTES = 10 * 1024 * 1024;
/** At most this many suggestions come in in one pass (one op group). */
export const MAX_PASS_SUGGESTIONS = 2000;

/** What the log says was ever brought in, read once per open and added to as each bring-in writes (the log only grows). */
interface Ever {
  suggestions: Set<string>;
  files: Set<string>;
}

/** What one open project's folder has done this session. */
interface FolderState {
  /**
   * The files settled already, by name, size and time: brought in, refused, or brought in before. One rewritten with the
   * same size inside a coarse time waits for the next open. A file that couldn't be read is never settled: the next
   * pass tries it again.
   */
  read: Set<string>;
  /** The lines said already, so a later pass or a focus doesn't say the same one again. */
  said: Set<string>;
  /** Whether the open pass ran: a project's first request, whatever asked, is its pass. */
  opened: boolean;
  renameOffered: boolean;
  /** The waiting files last said (by a find or a pass's own line), so a find says nothing until they change. */
  lastWaiting: string;
  /** everBroughtIn's answer for this open, once read; null until a pass needs it. */
  ever: Ever | null;
  /** What bring-ins wrote while `ever` was still null, merged into it once it's read (7.1 round 4). */
  pending: Ever;
}

const states = new WeakMap<Project, FolderState>();

function stateOf(opened: Project): FolderState {
  const known = states.get(opened);
  if (known) return known;
  const made: FolderState = {
    read: new Set(),
    said: new Set(),
    opened: false,
    renameOffered: false,
    lastWaiting: '',
    ever: null,
    pending: { suggestions: new Set(), files: new Set() },
  };
  states.set(opened, made);
  return made;
}

/**
 * What a bring-in just wrote, added to this open's `ever`: the log is append-only, so it is never read again. Before
 * `ever` is read it goes into `pending`, as the log's read may have begun before this write.
 */
function noteBroughtIn(opened: Project, files: readonly ChangeFile[], each: readonly BroughtIn[]): void {
  const state = stateOf(opened);
  const ever = state.ever ?? state.pending;
  for (const [i, file] of files.entries()) {
    const made = each[i]?.changes ?? [];
    for (const change of made) if (change.kind === 'create' && change.record.id !== undefined) ever.suggestions.add(change.record.id);
    if (made.length > 0) ever.files.add(file.id);
  }
}

async function everOf(opened: Project, state: FolderState): Promise<Ever> {
  if (state.ever) return state.ever;
  const read = await everBroughtIn(opened.file);
  // A bring-in by hand while the log was read may have committed after the read began, so it may be missing from the
  // answer: what it wrote waits in `pending` and is merged here. A second read that finished first is kept.
  state.ever ??= {
    suggestions: new Set([...read.suggestions, ...state.pending.suggestions]),
    files: new Set([...read.files, ...state.pending.files]),
  };
  // Once `ever` is read, bring-ins note into it: nothing more goes into `pending`.
  state.pending = { suggestions: new Set(), files: new Set() };
  return state.ever;
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

/**
 * The run now, one at a time; what was asked meanwhile runs after it, for whichever project is open then. `busy` is
 * cleared in the run's own body, in the same turn as its last look at `again`, so a request made in any microtask as a
 * run ends either is seen by the loop or starts a run of its own (7.1 round 3): none is lost.
 */
let busy = false;
let running: Promise<void> = Promise.resolve();
let again: FolderAsk | null = null;

const stronger = (a: FolderAsk | null, b: FolderAsk): FolderAsk => (a === 'pass' || b === 'pass' ? 'pass' : a === 'open' || b === 'open' ? 'open' : 'find');

function request(ask: FolderAsk): Promise<void> {
  if (!isTauriApp) return Promise.resolve();
  if (busy) {
    again = stronger(again, ask);
    return running;
  }
  busy = true;
  again = null;
  running = (async () => {
    let next: FolderAsk | null = ask;
    try {
      while (next !== null) {
        const opened = projectStore.getState().project;
        if (opened) {
          try {
            await runFolder(opened, next);
          } catch (error) {
            // Said only into the project the run began in: a switch meanwhile leaves the new one's line alone.
            if (projectStore.getState().project === opened) sayOnce(stateOf(opened), error instanceof Error ? error.message : String(error), true);
          }
        }
        next = again;
        again = null;
      }
    } finally {
      busy = false;
    }
  })();
  return running;
}

/** The open project's folder, as a project opens: its open pass, once per open. */
export const bringInFolder = (): Promise<void> => request('open');
/** The window came back to the front: what's new is found and said, never brought in. */
export const findInFolder = (): Promise<void> => request('find');
/** Bring in, pressed: one more pass, one more op group. */
export const bringInWaiting = (): Promise<void> => request('pass');

/** The project each Bring in button was made for. */
const actionProjects = new WeakMap<NoticeAction, Project>();

/** A switch or a close: the folder's line about the project left behind goes with it (7.1 round 3). */
export function dropFolderNotice(): void {
  const action = noticeStore.getState().action;
  const made = action === null ? undefined : actionProjects.get(action);
  if (made !== undefined && made !== projectStore.getState().project) clearNotice();
}

/** The Bring in button, for the project it was made for only: pressed after a switch, it takes its line away. */
function waitingAction(opened: Project): NoticeAction {
  const action: NoticeAction = {
    label: t('changes.bringIn'),
    run: () => {
      if (projectStore.getState().project !== opened) dropFolderNotice();
      else void bringInWaiting();
    },
  };
  actionProjects.set(action, opened);
  return action;
}

const keysOf = (files: readonly Listed[]): string => files.map(keyOf).join('\u0001');

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
    const keys = keysOf(waiting);
    if (waiting.length > 0 && keys !== state.lastWaiting) showInfo(tn('changes.waiting', waiting.length, { folder }), { action: waitingAction(opened) });
    state.lastWaiting = keys;
    return;
  }
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
    // Renamed beside the project the run began in; a switch meanwhile hears nothing of it (7.1 round 4).
    if (projectStore.getState().project !== opened) return null;
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
 * One pass: the waiting files read in name order, at most 1,000 files and 50 MB read to find what's new, of which at
 * most 200 files, 10 MB and 2,000 suggestions are brought in, as one op group. A file or a suggestion the log ever
 * brought in, undone ones included, is skipped and costs only the read budget, so an undone pass stays undone. A file
 * that couldn't be read costs the read budget by its listed size and waits for the next pass; however many there are,
 * the pass says them in one counted line. What's left waits, with a line and Bring in.
 */
async function pass(opened: Project, state: FolderState, handle: number, folder: string, waiting: readonly Listed[]): Promise<void> {
  if (waiting.length === 0) {
    state.lastWaiting = '';
    return;
  }
  const ever = await everOf(opened, state);
  const taken: { name: string; key: string; file: ChangeFile }[] = [];
  /** Read and done with: refused, or brought in before. Marked read at once, as nothing of them is written. */
  const settled: string[] = [];
  let readFiles = 0;
  let readBytes = 0;
  let takenBytes = 0;
  let suggestions = 0;
  /** Files whose read failed: said in the pass's one counted line, never settled. */
  const unread = new Set<string>();
  for (const listed of waiting) {
    if (taken.length >= MAX_PASS_FILES || readFiles >= MAX_READ_FILES || readBytes + listed.bytes > MAX_READ_BYTES) break;
    // A file this large would take the pass past 10 MB if it's new: it waits, unread, for the next pass, and the pass goes
    // on to smaller ones while the read budget lasts, so a large file already brought in never blocks them (7.1 round 4).
    if (taken.length > 0 && takenBytes + listed.bytes > MAX_PASS_BYTES) continue;
    if (projectStore.getState().project !== opened) return;
    const key = keyOf(listed);
    readFiles += 1;
    readBytes += listed.bytes;
    let raw: Uint8Array | null;
    try {
      raw = new Uint8Array(await invoke<ArrayBuffer>('changes_folder_read', { handle, name: listed.name }));
    } catch {
      raw = null;
    }
    // A switch while the file was read (7.1 round 4): nothing of this pass is said into, or kept for, the project open now.
    if (projectStore.getState().project !== opened) return;
    if (raw === null) {
      // Counted, said once for the pass, never settled: the next pass reads it again.
      unread.add(key);
      continue;
    }
    // By the larger of the listed size and what was read: a file that grew after the listing counts as it is now.
    const size = Math.max(listed.bytes, raw.byteLength);
    readBytes += size - listed.bytes;
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
    // A file that would take the pass past 2,000 suggestions or 10 MB waits for the next; one alone always fits (a file
    // holds at most 2,000 and 5 MB).
    if (taken.length > 0 && (suggestions + fresh > MAX_PASS_SUGGESTIONS || takenBytes + size > MAX_PASS_BYTES)) break;
    suggestions += fresh;
    takenBytes += size;
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
  const left = waiting.filter((file) => !state.read.has(keyOf(file)));
  // The pass's own line names what's left, so a find straight after says nothing over it.
  state.lastWaiting = keysOf(left);
  const brought = files === 1 && last ? outcomeWords(last) : files > 1 ? tn('changes.broughtInFiles', added, { files }) : null;
  const failed = unread.size > 0 ? tn('changes.unread', unread.size, { folder }) : null;
  // The waiting line counts what wasn't looked at or brought in; the files that couldn't be read have their own line.
  const notLooked = left.filter((file) => !unread.has(keyOf(file))).length;
  const wait = notLooked > 0 ? tn('changes.waiting', notLooked, { folder }) : null;
  const words = [brought, failed, wait].filter((part) => part !== null).join(' ');
  if (words === '') return;
  // Bring in tries again whatever is left, the files that couldn't be read included. A pass's imports are reviewed from
  // their notifications (7.2): the line keeps its one button for what's left.
  const action = left.length === 0 ? null : waitingAction(opened);
  if (failed !== null) showNotice(words, { action, step: brought !== null });
  else showInfo(words, { step: brought !== null, action });
}
