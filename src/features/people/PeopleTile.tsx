import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { setProjectSelf, useProjectSelf } from '../../app/settings/projectRole';
import { t, tn } from '../../core/i18n';
import { customFieldsOf, fieldNamesOf, hiddenFieldNames } from '../../core/model/customFields';
import { DEPARTMENT_LABELS, DEPARTMENTS } from '../../core/model/department';
import { castOf, characterName, contactOnSheet, PERSON_TEXT_FIELDS, personFieldRecords, personFullView, personPart, projectCharacters, projectPeople, type PersonFields, type PersonTextField } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import { ROLE_LABELS, ROLES } from '../../core/model/role';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Select, TextArea, TextField } from '../../ui/fields';
import { setCustomField } from '../storyboard/board';
import { CustomFields } from '../storyboard/InspectorView';
import { focusOf } from '../department/perspective';
import { castCharacter, newPerson, personChange, personDepartment, personContactOnSheetChange, personFullViewChange, personRole, trashPerson } from './personEdits';

// The Cast & crew tile (3.5), in the Production workspace: everyone on the production, each with their departments
// (several: a DP is camera and grip and electric), one main role, a title for the call sheet, and their phone and email.
// Contacts are private: shown here, never logged or named in History. Each field is one edit when it's left, so one ⌘Z;
// Delete sends a person to the Trash. Narrow (Production gives it a column), the list sits above the editor.

const FIELD_LABEL: Readonly<Record<PersonTextField, () => string>> = {
  title: () => t('person.title'),
  phone: () => t('person.phone'),
  email: () => t('person.email'),
  notes: () => t('person.notes'),
};
const FIELD_TYPE: Partial<Record<PersonTextField, string>> = { phone: 'tel', email: 'email' };
/** Narrower than this, the list goes above the editor rather than beside it. */
const SIDE_BY_SIDE = 520;

type Records = Readonly<Record<string, SbdRecord>>;

/** "DP · Camera, Grip & electric": what a row says under the name. */
function summary(fields: PersonFields): string {
  const role = fields.role ? ROLE_LABELS[fields.role] : null;
  const departments = fields.departments.map((d) => DEPARTMENT_LABELS[d]).join(', ');
  return [role, departments].filter((part) => part).join(' · ') || t('people.noRole');
}

