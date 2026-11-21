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
 * The window's keydown, in the capture phase: the key's default is always prevented (in a text field too, with or
 * without a project) and nothing else is stopped. A held key presses once. True when it was the key.
 */
export function onSaveKey(
  event: KeyEvent & Pick<KeyboardEvent, 'repeat' | 'preventDefault'>,
  mac: boolean,
  press: () => void = () => void pressSave(),
): boolean {
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

/**
 * Commits the field being typed in, then, once its edit is in and drawn (`settled`), puts focus and caret back: into
 * the same field, or the one drawn in its place. Only when focus is still nowhere: if the person moved on meanwhile,
 * it stays where they put it. A field whose leaving closes its editor (an inline title, a canvas text box) has none
 * drawn in its place, so it closes, as leaving it does. Resolves once that's done.
 */
export async function commitAndStay(settled: () => Promise<void>, doc: Document = document): Promise<void> {
  const active = doc.activeElement;
  if (!isTextEntry(active) || !active) return;
  const caret = caretOf(active);
  const sig = signature(active);
  const ancestors: Element[] = [];
  for (let at = active.parentElement; at; at = at.parentElement) ancestors.push(at);
  if (!commitTyping(doc)) return;
  await settled();
  // Read again after the wait: the person may have moved on meanwhile.
  const focused: Element | null = (doc as Pick<Document, 'activeElement'>).activeElement;
  if (focused && focused !== doc.body) return;
  if (active.isConnected) {
    putBack(active as HTMLElement, caret);
    return;
  }
  const holder = ancestors.find((at) => at.isConnected);
  if (!holder) return;
  const same = [...holder.querySelectorAll('input, textarea')].filter((el) => isTextEntry(el) && signature(el) === sig);
  if (same.length === 1 && same[0]) putBack(same[0] as HTMLElement, caret);
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
  try {
    answer(await schedule.backUpByHand());
  } catch (error) {
    // As Back up now's: said, and the sign still answers with what it knows.
    showNotice(error);
    answer(null);
  }
}
