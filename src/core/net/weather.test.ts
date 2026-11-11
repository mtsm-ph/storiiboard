import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../i18n';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { loadSettings, saveSettings } from '../storage/settings';
import { answerFrom, cachedForecast, clockIn, conditionKey, dayWeather, forecastJson, isFresh, isUsLocale, momentIn, precipitationText, temperatureText, todayIn, unitsFor, weatherKey, windText, type ForecastEntry } from './weather';
import { recordedForecast } from './recordedWeather';

// The call sheet's forecast (4.4), from the recorded answer (written by hand in the shape of MET Norway's compact
// Locationforecast; the Rust tests read the same file): a day in the location's zone, symbol words, units, the cache.

const start = getLocale();
afterEach(() => {
  setLocale(start);
});

async function recorded(): Promise<ForecastEntry[]> {
  const answer = answerFrom(await recordedForecast());
  if (!answer?.forecast) throw new Error('the recorded forecast');
  return answer.forecast.entries;
}

const entry = (time: string, over: Partial<ForecastEntry> = {}): ForecastEntry => ({
  time,
  temperature: 10,
  wind: 2,
  rain1h: null,
  rain6h: null,
  symbol1h: null,
  symbol6h: null,
  ...over,
});

describe('a day at a place', () => {
  it('takes the entries and the spans that fall in the day in the location’s zone, across UTC midnight (Los Angeles)', async () => {
    const entries = await recorded();
    // Nov 17 in Los Angeles (UTC-8) runs from 08:00Z to 08:00Z: the 12Z and 18Z entries, then 00Z and 06Z of the 18th.
    // Precipitation: 0 + 2.1 + 5.2 and the 2 of the 6 hours of the 06Z span (22:00 to 04:00) that are still the 17th.
    const day = dayWeather(entries, '2026-11-17', 'America/Los_Angeles', '08:00');
    expect(day).toMatchObject({ state: 'summary', high: 18.3, low: 9.4, wind: 4.4, precipitation: 7.433, from: null, until: null });
    // The same day in Lima (UTC-5) takes the 06Z entry of the 17th, not the 06Z of the 18th.
    expect(dayWeather(entries, '2026-11-17', 'America/Lima', '')).toMatchObject({ state: 'summary', high: 18.3, low: 8.9, wind: 4.4, precipitation: 6.483 });
    // In Tokyo (UTC+9) the 17th runs from 15:00Z of the 16th, where the forecast is hourly.
    expect(dayWeather(entries, '2026-11-17', 'Asia/Tokyo', '')).toMatchObject({ state: 'summary', high: 17.6, low: 8.9, wind: 3.7, precipitation: 3 });
    // India (+5:30): a day starting at 18:30Z cuts the 18Z span of the 16th and the 18Z span of the 17th through the middle.
    expect(dayWeather(entries, '2026-11-17', 'Asia/Kolkata', '')).toMatchObject({ state: 'summary', high: 18.3, low: 8.9, precipitation: 1.758 });
  });

  it('gives each day its share of a span that straddles local midnight (Los Angeles, 22:00 to 04:00)', async () => {
    const entries = await recorded();
    // The 06Z entry of the 18th is 22:00 on the 17th; its six hours (0.4 mm) run to 04:00 on the 18th: a third, then two thirds.
    expect(dayWeather(entries, '2026-11-18', 'America/Los_Angeles', '')).toMatchObject({ state: 'summary', precipitation: 0.267 });
    const lone = [entry('2026-11-18T06:00:00Z', { rain6h: 0.6 }), entry('2026-11-18T12:00:00Z')];
    expect(dayWeather(lone, '2026-11-17', 'America/Los_Angeles', '')).toMatchObject({ precipitation: 0.2 });
    expect(dayWeather(lone, '2026-11-18', 'America/Los_Angeles', '')).toMatchObject({ precipitation: 0.4 });
  });

  it('counts the hours up to the next entry, hourly then six-hourly, and spreads a span over the gap that fits', () => {
    // Three hourly entries (each with its hour and its six), then the next entry four hours after the last: that gap
    // (14Z to 18Z) is covered by the last one's six hours, spread evenly (4 of the 6), not lost.
    const seam = [
      entry('2026-11-17T12:00:00Z', { rain1h: 0.1, rain6h: 1.2 }),
      entry('2026-11-17T13:00:00Z', { rain1h: 0.2, rain6h: 1.2 }),
      entry('2026-11-17T14:00:00Z', { rain1h: 0.3, rain6h: 1.2 }),
      entry('2026-11-17T18:00:00Z', { rain6h: 0.6 }),
      entry('2026-11-18T00:00:00Z'),
    ];
    expect(dayWeather(seam, '2026-11-17', 'UTC', '')).toMatchObject({ precipitation: 1.7 });
    // Entries six hours apart each count their six.
    const six = [entry('2026-11-17T00:00:00Z', { rain6h: 1 }), entry('2026-11-17T06:00:00Z', { rain6h: 2 }), entry('2026-11-17T12:00:00Z', { rain6h: 3, rain1h: 1 })];
    expect(dayWeather(six, '2026-11-17', 'UTC', '')).toMatchObject({ precipitation: 6 });
    // An hourly entry with only its six hours spreads them evenly: 6 mm over six hours is 1 mm an hour.
    const only6 = [entry('2026-11-17T00:00:00Z', { rain6h: 6 }), entry('2026-11-17T01:00:00Z', { rain6h: 6 }), entry('2026-11-17T02:00:00Z')];
    expect(dayWeather(only6, '2026-11-17', 'UTC', '')).toMatchObject({ precipitation: 2 });
  });

  it('reads the conditions of the span that covers the crew call, else at noon, else nothing', async () => {
    const entries = await recorded();
    const at = (call: string) => dayWeather(entries, '2026-11-17', 'America/Los_Angeles', call);
    // 08:00 in Los Angeles is 16:00Z, inside the 12Z entry’s six hours (fair), not the 18Z entry’s showers that follow.
    expect(at('08:00')).toMatchObject({ conditions: 'weather.fair', at: '08:00' });
    expect(at('07:00')).toMatchObject({ conditions: 'weather.fair' });
    expect(at('05:00')).toMatchObject({ conditions: 'weather.fair' });
    // 03:00 is still the 06Z entry’s (partly cloudy at night); 10:00 is the 18Z entry’s.
    expect(at('03:00')).toMatchObject({ conditions: 'weather.partlyCloudy' });
    expect(at('10:00')).toMatchObject({ conditions: 'weather.lightRain' });
    // No call (or one that isn't a time): noon, which is 20:00Z, in the 18Z entry’s span.
    expect(at('')).toMatchObject({ conditions: 'weather.lightRain', at: '12:00' });
    expect(at('7am')).toMatchObject({ at: '12:00' });
    // After the forecast's last entry no span covers the call: nothing is said rather than a guess.
    expect(dayWeather(entries, '2026-11-19', 'America/New_York', '14:00')).toMatchObject({ state: 'summary', conditions: null });
    expect(dayWeather(entries, '2026-11-19', 'America/New_York', '12:00')).toMatchObject({ conditions: 'weather.fair' });
  });

  it('says how far the forecast reaches for a day beyond it, and nothing for a day before it', async () => {
    const entries = await recorded();
    expect(dayWeather(entries, '2026-11-20', 'America/New_York', '')).toEqual({ state: 'beyond', lastDate: '2026-11-19' });
    expect(dayWeather(entries, '2030-11-16', 'America/New_York', '')).toEqual({ state: 'beyond', lastDate: '2026-11-19' });
    expect(dayWeather(entries, '2026-11-10', 'America/New_York', '')).toEqual({ state: 'none' });
    expect(dayWeather([], '2026-11-17', 'America/New_York', '')).toEqual({ state: 'none' });
  });

  it('says which part of a day the forecast covers when it starts late or ends early', async () => {
    const entries = await recorded();
    // The forecast ends at 18Z on the 19th: 13:00 in New York. It starts at 12Z on the 16th: 07:00.
    expect(dayWeather(entries, '2026-11-19', 'America/New_York', '')).toMatchObject({ state: 'summary', high: 18.1, from: null, until: '13:00' });
    expect(dayWeather(entries, '2026-11-16', 'America/New_York', '')).toMatchObject({ state: 'summary', from: '07:00', until: null });
    expect(dayWeather(entries, '2026-11-17', 'America/New_York', '')).toMatchObject({ from: null, until: null });
  });

  it('writes a time in a zone, with its date when that is not today there', () => {
    expect(clockIn('2026-11-16T19:05:00Z', 'America/New_York')).toBe('14:05');
    expect(clockIn('2026-11-16T19:05:00Z', 'Asia/Tokyo')).toBe('04:05');
    expect(clockIn('nonsense', 'Asia/Tokyo')).toBe('');
    expect(todayIn('Asia/Tokyo', new Date('2026-11-16T16:00:00Z'))).toBe('2026-11-17');
    expect(todayIn('America/Los_Angeles', new Date('2026-11-16T16:00:00Z'))).toBe('2026-11-16');
    expect(momentIn('2026-11-16T19:05:00Z', 'America/New_York', new Date('2026-11-16T20:00:00Z'))).toBe('14:05');
    expect(momentIn('2026-11-16T19:05:00Z', 'America/New_York', new Date('2026-11-17T20:00:00Z'))).toBe('Mon, Nov 16 14:05');
  });
});

