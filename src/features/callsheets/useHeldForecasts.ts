import { useEffect, useState } from 'react';
import type { HeldForecasts } from '../../core/checks';
import { findForecast, onForecastHeld } from './forecast';

// The forecasts already held for some places (4.8), for the call sheet checks: this session's and the project's cache,
// read without ever asking the network. A forecast the sheet fetches later is picked up when it lands.

export interface HeldPoint {
  id: string;
  latitude: number;
  longitude: number;
}

/** The forecasts held, by point id, and when each was fetched (ISO), for the Checks tile's word on an old one (7.4). */
export interface HeldReading {
  forecasts: HeldForecasts;
  fetchedAt: ReadonlyMap<string, string>;
}

async function readHeld(points: readonly HeldPoint[]): Promise<HeldReading> {
  const rows = await Promise.all(
    points.map(async (p) => {
      const loaded = await findForecast(p.latitude, p.longitude, false).catch(() => null);
      return loaded ? { id: p.id, forecast: loaded.forecast, fetchedAt: loaded.fetchedAt } : null;
    }),
  );
  const found = rows.flatMap((row) => (row ? [row] : []));
  return { forecasts: new Map(found.map((row) => [row.id, row.forecast])), fetchedAt: new Map(found.map((row) => [row.id, row.fetchedAt])) };
}

/** The forecasts held for some places right now (this session's and the project's cache), by point id; never asks the network. */
export async function readHeldForecasts(points: readonly HeldPoint[]): Promise<HeldForecasts> {
  return (await readHeld(points)).forecasts;
}

const NOTHING: HeldReading = { forecasts: new Map(), fetchedAt: new Map() };

/**
 * The held forecasts with their fetch times, and when they were last read (ms; null until they have been read once since
 * the mount): until then a caller can't tell "none held" from "not read yet", and a forecast's age is judged at that
 * time. Points are compared by value, so a redraw with the same places reads nothing again.
 */
export function useHeldReading(points: readonly HeldPoint[]): HeldReading & { readAt: number | null } {
  const wanted = JSON.stringify(points);
  const [held, setHeld] = useState<HeldReading>(NOTHING);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(
    () =>
      onForecastHeld(() => {
        setTick((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    let current = true;
    void readHeld(JSON.parse(wanted) as HeldPoint[]).then((next) => {
      if (!current) return;
      setHeld(next);
      setReadAt(Date.now());
    });
    return () => {
      current = false;
    };
  }, [wanted, tick]);
  return { ...held, readAt };
}

/** By point id. Points are compared by value, so a redraw with the same places reads nothing again. */
export function useHeldForecasts(points: readonly HeldPoint[]): HeldForecasts {
  return useHeldReading(points).forecasts;
}
