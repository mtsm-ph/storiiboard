import { useEffect, useRef } from 'react';
import { showInfo } from '../../../app/notice';
import { layoutsOf, layoutStore } from '../../../app/shell/docking/layoutStore';
import { openTile } from '../../../app/shell/docking/layout';
import { useWorkspaceId } from '../../../app/shell/workspaceContext';
import { useZonesAt } from '../../../app/timeZone';
import { t } from '../../../core/i18n';
import { locationFields } from '../../../core/model/location';
import { NORTH_ICON, parseDegrees, type NorthFields, type SunFields } from '../../../core/model/plan';
import { parseSunTime, steppedTime, sunReading, sunZonePoint, type SunMissing, type SunReading } from '../../../core/model/planSun';
import type { SbdRecord } from '../../../core/model/record';
import { dayLabel } from '../../../core/model/shootDay';
import type { SunBand, SunRange } from '../../../core/model/sunTimes';
import { Button } from '../../../ui/Button';
import { TextField } from '../../../ui/fields';
import { openLocation } from '../../locations/shownLocation';
import { openShootDay, openShootDays } from '../../schedule/shownDay';
import { changeIcons, setSunTime } from './planActions';
import { degreesText, TypedField } from './selectionFields';
import { MISSING_WORDS, sunNumbers } from './sunLooks';

// The room's north and a sun path in the Selection tile (6.6). North: its angle typed ("35°"), the room's north for every
// scene and setup set there. A sun path: its time (typed, or stepped from the keyboard: the arrows 15 minutes, Shift an
// hour, each step one edit), what it is drawn for (the day, its date, the place and the zone), and the sun at that time
// with the day's sunrise, sunset and golden hour as the call sheet gives them; or what it lacks, with a button to where
// that is set.

type Records = Readonly<Record<string, SbdRecord>>;

export function NorthFieldsView({ id, fields }: { id: string; fields: NorthFields }) {
  return (
    <div className="flex flex-col gap-3" data-north={id}>
      <p className="sb-label" data-selection-kind="">
        {t('selection.north.field')}
      </p>
      <TypedField
        key={`${id}:north`}
        label={t('selection.north.field')}
        text={degreesText(fields.rotation)}
        onCommit={(typed) => {
          // "North: 35°" as typed after the field's name, or just "35°".
          const degrees = parseDegrees(typed.replace(new RegExp(`^\\s*${t('selection.north.field')}\\s*:?`, 'i'), ''));
          if (degrees === null) return false;
          void changeIcons([id], { rotation: degrees });
          return true;
        }}
        refused={t('selection.rotationRefused')}
      />
      <p className="text-[12px]" data-north-shared="">
        {t('selection.north.shared')}
      </p>
      <p className="text-[12px] text-text-muted">{t('selection.north.note')}</p>
    </div>
  );
}

const MINUTES_STEP = 15;
const HOUR_STEP = 60;

/** The sun path's time: typed and left (or Enter) is one edit; the up and down arrows step it, each step one edit. */
function SunTimeField({ id, time }: { id: string; time: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.value = time;
  }, [time]);
  const commit = (field: HTMLInputElement) => {
    if (field.value.trim() === time) return;
    const next = parseSunTime(field.value);
    field.value = time;
    if (next === null) {
      showInfo(t('selection.sun.timeRefused'));
      return;
    }
    void setSunTime([id], next);
  };
  return (
    <TextField
      ref={input}
      label={t('selection.sun.time')}
      mono
      autoComplete="off"
      inputMode="numeric"
      defaultValue={time}
      data-sun-time=""
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(event.currentTarget);
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        // From what the field reads, when it reads a time; else from the stored one.
        const from = parseSunTime(event.currentTarget.value) ?? time;
        const next = steppedTime(from, (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? HOUR_STEP : MINUTES_STEP));
        event.currentTarget.value = next;
        void setSunTime([id], next);
      }}
    />
  );
}

/** A clock time, mono; "+1" or "−1" for one on the next or previous day. */
const Clock = ({ time, next, prev }: { time: string; next: boolean; prev: boolean }) => (
  <span className="font-mono">
    {time}
    {next ? ' +1' : prev ? ' −1' : ''}
  </span>
);

const Stretch = ({ range }: { range: SunRange }) => (
  <>
    <Clock time={range.start} next={range.startNext} prev={range.startPrev} />–<Clock time={range.end} next={range.endNext} prev={range.endPrev} />
  </>
);

/** Golden hour as the call sheet gives it: morning and evening, or one stretch, or all day. */
function GoldenHour({ band }: { band: SunBand }) {
  if (!band.allDay && !band.morning && !band.evening && !band.whole) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]" data-sun-golden="">
      {/* Burning Flame with ink text, and its name in words as the second cue (as on the call sheet). */}
      <span className="sb-label bg-highlight px-[7px] py-1 text-ink-fixed">{t('callSheet.goldenHour')}</span>
      {band.allDay && <span>{t('callSheet.allDay')}</span>}
      {band.whole && <Stretch range={band.whole} />}
      {band.morning && (
        <span>
          {t('callSheet.morning')} <Stretch range={band.morning} />
        </span>
      )}
      {band.evening && (
        <span>
          {t('callSheet.evening')} <Stretch range={band.evening} />
        </span>
      )}
    </div>
  );
}

