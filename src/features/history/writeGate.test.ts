import { describe, expect, it } from 'vitest';
import { createWriteGate, SETTLE_MS } from './writeGate';

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
    expect(gate.take('frame', before)).toBe(true);
    gate.read('frame', gate.versionOf({}));
    gate.written(true);
    clock += SETTLE_MS;
    expect(gate.take('frame', before)).toBe(true);
    gate.written(false);
    expect(gate.take('steps', before)).toBe(true);
  });

  it('waits for the view the click was in: a Put back waits for the frame’s rows, not the steps', () => {
    let clock = 0;
    const gate = createWriteGate(() => clock);
    expect(gate.take('frame', {})).toBe(true);
    gate.written(true);
    gate.read('steps', gate.versionOf({}));
    clock += SETTLE_MS * 4;
    expect(gate.take('frame', {})).toBe(false);
  });
});
