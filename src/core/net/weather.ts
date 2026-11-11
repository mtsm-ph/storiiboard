import { getLocale, t, type MessageKey } from '../i18n';
import { dayDateLabel } from '../model/shootDay';
import type { JsonValue } from '../model/record';
import { wallInstant, zoneClock } from '../model/sunTimes';
import type { WeatherUnitsChoice } from '../storage/settings';

// The call sheet's forecast (4.4): MET Norway's Locationforecast as the desktop's Rust side reduces it
// (src-tauri/src/weather.rs), cached in the project (`lookups`, kind `weather`) with MET's metric values, and turned
// here into one day at a location, in that location's time zone. Pure: units are converted for display only.

/**
 * One moment of the forecast: UTC time, °C, m/s, and what MET says of the hour and of the six hours after it (mm of
 * precipitation, symbol code). A moment's span is the gap to the next one, so which of the two applies is worked out
 * in `dayWeather`, not here.
 */
export interface ForecastEntry {
  time: string;
  temperature: number | null;
  wind: number | null;
  rain1h: number | null;
  rain6h: number | null;
  symbol1h: string | null;
  symbol6h: string | null;
}

/** A forecast as cached: what the answer's `Expires` says, and the entries. */
export interface Forecast {
  /** ISO time after which the page may ask again. */
  expires: string;
  lastModified: string | null;
  entries: ForecastEntry[];
}

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SYMBOL = /^[a-z0-9_]{1,40}$/;
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const symbolOrNull = (value: unknown): string | null => (typeof value === 'string' && SYMBOL.test(value) ? value : null);

function entryFrom(value: unknown): ForecastEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.time !== 'string' || !MOMENT.test(v.time) || Number.isNaN(Date.parse(v.time))) return null;
  return {
    time: v.time,
    temperature: numberOrNull(v.temperature),
    wind: numberOrNull(v.wind),
    rain1h: numberOrNull(v.rain1h),
    rain6h: numberOrNull(v.rain6h),
    symbol1h: symbolOrNull(v.symbol1h),
    symbol6h: symbolOrNull(v.symbol6h),
  };
}

const isoOrNull = (value: unknown): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

/** The entries in a list, in time order and each checked again; null when it is not a list or nothing in it reads. */
function entriesFrom(value: unknown): ForecastEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.flatMap((entry) => entryFrom(entry) ?? []).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return entries.length > 0 ? entries : null;
}

/** What Rust answers with (`expires`, `lastModified`, `fetchedAt`, `notModified`, `forecast`), checked. */
export interface Answer {
  forecast: Forecast | null;
  expires: string;
  lastModified: string | null;
  fetchedAt: string;
  /** The renewal said nothing changed: the forecast already held stands, with this expiry. */
  notModified: boolean;
}

export function answerFrom(value: unknown): Answer | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const expires = isoOrNull(v.expires);
  const fetchedAt = isoOrNull(v.fetchedAt);
  if (!expires || !fetchedAt) return null;
  const lastModified = isoOrNull(v.lastModified);
  if (v.notModified === true) return { forecast: null, expires, lastModified, fetchedAt, notModified: true };
  const entries = entriesFrom(v.forecast);
  return entries ? { forecast: { expires, lastModified, entries }, expires, lastModified, fetchedAt, notModified: false } : null;
}

/** The cached result (`{ expires, last_modified, forecast }`) read back, checked again; null if it can't be read. */
export function cachedForecast(result: unknown): Forecast | null {
  if (typeof result !== 'object' || result === null) return null;
  const v = result as Record<string, unknown>;
  const expires = isoOrNull(v.expires);
  const entries = entriesFrom(v.forecast);
  return expires && entries ? { expires, lastModified: isoOrNull(v.last_modified), entries } : null;
}

/** What goes in `lookups.result`. */
export const forecastJson = (forecast: Forecast): JsonValue => ({
  expires: forecast.expires,
  last_modified: forecast.lastModified,
  forecast: forecast.entries.map((e) => ({
    time: e.time,
    temperature: e.temperature,
    wind: e.wind,
    rain1h: e.rain1h,
    rain6h: e.rain6h,
    symbol1h: e.symbol1h,
    symbol6h: e.symbol6h,
  })),
});

