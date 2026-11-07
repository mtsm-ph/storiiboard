import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { showInfo, showNotice } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import {
  LOCATION_STATUS_LABEL,
  LOCATION_STATUSES,
  LOCATION_TEXT_FIELDS,
  mapLink,
  projectLocations,
  type LocationFields,
  type LocationTextField,
} from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { TextArea, TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { compareSceneNumbers, locationNameTaken } from '../storyboard/board';
import { locationChange, newLocation, trashLocation } from './locationEdits';
import { LocationPhotos } from './LocationPhotos';
import { customFieldsOf, fieldNamesOf, hiddenFieldNames } from '../../core/model/customFields';
import { locationFieldRecords } from '../../core/model/location';
import { CustomFields } from '../storyboard/InspectorView';
import { setCustomField } from '../storyboard/board';

// The Locations tile (3.3), in the Production workspace: every place the project shoots, each with its address, its
// contact, parking and power notes, and whether it's booked; and which scenes are set there. A location is named once
// and linked from its scenes, so a change here is a change for all of them. Each field is one edit when it's left, so
// one ⌘Z; Delete sends it to the Trash. Copy map link puts an OpenStreetMap search for its address on the clipboard:
// nothing is looked up from here. Narrow (Production gives it a column), the list sits above the editor.

const FIELD_LABEL: Readonly<Record<LocationTextField, () => string>> = {
  address: () => t('location.address'),
  contact_name: () => t('location.contactName'),
  contact_phone: () => t('location.contactPhone'),
  contact_email: () => t('location.contactEmail'),
  parking: () => t('location.parking'),
  power: () => t('location.power'),
  notes: () => t('location.notes'),
};

const FIELD_TYPE: Partial<Record<LocationTextField, string>> = { contact_phone: 'tel', contact_email: 'email' };
/** Notes that run to a few lines. */
const LONG: ReadonlySet<LocationTextField> = new Set(['address', 'parking', 'power', 'notes']);
/** Narrower than this, the list goes above the editor rather than beside it. */
const SIDE_BY_SIDE = 520;

type Records = Readonly<Record<string, SbdRecord>>;

export function LocationsTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  const listId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const making = useRef(false);
  // The tile's own width, for the layout: a container, not the window, decides.
  const [width, setWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  // Measured as the element arrives too, so a wide tile never shows the narrow layout first.
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
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('locations.noProject')}</p>;
  const projectId = project.projectId;
  const all = projectLocations(records, projectId);
  const selected = all.find((l) => l.record.id === chosen) ?? all[0] ?? null;
  const wide = width >= SIDE_BY_SIDE;

  const edit = (build: (now: Records) => ReturnType<typeof locationChange>) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div ref={measure} className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div className={cx('flex shrink-0 flex-col border-border', wide ? 'w-[220px] border-r' : 'max-h-[40%] border-b')}>
        <div className="flex items-center gap-2 border-b border-border p-2">
          <p className="sb-label flex-1 font-mono">{tn('locations.count', all.length)}</p>
          <Button
            ref={newButton}
            onClick={() => {
              if (making.current) return;
              making.current = true;
              const id = crypto.randomUUID();
              // From the records at its turn, so two quick clicks never share a place in the list.
              void edit((now) => [newLocation(now, projectId, id)])
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
            {t('locations.new')}
          </Button>
        </div>
        {all.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('locations.none')}</p>
        ) : (
          <ul id={listId} aria-label={t('locations.list')} className="min-h-0 flex-1 overflow-y-auto">
            {all.map(({ record, fields, scenes }) => {
              const current = record.id === selected?.record.id;
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    aria-current={current || undefined}
                    data-location-id={record.id}
                    onClick={() => {
                      setChosen(record.id);
                    }}
                    // On the ink fill, the focus ring is paper (DESIGN.md: never ink on ink).
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left focus-visible:-outline-offset-2',
                      current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="max-w-full truncate text-[13px] font-semibold">{fields.name || t('locations.unnamed')}</span>
                    <span className="sb-label">
                      {LOCATION_STATUS_LABEL[fields.status]} · {tn('locations.scenes', scenes.length)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && (
        <LocationEditor
          key={selected.record.id}
          id={selected.record.id}
          props={selected.record.props}
          knownFields={fieldNamesOf(locationFieldRecords(records))}
          fields={selected.fields}
          scenes={selected.scenes}
          nameField={nameField}
          onChange={(prop, value) => {
            // One name per place: a rename onto another live location's name is refused, so the "/" menu never
            // offers two of the same.
            const taken = prop === 'name' ? locationNameTaken(projectStore.getState().records, projectId, value, selected.record.id) : null;
            if (taken) {
              showNotice(new Error(t(taken === 'live' ? 'location.nameTaken' : 'location.nameInTrash', { name: value.trim() })));
              return false;
            }
            // A name is kept trimmed, so the "/" menu and a typed name find it.
            void edit((now) => locationChange(now, selected.record.id, prop, prop === 'name' ? value.trim() : value));
            return true;
          }}
          onDelete={() => {
            const name = selected.fields.name || t('locations.unnamed');
            void edit((now) => trashLocation(now, selected.record.id)).then((done) => {
              if (!done) return;
              // A note about this step: an undo clears it.
              showInfo(t('locations.trashed', { name }), { step: true });
              // Focus to the list, whose row went; to New location when it was the last.
              requestAnimationFrame(() => {
                const row = document.getElementById(listId)?.querySelector<HTMLElement>('button');
                (row ?? newButton.current)?.focus();
              });
            });
          }}
        />
      )}
    </div>
  );
}

interface LocationEditorProps {
  id: string;
  props: SbdRecord['props'];
  /** Every custom field name the project's locations use, for a new field's suggestions. */
  knownFields: readonly string[];
  fields: LocationFields;
  scenes: SbdRecord[];
  nameField: React.RefObject<HTMLInputElement | null>;
  /** False when the change is refused (a name another location has): the field goes back to what's stored. */
  onChange: (prop: string, value: string) => boolean;
  onDelete: () => void;
}

function LocationEditor({ id, props, knownFields, fields, scenes, nameField, onChange, onDelete }: LocationEditorProps) {
  const editor = useRef<HTMLElement>(null);
  const headingId = useId();
  const text = (prop: 'name' | LocationTextField, label: string, long = false, type?: string) => {
    const value = fields[prop];
    // Keyed by the value, so an undo shows in the field it changed and the others keep focus.
    const key = `${prop}:${value}`;
    const onBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      if (next !== value && !onChange(prop, next)) event.currentTarget.value = value;
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
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };
  /** The link from what's in the fields now, typed and not yet written included. */
  const currentLink = () => {
    const read = (prop: string) => editor.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${prop}"]`)?.value ?? '';
    return mapLink({ address: read('address'), name: read('name') });
  };
  const sorted = [...scenes].sort((a, b) => compareSceneNumbers(sceneFields(a.props).number, sceneFields(b.props).number));
  return (
    <section ref={editor} aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-location-editor="">
      <h3 id={headingId} className="sb-label">
        {fields.name || t('locations.unnamed')}
      </h3>
      {text('name', t('location.name'))}
      <SegmentedControl
        label={t('location.status')}
        options={LOCATION_STATUSES.map((value) => ({ value, label: LOCATION_STATUS_LABEL[value] }))}
        value={fields.status}
        onChange={(status) => {
          onChange('status', status);
        }}
      />
      {LOCATION_TEXT_FIELDS.map((prop) => text(prop, FIELD_LABEL[prop](), LONG.has(prop), FIELD_TYPE[prop]))}
      <LocationPhotos locationId={id} name={fields.name || t('locations.unnamed')} />
      <div className="flex flex-col gap-3">
        <h4 className="sb-label">{t('location.customFields')}</h4>
        {/* The location's own fields (drone permit, curfew, anything), as a frame's are (1.19). */}
        <CustomFields
          fields={customFieldsOf(props)}
          known={knownFields}
          hidden={hiddenFieldNames(props)}
          onChange={async (name, value) => {
            // Worked out when it lands, so two fields added quickly both stay.
            await projectStore.getState().applyWith((now) => ({ changes: setCustomField(now, id, name, value) }));
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const link = currentLink();
            if (!link) {
              showInfo(t('location.nothingToMap'));
              return;
            }
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
        <Button className="ml-auto" onClick={onDelete}>
          {t('location.delete')}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="sb-label">{t('location.scenesHere')}</h4>
        {sorted.length === 0 ? (
          <p className="text-[12px] text-text-muted">{t('location.noScenes')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {sorted.map((scene) => {
              const f = sceneFields(scene.props);
              return (
                <li key={scene.id}>
                  <span className="font-mono">{sceneLabel(f.number)}</span> {f.name}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