export function PeopleTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  // Who you are here (3.5c): on this computer only, never in the file.
  const self = useProjectSelf(project?.projectId);
  const listId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const making = useRef(false);
  // The tile's own width, for the layout: a container, not the window, decides.
  const [width, setWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const measure = useCallback((element: HTMLDivElement | null) => {
    setBox(element);
    if (element) setWidth(element.getBoundingClientRect().width);
  }, []);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [box]);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('people.noProject')}</p>;
  const projectId = project.projectId;
  const all = projectPeople(records, projectId);
  const selected = all.find((p) => p.record.id === chosen) ?? all[0] ?? null;
  const wide = width >= SIDE_BY_SIDE;

  const edit = (build: (now: Records) => ReturnType<typeof personChange>) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div ref={measure} className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div className={cx('flex shrink-0 flex-col border-border', wide ? 'w-[220px] border-r' : 'max-h-[40%] border-b')}>
        <div className="flex items-center gap-2 border-b border-border p-2">
          <p className="sb-label flex-1 font-mono">{tn('people.count', all.length)}</p>
          <Button
            ref={newButton}
            onClick={() => {
              if (making.current) return;
              making.current = true;
              const id = crypto.randomUUID();
              void edit((now) => [newPerson(now, projectId, id)])
                .then((made) => {
                  if (!made) return;
                  setChosen(id);
                  requestAnimationFrame(() => nameField.current?.focus());
                })
                .finally(() => {
                  making.current = false;
                });
            }}
          >
            {t('people.new')}
          </Button>
        </div>
        {all.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('people.none')}</p>
        ) : (
          <ul id={listId} aria-label={t('people.list')} className="min-h-0 flex-1 overflow-y-auto">
            {all.map(({ record, fields }) => {
              const current = record.id === selected?.record.id;
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    aria-current={current || undefined}
                    data-person-id={record.id}
                    onClick={() => {
                      setChosen(record.id);
                    }}
                    // On the ink fill, the focus ring is paper (DESIGN.md: never ink on ink).
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left focus-visible:-outline-offset-2',
                      current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="flex max-w-full items-baseline gap-1.5">
                      <span className="truncate text-[13px] font-semibold">{fields.name || t('people.unnamed')}</span>
                      {/* Words, not a mark alone, heard after the name as a word of its own. */}
                      {record.id === self && (
                        <span className="sb-label shrink-0 font-mono">
                          <span className="sr-only">, </span>
                          {t('people.you')}
                        </span>
                      )}
                    </span>
                    <span className="sb-label max-w-full truncate">{summary(fields)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && (
        <PersonEditor
          key={selected.record.id}
          id={selected.record.id}
          props={selected.record.props}
          knownFields={fieldNamesOf(personFieldRecords(records))}
          characters={projectCharacters(records, projectId).map((character) => {
            const cast = castOf(records, character);
            return { id: character.id, name: characterName(character), playedBy: cast ? cast.id : null, castName: cast && typeof cast.props.name === 'string' ? cast.props.name : '' };
          })}
          onCast={(characterId, on) => {
            const me = selected.record.id;
            // Who had the part as the edit finds it, so a move says whom it was taken from.
            let movedFrom: { character: string; name: string } | null = null;
            void projectStore
              .getState()
              .applyWith((now) => {
                const character = now[characterId];
                const had = character ? castOf(now, character) : null;
                movedFrom =
                  on && character && had && had.id !== me ? { character: characterName(character), name: (typeof had.props.name === 'string' && had.props.name.trim()) || t('people.unnamed') } : null;
                return { changes: castCharacter(now, characterId, on ? me : null, on ? undefined : me) };
              })
              .then((done) => {
                // A part taken from someone else is said, since nothing on screen shows them losing it; an undo clears it.
                if (done && movedFrom) showInfo(t('person.castMoved', movedFrom), { step: true });
              });
          }}
          fields={selected.fields}
          isMe={selected.record.id === self}
          onMe={(me) => {
            setProjectSelf(projectId, me ? selected.record.id : null);
          }}
          nameField={nameField}
          onChange={(prop, value) => {
            // A name is kept trimmed, so a call sheet and a search find it.
            void edit((now) => personChange(now, selected.record.id, prop, prop === 'name' ? value.trim() : value));
          }}
          onRole={(role) => {
            void edit((now) => personRole(now, selected.record.id, role));
          }}
          onDepartment={(department, on) => {
            void edit((now) => personDepartment(now, selected.record.id, department, on));
          }}
          onFullView={(on) => {
            void edit((now) => personFullViewChange(now, selected.record.id, on));
          }}
          onContactOnSheet={(on) => {
            void edit((now) => personContactOnSheetChange(now, selected.record.id, on));
          }}
          onDelete={() => {
            const id = selected.record.id;
            const at = all.findIndex((p) => p.record.id === id);
            // Named as the edit finds them, so a name typed and not yet left is the one the notice says.
            let name = '';
            void projectStore
              .getState()
              .applyWith((now) => {
                const person = now[id];
                name = (person && typeof person.props.name === 'string' && person.props.name.trim()) || t('people.unnamed');
                return { changes: trashPerson(now, id) };
              })
              .then((done) => {
                if (!done) return;
                // A note about this step: an undo clears it.
                showInfo(t('people.trashed', { name }), { step: true });
                // The one after takes its place, else the one before; New person when it was the last.
                const next = all[at + 1] ?? all[at - 1] ?? null;
                setChosen(next?.record.id ?? null);
                requestAnimationFrame(() => {
                  const row = next ? document.getElementById(listId)?.querySelector<HTMLElement>(`[data-person-id="${next.record.id}"]`) : null;
                  (row ?? newButton.current)?.focus();
                });
              });
          }}
        />
      )}
    </div>
  );
}

interface PersonEditorProps {
  id: string;
  props: SbdRecord['props'];
  /** Every custom field name the project's people use, for a new field's suggestions. */
  knownFields: readonly string[];
  fields: PersonFields;
  /** Whether this person is you on this project (3.5c). */
  isMe: boolean;
  onMe: (me: boolean) => void;
  nameField: React.RefObject<HTMLInputElement | null>;
  onChange: (prop: string, value: string) => void;
  onRole: (role: string | null) => void;
  onDepartment: (department: (typeof DEPARTMENTS)[number], on: boolean) => void;
  /** Full view on or off (3.6c): set on the person, in the file. */
  onFullView: (on: boolean) => void;
  /** Phone and email on call sheets on or off (4.2): set on the person, in the file. */
  onContactOnSheet: (on: boolean) => void;
  /** The project's characters, and who plays each: picking one casts this person, again uncasts them. */
  characters: readonly { id: string; name: string; playedBy: string | null; castName: string }[];
  onCast: (characterId: string, on: boolean) => void;
  onDelete: () => void;
}

function PersonEditor({ id, props, knownFields, fields, isMe, onMe, nameField, onChange, onRole, onDepartment, onFullView, onContactOnSheet, characters, onCast, onDelete }: PersonEditorProps) {
  const playsId = useId();
  const fullViewNoteId = useId();
  const fullView = personFullView(fields);
  const contactNoteId = useId();
  const contactShown = contactOnSheet(fields);
  // Off, but nothing to fold (no department of their own, or every one): they see everything, and the note says so.
  const folded = focusOf({ fullView, departments: personPart(fields).departments }) !== null;
  const meNoteId = useId();
  const headingId = useId();
  const departmentsId = useId();
  const text = (prop: 'name' | PersonTextField, label: string, long = false, type?: string) => {
    const value = fields[prop];
    // Keyed by the value, so an undo shows in the field it changed and the others keep focus.
    const key = `${prop}:${value}`;
    const onBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      if (next !== value) onChange(prop, next);
    };
    return long ? (
      <TextArea key={key} defaultValue={value} onBlur={onBlur} label={label} data-field={prop} />
    ) : (
      <TextField
        key={key}
        defaultValue={value}
        onBlur={onBlur}
        {...(prop === 'name' ? { ref: nameField } : {})}
        label={label}
        data-field={prop}
        {...(type ? { type } : {})}
        // Never offered from, or saved to, the browser's own autofill: a cast member's phone stays in the project.
        autoComplete="off"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-person-editor="">
      <h3 id={headingId} className="sb-label">
        {fields.name || t('people.unnamed')}
      </h3>
      {text('name', t('person.name'))}
      {/* Who you are here (3.5c): your approvals and Seen follow this person. A setting on this computer, not an edit. */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-pressed={isMe}
          aria-describedby={meNoteId}
          data-this-is-me=""
          onClick={() => {
            onMe(!isMe);
          }}
          className={cx(
            'self-start border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
            isMe ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
          )}
        >
          {t('person.thisIsMe')}
        </button>
        <p id={meNoteId} className="text-[12px] text-text-muted">
          {isMe ? t('person.thisIsMeOn') : t('person.thisIsMeNote')}
        </p>
      </div>
      <Select
        label={t('person.role')}
        value={fields.role ?? ''}
        onChange={(event) => {
          const role = event.currentTarget.value;
          onRole(role === '' ? null : role);
        }}
      >
        <option value="">{t('person.noRole')}</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </Select>
      <div role="group" aria-labelledby={departmentsId} className="flex flex-col gap-1">
        <span id={departmentsId} className="sb-label">
          {t('person.departments')}
        </span>
        <div className="flex flex-wrap gap-1">
          {DEPARTMENTS.map((department) => {
            const on = fields.departments.includes(department);
            return (
              // Picked shows an ink fill, as every selection does; the pressed state says so to a screen reader.
              <button
                key={department}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onDepartment(department, !on);
                }}
                className={cx(
                  'border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
                  // On the ink fill, the focus ring is paper and inside (DESIGN.md: never ink on ink).
                  on ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                )}
              >
                {DEPARTMENT_LABELS[department]}
              </button>
            );
          })}
        </div>
      </div>
      {/* Full view (3.6c): every department first, as the director and the DP see it, or their own first with the
          rest folded under Rest of crew. On by default for the director and the DP. A focus view, not access. */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={fullView}
          aria-describedby={fullViewNoteId}
          data-full-view=""
          onClick={() => {
            onFullView(!fullView);
          }}
          className={cx(
            'self-start border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
            fullView ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
          )}
        >
          {t('person.fullView')}
        </button>
        <p id={fullViewNoteId} className="text-[12px] text-text-muted">
          {fullView ? t('person.fullViewOn') : folded ? t('person.fullViewOff') : t('person.fullViewNothingToFold')}{' '}
          {t('person.fullViewNotAccess')}
        </p>
      </div>
      {characters.length > 0 && (
        // The characters they play (3.5b): one cast member each, so picking one another plays moves it here.
        <div role="group" aria-labelledby={playsId} className="flex flex-col gap-1">
          <span id={playsId} className="sb-label">
            {t('person.plays')}
          </span>
          <div className="flex flex-wrap gap-1">
            {characters.map((character) => {
              const mine = character.playedBy === id;
              const other = character.playedBy !== null && !mine;
              return (
                <span key={character.id} className="flex items-baseline gap-1">
                  <button
                    type="button"
                    aria-pressed={mine}
                    // Named by the character alone, whatever its state; who plays it now is beside it, as its description.
                    aria-describedby={other ? `${playsId}-${character.id}` : undefined}
                    onClick={() => {
                      onCast(character.id, !mine);
                    }}
                    className={cx(
                      'border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
                      // On the ink fill, the focus ring is paper and inside (DESIGN.md: never ink on ink).
                      mine ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    {character.name}
                  </button>
                  {other && (
                    <span id={`${playsId}-${character.id}`} className="text-[12px] text-text-muted">
                      {t('person.playedBy', { name: character.castName || t('people.unnamed') })}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {PERSON_TEXT_FIELDS.map((prop) => (
        <Fragment key={prop}>
          {text(prop, FIELD_LABEL[prop](), prop === 'notes', FIELD_TYPE[prop])}
          {/* Whether the phone and email above print on call sheets (4.2): on for crew, off for cast, until it is set. */}
          {prop === 'email' && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={contactShown}
                aria-describedby={contactNoteId}
                data-contact-on-sheet=""
                onClick={() => {
                  onContactOnSheet(!contactShown);
                }}
                className={cx(
                  'self-start border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
                  contactShown ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                )}
              >
                {t('person.contactOnSheet')}
              </button>
              <p id={contactNoteId} className="text-[12px] text-text-muted">
                {contactShown ? t('person.contactOnSheetOn') : t('person.contactOnSheetOff')}
              </p>
            </div>
          )}
        </Fragment>
      ))}
      <div className="flex flex-col gap-3">
        <h4 className="sb-label">{t('person.customFields')}</h4>
        <CustomFields
          of="person"
          fields={customFieldsOf(props)}
          known={knownFields}
          hidden={hiddenFieldNames(props)}
          onChange={async (name, value) => {
            // Only while they're live: a field left as Delete lands isn't written to the trashed person.
            await projectStore.getState().applyWith((now) => ({ changes: now[id]?.type === 'person' && now[id].trashedAt === null ? setCustomField(now, id, name, value) : [] }));
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="ml-auto" onClick={onDelete}>
          {t('people.delete')}
        </Button>
      </div>
    </section>
  );
}
