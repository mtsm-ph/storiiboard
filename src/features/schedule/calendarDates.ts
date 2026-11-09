// Calendar arithmetic on YYYY-MM-DD dates (3.8), done at noon UTC so no time zone or daylight saving change ever moves
// a date by a day. A week starts on the day the region says, or Settings sets (src/app/weekStart.ts: 0 Sunday … 6 Saturday).

const at = (date: string): Date => new Date(`${date}T12:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = at(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The first of the month `months` from the month `date` is in. */
export function addMonths(date: string, months: number): string {
  const d = at(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return iso(d);
}

export const monthOf = (date: string): string => date.slice(0, 7);

/** The first day of the week `date` is in. */
export function weekStart(date: string, firstDay: number): string {
  const day = at(date).getUTCDay();
  return addDays(date, -((day - firstDay + 7) % 7));
}

/** The week `date` is in, seven dates. */
export function weekOf(date: string, firstDay: number): string[] {
  const start = weekStart(date, firstDay);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The month `date` is in, as whole weeks: the days before and after it that fill its first and last weeks too. */
export function monthGrid(date: string, firstDay: number): string[][] {
  const month = monthOf(date);
  const weeks: string[][] = [];
  // From the week holding the 1st, until a week starts after the month.
  for (let start = weekStart(`${month}-01`, firstDay); monthOf(start) <= month; start = addDays(start, 7)) {
    weeks.push(weekOf(start, firstDay));
  }
  return weeks;
}

/** Today on this computer, as YYYY-MM-DD. */
export function todayDate(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
