import { useEffect, useMemo, useState } from 'react';
import { t, type MessageKey } from '../../core/i18n';
import type { SheetLocation } from '../../core/model/callsheet';
import { dayDateLabel, isDayDate } from '../../core/model/shootDay';
import { dayWeather, momentIn, precipitationText, temperatureText, todayIn, windText, type DaySummary } from '../../core/net/weather';
import { useWeatherUnits } from '../../app/weatherUnits';
import { Button } from '../../ui/Button';
import { issueWords } from './forecast';
import { useForecast } from './useForecast';

// One location's forecast on the call sheet (4.4), beside its Sun block: the day's high and low, the most wind, the
// precipitation, and the conditions at the crew call, in the units Settings → App says. MET Norway is credited
// wherever its data shows (CC BY 4.0). The forecast is shown, never stored on the call sheet.

function Fact({ label, value, kind }: { label: string; value: string; kind: string }) {
  return (
    <span>
      <span className="sb-label">{label} </span>
      <span data-weather-fact={kind} className="font-mono">
        {value}
      </span>
    </span>
  );
}

const MARK = '\u0001';

/** A sentence with a time in it, the time in mono like every other technical value: `key` has a {time} in it. */
function Timed({ words, time, ...rest }: { words: MessageKey; time: string } & Record<`data-${string}`, string>) {
  const [before = '', after = ''] = t(words, { time: MARK }).split(MARK);
  return (
    <span {...rest}>
      {before}
      <span className="font-mono">{time}</span>
      {after}
    </span>
  );
}

function Summary({ s, units }: { s: DaySummary; units: 'metric' | 'us' }) {
  return (
    <>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {s.high !== null && <Fact kind="high" label={t('callSheet.weatherHigh')} value={temperatureText(s.high, units)} />}
        {s.low !== null && <Fact kind="low" label={t('callSheet.weatherLow')} value={temperatureText(s.low, units)} />}
        {s.wind !== null && <Fact kind="wind" label={t('callSheet.weatherWind')} value={windText(s.wind, units)} />}
        {s.precipitation !== null && <Fact kind="precipitation" label={t('callSheet.weatherRain')} value={precipitationText(s.precipitation, units)} />}
        {s.conditions !== null && (
          <span>
            <span className="sb-label">{t('callSheet.weatherAt', { time: s.at })} </span>
            <span data-weather-fact="conditions">{t(s.conditions)}</span>
          </span>
        )}
      </p>
      {/* A day the forecast only partly covers says which part. */}
      {(s.from !== null || s.until !== null) && (
        <p data-weather-covers="" className="flex gap-x-3 text-[12px] text-text-muted">
          {s.from !== null && <Timed words="callSheet.weatherFrom" time={s.from} />}
          {s.until !== null && <Timed words="callSheet.weatherUntil" time={s.until} />}
        </p>
      )}
    </>
  );
}

export function WeatherBlock({ location, date, callTime }: { location: SheetLocation; date: string; callTime: string }) {
  const { place, zone } = location;
  const units = useWeatherUnits();
  // A day that has gone by never asks the network: its forecast is the cache's, or nothing.
  const now = new Date();
  const today = zone ? todayIn(zone.zone, now) : null;
  const past = today !== null && isDayDate(date) && date < today;
  const ready = place !== null && zone !== null && isDayDate(date);
  const { loading, loaded, issue, upToDate, refresh } = useForecast(ready ? place : null, !past);
  // Refresh waits out a refusal; nothing else redraws when the wait ends, so a timer does.
  const [, redraw] = useState(0);
  const refusedUntil = issue?.kind === 'refused' ? issue.until : 0;
  useEffect(() => {
    const wait = refusedUntil - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      redraw((n) => n + 1);
    }, wait + 50);
    return () => {
      clearTimeout(timer);
    };
  }, [refusedUntil]);
  const entries = loaded?.forecast.entries;
  const zoneName = zone?.zone;
  const day = useMemo(() => (entries && zoneName ? dayWeather(entries, date, zoneName, callTime) : null), [entries, zoneName, date, callTime]);
  if (!place) {
    return (
      <p data-weather-note="" className="text-text-muted">
        {t('callSheet.noWeatherPlace')}
      </p>
    );
  }
  // Waiting for the place's zone, or no date on the day: nothing to show yet.
  if (!zone || !ready) return null;
  if (!loading && !issue && (day === null || day.state === 'none')) return null;
  // Refresh waits out a refusal.
  const refused = issue?.kind === 'refused' && issue.until > now.getTime();

  return (
    <div data-weather="" className="flex flex-col gap-1">
      <p className="sb-label">{t('callSheet.weather')}</p>
      {day?.state === 'summary' && <Summary s={day} units={units} />}
      {day?.state === 'beyond' && <p data-weather-beyond="">{t('callSheet.weatherBeyond', { date: dayDateLabel(day.lastDate) })}</p>}
      {loaded && (day?.state === 'summary' || day?.state === 'beyond') && (
        <p data-weather-fetched="" className="text-[12px] text-text-muted">
          <Timed words="callSheet.weatherFetched" time={momentIn(loaded.fetchedAt, zone.zone, now)} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!past && (
          <Button disabled={loading || refused} onClick={refresh}>
            {t('callSheet.weatherRefresh')}
          </Button>
        )}
        {/* One live region says what the forecast is doing: getting it, why it couldn't be had, or that it's current. */}
        <span role="status" data-weather-status="" className="text-[12px] text-text-muted">
          {loading && !loaded && t('callSheet.weatherLoading')}
          {issue && (
            <span data-weather-error="" className="text-warning dark:text-text">
              <span aria-hidden="true">▲ </span>
              {issueWords(issue)}
            </span>
          )}
          {upToDate && <Timed data-weather-up-to-date="" words="callSheet.weatherUpToDate" time={momentIn(upToDate, zone.zone, now)} />}
        </span>
      </div>
    </div>
  );
}
