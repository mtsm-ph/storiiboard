import { invoke } from '@tauri-apps/api/core';
import { en } from '../core/i18n/locales/en';
import { isTauriApp } from './fileAccess';
import { offReasonFrom } from './servicesStatus';

// The forecast on the network (4.4): on the desktop through Rust (src-tauri/src/weather.rs: the switch, the host list,
// the app's User-Agent, coordinates cut to 4 decimals), never from the page itself. A development build in a browser
// answers from a recorded forecast (src/core/net/recordedWeather.ts), so the end-to-end tests never go online; a
// release in a browser has no forecast.

/** Why there is no (new) forecast. Kept as a code and put into words when it is drawn, so a language change applies. */
export type Issue =
  /** MET said stop (403, or 429 for everyone); no ask is made until `until` (ms since 1970). */
  | { kind: 'refused'; status: number; until: number }
  /** The service switch has turned the forecast off, for this reason code. */
  | { kind: 'off'; reason: string | null }
  /** Anything else, as the English text the error came with (Rust's, or the app's). */
  | { kind: 'message'; text: string };

export class ForecastError extends Error {
  constructor(readonly issue: Issue) {
    super(issue.kind === 'message' ? issue.text : issue.kind);
  }
}

/** Rust's error for a refusal starts with this, the status following (weather.rs `REFUSED_PREFIX`). */
const REFUSED_PREFIX = 'weather-refused:';

function issueOf(error: unknown): Issue {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  const off = offReasonFrom(text);
  if (off !== null) return { kind: 'off', reason: off };
  if (text.startsWith(REFUSED_PREFIX)) return { kind: 'refused', status: Number(text.slice(REFUSED_PREFIX.length)) || 0, until: 0 };
  return { kind: 'message', text };
}

/**
 * Rust's answer for a place, as it came (the caller checks it). `modifiedSince` is the `lastModified` of a forecast
 * held and being renewed: Rust sends it as `If-Modified-Since`, and a 304 comes back as `notModified`.
 */
export async function askForecast(latitude: number, longitude: number, modifiedSince: string | null): Promise<unknown> {
  if (isTauriApp) {
    // A service the switch has turned off (4.0) answers with its reason code, and nothing was sent.
    return invoke<unknown>('weather_forecast', { latitude, longitude, modifiedSince }).catch((error: unknown) => {
      throw new ForecastError(issueOf(error));
    });
  }
  if (import.meta.env.DEV) {
    const { recordedForecast } = await import('../core/net/recordedWeather');
    return recordedForecast();
  }
  throw new ForecastError({ kind: 'message', text: en['error.weatherDesktopOnly'] });
}

