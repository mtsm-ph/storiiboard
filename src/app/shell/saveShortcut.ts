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

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
  Partial<Pick<KeyboardEvent, 'getModifierState'>>;

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
let gap: Gap | null = null;

/** What a key in the gap does to the field once it's back, in order. */
type GapEdit = { kind: 'text'; text: string } | { kind: 'delete' } | { kind: 'forwardDelete' };

interface Gap {
  doc: Pick<Document, 'activeElement' | 'body'>;
  edits: GapEdit[];
  /** A textarea, where Enter types a line break; in a one-line field Enter does something else. */
  multiline: boolean;
  /**
   * Set at a key that moves on (Tab, an arrow, Escape, Home, a function key): what follows it was meant for another
   * place, so it's dropped; what came before still goes into the field. Enter in a one-line field and a shortcut are
   * taken without stopping it (round 2's test of "x, Ctrl+Z, y, Ctrl+S, Enter, z" typing "xyz").
   */
  stopped: boolean;
  /** Set at a pointerdown: the person went elsewhere (WebKit on a Mac moves no focus on a click), so nothing comes back. */
  ended: boolean;
}

/** Keys that change nothing by themselves: held for a capital, an accent or a layout's next key. */
const NEUTRAL = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'Fn', 'Dead', 'Process', 'Unidentified']);

/** What a key types, or null for one that types nothing (a shortcut, an arrow, Enter, a dead key). */
export function typedBy(event: KeyEvent, mac: boolean): string | null {
  // A key that types has one character for its name; named keys (Enter, ArrowLeft, Dead) have longer ones.
  if (event.metaKey || !/^.$/u.test(event.key)) return null;
  // On a Mac, Option types and Ctrl doesn't.
  if (mac) return event.ctrlKey ? null : event.key;
  if (!event.ctrlKey && !event.altKey) return event.key;
  // AltGr reports Ctrl and Alt together on Windows and Linux, and types; Alt alone is a shortcut there (Alt+1). Where
  // the engine says which it is, only AltGr counts, so Ctrl+Alt+letter held down isn't typing.
  if (event.getModifierState) return event.getModifierState('AltGraph') ? event.key : null;
  return event.ctrlKey && event.altKey ? event.key : null;
}

/** What a key pressed in the gap does: an edit for the field, nothing, or the end of collecting. */
function gapKey(event: KeyEvent, mac: boolean, multiline: boolean): GapEdit | 'none' | 'stop' {
  const typed = typedBy(event, mac);
  if (typed !== null) return { kind: 'text', text: typed };
  if (NEUTRAL.has(event.key)) return 'none';
  const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
  if (plain && event.key === 'Backspace') return { kind: 'delete' };
  if (plain && event.key === 'Delete') return { kind: 'forwardDelete' };
  if (plain && event.key === 'Enter' && multiline) return { kind: 'text', text: '\n' };
  // Taken as round 2 has it, and collecting goes on: the key again, Enter in a one-line field, and other shortcuts
  // (Ctrl+Z). A shortcut stopping the collecting too, as round 3's item 3 asked, would change round 2's test of "x,
  // Ctrl+Z, y, Ctrl+S, Enter, z" typing "xyz"; left as is (#244 round 4).
  if (isSaveShortcut(event, mac) || event.key === 'Enter' || !plain) return 'none';
  // Any other key that doesn't type (Tab, an arrow, Escape, Home, a function key) moves on.
  return 'stop';
}

/** A pointerdown anywhere ends the gap: nothing typed in it goes in, and the field isn't focused again. */
export function onGapPointer(): void {
  if (!gap) return;
  gap.ended = true;
  gap = null;
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
    // Stops every listener after this one, but not capture-phase listeners on the window added before the shell's
    // (a child's effect runs before its parent's), which still hear the key. Today those handle only Escape (a tip),
    // a tile move, drag or menu already under way, or track which keys are held (the canvas's Ctrl): never an edit.
    event.stopImmediatePropagation?.();
    if (!gap.stopped) {
      const edit = gapKey(event, mac, gap.multiline);
      if (edit === 'stop') gap.stopped = true;
      else if (edit !== 'none') gap.edits.push(edit);
    }
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

/** Backspace (`delete`) or Delete (`forwardDelete`) pressed in the gap, at the caret, as the key does it. */
function deleteIn(element: HTMLElement, kind: 'delete' | 'forwardDelete', doc: Document): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (doc.execCommand(kind, false)) return;
  const field = element as HTMLInputElement;
  try {
    let start = field.selectionStart ?? field.value.length;
    let end = field.selectionEnd ?? start;
    // With nothing selected, the character before the caret (Backspace) or after it (Delete).
    if (start === end) {
      if (kind === 'delete') start = Math.max(0, start - 1);
      else end = Math.min(field.value.length, end + 1);
    }
    if (start === end) return;
    field.setRangeText('', start, end, 'end');
    const inputType = kind === 'delete' ? 'deleteContentBackward' : 'deleteContentForward';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
  } catch {
    // A field with no caret of its own: nothing to delete.
  }
}

/** The gap's keys replayed in order: each run of letters typed at once, each delete as its key. */
function replay(element: HTMLElement, edits: readonly GapEdit[], doc: Document): void {
  let text = '';
  const flush = () => {
    if (text !== '') typeInto(element, text, doc);
    text = '';
  };
  for (const edit of edits) {
    if (doc.activeElement !== element) return;
    if (edit.kind === 'text') {
      text += edit.text;
      continue;
    }
    flush();
    deleteIn(element, edit.kind, doc);
  }
  if (doc.activeElement === element) flush();
}

/** A value as a commit may leave it: tidied of spaces at the ends, and in any case (a scene number made upper case). */
const tidied = (value: string) => value.trim().toLowerCase();

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
  const keys: Gap = { doc, edits: [], multiline: active.tagName === 'TEXTAREA', stopped: false, ended: false };
  gap = keys;
  try {
    if (!commitTyping(doc)) return;
    await settled();
  } finally {
    // From here on (synchronously) the field is back or isn't coming back: keys go where focus is again.
    if (gap === keys) gap = null;
  }
  // A click meanwhile: the person went elsewhere, even where it moved no focus (WebKit on a Mac).
  if (keys.ended) return;
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
          // As the commit left it: a scene number made upper case, a name trimmed, is still the same field's value.
          (el) => isTextEntry(el) && signature(el) === sig && tidied((el as HTMLInputElement).value) === tidied(value),
        )
      : [];
    if (same.length === 1 && same[0]) field = same[0] as HTMLElement;
  }
  if (!field) return;
  putBack(field, caret);
  if (keys.edits.length > 0 && doc.activeElement === field) replay(field, keys.edits, doc);
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
