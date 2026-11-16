import { describe, expect, it } from 'vitest';
import { compassModel, compassModelsMade } from './planCompass';
import type { Props, SbdRecord } from './record';
import { planVector } from './sunPath';

// The plan's compass (6.5.5), as data: north as the room has it (turning with it), the sun from the sun path's one
// reading at its time or at solar noon, "N?" with no north, north alone with no place or date or no sun path.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const box = { x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0 };

/** A room with north turned `north`° (none for null), a setup with a sun path on its own in New York on 21 June 2026. */
function project(north: number | null, sun: Props | null = { time: '13:00', own_latitude: 40.7128, own_longitude: -74.006, own_date: '2026-06-21' }): Records {
  return recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    ...(north === null ? [] : [record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: north })]),
    record('s1', 'scene', 'p', { number: '1', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    ...(sun === null ? [] : [record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, ...sun })]),
  );
}
const view = { sceneId: 's1', setupId: 'u1' };
const ny = new Map<string, string | null>([['sun', 'America/New_York']]);

describe('the plan’s compass (6.5.5)', () => {
  it('points north as the room has it, turning with it', () => {
    expect(compassModel(project(0), view, ny)).toMatchObject({ north: 0, northArrow: { x: 0, y: -1 } });
    const turned = compassModel(project(90), view, ny);
    expect(turned.north).toBe(90);
    expect(turned.northArrow).toEqual({ x: 1, y: 0 });
    const sun = turned.sun;
    if (!sun) throw new Error('no sun');
    // The sun near due south at 13:00, so with north to the right of the plan it points to the left.
    expect(sun.at.x).toBeLessThan(-0.99);
    expect(Math.abs(sun.at.y)).toBeLessThan(0.05);
    expect(sun.at).toMatchObject({ up: true, time: '13:00' });
    expect(sun.timeFrom).toBe('item');
    // The arc turns with it: its first point (sunrise, about 58° east of north) is where 58° reads with north turned 90°.
    const [rise] = sun.arc;
    const unturned = compassModel(project(0), view, ny).sun?.arc[0];
    if (!rise || !unturned) throw new Error('no arc');
    expect(rise.x).toBeCloseTo(-unturned.y, 6);
    expect(rise.y).toBeCloseTo(unturned.x, 6);
    expect(rise.x).toBeCloseTo(planVector(Math.atan2(unturned.x, -unturned.y) * (180 / Math.PI), 90).x, 6);
  });

  it('shows the sun at solar noon when the sun path has no time of its own, and says so', () => {
    const noon = compassModel(project(0, { own_latitude: 40.7128, own_longitude: -74.006, own_date: '2026-06-21' }), view, ny);
    expect(noon.sun?.timeFrom).toBe('solarNoon');
    expect(noon.sun?.at.time).toMatch(/^12:5\d$/);
    expect(Math.abs((noon.sun?.at.bearing ?? 0) - 180)).toBeLessThanOrEqual(1);
  });

  it('is “N?” with no north, and draws no sun without one', () => {
    const model = compassModel(project(null), view, ny);
    expect(model).toMatchObject({ north: null, northArrow: null, sun: null, missing: 'noNorth', sunId: 'sun' });
  });

  it('is north alone with no place or date, or no sun path', () => {
    const noPlace = compassModel(project(30, { time: '13:00', own_date: '2026-06-21' }), view, ny);
    // A setup with no frames: what's missing said as 6.6 says it there, the own field that would complete it named.
    expect(noPlace).toMatchObject({ north: 30, sun: null, missing: 'noFrames', sunId: 'sun', reading: { ownField: 'place' } });
    const noDate = compassModel(project(30, { time: '13:00', own_latitude: 40.7128, own_longitude: -74.006 }), view, ny);
    expect(noDate).toMatchObject({ north: 30, sun: null, missing: 'noFrames', reading: { ownField: 'date' } });
    expect(compassModel(project(30, null), view, ny)).toMatchObject({ north: 30, sun: null, missing: 'noSunPath', sunId: null });
    // A scene's own view has no setup, so no sun path: north alone.
    expect(compassModel(project(30), { sceneId: 's1', setupId: null }, ny)).toMatchObject({ north: 30, sun: null, missing: 'noSunPath' });
  });

  it('is worked out once per records, view and zone answer: a render that changes none of them works nothing out', () => {
    const records = project(35);
    const before = compassModelsMade();
    const first = compassModel(records, view, ny);
    // A new zones map with the same answer (each render makes one), and the same records: the same model.
    expect(compassModel(records, view, new Map(ny))).toBe(first);
    expect(compassModelsMade() - before).toBe(1);
    // Another view, another zone answer, or new records: worked out again.
    compassModel(records, { sceneId: 's1', setupId: null }, ny);
    compassModel(records, view, new Map());
    compassModel({ ...records }, view, ny);
    expect(compassModelsMade() - before).toBe(4);
  });

  it('says nothing yet while its zone is on its way', () => {
    expect(compassModel(project(0), view, new Map())).toMatchObject({ sun: null, missing: null, pending: true });
  });
});
