import type { SheetLocation } from '../model/callsheet';
import type { DayNight } from '../model/storyboard';
import { sunTimes, wallInstant, type SunBand, type SunRange } from '../model/sunTimes';
import { minutesOf } from './clock';
import type { CheckContext } from './context';
import { shiftDate, workingHours } from './hours';

// Check 4 (4.8): a scene written for the light at the edges of the day (DAWN, DUSK, MAGIC HOUR) on a day whose working
// hours miss that light at the scene's location. A scene has no time of its own in the data, so the day's hours (crew
// call to wrap; without a wrap, the call plus the day's estimate) stand in for it: the finding says "today's hours
// miss golden and blue hour", not "at the time it is shot". Without a place, a date or a crew call there is no sun or
// no hours: no finding. Hours that run past midnight also meet the next morning's light.

const EDGE_OF_DAY: readonly DayNight[] = ['DAWN', 'DUSK', 'MAGIC HOUR'];

export interface GoldenHourMidday {
  kind: 'golden-hour-midday';
  dayId: string;
  sceneId: string;
  locationId: string;
  dayNight: DayNight;
  /** The location's golden hour on the day's date, morning then evening (a time on another date has next or prev set). */
  golden: SunRange[];
}

const ranges = (band: SunBand): SunRange[] => [band.morning, band.whole, band.evening].flatMap((r) => r ?? []);

/** A sun range as instants: its HH:MM on the date it falls on (the next or previous one when flagged), in the place's zone. */
function instants(range: SunRange, date: string, zone: string): { start: number; end: number } | null {
  const at = (time: string, next: boolean, prev: boolean): number | null => {
    const minutes = minutesOf(time);
    return minutes === null ? null : (wallInstant(shiftDate(date, next ? 1 : prev ? -1 : 0), Math.floor(minutes / 60), minutes % 60, zone)?.getTime() ?? null);
  };
  const start = at(range.start, range.startNext, range.startPrev);
  const end = at(range.end, range.endNext, range.endPrev);
  if (start === null || end === null) return null;
  return { start, end: end < start ? end + 24 * 3_600_000 : end };
}

/** Whether the hours meet golden or blue hour at a place, on the dates they touch. */
function meetsLight(location: SheetLocation, date: string, hours: { start: number; end: number }): boolean {
  const { place, zone } = location;
  if (!place || !zone) return false;
  return [-1, 0, 1].some((shift) => {
    const day = shiftDate(date, shift);
    const dayStart = wallInstant(day, 0, 0, zone.zone)?.getTime();
    const dayEnd = wallInstant(shiftDate(day, 1), 0, 0, zone.zone)?.getTime();
    if (dayStart === undefined || dayEnd === undefined || dayStart > hours.end || dayEnd < hours.start) return false;
    const sun = sunTimes(day, place.latitude, place.longitude, zone.zone);
    if (!sun) return false;
    // The sun staying inside a band all day is light all day.
    if (sun.golden.allDay || sun.blue.allDay) return true;
    return [...ranges(sun.golden), ...ranges(sun.blue)].some((range) => {
      const when = instants(range, day, zone.zone);
      return when !== null && when.start <= hours.end && when.end >= hours.start;
    });
  });
}

export function goldenHourMidday(ctx: CheckContext): GoldenHourMidday[] {
  const { sheet } = ctx;
  const hours = workingHours(ctx, true);
  if (hours === null) return [];
  return sheet.scenes.flatMap(({ record, fields, locationIds }): GoldenHourMidday[] => {
    if (fields.dayNight === null || !EDGE_OF_DAY.includes(fields.dayNight)) return [];
    const places = locationIds.flatMap((id) => sheet.locations.filter((l) => l.record.id === id && l.sun !== null));
    // The scene's frames may be at several places: it is fine when the hours catch the light at any of them.
    const first = places[0];
    if (!first?.sun) return [];
    if (places.some((place) => meetsLight(place, sheet.day.fields.date, hours))) return [];
    return [{ kind: 'golden-hour-midday', dayId: sheet.day.record.id, sceneId: record.id, locationId: first.record.id, dayNight: fields.dayNight, golden: ranges(first.sun.golden) }];
  });
}
