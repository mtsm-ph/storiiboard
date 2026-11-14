import { describe, expect, it } from 'vitest';
import { framesOffCameras } from './cameraLinks';
import type { Props, SbdRecord } from './record';

// Frames taken off the cameras that list them (6.4 review): only the ids being taken off go; every other entry of
// `shot_ids` stays as stored, one this version can't read included.

const at = '2026-11-14T10:00:00.000Z';
const camera = (id: string, props: Props): SbdRecord => ({
  id,
  type: 'plan_item',
  parentId: 'plan',
  sortKey: id,
  props: { kind: 'camera', icon: 'camera/camera', x: 0, y: 0, width: 0.4, height: 0.4, ...props },
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});

describe('framesOffCameras', () => {
  it('takes off only the frames named, keeping every other entry as stored', () => {
    const records = { c1: camera('c1', { shot_ids: ['a', 7, 'b', { newer: true }, ''] }) };
    expect(framesOffCameras(records, ['a'])).toEqual([{ kind: 'update', id: 'c1', set: { shot_ids: [7, 'b', { newer: true }, ''] } }]);
  });

  it('unsets the list once nothing is left, takes off the shown frame, and leaves `keep` and unlisting cameras alone', () => {
    const records = {
      c1: camera('c1', { shot_ids: ['a'], shown_shot_id: 'a' }),
      c2: camera('c2', { shot_ids: ['a'] }),
      c3: camera('c3', { shot_ids: ['b'] }),
    };
    expect(framesOffCameras(records, ['a'], 'c2')).toEqual([{ kind: 'update', id: 'c1', unset: ['shot_ids', 'shown_shot_id'] }]);
    expect(framesOffCameras(records, [])).toEqual([]);
  });
});
