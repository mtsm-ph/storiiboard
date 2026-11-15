import { dayTotals, setupMinutes } from '../model/shootDay';
import { wallInstant } from '../model/sunTimes';
import { DAY_MINUTES, minutesOf } from './clock';
import type { CheckContext } from './context';

// The day's working hours as instants (ms). The crew call and wrap are typed as one wall clock, the sheet's "Times in"
// zone (the first location's), so they are turned into instants once, there; each location's sun and forecast are
// then compared as instants, whatever zone that location is in.

/** The date `days` after (or before) a YYYY-MM-DD, read at noon UTC so no zone moves it. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * Crew call to wrap. A wrap before the call is after midnight; a wrap equal to the call is no wrap. With no wrap, when
 * `estimate` is set the hours run the day's estimate (3.7's totals) from the call; otherwise there are no hours. Null
 * without a date, a crew call or a zone to read them in.
 */
export function workingHours(ctx: CheckContext, estimate: boolean): { start: number; end: number } | null {
  const { sheet } = ctx;
  const { date, callTime, wrapTime } = sheet.day.fields;
  const zone = sheet.timesIn?.zone;
  const call = minutesOf(callTime);
  if (!zone || date === '' || call === null) return null;
  const start = wallInstant(date, Math.floor(call / 60), call % 60, zone)?.getTime();
  if (start === undefined) return null;
  const wrap = minutesOf(wrapTime);
  let end: number | undefined;
  if (wrap !== null && wrap !== call) {
    // The wrap as its own wall clock reading, on the next date when it is earlier than the call: a clock change in
    // between (the night clocks go back or forward) then counts, which adding the difference in minutes would not.
    end = wallInstant(wrap > call ? date : shiftDate(date, 1), Math.floor(wrap / 60), wrap % 60, zone)?.getTime();
  } else if (estimate) {
    end = start + dayTotals(ctx.records, ctx.frames, setupMinutes(ctx.records[ctx.projectId]?.props)).minutes * 60_000;
  }
  if (end === undefined) return null;
  return { start, end };
}
