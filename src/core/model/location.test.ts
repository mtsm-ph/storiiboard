import { describe, expect, it } from 'vitest';
import { locationChange, newLocation, timeZoneChange, trashLocation } from '../../features/locations/locationEdits';
import { computerTimeZone, locationFields, mapLink, projectLocations, unpinnedBy, zoneFor } from './location';
import type { SbdRecord } from './record';

// Locations (3.3): read from their records, listed with the scenes set there, and changed one field at a time.

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-07T12:00:00.000Z',
  updatedAt: '2026-11-07T12:00:00.000Z',
});

const records = () => ({
  p: record('p', 'project', null, {}),
  l1: record('l1', 'location', 'p', { name: 'Diner', status: 'confirmed', address: '12 Route 9, Bey County', parking: 'Lot behind' }),
  l2: record('l2', 'location', 'p', { name: 'Barn' }),
  l3: record('l3', 'location', 'p', { name: 'Gone' }, '2026-11-07T12:00:00.000Z'),
  sc1: record('sc1', 'scene', 'p', { number: '1', location_id: 'l1' }),
  sc2: record('sc2', 'scene', 'p', { number: '2', location_id: 'l1' }),
  sc3: record('sc3', 'scene', 'p', { number: '3', location_id: 'l1' }, '2026-11-07T12:00:00.000Z'),
});

describe('locations (3.3)', () => {
  it('reads a location’s fields, an odd status as TBD', () => {
    expect(locationFields({ name: 'Diner', status: 'booked?' })).toMatchObject({ name: 'Diner', status: 'tbd', address: '', parking: '' });
    expect(locationFields({ status: 'cancelled' }).status).toBe('cancelled');
  });

  it('lists the live locations by name with their live scenes', () => {
    const list = projectLocations(records(), 'p');
    expect(list.map((l) => l.fields.name)).toEqual(['Barn', 'Diner']);
    expect(list[1]?.scenes.map((s) => s.id)).toEqual(['sc1', 'sc2']);
  });

  it('links a map search by address, else by name, and nothing for neither', () => {
    expect(mapLink({ address: '12 Route 9,\n Bey County', name: 'Diner' })).toBe('https://www.openstreetmap.org/search?query=12%20Route%209%2C%20Bey%20County');
    expect(mapLink({ address: '', name: 'Diner' })).toBe('https://www.openstreetmap.org/search?query=Diner');
    expect(mapLink({ address: ' ', name: '' })).toBeNull();
  });

  it('makes, changes and trashes a location, one edit each, nothing when nothing changes', () => {
    const made = newLocation(records(), 'p', 'l4');
    expect(made.record).toMatchObject({ id: 'l4', type: 'location', parentId: 'p', props: { name: '', status: 'tbd' } });
    // After every other location, those in the Trash too.
    expect(made.record.sortKey > 'l3').toBe(true);
    expect(locationChange(records(), 'l1', 'parking', 'Street only')).toEqual([{ kind: 'update', id: 'l1', set: { parking: 'Street only' } }]);
    expect(locationChange(records(), 'l1', 'parking', 'Lot behind')).toEqual([]);
    expect(locationChange(records(), 'l3', 'name', 'Back')).toEqual([]);
    expect(locationChange(records(), 'sc1', 'name', 'x')).toEqual([]);
    expect(trashLocation(records(), 'l1')).toEqual([{ kind: 'trash', id: 'l1' }]);
    expect(trashLocation(records(), 'l3')).toEqual([]);
  });
});

