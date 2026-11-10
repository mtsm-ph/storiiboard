// Clock arithmetic the call sheet checks share (4.8). Times on a sheet are HH:MM as typed, in the first location's
// zone; these turn them into minutes after midnight of the day's date so a night shoot can run past 24:00.

export const DAY_MINUTES = 1440;

/** Minutes after midnight for an HH:MM, or null for '' (or anything that isn't a time). */
export function minutesOf(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * How far `time` is after `from` in minutes, on a clock that wraps: a time earlier than `from` by more than 12 hours is
 * the next day's (a 23:30 call and a 00:15 on set are 45 minutes apart); one earlier by less is simply before.
 */
export function minutesAfter(from: number, time: number): number {
  const gap = time - from;
  return gap < -DAY_MINUTES / 2 ? gap + DAY_MINUTES : gap;
}
