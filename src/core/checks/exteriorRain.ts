import type { MessageKey } from '../i18n';
import { dayWeather, precipitationBetween, type Forecast } from '../net/weather';
import { wallInstant, zoneClock } from '../model/sunTimes';
import type { CheckContext } from './context';
import { shiftDate, workingHours } from './hours';

// Check 5 (4.8): an exterior scene on a day when the forecast already held for its location says rain during the day's
// hours (crew call to wrap, else the whole day), or rain, thunder, sleet or snow at the call. A check never fetches:
// the forecasts are an argument (the app passes the ones it holds; the MCP passes none until it has its own), so a
// location without one has no finding. The limit is metric, 1 mm; the US units shown (0.04 in) are the same amount.
// Light rain alone at the call isn't wet enough; a millimetre or more in the hours still counts.

/** Rain that matters on a shoot: a millimetre or more in the day's hours. */
export const RAIN_MM = 1;

const WET: readonly MessageKey[] = ['weather.rain', 'weather.heavyRain', 'weather.thunder', 'weather.sleet', 'weather.snow'];

/** Forecasts held, by location id. */
export type HeldForecasts = ReadonlyMap<string, Forecast>;

export interface ExteriorRain {
  kind: 'exterior-rain';
  dayId: string;
  sceneId: string;
  locationId: string;
  /** Why: enough precipitation in the hours, or a wet condition at the call. */
  cause: 'precipitation' | 'conditions';
  /** Precipitation in the hours in mm, when the forecast covers them. */
  mm: number | null;
  /** The condition at the call, when that is the cause. */
  conditions: MessageKey | null;
}

export function exteriorRain(ctx: CheckContext, forecasts: HeldForecasts): ExteriorRain[] {
  const { sheet } = ctx;
  const { date } = sheet.day.fields;
  if (date === '') return [];
  // Crew call to wrap as instants; none without both (then the whole day, in each location's own zone).
  const hours = workingHours(ctx, false);
  const callAt = workingHours(ctx, true)?.start ?? null;
  return sheet.scenes.flatMap(({ record, fields, locationIds }): ExteriorRain[] => {
    if (fields.intExt !== 'EXT' && fields.intExt !== 'INT/EXT') return [];
    for (const id of locationIds) {
      const location = sheet.locations.find((l) => l.record.id === id);
      const forecast = forecasts.get(id);
      if (!location?.zone || !forecast) continue;
      const zone = location.zone.zone;
      const from = hours ? hours.start : wallInstant(date, 0, 0, zone)?.getTime();
      const to = hours ? hours.end : wallInstant(shiftDate(date, 1), 0, 0, zone)?.getTime();
      if (from === undefined || to === undefined) continue;
      const mm = precipitationBetween(forecast.entries, from, to);
      const base = { kind: 'exterior-rain' as const, dayId: sheet.day.record.id, sceneId: record.id, locationId: id };
      if (mm !== null && mm >= RAIN_MM) return [{ ...base, cause: 'precipitation', mm, conditions: null }];
      // The call is a wall clock in the sheet's zone; the conditions are read at that moment where the location is.
      const clock = callAt === null ? null : zoneClock(new Date(callAt), zone);
      if (clock && clock.date === date) {
        const at = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
        const weather = dayWeather(forecast.entries, date, zone, at);
        if (weather.state === 'summary' && weather.conditions !== null && WET.includes(weather.conditions)) {
          return [{ ...base, cause: 'conditions', mm, conditions: weather.conditions }];
        }
      }
    }
    return [];
  });
}
