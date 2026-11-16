import { getPosition } from 'suncalc';
import { describe, expect, it } from 'vitest';
import { planItemFields, wallBetween, wallProps, type Point } from './plan';
import type { Props, SbdRecord } from './record';
import { trueAltitude } from './sunPath';
import { sunTimes } from './sunTimes';
import { compassPointOf, directSun, unreadable, windowSunOf, windowSunsMade, windowSunsOf, windowWall, type DirectSun } from './windowSun';

// Sun through the windows (6.5.6): which side of a window is outside, which way it faces through the room's north, and
// the hours direct sun can come through it, checked against SunCalc's own positions at each stretch's ends.

type Records = Record<string, SbdRecord>;

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
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));

const wall = (id: string, a: Point, b: Point, parent = 'room'): SbdRecord => record(id, 'plan_item', parent, wallProps(wallBetween(a, b)));
const wallsOf = (...list: SbdRecord[]) => list.map((r) => {
  const fields = planItemFields(r.props);
  if (!fields) throw new Error(r.id);
  return { id: r.id, fields };
});
const turn = (p: Point, degrees: number): Point => {
  const a = (degrees * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};

/** A closed 4 × 3 m room, its corners turned by `degrees` round the middle: top, right, bottom and left walls, drawn clockwise. */
const rectangle = (degrees = 0) => {
  const [tl, tr, br, bl] = [
    { x: -2, y: -1.5 },
    { x: 2, y: -1.5 },
    { x: 2, y: 1.5 },
    { x: -2, y: 1.5 },
  ].map((p) => turn(p, degrees)) as [Point, Point, Point, Point];
  return [wall('top', tl, tr), wall('right', tr, br), wall('bottom', br, bl), wall('left', bl, tl)];
};

describe('which side of a window is outside (6.5.6)', () => {
  it('a closed rectangle: each wall outside, facing away from the room', () => {
    const walls = wallsOf(...rectangle());
    // The bottom wall runs right to left: its window looks down the plan.
    expect(windowWall(walls, 'bottom', 2)).toMatchObject({ kind: 'outside', outward: { x: 0, y: 1 }, planAngle: 180 });
    expect(windowWall(walls, 'top', 2)).toMatchObject({ kind: 'outside', planAngle: 0 });
    expect(windowWall(walls, 'right', 1.5)).toMatchObject({ kind: 'outside', planAngle: 90 });
    expect(windowWall(walls, 'left', 1.5)).toMatchObject({ kind: 'outside', planAngle: 270 });
    // Near a corner, still outside.
    expect(windowWall(walls, 'bottom', 0.4)).toMatchObject({ kind: 'outside', planAngle: 180 });
  });

  it('an L-shaped room: the walls at the inner corner look out', () => {
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const list = corners.map((p, i) => wall(`w${String(i)}`, p, corners[(i + 1) % corners.length] as Point));
    const walls = wallsOf(...list);
    // (4, 2) to (2, 2): the step's top, looking down past the other leg.
    expect(windowWall(walls, 'w2', 1)).toMatchObject({ kind: 'outside', planAngle: 180 });
    // (2, 2) to (2, 4): looking right, past the step.
    expect(windowWall(walls, 'w3', 1)).toMatchObject({ kind: 'outside', planAngle: 90 });
    // The long left wall looks left.
    expect(windowWall(walls, 'w5', 2)).toMatchObject({ kind: 'outside', planAngle: 270 });
  });

  it('a room with an inner wall: a window in it is an inside one, the outer walls still look out', () => {
    const walls = wallsOf(...rectangle(), wall('inner', { x: 0, y: -1.5 }, { x: 0, y: 1.5 }));
    expect(windowWall(walls, 'inner', 1.5)).toEqual({ kind: 'inside' });
    expect(windowWall(walls, 'bottom', 1)).toMatchObject({ kind: 'outside', planAngle: 180 });
  });

  /** Walls round a closed run of corners, each from one corner to the next. */
  const around = (prefix: string, corners: readonly Point[]) => corners.map((p, i) => wall(`${prefix}${String(i)}`, p, corners[(i + 1) % corners.length] as Point));

  it('a U-shaped room: a window looking across the notch at the other wing is outside (round 2)', () => {
    // (0,0)→(2,0)→(2,2)→(4,2)→(4,0)→(6,0)→(6,4)→(0,4): the notch is open at the top, between the wings.
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ];
    const walls = wallsOf(...around('u', corners));
    // The window in (2,0)→(2,2), 1 m along: right it crosses the other wing's two walls (even, outside); left, the room's
    // far wall (odd, inside). Outside, facing E with north up the plan.
    const side = windowWall(walls, 'u1', 1);
    expect(side).toMatchObject({ kind: 'outside', outward: { x: 1, y: 0 }, planAngle: 90 });
    expect(compassPointOf(side?.kind === 'outside' ? side.planAngle : -1)).toBe('E');
    // The far wing's inner wall (4,2)→(4,0) looks back across the notch: facing W.
    expect(windowWall(walls, 'u3', 1)).toMatchObject({ kind: 'outside', planAngle: 270 });
    // The notch's floor (2,2)→(4,2) looks up out of the notch, as before.
    expect(windowWall(walls, 'u2', 1)).toMatchObject({ kind: 'outside', planAngle: 0 });
  });

  it('a courtyard room: a window in the courtyard’s wall looks into the courtyard', () => {
    const outer = around('o', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const court = around('c', [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ]);
    const walls = wallsOf(...outer, ...court);
    // (4,4)→(6,4): up it crosses the outer top wall (odd, the room); down the courtyard's far wall and the outer bottom
    // wall (even): outside, into the courtyard, facing S.
    expect(windowWall(walls, 'c0', 1)).toMatchObject({ kind: 'outside', planAngle: 180 });
    expect(windowWall(walls, 'c1', 1)).toMatchObject({ kind: 'outside', planAngle: 270 });
    // The outer walls still look out of the building.
    expect(windowWall(walls, 'o0', 5)).toMatchObject({ kind: 'outside', planAngle: 0 });
  });

  it('a free-standing inner wall parallel to the window’s wall changes nothing: its outside side is clear', () => {
    // A free wall across the middle of the room, parallel to the bottom wall: the window's room side now crosses two walls
    // (the free one and the top one), its outside none. A side with no crossing is outside, so the parity never comes in.
    const walls = wallsOf(...rectangle(), wall('free', { x: -1, y: 0 }, { x: 1, y: 0 }));
    expect(windowWall(walls, 'bottom', 2)).toMatchObject({ kind: 'outside', planAngle: 180 });
    // A window in the free wall itself crosses one wall either way: an inside one.
    expect(windowWall(walls, 'free', 1)).toEqual({ kind: 'inside' });
  });

  it('both sides crossing an even number of walls: it can’t tell', () => {
    // A wall standing in the gap between two closed rooms: two walls of a room on each side.
    const left = around('l', [
      { x: -6, y: -1 },
      { x: -2, y: -1 },
      { x: -2, y: 1 },
      { x: -6, y: 1 },
    ]);
    const right = around('r', [
      { x: 2, y: -1 },
      { x: 6, y: -1 },
      { x: 6, y: 1 },
      { x: 2, y: 1 },
    ]);
    const walls = wallsOf(...left, ...right, wall('gap', { x: 0, y: -1 }, { x: 0, y: 1 }));
    expect(windowWall(walls, 'gap', 1)).toEqual({ kind: 'unknown' });
  });

  it('a ray through the corner where two walls meet crosses once', () => {
    // A diamond: the window's ray runs straight through its far corner.
    const walls = wallsOf(
      ...around('d', [
        { x: 0, y: -2 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        { x: -2, y: 0 },
      ]),
      wall('mid', { x: -1, y: 0 }, { x: 1, y: 0 }),
    );
    // From the middle of the inner wall, up through the top corner (0,-2) and down through the bottom one (0,2): one each,
    // so an inside wall, as a partition is.
    expect(windowWall(walls, 'mid', 1)).toEqual({ kind: 'inside' });
  });

  it('a wall standing alone, or a room not closed yet: it can’t tell', () => {
    expect(windowWall(wallsOf(wall('alone', { x: 0, y: 0 }, { x: 4, y: 0 })), 'alone', 2)).toEqual({ kind: 'unclosed' });
    // Two walls of a room only: across from each other, each sees the other one way and nothing the other.
    const open = wallsOf(wall('top', { x: -2, y: -1.5 }, { x: 2, y: -1.5 }), wall('bottom', { x: 2, y: 1.5 }, { x: -2, y: 1.5 }));
    expect(windowWall(open, 'bottom', 2)).toMatchObject({ kind: 'outside', planAngle: 180 });
    const corner = wallsOf(wall('top', { x: -2, y: -1.5 }, { x: 2, y: -1.5 }), wall('right', { x: 2, y: -1.5 }, { x: 2, y: 1.5 }));
    expect(windowWall(corner, 'top', 2)).toEqual({ kind: 'unclosed' });
    // A wall that isn't among them.
    expect(windowWall(open, 'gone', 1)).toBeNull();
  });

  it('a turned room faces as it is turned', () => {
    const walls = wallsOf(...rectangle(30));
    const bottom = windowWall(walls, 'bottom', 2);
    expect(bottom?.kind).toBe('outside');
    expect(bottom?.kind === 'outside' ? bottom.planAngle : null).toBeCloseTo(210, 6);
  });

  it('names the eight points of a bearing', () => {
    expect([0, 22, 23, 90, 135, 180, 210, 250, 270, 315, 338, 359.9].map(compassPointOf)).toEqual(['N', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'W', 'NW', 'N', 'N']);
  });
});

/** Fort Tryon Park, New York, as Google Maps copies it. */
const INWOOD = { latitude: 40.8677, longitude: -73.9212, zone: 'America/New_York' };
/** Tromsø, Norway: the midnight sun in June. */
const TROMSO = { latitude: 69.6492, longitude: 18.9553, zone: 'Europe/Oslo' };
const MINUTE = 60_000;

/** Whether SunCalc puts the sun up and in front of glass facing `facing` at an instant. */
const litAt = (ms: number, place: { latitude: number; longitude: number }, facing: number): boolean => {
  const p = getPosition(new Date(ms), place.latitude, place.longitude);
  const bearing = ((p.azimuth % 360) + 360) % 360;
  const d = Math.abs(bearing - facing) % 360;
  return trueAltitude(p.altitude) > -0.833 && Math.min(d, 360 - d) < 90;
};

/** Each stretch's ends are where SunCalc's sun crosses into and out of the glass's front, within the 5-minute rounding. */
function checkEnds(hours: readonly DirectSun[], place: { latitude: number; longitude: number }, facing: number, dayStart: number, dayEnd: number) {
  for (const h of hours) {
    expect(h.start.getTime() % (5 * MINUTE)).toBe(0);
    expect(h.end.getTime() % (5 * MINUTE)).toBe(0);
    if (h.start.getTime() > dayStart) {
      expect(litAt(h.start.getTime() - 3 * MINUTE, place, facing)).toBe(false);
      expect(litAt(h.start.getTime() + 3 * MINUTE, place, facing)).toBe(true);
    }
    if (h.end.getTime() < dayEnd) {
      expect(litAt(h.end.getTime() - 3 * MINUTE, place, facing)).toBe(true);
      expect(litAt(h.end.getTime() + 3 * MINUTE, place, facing)).toBe(false);
    }
  }
}

const dayOf = (date: string, offset: string) => {
  const start = Date.parse(`${date}T00:00:00${offset}`);
  return [start, start + 24 * 60 * MINUTE] as const;
};

describe('the hours direct sun comes through (6.5.6)', () => {
  it('a south-facing window at Inwood, on June 21: one stretch, mid-morning to late afternoon', () => {
    const hours = directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180) ?? [];
    expect(hours).toHaveLength(1);
    const [h] = hours;
    // The sun crosses due east a little before 09:00 there then (EDT), and due west at about 16:58.
    expect(h?.from).toMatch(/^(08|09):[0-5]\d$/);
    expect(h?.to).toMatch(/^(16|17):[0-5]\d$/);
    checkEnds(hours, INWOOD, 180, ...dayOf('2026-06-21', '-04:00'));
  });

  it('a south-facing window on December 21: sunrise to sunset', () => {
    const hours = directSun('2026-12-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180) ?? [];
    expect(hours).toHaveLength(1);
    expect(hours[0]?.from).toMatch(/^07:[0-5]\d$/);
    expect(hours[0]?.to).toMatch(/^16:[0-5]\d$/);
    checkEnds(hours, INWOOD, 180, ...dayOf('2026-12-21', '-05:00'));
  });

  it('a north-facing window on June 21: early morning and evening, two stretches', () => {
    const hours = directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 0) ?? [];
    expect(hours).toHaveLength(2);
    expect(hours[0]?.from).toMatch(/^05:[0-5]\d$/);
    expect(hours[0]?.to).toMatch(/^(08|09):[0-5]\d$/);
    expect(hours[1]?.from).toMatch(/^(16|17):[0-5]\d$/);
    // The two meet the south window's one end to end: the sun leaves one side of due east as it comes to the other.
    const south = directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180) ?? [];
    expect(hours[0]?.to).toBe(south[0]?.from);
    expect(hours[1]?.from).toBe(south[0]?.to);
    expect(hours[1]?.to).toMatch(/^20:[0-5]\d$/);
    checkEnds(hours, INWOOD, 0, ...dayOf('2026-06-21', '-04:00'));
  });

  it('a north-facing window on December 21: no direct sun', () => {
    expect(directSun('2026-12-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 0)).toEqual([]);
  });

  it('at Tromsø in the midnight sun: an east window has one long stretch, solar midnight to solar noon; a north one two', () => {
    // The sun never sets: it is due north at about 00:45 and due south at about 12:45 local time (CEST), so glass facing
    // east sees it the whole twelve hours between, one stretch. A north window sees it either side of midnight: two,
    // one from the day's start and one to its end.
    const east = directSun('2026-06-21', TROMSO.latitude, TROMSO.longitude, TROMSO.zone, 90) ?? [];
    expect(east).toHaveLength(1);
    expect(east[0]?.from).toMatch(/^0[01]:[0-5]\d$/);
    expect(east[0]?.to).toMatch(/^1[23]:[0-5]\d$/);
    const [start, end] = dayOf('2026-06-21', '+02:00');
    checkEnds(east, TROMSO, 90, start, end);
    const north = directSun('2026-06-21', TROMSO.latitude, TROMSO.longitude, TROMSO.zone, 0) ?? [];
    expect(north).toHaveLength(2);
    expect(north[0]?.from).toBe('00:00');
    expect(north[0]?.to).toMatch(/^0[67]:[0-5]\d$/);
    expect(north[1]?.from).toMatch(/^1[89]:[0-5]\d$/);
    // Its morning ends as the sun passes due east, 90° from north: when a south window's sun begins.
    expect(north[0]?.to).toBe(directSun('2026-06-21', TROMSO.latitude, TROMSO.longitude, TROMSO.zone, 180)?.[0]?.from);
    expect(north[1]?.to).toBe('24:00');
    checkEnds(north, TROMSO, 0, start, end);
  });

  it('on the days the clocks change (23 and 25 hours), each end is right on the wall clock', () => {
    const clock = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: INWOOD.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    for (const [date, start, end] of [
      // 8 March 2026: 02:00 EST becomes 03:00 EDT, a 23-hour day.
      ['2026-03-08', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00'],
      // 1 November 2026: 02:00 EDT becomes 01:00 EST, a 25-hour day.
      ['2026-11-01', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'],
    ] as const) {
      const dayStart = Date.parse(start);
      const dayEnd = Date.parse(end);
      for (const facing of [90, 180, 270]) {
        const hours = directSun(date, INWOOD.latitude, INWOOD.longitude, INWOOD.zone, facing) ?? [];
        expect(hours.length, `${date} facing ${String(facing)}`).toBeGreaterThan(0);
        for (const h of hours) {
          expect(h.from).toBe(clock(h.start));
          expect(h.to).toBe(clock(h.end));
          expect(h.start.getTime()).toBeGreaterThanOrEqual(dayStart);
          expect(h.end.getTime()).toBeLessThanOrEqual(dayEnd);
        }
        checkEnds(hours, INWOOD, facing, dayStart, dayEnd);
      }
      // Glass facing south sees the sun from sunrise to sunset these days (it rises a little south of east in March and
      // November): the stretch is the call sheet's sunrise and sunset, within the rounding, on the day's own clock.
      const [south] = directSun(date, INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180) ?? [];
      const day = sunTimes(date, INWOOD.latitude, INWOOD.longitude, INWOOD.zone);
      const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
      expect(Math.abs(minutes(south?.from ?? '') - minutes(day?.sunrise ?? ''))).toBeLessThanOrEqual(3);
      expect(Math.abs(minutes(south?.to ?? '') - minutes(day?.sunset ?? ''))).toBeLessThanOrEqual(3);
    }
  });

  it('reads nothing for a date or zone it can’t read; the sun’s height only when asked', () => {
    expect(directSun('2026-13-40', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180)).toBeNull();
    expect(directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, 'Not/AZone', 180)).toBeNull();
    expect(directSun('2026-06-21', 91, INWOOD.longitude, INWOOD.zone, 180)).toBeNull();
    // Why, truthfully: the date, the zone or the place, as the sun path says them.
    expect(unreadable('2026-13-40', INWOOD.latitude, INWOOD.longitude, INWOOD.zone)).toBe('noDate');
    expect(unreadable('2026-06-21', INWOOD.latitude, INWOOD.longitude, 'Not/AZone')).toBe('noZone');
    expect(unreadable('2026-06-21', 91, INWOOD.longitude, INWOOD.zone)).toBe('noPlace');
    expect(directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180)?.[0]?.altitude).toBeUndefined();
    const high = directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180, true)?.[0]?.altitude;
    expect(high?.min).toBeGreaterThan(30);
    // The sun's noon height there on the solstice: 90 − 40.87 + 23.44.
    expect(high?.max).toBeCloseTo(72.6, 0);
  });
});

const box = { x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0 };
const OWN = { own_latitude: INWOOD.latitude, own_longitude: INWOOD.longitude, own_date: '2026-06-21' };
const zones = new Map<string, string | null>([['sun', INWOOD.zone]]);
const view = { sceneId: 's1', setupId: 'u1' };

/** Scene 1 in a closed room with north up the plan; Setup 1's sun path with its own place and date; a window in the bottom wall. */
const project = (extra: SbdRecord[] = []): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 0 }),
    ...rectangle(),
    record('win', 'plan_item', 'room', { kind: 'window', wall_id: 'bottom', along_m: 2, width_m: 1.2 }),
    record('s1', 'scene', 'p', { number: '1', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, time: '12:00', ...OWN }),
    ...extra,
  );
