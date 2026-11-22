import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useProject } from '../../app/projectStore';
import { useFirstDay } from '../../app/weekStart';
import { formatDate, t, tn } from '../../core/i18n';
import { stretchLabel } from '../../core/model/availability';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { ROLE_LABELS } from '../../core/model/role';
import type { SbdRecord } from '../../core/model/record';
import { dayCrew, dayLocations, dayScenes } from '../../core/model/schedule';
import { dayDateLabel, dayFrames, dayLabel, dayTotals, projectShootDays, setupMinutes, type ShootDay } from '../../core/model/shootDay';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import { Button, IconButton } from '../../ui/Button';
import { useScrollLane } from '../../ui/scrollLane';
import { cx } from '../../ui/cx';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { addDays, addMonths, monthGrid, monthOf, todayDate, weekOf } from './calendarDates';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { openDayHistory } from '../history/historyDay';
import { awayShown, type AwayPerson } from './calendarAway';

// The Calendar tile (3.8), in the Production workspace's default layout: the shoot days by month or by week, and the
// shoot schedule under it. Picking a date narrows the schedule to that date; Show all days widens it again. Each day in
// the schedule says its scenes, the locations it's at and whether each is booked, and how many of the crew have
// confirmed (set in the Shoot days tile). Read from the records, never stored. Unavailable dates (7.3, typed in Cast
// and crew) mark a date with how many are away (on a shoot date, of the people on it), by a sign and words, never by
// colour, and a picked date lists who. The grid is one Tab stop: the arrows move a day or a week, Enter or a click picks.

type Records = Readonly<Record<string, SbdRecord>>;
type View = 'month' | 'week';

/** A shoot day's chip on its date: its number, and in the week its call time. */
const chipText = (day: ShootDay, view: View): string =>
  view === 'week' && day.fields.callTime ? t('calendar.chipWithCall', { number: day.number, time: day.fields.callTime }) : t('shootDay.label', { number: day.number });

