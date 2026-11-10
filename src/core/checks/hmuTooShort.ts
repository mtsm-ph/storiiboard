import { hmuMinutes } from '../model/shootDay';
import { minutesAfter, minutesOf } from './clock';
import type { CheckContext } from './context';

// Check 3 (4.8): a cast member's HMU ready time is too soon after their call to be made up in, or comes after they are
// on set. The call is worked out as 4.2 does (their own, else their department's, else the day's crew call).

export interface HmuTooShort {
  kind: 'hmu-too-short';
  dayId: string;
  personId: string;
  /** `short`: under the project's minimum after the call; `after-on-set`: ready after they are due on set. */
  problem: 'short' | 'after-on-set';
  call: string;
  hmuReady: string;
  onSet: string;
  /** Minutes from the call to HMU ready (negative when it is before the call). */
  gap: number;
  /** The project's minimum, in minutes. */
  minimum: number;
}

export function hmuTooShort({ records, projectId, sheet }: CheckContext): HmuTooShort[] {
  const minimum = hmuMinutes(records[projectId]?.props);
  return sheet.cast.flatMap(({ person, times }) => {
    const call = minutesOf(times.call);
    const ready = minutesOf(times.hmuReady);
    if (call === null || ready === null) return [];
    const base = { dayId: sheet.day.record.id, personId: person.record.id, call: times.call, hmuReady: times.hmuReady, onSet: times.onSet, minimum };
    const gap = minutesAfter(call, ready);
    const onSet = minutesOf(times.onSet);
    const found: HmuTooShort[] = [];
    if (gap < minimum) found.push({ kind: 'hmu-too-short', ...base, problem: 'short', gap });
    if (onSet !== null && gap > minutesAfter(call, onSet)) found.push({ kind: 'hmu-too-short', ...base, problem: 'after-on-set', gap });
    return found;
  });
}
