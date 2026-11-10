import { describe, expect, it } from 'vitest';
import { ForecastError } from '../../app/forecastOnline';
import { forecastJson, weatherKey, type Forecast } from '../../core/net/weather';
import { forecastAt, newMemory, REFUSAL_MS, type ForecastDeps, type ForecastMemory } from './forecast';

// The forecast's cache logic (4.4): a fresh answer, in memory or in the project, is read without asking; an expired,
// missing or unreadable one asks (as a renewal when one is held); Refresh before the expiry doesn't ask; a day gone by
// never asks; a refusal is remembered.

const NOW = new Date('2026-11-16T12:00:00Z');
const entry = { time: '2026-11-17T12:00:00Z', temperature: 15, wind: 3, rain1h: null, rain6h: 0, symbol1h: null, symbol6h: 'fair_day' };
const forecast = (expires: string, lastModified: string | null = null): Forecast => ({ expires, lastModified, entries: [entry] });
const answer = (expires: string) => ({ expires, lastModified: '2026-11-16T11:59:00Z', fetchedAt: NOW.toISOString(), notModified: false, forecast: [entry] });
const refusal = (status: number) => () => Promise.reject(new ForecastError({ kind: 'refused', status, until: 0 }));

interface Calls {
  load: string[];
  ask: number;
  since: (string | null)[];
  saved: string[];
}

function deps(
  cached: { result: unknown; fetchedAt: string } | 'unreadable' | null,
  reply: () => Promise<unknown> = () => Promise.resolve(answer('2026-11-16T13:00:00Z')),
  memory: ForecastMemory = newMemory(),
  clock: () => Date = () => NOW,
) {
  const calls: Calls = { load: [], ask: 0, since: [], saved: [] };
  const d: ForecastDeps = {
    load: (key) => {
      calls.load.push(key);
      return cached === 'unreadable' ? Promise.reject(new Error('no table')) : Promise.resolve(cached);
    },
    ask: (_lat, _lon, since) => {
      calls.ask += 1;
      calls.since.push(since);
      return reply();
    },
    save: (key) => {
      calls.saved.push(key);
    },
    now: clock,
    memory,
  };
  return { d, calls };
}

const cache = (expires: string, lastModified: string | null = null) => ({ result: forecastJson(forecast(expires, lastModified)), fetchedAt: '2026-11-16T11:30:00Z' });

