import { describe, expect, it } from 'vitest';
import { LAYER_ORDER } from '../../../core/model/planLayers';
import { keysLineFits } from './keysLine';
import { layerKeyFor, layerKeyOf, SHOW_ALL_KEY } from './PlanTile';

// The Layers tile's keys line shows only when it fits whole (#222, Kevin Nov 20), and each key is said in its own
// control's title, read from the order the plan handles them in.

describe('the keys line’s fit', () => {
  it('shows when the rows, the gap and the whole line fit the body, to the pixel', () => {
    expect(keysLineFits({ base: 300, gap: 8, line: 48, room: 376 })).toBe(true);
    expect(keysLineFits({ base: 320, gap: 8, line: 48, room: 376 })).toBe(true);
  });

  it('hides when any part of the line would spill, or the rows alone already do', () => {
    expect(keysLineFits({ base: 320.5, gap: 8, line: 48, room: 376 })).toBe(false);
    expect(keysLineFits({ base: 385, gap: 8, line: 48, room: 376 })).toBe(false);
  });

  it('hides with no body or no line to measure (no layout yet)', () => {
    expect(keysLineFits({ base: 0, gap: 8, line: 0, room: 376 })).toBe(false);
    expect(keysLineFits({ base: 0, gap: 8, line: 48, room: 0 })).toBe(false);
    expect(keysLineFits({ base: 0, gap: Number.NaN, line: 48, room: 376 })).toBe(false);
  });
});

describe('each layer’s key', () => {
  it('is the key the plan solos it by, 1 to 7 in the rows’ order', () => {
    expect(LAYER_ORDER.map(layerKeyOf)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    for (const layer of LAYER_ORDER) expect(layerKeyFor({ code: `Digit${layerKeyOf(layer)}` })).toBe(layer);
  });

  it('Show all’s is the key the plan shows every layer by', () => {
    expect(layerKeyFor({ code: `Digit${SHOW_ALL_KEY}` })).toBe('all');
  });
});
