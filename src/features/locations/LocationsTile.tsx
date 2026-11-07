import { useId, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
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
import { TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { locationChange, newLocation, trashLocation } from './locationEdits';

// The Locations tile (3.3), in the Production workspace: every place the project shoots, each with its address, its
// contact, parking and power notes, and whether it's booked; and which scenes are set there. A location is named once
// and linked from its scenes, so a change here is a change for all of them. Each field is one edit when it's left, so
// one ⌘Z; Delete sends it to the Trash. Copy map link puts an OpenStreetMap search for its address on the clipboard:
// nothing is looked up from here.

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

export function LocationsTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  const listId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('locations.noProject')}</p>;
  const all = projectLocations(records, project.projectId);
  const selected = all.find((l) => l.record.id === chosen) ?? all[0] ?? null;

  const edit = (build: (now: Readonly<Record<string, SbdRecord>>) => ReturnType<typeof locationChange>) =>
    projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-2">
          <p className="sb-label flex-1 font-mono">{tn('locations.count', all.length)}</p>
          <Button
            onClick={() => {
              const change = newLocation(records, project.projectId);
              void projectStore
                .getState()
                .apply([change])
                .then(() => {
                  setChosen(change.record.id ?? null);
                  requestAnimationFrame(() => nameField.current?.focus());
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
                    className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left focus-visible:-outline-offset-2 ${current ? 'bg-text text-text-inverse' : 'hover:bg-surface-raised'}`}
                  >
                    <span className="truncate text-[13px] font-semibold">{fields.name || t('locations.unnamed')}</span>
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
          fields={selected.fields}
          scenes={selected.scenes}
          nameField={nameField}
          onChange={(prop, value) => void edit((now) => locationChange(now, selected.record.id, prop, value))}
          onDelete={() => {
            const name = selected.fields.name || t('locations.unnamed');
            void edit((now) => trashLocation(now, selected.record.id)).then((done) => {
              if (done) showInfo(t('locations.trashed', { name }));
              // Focus to the list, whose row went.
              requestAnimationFrame(() => document.getElementById(listId)?.querySelector<HTMLElement>('button')?.focus());
            });
          }}
        />
      )}
    </div>
  );
}

interface LocationEditorProps {
  id: string;
  fields: LocationFields;
  scenes: SbdRecord[];
  nameField: React.RefObject<HTMLInputElement | null>;
  onChange: (prop: string, value: string) => void;
  onDelete: () => void;
}

function LocationEditor({ fields, scenes, nameField, onChange, onDelete }: LocationEditorProps) {
  const link = mapLink(fields);
  const text = (prop: 'name' | LocationTextField, label: string, long = false, type?: string) => {
    const value = fields[prop];
    // Keyed by the value, so an undo shows in the field it changed and the others keep focus.
    const key = `${prop}:${value}`;
    const common = {
      defaultValue: value,
      onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const next = event.currentTarget.value;
        if (next !== value) onChange(prop, next);
      },
    };
    return long ? <TextArea key={key} {...common} label={label} /> : (
      <TextField
        key={key}
        {...common}
        {...(prop === 'name' ? { ref: nameField } : {})}
        label={label}
        {...(type ? { type } : {})}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-location-editor="">
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
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={link === null}
          onClick={() => {
            if (!link) return;
            void navigator.clipboard.writeText(link).then(
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
      <section className="flex flex-col gap-1">
        <h3 className="sb-label">{t('location.scenesHere')}</h3>
        {scenes.length === 0 ? (
          <p className="text-[12px] text-text-muted">{t('location.noScenes')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {scenes.map((scene) => {
              const f = sceneFields(scene.props);
              return (
                <li key={scene.id}>
                  <span className="font-mono">{sceneLabel(f.number)}</span> {f.name}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function TextArea({ label, ...rest }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="sb-label">
        {label}
      </label>
      <textarea id={id} rows={2} className="w-full border border-text bg-surface-raised px-2.5 py-2 text-[13px] text-text" {...rest} />
    </div>
  );
}
