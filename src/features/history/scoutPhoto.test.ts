import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, changeText, changeValue, describeEdit, fieldChanges, lineText } from './summary';

// Scout photos in History (6.27): where a photo was taken (its EXIF's GPS) is private, as a location's coordinates are:
// History names the field and says it was set, changed or removed, never the value, since History feeds notifications.
// The light reference is said as "a photo", never an id. The place is made up: a point in the open sea.

const at = '2026-11-17T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({ id, type, parentId, sortKey: 'm', props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
const update = (before: SbdRecord, after: SbdRecord): LoggedOp => ({ id: 'o', seq: 1, groupId: 'g', groupKind: 'edit', recordId: after.id, kind: 'update', before, after, author: 'local', timestamp: at });
const created = (after: SbdRecord): LoggedOp => ({ id: 'c', seq: 1, groupId: 'g', groupKind: 'edit', recordId: after.id, kind: 'create', before: null, after, author: 'local', timestamp: at });

const image = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, source_name: 'quay-dusk.jpg' };
const taken = { taken_at: '2026-11-03T16:42:07', taken_offset: '+02:00', gps_latitude: 12.510001, gps_longitude: -45.250002 };
const quay = (props: Props = {}) => record('loc', 'location', 'p', { name: 'Quay', status: 'tbd', ...props });
const photo = (props: Props = {}) => record('ph', 'media', 'loc', { ...image, ...props });
const sun = (props: Props = {}) => record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0, time: '13:00', ...props });
const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });
const around = new Map<string, SbdRecord>([['loc', quay()], ['own', own]]);
// The photo's stored picture is in the file (a step whose picture is gone says so).
const tell = (ops: LoggedOp[]) => lineText(describeEdit(ops, new Set(['a'.repeat(64)]), around));

/** Every digit run of the made-up place, as it could leak: whole, rounded, or as the location's map name shows it. */
const PLACE_TEXT = ['12.51', '45.25', '12,51', '45,25'];
const hidesPlace = (text: string) => {
  for (const part of PLACE_TEXT) expect(text, text).not.toContain(part);
};
const lines = (before: SbdRecord, after: SbdRecord) =>
  fieldChanges(before, after).map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)} | ${changeText(c, c.before)} → ${changeText(c, c.after)}`);

afterEach(() => {
  setLocale('en');
});

describe('History for scout photos (6.27)', () => {
  it('never shows where a photo was taken: set, changed or removed only', () => {
    const set = lines(photo(), photo(taken));
    expect(set).toContain('latitude where taken: — → not shown | — → not shown');
    expect(set).toContain('longitude where taken: — → not shown | — → not shown');
    // When it was taken is shown, as a shoot day's date is.
    expect(set).toContain('time taken: — → 2026-11-03T16:42:07 | — → 2026-11-03T16:42:07');
    expect(set).toContain('time zone offset when taken: — → +02:00 | — → +02:00');
    hidesPlace(set.join('\n'));
    const changed = lines(photo(taken), photo({ ...taken, gps_latitude: -12.510001, gps_longitude: 45.250002 }));
    expect(changed).toEqual(['latitude where taken: changed → changed | changed → changed', 'longitude where taken: changed → changed | changed → changed']);
    const removed = lines(photo(taken), photo({ taken_at: taken.taken_at }));
    hidesPlace(removed.join('\n'));
    expect(removed).toContain('latitude where taken: not shown → — | not shown → —');
  });

  it('says a photo added with its EXIF as any photo, with no place in its line', () => {
    const line = tell([created(photo(taken))]);
    expect(line).toBe('Added 1 photo of Quay');
    hidesPlace(line);
  });

  it('says "Use this photo’s place and time" without the place, and the light reference as a photo', () => {
    const before = quay();
    const after = quay({ latitude: 12.510001, longitude: -45.250002, map_moved: true, map_name: '12.51000, -45.25000', light_photo_id: 'ph' });
    const line = tell([update(before, after)]);
    expect(line).toBe('Quay: place on the map, light reference');
    hidesPlace(line);
    const said = lines(before, after);
    hidesPlace(said.join('\n'));
    expect(said).toContain('light reference: — → a photo | — → a photo');
    expect(said.join('\n')).not.toContain('ph |');
    // Another photo chosen, and the reference cleared.
    expect(lines(after, quay({ ...after.props, light_photo_id: 'ph2' }))).toEqual(['light reference: a photo → a photo | a photo → a photo']);
    const cleared = Object.fromEntries(Object.entries(after.props).filter(([name]) => name !== 'light_photo_id'));
    expect(lines(after, record('loc', 'location', 'p', cleared))).toEqual(['light reference: a photo → — | a photo → —']);
  });

  it('names a sun path shown at the photo’s time', () => {
    const [change] = fieldChanges(sun(), sun({ at_photo: true }));
    expect(change && changeLabel(change)).toBe('sun at the photo’s time');
    expect(change && changeValue(change, change.after)).toBe('shown');
    expect(change && changeValue(change, change.before)).toBe('—');
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    const set = lines(photo(), photo(taken));
    expect(set).toContain('latitud donde se tomó: — → no se muestra | — → no se muestra');
    hidesPlace(set.join('\n'));
    const [change] = fieldChanges(quay(), quay({ light_photo_id: 'ph' }));
    expect(change && `${changeLabel(change)}: ${changeValue(change, change.after)}`).toBe('referencia de luz: una foto');
  });
});