/** A coordinate cut to 4 decimals, half away from zero as Rust cuts it, so the key is the place that was asked. */
const cut = (n: number): string => ((Math.sign(n) * Math.round(Math.abs(n) * 10_000)) / 10_000 + 0).toFixed(4);

/** What a place is cached under: its coordinates cut to 4 decimals, as MET's terms and the Rust side cut them. */
export function weatherKey(latitude: number, longitude: number): string {
  return `${cut(latitude)},${cut(longitude)}`;
}

/** Whether a forecast may still be used without asking again (the answer's `Expires` not yet reached). */
export function isFresh(forecast: Pick<Forecast, 'expires'>, now: Date): boolean {
  return Date.parse(forecast.expires) > now.getTime();
}

// -- Words from MET's symbol codes ------------------------------------------------------------------------------------

/**
 * MET's symbol code as one of about ten words. The day, night and polar twilight variants of a code read the same;
 * showers read as their rain, sleet or snow; anything with thunder is thunder. A code this doesn't know has no words.
 */
export function conditionKey(symbol: string | null): MessageKey | null {
  if (!symbol) return null;
  const code = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (code.endsWith('andthunder')) return 'weather.thunder';
  const family = code.replace(/showers$/, '');
  switch (family) {
    case 'clearsky':
      return 'weather.clear';
    case 'fair':
      return 'weather.fair';
    case 'partlycloudy':
      return 'weather.partlyCloudy';
    case 'cloudy':
      return 'weather.cloudy';
    case 'fog':
      return 'weather.fog';
    case 'lightrain':
      return 'weather.lightRain';
    case 'rain':
      return 'weather.rain';
    case 'heavyrain':
      return 'weather.heavyRain';
    case 'lightsleet':
    case 'sleet':
    case 'heavysleet':
      return 'weather.sleet';
    case 'lightsnow':
    case 'snow':
    case 'heavysnow':
      return 'weather.snow';
    default:
      return null;
  }
}

// -- A day at a place --------------------------------------------------------------------------------------------------

export interface DaySummary {
  state: 'summary';
  /** °C; null when no entry of the day has one. */
  high: number | null;
  low: number | null;
  /** The most wind, m/s. */
  wind: number | null;
  /** The day's total, mm, each span counted by the part of it that falls in the day. */
  precipitation: number | null;
  /** The conditions at the day's crew call, else at noon (`at`, HH:MM); null when no span of the forecast covers it. */
  conditions: MessageKey | null;
  at: string;
  /** HH:MM the forecast starts, when that is after the day starts; HH:MM it ends, when that is before the day ends. */
  from: string | null;
  until: string | null;
}

/** A day past the forecast's last entry (`lastDate`, YYYY-MM-DD, in the zone), or a day with nothing to show. */
export type DayWeather = DaySummary | { state: 'beyond'; lastDate: string } | { state: 'none' };

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR = 3_600_000;

/**
 * Which of MET's two spans an entry's figure is: the six hours when the next entry is further than an hour away and
 * there are six, else the hour, else whatever there is. Null when it has neither.
 */
function period(has1: boolean, has6: boolean, gap: number): 1 | 6 | null {
  if (gap > HOUR) return has6 ? 6 : has1 ? 1 : null;
  return has1 ? 1 : has6 ? 6 : null;
}

/** An amount or a symbol over [start, end) (ms): what an entry says of the time up to the next entry. */
interface Span<T> {
  start: number;
  end: number;
  value: T;
}

/**
 * Each entry's spans. An entry covers the time up to the next one (the hour where they are an hour apart, the six hours
 * where they are six), never more than the span MET gave it; for another gap, the span that fits, its rain spread
 * evenly (a 6 mm over six hours is 1 mm an hour) over what it covers. The last entry has no next, so it covers its own
 * span, if any.
 */
