import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { projectStore } from '../../app/projectStore';
import { useWeatherUnits } from '../../app/weatherUnits';
import { formatDate, localizeError, t, tn } from '../../core/i18n';
import { emergencyNumbers } from '../../core/model/emergencyNumbers';
import { distanceText, hospitalKey, type Hospital } from '../../core/net/hospitals';
import type { Place } from '../../core/net/places';
import { Button } from '../../ui/Button';
import { countryList } from '../../core/model/countries';
import { Select, TextField } from '../../ui/fields';
import { findHospitals, type FoundNearby } from './findHospitals';
import { clearHospital, countryChange, hospitalFieldChange, pickHospital } from './locationEdits';
import type { LocationFields } from '../../core/model/location';

// The nearest hospital in a location's editor (4.5), under the place on the map: Find nearest hospital looks around
// that place when pressed (never otherwise), lists what it finds with its distance, and picking one keeps it on the
// location in one edit. The hospital's name, address and phone can also be typed by hand, and Clear hospital takes
// it all off. The country, and the emergency number for it, sit with it, since the call sheet's safety box prints both.

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | ({ kind: 'found'; placeKey: string } & FoundNearby)
  | { kind: 'failed'; message: string };

/** The numbers to call as one line: "911", "999 or 112", or the words for a country not in the table. */
export function emergencyLine(countryCode: string): string {
  const [first, second] = emergencyNumbers(countryCode);
  if (first === undefined) return t('emergency.checkLocally');
  return t('emergency.number', { number: second === undefined ? first : t('emergency.two', { first, second }) });
}

interface HospitalFinderProps {
  locationId: string;
  fields: LocationFields;
  /** The place on the map now, or none: the search is around it. */
  place: Place | null;
  locale: string;
}

