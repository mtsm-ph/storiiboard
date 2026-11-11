import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDirectionsApp } from '../../app/directionsApp';
import { showInfo } from '../../app/notice';
import { list, t, tn } from '../../core/i18n';
import { directionsLink } from '../../core/model/directions';
import { dayDateFull, type CallSheet, type CallSheetNotes, type SheetContact, type SheetLocation, type SheetZone } from '../../core/model/callsheet';
import type { SunBand, SunRange } from '../../core/model/sunTimes';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { ROLE_LABELS } from '../../core/model/role';
import { HMU_MINUTES } from '../../core/model/shootDay';
import { pageLabel, sceneLabel } from '../../core/model/storyboard';
import { headingOf } from '../storyboard/ScenesView';
import { LocationMap } from '../locations/LocationMap';
import { Button } from '../../ui/Button';
import { Select, TextArea, TextField } from '../../ui/fields';
import { DepartmentTag } from '../../ui/tags';
import type { CallsheetNote, PersonTime } from './callsheetEdits';
import { TimeInput } from './TimeInput';
import { SafetyBox } from './SafetyBox';
import { WeatherBlock } from './WeatherBlock';

// The call sheet's sections (4.1), one small component each, so a later milestone adds a section without reshaping
// the others. They only draw what callSheet() worked out; what a person edits here is who is on the day, the times,
// and the notes.

/** A section: a 10px mono label over a 1.5px rule, as the other tiles' sections are. */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="sb-label border-b-[1.5px] border-text pb-1">
        {label}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: string }) => <p className="py-2 text-[13px] text-text-muted">{children}</p>;

/** The day: the project, "Day 3 of 5", its date in full, and the crew call and wrap (edited in Shoot days). */
export function DaySection({ sheet, projectName }: { sheet: CallSheet; projectName: string }) {
  const { day } = sheet;
  const date = dayDateFull(day.fields.date);
  return (
    <Section label={t('callSheet.section.day')}>
      <div className="flex flex-col gap-1 py-2">
        <p data-user-text="" className="text-[18px] leading-tight font-bold">
          {sheet.title || projectName}
        </p>
        <p className="font-mono text-[13px] font-bold" data-sheet-day="">
          {t('callSheet.dayOf', { number: day.number, total: sheet.dayCount })}
        </p>
        <p className="text-[13px]">{date || <span className="text-text-muted">{t('callSheet.noDate')}</span>}</p>
        <dl className="flex gap-6 pt-1">
          <Time label={t('callSheet.crewCall')} time={day.fields.callTime} />
          <Time label={t('days.wrap')} time={day.fields.wrapTime} />
        </dl>
        {/* The call and wrap are the clock as typed; this says whose clock (the first location's). */}
        {sheet.timesIn && (
          <p data-times-in="" className="text-[12px] text-text-muted">
            {zoneLine(sheet.timesIn)}
          </p>
        )}
      </div>
    </Section>
  );
}

/** "Times in America/New_York", or that they are in this computer's zone when nothing better is known. */
function zoneLine({ zone, source }: SheetZone): string {
  return source === 'computer' ? t('callSheet.timesInComputer') : t('callSheet.timesIn', { zone });
}

/** A time in mono; one on the day after the sheet's carries "+1", the day before "−1" (a screen reader says "+1 day"). */
function Clock({ time, next, prev }: { time: string; next: boolean; prev: boolean }) {
  return (
    <span className="font-mono">
      {time}
      {(next || prev) && (
        <>
          <span aria-hidden="true"> {next ? '+1' : '−1'}</span>
          <span className="sr-only"> {next ? t('callSheet.nextDay') : t('callSheet.previousDay')}</span>
        </>
      )}
    </span>
  );
}

const Stretch = ({ range }: { range: SunRange }) => (
  <>
    <Clock time={range.start} next={range.startNext} prev={range.startPrev} />–<Clock time={range.end} next={range.endNext} prev={range.endPrev} />
  </>
);

