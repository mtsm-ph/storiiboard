import { answerFrom } from './weather';
import cusco from './recorded/met-norway-cusco.json';

// Development builds only (loaded behind import.meta.env.DEV, so a release never carries it): the forecast in a browser,
// where there's no Rust side to ask, answers from a forecast written by hand in the shape of MET Norway's
// Locationforecast compact (the same file the Rust tests read). The end-to-end tests read the sheet through it, so no
// test ever asks the real service. Every place gets Cusco's forecast; it says it is good for an hour from now.

const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const part = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);

/** MET's compact answer reduced the way src-tauri/src/weather.rs reduces it. */
function reduced(answer: unknown): unknown[] {
  const series = part(part(answer, 'properties'), 'timeseries');
  if (!Array.isArray(series)) return [];
  return series.map((item: unknown) => {
    const data = part(item, 'data');
    const details = part(part(data, 'instant'), 'details');
    const rain = (name: string) => number(part(part(part(data, name), 'details'), 'precipitation_amount'));
    const symbol = (name: string) => part(part(part(data, name), 'summary'), 'symbol_code') ?? null;
    return {
      time: part(item, 'time'),
      temperature: number(part(details, 'air_temperature')),
      wind: number(part(details, 'wind_speed')),
      rain1h: rain('next_1_hours'),
      rain6h: rain('next_6_hours'),
      symbol1h: symbol('next_1_hours'),
      symbol6h: symbol('next_6_hours'),
    };
  });
}

export function recordedForecast(): Promise<unknown> {
  const now = new Date();
  const answer = {
    expires: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    lastModified: '2026-11-16T11:42:10Z',
    fetchedAt: now.toISOString(),
    notModified: false,
    forecast: reduced(cusco),
  };
  return answerFrom(answer) ? Promise.resolve(answer) : Promise.reject(new Error('The recorded forecast can’t be read.'));
}