/** What a sun path lacks, said, with a button to where it is set. */
function Missing({ reading }: { reading: Extract<SunReading, { missing: SunMissing }> }) {
  const workspaceId = useWorkspaceId();
  const { missing } = reading;
  let action: { words: string; run: () => void } | null = null;
  if (missing === 'noDay') action = { words: t('selection.sun.openDays'), run: () => { openShootDays(workspaceId); } };
  else if (missing === 'noDate' && reading.dayId) {
    const dayId = reading.dayId;
    action = { words: t('selection.sun.openDays'), run: () => { openShootDay(workspaceId, dayId); } };
  } else if (missing === 'noLocation' || missing === 'noPlace' || missing === 'noZone') {
    const locationId = reading.locationId ?? null;
    action = { words: t('selection.sun.openLocations'), run: () => { openLocation(workspaceId, locationId); } };
  } else if (missing === 'noNorth') {
    action = {
      words: t('selection.sun.placeNorth'),
      run: () => {
        // North's button in the Library, the Library opened first when it isn't.
        const button = () => document.querySelector<HTMLElement>(`[data-library-icon="${NORTH_ICON}"]`);
        if (!button()) {
          const { layouts, change } = layoutStore.getState();
          change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'library'));
        }
        requestAnimationFrame(() => {
          button()?.scrollIntoView({ block: 'nearest' });
          button()?.focus();
        });
      },
    };
  }
  return (
    <div className="flex flex-col gap-2" data-sun-missing={missing}>
      <p className="font-mono text-[13px] font-bold">{t(MISSING_WORDS[missing])}</p>
      <p className="text-[12px] text-text-muted">{missing === 'noFrames' ? t('selection.sun.noFramesHow') : t('selection.sun.nothingDrawn')}</p>
      {action && (
        <div>
          <Button data-sun-fix={missing} onClick={action.run}>
            {action.words}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SunFieldsView({ id, fields, records }: { id: string; fields: SunFields; records: Records }) {
  const point = sunZonePoint(records, id);
  const zones = useZonesAt(point ? [point] : []);
  const reading = sunReading(records, id, zones);
  const numbers = sunNumbers(reading, fields.time);
  return (
    <div className="flex flex-col gap-3" data-sun={id}>
      <p className="sb-label" data-selection-kind="">
        {t('planIcon.lighting.sun-path')}
      </p>
      <SunTimeField id={id} time={fields.time} />
      <p className="text-[12px] text-text-muted">{t('selection.sun.timeNote')}</p>
      {!reading ? null : 'missing' in reading ? (
        <Missing reading={reading} />
      ) : (
        <>
          <section className="flex flex-col gap-1 border-t border-border pt-3" data-sun-for="">
            <h3 className="sb-label">{t('selection.sun.drawnFor')}</h3>
            <p className="text-[13px]" data-sun-day={reading.source.day.record.id}>
              {t('selection.sun.dayAt', { day: dayLabel(reading.source.day), place: locationFields(reading.source.location.props).name || t('locations.unnamed') })}
            </p>
            <p className="text-[12px] text-text-muted" data-sun-zone="">
              {reading.zone.source === 'map' ? t('selection.sun.zoneFromMap', { zone: reading.zone.zone }) : t('callSheet.timesIn', { zone: reading.zone.zone })}
            </p>
            {reading.source.otherDays.length > 0 && (
              <p className="text-[12px]" data-sun-also-days="">
                {t('selection.sun.alsoDays', { days: reading.source.otherDays.map((d) => dayLabel(d)).join(', ') })}
              </p>
            )}
            {reading.source.otherPlaces.length > 0 && (
              <p className="text-[12px]" data-sun-also-places="">
                {t('selection.sun.alsoPlaces', { places: reading.source.otherPlaces.map((l) => locationFields(l.props).name || t('locations.unnamed')).join(', ') })}
              </p>
            )}
          </section>
          {numbers && (
            <section className="flex flex-col gap-1.5 border-t border-border pt-3" data-sun-numbers="">
              <p className="flex flex-wrap gap-x-4 text-[13px]">
                <span>
                  <span className="sb-label">{t('selection.sun.bearing')} </span>
                  <span className="font-mono" data-sun-bearing="">
                    {numbers.at.up ? degreesText(Math.round(numbers.at.bearing) % 360) : '—'}
                  </span>
                </span>
                <span>
                  <span className="sb-label">{t('selection.sun.height')} </span>
                  <span className="font-mono" data-sun-height="">
                    {numbers.at.up ? t('selection.sun.heightValue', { height: String(Math.round(numbers.at.altitude)) }) : t('selection.sun.downValue')}
                  </span>
                </span>
              </p>
              {numbers.path.day.state === 'normal' ? (
                <p className="flex flex-wrap gap-x-4 text-[13px]">
                  <span>
                    <span className="sb-label">{t('callSheet.sunrise')} </span>
                    <span data-sun-rise="">
                      <Clock time={numbers.path.day.sunrise} next={numbers.path.day.sunriseNext} prev={numbers.path.day.sunrisePrev} />
                    </span>
                  </span>
                  <span>
                    <span className="sb-label">{t('callSheet.sunset')} </span>
                    <span data-sun-set="">
                      <Clock time={numbers.path.day.sunset} next={numbers.path.day.sunsetNext} prev={numbers.path.day.sunsetPrev} />
                    </span>
                  </span>
                </p>
              ) : (
                <p className="text-[13px]">{numbers.path.day.state === 'up' ? t('callSheet.sunUp') : t('callSheet.sunDown')}</p>
              )}
              <GoldenHour band={numbers.path.day.golden} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