describe('the words for MET’s symbols', () => {
  const words: [string, string][] = [
    ['clearsky_day', 'weather.clear'],
    ['clearsky_night', 'weather.clear'],
    ['fair_polartwilight', 'weather.fair'],
    ['partlycloudy_night', 'weather.partlyCloudy'],
    ['cloudy', 'weather.cloudy'],
    ['fog', 'weather.fog'],
    ['lightrain', 'weather.lightRain'],
    ['lightrainshowers_day', 'weather.lightRain'],
    ['rain', 'weather.rain'],
    ['rainshowers_night', 'weather.rain'],
    ['heavyrain', 'weather.heavyRain'],
    ['heavyrainshowers_day', 'weather.heavyRain'],
    ['lightsleet', 'weather.sleet'],
    ['sleetshowers_day', 'weather.sleet'],
    ['heavysleet', 'weather.sleet'],
    ['lightsnow', 'weather.snow'],
    ['snowshowers_night', 'weather.snow'],
    ['heavysnow', 'weather.snow'],
    ['rainandthunder', 'weather.thunder'],
    ['lightrainshowersandthunder_day', 'weather.thunder'],
    ['heavysnowandthunder', 'weather.thunder'],
  ];

  it('are about ten words; day, night and showers read as their family, thunder wins', () => {
    for (const [code, key] of words) expect(conditionKey(code), code).toBe(key);
    expect(conditionKey('somethingnew')).toBeNull();
    expect(conditionKey(null)).toBeNull();
    expect(new Set(words.map(([, key]) => key)).size).toBe(11);
  });

  it('read in English and Spanish', () => {
    for (const [, key] of words) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
      expect(es[key as keyof typeof es], key).toBeTruthy();
    }
    expect(t('weather.partlyCloudy')).toBe('Partly cloudy');
    setLocale('es');
    expect(t('weather.partlyCloudy')).toBe('Parcialmente nublado');
    expect(t('weather.thunder')).toBe('Tormenta eléctrica');
  });
});

