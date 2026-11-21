import { projectStore } from '../projectStore';
import { isTextEntry } from './workspaces';

// A press on the top bar's Undo or Redo (item 8) while a field is being typed in (#241, the main session's decision):
// in Chromium and WebView2 a click moves focus, so the field's save-on-leave edit lands before the click's undo; in
// WebKit a click may not move focus, so the typing would stay in the field unsaved while the undo took the step before
// it. The same in every engine, and nothing typed lost unseen: the press first commits the field, as leaving it does,
// then takes the newest step, which is that typing. A new edit empties the redo stack, so Redo then has nothing to take.

/** The part of the project store a press uses. */
export interface StepStore {
  getState(): { undo: () => Promise<void>; redo: () => Promise<void> };
}

/**
 * Commits the field being typed in, if any, by taking focus from it: its own blur handler saves it, as leaving it does.
 * That handler queues its edit at once (the store runs edits one at a time, in the order they're made), so the step a
 * click then takes is queued after it. True when a field was left.
 */
export function commitTyping(doc: Pick<Document, 'activeElement'> = document): boolean {
  const active = doc.activeElement;
  if (!isTextEntry(active) || !active || !('blur' in active)) return false;
  (active as HTMLElement).blur();
  return true;
}

/**
 * Exactly ⌘Z or ⌘⇧Z. `enabled`: there's a step to take, or the press just committed a field (whose edit is then the
 * newest step, queued before this one); otherwise nothing at all.
 */
export function takeStep(which: 'undo' | 'redo', enabled: boolean, store: StepStore = projectStore): void {
  void askStep(which, enabled, store);
}

/**
 * takeStep, handing back the step's promise, which settles once the store has merged it: the buttons count presses in
 * flight by it. Null when nothing was asked.
 */
export function askStep(which: 'undo' | 'redo', enabled: boolean, store: StepStore = projectStore): Promise<void> | null {
  if (!enabled) return null;
  return which === 'undo' ? store.getState().undo() : store.getState().redo();
}

/**
 * What reaches a button during one press, as far as its "this press committed a field" flag goes. Pointer Events run
 * pointerdown, pointerup, pointerout, pointerleave and only then the click for a touch or a pen (a mouse's click comes
 * before it leaves), so only a mouse's leave says the press ended elsewhere.
 */
export type PressEvent =
  | { type: 'pointerdown'; committed: boolean }
  | { type: 'pointerleave'; pointerType: string }
  | { type: 'pointercancel' }
  | { type: 'click' };

/**
 * The flag after one event: set by a pointerdown that committed a field (each pointerdown starts the press afresh,
 * whatever a press before it left), cleared by a mouse leaving (a press that ended elsewhere made no click, so its
 * commit is not this button's to act on later), by a cancelled pointer of any kind, and by the click that reads it.
 */
export function pressCommitted(committed: boolean, event: PressEvent): boolean {
  switch (event.type) {
    case 'pointerdown':
      return event.committed;
    case 'pointerleave':
      return event.pointerType === 'mouse' ? false : committed;
    case 'pointercancel':
    case 'click':
      return false;
  }
}