describe('one name per place (3.3)', () => {
  it('typing a name a trashed location had brings that one back, not a second', async () => {
    const { setSceneLocation, locationNameTaken } = await import('../../features/storyboard/board');
    const all = { ...records(), l1: record('l1', 'location', 'p', { name: 'Diner', address: '12 Route 9' }, '2026-11-07T12:00:00.000Z') };
    expect(setSceneLocation(all, 'p', 'sc1', 'diner')).toEqual([
      { kind: 'restore', id: 'l1' },
      { kind: 'update', id: 'sc1', set: { location_id: 'l1' } },
    ]);
    // A rename onto another live location's name is taken, whatever its case; its own name isn't.
    expect(locationNameTaken(records(), 'p', ' barn ', 'l1')).toBe('live');
    expect(locationNameTaken(records(), 'p', 'Barn', 'l2')).toBeNull();
    // One in the Trash holds its name too: a restore would put it beside the new one.
    expect(locationNameTaken(records(), 'p', 'gone', 'l1')).toBe('trashed');
    // A live name kept with a stray space still matches a typed one: no second location.
    const spaced = { ...records(), l1: record('l1', 'location', 'p', { name: 'Diner ' }) };
    expect(setSceneLocation(spaced, 'p', 'sc1', 'Diner')).toEqual([]);
    expect(setSceneLocation(spaced, 'p', 'sc3', 'diner')).toEqual([]);
  });

  it('lists a trashed location in the Trash by name and restores it alone', async () => {
    const { restoreChanges, trashItems } = await import('../../features/trash/trash');
    const item = trashItems(records(), 'p').find((i) => i.id === 'l3');
    expect(item).toMatchObject({ kind: 'location', name: 'Gone', sceneId: null });
    expect(restoreChanges(records(), 'p', 'l3')).toEqual([{ kind: 'restore', id: 'l3' }]);
  });

  it('won’t restore a location beside a live one with its name: says so instead', async () => {
    const { restoreClash } = await import('../../features/trash/trash');
    expect(restoreClash(records(), 'l3')).toBeNull();
    const clash = { ...records(), l2: record('l2', 'location', 'p', { name: 'gone ' }) };
    expect(restoreClash(clash, 'l3')).toBe('Gone');
  });
});

describe('a location’s contact in History (3.3)', () => {
  it('names the field, never its phone, email or address', async () => {
    const { changeLabel, changeValue, fieldChanges } = await import('../../features/history/summary');
    const before = record('l1', 'location', 'p', { name: 'Diner', contact_phone: '', address: '12 Route 9' });
    const after = record('l1', 'location', 'p', { name: 'Diner', contact_phone: '+1 212 555 0100', contact_email: 'ana@example.com', address: '14 Route 9', status: 'confirmed' });
    const lines = fieldChanges(before, after).map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    expect(lines.join(' | ')).not.toMatch(/555|example\.com|Route 9/);
    expect(lines).toContain('contact phone: — → not shown');
    expect(lines).toContain('address: changed → changed');
    expect(lines).toContain('status: — → Confirmed');
  });

  it('says a location’s status and a frame’s in the language chosen now', async () => {
    const { setLocale } = await import('../i18n');
    const { valueLabel } = await import('../../features/history/summary');
    setLocale('es');
    try {
      expect(valueLabel('status', 'confirmed')).toBe('Confirmada');
      expect(valueLabel('status', 'have')).not.toBe('Have');
    } finally {
      setLocale('en');
    }
    expect(valueLabel('status', 'confirmed')).toBe('Confirmed');
  });
});