describe('units', () => {
  it('follow the region, US in the US and metric elsewhere, and the choice over the region both ways', () => {
    expect(unitsFor('region', 'en-US')).toBe('us');
    expect(unitsFor('region', 'es-MX')).toBe('metric');
    expect(unitsFor('region', 'en-GB')).toBe('metric');
    expect(unitsFor('region', 'es-US')).toBe('us');
    // The territories too.
    for (const region of ['PR', 'GU', 'VI', 'AS', 'MP']) expect(isUsLocale(`es-${region}`), region).toBe(true);
    expect(isUsLocale('en-CA')).toBe(false);
    expect(unitsFor('region', null)).toBe('metric');
    expect(unitsFor('region', 'not a locale')).toBe('metric');
    expect(unitsFor('metric', 'en-US')).toBe('metric');
    expect(unitsFor('us', 'es-MX')).toBe('us');
  });

  it('convert for display only: °C to °F, m/s to km/h and mph, mm to inches', () => {
    expect(temperatureText(18.3, 'metric')).toBe('18°C');
    expect(temperatureText(18.3, 'us')).toBe('65°F');
    expect(temperatureText(-3.6, 'metric')).toBe('−4°C');
    expect(temperatureText(-0.2, 'metric')).toBe('0°C');
    expect(windText(4.4, 'metric')).toBe('16 km/h');
    expect(windText(4.4, 'us')).toBe('10 mph');
    expect(precipitationText(7.7, 'metric')).toBe('7.7 mm');
    expect(precipitationText(0, 'metric')).toBe('0 mm');
    expect(precipitationText(7.7, 'us')).toBe('0.30 in');
    setLocale('es');
    expect(temperatureText(18.3, 'metric')).toBe('18 °C');
    expect(precipitationText(7.7, 'metric')).toBe('7,7 mm');
  });

  it('are kept in this computer’s settings, a value this version doesn’t know read as the region’s', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadSettings(storage).weatherUnits).toBe('region');
    saveSettings({ weatherUnits: 'us' }, storage);
    expect(loadSettings(storage).weatherUnits).toBe('us');
    store.set('storiiboard.settings', JSON.stringify({ weatherUnits: 'kelvin' }));
    expect(loadSettings(storage).weatherUnits).toBe('region');
  });
});

