import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../core/media/store';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';

// Scout photos in the Locations tile (6.27): the import writes what a photo's EXIF said on the photo's own record, in the
// import's op group; "Use this photo's place and time" is ONE op on the location (so one op group and one undo), puts
// the place on as pasted coordinates do, replaces an earlier light reference, and requests nothing of any kind: no
// address search, no Rust command, no fetch. The place is made up: a point in the open sea.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);
const search = vi.hoisted(() => ({ searchOnline: vi.fn() }));
vi.mock('../../app/addressSearch', () => search);

const { applyPhotoPlaceTime, clearLightPhoto, importNote } = await import('./scoutPhoto');
const { addLocationPhotos, clearLightPhotoChanges, pasteCoordinatesChanges, photoPlaceTimeChanges } = await import('./locationEdits');
const { projectStore } = await import('../../app/projectStore');
const { apply, loadRecords, log, undo, redo } = await import('../../core/ops/ops');
const { nodeDriver } = await import('../../core/storage/nodeDriver');
const { migrate } = await import('../../core/storage/migrate');
const { MIGRATIONS } = await import('../../core/storage/migrations');
const { makeTestFolder } = await import('../../core/storage/testFolder');

type Records = Readonly<Record<string, SbdRecord>>;

const at = '2026-11-16T12:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({ id, type, parentId, sortKey: id, props, trashedAt, trashedBy: null, createdAt: at, updatedAt: at });
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const image = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600 };
const taken = { taken_at: '2026-11-03T16:42:07', taken_offset: '+02:00', gps_latitude: 12.510001, gps_longitude: -45.250002 };
const typed = { name: 'Quay', address: 'Pier 4', status: 'tbd' };

const project = (locationProps: Props = typed, ...photos: SbdRecord[]): Records =>
  recordsOf(record('p', 'project', null, {}), record('loc', 'location', 'p', locationProps), ...photos);
const dusk = record('dusk', 'media', 'loc', { ...image, ...taken, source_name: 'quay-dusk.jpg' });
const noon = record('noon', 'media', 'loc', { ...image, file: 'b'.repeat(64), taken_at: '2026-11-04T12:01:00', gps_latitude: -12.5, gps_longitude: 45.25 });
const timeOnly = record('time', 'media', 'loc', { ...image, taken_at: '2026-11-05T08:00:00' });
const placeOnly = record('place', 'media', 'loc', { ...image, gps_latitude: 12.5, gps_longitude: -45.25 });
const plain = record('plain', 'media', 'loc', image);

