import { useEffect, useRef, useState } from 'react';
import { ForecastError } from '../../app/forecastOnline';
import { isFresh } from '../../core/net/weather';
import { findForecast, type Issue, type Loaded } from './forecast';

// A location's forecast on the sheet (4.4): read when the sheet shows the location's day, and again only when Refresh
// is pressed (which, like opening, asks the network only past the forecast's expiry).

export interface ForecastState {
  loading: boolean;
  loaded: Loaded | null;
  /** Why there is no (new) forecast, as a code: the sheet puts it into words when it draws, in the current language. */
  issue: Issue | null;
  /** ISO time: Refresh was pressed and the forecast already held is good until then. */
  upToDate: string | null;
}

const START: ForecastState = { loading: false, loaded: null, issue: null, upToDate: null };

const issueOf = (error: unknown): Issue =>
  error instanceof ForecastError ? error.issue : { kind: 'message', text: error instanceof Error ? error.message : String(error) };

/**
 * `point` is where to read it, or null for no place (nothing is asked). `mayAsk` is false for a day gone by: the cache
 * is shown if it has one, and the network is left alone.
 */
export function useForecast(point: { latitude: number; longitude: number } | null, mayAsk: boolean): ForecastState & { refresh: () => void } {
  const [state, setState] = useState<ForecastState>(START);
  const turn = useRef(0);
  const latitude = point?.latitude;
  const longitude = point?.longitude;

  const run = (refresh: boolean) => {
    if (latitude === undefined || longitude === undefined) return;
    const mine = ++turn.current;
    setState((before) => ({ loading: true, loaded: refresh ? before.loaded : null, issue: null, upToDate: null }));
    findForecast(latitude, longitude, mayAsk).then(
      (loaded) => {
        if (turn.current !== mine) return;
        setState({
          loading: false,
          loaded,
          issue: loaded?.issue ?? null,
          upToDate: refresh && loaded && !loaded.asked && !loaded.issue && isFresh(loaded.forecast, new Date()) ? loaded.forecast.expires : null,
        });
      },
      (error: unknown) => {
        if (turn.current === mine) setState((before) => ({ loading: false, loaded: refresh ? before.loaded : null, issue: issueOf(error), upToDate: null }));
      },
    );
  };

  useEffect(() => {
    run(false);
    return () => {
      // A place or day changed (or the sheet closed): the answer on its way is for something no longer shown.
      turn.current += 1;
    };
  }, [latitude, longitude, mayAsk]);

  return {
    ...state,
    refresh: () => {
      run(true);
    },
  };
}
