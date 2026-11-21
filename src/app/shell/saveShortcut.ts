import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { HandBackup } from '../../core/storage/backups';
import { showNotice } from '../notice';
import { projectStore } from '../projectStore';
import { commitTyping } from './undoRedoPress';
import { isTextEntry } from './workspaces';

// Ctrl+S, ⌘S on a Mac (Kevin, Nov 18). Every change is saved at once, so the key confirms: it commits the field being
// typed in, as leaving it does, puts focus and caret back where they were, takes a hand backup (backUpByHand in
// src/core/storage/backups.ts, one rule with Settings → Backups → Back up now) and shows the Saved sign's tip with the
// answer. The browser's or WebView's own save dialog never opens: the key is caught for the whole window, text fields
// included, with or without a project.

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/**
 * ⌘S on a Mac, Ctrl+S elsewhere: never the other one. The letter typed, on any Latin layout; the key's place only where
 * the layout has no Latin letters (as the project menu's shortcuts read it).
 */
export function isSaveShortcut(event: KeyEvent, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || event.shiftKey) return false;
  const typed = event.key.toLowerCase();
  return /^[a-z]$/.test(typed) ? typed === 's' : event.code === 'KeyS';
}

/**
 * A press between its blur and its refocus (about 20 to 150 ms while the edit is written and drawn): focus is on the
 * page then, so letters typed would be lost and window shortcuts would act on them (Ctrl+Z undoing the step just
 * committed). Every key in it is taken, and the typed ones are kept, in order, for the field once it's back.
 */
let gap: { doc: Pick<Document, 'activeElement' | 'body'>; typed: string[] } | null = null;

/** What a key types, or null for one that types nothing (a shortcut, an arrow, Enter, a dead key). */
export function typedBy(event: KeyEvent, mac: boolean): string | null {
  // A key that types has one character for its name; named keys (Enter, ArrowLeft, Dead) have longer ones.
  if (event.metaKey || !/^.$/u.test(event.key)) return null;
  // AltGr reports Ctrl and Alt together on Windows and Linux, and types; Alt alone is a shortcut there (Alt+1). On a
  // Mac, Option types and Ctrl doesn't.
  if (mac ? event.ctrlKey : event.ctrlKey !== event.altKey) return null;
  return event.key;
}

/**
 * The window's keydown, in the capture phase: the key's default is always prevented (in a text field too, with or
 * without a project) and nothing else is stopped. A held key presses once. True when it was the key. Between a press's
 * blur and its refocus, every key is taken from everyone else, the typed ones kept for the field.
 */
export function onSaveKey(
  event: KeyEvent &
    Pick<KeyboardEvent, 'repeat' | 'preventDefault'> &
    Partial<Pick<KeyboardEvent, 'stopImmediatePropagation'>>,
  mac: boolean,
  press: () => void = () => void pressSave(),
): boolean {
  // Only while focus is still nowhere: a person who clicked into another place meanwhile types there.
  if (gap && (gap.doc.activeElement === null || gap.doc.activeElement === gap.doc.body)) {
    event.preventDefault();
    event.stopImmediatePropagation?.();
    const typed = typedBy(event, mac);
    if (typed !== null) gap.typed.push(typed);
    return isSaveShortcut(event, mac);
  }
  if (!isSaveShortcut(event, mac)) return false;
  event.preventDefault();
  if (!event.repeat) press();
  return true;
}

/** The last press's answer, for the Saved sign: `press` counts presses, so the tip and the live region show each one. */
export interface SaveAnswer {
  press: number;
  /** When the queued hand backup will be made, when the press queued one (ISO). */
  nextAt: string | null;
}

const answerStore = createStore<SaveAnswer>()(() => ({ press: 0, nextAt: null }));

export function useSaveAnswer(): SaveAnswer {
  return useStore(answerStore, (s) => s);
}

/** Tells the sign what a press did. Exported for tests. */
export function answer(run: HandBackup | null): void {
  answerStore.setState((s) => ({ press: s.press + 1, nextAt: run?.kind === 'queued' ? run.at.toISOString() : null }));
}

/** What a field is, to find it again when committing it drew it anew (a field keyed by its value remounts). */
function signature(element: Element): string {
  const field = element as HTMLInputElement;
  const labels = 'labels' in field && field.labels ? [...field.labels].map((label) => label.textContent).join('|') : '';
  return [
    element.tagName,
    field.type,
    field.name,
    element.getAttribute('aria-label'),
    element.getAttribute('data-field'),
    element.getAttribute('placeholder'),
    labels,
  ].join('\u0000');
}

interface Caret {
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
}

