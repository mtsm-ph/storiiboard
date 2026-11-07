import { describe, expect, it } from 'vitest';
import { locationChange, newLocation, trashLocation } from '../../features/locations/locationEdits';
import { locationFields, mapLink, projectLocations } from './location';
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
    expect(locationNameTaken(records(), 'p', ' barn ', 'l1')).toBe(true);
    expect(locationNameTaken(records(), 'p', 'Barn', 'l2')).toBe(false);
    expect(locationNameTaken(records(), 'p', 'Gone', 'l1')).toBe(false);
  });

  it('lists a trashed location in the Trash by name and restores it alone', async () => {
    const { restoreChanges, trashItems } = await import('../../features/trash/trash');
    const item = trashItems(records(), 'p').find((i) => i.id === 'l3');
    expect(item).toMatchObject({ kind: 'location', name: 'Gone', sceneId: null });
    expect(restoreChanges(records(), 'p', 'l3')).toEqual([{ kind: 'restore', id: 'l3' }]);
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
});
