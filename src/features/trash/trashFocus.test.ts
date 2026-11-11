import { beforeEach, describe, expect, it } from 'vitest';
import { trashFocus } from './trashFocus';

// A card on a board asks the Trash tile to open on its frame (5.4). The tile takes the request once.

beforeEach(() => {
  trashFocus.setState({ asked: null });
});

describe('the Trash tile’s request', () => {
  it('is taken once: a tile opened later does not apply it again', () => {
    trashFocus.getState().ask('frame', 'sc1', 'p1');
    expect(trashFocus.getState().take('p1')).toEqual({ kind: 'frame', sceneId: 'sc1', projectId: 'p1' });
    expect(trashFocus.getState().asked).toBeNull();
    expect(trashFocus.getState().take('p1')).toBeNull();
  });

  it('is dropped, not applied, in another project (a project switched in between)', () => {
    trashFocus.getState().ask('scene', 'sc1', 'p1');
    expect(trashFocus.getState().take('p2')).toBeNull();
    expect(trashFocus.getState().asked).toBeNull();
    expect(trashFocus.getState().take('p1')).toBeNull();
  });

  it('keeps the latest of two requests', () => {
    trashFocus.getState().ask('frame', 'a', 'p1');
    trashFocus.getState().ask('scene', 'b', 'p1');
    expect(trashFocus.getState().take('p1')).toMatchObject({ kind: 'scene', sceneId: 'b' });
  });
});
