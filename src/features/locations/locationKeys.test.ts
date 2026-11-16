import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreparedImage } from '../../core/media/store';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { addLocationPhotos, newLocation } from './locationEdits';

// A new location, or a location's photos, past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never
// makes the app throw): after the last key that can be read; a sound file's keys are keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

function photo(seed: number): { image: PreparedImage; source: { name: string } } {
  const bytes = new Uint8Array(300).map((_, i) => (i * seed) % 256);
  return {
    image: {
      original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 800, height: 600, colorSpace: 'srgb' },
      thumbnail: { bytes: bytes.slice(0, 100), mime: 'image/jpeg', width: 640, height: 480, longEdge: 640 },
    },
    source: { name: `photo${String(seed)}.png` },
  };
}

const keysMade = (changes: readonly { kind: string; record?: { sortKey: string } }[]) => changes.flatMap((c) => (c.kind === 'create' && c.record ? [c.record.sortKey] : []));

describe('locations past an odd key (6.23)', () => {
  const project = record('p', 'project', null, { name: 'Odd' });

  it('a new location goes after the last readable key; a sound list’s key as before', () => {
    const odd = recordsOf(project, record('l1', 'location', 'p', { name: 'Diner' }, 'b'), record('l2', 'location', 'p', { name: 'Motel' }, '~'));
    expect(newLocation(odd, 'p', 'l3').record.sortKey).toBe(keyBetween('b', null));
    const sound = recordsOf(project, record('l1', 'location', 'p', { name: 'Diner' }, 'b'), record('l2', 'location', 'p', { name: 'Motel' }, 'd'));
    expect(newLocation(sound, 'p', 'l3').record.sortKey).toBe(keyBetween('d', null));
  });

  it('photos go after the location’s last readable key, each after the one before; a sound location’s keys as before', () => {
    const location = record('l1', 'location', 'p', { name: 'Diner' }, 'b');
    const odd = recordsOf(project, location, record('m1', 'media', 'l1', { kind: 'picture' }, 'b'), record('m2', 'media', 'l1', { kind: 'picture' }, '~'));
    const first = keyBetween('b', null);
    expect(keysMade(addLocationPhotos(odd, 'l1', [photo(2), photo(3)], '/Films/Odd.sbd').changes)).toEqual([first, keyBetween(first, null)]);
    const sound = recordsOf(project, location, record('m1', 'media', 'l1', { kind: 'picture' }, 'd'));
    expect(keysMade(addLocationPhotos(sound, 'l1', [photo(2)], '/Films/Odd.sbd').changes)).toEqual([keyBetween('d', null)]);
  });
});