export function HospitalFinder({ locationId, fields, place, locale }: HospitalFinderProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const findButton = useRef<HTMLButtonElement>(null);
  const whyId = useId();
  const units = useWeatherUnits();
  const turn = useRef(0);
  useEffect(
    () => () => {
      turn.current += 1;
    },
    [],
  );
  const placeKey = place ? hospitalKey(place, locale) : '';
  const list = useMemo(() => countryList(locale), [locale]);
  // The list only ever shows what was found around the place now on the map.
  const shown = state.kind === 'found' && state.placeKey !== placeKey ? { kind: 'stale' as const } : state;

  const find = (again: boolean) => {
    if (!place || state.kind === 'searching') return;
    const mine = ++turn.current;
    if (again) findButton.current?.focus();
    setState({ kind: 'searching' });
    findHospitals(place, again).then(
      (found) => {
        if (turn.current === mine) setState({ kind: 'found', placeKey, ...found });
      },
      (error: unknown) => {
        if (turn.current === mine) setState({ kind: 'failed', message: localizeError(error instanceof Error ? error.message : String(error)) });
      },
    );
  };

  const pick = (chosen: Hospital) => {
    void projectStore
      .getState()
      .applyWith((now) => ({ changes: pickHospital(now, locationId, chosen) }))
      .then(() => {
        setState({ kind: 'idle' });
        requestAnimationFrame(() => findButton.current?.focus());
      });
  };

  const status =
    shown.kind === 'searching'
      ? t('location.searchingHospitals')
      : shown.kind === 'failed'
        ? shown.message
        : shown.kind === 'stale'
          ? t('location.hospitalStale')
          : shown.kind === 'found'
            ? shown.hospitals.length === 0
              ? t('location.noHospitalFound')
              : `${tn('location.hospitalsFound', shown.hospitals.length)}${shown.saved ? ` ${t('location.savedSearch', { date: formatDate(new Date(shown.fetchedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}` : ''}`
            : '';

  const hand = (prop: 'hospital_name' | 'hospital_address' | 'hospital_phone', label: string, type?: string) => {
    const value = fields[prop];
    return (
      <TextField
        // Keyed by the value, so an undo shows in the field it changed.
        key={`${prop}:${value}`}
        defaultValue={value}
        label={label}
        data-field={prop}
        {...(type ? { type } : {})}
        // A hospital's phone is private like every contact: never offered from, or saved to, the browser's autofill.
        autoComplete="off"
        onBlur={(event) => {
          const next = event.currentTarget.value;
          if (next !== value) void projectStore.getState().applyWith((now) => ({ changes: hospitalFieldChange(now, locationId, prop, next) }));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };

  const anyKept = fields.hospital_name !== '' || fields.hospital_address !== '' || fields.hospital_phone !== '';
  const known = fields.country_code === '' || list.some((c) => c.code === fields.country_code);

  return (
    <div className="flex flex-col gap-2" data-hospital-finder="">
      <h4 className="sb-label">{t('location.hospital')}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={findButton}
          aria-disabled={!place || state.kind === 'searching' || undefined}
          aria-describedby={place ? undefined : whyId}
          onClick={() => {
            find(false);
          }}
        >
          {t('location.findHospital')}
        </Button>
        {state.kind === 'found' && state.saved && (
          <Button
            onClick={() => {
              find(true);
            }}
          >
            {t('location.findHospitalAgain')}
          </Button>
        )}
      </div>
      {!place && (
        <p id={whyId} className="text-[12px] text-text-muted">
          {t('location.findHospitalNeedsPlace')}
        </p>
      )}
      <p role="status" className={status === '' ? 'sr-only' : 'text-[12px]'}>
        {status}
      </p>
      {shown.kind === 'found' && shown.hospitals.length > 0 && (
        <>
          <ul aria-label={t('location.hospitalList')} className="flex flex-col border border-border">
            {shown.hospitals.map((found, i) => (
              <li key={`${String(i)}:${found.name}`} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  data-hospital-option=""
                  onClick={() => {
                    pick(found);
                  }}
                  className="group flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-surface-raised focus-visible:-outline-offset-2"
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-[13px]">{found.name}</span>
                    <span className="shrink-0 font-mono text-[12px]">{distanceText(found.distanceKm, units)}</span>
                  </span>
                  {found.address !== '' && <span className="text-[12px] text-text-muted group-hover:text-text">{found.address}</span>}
                  {found.emergency ? (
                    <span className="text-[12px]">{t('hospital.emergencyRoom')}</span>
                  ) : (
                    // Truffle on paper; in dark mode the page's text (it falls below AA there); the ▲ is the second cue.
                    <span className="text-[12px] text-warning group-hover:text-text dark:text-text">
                      <span aria-hidden="true">▲ </span>
                      {t('hospital.checkEmergencyRoom')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted">{t('location.mapCredit')}</p>
        </>
      )}
      {hand('hospital_name', t('location.hospitalName'))}
      {hand('hospital_address', t('location.hospitalAddress'))}
      {hand('hospital_phone', t('location.hospitalPhone'), 'tel')}
      {anyKept && (
        <div>
          <Button
            onClick={() => {
              void projectStore
                .getState()
                .applyWith((now) => ({ changes: clearHospital(now, locationId) }))
                .then(() => {
                  requestAnimationFrame(() => findButton.current?.focus());
                });
            }}
          >
            {t('location.clearHospital')}
          </Button>
        </div>
      )}
      <Select
        label={t('location.country')}
        value={fields.country_code}
        data-field="country_code"
        onChange={(event) => {
          const code = event.currentTarget.value === '' ? null : event.currentTarget.value;
          void projectStore.getState().applyWith((now) => ({ changes: countryChange(now, locationId, code) }));
        }}
      >
        <option value="">{t('location.countryNotSet')}</option>
        {/* A code this computer has no name for stays selectable, as its own letters. */}
        {!known && <option value={fields.country_code}>{fields.country_code}</option>}
        {list.map(({ code, name }) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
      {fields.country_code !== '' && (
        <p data-emergency-number="" className="font-mono text-[13px]">
          {emergencyLine(fields.country_code)}
        </p>
      )}
    </div>
  );
}