/** One location's sun (4.3): sunrise and sunset, golden and blue hours, and the zone they are in. */
function SunBlock({ location }: { location: SheetLocation }) {
  const { place, sun, zone } = location;
  if (!place) {
    // Nothing is guessed from the address text.
    return (
      <p data-sun-note="" className="text-text-muted">
        {t('callSheet.noSunPlace')}
      </p>
    );
  }
  // Waiting for the place's zone, or no date on the day: nothing to show yet.
  if (!sun || !zone) return null;
  const stretches = (label: string, band: SunBand, golden: boolean) => {
    if (!band.allDay && !band.morning && !band.evening && !band.whole) return null;
    const kind = golden ? 'golden' : 'blue';
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Golden hour is Burning Flame with ink text, and its name in words as the second cue. */}
        <span className={golden ? 'sb-label bg-highlight px-[7px] py-1 text-ink-fixed' : 'sb-label shrink-0 pt-[2px]'}>{label}</span>
        {band.allDay && <span data-sun-range={`${kind}-all-day`}>{t('callSheet.allDay')}</span>}
        {band.whole && (
          <span data-sun-range={`${kind}-whole`}>
            <Stretch range={band.whole} />
          </span>
        )}
        {band.morning && (
          <span data-sun-range={`${kind}-morning`}>
            <span className="text-text-muted">{t('callSheet.morning')} </span>
            <Stretch range={band.morning} />
          </span>
        )}
        {band.evening && (
          <span data-sun-range={`${kind}-evening`}>
            <span className="text-text-muted">{t('callSheet.evening')} </span>
            <Stretch range={band.evening} />
          </span>
        )}
      </div>
    );
  };
  return (
    <div data-sun="" className="flex flex-col gap-1">
      <p className="sb-label">{t('callSheet.sun')}</p>
      {sun.state === 'normal' ? (
        <p className="flex flex-wrap gap-x-4">
          <span>
            <span className="sb-label">{t('callSheet.sunrise')} </span>
            <span data-sun-rise="">
              <Clock time={sun.sunrise} next={sun.sunriseNext} prev={sun.sunrisePrev} />
            </span>
          </span>
          <span>
            <span className="sb-label">{t('callSheet.sunset')} </span>
            <span data-sun-set="">
              <Clock time={sun.sunset} next={sun.sunsetNext} prev={sun.sunsetPrev} />
            </span>
          </span>
        </p>
      ) : (
        <p data-sun-state={sun.state}>{sun.state === 'up' ? t('callSheet.sunUp') : t('callSheet.sunDown')}</p>
      )}
      {stretches(t('callSheet.goldenHour'), sun.golden, true)}
      {stretches(t('callSheet.blueHour'), sun.blue, false)}
      <p data-sun-zone="" className="text-[12px] text-text-muted">
        {zoneLine(zone)}
      </p>
    </div>
  );
}

function Time({ label, time }: { label: string; time: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <dt className="sb-label">{label}</dt>
      <dd className="font-mono text-[15px] font-bold">{time || '—'}</dd>
    </div>
  );
}

/** Copy map link (4.6): the same directions link the PDF prints and puts in its QR code, in the app Settings names. */
function CopyMapLink({ location }: { location: SheetLocation }) {
  const app = useDirectionsApp();
  const link = directionsLink(app, location.fields, location.place);
  if (link === null) return null;
  const name = location.fields.name || t('trash.unnamedLocation');
  return (
    <div>
      <Button
        aria-label={t('callSheet.copyMapLinkFor', { location: name })}
        onClick={() => {
          // A webview without clipboard access shows the link to copy by hand.
          const clipboard = (navigator as Partial<Navigator>).clipboard;
          if (!clipboard) {
            showInfo(t('location.linkNotCopied', { link }));
            return;
          }
          void clipboard.writeText(link).then(
            () => {
              showInfo(t('location.linkCopied'));
            },
            () => {
              showInfo(t('location.linkNotCopied', { link }));
            },
          );
        }}
      >
        {t('location.copyMapLink')}
      </Button>
    </div>
  );
}

