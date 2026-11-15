import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import type { Project } from '../../core/storage/project';
import { openLocation, useShownLocation } from './shownLocation';

// The Locations tile's ask (6.6 second review): a project switch clears it, and "Open Locations" focuses the row asked
// for, or the first row on the last try when that row never shows. The layout is left out (its store reads this
// computer's settings), and the page is a small stand-in, as in src/app/focusWhenShown.test.ts.

vi.mock('../../app/shell/docking/layoutStore', () => ({
  layoutsOf: () => ({ current: null }),
  layoutStore: { getState: () => ({ layouts: {}, change: () => undefined }) },
}));
vi.mock('../../app/shell/docking/layout', () => ({ openTile: () => null }));

interface Row {
  focused: boolean;
  isConnected: boolean;
  parentElement: null;
  matches: () => boolean;
  focus: () => void;
}

const row = (): Row => {
  const made: Row = {
    focused: false,
    isConnected: true,
    parentElement: null,
    matches: () => false,
    focus: () => {
      made.focused = true;
    },
  };
  return made;
};

let frames: (() => void)[] = [];
const frame = () => {
  const now = frames;
  frames = [];
  for (const run of now) run();
};

const at = '2026-11-14T10:00:00.000Z';
const location = (id: string): SbdRecord => ({ id, type: 'location', parentId: 'p', sortKey: id, props: { name: id }, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('getComputedStyle', () => ({ display: '' }));
  vi.stubGlobal('CSS', { escape: (text: string) => text });
});

afterEach(() => {
  frames = [];
  vi.unstubAllGlobals();
  useShownLocation.setState({ request: null });
  projectStore.setState({ project: null, records: {} });
});

describe('the Locations tile’s ask', () => {
  it('is cleared when another project opens', () => {
    useShownLocation.setState({ request: { id: 'diner', at: 1 } });
    projectStore.setState({ project: { projectId: 'p' } as unknown as Project });
    expect(useShownLocation.getState().request).toBeNull();
  });

  it('focuses the first row on the last try when the asked-for row never shows', () => {
    const first = row();
    const body = {};
    vi.stubGlobal('document', { activeElement: body, body, querySelector: (selector: string) => (selector === '[data-location-id]' ? first : null) });
    projectStore.setState({ records: { diner: location('diner'), alley: location('alley') } });
    openLocation('production', 'diner');
    expect(useShownLocation.getState().request?.id).toBe('diner');
    for (let i = 0; i < 29; i += 1) frame();
    // Waiting for the Diner's own row all along, never the first.
    expect(first.focused).toBe(false);
    frame();
    expect(first.focused).toBe(true);
  });

  it('focuses the asked-for row as soon as it shows', () => {
    const first = row();
    const diner = row();
    let shown = false;
    const body = {};
    vi.stubGlobal('document', {
      activeElement: body,
      body,
      querySelector: (selector: string) => (selector === '[data-location-id="diner"]' ? (shown ? diner : null) : first),
    });
    projectStore.setState({ records: { diner: location('diner'), alley: location('alley') } });
    openLocation('production', 'diner');
    frame();
    shown = true;
    frame();
    expect(diner.focused).toBe(true);
    expect(first.focused).toBe(false);
  });
});
