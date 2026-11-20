import { describe, expect, it, vi } from 'vitest';
import { commitTyping, takeStep, type StepStore } from './undoRedoPress';

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
