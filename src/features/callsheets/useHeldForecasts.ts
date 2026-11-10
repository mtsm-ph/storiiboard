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

/** The forecasts held for some places right now (this session's and the project's cache), by point id; never asks the network. */
export async function readHeldForecasts(points: readonly HeldPoint[]): Promise<HeldForecasts> {
  const rows = await Promise.all(
    points.map(async (p) => {
      const loaded = await findForecast(p.latitude, p.longitude, false).catch(() => null);
      return loaded ? ([p.id, loaded.forecast] as const) : null;
    }),
  );
  return new Map(rows.flatMap((row) => (row ? [row] : [])));
}

/** By point id. Points are compared by value, so a redraw with the same places reads nothing again. */
export function useHeldForecasts(points: readonly HeldPoint[]): HeldForecasts {
  const wanted = JSON.stringify(points);
  const [held, setHeld] = useState<HeldForecasts>(new Map());
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
    void readHeldForecasts(JSON.parse(wanted) as HeldPoint[]).then((next) => {
      if (current) setHeld(next);
    });
    return () => {
      current = false;
    };
  }, [wanted, tick]);
  return held;
}