describe('a frame’s own location, and a location’s photos (3.3b)', () => {
  it('reads a frame’s own location over its scene’s, and a trashed one as none', async () => {
    const { frameLocationId } = await import('./location');
    const all = { ...records(), s1: record('s1', 'shot', 'sc1', {}), s2: record('s2', 'shot', 'sc1', { location_id: 'l2' }), s3: record('s3', 'shot', 'sc1', { location_id: 'l3' }) };
    expect(frameLocationId(all, all.s1)).toBe('l1');
    expect(frameLocationId(all, all.s2)).toBe('l2');
    // Its own is in the Trash: the scene's again.
    expect(frameLocationId(all, all.s3)).toBe('l1');
  });

  it('sets a frame’s own location and puts it back on its scene’s, nothing when nothing changes', async () => {
    const { setFrameLocation } = await import('../../features/storyboard/board');
    const all = { ...records(), s1: record('s1', 'shot', 'sc1', {}), s2: record('s2', 'shot', 'sc1', { location_id: 'l2' }) };
    expect(setFrameLocation(all, 's1', 'l2')).toEqual([{ kind: 'update', id: 's1', set: { location_id: 'l2' } }]);
    expect(setFrameLocation(all, 's2', 'l2')).toEqual([]);
    expect(setFrameLocation(all, 's2', null)).toEqual([{ kind: 'update', id: 's2', unset: ['location_id'] }]);
    expect(setFrameLocation(all, 's1', null)).toEqual([]);
    // Not to a location in the Trash, nor to something that isn't one.
    expect(setFrameLocation(all, 's1', 'l3')).toEqual([]);
    expect(setFrameLocation(all, 's1', 'sc2')).toEqual([]);
  });

  it('adds photos to a live location in one edit, and sends one to the Trash named by its location', async () => {
    const { addLocationPhotos, trashLocationPhoto } = await import('../../features/locations/locationEdits');
    const { restoreChanges, trashItems } = await import('../../features/trash/trash');
    const bytes = new Uint8Array(200).map((_, i) => i % 256);
    const image: import('../media/store').PreparedImage = {
      original: { sha256: 'a'.repeat(64), bytes, mime: 'image/jpeg', width: 400, height: 300, colorSpace: 'srgb' },
      thumbnail: { bytes: bytes.slice(0, 50), mime: 'image/jpeg', width: 400, height: 300, longEdge: 400 },
    };
    const added = addLocationPhotos(records(), 'l1', [{ image, source: { name: 'recce-1.jpg' } }, { image, source: { name: 'recce-2.jpg' } }], '/Films/Bey County.sbd');
    expect(added.changes.map((c) => c.kind === 'create' && c.record.parentId)).toEqual(['l1', 'l1']);
    expect(added.alsoWrite.length).toBeGreaterThan(0);
    expect(addLocationPhotos(records(), 'l3', [{ image, source: {} }], '').changes).toEqual([]);
    const { mediaProps } = await import('../media/store');
    const photo = record('ph1', 'media', 'l1', mediaProps(image, { name: 'recce-1.jpg' }));
    expect(trashLocationPhoto({ ...records(), ph1: photo }, 'ph1')).toEqual([{ kind: 'trash', id: 'ph1' }]);
    // In the Trash: named by its location; restored with its location when that's in the Trash too.
    const trashed = { ...records(), ph1: { ...photo, trashedAt: '2026-11-07T12:00:00.000Z' }, ph2: record('ph2', 'media', 'l3', { kind: 'image', file: 'b'.repeat(64) }, '2026-11-07T12:00:00.000Z') };
    expect(trashItems(trashed, 'p').find((i) => i.id === 'ph1')?.name).toBe('recce-1.jpg (photo of Diner)');
    expect(restoreChanges(trashed, 'p', 'ph2')).toEqual([{ kind: 'restore', id: 'l3' }, { kind: 'restore', id: 'ph2' }]);
  });
});

