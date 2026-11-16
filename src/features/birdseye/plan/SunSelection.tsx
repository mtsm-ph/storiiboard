import { useEffect, useId, useRef } from 'react';
import { focusWhenShown } from '../../../app/focusWhenShown';
import { showInfo } from '../../../app/notice';
import { layoutsOf, layoutStore } from '../../../app/shell/docking/layoutStore';
import { openTile } from '../../../app/shell/docking/layout';
import { useWorkspaceId } from '../../../app/shell/workspaceContext';
import { useSunZonesAt } from '../../../app/timeZone';
import { t } from '../../../core/i18n';
import { formatCoordinates, type Coordinates } from '../../../core/model/coordinates';
import { locationFields } from '../../../core/model/location';
import { NORTH_ICON, parseDegrees, type NorthFields, type SunFields } from '../../../core/model/plan';
import { parseSunTime, roomNorthItem, steppedTime, type SunMissing } from '../../../core/model/planSun';
import type { Props, SbdRecord } from '../../../core/model/record';
import { dayDateLabel, dayLabel } from '../../../core/model/shootDay';
import { ownPlaceText, ownSunOf, sunReadingOf, sunZonePointOf, type SunDate, type SunPlace, type SunReadingOf } from '../../../core/model/sunSources';
import type { SunBand, SunRange } from '../../../core/model/sunTimes';
import { Button } from '../../../ui/Button';
import { TextField } from '../../../ui/fields';
import { COORDINATES_REFUSED } from '../../locations/coordinatesWords';
import { openLocation } from '../../locations/shownLocation';
import { openShootDay, openShootDays } from '../../schedule/shownDay';
import { ownDateCommit, ownPlaceCommit } from './ownSunFields';
import { changeIcons, setSunOwnDate, setSunOwnPlace, setSunTime } from './planActions';
import { degreesText, TypedField } from './selectionFields';
import { MISSING_WORDS, shownHeight, sunNumbers } from './sunLooks';

// The room's north and a sun path in the Selection tile (6.6). North: its angle typed ("35°"), the room's north for every
// scene and setup set there. A sun path: its time (typed, or stepped from the keyboard: the arrows 15 minutes, Shift an
// hour, each step one edit), what it is drawn for (the day, its date, the place and the zone), and the sun at that time
// with the day's sunrise, sunset and golden hour as the call sheet gives them; or what it lacks, with a button to where
// that is set. Quick sun (6.5.5): where its place and date come from, always said, and its own place and date, typed
// or pasted, for a setup with no location or shoot day (the setup's win where it has them).

type Records = Readonly<Record<string, SbdRecord>>;