/** The same day of the month a month away, or the month's last when it hasn't one (January 31 to February 28). */
function sameDayIn(date: string, months: number): string {
  const first = addMonths(date, months);
  const day = Number(date.slice(8));
  const last = Number(addDays(addMonths(first, 1), -1).slice(8));
  return `${first.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

const at = (date: string) => new Date(`${date}T12:00:00Z`);
const format = (date: string, options: Intl.DateTimeFormatOptions) => formatDate(at(date), { ...options, timeZone: 'UTC' });

/** "Nov 15 – Nov 21, 2026", the year on both ends when the week crosses into the next. */
function weekTitle(from: string, to: string): string {
  const year = from.slice(0, 4) !== to.slice(0, 4);
  return t('calendar.weekOf', {
    from: format(from, { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }),
    to: format(to, { month: 'short', day: 'numeric', year: 'numeric' }),
  });
}

export function CalendarTile() {
  const project = useProject((s) => s.project);
  // Keyed by project, so a date picked in one never narrows another's schedule.
  return project ? <Calendar key={project.projectId} projectId={project.projectId} /> : <p className="sb-label p-3 text-text-muted">{t('calendar.noProject')}</p>;
}

function Calendar({ projectId }: { projectId: string }) {
  const records = useProject((s) => s.records);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollLane(scroller);
  const [view, setView] = useState<View>('month');
  const today = todayDate();
  const [focus, setFocus] = useState(today);
  const [picked, setPicked] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const scheduleId = useId();
  // As this computer's region says, or as Settings → App sets it (3.17).
  const firstDay = useFirstDay();
  const days = projectShootDays(records, projectId);
  const byDate = new Map<string, ShootDay[]>();
  for (const day of days) {
    if (!day.fields.date) continue;
    byDate.set(day.fields.date, [...(byDate.get(day.fields.date) ?? []), day]);
  }
  const weeks = view === 'month' ? monthGrid(focus, firstDay) : [weekOf(focus, firstDay)];
  const title =
    view === 'month'
      ? format(`${monthOf(focus)}-01`, { month: 'long', year: 'numeric' })
      : weekTitle(weeks[0]?.[0] ?? focus, weeks[0]?.[6] ?? focus);

  // The day the keys move focus to. It's focused as soon as the grid is drawn, before the browser takes the next key:
  // an arrow into another month draws another grid without the day pressed on, and a key pressed in a frame between
  // (a held arrow, three quick ones) would otherwise land on the page and be lost.
  const moving = useRef<string | null>(null);
  useLayoutEffect(() => {
    const date = moving.current;
    if (date === null) return;
    moving.current = null;
    grid.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  }, [focus]);
  const moveTo = (date: string) => {
    if (date === focus) {
      grid.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
      return;
    }
    moving.current = date;
    setFocus(date);
  };
  const onKeyDown = (event: KeyboardEvent, date: string) => {
    // As a date grid moves: a day, a week, the week's ends, a month.
    const week = weekOf(date, firstDay);
    const to: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => week[0] ?? date,
      End: () => week[6] ?? date,
      PageUp: () => sameDayIn(date, -1),
      PageDown: () => sameDayIn(date, 1),
    };
    const next = to[event.key];
    if (!next) return;
    event.preventDefault();
    moveTo(next());
  };
  const shift = (by: number) => {
    setFocus(view === 'month' ? addMonths(focus, by) : addDays(focus, by * 7));
  };
  const shown = picked ? days.filter((d) => d.fields.date === picked) : days;
  const awayPicked = picked ? awayShown(records, projectId, picked, byDate.get(picked) ?? []) : [];
  const minutes = setupMinutes(records[projectId]?.props);

  return (
    <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
        <SegmentedControl
          label={t('calendar.view')}
          options={[
            { value: 'month', label: t('calendar.month') },
            { value: 'week', label: t('calendar.week') },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="flex items-center gap-1">
          <IconButton label={t(view === 'month' ? 'calendar.previousMonth' : 'calendar.previousWeek')} onClick={() => { shift(-1); }} className="border border-text">
            <span aria-hidden="true" className="font-mono">‹</span>
          </IconButton>
          <IconButton label={t(view === 'month' ? 'calendar.nextMonth' : 'calendar.nextWeek')} onClick={() => { shift(1); }} className="border border-text">
            <span aria-hidden="true" className="font-mono">›</span>
          </IconButton>
          <Button onClick={() => { setFocus(today); }}>{t('calendar.today')}</Button>
        </div>
        {/* Said when it changes, so the arrows' and the buttons' moves to another month are heard. */}
        <h2 id={titleId} aria-live="polite" className="ml-auto text-[15px] font-bold">
          {title}
        </h2>
      </div>

      <div ref={grid} role="grid" aria-labelledby={titleId} className="flex flex-col p-2">
        <div role="row" className="grid grid-cols-7">
          {weeks[0]?.map((date) => (
            <span key={date} role="columnheader" className="sb-label px-1 pb-1 text-text-muted">
              {format(date, { weekday: 'short' })}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7">
            {week.map((date) => {
              const shoots = byDate.get(date) ?? [];
              const away = awayShown(records, projectId, date, shoots).length;
              const outside = view === 'month' && monthOf(date) !== monthOf(focus);
              const isPicked = date === picked;
              // Named by what it shows, so the name holds the visible text (WCAG 2.5.3): the date's number, then (for
              // a screen reader) the whole date and today, then each shoot day's chip as it reads.
              const said = [format(date, { weekday: 'long', month: 'long', day: 'numeric' }), ...(date === today ? [t('calendar.isToday')] : [])];
              const sep = t('list.separator');
              return (
                <span key={date} role="gridcell" aria-selected={isPicked} className="min-w-0">
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focus ? 0 : -1}
                    onFocus={() => {
                      setFocus(date);
                    }}
                    onKeyDown={(event) => {
                      onKeyDown(event, date);
                    }}
                    onClick={() => {
                      setPicked(isPicked ? null : date);
                    }}
                    // The picked date takes the ink fill, as a selection does; a shoot day shows its number on it.
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border border-border p-1 text-left focus-visible:-outline-offset-2',
                      'group',
                      view === 'month' ? 'min-h-16' : 'min-h-28',
                      isPicked ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span
                      className={cx(
                        'font-mono text-[12px]',
                        // Muted never sits on the oatmeal hover (DESIGN.md): ink there.
                        outside && !isPicked && 'text-text-muted group-hover:text-text',
                        date === today && 'font-bold underline underline-offset-2',
                      )}
                    >
                      {Number(date.slice(8))}
                    </span>
                    <span className="sr-only">{`${said.join(sep)}${shoots.length > 0 || away > 0 ? sep : ''}`}</span>
                    {/* The separator ends the words of the item before the next, in the same text (the date's words
                        above, a chip's here): the browser puts a space round every flex item and every sr-only span, so
                        a separator of its own would stand after a space ("Day 1 , 1 unavailable"). A chip followed by
                        another item is said by its own words and the separator, and shown by the words alone. */}
                    {shoots.map((d, i) => {
                      const chip = chipText(d, view);
                      return (
                        <span key={d.record.id} className="max-w-full truncate border border-current px-1 font-mono text-[10px]">
                          {i < shoots.length - 1 || away > 0 ? (
                            <>
                              <span aria-hidden="true">{chip}</span>
                              <span className="sr-only">{`${chip}${sep}`}</span>
                            </>
                          ) : (
                            chip
                          )}
                        </span>
                      );
                    })}
                    {/* A sign and a count, and words for a screen reader: never colour alone (DESIGN.md). */}
                    {away > 0 && (
                      <span data-away={away} className="max-w-full truncate font-mono text-[10px]">
                        <span aria-hidden="true">⊘ {away}</span>
                        <span className="sr-only">{tn('calendar.away', away)}</span>
                      </span>
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <section aria-labelledby={scheduleId} className="flex flex-col gap-1 p-2">
        <div className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-text pb-1">
          <h3 id={scheduleId} aria-live="polite" className="sb-label flex-1">
            {picked ? t('calendar.scheduleOn', { date: dayDateLabel(picked) }) : t('calendar.schedule')}
          </h3>
          {picked && (
            <Button
              variant="ghost"
              onClick={() => {
                setPicked(null);
              }}
            >
              {t('calendar.showAll')}
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="py-2 text-[13px] text-text-muted">{picked ? t('calendar.noShootThatDay') : t('calendar.noDays')}</p>
        ) : (
          <ul aria-labelledby={scheduleId}>
            {shown.map((day) => (
              <ScheduleRow key={day.record.id} day={day} records={records} projectId={projectId} minutes={minutes} />
            ))}
          </ul>
        )}
        {picked && awayPicked.length > 0 && <AwayList date={picked} people={awayPicked} />}
      </section>
    </div>
  );
}

/** Who is away on the picked date (7.3): name, what they do, and each stretch's dates and note. */
function AwayList({ date, people }: { date: string; people: readonly AwayPerson[] }) {
  const headingId = useId();
  return (
    <div data-away-list="" className="flex flex-col gap-1 pt-2">
      <h4 id={headingId} className="sb-label border-b-[1.5px] border-text pb-1">
        {t('calendar.awayOn', { date: dayDateLabel(date) })}
      </h4>
      <ul aria-labelledby={headingId}>
        {people.map(({ record, fields, stretches }) => {
          const [department] = fields.departments;
          const part = fields.role ? ROLE_LABELS[fields.role] : department ? DEPARTMENT_LABELS[department] : null;
          return (
            <li key={record.id} data-away-person={record.id} className="flex flex-col gap-0.5 border-b border-border py-1.5 text-[13px]">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span data-user-text="" className="font-bold">
                  {fields.name || t('people.unnamed')}
                </span>
                {part !== null && <span className="sb-label">{part}</span>}
              </p>
              {stretches.map((stretch) => (
                <p key={stretch.record.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[12px]">{stretchLabel(stretch.from, stretch.to, date)}</span>
                  {stretch.note !== '' && <span data-user-text="">{stretch.note}</span>}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScheduleRow({ day, records, projectId, minutes }: { day: ShootDay; records: Records; projectId: string; minutes: number }) {
  const scenes = dayScenes(records, projectId, day.record.id);
  const places = dayLocations(records, projectId, day.record.id);
  const crew = dayCrew(records, projectId, day.record);
  const sep = t('list.separator');
  const totals = dayTotals(records, dayFrames(records, projectId, day.record.id), minutes);
  const hours = [day.fields.callTime && t('days.callShort', { time: day.fields.callTime }), day.fields.wrapTime && t('calendar.wrapShort', { time: day.fields.wrapTime })].filter(Boolean);
  const workspaceId = useWorkspaceId();
  return (
    <li data-schedule-day={day.record.id} className="flex flex-col gap-0.5 border-b border-border py-2 text-[13px]">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-bold">{dayLabel(day)}</span>
        {hours.length > 0 && <span className="font-mono text-[12px]">{hours.join(' · ')}</span>}
        <span className="font-mono text-[12px]">{tn('days.frames', totals.frames)}</span>
        {/* The day's own history (Kevin, Nov 18), as from the day in Shoot days. */}
        <Button
          variant="ghost"
          className="ml-auto"
          aria-label={t('days.historyOf', { day: dayLabel(day) })}
          onClick={() => {
            openDayHistory(workspaceId, day.record.id);
          }}
        >
          {t('days.history')}
        </Button>
      </p>
      <p>
        <span className="sb-label">{t('calendar.scenes')} </span>
        {scenes.length === 0 ? (
          <span className="text-text-muted">{t('calendar.noScenes')}</span>
        ) : (
          <span className="font-mono">{scenes.map((s) => sceneLabel(sceneFields(s.props).number)).join(sep)}</span>
        )}
      </p>
      <p>
        <span className="sb-label">{t('calendar.locations')} </span>
        {places.length === 0 ? (
          <span className="text-text-muted">{t('calendar.noLocations')}</span>
        ) : (
          places.map((p, i) => (
            <span key={p.record.id}>
              {i > 0 && t('list.separator')}
              <span data-user-text="">{p.name || t('locations.unnamed')}</span> ({LOCATION_STATUS_LABEL[p.status]})
            </span>
          ))
        )}
      </p>
      <p>
        <span className="sb-label">{t('calendar.crew')} </span>
        {crew.people === 0 ? <span className="text-text-muted">{t('calendar.noCrew')}</span> : tn('calendar.confirmed', crew.confirmed, { people: crew.people })}
      </p>
    </li>
  );
}
