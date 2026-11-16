import { describe, expect, it } from 'vitest';
import { BOARD_GRID_KEY, boardGridOf, DEFAULT_SETTINGS, loadBoardGrid, loadSettings, saveBoardGrid } from '../core/storage/settings';

// The board's dot grid and its snap (6.5.7a): this computer's view under a key of its own, read defensively, both off
// until chosen, and never a field of the settings object.

const memory = () => {
  const kept = new Map<string, string>();
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe('the board grid setting', () => {
  it('starts with the grid and snap off', () => {
    const { storage } = memory();
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(loadBoardGrid(undefined)).toEqual({ boardGrid: false, boardGridSnap: false });
  });

  it('reads only a real true as on, each on its own, and anything unreadable as both off', () => {
    expect(boardGridOf(undefined)).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(boardGridOf(null)).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(boardGridOf(true)).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(boardGridOf([true, true])).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(boardGridOf({ boardGrid: 'true', boardGridSnap: 1 })).toEqual({ boardGrid: false, boardGridSnap: false });
    expect(boardGridOf({ boardGrid: true })).toEqual({ boardGrid: true, boardGridSnap: false });
    expect(boardGridOf({ boardGridSnap: true })).toEqual({ boardGrid: false, boardGridSnap: true });
    const { kept, storage } = memory();
    kept.set(BOARD_GRID_KEY, '{not json');
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: false, boardGridSnap: false });
    kept.set(BOARD_GRID_KEY, '"on"');
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: false, boardGridSnap: false });
    kept.set(BOARD_GRID_KEY, JSON.stringify({ boardGrid: true, boardGridSnap: 'yes', extra: 3 }));
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: true, boardGridSnap: false });
  });

  it('keeps what is chosen under its own key, never in the settings object', () => {
    const { kept, storage } = memory();
    expect(saveBoardGrid({ boardGrid: true, boardGridSnap: true }, storage)).toEqual({ boardGrid: true, boardGridSnap: true });
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: true, boardGridSnap: true });
    expect(JSON.parse(kept.get(BOARD_GRID_KEY) ?? 'null')).toEqual({ boardGrid: true, boardGridSnap: true });
    // Snap is kept as chosen while the grid is off: it acts again once the grid is back.
    saveBoardGrid({ boardGrid: false, boardGridSnap: true }, storage);
    expect(loadBoardGrid(storage)).toEqual({ boardGrid: false, boardGridSnap: true });
    expect([...kept.keys()]).toEqual([BOARD_GRID_KEY]);
    expect(loadSettings(storage)).toEqual(loadSettings(memory().storage));
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('boardGrid');
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('boardGridSnap');
  });

  it('loses only the view when the store refuses to keep it', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(saveBoardGrid({ boardGrid: true, boardGridSnap: false }, refusing)).toEqual({ boardGrid: true, boardGridSnap: false });
    expect(loadBoardGrid(refusing)).toEqual({ boardGrid: false, boardGridSnap: false });
  });
});
