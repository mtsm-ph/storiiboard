import { useId, type ReactNode } from 'react';
import { list, t, tn } from '../../core/i18n';
import { dayDateFull, type CallSheet, type CallSheetNotes } from '../../core/model/callsheet';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { ROLE_LABELS } from '../../core/model/role';
import { pageLabel, sceneLabel } from '../../core/model/storyboard';
import { headingOf } from '../storyboard/ScenesView';
import { TextArea } from '../../ui/fields';
import { DepartmentTag } from '../../ui/tags';
import type { CallsheetNote } from './callsheetEdits';

// The call sheet's sections (4.1), one small component each, so a later milestone adds a section without reshaping
// the others. They only draw what callSheet() worked out; the notes are the only thing here a person edits.

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
      </div>
    </Section>
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

/** The live locations the day's frames are shot at; a field not filled in is left out, except the address. */
export function LocationsSection({ sheet }: { sheet: CallSheet }) {
  return (
    <Section label={t('callSheet.section.locations')}>
      {sheet.locations.length === 0 ? (
        <Empty>{t('callSheet.noLocations')}</Empty>
      ) : (
        <ul>
          {sheet.locations.map(({ record, fields }) => {
            const contact = [fields.contact_name, fields.contact_phone].filter((part) => part.trim() !== '').join(' · ');
            const rows: [string, string, boolean][] = [
              [t('callSheet.contact'), contact, true],
              [t('callSheet.parking'), fields.parking, false],
              [t('callSheet.power'), fields.power, false],
            ];
            return (
              <li key={record.id} data-sheet-location={record.id} className="flex flex-col gap-1 border-b border-border py-2 text-[13px]">
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
        <Empty>{t('callSheet.noScenes')}</Empty>
      ) : (
        <ul>
          {sheet.scenes.map(({ record, fields, location, frames, characters }) => (
            <li key={record.id} data-sheet-scene={record.id} className="flex flex-col gap-1 border-b border-border py-2 text-[13px]">
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
                  {characters.map(({ record: character, name, cast }) => (
                    <li key={character.id} className="flex gap-2 pl-3">
                      <span data-user-text="" className="font-semibold">
                        {name}
                      </span>
                      {cast ? <span data-user-text="">{cast.fields.name || t('people.unnamed')}</span> : <span className="text-text-muted">{t('callSheet.notCast')}</span>}
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

/** Each actor of the day's scenes once, with the characters they play that day. */
export function CastSection({ sheet }: { sheet: CallSheet }) {
  return (
    <Section label={t('callSheet.section.cast')}>
      {sheet.cast.length === 0 ? (
        <Empty>{t('callSheet.noCast')}</Empty>
      ) : (
        <ul>
          {sheet.cast.map(({ person, characters }) => (
            <li key={person.record.id} data-sheet-cast={person.record.id} className="flex flex-wrap gap-x-2 border-b border-border py-1.5 text-[13px]">
              <span data-user-text="" className="font-semibold">
                {person.fields.name || t('people.unnamed')}
              </span>
              <span data-user-text="">{t('callSheet.plays', { characters: list(characters) })}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The crew by department, in the call sheet's order; no phone or email until 4.2 says whose may print. */
export function CrewSection({ sheet }: { sheet: CallSheet }) {
  return (
    <Section label={t('callSheet.section.crew')}>
      {sheet.crew.length === 0 ? (
        <Empty>{t('callSheet.noCrew')}</Empty>
      ) : (
        sheet.crew.map(({ department, people }) => (
          <div key={department ?? 'none'} className="flex flex-col gap-1 border-b border-border py-2" data-sheet-department={department ?? 'none'}>
            {department ? <DepartmentTag department={department} label={DEPARTMENT_LABELS[department]} /> : <span className="sb-label">{t('callSheet.noDepartment')}</span>}
            <ul>
              {people.map(({ record, fields }) => {
                const what = fields.title.trim() || (fields.role ? ROLE_LABELS[fields.role] : '');
                return (
                  <li key={record.id} className="flex flex-wrap gap-x-2 py-0.5 text-[13px]">
                    <span data-user-text="" className="font-semibold">
                      {fields.name || t('people.unnamed')}
                    </span>
                    {what && (
                      <span data-user-text="" className="text-text-muted">
                        {what}
                      </span>
                    )}
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