describe('the forecast at a place', () => {
  it('writes to this project what the session holds when its own row is older or missing (another project asked)', async () => {
    const memory = newMemory();
    const other = deps(null, undefined, memory);
    await forecastAt(1, 2, true, other.d);
    // This project has no row: the held answer is read and written here too, without asking.
    const mine = deps(null, undefined, memory);
    expect((await forecastAt(1, 2, true, mine.d))?.asked).toBe(false);
    expect(mine.calls.ask).toBe(0);
    expect(mine.calls.saved).toEqual(['1.0000,2.0000']);
    // A day gone by (no ask allowed) is written too, so it shows after a restart.
    const past = deps(null, undefined, memory);
    expect((await forecastAt(1, 2, false, past.d))?.asked).toBe(false);
    expect(past.calls.saved).toEqual(['1.0000,2.0000']);
    // A row as new as the held answer is left alone.
    const same = deps({ result: forecastJson(forecast('2026-11-16T13:00:00Z', '2026-11-16T11:59:00Z')), fetchedAt: NOW.toISOString() }, undefined, memory);
    await forecastAt(1, 2, true, same.d);
    expect(same.calls.saved).toEqual([]);
  });

  it('reads a fresh cached answer without asking (opening the sheet, or Refresh before the expiry)', async () => {
    const { d, calls } = deps(cache('2026-11-16T12:30:00Z'));
    for (let i = 0; i < 2; i++) {
      const loaded = await forecastAt(-13.5168, -71.9788, true, d);
      expect(loaded?.asked).toBe(false);
      expect(loaded?.fetchedAt).toBe('2026-11-16T11:30:00Z');
      expect(loaded?.forecast.expires).toBe('2026-11-16T12:30:00Z');
    }
    expect(calls.ask).toBe(0);
    expect(calls.load).toEqual([weatherKey(-13.5168, -71.9788), weatherKey(-13.5168, -71.9788)]);
  });

  it('asks when there is nothing cached, and keeps what it is told', async () => {
    const { d, calls } = deps(null);
    const loaded = await forecastAt(-13.5168, -71.9788, true, d);
    expect(loaded).toMatchObject({ asked: true, fetchedAt: NOW.toISOString(), issue: null });
    expect(calls.ask).toBe(1);
    expect(calls.since).toEqual([null]);
    expect(calls.saved).toEqual(['-13.5168,-71.9788']);
  });

  it('asks when the cached answer is past its expiry, or can’t be read', async () => {
    const expired = deps(cache('2026-11-16T12:00:00Z'));
    expect((await forecastAt(1, 2, true, expired.d))?.asked).toBe(true);
    expect(expired.calls.ask).toBe(1);
    const unreadable = deps(cache('2026-11-16T13:00:00Z'));
    unreadable.d.load = () => Promise.resolve({ result: { nonsense: true }, fetchedAt: '2026-11-16T11:30:00Z' });
    expect((await forecastAt(1, 2, true, unreadable.d))?.asked).toBe(true);
    const noTable = deps('unreadable');
    expect((await forecastAt(1, 2, true, noTable.d))?.asked).toBe(true);
    expect(noTable.calls.ask).toBe(1);
  });

  it('never asks for a day gone by: its cached answer, even expired, or none', async () => {
    const old = deps(cache('2026-11-10T12:00:00Z'));
    const shown = await forecastAt(1, 2, false, old.d);
    expect(shown?.forecast.expires).toBe('2026-11-10T12:00:00Z');
    expect(old.calls.ask).toBe(0);
    const none = deps(null);
    expect(await forecastAt(1, 2, false, none.d)).toBeNull();
    expect(none.calls.ask).toBe(0);
  });

  it('remembers what it was told in memory: a remount, a failed write or another project at the same place asks nothing', async () => {
    const memory = newMemory();
    // The first sheet asks, and its write to the project never lands (the cache stays empty).
    const first = deps(null, undefined, memory);
    expect((await forecastAt(-13.5168, -71.9788, true, first.d))?.asked).toBe(true);
    // The same place again (a remount; another project opened over it): the expiry is not reached, so nothing is asked.
    const second = deps(null, undefined, memory);
    const again = await forecastAt(-13.516_801, -71.978_801, true, second.d);
    expect(again).toMatchObject({ asked: false, fetchedAt: NOW.toISOString() });
    expect(second.calls.ask).toBe(0);
    // Another place asks.
    expect((await forecastAt(10, 20, true, second.d))?.asked).toBe(true);
    // Once the expiry has passed it asks again.
    const later = deps(null, undefined, memory, () => new Date('2026-11-16T13:00:00Z'));
    expect((await forecastAt(-13.5168, -71.9788, true, later.d))?.asked).toBe(true);
  });

  it('renews an expired forecast with its Last-Modified, and a 304 keeps the held entries with the new expiry', async () => {
    const unchanged = () => Promise.resolve({ expires: '2026-11-16T13:20:00Z', lastModified: null, fetchedAt: NOW.toISOString(), notModified: true, forecast: [] });
    const { d, calls } = deps(cache('2026-11-16T12:00:00Z', '2026-11-16T11:00:00Z'), unchanged);
    const loaded = await forecastAt(1, 2, true, d);
    expect(calls.since).toEqual(['2026-11-16T11:00:00Z']);
    expect(loaded).toMatchObject({ asked: true, fetchedAt: NOW.toISOString(), issue: null });
    expect(loaded?.forecast.expires).toBe('2026-11-16T13:20:00Z');
    expect(loaded?.forecast.lastModified).toBe('2026-11-16T11:00:00Z');
    expect(loaded?.forecast.entries).toEqual([entry]);
    expect(calls.saved).toHaveLength(1);
    // A 304 with nothing held to keep is an answer it can't use.
    const nothing = deps(null, unchanged);
    await expect(forecastAt(1, 2, true, nothing.d)).rejects.toBeInstanceOf(ForecastError);
    expect(nothing.calls.saved).toEqual([]);
  });

  it('shows an expired forecast with why it couldn’t be renewed, and throws with nothing to show', async () => {
    const down = () => Promise.reject(new Error('Storiiboard couldn’t reach the service.'));
    const stale = deps(cache('2026-11-16T12:00:00Z'), down);
    const loaded = await forecastAt(1, 2, true, stale.d);
    expect(loaded?.issue).toEqual({ kind: 'message', text: 'Storiiboard couldn’t reach the service.' });
    expect(loaded?.forecast.entries).toHaveLength(1);
    expect(stale.calls.saved).toEqual([]);
    const nothing = deps(null, down);
    await expect(forecastAt(1, 2, true, nothing.d)).rejects.toThrow('reach the service');
    expect(nothing.calls.saved).toEqual([]);
  });

  it('treats an answer it can’t read as an error and keeps nothing', async () => {
    const odd = deps(null, () => Promise.resolve({ forecast: 'nope' }));
    await expect(forecastAt(1, 2, true, odd.d)).rejects.toThrow();
    expect(odd.calls.saved).toEqual([]);
  });

  it('remembers a 403 for 30 minutes, for every place,, and asks nothing meanwhile', async () => {
    const memory = newMemory();
    let at = NOW;
    const first = deps(null, refusal(403), memory, () => at);
    await expect(forecastAt(1, 2, true, first.d)).rejects.toMatchObject({ issue: { kind: 'refused', status: 403, until: NOW.getTime() + REFUSAL_MS } });
    // Pressed again (Refresh, or a remount): refused at once, nothing sent.
    at = new Date(NOW.getTime() + 10 * 60 * 1000);
    const second = deps(null, undefined, memory, () => at);
    await expect(forecastAt(1, 2, true, second.d)).rejects.toMatchObject({ issue: { kind: 'refused' } });
    expect(second.calls.ask).toBe(0);
    // A 403 is about this client, not a place: another place is refused too.
    await expect(forecastAt(10, 20, true, second.d)).rejects.toMatchObject({ issue: { kind: 'refused' } });
    expect(second.calls.ask).toBe(0);
    // After the 30 minutes it may ask again.
    at = new Date(NOW.getTime() + REFUSAL_MS + 1);
    expect((await forecastAt(1, 2, true, second.d))?.asked).toBe(true);
  });

  it('shows an older forecast with the refusal', async () => {
    const memory = newMemory();
    const first = deps(cache('2026-11-16T12:00:00Z'), refusal(429), memory);
    const stale = await forecastAt(1, 2, true, first.d);
    expect(stale?.issue).toMatchObject({ kind: 'refused', status: 429 });
    expect(stale?.forecast.entries).toHaveLength(1);
    const other = deps(null, undefined, memory);
    await expect(forecastAt(30, 40, true, other.d)).rejects.toMatchObject({ issue: { kind: 'refused' } });
    expect(other.calls.ask).toBe(0);
    // A fresh forecast needs no ask, so a refusal never hides it.
    const fresh = deps(cache('2026-11-16T12:30:00Z'), undefined, memory);
    expect((await forecastAt(50, 60, true, fresh.d))?.asked).toBe(false);
  });
});