describe('3.3b review', () => {
  type LoggedOp = import('../ops/ops').LoggedOp;
  const logged = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null, seq = 1): LoggedOp => ({
    id: `${kind}${String(seq)}`,
    seq,
    groupId: 'g',
    groupKind: 'edit',
    recordId: (after ?? before)?.id ?? '',
    kind,
    before,
    after,
    author: 'Kevin',
    timestamp: '2026-11-07T12:00:00.000Z',
  });
  const photo = (id: string) => record(id, 'media', 'l1', { kind: 'image', file: 'a'.repeat(64), source_name: `${id}.jpg` });
  const gone = <T extends SbdRecord>(r: T): T => ({ ...r, trashedAt: '2026-11-07T12:00:00.000Z' });

  it('History names a location’s photos by their location, and a restore with the location as the location’s', async () => {
    const { describeEdit, lineText } = await import('../../features/history/summary');
    const diner = records().l1;
    const around = new Map([['l1', diner]]);
    const text = (ops: LoggedOp[]) => lineText(describeEdit(ops, new Set(['a'.repeat(64)]), around));
    expect(text([logged('create', null, photo('ph1')), logged('create', null, photo('ph2'), 2)])).toMatch(/^Added 2 photos of .*Diner/);
    expect(text([logged('trash', photo('ph1'), gone(photo('ph1')))])).toMatch(/^Removed 1 photo of .*Diner/);
    expect(text([logged('restore', gone(diner), diner), logged('restore', gone(photo('ph1')), photo('ph1'), 2)])).toMatch(/Diner/);
    expect(text([logged('restore', gone(diner), diner), logged('restore', gone(photo('ph1')), photo('ph1'), 2)])).not.toMatch(/photo|picture/i);
  });

  it('a location’s own fields: its labels are reserved, a frame’s aren’t', async () => {
    const { fieldName } = await import('./customFields');
    expect(fieldName('Parking', [], [], 'location')).toMatchObject({ ok: false });
    expect(fieldName('Lens', [], [], 'location')).toEqual({ ok: true, name: 'Lens' });
    expect(fieldName('Lens', [], [])).toMatchObject({ ok: false });
    expect(fieldName('Curfew', [], [], 'location')).toEqual({ ok: true, name: 'Curfew' });
  });

  it('restoring a photo checks its trashed location’s name, as restoring the location does', async () => {
    const { restoreClash, trashItems } = await import('../../features/trash/trash');
    const base = { ...records(), ph: gone(record('ph', 'media', 'l3', { kind: 'image', file: 'a'.repeat(64) })) };
    expect(restoreClash(base, 'ph')).toBeNull();
    expect(restoreClash({ ...base, l2: record('l2', 'location', 'p', { name: 'Gone' }) }, 'ph')).toBe('Gone');
    // An unnamed location's photo still reads sensibly in the Trash.
    const unnamed = { ...base, l3: gone(record('l3', 'location', 'p', { name: ' ' })) };
    expect(trashItems(unnamed, 'p').find((i) => i.id === 'ph')?.name).not.toMatch(/of \)$/);
  });

  it('a location only frames are shot at counts them, so it never reads as unused', () => {
    const all = { ...records(), s1: record('s1', 'shot', 'sc1', { location_id: 'l2' }), s2: record('s2', 'shot', 'sc3', { location_id: 'l2' }) };
    const barn = projectLocations(all, 'p').find((l) => l.record.id === 'l2');
    expect(barn?.scenes).toEqual([]);
    // Not one whose scene is in the Trash.
    expect(barn?.frames.map((f) => f.id)).toEqual(['s1']);
    // A frame pinned to its own scene's location is counted with the scene, not twice.
    const diner = projectLocations({ ...all, s3: record('s3', 'shot', 'sc1', { location_id: 'l1' }) }, 'p').find((l) => l.record.id === 'l1');
    expect(diner?.frames).toEqual([]);
  });

  it('the shot list’s location column: the frame’s own, else its scene’s, a trashed own one as the scene’s', async () => {
    const { shotListCsv } = await import('../../features/export/shotListCsv');
    const all = {
      ...records(),
      s1: record('s1', 'shot', 'sc1', { number: '1A' }),
      s2: record('s2', 'shot', 'sc1', { number: '1B', location_id: 'l2' }),
      s3: record('s3', 'shot', 'sc1', { number: '1C', location_id: 'l3' }),
    };
    const rows = shotListCsv(all, 'p', { kind: 'project' }).replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    const column = (rows[0] ?? '').split(',').indexOf('Location');
    expect(rows.slice(1).map((row) => row.split(',')[column])).toEqual(['Diner', 'Barn', 'Diner']);
  });
});

