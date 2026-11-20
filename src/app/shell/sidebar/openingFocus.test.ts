import { describe, expect, it } from 'vitest';
import { FOCUS_BACK_START, stepFocusBack, type FocusBackEvent, type FocusBackState } from './openingFocus';

// Runs the events in order and lists what each one gives focus back to.
function run(events: FocusBackEvent<string>[]): { restored: (string | null)[]; state: FocusBackState<string> } {
  let state: FocusBackState<string> = FOCUS_BACK_START;
  const restored: (string | null)[] = [];
  for (const event of events) {
    const step = stepFocusBack(state, event);
    state = step.state;
    restored.push(step.restore);
  }
  return { restored, state };
}

const began = (focused: string | null): FocusBackEvent<string> => ({ kind: 'began', focused });
const ended: FocusBackEvent<string> = { kind: 'ended' };
const drawnOpening: FocusBackEvent<string> = { kind: 'drawn', opening: true, was: false };
const drawnOpen: FocusBackEvent<string> = { kind: 'drawn', opening: false, was: true };
const sectionChanged: FocusBackEvent<string> = { kind: 'drawn', opening: false, was: false };

describe('stepFocusBack', () => {
  it('gives the noted entry back once React draws the open ended', () => {
    const { restored, state } = run([began('scene'), drawnOpening, ended, drawnOpen]);
    expect(restored).toEqual([null, null, null, 'scene']);
    expect(state).toEqual(FOCUS_BACK_START);
  });

  it('drops the entry when an open begins and ends before React draws it', () => {
    const { restored, state } = run([began('scene'), ended, sectionChanged]);
    expect(restored).toEqual([null, null, null]);
    expect(state.held).toBeNull();
  });

  it('keeps the first entry when a second open begins before React draws the end of the first', () => {
    // The second open begins with focus on the body, so it notes nothing; the first's entry stays held.
    const { restored } = run([began('scene'), drawnOpening, ended, began(null), ended, drawnOpen]);
    expect(restored).toEqual([null, null, null, null, null, 'scene']);
  });

  it('gives nothing back on a change of section alone', () => {
    const { restored } = run([began('scene'), drawnOpening, sectionChanged]);
    expect(restored).toEqual([null, null, null]);
  });

  it('gives nothing back when no entry had focus as the open began', () => {
    const { restored } = run([began(null), drawnOpening, ended, drawnOpen]);
    expect(restored).toEqual([null, null, null, null]);
  });

  it('notes a new entry for the next open once the last one is given back', () => {
    const { restored } = run([began('scene'), drawnOpening, ended, drawnOpen, began('board'), drawnOpening, ended, drawnOpen]);
    expect(restored).toEqual([null, null, null, 'scene', null, null, null, 'board']);
  });
});
