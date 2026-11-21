import { describe, expect, it, vi } from 'vitest';
import { askStep, commitTyping, pressCommitted, takeStep, type PressEvent, type StepStore } from './undoRedoPress';

// A press on the top bar's Undo or Redo (item 8, #241): exactly ⌘Z or ⌘⇧Z once when there's a step to take, nothing
// at all otherwise; a field being typed in is committed first, as leaving it does. A click, Enter and Space on a
// button all arrive as its click (the browser's own), which calls takeStep; e2e/undoRedo.spec.ts presses all three.

function spyStore() {
  const undo = vi.fn(() => Promise.resolve());
  const redo = vi.fn(() => Promise.resolve());
  const store: StepStore = { getState: () => ({ undo, redo }) };
  return { store, undo, redo };
}

describe('a press on Undo or Redo', () => {
  it('with nothing to take, calls neither', () => {
    const { store, undo, redo } = spyStore();
    for (let press = 0; press < 3; press += 1) {
      takeStep('undo', false, store);
      takeStep('redo', false, store);
    }
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('with a step to take, calls the right one once per press', () => {
    const { store, undo, redo } = spyStore();
    takeStep('undo', true, store);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
    takeStep('redo', true, store);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('hands back the step it asked for, so the buttons can count it until it settles; nothing when nothing was asked', async () => {
    const { store } = spyStore();
    expect(askStep('undo', false, store)).toBeNull();
    const step = askStep('redo', true, store);
    expect(step).not.toBeNull();
    await expect(step).resolves.toBeUndefined();
  });

  it('leaves a field being typed in, so its own blur saves it, and only a text entry', () => {
    const blur = vi.fn();
    const area = { tagName: 'TEXTAREA', isContentEditable: false, blur };
    expect(commitTyping({ activeElement: area as unknown as Element })).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    const input = { tagName: 'INPUT', type: 'text', isContentEditable: false, blur: vi.fn() };
    expect(commitTyping({ activeElement: input as unknown as Element })).toBe(true);
    expect(input.blur).toHaveBeenCalledTimes(1);
    // A button, a checkbox or nothing focused: nothing is left.
    const button = { tagName: 'BUTTON', isContentEditable: false, blur: vi.fn() };
    expect(commitTyping({ activeElement: button as unknown as Element })).toBe(false);
    expect(button.blur).not.toHaveBeenCalled();
    const box = { tagName: 'INPUT', type: 'checkbox', isContentEditable: false, blur: vi.fn() };
    expect(commitTyping({ activeElement: box as unknown as Element })).toBe(false);
    expect(commitTyping({ activeElement: null })).toBe(false);
  });
});

/** Whether the click at the end of these events takes the step for a press that committed a field. */
const atClick = (events: readonly PressEvent[]) => events.reduce(pressCommitted, false);
/** A tap or a click that committed a field, as Pointer Events run it for this pointer, up to the click. */
const tap = (pointerType: string): PressEvent[] =>
  pointerType === 'mouse'
    ? [{ type: 'pointerdown', committed: true }]
    : [{ type: 'pointerdown', committed: true }, { type: 'pointerleave', pointerType }];

describe('a press that committed a field, by pointer (#241, round 3)', () => {
  it('a mouse click takes it; a mouse press that left before letting go does not', () => {
    expect(atClick(tap('mouse'))).toBe(true);
    expect(atClick([{ type: 'pointerdown', committed: true }, { type: 'pointerleave', pointerType: 'mouse' }])).toBe(false);
  });

  it('a touch or a pen tap takes it, though its leave comes before its click', () => {
    expect(atClick(tap('touch'))).toBe(true);
    expect(atClick(tap('pen'))).toBe(true);
  });

  it('a cancelled pointer of any kind does not', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
      expect(atClick([{ type: 'pointerdown', committed: true }, { type: 'pointercancel' }]), pointerType).toBe(false);
      expect(atClick([...tap(pointerType), { type: 'pointercancel' }]), pointerType).toBe(false);
    }
  });

  it('each pointerdown starts afresh, and the click clears what it read', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
      // A tap that never clicked (a touch that left the button), then a press with nothing being typed.
      const stale: PressEvent[] = [{ type: 'pointerdown', committed: true }, { type: 'pointerleave', pointerType }];
      expect(atClick([...stale, { type: 'pointerdown', committed: false }]), pointerType).toBe(false);
      // A click, then Enter's click with no pointer: the second reads nothing.
      expect(atClick([...tap(pointerType), { type: 'click' }]), pointerType).toBe(false);
    }
    // A press with nothing typed takes nothing on its own.
    expect(atClick([{ type: 'pointerdown', committed: false }])).toBe(false);
  });
});