describe('a location on the map (3.4)', () => {
  const place = { name: 'Plaza de Armas, Cusco, Peru', latitude: -13.5167674, longitude: -71.9787787 };

  it('takes a place picked from the search in one edit, keeping a typed address; nothing twice', async () => {
    const { placeLocation, unplaceLocation } = await import('../../features/locations/locationEdits');
    expect(placeLocation(records(), 'l1', place)).toEqual([{ kind: 'update', id: 'l1', set: { latitude: -13.5167674, longitude: -71.9787787, map_name: place.name } }]);
    // An empty address takes the place's name.
    expect(placeLocation(records(), 'l2', place)).toEqual([{ kind: 'update', id: 'l2', set: { latitude: -13.5167674, longitude: -71.9787787, map_name: place.name, address: place.name } }]);
    const placed = { ...records(), l1: record('l1', 'location', 'p', { name: 'Diner', latitude: place.latitude, longitude: place.longitude, map_name: place.name }) };
    expect(placeLocation(placed, 'l1', place)).toEqual([]);
    expect(placeLocation(records(), 'l3', place)).toEqual([]);
    expect(unplaceLocation(placed, 'l1')).toEqual([{ kind: 'update', id: 'l1', unset: ['latitude', 'longitude', 'map_name'] }]);
    expect(unplaceLocation(records(), 'l1')).toEqual([]);
    // A new address takes the old pin off in the same edit; another field leaves it.
    const { locationChange } = await import('../../features/locations/locationEdits');
    expect(locationChange(placed, 'l1', 'address', 'Av. El Sol 100')).toEqual([{ kind: 'update', id: 'l1', set: { address: 'Av. El Sol 100' }, unset: ['latitude', 'longitude', 'map_name'] }]);
    expect(locationChange(placed, 'l1', 'parking', 'Street')).toEqual([{ kind: 'update', id: 'l1', set: { parking: 'Street' } }]);
    // Only re-spaced, it's the same address: the place stays.
    const spaced = { ...placed, l1: record('l1', 'location', 'p', { ...placed.l1.props, address: 'Plaza de Armas' }) };
    expect(locationChange(spaced, 'l1', 'address', ' Plaza  de Armas ')).toEqual([{ kind: 'update', id: 'l1', set: { address: ' Plaza  de Armas ' } }]);
  });

  it('reads its place, never one off the Earth, and links the pin over the address', async () => {
    const { mapPlace } = await import('./location');
    expect(mapPlace({ latitude: place.latitude, longitude: place.longitude, map_name: place.name })).toEqual(place);
    expect(mapPlace({ latitude: 200, longitude: 0, map_name: 'x' })).toBeNull();
    expect(mapPlace({})).toBeNull();
    expect(mapLink({ address: '12 Route 9', name: 'Diner' }, place)).toBe('https://www.openstreetmap.org/?mlat=-13.516767&mlon=-71.978779#map=17/-13.516767/-71.978779');
  });

  it('is kept out of History as the address is', async () => {
    const { changeLabel, changeValue, fieldChanges } = await import('../../features/history/summary');
    const before = record('l1', 'location', 'p', { name: 'Diner' });
    const after = record('l1', 'location', 'p', { name: 'Diner', latitude: place.latitude, longitude: place.longitude, map_name: place.name });
    const lines = fieldChanges(before, after).map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    expect(lines.join(' | ')).not.toMatch(/13\.5|71\.9|Cusco/);
    expect(lines).toContain('place on the map: — → not shown');
  });

  it('chooses the zone a location’s times are in (4.3): its own, else the map’s, else this computer’s', () => {
    const mine = (props: SbdRecord['props']) => locationFields(props);
    expect(zoneFor(mine({ time_zone: 'Europe/Madrid' }), 'America/New_York')).toEqual({ zone: 'Europe/Madrid', source: 'location' });
    expect(zoneFor(mine({}), 'America/New_York')).toEqual({ zone: 'America/New_York', source: 'map' });
    // Odd values read as unset, so the map's zone (or this computer's) is used instead.
    expect(mine({ time_zone: 'Mars/Olympus' }).time_zone).toBe('');
    expect(mine({ time_zone: 7 }).time_zone).toBe('');
    expect(zoneFor(mine({ time_zone: 'Mars/Olympus' }), 'Asia/Tokyo')).toEqual({ zone: 'Asia/Tokyo', source: 'map' });
    expect(zoneFor(mine({}), null)).toEqual({ zone: computerTimeZone(), source: 'computer' });
    expect(zoneFor(mine({}), 'Not/AZone')).toEqual({ zone: computerTimeZone(), source: 'computer' });
  });

  it('sets, changes and unsets the time zone in one edit each, and leaves it when a new address unpins the place (4.3)', () => {
    const all = { ...records(), l4: record('l4', 'location', 'p', { name: 'Pier', address: 'Old', latitude: 1, longitude: 2, map_name: 'Old', time_zone: 'Asia/Tokyo' }) };
    expect(timeZoneChange(all, 'l1', 'Europe/Madrid')).toEqual([{ kind: 'update', id: 'l1', set: { time_zone: 'Europe/Madrid' } }]);
    expect(timeZoneChange(all, 'l4', 'Asia/Tokyo')).toEqual([]);
    expect(timeZoneChange(all, 'l1', 'Mars/Olympus')).toEqual([]);
    expect(timeZoneChange(all, 'l4', null)).toEqual([{ kind: 'update', id: 'l4', unset: ['time_zone'] }]);
    // Already unset: nothing to write. A trashed or missing location: nothing either.
    expect(timeZoneChange(all, 'l1', null)).toEqual([]);
    expect(timeZoneChange(all, 'l3', 'Europe/Madrid')).toEqual([]);
    expect(timeZoneChange(all, 'nope', 'Europe/Madrid')).toEqual([]);
    // A new address takes the place off, never the zone chosen by hand.
    expect(unpinnedBy(all.l4.props, 'New address')).toEqual(['latitude', 'longitude', 'map_name']);
    expect(locationChange(all, 'l4', 'address', 'New address')).toEqual([
      { kind: 'update', id: 'l4', set: { address: 'New address' }, unset: ['latitude', 'longitude', 'map_name'] },
    ]);
  });
});