const prepared = (sha: string): PreparedImage => ({
  original: { sha256: sha.repeat(64), bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', width: 800, height: 600, colorSpace: 'srgb' },
  thumbnail: { bytes: new Uint8Array([1]), mime: 'image/jpeg', width: 80, height: 60, longEdge: 640 },
});

const fetchSpy = vi.fn();
beforeEach(() => {
  tauri.invoke.mockReset();
  search.searchOnline.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importing a location’s photos with their EXIF', () => {
  it('writes what each photo’s EXIF said on its own record, in the import’s one op group', () => {
    const { changes, alsoWrite } = addLocationPhotos(
      project(),
      'loc',
      [
        { image: prepared('a'), source: { name: 'quay-dusk.jpg' }, exif: { takenAt: '2026-11-03T16:42:07', takenOffset: '+02:00', latitude: 12.510001, longitude: -45.250002 } },
        { image: prepared('b'), source: { name: 'no-exif.jpg' }, exif: null },
        { image: prepared('c'), source: { name: 'odd.jpg' }, exif: { takenAt: 'yesterday', takenOffset: '+02:00', latitude: 91, longitude: 0 } },
        { image: prepared('d'), source: { name: 'before-6.27.jpg' } },
      ],
      '/Films/Quay.sbd',
      new Date(at),
    );
    expect(changes).toHaveLength(4);
    const props = changes.map((change) => (change.kind === 'create' ? change.record.props : null));
    expect(props[0]).toEqual({ kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, color_space: 'srgb', source_name: 'quay-dusk.jpg', ...taken });
    // No EXIF, an odd answer, and a caller from before 6.27: exactly the record a photo had before.
    for (const [i, sha, name] of [[1, 'b', 'no-exif.jpg'], [2, 'c', 'odd.jpg'], [3, 'd', 'before-6.27.jpg']] as const) {
      expect(props[i]).toEqual({ kind: 'image', file: sha.repeat(64), mime: 'image/jpeg', width: 800, height: 600, color_space: 'srgb', source_name: name });
    }
    expect(changes.every((change) => change.kind === 'create' && change.record.type === 'media' && change.record.parentId === 'loc')).toBe(true);
    // The pictures' bytes go beside, as before: two statements a photo.
    expect(alsoWrite).toHaveLength(8);
    // Nothing is set on the location by an import: a light reference is the person's choice.
    expect(JSON.stringify(changes)).not.toContain('light_photo_id');
  });
});

describe('"Use this photo’s place and time"', () => {
  it('is one op on the location: the place as pasted coordinates put it, and the photo as the light reference', () => {
    const records = project(typed, dusk);
    const changes = photoPlaceTimeChanges(records, 'dusk');
    expect(changes).toEqual([{ kind: 'update', id: 'loc', set: { latitude: 12.510001, longitude: -45.250002, map_moved: true, map_name: '12.51000, -45.25000', light_photo_id: 'dusk' } }]);
    // Exactly the pasted coordinates' own change, with the light reference beside it.
    const [pasted] = pasteCoordinatesChanges(records, 'loc', 12.510001, -45.250002);
    expect(changes[0]).toEqual({ ...pasted, set: { ...(pasted?.kind === 'update' ? pasted.set : {}), light_photo_id: 'dusk' } });
    // The address stays as typed.
    expect(JSON.stringify(changes)).not.toContain('address');
  });

  it('sets only the time for a photo with no GPS, only the place for one with no time, nothing for one with neither', () => {
    expect(photoPlaceTimeChanges(project(typed, timeOnly), 'time')).toEqual([{ kind: 'update', id: 'loc', set: { light_photo_id: 'time' } }]);
    expect(photoPlaceTimeChanges(project(typed, placeOnly), 'place')).toEqual([{ kind: 'update', id: 'loc', set: { latitude: 12.5, longitude: -45.25, map_moved: true, map_name: '12.50000, -45.25000' } }]);
    expect(photoPlaceTimeChanges(project(typed, plain), 'plain')).toEqual([]);
  });

  it('replaces an earlier light reference, and writes nothing when the location reads so already', () => {
    const used = { ...typed, latitude: 12.510001, longitude: -45.250002, map_moved: true, map_name: '12.51000, -45.25000', light_photo_id: 'dusk' };
    expect(photoPlaceTimeChanges(project(used, dusk, noon), 'dusk')).toEqual([]);
    expect(photoPlaceTimeChanges(project(used, dusk, noon), 'noon')).toEqual([{ kind: 'update', id: 'loc', set: { latitude: -12.5, longitude: 45.25, map_moved: true, map_name: '-12.50000, 45.25000', light_photo_id: 'noon' } }]);
    // The same place, another photo: only the reference changes.
    const here = record('again', 'media', 'loc', { ...image, ...taken, taken_at: '2026-11-06T07:00:00' });
    expect(photoPlaceTimeChanges(project(used, dusk, here), 'again')).toEqual([{ kind: 'update', id: 'loc', set: { light_photo_id: 'again' } }]);
  });

  it('does nothing for a photo in the Trash, a photo of a location in the Trash, a PDF, a frame’s picture or an id that names nothing', () => {
    expect(photoPlaceTimeChanges(project(typed, { ...dusk, trashedAt: at }), 'dusk')).toEqual([]);
    expect(photoPlaceTimeChanges(recordsOf(record('p', 'project', null, {}), record('loc', 'location', 'p', typed, at), dusk), 'dusk')).toEqual([]);
    expect(photoPlaceTimeChanges(project(typed, record('pdf', 'media', 'loc', { kind: 'pdf', ...taken })), 'pdf')).toEqual([]);
    expect(photoPlaceTimeChanges(recordsOf(record('p', 'project', null, {}), record('shot', 'shot', 'p', {}), record('still', 'media', 'shot', { ...image, ...taken })), 'still')).toEqual([]);
    expect(photoPlaceTimeChanges(project(), 'gone')).toEqual([]);
    expect(photoPlaceTimeChanges(project(), 'loc')).toEqual([]);
  });

  it('"Clear" takes the light reference off in one op, the place kept; nothing when there is none', () => {
    const used = { ...typed, latitude: 12.5, longitude: -45.25, map_name: '12.50000, -45.25000', map_moved: true, light_photo_id: 'dusk' };
    expect(clearLightPhotoChanges(project(used, dusk), 'loc')).toEqual([{ kind: 'update', id: 'loc', unset: ['light_photo_id'] }]);
    expect(clearLightPhotoChanges(project(typed, dusk), 'loc')).toEqual([]);
    expect(clearLightPhotoChanges(recordsOf(record('loc', 'location', 'p', used, at)), 'loc')).toEqual([]);
    expect(clearLightPhotoChanges(project(), 'gone')).toEqual([]);
  });

  it('through the store: one edit, and no request of any kind', async () => {
    const groups: Change[][] = [];
    const records = project(typed, dusk, timeOnly);
    projectStore.setState({
      records,
      applyWith: (build: (now: Records) => { changes: Change[] }) => {
        const { changes } = build(records);
        if (changes.length > 0) groups.push(changes);
        // As the real store's applyWith: true when nothing failed, whether or not there was anything to write.
        return Promise.resolve(true);
      },
    } as never);
    expect(await applyPhotoPlaceTime('dusk')).toEqual({ outcome: 'written', place: { latitude: 12.510001, longitude: -45.250002 }, time: true });
    expect(await applyPhotoPlaceTime('time')).toEqual({ outcome: 'written', place: null, time: true });
    // Nothing set to clear: nothing to write, and no group.
    expect(await clearLightPhoto('loc')).toBe('nothing');
    // One group each, one change in each.
    expect(groups.map((group) => group.length)).toEqual([1, 1]);
    expect(search.searchOnline).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('through the store: tells "nothing to write" from "the save failed"', async () => {
    // The real store resolves true when nothing failed, written or not, and false when the save was refused or threw.
    const used = { ...typed, latitude: 12.510001, longitude: -45.250002, map_moved: true, map_name: '12.51000, -45.25000', light_photo_id: 'dusk' };
    const store = (records: Records, saves: boolean) => {
      projectStore.setState({
        records,
        applyWith: (build: (now: Records) => { changes: Change[] }) => {
          build(records);
          return Promise.resolve(saves);
        },
      } as never);
    };
    // The location already has this place and this reference: nothing to write, and the store says nothing failed.
    store(project(used, dusk), true);
    expect((await applyPhotoPlaceTime('dusk')).outcome).toBe('nothing');
    // Something to write, and the save failed: never "nothing".
    store(project(typed, dusk), false);
    expect((await applyPhotoPlaceTime('dusk')).outcome).toBe('failed');
    expect(await clearLightPhoto('loc')).toBe('failed');
    // Nothing to write and a store that reports a failure anyway (a file a sync replaced): failed, not "already".
    store(project(used, dusk), false);
    expect((await applyPhotoPlaceTime('dusk')).outcome).toBe('failed');
    // Clear: written, then nothing.
    store(project(used, dusk), true);
    expect(await clearLightPhoto('loc')).toBe('written');
    store(project(typed, dusk), true);
    expect(await clearLightPhoto('loc')).toBe('nothing');
  });
});

describe('the status line after "Add photos…" (6.27 round 3)', () => {
  it('says, per photo, when its date and place were refused or are a HEIC’s, all in one; nothing for the others', async () => {
    const { setLocale } = await import('../../core/i18n');
    const { exifReasonOf } = await import('../../core/model/scoutPhoto');
    setLocale('en');
    // Photos named as the tile names them (round 4): by their number among the location's photos, not in the import.
    const photo = (id: string) => record(id, 'media', 'loc', { ...image, file: id.repeat(64).slice(0, 64) });
    const four = project(typed, photo('p1'), photo('p2'), photo('p3'), photo('p4'));
    expect(importNote(four, 'loc', [{ id: 'p1', reason: 'read' }, { id: 'p2', reason: 'none' }])).toBe('');
    expect(importNote(four, 'loc', [])).toBe('');
    expect(importNote(four, 'loc', [{ id: 'p1', reason: 'refused' }])).toBe('Photo 1: its date and place couldn’t be read, so it was added without them.');
    expect(importNote(four, 'loc', [{ id: 'p1', reason: 'read' }, { id: 'p2', reason: 'heic' }, { id: 'p3', reason: 'none' }, { id: 'p4', reason: 'refused' }])).toBe(
      'Photo 2: Storiiboard can’t read a HEIC’s date and place yet; a JPEG copy of it works. Photo 4: its date and place couldn’t be read, so it was added without them.',
    );
    // A location with 3 photos, 2 imported, the second refused: it is Photo 5 there.
    const five = project(typed, photo('p1'), photo('p2'), photo('p3'), photo('q1'), photo('q2'));
    expect(importNote(five, 'loc', [{ id: 'q1', reason: 'read' }, { id: 'q2', reason: 'refused' }])).toBe('Photo 5: its date and place couldn’t be read, so it was added without them.');
    // A photo that isn't the location's says nothing.
    expect(importNote(five, 'loc', [{ id: 'gone', reason: 'refused' }])).toBe('');
    setLocale('es');
    expect(importNote(four, 'loc', [{ id: 'p1', reason: 'heic' }, { id: 'p2', reason: 'refused' }])).toBe(
      'Foto 1: Storiiboard aún no puede leer la fecha y el lugar de un HEIC; una copia en JPEG sí funciona. Foto 2: no se pudieron leer su fecha y su lugar, así que se añadió sin ellos.',
    );
    setLocale('en');
    // The reader's reason: one of the four, anything else none.
    for (const reason of ['read', 'none', 'refused', 'heic'] as const) expect(exifReasonOf({ reason })).toBe(reason);
    for (const odd of [undefined, null, 'READ', 'Heic', 1, {}, '']) expect(exifReasonOf({ reason: odd })).toBe('none');
    expect(exifReasonOf(null)).toBe('none');
    // A refused or HEIC answer still imports, with exactly a photo's record from before 6.27.
    const { changes } = addLocationPhotos(project(), 'loc', [{ image: prepared('e'), source: { name: 'IMG_0001.HEIC' }, exif: { takenAt: null, takenOffset: null, latitude: null, longitude: null, reason: 'heic' } }], '/Films/Quay.sbd', new Date(at));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind === 'create' ? changes[0].record.props : null).toEqual({ kind: 'image', file: 'e'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, color_space: 'srgb', source_name: 'IMG_0001.HEIC' });
  });
});

describe('in a project file: one op group, one undo', () => {
  const folder = makeTestFolder();
  afterEach(() => {
    folder.remove();
  });

  it('"Use this photo’s place and time" is one step in History that one undo takes back whole, and redo puts back', async () => {
    const file = await nodeDriver.create(folder.path('Quay.sbd'));
    try {
      let tick = 0;
      const now = () => new Date(Date.parse(at) + (tick += 1) * 1000);
      await migrate(file, { isNew: true, migrations: MIGRATIONS, now });
      const create = (r: SbdRecord) => ({ kind: 'create' as const, record: { id: r.id, type: r.type, parentId: r.parentId, sortKey: r.sortKey, props: r.props } });
      await apply(file, [create(record('p', 'project', null, {})), create(record('loc', 'location', 'p', { ...typed, light_photo_id: 'noon' })), create(dusk), create(noon)], { now });
      const read = async (): Promise<Records> => Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
      const before = await read();
      const steps = (await log(file)).length;

      await apply(file, photoPlaceTimeChanges(before, 'dusk'), { now });
      expect(await log(file)).toHaveLength(steps + 1);
      const after = await read();
      expect(after.loc?.props).toEqual({ ...typed, latitude: 12.510001, longitude: -45.250002, map_moved: true, map_name: '12.51000, -45.25000', light_photo_id: 'dusk' });
      // The photos themselves are untouched.
      expect(after.dusk?.props).toEqual(before.dusk?.props);

      // One undo: the place gone and the earlier reference back, together.
      await undo(file, { now });
      expect((await read()).loc?.props).toEqual({ ...typed, light_photo_id: 'noon' });
      await redo(file, { now });
      expect((await read()).loc?.props).toEqual(after.loc?.props);
      expect(tauri.invoke).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await file.close();
    }
  });
});