export function NorthFieldsView({ id, fields, records }: { id: string; fields: NorthFields; records: Records }) {
  // A second north in its room (only an imported file has one): the first in plan order is the room's north, not this.
  const used = roomNorthItem(records, records[id]?.parentId ?? null);
  const unused = used !== null && used.record.id !== id;
  return (
    <div className="flex flex-col gap-3" data-north={id}>
      <p className="sb-label" data-selection-kind="">
        {t('selection.north.field')}
      </p>
      {unused && (
        <p className="text-[13px] font-bold" data-north-unused="">
          {t('selection.north.unused')}
        </p>
      )}
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
function SunTimeField({ id, time, describedBy }: { id: string; time: string; describedBy: string }) {
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
      aria-describedby={describedBy}
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
function Missing({ reading }: { reading: Extract<SunReadingOf, { missing: SunMissing }> }) {
  const workspaceId = useWorkspaceId();
  const { missing } = reading;
  // Its own coordinates with no zone found (6.5.5): there is no location to fix, so no button; said for these coordinates.
  const ownZone = missing === 'noZone' && reading.place?.source === 'own';
  let action: { words: string; run: () => void } | null = null;
  if (ownZone) action = null;
  else if (missing === 'noDay') action = { words: t('selection.sun.openDays'), run: () => { openShootDays(workspaceId); } };
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
        // The Library mounts a frame or more later when it wasn't open.
        focusWhenShown(button, (found) => {
          found.scrollIntoView({ block: 'nearest' });
        });
      },
    };
  }
  return (
    <div className="flex flex-col gap-2" data-sun-missing={missing}>
      <p className="font-mono text-[13px] font-bold">{t(MISSING_WORDS[missing])}</p>
      {ownZone && <p className="text-[12px]" data-sun-own-zone-missing="">{t('selection.sun.noZoneOwn')}</p>}
      <p className="text-[12px] text-text-muted">{missing === 'noFrames' ? t('selection.sun.noFramesHow') : t('selection.sun.nothingDrawn')}</p>
      {/* The own field that would complete it, when the other own value is set. */}
      {reading.ownField && (
        <p className="text-[12px]" data-sun-own-completes={reading.ownField}>
          {t(reading.ownField === 'place' ? 'selection.sun.orOwnPlace' : 'selection.sun.orOwnDate')}
        </p>
      )}
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

/** A place as the sun path's settings name it: its location's name, or its own coordinates. */
const placeWords = (place: SunPlace): string => (place.source === 'location' ? locationFields(place.location.props).name || t('locations.unnamed') : formatCoordinates(place));

/** A date as the settings name it: its shoot day ("Day 1 · Sun, Jun 21"), or its own date. */
const dateWords = (date: SunDate): string => (date.source === 'shootDay' ? dayLabel(date.day) : dayDateLabel(date.date));

/** Where the place comes from, said always (6.5.5): "From the location: Diner", "Its own", or none yet. */
const placeFrom = (place: SunPlace | null): string =>
  place === null ? t('selection.sun.noneYet') : place.source === 'location' ? t('selection.sun.fromLocation', { name: placeWords(place) }) : t('selection.sun.itsOwn');

const dateFrom = (date: SunDate | null): string =>
  date === null ? t('selection.sun.noneYet') : date.source === 'shootDay' ? t('selection.sun.fromShootDay', { day: dateWords(date) }) : t('selection.sun.itsOwn');

/**
 * A sun path's own place (6.5.5): coordinates typed or pasted as Google Maps copies them, read by the one parser; left
 * (or Enter) is one edit, emptied takes it off. A refusal says why and the field goes back to what's stored.
 */
function OwnPlaceField({ id, props, describedBy }: { id: string; props: Props; describedBy: string }) {
  const stored = ownSunOf(props).place;
  const text = ownPlaceText(props);
  const input = useRef<HTMLInputElement>(null);
  // The full place the field's short text stands for: what's stored, or what it last wrote (ownPlaceCommit).
  const shown = useRef<Coordinates | null>(stored);
  useEffect(() => {
    shown.current = stored;
    if (input.current) input.current.value = text;
    // The stored place by value: a new records object with the same place changes nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stored` by its text and values
  }, [text, stored?.latitude, stored?.longitude]);
  const commit = (field: HTMLInputElement) => {
    const outcome = ownPlaceCommit(field.value, stored, shown.current);
    if (outcome.kind === 'none') return;
    if (outcome.kind === 'refused') {
      field.value = shown.current ? formatCoordinates(shown.current) : text;
      showInfo(t(COORDINATES_REFUSED[outcome.reason]));
      return;
    }
    if (outcome.kind === 'clear') {
      shown.current = null;
      void setSunOwnPlace(id, null);
      return;
    }
    // Shown back in its short form; the file keeps every decimal pasted.
    shown.current = outcome.place;
    field.value = formatCoordinates(outcome.place);
    void setSunOwnPlace(id, outcome.place);
  };
  return (
    <TextField
      ref={input}
      label={t('selection.sun.ownPlace')}
      mono
      autoComplete="off"
      spellCheck={false}
      defaultValue={text}
      placeholder={t('coordinates.example')}
      data-sun-own-place=""
      aria-describedby={describedBy}
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(event.currentTarget);
      }}
    />
  );
}

/** A sun path's own date (6.5.5), YYYY-MM-DD: left (or Enter) is one edit, emptied takes it off. */
function OwnDateField({ id, props, describedBy }: { id: string; props: Props; describedBy: string }) {
  const date = ownSunOf(props).date ?? '';
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.value = date;
  }, [date]);
  const commit = (field: HTMLInputElement) => {
    // An incomplete date changes nothing; only an emptied field clears (ownDateCommit).
    const outcome = ownDateCommit(field.value, field.validity.badInput, date === '' ? null : date);
    if (outcome.kind === 'none') return;
    if (outcome.kind === 'refused') {
      field.value = date;
      showInfo(t('selection.sun.ownDateRefused'));
      return;
    }
    void setSunOwnDate(id, outcome.kind === 'clear' ? null : outcome.date);
  };
  return (
    <TextField
      ref={input}
      label={t('selection.sun.ownDate')}
      type="date"
      mono
      defaultValue={date}
      data-sun-own-date=""
      aria-describedby={describedBy}
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(event.currentTarget);
      }}
    />
  );
}

/**
 * Where the sun path's place and date come from (6.5.5), both said at all times, and its own values to type or paste: kept
 * editable while the setup's win, each marked as not used then.
 */