describe('the cache', () => {
  it('keeps a place cut to 4 decimals, half away from zero as Rust cuts it, and reads back what it wrote', async () => {
    expect(weatherKey(-13.516_767_4, -71.978_749_9)).toBe('-13.5168,-71.9787');
    expect(weatherKey(10, -0.000_01)).toBe('10.0000,0.0000');
    expect(weatherKey(0.000_05, -0.000_05)).toBe('0.0001,-0.0001');
    expect(weatherKey(-1.234_55, 1.234_55)).toBe('-1.2346,1.2346');
    const answer = answerFrom(await recordedForecast());
    expect(answer?.forecast).toBeTruthy();
    if (!answer?.forecast) return;
    const back = cachedForecast(JSON.parse(JSON.stringify(forecastJson(answer.forecast))));
    expect(back).toEqual(answer.forecast);
    expect(back?.entries).toHaveLength(19);
    expect(back?.entries[0]).toMatchObject({ rain1h: 0, rain6h: 1.6, symbol1h: 'partlycloudy_day', symbol6h: 'cloudy' });
  });

  it('is fresh until the expiry the answer gave', async () => {
    const answer = answerFrom(await recordedForecast());
    if (!answer?.forecast) throw new Error('the recorded forecast');
    const expires = Date.parse(answer.forecast.expires);
    expect(isFresh(answer.forecast, new Date(expires - 1))).toBe(true);
    expect(isFresh(answer.forecast, new Date(expires))).toBe(false);
  });

  it('reads an answer that nothing changed in (304) as no forecast, only a new expiry', () => {
    const unchanged = answerFrom({ expires: '2026-11-16T13:20:00Z', lastModified: null, fetchedAt: '2026-11-16T12:50:00Z', notModified: true, forecast: [] });
    expect(unchanged).toMatchObject({ notModified: true, forecast: null, expires: '2026-11-16T13:20:00Z' });
    expect(answerFrom({ expires: '2026-11-16T13:20:00Z', fetchedAt: '2026-11-16T12:50:00Z', forecast: [] })).toBeNull();
  });

  it('is checked again when read: what isn’t a forecast reads as none', () => {
    for (const odd of [null, 'x', {}, { expires: 'soon', forecast: [] }, { expires: '2026-11-16T12:00:00Z', forecast: [] }, { expires: '2026-11-16T12:00:00Z', forecast: [{ time: 'tomorrow' }] }]) {
      expect(cachedForecast(odd)).toBeNull();
    }
    const odd = cachedForecast({
      expires: '2026-11-16T12:00:00Z',
      forecast: [{ time: '2026-11-16T12:00:00Z', temperature: 'warm', wind: 2, rain1h: 'wet', symbol1h: '<b>', symbol6h: 'rain' }],
    });
    expect(odd?.entries[0]).toEqual({ time: '2026-11-16T12:00:00Z', temperature: null, wind: 2, rain1h: null, rain6h: null, symbol1h: null, symbol6h: 'rain' });
  });
});