/** The map on a location's block: about 100% wide and 160 px tall. */
const SHEET_MAP_HEIGHT = 160;

/** The live locations the day's frames are shot at; a field not filled in is left out, except the address. */
export function LocationsSection({ sheet }: { sheet: CallSheet }) {
  return (
    <Section label={t('callSheet.section.locations')}>
      {sheet.locations.length === 0 ? (
        // Nothing left to shoot: the Scenes section says so, and this one stays quiet.
        sheet.nothingLeft ? null : <Empty>{t('callSheet.noLocations')}</Empty>
      ) : (
        <ul>
          {sheet.locations.map((location) => {
            const { record, fields } = location;
            const contact = [fields.contact_name, fields.contact_phone].filter((part) => part.trim() !== '').join(' · ');
            const rows: [string, string, boolean][] = [
              [t('callSheet.contact'), contact, true],
              [t('callSheet.parking'), fields.parking, false],
              [t('callSheet.power'), fields.power, false],
            ];
            return (
              <li key={record.id} data-sheet-location={record.id} tabIndex={-1} className="flex flex-col gap-1 border-b border-border py-2 text-[13px] focus-visible:outline-offset-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span data-user-text="" className="font-semibold">
                    {fields.name || t('trash.unnamedLocation')}
                  </span>
                  <span className="sb-label">{LOCATION_STATUS_LABEL[fields.status]}</span>
                </p>
                {fields.address.trim() === '' ? (
                  // Truffle on paper; in dark mode the page's text, as the other warnings do (it falls below AA there).
                  <p className="text-warning dark:text-text">
                    <span aria-hidden="true">▲ </span>
                    {t('callSheet.noAddress')}
                  </p>
                ) : (
                  <p data-user-text="">{fields.address}</p>
                )}
                {rows
                  .filter(([, value]) => value.trim() !== '')
                  .map(([label, value, mono]) => (
                    <p key={label} className="flex gap-2">
                      <span className="sb-label shrink-0 pt-[2px]">{label}</span>
                      <span data-user-text="" className={mono ? 'font-mono' : undefined}>
                        {value}
                      </span>
                    </p>
                  ))}
                {/* The place on a map (4.10): a view only, zoom 16 on the place, with the pin and the tile credit. */}
                {location.place && <LocationMap locationId={record.id} place={location.place} moved={false} readOnly height={SHEET_MAP_HEIGHT} />}
                <CopyMapLink location={location} />
                <SunBlock location={location} />
                <WeatherBlock location={location} date={sheet.day.fields.date} callTime={sheet.day.fields.callTime} />
                <SafetyBox location={location} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** The day's scenes in board order, each with its characters and who plays them. */
export function ScenesSection({ sheet }: { sheet: CallSheet }) {
  return (
    <Section label={t('callSheet.section.scenes')}>
      {sheet.scenes.length === 0 ? (
        <Empty>{t(sheet.nothingLeft ? 'callSheet.nothingLeft' : 'callSheet.noScenes')}</Empty>
      ) : (
        <ul>
          {sheet.scenes.map(({ record, fields, location, frames, characters }) => (
            <li key={record.id} data-sheet-scene={record.id} tabIndex={-1} className="flex flex-col gap-1 border-b border-border py-2 text-[13px] focus-visible:outline-offset-2">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-bold">{sceneLabel(fields.number)}</span>
                <span data-user-text="" className="font-semibold">
                  {headingOf(fields)}
                </span>
                <span className="font-mono">{pageLabel(fields.pageEighths)}</span>
              </p>
              <p className="flex flex-wrap gap-x-3 text-text-muted">
                {location !== null && <span data-user-text="">{t('callSheet.atLocation', { location })}</span>}
                <span className="font-mono">{tn('count.frames', frames)}</span>
              </p>
              {characters.length > 0 && (
                <ul aria-label={t('callSheet.charactersOf', { scene: sceneLabel(fields.number) })}>
                  {characters.map(({ record: character, name, cast, onDay }) => (
                    <li key={character.id} className="flex gap-2 pl-3">
                      <span data-user-text="" className="font-semibold">
                        {name}
                      </span>
                      {cast ? <span data-user-text="">{cast.fields.name || t('people.unnamed')}</span> : <span className="text-text-muted">{t('callSheet.notCast')}</span>}
                      {/* A missed actor, said in words (muted, never colour alone). */}
                      {cast && !onDay && (
                        <span data-not-on-day="" className="text-text-muted">
                          {t('callSheet.notOnDay')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Who is on the day (4.2): the people on it with a Take off each, Add person, Add everyone. An edit's promise settles
 * once it has landed (true) so focus can move to what took the place of the button that went. The tile keys this by
 * day, so a pick never carries to another day.
 */
export function PeopleSection({
  sheet,
  dayName,
  onAdd,
  onRemove,
  onAddEveryone,
  onChoose,
}: {
  sheet: CallSheet;
  dayName: string;
  onAdd: (personId: string) => Promise<boolean>;
  onRemove: (personId: string) => Promise<boolean>;
  onAddEveryone: () => Promise<boolean>;
  onChoose: () => Promise<boolean>;
}) {
  const [pick, setPick] = useState('');
  const box = useRef<HTMLDivElement>(null);
  // A pick that has since gone on the day (or away) reads as none.
  const picked = sheet.notOnDay.some((p) => p.record.id === pick) ? pick : '';
  // Once the list has drawn again: the Take off of `id`, else the Add person field, else the first Take off.
  const focusAfter = (done: boolean, id: string | null) => {
    if (!done) return;
    requestAnimationFrame(() => {
      // Only focus lost with the button that went, or still in this section: never pull it from where the person has
      // gone since (a time or a note half typed would commit on the blur).
      const now = document.activeElement;
      if (now && now !== document.body && !box.current?.contains(now)) return;
      const row = id === null ? null : box.current?.querySelector<HTMLElement>(`[data-take-off="${CSS.escape(id)}"]`);
      (row ?? box.current?.querySelector<HTMLElement>('[data-add-person]') ?? box.current?.querySelector<HTMLElement>('[data-take-off]'))?.focus();
    });
  };
  if (!sheet.peopleChosen) {
    // A day from before 4.2: everyone is on it until someone chooses, so nothing changes by itself.
    return (
      <Section label={t('callSheet.section.people')}>
        <div ref={box} className="flex flex-wrap items-center gap-3 py-2">
          <p data-everyone="" className="text-[13px] text-text-muted">
            {sheet.peopleOdd ? t('callSheet.peopleOdd') : t('callSheet.everyone')}
          </p>
          {!sheet.peopleOdd && (
            <Button
              data-choose-people=""
              onClick={() => {
                void onChoose().then((done) => {
                  focusAfter(done, null);
                });
              }}
            >
              {t('callSheet.choose')}
            </Button>
          )}
        </div>
      </Section>
    );
  }
  const ids = sheet.people.map((p) => p.record.id);
  return (
    <Section label={t('callSheet.section.people')}>
      <div ref={box}>
        {sheet.people.length === 0 ? (
          <Empty>{t('callSheet.nobody')}</Empty>
        ) : (
          <ul>
            {sheet.people.map(({ record, fields }) => {
              const name = fields.name || t('people.unnamed');
              return (
                <li key={record.id} data-on-day={record.id} className="flex items-center gap-2 border-b border-border py-1 text-[13px]">
                  <span data-user-text="" className="min-w-0 flex-1 truncate font-semibold">
                    {name}
                  </span>
                  <Button
                    data-take-off={record.id}
                    aria-label={t('callSheet.takeOffNamed', { name, day: dayName })}
                    onClick={() => {
                      const at = ids.indexOf(record.id);
                      void onRemove(record.id).then((done) => {
                        focusAfter(done, ids[at + 1] ?? ids[at - 1] ?? null);
                      });
                    }}
                  >
                    {t('callSheet.takeOff')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {sheet.notOnDay.length === 0 ? (
          sheet.people.length > 0 && <Empty>{t('callSheet.allOn')}</Empty>
        ) : (
          <div className="flex flex-wrap items-end gap-2 py-2">
            <span className="w-56">
              <Select
                label={t('callSheet.addPerson')}
                value={picked}
                data-add-person=""
                onChange={(event) => {
                  setPick(event.currentTarget.value);
                }}
              >
                <option value="">{t('callSheet.pickPerson')}</option>
                {sheet.notOnDay.map(({ record, fields }) => (
                  <option key={record.id} value={record.id}>
                    {fields.name || t('people.unnamed')}
                  </option>
                ))}
              </Select>
            </span>
            <Button
              disabled={picked === ''}
              onClick={() => {
                const id = picked;
                setPick('');
                void onAdd(id).then((done) => {
                  focusAfter(done, null);
                });
              }}
            >
              {t('callSheet.addPersonButton')}
            </Button>
            <Button
              onClick={() => {
                void onAddEveryone().then((done) => {
                  focusAfter(done, null);
                });
              }}
            >
              {t('callSheet.addEveryone')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/** A person's phone and email where their record lets them print (4.2); nothing otherwise. */
function Contact({ contact }: { contact: SheetContact | null }) {
  const parts = contact ? [contact.phone, contact.email].filter((part) => part.trim() !== '') : [];
  if (parts.length === 0) return null;
  return (
    <span data-user-text="" data-sheet-contact="" className="font-mono text-[12px]">
      {parts.join(' · ')}
    </span>
  );
}

type OnTime = (personId: string, field: PersonTime, value: string) => void;

/**
 * The least minutes HMU needs before a call (4.8), at the top of Cast: one edit on blur or Enter. Enter keeps focus where
 * it is. The field follows the stored value (an undo shows) unless the person is in it.
 */
function HmuMinutes({ minutes, onCommit }: { minutes: number; onCommit: (minutes: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  // Only a field the person has typed in commits (as TimeInput does); otherwise it follows the stored value.
  const typed = useRef(false);
  useEffect(() => {
    const element = input.current;
    if (element && !typed.current) element.value = String(minutes);
  }, [minutes]);
  const commit = (element: HTMLInputElement) => {
    const wasTyped = typed.current;
    typed.current = false;
    const value = Number(element.value);
    if (wasTyped && element.value.trim() !== '' && Number.isInteger(value) && value >= HMU_MINUTES.min && value <= HMU_MINUTES.max) {
      if (value !== minutes) onCommit(value);
    } else element.value = String(minutes);
  };
  return (
    <div className="w-56 py-2">
      <TextField
        ref={input}
        label={t('callSheet.hmuMinutes')}
        type="number"
        mono
        data-hmu-minutes=""
        min={HMU_MINUTES.min}
        max={HMU_MINUTES.max}
        defaultValue={String(minutes)}
        onFocus={() => {
          typed.current = false;
        }}
        onInput={() => {
          typed.current = true;
        }}
        onBlur={(event) => {
          commit(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget);
        }}
      />
    </div>
  );
}

/** Each actor on the day once, with the characters they play that day, and their call, HMU ready and on set. */
export function CastSection({
  sheet,
  hmuMinutes,
  onHmuMinutes,
  onTime,
}: {
  sheet: CallSheet;
  /** The least minutes HMU needs before a call (4.8): what the HMU check holds the times to. */
  hmuMinutes: number;
  onHmuMinutes: (minutes: number) => void;
  onTime: OnTime;
}) {
  return (
    <Section label={t('callSheet.section.cast')}>
      <HmuMinutes minutes={hmuMinutes} onCommit={onHmuMinutes} />
      {sheet.cast.length === 0 ? (
        <Empty>{t('callSheet.noCast')}</Empty>
      ) : (
        <ul>
          {sheet.cast.map(({ person, characters, times, ownCall, contact }) => {
            const name = person.fields.name || t('people.unnamed');
            const id = person.record.id;
            return (
              <li key={id} data-sheet-cast={id} className="flex flex-col gap-1 border-b border-border py-1.5 text-[13px]">
                <p className="flex flex-wrap gap-x-2">
                  <span data-user-text="" className="font-semibold">
                    {name}
                  </span>
                  {characters.length > 0 && <span data-user-text="">{t('callSheet.plays', { characters: list(characters) })}</span>}
                  <Contact contact={contact} />
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <TimeInput
                    label={t('callSheet.callFor', { name })}
                    caption={t('callSheet.call')}
                    shown={times.call}
                    stored={ownCall}
                    onCommit={(value) => {
                      onTime(id, 'call', value);
                    }}
                  />
                  <TimeInput
                    label={t('callSheet.hmuReadyFor', { name })}
                    caption={t('callSheet.hmuReady')}
                    shown={times.hmuReady}
                    field="hmu_ready"
                    onCommit={(value) => {
                      onTime(id, 'hmu_ready', value);
                    }}
                  />
                  <TimeInput
                    label={t('callSheet.onSetFor', { name })}
                    caption={t('callSheet.onSet')}
                    shown={times.onSet}
                    onCommit={(value) => {
                      onTime(id, 'on_set', value);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** The crew by department, in the call sheet's order: each department's call, and each person's. */
export function CrewSection({ sheet, onDepartmentCall, onTime }: { sheet: CallSheet; onDepartmentCall: (department: Department, value: string) => void; onTime: OnTime }) {
  return (
    <Section label={t('callSheet.section.crew')}>
      {sheet.crew.length === 0 ? (
        <Empty>{t('callSheet.noCrew')}</Empty>
      ) : (
        sheet.crew.map(({ department, call, ownCall: departmentOwn, people }) => (
          <div key={department ?? 'none'} className="flex flex-col gap-1 border-b border-border py-2" data-sheet-department={department ?? 'none'}>
            <div className="flex flex-wrap items-center gap-3">
              {department ? <DepartmentTag department={department} label={DEPARTMENT_LABELS[department]} /> : <span className="sb-label">{t('callSheet.noDepartment')}</span>}
              {department && call !== null && (
                <TimeInput
                  label={t('callSheet.departmentCallFor', { department: DEPARTMENT_LABELS[department] })}
                  caption={t('callSheet.call')}
                  shown={call}
                  stored={departmentOwn}
                  onCommit={(value) => {
                    onDepartmentCall(department, value);
                  }}
                />
              )}
            </div>
            <ul>
              {people.map(({ record, fields, call: personCall, ownCall: personOwn, contact }) => {
                const what = fields.title.trim() || (fields.role ? ROLE_LABELS[fields.role] : '');
                const name = fields.name || t('people.unnamed');
                return (
                  <li key={record.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[13px]">
                    <span data-user-text="" className="font-semibold">
                      {name}
                    </span>
                    {what && (
                      <span data-user-text="" className="text-text-muted">
                        {what}
                      </span>
                    )}
                    <Contact contact={contact} />
                    <span className="ml-auto">
                      <TimeInput
                        label={t('callSheet.callFor', { name })}
                        caption={t('callSheet.call')}
                        shown={personCall}
                        stored={personOwn}
                        onCommit={(value) => {
                          onTime(record.id, 'call', value);
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}

/** The call sheet's own notes: each is one edit when the box is left, so one ⌘Z. */
export function NotesSection({ notes, onNote }: { notes: CallSheetNotes; onNote: (prop: CallsheetNote, value: string) => void }) {
  const box = (prop: CallsheetNote, label: string, value: string) => (
    <TextArea
      // Keyed by the value, so an undo shows in the box it changed.
      key={`${prop}:${value}`}
      label={label}
      rows={3}
      defaultValue={value}
      onBlur={(event) => {
        if (event.currentTarget.value !== value) onNote(prop, event.currentTarget.value);
      }}
    />
  );
  return (
    <Section label={t('callSheet.section.notes')}>
      <div className="flex flex-col gap-3 py-2">
        {box('notes', t('callSheet.general'), notes.general)}
        {box('safety_notes', t('callSheet.safety'), notes.safety)}
      </div>
    </Section>
  );
}
