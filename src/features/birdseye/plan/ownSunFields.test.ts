import { describe, expect, it } from 'vitest';
import { formatCoordinates } from '../../../core/model/coordinates';
import { ownDateCommit, ownPlaceCommit } from './ownSunFields';

// A sun path's own place and date fields (6.5.5 review): Enter then leaving the place field writes once and keeps every
// decimal pasted (values compared, not text); an incomplete date never changes, let alone clears, a stored one.

const pasted = { latitude: 40.867712345, longitude: -73.921234567 };

describe('the own place field', () => {
  it('writes a pasted place once, Enter then blur, every decimal kept', () => {
    // Enter: nothing stored yet, the pasted text read in full.
    const first = ownPlaceCommit('40.867712345, -73.921234567', null, null);
    expect(first).toEqual({ kind: 'set', place: pasted });
    // The field now shows the short form; the blur reads it as the place it stands for, before or after the store has it.
    const short = formatCoordinates(pasted);
    expect(short).toBe('40.8677, -73.9212');
    expect(ownPlaceCommit(short, null, pasted)).toEqual({ kind: 'none' });
    expect(ownPlaceCommit(short, pasted, pasted)).toEqual({ kind: 'none' });
    // The same place pasted again, in full, is no new edit either.
    expect(ownPlaceCommit('40.867712345, -73.921234567', pasted, pasted)).toEqual({ kind: 'none' });
  });

  it('writes a new place, clears on an emptied field, and refuses what isn’t one', () => {
    expect(ownPlaceCommit('33.8688 S, 151.2093 E', pasted, pasted)).toEqual({ kind: 'set', place: { latitude: -33.8688, longitude: 151.2093 } });
    // Typed as the short form of the stored place but meant as itself: still that place, never rounded.
    expect(ownPlaceCommit('40.8677, -73.9212', pasted, null)).toEqual({ kind: 'none' });
    expect(ownPlaceCommit('   ', pasted, pasted)).toEqual({ kind: 'clear' });
    expect(ownPlaceCommit('', null, null)).toEqual({ kind: 'none' });
    expect(ownPlaceCommit('40,8677, -73,9212', pasted, pasted)).toEqual({ kind: 'refused', reason: 'decimalComma' });
  });
});

describe('the own date field', () => {
  it('changes nothing for an incomplete date, never clearing a stored one', () => {
    expect(ownDateCommit('', true, '2026-06-21')).toEqual({ kind: 'none' });
    expect(ownDateCommit('', true, null)).toEqual({ kind: 'none' });
  });

  it('sets a whole date, clears only on an emptied field, and refuses one that isn’t real', () => {
    expect(ownDateCommit('2026-06-21', false, null)).toEqual({ kind: 'set', date: '2026-06-21' });
    expect(ownDateCommit('2026-06-21', false, '2026-06-21')).toEqual({ kind: 'none' });
    expect(ownDateCommit('', false, '2026-06-21')).toEqual({ kind: 'clear' });
    expect(ownDateCommit('', false, null)).toEqual({ kind: 'none' });
    expect(ownDateCommit('2026-02-30', false, null)).toEqual({ kind: 'refused' });
  });
});
