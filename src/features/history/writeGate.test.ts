import { describe, expect, it } from 'vitest';
import { createWriteGate, GIVE_UP_MS, SETTLE_MS } from './writeGate';

describe('one restore or Put back at a time', () => {
  it('drops clicks while one writes, until its rows are read again and have stood still', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    const before = {};
    const after = {};
    gate.read('steps', gate.versionOf(before));
    expect(gate.take('steps', before)).toBe(true);
    // A double click: the second lands while the first writes.
    expect(gate.take('steps', before)).toBe(false);
    gate.written(true);
    expect(gate.take('steps', before)).toBe(false);
    // The rows read for the records before the click are the old rows: still waiting.
    gate.read('steps', gate.versionOf(before));
    expect(gate.take('steps', before)).toBe(false);
    gate.read('steps', gate.versionOf(after));
    clock += 150;
    expect(gate.take('steps', after)).toBe(false);
    clock += SETTLE_MS;
    expect(gate.take('steps', after)).toBe(true);
  });

  it('counts the rows read before the write said it was done, and lets go at once when nothing changed', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    const before = {};
    expect(gate.take('item', before)).toBe(true);
    gate.read('item', gate.versionOf({}));
    gate.written(true);
    clock += SETTLE_MS;
    expect(gate.take('item', before)).toBe(true);
    gate.written(false);
    expect(gate.take('steps', before)).toBe(true);
  });

  it('waits for the view the click was in: a Put back waits for the frame’s rows, not the steps', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    expect(gate.take('item', {})).toBe(true);
    gate.written(true);
    gate.read('steps', gate.versionOf({}));
    clock += SETTLE_MS * 4;
    expect(gate.take('item', {})).toBe(false);
  });

  it('lets go when the view the click came from stops being read, before or after the write is done', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    // Put back, then the item filter turned off: the item's rows won't be read again.
    expect(gate.take('item', {})).toBe(true);
    gate.written(true);
    gate.gone('item');
    clock += SETTLE_MS;
    expect(gate.take('steps', {})).toBe(true);
    gate.written(false);
    // Gone while the write was still going: it lets go once the write is done.
    expect(gate.take('item', {})).toBe(true);
    gate.gone('item');
    expect(gate.take('item', {})).toBe(false);
    gate.written(true);
    clock += SETTLE_MS;
    expect(gate.take('steps', {})).toBe(true);
  });

  it('keeps waiting when only the other view goes', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    expect(gate.take('steps', {})).toBe(true);
    gate.written(true);
    gate.gone('item');
    clock += SETTLE_MS;
    expect(gate.take('steps', {})).toBe(false);
  });

  it('lets go when the read it waits for fails', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    expect(gate.take('steps', {})).toBe(true);
    gate.written(true);
    // The steps' read rejected: the tile says the view is gone.
    gate.gone('steps');
    clock += SETTLE_MS;
    expect(gate.take('steps', {})).toBe(true);
  });

  it('never stays shut for good: a few seconds after a write, a click counts again whatever its rows did', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    expect(gate.take('item', {})).toBe(true);
    gate.written(true);
    clock += GIVE_UP_MS - 1;
    expect(gate.take('item', {})).toBe(false);
    clock += 1;
    expect(gate.take('item', {})).toBe(true);
  });
});