function SunSources({ id, props, place, date }: { id: string; props: Props; place: SunPlace | null; date: SunDate | null }) {
  const placeNote = useId();
  const dateNote = useId();
  const help = useId();
  // "Not used" only where a setup value really replaces a value typed here in what's drawn (6.5.5 review).
  const own = ownSunOf(props);
  const placeUnused = place?.source === 'location' && own.place !== null;
  const dateUnused = date?.source === 'shootDay' && own.date !== null;
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3" data-sun-sources="">
      <h3 className="sb-label">{t('selection.sun.sources')}</h3>
      <p className="text-[13px]" data-sun-place-from={place?.source ?? 'none'}>
        <span className="sb-label">{t('selection.sun.place')} </span>
        {placeFrom(place)}
      </p>
      <p className="text-[13px]" data-sun-date-from={date?.source ?? 'none'}>
        <span className="sb-label">{t('selection.sun.date')} </span>
        {dateFrom(date)}
      </p>
      <OwnPlaceField id={id} props={props} describedBy={`${placeNote} ${help}`} />
      <p id={placeNote} className={placeUnused ? 'text-[12px] font-bold' : 'sr-only'} data-sun-own-place-unused={placeUnused ? '' : undefined}>
        {placeUnused ? t('selection.sun.ownPlaceUnused') : ''}
      </p>
      <OwnDateField id={id} props={props} describedBy={`${dateNote} ${help}`} />
      <p id={dateNote} className={dateUnused ? 'text-[12px] font-bold' : 'sr-only'} data-sun-own-date-unused={dateUnused ? '' : undefined}>
        {dateUnused ? t('selection.sun.ownDateUnused') : ''}
      </p>
      <p id={help} className="text-[12px] text-text-muted">
        {t('selection.sun.ownNote')} {t('coordinates.help')}
      </p>
    </section>
  );
}

export function SunFieldsView({ id, fields, records }: { id: string; fields: SunFields; records: Records }) {
  const point = sunZonePointOf(records, id);
  const zones = useSunZonesAt(point ? [point] : []);
  const reading = sunReadingOf(records, id, zones);
  const numbers = sunNumbers(reading, fields.time);
  const noteId = useId();
  const props = records[id]?.props ?? {};
  return (
    <div className="flex flex-col gap-3" data-sun={id}>
      <p className="sb-label" data-selection-kind="">
        {t('planIcon.lighting.sun-path')}
      </p>
      <SunTimeField id={id} time={fields.time} describedBy={noteId} />
      <p id={noteId} className="text-[12px] text-text-muted">
        {t('selection.sun.timeNote')}
      </p>
      <SunSources id={id} props={props} place={reading?.place ?? null} date={reading?.date ?? null} />
      {/* While its zone's lookup is on its way, nothing is said about it yet. */}
      {!reading || ('missing' in reading && reading.pending) ? null : 'missing' in reading ? (
        <Missing reading={reading} />
      ) : (
        <>
          <section className="flex flex-col gap-1 border-t border-border pt-3" data-sun-for="">
            <h3 className="sb-label">{t('selection.sun.drawnFor')}</h3>
            <p className="text-[13px]" {...(reading.date.source === 'shootDay' ? { 'data-sun-day': reading.date.day.record.id } : {})}>
              {t('selection.sun.dayAt', { day: dateWords(reading.date), place: placeWords(reading.place) })}
            </p>
            <p className="text-[12px] text-text-muted" data-sun-zone="">
              {reading.place.source === 'own'
                ? t('selection.sun.zoneFromCoordinates', { zone: reading.zone.zone })
                : reading.zone.source === 'map'
                  ? t('selection.sun.zoneFromMap', { zone: reading.zone.zone })
                  : t('callSheet.timesIn', { zone: reading.zone.zone })}
            </p>
            {reading.otherDays.length > 0 && (
              <p className="text-[12px]" data-sun-also-days="">
                {t('selection.sun.alsoDays', { days: reading.otherDays.map((d) => dayLabel(d)).join(', ') })}
              </p>
            )}
            {reading.otherPlaces.length > 0 && (
              <p className="text-[12px]" data-sun-also-places="">
                {t('selection.sun.alsoPlaces', { places: reading.otherPlaces.map((l) => locationFields(l.props).name || t('locations.unnamed')).join(', ') })}
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
                    {numbers.at.up ? t('selection.sun.heightValue', { height: String(shownHeight(numbers.at.altitude)) }) : t('selection.sun.downValue')}
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