function caretOf(element: Element): Caret {
  try {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
  } catch {
    // A field with no caret of its own.
    return { start: null, end: null, direction: null };
  }
}

function putBack(element: HTMLElement, caret: Caret): void {
  // Without scrolling, so the view stays where the person was working. Its own focus handler runs first (one selects
  // all as it's focused), then the caret goes back where it was.
  element.focus({ preventScroll: true });
  if (caret.start === null || caret.end === null) return;
  try {
    (element as HTMLInputElement).setSelectionRange(caret.start, caret.end, caret.direction ?? 'none');
  } catch {
    // A number field has no selection to set.
  }
}

/** The keys typed in the gap, at the caret, as typing puts them: an input event the field's own handler hears. */
function typeInto(element: HTMLElement, text: string, doc: Document): void {
  // insertText is what typing does (one input event, the browser's own undo for the field), in Chromium and WebKit.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (doc.execCommand('insertText', false, text)) return;
  const field = element as HTMLInputElement;
  try {
    const start = field.selectionStart ?? field.value.length;
    field.setRangeText(text, start, field.selectionEnd ?? start, 'end');
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } catch {
    // A field with no caret of its own takes nothing: the keys are dropped.
  }
}

/** The element the climb for a field drawn anew stops at: its tile, so focus never goes to another tile's field. */
const TILE = 'data-stack-id';

/**
 * Commits the field being typed in, then, once its edit is in and drawn (`settled`), puts focus and caret back: into
 * the same field, or the one drawn in its place (same kind, same label, same value as at the blur, in the same tile).
 * Only when focus is still nowhere: if the person moved on meanwhile, it stays where they put it. A field whose leaving
 * closes its editor (an inline title, a canvas text box) has none drawn in its place, so it closes, as leaving it does.
 * Keys typed meanwhile go into the field once it's back, or are dropped. Resolves once that's done.
 */
export async function commitAndStay(settled: () => Promise<void>, doc: Document = document): Promise<void> {
  const active = doc.activeElement;
  if (!isTextEntry(active) || !active) return;
  const caret = caretOf(active);
  const sig = signature(active);
  const value = (active as HTMLInputElement).value;
  const ancestors: Element[] = [];
  for (let at = active.parentElement; at; at = at.parentElement) {
    ancestors.push(at);
    if (at.getAttribute(TILE) !== null) break;
  }
  const keys = { doc, typed: [] as string[] };
  gap = keys;
  try {
    if (!commitTyping(doc)) return;
    await settled();
  } finally {
    // From here on (synchronously) the field is back or isn't coming back: keys go where focus is again.
    if (gap === keys) gap = null;
  }
  // Read again after the wait: the person may have moved on meanwhile.
  const focused: Element | null = (doc as Pick<Document, 'activeElement'>).activeElement;
  if (focused && focused !== doc.body) return;
  let field: HTMLElement | null = null;
  if (active.isConnected) {
    field = active as HTMLElement;
  } else {
    const holder = ancestors.find((at) => at.isConnected);
    const same = holder
      ? [...holder.querySelectorAll('input, textarea')].filter(
          (el) => isTextEntry(el) && signature(el) === sig && (el as HTMLInputElement).value === value,
        )
      : [];
    if (same.length === 1 && same[0]) field = same[0] as HTMLElement;
  }
  if (!field) return;
  putBack(field, caret);
  const text = keys.typed.join('');
  if (text !== '' && doc.activeElement === field) typeInto(field, text, doc);
}

/** The edits queued so far are written and merged, and the screen has drawn them. */
async function editsDrawn(): Promise<void> {
  // An empty write takes its turn after every edit queued before it and writes nothing.
  await projectStore.getState().writeAside([]);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** One press, with a project open: the field committed, a hand backup, the sign's tip with the answer. */
export async function pressSave(): Promise<void> {
  const { project } = projectStore.getState();
  if (!project) return;
  await commitAndStay(editsDrawn);
  // The edit just committed counts as a change, so the backup comes after it has been written.
  if (projectStore.getState().project !== project) return;
  const schedule = project.backups;
  if (!schedule) {
    answer(null);
    return;
  }
  let run: HandBackup;
  try {
    run = await schedule.backUpByHand();
  } catch (error) {
    // A project closed or switched meanwhile has no sign to answer on.
    if (projectStore.getState().project !== project) return;
    // As Back up now's: said, and the sign still answers with what it knows.
    showNotice(error);
    answer(null);
    return;
  }
  // The answer is this project's: another one opened meanwhile never shows it.
  if (projectStore.getState().project === project) answer(run);
}
