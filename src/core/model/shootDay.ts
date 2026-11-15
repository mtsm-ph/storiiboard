import { formatDate, t } from '../i18n';
import type { JsonValue, Props, SbdRecord } from './record';
import { shotFields } from './storyboard';

// Shoot days (3.7, docs/PHASE3_DECISIONS.md 8 and 9). A `shoot_day` record under the project is one day of the shoot:
// its date, call and wrap, and notes. A frame sits in at most one day, by its `shoot_day_id`; only "Need to shoot"
// frames are offered for a day, as in Kevin's Notion, since Have and Source frames aren't shot. A day's number ("Day
// 3") is its place among the live days by date, worked out, never stored, so moving a date renumbers the days. Totals
// are worked out too (CLAUDE.md: rollups are never stored): its frames, its setups, and hours from the project's
// minutes per setup.

type Records = Readonly<Record<string, SbdRecord>>;

export interface ShootDayFields {
  /** YYYY-MM-DD, or '' while it has none. */
  date: string;
  /** HH:MM on a 24-hour clock, or ''. */
  callTime: string;
  wrapTime: string;
  notes: string;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar date: read back the same, so February 30 (which a Date rolls on to March 2) isn't one. */
export const isDayDate = (value: string): boolean => {
  if (!DATE.test(value)) return false;
  const read = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(read.getTime()) && read.toISOString().slice(0, 10) === value;
};
export const isClockTime = (value: string): boolean => TIME.test(value);

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

export function shootDayFields(props: Props): ShootDayFields {
  const date = text(props.date);
  const call = text(props.call_time);
  const wrap = text(props.wrap_time);
  return {
    date: isDayDate(date) ? date : '',
    callTime: isClockTime(call) ? call : '',
    wrapTime: isClockTime(wrap) ? wrap : '',
    notes: text(props.notes),
  };
}

export interface ShootDay {
  record: SbdRecord;
  fields: ShootDayFields;
  /** 1 for the first day by date; days without a date come last, in the order made. */
  number: number;
}

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** The project's live shoot days, by date (undated last), each numbered. */
export function projectShootDays(records: Records, projectId: string): ShootDay[] {
  return Object.values(records)
    .filter((r) => r.type === 'shoot_day' && r.parentId === projectId && r.trashedAt === null)
    .map((record) => ({ record, fields: shootDayFields(record.props) }))
    .sort((a, b) => {
      if (a.fields.date !== b.fields.date) {
        if (a.fields.date === '') return 1;
        if (b.fields.date === '') return -1;
        return a.fields.date < b.fields.date ? -1 : 1;
      }
      return bySortKey(a.record, b.record);
    })
    .map((day, i) => ({ ...day, number: i + 1 }));
}

/** "Mon, Nov 16" in the app's language, or "" for no date. Read at noon UTC, so no time zone moves it a day. */
export function dayDateLabel(date: string): string {
  return isDayDate(date) ? formatDate(new Date(`${date}T12:00:00Z`), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
}

/** "Day 3 · Mon, Nov 16", or "Day 3" without a date. */
export function dayLabel(day: Pick<ShootDay, 'number' | 'fields'>): string {
  const date = dayDateLabel(day.fields.date);
  return date ? t('shootDay.labelDated', { number: day.number, date }) : t('shootDay.label', { number: day.number });
}

/** The live day a frame is in, or null: none set, or its day is in the Trash or gone. */
export function frameDayId(records: Records, shot: SbdRecord): string | null {
  const id = shot.props.shoot_day_id;
  const day = typeof id === 'string' ? records[id] : undefined;
  return day?.type === 'shoot_day' && day.trashedAt === null ? day.id : null;
}

/**
 * The frame's day as the Inspector's Shoot day row reads it (5.11): the day's id and "Day 2 · Tue, Nov 18", numbered
 * among the live days as the Shoot days tile and the Calendar number them. Null when the frame is in no live day of
 * this project: none set, its day in the Trash, or an id that names nothing.
 */
export function frameShootDay(records: Records, projectId: string, shot: SbdRecord): { id: string; label: string } | null {
  const id = frameDayId(records, shot);
  if (id === null) return null;
  const day = projectShootDays(records, projectId).find((d) => d.record.id === id);
  return day ? { id, label: dayLabel(day) } : null;
}

/** The project's live frames in live scenes, in board order, each with its scene. */
function boardFrames(records: Records, projectId: string): { scene: SbdRecord; shot: SbdRecord }[] {
  const scenes = Object.values(records)
    .filter((r) => r.type === 'scene' && r.parentId === projectId && r.trashedAt === null)
    .sort(bySortKey);
  const byScene = new Map<string, SbdRecord[]>();
  for (const r of Object.values(records)) {
    if (r.type !== 'shot' || r.trashedAt !== null || r.parentId === null) continue;
    const list = byScene.get(r.parentId) ?? [];
    list.push(r);
    byScene.set(r.parentId, list);
  }
  return scenes.flatMap((scene) => (byScene.get(scene.id) ?? []).sort(bySortKey).map((shot) => ({ scene, shot })));
}

/** A day's frames, in board order. */
export function dayFrames(records: Records, projectId: string, dayId: string): { scene: SbdRecord; shot: SbdRecord }[] {
  return boardFrames(records, projectId).filter(({ shot }) => frameDayId(records, shot) === dayId);
}

/** "Need to shoot" frames in no live day, in board order: what's left to schedule. */
export function unscheduledFrames(records: Records, projectId: string): { scene: SbdRecord; shot: SbdRecord }[] {
  return boardFrames(records, projectId).filter(({ shot }) => shotFields(shot.props).status === 'need' && frameDayId(records, shot) === null);
}

export const DEFAULT_SETUP_MINUTES = 30;
export const SETUP_MINUTES = { min: 1, max: 600 } as const;

/** The project's minutes per setup for a day's estimate (the `setup_minutes` prop), else 30. */
export function setupMinutes(projectProps: Props | undefined): number {
  const value = projectProps?.setup_minutes;
  return typeof value === 'number' && Number.isInteger(value) && value >= SETUP_MINUTES.min && value <= SETUP_MINUTES.max ? value : DEFAULT_SETUP_MINUTES;
}

export const DEFAULT_HMU_MINUTES = 45;
export const HMU_MINUTES = { min: 0, max: 600 } as const;

/** The least time HMU needs before a cast member's call (the `hmu_minutes` prop, 4.8), 0 to 600, else 45. */
export function hmuMinutes(projectProps: Props | undefined): number {
  const value = projectProps?.hmu_minutes;
  return typeof value === 'number' && Number.isInteger(value) && value >= HMU_MINUTES.min && value <= HMU_MINUTES.max ? value : DEFAULT_HMU_MINUTES;
}

export interface DayTotals {
  /** Frames still to shoot ("Need to shoot"): one marked Have or Source since it was put in the day isn't counted. */
  frames: number;
  /** Frames sharing a setup (`setup_id`, Phase 6's plans) count once; a frame without one is a setup of its own. */
  setups: number;
  /** Setups times the minutes per setup. */
  minutes: number;
}

export function dayTotals(frames: readonly { shot: SbdRecord }[], minutesPerSetup: number): DayTotals {
  const shared = new Set<string>();
  let alone = 0;
  const toShoot = frames.filter(({ shot }) => shotFields(shot.props).status === 'need');
  for (const { shot } of toShoot) {
    const setup = shot.props.setup_id;
    if (typeof setup === 'string' && setup !== '') shared.add(setup);
    else alone += 1;
  }
  const setups = shared.size + alone;
  return { frames: toShoot.length, setups, minutes: setups * minutesPerSetup };
}

/** "1 h 30 min", "45 min", "2 h": an estimate as a schedule reads it. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('shootDay.minutes', { minutes: rest });
  return rest === 0 ? t('shootDay.hours', { hours }) : t('shootDay.hoursMinutes', { hours, minutes: rest });
}