const patched = (records: Records, id: string, props: Props): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: { ...was.props, ...props } } };
};
const without = (records: Records, id: string): Records => Object.fromEntries(Object.entries(records).filter(([key]) => key !== id));

describe('a window’s sun in a view (6.5.6)', () => {
  it('a window in the south wall: facing S, its hours from the sun path’s own place and date', () => {
    const sun = windowSunOf(project(), view, 'win', zones);
    expect(sun).toMatchObject({ wall: 'outside', facing: { bearing: 180, point: 'S' }, missing: null, zone: INWOOD.zone, date: { source: 'own', date: '2026-06-21' } });
    expect(sun?.hours).toEqual(directSun('2026-06-21', INWOOD.latitude, INWOOD.longitude, INWOOD.zone, 180));
    expect(sun?.heights).toEqual({ kind: 'window', heightM: null, heightFromGlass: false, sillM: null, topM: null });
  });

  it('a turned north turns the facing; moved to the north wall, the hours change', () => {
    const east = windowSunOf(patched(project(), 'north', { rotation: 90 }), view, 'win', zones);
    // North points right on the plan, so east is down it: the window in the bottom wall faces east (180° − 90°).
    expect(east?.facing).toEqual({ bearing: 90, point: 'E' });
    const moved = windowSunOf(patched(project(), 'win', { wall_id: 'top' }), view, 'win', zones);
    expect(moved?.facing).toEqual({ bearing: 0, point: 'N' });
    expect(moved?.hours).toHaveLength(2);
    expect(moved?.hours).not.toEqual(windowSunOf(project(), view, 'win', zones)?.hours);
  });

  it('a window in an inner wall is an inside one; a room not closed can’t tell; neither has hours', () => {
    const inner = project([wall('inner', { x: 0, y: -1.5 }, { x: 0, y: 1.5 }), record('win2', 'plan_item', 'room', { kind: 'window', wall_id: 'inner', along_m: 1.5, width_m: 1 })]);
    expect(windowSunOf(inner, view, 'win2', zones)).toMatchObject({ wall: 'inside', missing: 'insideWall', facing: null, hours: null });
    // A side wall gone: the top wall still closes the window's inner side.
    expect(windowSunOf(without(project(), 'left'), view, 'win', zones)).toMatchObject({ wall: 'outside' });
    // The wall across from it gone: nothing either side of it.
    expect(windowSunOf(without(project(), 'top'), view, 'win', zones)).toMatchObject({ wall: 'unclosed', missing: 'unclosed', hours: null });
  });

  it('no north, no place, no date, no sun path: says which and gives no hours', () => {
    expect(windowSunOf(without(project(), 'north'), view, 'win', zones)).toMatchObject({ wall: 'outside', facing: null, missing: 'noNorth', hours: null });
    const noPlace = patched(project(), 'sun', { own_latitude: 'none' });
    expect(windowSunOf(noPlace, view, 'win', zones)).toMatchObject({ facing: { point: 'S' }, hours: null });
    expect(windowSunOf(noPlace, view, 'win', zones)?.missing).not.toBeNull();
    const noDate = patched(project(), 'sun', { own_date: '' });
    expect(windowSunOf(noDate, view, 'win', zones)?.missing).not.toBeNull();
    expect(windowSunOf(noDate, view, 'win', zones)?.hours).toBeNull();
    expect(windowSunOf(without(project(), 'sun'), view, 'win', zones)).toMatchObject({ missing: 'noSunPath', hours: null });
    // No setup picked: a sun path goes in a setup, said as that, not "no sun path in this setup".
    expect(windowSunOf(project(), { sceneId: 's1', setupId: null }, 'win', zones)).toMatchObject({ missing: 'noSetup', hours: null });
    // No zone answer yet: nothing said.
    expect(windowSunOf(project(), view, 'win', new Map())).toMatchObject({ missing: null, pending: true, hours: null });
  });

  it('a sill and top add the sun’s height range, never changing the hours', () => {
    const plain = windowSunOf(project(), view, 'win', zones);
    const tall = windowSunOf(patched(project(), 'win', { sill_height_m: 0.9, top_height_m: 2.1 }), view, 'win', zones);
    expect(tall?.heights).toMatchObject({ sillM: 0.9, topM: 2.1 });
    expect(tall?.hours?.map((h) => [h.from, h.to])).toEqual(plain?.hours?.map((h) => [h.from, h.to]));
    expect(tall?.hours?.[0]?.altitude?.max).toBeGreaterThan(70);
    expect(plain?.hours?.[0]?.altitude).toBeUndefined();
  });

  it('is worked out once per records, view and zone answer', () => {
    const records = project();
    const before = windowSunsMade();
    const first = windowSunsOf(records, view, zones);
    expect(windowSunsOf(records, view, zones)).toBe(first);
    expect(windowSunsMade()).toBe(before + 1);
    expect(first.map((w) => w.windowId)).toEqual(['win']);
  });
});
