import { askForecast, ForecastError, type Issue } from '../../app/forecastOnline';
import { projectStore } from '../../app/projectStore';
import { offReason } from '../../app/servicesStatus';
import { localizeError, t } from '../../core/i18n';
import { en } from '../../core/i18n/locales/en';
import { answerFrom, cachedForecast, forecastJson, isFresh, weatherKey, type Forecast } from '../../core/net/weather';
import { loadLookup, lookupStatement } from '../../core/storage/lookups';

// The forecast for a place on a call sheet (4.4): what this session already holds, then the project's cache
// (`lookups`, kind `weather`, keyed by the place cut to 4 decimals), then Rust, and only when what is held is missing,
// unreadable, or past its `Expires`. Opening the sheet and pressing Refresh both come through here, so neither asks a
// place again before it is due. A refusal (403, 429) is remembered, so nothing asks again meanwhile.

export type { Issue };

export function issueWords(issue: Issue): string {
  if (issue.kind === 'refused') return t('error.weatherRefused');
  if (issue.kind === 'off') return offReason(issue.reason);
  return localizeError(issue.text);
}

/** How long a refusal stands (MET asks clients that are refused to stop). */
export const REFUSAL_MS = 30 * 60 * 1000;

export interface Loaded {
  forecast: Forecast;
  /** ISO time the answer came from the network. */
  fetchedAt: string;
  /** The network was asked just now (not read from the cache). */
  asked: boolean;
  /** Why a newer forecast couldn't be had, when the older one is shown instead. */
  issue: Issue | null;
}

/**
 * What this session remembers of its asks, in memory only: the forecasts last held, by place, so a project opened over
 * another, a remount before a write has landed, or a write that failed doesn't ask MET again before the expiry; and
 * refusals. Public weather, no project data, never stored.
 */
export interface ForecastMemory {
  held: Map<string, { forecast: Forecast; fetchedAt: string }>;
  /** Until when no place is asked: a 403 or 429 is MET refusing this client, not one place. */
  refusedAll: number;
}

export const newMemory = (): ForecastMemory => ({ held: new Map(), refusedAll: 0 });

/** What `forecastAt` needs from outside: the cache, the network and the clock, so tests supply their own. */
export interface ForecastDeps {
  load: (key: string) => Promise<{ result: unknown; fetchedAt: string } | null>;
  /** `modifiedSince` is the held forecast's `lastModified`, for a renewal. */
  ask: (latitude: number, longitude: number, modifiedSince: string | null) => Promise<unknown>;
  save: (key: string, result: ReturnType<typeof forecastJson>, fetchedAt: string) => void;
  now: () => Date;
  memory: ForecastMemory;
}

const newer = (a: Loaded | null, b: Loaded | null): Loaded | null => (a && b ? (Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a) : (a ?? b));

/**
 * The forecast at a place: the one held while it is fresh; else, when `mayAsk`, a new one from the network (kept in the
 * cache), asked as a renewal when an older one is held; else the older one even past its expiry, or null for none. A
 * failed ask with an older forecast to show gives that forecast with the reason; with nothing to show it throws a
 * `ForecastError`.
 */
export async function forecastAt(latitude: number, longitude: number, mayAsk: boolean, deps: ForecastDeps): Promise<Loaded | null> {
  const key = weatherKey(latitude, longitude);
  const { memory } = deps;
  const now = deps.now();
  const inMemory = memory.held.get(key);
  // A cache that can't be read is no cache.
  const cached = await deps.load(key).catch(() => null);
  const kept = cached ? cachedForecast(cached.result) : null;
  const old = newer(
    inMemory ? { ...inMemory, asked: false, issue: null } : null,
    cached && kept ? { forecast: kept, fetchedAt: cached.fetchedAt, asked: false, issue: null } : null,
  );
  if (old) memory.held.set(key, { forecast: old.forecast, fetchedAt: old.fetchedAt });
  // What this session holds is newer than this project's row (another project at the same place asked): the row is
  // written here too, so a past day still shows after a restart and the JSON export has it.
  if (old && inMemory && old.fetchedAt === inMemory.fetchedAt && (!kept || !cached || Date.parse(cached.fetchedAt) < Date.parse(inMemory.fetchedAt))) {
    deps.save(key, forecastJson(old.forecast), old.fetchedAt);
  }
  if (old && (isFresh(old.forecast, now) || !mayAsk)) return old;
  if (!mayAsk) return null;

  const blocked = memory.refusedAll;
  const fail = (issue: Issue): Loaded | null => {
    if (old) return { ...old, issue };
    throw new ForecastError(issue);
  };
  if (blocked > now.getTime()) return fail({ kind: 'refused', status: 0, until: blocked });
  try {
    const answer = answerFrom(await deps.ask(latitude, longitude, old?.forecast.lastModified ?? null));
    const forecast = answer?.notModified && old ? { ...old.forecast, expires: answer.expires, lastModified: answer.lastModified ?? old.forecast.lastModified } : answer?.forecast;
    if (!answer || !forecast) throw new ForecastError({ kind: 'message', text: en['error.oddAnswer'] });
    memory.held.set(key, { forecast, fetchedAt: answer.fetchedAt });
    deps.save(key, forecastJson(forecast), answer.fetchedAt);
    return { forecast, fetchedAt: answer.fetchedAt, asked: true, issue: null };
  } catch (error) {
    let issue: Issue = error instanceof ForecastError ? error.issue : { kind: 'message', text: error instanceof Error ? error.message : String(error) };
    if (issue.kind === 'refused') {
      const until = now.getTime() + REFUSAL_MS;
      memory.refusedAll = until;
      issue = { ...issue, until };
    }
    return fail(issue);
  }
}

const session = newMemory();

/** The app's own deps: the open project's cache, Rust (or the recorded forecast in a browser build) and the clock. */
function appDeps(): ForecastDeps {
  const file = projectStore.getState().project?.file;
  return {
    load: async (key) => {
      const found = file ? await loadLookup(file, 'weather', key) : null;
      return found ? { result: found.result, fetchedAt: found.fetchedAt } : null;
    },
    ask: askForecast,
    // Kept for the project it was asked in; a project opened while it was out isn't written to. Not waited for: a write
    // that fails costs only the cache.
    save: (key, result, fetchedAt) => {
      if (file && projectStore.getState().project?.file === file) void projectStore.getState().writeAside([lookupStatement('weather', key, key, result, fetchedAt)]);
    },
    now: () => new Date(),
    memory: session,
  };
}

// Two locations at the same place, shown together, share one ask.
const inFlight = new Map<string, Promise<Loaded | null>>();

export function findForecast(latitude: number, longitude: number, mayAsk: boolean): Promise<Loaded | null> {
  const key = `${projectStore.getState().project?.projectId ?? ''}|${weatherKey(latitude, longitude)}|${String(mayAsk)}`;
  const running = inFlight.get(key);
  if (running) return running;
  const next = forecastAt(latitude, longitude, mayAsk, appDeps()).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, next);
  return next;
}