function spansOf(entries: readonly ForecastEntry[]): { rain: Span<number>[]; symbol: Span<string>[] } {
  const rain: Span<number>[] = [];
  const symbol: Span<string>[] = [];
  entries.forEach((entry, i) => {
    const start = Date.parse(entry.time);
    const next = entries[i + 1];
    const gap = next ? Date.parse(next.time) - start : Infinity;
    const r = period(entry.rain1h !== null, entry.rain6h !== null, gap);
    if (r !== null) {
      const amount = r === 1 ? entry.rain1h : entry.rain6h;
      const length = Math.min(gap, r * HOUR);
      if (amount !== null && length > 0) rain.push({ start, end: start + length, value: (amount * length) / (r * HOUR) });
    }
    const s = period(entry.symbol1h !== null, entry.symbol6h !== null, gap);
    if (s !== null) {
      const code = s === 1 ? entry.symbol1h : entry.symbol6h;
      if (code !== null) symbol.push({ start, end: start + Math.min(gap, s * HOUR), value: code });
    }
  });
  return { rain, symbol };
}

const nextDate = (date: string): string => new Date(Date.parse(`${date}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);
const hhmm = (at: number, zone: string): string => {
  const clock = zoneClock(new Date(at), zone);
  return clock ? `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}` : '';
};

/**
 * The forecast for `date` (YYYY-MM-DD) as the wall clock of `zone` has it, so a day that crosses UTC midnight takes the
 * entries that fall in it and no others. Temperatures and wind are the entries' own moments in the day. Precipitation
 * is each span's amount, pro rata for the part of the span inside the day (a span from 22:00 to 04:00 gives the day
 * a third). The conditions are those of the span that covers the crew call (`callTime`, HH:MM; noon with none), and
 * nothing when none does. A forecast that starts after the day starts or ends before it ends says from and until when.
 */
export function dayWeather(entries: readonly ForecastEntry[], date: string, zone: string, callTime: string): DayWeather {
  const first = wallInstant(date, 0, 0, zone);
  const last = wallInstant(nextDate(date), 0, 0, zone);
  if (!first || !last || entries.length === 0) return { state: 'none' };
  const [dayStart, dayEnd] = [first.getTime(), last.getTime()];
  const { rain, symbol } = spansOf(entries);
  const seriesStart = Date.parse(entries[0]?.time ?? '');
  const lastTime = Date.parse(entries.at(-1)?.time ?? '');
  const seriesEnd = Math.max(lastTime, ...rain.map((s) => s.end), ...symbol.map((s) => s.end));
  if (seriesEnd <= dayStart) {
    return { state: 'beyond', lastDate: zoneClock(new Date(seriesEnd - 1), zone)?.date ?? date };
  }
  if (seriesStart >= dayEnd) return { state: 'none' };

  const inDay = entries.filter((e) => Date.parse(e.time) >= dayStart && Date.parse(e.time) < dayEnd);
  const values = (pick: (e: ForecastEntry) => number | null) => inDay.flatMap((e) => pick(e) ?? []);
  const temperatures = values((e) => e.temperature);
  const winds = values((e) => e.wind);
  const wet = rain.filter((s) => s.start < dayEnd && s.end > dayStart);
  const total = wet.reduce((sum, s) => sum + (s.value * (Math.min(s.end, dayEnd) - Math.max(s.start, dayStart))) / (s.end - s.start), 0);

  const call = CLOCK.exec(callTime);
  const [hour, minute] = call ? [Number(call[1]), Number(call[2])] : [12, 0];
  const at = wallInstant(date, hour, minute, zone)?.getTime() ?? NaN;
  const covering = symbol.filter((s) => s.start <= at && at < s.end).at(-1);
  return {
    state: 'summary',
    high: temperatures.length > 0 ? Math.max(...temperatures) : null,
    low: temperatures.length > 0 ? Math.min(...temperatures) : null,
    wind: winds.length > 0 ? Math.max(...winds) : null,
    // Counted to the thousandth of a millimetre, so 0.1 + 0.2 reads 0.3.
    precipitation: wet.length > 0 ? Math.round(total * 1000) / 1000 : null,
    conditions: covering ? conditionKey(covering.value) : null,
    at: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    from: seriesStart > dayStart ? hhmm(seriesStart, zone) : null,
    until: seriesEnd < dayEnd ? hhmm(seriesEnd, zone) : null,
  };
}

/**
 * The precipitation, in mm, between two instants (ms): each span's amount pro rata for the part of it inside. Null when
 * no span of the forecast reaches into the window (nothing is known, which is not the same as dry). For the call
 * sheet's rain check (4.8), which asks about the day's working hours rather than the whole day.
 */
export function precipitationBetween(entries: readonly ForecastEntry[], from: number, to: number): number | null {
  const wet = spansOf(entries).rain.filter((s) => s.start < to && s.end > from);
  if (wet.length === 0) return null;
  const total = wet.reduce((sum, s) => sum + (s.value * (Math.min(s.end, to) - Math.max(s.start, from))) / (s.end - s.start), 0);
  return Math.round(total * 1000) / 1000;
}

/** HH:MM in a zone for an ISO time (the fetch time, the expiry), or '' for a time or zone that can't be read. */
export function clockIn(iso: string, zone: string): string {
  return hhmm(Date.parse(iso), zone);
}

/** The day, in the zone, that today is: where "past" and "future" are counted from for a location. */
export function todayIn(zone: string, now: Date): string | null {
  return zoneClock(now, zone)?.date ?? null;
}

/** "14:05", or "Mon, Nov 16 14:05" when that isn't today in the zone: when a fetch or an expiry is, said so it can't mislead. */
export function momentIn(iso: string, zone: string, now: Date): string {
  const clock = clockIn(iso, zone);
  const date = zoneClock(new Date(iso), zone)?.date;
  if (!clock || !date || date === todayIn(zone, now)) return clock;
  return `${dayDateLabel(date)} ${clock}`;
}

// -- Units -------------------------------------------------------------------------------------------------------------

export type WeatherUnits = 'metric' | 'us';

/** The regions that use °F, mph and inches: the US and its territories. */
const US_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP']);

/** Whether a region's locale (`en-US`, `es-MX`; a bare language reads as its likeliest region) is the US or a territory. */
export function isUsLocale(locale: string | null): boolean {
  if (!locale) return false;
  try {
    const parsed = new Intl.Locale(locale);
    return US_REGIONS.has(parsed.region ?? parsed.maximize().region ?? '');
  } catch {
    return false;
  }
}

/** The units to show: the choice, else °F, mph and inches in the US and °C, km/h and mm elsewhere (Kevin, Nov 9). */
export function unitsFor(choice: WeatherUnitsChoice, regionLocale: string | null): WeatherUnits {
  if (choice === 'metric' || choice === 'us') return choice;
  return isUsLocale(regionLocale) ? 'us' : 'metric';
}

const minus = (text: string): string => text.replace('-', '−');
/** A number the way the app's language writes it, with `least` to `most` decimals; "-0" never shows. */
function plain(value: number, least: number, most: number): string {
  const text = value.toLocaleString(getLocale(), { minimumFractionDigits: least, maximumFractionDigits: most, useGrouping: false });
  return minus(text === '-0' ? '0' : text);
}

/** "18°C" or "64°F": whole degrees. */
export function temperatureText(celsius: number, units: WeatherUnits): string {
  return units === 'us' ? t('weather.fahrenheit', { value: plain((celsius * 9) / 5 + 32, 0, 0) }) : t('weather.celsius', { value: plain(celsius, 0, 0) });
}

/** "16 km/h" or "10 mph" from metres per second: whole numbers. */
export function windText(metresPerSecond: number, units: WeatherUnits): string {
  return units === 'us' ? t('weather.mph', { value: plain(metresPerSecond * 2.236_936, 0, 0) }) : t('weather.kmh', { value: plain(metresPerSecond * 3.6, 0, 0) });
}

/** "7.7 mm" or "0.30 in" from millimetres. */
export function precipitationText(mm: number, units: WeatherUnits): string {
  return units === 'us' ? t('weather.inches', { value: plain(mm / 25.4, 2, 2) }) : t('weather.mm', { value: plain(mm, 0, 1) });
}
